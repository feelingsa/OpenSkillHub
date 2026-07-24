import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const frontendRoot = path.resolve("frontend");
const generatedFixtureRoot = path.resolve("tests/fixtures/generated-page");
const viewport = { width: 1440, height: 900 };
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function findEdgeExecutable() {
  for (const candidate of edgeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known local Edge installation.
    }
  }
  throw new Error("Microsoft Edge was not found.");
}

function contentType(filename) {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".css")) return "text/css; charset=utf-8";
  if (filename.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  const root = pathname.startsWith("/generated/browser-validation/") ? generatedFixtureRoot : frontendRoot;
  const relativePath = pathname.startsWith("/generated/browser-validation/")
    ? pathname.slice("/generated/browser-validation/".length)
    : pathname.slice(1);
  const candidate = path.resolve(root, `.${path.sep}${decodeURIComponent(relativePath)}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(candidate);
    response.writeHead(200, { "Content-Type": contentType(candidate), "Cache-Control": "no-store" }).end(content);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Browser validation server did not start.");
const browser = await chromium.launch({ executablePath: await findEdgeExecutable(), headless: true, args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

try {
  await page.goto(`http://127.0.0.1:${address.port}/generated/browser-validation/index.html?skillId=opencode--browser-validation`, { waitUntil: "networkidle" });
  for (const selector of ["[data-skill-form]", "[data-run-status]", "[data-run-events]", "[data-run-interaction]", "[data-run-artifacts]"]) {
    await page.waitForSelector(selector);
  }
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    runtimeLoaded: [...document.scripts].some((script) => script.src.endsWith("/runtime/skill-runtime.js")),
  }));
  if (metrics.width !== viewport.width || metrics.height !== viewport.height) throw new Error(`Unexpected viewport: ${metrics.width} x ${metrics.height}`);
  if (metrics.scrollWidth > viewport.width) throw new Error(`Generated page has horizontal overflow: ${metrics.scrollWidth}px > ${viewport.width}px`);
  if (!metrics.runtimeLoaded) throw new Error("Generated page did not load the shared runtime.");
  if (errors.length > 0) throw new Error(`Generated page reported browser errors: ${errors.join(" | ")}`);
  console.log("Generated page browser validation passed.");
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
