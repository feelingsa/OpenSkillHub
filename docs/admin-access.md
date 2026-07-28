# OpenSkillHub 管理员访问

管理页面位于 `/admin`。所有 `/api/admin/*` 接口都要求服务端会话认证；前端导航隐藏不是安全边界。

## 配置

在 `node/.env` 中设置以下值后重启 Hub：

```dotenv
HUB_ADMIN_USERNAME=<管理员用户名>
HUB_ADMIN_PASSWORD=<至少 12 位的唯一强密码>
HUB_SESSION_TTL_MS=86400000
```

会话令牌为随机值，浏览器只收到 HttpOnly、SameSite=Lax cookie；数据库只保存令牌的 SHA-256 哈希。部署到局域网前必须设置唯一的强密码。通过 HTTPS 反向代理发布时设置 `HUB_COOKIE_SECURE=true`，让浏览器只在 HTTPS 请求中携带会话 cookie。

## 当前范围

- 首次启动将 `.env` 中的 bootstrap 管理员安全写入数据库；管理员可在 `/admin/users` 创建、禁用和调整普通用户或其他管理员。
- 密码使用随机盐的 `scrypt-v1` 哈希保存。禁用账户或重设密码会撤销该用户的现有会话，系统拒绝禁用或降级最后一个启用状态的管理员。
- 普通用户只能访问自己的运行、事件、上传和产物。管理员接口始终在服务端执行 RBAC。
- `/admin` 首页显示近期审计记录；登录、用户管理、扫描、页面生成、运行、权限回复、上传、产物预览/下载和存储维护都会写入审计表。
- 运行额度、登录和接口速率、上传大小以及会话有效期均通过 `.env` 配置。详细局域网发布步骤见 `docs/lan-deployment.md`。
