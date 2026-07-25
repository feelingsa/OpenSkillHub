import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";
import { HubDatabase } from "../src/storage/database.js";
import type { SkillManifest } from "../src/types.js";

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const viewport = { width: 1440, height: 900 };

async function findEdgeExecutable(): Promise<string> {
  for (const candidate of edgeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the known local installation locations.
    }
  }
  throw new Error("Microsoft Edge was not found.");
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-browser-"));
const projectRoot = path.resolve(import.meta.dirname, "..");
let browserRunDirectory = "";
const config: HubConfig = {
  projectRoot, host: "127.0.0.1", port: 0, databasePath: path.join(temporaryDirectory, "hub.db"), skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal", authRequired: true,
  admin: { username: "browser-admin", password: "browser-admin-password", sessionTtlMs: 60000 },
  opencode: { mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: projectRoot, configDirectory: path.join(temporaryDirectory, "config"), dataDirectory: path.join(temporaryDirectory, "data"), lockFilePath: path.join(temporaryDirectory, "lock"), logFilePath: path.join(temporaryDirectory, "log"), startTimeoutMs: 1000, skillRoots: [] },
};
const manifest: SkillManifest = {
  id: "opencode--browser-e2e", provider: "opencode", name: "browser-e2e", displayName: "Browser E2E", description: "Browser interaction validation.", sourcePath: "private", sourceHash: "browser-e2e-hash",
  inputs: [
    { id: "taskText", label: "Task", kind: "text", required: true, confidence: "high" },
    { id: "attachment", label: "Attachment", kind: "file", required: true, confidence: "high" },
  ], outputs: [], workflow: [], requirements: [], assets: [], pageStatus: "missing", enabled: true, lastScannedAt: new Date().toISOString(),
};
const database = new HubDatabase(config.databasePath);
database.upsertSkill(manifest);
database.close();
const app = await buildServer(config);
const browser = await chromium.launch({ executablePath: await findEdgeExecutable(), headless: true, args: ["--hide-scrollbars"] });

try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Browser validation server did not expose a TCP address.");
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}/login`, { waitUntil: "networkidle" });
  await page.fill("#adminLoginForm [name='username']", "browser-admin");
  await page.fill("#adminLoginForm [name='password']", "browser-admin-password");
  await page.click("#adminLoginForm button[type='submit']");
  await page.waitForURL(`http://127.0.0.1:${address.port}/admin`);
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#skillDeck [data-card]");
  const catalogCardCount = await page.locator("#skillDeck [data-card]").count();
  await page.goto(`http://127.0.0.1:${address.port}/skills/${manifest.id}`, { waitUntil: "networkidle" });
  await page.fill("#skillRunForm [name='taskText']", "browser flow");
  await page.setInputFiles("#skillRunForm [name='attachment']", { name: "browser-input.txt", mimeType: "text/plain", buffer: Buffer.from("browser input") });
  await page.click("#skillRunForm button[type='submit']");
  await page.waitForFunction(() => document.querySelector("#runStatus")?.textContent === "FAILED");
  const runStatus = await page.locator("#runStatus").textContent();
  const runId = await page.locator("#runAbortButton").getAttribute("data-run-id");
  if (!runId) throw new Error("Run panel did not expose a run ID.");
  const runDatabase = new HubDatabase(config.databasePath);
  const storedRun = runDatabase.getRun(runId);
  if (!storedRun) throw new Error("Browser-created run was not persisted.");
  if (typeof storedRun.inputValues.attachment !== "string" || storedRun.inputValues.attachment.length === 0) throw new Error("Browser file upload was not bound to the run.");
  const artifactBytes = Buffer.from("browser artifact");
  const artifactId = "browser-e2e-artifact";
  const artifactPath = path.join(projectRoot, "runtime", "runs", storedRun.workspaceId, "browser-result.txt");
  browserRunDirectory = path.dirname(artifactPath);
  await writeFile(artifactPath, artifactBytes);
  runDatabase.createArtifact({
    id: artifactId, runId, ownerId: storedRun.ownerId, relativePath: "browser-result.txt", displayName: "browser-result.txt", mimeType: "text/plain; charset=utf-8",
    sizeBytes: artifactBytes.length, sha256: createHash("sha256").update(artifactBytes).digest("hex"), createdAt: new Date().toISOString(),
  });
  runDatabase.close();
  await page.goto(`http://127.0.0.1:${address.port}/runs/${runId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".artifact-item");
  await page.locator(".artifact-preview summary").click();
  await page.waitForSelector(".artifact-preview iframe");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`a[href='/api/artifacts/${artifactId}/download']`).click(),
  ]);
  if (download.suggestedFilename() !== "browser-result.txt") throw new Error(`Unexpected artifact download filename: ${download.suggestedFilename()}`);
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (metrics.width !== viewport.width || metrics.height !== viewport.height) throw new Error(`Unexpected viewport: ${metrics.width} x ${metrics.height}`);
  if (metrics.scrollWidth > viewport.width) throw new Error(`Hub browser flow has horizontal overflow: ${metrics.scrollWidth}px > ${viewport.width}px`);
  if (catalogCardCount !== 1 || runStatus !== "FAILED") throw new Error(`Hub browser flow did not render the expected catalog and run state: ${JSON.stringify({ catalogCardCount, runStatus, ...metrics })}`);
  if (errors.length > 0) throw new Error(`Hub browser flow reported errors: ${errors.join(" | ")}`);
  console.log("Hub browser catalog, Skill route, form, and run-state validation passed.");
} finally {
  await browser.close();
  await app.close();
  if (browserRunDirectory) await rm(browserRunDirectory, { recursive: true, force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
