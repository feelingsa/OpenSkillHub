import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

describe("legacy service retirement", () => {
  it("does not expose the legacy OpenCode proxy or arbitrary file endpoints", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-legacy-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const config: HubConfig = {
      projectRoot, host: "127.0.0.1", port: 0, databasePath: path.join(temporaryDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", authRequired: false,
      opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(temporaryDirectory, "config"), dataDirectory: path.join(temporaryDirectory, "data"), lockFilePath: path.join(temporaryDirectory, "lock"), logFilePath: path.join(temporaryDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
    };
    const app = await buildServer(config);
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ service: "skill-web-hub" });
      for (const request of [
        { method: "GET" as const, url: "/oc/session" },
        { method: "GET" as const, url: "/download?path=C:%5CWindows%5Cwin.ini" },
        { method: "GET" as const, url: "/artifacts?projectPath=C:%5C" },
        { method: "POST" as const, url: "/upload" },
      ]) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
