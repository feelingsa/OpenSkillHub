# OpenSkillHub 局域网发布

Hub 是唯一允许面向局域网的服务。OpenCode 必须始终监听 `127.0.0.1`，路由器不得配置任何公网端口转发。

## 1. 固定地址和账户

1. 在 DHCP 服务器为 Hub 主机绑定固定 IP，或在内部 DNS 创建固定名称，例如 `skillhub.lan`。
2. 在 `node/.env` 设置唯一的 `HUB_ADMIN_PASSWORD`，并保持 `HUB_AUTH_REQUIRED=true`。
3. OpenCode 配置保持 `OPENCODE_URL=http://127.0.0.1:4197`；不要将 OpenCode 端口开放到 LAN。
4. 通过 `/admin/users` 创建每位使用者的单独账号。不要共享管理员账号。
5. 对需要额外确认的 Skill，在 `.env` 中将其 ID 加到 `HUB_HIGH_RISK_SKILL_IDS_JSON`，例如 `HUB_HIGH_RISK_SKILL_IDS_JSON=["opencode--deployment"]`。这些 Skill 仍必须先由管理员启用，且每次运行必须在用户页面确认。

## 2. 推荐的 HTTPS 发布方式

在 Hub 主机安装 Caddy，并让 Node 只监听回环地址：

```dotenv
HUB_HOST=127.0.0.1
HUB_PORT=5177
HUB_COOKIE_SECURE=true
```

使用以下 Caddyfile。`tls internal` 适用于只有内部 DNS 的网络；所有客户端都必须信任该 Caddy 内部 CA。已有内部 CA 时改为组织的证书配置。

```caddyfile
https://skillhub.lan {
    tls internal
    reverse_proxy 127.0.0.1:5177
}
```

重启 Caddy 和 `OpenSkillHub` 服务后，从另一台局域网设备访问 `https://skillhub.lan/login`。浏览器必须没有证书警告，且登录 cookie 应带 `Secure` 属性。

## 3. Windows 私有网络防火墙

以管理员 PowerShell 仅为私有网络放行 HTTPS。Caddy 监听 443 时执行：

```powershell
New-NetFirewallRule -DisplayName "OpenSkillHub HTTPS (Private)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -Profile Private
```

仅在临时受控测试中直连 Node 时，设置 `HUB_HOST=0.0.0.0` 并仅放行其端口：

```powershell
New-NetFirewallRule -DisplayName "OpenSkillHub HTTP Test (Private)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5177 -Profile Private
```

直连 HTTP 不应传输真实账户或生产数据。完成 HTTPS 发布后删除临时规则：

```powershell
Remove-NetFirewallRule -DisplayName "OpenSkillHub HTTP Test (Private)"
```

## 4. 验收和恢复

1. 在未安装 OpenCode 或 Skill 的另一台设备登录普通用户账号。
2. 运行一个 Skill，上传一个测试文件，确认页面显示运行状态并可下载自己的产物。
3. 使用另一普通用户账号确认无法打开前一账号的运行或产物 URL。
4. 在 `/admin` 检查审计记录、限额和存储状态；恢复步骤见 `docs/backup-recovery.md`。

`/api` 不提供跨域 CORS 许可，浏览器只能从 Hub 自己的来源访问接口。CSP、CSRF、HttpOnly cookie 和服务端 RBAC 共同保护该 LAN 部署；它们不是公网暴露的替代措施。
