import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const sourceDirectory = path.resolve("source");
const expectedFiles = [
  "Skill Web Hub — 用户端.svg",
  "Skill Web Hub — 管理端.svg",
  "Skill Web Hub — 配色.svg",
];

function getSvgDimensions(svg) {
  const match = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"[^>]*>/i);
  if (!match) return null;

  return { width: Number(match[1]), height: Number(match[2]) };
}

function getColors(svg) {
  return [...new Set(svg.match(/#[0-9a-f]{6}\b/gi) ?? [])]
    .map((color) => color.toUpperCase())
    .sort();
}

const discoveredFiles = new Set(await readdir(sourceDirectory));
let failed = false;

for (const filename of expectedFiles) {
  if (!discoveredFiles.has(filename)) {
    console.error(`Missing design source: ${filename}`);
    failed = true;
    continue;
  }

  const svg = await readFile(path.join(sourceDirectory, filename), "utf8");
  const dimensions = getSvgDimensions(svg);
  const colors = getColors(svg);
  if (!dimensions || colors.length === 0) {
    console.error(`Unreadable or incomplete SVG: ${filename}`);
    failed = true;
    continue;
  }

  console.log(`${filename}: ${dimensions.width}x${dimensions.height}; ${colors.length} colors`);
}

if (failed) process.exitCode = 1;
