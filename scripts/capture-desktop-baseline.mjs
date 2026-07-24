import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const viewport = { width: 1440, height: 900 };
const url = process.env.HUB_VISUAL_URL ?? "http://127.0.0.1:5180/";
const outputPath = path.resolve(process.env.HUB_VISUAL_OUTPUT ?? "docs/baselines/home-current-desktop-1440x900.png");
const reportPath = outputPath.replace(/\.png$/i, ".json");
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
      // Keep checking known local Edge installation paths.
    }
  }
  throw new Error("Microsoft Edge was not found. Set up a local Edge installation before running capture:desktop.");
}

const browser = await chromium.launch({
  executablePath: await findEdgeExecutable(),
  headless: true,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage({ viewport });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") {
    const location = message.location();
    errors.push(`${message.text()}${location.url ? ` (${location.url})` : ""}`);
  }
});

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".hub-shell");
  await page.waitForSelector("#skillDeck [data-card].is-focus");
  const metrics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    cardCount: document.querySelectorAll("#skillDeck [data-card]").length,
    focusCardCount: document.querySelectorAll("#skillDeck .is-focus").length,
  }));
  if (metrics.viewport.width !== viewport.width || metrics.viewport.height !== viewport.height) {
    throw new Error(`Unexpected viewport: ${metrics.viewport.width} x ${metrics.viewport.height}`);
  }
  if (metrics.documentWidth > viewport.width) {
    throw new Error(`Desktop page has horizontal overflow: ${metrics.documentWidth}px > ${viewport.width}px`);
  }
  if (metrics.focusCardCount !== 1) {
    throw new Error(`Expected exactly one focused Skill card, received ${metrics.focusCardCount}.`);
  }
  if (errors.length > 0) throw new Error(`Browser reported errors: ${errors.join(" | ")}`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: false });
  await writeFile(reportPath, `${JSON.stringify({ url, capturedAt: new Date().toISOString(), ...metrics }, null, 2)}\n`, "utf8");
  console.log(`Captured desktop baseline: ${outputPath}`);
} finally {
  await browser.close();
}
