import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  HUB_HOST: z.string().default("0.0.0.0"),
  HUB_PORT: z.coerce.number().int().min(1).max(65535).default(5177),
  HUB_DATA_PATH: z.string().default("./data/hub.db"),
  HUB_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  OPENCODE_MODE: z.enum(["connect", "managed"]).default("connect"),
  OPENCODE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_COMMAND: z.string().min(1).default("opencode"),
  OPENCODE_ARGS_JSON: z.string().default('["--hostname","127.0.0.1","--port","4096","serve"]'),
  OPENCODE_WORKING_DIRECTORY: z.string().default("."),
  OPENCODE_START_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  OPENCODE_SKILL_ROOTS_JSON: z.string().optional(),
  OPENCODE_API_SKILL_DISCOVERY: z.enum(["true", "false"]).default("true"),
  OPENCODE_MODEL_PROVIDER: z.string().min(1).optional(),
  OPENCODE_MODEL_ID: z.string().min(1).optional(),
  OPENCODE_MODEL_VARIANT: z.string().min(1).optional(),
  SKILL_SYNC_INTERVAL_MS: z.coerce.number().int().min(10000).max(86400000).default(300000),
  HUB_RUN_TIMEOUT_MS: z.coerce.number().int().min(10000).max(86400000).default(900000),
  HUB_PAGE_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900000).default(120000),
  HUB_PAGE_GENERATION_TEMP_ROOT: z.string().min(1).default(path.join(tmpdir(), "skill-web-hub-page-generation")),
  HUB_PAGE_PROMPT_VERSION: z.string().min(1).default("skill-page-contract-v1"),
  HUB_ADMIN_USERNAME: z.string().min(1).max(80).default("admin"),
  // This value deliberately works only for a local first boot. Replace it before LAN use.
  HUB_ADMIN_PASSWORD: z.string().min(12).default("change-me-before-lan-use"),
  HUB_SESSION_TTL_MS: z.coerce.number().int().min(60000).max(2592000000).default(86400000),
  HUB_ARTIFACT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
});

function parseStringArray(value: string, field: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("must be a JSON string array");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${field}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function defaultSkillRoots(): string[] {
  const home = homedir();
  return [path.join(home, ".config", "opencode", "skills"), path.join(home, ".agents", "skills")]
    .filter((candidate) => existsSync(candidate));
}

export interface HubConfig {
  projectRoot: string;
  host: string;
  port: number;
  databasePath: string;
  skillSyncIntervalMs: number;
  runTimeoutMs: number;
  pageGenerationTimeoutMs?: number;
  pageGenerationWorkspaceRoot?: string;
  pagePromptVersion?: string;
  admin?: {
    username: string;
    password: string;
    sessionTtlMs: number;
  };
  artifactRetentionDays?: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  opencode: {
    mode: "connect" | "managed";
    url: URL;
    command: string;
    args: string[];
    workingDirectory: string;
    configDirectory: string;
    dataDirectory: string;
    lockFilePath: string;
    logFilePath: string;
    startTimeoutMs: number;
    skillRoots: string[];
    includeApiSkills?: boolean;
    model?: { providerID: string; id: string; variant?: string };
  };
}

export function loadConfig(projectRoot: string): HubConfig {
  const envPath = path.join(projectRoot, ".env");
  if (existsSync(envPath)) {
    // Process environment is the deployment override; .env only supplies local defaults.
    const explicitEnvironment = { ...process.env };
    process.loadEnvFile(envPath);
    Object.assign(process.env, explicitEnvironment);
  }

  const env = envSchema.parse(process.env);
  const requestedRoots = env.OPENCODE_SKILL_ROOTS_JSON
    ? parseStringArray(env.OPENCODE_SKILL_ROOTS_JSON, "OPENCODE_SKILL_ROOTS_JSON")
    : defaultSkillRoots();
  const skillRoots = requestedRoots.map((root) => path.resolve(projectRoot, root));
  if (Boolean(env.OPENCODE_MODEL_PROVIDER) !== Boolean(env.OPENCODE_MODEL_ID)) {
    throw new Error("OPENCODE_MODEL_PROVIDER and OPENCODE_MODEL_ID must be set together");
  }

  return {
    projectRoot,
    host: env.HUB_HOST,
    port: env.HUB_PORT,
    databasePath: path.resolve(projectRoot, env.HUB_DATA_PATH),
    skillSyncIntervalMs: env.SKILL_SYNC_INTERVAL_MS,
    runTimeoutMs: env.HUB_RUN_TIMEOUT_MS,
    pageGenerationTimeoutMs: env.HUB_PAGE_GENERATION_TIMEOUT_MS,
    pageGenerationWorkspaceRoot: path.resolve(env.HUB_PAGE_GENERATION_TEMP_ROOT),
    pagePromptVersion: env.HUB_PAGE_PROMPT_VERSION,
    admin: {
      username: env.HUB_ADMIN_USERNAME,
      password: env.HUB_ADMIN_PASSWORD,
      sessionTtlMs: env.HUB_SESSION_TTL_MS,
    },
    artifactRetentionDays: env.HUB_ARTIFACT_RETENTION_DAYS,
    logLevel: env.HUB_LOG_LEVEL,
    opencode: {
      mode: env.OPENCODE_MODE,
      url: new URL(env.OPENCODE_URL),
      command: env.OPENCODE_COMMAND,
      args: parseStringArray(env.OPENCODE_ARGS_JSON, "OPENCODE_ARGS_JSON"),
      workingDirectory: path.resolve(projectRoot, env.OPENCODE_WORKING_DIRECTORY),
      configDirectory: path.join(projectRoot, "runtime", "opencode-config"),
      dataDirectory: path.join(projectRoot, "runtime", "opencode-data"),
      lockFilePath: path.join(projectRoot, "runtime", "opencode.lock"),
      logFilePath: path.join(projectRoot, "runtime", "logs", "opencode.log"),
      startTimeoutMs: env.OPENCODE_START_TIMEOUT_MS,
      skillRoots,
      includeApiSkills: env.OPENCODE_API_SKILL_DISCOVERY === "true",
      model: env.OPENCODE_MODEL_PROVIDER && env.OPENCODE_MODEL_ID
        ? { providerID: env.OPENCODE_MODEL_PROVIDER, id: env.OPENCODE_MODEL_ID, ...(env.OPENCODE_MODEL_VARIANT ? { variant: env.OPENCODE_MODEL_VARIANT } : {}) }
        : undefined,
    },
  };
}
