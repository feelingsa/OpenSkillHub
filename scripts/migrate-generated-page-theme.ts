import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyGeneratedTheme } from "../src/page-generator/service.js";

async function findStyleSheets(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findStyleSheets(entryPath);
    return entry.isFile() && entry.name === "styles.css" ? [entryPath] : [];
  }));
  return files.flat();
}

const generatedRoot = path.resolve("frontend", "generated");
const styleSheets = await findStyleSheets(generatedRoot);
let migrated = 0;

for (const styleSheet of styleSheets) {
  const original = await readFile(styleSheet, "utf8");
  const themed = applyGeneratedTheme(original);
  if (themed === original) continue;
  await writeFile(styleSheet, themed, "utf8");
  migrated += 1;
}

console.log(`Generated page theme migration complete: ${migrated} updated, ${styleSheets.length - migrated} already current.`);
