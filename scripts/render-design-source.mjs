import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const source = process.env.SOURCE_FILE;
const output = process.env.OUTPUT_FILE;
if (!source || !output) throw new Error("SOURCE_FILE and OUTPUT_FILE are required.");

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--hide-scrollbars"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.resolve(source)).href, { waitUntil: "load" });
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await page.screenshot({ path: output });
} finally {
  await browser.close();
}
