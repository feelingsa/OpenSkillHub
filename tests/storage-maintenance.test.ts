import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import { StorageMaintenanceService } from "../src/storage/maintenance.js";
import type { RunRecord } from "../src/types.js";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

function configFor(root: string): HubConfig {
  return {
    projectRoot: root, host: "127.0.0.1", port: 0, databasePath: path.join(root, "data", "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", artifactRetentionDays: 30,
    opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: root, configDirectory: path.join(root, "config"), dataDirectory: path.join(root, "data"), lockFilePath: path.join(root, "lock"), logFilePath: path.join(root, "log"), startTimeoutMs: 1000, skillRoots: [] },
  };
}

describe("storage maintenance", () => {
  it("only removes completed workspaces that are older than the confirmed retention cutoff", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-storage-"));
    const config = configFor(testDirectory);
    const database = new HubDatabase(config.databasePath);
    const oldRun: RunRecord = { id: "old-run", skillId: "skill", provider: "opencode", ownerId: "owner", status: "running", inputValues: {}, workspaceId: "old-workspace", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" };
    const freshRun: RunRecord = { ...oldRun, id: "fresh-run", workspaceId: "fresh-workspace" };
    database.createRun(oldRun);
    database.createRun(freshRun);
    database.updateRun(oldRun.id, { status: "completed", completedAt: "2020-01-02T00:00:00.000Z" });
    database.updateRun(freshRun.id, { status: "completed", completedAt: new Date().toISOString() });
    await mkdir(path.join(testDirectory, "runtime", "runs", oldRun.workspaceId), { recursive: true });
    await mkdir(path.join(testDirectory, "runtime", "runs", freshRun.workspaceId), { recursive: true });
    await writeFile(path.join(testDirectory, "runtime", "runs", oldRun.workspaceId, "result.txt"), "old result");
    await writeFile(path.join(testDirectory, "runtime", "runs", freshRun.workspaceId, "result.txt"), "fresh result");
    database.createArtifact({ id: "old-artifact", runId: oldRun.id, ownerId: "owner", relativePath: "result.txt", displayName: "result.txt", mimeType: "text/plain", sizeBytes: 10, sha256: "hash", createdAt: oldRun.createdAt });
    const maintenance = new StorageMaintenanceService(config, database, { getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }) } as never);

    expect(maintenance.previewCleanup(30)).toMatchObject({ runCount: 1, artifactCount: 1 });
    const deleted = await maintenance.cleanup(30);
    expect(deleted.deletedRuns).toBe(1);
    expect(database.getRun(oldRun.id)).toBeUndefined();
    expect(database.getRun(freshRun.id)).toBeDefined();
    await expect(writeFile(path.join(testDirectory, "runtime", "runs", freshRun.workspaceId, "still-here.txt"), "ok")).resolves.toBeUndefined();
    database.close();
  });

  it("creates a portable database backup and diagnostics without sensitive connection details", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-backup-"));
    const config = configFor(testDirectory);
    const database = new HubDatabase(config.databasePath);
    const maintenance = new StorageMaintenanceService(config, database, { getHealthSnapshot: () => ({ provider: "opencode", status: "offline", checkedAt: new Date().toISOString() }) } as never);
    const backup = await maintenance.createBackup();
    expect(backup.id).toMatch(/^backup-/);
    expect(await maintenance.openBackup(backup.id)).toBeDefined();
    expect(await maintenance.listBackups()).toEqual([expect.objectContaining({ id: backup.id })]);
    const diagnostics = JSON.stringify(maintenance.diagnostics());
    expect(diagnostics).toContain("schemaMigrations");
    expect(diagnostics).not.toContain("127.0.0.1:1");
    database.close();
  });
});
