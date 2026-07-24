import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactService, canPreviewArtifact } from "../src/artifacts/service.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { RunRecord } from "../src/types.js";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("ArtifactService", () => {
  it("collects only regular workspace files and refuses changed artifacts", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "skill-artifacts-"));
    const config: HubConfig = {
      projectRoot: directory, host: "127.0.0.1", port: 0, databasePath: path.join(directory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal",
      opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: directory, configDirectory: path.join(directory, "opencode-config"), dataDirectory: path.join(directory, "opencode-data"), lockFilePath: path.join(directory, "lock"), logFilePath: path.join(directory, "log"), startTimeoutMs: 1000, skillRoots: [] },
    };
    const database = new HubDatabase(config.databasePath);
    const run: RunRecord = {
      id: "run_artifacts", skillId: "opencode--example", provider: "opencode", ownerId: "local-default", status: "completed", inputValues: {}, workspaceId: "workspace_artifacts", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    };
    database.createRun(run);
    const root = path.join(directory, "runtime", "runs", run.workspaceId);
    await mkdir(path.join(root, "nested"), { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, "summary.txt"), "safe output");
    await writeFile(path.join(root, "nested", "report.json"), "{\"ok\":true}");
    await writeFile(path.join(root, ".git", "config"), "must not be an artifact");
    const service = new ArtifactService(config, database);
    try {
      const artifacts = await service.collect(run);
      expect(artifacts.map((artifact) => artifact.relativePath)).toEqual(["nested/report.json", "summary.txt"]);
      expect(artifacts.every(canPreviewArtifact)).toBe(true);
      expect(await service.open(artifacts[1].id)).toMatchObject({ artifact: { displayName: "summary.txt" } });

      await writeFile(path.join(root, "summary.txt"), "changed output is no longer the registered artifact");
      await expect(service.open(artifacts[1].id)).resolves.toBeUndefined();
      expect(await service.collect(run)).toEqual([]);
    } finally {
      database.close();
    }
  });
});
