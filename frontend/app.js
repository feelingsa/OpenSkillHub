import { createMotionScope } from "./motion/index.js";
import { renderConnectionState } from "./components/connection-state.js";
import { compactDescription, escapeHtml, pageStateLabel, renderSkillCard, toneFor } from "./components/skill-card.js";
import { getActiveCardIndex, getStackLayout, maxVisibleStackCards, renderSkillDeck } from "./components/skill-deck.js";
import { renderSkillPreview } from "./components/skill-preview-modal.js";

const hubShell = document.querySelector(".hub-shell");
const skillDeck = document.getElementById("skillDeck");
const connectionState = document.getElementById("connectionState");
const searchInput = document.getElementById("skillSearch");
const statusFilter = document.getElementById("skillFilter");
const skillModal = document.getElementById("skillModal");
const skillModalWindow = skillModal?.querySelector(".skill-modal-window");
const skillModalHero = document.getElementById("skillModalHero");
const skillModalTitle = document.getElementById("skillModalTitle");
const skillModalContent = document.getElementById("skillModalContent");
const skillStartButton = document.getElementById("skillStartButton");
const skillPage = document.getElementById("skillPage");
const skillPageContent = document.getElementById("skillPageContent");
const motion = createMotionScope(document.body);
let activeRunStream;
let activeGeneratedFrame;
let activeGeneratedRunId = "";
let activeGeneratedRunStatus = "idle";

const state = {
  allSkills: [],
  visibleSkills: [],
  activeModalSkill: null,
  opencodeAvailable: false,
  stackOffset: 0,
  liftedCardIndex: null,
  wheelLocked: false,
};

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

function applyStackPositions(animate) {
  const cards = [...skillDeck.querySelectorAll(".skill-window")];
  const count = cards.length;
  if (!count) return;
  const focusSlot = count - 1;
  const visibleStart = Math.max(0, count - maxVisibleStackCards);
  const visibleCount = count - visibleStart;
  const { startY, gapY } = getStackLayout(visibleCount);
  cards.forEach((card, index) => {
    const slot = (index + state.stackOffset + count) % count;
    const isVisible = slot >= visibleStart;
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
      y: visibleCount === 1 ? 12 : startY + displaySlot * gapY + (isFocus ? 68 : 0) + (isLifted ? -48 : 0),
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

function getHoverCardIndex(event) {
  const targetCard = event.target instanceof Element ? event.target.closest(".skill-window") : null;
  if (targetCard?.dataset.card) {
    const index = Number(targetCard.dataset.card);
    if (Number.isInteger(index) && index >= 0 && index < state.visibleSkills.length) return index;
  }

  const cards = [...skillDeck.querySelectorAll(".skill-window")];
  const count = cards.length;
  if (!count) return null;
  const visibleStart = Math.max(0, count - maxVisibleStackCards);
  const visibleCount = count - visibleStart;
  const { startY, gapY } = getStackLayout(visibleCount);
  const deckRect = skillDeck.getBoundingClientRect();
  const centerX = deckRect.left + deckRect.width / 2;
  const baseY = deckRect.top + deckRect.height * 0.54;
  const focusSlot = count - 1;
  const candidates = cards.map((card, index) => {
    const slot = (index + state.stackOffset + count) % count;
    if (slot < visibleStart) return null;
    const displaySlot = slot - visibleStart;
    const scale = slot === focusSlot ? 1 : 0.78 + displaySlot / Math.max(visibleCount - 1, 1) * 0.28;
    return { index, slot, top: baseY + startY + displaySlot * gapY - (card.offsetHeight * scale) / 2, halfWidth: card.offsetWidth * scale / 2 };
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
  skillStartButton.textContent = state.opencodeAvailable ? "开始使用" : "OpenCode 离线";
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
  const type = input.kind === "number" ? "number" : input.kind === "url" ? "url" : "text";
  const fileHint = input.kind === "file" ? "请输入已上传文件的 ID（上传功能将在产物阶段接入）" : "";
  return `<label class="skill-run-field"><span>${escapeHtml(input.label)}${input.required ? " *" : ""}</span><input name="${escapeHtml(input.id)}" type="${type}"${input.defaultValue !== undefined ? ` value="${escapeHtml(String(input.defaultValue))}"` : ""}${fileHint ? ` placeholder="${fileHint}"` : ""}${required} />${description}</label>`;
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
  const detail = event.message || event.text || event.tool || event.question || event.permission || event.artifactId || "";
  item.textContent = `#${event.sequence} ${event.type}${detail ? `: ${detail}` : ""}`;
  list.append(item);
  if (event.type === "artifact.created") {
    const runId = document.getElementById("runAbortButton")?.dataset.runId;
    if (runId) void loadRunArtifacts(runId);
  }
  if (event.type === "question.pending" || event.type === "permission.pending") renderPendingInteraction(event);
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

async function replyToPendingInteraction(event) {
  const container = document.getElementById("runInteraction");
  const abort = document.getElementById("runAbortButton");
  const runId = abort?.dataset.runId;
  if (!container || !runId) return;
  const requestId = container.querySelector("[data-request-id]")?.dataset.requestId;
  if (!requestId) return;
  const isQuestion = event.type === "submit";
  const body = isQuestion
    ? { answers: [String(new FormData(event.currentTarget).get("answer") || "").split(",").map((value) => value.trim()).filter(Boolean)] }
    : { reply: event.target.dataset.permissionReply };
  const endpoint = isQuestion
    ? `/api/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/reply`
    : `/api/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/reply`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const summary = document.getElementById("runSummary");
    if (summary) summary.textContent = payload.message || payload.error || "无法提交交互响应。";
    return;
  }
  updateRunPanel(await response.json());
  container.replaceChildren();
}

function subscribeToRun(runId) {
  activeRunStream?.close();
  activeRunStream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  const eventTypes = ["run.created", "run.started", "message.delta", "tool.started", "tool.finished", "question.pending", "permission.pending", "artifact.created", "run.completed", "run.failed", "run.aborted"];
  for (const type of eventTypes) {
    activeRunStream.addEventListener(type, (message) => {
      const event = JSON.parse(message.data);
      appendRunEvent(event);
      if (["run.completed", "run.failed", "run.aborted"].includes(event.type)) {
        const stream = activeRunStream;
        void Promise.all([
          requestJson(`/api/runs/${encodeURIComponent(runId)}`).then(updateRunPanel),
          loadRunArtifacts(runId),
        ]).finally(() => {
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
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) continue;
      values[input.id] = input.kind === "boolean" ? field.checked : field.value;
    }
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillId: skill.id, inputs: values }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      document.getElementById("runEvents").replaceChildren();
      renderRunArtifacts([]);
      updateRunPanel(payload);
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
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/abort`, { method: "POST" });
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

function normalizeGeneratedInputs(skill, rawInputs) {
  const submitted = rawInputs && typeof rawInputs === "object" && !Array.isArray(rawInputs) ? rawInputs : {};
  const inputs = {};
  for (const input of skill.inputs || []) {
    const value = submitted[input.id];
    if (input.kind === "boolean") inputs[input.id] = value === true;
    else if (input.kind === "number") inputs[input.id] = typeof value === "number" ? value : Number(value);
    else if (value !== undefined) inputs[input.id] = String(value);
  }
  return inputs;
}

function subscribeGeneratedRun(runId) {
  activeRunStream?.close();
  activeRunStream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  const eventTypes = ["run.created", "run.started", "message.delta", "tool.started", "tool.finished", "question.pending", "permission.pending", "artifact.created", "run.completed", "run.failed", "run.aborted"];
  for (const type of eventTypes) {
    activeRunStream.addEventListener(type, (message) => {
      const event = JSON.parse(message.data);
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
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: skill.id, inputs: normalizeGeneratedInputs(skill, rawInputs) }),
    });
    const run = await response.json();
    if (!response.ok) throw new Error(run.message || run.error || `HTTP ${response.status}`);
    activeGeneratedRunId = run.id;
    activeGeneratedRunStatus = run.status;
    postToGeneratedFrame("run.state", { run });
    subscribeGeneratedRun(run.id);
  } catch (error) {
    postToGeneratedFrame("run.error", { message: error instanceof Error ? error.message : "无法创建运行。" });
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
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  activeGeneratedRunId = "";
  activeGeneratedRunStatus = "idle";
  const generatedUrl = new URL(generatedPage.url, window.location.origin);
  generatedUrl.searchParams.set("skillId", skill.id);
  skillPageContent.innerHTML = `<a class="skill-page-back" href="/">返回 Skill 目录</a><iframe id="generatedSkillFrame" class="generated-skill-frame" title="${escapeHtml(skill.displayName)} 操作页面" sandbox="allow-scripts" src="${escapeHtml(generatedUrl.pathname + generatedUrl.search)}"></iframe>`;
  activeGeneratedFrame = document.getElementById("generatedSkillFrame");
}

function renderRunHistory(runs) {
  hubShell.hidden = true;
  skillPage.hidden = false;
  activeGeneratedFrame = undefined;
  const rows = runs.map((run) => `<a class="run-history-item" href="/runs/${encodeURIComponent(run.id)}"><strong>${escapeHtml(run.skillId)}</strong><span>${escapeHtml(String(run.status).toUpperCase())}</span><time datetime="${escapeHtml(run.createdAt)}">${escapeHtml(new Date(run.createdAt).toLocaleString("zh-CN"))}</time></a>`).join("");
  skillPageContent.innerHTML = `<a class="skill-page-back" href="/">返回 Skill 目录</a><h1>运行历史</h1><p>查看当前服务保存的运行状态、事件和可下载产物。</p><section class="run-history-list">${rows || "<p class=\"run-history-empty\">尚无运行记录。</p>"}</section>`;
}

function renderRunDetail(run, events, artifacts) {
  hubShell.hidden = true;
  skillPage.hidden = false;
  activeGeneratedFrame = undefined;
  const eventRows = events.map((event) => `<li><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(event.createdAt)}</span></li>`).join("");
  skillPageContent.innerHTML = `<a class="skill-page-back" href="/runs">返回运行历史</a><h1>${escapeHtml(run.skillId)}</h1><p>${escapeHtml(String(run.status).toUpperCase())} · ${escapeHtml(run.createdAt)}</p><section class="run-detail-panel"><h2>事件时间线</h2><ol class="run-events">${eventRows || "<li>尚未记录事件。</li>"}</ol></section><section class="run-detail-panel"><h2>运行产物</h2><div id="runArtifacts"></div></section>`;
  renderRunArtifacts(artifacts);
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
  const generatedPage = await requestJson(`/api/skills/${encodeURIComponent(skill.id)}/page`).catch(() => undefined);
  if (generatedPage?.status === "ready" && typeof generatedPage.url === "string") {
    renderGeneratedSkillPage(skill, generatedPage);
    return;
  }
  activeGeneratedFrame = undefined;
  hubShell.hidden = true;
  skillPage.hidden = false;
  const fields = (skill.inputs || []).map(renderInputField).join("");
  skillPageContent.innerHTML = `
    <span class="meta-kicker">${escapeHtml(skill.provider.toUpperCase())} SKILL · ${escapeHtml(pageStateLabel(skill.pageStatus))}</span>
    <h1>${escapeHtml(skill.displayName)}</h1>
    <p>${escapeHtml(compactDescription(skill.description))}</p>
    <form id="skillRunForm" class="skill-run-form">
      <div class="skill-run-fields">${fields}</div>
      <button type="submit" class="skill-run-submit">运行 Skill</button>
    </form>
    <section class="skill-run-panel" aria-live="polite">
      <header><span>运行状态</span><strong id="runStatus">IDLE</strong></header>
      <p id="runSummary">提交后将由服务端验证参数并创建运行。</p>
      <div class="run-result-meta"><span id="runDuration">耗时：-</span><span id="runArtifactCount">产物：0</span></div>
      <ol id="runEvents" class="run-events"></ol>
      <div id="runInteraction" class="run-interaction" aria-live="polite"></div>
      <section class="run-artifacts" aria-live="polite"><h2>运行产物</h2><div id="runArtifacts"><p class="run-artifacts-empty">运行完成后将在这里显示产物。</p></div></section>
      <button id="runAbortButton" class="skill-run-abort" type="button" disabled>终止运行</button>
    </section>
  `;
  bindRunForm(skill);
}

function renderRouteError() {
  activeGeneratedFrame = undefined;
  hubShell.hidden = true;
  skillPage.hidden = false;
  skillPageContent.innerHTML = "<h1>Skill 不可用</h1><p>该 Skill 不存在、被禁用或正在更新目录。</p>";
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
  if (state.opencodeAvailable) setConnection(`${state.visibleSkills.length} / ${state.allSkills.length} SKILLS READY`, "ok");
  else setConnection(`${state.visibleSkills.length} / ${state.allSkills.length} SKILLS · OPENCODE OFFLINE`, "error");
}

async function requestJson(url) {
  const response = await fetch(url, { cache: "no-store" });
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
      const index = state.liftedCardIndex ?? getActiveCardIndex(state.visibleSkills.length, state.stackOffset);
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
    if (state.activeModalSkill && state.opencodeAvailable) window.location.assign(`/skills/${encodeURIComponent(state.activeModalSkill.id)}`);
  });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSkillModal(); });
}

async function init() {
  if (window.location.pathname === "/login" || window.location.pathname.startsWith("/admin")) return;
  if (window.location.pathname === "/runs") {
    await renderRunsHistoryPage();
    return;
  }
  const runRouteMatch = window.location.pathname.match(/^\/runs\/([^/]+)$/);
  if (runRouteMatch) {
    await renderRunDetailPage(runRouteMatch[1]);
    return;
  }
  const routeMatch = window.location.pathname.match(/^\/skills\/([^/]+)$/);
  if (routeMatch) {
    try {
      await renderSkillPage(await requestJson(`/api/skills/${encodeURIComponent(routeMatch[1])}`));
    } catch {
      renderRouteError();
    }
    return;
  }
  bindControls();
  await initializeCatalog();
}

window.addEventListener("message", (event) => {
  if (!activeGeneratedFrame || event.source !== activeGeneratedFrame.contentWindow || !event.data || event.data.channel !== "skill-web-hub-runtime") return;
  const payload = event.data;
  const routeMatch = window.location.pathname.match(/^\/skills\/([^/]+)$/);
  if (!routeMatch) return;
  void requestJson(`/api/skills/${encodeURIComponent(routeMatch[1])}`).then((skill) => {
    if (payload.type === "run.start") return startGeneratedRun(skill, payload.inputs);
    if (payload.type === "run.abort" && payload.runId === activeGeneratedRunId) {
      return fetch(`/api/runs/${encodeURIComponent(payload.runId)}/abort`, { method: "POST" })
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
