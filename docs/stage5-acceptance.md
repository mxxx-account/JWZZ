# 阶段 5 验收：演示咨询与 Redis

此文档保留阶段 5 完成时的验收步骤。当前页面已升级为持续对话和医生目录，最新操作请看[消息页迭代验收](messages-acceptance.md)。原有接口仍兼容。

本阶段增加异步演示咨询、医生接单与回复，以及公开指标说明缓存。它不是在线医疗服务，不提供实时问诊、诊断、处方或用药剂量。不要填写真实患者隐私。

## 启动

先按 [本地开发说明](development.md) 启动 MySQL。当前 Windows 电脑已有 Ubuntu WSL 和 Redis，可在 PowerShell 执行：

```powershell
wsl -d Ubuntu -u root -- service redis-server start
wsl -d Ubuntu -- redis-cli ping
```

第二行应返回 `PONG`。在启动 Java 的终端，加载 `server/.env.local.ps1` 后设置 `$env:JWZZ_REDIS_ENABLED='true'`，再运行 `mvn spring-boot:run`。前端仍在 `web/` 执行 `npm run dev`。Flyway 会自动建 `consultation_request` 表。
若 WSL 在命令执行后空闲退出，请另开一个 Ubuntu 终端保持运行，再启动 Java；否则 Redis 端口可能短暂可用后消失。

## 自己动手验收

1. 用户登录后，进入“录入体检指标”，展开“指标填写说明”。应看到八项公开指标的单位与填写说明；内容不含任何用户报告或身份信息。
2. 在“最近录入”生成一份真实测试指标报告。未授权医生时，报告下的演示咨询区域提示先授权，不能提交问题。
3. 授权医生查看这份报告，输入至少 10 个字的问题并点击“提交演示咨询”。用户端出现“待接单”；医生端刷新后应看到咨询及报告编号。
4. 医生点击“接单”。状态变成“已接单”；再输入至少 10 个字的演示回复并发送。用户刷新页面后应看到回复。
5. 用户撤销该报告的医生授权。医生刷新后，报告和关联咨询都应从列表消失；即使此前接单，也不能再回复。
6. 过快提交第六条咨询时，接口应返回 429（每位用户每分钟最多 5 条）；医生回复每分钟最多 20 次。该限流只保护演示写接口，不是完整的生产风控。

## 技术验证重点

- `POST /api/doctor/consultations/{id}/claim` 使用 MySQL 的带 `status='OPEN'` 条件更新。并发请求只有一个 200，其他返回 409，不依赖 Java 进程内锁。
- `GET /api/public/indicators` 使用版本化键 `jwzz:indicator-catalog:catalog-2026-01` 和 10 分钟 TTL；内容变更时提升版本号，旧键自动过期。响应头带 10 分钟公共缓存控制。
- 开启 Redis 后，咨询创建/回复使用 Redis Lua 原子计数加过期时间；Redis 不可用时回退到单实例本地计数。不要把用户数据放进公开缓存。
- 医生只能读取仍获授权报告关联的咨询。跨用户读写和无授权访问均应被拒绝；写操作仍需会话和 CSRF 令牌。

接口简表：`GET/POST /api/consultations`（用户）；`GET /api/doctor/consultations`、`POST /api/doctor/consultations/{id}/claim`、`POST /api/doctor/consultations/{id}/reply`（医生）；`GET /api/public/indicators`（公开）。

## 自动化验收

在后端、MySQL 和 Redis 运行时，从项目根目录执行 `./scripts/verify_stage5.ps1`（PowerShell 7）。脚本创建随机账号及少量测试记录，检查跨用户隔离、授权前后、医生回复、8 个并发接单请求、接口限流和撤销后的访问控制，不会删除已有记录。若测试服务在 8081，可加 `-BaseUrl 'http://127.0.0.1:8081'`。后端单元测试在 `server/` 执行 `mvn test`，前端在 `web/` 执行 `npm run build`。
