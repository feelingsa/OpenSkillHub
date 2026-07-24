const tones = [
  ["#8b5cff", "#27d7f5"], ["#32f5a6", "#27d7f5"], ["#ffb84d", "#ff5e70"],
  ["#27d7f5", "#8b5cff"], ["#ff5e70", "#ffb84d"], ["#32f5a6", "#8b5cff"],
];

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function compactDescription(description) {
  return String(description || "此 Skill 尚未提供描述。").replace(/\s+/g, " ").trim();
}

export function pageStateLabel(pageStatus) {
  return { ready: "PAGE READY", queued: "PAGE QUEUED", generating: "GENERATING", failed: "PAGE FAILED", stale: "PAGE STALE", missing: "PAGE MISSING" }[pageStatus] || "PAGE MISSING";
}

export function toneFor(skillId) {
  const hash = [...skillId].reduce((total, character) => total + character.codePointAt(0), 0);
  return tones[hash % tones.length];
}

function initials(value) {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SK";
}

export function renderSkillCard(skill, index, opencodeAvailable) {
  const [accent, secondary] = toneFor(skill.id);
  const runState = opencodeAvailable ? "RUN AVAILABLE" : "OPENCODE OFFLINE";
  return `
    <article class="skill-window" data-card="${index}" data-skill="${escapeHtml(skill.id)}" tabindex="-1" style="--card-accent:${accent}; --card-secondary:${secondary}">
      <header class="window-bar"><div class="window-controls" aria-label="window controls"><span class="control minimize" title="minimize"></span><span class="control collapse" title="collapse"></span><span class="control close" title="close"></span></div><div class="bar-title">${escapeHtml(skill.displayName)}</div><span class="window-tag tag-${skill.pageStatus === "ready" ? "green" : "violet"}">${escapeHtml(pageStateLabel(skill.pageStatus))}</span></header>
      <section class="skill-card-hero"><div class="hero-backdrop" aria-hidden="true"></div><div class="skill-cover skill-cover-placeholder" aria-hidden="true">${escapeHtml(initials(skill.displayName))}</div><div class="skill-meta"><span class="meta-kicker">${escapeHtml(skill.provider.toUpperCase())} SKILL</span><h2>${escapeHtml(skill.displayName)}</h2><p>${escapeHtml(compactDescription(skill.description))}</p><div class="skill-meta-footer"><span>${escapeHtml(pageStateLabel(skill.pageStatus))}</span><span>${escapeHtml(runState)}</span></div></div></section>
    </article>
  `;
}
