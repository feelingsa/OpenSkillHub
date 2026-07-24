import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { HubConfig } from "../config.js";
import type { OpenCodeApiSkill, OpenCodeProvider } from "../providers/opencode/provider.js";
import type { HubDatabase } from "../storage/database.js";
import type { SkillManifest } from "../types.js";
import { createManifest, makeSourceHash } from "./manifest.js";

const skillDocumentNames = ["SKILL.md", "skill.md", "README.md"];
const maxFilesPerSkill = 200;
const maxFileBytes = 2 * 1024 * 1024;

export interface ScanSummary {
  scannedAt: string;
  sources: { api: number; filesystem: number };
  total: number;
  addedOrUpdated: number;
  disabledOrRemoved: number;
  warnings: string[];
}

interface FileSkill {
  sourcePath: string;
  markdown: string;
  hashFiles: Array<{ path: string; content: Buffer }>;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (relative === "" || !relative.startsWith(`..${path.sep}`)) && relative !== ".." && !path.isAbsolute(relative);
}

async function findSkillDocuments(root: string): Promise<string[]> {
  const documents: string[] = [];
  const visited = new Set<string>();

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 5 || visited.size >= maxFilesPerSkill * 20) return;
    const resolved = path.resolve(directory);
    if (!isWithinRoot(root, resolved) || visited.has(resolved)) return;
    visited.add(resolved);
    let entries: Dirent[];
    try {
      entries = await readdir(resolved, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(resolved, entry.name);
      if (!isWithinRoot(root, fullPath)) continue;
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      if (entry.isFile() && skillDocumentNames.includes(entry.name)) documents.push(fullPath);
    }
  }

  await walk(root, 0);
  const priority = new Map(skillDocumentNames.map((name, index) => [name, index]));
  return [...new Map(documents
    .sort((left, right) => (priority.get(path.basename(left)) ?? 99) - (priority.get(path.basename(right)) ?? 99))
    .map((document) => [path.dirname(document), document]))
    .values()];
}

async function buildFileSkill(root: string, documentPath: string): Promise<FileSkill | undefined> {
  const skillDirectory = path.dirname(documentPath);
  if (!isWithinRoot(root, documentPath)) return undefined;
  const markdown = await readFile(documentPath, "utf8");
  const hashFiles: Array<{ path: string; content: Buffer }> = [];
  const queue = [skillDirectory];
  while (queue.length > 0 && hashFiles.length < maxFilesPerSkill) {
    const directory = queue.shift();
    if (!directory) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (hashFiles.length >= maxFilesPerSkill) break;
      const fullPath = path.join(directory, entry.name);
      if (!isWithinRoot(root, fullPath)) continue;
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") queue.push(fullPath);
      if (!entry.isFile()) continue;
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > maxFileBytes) continue;
        hashFiles.push({ path: fullPath, content: await readFile(fullPath) });
      } catch {
        // Files that disappear while scanning are intentionally skipped.
      }
    }
  }
  return { sourcePath: documentPath, markdown, hashFiles };
}

function apiManifest(skill: OpenCodeApiSkill, scannedAt: string): SkillManifest {
  const name = skill.name || skill.id || "Unnamed OpenCode Skill";
  const sourcePath = typeof skill.path === "string" ? skill.path : `opencode-api:${name}`;
  const markdown = typeof skill.description === "string" ? `# ${name}\n\n${skill.description}` : `# ${name}`;
  return createManifest({
    name,
    description: typeof skill.description === "string" ? skill.description : undefined,
    sourcePath,
    sourceHash: createHash("sha256").update(JSON.stringify(skill)).digest("hex"),
    markdown,
    lastScannedAt: scannedAt,
  });
}

export class SkillScanner {
  constructor(
    private readonly config: HubConfig,
    private readonly provider: OpenCodeProvider,
    private readonly database: HubDatabase,
  ) {}

  async sync(): Promise<ScanSummary> {
    const scannedAt = new Date().toISOString();
    const warnings: string[] = [];
    let canMarkMissing = this.config.opencode.skillRoots.length > 0 || this.provider.getHealthSnapshot().status === "healthy";
    const manifests = new Map<string, SkillManifest>();
    const apiSkills = await this.provider.listSkills();
    for (const skill of apiSkills) {
      const manifest = apiManifest(skill, scannedAt);
      manifests.set(manifest.id, manifest);
    }

    let filesystemCount = 0;
    for (const root of this.config.opencode.skillRoots) {
      let rootStat: Awaited<ReturnType<typeof stat>>;
      try {
        rootStat = await stat(root);
      } catch {
        warnings.push(`Configured Skill root is unavailable: ${path.basename(root) || "configured root"}`);
        canMarkMissing = false;
        continue;
      }
      if (!rootStat.isDirectory()) {
        warnings.push(`Configured Skill root is not a directory: ${path.basename(root) || "configured root"}`);
        continue;
      }
      const documents = await findSkillDocuments(root);
      for (const documentPath of documents) {
        try {
          const fileSkill = await buildFileSkill(root, documentPath);
          if (!fileSkill) continue;
          const manifest = createManifest({
            name: path.basename(path.dirname(documentPath)),
            sourcePath: fileSkill.sourcePath,
            sourceHash: makeSourceHash(fileSkill.hashFiles),
            markdown: fileSkill.markdown,
            lastScannedAt: scannedAt,
          });
          manifest.assets = fileSkill.hashFiles
            .filter((file) => !skillDocumentNames.includes(path.basename(file.path)))
            .map((file, index) => {
              const extension = path.extname(file.path).toLowerCase();
              return {
                id: `asset-${index + 1}`,
                name: path.basename(file.path),
                kind: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension) ? "image" as const : [".md", ".txt", ".pdf"].includes(extension) ? "document" as const : "other" as const,
              };
            });
          manifests.set(manifest.id, manifest);
          filesystemCount += 1;
        } catch (error) {
          warnings.push(`Could not scan ${path.basename(path.dirname(documentPath))}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }

    const existing = new Map(this.database.listSkills().map((manifest) => [manifest.id, manifest]));
    let addedOrUpdated = 0;
    for (const manifest of manifests.values()) {
      const previous = existing.get(manifest.id);
      if (!previous || previous.sourceHash !== manifest.sourceHash) addedOrUpdated += 1;
      if (previous && previous.sourceHash === manifest.sourceHash) {
        manifest.pageStatus = previous.pageStatus;
        manifest.enabled = previous.enabled;
      }
      this.database.upsertSkill(manifest);
    }
    const removed = [...existing.keys()].filter((id) => !manifests.has(id)).length;
    if (canMarkMissing) this.database.markMissing("opencode", [...manifests.keys()]);

    return {
      scannedAt,
      sources: { api: apiSkills.length, filesystem: filesystemCount },
      total: manifests.size,
      addedOrUpdated,
      disabledOrRemoved: canMarkMissing ? removed : 0,
      warnings,
    };
  }
}
