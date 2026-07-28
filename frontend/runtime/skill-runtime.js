const channel = "skill-web-hub-runtime";
const form = document.querySelector("[data-skill-form]");
const statusMount = document.querySelector("[data-run-status]");
const eventMount = document.querySelector("[data-run-events]");
const interactionMount = document.querySelector("[data-run-interaction]");
const artifactMount = document.querySelector("[data-run-artifacts]");
const resultMount = document.querySelector("[data-run-result]") || (() => {
  if (!eventMount) return undefined;
  const section = document.createElement("section");
  section.dataset.runResult = "";
  section.hidden = true;
  const heading = document.createElement("h3");
  heading.textContent = "文本结果";
  const content = document.createElement("pre");
  content.dataset.runResultContent = "";
  section.append(heading, content);
  eventMount.after(section);
  return section;
})();
const followUpMount = document.querySelector("[data-run-followup]") || (() => {
  if (!eventMount) return undefined;
  const section = document.createElement("section");
  section.dataset.runFollowup = "";
  section.hidden = true;
  const heading = document.createElement("h3");
  heading.textContent = "继续互动";
  const form = document.createElement("form");
  form.dataset.runFollowupForm = "";
  const input = document.createElement("textarea");
  input.name = "message";
  input.rows = 3;
  input.required = true;
  input.placeholder = "输入补充、修改意见或下一步要求...";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "发送";
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || !activeRunId) return;
    input.value = "";
    submit.disabled = true;
    send("run.followup", { runId: activeRunId, message });
  });
  section.append(heading, form);
  (resultMount || eventMount).after(section);
  return section;
})();
let activeRunId = "";

if (eventMount) {
  eventMount.classList.add("skill-runtime-event-log");
  const style = document.createElement("style");
  style.textContent = ".skill-runtime-event-log { max-block-size: 260px; overflow-y: auto; margin-block: 12px; padding: 10px; border: 1px solid color-mix(in srgb, currentColor, transparent 76%); background: rgb(0 0 0 / 8%); scrollbar-width: thin; } .skill-runtime-event-log:empty { display: none; } .skill-runtime-event-log > :first-child { margin-top: 0; } .skill-runtime-event-log > :last-child { margin-bottom: 0; }";
  document.head.append(style);
}

function send(type, payload = {}) {
  window.parent.postMessage({ channel, type, ...payload }, "*");
}

function setStatus(run) {
  if (!statusMount) return;
  statusMount.replaceChildren();
  const state = document.createElement("strong");
  state.textContent = String(run.status || "idle").toUpperCase();
  const summary = document.createElement("p");
  summary.textContent = run.errorMessage || run.summary || (run.id ? `运行 ${run.id}` : "准备就绪");
  statusMount.append(state, summary);
  activeRunId = run.id || activeRunId;
  if (followUpMount) {
    const available = Boolean(activeRunId) && run.status === "completed";
    followUpMount.hidden = !available;
    const submit = followUpMount.querySelector("button[type=submit]");
    if (submit instanceof HTMLButtonElement) submit.disabled = !available;
  }
  if (activeRunId && !["completed", "failed", "aborted"].includes(run.status)) {
    const abort = document.createElement("button");
    abort.type = "button";
    abort.textContent = "终止运行";
    abort.addEventListener("click", () => send("run.abort", { runId: activeRunId }));
    statusMount.append(abort);
  }
}

function appendEvent(event) {
  if (!eventMount) return;
  const item = document.createElement("p");
  const detail = event.message || event.text || event.tool || event.question || event.permission || event.artifactId || "";
  item.textContent = `${event.type}${detail ? `: ${detail}` : ""}`;
  eventMount.append(item);
  eventMount.scrollTop = eventMount.scrollHeight;
  if (event.type === "message.delta" && typeof event.text === "string" && event.text) {
    const content = resultMount?.querySelector("[data-run-result-content]");
    if (content) {
      content.textContent += event.text;
      resultMount.hidden = false;
    }
  }
}

function clearTextResult() {
  const content = resultMount?.querySelector("[data-run-result-content]");
  if (content) content.textContent = "";
  if (resultMount) resultMount.hidden = true;
}

function renderInteraction(event) {
  if (!interactionMount) return;
  interactionMount.replaceChildren();
  if (event.type === "question.pending") {
    const question = document.createElement("p");
    question.textContent = event.question || "需要回答问题";
    const input = document.createElement("input");
    input.required = true;
    input.placeholder = "回答";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = "提交回答";
    submit.addEventListener("click", () => send("interaction.reply", {
      runId: activeRunId,
      kind: "question",
      requestId: event.questionId,
      answers: [input.value.split(",").map((value) => value.trim()).filter(Boolean)],
    }));
    interactionMount.append(question, input, submit);
    return;
  }
  const permission = document.createElement("p");
  permission.textContent = event.permission || "需要权限";
  for (const [reply, label] of [["once", "允许一次"], ["reject", "拒绝"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => send("interaction.reply", { runId: activeRunId, kind: "permission", requestId: event.permissionId, reply }));
    interactionMount.append(button);
  }
  interactionMount.prepend(permission);
}

function renderArtifacts(artifacts) {
  if (!artifactMount) return;
  artifactMount.replaceChildren();
  if (!artifacts.length) {
    const empty = document.createElement("p");
    empty.textContent = "尚未生成可下载产物。";
    artifactMount.append(empty);
    return;
  }
  for (const artifact of artifacts) {
    const item = document.createElement("article");
    const name = document.createElement("strong");
    name.textContent = artifact.displayName;
    const meta = document.createElement("p");
    meta.textContent = `${artifact.mimeType} · ${artifact.sizeBytes} B`;
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "下载";
    download.addEventListener("click", () => send("artifact.download", { artifactId: String(artifact.id) }));
    item.append(name, meta, download);
    artifactMount.append(item);
  }
}

function collectInputs() {
  const inputs = {};
  if (!form) return inputs;
  for (const field of form.querySelectorAll("[name]")) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) continue;
    if (field instanceof HTMLInputElement && field.type === "checkbox") inputs[field.name] = field.checked;
    else if (field instanceof HTMLInputElement && field.type === "file") inputs[field.name] = field.files?.[0] || "";
    else inputs[field.name] = field.value;
  }
  return inputs;
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  eventMount?.replaceChildren();
  clearTextResult();
  if (followUpMount) followUpMount.hidden = true;
  renderArtifacts([]);
  send("run.start", { inputs: collectInputs() });
});

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || !event.data || event.data.channel !== channel) return;
  const message = event.data;
  if (message.type === "run.state") setStatus(message.run || {});
  if (message.type === "run.event") {
    appendEvent(message.event || {});
    if (message.event?.type === "question.pending" || message.event?.type === "permission.pending") renderInteraction(message.event);
  }
  if (message.type === "run.artifacts") renderArtifacts(Array.isArray(message.artifacts) ? message.artifacts : []);
  if (message.type === "run.error") {
    setStatus({ status: "failed", errorMessage: message.message || "运行请求失败。" });
  }
  if (message.type === "interaction.cleared") interactionMount?.replaceChildren();
});

send("runtime.ready");
