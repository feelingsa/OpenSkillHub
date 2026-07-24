# 备份与恢复

管理端的 Storage 页面会创建一个受控备份目录。每个备份包含：

- SQLite 一致性备份 `hub.db`；
- `frontend/generated/` 中当时已生成的 Skill 页面；
- 不含凭据、路径、OpenCode URL 和命令的 `manifest.json` 与诊断摘要。

## 创建和下载

管理员在 `/admin/storage` 选择 **Create backup** 后，可下载该备份的数据库文件。备份目录位于受 Git 忽略保护的 `data/backups/`，不应提交到仓库。

## 恢复步骤

1. 停止 Skill Web Hub 服务，确认没有其他进程占用目标数据库。
2. 将当前 `data/*.db` 和 `frontend/generated/` 复制到一个单独的、带日期的安全位置。
3. 将备份目录中的 `hub.db` 复制到 `.env` 的 `HUB_DATA_PATH` 所指位置。
4. 将备份目录中的 `generated-pages/` 内容复制回 `frontend/generated/`。
5. 保留当前 `.env`，不要从备份或诊断文件恢复管理员密码、OpenCode URL 或本机路径。
6. 启动 Hub，检查 `/api/health`、管理员 Storage 页面和一个已生成的 Skill 页面。

恢复会覆盖运行记录、页面版本元数据和相关产物索引，必须由管理员在停机窗口执行。
