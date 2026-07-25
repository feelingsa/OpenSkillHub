import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HubConfig } from "../src/config.js";
import { PageGenerator, type PageGenerationProvider } from "../src/page-generator/service.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

function manifest(): SkillManifest {
  return {
    id: "opencode--example", provider: "opencode", name: "example", displayName: "Example", description: "Example skill.", sourcePath: "private", sourceHash: "source-hash",
    inputs: [
      { id: "title", label: "Title", kind: "text", required: true, confidence: "high" },
      { id: "mode", label: "Mode", kind: "select", required: false, options: [{ label: "Draft", value: "draft" }], confidence: "high" },
    ],
    outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "missing", enabled: true, lastScannedAt: "2026-07-24T00:00:00.000Z",
  };
}

async function createContext(overrides: Pick<HubConfig, "pageGenerationTimeoutMs" | "pageGenerationWorkspaceRoot"> = {}): Promise<{ config: HubConfig; database: HubDatabase }> {
  directory = await mkdtemp(path.join(tmpdir(), "skill-page-generator-"));
  const prompts = path.join(directory, "prompts");
  await mkdir(prompts, { recursive: true });
  await Promise.all([
    writeFile(path.join(prompts, "skill-page-base.md"), "{{manifest_json}}\n{{preset_instructions}}\n{{runtime_contract}}\n{{source_hash}}"),
    writeFile(path.join(prompts, "form-first.md"), "form-first"),
    writeFile(path.join(prompts, "workflow-console.md"), "workflow-console"),
    writeFile(path.join(prompts, "artifact-workbench.md"), "artifact-workbench"),
  ]);
  const config: HubConfig = {
    projectRoot: directory, host: "127.0.0.1", port: 0, databasePath: path.join(directory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", pageGenerationWorkspaceRoot: path.join(directory, "temporary-page-workspaces"),
    opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: directory, configDirectory: path.join(directory, "opencode-config"), dataDirectory: path.join(directory, "opencode-data"), lockFilePath: path.join(directory, "lock"), logFilePath: path.join(directory, "log"), startTimeoutMs: 1000, skillRoots: [], includeApiSkills: true },
    ...overrides,
  };
  return { config, database: new HubDatabase(config.databasePath) };
}

function provider(): PageGenerationProvider {
  return {
    getHealthSnapshot: () => ({ status: "healthy" }),
    startRun: async ({ directory: workspace, onEvent }) => {
      const output = path.join(workspace, "output");
      await mkdir(output, { recursive: true });
      await Promise.all([
        writeFile(path.join(output, "index.html"), `<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><form data-skill-form><input name="title" data-skill-input><select name="mode" data-skill-input><option value="draft">Draft</option></select><button type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script></body></html>`),
        writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
        writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "source-hash", inputIds: ["title", "mode"], runtime: "shared" })),
      ]);
      onEvent({ type: "session.idle" });
      let close!: () => void;
      return { sessionId: "ses_page", done: new Promise<void>((resolve) => { close = resolve; }), abort: async () => undefined, close };
    },
  };
}

describe("PageGenerator", () => {
  it("persists a validated page and reuses it when the Skill source is unchanged", async () => {
    const { config, database } = await createContext();
    const skill = manifest();
    database.upsertSkill(skill);
    const generator = new PageGenerator(config, database, provider());
    try {
      const queued = await generator.generate(skill);
      expect(queued.status).toBe("queued");
      await generator.waitForIdle();
      const page = generator.getActive(skill.id);
      expect(page).toMatchObject({ status: "ready", active: true, sourceHash: skill.sourceHash, preset: "form-first" });
      expect(page?.outputDirectory).toMatch(/^generated\/opencode--example\//);
      expect(await readFile(path.join(config.projectRoot, "frontend", page!.outputDirectory!, "index.html"), "utf8")).toContain("data-skill-form");
      expect(database.getSkill(skill.id)?.pageStatus).toBe("ready");
      const reused = await generator.generate(skill);
      expect(reused.id).toBe(page?.id);
      expect(generator.getStatus(skill.id)).toHaveLength(1);

      config.pagePromptVersion = "skill-page-contract-v2";
      expect(generator.markStalePromptVersions()).toBe(1);
      expect(database.getSkill(skill.id)?.pageStatus).toBe("stale");
      await generator.generate(skill);
      await generator.waitForIdle();
      const versions = generator.getStatus(skill.id);
      expect(versions).toHaveLength(2);
      expect(versions.some((candidate) => candidate.id === page?.id && candidate.status === "ready")).toBe(true);
      expect(generator.getActive(skill.id)).toMatchObject({ status: "ready", promptVersion: "skill-page-contract-v2" });
    } finally {
      database.close();
    }
  });

  it("uses and cleans an isolated temporary workspace before persisting page output", async () => {
    const { config, database } = await createContext();
    const skill = manifest();
    database.upsertSkill(skill);
    const workspaceRoot = config.pageGenerationWorkspaceRoot!;
    let workspace = "";
    const trackingProvider: PageGenerationProvider = {
      getHealthSnapshot: () => ({ status: "healthy" }),
      startRun: async ({ directory, onEvent }) => {
        workspace = directory;
        const output = path.join(directory, "output");
        await mkdir(output, { recursive: true });
        await Promise.all([
          writeFile(path.join(output, "index.html"), '<link rel="stylesheet" href="./styles.css"><form data-skill-form><input name="title"><select name="mode"></select><button type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script>'),
          writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
          writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "source-hash", inputIds: ["title", "mode"], runtime: "shared" })),
        ]);
        onEvent({ type: "session.idle" });
        return { sessionId: "ses_temp_workspace", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
    };
    const generator = new PageGenerator(config, database, trackingProvider);
    try {
      await generator.generate(skill);
      await generator.waitForIdle();
      expect(workspace.startsWith(workspaceRoot)).toBe(true);
      expect(workspace).not.toContain(path.join(config.projectRoot, "runtime", "page-generation"));
      await expect(access(workspace)).rejects.toThrow();
      expect(generator.getActive(skill.id)?.status).toBe("ready");
    } finally {
      database.close();
    }
  });

  it("rejects an invalid generated view script without activating it", async () => {
    const { config, database } = await createContext();
    const skill = manifest();
    database.upsertSkill(skill);
    const invalidProvider: PageGenerationProvider = {
      getHealthSnapshot: () => ({ status: "healthy" }),
      startRun: async ({ directory: workspace, onEvent }) => {
        const output = path.join(workspace, "output");
        await mkdir(output, { recursive: true });
        await Promise.all([
          writeFile(path.join(output, "index.html"), '<link rel="stylesheet" href="./styles.css"><form data-skill-form><input name="title"><select name="mode"></select><button type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script><script type="module" src="./view.js"></script>'),
          writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
          writeFile(path.join(output, "view.js"), "const = broken;"),
          writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "source-hash", inputIds: ["title", "mode"], runtime: "shared" })),
        ]);
        onEvent({ type: "session.idle" });
        return { sessionId: "ses_bad_page", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
    };
    const generator = new PageGenerator(config, database, invalidProvider);
    try {
      await generator.generate(skill);
      await generator.waitForIdle();
      expect(generator.getActive(skill.id)).toBeUndefined();
      expect(generator.getStatus(skill.id)).toEqual([expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("invalid JavaScript syntax") })]);
    } finally {
      database.close();
    }
  });

  it("rejects generated output that contains credential-like values", async () => {
    const { config, database } = await createContext();
    const skill = manifest();
    database.upsertSkill(skill);
    const unsafeProvider: PageGenerationProvider = {
      getHealthSnapshot: () => ({ status: "healthy" }),
      startRun: async ({ directory: workspace, onEvent }) => {
        const output = path.join(workspace, "output");
        await mkdir(output, { recursive: true });
        await Promise.all([
          writeFile(path.join(output, "index.html"), '<link rel="stylesheet" href="./styles.css"><form data-skill-form><input name="title"><select name="mode"></select><button type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script><script type="module" src="./view.js"></script>'),
          writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
          writeFile(path.join(output, "view.js"), 'const apiKey = "not-a-real-secret";'),
          writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "source-hash", inputIds: ["title", "mode"], runtime: "shared" })),
        ]);
        onEvent({ type: "session.idle" });
        return { sessionId: "ses_secret_page", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
    };
    const generator = new PageGenerator(config, database, unsafeProvider);
    try {
      await generator.generate(skill);
      await generator.waitForIdle();
      expect(generator.getStatus(skill.id)).toEqual([expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("credential-like") })]);
    } finally {
      database.close();
    }
  });

  it("rejects generated HTML that attempts inline event-handler injection", async () => {
    const { config, database } = await createContext();
    const skill = manifest();
    database.upsertSkill(skill);
    const unsafeProvider: PageGenerationProvider = {
      getHealthSnapshot: () => ({ status: "healthy" }),
      startRun: async ({ directory: workspace, onEvent }) => {
        const output = path.join(workspace, "output");
        await mkdir(output, { recursive: true });
        await Promise.all([
          writeFile(path.join(output, "index.html"), '<link rel="stylesheet" href="./styles.css"><form data-skill-form><button onclick="alert(1)" type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script>'),
          writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
          writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "source-hash", inputIds: ["title", "mode"], runtime: "shared" })),
        ]);
        onEvent({ type: "session.idle" });
        return { sessionId: "ses_xss_page", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
    };
    const generator = new PageGenerator(config, database, unsafeProvider);
    try {
      await generator.generate(skill);
      await generator.waitForIdle();
      expect(generator.getStatus(skill.id)).toEqual([expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("inline event handlers") })]);
      expect(generator.getActive(skill.id)).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("pauses automatic work after an upstream failure and resumes it only when explicitly requested", async () => {
    const { config, database } = await createContext();
    const first = manifest();
    const second = { ...manifest(), id: "opencode--second", name: "second", displayName: "Second" };
    database.upsertSkill(first);
    database.upsertSkill(second);
    let attempts = 0;
    const pausingProvider: PageGenerationProvider = {
      getHealthSnapshot: () => ({ status: "healthy" }),
      startRun: async ({ directory: workspace, onEvent }) => {
        attempts += 1;
        if (attempts === 1) {
          onEvent({ type: "session.error" });
          return { sessionId: "ses_failed_page", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
        }
        const output = path.join(workspace, "output");
        await mkdir(output, { recursive: true });
        await Promise.all([
          writeFile(path.join(output, "index.html"), `<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><form data-skill-form><input name="title" data-skill-input><select name="mode" data-skill-input><option value="draft">Draft</option></select><button type="submit">Run</button></form><div data-run-status></div><div data-run-events></div><div data-run-interaction></div><div data-run-artifacts></div><script type="module" src="/runtime/skill-runtime.js"></script></body></html>`),
          writeFile(path.join(output, "styles.css"), ".page { color: var(--hub-color-text-primary); }"),
          writeFile(path.join(output, "view.manifest.json"), JSON.stringify({ contractVersion: 1, preset: "form-first", sourceHash: "source-hash", inputIds: ["title", "mode"], runtime: "shared" })),
        ]);
        onEvent({ type: "session.idle" });
        return { sessionId: "ses_retried_page", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined };
      },
    };
    const generator = new PageGenerator(config, database, pausingProvider);
    try {
      await generator.generate(first, undefined, { resume: false });
      await generator.generate(second, undefined, { resume: false });
      await generator.waitForIdle();
      expect(attempts).toBe(1);
      expect(generator.getStatus(first.id)).toEqual([expect.objectContaining({ status: "failed" })]);
      expect(generator.getStatus(second.id)).toEqual([expect.objectContaining({ status: "queued" })]);

      await generator.generate(second);
      await generator.waitForIdle();
      expect(attempts).toBe(2);
      expect(generator.getActive(second.id)).toMatchObject({ status: "ready", active: true });
    } finally {
      database.close();
    }
  });

  it("preserves queued pages across restart recovery and only fails an in-flight generation", async () => {
    const { config, database } = await createContext();
    const queuedSkill = manifest();
    const runningSkill = { ...manifest(), id: "opencode--running", name: "running", displayName: "Running" };
    database.upsertSkill(queuedSkill);
    database.upsertSkill(runningSkill);
    const createdAt = new Date().toISOString();
    database.createGeneratedPage({
      id: "page-queued", skillId: queuedSkill.id, version: "queued-v1", preset: "form-first", sourceHash: queuedSkill.sourceHash,
      promptVersion: "skill-page-contract-v1", status: "queued", active: false, createdAt, updatedAt: createdAt,
    });
    database.createGeneratedPage({
      id: "page-running", skillId: runningSkill.id, version: "running-v1", preset: "form-first", sourceHash: runningSkill.sourceHash,
      promptVersion: "skill-page-contract-v1", status: "generating", active: false, createdAt, updatedAt: createdAt,
    });
    const afterRestart = new PageGenerator(config, database, provider());
    try {
      afterRestart.recoverInterrupted();
      expect(afterRestart.getStatus(queuedSkill.id)).toEqual([expect.objectContaining({ status: "queued" })]);
      expect(afterRestart.getStatus(runningSkill.id)).toEqual([expect.objectContaining({ status: "failed", errorMessage: "Page generation was interrupted by a Node restart." })]);

      afterRestart.resumeQueued();
      await afterRestart.waitForIdle();
      expect(afterRestart.getActive(queuedSkill.id)).toMatchObject({ status: "ready", active: true });
    } finally {
      database.close();
    }
  });

  it("fails and pauses the queue when OpenCode never completes a page-generation session", async () => {
    const { config, database } = await createContext({ pageGenerationTimeoutMs: 20 });
    const skill = manifest();
    database.upsertSkill(skill);
    const timedOutProvider: PageGenerationProvider = {
      getHealthSnapshot: () => ({ status: "healthy" }),
      startRun: async () => ({ sessionId: "ses_timeout", done: new Promise(() => undefined), abort: async () => undefined, close: () => undefined }),
    };
    const generator = new PageGenerator(config, database, timedOutProvider);
    try {
      await generator.generate(skill);
      await generator.waitForIdle();
      expect(generator.getStatus(skill.id)).toEqual([expect.objectContaining({ status: "failed", errorMessage: "Page generation timed out." })]);
    } finally {
      database.close();
    }
  });
});
