import { access, readFile } from "node:fs/promises";
import path from "node:path";

const frontendRoot = path.resolve("frontend");
const index = await readFile(path.join(frontendRoot, "index.html"), "utf8");
for (const marker of ["skillDeck", "skillModal", "app.js", "styles.css"]) {
  if (!index.includes(marker)) throw new Error(`Static shell is missing ${marker}`);
}
await access(path.join(frontendRoot, "styles", "tokens.css"));
const runtime = await readFile(path.join(frontendRoot, "runtime", "skill-runtime.js"), "utf8");
if (runtime.includes("fetch(") || runtime.includes("EventSource(")) throw new Error("Generated Skill runtime bypasses the parent runtime bridge");
if (runtime.includes("/api/")) throw new Error("Generated Skill runtime bypasses the parent API bridge");
const app = await readFile(path.join(frontendRoot, "app.js"), "utf8");
if (!app.includes("./motion/index.js")) throw new Error("Static shell does not load the shared motion module");
for (const component of ["connection-state.js", "skill-card.js", "skill-deck.js", "skill-preview-modal.js"]) {
  if (!app.includes(`./components/${component}`)) throw new Error(`Static shell does not load ${component}`);
  await access(path.join(frontendRoot, "components", component));
}
if (!app.includes('requestJson("/api/skills")')) throw new Error("Static shell does not load the dynamic Skill catalog");
if (app.includes("gsap.set") || app.includes("gsap.to")) throw new Error("Static shell bypasses the shared motion module");
if (app.includes("const skillCards")) throw new Error("Static shell still contains a hard-coded Skill catalog");
if (app.includes("skill.markdown")) throw new Error("Static shell still reads arbitrary Skill Markdown paths");
if (!app.includes("downloadGeneratedArtifact")) throw new Error("Static shell does not bridge generated artifact downloads through the parent");
console.log("Static shell baseline is present.");
