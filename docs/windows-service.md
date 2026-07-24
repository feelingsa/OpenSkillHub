# Windows 服务部署

`scripts/install-hub-service.ps1` 为 Windows 提供受控服务注册脚本。它默认运行构建后的 `dist/server.js`，因此每次升级后先执行：

```powershell
npm.cmd run build
```

以管理员 PowerShell 执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-hub-service.ps1 -ProjectRoot "E:\Skills\SkillsWebHub\node"
```

服务读取项目根目录 `.env`，其中 `HUB_HOST=0.0.0.0` 才能在局域网提供 Hub。OpenCode 仍应保持 `127.0.0.1`，不要直接将其监听到局域网。修改 `.env` 或升级构建后使用：

```powershell
Restart-Service SkillWebHub
```

生产局域网发布建议由 Caddy 提供 HTTPS，并将 Hub 改为 `HUB_HOST=127.0.0.1`、`HUB_COOKIE_SECURE=true`。防火墙、内部 DNS 和 Caddy 配置见 `docs/lan-deployment.md`。

卸载服务：

```powershell
Stop-Service SkillWebHub
sc.exe delete SkillWebHub
```
