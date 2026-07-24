import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { buildServer } from "../dist/server.js";

const viewport = { width: 1440, height: 900 };
const projectRoot = process.cwd();
const outputPath = path.resolve(process.env.HUB_ADMIN_VISUAL_OUTPUT ?? "docs/baselines/admin-m5-desktop-1440x900.png");
const reportPath = outputPath.replace(/\.png$/i, ".json");
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function findEdgeExecutable() {
  for (const candidate of edgeCandidates) {
    try {
      await (await import("node:fs/promises")).access(candidate);
      return candidate;
    } catch { /* Continue checking known paths. */ }
  }
  throw new Error("Microsoft Edge was not found.");
}

const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-admin-visual-"));
const config = {
  projectRoot,
  host: "127.0.0.1",
  port: 0,
  databasePath: path.join(fixtureDirectory, "hub.db"),
  skillSyncIntervalMs: 86400000,
  runTimeoutMs: 60000,
  pageGenerationTimeoutMs: 1000,
  logLevel: "fatal",
  admin: { username: "visual-admin", password: "visual-only-admin-password", sessionTtlMs: 60000 },
  artifactRetentionDays: 30,
  opencode: {
    mode: "connect",
    url: new URL("http://127.0.0.1:1"),
    command: "opencode",
    args: [],
    workingDirectory: projectRoot,
    configDirectory: path.join(fixtureDirectory, "config"),
    dataDirectory: path.join(fixtureDirectory, "data"),
    lockFilePath: path.join(fixtureDirectory, "lock"),
    logFilePath: path.join(fixtureDirectory, "log"),
    startTimeoutMs: 1000,
    skillRoots: [],
  },
};
const app = await buildServer(config);
const browser = await chromium.launch({ executablePath: await findEdgeExecutable(), headless: true, args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await app.listen({ host: config.host, port: config.port });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Visual test server did not expose a TCP address.");
  const origin = `http://127.0.0.1:${address.port}`;
  await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
  await page.locator('input[name="username"]').fill(config.admin.username);
  await page.locator('input[name="password"]').fill(config.admin.password);
  await Promise.all([
    page.waitForURL(`${origin}/admin`),
    page.locator("#adminLoginForm button").click(),
  ]);
  await page.waitForSelector(".admin-workspace");
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    sidebarLinks: document.querySelectorAll(".admin-sidebar nav a").length,
    metrics: document.querySelectorAll(".admin-metrics article").length,
    route: window.location.pathname,
  }));
  if (metrics.viewport.width !== viewport.width || metrics.viewport.height !== viewport.height) throw new Error("Unexpected visual viewport.");
  if (metrics.documentWidth > viewport.width) throw new Error(`Desktop page has horizontal overflow: ${metrics.documentWidth}px.`);
  if (metrics.sidebarLinks !== 7 || metrics.metrics !== 4 || metrics.route !== "/admin") throw new Error("Admin shell controls were not rendered.");
  if (errors.length > 0) throw new Error(`Browser reported errors: ${errors.join(" | ")}`);
  if (process.env.HUB_ADMIN_VISUAL_SKIP_SCREENSHOT === "true") {
    console.log("Admin desktop shell verified without writing a screenshot.");
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: false });
    await writeFile(reportPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...metrics }, null, 2)}\n`, "utf8");
    console.log(`Captured admin desktop baseline: ${outputPath}`);
  }
} finally {
  await browser.close();
  await app.close();
  await rm(fixtureDirectory, { recursive: true, force: true });
}
