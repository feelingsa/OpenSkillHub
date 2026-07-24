const root = document.querySelector("#adminRoot");
const isAdminRoute = window.location.pathname === "/login" || window.location.pathname.startsWith("/admin");

const navItems = [
  ["/admin", "Overview"], ["/admin/providers", "Providers"], ["/admin/skills", "Skills"],
  ["/admin/page-generation", "Page generation"], ["/admin/runs", "Runs"], ["/admin/users", "Users"], ["/admin/storage", "Storage"],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "REQUEST_FAILED");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function renderLogin(message = "") {
  root.hidden = false;
  root.innerHTML = `<section class="admin-login"><div class="admin-login-card"><p class="admin-eyebrow">SKILL WEB HUB</p><h1>Administrator access</h1><p>Use the administrator credentials configured on this Hub host.</p><form id="adminLoginForm"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><p class="admin-error" role="alert">${escapeHtml(message)}</p><button type="submit">Sign in</button></form></div></section>`;
  root.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      window.location.assign("/admin");
    } catch { renderLogin("The username or password is not valid."); }
  });
}

function valueStatus(status) { return `<span class="admin-status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`; }
function table(headers, rows) { return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="admin-empty">No records.</td></tr>`}</tbody></table></div>`; }

function shell(title, body, session) {
  root.hidden = false;
  root.innerHTML = `<aside class="admin-sidebar"><a class="admin-brand" href="/admin">SKILL<br>WEB HUB</a><nav>${navItems.map(([href, label]) => `<a href="${href}" class="${window.location.pathname === href ? "is-current" : ""}">${label}</a>`).join("")}</nav><div class="admin-sidebar-footer"><span>${escapeHtml(session.username)}</span><button id="adminLogout" class="admin-quiet-button">Sign out</button><a href="/">Open user Hub</a></div></aside><section class="admin-workspace"><header class="admin-topbar"><div><p class="admin-eyebrow">ADMIN CONSOLE</p><h1>${escapeHtml(title)}</h1></div><div id="adminNotice" role="status"></div></header><div class="admin-content">${body}</div></section>`;
  root.querySelector("#adminLogout").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); });
}

function setNotice(message, kind = "") { const element = root.querySelector("#adminNotice"); if (element) element.innerHTML = `<span class="admin-notice ${kind}">${escapeHtml(message)}</span>`; }

async function renderOverview(session) {
  const data = await api("/api/admin/overview");
  shell("System overview", `<div class="admin-metrics"><article><span>Provider</span><strong>${escapeHtml(data.provider.status)}</strong><small>${escapeHtml(data.provider.provider)}</small></article><article><span>Skills</span><strong>${data.skills.enabled} / ${data.skills.total}</strong><small>enabled</small></article><article><span>Pages</span><strong>${data.pages.queued + data.pages.generating}</strong><small>queue active</small></article><article><span>Runs</span><strong>${data.runs.active}</strong><small>active of ${data.runs.total}</small></article></div><section class="admin-panel"><h2>Service status</h2><dl class="admin-definition"><div><dt>Node</dt><dd>${escapeHtml(data.runtime.node)}</dd></div><div><dt>Scanner interval</dt><dd>${Math.round(data.runtime.scannerIntervalMs / 1000)} seconds</dd></div><div><dt>Artifacts</dt><dd>${data.storage.artifacts} files, ${Math.round(data.storage.artifactBytes / 1024)} KB</dd></div></dl></section>`, session);
}

async function renderProviders(session) {
  const providers = await api("/api/admin/providers");
  shell("Providers", `<section class="admin-panel"><div class="admin-panel-heading"><h2>OpenCode connection</h2><button id="testProvider">Run health check</button></div>${table(["Provider", "State", "Last checked", "Capabilities"], providers.map((provider) => `<tr><td>${escapeHtml(provider.provider)}</td><td>${valueStatus(provider.status)}</td><td>${escapeHtml(new Date(provider.checkedAt).toLocaleString())}</td><td>${escapeHtml((provider.capabilities || []).join(", ") || "Not reported")}</td></tr>`).join(""))}</section>`, session);
  root.querySelector("#testProvider").addEventListener("click", async () => { setNotice("Checking..."); try { const state = await api("/api/admin/providers/opencode/test", { method: "POST" }); setNotice(`Provider is ${state.status}`, "success"); } catch { setNotice("Health check failed", "error"); } });
}

async function renderSkills(session) {
  const skills = await api("/api/admin/skills");
  shell("Skill catalog", `<section class="admin-panel"><div class="admin-panel-heading"><h2>${skills.length} discovered Skills</h2><button id="scanSkills">Scan catalog</button></div>${table(["Skill", "State", "Page", "Updated", "Actions"], skills.map((skill) => `<tr><td><strong>${escapeHtml(skill.displayName)}</strong><small>${escapeHtml(skill.description)}</small></td><td>${valueStatus(skill.enabled ? "enabled" : "disabled")}</td><td>${valueStatus(skill.pageStatus)}</td><td>${escapeHtml(new Date(skill.lastScannedAt).toLocaleString())}</td><td><button class="admin-inline-action" data-skill-toggle="${escapeHtml(skill.id)}" data-enabled="${!skill.enabled}">${skill.enabled ? "Disable" : "Enable"}</button><button class="admin-inline-action" data-page-generate="${escapeHtml(skill.id)}">Generate</button></td></tr>`).join(""))}</section>`, session);
  root.querySelector("#scanSkills").addEventListener("click", async () => { setNotice("Scanning catalog..."); try { const outcome = await api("/api/admin/skills/scan", { method: "POST" }); setNotice(`Scan completed: ${outcome.total} Skills`, "success"); setTimeout(() => void renderSkills(session), 300); } catch { setNotice("Scan failed", "error"); } });
  root.querySelectorAll("[data-skill-toggle]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/admin/skills/${encodeURIComponent(button.dataset.skillToggle)}/enabled`, { method: "POST", body: JSON.stringify({ enabled: button.dataset.enabled === "true" }) }); void renderSkills(session); }));
  root.querySelectorAll("[data-page-generate]").forEach((button) => button.addEventListener("click", async () => { setNotice("Page generation queued..."); await api(`/api/admin/skills/${encodeURIComponent(button.dataset.pageGenerate)}/page/generate`, { method: "POST", body: JSON.stringify({ force: true }) }); setNotice("Page generation queued", "success"); }));
}

async function renderPages(session) {
  const pages = await api("/api/admin/pages");
  shell("Page generation", `<section class="admin-panel"><div class="admin-panel-heading"><h2>Generated page versions</h2><span class="admin-muted">Prompt contract: persisted on each version</span></div>${table(["Skill", "Version", "Preset", "State", "Updated", "Action"], pages.map((page) => `<tr><td>${escapeHtml(page.skillId)}</td><td>${escapeHtml(page.version)}</td><td>${escapeHtml(page.preset)}</td><td>${valueStatus(page.status)} ${page.active ? "active" : ""}</td><td>${escapeHtml(new Date(page.updatedAt).toLocaleString())}</td><td>${page.status === "ready" && !page.active ? `<button class="admin-inline-action" data-page-activate="${escapeHtml(page.skillId)}" data-version="${escapeHtml(page.version)}">Activate</button>` : ""}</td></tr>`).join(""))}</section>`, session);
  root.querySelectorAll("[data-page-activate]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/admin/pages/${encodeURIComponent(button.dataset.pageActivate)}/activate/${encodeURIComponent(button.dataset.version)}`, { method: "POST" }); void renderPages(session); }));
}

async function renderRuns(session) {
  const runs = await api("/api/admin/runs");
  shell("Global runs", `<section class="admin-panel">${table(["Skill", "Status", "Created", "Summary", "Action"], runs.map((run) => `<tr><td>${escapeHtml(run.skillId)}</td><td>${valueStatus(run.status)}</td><td>${escapeHtml(new Date(run.createdAt).toLocaleString())}</td><td>${escapeHtml(run.summary || run.errorMessage || "-")}</td><td>${["created", "running", "waiting_question", "waiting_permission"].includes(run.status) ? `<button class="admin-inline-action admin-danger" data-run-abort="${escapeHtml(run.id)}">Terminate</button>` : ""}</td></tr>`).join(""))}</section>`, session);
  root.querySelectorAll("[data-run-abort]").forEach((button) => button.addEventListener("click", async () => { if (!window.confirm("Terminate this run?")) return; await api(`/api/admin/runs/${encodeURIComponent(button.dataset.runAbort)}/abort`, { method: "POST" }); void renderRuns(session); }));
}

async function renderUsers(session) {
  const data = await api("/api/admin/users");
  shell("Users and sessions", `<section class="admin-panel"><h2>Bootstrap administrator</h2>${table(["Username", "Role", "Source"], `<tr><td>${escapeHtml(data.bootstrapAdministrator.username)}</td><td>${escapeHtml(data.bootstrapAdministrator.role)}</td><td>${escapeHtml(data.bootstrapAdministrator.source)}</td></tr>`)}<p class="admin-muted">${escapeHtml(data.multiUserManagement)}</p></section>`, session);
}

async function renderStorage(session) {
  const data = await api("/api/admin/storage");
  shell("Storage", `<div class="admin-metrics"><article><span>Artifacts</span><strong>${data.artifacts}</strong><small>${Math.round(data.artifactBytes / 1024)} KB</small></article><article><span>Runs</span><strong>${data.runs}</strong></article><article><span>Page versions</span><strong>${data.generatedPages}</strong></article><article><span>Skills</span><strong>${data.skills}</strong></article></div><section class="admin-panel"><h2>Retention</h2><p class="admin-muted">Automatic cleanup is intentionally deferred to M6 so operator data is never deleted without a confirmed retention policy.</p></section>`, session);
}

async function init() {
  if (!isAdminRoute) return;
  document.querySelector(".hub-shell").hidden = true;
  const session = await api("/api/auth/session").catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  const route = window.location.pathname;
  const renderers = { "/admin": renderOverview, "/admin/providers": renderProviders, "/admin/skills": renderSkills, "/admin/page-generation": renderPages, "/admin/runs": renderRuns, "/admin/users": renderUsers, "/admin/storage": renderStorage };
  try { await (renderers[route] || renderOverview)(session); } catch (error) { if (error.status === 401) renderLogin(); else { root.hidden = false; root.innerHTML = `<section class="admin-error-state"><h1>Management data is unavailable</h1><p>Refresh after the service is available.</p></section>`; } }
}

void init();
