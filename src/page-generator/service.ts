import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { HubConfig } from "../config.js";
import type { OpenCodeRunHandle, OpenCodeServerEvent } from "../providers/opencode/provider.js";
import { HubDatabase } from "../storage/database.js";
import type { GeneratedPagePreset, GeneratedPageRecord, SkillManifest } from "../types.js";

const defaultPromptVersion = "skill-page-contract-v1";
const maximumGeneratedFileBytes = 250 * 1024;
const outputFiles = ["index.html", "styles.css", "view.manifest.json"] as const;
const optionalOutputFiles = ["view.js"] as const;

const viewManifestSchema = z.object({
  contractVersion: z.literal(1),
  preset: z.enum(["form-first", "workflow-console", "artifact-workbench"]),
  sourceHash: z.string().min(1),
  inputIds: z.array(z.string().min(1)),
  runtime: z.literal("shared"),
}).strict();

export interface PageGenerationProvider {
  getHealthSnapshot(): { status: "healthy" | "offline" | "starting" | "misconfigured" };
  startRun(options: { title: string; prompt: string; directory: string; onEvent: (event: OpenCodeServerEvent) => void }): Promise<OpenCodeRunHandle>;
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!segment || segment.length > 120) throw new Error("Invalid Skill ID for generated page output");
  return segment;
}

function choosePreset(manifest: SkillManifest): GeneratedPagePreset {
  if (manifest.outputs.length > manifest.inputs.length && manifest.outputs.length > 0) return "artifact-workbench";
  if (manifest.workflow.length >= 4) return "workflow-console";
  return "form-first";
}

function publicGenerationManifest(manifest: SkillManifest): Omit<SkillManifest, "sourcePath"> {
  const { sourcePath: _sourcePath, ...publicManifest } = manifest;
  return publicManifest;
}

function runtimeContract(): string {
  return [
    "The generated page runs in a sandboxed iframe.",
    "The module /runtime/skill-runtime.js owns all communication with the parent Hub.",
    "It finds [data-skill-form], [data-run-status], [data-run-events], [data-run-interaction], and [data-run-artifacts].",
    "It sends only declared form values to the parent, which validates them and calls the Node API.",
    "It renders run state, events, questions, permission choices, and artifact previews without direct network requests from generated code.",
  ].join("\n");
}

function assertGeneratedTextIsSafe(filename: string, value: string): void {
  if (/\b(?:https?:|file:|javascript:)\/\//i.test(value)) throw new Error(`${filename} references an external or local URL`);
  if (/[a-zA-Z]:[\\/]/.test(value)) throw new Error(`${filename} contains an absolute local path`);
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(value)) throw new Error(`${filename} bypasses the shared runtime`);
  if (/\b(?:api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*["'][^"']+/i.test(value) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)) {
    throw new Error(`${filename} contains a credential-like value`);
  }
  if (/\b(?:window\.)?location\s*(?:=|\.\s*(?:assign|replace)\s*\()/i.test(value)) throw new Error(`${filename} contains a client-side redirect`);
}

function assertGeneratedHtmlIsSafe(html: string): void {
  assertGeneratedTextIsSafe("index.html", html);
  if (/<(?:iframe|object|embed|base)\b/i.test(html)) throw new Error("index.html contains an unsupported embedded browsing context");
  if (/\son[a-z]+\s*=/i.test(html)) throw new Error("index.html contains inline event handlers");
  if (!/<form\b[^>]*data-skill-form/i.test(html)) throw new Error("index.html is missing data-skill-form");
  for (const mount of ["data-run-status", "data-run-events", "data-run-interaction", "data-run-artifacts"]) {
    if (!new RegExp(`<[^>]+${mount}`, "i").test(html)) throw new Error(`index.html is missing ${mount}`);
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  for (const script of scripts) {
    const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(script[1])?.[1];
    if (!source || !["/runtime/skill-runtime.js", "./view.js"].includes(source)) throw new Error("index.html uses an unapproved script");
  }
  const stylesheets = [...html.matchAll(/<link\b([^>]*)>/gi)];
  for (const link of stylesheets) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(link[1])?.[1];
    if (href && href !== "./styles.css") throw new Error("index.html uses an unapproved stylesheet");
  }
  if (!/href\s*=\s*["']\.\/styles\.css["']/i.test(html)) throw new Error("index.html must load ./styles.css");
  if (!/src\s*=\s*["']\/runtime\/skill-runtime\.js["']/i.test(html)) throw new Error("index.html must load the shared runtime");
}

function assertGeneratedCssIsSafe(css: string): void {
  assertGeneratedTextIsSafe("styles.css", css);
  if (/\@import|url\s*\(/i.test(css)) throw new Error("styles.css contains an external asset reference");
}

function validateViewManifest(manifest: SkillManifest, preset: GeneratedPagePreset, raw: string): GeneratedPageRecord["viewManifest"] {
  const parsed = viewManifestSchema.parse(JSON.parse(raw));
  const expectedInputs = [...manifest.inputs.map((input) => input.id)].sort();
  const receivedInputs = [...parsed.inputIds].sort();
  if (parsed.preset !== preset || parsed.sourceHash !== manifest.sourceHash) throw new Error("view.manifest.json does not match the current Skill or preset");
  if (new Set(receivedInputs).size !== receivedInputs.length || expectedInputs.length !== receivedInputs.length || expectedInputs.some((id, index) => id !== receivedInputs[index])) {
    throw new Error("view.manifest.json must declare every manifest input exactly once");
  }
  return parsed;
}

async function assertJavaScriptSyntax(filename: string, filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filePath], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${filename} contains invalid JavaScript syntax${errorOutput ? `: ${errorOutput.slice(0, 400)}` : ""}`));
    });
  });
}

export class PageGenerator {
  private readonly queue: string[] = [];
  private running = false;
  private paused = false;

  constructor(
    private readonly config: HubConfig,
    private readonly database: HubDatabase,
    private readonly provider: PageGenerationProvider,
  ) {}

  async generate(manifest: SkillManifest, requestedPreset?: GeneratedPagePreset, options: { resume?: boolean; force?: boolean } = {}): Promise<GeneratedPageRecord> {
    if (options.resume !== false) {
      this.paused = false;
      void this.drain();
    }
    const preset = requestedPreset ?? choosePreset(manifest);
    const promptVersion = this.currentPromptVersion();
    const reusable = options.force ? undefined : this.database.findReusableGeneratedPage(manifest.id, manifest.sourceHash, promptVersion);
    if (reusable) {
      const active = this.database.activateGeneratedPage(manifest.id, reusable.version) ?? reusable;
      this.database.updateSkillPageStatus(manifest.id, "ready");
      return active;
    }

    const existing = this.database.listGeneratedPages(manifest.id).find((page) => page.sourceHash === manifest.sourceHash && page.preset === preset && (page.status === "queued" || page.status === "generating"));
    if (existing) return existing;

    const now = new Date().toISOString();
    const page: GeneratedPageRecord = {
      id: randomUUID(),
      skillId: manifest.id,
      version: `${now.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`,
      preset,
      sourceHash: manifest.sourceHash,
      promptVersion,
      status: "queued",
      active: false,
      createdAt: now,
      updatedAt: now,
    };
    this.database.createGeneratedPage(page);
    this.database.appendGeneratedPageEvent(page.id, "queued", "Page generation queued.");
    this.database.updateSkillPageStatus(manifest.id, "queued");
    this.queue.push(page.id);
    void this.drain();
    return page;
  }

  getActive(skillId: string): GeneratedPageRecord | undefined {
    return this.database.getActiveGeneratedPage(skillId);
  }

  getStatus(skillId: string): GeneratedPageRecord[] {
    return this.database.listGeneratedPages(skillId);
  }

  activate(skillId: string, version: string): GeneratedPageRecord | undefined {
    const page = this.database.activateGeneratedPage(skillId, version);
    if (page) {
      this.database.appendGeneratedPageEvent(page.id, "activated", "This version was activated.");
      this.database.updateSkillPageStatus(skillId, "ready");
    }
    return page;
  }

  recoverInterrupted(): void {
    for (const page of this.database.listGeneratedPagesByStatus(["generating"])) {
      this.database.updateGeneratedPage(page.id, { status: "failed", errorMessage: "Page generation was interrupted by a Node restart." });
      this.database.appendGeneratedPageEvent(page.id, "failed", "Page generation was interrupted by a Node restart.");
      this.database.updateSkillPageStatus(page.skillId, this.database.getActiveGeneratedPage(page.skillId) ? "stale" : "missing");
    }
  }

  resumeQueued(): void {
    this.paused = false;
    for (const page of this.database.listGeneratedPagesByStatus(["queued"])) {
      if (!this.queue.includes(page.id)) this.queue.push(page.id);
    }
    void this.drain();
  }

  markStalePromptVersions(): number {
    const promptVersion = this.currentPromptVersion();
    let staleCount = 0;
    for (const skill of this.database.listSkills()) {
      const active = this.database.getActiveGeneratedPage(skill.id);
      if (active && active.promptVersion !== promptVersion) {
        this.database.updateSkillPageStatus(skill.id, "stale");
        staleCount += 1;
      }
    }
    return staleCount;
  }

  async waitForIdle(): Promise<void> {
    while (this.running || (!this.paused && this.queue.length > 0)) await delay(5);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.paused && this.queue.length > 0) {
        const id = this.queue.shift();
        if (id) await this.execute(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async execute(id: string): Promise<void> {
    const page = this.database.getGeneratedPage(id);
    if (!page || page.status !== "queued") return;
    const manifest = this.database.getSkill(page.skillId);
    if (!manifest || manifest.sourceHash !== page.sourceHash) {
      this.markFailed(page, "The Skill changed before its page could be generated.");
      return;
    }
    if (this.provider.getHealthSnapshot().status !== "healthy") {
      this.markFailed(page, "OpenCode is offline. Page generation was not started.");
      return;
    }

    this.database.updateGeneratedPage(page.id, { status: "generating" });
    this.database.appendGeneratedPageEvent(page.id, "started", "Page generation started.");
    this.database.updateSkillPageStatus(manifest.id, "generating");
    const workspaceRoot = this.config.pageGenerationWorkspaceRoot ?? path.join(tmpdir(), "skill-web-hub-page-generation");
    await mkdir(workspaceRoot, { recursive: true });
    // OpenCode writes only in this disposable system-temp workspace. Node validates then persists approved files.
    const workspace = await mkdtemp(path.join(workspaceRoot, "page-"));
    let handle: OpenCodeRunHandle | undefined;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: Error) => void;
    let acceptingEvents = false;
    const pendingEvents: OpenCodeServerEvent[] = [];
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const receive = (event: OpenCodeServerEvent) => {
      if (!acceptingEvents) {
        pendingEvents.push(event);
        return;
      }
      this.recordOpenCodeEvent(page.id, event);
      if (event.type === "session.idle") resolveCompletion();
      if (event.type === "session.error") rejectCompletion(new Error("OpenCode reported a page generation error."));
      if (event.type === "question.asked" || event.type === "permission.asked") {
        rejectCompletion(new Error("Page generation requires interactive input or permission approval."));
      }
    };

    try {
      handle = await this.provider.startRun({
        title: `Generate ${manifest.displayName} page`,
        prompt: await this.buildPrompt(manifest, page.preset),
        directory: workspace,
        onEvent: receive,
      });
      this.database.updateGeneratedPage(page.id, { status: "generating", sessionId: handle.sessionId });
      this.database.appendGeneratedPageEvent(page.id, "session.started", "OpenCode generation session started.");
      acceptingEvents = true;
      for (const event of pendingEvents) receive(event);
      const timeout = setTimeout(
        () => rejectCompletion(new Error("Page generation timed out.")),
        this.config.pageGenerationTimeoutMs ?? 120000,
      );
      try {
        void handle.done.then(() => rejectCompletion(new Error("OpenCode event stream ended before page generation completed."))).catch((error) => rejectCompletion(error instanceof Error ? error : new Error("OpenCode event stream failed.")));
        await completion;
      } finally {
        clearTimeout(timeout);
      }
      handle.close();
      this.database.appendGeneratedPageEvent(page.id, "validating", "Generated files are being validated.");
      const viewManifest = await this.validateOutput(manifest, page, workspace);
      const outputDirectory = await this.persistOutput(page, workspace);
      const ready = this.database.updateGeneratedPage(page.id, { status: "ready", outputDirectory, viewManifest, errorMessage: null });
      if (!ready) throw new Error("Generated page record disappeared before activation.");
      this.database.activateGeneratedPage(manifest.id, ready.version);
      this.database.appendGeneratedPageEvent(page.id, "ready", "Generated page validated, persisted, and activated.");
      this.database.updateSkillPageStatus(manifest.id, "ready");
    } catch (error) {
      handle?.close();
      const message = error instanceof Error ? error.message : "Page generation failed.";
      this.markFailed(page, message);
      if (this.isUpstreamFailure(message)) this.paused = true;
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async buildPrompt(manifest: SkillManifest, preset: GeneratedPagePreset): Promise<string> {
    const [base, presetInstructions] = await Promise.all([
      readFile(path.join(this.config.projectRoot, "prompts", "skill-page-base.md"), "utf8"),
      readFile(path.join(this.config.projectRoot, "prompts", `${preset}.md`), "utf8"),
    ]);
    return base
      .replace("{{manifest_json}}", JSON.stringify(publicGenerationManifest(manifest), null, 2))
      .replace("{{preset_instructions}}", presetInstructions)
      .replace("{{runtime_contract}}", runtimeContract())
      .replaceAll("{{source_hash}}", manifest.sourceHash);
  }

  private currentPromptVersion(): string {
    return this.config.pagePromptVersion ?? defaultPromptVersion;
  }

  private async validateOutput(manifest: SkillManifest, page: GeneratedPageRecord, workspace: string): Promise<GeneratedPageRecord["viewManifest"]> {
    const output = path.join(workspace, "output");
    const files = new Map<string, string>();
    for (const filename of [...outputFiles, ...optionalOutputFiles]) {
      const filenamePath = path.join(output, filename);
      try {
        const details = await lstat(filenamePath);
        if (!details.isFile() || details.isSymbolicLink() || details.size > maximumGeneratedFileBytes) throw new Error(`${filename} is not an allowed regular file`);
        files.set(filename, await readFile(filenamePath, "utf8"));
      } catch (error) {
        if ((outputFiles as readonly string[]).includes(filename)) throw error;
      }
    }
    const html = files.get("index.html");
    const css = files.get("styles.css");
    const rawViewManifest = files.get("view.manifest.json");
    if (!html || !css || !rawViewManifest) throw new Error("Generated page is missing a required output file.");
    assertGeneratedHtmlIsSafe(html);
    assertGeneratedCssIsSafe(css);
    const viewScript = files.get("view.js");
    if (viewScript) {
      assertGeneratedTextIsSafe("view.js", viewScript);
      await assertJavaScriptSyntax("view.js", path.join(output, "view.js"));
    }
    if (!viewScript && /src\s*=\s*["']\.\/view\.js["']/i.test(html)) throw new Error("index.html references a missing view.js file");
    return validateViewManifest(manifest, page.preset, rawViewManifest);
  }

  private async persistOutput(page: GeneratedPageRecord, workspace: string): Promise<string> {
    const skillDirectory = safeSegment(page.skillId);
    const relativeOutput = path.posix.join("generated", skillDirectory, page.version);
    const target = path.join(this.config.projectRoot, "frontend", ...relativeOutput.split("/"));
    const staging = `${target}.staging-${randomUUID().slice(0, 8)}`;
    await mkdir(staging, { recursive: true });
    for (const filename of [...outputFiles, ...optionalOutputFiles]) {
      const source = path.join(workspace, "output", filename);
      try {
        await copyFile(source, path.join(staging, filename));
      } catch (error) {
        if ((outputFiles as readonly string[]).includes(filename)) throw error;
      }
    }
    await rename(staging, target);
    await writeFile(path.join(target, ".generated-by-skill-web-hub"), `${page.id}\n`, "utf8");
    return relativeOutput;
  }

  private markFailed(page: GeneratedPageRecord, message: string): void {
    this.database.updateGeneratedPage(page.id, { status: "failed", errorMessage: message.slice(0, 500) });
    this.database.appendGeneratedPageEvent(page.id, "failed", message);
    this.database.updateSkillPageStatus(page.skillId, this.database.getActiveGeneratedPage(page.skillId) ? "stale" : "failed");
  }

  private recordOpenCodeEvent(pageId: string, event: OpenCodeServerEvent): void {
    const type = typeof event.type === "string" && event.type.length > 0 ? event.type : "unknown";
    const message = type === "session.idle"
      ? "OpenCode reported the generation session is idle."
      : type === "session.error"
        ? "OpenCode reported a page generation error."
        : type === "question.asked" || type === "permission.asked"
          ? "OpenCode requested interaction during page generation."
          : "OpenCode generation event received.";
    this.database.appendGeneratedPageEvent(pageId, `opencode.${type}`, message);
  }

  private isUpstreamFailure(message: string): boolean {
    return message.startsWith("OpenCode ")
      || message.startsWith("Page generation requires interactive")
      || message === "Page generation timed out.";
  }
}
