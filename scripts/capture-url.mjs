import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const url = process.env.CAPTURE_URL;
const output = process.env.OUTPUT_FILE;
if (!url || !output) throw new Error("CAPTURE_URL and OUTPUT_FILE are required.");
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true, args: ["--hide-scrollbars"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  if (process.env.CAPTURE_USER && process.env.CAPTURE_PASSWORD) {
    await page.fill("#adminLoginForm [name='username']", process.env.CAPTURE_USER);
    await page.fill("#adminLoginForm [name='password']", process.env.CAPTURE_PASSWORD);
    await page.click("#adminLoginForm button[type='submit']");
    if (process.env.CAPTURE_PATH) await page.waitForURL(`**${process.env.CAPTURE_PATH}`);
    await page.waitForLoadState("networkidle");
  }
  if (process.env.DEBUG_CAPTURE === "true") {
    console.log(await page.evaluate(() => {
      const shell = document.querySelector(".source-login-shell");
      const title = document.querySelector(".source-login-shell .auth-intro h1");
      const panel = document.querySelector(".source-login-shell .auth-panel");
      const titleStyle = title && getComputedStyle(title);
      const panelStyle = panel && getComputedStyle(panel);
      return { width: window.innerWidth, shell: shell?.className, titleStyle: titleStyle && { position: titleStyle.position, top: titleStyle.top, left: titleStyle.left, fontSize: titleStyle.fontSize }, titleRect: title?.getBoundingClientRect().toJSON(), panelRect: panel?.getBoundingClientRect().toJSON(), panelPosition: panelStyle?.position };
    }));
  }
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await page.screenshot({ path: output });
} finally { await browser.close(); }
