import { existsSync } from "node:fs";
import { homedir } from "node:os";
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
  OPENCODE_ARGS_JSON: z.string().default('["serve","--hostname","127.0.0.1","--port","4096"]'),
  OPENCODE_WORKING_DIRECTORY: z.string().default("."),
  OPENCODE_START_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  OPENCODE_SKILL_ROOTS_JSON: z.string().optional(),
  SKILL_SYNC_INTERVAL_MS: z.coerce.number().int().min(10000).max(86400000).default(300000),
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
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  opencode: {
    mode: "connect" | "managed";
    url: URL;
    command: string;
    args: string[];
    workingDirectory: string;
    lockFilePath: string;
    logFilePath: string;
    startTimeoutMs: number;
    skillRoots: string[];
  };
}

export function loadConfig(projectRoot: string): HubConfig {
  const envPath = path.join(projectRoot, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  const env = envSchema.parse(process.env);
  const requestedRoots = env.OPENCODE_SKILL_ROOTS_JSON
    ? parseStringArray(env.OPENCODE_SKILL_ROOTS_JSON, "OPENCODE_SKILL_ROOTS_JSON")
    : defaultSkillRoots();
  const skillRoots = requestedRoots.map((root) => path.resolve(projectRoot, root));

  return {
    projectRoot,
    host: env.HUB_HOST,
    port: env.HUB_PORT,
    databasePath: path.resolve(projectRoot, env.HUB_DATA_PATH),
    skillSyncIntervalMs: env.SKILL_SYNC_INTERVAL_MS,
    logLevel: env.HUB_LOG_LEVEL,
    opencode: {
      mode: env.OPENCODE_MODE,
      url: new URL(env.OPENCODE_URL),
      command: env.OPENCODE_COMMAND,
      args: parseStringArray(env.OPENCODE_ARGS_JSON, "OPENCODE_ARGS_JSON"),
      workingDirectory: path.resolve(projectRoot, env.OPENCODE_WORKING_DIRECTORY),
      lockFilePath: path.join(projectRoot, "runtime", "opencode.lock"),
      logFilePath: path.join(projectRoot, "runtime", "logs", "opencode.log"),
      startTimeoutMs: env.OPENCODE_START_TIMEOUT_MS,
      skillRoots,
    },
  };
}
