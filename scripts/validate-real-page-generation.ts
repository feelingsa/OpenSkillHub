import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HubConfig } from "../src/config.js";
import { PageGenerator } from "../src/page-generator/service.js";
import { OpenCodeProvider } from "../src/providers/opencode/provider.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

const root = await mkdtemp(path.join(tmpdir(), "skill-web-hub-real-page-"));
const endpoint = process.env.OPENCODE_URL ?? "http://127.0.0.1:4197";
const providerID = process.env.OPENCODE_MODEL_PROVIDER;
const modelID = process.env.OPENCODE_MODEL_ID;
const variant = process.env.OPENCODE_MODEL_VARIANT;
if (Boolean(providerID) !== Boolean(modelID)) {
  throw new Error("Set both OPENCODE_MODEL_PROVIDER and OPENCODE_MODEL_ID, or leave both unset to use OpenCode's default model.");
}
const config: HubConfig = {
  projectRoot: root,
  host: "127.0.0.1",
  port: 0,
  databasePath: path.join(root, "hub.db"),
  skillSyncIntervalMs: 60_000,
  runTimeoutMs: 60_000,
  pageGenerationTimeoutMs: 180_000,
  logLevel: "fatal",
  opencode: {
    mode: "connect",
    url: new URL(endpoint),
    command: "opencode",
    args: [],
    workingDirectory: root,
    configDirectory: path.join(root, "opencode-config"),
    dataDirectory: path.join(root, "opencode-data"),
    lockFilePath: path.join(root, "opencode.lock"),
    logFilePath: path.join(root, "opencode.log"),
    startTimeoutMs: 15_000,
    skillRoots: [],
    model: providerID && modelID ? { providerID, id: modelID, ...(variant ? { variant } : {}) } : undefined,
  },
};
const skill: SkillManifest = {
  id: "opencode--real-page-validation",
  provider: "opencode",
  name: "real-page-validation",
  displayName: "Real page validation",
  description: "Generate a concise operational page for a deterministic text transformation task.",
  sourcePath: "private",
  sourceHash: "real-page-validation-v1",
  inputs: [
    { id: "sourceText", label: "Source text", kind: "text", required: true, confidence: "high" },
    { id: "style", label: "Style", kind: "select", required: false, options: [{ label: "Plain", value: "plain" }, { label: "Structured", value: "structured" }], confidence: "high" },
  ],
  outputs: [],
  workflow: [],
  requirements: [],
  assets: [],
  pageStatus: "missing",
  enabled: true,
  lastScannedAt: new Date().toISOString(),
};

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const database = new HubDatabase(config.databasePath);
const provider = new OpenCodeProvider(config.opencode, logger);
try {
  await cp(path.resolve("prompts"), path.join(root, "prompts"), { recursive: true });
  await mkdir(path.join(root, "frontend", "generated"), { recursive: true });
  database.upsertSkill(skill);
  const health = await provider.start();
  if (health.status !== "healthy") throw new Error(`OpenCode is ${health.status}.`);
  const generator = new PageGenerator(config, database, provider);
  await generator.generate(skill);
  await generator.waitForIdle();
  const page = generator.getActive(skill.id);
  if (!page || page.status !== "ready" || !page.outputDirectory) {
    throw new Error(`Real page generation did not become ready: ${JSON.stringify(generator.getStatus(skill.id))}`);
  }
  const index = await readFile(path.join(root, "frontend", page.outputDirectory, "index.html"), "utf8");
  for (const marker of ["data-skill-form", "data-run-status", "data-run-events", "data-run-interaction", "data-run-artifacts"]) {
    if (!index.includes(marker)) throw new Error(`Generated page is missing ${marker}.`);
  }
  console.log(JSON.stringify({ status: page.status, version: page.version, outputDirectory: page.outputDirectory, sessionId: page.sessionId }, null, 2));
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
}
