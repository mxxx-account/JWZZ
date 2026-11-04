# 阶段 2 验收：登录与报告授权

本阶段只验证身份、角色和报告访问权限。页面上的报告是虚构数据，不会分析体检指标，也不提供医疗建议。医生账号仅在 `dev` 配置下由本地环境变量创建；不要把演示密码上传到 Git。

## 自己动手验收

1. 按 [本地开发说明](development.md) 启动 MySQL、Java 后端和 Next.js 前端，打开 [http://localhost:3000](http://localhost:3000)，确认“检查后端连接”成功。
2. 选择“注册用户”，用自己的测试邮箱注册。密码至少 12 位。注册成功后应进入“用户工作台”。
3. 点击“创建一份虚构演示报告”，确认报告出现，且“当前授权”为“无”。
4. 在另一个浏览器或无痕窗口登录医生演示账号。邮箱和密码取自本机被 Git 忽略的 `server/.env.local.ps1` 中 `DEMO_DOCTOR_EMAIL`、`DEMO_DOCTOR_PASSWORD`。医生工作台此时不应看到刚创建的报告。
5. 回到用户窗口，在报告下方输入医生邮箱，点击“授权医生查看”。刷新医生工作台，报告应出现。
6. 回到用户窗口点击“撤销…的权限”。刷新医生工作台，报告应消失。
7. 两边分别点击“退出登录”。再次进入对应工作台，应被带回登录页。

如果 Java 服务没有以 `dev` 配置启动，“创建一份虚构演示报告”接口不可用；检查 `server/.env.local.ps1` 里的 `SPRING_PROFILES_ACTIVE=dev`。`dev` 配置只适用于本机演示。

## 自动化验收

在后端运行且使用 `dev` 配置时，从项目根目录执行：

```powershell
.\scripts\verify_stage2.ps1
```

需要 PowerShell 7。脚本会创建两个随机测试用户和一份虚构报告，验证未登录、跨用户、未授权医生、授权、撤销、角色隔离、CSRF 和退出登录。脚本不会删除这些测试记录；邮箱使用 `example.invalid` 域名。

## 阶段 2 接口速查

后端地址：`http://localhost:8080`。浏览器调用跨域接口时需携带会话 Cookie（`credentials: "include"`）。除 `GET` 外，先调用 `GET /api/auth/csrf` 获取 `token`，并在写请求中放入 `X-XSRF-TOKEN` 请求头。登录表单使用 `application/x-www-form-urlencoded`；其余含请求体的接口使用 JSON。

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/auth/csrf` | 获取 CSRF 令牌 | 公开 |
| `POST /api/auth/register` | 注册用户，JSON：`email`、`password` | 公开 |
| `POST /api/auth/login` | 登录，表单：`email`、`password` | 公开 |
| `GET /api/auth/me` | 查询当前用户与角色 | 已登录 |
| `POST /api/auth/logout` | 退出登录 | 已登录 |
| `GET /api/reports` | 当前用户自己的报告列表 | 用户 |
| `POST /api/dev/reports` | 创建虚构报告，仅用于验收 | 用户，且仅 `dev` 配置 |
| `GET /api/reports/{id}` | 查看自己的或已获授权的报告 | 报告所有者／获授权医生 |
| `GET /api/reports/{id}/grants` | 查看报告授权 | 报告所有者 |
| `POST /api/reports/{id}/grants` | 授权医生，JSON：`doctorEmail` | 报告所有者 |
| `DELETE /api/reports/{id}/grants/{doctorId}` | 撤销授权 | 报告所有者 |
| `GET /api/doctor/reports` | 查看获授权的报告列表 | 医生 |

未登录访问受保护接口返回 401；角色不符通常返回 403；对不存在或无权查看的报告统一返回 404，避免泄露报告是否存在。
