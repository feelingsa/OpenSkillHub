import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HubConfig } from "../config.js";
import type { OpenCodeProvider } from "../providers/opencode/provider.js";
import { ArtifactService, canPreviewArtifact } from "../artifacts/service.js";
import { PageGenerator } from "../page-generator/service.js";
import { AdminAuthService } from "../auth/service.js";
import type { SkillScanner } from "../skills/scanner.js";
import type { HubDatabase } from "../storage/database.js";
import { RunService, RunValidationError } from "../runs/service.js";
import type { ArtifactRecord, GeneratedPagePreset, GeneratedPageRecord, PublicSkillManifest, RunRecord, SkillManifest } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    adminSession?: { username: string; expiresAt: string };
  }
}

function toPublicManifest(manifest: SkillManifest): PublicSkillManifest {
  const { sourcePath: _sourcePath, ...publicManifest } = manifest;
  return publicManifest;
}

function toPublicRun(run: RunRecord) {
  const { ownerId: _ownerId, workspaceId: _workspaceId, sessionId: _sessionId, ...publicRun } = run;
  return publicRun;
}

function toPublicArtifact(artifact: ArtifactRecord) {
  const { ownerId: _ownerId, relativePath: _relativePath, ...publicArtifact } = artifact;
  return publicArtifact;
}

function toPublicGeneratedPage(page: GeneratedPageRecord) {
  return {
    id: page.id,
    version: page.version,
    preset: page.preset,
    sourceHash: page.sourceHash,
    promptVersion: page.promptVersion,
    status: page.status,
    active: page.active,
    errorMessage: page.errorMessage,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    activatedAt: page.activatedAt,
    ...(page.status === "ready" && page.outputDirectory ? { url: `/${page.outputDirectory}/index.html` } : {}),
  };
}

export async function registerApiRoutes(
  app: FastifyInstance,
  options: {
    config: HubConfig;
    database: HubDatabase;
    provider: OpenCodeProvider;
    scanner: SkillScanner;
    runs: RunService;
    artifacts: ArtifactService;
    pages: PageGenerator;
    auth?: AdminAuthService;
  },
): Promise<void> {
  const { config, database, provider, scanner, runs, artifacts, pages } = options;
  const auth = options.auth ?? new AdminAuthService(config, database);

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = auth.getSession(request);
    if (!session) return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    request.adminSession = session;
  };

  app.post<{ Body: { username?: unknown; password?: unknown } }>("/api/auth/login", async (request, reply) => {
    const session = auth.login(request.body?.username, request.body?.password);
    if (!session) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    auth.setSessionCookie(reply, session.token, session.expiresAt);
    return { authenticated: true, username: session.username, expiresAt: session.expiresAt };
  });
  app.get("/api/auth/session", async (request) => {
    const session = auth.getSession(request);
    return session ? { authenticated: true, ...session } : { authenticated: false };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    auth.logout(request, reply);
    return { authenticated: false };
  });

  app.get("/api/health", async () => ({
    status: "healthy",
    service: "skill-web-hub",
    time: new Date().toISOString(),
    opencode: provider.getHealthSnapshot(),
  }));

  app.get("/api/config/status", async () => ({
    provider: "opencode",
    mode: config.opencode.mode,
    skillRootCount: config.opencode.skillRoots.length,
    managedByNode: config.opencode.mode === "managed",
    opencode: provider.getHealthSnapshot(),
  }));

  app.get("/api/providers", async () => [{ ...provider.getHealthSnapshot(), ...provider.getRuntimeInfo() }]);
  app.post("/api/providers/opencode/test", async () => provider.checkHealth());

  app.get("/api/admin/overview", { preHandler: requireAdmin }, async () => {
    const skills = database.listSkills();
    const runsList = database.listAllRuns(200);
    const pagesList = database.listAllGeneratedPages(500);
    return {
      provider: provider.getHealthSnapshot(),
      runtime: { node: process.version, service: "skill-web-hub", scannerIntervalMs: config.skillSyncIntervalMs },
      storage: database.getAdminStorageSummary(),
      skills: { total: skills.length, enabled: skills.filter((skill) => skill.enabled).length },
      pages: { queued: pagesList.filter((page) => page.status === "queued").length, generating: pagesList.filter((page) => page.status === "generating").length, failed: pagesList.filter((page) => page.status === "failed").length },
      runs: { active: runsList.filter((run) => ["created", "running", "waiting_question", "waiting_permission"].includes(run.status)).length, total: runsList.length },
    };
  });
  app.get("/api/admin/providers", { preHandler: requireAdmin }, async () => [{ ...provider.getHealthSnapshot(), ...provider.getRuntimeInfo() }]);
  app.post("/api/admin/providers/opencode/test", { preHandler: requireAdmin }, async () => provider.checkHealth());
  app.get("/api/admin/skills", { preHandler: requireAdmin }, async () => database.listSkills().map(toPublicManifest));
  app.post("/api/admin/skills/scan", { preHandler: requireAdmin }, async () => scanner.sync());
  app.post<{ Params: { skillId: string }; Body: { enabled?: unknown } }>("/api/admin/skills/:skillId/enabled", { preHandler: requireAdmin }, async (request, reply) => {
    if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ error: "INVALID_ENABLED_VALUE" });
    const skill = database.setSkillEnabled(request.params.skillId, request.body.enabled);
    return skill ? toPublicManifest(skill) : reply.code(404).send({ error: "SKILL_NOT_FOUND" });
  });
  app.post<{ Params: { skillId: string }; Body: { preset?: unknown; force?: unknown } }>("/api/admin/skills/:skillId/page/generate", { preHandler: requireAdmin }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const preset = request.body?.preset;
    if (preset !== undefined && preset !== "form-first" && preset !== "workflow-console" && preset !== "artifact-workbench") return reply.code(400).send({ error: "INVALID_PAGE_PRESET" });
    if (request.body?.force !== undefined && typeof request.body.force !== "boolean") return reply.code(400).send({ error: "INVALID_PAGE_GENERATION_FORCE" });
    const page = await pages.generate(skill, preset as GeneratedPagePreset | undefined, { force: request.body?.force === true });
    return reply.code(page.status === "ready" ? 200 : 202).send(toPublicGeneratedPage(page));
  });
  app.get("/api/admin/pages", { preHandler: requireAdmin }, async () => database.listAllGeneratedPages().map((page) => ({ skillId: page.skillId, ...toPublicGeneratedPage(page) })));
  app.post<{ Params: { skillId: string; version: string } }>("/api/admin/pages/:skillId/activate/:version", { preHandler: requireAdmin }, async (request, reply) => {
    const page = pages.activate(request.params.skillId, request.params.version);
    return page ? toPublicGeneratedPage(page) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });
  app.get("/api/admin/runs", { preHandler: requireAdmin }, async () => database.listAllRuns().map(toPublicRun));
  app.post<{ Params: { runId: string } }>("/api/admin/runs/:runId/abort", { preHandler: requireAdmin }, async (request, reply) => {
    const run = await runs.abort(request.params.runId, "Run aborted by an administrator.");
    return run ? toPublicRun(run) : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });
  app.get("/api/admin/users", { preHandler: requireAdmin }, async (request) => ({
    bootstrapAdministrator: { username: request.adminSession!.username, role: "administrator", source: "environment" },
    multiUserManagement: "planned-for-m6",
  }));
  app.get("/api/admin/storage", { preHandler: requireAdmin }, async () => database.getAdminStorageSummary());

  app.post("/api/skills/sync", async () => scanner.sync());
  app.get("/api/skills", async () => database.listSkills().filter((skill) => skill.enabled).map(toPublicManifest));
  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    return toPublicManifest(skill);
  });
  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId/source-summary", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    return {
      skillId: skill.id,
      description: skill.description,
      inputs: skill.inputs,
      outputs: skill.outputs,
      workflow: skill.workflow,
      sourceHash: skill.sourceHash,
    };
  });

  app.post<{ Params: { skillId: string }; Body: { preset?: unknown; force?: unknown } }>("/api/skills/:skillId/page/generate", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const preset = request.body?.preset;
    if (preset !== undefined && preset !== "form-first" && preset !== "workflow-console" && preset !== "artifact-workbench") {
      return reply.code(400).send({ error: "INVALID_PAGE_PRESET" });
    }
    if (request.body?.force !== undefined && typeof request.body.force !== "boolean") {
      return reply.code(400).send({ error: "INVALID_PAGE_GENERATION_FORCE" });
    }
    const page = await pages.generate(skill, preset as GeneratedPagePreset | undefined, { force: request.body?.force === true });
    return reply.code(page.status === "ready" ? 200 : 202).send(toPublicGeneratedPage(page));
  });

  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId/page/status", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    return pages.getStatus(skill.id).map(toPublicGeneratedPage);
  });

  app.get<{ Params: { skillId: string; version: string } }>("/api/skills/:skillId/page/:version/logs", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const page = pages.getStatus(skill.id).find((candidate) => candidate.version === request.params.version);
    return page ? database.listGeneratedPageEvents(page.id) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });

  app.post<{ Params: { skillId: string; version: string } }>("/api/skills/:skillId/page/activate/:version", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const page = pages.activate(skill.id, request.params.version);
    return page ? toPublicGeneratedPage(page) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });

  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId/page", async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const page = pages.getActive(skill.id);
    return page ? toPublicGeneratedPage(page) : { status: skill.pageStatus };
  });

  app.post<{ Body: { skillId?: unknown; inputs?: unknown } }>("/api/runs", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body.skillId !== "string") return reply.code(400).send({ error: "INVALID_RUN_REQUEST", message: "skillId is required" });
    const skill = database.getSkill(body.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    try {
      const run = await runs.start(skill, body.inputs ?? {});
      return reply.code(201).send(toPublicRun(run));
    } catch (error) {
      if (error instanceof RunValidationError) return reply.code(400).send({ error: "INVALID_RUN_INPUT", message: error.message });
      throw error;
    }
  });

  app.get("/api/runs", async () => runs.list().map(toPublicRun));

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", async (request, reply) => {
    const run = runs.get(request.params.runId);
    return run ? toPublicRun(run) : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/events/history", async (request, reply) => {
    const run = runs.get(request.params.runId);
    return run ? runs.listEvents(run.id) : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/events", async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const fromHeader = request.headers["last-event-id"];
    const afterSequence = typeof fromHeader === "string" && /^\d+$/.test(fromHeader) ? Number(fromHeader) : 0;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: ReturnType<RunService["listEvents"]>[number]) => {
      reply.raw.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    for (const event of runs.listEvents(run.id, afterSequence)) write(event);
    const unsubscribe = runs.onEvent(run.id, write);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15000);
    request.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });

  app.post<{ Params: { runId: string } }>("/api/runs/:runId/abort", async (request, reply) => {
    const run = await runs.abort(request.params.runId);
    return run ? run : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/artifacts", async (request, reply) => {
    if (!runs.get(request.params.runId)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    return artifacts.list(request.params.runId).map(toPublicArtifact);
  });

  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/metadata", async (request, reply) => {
    const artifact = artifacts.get(request.params.artifactId);
    return artifact ? toPublicArtifact(artifact) : reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
  });

  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/preview", async (request, reply) => {
    const opened = await artifacts.open(request.params.artifactId);
    if (!opened) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    if (!canPreviewArtifact(opened.artifact)) return reply.code(415).send({ error: "ARTIFACT_PREVIEW_UNSUPPORTED" });
    reply
      .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
      .header("Content-Disposition", `inline; filename="${opened.artifact.displayName.replaceAll('"', "")}"`)
      .type(opened.artifact.mimeType);
    return reply.send(artifacts.createReadStream(opened.filePath));
  });

  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/download", async (request, reply) => {
    const opened = await artifacts.open(request.params.artifactId);
    if (!opened) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    reply
      .header("Content-Disposition", `attachment; filename="${opened.artifact.displayName.replaceAll('"', "")}"`)
      .type(opened.artifact.mimeType);
    return reply.send(artifacts.createReadStream(opened.filePath));
  });

  app.post<{ Params: { runId: string; questionId: string }; Body: { answers?: unknown } }>("/api/runs/:runId/questions/:questionId/reply", async (request, reply) => {
    if (!runs.get(request.params.runId)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if (!Array.isArray(request.body?.answers) || !request.body.answers.every((answer) => Array.isArray(answer) && answer.every((value) => typeof value === "string"))) {
      return reply.code(400).send({ error: "INVALID_QUESTION_ANSWER" });
    }
    try {
      const run = await runs.answerQuestion(request.params.runId, request.params.questionId, request.body.answers as string[][]);
      return run ?? reply.code(404).send({ error: "RUN_NOT_FOUND" });
    } catch (error) {
      if (error instanceof RunValidationError) return reply.code(409).send({ error: "QUESTION_NOT_PENDING" });
      throw error;
    }
  });

  app.post<{ Params: { runId: string; permissionId: string }; Body: { reply?: unknown } }>("/api/runs/:runId/permissions/:permissionId/reply", async (request, reply) => {
    if (!runs.get(request.params.runId)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if (request.body?.reply === "always") return reply.code(403).send({ error: "PERSISTENT_PERMISSION_REQUIRES_ADMIN" });
    if (request.body?.reply !== "once" && request.body?.reply !== "reject") return reply.code(400).send({ error: "INVALID_PERMISSION_REPLY" });
    try {
      const run = await runs.answerPermission(request.params.runId, request.params.permissionId, request.body.reply);
      return run ?? reply.code(404).send({ error: "RUN_NOT_FOUND" });
    } catch (error) {
      if (error instanceof RunValidationError) return reply.code(409).send({ error: "PERMISSION_NOT_PENDING" });
      throw error;
    }
  });
}
