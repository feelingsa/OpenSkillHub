# OpenCode Skill Web Hub 实施任务清单

## 1. 项目目标

本阶段只接入 OpenCode，完成以下闭环：

1. Node 服务连接并管理一套 OpenCode 服务。
2. 扫描 OpenCode 当前可用的全部 Skill，建立本地 Skill 目录。
3. 在 `node/frontend/index.html` 中展示全部 Skill，并保留现有卡片堆叠、滚轮切换、悬停抬升和弹窗预览交互。
4. 针对每个 Skill，使用预设提示词调用 OpenCode 生成独立的可视化操作页面。
5. 将生成页面保存到项目中；Skill 未变化时直接复用，避免每次启动重复生成。
6. 局域网用户只需打开网页即可运行 Skill，无需安装 OpenCode、Skill 或其他依赖。
7. 每次运行的状态、交互问题、权限请求、日志和产物都必须显示在网页中。
8. 整个项目包括前后端所有内容；`node/source/` 中用户端、管理端和配色 SVG 已明确呈现的页面区域，按登记的桌面端视口进行视觉还原；未在设计导出中出现的交互和状态以本清单补充定义为准。Skill 个性化内容区遵循同一套设计令牌。
9. 所有自研 UI 动画统一使用锁定版本的 GSAP npm 包；`gsap-skills` 仅作为使用规范和示例参考，使用文档可以查看 https://github.com/greensock/gsap-skills。

## 2. 核心实现原则

- [ ] 整个项目分为前后端，前端主要是用户使用包括登录、查看Skill、选择Skill、运行Skill，后端为Skill、网络、Agent配置管理。
- [ ] 用户端和管理端使用同一个 Node 前端应用，但通过路由和权限分开；不能把管理接口或敏感配置渲染到用户端页面。
- [ ] 根目录现有 `frontend/index.html`、`frontend/styles.css` 的视觉风格和卡片式交互仅作为迁移基线；正式实现位于 `node/frontend/`，不进行整体重做。
- [ ] 首页只将硬编码 Skill 数据替换为动态目录，不改变卡片堆叠的核心操作方式。
- [ ] AI 负责生成 Skill 页的视觉结构和字段布局；Node 共享运行时负责执行、状态、权限和产物，生成页面不能自行拼接 OpenCode API。
- [ ] 所有 Skill 页面使用统一数据协议 `SkillManifest` 和统一运行协议 `RunState`。
- [ ] 所有文件访问必须使用受控的 `artifactId`，禁止把任意本机绝对路径作为下载接口参数。
- [ ] OpenCode、Skill 和凭据只安装在服务端主机，局域网用户浏览器不承担任何本地配置。
- [ ] Skill 页面生成失败不能影响首页和 Skill 执行；必须提供通用兜底页面。
- [ ] 扫描和页面生成采用增量方式，仅处理新增或内容发生变化的 Skill。
- [ ] 设计 SVG 只约束 Hub 壳层、用户端和管理端中明确出现的页面区域；Skill 个性化操作页由预设提示词生成，但必须使用 Hub 的设计令牌和共享运行时。
- [ ] `gsap-skills` 作为 GSAP 使用规范和示例来源；实际运行时固定安装 `gsap` npm 依赖，禁止从 GitHub 页面或 CDN 动态加载脚本。
- [ ] 所有有意的页面动效通过共享动画模块实现，统一处理清理和 `prefers-reduced-motion`。

## 2.1 前后端 UI 分层

### 桌面端交付范围

- [x] 本期只制作和验收电脑端界面，统一以 `1440 x 900` 作为首个视觉回归与交互验收视口。
- [x] 不为手机、平板或触摸操作实现专用布局、断点、手势或截图验收；历史移动端截图仅保留归档，不作为开发或回归依据。
- [x] 移动端、触摸交互和响应式断点明确不属于本项目范围；后续如有需求，作为独立项目重新定义设计稿、路由状态和验收标准，且不得影响当前桌面端的 1:1 还原结果。

### 用户端页面

- [ ] `/login`：登录、服务状态和错误提示。
- [ ] `/`：保留现有卡片式 Skill Hub 首页，展示全部已启用 Skill。
- [ ] `/skills/:skillId`：Skill 说明、输入表单、运行状态、问题/权限交互、日志和产物。
- [ ] `/runs`：当前用户的运行历史。
- [ ] `/runs/:runId`：单次运行详情、事件时间线和产物列表。
- [ ] 用户端不得出现 OpenCode 地址、命令、凭据、Skill 根目录和服务端绝对路径。

### 管理端页面

- [ ] `/admin`：Node、OpenCode、数据库、扫描器、页面生成队列和运行队列总览。
- [ ] `/admin/providers`：OpenCode 连接配置、健康检查、启动模式和日志入口。
- [ ] `/admin/skills`：Skill 扫描、启用/禁用、Manifest、页面版本和失败重试。
- [ ] `/admin/page-generation`：页面生成队列、提示词预设、版本切换和回滚。
- [ ] `/admin/runs`：全局运行管理、终止任务、权限请求和审计信息。
- [ ] `/admin/users`：用户、角色、会话和访问范围管理。
- [ ] `/admin/storage`：上传、产物、缓存占用和清理策略。
- [ ] 管理端所有页面和 API 都必须执行服务端 RBAC，不能只依赖前端隐藏菜单。

### UI 交付约束

- [x] 已取得并冻结 Figma 设计导出的 SVG：`node/source/Skill Web Hub — 用户端.svg`、`node/source/Skill Web Hub — 管理端.svg`、`node/source/Skill Web Hub — 配色.svg`；设计源登记见 `node/docs/design-sources.md`。
- [x] 本期以这三份 SVG 作为唯一必需的视觉设计输入；不再以取得 Figma 链接、在线访问权限或原始 `.fig` 文件为开工前置条件。
- [x] 已明确“1:1 还原”的范围：仅对 SVG 中可识别的用户端/管理端壳层、导航、卡片、表格、筛选、抽屉、弹窗及其明确文案、层级、色彩、间距和图标，在登记的基准视口进行视觉验收。
- [x] SVG 未覆盖的组件变体、原型连接、加载/错误/无权限/离线/生成中状态和交互细节，按产品规则设计并登记为“补充实现”，不纳入设计导出像素比对；移动端不属于本期范围。
- [x] 已为每个桌面端设计页面建立路由、状态和验收截图映射表，见 `node/docs/ui-route-map.md` 与 `node/docs/ui-state-contract.md`。
- [x] 已统一记录加载中、空状态、错误、无权限、生成中和离线状态；实现时必须遵守该状态合同。
- [x] 页面生成器只能生成 Skill 内容区域，用户端/管理端壳层和运行面板由代码维护。
- [ ] M2 和 M5 分别以用户端、管理端 SVG 为视觉回归输入：在登记视口保存实现截图，记录允许差异区域，并对 1:1 壳层完成可复查的视觉验收。

## 3. 目标目录结构

```text
node/
  package.json
  tsconfig.json
  source/
    Skill Web Hub — 用户端.svg
    Skill Web Hub — 管理端.svg
    Skill Web Hub — 配色.svg
  src/
    server.ts
    config/
    providers/opencode/
    skills/
    page-generator/
    runs/
    artifacts/
    security/
    routes/
  prompts/
    skill-page-base.md
    form-first.md
    workflow-console.md
    artifact-workbench.md
  data/
    hub.db
  runtime/
    skill-runtime.js
    skill-runtime.css
  tests/
  frontend/
    index.html
    styles.css
    app.js
    generated/
      <skill-id>/
        index.html
        styles.css
        view.js
        view.manifest.json
```

生成文件目录是否提交 Git，在第一阶段结束前确定。默认建议提交已审核页面，运行时生成内容使用独立缓存目录。

## 4. 阶段 0：冻结现状与验收基线

- [x] 记录当前首页桌面端截图，作为样式回归基线（`node/docs/baselines/`）；历史移动端截图仅保留归档，不作为本期验收项。
- [x] 记录当前卡片行为：滚轮切换、卡片层叠、悬停抬升、点击弹窗、Esc/遮罩关闭（`node/docs/baselines/README.md`）。
- [x] 保存当前 6 个示例 Skill 的名称、图片和说明，用作迁移后的固定回归样本（迁移基线位于根目录 `frontend/`）。
- [x] 已确认当前设计导出包含用户端、管理端和独立配色板，文件位于 `node/source/`。
- [x] 记录三个 SVG 的画布尺寸、可识别页面区域、桌面端基准视口和资源依赖；当前导出尺寸为用户端/管理端 `3000x2940`，配色板 `1440x1100`（`node/docs/design-sources.md`）。
- [x] 将每份 SVG 中的页面/组件区域标注为“1:1 壳层”“共享代码组件”或“Skill 可生成内容区”，并为每项登记目标路由与基准视口（`node/docs/ui-route-map.md`）。
- [x] 对设计导出未提供的登录、加载、空数据、错误、无权限、生成中和离线状态补充交互定义，并明确为产品补充状态（`node/docs/ui-state-contract.md`）。
- [x] 建立设计源页面到实现路由的映射表，标出 1:1 壳层、允许在桌面端补充实现的区域，以及允许 Skill 页面生成器自定义的内容区（`node/docs/ui-route-map.md`）。
- [x] 从 `node/source/Skill Web Hub — 配色.svg` 及用户端/管理端 SVG 固化颜色、字体、间距、圆角、阴影、图标和动效时序等设计令牌，形成代码可读取的 token 文件（`node/frontend/styles/tokens.css`）。
- [x] 对 SVG 资源执行 XML 解析和可渲染性检查；不要直接把大型 SVG 原文塞进组件或提示词上下文（`node/scripts/audit-design-sources.mjs`）。
- [x] 对设计源中可识别的加载、空数据、错误、无权限和离线状态建立单独验收样本；设计源未覆盖的状态由产品规则补齐（`node/docs/ui-state-contract.md`）。
- [x] 明确 `gsap-skills` 仅作为文档参考，锁定实际 `gsap` npm 版本和许可证信息（`gsap@3.13.0` 已锁入 `package-lock.json`，其依赖许可证为 GSAP Standard 'no charge' license）。
- [x] 定义共享动画模块的命名、生命周期和清理方式；为首页卡片、弹窗、路由切换和状态更新分别登记动画责任（`node/docs/ui-route-map.md`）。
- [x] 已明确 `node/` 为唯一正式项目根目录；后端、前端、运行时、数据和生成页面均放入该目录。
- [x] 将根目录 `frontend/`、`server.js` 和 `public/` 作为只读迁移参考；M2 后不再依赖它们提供正式服务。
- [x] 建立基础验收命令：类型检查、单元测试、接口测试、浏览器交互测试（`node/docs/ui-state-contract.md`；M1 实现脚本）。

验收标准：`node/source` 中的三个设计源已登记并可解析；已为每个可识别页面区域定义 1:1 范围、目标路由、基准视口和截图基线；设计未覆盖状态已作为产品补充状态记录；现有首页核心视觉与卡片交互有可复现基线；GSAP 版本和动效验收规则已固定。

## 5. 阶段 1：建立 Node/TypeScript 服务骨架

- [x] 在 `node/` 初始化独立 Node/TypeScript 项目。
- [x] 选择服务框架，使用 Fastify；保持依赖数量可控。
- [x] 增加开发、构建、启动、测试和类型检查脚本。
- [x] 将前端依赖纳入 Node 项目管理，固定 `gsap` 版本；不依赖运行时 CDN。
- [x] 增加统一配置模块，支持环境变量和本地配置文件。
- [x] 配置服务监听地址，默认 `0.0.0.0`，端口默认 `5177`。
- [x] 将 `node/frontend/` 作为静态目录提供，并支持 `/skills/:skillId` 页面路由。
- [x] 增加结构化日志和请求 ID。
- [x] 增加全局错误处理，生产响应不得返回服务端堆栈和本机路径。
- [x] 增加优雅退出，停止时关闭 OpenCode 连接；M3 新增 SSE 和运行队列时沿用同一关闭钩子。
- [x] 创建共享 `motion` 模块，封装 GSAP 的进入、退出、列表交错、状态变化和 reduced-motion 行为。
- [x] 所有路由切换和组件卸载都要能杀掉当前 tween/timeline，禁止页面切换后继续操作已销毁 DOM。

建议首批接口：

```text
GET  /api/health
GET  /api/config/status
GET  /api/providers
POST /api/providers/opencode/test
```

验收标准：Node 服务能独立启动、访问现有首页，并能返回自身健康状态；前端可加载锁定版本的 GSAP，且 reduced-motion 下不会强制播放装饰动画。

## 6. 阶段 2：OpenCode 配置和生命周期管理

- [x] 定义 `OpenCodeConfig`：命令路径、服务地址、端口、工作目录、启动模式和超时时间。
- [x] 支持两种连接方式：连接已运行的 OpenCode；由 Node 启动和守护 OpenCode。
- [x] 启动前检查命令是否存在，并记录版本和能力信息。
- [x] 实现 OpenCode 健康检查，不能只判断端口监听。
- [x] 实现自动启动、启动超时、异常退出检测和有限次数重启。
- [x] 防止多个 Node 进程重复启动同一个 OpenCode 服务。
- [x] 将 OpenCode 标准输出和错误输出写入受控日志文件。
- [x] OpenCode 不可用时：首页仍可打开、目录仍可浏览，运行按钮显示明确不可用状态。
- [x] 不在浏览器中暴露 OpenCode 实际地址、命令路径和服务端凭据。

验收标准：重启电脑或服务后，只启动 Node 即可恢复 OpenCode 连接；局域网用户不需要执行任何命令。

## 7. 阶段 3：扫描并标准化全部 Skill

- [x] 优先通过 OpenCode Skill API 获取当前可用 Skill 列表。
- [x] 对 API 返回信息不足的 Skill，在配置允许的 Skill 根目录内补充读取 `SKILL.md`、`skill.md`、`README.md`、脚本和静态资源。
- [x] 不允许扫描配置根目录之外的任意路径。
- [x] 定义统一的 `SkillManifest` 数据结构。

```ts
interface SkillManifest {
  id: string;
  provider: "opencode";
  name: string;
  displayName: string;
  description: string;
  sourcePath: string;
  sourceHash: string;
  inputs: SkillInput[];
  outputs: SkillOutput[];
  workflow: SkillWorkflowStep[];
  requirements: SkillRequirement[];
  assets: SkillAsset[];
  pageStatus: "missing" | "queued" | "generating" | "ready" | "failed" | "stale";
  enabled: boolean;
  lastScannedAt: string;
}
```

- [x] 解析 YAML frontmatter 中的名称、描述和元数据。
- [x] 解析文档中明确声明的输入、输出、默认值、枚举和必填性。
- [x] 识别文件上传、URL、文本、数字、布尔值、选项和本地项目等输入类型。
- [x] 解析不到明确字段时，使用通用 `taskText` 输入并记录低置信度警告。
- [x] 输出推断只能基于明确文档证据，不能虚构文件路径。
- [x] 修复当前生成器存在的流程未写入问题，确保解析到的 workflow 进入 Manifest。
- [x] 计算 Skill 内容指纹，覆盖主说明、相关脚本和用于页面展示的资源。
- [x] 将扫描结果保存到 SQLite，记录新增、更新、删除和禁用状态。
- [x] 实现启动扫描、手动扫描和定时扫描。
- [x] 扫描失败只影响对应 Skill，并保留上一次有效数据。

建议接口：

```text
POST /api/skills/sync
GET  /api/skills
GET  /api/skills/:skillId
GET  /api/skills/:skillId/source-summary
```

验收标准：OpenCode 返回多少个可用 Skill，首页目录就能获得多少条有效记录；新增或修改 Skill 后可被增量识别。

## 8. 阶段 4：保留现有卡片首页并改成动态目录

- [x] 将现有首页视觉基线迁移到 `node/frontend/index.html`，保留主结构和视觉样式。
- [x] 保留 `.skill-deck` 卡片层叠模型、滚轮切换、悬停和弹窗动画。
- [x] 按 `node/source/Skill Web Hub — 用户端.svg` 还原公共壳层中明确出现的布局；已在 `1440 x 900` 基准视口保存对照截图并记录允许差异，见 `node/docs/visual-acceptance-m2.md`。登录态、顶部状态、错误提示和空状态按阶段 0 的补充状态定义实现。
- [x] 将卡片首页拆为可复用的 `SkillDeck`、`SkillCard`、`SkillPreviewModal` 和 `ConnectionState` 模块，保持现有 DOM 视觉结果。
- [x] 使用共享 GSAP 模块实现卡片堆叠、切换、抬升、弹窗打开/关闭和列表进入动画；不能在每个 Skill 页面重复实现这些动效。
- [x] 使用共享 GSAP 模块处理桌面端动效和 `prefers-reduced-motion`；关闭或减少动效时不能影响卡片功能。移动断点不属于本期实现。
- [x] 动画只优先修改 transform、opacity/autoAlpha 和 CSS variables，避免用 GSAP 频繁驱动 width、height、top、left 造成布局抖动。
- [x] 删除 `node/frontend/app.js` 中硬编码的 `skillCards`，改为请求 `GET /api/skills`。
- [x] `stackSize` 根据实际 Skill 数量计算，不再复制同一批 Skill 填充固定 16 张卡片。
- [x] 每张卡片展示 Skill 名称、简述、提供方、页面状态和运行可用状态。
- [x] 为缺少预览图的 Skill 提供统一占位图，不阻塞目录展示。
- [x] 弹窗说明改为读取 Skill Manifest，不直接从任意路径 fetch Markdown。
- [x] 实现“开始使用”按钮，路由到 `/skills/:skillId`。
- [x] 页面未生成时，按钮显示“正在生成”或进入通用兜底页。
- [x] 对大量 Skill 增加搜索和分类过滤，但不破坏卡片交互的主入口。
- [x] 支持空目录、扫描中、扫描失败、OpenCode 离线等状态。
- [x] 保持桌面端键盘操作可用。

验收标准：所有已扫描 Skill 都出现在首页；用户端 SVG 中明确的公共壳层完成视觉验收，补充状态按阶段 0 定义齐全；当前卡片式交互与基线一致；点击任意卡片都能进入有效页面；关闭 reduced-motion 时无不可操作或闪烁。

## 9. 阶段 5：建立 Skill 页面预设提示词

- [x] 创建通用基础提示词 `prompts/skill-page-base.md`。
- [x] 创建至少三套布局提示词：
  - [x] `form-first.md`：以结构化参数和文件上传为核心。
  - [x] `workflow-console.md`：以步骤、状态和长时间任务为核心。
  - [x] `artifact-workbench.md`：以预览、文件产物和下载为核心。
- [x] 根据 Manifest 的输入、输出和 workflow 自动选择默认预设。
- [ ] 允许管理员为单个 Skill 固定预设或重新生成。
- [x] 提示词必须包含以下硬约束：
  - [x] 延续 Hub 的设计语言、色彩变量和圆角尺度。
  - [x] 不生成营销落地页，首屏直接是可操作界面。
  - [x] 所有输入字段必须来自 Manifest，不得虚构参数。
  - [x] 页面必须包含运行状态、问题/权限交互、日志和产物区域。
  - [x] 不直接调用 OpenCode，不包含服务端地址和凭据。
  - [x] 仅通过共享 `skill-runtime.js` 与 Node 通信；iframe 不直接访问 `/api/`，运行、交互和产物下载均由父页面校验并代理。
  - [x] 禁止引用未经批准的外部 CDN 和远程脚本。
  - [x] 输出必须符合固定文件和 JSON 协议。
- [x] 提示词不得要求 AI 重建设计 SVG 规定的 Hub 壳层；壳层、登录、运行面板、产物区和管理端 UI 由代码维护。
- [x] 生成内容只能填充 Skill 专属的内容区域，不能覆盖全局路由、鉴权、导航、CSP 或共享运行时。
- [ ] 为提示词增加版本号；版本变化时页面标记为 `stale`，不立即删除旧页面。

验收标准：同一个 Manifest 在相同提示词版本下能得到结构稳定、字段完整且可接入共享运行时的页面。

## 10. 阶段 6：调用 OpenCode 生成并持久化页面

- [x] 实现页面生成队列，限制同时生成数量为 1，防止压垮 OpenCode。
- [x] 为每个生成任务创建独立 OpenCode 会话和临时工作目录。
- [x] 把 Skill Manifest、选定预设、共享运行时接口和允许修改的文件范围传给 OpenCode。
- [x] 要求 OpenCode 输出：`index.html`、`styles.css`、可选 `view.js`、`view.manifest.json`。
- [x] 先写入临时目录，完成校验后再原子持久化到 `node/frontend/generated/<skill-id>/<version>/`，仅在成功后激活版本。
- [x] 校验 HTML、CSS、JavaScript 语法和 Manifest schema。
- [ ] 检查生成文件是否包含外部脚本、绝对路径、密钥、危险跳转或绕过共享运行时的网络请求。
- [ ] 用无头浏览器验证页面能够加载、关键区域存在、没有明显溢出或脚本错误。
- [x] 生成成功后记录 Skill hash、提示词版本、生成时间和 OpenCode 会话 ID。
- [x] 生成失败时保留旧页面，并保存错误摘要；上游错误、权限/提问或超时时暂停自动队列，避免批量无效重试；管理员显式重新生成可恢复队列，管理端重试入口留待 M5。
- [x] 首次同步后自动排队生成缺失页面；不要阻塞首页启动。
- [x] Skill 内容不变时直接复用已生成页面。
- [x] Skill 更新时继续提供旧页面，同时后台生成新版，成功后再切换。
- [ ] 提供管理员操作：生成、重新生成、切换预设、查看生成日志、回滚上一版。

建议接口：

```text
POST /api/skills/:skillId/page/generate
GET  /api/skills/:skillId/page/status
POST /api/skills/:skillId/page/activate/:version
GET  /skills/:skillId
```

验收标准：首次生成后重启 Node 不会重复生成；修改 Skill 后只重新生成对应页面；生成失败仍可使用通用页面运行 Skill。

## 11. 阶段 7：建立统一 Skill 运行协议

- [x] 页面提交表单时只发送 Manifest 字段值和已上传文件的 ID；上传本身在产物阶段接入。
- [x] Node 验证字段类型、长度、必填性和允许值。
- [x] Node 根据 Skill Manifest 构造并发送 OpenCode 提示词，浏览器不得自行决定系统指令；`buildRunPrompt` 仅在服务端执行，并已通过真实 OpenCode Run 验证。
- [x] 每次运行创建唯一 `runId`、OpenCode session ID、当前单用户 owner ID 和独立工作目录；多用户身份归属在 M6 替换为真实会话用户。
- [x] 实现开始、问题/权限回复后的继续、终止和超时操作。
- [x] 定义并持久化以下统一事件；OpenCode 流式消息接入后只能映射到这些事件：

```ts
type RunEvent =
  | { type: "run.created" }
  | { type: "run.started" }
  | { type: "message.delta"; text: string }
  | { type: "tool.started"; tool: string }
  | { type: "tool.finished"; tool: string }
  | { type: "question.pending"; questionId: string }
  | { type: "permission.pending"; permissionId: string }
  | { type: "artifact.created"; artifactId: string }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string }
  | { type: "run.aborted" };
```

- [x] 通过 SSE 将运行事件推送给对应浏览器。
- [x] 浏览器断线重连后，可按事件序号恢复运行状态。
- [x] 保存运行记录、失败摘要和必要事件日志，重启服务后仍可查看历史结果。
- [x] 运行中的 OpenCode 问题和权限请求绑定 `runId`，服务端拒绝跨 Run 回复；多用户归属校验在 M6 接入。
- [x] 页面提供回答问题、允许一次和拒绝操作。
- [ ] “始终允许”只允许管理员使用，并限定在明确权限范围内。

建议接口：

```text
POST /api/runs
GET  /api/runs/:runId
GET  /api/runs/:runId/events
POST /api/runs/:runId/abort
POST /api/runs/:runId/questions/:questionId/reply
POST /api/runs/:runId/permissions/:permissionId/reply
```

验收标准：任意生成页和通用兜底页都可以用同一运行协议执行 Skill，并实时显示完整状态。

## 12. 阶段 8：产物发现、预览和安全下载

- [x] 为每次运行建立独立产物目录和允许访问的根目录集合。
- [x] 在完成、终止或失败时扫描受控运行目录收集产物；后续可按 OpenCode 工具结果进一步补充即时发现。
- [x] 不再依赖正则从文本中提取任意本机绝对路径作为下载地址。
- [x] 产物入库时生成 `artifactId`，保存受控相对路径、显示名、MIME、大小、hash、runId 和所有者；数据库不保存可直接暴露的下载路径。
- [ ] 下载接口只接收 `artifactId`，并再次验证用户和运行归属。
- [x] 支持常见产物预览：图片、SVG、PDF、Markdown、HTML、文本和结构化 JSON。
- [x] PPTX、DOCX、ZIP 等不可直接预览的文件显示类型、大小和下载操作。
- [x] HTML/SVG 预览使用隔离 iframe 和严格 CSP，禁止访问 Hub 的认证信息。
- [x] 产物创建后立即通过 SSE 更新页面。
- [x] 运行结束后展示最终状态、摘要、耗时、产物数量和下载列表。
- [ ] 提供运行历史页，用户可再次查看自己之前的状态和产物。
- [ ] 定义产物保留时间、过期清理和管理员保留策略。

建议接口：

```text
GET /api/runs/:runId/artifacts
GET /api/artifacts/:artifactId/metadata
GET /api/artifacts/:artifactId/preview
GET /api/artifacts/:artifactId/download
```

验收标准：用户不需要知道服务端路径即可查看和下载自己的产物；不能通过修改请求读取其他运行或本机任意文件。

## 13. 阶段 9：局域网多用户访问

- [ ] 明确初版身份方案。建议至少使用管理员创建的账号和密码，不允许匿名执行 Skill。
- [ ] 实现登录、会话过期、退出和密码安全存储。
- [ ] 定义管理员和普通用户角色。
- [ ] 管理员可配置 OpenCode、扫描 Skill、生成页面、查看系统状态。
- [ ] 普通用户只能浏览已启用 Skill、运行 Skill、处理自己的交互和访问自己的产物。
- [ ] 所有上传、运行、日志和产物按用户隔离。
- [ ] 增加并发限制、单用户运行额度、上传大小限制和请求速率限制。
- [ ] 对高风险 Skill 增加管理员启用开关和额外确认。
- [ ] 增加操作审计：登录、运行、权限回复、下载、配置变更和页面生成。
- [ ] 设置严格 CORS，不使用 `Access-Control-Allow-Origin: *`。
- [ ] 增加 CSP、安全响应头和 CSRF 防护。
- [ ] 默认只监听指定局域网网卡或 `0.0.0.0`，不得自动映射公网。
- [ ] 提供 Windows 防火墙配置说明，仅放行选定私有网络和端口。
- [ ] 支持固定局域网 IP 或内部 DNS 名称。
- [ ] 推荐使用 Caddy/Nginx 反向代理；涉及账号时启用 HTTPS。

验收标准：另一台未安装任何 Agent 或 Skill 的局域网设备，可以登录、运行一个 Skill、回答交互问题并下载产物；不能读取其他用户数据。

## 14. 阶段 10：管理页面和运维能力

- [ ] 按管理端 SVG 还原公共壳层、侧边导航、表格、筛选、抽屉和确认弹窗中明确出现的布局；权限状态按阶段 0 的补充状态定义实现。
- [ ] 将管理端页面落成独立路由：`/admin`、`/admin/providers`、`/admin/skills`、`/admin/page-generation`、`/admin/runs`、`/admin/users`、`/admin/storage`。
- [ ] 为每个管理端路由实现加载中、空数据、错误、无权限和离线状态。
- [ ] 管理端长列表和队列更新使用轻量 GSAP 状态动画；不得用动画隐藏错误、权限变化或任务状态。
- [ ] 增加系统状态页：Node、OpenCode、数据库、扫描器、生成队列和运行队列。
- [ ] 增加 Skill 管理页：启用/禁用、扫描状态、页面版本、提示词预设和最后错误。
- [ ] 增加运行管理页：运行人、Skill、状态、开始时间、耗时和终止操作。
- [ ] 增加存储使用统计和产物清理入口。
- [ ] 支持导出不含密钥的诊断包。
- [ ] 提供数据备份和恢复流程，至少覆盖数据库、配置引用和已生成页面。
- [ ] 将 Node 服务和 OpenCode 配置为开机启动或受控 Windows 服务。
- [ ] 增加版本信息和数据库迁移机制。

验收标准：管理员可以只通过网页判断系统是否健康，并处理扫描、生成和运行故障；管理端 SVG 中明确的页面完成视觉验收，权限状态和空/错/离线等补充状态均可验收。

## 15. 阶段 11：测试与最终验收

- [ ] 单元测试：Manifest 解析、hash、字段验证、路径限制、权限判断和状态转换。
- [ ] 集成测试：OpenCode 健康检查、Skill 扫描、页面生成、运行、问题回复、权限回复和终止。
- [ ] 接口测试：非法 Skill ID、非法 runId、越权 artifactId、超大上传和断线重连。
- [ ] 浏览器测试：首页卡片交互、Skill 路由、表单、实时状态、产物预览和下载。
- [ ] 视觉回归：桌面端与阶段 0 基线比较。
- [ ] 对 `node/source` 中的用户端和管理端 SVG 设计源按阶段 0 登记的基准视口截图并执行视觉差异检查；像素差异阈值、允许差异区域和“补充实现”豁免项必须在阶段 0 记录。
- [ ] 安全测试：路径穿越、任意文件下载、跨用户访问、XSS、生成 HTML 注入和权限越权。
- [ ] 恢复测试：Node 重启、OpenCode 重启、页面生成中断和运行中浏览器刷新。
- [ ] 性能测试：大量 Skill、同时页面生成和多用户同时运行。
- [ ] 使用一台全新局域网设备执行端到端验收，该设备不能预装 OpenCode 或任何 Skill。

最终验收场景：

1. 管理员启动 Node 服务。
2. Node 自动连接或启动 OpenCode。
3. 系统扫描所有 OpenCode Skill 并更新首页卡片。
4. 缺少页面的 Skill 在后台生成并保存页面。
5. 普通用户从另一台局域网设备打开 Hub。
6. 用户选择一个 Skill，填写参数并上传文件。
7. 页面实时显示排队、执行、工具调用、问题、权限和完成状态。
8. 页面展示所有允许访问的产物，用户可预览或下载。
9. 重启服务后，Skill 页面、目录、运行历史和产物记录仍然存在。

## 16. 更新后的阶段目标

- [x] M0：Figma 设计导出的 SVG 源登记与解析 + 1:1 范围、页面/状态/视口映射 + 设计令牌、GSAP 版本和动效基线冻结。
- [x] M1：Node/TypeScript 骨架 + OpenCode 健康检查、生命周期管理 + 动态 Skill 扫描和 Manifest 入库。
- [x] M2：用户端壳层和现有卡片首页动态化；保持卡片交互并接入 GSAP 共享动画模块，已完成用户端 SVG 的 `1440 x 900` 1:1 壳层视觉验收，证据见 `node/docs/visual-acceptance-m2.md`。
- [ ] M3：通用 Skill 操作页 + 统一运行状态、问题/权限处理、SSE 和安全产物下载。
- [ ] M4：三套页面生成提示词 + OpenCode 页面生成、校验、持久化、版本切换和兜底页。
- [ ] M5：管理端 UI + OpenCode/Skill/页面生成/运行/用户/存储管理，并完成 RBAC 和管理端 SVG 的 `1440 x 900` 1:1 壳层视觉验收。
- [ ] M6：局域网认证、用户隔离、审计、防火墙/反向代理部署、恢复能力和完整测试。
- [ ] M7：旧 `server.js`/`public/` 迁移验收、灰度切换、性能回归和旧服务下线。

不要先做 AI 页面生成再补运行协议。M3 的通用操作页必须先跑通，因为它既是所有生成页面的接口标准，也是页面生成失败时的永久兜底。

## 17. 开工前需要确认的产品决策

- [x] Figma 设计导出的用户端、管理端和配色板 SVG 已放入 `node/source/`，并通过设计源审计。
- [x] 本期以 `node/source/` 中三份 SVG 作为视觉验收源；无需等待 Figma 链接、在线访问权限或原始 `.fig` 文件。
- [ ] 若后续需要还原 SVG 未包含的组件变体或原型连接，再补充原始 Figma 文件或交互说明；它只扩展后续范围，不阻塞当前桌面端 M2-M6。
- [ ] 局域网用户是否必须登录。本文默认“必须登录”，匿名只允许浏览已启用 Skill。
- [ ] OpenCode 是由 Node 自动启动，还是由管理员单独启动。本文默认两种都支持，生产默认 Node 守护。
- [ ] 普通用户是否能批准工具权限。本文默认只能批准低风险的“一次允许”，高风险权限交给管理员。
- [ ] 生成页面是否提交 Git。本文默认已审核稳定页面可提交，临时版本不提交。
- [ ] 运行产物保留多久。建议默认 7 或 30 天，由管理员配置。
- [ ] 是否允许 Skill 访问宿主机任意目录。本文默认不允许，只能访问本次运行工作区和显式配置的只读资源。
- [ ] 第一版是否只支持 Windows。当前环境和路径均为 Windows，建议第一版先限定 Windows，协议层保持跨平台。
