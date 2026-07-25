import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactService } from "../src/artifacts/service.js";
import type { HubConfig } from "../src/config.js";
import { PageGenerator } from "../src/page-generator/service.js";
import type { OpenCodeProvider } from "../src/providers/opencode/provider.js";
import { registerApiRoutes } from "../src/routes/api.js";
import { RunService, type RunProvider } from "../src/runs/service.js";
import type { SkillScanner } from "../src/skills/scanner.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  return await Promise.race([
    reader.read().then(({ value, done }) => {
      if (done || !value) throw new Error("SSE stream closed before an event arrived.");
      return new TextDecoder().decode(value);
    }),
    new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("Timed out waiting for an SSE event.")), 3000)),
  ]);
}

describe("SSE run event recovery", () => {
  it("replays events after Last-Event-ID and delivers new provider events", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-sse-"));
    const config: HubConfig = {
      projectRoot: temporaryDirectory, host: "127.0.0.1", port: 0, databasePath: path.join(temporaryDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", authRequired: false,
      opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: temporaryDirectory, configDirectory: path.join(temporaryDirectory, "config"), dataDirectory: path.join(temporaryDirectory, "data"), lockFilePath: path.join(temporaryDirectory, "lock"), logFilePath: path.join(temporaryDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
    };
    const manifest: SkillManifest = {
      id: "opencode--sse", provider: "opencode", name: "sse", displayName: "SSE", description: "SSE replay validation.", sourcePath: "private", sourceHash: "sse-hash",
      inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "ready", enabled: true, lastScannedAt: new Date().toISOString(),
    };
    const database = new HubDatabase(config.databasePath);
    database.upsertSkill(manifest);
    let emit: ((event: { type?: string; properties?: Record<string, unknown> }) => void) | undefined;
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async ({ onEvent }) => {
        emit = onEvent;
        return { sessionId: "ses_sse", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
      replyToQuestion: async () => undefined,
      replyToPermission: async () => undefined,
    };
    const app = Fastify({ logger: false });
    const artifacts = new ArtifactService(config, database);
    const runs = new RunService(config, database, provider, artifacts);
    await registerApiRoutes(app, {
      config, database, runs, artifacts, pages: new PageGenerator(config, database, provider), scanner: {} as SkillScanner,
      provider: { getHealthSnapshot: provider.getHealthSnapshot, getRuntimeInfo: () => ({ capabilities: [] }), checkHealth: async () => provider.getHealthSnapshot() } as unknown as OpenCodeProvider,
    });
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const created = await fetch(`${baseUrl}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ skillId: manifest.id, inputs: { taskText: "stream" } }) });
      expect(created.status).toBe(201);
      const runId = (await created.json() as { id: string }).id;

      const firstController = new AbortController();
      const firstStream = await fetch(`${baseUrl}/api/runs/${runId}/events`, { signal: firstController.signal });
      expect(firstStream.status).toBe(200);
      const firstReader = firstStream.body!.getReader();
      expect(await readChunk(firstReader)).toContain("event: run.created");
      emit?.({ type: "session.next.text.delta", properties: { delta: "reconnect me" } });
      expect(await readChunk(firstReader)).toContain("event: message.delta");
      firstController.abort();
      await firstReader.cancel().catch(() => undefined);

      const reconnectController = new AbortController();
      const replay = await fetch(`${baseUrl}/api/runs/${runId}/events`, { headers: { "Last-Event-ID": "1" }, signal: reconnectController.signal });
      const replayReader = replay.body!.getReader();
      const replayChunk = await readChunk(replayReader);
      expect(replayChunk).toContain("event: run.started");
      expect(replayChunk).toContain("event: message.delta");
      reconnectController.abort();
      await replayReader.cancel().catch(() => undefined);
      await runs.abort(runId);
    } finally {
      await app.close();
      database.close();
    }
  });
});
