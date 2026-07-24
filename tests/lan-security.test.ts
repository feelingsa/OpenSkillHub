import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

let testDirectory = "";
const runDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(runDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

async function login(app: Awaited<ReturnType<typeof buildServer>>, username: string, password: string): Promise<{ cookie: string; csrfToken: string }> {
  const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers["set-cookie"];
  return { cookie: (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0], csrfToken: response.json().csrfToken as string };
}

describe("LAN security controls", () => {
  it("enforces RBAC, CSRF, quotas, upload ownership, artifact ownership, and auditing", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-security-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const config: HubConfig = {
      projectRoot, host: "127.0.0.1", port: 0, databasePath: path.join(testDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal",
      authRequired: true, maxRunsPerUserPerDay: 1, maxConcurrentRunsPerUser: 2, requestsPerMinute: 100, loginAttemptsPerMinute: 20, uploadMaxBytes: 1024, highRiskSkillIds: ["opencode--secured-file"],
      admin: { username: "admin", password: "admin-strong-password", sessionTtlMs: 60000 },
      opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(testDirectory, "config"), dataDirectory: path.join(testDirectory, "data"), lockFilePath: path.join(testDirectory, "lock"), logFilePath: path.join(testDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
    };
    const manifest: SkillManifest = {
      id: "opencode--secured-file", provider: "opencode", name: "secured-file", displayName: "Secured file", description: "Security validation.", sourcePath: "private", sourceHash: "hash",
      inputs: [{ id: "attachment", label: "Attachment", kind: "file", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "ready", enabled: true, lastScannedAt: new Date().toISOString(),
    };
    const seed = new HubDatabase(config.databasePath);
    seed.upsertSkill(manifest);
    seed.close();
    const app = await buildServer(config);
    try {
      const admin = await login(app, "admin", "admin-strong-password");
      for (const [username, password] of [["alice", "alice-strong-password"], ["bob", "bob-password-longer"]]) {
        const created = await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken }, payload: { username, password, role: "user" } });
        expect(created.statusCode).toBe(201);
      }
      const alice = await login(app, "alice", "alice-strong-password");
      const bob = await login(app, "bob", "bob-password-longer");

      expect((await app.inject({ method: "GET", url: "/api/admin/overview", headers: { cookie: alice.cookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/uploads", headers: { cookie: alice.cookie, "content-type": "application/octet-stream", "x-upload-name": "private.txt" }, payload: Buffer.from("private") })).statusCode).toBe(403);

      const uploaded = await app.inject({ method: "POST", url: "/api/uploads", headers: { cookie: alice.cookie, "x-csrf-token": alice.csrfToken, "content-type": "application/octet-stream", "x-upload-name": "private.txt" }, payload: Buffer.from("private") });
      expect(uploaded.statusCode).toBe(201);
      const uploadId = uploaded.json().id as string;
      const crossUserRun = await app.inject({ method: "POST", url: "/api/runs", headers: { cookie: bob.cookie, "x-csrf-token": bob.csrfToken }, payload: { skillId: manifest.id, inputs: { attachment: uploadId } } });
      expect(crossUserRun.statusCode).toBe(409);
      const crossUserConfirmed = await app.inject({ method: "POST", url: "/api/runs", headers: { cookie: bob.cookie, "x-csrf-token": bob.csrfToken }, payload: { skillId: manifest.id, inputs: { attachment: uploadId }, confirmHighRisk: true } });
      expect(crossUserConfirmed.statusCode).toBe(400);

      const firstRun = await app.inject({ method: "POST", url: "/api/runs", headers: { cookie: alice.cookie, "x-csrf-token": alice.csrfToken }, payload: { skillId: manifest.id, inputs: { attachment: uploadId }, confirmHighRisk: true } });
      expect(firstRun.statusCode).toBe(201);
      const runId = firstRun.json().id as string;
      const quotaRejected = await app.inject({ method: "POST", url: "/api/runs", headers: { cookie: alice.cookie, "x-csrf-token": alice.csrfToken }, payload: { skillId: manifest.id, inputs: { attachment: uploadId }, confirmHighRisk: true } });
      expect(quotaRejected.statusCode).toBe(429);

      const database = new HubDatabase(config.databasePath);
      const run = database.getRun(runId)!;
      const artifactId = "alice-private-artifact";
      const runDirectory = path.join(projectRoot, "runtime", "runs", run.workspaceId);
      runDirectories.push(runDirectory);
      const artifactPath = path.join(runDirectory, "report.txt");
      const artifactBytes = Buffer.from("private artifact");
      await writeFile(artifactPath, artifactBytes);
      database.createArtifact({ id: artifactId, runId, ownerId: run.ownerId, relativePath: "report.txt", displayName: "report.txt", mimeType: "text/plain; charset=utf-8", sizeBytes: artifactBytes.length, sha256: createHash("sha256").update(artifactBytes).digest("hex"), createdAt: new Date().toISOString() });
      database.close();

      expect((await app.inject({ method: "GET", url: `/api/artifacts/${artifactId}/metadata`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/api/artifacts/${artifactId}/download`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/api/artifacts/${artifactId}/download`, headers: { cookie: alice.cookie } })).statusCode).toBe(200);

      const audit = await app.inject({ method: "GET", url: "/api/admin/audit", headers: { cookie: admin.cookie } });
      expect(audit.statusCode).toBe(200);
      expect(audit.json().map((event: { type: string }) => event.type)).toEqual(expect.arrayContaining(["upload.created", "run.started", "artifact.downloaded"]));
    } finally {
      await app.close();
    }
  });
});
