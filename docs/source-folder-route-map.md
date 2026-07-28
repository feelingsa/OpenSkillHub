# Current Source Folder Route Map

The desktop design source of truth is `node/source/`. Source SVGs are visual references only and are not embedded in the running application.

| Source board | Route | Implemented capability |
| --- | --- | --- |
| `用户界面/U01 · 用户登录.svg` | `/login` | One login form; the authenticated server role redirects an administrator to `/admin` and a user to `/`. |
| `用户界面/U02 · 发现 Skill.svg` | `/` | Authenticated Skill catalog with the preserved card-stack interaction. |
| `用户界面/U03 · Skill 详情与运行.svg` | `/skills/:skillId` | Manifest inputs, launch, and interactive run controls. |
| `用户界面/U04 · 运行状态.svg` | `/runs/:runId` | Event timeline, active state, question, and permission handling. |
| `用户界面/U05 · 产物下载.svg` | `/runs/:runId` | Secure preview and download of run-scoped artifacts. |
| `管理员界面/A01 · 用户管理.svg` | `/admin/users` | Accounts, roles, enablement, and creation. |
| `管理员界面/A02 · 网络管理.svg` | `/admin/network` | LAN addresses, listener configuration, and exposure guidance. |
| `管理员界面/A03 · Agent 连接.svg` | `/admin/providers` | OpenCode health check and redacted diagnostics. |
| `管理员界面/A04 · 实时用户运行负载.svg` | `/admin/load` | Active work, waiting interactions, and per-user load. |
| `管理员界面/A05 · 技能库管理.svg` | `/admin/skills` | Scan, enablement, manifest inspection, and page generation. |

The shared palette source is `整体配色/Skill Web Hub — 配色.svg` (a retained historical asset filename). Its tokens live in `frontend/styles/tokens.css`.
