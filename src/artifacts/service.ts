import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { HubConfig } from "../config.js";
import { HubDatabase } from "../storage/database.js";
import type { ArtifactRecord, RunRecord } from "../types.js";

const maximumArtifactBytes = 50 * 1024 * 1024;
const maximumArtifactsPerRun = 200;
const skippedDirectories = new Set([".git", ".opencode", "node_modules", "uploads"]);

const mimeTypes: Record<string, string> = {
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mimeTypeFor(filename: string): string {
  return mimeTypes[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export function canPreviewArtifact(artifact: ArtifactRecord): boolean {
  return artifact.mimeType.startsWith("image/")
    || artifact.mimeType === "application/pdf"
    || artifact.mimeType.startsWith("text/")
    || artifact.mimeType.startsWith("application/json");
}

export class ArtifactService {
  constructor(
    private readonly config: HubConfig,
    private readonly database: HubDatabase,
  ) {}

  async collect(run: RunRecord): Promise<ArtifactRecord[]> {
    const workspaceRoot = this.workspaceRoot(run);
    const discovered: ArtifactRecord[] = [];
    await this.collectDirectory(run, workspaceRoot, workspaceRoot, discovered);
    return discovered;
  }

  list(runId: string): ArtifactRecord[] {
    return this.database.listArtifacts(runId);
  }

  get(id: string): ArtifactRecord | undefined {
    return this.database.getArtifact(id);
  }

  async open(id: string): Promise<{ artifact: ArtifactRecord; filePath: string } | undefined> {
    const artifact = this.get(id);
    if (!artifact) return undefined;
    const run = this.database.getRun(artifact.runId);
    if (!run) return undefined;
    const root = this.workspaceRoot(run);
    const filePath = path.resolve(root, artifact.relativePath);
    if (!isWithin(root, filePath)) return undefined;
    try {
      const details = await lstat(filePath);
      if (!details.isFile() || details.isSymbolicLink() || details.size !== artifact.sizeBytes) return undefined;
    } catch {
      return undefined;
    }
    return { artifact, filePath };
  }

  createReadStream(filePath: string) {
    return createReadStream(filePath);
  }

  private workspaceRoot(run: RunRecord): string {
    const root = path.resolve(this.config.projectRoot, "runtime", "runs");
    const workspace = path.resolve(root, run.workspaceId);
    if (!isWithin(root, workspace)) throw new Error("Invalid run workspace");
    return workspace;
  }

  private async collectDirectory(run: RunRecord, root: string, directory: string, discovered: ArtifactRecord[]): Promise<void> {
    if (discovered.length >= maximumArtifactsPerRun) return;
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (discovered.length >= maximumArtifactsPerRun) return;
      if (entry.isSymbolicLink()) continue;
      const target = path.resolve(directory, entry.name);
      if (!isWithin(root, target)) continue;
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) await this.collectDirectory(run, root, target, discovered);
        continue;
      }
      if (!entry.isFile()) continue;
      let details: Awaited<ReturnType<typeof lstat>>;
      try {
        details = await lstat(target);
      } catch {
        continue;
      }
      if (!details.isFile() || details.isSymbolicLink() || details.size > maximumArtifactBytes) continue;
      const relativePath = path.relative(root, target).split(path.sep).join("/");
      const buffer = await readFile(target);
      const artifact: ArtifactRecord = {
        id: randomUUID(),
        runId: run.id,
        ownerId: run.ownerId,
        relativePath,
        displayName: path.basename(target),
        mimeType: mimeTypeFor(target),
        sizeBytes: details.size,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        createdAt: new Date().toISOString(),
      };
      this.database.createArtifact(artifact);
      if (this.database.getArtifact(artifact.id)) discovered.push(artifact);
    }
  }
}
