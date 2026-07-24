import { createHash } from "node:crypto";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillInput, SkillInputKind, SkillManifest, SkillOutput, SkillWorkflowStep } from "../types.js";

export interface ParsedSkillDocument {
  name?: string;
  description?: string;
  inputs: SkillInput[];
  outputs: SkillOutput[];
  workflow: SkillWorkflowStep[];
}

function section(markdown: string, heading: string): string {
  const expression = new RegExp(`^#{1,3}\\s+${heading}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s+|$(?![\\s\\S]))`, "im");
  return markdown.match(expression)?.[1]?.trim() ?? "";
}

function toId(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const id = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}

function inferKind(label: string, description: string): SkillInputKind {
  const text = `${label} ${description}`.toLowerCase();
  if (/upload|file|文件|附件/.test(text)) return "file";
  if (/url|网址|链接/.test(text)) return "url";
  if (/number|数量|数值|页数|数字/.test(text)) return "number";
  if (/true|false|boolean|是否|开关/.test(text)) return "boolean";
  if (/project|项目|目录|folder/.test(text)) return "project";
  if (/select|option|choice|选择|枚举/.test(text)) return "select";
  return "text";
}

function parseInputMetadata(description: string): Pick<SkillInput, "defaultValue" | "options"> {
  const defaultValue = description.match(/(?:default|默认)\s*[:：]\s*([^,，;；.。]+)/i)?.[1]?.trim();
  const optionBlock = description.match(/(?:options?|选项|可选)\s*[:：]\s*\[?([^\]\n;；]+)\]?/i)?.[1];
  const options = optionBlock
    ?.split(/[|,，/]/)
    .map((option) => option.trim())
    .filter(Boolean)
    .map((option) => ({ label: option, value: option }));
  return { ...(defaultValue ? { defaultValue } : {}), ...(options?.length ? { options } : {}) };
}

function parseBullets(markdown: string): Array<{ label: string; description: string; required: boolean }> {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(?:`([^`]+)`|\*\*([^*]+)\*\*|([^:：-]+))\s*[:：-]?\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const label = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      const description = match[4].trim();
      return { label, description, required: /required|必填|必须/i.test(`${label} ${description}`) };
    })
    .filter((item) => item.label.length > 0);
}

export function parseSkillDocument(markdown: string): ParsedSkillDocument {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch ? (parseYaml(frontmatterMatch[1]) as Record<string, unknown>) : {};
  const body = frontmatterMatch ? markdown.slice(frontmatterMatch[0].length) : markdown;
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = typeof frontmatter.name === "string" ? frontmatter.name : heading;
  const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;
  const inputItems = parseBullets(section(body, "(?:Inputs?|输入|参数)"));
  const inputs = inputItems.map((item, index) => ({
    id: toId(item.label, `input-${index + 1}`),
    label: item.label,
    kind: inferKind(item.label, item.description),
    required: item.required,
    ...(item.description ? { description: item.description } : {}),
    ...parseInputMetadata(item.description),
    confidence: "high" as const,
  }));
  const outputItems = parseBullets(section(body, "(?:Outputs?|输出|产物)"));
  const outputs = outputItems.map((item, index) => ({
    id: toId(item.label, `output-${index + 1}`),
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
  }));
  const workflowItems = parseBullets(section(body, "(?:Workflow|Steps?|流程|步骤)"));
  const workflow = workflowItems.map((item, index) => ({
    id: toId(item.label, `step-${index + 1}`),
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
  }));

  return { name, description, inputs, outputs, workflow };
}

export function makeSkillId(name: string, sourcePath: string): string {
  const fallback = createHash("sha256").update(sourcePath).digest("hex").slice(0, 10);
  return `opencode--${toId(name, `skill-${fallback}`)}`;
}

export function makeSourceHash(files: Array<{ path: string; content: Buffer }>): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(path.basename(file.path));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function createManifest(options: {
  name: string;
  description?: string;
  sourcePath: string;
  sourceHash: string;
  markdown: string;
  lastScannedAt: string;
}): SkillManifest {
  const parsed = parseSkillDocument(options.markdown);
  const inputs = parsed.inputs.length > 0
    ? parsed.inputs
    : [{ id: "taskText", label: "任务说明", kind: "text" as const, required: true, description: "未从 Skill 文档中解析到结构化参数。", confidence: "low" as const }];
  const name = parsed.name || options.name;
  return {
    id: makeSkillId(name, options.sourcePath),
    provider: "opencode",
    name,
    displayName: name,
    description: parsed.description || options.description || "此 Skill 尚未提供描述。",
    sourcePath: options.sourcePath,
    sourceHash: options.sourceHash,
    inputs,
    outputs: parsed.outputs,
    workflow: parsed.workflow,
    requirements: [],
    assets: [],
    pageStatus: "missing",
    enabled: true,
    lastScannedAt: options.lastScannedAt,
  };
}
