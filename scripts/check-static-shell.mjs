import { access, readFile } from "node:fs/promises";
import path from "node:path";

const frontendRoot = path.resolve("frontend");
const index = await readFile(path.join(frontendRoot, "index.html"), "utf8");
for (const marker of ["skillDeck", "skillModal", "app.js", "styles.css"]) {
  if (!index.includes(marker)) throw new Error(`Static shell is missing ${marker}`);
}
await access(path.join(frontendRoot, "styles", "tokens.css"));
const app = await readFile(path.join(frontendRoot, "app.js"), "utf8");
if (!app.includes("./motion/index.js")) throw new Error("Static shell does not load the shared motion module");
console.log("Static shell baseline is present.");
