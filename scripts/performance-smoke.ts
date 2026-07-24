import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-performance-"));
const projectRoot = path.resolve(import.meta.dirname, "..");
const config: HubConfig = {
  projectRoot, host: "127.0.0.1", port: 0, databasePath: path.join(temporaryDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", authRequired: false,
  opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(temporaryDirectory, "config"), dataDirectory: path.join(temporaryDirectory, "data"), lockFilePath: path.join(temporaryDirectory, "lock"), logFilePath: path.join(temporaryDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
};
const database = new HubDatabase(config.databasePath);
for (let index = 0; index < 300; index += 1) {
  const manifest: SkillManifest = {
    id: `opencode--performance-${index}`, provider: "opencode", name: `performance-${index}`, displayName: `Performance ${index}`, description: "Synthetic catalog entry for the M7 performance smoke test.", sourcePath: "synthetic", sourceHash: String(index),
    inputs: [{ id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" }], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "ready", enabled: true, lastScannedAt: new Date().toISOString(),
  };
  database.upsertSkill(manifest);
}
database.close();

const app = await buildServer(config);
try {
  const startedAt = performance.now();
  const response = await app.inject({ method: "GET", url: "/api/skills" });
  const elapsedMs = performance.now() - startedAt;
  const skills = response.json() as Array<{ id: string }>;
  if (response.statusCode !== 200 || skills.length !== 300) throw new Error(`Catalog response was invalid: ${response.statusCode}, ${skills.length} skills.`);
  if (elapsedMs > 2000) throw new Error(`Catalog response exceeded the 2000 ms smoke threshold: ${elapsedMs.toFixed(1)} ms.`);
  console.log(JSON.stringify({ skills: skills.length, catalogRequestMs: Number(elapsedMs.toFixed(1)) }));
} finally {
  await app.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
