import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HubConfig } from "../config.js";
import type { OpenCodeProvider } from "../providers/opencode/provider.js";
import type { HubDatabase } from "./database.js";

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function validBackupId(value: string): boolean {
  return /^[a-z0-9-]{20,80}$/i.test(value);
}

export interface CleanupPreview {
  cutoff: string;
  retentionDays: number;
  runCount: number;
  artifactCount: number;
  artifactBytes: number;
}

export class StorageMaintenanceService {
  private readonly backupRoot: string;
  private readonly workspaceRoot: string;

  constructor(
    private readonly config: HubConfig,
    private readonly database: HubDatabase,
    private readonly provider: OpenCodeProvider,
  ) {
    this.backupRoot = path.resolve(config.projectRoot, "data", "backups");
    this.workspaceRoot = path.resolve(config.projectRoot, "runtime", "runs");
  }

  previewCleanup(retentionDays = this.config.artifactRetentionDays ?? 30): CleanupPreview {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const runs = this.database.listCompletedRunsBefore(cutoff);
    const artifacts = runs.flatMap((run) => this.database.listArtifacts(run.id));
    return {
      cutoff,
      retentionDays,
      runCount: runs.length,
      artifactCount: artifacts.length,
      artifactBytes: artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
    };
  }

  async cleanup(retentionDays = this.config.artifactRetentionDays ?? 30): Promise<CleanupPreview & { deletedRuns: number }> {
    const preview = this.previewCleanup(retentionDays);
    const runs = this.database.listCompletedRunsBefore(preview.cutoff);
    const removable: string[] = [];
    for (const run of runs) {
      const workspace = path.resolve(this.workspaceRoot, run.workspaceId);
      if (!isWithin(this.workspaceRoot, workspace)) continue;
      await rm(workspace, { recursive: true, force: true, maxRetries: 2 });
      removable.push(run.id);
    }
    return { ...preview, deletedRuns: this.database.deleteRuns(removable) };
  }

  diagnostics(): Record<string, unknown> {
    const storage = this.database.getAdminStorageSummary();
    return {
      format: "skill-web-hub-diagnostics-v1",
      generatedAt: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      provider: this.provider.getHealthSnapshot(),
      configuration: {
        provider: "opencode",
        mode: this.config.opencode.mode,
        modelConfigured: Boolean(this.config.opencode.model),
        pagePromptVersion: this.config.pagePromptVersion,
        skillRootCount: this.config.opencode.skillRoots.length,
        artifactRetentionDays: this.config.artifactRetentionDays ?? 30,
      },
      storage,
      schemaMigrations: this.database.listSchemaMigrations(),
    };
  }

  async createBackup(): Promise<{ id: string; createdAt: string; generatedPageCount: number }> {
    const id = `backup-${new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").replace("Z", "")}-${randomUUID().slice(0, 8)}`;
    const destination = path.join(this.backupRoot, id);
    await mkdir(destination, { recursive: true });
    await this.database.backup(path.join(destination, "hub.db"));
    const generatedRoot = path.resolve(this.config.projectRoot, "frontend", "generated");
    const generatedDestination = path.join(destination, "generated-pages");
    let generatedPageCount = 0;
    try {
      const entries = await readdir(generatedRoot, { withFileTypes: true });
      generatedPageCount = entries.filter((entry) => entry.isDirectory()).length;
      await cp(generatedRoot, generatedDestination, { recursive: true, force: true, dereference: false, verbatimSymlinks: true });
    } catch {
      // No generated pages is a valid backup state.
    }
    const createdAt = new Date().toISOString();
    await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify({
      format: "skill-web-hub-backup-v1",
      id,
      createdAt,
      contents: ["hub.db", "generated-pages", "manifest.json"],
      generatedPageCount,
      diagnostics: this.diagnostics(),
    }, null, 2)}\n`, "utf8");
    return { id, createdAt, generatedPageCount };
  }

  async listBackups(): Promise<Array<{ id: string; createdAt: string; sizeBytes: number }>> {
    try {
      const entries = await readdir(this.backupRoot, { withFileTypes: true });
      const backups = await Promise.all(entries.filter((entry) => entry.isDirectory() && validBackupId(entry.name)).map(async (entry) => {
        const folder = path.join(this.backupRoot, entry.name);
        const details = await stat(path.join(folder, "hub.db"));
        return { id: entry.name, createdAt: details.birthtime.toISOString(), sizeBytes: details.size };
      }));
      return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch {
      return [];
    }
  }

  async openBackup(id: string): Promise<string | undefined> {
    if (!validBackupId(id)) return undefined;
    const target = path.resolve(this.backupRoot, id, "hub.db");
    if (!isWithin(this.backupRoot, target)) return undefined;
    try {
      const details = await stat(target);
      return details.isFile() ? target : undefined;
    } catch {
      return undefined;
    }
  }
}
