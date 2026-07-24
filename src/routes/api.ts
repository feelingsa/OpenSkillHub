import type { FastifyInstance } from "fastify";
import type { HubConfig } from "../config.js";
import type { OpenCodeProvider } from "../providers/opencode/provider.js";
import type { SkillScanner } from "../skills/scanner.js";
import type { HubDatabase } from "../storage/database.js";
import type { PublicSkillManifest, SkillManifest } from "../types.js";

function toPublicManifest(manifest: SkillManifest): PublicSkillManifest {
  const { sourcePath: _sourcePath, ...publicManifest } = manifest;
  return publicManifest;
}

export async function registerApiRoutes(
  app: FastifyInstance,
  options: {
    config: HubConfig;
    database: HubDatabase;
    provider: OpenCodeProvider;
    scanner: SkillScanner;
  },
): Promise<void> {
  const { config, database, provider, scanner } = options;

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
}
