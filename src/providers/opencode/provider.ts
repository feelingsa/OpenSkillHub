import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { HubConfig } from "../../config.js";
import type { ProviderHealth } from "../../types.js";

export interface ProviderLogger {
  debug(data: unknown, message?: string): void;
  info(data: unknown, message?: string): void;
  warn(data: unknown, message?: string): void;
  error(data: unknown, message?: string): void;
}

export interface OpenCodeApiSkill {
  name?: string;
  id?: string;
  description?: string;
  path?: string;
  [key: string]: unknown;
}

export interface OpenCodeServerEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

export interface OpenCodeRunHandle {
  sessionId: string;
  done: Promise<void>;
  abort(): Promise<void>;
  close(): void;
}

export class OpenCodeProvider {
  private child?: ChildProcessWithoutNullStreams;
  private ownsLock = false;
  private stopping = false;
  private restartAttempts = 0;
  private version?: string;
  private lastHealth: ProviderHealth = {
    provider: "opencode",
    status: "offline",
    checkedAt: new Date(0).toISOString(),
  };

  constructor(
    private readonly config: HubConfig["opencode"],
    private readonly logger: ProviderLogger,
  ) {}

  getHealthSnapshot(): ProviderHealth {
    return this.lastHealth;
  }

  getRuntimeInfo(): { version?: string; capabilities: string[] } {
    return { ...(this.version ? { version: this.version } : {}), capabilities: ["health", "skills"] };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const endpoints = ["global/health", "health"];
    let lastMessage = "OpenCode did not return a successful health response";

    for (const endpoint of endpoints) {
      const url = new URL(endpoint, this.config.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok) {
          return this.setHealth("healthy");
        }
        lastMessage = `OpenCode health endpoint returned HTTP ${response.status}`;
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "OpenCode health request failed";
      } finally {
        clearTimeout(timer);
      }
    }

    return this.setHealth("offline", lastMessage);
  }

  async start(): Promise<ProviderHealth> {
    const existing = await this.checkHealth();
    if (existing.status === "healthy" || this.config.mode === "connect") return existing;
    if (this.child && !this.child.killed) return this.waitForHealthy();
    if (!(await this.acquireManagedLock())) {
      return this.setHealth("misconfigured", "Another Node process owns managed OpenCode");
    }
    const commandCheck = await this.checkCommand();
    if (!commandCheck.ok) {
      await this.releaseManagedLock();
      return this.setHealth("misconfigured", commandCheck.message);
    }

    this.stopping = false;
    this.setHealth("starting");
    try {
      this.child = spawn(this.config.command, this.config.args, {
        cwd: this.config.workingDirectory,
        shell: false,
        windowsHide: true,
        env: this.runtimeEnvironment(),
      });
    } catch (error) {
      await this.releaseManagedLock();
      return this.setHealth("misconfigured", error instanceof Error ? error.message : "Unable to start OpenCode");
    }

    this.child.stdout.on("data", (chunk: Buffer) => this.recordProcessOutput("stdout", chunk));
    this.child.stderr.on("data", (chunk: Buffer) => this.recordProcessOutput("stderr", chunk));
    this.child.on("error", (error) => this.setHealth("misconfigured", error.message));
    this.child.on("exit", async (code, signal) => {
      this.logger.warn({ code, signal }, "OpenCode process exited");
      this.child = undefined;
      await this.releaseManagedLock();
      this.setHealth("offline", "OpenCode process exited");
      if (!this.stopping && this.restartAttempts < 2) {
        this.restartAttempts += 1;
        void this.restartAfterExit();
      }
    });

    return this.waitForHealthy();
  }

  async stop(): Promise<void> {
    if (!this.child || this.child.killed) return;
    this.stopping = true;
    this.child.kill();
    this.child = undefined;
    await this.releaseManagedLock();
    this.setHealth("offline", "OpenCode stopped with Node service");
  }

  async listSkills(): Promise<OpenCodeApiSkill[]> {
    const health = await this.checkHealth();
    if (health.status !== "healthy") return [];

    for (const endpoint of ["skill", "skills"]) {
      const url = new URL(endpoint, this.config.url);
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const payload: unknown = await response.json();
        const list = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
            ? (payload as { data: unknown[] }).data
            : [];
        return list.filter((entry): entry is OpenCodeApiSkill => Boolean(entry && typeof entry === "object"));
      } catch (error) {
        this.logger.debug({ endpoint, error }, "OpenCode Skill API unavailable");
      }
    }
    return [];
  }

  async startRun(options: { title: string; prompt: string; directory: string; onEvent: (event: OpenCodeServerEvent) => void }): Promise<OpenCodeRunHandle> {
    const health = await this.checkHealth();
    if (health.status !== "healthy") throw new Error("OpenCode is offline");
    const model = this.config.model;
    const session = await this.requestJson<{ id?: unknown }>("session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: options.title, ...(model ? { model } : {}) }),
    });
    if (!session || typeof session.id !== "string") throw new Error("OpenCode did not create a valid session");
    const sessionId = session.id;
    const subscription = await this.subscribe((event) => {
      if (event.properties && event.properties.sessionID === sessionId) options.onEvent(event);
    });
    const endpoint = `session/${encodeURIComponent(sessionId)}/message`;
    const url = new URL(endpoint, this.config.url);
    url.searchParams.set("directory", options.directory);
    const promptController = new AbortController();
    void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: options.prompt }],
          ...(model ? { model: { providerID: model.providerID, modelID: model.id }, ...(model.variant ? { variant: model.variant } : {}) } : {}),
        }),
        signal: promptController.signal,
      })
      .then(async (response) => {
        if (!response.ok) throw new Error(`OpenCode message request returned HTTP ${response.status}`);
        await response.arrayBuffer();
        // The message endpoint completes only after the assistant has stopped. Some
        // OpenCode versions omit session.idle from the shared SSE subscription.
        options.onEvent({ type: "session.idle", properties: { sessionID: sessionId } });
      })
      .catch((error) => {
        if (promptController.signal.aborted) return;
        options.onEvent({ type: "session.error", properties: { message: error instanceof Error ? error.message : "OpenCode message request failed" } });
      });
    return {
      sessionId,
      done: subscription.done,
      close: () => {
        promptController.abort();
        subscription.close();
      },
      abort: async () => {
        promptController.abort();
        await this.requestJson(`session/${encodeURIComponent(sessionId)}/abort`, { method: "POST" });
        subscription.close();
      },
    };
  }

  async replyToQuestion(requestId: string, answers: string[][]): Promise<void> {
    await this.requestJson(`question/${encodeURIComponent(requestId)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
  }

  async replyToPermission(requestId: string, reply: "once" | "always" | "reject"): Promise<void> {
    await this.requestJson(`permission/${encodeURIComponent(requestId)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    });
  }

  private async waitForHealthy(): Promise<ProviderHealth> {
    const deadline = Date.now() + this.config.startTimeoutMs;
    while (Date.now() < deadline) {
      const health = await this.checkHealth();
      if (health.status === "healthy") return health;
      await delay(400);
    }
    return this.setHealth("offline", `OpenCode did not become healthy within ${this.config.startTimeoutMs}ms`);
  }

  private async requestJson<T = unknown>(endpoint: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(endpoint, this.config.url), init);
    if (!response.ok) throw new Error(`OpenCode API returned HTTP ${response.status}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async subscribe(onEvent: (event: OpenCodeServerEvent) => void): Promise<{ done: Promise<void>; close: () => void }> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const response = await fetch(new URL("event", this.config.url), { headers: { Accept: "text/event-stream" }, signal: controller.signal });
    const body = response.body;
    if (!response.ok || !body) throw new Error(`OpenCode event stream returned HTTP ${response.status}`);
    const done = (async () => {
      reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: string[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          let lineEnd: number;
          while ((lineEnd = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
            buffer = buffer.slice(lineEnd + 1);
            if (!line) {
              if (data.length) {
                try { onEvent(JSON.parse(data.join("\n")) as OpenCodeServerEvent); } catch { /* Ignore malformed event data. */ }
                data = [];
              }
            } else if (line.startsWith("data:")) {
              data.push(line.slice(5).trimStart());
            }
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      } finally {
        reader?.releaseLock();
      }
    })();
    return {
      done,
      close: () => {
        controller.abort();
        void reader?.cancel().catch(() => undefined);
      },
    };
  }

  private setHealth(status: ProviderHealth["status"], message?: string): ProviderHealth {
    this.lastHealth = { provider: "opencode", status, checkedAt: new Date().toISOString(), ...(message ? { message } : {}) };
    if (status === "healthy") this.restartAttempts = 0;
    return this.lastHealth;
  }

  private async checkCommand(): Promise<{ ok: true } | { ok: false; message: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.config.command, ["--version"], { cwd: this.config.workingDirectory, shell: false, windowsHide: true, env: this.runtimeEnvironment() });
      let output = "";
      const timeout = setTimeout(() => {
        child.kill();
        resolve({ ok: false, message: "OpenCode version check timed out" });
      }, 5000);
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.once("error", (error) => {
        clearTimeout(timeout);
        resolve({ ok: false, message: `OpenCode command is unavailable: ${error.message}` });
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          this.version = output.trim().slice(0, 200) || undefined;
          resolve({ ok: true });
        } else {
          resolve({ ok: false, message: "OpenCode version check failed" });
        }
      });
    });
  }

  private async restartAfterExit(): Promise<void> {
    await delay(1000);
    const result = await this.start();
    if (result.status !== "healthy") this.logger.warn({ attempt: this.restartAttempts, status: result.status }, "OpenCode restart attempt failed");
  }

  private runtimeEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      XDG_CONFIG_HOME: this.config.configDirectory,
      XDG_DATA_HOME: this.config.dataDirectory,
    };
  }

  private async acquireManagedLock(): Promise<boolean> {
    const filename = this.config.lockFilePath;
    await mkdir(path.dirname(filename), { recursive: true });
    try {
      await writeFile(filename, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx" });
      this.ownsLock = true;
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }

    try {
      const content = JSON.parse(await readFile(filename, "utf8")) as { pid?: number };
      if (typeof content.pid === "number") {
        try {
          process.kill(content.pid, 0);
          return false;
        } catch {
          await rm(filename, { force: true });
          return this.acquireManagedLock();
        }
      }
    } catch {
      await rm(filename, { force: true });
      return this.acquireManagedLock();
    }
    return false;
  }

  private async releaseManagedLock(): Promise<void> {
    if (!this.ownsLock) return;
    await rm(this.config.lockFilePath, { force: true });
    this.ownsLock = false;
  }

  private recordProcessOutput(stream: "stdout" | "stderr", chunk: Buffer): void {
    const text = chunk.toString().trim();
    if (!text) return;
    this.logger[stream === "stdout" ? "info" : "warn"]({ stream, text }, "OpenCode process output");
    void mkdir(path.dirname(this.config.logFilePath), { recursive: true })
      .then(() => appendFile(this.config.logFilePath, `${new Date().toISOString()} [${stream}] ${text}\n`, "utf8"))
      .catch((error) => this.logger.warn({ error }, "Could not append OpenCode process log"));
  }
}
