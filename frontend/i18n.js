const storageKey = "skill-web-hub.locale";
let locale = localStorage.getItem(storageKey) === "en" ? "en" : "zh-CN";
let observer;
let pending = false;

// UI labels live in one place so dynamically rendered user and administrator
// screens stay in the same language. Skill names and user-authored content are
// deliberately left unchanged.
const dictionary = {
  "WORKSPACE": ["工作区", "WORKSPACE"],
  "LOCAL NETWORK": ["局域网", "LOCAL NETWORK"],
  "CONTROL PLANE": ["管理控制台", "CONTROL PLANE"],
  "ADMIN": ["管理员", "ADMIN"],
  "CONNECTING": ["正在连接", "CONNECTING"],
  "SKILLS READY": ["技能已就绪", "SKILLS READY"],
  "OPENCODE OFFLINE": ["OpenCode 未连接", "OPENCODE NOT CONNECTED"],
  "OpenCode 离线": ["OpenCode 未连接", "OpenCode not connected"],
  "OpenCode 离线。": ["OpenCode 未连接。", "OpenCode is not connected."],
  "OpenCode 未连接": ["OpenCode 未连接", "OpenCode not connected"],
  "CATALOG UNAVAILABLE": ["技能目录不可用", "CATALOG UNAVAILABLE"],
  "RUN AVAILABLE": ["可运行", "RUN AVAILABLE"],
  "PAGE READY": ["页面已就绪", "PAGE READY"],
  "PAGE QUEUED": ["页面排队中", "PAGE QUEUED"],
  "GENERATING": ["正在生成", "GENERATING"],
  "PAGE FAILED": ["页面生成失败", "PAGE FAILED"],
  "PAGE STALE": ["页面待更新", "PAGE STALE"],
  "PAGE MISSING": ["页面未生成", "PAGE MISSING"],
  "System overview": ["系统总览", "System overview"],
  "Provider": ["智能体", "Provider"],
  "Providers": ["智能体连接", "Providers"],
  "Skills": ["技能", "Skills"],
  "Pages": ["页面", "Pages"],
  "Runs": ["运行", "Runs"],
  "enabled": ["已启用", "enabled"],
  "disabled": ["已禁用", "disabled"],
  "healthy": ["正常", "healthy"],
  "offline": ["未连接", "offline"],
  "starting": ["启动中", "starting"],
  "misconfigured": ["配置错误", "misconfigured"],
  "ready": ["就绪", "ready"],
  "queued": ["排队中", "queued"],
  "failed": ["失败", "failed"],
  "seconds": ["秒", "seconds"],
  "files": ["个文件", "files"],
  "queue active": ["正在生成", "queue active"],
  "active of": ["活动运行 / 总数", "active of"],
  "Service status": ["服务状态", "Service status"],
  "Scanner interval": ["扫描间隔", "Scanner interval"],
  "Artifacts": ["产物", "Artifacts"],
  "Recent audit activity": ["近期审计记录", "Recent audit activity"],
  "Time": ["时间", "Time"],
  "Action": ["操作", "Action"],
  "Resource": ["资源", "Resource"],
  "Loading provider status...": ["正在加载智能体状态...", "Loading provider status..."],
  "OpenCode connection": ["OpenCode 连接", "OpenCode connection"],
  "View redacted logs": ["查看脱敏日志", "View redacted logs"],
  "Last checked": ["最近检查", "Last checked"],
  "Mode": ["模式", "Mode"],
  "Capabilities": ["能力", "Capabilities"],
  "Diagnostic": ["诊断信息", "Diagnostic"],
  "Not reported": ["未报告", "Not reported"],
  "connect": ["连接现有服务", "connect"],
  "health, skills": ["健康检查、技能发现", "health, skills"],
  "fetch failed": ["连接请求失败", "fetch failed"],
  "Run health check": ["运行健康检查", "Run health check"],
  "Checking...": ["正在检查...", "Checking..."],
  "Health check failed": ["健康检查失败", "Health check failed"],
  "OpenCode 连接正常": ["OpenCode 连接正常", "OpenCode is connected"],
  "No managed OpenCode log entries are available.": ["没有可用的 OpenCode 托管日志。", "No managed OpenCode log entries are available."],
  "Skill catalog": ["技能目录", "Skill catalog"],
  "Loading Skill catalog...": ["正在加载技能目录...", "Loading Skill catalog..."],
  "discovered Skills": ["个已发现技能", "discovered Skills"],
  "Filter Skills": ["筛选技能", "Filter Skills"],
  "Scan catalog": ["扫描目录", "Scan catalog"],
  "Skill": ["技能", "Skill"],
  "State": ["状态", "State"],
  "Page": ["页面", "Page"],
  "Updated": ["更新时间", "Updated"],
  "Actions": ["操作", "Actions"],
  "Details": ["详情", "Details"],
  "Disable": ["禁用", "Disable"],
  "Enable": ["启用", "Enable"],
  "Form": ["表单", "Form"],
  "Workflow": ["工作流", "Workflow"],
  "Generate": ["生成", "Generate"],
  "Scanning catalog...": ["正在扫描目录...", "Scanning catalog..."],
  "Scan failed": ["扫描失败", "Scan failed"],
  "Select all visible Skills": ["全选当前显示的技能", "Select all visible Skills"],
  "selected": ["已选择", "selected"],
  "Enable selected": ["批量启用", "Enable selected"],
  "Disable selected": ["批量关闭", "Disable selected"],
  "Enable Skill": ["启用技能", "Enable Skill"],
  "Skill enabled": ["技能已启用", "Skill enabled"],
  "Skill disabled": ["技能已关闭", "Skill disabled"],
  "Selected Skills enabled": ["已批量启用选中技能", "Selected Skills enabled"],
  "Selected Skills disabled": ["已批量关闭选中技能", "Selected Skills disabled"],
  "Skill state could not be updated": ["无法更新技能状态", "Skill state could not be updated"],
  "Selected Skills could not be updated": ["无法更新选中技能", "Selected Skills could not be updated"],
  "RUN EVENTS": ["运行事件", "RUN EVENTS"],
  "REQUEST": ["请求", "REQUEST"],
  "CONTEXT": ["上下文", "CONTEXT"],
  "RUNTIME": ["运行时", "RUNTIME"],
  "EVENTS": ["事件", "EVENTS"],
  "ARTIFACTS": ["产物", "ARTIFACTS"],
  "BACKEND OUTPUT / MARKDOWN": ["后端输出 / Markdown", "BACKEND OUTPUT / MARKDOWN"],
  "运行日志": ["运行日志", "Run log"],
  "输出与交互": ["输出与交互", "Output & interaction"],
  "正在运行": ["正在运行", "Running now"],
  "暂无运行中的 Skill": ["暂无运行中的 Skill", "No Skills are running"],
  "最近会话": ["最近会话", "Recent conversations"],
  "最近对话": ["最近对话", "Recent conversations"],
  "全部技能": ["全部技能", "All Skills"],
  "运行历史": ["运行历史", "Run history"],
  "搜索技能...": ["搜索技能...", "Search Skills..."],
  "暂无可用技能": ["暂无可用技能", "No Skills available"],
  "暂无最近对话": ["暂无最近对话", "No recent conversations"],
  "查看完整运行历史": ["查看完整运行历史", "View complete run history"],
  "暂无最近会话": ["暂无最近会话", "No recent conversations"],
  "运行历史": ["运行历史", "Run history"],
  "等待 Skill 输出": ["等待 Skill 输出", "Awaiting Skill output"],
  "继续对话": ["继续对话", "Continue conversation"],
  "补充信息或确认内容": ["补充信息或确认内容", "Add information or confirm the result"],
  "输入回复后继续执行": ["输入回复后继续执行", "Enter a reply to continue"],
  "发送并继续": ["发送并继续", "Send and continue"],
  "required": ["必填", "required"],
  "result": ["结果", "result"],
  "执行说明": ["执行说明", "Execution context"],
  "运行状态": ["运行状态", "Runtime state"],
  "执行日志": ["执行日志", "Execution log"],
  "结果与产物": ["结果与产物", "Results & artifacts"],
  "输入": ["输入", "Inputs"],
  "输出": ["输出", "Outputs"],
  "工作流": ["工作流", "Workflow"],
  "运行 Skill": ["运行技能", "Run Skill"],
  "提交后由 Hub 执行": ["提交后由 Hub 执行", "Hub runs it after submission"],
  "提交后将由服务端验证参数并创建运行。": ["提交后将由服务端验证参数并创建运行。", "The Hub validates inputs and starts the run after submission."],
  "耗时：-": ["耗时：-", "Duration: -"],
  "产物：0": ["产物：0", "Artifacts: 0"],
  "终止运行": ["终止运行", "Abort run"],
  "运行完成后将在这里显示产物。": ["运行完成后将在这里显示产物。", "Artifacts will appear here after the run completes."],
  "运行结果显示在下方日志和结果区域。": ["运行结果显示在下方日志和结果区域。", "Run results appear in the logs and results area below."],
  "未声明预设工作流。": ["未声明预设工作流。", "No predefined workflow."],
  "任务说明": ["任务说明", "Task description"],
  "描述你希望 Skill 完成的工作": ["描述你希望 Skill 完成的工作", "Describe the work you want the Skill to complete"],
  "Page generation": ["页面生成", "Page generation"],
  "Loading generated pages...": ["正在加载已生成页面...", "Loading generated pages..."],
  "Generated page versions": ["已生成页面版本", "Generated page versions"],
  "Version": ["版本", "Version"],
  "Preset": ["预设", "Preset"],
  "Logs": ["日志", "Logs"],
  "Activate": ["启用此版本", "Activate"],
  "Global runs": ["全局运行记录", "Global runs"],
  "Loading runs...": ["正在加载运行记录...", "Loading runs..."],
  "Owner": ["所属用户", "Owner"],
  "Status": ["状态", "Status"],
  "Created": ["创建时间", "Created"],
  "Summary": ["摘要", "Summary"],
  "Terminate": ["终止", "Terminate"],
  "Users and sessions": ["用户与会话", "Users and sessions"],
  "Loading administrator details...": ["正在加载管理员数据...", "Loading administrator details..."],
  "Accounts": ["账户", "Accounts"],
  "Create account": ["创建账户", "Create account"],
  "Username": ["用户名", "Username"],
  "Temporary password": ["临时密码", "Temporary password"],
  "Role": ["角色", "Role"],
  "User": ["普通用户", "User"],
  "Administrator": ["管理员", "Administrator"],
  "Create account": ["创建账户", "Create account"],
  "Storage": ["存储与备份", "Storage"],
  "Loading storage summary...": ["正在加载存储摘要...", "Loading storage summary..."],
  "Backups": ["备份", "Backups"],
  "Refresh": ["刷新", "Refresh"],
  "Close": ["关闭", "Close"],
  "Inputs": ["输入", "Inputs"],
  "No declared inputs.": ["未声明输入字段。", "No declared inputs."],
  "No declared steps.": ["未声明工作流步骤。", "No declared steps."],
  "The username or password is not valid.": ["用户名或密码无效。", "The username or password is not valid."],
  "Sign-in could not be completed. Please refresh and try again.": ["无法完成登录，请刷新后重试。", "Sign-in could not be completed. Please refresh and try again."],
  "Sign in is required to access administration.": ["访问管理控制台需要先登录。", "Sign in is required to access administration."],
  "Administrator access required": ["需要管理员权限", "Administrator access required"],
  "Management data is unavailable": ["管理数据不可用", "Management data is unavailable"],
  "Open Skill Hub": ["打开用户端", "Open Skill Hub"],
  "发现 Skill": ["发现技能", "Discover Skills"],
  "搜索 Skill": ["搜索技能", "Search Skills"],
  "搜索 Skill...": ["搜索技能...", "Search Skills..."],
  "全部 Skill": ["全部技能", "All Skills"],
  "浏览已发布的 Skill，选择后进入可视化运行页面": ["浏览已发布的技能，选择后进入可视化运行页面", "Browse published skills and open their visual run pages."],
  "开始运行": ["开始运行", "Start Run"],
  "开始使用": ["开始使用", "Start Using"],
  "返回 Skill 目录": ["返回技能目录", "Back to Skills"],
  "运行 Skill": ["运行技能", "Run Skill"],
  "运行状态": ["运行状态", "Run Status"],
  "产物中心": ["产物中心", "Artifacts"],
  "页面状态": ["页面状态", "Page Status"],
  "页面已就绪": ["页面已就绪", "Page Ready"],
  "等待生成": ["等待生成", "Pending Generation"],
  "局域网服务在线": ["局域网服务在线", "LAN service online"],
  "管理控制台": ["管理控制台", "Admin Console"],
  "退出": ["退出", "Sign Out"],
  "账户登录": ["账户登录", "Account sign-in"],
  "用户名": ["用户名", "Username"],
  "登录到本地工作区": ["登录到本地工作区", "Sign in to the local workspace"],
  "登录后会根据账号权限自动进入用户工作台或管理控制台。": ["登录后会根据账号权限自动进入用户工作台或管理控制台。", "You will enter the user workspace or the admin console based on your account role."],
  "密码": ["密码", "Password"],
  "进入 Skill Hub": ["进入技能中心", "Enter Skill Hub"],
  "管理员与普通用户使用同一个登录入口。": ["管理员与普通用户使用同一个登录入口。", "Administrators and users share the same sign-in page."],
  "用户管理": ["用户管理", "User Management"],
  "网络管理": ["网络管理", "Network Management"],
  "Agent 连接": ["智能体连接", "Agent Connections"],
  "实时运行负载": ["实时运行负载", "Live Run Load"],
  "技能库管理": ["技能库管理", "Skill Library"],
  "运行记录": ["运行记录", "Run History"],
  "存储与备份": ["存储与备份", "Storage & Backups"],
  "服务健康": ["服务健康", "Service Health"],
  "打开用户端": ["打开用户端", "Open User Hub"],
  "管理局域网成员、运行状态与 Skill 服务": ["管理局域网成员、运行状态与技能服务", "Manage LAN members, run status, and Skill services."],
  "正在加载系统状态...": ["正在加载系统状态...", "Loading system status..."],
  "正在读取网络配置...": ["正在读取网络配置...", "Loading network configuration..."],
  "打开 Hub": ["打开技能中心", "Open Hub"],
  "监听地址": ["监听地址", "Listening host"],
  "端口": ["端口", "Port"],
  "局域网地址": ["局域网地址", "LAN addresses"],
  "已检测网卡": ["已检测网卡", "detected adapters"],
  "登录保护": ["登录保护", "Sign-in protection"],
  "启用": ["启用", "Enabled"],
  "关闭": ["关闭", "Disabled"],
  "本机": ["本机", "Local"],
  "远程": ["远程", "Remote"],
  "可访问地址": ["可访问地址", "Access URLs"],
  "将下列地址提供给局域网用户": ["将下列地址提供给局域网用户", "Share these URLs with LAN users."],
  "网络接口": ["网络接口", "Network interfaces"],
  "接口": ["接口", "Interface"],
  "IPv4 地址": ["IPv4 地址", "IPv4 address"],
  "子网": ["子网", "Subnet"],
  "操作": ["操作", "Action"],
  "共享前检查": ["共享前检查", "Before sharing"],
  "正在汇总当前运行负载...": ["正在汇总当前运行负载...", "Loading current run load..."],
  "活动运行": ["活动运行", "Active runs"],
  "正在执行或等待交互": ["正在执行或等待交互", "running or awaiting input"],
  "等待处理": ["等待处理", "Waiting"],
  "问题或权限确认": ["问题或权限确认", "questions or permission requests"],
  "启用用户": ["启用用户", "Enabled users"],
  "可访问 Hub": ["可访问技能中心", "can access the Hub"],
  "最近一小时": ["最近一小时", "Last hour"],
  "创建的运行": ["创建的运行", "runs created"],
  "按用户的活动负载": ["按用户的活动负载", "Active load by user"],
  "用户": ["用户", "User"],
  "等待交互": ["等待交互", "Waiting for input"],
  "最近创建": ["最近创建", "Last created"],
  "运行状态说明": ["运行状态说明", "Run status notes"],
  "此页每 10 秒自动更新。结束的运行保存在“运行记录”，管理员可以从那里终止仍在运行的任务。": ["此页每 10 秒自动更新。结束的运行保存在“运行记录”，管理员可以从那里终止仍在运行的任务。", "This page refreshes every 10 seconds. Completed runs are retained in Run History, where administrators can stop active tasks."],
  "LOCAL USER": ["本地用户", "LOCAL USER"],
  "LOCAL / OPEN SKILLS": ["本地 / 开放技能", "LOCAL / OPEN SKILLS"],
  "DISCOVER · RUN · COLLECT": ["发现 · 运行 · 收集", "DISCOVER · RUN · COLLECT"],
  "请选择一个要上传的文件。": ["请选择一个要上传的文件。", "Choose a file to upload."],
  "文件上传失败。": ["文件上传失败。", "File upload failed."],
  "产物：": ["产物：", "Artifacts: "],
  "预览": ["预览", "Preview"],
  "下载": ["下载", "Download"],
  "需要回答问题": ["需要回答问题", "Answer required"],
  "回答（多个选项以逗号分隔）": ["回答（多个选项以逗号分隔）", "Answer (separate options with commas)"],
  "提交回答": ["提交回答", "Submit answer"],
  "需要权限": ["需要权限", "Permission required"],
  "允许一次": ["允许一次", "Allow once"],
  "拒绝": ["拒绝", "Reject"],
  "返回目录": ["返回目录", "Back to catalog"],
  "运行历史": ["运行历史", "Run History"],
  "尚无运行记录。": ["尚无运行记录。", "No runs yet."],
  "返回历史": ["返回历史", "Back to history"],
  "尚未记录事件。": ["尚未记录事件。", "No events recorded."],
  "提交后将由服务端验证参数并创建运行。": ["提交后将由服务端验证参数并创建运行。", "The server validates inputs and creates the run after submission."],
  "耗时：-": ["耗时：-", "Duration: -"],
  "运行产物": ["运行产物", "Run artifacts"],
  "运行完成后将在这里显示产物。": ["运行完成后将在这里显示产物。", "Artifacts will appear here after the run completes."],
  "终止运行": ["终止运行", "Abort run"],
  "Skill 不可用": ["技能不可用", "Skill unavailable"],
  "该 Skill 不存在、被禁用或正在更新目录。": ["该技能不存在、被禁用或正在更新目录。", "This Skill does not exist, is disabled, or its catalog is updating."],
};

function entryFor(value) {
  const text = String(value ?? "").trim();
  if (dictionary[text]) return dictionary[text];
  return Object.values(dictionary).find((entry) => entry[0] === text || entry[1] === text);
}

export function t(value) {
  const entry = entryFor(value);
  return entry ? entry[locale === "zh-CN" ? 0 : 1] : value;
}

function translateElement(element) {
  for (const attribute of ["placeholder", "aria-label", "title"]) {
    if (!element.hasAttribute(attribute)) continue;
    const current = element.getAttribute(attribute);
    const translated = t(current);
    if (translated !== current) element.setAttribute(attribute, translated);
  }
}

export function applyLocale(root = document.body) {
  document.documentElement.lang = locale;
  root.querySelectorAll?.("*").forEach(translateElement);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("script, style, [data-i18n-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const translated = t(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  });
  const toggle = document.getElementById("languageToggle");
  if (toggle) {
    const label = locale === "zh-CN" ? "EN" : "中";
    const ariaLabel = locale === "zh-CN" ? "Switch to English" : "切换为中文";
    if (toggle.textContent !== label) toggle.textContent = label;
    if (toggle.getAttribute("aria-label") !== ariaLabel) toggle.setAttribute("aria-label", ariaLabel);
  }
}

export function setupLanguageSwitcher() {
  if (!document.getElementById("languageToggle")) {
    const button = document.createElement("button");
    button.id = "languageToggle";
    button.className = "language-switcher";
    button.type = "button";
    button.addEventListener("click", () => {
      locale = locale === "zh-CN" ? "en" : "zh-CN";
      localStorage.setItem(storageKey, locale);
      applyLocale();
    });
    document.body.append(button);
  }
  applyLocale();
  if (!observer) {
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => { pending = false; applyLocale(); });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
}
