import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HubConfig } from "../config.js";
import type { OpenCodeProvider } from "../providers/opencode/provider.js";
import { ArtifactService, canPreviewArtifact } from "../artifacts/service.js";
import { PageGenerator } from "../page-generator/service.js";
import { AdminAuthService, AuthenticationError } from "../auth/service.js";
import type { SkillScanner } from "../skills/scanner.js";
import type { HubDatabase } from "../storage/database.js";
import { RunService, RunQuotaError, RunValidationError } from "../runs/service.js";
import { StorageMaintenanceService } from "../storage/maintenance.js";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { FixedWindowRateLimiter } from "../security/rate-limiter.js";
import { UploadService } from "../uploads/service.js";
import type { ArtifactRecord, AuthenticatedUser, GeneratedPagePreset, GeneratedPageRecord, PublicSkillManifest, RunRecord, SkillManifest } from "../types.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser?: AuthenticatedUser;
    adminSession?: AuthenticatedUser;
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

function toAdminRun(run: RunRecord) {
  return { ...toPublicRun(run), ownerId: run.ownerId };
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

function redactDiagnosticLog(value: string): string {
  return value
    .replace(/\b(api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*\S+/gi, (_match, key: string) => `${key}=[redacted]`)
    .replace(/https?:\/\/[^\s)]+/gi, "[url]")
    .replace(/[a-zA-Z]:\\[^\s)]+/g, "[local-path]");
}

function canAccessRun(run: RunRecord, user: AuthenticatedUser | undefined): boolean {
  return !user || user.role === "administrator" || run.ownerId === user.id;
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
    storage?: StorageMaintenanceService;
    uploads?: UploadService;
  },
): Promise<void> {
  const { config, database, provider, scanner, runs, artifacts, pages } = options;
  const auth = options.auth ?? new AdminAuthService(config, database);
  const storage = options.storage ?? new StorageMaintenanceService(config, database, provider);
  const uploads = options.uploads ?? new UploadService(config, database);
  const isHighRiskSkill = (skillId: string) => config.highRiskSkillIds?.includes(skillId) === true;
  const toUserManifest = (manifest: SkillManifest) => ({ ...toPublicManifest(manifest), highRisk: isHighRiskSkill(manifest.id) });
  const rateLimiter = new FixedWindowRateLimiter();

  const requireAuthenticated = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = auth.getSession(request);
    if (!session && config.authRequired === true) return reply.code(401).send({ error: "AUTHENTICATION_REQUIRED" });
    request.authenticatedUser = session;
  };

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = auth.getSession(request);
    if (!session) return reply.code(401).send({ error: "ADMIN_AUTH_REQUIRED" });
    if (session.role !== "administrator") return reply.code(403).send({ error: "ADMIN_PERMISSION_REQUIRED" });
    request.authenticatedUser = session;
    request.adminSession = session;
  };
  const requireAdministrator = async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.authRequired !== true) return;
    return requireAdmin(request, reply);
  };

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/") && config.requestsPerMinute !== undefined) {
      const session = auth.getSession(request);
      const limit = request.url.startsWith("/api/auth/login") ? (config.loginAttemptsPerMinute ?? config.requestsPerMinute) : config.requestsPerMinute;
      const key = `${request.ip}:${session?.id ?? "anonymous"}:${request.url.startsWith("/api/auth/login") ? "login" : "api"}`;
      if (!rateLimiter.consume(key, limit)) return reply.code(429).send({ error: "RATE_LIMITED", message: "Too many requests. Try again later." });
      if (session) request.authenticatedUser = session;
    }
    if (config.authRequired !== true || ["GET", "HEAD", "OPTIONS"].includes(request.method) || request.url.startsWith("/api/auth/login")) return;
    const session = auth.getSession(request);
    if (!session) return;
    if (!auth.hasValidCsrfToken(request, session)) return reply.code(403).send({ error: "CSRF_VALIDATION_FAILED" });
    request.authenticatedUser = session;
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>("/api/auth/login", async (request, reply) => {
    const session = auth.login(request.body?.username, request.body?.password);
    if (!session) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    auth.setSessionCookie(reply, session.token, session.user.expiresAt);
    return { authenticated: true, username: session.user.username, role: session.user.role, expiresAt: session.user.expiresAt, csrfToken: session.user.csrfToken };
  });
  app.get("/api/auth/session", async (request) => {
    const session = auth.getSession(request);
    return session ? { authenticated: true, username: session.username, role: session.role, expiresAt: session.expiresAt, csrfToken: session.csrfToken } : { authenticated: false };
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
  app.post("/api/providers/opencode/test", { preHandler: requireAdministrator }, async () => provider.checkHealth());

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
  app.get("/api/admin/network", { preHandler: requireAdmin }, async () => {
    const interfaces = networkInterfaces();
    const addresses = Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => ({ name, address: entry.address, cidr: entry.cidr ?? null })));
    const host = config.host === "0.0.0.0" || config.host === "::" ? "all LAN adapters" : config.host;
    return {
      host,
      port: config.port,
      authRequired: config.authRequired === true,
      cookieSecure: config.cookieSecure === true,
      urls: addresses.map(({ address }) => `http://${address}:${config.port}`),
      addresses,
      opencodeUrl: `${config.opencode.url.protocol}//${config.opencode.url.host}`,
      opencodeLoopbackOnly: ["127.0.0.1", "localhost", "::1"].includes(config.opencode.url.hostname),
    };
  });
  app.get("/api/admin/load", { preHandler: requireAdmin }, async () => {
    const users = database.listUsers();
    const runsList = database.listAllRuns(500);
    const activeStatuses = new Set(["created", "running", "waiting_question", "waiting_permission"]);
    const active = runsList.filter((run) => activeStatuses.has(run.status));
    const userById = new Map(users.map((user) => [user.id, user]));
    const byUser = [...new Map(active.map((run) => [run.ownerId, active.filter((item) => item.ownerId === run.ownerId)])).entries()]
      .map(([ownerId, ownerRuns]) => ({
        ownerId,
        username: userById.get(ownerId)?.username ?? "unknown user",
        activeRuns: ownerRuns.length,
        waiting: ownerRuns.filter((run) => run.status === "waiting_question" || run.status === "waiting_permission").length,
        latestRunAt: ownerRuns.map((run) => run.createdAt).sort().at(-1) ?? null,
      }))
      .sort((left, right) => right.activeRuns - left.activeRuns || left.username.localeCompare(right.username));
    return {
      capturedAt: new Date().toISOString(),
      activeRuns: active.length,
      waitingRuns: active.filter((run) => run.status === "waiting_question" || run.status === "waiting_permission").length,
      enabledUsers: users.filter((user) => !user.disabled).length,
      recentRuns: runsList.filter((run) => Date.now() - Date.parse(run.createdAt) < 60 * 60 * 1000).length,
      byUser,
    };
  });
  app.get("/api/admin/providers", { preHandler: requireAdmin }, async () => [{ ...provider.getHealthSnapshot(), ...provider.getRuntimeInfo(), mode: config.opencode.mode }]);
  app.post("/api/admin/providers/opencode/test", { preHandler: requireAdmin }, async () => provider.checkHealth());
  app.get("/api/admin/providers/opencode/logs", { preHandler: requireAdmin }, async () => {
    try {
      const source = await readFile(config.opencode.logFilePath, "utf8");
      return { lines: source.split(/\r?\n/).filter(Boolean).slice(-100).map(redactDiagnosticLog) };
    } catch {
      return { lines: [] };
    }
  });
  app.get("/api/admin/skills", { preHandler: requireAdmin }, async () => database.listSkills().map(toPublicManifest));
  app.post("/api/admin/skills/scan", { preHandler: requireAdmin }, async (request) => {
    const outcome = await scanner.sync();
    database.appendAuditEvent({ userId: request.adminSession!.id, type: "skill.scan_requested", details: { total: outcome.total } });
    return outcome;
  });
  app.post<{ Params: { skillId: string }; Body: { enabled?: unknown } }>("/api/admin/skills/:skillId/enabled", { preHandler: requireAdmin }, async (request, reply) => {
    if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ error: "INVALID_ENABLED_VALUE" });
    const skill = database.setSkillEnabled(request.params.skillId, request.body.enabled);
    if (skill) database.appendAuditEvent({ userId: request.adminSession!.id, type: "skill.enabled_changed", resourceId: skill.id, details: { enabled: skill.enabled } });
    return skill ? toPublicManifest(skill) : reply.code(404).send({ error: "SKILL_NOT_FOUND" });
  });
  app.post<{ Params: { skillId: string }; Body: { preset?: unknown; force?: unknown } }>("/api/admin/skills/:skillId/page/generate", { preHandler: requireAdmin }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const preset = request.body?.preset;
    if (preset !== undefined && preset !== "form-first" && preset !== "workflow-console" && preset !== "artifact-workbench") return reply.code(400).send({ error: "INVALID_PAGE_PRESET" });
    if (request.body?.force !== undefined && typeof request.body.force !== "boolean") return reply.code(400).send({ error: "INVALID_PAGE_GENERATION_FORCE" });
    const page = await pages.generate(skill, preset as GeneratedPagePreset | undefined, { force: request.body?.force === true });
    database.appendAuditEvent({ userId: request.adminSession!.id, type: "page.generation_requested", resourceId: skill.id, details: { preset: page.preset, force: request.body?.force === true } });
    return reply.code(page.status === "ready" ? 200 : 202).send(toPublicGeneratedPage(page));
  });
  app.get("/api/admin/pages", { preHandler: requireAdmin }, async () => database.listAllGeneratedPages().map((page) => ({ skillId: page.skillId, ...toPublicGeneratedPage(page) })));
  app.get<{ Params: { skillId: string; version: string } }>("/api/admin/pages/:skillId/:version/logs", { preHandler: requireAdmin }, async (request, reply) => {
    const page = database.listGeneratedPages(request.params.skillId).find((candidate) => candidate.version === request.params.version);
    return page ? database.listGeneratedPageEvents(page.id) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });
  app.post<{ Params: { skillId: string; version: string } }>("/api/admin/pages/:skillId/activate/:version", { preHandler: requireAdmin }, async (request, reply) => {
    const page = pages.activate(request.params.skillId, request.params.version);
    if (page) database.appendAuditEvent({ userId: request.adminSession!.id, type: "page.activated", resourceId: page.id, details: { skillId: page.skillId, version: page.version } });
    return page ? toPublicGeneratedPage(page) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });
  app.get("/api/admin/runs", { preHandler: requireAdmin }, async () => database.listAllRuns().map(toAdminRun));
  app.get("/api/admin/audit", { preHandler: requireAdmin }, async () => database.listAuditEvents());
  app.post<{ Params: { runId: string } }>("/api/admin/runs/:runId/abort", { preHandler: requireAdmin }, async (request, reply) => {
    const run = await runs.abort(request.params.runId, "Run aborted by an administrator.");
    if (run) database.appendAuditEvent({ userId: request.adminSession!.id, type: "run.aborted_by_admin", resourceId: run.id });
    return run ? toPublicRun(run) : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });
  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => database.listUsers());
  app.post<{ Body: { username?: unknown; password?: unknown; role?: unknown } }>("/api/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const user = auth.createUser(request.body?.username, request.body?.password, request.body?.role);
      database.appendAuditEvent({ userId: request.adminSession!.id, type: "user.created", resourceId: user.id, details: { role: user.role } });
      return reply.code(201).send(user);
    } catch (error) {
      if (error instanceof AuthenticationError) return reply.code(400).send({ error: "INVALID_USER", message: error.message });
      throw error;
    }
  });
  app.patch<{ Params: { userId: string }; Body: { role?: unknown; disabled?: unknown; password?: unknown } }>("/api/admin/users/:userId", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const existing = database.getUser(request.params.userId);
      if (!existing) return reply.code(404).send({ error: "USER_NOT_FOUND" });
      const nextRole = request.body?.role === undefined ? existing.role : request.body.role;
      const nextDisabled = request.body?.disabled === undefined ? existing.disabled : request.body.disabled;
      const removesLastAdministrator = existing.role === "administrator" && !existing.disabled
        && (nextRole !== "administrator" || nextDisabled === true)
        && database.countEnabledAdministrators() <= 1;
      if (removesLastAdministrator) return reply.code(409).send({ error: "LAST_ADMINISTRATOR_REQUIRED" });
      const user = auth.updateUser(request.params.userId, request.body ?? {});
      if (user) {
        if (request.body?.password !== undefined || request.body?.disabled === true) database.deleteUserSessionsByUserId(user.id);
        database.appendAuditEvent({ userId: request.adminSession!.id, type: "user.updated", resourceId: user.id, details: { role: user.role, disabled: user.disabled } });
      }
      return user!;
    } catch (error) {
      if (error instanceof AuthenticationError) return reply.code(400).send({ error: "INVALID_USER", message: error.message });
      throw error;
    }
  });
  app.get("/api/admin/storage", { preHandler: requireAdmin }, async () => ({ ...database.getAdminStorageSummary(), retentionDays: config.artifactRetentionDays ?? 30 }));
  app.get<{ Querystring: { retentionDays?: string } }>("/api/admin/storage/cleanup/preview", { preHandler: requireAdmin }, async (request, reply) => {
    const requested = request.query.retentionDays === undefined ? undefined : Number(request.query.retentionDays);
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > 3650)) return reply.code(400).send({ error: "INVALID_RETENTION_DAYS" });
    return storage.previewCleanup(requested);
  });
  app.post<{ Body: { retentionDays?: unknown; confirm?: unknown } }>("/api/admin/storage/cleanup", { preHandler: requireAdmin }, async (request, reply) => {
    const requested = request.body?.retentionDays === undefined ? undefined : request.body.retentionDays;
    if (requested !== undefined && (!Number.isInteger(requested) || (requested as number) < 1 || (requested as number) > 3650)) return reply.code(400).send({ error: "INVALID_RETENTION_DAYS" });
    if (request.body?.confirm !== true) return reply.code(409).send({ error: "CLEANUP_CONFIRMATION_REQUIRED" });
    const outcome = await storage.cleanup(requested as number | undefined);
    database.appendAuditEvent({ userId: request.adminSession!.id, type: "storage.cleanup", details: { retentionDays: requested ?? config.artifactRetentionDays ?? 30, deletedRuns: outcome.deletedRuns } });
    return outcome;
  });
  app.get("/api/admin/diagnostics", { preHandler: requireAdmin }, async (_request, reply) => {
    reply.type("application/json; charset=utf-8").header("Content-Disposition", "attachment; filename=skill-web-hub-diagnostics.json");
    return storage.diagnostics();
  });
  app.get("/api/admin/storage/backups", { preHandler: requireAdmin }, async () => storage.listBackups());
  app.post("/api/admin/storage/backups", { preHandler: requireAdmin }, async (request, reply) => {
    const backup = await storage.createBackup();
    database.appendAuditEvent({ userId: request.adminSession!.id, type: "storage.backup_created", resourceId: backup.id });
    return reply.code(201).send(backup);
  });
  app.get<{ Params: { backupId: string } }>("/api/admin/storage/backups/:backupId/download", { preHandler: requireAdmin }, async (request, reply) => {
    const backup = await storage.openBackup(request.params.backupId);
    if (!backup) return reply.code(404).send({ error: "BACKUP_NOT_FOUND" });
    reply.type("application/vnd.sqlite3").header("Content-Disposition", `attachment; filename="${request.params.backupId}.db"`);
    return reply.send(createReadStream(backup));
  });

  app.post("/api/skills/sync", { preHandler: requireAdministrator }, async () => scanner.sync());
  app.get("/api/skills", { preHandler: requireAuthenticated }, async () => database.listSkills().filter((skill) => skill.enabled).map(toUserManifest));
  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId", { preHandler: requireAuthenticated }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    return toUserManifest(skill);
  });
  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId/source-summary", { preHandler: requireAuthenticated }, async (request, reply) => {
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

  app.post<{ Params: { skillId: string }; Body: { preset?: unknown; force?: unknown } }>("/api/skills/:skillId/page/generate", { preHandler: requireAdministrator }, async (request, reply) => {
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

  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId/page/status", { preHandler: requireAuthenticated }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    return pages.getStatus(skill.id).map(toPublicGeneratedPage);
  });

  app.get<{ Params: { skillId: string; version: string } }>("/api/skills/:skillId/page/:version/logs", { preHandler: requireAuthenticated }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const page = pages.getStatus(skill.id).find((candidate) => candidate.version === request.params.version);
    return page ? database.listGeneratedPageEvents(page.id) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });

  app.post<{ Params: { skillId: string; version: string } }>("/api/skills/:skillId/page/activate/:version", { preHandler: requireAdministrator }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const page = pages.activate(skill.id, request.params.version);
    return page ? toPublicGeneratedPage(page) : reply.code(404).send({ error: "PAGE_VERSION_NOT_FOUND" });
  });

  app.get<{ Params: { skillId: string } }>("/api/skills/:skillId/page", { preHandler: requireAuthenticated }, async (request, reply) => {
    const skill = database.getSkill(request.params.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    const page = pages.getActive(skill.id);
    return page ? { ...toPublicGeneratedPage(page), isCurrentPrompt: page.promptVersion === config.pagePromptVersion } : { status: skill.pageStatus, isCurrentPrompt: false };
  });

  app.post<{ Body: { skillId?: unknown; inputs?: unknown; confirmHighRisk?: unknown } }>("/api/runs", { preHandler: requireAuthenticated }, async (request, reply) => {
    const body = request.body;
    if (!body || typeof body.skillId !== "string") return reply.code(400).send({ error: "INVALID_RUN_REQUEST", message: "skillId is required" });
    const skill = database.getSkill(body.skillId);
    if (!skill || !skill.enabled) return reply.code(404).send({ error: "SKILL_NOT_FOUND" });
    if (isHighRiskSkill(skill.id) && body.confirmHighRisk !== true) return reply.code(409).send({ error: "HIGH_RISK_CONFIRMATION_REQUIRED", message: "This Skill requires confirmation before each run." });
    try {
      const run = await runs.start(skill, body.inputs ?? {}, request.authenticatedUser?.id);
      if (request.authenticatedUser) database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "run.started", resourceId: run.id, details: { skillId: skill.id, highRisk: isHighRiskSkill(skill.id) } });
      return reply.code(201).send(toPublicRun(run));
    } catch (error) {
      if (error instanceof RunValidationError) return reply.code(400).send({ error: "INVALID_RUN_INPUT", message: error.message });
      if (error instanceof RunQuotaError) return reply.code(429).send({ error: "RUN_QUOTA_EXCEEDED", message: error.message });
      throw error;
    }
  });

  app.post<{ Body: Buffer }>("/api/uploads", { preHandler: requireAuthenticated }, async (request, reply) => {
    if (!request.authenticatedUser) return reply.code(401).send({ error: "AUTHENTICATION_REQUIRED" });
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "INVALID_UPLOAD_BODY" });
    try {
      const upload = await uploads.create(request.authenticatedUser.id, request.body, request.headers["x-upload-name"], request.headers["x-upload-mime"] ?? request.headers["content-type"]);
      database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "upload.created", resourceId: upload.id, details: { sizeBytes: upload.sizeBytes } });
      return reply.code(201).send({ id: upload.id, displayName: upload.displayName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, createdAt: upload.createdAt });
    } catch (error) {
      return reply.code(400).send({ error: "UPLOAD_REJECTED", message: error instanceof Error ? error.message : "The upload was rejected." });
    }
  });

  app.get("/api/runs", { preHandler: requireAuthenticated }, async (request) => runs.list(request.authenticatedUser?.id).map(toPublicRun));

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", { preHandler: requireAuthenticated }, async (request, reply) => {
    const run = runs.get(request.params.runId);
    return run && canAccessRun(run, request.authenticatedUser) ? toPublicRun(run) : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/events/history", { preHandler: requireAuthenticated }, async (request, reply) => {
    const run = runs.get(request.params.runId);
    return run && canAccessRun(run, request.authenticatedUser) ? runs.listEvents(run.id) : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/events", { preHandler: requireAuthenticated }, async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run || !canAccessRun(run, request.authenticatedUser)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
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

  app.post<{ Params: { runId: string } }>("/api/runs/:runId/abort", { preHandler: requireAuthenticated }, async (request, reply) => {
    const existing = runs.get(request.params.runId);
    if (!existing || !canAccessRun(existing, request.authenticatedUser)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    const run = await runs.abort(request.params.runId);
    if (run && request.authenticatedUser) database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "run.aborted", resourceId: run.id });
    return run ? run : reply.code(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/artifacts", { preHandler: requireAuthenticated }, async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run || !canAccessRun(run, request.authenticatedUser)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    return artifacts.list(request.params.runId).map(toPublicArtifact);
  });

  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/metadata", { preHandler: requireAuthenticated }, async (request, reply) => {
    const artifact = artifacts.get(request.params.artifactId);
    const run = artifact ? runs.get(artifact.runId) : undefined;
    return artifact && run && canAccessRun(run, request.authenticatedUser) ? toPublicArtifact(artifact) : reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
  });

  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/preview", { preHandler: requireAuthenticated }, async (request, reply) => {
    const metadata = artifacts.get(request.params.artifactId);
    const run = metadata ? runs.get(metadata.runId) : undefined;
    if (!metadata || !run || !canAccessRun(run, request.authenticatedUser)) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    const opened = await artifacts.open(request.params.artifactId);
    if (!opened) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    if (!canPreviewArtifact(opened.artifact)) return reply.code(415).send({ error: "ARTIFACT_PREVIEW_UNSUPPORTED" });
    if (request.authenticatedUser) database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "artifact.previewed", resourceId: opened.artifact.id });
    reply
      .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
      .header("Content-Disposition", `inline; filename="${opened.artifact.displayName.replaceAll('"', "")}"`)
      .type(opened.artifact.mimeType);
    return reply.send(artifacts.createReadStream(opened.filePath));
  });

  app.get<{ Params: { artifactId: string } }>("/api/artifacts/:artifactId/download", { preHandler: requireAuthenticated }, async (request, reply) => {
    const metadata = artifacts.get(request.params.artifactId);
    const run = metadata ? runs.get(metadata.runId) : undefined;
    if (!metadata || !run || !canAccessRun(run, request.authenticatedUser)) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    const opened = await artifacts.open(request.params.artifactId);
    if (!opened) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
    if (request.authenticatedUser) database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "artifact.downloaded", resourceId: opened.artifact.id });
    reply
      .header("Content-Disposition", `attachment; filename="${opened.artifact.displayName.replaceAll('"', "")}"`)
      .type(opened.artifact.mimeType);
    return reply.send(artifacts.createReadStream(opened.filePath));
  });

  app.post<{ Params: { runId: string; questionId: string }; Body: { answers?: unknown } }>("/api/runs/:runId/questions/:questionId/reply", { preHandler: requireAuthenticated }, async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run || !canAccessRun(run, request.authenticatedUser)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if (!Array.isArray(request.body?.answers) || !request.body.answers.every((answer) => Array.isArray(answer) && answer.every((value) => typeof value === "string"))) {
      return reply.code(400).send({ error: "INVALID_QUESTION_ANSWER" });
    }
    try {
      const run = await runs.answerQuestion(request.params.runId, request.params.questionId, request.body.answers as string[][]);
      if (run && request.authenticatedUser) database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "run.question_answered", resourceId: run.id });
      return run ?? reply.code(404).send({ error: "RUN_NOT_FOUND" });
    } catch (error) {
      if (error instanceof RunValidationError) return reply.code(409).send({ error: "QUESTION_NOT_PENDING" });
      throw error;
    }
  });

  app.post<{ Params: { runId: string; permissionId: string }; Body: { reply?: unknown } }>("/api/runs/:runId/permissions/:permissionId/reply", { preHandler: requireAuthenticated }, async (request, reply) => {
    const run = runs.get(request.params.runId);
    if (!run || !canAccessRun(run, request.authenticatedUser)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    if (request.body?.reply === "always" && request.authenticatedUser?.role !== "administrator") return reply.code(403).send({ error: "PERSISTENT_PERMISSION_REQUIRES_ADMIN" });
    if (request.body?.reply !== "once" && request.body?.reply !== "reject") return reply.code(400).send({ error: "INVALID_PERMISSION_REPLY" });
    try {
      const run = await runs.answerPermission(request.params.runId, request.params.permissionId, request.body.reply);
      if (run && request.authenticatedUser) database.appendAuditEvent({ userId: request.authenticatedUser.id, type: "run.permission_answered", resourceId: run.id, details: { reply: request.body.reply } });
      return run ?? reply.code(404).send({ error: "RUN_NOT_FOUND" });
    } catch (error) {
      if (error instanceof RunValidationError) return reply.code(409).send({ error: "PERMISSION_NOT_PENDING" });
      throw error;
    }
  });
}
