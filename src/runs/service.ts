import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ArtifactService } from "../artifacts/service.js";
import type { UploadService } from "../uploads/service.js";
import type { HubConfig } from "../config.js";
import type { OpenCodeProvider, OpenCodeRunHandle, OpenCodeServerEvent } from "../providers/opencode/provider.js";
import { HubDatabase } from "../storage/database.js";
import type { RunEvent, RunInputValues, RunRecord, RunStatus, SkillInput, SkillManifest, StoredRunEvent } from "../types.js";

const terminalStatuses = new Set<RunStatus>(["completed", "failed", "aborted"]);
const localOwnerId = "local-default";

export interface RunProvider {
  getHealthSnapshot(): ReturnType<OpenCodeProvider["getHealthSnapshot"]>;
  startRun(options: { title: string; prompt: string; directory: string; onEvent: (event: OpenCodeServerEvent) => void }): Promise<OpenCodeRunHandle>;
  continueRun?(options: { sessionId: string; prompt: string; directory: string; onEvent: (event: OpenCodeServerEvent) => void }): Promise<OpenCodeRunHandle>;
  deleteSession?(sessionId: string): Promise<void>;
  replyToQuestion(requestId: string, answers: string[][]): Promise<void>;
  replyToPermission(requestId: string, reply: "once" | "always" | "reject"): Promise<void>;
}

export class RunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunValidationError";
  }
}

export class RunQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunQuotaError";
  }
}

function validateValue(input: SkillInput, raw: unknown): string | number | boolean | undefined {
  const value = raw ?? input.defaultValue;
  if (value === undefined || value === null || value === "") {
    if (input.required) throw new RunValidationError(`${input.label} is required`);
    return undefined;
  }
  if (input.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new RunValidationError(`${input.label} must be a finite number`);
    return value;
  }
  if (input.kind === "boolean") {
    if (typeof value !== "boolean") throw new RunValidationError(`${input.label} must be true or false`);
    return value;
  }
  if (typeof value !== "string") throw new RunValidationError(`${input.label} must be text`);
  const normalized = value.trim();
  if (normalized.length > 12000) throw new RunValidationError(`${input.label} exceeds the maximum length`);
  if (input.kind === "url") {
    try {
      const url = new URL(normalized);
      if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported protocol");
    } catch {
      throw new RunValidationError(`${input.label} must be an http(s) URL`);
    }
  }
  if (input.kind === "select" && !input.options?.some((option) => option.value === normalized)) {
    throw new RunValidationError(`${input.label} is not an allowed option`);
  }
  if (input.kind === "file" && !/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new RunValidationError(`${input.label} must reference an uploaded file ID`);
  }
  return normalized;
}

export function validateRunInputs(manifest: SkillManifest, body: unknown): RunInputValues {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RunValidationError("inputs must be an object");
  const values = body as Record<string, unknown>;
  const declaredIds = new Set(manifest.inputs.map((input) => input.id));
  for (const key of Object.keys(values)) {
    if (!declaredIds.has(key)) throw new RunValidationError(`Unknown input: ${key}`);
  }
  const validated: RunInputValues = {};
  for (const input of manifest.inputs) {
    const value = validateValue(input, values[input.id]);
    if (value !== undefined) validated[input.id] = value;
  }
  return validated;
}

export function buildRunPrompt(manifest: SkillManifest, inputs: RunInputValues, stagedFiles = new Map<string, string>()): string {
  const inputLines = manifest.inputs
    .filter((input) => inputs[input.id] !== undefined)
    .map((input) => input.kind === "file"
      ? `- ${input.label}: user-uploaded file staged at ${stagedFiles.get(input.id) ?? "an unavailable upload"}`
      : `- ${input.label}: ${String(inputs[input.id])}`);
  const workflow = manifest.workflow.map((step) => `- ${step.label}${step.description ? `: ${step.description}` : ""}`);
  return [
    `Execute the OpenCode skill \"${manifest.name}\" for the user.`,
    manifest.description,
    "Use only the supplied values. Do not request or expose host configuration, credentials, or arbitrary local paths.",
    "Declared input values:",
    ...(inputLines.length ? inputLines : ["- No explicit inputs supplied."]),
    ...(workflow.length ? ["Declared workflow:", ...workflow] : []),
  ].join("\n");
}

export class RunService {
  private readonly events = new EventEmitter();
  private readonly activeRuns = new Map<string, { handle: OpenCodeRunHandle; timeout: NodeJS.Timeout }>();
  private readonly pendingQuestions = new Map<string, string>();
  private readonly pendingPermissions = new Map<string, string>();

  constructor(
    private readonly config: HubConfig,
    private readonly database: HubDatabase,
    private readonly provider: RunProvider,
    private readonly artifacts?: ArtifactService,
    private readonly uploads?: UploadService,
  ) {}

  async start(manifest: SkillManifest, rawInputs: unknown, ownerId = localOwnerId): Promise<RunRecord> {
    const inputValues = validateRunInputs(manifest, rawInputs);
    const maxConcurrent = this.config.maxConcurrentRunsPerUser;
    if (maxConcurrent !== undefined && this.database.countActiveRunsByOwner(ownerId) >= maxConcurrent) {
      throw new RunQuotaError(`Concurrent run limit (${maxConcurrent}) reached.`);
    }
    const maxDaily = this.config.maxRunsPerUserPerDay;
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (maxDaily !== undefined && this.database.countRunsByOwnerSince(ownerId, dayStart) >= maxDaily) {
      throw new RunQuotaError(`Daily run limit (${maxDaily}) reached.`);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const workspaceId = id;
    const workspaceDirectory = path.join(this.config.projectRoot, "runtime", "runs", workspaceId);
    await mkdir(workspaceDirectory, { recursive: true });
    let stagedFiles = new Map<string, string>();
    try {
      stagedFiles = this.uploads ? await this.uploads.stageForRun(manifest, inputValues, ownerId, workspaceDirectory) : stagedFiles;
    } catch (error) {
      throw new RunValidationError(error instanceof Error ? error.message : "The selected upload is unavailable.");
    }
    const run: RunRecord = {
      id,
      skillId: manifest.id,
      provider: manifest.provider,
      ownerId,
      status: "created",
      inputValues,
      workspaceId,
      createdAt: now,
      updatedAt: now,
    };
    this.database.createRun(run);
    this.publish(id, { type: "run.created" });

    const health = this.provider.getHealthSnapshot();
    if (health.status !== "healthy") {
      return await this.fail(id, "OpenCode is offline. The run was not started.");
    }

    const prompt = buildRunPrompt(manifest, inputValues, stagedFiles);
    const pendingProviderEvents: OpenCodeServerEvent[] = [];
    let runReadyForEvents = false;
    try {
      const handle = await this.provider.startRun({
        title: manifest.displayName,
        prompt,
        directory: workspaceDirectory,
        onEvent: (event) => {
          if (runReadyForEvents) this.handleOpenCodeEvent(id, event);
          else pendingProviderEvents.push(event);
        },
      });
      const started = this.database.updateRun(id, { status: "running", sessionId: handle.sessionId });
      if (!started) throw new Error(`Run ${id} was not persisted`);
      const timeout = setTimeout(() => {
        void this.abort(id, "Run timed out before OpenCode became idle.");
      }, this.config.runTimeoutMs);
      this.activeRuns.set(id, { handle, timeout });
      this.publish(id, { type: "run.started" });
      runReadyForEvents = true;
      for (const event of pendingProviderEvents) this.handleOpenCodeEvent(id, event);
      void handle.done.catch((error) => {
        const current = this.get(id);
        if (current && !terminalStatuses.has(current.status)) void this.fail(id, error instanceof Error ? error.message : "OpenCode event stream ended unexpectedly.");
      });
      return this.get(id) ?? started;
    } catch (error) {
      return await this.fail(id, error instanceof Error ? error.message : "OpenCode could not start the run.");
    }
  }

  async followUp(runId: string, message: unknown): Promise<RunRecord> {
    const run = this.get(runId);
    if (!run) throw new RunValidationError("Run was not found.");
    if (run.status !== "completed" || !run.sessionId) throw new RunValidationError("This run is not ready for a follow-up message.");
    if (this.activeRuns.has(run.id)) throw new RunValidationError("This run is already active.");
    if (!this.provider.continueRun) throw new RunValidationError("The connected provider does not support follow-up messages.");
    if (typeof message !== "string" || !message.trim()) throw new RunValidationError("A follow-up message is required.");
    const prompt = message.trim();
    if (prompt.length > 12000) throw new RunValidationError("The follow-up message exceeds the maximum length.");
    if (this.provider.getHealthSnapshot().status !== "healthy") return await this.fail(run.id, "OpenCode is offline. The follow-up message was not started.");

    const workspaceDirectory = path.join(this.config.projectRoot, "runtime", "runs", run.workspaceId);
    const pendingProviderEvents: OpenCodeServerEvent[] = [];
    let runReadyForEvents = false;
    try {
      const handle = await this.provider.continueRun({
        sessionId: run.sessionId,
        prompt,
        directory: workspaceDirectory,
        onEvent: (event) => {
          if (runReadyForEvents) this.handleOpenCodeEvent(run.id, event);
          else pendingProviderEvents.push(event);
        },
      });
      const started = this.database.updateRun(run.id, { status: "running" });
      if (!started) throw new Error(`Run ${run.id} was not persisted`);
      const timeout = setTimeout(() => {
        void this.abort(run.id, "Follow-up message timed out before OpenCode became idle.");
      }, this.config.runTimeoutMs);
      this.activeRuns.set(run.id, { handle, timeout });
      this.publish(run.id, { type: "run.started" });
      runReadyForEvents = true;
      for (const event of pendingProviderEvents) this.handleOpenCodeEvent(run.id, event);
      void handle.done.catch((error) => {
        const current = this.get(run.id);
        if (current && !terminalStatuses.has(current.status)) void this.fail(run.id, error instanceof Error ? error.message : "OpenCode event stream ended unexpectedly.");
      });
      return this.get(run.id) ?? started;
    } catch (error) {
      return await this.fail(run.id, error instanceof Error ? error.message : "OpenCode could not start the follow-up message.");
    }
  }

  get(runId: string): RunRecord | undefined {
    return this.database.getRun(runId);
  }

  list(ownerId = localOwnerId): RunRecord[] {
    return this.database.listRuns(ownerId);
  }

  listEvents(runId: string, afterSequence = 0): StoredRunEvent[] {
    return this.database.listRunEvents(runId, afterSequence);
  }

  onEvent(runId: string, listener: (event: StoredRunEvent) => void): () => void {
    const key = `run:${runId}`;
    this.events.on(key, listener);
    return () => this.events.off(key, listener);
  }

  async abort(runId: string, message = "Run aborted by the user."): Promise<RunRecord | undefined> {
    const run = this.get(runId);
    if (!run || terminalStatuses.has(run.status)) return run;
    const active = this.activeRuns.get(runId);
    if (active) {
      clearTimeout(active.timeout);
      this.activeRuns.delete(runId);
      try { await active.handle.abort(); } catch { /* Preserve the aborted state even if the upstream request fails. */ }
    }
    let updated = this.database.updateRun(runId, { status: "aborted", completedAt: new Date().toISOString() });
    if (message !== "Run aborted by the user." && updated) {
      updated = this.database.updateRun(runId, { status: "aborted", summary: message, completedAt: updated.completedAt });
    }
    if (!updated) return updated;
    await this.collectArtifacts(updated);
    this.publish(runId, { type: "run.aborted" });
    return updated;
  }

  async delete(runId: string): Promise<boolean> {
    const run = this.get(runId);
    if (!run) return false;
    if (!terminalStatuses.has(run.status)) await this.abort(runId, "Run deleted by the user.");
    const current = this.get(runId) ?? run;
    if (current.sessionId && this.provider.deleteSession) {
      try { await this.provider.deleteSession(current.sessionId); } catch { /* Local deletion must complete even if OpenCode is offline. */ }
    }
    const workspaceDirectory = path.join(this.config.projectRoot, "runtime", "runs", current.workspaceId);
    await rm(workspaceDirectory, { recursive: true, force: true, maxRetries: 2 });
    return this.database.deleteRuns([runId]) > 0;
  }

  async fail(runId: string, message: string): Promise<RunRecord> {
    const active = this.activeRuns.get(runId);
    if (active) {
      clearTimeout(active.timeout);
      active.handle.close();
      this.activeRuns.delete(runId);
    }
    const updated = this.database.updateRun(runId, { status: "failed", errorMessage: message, completedAt: new Date().toISOString() });
    if (!updated) throw new Error(`Run ${runId} does not exist`);
    await this.collectArtifacts(updated);
    this.publish(runId, { type: "run.failed", message });
    return updated;
  }

  async answerQuestion(runId: string, questionId: string, answers: string[][]): Promise<RunRecord | undefined> {
    const run = this.get(runId);
    if (!run) return undefined;
    if (this.pendingQuestions.get(questionId) !== runId || run.status !== "waiting_question") throw new RunValidationError("Question is not pending for this run");
    await this.provider.replyToQuestion(questionId, answers);
    this.pendingQuestions.delete(questionId);
    return this.database.updateRun(runId, { status: "running" });
  }

  async answerPermission(runId: string, permissionId: string, reply: "once" | "always" | "reject"): Promise<RunRecord | undefined> {
    const run = this.get(runId);
    if (!run) return undefined;
    if (this.pendingPermissions.get(permissionId) !== runId || run.status !== "waiting_permission") throw new RunValidationError("Permission is not pending for this run");
    await this.provider.replyToPermission(permissionId, reply);
    this.pendingPermissions.delete(permissionId);
    return this.database.updateRun(runId, { status: "running" });
  }

  private handleOpenCodeEvent(runId: string, event: OpenCodeServerEvent): void {
    const properties = event.properties ?? {};
    switch (event.type) {
      case "message.part.updated": {
        const part = properties.part;
        if (!part || typeof part !== "object") return;
        const value = part as { type?: unknown; text?: unknown; tool?: unknown; state?: { status?: unknown; input?: unknown; output?: unknown } };
        if (value.type === "reasoning" && typeof value.text === "string") this.publish(runId, { type: "thinking.delta", text: value.text });
        if (value.type === "tool") {
          const tool = typeof value.tool === "string" ? value.tool : "tool";
          const input = value.state?.input;
          const command = typeof input === "string"
            ? input
            : input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string"
              ? (input as { command: string }).command
              : undefined;
          if (value.state?.status === "running" || value.state?.status === "pending") this.publish(runId, { type: "tool.started", tool });
          if (command) this.publish(runId, { type: "terminal.command", command });
          if (typeof value.state?.output === "string") this.publish(runId, { type: "terminal.output", text: value.state.output.slice(0, 6000) });
        }
        return;
      }
      case "session.status":
        if (typeof properties.status === "string") this.publish(runId, { type: "provider.status", message: properties.status });
        return;
      case "session.next.reasoning.delta":
        if (typeof properties.delta === "string") this.publish(runId, { type: "thinking.delta", text: properties.delta });
        return;
      case "session.next.text.delta":
        if (typeof properties.delta === "string") this.publish(runId, { type: "message.delta", text: properties.delta });
        return;
      case "session.next.tool.called":
        {
          const tool = typeof properties.tool === "string" ? properties.tool : typeof properties.name === "string" ? properties.name : "tool";
          this.publish(runId, { type: "tool.started", tool });
          const input = properties.input;
          const command = typeof input === "string"
            ? input
            : input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string"
              ? (input as { command: string }).command
              : undefined;
          if (command) this.publish(runId, { type: "terminal.command", command });
        }
        return;
      case "session.next.tool.success":
      case "session.next.tool.failed":
        this.publish(runId, { type: "tool.finished", tool: typeof properties.callID === "string" ? properties.callID : "tool" });
        {
          const output = typeof properties.output === "string" ? properties.output : typeof properties.result === "string" ? properties.result : undefined;
          if (output) this.publish(runId, { type: "terminal.output", text: output.slice(0, 6000) });
        }
        return;
      case "question.asked": {
        const questionId = typeof properties.id === "string" ? properties.id : undefined;
        if (!questionId) return;
        this.pendingQuestions.set(questionId, runId);
        this.database.updateRun(runId, { status: "waiting_question" });
        const question = Array.isArray(properties.questions)
          ? properties.questions.map((entry) => typeof entry === "object" && entry ? JSON.stringify(entry) : String(entry)).join("\n")
          : "OpenCode is waiting for an answer.";
        this.publish(runId, { type: "question.pending", questionId, question });
        return;
      }
      case "permission.asked": {
        const permissionId = typeof properties.id === "string" ? properties.id : undefined;
        if (!permissionId) return;
        this.pendingPermissions.set(permissionId, runId);
        this.database.updateRun(runId, { status: "waiting_permission" });
        this.publish(runId, { type: "permission.pending", permissionId, permission: typeof properties.permission === "string" ? properties.permission : "OpenCode requested permission." });
        return;
      }
      case "session.idle":
        this.complete(runId);
        return;
      case "session.error":
        // OpenCode has emitted both `error` and `message` payloads across
        // versions. Preserve whichever carries the upstream diagnostic.
        void this.fail(runId, this.describeError(properties.error ?? properties.message));
        return;
      default:
        return;
    }
  }

  private complete(runId: string): void {
    const current = this.get(runId);
    if (!current || terminalStatuses.has(current.status)) return;
    const active = this.activeRuns.get(runId);
    if (active) {
      clearTimeout(active.timeout);
      active.handle.close();
      this.activeRuns.delete(runId);
    }
    const completed = this.database.updateRun(runId, { status: "completed", completedAt: new Date().toISOString() });
    if (!completed) return;
    if (!this.artifacts) {
      this.publish(runId, { type: "run.completed" });
    } else {
      void this.collectArtifacts(completed).finally(() => this.publish(runId, { type: "run.completed" }));
    }
  }

  private describeError(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    return "OpenCode reported a session error.";
  }

  private publish(runId: string, event: RunEvent): StoredRunEvent {
    const stored = this.database.appendRunEvent(runId, event);
    this.events.emit(`run:${runId}`, stored);
    return stored;
  }

  private async collectArtifacts(run: RunRecord): Promise<void> {
    if (!this.artifacts) return;
    try {
      const artifacts = await this.artifacts.collect(run);
      for (const artifact of artifacts) this.publish(run.id, { type: "artifact.created", artifactId: artifact.id });
    } catch {
      // Artifact collection must not turn a completed or aborted run into a failed run.
    }
  }
}
