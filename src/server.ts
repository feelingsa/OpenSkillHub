import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig, type HubConfig } from "./config.js";
import { OpenCodeProvider } from "./providers/opencode/provider.js";
import { ArtifactService } from "./artifacts/service.js";
import { AdminAuthService } from "./auth/service.js";
import { PageGenerator } from "./page-generator/service.js";
import { registerApiRoutes } from "./routes/api.js";
import { RunService } from "./runs/service.js";
import { SkillScanner } from "./skills/scanner.js";
import { HubDatabase } from "./storage/database.js";
import { StorageMaintenanceService } from "./storage/maintenance.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(moduleDirectory, "..");

export async function buildServer(config: HubConfig = loadConfig(defaultProjectRoot)): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });
  const database = new HubDatabase(config.databasePath);
  const provider = new OpenCodeProvider(config.opencode, app.log);
  const scanner = new SkillScanner(config, provider, database);
  const artifacts = new ArtifactService(config, database);
  const runs = new RunService(config, database, provider, artifacts);
  const pages = new PageGenerator(config, database, provider);
  const storage = new StorageMaintenanceService(config, database, provider);
  const auth = new AdminAuthService(config, database);
  let scheduledSync: NodeJS.Timeout | undefined;

  const syncSkillsAndQueuePages = async () => {
    await scanner.sync();
    pages.markStalePromptVersions();
    if (provider.getHealthSnapshot().status !== "healthy") return;
    pages.resumeQueued();
    for (const skill of database.listSkills()) {
      if (skill.enabled && (skill.pageStatus === "missing" || skill.pageStatus === "stale")) {
        await pages.generate(skill, undefined, { resume: false });
      }
    }
  };

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
  });
  app.setErrorHandler((error, request, reply) => {
    const appError = error as { statusCode?: number; message?: string };
    const statusCode = typeof appError.statusCode === "number" ? appError.statusCode : 500;
    request.log.error(error);
    reply.code(statusCode < 500 ? statusCode : 500).send({
      error: "INTERNAL_ERROR",
      requestId: request.id,
      message: statusCode < 500 ? appError.message : "The server could not complete this request.",
    });
  });

  await app.register(fastifyStatic, {
    root: path.join(config.projectRoot, "frontend"),
    wildcard: false,
    decorateReply: true,
  });
  await app.register(fastifyStatic, {
    root: path.join(config.projectRoot, "node_modules", "gsap"),
    prefix: "/vendor/gsap/",
    wildcard: false,
    decorateReply: false,
  });
  await registerApiRoutes(app, { config, database, provider, scanner, runs, artifacts, pages, auth, storage });

  for (const route of ["/login", "/runs", "/skills/:skillId", "/runs/:runId", "/admin", "/admin/*"]) {
    app.get(route, async (_request, reply) => reply.sendFile("index.html"));
  }

  app.addHook("onReady", async () => {
    pages.recoverInterrupted();
    void provider.start()
      .then(syncSkillsAndQueuePages)
      .catch((error) => app.log.warn({ error }, "Initial Skill scan or page generation queue failed"));
    scheduledSync = setInterval(() => {
      void syncSkillsAndQueuePages().catch((error) => app.log.warn({ error }, "Scheduled Skill scan or page generation queue failed"));
    }, config.skillSyncIntervalMs);
  });
  app.addHook("onClose", async () => {
    if (scheduledSync) clearInterval(scheduledSync);
    await provider.stop();
    database.close();
  });
  return app;
}

async function main(): Promise<void> {
  const config = loadConfig(defaultProjectRoot);
  const app = await buildServer(config);
  await app.listen({ host: config.host, port: config.port });
  const close = async () => {
    await app.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
