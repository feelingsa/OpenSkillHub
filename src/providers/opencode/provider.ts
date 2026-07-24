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

  private async waitForHealthy(): Promise<ProviderHealth> {
    const deadline = Date.now() + this.config.startTimeoutMs;
    while (Date.now() < deadline) {
      const health = await this.checkHealth();
      if (health.status === "healthy") return health;
      await delay(400);
    }
    return this.setHealth("offline", `OpenCode did not become healthy within ${this.config.startTimeoutMs}ms`);
  }

  private setHealth(status: ProviderHealth["status"], message?: string): ProviderHealth {
    this.lastHealth = { provider: "opencode", status, checkedAt: new Date().toISOString(), ...(message ? { message } : {}) };
    if (status === "healthy") this.restartAttempts = 0;
    return this.lastHealth;
  }

  private async checkCommand(): Promise<{ ok: true } | { ok: false; message: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.config.command, ["--version"], { cwd: this.config.workingDirectory, shell: false, windowsHide: true });
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
