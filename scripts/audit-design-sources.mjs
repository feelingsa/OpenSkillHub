import { readFile } from "node:fs/promises";
import path from "node:path";

const sourceDirectory = path.resolve("source");
const expectedFiles = [
  "整体配色/Skill Web Hub — 配色.svg",
  "用户界面/U01 · 用户登录.svg",
  "用户界面/U02 · 发现 Skill.svg",
  "用户界面/U03 · Skill 详情与运行.svg",
  "用户界面/U04 · 运行状态.svg",
  "用户界面/U05 · 产物下载.svg",
  "管理员界面/A01 · 用户管理.svg",
  "管理员界面/A02 · 网络管理.svg",
  "管理员界面/A03 · Agent 连接.svg",
  "管理员界面/A04 · 实时用户运行负载.svg",
  "管理员界面/A05 · 技能库管理.svg",
];

function getSvgDimensions(svg) {
  const match = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"[^>]*>/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function getColors(svg) {
  return [...new Set(svg.match(/#[0-9a-f]{6}\b/gi) ?? [])]
    .map((color) => color.toUpperCase())
    .sort();
}

let failed = false;
for (const filename of expectedFiles) {
  let svg;
  try {
    svg = await readFile(path.join(sourceDirectory, filename), "utf8");
  } catch {
    console.error(`Missing design source: ${filename}`);
    failed = true;
    continue;
  }
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
