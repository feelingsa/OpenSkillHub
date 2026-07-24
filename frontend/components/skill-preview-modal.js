import { compactDescription, escapeHtml, pageStateLabel } from "./skill-card.js";

export function renderSkillPreview(skill) {
  const inputs = skill.inputs?.length ?? 0;
  const outputs = skill.outputs?.length ?? 0;
  return `<p>${escapeHtml(compactDescription(skill.description))}</p><dl class="modal-manifest"><div><dt>提供方</dt><dd>${escapeHtml(skill.provider)}</dd></div><div><dt>页面状态</dt><dd>${escapeHtml(pageStateLabel(skill.pageStatus))}</dd></div><div><dt>输入字段</dt><dd>${inputs}</dd></div><div><dt>声明输出</dt><dd>${outputs}</dd></div></dl>`;
}
