import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactService } from "../src/artifacts/service.js";
import type { HubConfig } from "../src/config.js";
import { RunService, type RunProvider, validateRunInputs } from "../src/runs/service.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

function manifest(): SkillManifest {
  return {
    id: "opencode--example", provider: "opencode", name: "example", displayName: "Example", description: "Example skill.", sourcePath: "private", sourceHash: "hash",
    inputs: [
      { id: "title", label: "Title", kind: "text", required: true, confidence: "high" },
      { id: "mode", label: "Mode", kind: "select", required: false, options: [{ label: "draft", value: "draft" }], confidence: "high" },
    ],
    outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "missing", enabled: true, lastScannedAt: "2026-07-24T00:00:00.000Z",
  };
}

async function createTestContext(): Promise<{ config: HubConfig; database: HubDatabase }> {
  directory = await mkdtemp(path.join(tmpdir(), "skill-run-"));
  const config: HubConfig = {
    projectRoot: directory, host: "127.0.0.1", port: 0, databasePath: path.join(directory, "hub.db"), skillSyncIntervalMs: 60000, logLevel: "fatal",
    runTimeoutMs: 60000,
    opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: directory, configDirectory: path.join(directory, "opencode-config"), dataDirectory: path.join(directory, "opencode-data"), lockFilePath: path.join(directory, "lock"), logFilePath: path.join(directory, "log"), startTimeoutMs: 1000, skillRoots: [] },
  };
  return { config, database: new HubDatabase(config.databasePath) };
}

describe("RunService", () => {
  it("validates declared values and persists a replayable offline failure", async () => {
    const { config, database } = await createTestContext();
    try {
      expect(validateRunInputs(manifest(), { title: "Report", mode: "draft" })).toEqual({ title: "Report", mode: "draft" });
      expect(() => validateRunInputs(manifest(), { title: "Report", mode: "other" })).toThrow("not an allowed option");
      const service = new RunService(config, database, {
        getHealthSnapshot: () => ({ provider: "opencode", status: "offline", checkedAt: new Date().toISOString() }),
        startRun: async () => { throw new Error("offline"); },
        replyToQuestion: async () => undefined,
        replyToPermission: async () => undefined,
      });
      const run = await service.start(manifest(), { title: "Report" });
      expect(run).toMatchObject({ status: "failed", inputValues: { title: "Report" } });
      expect(service.listEvents(run.id)).toEqual([
        expect.objectContaining({ sequence: 1, type: "run.created" }),
        expect.objectContaining({ sequence: 2, type: "run.failed", message: expect.stringContaining("offline") }),
      ]);
      expect(service.listEvents(run.id, 1)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("maps OpenCode stream events and confines question and permission replies to their run", async () => {
    const { config, database } = await createTestContext();
    let emit: ((event: { type?: string; properties?: Record<string, unknown> }) => void) | undefined;
    let settle!: () => void;
    const done = new Promise<void>((resolve) => { settle = resolve; });
    const replyToQuestion = vi.fn(async () => undefined);
    const replyToPermission = vi.fn(async () => undefined);
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async ({ onEvent }) => {
        emit = onEvent;
        return { sessionId: "ses_run", done, abort: async () => undefined, close: settle };
      },
      replyToQuestion,
      replyToPermission,
    };
    const service = new RunService(config, database, provider);
    try {
      const run = await service.start(manifest(), { title: "Report" });
      expect(run.status).toBe("running");

      emit?.({ type: "session.next.text.delta", properties: { delta: "Working" } });
      emit?.({ type: "session.next.tool.called", properties: { tool: "read" } });
      emit?.({ type: "session.next.tool.success", properties: { callID: "tool_call_1" } });
      emit?.({ type: "question.asked", properties: { id: "question_1", questions: [{ header: "Format" }] } });
      expect(service.get(run.id)?.status).toBe("waiting_question");
      await expect(service.answerQuestion("other-run", "question_1", [["PDF"]])).resolves.toBeUndefined();
      await service.answerQuestion(run.id, "question_1", [["PDF"]]);
      expect(replyToQuestion).toHaveBeenCalledWith("question_1", [["PDF"]]);
      expect(service.get(run.id)?.status).toBe("running");

      emit?.({ type: "permission.asked", properties: { id: "permission_1", permission: "filesystem" } });
      expect(service.get(run.id)?.status).toBe("waiting_permission");
      await service.answerPermission(run.id, "permission_1", "once");
      expect(replyToPermission).toHaveBeenCalledWith("permission_1", "once");
      expect(service.get(run.id)?.status).toBe("running");

      emit?.({ type: "session.idle" });
      expect(service.get(run.id)?.status).toBe("completed");
      expect(service.listEvents(run.id).map((event) => event.type)).toEqual([
        "run.created", "run.started", "message.delta", "tool.started", "tool.finished", "question.pending", "permission.pending", "run.completed",
      ]);
    } finally {
      database.close();
    }
  });

  it("returns the timeout summary after aborting an active run", async () => {
    const { config, database } = await createTestContext();
    let settle!: () => void;
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async () => ({
        sessionId: "ses_abort",
        done: new Promise<void>((resolve) => { settle = resolve; }),
        abort: async () => undefined,
        close: settle,
      }),
      replyToQuestion: async () => undefined,
      replyToPermission: async () => undefined,
    };
    const service = new RunService(config, database, provider);
    try {
      const run = await service.start(manifest(), { title: "Report" });
      const aborted = await service.abort(run.id, "Run timed out before OpenCode became idle.");
      expect(aborted).toMatchObject({ status: "aborted", summary: "Run timed out before OpenCode became idle." });
    } finally {
      database.close();
    }
  });

  it("buffers upstream events that arrive before OpenCode returns its run handle", async () => {
    const { config, database } = await createTestContext();
    let settle!: () => void;
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async ({ onEvent }) => {
        onEvent({ type: "session.idle" });
        return {
          sessionId: "ses_early_idle",
          done: new Promise<void>((resolve) => { settle = resolve; }),
          abort: async () => undefined,
          close: settle,
        };
      },
      replyToQuestion: async () => undefined,
      replyToPermission: async () => undefined,
    };
    const service = new RunService(config, database, provider);
    try {
      const run = await service.start(manifest(), { title: "Report" });
      expect(service.get(run.id)?.status).toBe("completed");
      expect(service.listEvents(run.id).map((event) => event.type)).toEqual(["run.created", "run.started", "run.completed"]);
    } finally {
      database.close();
    }
  });

  it("collects partial artifacts before publishing a failed run", async () => {
    const { config, database } = await createTestContext();
    let emit: ((event: { type?: string; properties?: Record<string, unknown> }) => void) | undefined;
    let settle!: () => void;
    const provider: RunProvider = {
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
      startRun: async ({ directory, onEvent }) => {
        await writeFile(path.join(directory, "partial.txt"), "partial output");
        emit = onEvent;
        return {
          sessionId: "ses_failed",
          done: new Promise<void>((resolve) => { settle = resolve; }),
          abort: async () => undefined,
          close: settle,
        };
      },
      replyToQuestion: async () => undefined,
      replyToPermission: async () => undefined,
    };
    const service = new RunService(config, database, provider, new ArtifactService(config, database));
    try {
      const run = await service.start(manifest(), { title: "Report" });
      const failed = new Promise<void>((resolve) => {
        service.onEvent(run.id, (event) => { if (event.type === "run.failed") resolve(); });
      });
      emit?.({ type: "session.error", properties: { error: "OpenCode failed after writing output." } });
      await failed;
      expect(service.get(run.id)).toMatchObject({ status: "failed" });
      expect(service.listEvents(run.id).map((event) => event.type)).toEqual(["run.created", "run.started", "artifact.created", "run.failed"]);
      expect(service.listEvents(run.id).find((event) => event.type === "artifact.created")?.artifactId).toBeDefined();
      expect(new ArtifactService(config, database).list(run.id)).toEqual([expect.objectContaining({ displayName: "partial.txt" })]);
    } finally {
      database.close();
    }
  });
});
