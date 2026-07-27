import { createMotionScope } from "/motion/index.js";

const root = document.querySelector("#adminRoot");
let adminMotion = null;
let csrfToken = "";
const isAdminRoute = window.location.pathname.startsWith("/admin");
const isLoginRoute = window.location.pathname === "/login";

const navItems = [
  ["/admin", "系统总览"], ["/admin/users", "用户管理"], ["/admin/network", "网络管理"],
  ["/admin/providers", "Agent 连接"], ["/admin/load", "实时运行负载"], ["/admin/skills", "技能库管理"],
  ["/admin/page-generation", "页面生成"], ["/admin/runs", "运行记录"], ["/admin/storage", "存储与备份"],
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

async function api(url, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (!["GET", "HEAD"].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, { credentials: "same-origin", headers, ...options });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "REQUEST_FAILED");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function renderLogin(message = "") {
  root.classList.add("login-root");
  root.hidden = false;
  root.innerHTML = `<section class="auth-shell source-login-shell"><div class="auth-intro"><p>LOCAL / OPEN SKILLS</p><h1>SKILL WEB HUB</h1><span>DISCOVER · RUN · COLLECT</span><div class="auth-intro-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><div class="auth-panel"><p class="admin-eyebrow">账户登录</p><h2>登录到本地工作区</h2><p>登录后会根据账号权限自动进入用户工作台或管理控制台。</p><form id="adminLoginForm"><label>用户名<input name="username" autocomplete="username" required autofocus></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="admin-error" role="alert">${escapeHtml(message)}</p><button type="submit">进入 Skill Hub</button></form><small class="auth-route-note">管理员与普通用户使用同一个登录入口。</small></div></section>`;
  root.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      const session = await api("/api/auth/session");
      window.location.assign(session.role === "administrator" ? "/admin" : "/");
    } catch { renderLogin("The username or password is not valid."); }
  });
}

function valueStatus(status) { return `<span class="admin-status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`; }
function table(headers, rows) { return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="admin-empty">No records.</td></tr>`}</tbody></table></div>`; }

function shell(title, body, session) {
  root.classList.remove("login-root");
  adminMotion?.revert();
  root.hidden = false;
  root.innerHTML = `<aside class="admin-sidebar"><a class="admin-brand" href="/admin"><strong>SKILL HUB</strong><em>ADMIN</em></a><span class="admin-plane-label">CONTROL PLANE</span><nav>${navItems.map(([href, label]) => `<a href="${href}" class="${window.location.pathname === href ? "is-current" : ""}">${label}</a>`).join("")}</nav><div class="admin-sidebar-footer"><span class="admin-health-dot"></span><strong>服务健康</strong><small>${escapeHtml(session.username)}</small><button id="adminLogout" class="admin-quiet-button">退出</button><a href="/">打开用户端</a></div></aside><section class="admin-workspace"><header class="admin-topbar"><div><p class="admin-eyebrow">CONTROL PLANE</p><h1>${escapeHtml(title)}</h1><span>管理局域网成员、运行状态与 Skill 服务</span></div><div><div class="admin-network-badge">LOCAL NETWORK</div><div id="adminNotice" role="status"></div></div></header><div class="admin-content">${body}</div></section>`;
  root.querySelector("#adminLogout").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); });
  adminMotion = createMotionScope(root);
  adminMotion.enter(root.querySelector(".admin-workspace"));
  adminMotion.stagger([...root.querySelectorAll(".admin-metrics article, .admin-panel")]);
}

function setNotice(message, kind = "") { const element = root.querySelector("#adminNotice"); if (element) element.innerHTML = `<span class="admin-notice ${kind}">${escapeHtml(message)}</span>`; }

async function renderOverview(session) {
  shell("系统总览", `<section class="admin-panel admin-loading" aria-busy="true">正在加载系统状态...</section>`, session);
  const [data, audit] = await Promise.all([api("/api/admin/overview"), api("/api/admin/audit")]);
  const auditRows = audit.slice(0, 8).map((event) => `<tr><td>${escapeHtml(new Date(event.createdAt).toLocaleString())}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.resourceId || "-")}</td></tr>`).join("");
  shell("System overview", `<div class="admin-metrics"><article><span>Provider</span><strong>${escapeHtml(data.provider.status)}</strong><small>${escapeHtml(data.provider.provider)}</small></article><article><span>Skills</span><strong>${data.skills.enabled} / ${data.skills.total}</strong><small>enabled</small></article><article><span>Pages</span><strong>${data.pages.queued + data.pages.generating}</strong><small>queue active</small></article><article><span>Runs</span><strong>${data.runs.active}</strong><small>active of ${data.runs.total}</small></article></div><section class="admin-panel"><h2>Service status</h2><dl class="admin-definition"><div><dt>Node</dt><dd>${escapeHtml(data.runtime.node)}</dd></div><div><dt>Scanner interval</dt><dd>${Math.round(data.runtime.scannerIntervalMs / 1000)} seconds</dd></div><div><dt>Artifacts</dt><dd>${data.storage.artifacts} files, ${Math.round(data.storage.artifactBytes / 1024)} KB</dd></div></dl></section><section class="admin-panel"><h2>Recent audit activity</h2>${table(["Time", "Action", "Resource"], auditRows)}</section>`, session);
}

async function renderProviders(session) {
  shell("Providers", `<section class="admin-panel admin-loading" aria-busy="true">Loading provider status...</section>`, session);
  const providers = await api("/api/admin/providers");
  shell("Providers", `<section class="admin-panel"><div class="admin-panel-heading"><h2>OpenCode connection</h2><div class="admin-toolbar"><button id="showProviderLogs" class="admin-inline-action">View redacted logs</button><button id="testProvider">Run health check</button></div></div>${table(["Provider", "State", "Mode", "Last checked", "Capabilities"], providers.map((provider) => `<tr><td>${escapeHtml(provider.provider)}</td><td>${valueStatus(provider.status)}</td><td>${escapeHtml(provider.mode)}</td><td>${escapeHtml(new Date(provider.checkedAt).toLocaleString())}</td><td>${escapeHtml((provider.capabilities || []).join(", ") || "Not reported")}</td></tr>`).join(""))}<pre id="providerLogs" class="admin-log" hidden></pre></section>`, session);
  root.querySelector("#testProvider").addEventListener("click", async () => { setNotice("Checking..."); try { const state = await api("/api/admin/providers/opencode/test", { method: "POST" }); setNotice(`Provider is ${state.status}`, "success"); } catch { setNotice("Health check failed", "error"); } });
  root.querySelector("#showProviderLogs").addEventListener("click", async () => { const logPanel = root.querySelector("#providerLogs"); const result = await api("/api/admin/providers/opencode/logs"); logPanel.hidden = false; logPanel.textContent = result.lines.join("\n") || "No managed OpenCode log entries are available."; });
}

async function renderNetwork(session) {
  shell("网络管理", `<section class="admin-panel admin-loading" aria-busy="true">正在读取网络配置...</section>`, session);
  const network = await api("/api/admin/network");
  const addressRows = network.addresses.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td><code>${escapeHtml(item.address)}</code></td><td>${escapeHtml(item.cidr || "-")}</td><td><a class="admin-inline-action admin-link-button" href="http://${escapeHtml(item.address)}:${network.port}" target="_blank" rel="noreferrer">打开 Hub</a></td></tr>`).join("");
  shell("网络管理", `<div class="admin-metrics"><article><span>监听地址</span><strong>${escapeHtml(network.host)}</strong><small>端口 ${network.port}</small></article><article><span>局域网地址</span><strong>${network.addresses.length}</strong><small>已检测网卡</small></article><article><span>登录保护</span><strong>${network.authRequired ? "启用" : "关闭"}</strong><small>局域网推荐保持启用</small></article><article><span>OpenCode</span><strong>${network.opencodeLoopbackOnly ? "本机" : "远程"}</strong><small>${escapeHtml(network.opencodeUrl)}</small></article></div><section class="admin-panel"><div class="admin-panel-heading"><h2>可访问地址</h2><span class="admin-muted">将下列地址提供给局域网用户</span></div><div class="admin-address-list">${network.urls.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`).join("") || "<span class=\"admin-muted\">未检测到可用的 IPv4 局域网地址。</span>"}</div></section><section class="admin-panel"><div class="admin-panel-heading"><h2>网络接口</h2><span class="admin-muted">服务当前绑定到 ${escapeHtml(network.host)}</span></div>${table(["接口", "IPv4 地址", "子网", "操作"], addressRows)}</section><section class="admin-panel network-guidance"><h2>共享前检查</h2><ol><li>保持 OpenCode 仅绑定本机，Hub 才是唯一的局域网入口。</li><li>在 Windows 私有网络防火墙中放行 Hub 端口 ${network.port}。</li><li>面向长期使用时，请通过内部 HTTPS 反向代理并启用安全 Cookie。</li></ol></section>`, session);
}

async function renderLoad(session) {
  shell("实时用户运行负载", `<section class="admin-panel admin-loading" aria-busy="true">正在汇总当前运行负载...</section>`, session);
  const render = async () => {
    const load = await api("/api/admin/load");
    const rows = load.byUser.map((item) => `<tr><td><strong>${escapeHtml(item.username)}</strong></td><td>${item.activeRuns}</td><td>${item.waiting}</td><td>${item.latestRunAt ? escapeHtml(new Date(item.latestRunAt).toLocaleString("zh-CN")) : "-"}</td></tr>`).join("");
    shell("实时用户运行负载", `<div class="admin-metrics"><article><span>活动运行</span><strong>${load.activeRuns}</strong><small>正在执行或等待交互</small></article><article><span>等待处理</span><strong>${load.waitingRuns}</strong><small>问题或权限确认</small></article><article><span>启用用户</span><strong>${load.enabledUsers}</strong><small>可访问 Hub</small></article><article><span>最近一小时</span><strong>${load.recentRuns}</strong><small>创建的运行</small></article></div><section class="admin-panel"><div class="admin-panel-heading"><h2>按用户的活动负载</h2><div class="admin-toolbar"><span class="admin-muted">更新于 ${escapeHtml(new Date(load.capturedAt).toLocaleTimeString("zh-CN"))}</span><button id="refreshLoad" class="admin-inline-action">刷新</button></div></div>${table(["用户", "活动运行", "等待交互", "最近创建"], rows)}</section><section class="admin-panel load-note"><h2>运行状态说明</h2><p>此页每 10 秒自动更新。结束的运行保存在“运行记录”，管理员可以从那里终止仍在运行的任务。</p></section>`, session);
    root.querySelector("#refreshLoad")?.addEventListener("click", () => void render());
  };
  await render();
  const timer = window.setInterval(() => {
    if (window.location.pathname === "/admin/load") void render().catch(() => undefined);
    else window.clearInterval(timer);
  }, 10000);
}

async function renderSkills(session) {
  shell("Skill catalog", `<section class="admin-panel admin-loading" aria-busy="true">Loading Skill catalog...</section>`, session);
  const skills = await api("/api/admin/skills");
  shell("Skill catalog", `<section class="admin-panel"><div class="admin-panel-heading"><h2>${skills.length} discovered Skills</h2><div class="admin-toolbar"><input id="adminSkillFilter" type="search" placeholder="Filter Skills" aria-label="Filter Skills"><button id="scanSkills">Scan catalog</button></div></div>${table(["Skill", "State", "Page", "Updated", "Actions"], skills.map((skill) => `<tr data-skill-row data-skill-search="${escapeHtml(`${skill.displayName} ${skill.description} ${skill.id}`.toLowerCase())}"><td><strong>${escapeHtml(skill.displayName)}</strong><small>${escapeHtml(skill.description)}</small></td><td>${valueStatus(skill.enabled ? "enabled" : "disabled")}</td><td>${valueStatus(skill.pageStatus)}</td><td>${escapeHtml(new Date(skill.lastScannedAt).toLocaleString())}</td><td><button class="admin-inline-action" data-skill-details="${escapeHtml(skill.id)}">Details</button><button class="admin-inline-action" data-skill-toggle="${escapeHtml(skill.id)}" data-enabled="${!skill.enabled}">${skill.enabled ? "Disable" : "Enable"}</button><select class="admin-preset" data-page-preset><option value="form-first">Form</option><option value="workflow-console">Workflow</option><option value="artifact-workbench">Artifacts</option></select><button class="admin-inline-action" data-page-generate="${escapeHtml(skill.id)}">Generate</button></td></tr>`).join(""))}</section>`, session);
  root.querySelector("#adminSkillFilter").addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    root.querySelectorAll("[data-skill-row]").forEach((row) => { row.hidden = query.length > 0 && !row.dataset.skillSearch.includes(query); });
  });
  root.querySelector("#scanSkills").addEventListener("click", async () => { setNotice("Scanning catalog..."); try { const outcome = await api("/api/admin/skills/scan", { method: "POST" }); setNotice(`Scan completed: ${outcome.total} Skills`, "success"); setTimeout(() => void renderSkills(session), 300); } catch { setNotice("Scan failed", "error"); } });
  root.querySelectorAll("[data-skill-toggle]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/admin/skills/${encodeURIComponent(button.dataset.skillToggle)}/enabled`, { method: "POST", body: JSON.stringify({ enabled: button.dataset.enabled === "true" }) }); void renderSkills(session); }));
  root.querySelectorAll("[data-page-generate]").forEach((button) => button.addEventListener("click", async () => { setNotice("Page generation queued..."); const preset = button.closest("tr").querySelector("[data-page-preset]").value; await api(`/api/admin/skills/${encodeURIComponent(button.dataset.pageGenerate)}/page/generate`, { method: "POST", body: JSON.stringify({ preset, force: true }) }); setNotice("Page generation queued", "success"); }));
  root.querySelectorAll("[data-skill-details]").forEach((button) => button.addEventListener("click", () => {
    const skill = skills.find((item) => item.id === button.dataset.skillDetails);
    if (skill) openDrawer(skill);
  }));
}

async function renderPages(session) {
  shell("Page generation", `<section class="admin-panel admin-loading" aria-busy="true">Loading generated pages...</section>`, session);
  const pages = await api("/api/admin/pages");
  shell("Page generation", `<section class="admin-panel"><div class="admin-panel-heading"><h2>Generated page versions</h2><span class="admin-muted">Prompt contract: persisted on each version</span></div>${table(["Skill", "Version", "Preset", "State", "Updated", "Action"], pages.map((page) => `<tr><td>${escapeHtml(page.skillId)}</td><td>${escapeHtml(page.version)}</td><td>${escapeHtml(page.preset)}</td><td>${valueStatus(page.status)} ${page.active ? "active" : ""}</td><td>${escapeHtml(new Date(page.updatedAt).toLocaleString())}</td><td><button class="admin-inline-action" data-page-logs="${escapeHtml(page.skillId)}" data-version="${escapeHtml(page.version)}">Logs</button>${page.status === "ready" && !page.active ? ` <button class="admin-inline-action" data-page-activate="${escapeHtml(page.skillId)}" data-version="${escapeHtml(page.version)}">Activate</button>` : ""}</td></tr>`).join(""))}</section>`, session);
  root.querySelectorAll("[data-page-activate]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/admin/pages/${encodeURIComponent(button.dataset.pageActivate)}/activate/${encodeURIComponent(button.dataset.version)}`, { method: "POST" }); void renderPages(session); }));
  root.querySelectorAll("[data-page-logs]").forEach((button) => button.addEventListener("click", async () => { const events = await api(`/api/admin/pages/${encodeURIComponent(button.dataset.pageLogs)}/${encodeURIComponent(button.dataset.version)}/logs`); openLogDrawer(`Page version ${button.dataset.version}`, events.map((event) => `${event.createdAt} ${event.type}: ${event.message}`)); }));
}

async function renderRuns(session) {
  shell("Global runs", `<section class="admin-panel admin-loading" aria-busy="true">Loading runs...</section>`, session);
  const runs = await api("/api/admin/runs");
  shell("Global runs", `<section class="admin-panel">${table(["Owner", "Skill", "Status", "Created", "Summary", "Action"], runs.map((run) => `<tr><td>${escapeHtml(run.ownerId)}</td><td>${escapeHtml(run.skillId)}</td><td>${valueStatus(run.status)}</td><td>${escapeHtml(new Date(run.createdAt).toLocaleString())}</td><td>${escapeHtml(run.summary || run.errorMessage || "-")}</td><td>${["created", "running", "waiting_question", "waiting_permission"].includes(run.status) ? `<button class="admin-inline-action admin-danger" data-run-abort="${escapeHtml(run.id)}">Terminate</button>` : ""}</td></tr>`).join(""))}</section>`, session);
  root.querySelectorAll("[data-run-abort]").forEach((button) => button.addEventListener("click", async () => { if (!window.confirm("Terminate this run?")) return; await api(`/api/admin/runs/${encodeURIComponent(button.dataset.runAbort)}/abort`, { method: "POST" }); void renderRuns(session); }));
}

async function renderUsers(session) {
  shell("Users and sessions", `<section class="admin-panel admin-loading" aria-busy="true">Loading administrator details...</section>`, session);
  const users = await api("/api/admin/users");
  shell("Users and sessions", `<section class="admin-panel"><div class="admin-panel-heading"><h2>Accounts</h2><span class="admin-muted">${users.length} accounts</span></div>${table(["Username", "Role", "State", "Created", "Action"], users.map((user) => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td>${valueStatus(user.disabled ? "disabled" : "enabled")}</td><td>${escapeHtml(new Date(user.createdAt).toLocaleString())}</td><td><button class="admin-inline-action" data-user-toggle="${escapeHtml(user.id)}" data-disabled="${!user.disabled}">${user.disabled ? "Enable" : "Disable"}</button></td></tr>`).join(""))}</section><section class="admin-panel"><h2>Create account</h2><form id="createUserForm" class="admin-user-form"><label>Username<input name="username" autocomplete="off" required></label><label>Temporary password<input name="password" type="password" autocomplete="new-password" required minlength="12"></label><label>Role<select name="role"><option value="user">User</option><option value="administrator">Administrator</option></select></label><button type="submit">Create account</button></form></section>`, session);
  root.querySelectorAll("[data-user-toggle]").forEach((button) => button.addEventListener("click", async () => { await api(`/api/admin/users/${encodeURIComponent(button.dataset.userToggle)}`, { method: "PATCH", body: JSON.stringify({ disabled: button.dataset.disabled === "true" }) }); void renderUsers(session); }));
  root.querySelector("#createUserForm").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/admin/users", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password"), role: form.get("role") }) }); setNotice("Account created", "success"); void renderUsers(session); } catch { setNotice("Account could not be created", "error"); } });
}

async function renderStorage(session) {
  shell("Storage", `<section class="admin-panel admin-loading" aria-busy="true">Loading storage summary...</section>`, session);
  const data = await api("/api/admin/storage");
  const backups = await api("/api/admin/storage/backups");
  shell("Storage", `<div class="admin-metrics"><article><span>Artifacts</span><strong>${data.artifacts}</strong><small>${Math.round(data.artifactBytes / 1024)} KB</small></article><article><span>Runs</span><strong>${data.runs}</strong></article><article><span>Page versions</span><strong>${data.generatedPages}</strong></article><article><span>Skills</span><strong>${data.skills}</strong></article></div><section class="admin-panel"><div class="admin-panel-heading"><h2>Retention cleanup</h2><a class="admin-inline-action admin-link-button" href="/api/admin/diagnostics">Download diagnostics</a></div><div class="admin-toolbar"><label>Retention days <input id="retentionDays" type="number" min="1" max="3650" value="${data.retentionDays}"></label><button id="previewCleanup">Preview cleanup</button></div><div id="cleanupPreview" class="admin-muted">Review the candidate workspaces before deletion.</div></section><section class="admin-panel"><div class="admin-panel-heading"><h2>Backups</h2><button id="createBackup">Create backup</button></div>${table(["Created", "Database size", "Action"], backups.map((backup) => `<tr><td>${escapeHtml(new Date(backup.createdAt).toLocaleString())}</td><td>${Math.round(backup.sizeBytes / 1024)} KB</td><td><a class="admin-inline-action admin-link-button" href="/api/admin/storage/backups/${encodeURIComponent(backup.id)}/download">Download database</a></td></tr>`).join(""))}</section>`, session);
  const retentionDays = () => Number(root.querySelector("#retentionDays").value);
  root.querySelector("#previewCleanup").addEventListener("click", async () => {
    try {
      const preview = await api(`/api/admin/storage/cleanup/preview?retentionDays=${encodeURIComponent(retentionDays())}`);
      root.querySelector("#cleanupPreview").innerHTML = `${preview.runCount} completed runs, ${preview.artifactCount} artifacts (${Math.round(preview.artifactBytes / 1024)} KB) are older than ${preview.retentionDays} days. <button id="confirmCleanup" class="admin-inline-action">Delete these records and workspaces</button>`;
      root.querySelector("#confirmCleanup").addEventListener("click", async () => {
        if (!window.confirm("Delete only the previewed expired workspaces and their registered artifacts?")) return;
        const outcome = await api("/api/admin/storage/cleanup", { method: "POST", body: JSON.stringify({ retentionDays: retentionDays(), confirm: true }) });
        setNotice(`Deleted ${outcome.deletedRuns} expired runs`, "success");
        void renderStorage(session);
      });
    } catch { setNotice("Could not preview cleanup", "error"); }
  });
  root.querySelector("#createBackup").addEventListener("click", async () => { setNotice("Creating backup..."); try { await api("/api/admin/storage/backups", { method: "POST" }); setNotice("Backup created", "success"); void renderStorage(session); } catch { setNotice("Backup failed", "error"); } });
}

function openDrawer(skill) {
  const drawer = document.createElement("div");
  drawer.className = "admin-drawer-backdrop";
  drawer.innerHTML = `<aside class="admin-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(skill.displayName)} manifest"><div class="admin-panel-heading"><h2>${escapeHtml(skill.displayName)}</h2><button class="admin-inline-action" data-close-drawer>Close</button></div><p>${escapeHtml(skill.description)}</p><h3>Inputs</h3><ul>${skill.inputs.map((input) => `<li><strong>${escapeHtml(input.label)}</strong> <span>${escapeHtml(input.kind)}${input.required ? " · required" : ""}</span></li>`).join("") || "<li>No declared inputs.</li>"}</ul><h3>Workflow</h3><ol>${skill.workflow.map((step) => `<li>${escapeHtml(step.label)}</li>`).join("") || "<li>No declared steps.</li>"}</ol></aside>`;
  const drawerMotion = createMotionScope(drawer);
  const close = () => { drawerMotion.revert(); drawer.remove(); };
  drawer.addEventListener("click", (event) => { if (event.target === drawer || event.target.closest("[data-close-drawer]")) close(); });
  root.append(drawer);
  drawerMotion.enter(drawer.querySelector(".admin-drawer"), { x: 0 });
}

function openLogDrawer(title, lines) {
  const drawer = document.createElement("div");
  drawer.className = "admin-drawer-backdrop";
  drawer.innerHTML = `<aside class="admin-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="admin-panel-heading"><h2>${escapeHtml(title)}</h2><button class="admin-inline-action" data-close-drawer>Close</button></div><pre class="admin-log">${escapeHtml(lines.join("\n") || "No events recorded.")}</pre></aside>`;
  const drawerMotion = createMotionScope(drawer);
  const close = () => { drawerMotion.revert(); drawer.remove(); };
  drawer.addEventListener("click", (event) => { if (event.target === drawer || event.target.closest("[data-close-drawer]")) close(); });
  root.append(drawer);
  drawerMotion.enter(drawer.querySelector(".admin-drawer"), { x: 0 });
}

async function init() {
  if (!isAdminRoute && !isLoginRoute) return;
  document.querySelector(".hub-shell").hidden = true;
  const session = await api("/api/auth/session").catch(() => ({ authenticated: false }));
  if (isLoginRoute) {
    if (!session.authenticated) return renderLogin();
    window.location.assign(session.role === "administrator" ? "/admin" : "/");
    return;
  }
  if (!session.authenticated) return renderLogin("Sign in is required to access administration.");
  csrfToken = session.csrfToken || "";
  if (session.role !== "administrator") {
    root.hidden = false;
    root.innerHTML = `<section class="admin-error-state"><h1>Administrator access required</h1><p>This account can use the Skill Hub but cannot change its configuration.</p><a href="/">Open Skill Hub</a></section>`;
    return;
  }
  const route = window.location.pathname;
  const renderers = { "/admin": renderOverview, "/admin/users": renderUsers, "/admin/network": renderNetwork, "/admin/providers": renderProviders, "/admin/load": renderLoad, "/admin/skills": renderSkills, "/admin/page-generation": renderPages, "/admin/runs": renderRuns, "/admin/storage": renderStorage };
  try { await (renderers[route] || renderOverview)(session); } catch (error) { if (error.status === 401) renderLogin(); else { root.hidden = false; root.innerHTML = `<section class="admin-error-state"><h1>Management data is unavailable</h1><p>Refresh after the service is available.</p></section>`; } }
}

void init();
