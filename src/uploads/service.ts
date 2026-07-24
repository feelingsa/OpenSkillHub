import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HubConfig } from "../config.js";
import { HubDatabase } from "../storage/database.js";
import type { RunInputValues, SkillManifest, UploadRecord } from "../types.js";

const fileIdPattern = /^[a-zA-Z0-9_-]{1,160}$/;

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeDisplayName(value: string): string {
  const name = path.basename(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return (name || "upload").slice(0, 180);
}

export class UploadService {
  constructor(
    private readonly config: HubConfig,
    private readonly database: HubDatabase,
  ) {}

  async create(ownerId: string, body: Buffer, originalName: unknown, mimeType: unknown): Promise<UploadRecord> {
    const maximumBytes = this.config.uploadMaxBytes ?? 50 * 1024 * 1024;
    if (body.length === 0) throw new Error("The uploaded file is empty.");
    if (body.length > maximumBytes) throw new Error(`The uploaded file exceeds the ${maximumBytes} byte limit.`);
    const displayName = safeDisplayName(typeof originalName === "string" ? originalName : "upload");
    const id = randomUUID().replaceAll("-", "");
    const storageName = `${id}-${displayName}`;
    const target = this.filePath(ownerId, storageName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, { flag: "wx" });
    const upload: UploadRecord = {
      id,
      ownerId,
      storageName,
      displayName,
      mimeType: typeof mimeType === "string" && mimeType.length <= 255 ? mimeType : "application/octet-stream",
      sizeBytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      createdAt: new Date().toISOString(),
    };
    this.database.createUpload(upload);
    return upload;
  }

  async stageForRun(manifest: SkillManifest, inputs: RunInputValues, ownerId: string, workspaceDirectory: string): Promise<Map<string, string>> {
    const staged = new Map<string, string>();
    const destinationRoot = path.resolve(workspaceDirectory, "uploads");
    for (const input of manifest.inputs) {
      if (input.kind !== "file") continue;
      const uploadId = inputs[input.id];
      if (typeof uploadId !== "string" || !fileIdPattern.test(uploadId)) continue;
      const upload = this.database.getUpload(uploadId);
      if (!upload || upload.ownerId !== ownerId) throw new Error("The selected upload is unavailable.");
      const source = this.filePath(ownerId, upload.storageName);
      const details = await lstat(source).catch(() => undefined);
      if (!details?.isFile() || details.isSymbolicLink() || details.size !== upload.sizeBytes) throw new Error("The selected upload is unavailable.");
      const destination = path.resolve(destinationRoot, upload.storageName);
      if (!isWithin(destinationRoot, destination)) throw new Error("Invalid upload destination.");
      await mkdir(destinationRoot, { recursive: true });
      await copyFile(source, destination);
      staged.set(input.id, `uploads/${upload.storageName}`);
    }
    return staged;
  }

  private filePath(ownerId: string, storageName: string): string {
    const root = path.resolve(this.config.projectRoot, "runtime", "uploads");
    const ownerDirectory = path.resolve(root, ownerId);
    const filePath = path.resolve(ownerDirectory, storageName);
    if (!isWithin(root, ownerDirectory) || !isWithin(ownerDirectory, filePath)) throw new Error("Invalid upload storage path.");
    return filePath;
  }
}
