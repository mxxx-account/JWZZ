# HTTP 接口文档（当前实现）

本地默认后端 `http://localhost:8080`；完整 Compose 环境映射为 `http://localhost:8081`。以下路径均以 `/api` 开头。登录采用会话 Cookie；跨域浏览器请求需 `credentials: include`。除 GET 外，先请求 `GET /auth/csrf`，把返回的 `token` 放入 `X-XSRF-TOKEN` 头。未登录一般 401，角色不符 403，非本人/未授权资源通常 404，业务状态冲突 409，限流 429。示例均为演示数据。

| 方法与路径 | 角色 | 请求要点 | 成功结果 |
|---|---|---|---|
| GET `/health` | 公开 | 无 | `200 {status:"ok"}`；只表示进程可响应，不代表所有依赖健康 |
| GET `/auth/csrf` | 公开 | 无 | `200 {token}` |
| POST `/auth/register` | 公开 | `{email,name,password,role,specialty?}`；医生须选三科之一，且仅开发配置允许自行注册 | `201` 用户信息；不发送邮件、不核验医生资格 |
| POST `/auth/login` | 公开 | 表单 `email,password` | `200` 并设置会话 Cookie |
| POST `/auth/logout` | 已登录 | 无 | `204` |
| GET `/auth/me` | 已登录 | 无 | `200 {id,email,role,name}` |
| GET `/public/indicators` | 公开 | 无 | `200` 八项指标说明，版本化公共缓存 |
| POST `/indicators` | 用户 | `{category,measuredAt,context,ageYears,pregnant,values}` | `201 {entryId,values,rulesStatus,draftInterpretations}` |
| GET `/indicators` | 用户 | 无 | `200` 本人最近 100 条指标值 |
| GET `/indicators/trends` | 用户 | `?code=...&context=...` | `200` 同条件、同指标最多 50 条趋势值 |
| POST `/reports` | 用户 | `{entryId}` | `200` 固定快照；重复调用返回同一报告 |
| GET `/reports` | 用户 | 无 | `200` 本人所有报告；当前未分页 |
| GET `/reports/archive` | 用户 | `page` 从 0 开始、`size` 1–50（默认 12）；可选 `sort=NEWEST/OLDEST`、`category=BP/GLUCOSE/LIPID`、`from/to=yyyy-MM-dd`、`reportId` | `200 {items:[{id,title,category,createdAt}],total,page,size}`；只返回本人报告摘要 |
| GET `/reports/context` | 用户 | 无 | `200` 本人血压、血糖、血脂各最新一份完整报告，供科室推荐参考 |
| GET `/reports/{id}` | 报告所有者/获授权医生 | 无 | `200` 报告；越权 404 |
| GET `/doctor/reports` | 医生 | 无 | `200` 当前仍获授权的报告 |
| GET `/reports/{id}/grants` | 报告所有者 | 无 | `200` 活跃授权医生名单 |
| POST `/reports/{id}/grants` | 报告所有者 | `{doctorEmail}` | `200 {doctorId,doctorEmail}`；重授权恢复 |
| DELETE `/reports/{id}/grants/{doctorId}` | 报告所有者 | 无 | `204` 软撤销 |
| GET `/doctors` | 用户 | 无 | `200` 三科演示医生及近期页面活跃状态 |
| POST `/doctor/presence` | 医生 | 无 | `204` 更新活跃时间 |
| GET `/consultations` | 用户 | 无 | `200` 本人最近 100 条咨询 |
| POST `/consultations` | 用户 | `{reportId,doctorId,question?}`；医生须已获该报告授权 | `201` 咨询；空问题自动填问候语并创建首条消息；每用户每分钟最多 5 次 |
| GET `/doctor/consultations` | 医生 | 无 | `200` 定向给本人且仍有授权的咨询；首页筛选 `OPEN` 作为待咨询 |
| POST `/doctor/consultations/{id}/claim` | 目标医生 | 无 | `200` 接受咨询；竞争失败 409，成功后医生消息页可见会话 |
| POST `/doctor/consultations/{id}/reply` | 已接单医生 | `{answer}`，10–2000 字 | `200` 更新旧版答复并写消息；旧接口保留兼容 |
| GET `/messages/conversations` | 用户/医生 | 无 | `200` 会话摘要；医生只看已接受的会话，用户提交后即可看自己的会话 |
| GET `/messages/conversations/{id}` | 会话用户/已接受医生 | 无 | `200 {conversation,messages}`，目前最多 500 条；医生未接受时 404 |
| POST `/messages/conversations/{id}` | 会话用户/已接单医生 | `{body}`，1–2000 字 | `201` 新消息；撤销授权后禁止发送；用户/医生分别每分钟最多 30/60 条 |
| POST `/messages/conversations/{id}/read` | 会话用户/目标医生 | 无 | `204` 更新已读游标 |

指标录入示例：

```json
{"category":"BP","measuredAt":"2026-11-05T10:00:00","context":"HOME","ageYears":22,"pregnant":false,"values":{"systolic_bp":{"value":130,"unit":"mmHg"},"diastolic_bp":{"value":80,"unit":"mmHg"}}}
```

主流程错误语义：未授权即咨询返回 409；指定医生不是当前获授权者返回 409；医生未接受时访问消息会话返回 404；患者撤销后医生访问返回 404，患者仍可读历史但发消息返回 409。CSRF 缺失返回 403。不要将这些研发预览接口用于真实患者资料或诊疗。

实现出处：`server/src/main/java/com/jwzz/server` 下的 Controller、`SecurityConfig`、V1–V6 迁移。手工验收见[消息页验收](messages-acceptance.md)。
