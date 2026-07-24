import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

async function login(app: Awaited<ReturnType<typeof buildServer>>, username: string, password: string): Promise<{ cookie: string; csrfToken: string }> {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers["set-cookie"];
  return { cookie: (Array.isArray(raw) ? raw[0] : raw)!.split(";")[0], csrfToken: response.json().csrfToken as string };
}

describe("LAN user isolation", () => {
  it("requires a session and prevents one ordinary user from reading another user's run", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-users-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const config: HubConfig = {
      projectRoot, host: "127.0.0.1", port: 0, databasePath: path.join(testDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", authRequired: true,
      admin: { username: "admin", password: "admin-strong-password", sessionTtlMs: 60000 },
      opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(testDirectory, "config"), dataDirectory: path.join(testDirectory, "data"), lockFilePath: path.join(testDirectory, "lock"), logFilePath: path.join(testDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
    };
    const manifest: SkillManifest = { id: "opencode--isolated", provider: "opencode", name: "isolated", displayName: "Isolated", description: "Isolation test.", sourcePath: "private", sourceHash: "hash", inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "ready", enabled: true, lastScannedAt: new Date().toISOString() };
    const seed = new HubDatabase(config.databasePath);
    seed.upsertSkill(manifest);
    seed.close();
    const app = await buildServer(config);
    try {
      const anonymous = await app.inject({ method: "GET", url: "/api/skills" });
      expect(anonymous.statusCode).toBe(401);
      const adminSession = await login(app, "admin", "admin-strong-password");
      for (const [username, password] of [["alice", "alice-strong-password"], ["bob", "bob-password-longer"]]) {
        const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: adminSession.cookie, "x-csrf-token": adminSession.csrfToken }, payload: { username, password, role: "user" } });
        expect(created.statusCode).toBe(201);
      }
      const aliceSession = await login(app, "alice", "alice-strong-password");
      const bobSession = await login(app, "bob", "bob-password-longer");
      const csrfRejected = await app.inject({ method: "POST", url: "/api/runs", headers: { cookie: aliceSession.cookie }, payload: { skillId: manifest.id, inputs: { taskText: "missing csrf" } } });
      expect(csrfRejected.statusCode).toBe(403);
      const createdRun = await app.inject({ method: "POST", url: "/api/runs", headers: { cookie: aliceSession.cookie, "x-csrf-token": aliceSession.csrfToken }, payload: { skillId: manifest.id, inputs: { taskText: "private task" } } });
      expect(createdRun.statusCode).toBe(201);
      const runId = createdRun.json().id as string;
      const bobRun = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: { cookie: bobSession.cookie } });
      expect(bobRun.statusCode).toBe(404);
      const bobHistory = await app.inject({ method: "GET", url: "/api/runs", headers: { cookie: bobSession.cookie } });
      expect(bobHistory.json()).toEqual([]);
      const adminRuns = await app.inject({ method: "GET", url: "/api/admin/runs", headers: { cookie: adminSession.cookie } });
      expect(adminRuns.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: runId })]));
    } finally {
      await app.close();
    }
  });
});
