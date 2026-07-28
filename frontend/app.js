import { createMotionScope } from "./motion/index.js";
import { renderConnectionState } from "./components/connection-state.js";
import { compactDescription, escapeHtml, pageStateLabel, renderSkillCard, toneFor } from "./components/skill-card.js";
import { getActiveCardIndex, getStackLayout, maxVisibleStackCards, renderSkillDeck } from "./components/skill-deck.js";
import { renderSkillPreview } from "./components/skill-preview-modal.js";
import { setupLanguageSwitcher, t } from "./i18n.js";

const hubShell = document.querySelector(".hub-shell");
const skillDeck = document.getElementById("skillDeck");
const connectionState = document.getElementById("connectionState");
const searchInput = document.getElementById("skillSearch");
const statusFilter = document.getElementById("skillFilter");
const catalogControls = document.querySelector(".catalog-controls");
const skillModal = document.getElementById("skillModal");
const skillModalWindow = skillModal?.querySelector(".skill-modal-window");
const skillModalHero = document.getElementById("skillModalHero");
const skillModalTitle = document.getElementById("skillModalTitle");
const skillModalContent = document.getElementById("skillModalContent");
const skillStartButton = document.getElementById("skillStartButton");
const skillPage = document.getElementById("skillPage");
const skillPageContent = document.getElementById("skillPageContent");
const userSessionActions = document.getElementById("userSessionActions");
const userSessionName = document.getElementById("userSessionName");
const adminConsoleLink = document.getElementById("adminConsoleLink");
const userLogoutButton = document.getElementById("userLogoutButton");
const motion = createMotionScope(document.body);
let activeRunStream;
let activeGeneratedFrame;
let activeGeneratedRunId = "";
let activeGeneratedRunStatus = "idle";
let activeGeneratedRunEventSequence = 0;
let csrfToken = "";
let activeSession;
let hubRouteSequence = 0;
let activeRunMarkdown = "";
let activeRunEventSequence = 0;
let activeWorkspaceRunId = "";
let workspaceRunTreeTimer;
let workspaceTreeResize;
const workspaceTreeLayoutStorageKey = "skill-web-hub-tree-layout";

function readWorkspaceTreeSizes() {
  try {
    const stored = JSON.parse(localStorage.getItem(workspaceTreeLayoutStorageKey) || "");
    if (Array.isArray(stored) && stored.length === 3 && stored.every((size) => Number.isFinite(size) && size > 0)) return stored;
  } catch {
    // A missing or legacy value falls back to the documented 4:4:1 layout.
  }
  return [4, 4, 1];
}

const state = {
  allSkills: [],
  visibleSkills: [],
  activeModalSkill: null,
  opencodeAvailable: false,
  stackOffset: 0,
  liftedCardIndex: null,
  wheelLocked: false,
  skillTreeCollapsed: false,
  recentTreeCollapsed: false,
  historyTreeCollapsed: true,
  recentRuns: [],
  workspaceTreeSizes: readWorkspaceTreeSizes(),
};

function authenticatedFetch(url, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  if (!headers["Content-Type"] && options.body) headers["Content-Type"] = "application/json";
  if (!['GET', 'HEAD'].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return fetch(url, { ...options, headers });
}

function showUserSession(session) {
  activeSession = session;
  userSessionActions.hidden = false;
  userSessionName.textContent = session.username;
  adminConsoleLink.hidden = session.role !== "administrator";
  userLogoutButton.onclick = async () => {
    await authenticatedFetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  };
}

function skillTreeLabel(skill) {
  return (skill.displayName || skill.name || skill.id).split(/[\s._/-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "SK";
}

function isActiveRun(run) {
  return ["created", "running", "waiting"].includes(String(run.status || "").toLowerCase());
}

async function refreshRecentRuns() {
  state.recentRuns = await requestJson("/api/runs")
    .then((runs) => Array.isArray(runs) ? runs.slice(0, 12) : [])
    .catch(() => []);
}

function runIndicatorClass(run) {
  const status = String(run?.status || "").toLowerCase();
  return isActiveRun(run) ? "is-running" : status === "completed" ? "is-completed" : "is-idle";
}

function renderWorkspaceNavigation(activeSkillId = "") {
  const skills = state.allSkills.filter((skill) => skill.enabled !== false);
  const skillItems = skills.map((skill) => `<a class="workspace-tree-item ${skill.id === activeSkillId ? "is-current" : ""}" href="/skills/${encodeURIComponent(skill.id)}" data-workspace-skill="${escapeHtml(`${skill.displayName} ${skill.name} ${skill.id}`.toLowerCase())}"><span class="workspace-tree-icon">${escapeHtml(skillTreeLabel(skill))}</span><span><strong>${escapeHtml(skill.displayName)}</strong><small>${escapeHtml(skill.description || skill.provider)}</small></span></a>`).join("");
  const recentItems = state.recentRuns.map((run) => {
    const skill = state.allSkills.find((item) => item.id === run.skillId);
    const name = skill?.displayName || run.skillId;
    return `<div class="workspace-running-row"><a class="workspace-running-item" href="/skills/${encodeURIComponent(run.skillId)}?run=${encodeURIComponent(run.id)}"><span class="skill-run-indicator ${runIndicatorClass(run)}"></span><span>${escapeHtml(name)}</span></a><button type="button" class="workspace-run-delete" data-run-delete="${escapeHtml(run.id)}" title="\u7ec8\u6b62\u5e76\u5220\u9664\u4f1a\u8bdd" aria-label="\u7ec8\u6b62\u5e76\u5220\u9664\u4f1a\u8bdd"><span aria-hidden="true">&#x1F5D1;&#xFE0E;</span></button></div>`;
  }).join("");
  const [skillSize, recentSize, historySize] = state.workspaceTreeSizes;
  const panel = ({ id, label, count, collapsed, content }) => `<section class="workspace-tree-pane workspace-${id}-pane ${collapsed ? "is-collapsed" : ""}" data-workspace-tree-pane="${id}"><button class="workspace-tree-heading" type="button" data-workspace-tree-toggle="${id}" aria-expanded="${!collapsed}"><span class="workspace-tree-caret" aria-hidden="true">⌄</span><strong>${label}</strong>${count === undefined ? "" : `<em>${count}</em>`}</button><div class="workspace-tree-panel-content">${content}</div></section>`;
  const skillPanel = panel({ id: "skill", label: "\u5168\u90e8\u6280\u80fd", count: skills.length, collapsed: state.skillTreeCollapsed, content: `<div class="workspace-tree-list">${skillItems || '<p class="workspace-tree-empty">\u6682\u65e0\u53ef\u7528\u6280\u80fd</p>'}</div>` });
  const recentPanel = panel({ id: "recent", label: "\u6700\u8fd1\u5bf9\u8bdd", count: state.recentRuns.length, collapsed: state.recentTreeCollapsed, content: `<div class="workspace-running-content">${recentItems || "<p>\u6682\u65e0\u6700\u8fd1\u5bf9\u8bdd</p>"}</div>` });
  const historyPanel = panel({ id: "history", label: "\u8fd0\u884c\u5386\u53f2", collapsed: state.historyTreeCollapsed, content: '<a class="workspace-history-link" href="/runs">\u67e5\u770b\u5b8c\u6574\u8fd0\u884c\u5386\u53f2</a>' });
  return `<section class="workspace-skill-tree" aria-label="\u6280\u80fd\u76ee\u5f55"><label class="workspace-tree-search"><span class="sr-only">\u641c\u7d22\u6280\u80fd</span><input type="search" data-workspace-tree-search placeholder="\u641c\u7d22\u6280\u80fd..." autocomplete="off"></label><div class="workspace-tree-panes" style="--workspace-skill-size:${skillSize};--workspace-recent-size:${recentSize};--workspace-history-size:${historySize}">${skillPanel}<div class="workspace-tree-resizer" data-workspace-tree-resizer="skill-recent" role="separator" aria-label="\u8c03\u6574\u5168\u90e8\u6280\u80fd\u4e0e\u6700\u8fd1\u5bf9\u8bdd\u533a\u57df\u9ad8\u5ea6" aria-orientation="horizontal" tabindex="0"></div>${recentPanel}<div class="workspace-tree-resizer" data-workspace-tree-resizer="recent-history" role="separator" aria-label="\u8c03\u6574\u6700\u8fd1\u5bf9\u8bdd\u4e0e\u8fd0\u884c\u5386\u53f2\u533a\u57df\u9ad8\u5ea6" aria-orientation="horizontal" tabindex="0"></div>${historyPanel}</div></section>`;
}

function resetRouteScroll() {
  const reset = () => window.scrollTo(0, 0);
  reset();
  requestAnimationFrame(reset);
  window.setTimeout(reset, 0);
}

function renderUserWorkspace({ eyebrow, title, description, section, body, activeSkillId = "", hideHeader = false }) {
  const username = activeSession?.username || "";
  return `<section class="user-workspace user-workspace-${escapeHtml(section)}">
    <header class="user-workspace-globalbar"><a class="user-workspace-logo" href="/">SKILL HUB</a><div class="user-workspace-global-actions"><span class="user-workspace-network"><i></i>局域网服务在线</span>${activeSession?.role === "administrator" ? '<a href="/admin">管理控制台</a>' : ""}<button type="button" data-user-language>${escapeHtml(document.getElementById("languageToggle")?.textContent || "EN")}</button><details class="user-workspace-account"><summary>${escapeHtml(username || "LOCAL USER")}</summary><button type="button" data-user-logout>退出</button></details></div></header>
    <aside class="user-workspace-rail">
      <span class="user-workspace-rail-label">WORKSPACE</span>
      <nav class="user-workspace-nav" aria-label="用户工作区">
        <a href="/" class="${section === "catalog" ? "is-current" : ""}">发现 Skill</a>
      </nav>
      ${renderWorkspaceNavigation(activeSkillId)}
    </aside>
    <main class="user-workspace-main">
      ${hideHeader ? "" : `<header class="user-workspace-topbar"><div><p>${escapeHtml(eyebrow)}</p><h1 class="user-workspace-title">${escapeHtml(title)}</h1><span class="user-workspace-description">${escapeHtml(description)}</span></div><div class="user-workspace-status">LOCAL NETWORK</div></header>`}
      <div class="user-workspace-content">${body}</div>
    </main>
  </section>`;
}

function renderCatalogWorkspace() {
  activeGeneratedFrame = undefined;
  hubShell.hidden = true;
  skillPage.hidden = false;
  resetRouteScroll();
  skillPageContent.innerHTML = renderUserWorkspace({
    eyebrow: "SKILL CATALOG",
    title: "\u53d1\u73b0\u6280\u80fd",
    description: "\u6d4f\u89c8\u5df2\u53d1\u5e03\u7684 Skill\uff0c\u9009\u62e9\u540e\u8fdb\u5165\u53ef\u89c6\u5316\u8fd0\u884c\u9875\u9762",
    section: "catalog",
    hideHeader: true,
    body: `<section class="workspace-panel catalog-workspace-panel" aria-label="OpenCode skills preview"><div class="workspace-panel-heading catalog-workspace-heading"><span>\u53d1\u73b0\u6280\u80fd</span><div class="catalog-workspace-filter-slot"></div></div><div class="catalog-workspace-stage"></div></section>`,
  });
  const filterSlot = skillPageContent.querySelector(".catalog-workspace-filter-slot");
  if (filterSlot && catalogControls) filterSlot.append(catalogControls);
  const stage = skillPageContent.querySelector(".catalog-workspace-stage");
  if (stage) stage.append(skillDeck);
  if (skillModal.parentElement !== document.body) document.body.append(skillModal);
}

document.documentElement.dataset.gsapReady = "true";
window.addEventListener("pagehide", () => {
  activeRunStream?.close();
  motion.revert();
}, { once: true });

function setConnection(text, type = "") {
  renderConnectionState(connectionState, text, type);
}

function renderStack() {
  const skills = state.visibleSkills;
  state.stackOffset = skills.length ? ((state.stackOffset % skills.length) + skills.length) % skills.length : 0;
  state.liftedCardIndex = null;
  const cards = renderSkillDeck(skillDeck, skills, (skill, index) => renderSkillCard(skill, index, state.opencodeAvailable));
  if (cards.length === 0) return;
  applyStackPositions(false);
  motion.stagger(cards.filter((card) => card.dataset.stackVisible === "true"), { stagger: { amount: 0.32, from: "end" } });
}

function getDeckPresentation(count) {
  const catalogDeck = Boolean(skillDeck.closest(".catalog-workspace-stage"));
  const visibleStart = Math.max(0, count - maxVisibleStackCards);
  const suppressedFrontSlot = catalogDeck && count > 1 ? count - 1 : -1;
  const focusSlot = suppressedFrontSlot === -1 ? count - 1 : count - 2;
  const visibleCount = count - visibleStart - (suppressedFrontSlot >= visibleStart ? 1 : 0);
  const layout = getStackLayout(Math.max(visibleCount, 1));
  return { catalogDeck, visibleStart, visibleCount, suppressedFrontSlot, focusSlot, ...layout };
}

function applyStackPositions(animate) {
  const cards = [...skillDeck.querySelectorAll(".skill-window")];
  const count = cards.length;
  if (!count) return;
  const { catalogDeck, visibleStart, visibleCount, suppressedFrontSlot, focusSlot, startY, gapY } = getDeckPresentation(count);
  cards.forEach((card, index) => {
    const slot = (index + state.stackOffset + count) % count;
    const isVisible = slot >= visibleStart && slot !== suppressedFrontSlot;
    if (!isVisible) {
      card.dataset.stackVisible = "false";
      card.classList.remove("is-focus", "is-front-card", "is-lifted");
      card.style.pointerEvents = "none";
      motion.set(card, { autoAlpha: 0, y: -900, z: -1400 });
      return;
    }
    const displaySlot = slot - visibleStart;
    const depth = visibleCount === 1 ? 1 : displaySlot / Math.max(visibleCount - 1, 1);
    const isFocus = slot === focusSlot;
    const isLifted = !isFocus && index === state.liftedCardIndex;
    const values = {
      xPercent: -50,
      yPercent: -50,
      x: Math.sin(index * 1.6) * 4.5,
      y: visibleCount === 1 ? 12 : startY + displaySlot * gapY + (isFocus && !catalogDeck ? 68 : 0) + (isLifted ? -48 : 0),
      z: visibleCount === 1 ? 0 : -1040 + displaySlot * 72 + (isFocus ? 190 : 0) + (isLifted ? 84 : 0),
      rotationX: count === 1 ? 0 : isFocus ? -10 : -66 + depth * 18 + (isLifted ? 8 : 0),
      rotation: count === 1 ? 0 : (slot - focusSlot / 2) * -0.055,
      scale: visibleCount === 1 ? 1 : isFocus ? 1 : 0.78 + depth * 0.28 + (isLifted ? 0.035 : 0),
      autoAlpha: visibleCount === 1 ? 1 : 0.64 + depth * 0.34 + (isFocus ? 0.03 : 0) + (isLifted ? 0.08 : 0),
      duration: animate ? 0.3 : 0,
      ease: "power2.out",
      overwrite: "auto",
    };
    card.dataset.stackVisible = "true";
    card.style.pointerEvents = "auto";
    card.style.zIndex = String(20 + displaySlot * 10 + (isFocus ? 60 : 0) + (isLifted ? 70 : 0));
    card.style.filter = `blur(${Math.max(0, (1 - depth) * 0.95 - (isFocus ? 0.8 : 0)).toFixed(2)}px) brightness(${(isFocus ? 1.08 : 0.62 + depth * 0.36 + (isLifted ? 0.18 : 0)).toFixed(3)}) saturate(${isFocus ? 1.08 : 0.82})`;
    card.classList.toggle("is-focus", isFocus);
    card.classList.toggle("is-front-card", isFocus);
    card.classList.toggle("is-lifted", isLifted);
    card.tabIndex = isFocus || isLifted ? 0 : -1;
    if (animate) motion.to(card, values);
    else motion.set(card, values);
  });
}

function switchStack(direction) {
  if (!state.visibleSkills.length) return;
  state.liftedCardIndex = null;
  state.stackOffset += direction;
  applyStackPositions(true);
}

function getInteractiveCardIndex() {
  const catalogDeck = Boolean(skillDeck.closest(".catalog-workspace-stage"));
  return getActiveCardIndex(state.visibleSkills.length, state.stackOffset + (catalogDeck && state.visibleSkills.length > 1 ? 1 : 0));
}

function getHoverCardIndex(event) {
  const targetCard = event.target instanceof Element ? event.target.closest(".skill-window") : null;
  if (targetCard?.dataset.card) {
    const index = Number(targetCard.dataset.card);
    if (Number.isInteger(index) && index >= 0 && index < state.visibleSkills.length) return index;
  }

  const cards = [...skillDeck.querySelectorAll(".skill-window")];
  const count = cards.length;
  if (!count) return null;
  const { catalogDeck, visibleStart, visibleCount, suppressedFrontSlot, focusSlot, startY, gapY } = getDeckPresentation(count);
  const deckRect = skillDeck.getBoundingClientRect();
  const centerX = deckRect.left + deckRect.width / 2;
  const baseY = deckRect.top + deckRect.height * 0.54;
  const candidates = cards.map((card, index) => {
    const slot = (index + state.stackOffset + count) % count;
    if (slot < visibleStart || slot === suppressedFrontSlot) return null;
    const displaySlot = slot - visibleStart;
    const scale = slot === focusSlot ? 1 : 0.78 + displaySlot / Math.max(visibleCount - 1, 1) * 0.28;
    return { index, slot, top: baseY + startY + displaySlot * gapY + (slot === focusSlot && !catalogDeck ? 68 : 0) - (card.offsetHeight * scale) / 2, halfWidth: card.offsetWidth * scale / 2 };
  }).filter(Boolean).filter((zone) => Math.abs(event.clientX - centerX) <= zone.halfWidth && event.clientY >= zone.top - 8 && event.clientY <= zone.top + 42)
    .sort((left, right) => Math.abs(event.clientY - left.top) - Math.abs(event.clientY - right.top) || right.slot - left.slot);
  return candidates[0]?.index ?? null;
}

function setLiftedCard(index) {
  if (state.liftedCardIndex === index) return;
  state.liftedCardIndex = index;
  skillDeck.classList.toggle("has-lifted-card", index !== null);
  applyStackPositions(true);
}

function openSkillModal(skill, sourceCard) {
  state.activeModalSkill = skill;
  const [accent, secondary] = toneFor(skill.id);
  skillModalTitle.textContent = skill.displayName;
  skillModalHero.style.background = `radial-gradient(circle at 20% 30%, ${accent}, transparent 42%), radial-gradient(circle at 78% 72%, ${secondary}, transparent 48%), #050608`;
  skillModalContent.innerHTML = renderSkillPreview(skill);
  skillStartButton.disabled = !state.opencodeAvailable;
  skillStartButton.textContent = state.opencodeAvailable ? t("开始使用") : t("OpenCode 未连接");
  skillModal.classList.remove("is-leaving");
  skillModal.classList.add("is-open");
  skillModal.setAttribute("aria-hidden", "false");
  motion.enter(skillModalWindow, { scale: 1, duration: 0.28 });
  skillStartButton.focus();
  if (sourceCard) sourceCard.setAttribute("data-modal-origin", "true");
}

function closeSkillModal() {
  if (!skillModal.classList.contains("is-open")) return;
  const origin = skillDeck.querySelector("[data-modal-origin='true']");
  skillModal.classList.add("is-leaving");
  motion.exit(skillModalWindow, { onComplete: () => {
    skillModal.classList.remove("is-open", "is-leaving");
    skillModal.setAttribute("aria-hidden", "true");
    origin?.removeAttribute("data-modal-origin");
    origin?.focus();
    state.activeModalSkill = null;
  } });
}

function closeSkillModalForNavigation() {
  const origin = skillDeck.querySelector("[data-modal-origin='true']");
  skillModal.classList.remove("is-open", "is-leaving");
  skillModal.setAttribute("aria-hidden", "true");
  origin?.removeAttribute("data-modal-origin");
  state.activeModalSkill = null;
}

function renderInputField(input) {
  const required = input.required ? " required" : "";
  const description = input.description ? `<small>${escapeHtml(input.description)}</small>` : "";
  if (input.kind === "boolean") {
    return `<label class="skill-run-field skill-run-check"><input name="${escapeHtml(input.id)}" type="checkbox"${input.defaultValue === true ? " checked" : ""} /><span>${escapeHtml(input.label)}</span>${description}</label>`;
  }
  if (input.kind === "select") {
    const options = (input.options || []).map((option) => `<option value="${escapeHtml(option.value)}"${input.defaultValue === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
    return `<label class="skill-run-field"><span>${escapeHtml(input.label)}${input.required ? " *" : ""}</span><select name="${escapeHtml(input.id)}"${required}>${options}</select>${description}</label>`;
  }
  if (input.kind === "text" && (input.id === "taskText" || /task|description|prompt|request/i.test(input.id))) {
    return `<label class="skill-run-field skill-run-textarea"><span>${escapeHtml(input.label)}${input.required ? " *" : ""}</span><textarea name="${escapeHtml(input.id)}" rows="7"${required} placeholder="描述你希望 Skill 完成的工作"></textarea>${description}</label>`;
  }
  const type = input.kind === "file" ? "file" : input.kind === "number" ? "number" : input.kind === "url" ? "url" : "text";
  return `<label class="skill-run-field"><span>${escapeHtml(input.label)}${input.required ? " *" : ""}</span><input name="${escapeHtml(input.id)}" type="${type}"${input.kind === "file" ? "" : input.defaultValue !== undefined ? ` value="${escapeHtml(String(input.defaultValue))}"` : ""}${required} />${description}</label>`;
}

function restoreRunInputs(skill, values) {
  if (!values || typeof values !== "object") return;
  const form = document.getElementById("skillRunForm");
  if (!(form instanceof HTMLFormElement)) return;
  for (const input of skill.inputs || []) {
    if (input.kind === "file" || values[input.id] === undefined) continue;
    const field = form.elements.namedItem(input.id);
    if (field instanceof HTMLInputElement) {
      if (input.kind === "boolean") field.checked = values[input.id] === true;
      else field.value = String(values[input.id]);
    } else if (field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      field.value = String(values[input.id]);
    }
  }
}

async function uploadInputFile(file) {
  if (!(file instanceof File)) throw new Error("请选择一个要上传的文件。");
  const response = await authenticatedFetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Upload-Name": file.name, "X-Upload-Mime": file.type || "application/octet-stream" },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || "文件上传失败。");
  return payload.id;
}

function renderTerminalMarkdown(markdown) {
  const escaped = escapeHtml(markdown || "");
  const withCodeBlocks = escaped.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language, code) => `<pre class="terminal-markdown-code"><code>${language ? `<span>${language}</span>` : ""}${code}</code></pre>`);
  return withCodeBlocks
    .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/^##\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^#\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)(?:\n<li>[\s\S]*?<\/li>)+/g, (list) => `<ul>${list}</ul>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

function updateRunMarkdown(event) {
  if (event.type !== "message.delta" || typeof event.text !== "string" || !event.text) return;
  activeRunMarkdown += event.text;
  const result = document.getElementById("runMarkdownOutput");
  const panel = document.getElementById("runMarkdownPanel");
  if (!result || !panel) return;
  result.innerHTML = renderTerminalMarkdown(activeRunMarkdown);
  panel.hidden = false;
  document.getElementById("runOutputEmpty")?.setAttribute("hidden", "");
  result.scrollTop = result.scrollHeight;
}

function updateRunPanel(run) {
  const status = document.getElementById("runStatus");
  const summary = document.getElementById("runSummary");
  const abort = document.getElementById("runAbortButton");
  const duration = document.getElementById("runDuration");
  if (status) status.textContent = run.status.toUpperCase();
  if (summary) summary.textContent = run.errorMessage || run.summary || `运行 ${run.id} 已创建。`;
  if (duration) duration.textContent = formatRunDuration(run);
  if (abort) {
    abort.dataset.runId = run.id;
    abort.disabled = ["completed", "failed", "aborted"].includes(run.status);
  }
  activeWorkspaceRunId = run.id || activeWorkspaceRunId;
  const indicator = document.getElementById("skillRunIndicator");
  if (indicator) {
    const status = String(run.status || "").toLowerCase();
    indicator.className = `skill-run-indicator ${runIndicatorClass(run)}`;
    indicator.title = status || "idle";
  }
}

function refreshWorkspaceSkillTree(activeSkillId = "") {
  const tree = document.querySelector(".workspace-skill-tree");
  if (!tree) return;
  tree.outerHTML = renderWorkspaceNavigation(activeSkillId);
}

function startWorkspaceRunTreePolling(activeSkillId = "") {
  window.clearInterval(workspaceRunTreeTimer);
  workspaceRunTreeTimer = window.setInterval(() => {
    void refreshRecentRuns().then(() => refreshWorkspaceSkillTree(activeSkillId));
  }, 5000);
}

async function deleteRecentRun(runId) {
  const response = await authenticatedFetch(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("无法删除该会话。");
  if (activeWorkspaceRunId === runId) {
    activeRunStream?.close();
    activeWorkspaceRunId = "";
    navigateHub("/");
  }
  await refreshRecentRuns();
  refreshWorkspaceSkillTree();
}

function formatRunDuration(run) {
  if (!run.completedAt || !run.createdAt) return "耗时：运行中";
  const milliseconds = Math.max(0, Date.parse(run.completedAt) - Date.parse(run.createdAt));
  if (!Number.isFinite(milliseconds)) return "耗时：-";
  if (milliseconds < 1000) return "耗时：< 1 秒";
  if (milliseconds < 60000) return `耗时：${(milliseconds / 1000).toFixed(1)} 秒`;
  return `耗时：${Math.floor(milliseconds / 60000)} 分 ${Math.floor(milliseconds % 60000 / 1000)} 秒`;
}

function appendRunEvent(event) {
  const list = document.getElementById("runEvents");
  if (!list) return;
  const item = document.createElement("li");
  const detail = event.message || event.text || event.command || event.tool || event.question || event.permission || event.artifactId || "";
  item.textContent = `#${event.sequence} ${event.type}${detail ? `: ${detail}` : ""}`;
  item.dataset.eventType = event.type || "unknown";
  list.append(item);
  list.scrollTop = list.scrollHeight;
  updateRunMarkdown(event);
  if (event.type === "artifact.created") {
    if (activeWorkspaceRunId) void loadRunArtifacts(activeWorkspaceRunId);
  }
  if (event.type === "question.pending" || event.type === "permission.pending") renderPendingInteraction(event);
  if (event.type === "run.completed") renderFollowUpInteraction();
  if (["run.failed", "run.aborted"].includes(event.type)) {
    const container = document.getElementById("runInteraction");
    container?.replaceChildren();
    container?.closest(".skill-output-panel")?.classList.remove("has-interaction");
  }
}

function canPreviewArtifactInBrowser(artifact) {
  return artifact.mimeType.startsWith("image/")
    || artifact.mimeType === "application/pdf"
    || artifact.mimeType.startsWith("text/")
    || artifact.mimeType.startsWith("application/json");
}

function renderRunArtifacts(artifacts) {
  const container = document.getElementById("runArtifacts");
  const count = document.getElementById("runArtifactCount");
  if (count) count.textContent = `产物：${artifacts.length}`;
  if (!container) return;
  if (!artifacts.length) {
    container.innerHTML = "<p class=\"run-artifacts-empty\">本次运行尚未生成可下载产物。</p>";
    return;
  }
  container.innerHTML = artifacts.map((artifact) => {
    const artifactId = encodeURIComponent(artifact.id);
    const size = `${new Intl.NumberFormat("zh-CN").format(artifact.sizeBytes)} B`;
    const preview = canPreviewArtifactInBrowser(artifact)
      ? `<details class="artifact-preview"><summary>预览</summary><iframe title="${escapeHtml(artifact.displayName)} 预览" sandbox src="/api/artifacts/${artifactId}/preview" loading="lazy"></iframe></details>`
      : "";
    return `<article class="artifact-item"><header><strong>${escapeHtml(artifact.displayName)}</strong><span>${escapeHtml(artifact.mimeType)} · ${size}</span></header>${preview}<a href="/api/artifacts/${artifactId}/download">下载</a></article>`;
  }).join("");
}

async function loadRunArtifacts(runId) {
  try {
    renderRunArtifacts(await requestJson(`/api/runs/${encodeURIComponent(runId)}/artifacts`));
  } catch {
    const container = document.getElementById("runArtifacts");
    if (container) container.innerHTML = "<p class=\"run-artifacts-empty\">产物列表暂时不可用。</p>";
  }
}

function renderPendingInteraction(event) {
  const container = document.getElementById("runInteraction");
  if (!container) return;
  container.closest(".skill-output-panel")?.classList.add("has-interaction");
  if (event.type === "question.pending") {
    container.innerHTML = `
      <form class="run-interaction-form" data-kind="question" data-request-id="${escapeHtml(event.questionId)}">
        <strong>需要回答问题</strong><p>${escapeHtml(event.question)}</p>
        <label>回答（多个选项以逗号分隔）<input name="answer" type="text" required /></label>
        <button type="submit">提交回答</button>
      </form>`;
    return;
  }
  container.innerHTML = `
    <section class="run-interaction-form" data-kind="permission" data-request-id="${escapeHtml(event.permissionId)}">
      <strong>需要权限</strong><p>${escapeHtml(event.permission)}</p>
      <div><button type="button" data-permission-reply="once">允许一次</button><button type="button" data-permission-reply="reject">拒绝</button></div>
    </section>`;
}

function renderFollowUpInteraction() {
  const container = document.getElementById("runInteraction");
  if (!container || container.querySelector("[data-kind]")) return;
  container.closest(".skill-output-panel")?.classList.add("has-interaction");
  container.innerHTML = `
    <form class="run-interaction-form run-followup-form" data-kind="followup">
      <strong>继续对话</strong>
      <label>补充信息或确认内容<textarea name="message" rows="2" required placeholder="输入回复后继续执行"></textarea></label>
      <button type="submit">发送并继续</button>
    </form>`;
}

async function replyToPendingInteraction(event) {
  const container = document.getElementById("runInteraction");
  const runId = activeWorkspaceRunId;
  if (!container || !runId) return;
  const interaction = container.querySelector("[data-kind]");
  const kind = interaction?.dataset.kind;
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  let endpoint = "";
  let body;
  if (kind === "followup") {
    const message = String(new FormData(form ?? undefined).get("message") || "").trim();
    if (!message) return;
    endpoint = `/api/runs/${encodeURIComponent(runId)}/followup`;
    body = { message };
  } else {
    const requestId = interaction?.dataset.requestId;
    if (!requestId) return;
    if (kind === "question") {
      const answer = String(new FormData(form ?? undefined).get("answer") || "");
      endpoint = `/api/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/reply`;
      body = { answers: [answer.split(",").map((value) => value.trim()).filter(Boolean)] };
    } else if (kind === "permission") {
      endpoint = `/api/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/reply`;
      body = { reply: event.target instanceof HTMLButtonElement ? event.target.dataset.permissionReply : undefined };
    } else {
      return;
    }
  }
  const response = await authenticatedFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const summary = document.getElementById("runSummary");
    if (summary) summary.textContent = payload.message || payload.error || "无法提交交互响应。";
    return;
  }
  updateRunPanel(await response.json());
  container.replaceChildren();
  container.closest(".skill-output-panel")?.classList.remove("has-interaction");
  if (kind === "followup") {
    void refreshRecentRuns().then(() => refreshWorkspaceSkillTree());
    subscribeToRun(runId);
  }
}

function subscribeToRun(runId) {
  activeRunStream?.close();
  activeRunStream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  const eventTypes = ["run.created", "run.started", "thinking.delta", "terminal.command", "terminal.output", "provider.status", "message.delta", "tool.started", "tool.finished", "question.pending", "permission.pending", "artifact.created", "run.completed", "run.failed", "run.aborted"];
  for (const type of eventTypes) {
    activeRunStream.addEventListener(type, (message) => {
      const event = JSON.parse(message.data);
      const sequence = Number(event.sequence);
      if (Number.isFinite(sequence)) {
        if (sequence <= activeRunEventSequence) return;
        activeRunEventSequence = sequence;
      }
      appendRunEvent(event);
      if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
        const stream = activeRunStream;
        void Promise.all([
          requestJson(`/api/runs/${encodeURIComponent(runId)}`).then(updateRunPanel),
          loadRunArtifacts(runId),
          refreshRecentRuns(),
        ]).then(() => refreshWorkspaceSkillTree()).finally(() => {
          if (activeRunStream === stream) activeRunStream?.close();
        });
      }
    });
  }
  activeRunStream.onerror = () => {
    const status = document.getElementById("runStatus");
    if (status && status.textContent !== "COMPLETED" && status.textContent !== "FAILED" && status.textContent !== "ABORTED") status.textContent = "RECONNECTING";
  };
}

function bindRunForm(skill) {
  const form = document.getElementById("skillRunForm");
  const abort = document.getElementById("runAbortButton");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = {};
    for (const input of skill.inputs || []) {
      const field = form.elements.namedItem(input.id);
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) continue;
      if (input.kind === "file") {
        values[input.id] = field instanceof HTMLInputElement && field.files?.[0] ? await uploadInputFile(field.files[0]) : "";
      } else {
        values[input.id] = input.kind === "boolean" ? field.checked : field.value;
      }
    }
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      if (skill.highRisk && !window.confirm("此 Skill 可能执行高风险操作。确认继续本次运行？")) return;
      const response = await authenticatedFetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillId: skill.id, inputs: values, confirmHighRisk: skill.highRisk === true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      document.getElementById("runEvents").replaceChildren();
      activeRunEventSequence = 0;
      const interaction = document.getElementById("runInteraction");
      interaction?.replaceChildren();
      interaction?.closest(".skill-output-panel")?.classList.remove("has-interaction");
      activeRunMarkdown = "";
      document.getElementById("runMarkdownOutput")?.replaceChildren();
      const markdownPanel = document.getElementById("runMarkdownPanel");
      if (markdownPanel) markdownPanel.hidden = true;
      document.getElementById("runOutputEmpty")?.removeAttribute("hidden");
      renderRunArtifacts([]);
      updateRunPanel(payload);
      void refreshRecentRuns().then(() => refreshWorkspaceSkillTree(skill.id));
      subscribeToRun(payload.id);
    } catch (error) {
      const summary = document.getElementById("runSummary");
      if (summary) summary.textContent = error instanceof Error ? error.message : "无法创建运行。";
    } finally {
      submit.disabled = false;
    }
  });
  abort?.addEventListener("click", async () => {
    const runId = abort.dataset.runId;
    if (!runId) return;
    const response = await authenticatedFetch(`/api/runs/${encodeURIComponent(runId)}/abort`, { method: "POST" });
    if (response.ok) updateRunPanel(await response.json());
  });
  document.getElementById("runInteraction")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void replyToPendingInteraction(event);
  });
  document.getElementById("runInteraction")?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLButtonElement && event.target.dataset.permissionReply) void replyToPendingInteraction(event);
  });
}

function postToGeneratedFrame(type, payload = {}) {
  activeGeneratedFrame?.contentWindow?.postMessage({ channel: "skill-web-hub-runtime", type, ...payload }, "*");
}

async function normalizeGeneratedInputs(skill, rawInputs) {
  const submitted = rawInputs && typeof rawInputs === "object" && !Array.isArray(rawInputs) ? rawInputs : {};
  const inputs = {};
  for (const input of skill.inputs || []) {
    const value = submitted[input.id];
    if (input.kind === "boolean") inputs[input.id] = value === true;
    else if (input.kind === "number") inputs[input.id] = typeof value === "number" ? value : Number(value);
    else if (input.kind === "file") inputs[input.id] = value instanceof File ? await uploadInputFile(value) : String(value ?? "");
    else if (value !== undefined) inputs[input.id] = String(value);
  }
  return inputs;
}

function subscribeGeneratedRun(runId) {
  activeRunStream?.close();
  activeRunStream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  const eventTypes = ["run.created", "run.started", "thinking.delta", "terminal.command", "terminal.output", "provider.status", "message.delta", "tool.started", "tool.finished", "question.pending", "permission.pending", "artifact.created", "run.completed", "run.failed", "run.aborted"];
  for (const type of eventTypes) {
    activeRunStream.addEventListener(type, (message) => {
      const event = JSON.parse(message.data);
      if (typeof event.sequence === "number") {
        if (event.sequence <= activeGeneratedRunEventSequence) return;
        activeGeneratedRunEventSequence = event.sequence;
      }
      postToGeneratedFrame("run.event", { event });
      if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
        const stream = activeRunStream;
        void Promise.all([
          requestJson(`/api/runs/${encodeURIComponent(runId)}`),
          requestJson(`/api/runs/${encodeURIComponent(runId)}/artifacts`),
        ]).then(([run, artifacts]) => {
          activeGeneratedRunStatus = run.status;
          postToGeneratedFrame("run.state", { run });
          postToGeneratedFrame("run.artifacts", { artifacts });
        }).finally(() => {
          if (activeRunStream === stream) activeRunStream?.close();
        });
      }
    });
  }
  activeRunStream.onerror = () => postToGeneratedFrame("run.state", { run: { id: runId, status: "reconnecting", summary: "正在恢复实时连接。" } });
}

async function startGeneratedRun(skill, rawInputs) {
  if (activeGeneratedRunId && !["completed", "failed", "aborted"].includes(activeGeneratedRunStatus)) {
    postToGeneratedFrame("run.error", { message: "A Skill run is already active on this page." });
    return;
  }
  try {
    if (skill.highRisk && !window.confirm("此 Skill 可能执行高风险操作。确认继续本次运行？")) return;
    const response = await authenticatedFetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: skill.id, inputs: await normalizeGeneratedInputs(skill, rawInputs), confirmHighRisk: skill.highRisk === true }),
    });
    const run = await response.json();
    if (!response.ok) throw new Error(run.message || run.error || `HTTP ${response.status}`);
    activeGeneratedRunId = run.id;
    activeGeneratedRunStatus = run.status;
    activeGeneratedRunEventSequence = 0;
    postToGeneratedFrame("run.state", { run });
    subscribeGeneratedRun(run.id);
  } catch (error) {
    postToGeneratedFrame("run.error", { message: error instanceof Error ? error.message : "无法创建运行。" });
  }
}

async function followUpGeneratedRun(payload) {
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!runId || runId !== activeGeneratedRunId || activeGeneratedRunStatus !== "completed" || !message) return;
  try {
    const response = await authenticatedFetch(`/api/runs/${encodeURIComponent(runId)}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const run = await response.json();
    if (!response.ok) throw new Error(run.message || run.error || `HTTP ${response.status}`);
    activeGeneratedRunStatus = run.status;
    postToGeneratedFrame("run.state", { run });
    subscribeGeneratedRun(run.id);
  } catch (error) {
    postToGeneratedFrame("run.error", { message: error instanceof Error ? error.message : "无法发送后续消息。" });
  }
}

async function replyFromGeneratedRun(payload) {
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  if (!runId || runId !== activeGeneratedRunId || !requestId || (payload.kind !== "question" && payload.kind !== "permission")) return;
  const endpoint = payload.kind === "question"
    ? `/api/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/reply`
    : `/api/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/reply`;
  const body = payload.kind === "question" ? { answers: payload.answers } : { reply: payload.reply };
  try {
    const response = await authenticatedFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const run = await response.json();
    if (!response.ok) throw new Error(run.message || run.error || `HTTP ${response.status}`);
    activeGeneratedRunStatus = run.status;
    postToGeneratedFrame("run.state", { run });
    postToGeneratedFrame("interaction.cleared");
  } catch (error) {
    postToGeneratedFrame("run.error", { message: error instanceof Error ? error.message : "无法提交交互响应。" });
  }
}

async function downloadGeneratedArtifact(artifactId) {
  if (!activeGeneratedRunId || typeof artifactId !== "string") return;
  const artifacts = await requestJson(`/api/runs/${encodeURIComponent(activeGeneratedRunId)}/artifacts`);
  if (!Array.isArray(artifacts) || !artifacts.some((artifact) => artifact?.id === artifactId)) {
    throw new Error("The requested artifact is not part of the active run.");
  }
  const link = document.createElement("a");
  link.href = `/api/artifacts/${encodeURIComponent(artifactId)}/download`;
  link.download = "";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

function renderGeneratedSkillPage(skill, generatedPage) {
  hubShell.hidden = true;
  skillPage.hidden = false;
  resetRouteScroll();
  activeGeneratedRunId = "";
  activeGeneratedRunStatus = "idle";
  activeGeneratedRunEventSequence = 0;
  const generatedUrl = new URL(generatedPage.url, window.location.origin);
  generatedUrl.searchParams.set("skillId", skill.id);
  skillPageContent.innerHTML = renderUserWorkspace({
    eyebrow: `${skill.provider.toUpperCase()} / GENERATED VIEW`,
    title: skill.displayName,
    description: "此页面由已审核的 Skill 页面版本提供。运行状态与产物仍由 Hub 统一管理。",
    section: "catalog",
    activeSkillId: skill.id,
    hideHeader: true,
    body: `<section class="workspace-panel generated-page-panel"><div class="workspace-panel-heading"><span>SKILL WORKSPACE</span><a class="skill-page-back" href="/">返回目录</a></div><iframe id="generatedSkillFrame" class="generated-skill-frame" title="${escapeHtml(skill.displayName)} 操作页面" sandbox="allow-scripts allow-forms" src="${escapeHtml(generatedUrl.pathname + generatedUrl.search)}"></iframe></section>`,
  });
  activeGeneratedFrame = document.getElementById("generatedSkillFrame");
  activeGeneratedFrame?.addEventListener("load", resetRouteScroll, { once: true });
}

function renderRunHistory(runs) {
  hubShell.hidden = true;
  skillPage.hidden = false;
  resetRouteScroll();
  activeGeneratedFrame = undefined;
  const rows = runs.map((run) => `<a class="run-history-item" href="/runs/${encodeURIComponent(run.id)}"><span class="run-history-mark"></span><strong>${escapeHtml(run.skillId)}</strong><span class="run-history-status">${escapeHtml(String(run.status).toUpperCase())}</span><time datetime="${escapeHtml(run.createdAt)}">${escapeHtml(new Date(run.createdAt).toLocaleString("zh-CN"))}</time></a>`).join("");
  skillPageContent.innerHTML = renderUserWorkspace({
    eyebrow: "RUN ARCHIVE / USER SCOPE",
    title: "运行历史",
    description: "查看当前账户发起的 Skill 运行、事件记录和已登记产物。",
    section: "runs",
    body: `<section class="workspace-panel run-history-panel"><div class="workspace-panel-heading"><span>RECENT RUNS</span><span>${runs.length} RECORDS</span></div><div class="run-history-list">${rows || "<p class=\"run-history-empty\">尚无运行记录。</p>"}</div></section>`,
  });
}

function renderRunDetail(run, events, artifacts) {
  hubShell.hidden = true;
  skillPage.hidden = false;
  resetRouteScroll();
  activeGeneratedFrame = undefined;
  const eventRows = events.map((event) => `<li><span class="run-event-sequence">${escapeHtml(String(event.sequence ?? ""))}</span><div><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(event.text || event.message || event.tool || event.createdAt)}</span></div></li>`).join("");
  skillPageContent.innerHTML = renderUserWorkspace({
    eyebrow: "RUN DETAIL / USER SCOPE",
    title: run.skillId,
    description: `${String(run.status).toUpperCase()} · ${new Date(run.createdAt).toLocaleString("zh-CN")}`,
    section: "runs",
    body: `<div class="run-detail-grid"><section class="workspace-panel run-detail-panel"><div class="workspace-panel-heading"><span>EVENT TIMELINE</span><a class="skill-page-back" href="/runs">返回历史</a></div><div class="run-event-log-panel"><ol class="run-events run-events-detail">${eventRows || "<li>尚未记录事件。</li>"}</ol></div></section><section class="workspace-panel run-detail-panel"><div class="workspace-panel-heading"><span>ARTIFACTS</span><span>${escapeHtml(String(run.status).toUpperCase())}</span></div><div id="runArtifacts"></div></section></div>`,
  });
  renderRunArtifacts(artifacts);
}

function renderSkillContext(skill) {
  const inputs = (skill.inputs || []).map((input) => `<li><span>${escapeHtml(input.label)}</span><em>${escapeHtml(input.kind)}${input.required ? " · <span>required</span>" : ""}</em></li>`).join("") || "<li><span>任务说明</span><em>text</em></li>";
  const outputs = (skill.outputs || []).map((output) => `<li><span>${escapeHtml(output.label)}</span><em>${escapeHtml(output.description || "result")}</em></li>`).join("") || "<li><span>运行结果显示在下方日志和结果区域。</span></li>";
  const workflow = (skill.workflow || []).map((step) => `<li>${escapeHtml(step.label)}</li>`).join("") || "<li>未声明预设工作流。</li>";
  return `<section class="workspace-panel skill-context-panel"><div class="workspace-panel-heading"><span>执行说明</span></div><div class="skill-context-content"><p>${escapeHtml(compactDescription(skill.description) || "该 Skill 将由 Hub 执行，并把运行进度、后端输出和产物集中展示。")}</p><section><h3>输入</h3><ul>${inputs}</ul></section><section><h3>输出</h3><ul>${outputs}</ul></section><section><h3>工作流</h3><ol>${workflow}</ol></section></div></section>`;
}

async function renderRunsHistoryPage() {
  try {
    renderRunHistory(await requestJson("/api/runs"));
  } catch {
    renderRouteError();
  }
}

async function renderRunDetailPage(runId) {
  try {
    const [run, events, artifacts] = await Promise.all([
      requestJson(`/api/runs/${encodeURIComponent(runId)}`),
      requestJson(`/api/runs/${encodeURIComponent(runId)}/events/history`),
      requestJson(`/api/runs/${encodeURIComponent(runId)}/artifacts`),
    ]);
    renderRunDetail(run, events, artifacts);
  } catch {
    renderRouteError();
  }
}

async function renderSkillPage(skill) {
  activeGeneratedFrame = undefined;
  hubShell.hidden = true;
  skillPage.hidden = false;
  resetRouteScroll();
  activeWorkspaceRunId = "";
  await refreshRecentRuns();
  const selectedRunId = new URLSearchParams(window.location.search).get("run") || "";
  let selectedRun;
  let selectedRunEvents = [];
  let selectedRunArtifacts = [];
  if (selectedRunId) {
    try {
      [selectedRun, selectedRunEvents, selectedRunArtifacts] = await Promise.all([
        requestJson(`/api/runs/${encodeURIComponent(selectedRunId)}`),
        requestJson(`/api/runs/${encodeURIComponent(selectedRunId)}/events/history`),
        requestJson(`/api/runs/${encodeURIComponent(selectedRunId)}/artifacts`),
      ]);
      if (selectedRun.skillId !== skill.id) selectedRun = undefined;
    } catch {
      selectedRun = undefined;
    }
  }
  const fields = (skill.inputs || []).map(renderInputField).join("");
  skillPageContent.innerHTML = renderUserWorkspace({
    eyebrow: `${skill.provider.toUpperCase()} SKILL / ${pageStateLabel(skill.pageStatus)}`,
    title: skill.displayName,
    description: compactDescription(skill.description),
    section: "catalog",
    activeSkillId: skill.id,
    hideHeader: true,
    body: `<div class="skill-workspace-console"><section class="workspace-panel skill-request-panel"><div class="workspace-panel-heading"><span>REQUEST</span><h2>${escapeHtml(skill.displayName)}</h2><span id="skillRunIndicator" class="skill-run-indicator is-idle" title="idle"></span></div><form id="skillRunForm" class="skill-run-form"><div class="skill-run-fields">${fields}</div><div class="skill-submit-row"><button type="submit" class="skill-run-submit">运行 Skill</button><span>提交后由 Hub 执行</span></div></form></section>${renderSkillContext(skill)}<section class="workspace-panel skill-events-panel"><div class="workspace-panel-heading"><span>运行日志</span></div><div class="iso-terminal"><ol id="runEvents" class="run-events"></ol></div></section><section class="workspace-panel skill-output-panel"><div class="workspace-panel-heading"><span>输出与交互</span></div><div class="iso-terminal"><section id="runMarkdownPanel" class="terminal-output-panel" hidden><div>BACKEND OUTPUT / MARKDOWN</div><div id="runMarkdownOutput" class="terminal-markdown" aria-live="polite"></div></section><div id="runOutputEmpty" class="terminal-empty">等待 Skill 输出</div></div><div id="runInteraction" class="run-interaction" aria-live="polite"></div></section><section class="workspace-panel skill-artifacts-panel" aria-live="polite"><div class="workspace-panel-heading"><span>结果与产物</span></div><div id="runArtifacts"><p class="run-artifacts-empty">运行完成后将在这里显示产物。</p></div></section></div>`,
  });
  bindRunForm(skill);
  startWorkspaceRunTreePolling(skill.id);
  if (!selectedRun) return;
  activeRunMarkdown = "";
  activeRunEventSequence = 0;
  for (const event of selectedRunEvents) {
    const sequence = Number(event.sequence);
    if (Number.isFinite(sequence) && sequence <= activeRunEventSequence) continue;
    if (Number.isFinite(sequence)) activeRunEventSequence = sequence;
    appendRunEvent(event);
  }
  updateRunPanel(selectedRun);
  renderRunArtifacts(selectedRunArtifacts);
  restoreRunInputs(skill, selectedRun.inputValues);
  if (isActiveRun(selectedRun)) subscribeToRun(selectedRun.id);
}

function renderRouteError() {
  activeGeneratedFrame = undefined;
  hubShell.hidden = true;
  skillPage.hidden = false;
  skillPageContent.innerHTML = renderUserWorkspace({
    eyebrow: "ROUTE STATUS / UNAVAILABLE",
    title: "Skill 不可用",
    description: "该 Skill 不存在、被禁用或正在更新目录。",
    section: "catalog",
    body: "<section class=\"workspace-panel workspace-empty-state\"><strong>CATALOG ENTRY UNAVAILABLE</strong><a class=\"skill-page-back\" href=\"/\">返回 Skill 目录</a></section>",
  });
}

function applyFilters() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const filter = statusFilter.value;
  state.visibleSkills = state.allSkills.filter((skill) => {
    const matchesQuery = !query || `${skill.displayName} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query);
    const matchesFilter = filter === "all" || (filter === "ready" ? skill.pageStatus === "ready" : skill.pageStatus !== "ready");
    return matchesQuery && matchesFilter;
  });
  renderStack();
  if (state.opencodeAvailable) setConnection(`${state.visibleSkills.length} / ${state.allSkills.length} ${t("SKILLS READY")}`, "ok");
  else setConnection(`${state.visibleSkills.length} / ${state.allSkills.length} ${t("OpenCode 未连接")}`, "error");
}

async function requestJson(url) {
  const response = await authenticatedFetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function initializeCatalog() {
  const [healthResult, skillsResult] = await Promise.allSettled([requestJson("/api/health"), requestJson("/api/skills")]);
  state.opencodeAvailable = healthResult.status === "fulfilled" && healthResult.value?.opencode?.status === "healthy";
  if (skillsResult.status !== "fulfilled") {
    state.allSkills = [];
    setConnection("CATALOG UNAVAILABLE", "error");
  } else {
    state.allSkills = skillsResult.value;
  }
  applyFilters();
}

function bindControls() {
  searchInput.addEventListener("input", applyFilters);
  statusFilter.addEventListener("change", applyFilters);
  skillDeck.addEventListener("pointermove", (event) => setLiftedCard(getHoverCardIndex(event)));
  skillDeck.addEventListener("pointerleave", () => setLiftedCard(null));
  skillDeck.addEventListener("click", (event) => {
    const cardIndex = getHoverCardIndex(event);
    const skill = cardIndex === null ? null : state.visibleSkills[cardIndex];
    if (skill) openSkillModal(skill, skillDeck.querySelector(`[data-card='${cardIndex}']`));
  });
  skillDeck.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); switchStack(1); }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); switchStack(-1); }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const index = state.liftedCardIndex ?? getInteractiveCardIndex();
      const skill = index === null ? null : state.visibleSkills[index];
      if (skill) openSkillModal(skill, skillDeck.querySelector(`[data-card='${index}']`));
    }
  });
  skillDeck.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.wheelLocked || Math.abs(event.deltaY) < 10) return;
    state.wheelLocked = true;
    switchStack(event.deltaY > 0 ? 1 : -1);
    window.setTimeout(() => { state.wheelLocked = false; }, 320);
  }, { passive: false });
  skillModal.addEventListener("click", (event) => { if (event.target === skillModal) closeSkillModal(); });
  skillStartButton.addEventListener("click", () => {
    const skillId = state.activeModalSkill?.id;
    if (!skillId || !state.opencodeAvailable) return;
    closeSkillModalForNavigation();
    navigateHub(`/skills/${encodeURIComponent(skillId)}`);
  });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSkillModal(); });
}

function isHubRoute(pathname) {
  return pathname === "/" || pathname === "/runs" || /^\/runs\/[^/]+$/.test(pathname) || /^\/skills\/[^/]+$/.test(pathname);
}

function navigateHub(pathname) {
  if (pathname === window.location.pathname) return;
  window.history.pushState({}, "", pathname);
  void renderHubRoute();
}

function bindHubNavigation() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.target || link.hasAttribute("download")) return;
    const destination = new URL(link.href, window.location.origin);
    if (destination.origin !== window.location.origin || !isHubRoute(destination.pathname)) return;
    event.preventDefault();
    navigateHub(`${destination.pathname}${destination.search}${destination.hash}`);
  });
  window.addEventListener("popstate", () => { if (isHubRoute(window.location.pathname)) void renderHubRoute(); });
}

async function renderHubRoute() {
  const sequence = ++hubRouteSequence;
  activeRunStream?.close();
  activeRunStream = undefined;
  window.clearInterval(workspaceRunTreeTimer);
  const route = window.location.pathname;
  if (route === "/") {
    await refreshRecentRuns();
    renderCatalogWorkspace();
    await initializeCatalog();
    refreshWorkspaceSkillTree();
    return;
  }
  if (route === "/runs") {
    await renderRunsHistoryPage();
    return;
  }
  const runRouteMatch = route.match(/^\/runs\/([^/]+)$/);
  if (runRouteMatch) {
    await renderRunDetailPage(runRouteMatch[1]);
    return;
  }
  const skillRouteMatch = route.match(/^\/skills\/([^/]+)$/);
  if (skillRouteMatch) {
    try {
      const skill = await requestJson(`/api/skills/${encodeURIComponent(skillRouteMatch[1])}`);
      if (sequence === hubRouteSequence) await renderSkillPage(skill);
    } catch {
      if (sequence === hubRouteSequence) renderRouteError();
    }
  }
}

async function init() {
  setupLanguageSwitcher();
  if (window.location.pathname === "/login" || window.location.pathname.startsWith("/admin")) return;
  try {
    const session = await requestJson("/api/auth/session");
    if (!session.authenticated) {
      window.location.assign("/login");
      return;
    }
    csrfToken = session.csrfToken || "";
    showUserSession(session);
    state.allSkills = await requestJson("/api/skills").catch(() => []);
  } catch {
    window.location.assign("/login");
    return;
  }
  bindControls();
  bindHubNavigation();
  await renderHubRoute();
}

document.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-workspace-tree-search]")) return;
  const query = input.value.trim().toLocaleLowerCase();
  document.querySelectorAll("[data-workspace-skill]").forEach((item) => { item.hidden = Boolean(query) && !item.dataset.workspaceSkill.includes(query); });
});

document.addEventListener("click", (event) => {
  const deleteButton = event.target instanceof Element ? event.target.closest("[data-run-delete]") : null;
  if (deleteButton) {
    event.preventDefault();
    const runId = deleteButton.dataset.runDelete;
    if (runId) void deleteRecentRun(runId).catch((error) => window.alert(error instanceof Error ? error.message : "无法删除该会话。"));
    return;
  }
  const languageButton = event.target instanceof Element ? event.target.closest("[data-user-language]") : null;
  if (languageButton) {
    document.getElementById("languageToggle")?.click();
    queueMicrotask(() => { languageButton.textContent = document.getElementById("languageToggle")?.textContent || "EN"; });
    return;
  }
  const logoutButton = event.target instanceof Element ? event.target.closest("[data-user-logout]") : null;
  if (logoutButton) {
    void authenticatedFetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"));
    return;
  }
  const toggle = event.target instanceof Element ? event.target.closest("[data-workspace-tree-toggle]") : null;
  if (!toggle) return;
  const panelId = toggle.dataset.workspaceTreeToggle;
  const stateKey = panelId === "skill" ? "skillTreeCollapsed" : panelId === "recent" ? "recentTreeCollapsed" : panelId === "history" ? "historyTreeCollapsed" : "";
  if (!stateKey) return;
  state[stateKey] = !state[stateKey];
  const pane = toggle.closest("[data-workspace-tree-pane]");
  pane?.classList.toggle("is-collapsed", state[stateKey]);
  toggle.setAttribute("aria-expanded", String(!state[stateKey]));
});

const workspaceTreePaneIndexes = { skill: 0, recent: 1, history: 2 };

function setWorkspaceTreeSizes(sizes, { persist = false } = {}) {
  state.workspaceTreeSizes = sizes.map((size) => Math.max(0.25, Number(size) || 0.25));
  const panes = document.querySelector(".workspace-tree-panes");
  if (panes instanceof HTMLElement) {
    panes.style.setProperty("--workspace-skill-size", String(state.workspaceTreeSizes[0]));
    panes.style.setProperty("--workspace-recent-size", String(state.workspaceTreeSizes[1]));
    panes.style.setProperty("--workspace-history-size", String(state.workspaceTreeSizes[2]));
  }
  if (persist) localStorage.setItem(workspaceTreeLayoutStorageKey, JSON.stringify(state.workspaceTreeSizes));
}

function resizeWorkspaceTreePair(resizer, previousSize, { persist = false } = {}) {
  const [previousId, nextId] = String(resizer.dataset.workspaceTreeResizer || "").split("-");
  const previousIndex = workspaceTreePaneIndexes[previousId];
  const nextIndex = workspaceTreePaneIndexes[nextId];
  if (previousIndex === undefined || nextIndex === undefined) return;
  const pairSize = state.workspaceTreeSizes[previousIndex] + state.workspaceTreeSizes[nextIndex];
  const nextSizes = [...state.workspaceTreeSizes];
  nextSizes[previousIndex] = Math.min(pairSize - 0.25, Math.max(0.25, previousSize));
  nextSizes[nextIndex] = pairSize - nextSizes[previousIndex];
  setWorkspaceTreeSizes(nextSizes, { persist });
}

document.addEventListener("pointerdown", (event) => {
  const resizer = event.target instanceof Element ? event.target.closest("[data-workspace-tree-resizer]") : null;
  if (!(resizer instanceof HTMLElement)) return;
  const previousPane = resizer.previousElementSibling;
  const nextPane = resizer.nextElementSibling;
  if (!(previousPane instanceof HTMLElement) || !(nextPane instanceof HTMLElement) || previousPane.classList.contains("is-collapsed") || nextPane.classList.contains("is-collapsed")) return;
  const [previousId, nextId] = String(resizer.dataset.workspaceTreeResizer || "").split("-");
  const previousIndex = workspaceTreePaneIndexes[previousId];
  const nextIndex = workspaceTreePaneIndexes[nextId];
  if (previousIndex === undefined || nextIndex === undefined) return;
  workspaceTreeResize = {
    pointerId: event.pointerId,
    resizer,
    previousIndex,
    nextIndex,
    startY: event.clientY,
    previousHeight: previousPane.getBoundingClientRect().height,
    nextHeight: nextPane.getBoundingClientRect().height,
    pairSize: state.workspaceTreeSizes[previousIndex] + state.workspaceTreeSizes[nextIndex],
  };
  resizer.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

document.addEventListener("pointermove", (event) => {
  if (!workspaceTreeResize || event.pointerId !== workspaceTreeResize.pointerId) return;
  const totalHeight = workspaceTreeResize.previousHeight + workspaceTreeResize.nextHeight;
  const minimumHeight = Math.min(100, Math.max(36, totalHeight / 3));
  const previousHeight = Math.min(totalHeight - minimumHeight, Math.max(minimumHeight, workspaceTreeResize.previousHeight + event.clientY - workspaceTreeResize.startY));
  resizeWorkspaceTreePair(workspaceTreeResize.resizer, workspaceTreeResize.pairSize * (previousHeight / totalHeight));
});

function finishWorkspaceTreeResize(event) {
  if (!workspaceTreeResize || event.pointerId !== workspaceTreeResize.pointerId) return;
  workspaceTreeResize = undefined;
  setWorkspaceTreeSizes(state.workspaceTreeSizes, { persist: true });
}

document.addEventListener("pointerup", finishWorkspaceTreeResize);
document.addEventListener("pointercancel", finishWorkspaceTreeResize);

document.addEventListener("keydown", (event) => {
  const resizer = event.target instanceof Element ? event.target.closest("[data-workspace-tree-resizer]") : null;
  if (!(resizer instanceof HTMLElement) || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const [previousId, nextId] = String(resizer.dataset.workspaceTreeResizer || "").split("-");
  const previousIndex = workspaceTreePaneIndexes[previousId];
  const nextIndex = workspaceTreePaneIndexes[nextId];
  if (previousIndex === undefined || nextIndex === undefined) return;
  event.preventDefault();
  const pairSize = state.workspaceTreeSizes[previousIndex] + state.workspaceTreeSizes[nextIndex];
  const currentSize = state.workspaceTreeSizes[previousIndex];
  const targetSize = event.key === "Home" ? pairSize * 0.15 : event.key === "End" ? pairSize * 0.85 : currentSize + (event.key === "ArrowDown" ? pairSize * 0.05 : -pairSize * 0.05);
  resizeWorkspaceTreePair(resizer, targetSize, { persist: true });
});

window.addEventListener("message", (event) => {
  if (!activeGeneratedFrame || event.source !== activeGeneratedFrame.contentWindow || !event.data || event.data.channel !== "skill-web-hub-runtime") return;
  const payload = event.data;
  const routeMatch = window.location.pathname.match(/^\/skills\/([^/]+)$/);
  if (!routeMatch) return;
  void requestJson(`/api/skills/${encodeURIComponent(routeMatch[1])}`).then((skill) => {
    if (payload.type === "run.start") return startGeneratedRun(skill, payload.inputs);
    if (payload.type === "run.followup") return followUpGeneratedRun(payload);
    if (payload.type === "run.abort" && payload.runId === activeGeneratedRunId) {
      return authenticatedFetch(`/api/runs/${encodeURIComponent(payload.runId)}/abort`, { method: "POST" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("无法终止运行。")))
        .then((run) => {
          activeGeneratedRunStatus = run.status;
          postToGeneratedFrame("run.state", { run });
        });
    }
    if (payload.type === "interaction.reply") return replyFromGeneratedRun(payload);
    if (payload.type === "artifact.download") return downloadGeneratedArtifact(payload.artifactId);
    return undefined;
  }).catch((error) => postToGeneratedFrame("run.error", { message: error instanceof Error ? error.message : "页面运行时不可用。" }));
});

void init();
