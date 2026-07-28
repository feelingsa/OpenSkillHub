import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";
import { registerApiRoutes } from "../src/routes/api.js";
import { RunService, type RunProvider } from "../src/runs/service.js";
import type { OpenCodeProvider } from "../src/providers/opencode/provider.js";
import type { SkillScanner } from "../src/skills/scanner.js";
import { ArtifactService } from "../src/artifacts/service.js";
import { PageGenerator } from "../src/page-generator/service.js";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

describe("HTTP health and configuration status", () => {
  it("queues, persists, and exposes an activated generated Skill page", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-pages-"));
    const config: HubConfig = {
      projectRoot: testDirectory, host: "127.0.0.1", port: 0, databasePath: path.join(testDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal",
      opencode: {
        mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: testDirectory, configDirectory: path.join(testDirectory, "opencode-config"), dataDirectory: path.join(testDirectory, "opencode-data"),
        lockFilePath: path.join(testDirectory, "opencode.lock"), logFilePath: path.join(testDirectory, "opencode.log"), startTimeoutMs: 1000, skillRoots: [],
      },
    };
    const promptDirectory = path.join(testDirectory, "prompts");
    await mkdir(promptDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(promptDirectory, "skill-page-base.md"), "{{manifest_json}}\n{{preset_instructions}}\n{{runtime_contract}}\n{{source_hash}}"),
      writeFile(path.join(promptDirectory, "form-first.md"), "form-first"),
      writeFile(path.join(promptDirectory, "workflow-console.md"), "workflow-console"),
      writeFile(path.join(promptDirectory, "artifact-workbench.md"), "artifact-workbench"),
    ]);
    const manifest: SkillManifest = {
      id: "opencode--page", provider: "opencode", name: "page", displayName: "Page", description: "Page skill.", sourcePath: "private", sourceHash: "page-hash",
      inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "missing", enabled: true, lastScannedAt: new Date().toISOString(),
    };
    const database = new HubDatabase(config.databasePath);
    database.upsertSkill(manifest);
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async ({ directory, onEvent }) => {
        const output = path.join(directory, "output");
        await mkdir(output, { recursive: true });
        await Promise.all([
          writeFile(path.join(output, "index.html"), '<link rel="stylesheet" href="./styles.css"><form data-skill-form><input name="taskText"><button type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script>'),
          writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
          writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "page-hash", inputIds: ["taskText"], runtime: "shared" })),
        ]);
        onEvent({ type: "session.idle" });
        return { sessionId: "ses_page_api", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
      replyToQuestion: async () => undefined,
      replyToPermission: async () => undefined,
    };
    const artifacts = new ArtifactService(config, database);
    const pages = new PageGenerator(config, database, provider);
    const app = Fastify({ logger: false });
    await registerApiRoutes(app, {
      config, database, runs: new RunService(config, database, provider, artifacts), artifacts, pages,
      provider: { getHealthSnapshot: provider.getHealthSnapshot, getRuntimeInfo: () => ({ capabilities: [] }), checkHealth: async () => provider.getHealthSnapshot() } as unknown as OpenCodeProvider,
      scanner: {} as SkillScanner,
    });
    try {
      const queued = await app.inject({ method: "POST", url: `/api/skills/${manifest.id}/page/generate`, payload: { preset: "form-first" } });
      expect(queued.statusCode).toBe(202);
      await pages.waitForIdle();
      const active = await app.inject({ method: "GET", url: `/api/skills/${manifest.id}/page` });
      expect(active.statusCode).toBe(200);
      expect(active.json()).toMatchObject({ status: "ready", active: true, url: expect.stringMatching(/^\/generated\/opencode--page\//) });
      const status = await app.inject({ method: "GET", url: `/api/skills/${manifest.id}/page/status` });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toHaveLength(1);
      const firstVersion = status.json()[0].version as string;

      const invalidForce = await app.inject({ method: "POST", url: `/api/skills/${manifest.id}/page/generate`, payload: { force: "yes" } });
      expect(invalidForce.statusCode).toBe(400);
      const regenerated = await app.inject({ method: "POST", url: `/api/skills/${manifest.id}/page/generate`, payload: { preset: "form-first", force: true } });
      expect(regenerated.statusCode).toBe(202);
      await pages.waitForIdle();
      const versions = await app.inject({ method: "GET", url: `/api/skills/${manifest.id}/page/status` });
      expect(versions.json()).toHaveLength(2);
      const newestVersion = versions.json().find((page: { active: boolean }) => page.active).version as string;
      expect(newestVersion).not.toBe(firstVersion);

      const rolledBack = await app.inject({ method: "POST", url: `/api/skills/${manifest.id}/page/activate/${encodeURIComponent(firstVersion)}` });
      expect(rolledBack.statusCode).toBe(200);
      expect(rolledBack.json()).toMatchObject({ version: firstVersion, active: true, status: "ready" });
      const logs = await app.inject({ method: "GET", url: `/api/skills/${manifest.id}/page/${encodeURIComponent(firstVersion)}/logs` });
      expect(logs.statusCode).toBe(200);
      expect(logs.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "queued" }),
        expect.objectContaining({ type: "ready" }),
        expect.objectContaining({ type: "activated" }),
      ]));
    } finally {
      await app.close();
      database.close();
    }
  });

  it("exposes health without leaking an OpenCode URL or local Skill roots", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const config: HubConfig = {
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000,
      runTimeoutMs: 60000,
      logLevel: "fatal",
      opencode: {
        mode: "connect",
        url: new URL("http://127.0.0.1:1"),
        command: "opencode",
        args: [],
        workingDirectory: projectRoot,
        configDirectory: path.join(testDirectory, "opencode-config"),
        dataDirectory: path.join(testDirectory, "opencode-data"),
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
      expect(healthResponse.json()).toMatchObject({ status: "healthy", service: "open-skill-hub" });

      const configResponse = await app.inject({ method: "GET", url: "/api/config/status" });
      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.body).not.toContain("127.0.0.1:1");
      expect(configResponse.body).not.toContain("skillRoots");
    } finally {
      await app.close();
    }
  });

  it("creates a validated persisted run and does not claim success while OpenCode is offline", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-"));
    const projectRoot = path.resolve(import.meta.dirname, "..");
    const config: HubConfig = {
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000,
      runTimeoutMs: 60000,
      logLevel: "fatal",
      opencode: {
        mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(testDirectory, "opencode-config"), dataDirectory: path.join(testDirectory, "opencode-data"),
        lockFilePath: path.join(testDirectory, "opencode.lock"), logFilePath: path.join(testDirectory, "opencode.log"), startTimeoutMs: 1000, skillRoots: [],
      },
    };
    const manifest: SkillManifest = {
      id: "opencode--example", provider: "opencode", name: "example", displayName: "Example", description: "Example.", sourcePath: "private", sourceHash: "hash",
      inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "missing", enabled: true, lastScannedAt: new Date().toISOString(),
    };
    const database = new HubDatabase(config.databasePath);
    database.upsertSkill(manifest);
    database.close();
    const app = await buildServer(config);
    try {
      const invalid = await app.inject({ method: "POST", url: "/api/runs", payload: { skillId: manifest.id, inputs: {} } });
      expect(invalid.statusCode).toBe(400);

      const created = await app.inject({ method: "POST", url: "/api/runs", payload: { skillId: manifest.id, inputs: { taskText: "Run test" } } });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("offline") });

      const persisted = await app.inject({ method: "GET", url: `/api/runs/${created.json().id}` });
      expect(persisted.statusCode).toBe(200);
      expect(persisted.json()).toMatchObject({ status: "failed", inputValues: { taskText: "Run test" } });
    } finally {
      await app.close();
    }
  });

  it("returns specific status codes for pending question and permission replies", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-"));
    const projectRoot = testDirectory;
    const config: HubConfig = {
      projectRoot, host: "127.0.0.1", port: 0, databasePath: path.join(testDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal",
      opencode: {
        mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(testDirectory, "opencode-config"), dataDirectory: path.join(testDirectory, "opencode-data"),
        lockFilePath: path.join(testDirectory, "opencode.lock"), logFilePath: path.join(testDirectory, "opencode.log"), startTimeoutMs: 1000, skillRoots: [],
      },
    };
    const manifest: SkillManifest = {
      id: "opencode--interactive", provider: "opencode", name: "interactive", displayName: "Interactive", description: "Interactive skill.", sourcePath: "private", sourceHash: "hash",
      inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "missing", enabled: true, lastScannedAt: new Date().toISOString(),
    };
    const database = new HubDatabase(config.databasePath);
    database.upsertSkill(manifest);
    let emit: ((event: { type?: string; properties?: Record<string, unknown> }) => void) | undefined;
    const replies = { question: 0, permission: 0 };
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async ({ onEvent }) => {
        emit = onEvent;
        return { sessionId: "ses_api", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
      replyToQuestion: async () => { replies.question += 1; },
      replyToPermission: async () => { replies.permission += 1; },
    };
    const artifacts = new ArtifactService(config, database);
    const runs = new RunService(config, database, provider, artifacts);
    const app = Fastify({ logger: false });
    await registerApiRoutes(app, {
      config,
      database,
      runs,
      artifacts,
      provider: {
        getHealthSnapshot: provider.getHealthSnapshot,
        getRuntimeInfo: () => ({ capabilities: [] }),
        checkHealth: async () => provider.getHealthSnapshot(),
      } as unknown as OpenCodeProvider,
      scanner: {} as SkillScanner,
      pages: new PageGenerator(config, database, provider),
    });
    try {
      const created = await app.inject({ method: "POST", url: "/api/runs", payload: { skillId: manifest.id, inputs: { taskText: "Run test" } } });
      expect(created.statusCode).toBe(201);
      const createdRun = created.json() as { id: string; workspaceId?: string };
      const runId = createdRun.id;
      expect(createdRun.workspaceId).toBeUndefined();
      const history = await app.inject({ method: "GET", url: "/api/runs" });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual([expect.objectContaining({ id: runId, skillId: manifest.id })]);

      const unknownRun = await app.inject({ method: "POST", url: "/api/runs/absent/questions/question_1/reply", payload: { answers: [["yes"]] } });
      expect(unknownRun.statusCode).toBe(404);
      const staleQuestion = await app.inject({ method: "POST", url: `/api/runs/${runId}/questions/question_1/reply`, payload: { answers: [["yes"]] } });
      expect(staleQuestion.statusCode).toBe(409);

      emit?.({ type: "question.asked", properties: { id: "question_1", questions: [{ header: "Confirm" }] } });
      const malformedQuestion = await app.inject({ method: "POST", url: `/api/runs/${runId}/questions/question_1/reply`, payload: { answers: "yes" } });
      expect(malformedQuestion.statusCode).toBe(400);
      const answeredQuestion = await app.inject({ method: "POST", url: `/api/runs/${runId}/questions/question_1/reply`, payload: { answers: [["yes"]] } });
      expect(answeredQuestion.statusCode).toBe(200);
      expect(replies.question).toBe(1);

      emit?.({ type: "permission.asked", properties: { id: "permission_1", permission: "filesystem" } });
      const persistentPermission = await app.inject({ method: "POST", url: `/api/runs/${runId}/permissions/permission_1/reply`, payload: { reply: "always" } });
      expect(persistentPermission.statusCode).toBe(403);
      const malformedPermission = await app.inject({ method: "POST", url: `/api/runs/${runId}/permissions/permission_1/reply`, payload: { reply: "invalid" } });
      expect(malformedPermission.statusCode).toBe(400);
      const answeredPermission = await app.inject({ method: "POST", url: `/api/runs/${runId}/permissions/permission_1/reply`, payload: { reply: "once" } });
      expect(answeredPermission.statusCode).toBe(200);
      expect(replies.permission).toBe(1);
      await writeFile(path.join(projectRoot, "runtime", "runs", runId, "result.txt"), "completed result");
      emit?.({ type: "session.idle" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const artifactList = await app.inject({ method: "GET", url: `/api/runs/${runId}/artifacts` });
      expect(artifactList.statusCode).toBe(200);
      expect(artifactList.json()).toEqual([expect.objectContaining({ displayName: "result.txt", mimeType: "text/plain; charset=utf-8" })]);
      expect(artifactList.json()[0]).not.toHaveProperty("ownerId");
      expect(artifactList.json()[0]).not.toHaveProperty("relativePath");
      const eventHistory = await app.inject({ method: "GET", url: `/api/runs/${runId}/events/history` });
      expect(eventHistory.statusCode).toBe(200);
      expect(eventHistory.json()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "run.created" })]));
      const artifactId = artifactList.json()[0].id as string;
      const preview = await app.inject({ method: "GET", url: `/api/artifacts/${artifactId}/preview` });
      expect(preview.statusCode).toBe(200);
      expect(preview.headers["content-security-policy"]).toContain("sandbox");
      const download = await app.inject({ method: "GET", url: `/api/artifacts/${artifactId}/download` });
      expect(download.statusCode).toBe(200);
      expect(download.headers["content-disposition"]).toContain("attachment");
    } finally {
      await app.close();
      database.close();
    }
  });
});
