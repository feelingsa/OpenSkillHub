import { describe, expect, it } from "vitest";
import { createManifest, parseSkillDocument } from "../src/skills/manifest.js";

describe("Skill manifest parsing", () => {
  const markdown = `---
name: document-tool
description: Generate a document.
---
# Document Tool

## 输入
- \`sourceFile\`: required file upload
- \`title\`: required document title; options: draft|final; default: draft

## 输出
- \`report\`: Generated PDF

## 流程
- \`validate\`: Validate the source file
- \`render\`: Create the final report
`;

  it("extracts declared inputs, outputs and workflow", () => {
    const parsed = parseSkillDocument(markdown);
    expect(parsed.name).toBe("document-tool");
    expect(parsed.inputs).toHaveLength(2);
    expect(parsed.inputs[0]).toMatchObject({ id: "sourcefile", kind: "file", required: true });
    expect(parsed.inputs[1]).toMatchObject({ kind: "select", defaultValue: "draft", options: [{ label: "draft", value: "draft" }, { label: "final", value: "final" }] });
    expect(parsed.outputs[0]).toMatchObject({ id: "report" });
    expect(parsed.workflow).toHaveLength(2);
  });

  it("uses a low-confidence task input only when no parameters are declared", () => {
    const manifest = createManifest({
      name: "plain-skill",
      sourcePath: "C:/private/skill/SKILL.md",
      sourceHash: "abc",
      markdown: "# Plain skill\n\nNo structured parameters.",
      lastScannedAt: "2026-07-24T00:00:00.000Z",
    });
    expect(manifest.inputs).toEqual([
      expect.objectContaining({ id: "taskText", confidence: "low", required: true }),
    ]);
    expect(manifest.id).toBe("opencode--plain-skill");
  });
});
