# 管理员访问

管理页面位于 `/admin`。所有 `/api/admin/*` 接口都要求服务端会话认证；前端导航隐藏不是安全边界。

## 配置

在 `node/.env` 中设置以下值后重启 Hub：

```dotenv
HUB_ADMIN_USERNAME=admin
HUB_ADMIN_PASSWORD=use-a-unique-password-with-at-least-12-characters
HUB_SESSION_TTL_MS=86400000
```

会话令牌为随机值，浏览器只收到 HttpOnly、SameSite=Lax cookie；数据库只保存令牌的 SHA-256 哈希。部署到局域网前必须替换默认密码 `change-me-before-lan-use`。

## 当前范围

- 单个由 `.env` 配置的 bootstrap 管理员。
- 管理员可以检查 OpenCode 状态、扫描和启停 Skill、生成或切换页面版本、终止运行并查看存储摘要。
- 多用户账户、普通用户隔离、审计和产物保留/清理策略属于 M6，尚未实现。
