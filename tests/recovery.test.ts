import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

function testConfig(projectRoot: string, databasePath: string): HubConfig {
  return {
    projectRoot, host: "127.0.0.1", port: 0, databasePath, skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", authRequired: true,
    admin: { username: "admin", password: "admin-strong-password", sessionTtlMs: 60000 },
    opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(temporaryDirectory, "config"), dataDirectory: path.join(temporaryDirectory, "data"), lockFilePath: path.join(temporaryDirectory, "lock"), logFilePath: path.join(temporaryDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
  };
}

async function login(app: Awaited<ReturnType<typeof buildServer>>): Promise<{ cookie: string; csrfToken: string }> {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "admin-strong-password" } });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers["set-cookie"];
  return { cookie: (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0], csrfToken: response.json().csrfToken as string };
}

describe("service recovery", () => {
  it("retains bootstrap accounts and run history across a Node Hub restart", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-recovery-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const databasePath = path.join(temporaryDirectory, "hub.db");
    const manifest: SkillManifest = {
      id: "opencode--recovery", provider: "opencode", name: "recovery", displayName: "Recovery", description: "Restart validation.", sourcePath: "private", sourceHash: "recovery-hash",
      inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "ready", enabled: true, lastScannedAt: new Date().toISOString(),
    };
    const database = new HubDatabase(databasePath);
    database.upsertSkill(manifest);
    database.close();

    const first = await buildServer(testConfig(projectRoot, databasePath));
    let runId = "";
    try {
      const session = await login(first);
      const created = await first.inject({ method: "POST", url: "/api/runs", headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken }, payload: { skillId: manifest.id, inputs: { taskText: "persist this history" } } });
      expect(created.statusCode).toBe(201);
      runId = created.json().id as string;
      expect(created.json()).toMatchObject({ status: "failed" });
    } finally {
      await first.close();
    }

    const second = await buildServer(testConfig(projectRoot, databasePath));
    try {
      const session = await login(second);
      const history = await second.inject({ method: "GET", url: "/api/runs", headers: { cookie: session.cookie } });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual([expect.objectContaining({ id: runId, skillId: manifest.id, status: "failed" })]);
      const run = await second.inject({ method: "GET", url: `/api/runs/${runId}`, headers: { cookie: session.cookie } });
      expect(run.statusCode).toBe(200);
    } finally {
      await second.close();
    }
  });
});
