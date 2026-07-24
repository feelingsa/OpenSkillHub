import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

describe("HTTP health and configuration status", () => {
  it("exposes health without leaking an OpenCode URL or local Skill roots", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const config: HubConfig = {
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000,
      logLevel: "fatal",
      opencode: {
        mode: "connect",
        url: new URL("http://127.0.0.1:1"),
        command: "opencode",
        args: [],
        workingDirectory: projectRoot,
        lockFilePath: path.join(testDirectory, "opencode.lock"),
        logFilePath: path.join(testDirectory, "opencode.log"),
        startTimeoutMs: 1000,
        skillRoots: [],
      },
    };
    const app = await buildServer(config);
    try {
      const healthResponse = await app.inject({ method: "GET", url: "/api/health" });
      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json()).toMatchObject({ status: "healthy", service: "skill-web-hub" });

      const configResponse = await app.inject({ method: "GET", url: "/api/config/status" });
      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.body).not.toContain("127.0.0.1:1");
      expect(configResponse.body).not.toContain("skillRoots");
    } finally {
      await app.close();
    }
  });
});
