# HTTP 接口文档（当前实现）

## 血压知识解释

- `GET /api/reports/{reportId}/assistant/knowledge` 返回已核对的快捷问题。
- `POST` 同路径（需 CSRF），请求体 `{"question":"为什么要记录测量条件？"}`。非空且最多 200 字符，仅血压报告所有者可访问。
- 返回 `ANSWERED` 或 `INSUFFICIENT_EVIDENCE`；每段有机构、标题、章节和链接，另有资料库版本。问法未覆盖时不生成替代答案或引用。功能只用本地资料，不调用外部 AI。

## 模拟履约与退款（V15）

完整参数、状态机及库存语义见[第四阶段契约](fulfillment-acceptance.md#http-契约)。用户/商家分别通过 `GET /api/shop/orders/{id}/lifecycle`、`GET /api/merchant/orders/{id}/lifecycle` 查询。商家 POST `.../ship` 发货，用户 POST `.../receive` 收货；用户 POST `.../refunds` 申请整单退款，商家 POST `.../refunds/{refund}/review` 审核，用户 POST `.../refunds/{refund}/return` 模拟退货，商家 POST `.../refunds/{refund}/inspect` 验收（RESTOCK/DISCARD）。无真实资金或物流，金额由订单快照决定，退款流水一单最多一笔。

## 咨询结束与随访（V14）

见[完整契约与状态说明](followups-acceptance.md#数据库与-api)。`GET /api/followups` 支持 beforeId/size 游标；`GET /api/followups/{id}` 查询小结待办；医生 `POST /api/followups/{id}/close` 结束；用户 `POST /api/followups/{id}/tasks` 新增提醒，`POST /api/followups/{id}/tasks/{task}/confirm|cancel|complete` 确认、取消或完成。商家 403；他人咨询或医生原报告撤权 404；结束后消息写入 409。提醒时间使用带时区 ISO 8601，用户确认之前不触发。关联报告需要独立授权。

通知新增 CONSULTATION_CLOSED 与 RECORD_REMINDER_DUE；后者 resourceId 是待办 ID，其 href 指向所属咨询随访。取消或完成后不再显示该到期通知。

## 站内通知（V13）

以下完整路径无需再加 `/api`。三角色均可访问，只读写当前登录者可见通知；医生通知还检查当前报告授权，商家不会得到医疗通知。未登录 401、CSRF 缺失 403、他人／已撤权通知 404。普通客户端不能创建通知或重试 Outbox。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| GET `/api/notifications` | `size=20`（1–100）、可选排他 `beforeId>0`、`unreadOnly=false` | `{items,hasMore}`；ID 倒序；每项 `id,type,resourceId,title,description,href,createdAt,readAt` |
| GET `/api/notifications/unread-count` | 无 | `{unreadCount}`；当前账号所有可访问未读通知，不限当前页 |
| POST `/api/notifications/{id}/read` | 无请求体；需要 CSRF | 204；重复确认安全，不改变聊天已读游标 |

四类事件：`CONSULTATION_SUBMITTED`、`DOCTOR_REPLIED`、`ORDER_ACCEPTED`、`ORDER_EXPIRED`。href 为服务端固定业务路径；通知不包含报告或消息正文。通知列表只是提示，目标业务接口再次鉴权。实现与重试说明见[通知中心验收](notifications-acceptance.md)。

## 原有业务接口

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
| GET `/reports/{id}/assistant/evidence` | 仅报告所有者 | 无 | `200 {reportId,status,indicators,current,previous,change,notice}`；当前仅支持血压，医生授权不包含此接口 |
| POST `/reports/{id}/assistant` | 仅报告所有者 | `{"action":"PREPARE_CONSULTATION"}`；可选 `focus` 和 `useModel`，默认模板 | `200 {reportId,mode,modelStatus,questions,draft}`；模式为 `TEMPLATE` 或 `MODEL`；不支持的报告返回 409；不保存、不授权、不发送 |
| GET `/doctor/reports` | 医生 | 无 | `200` 当前仍获授权的报告 |
| GET `/reports/{id}/grants` | 报告所有者 | 无 | `200` 活跃授权医生名单 |
| POST `/reports/{id}/grants` | 报告所有者 | `{doctorEmail}` | `200 {doctorId,doctorEmail}`；重授权恢复 |
| DELETE `/reports/{id}/grants/{doctorId}` | 报告所有者 | 无 | `204` 软撤销 |
| GET `/doctors` | 用户 | 无 | `200` 三科演示医生及近期页面活跃状态 |
| GET `/pharmacies/nearby` | 用户 | `?lat=30.5928&lon=114.3055`，WGS84 经纬度 | `200 {source:"OPENSTREETMAP",radiusMeters:5000,pharmacies:[...]}`；最多 30 家、直线距离升序；地图服务异常 502，超限 429 |
| GET `/pharmacies/region` | 用户 | `?lat=30.5928&lon=114.3055`，WGS84 经纬度 | `200 {label,source:"OPENSTREETMAP"}`；大致地区名，逆地理编码不可用时 502；每用户每分钟最多 4 次 |
| POST `/doctor/presence` | 医生 | 无 | `204` 更新活跃时间 |
| GET `/consultations` | 用户 | 无 | `200` 本人最近 100 条咨询 |
| POST `/consultations` | 用户 | `{reportId,doctorId,question?}`；医生须已获该报告授权 | `201` 咨询；空问题自动填问候语并创建首条消息；每用户每分钟最多 5 次 |
| GET `/doctor/consultations` | 医生 | 无 | `200` 定向给本人且仍有授权的咨询；首页筛选 `OPEN` 作为待咨询 |
| POST `/doctor/consultations/{id}/claim` | 目标医生 | 无 | `200` 接受咨询；竞争失败 409，成功后医生消息页可见会话 |
| POST `/doctor/consultations/{id}/reply` | 已接单医生 | `{answer}`，10–2000 字 | `200` 更新旧版答复并写消息；旧接口保留兼容 |
| GET `/messages/conversations` | 用户/医生 | 无 | `200` 会话摘要；医生只看已接受的会话，用户提交后即可看自己的会话 |
| GET `/messages/conversations/page` | 用户/医生 | `size` 默认 20，可选 `beforeId` | `200 {items,hasMore}`；按会话 ID 倒序；医生只看已接受且仍获授权的会话 |
| GET `/messages/conversations/{id}` | 会话用户/已接受医生 | `size` 默认 50，可选 `beforeId` 或 `afterId` | `200 {conversation,messages,hasMore}`；消息升序，未传游标取最新页；医生未接受时 404 |
| POST `/messages/conversations/{id}` | 会话用户/已接单医生 | `{body,clientMessageId?}`，正文 1–2000 字 | `201` 新消息；重试使用相同客户端 ID；撤销授权后禁止发送；用户/医生分别每分钟最多 30/60 条 |
| POST `/messages/conversations/{id}/read` | 会话用户/已接受医生 | `{lastReadMessageId}`，必填且为本会话的消息 ID | `204` 单调推进已读游标；缺失、非正数、其他会话的 ID 返回 400 |

指标录入示例：

```json
{"category":"BP","measuredAt":"2026-11-05T10:00:00","context":"HOME","ageYears":22,"pregnant":false,"values":{"systolic_bp":{"value":130,"unit":"mmHg"},"diastolic_bp":{"value":80,"unit":"mmHg"}}}
```

主流程错误语义：未授权即咨询返回 409；指定医生不是当前获授权者返回 409；医生未接受时访问消息会话返回 404；患者撤销后医生访问返回 404，患者仍可读历史但发消息返回 409。CSRF 缺失返回 403。不要将这些研发预览接口用于真实患者资料或诊疗。

实现出处：`server/src/main/java/com/jwzz/server` 下的 Controller、`SecurityConfig`、V1–V11 迁移。医生咨询手工验收见[消息页验收](messages-acceptance.md)，商家订单消息见[商城第五阶段验收](shop-stage5-acceptance.md)。

## 商城与订单消息补充（V7–V11）

以下路径仍以 `/api` 开头；商家消息和医生消息是不同接口、不同表，不能互相访问。

| 方法与路径 | 角色 | 请求要点 | 成功结果 |
|---|---|---|---|
| GET `/shop/products` | 用户 | `query,category,sort,page,size` | 有货、上架且营业中的演示商品分页 |
| GET `/shop/cart`；POST `/shop/cart/items` | 用户 | 添加 `{skuId,quantity}`；仅单店 | 自己的购物车；库存不足/跨店 409 |
| PUT/DELETE `/shop/cart/items/{id}` | 用户 | PUT `{quantity}` | 调整或移除自己的购物车项目 |
| POST `/shop/orders` | 用户 | `{idempotencyKey}`，8–64 位字母数字或连字符 | 201 订单与快照；重复键返回原订单 |
| GET `/shop/orders`；GET `/shop/orders/{id}` | 用户 | 无 | 本人订单列表/明细；他人 404 |
| POST `/shop/orders/{id}/pay`；POST `/shop/orders/{id}/cancel` | 用户 | 无 | 模拟支付或取消；仅待支付能取消 |
| GET `/merchant/orders`；GET `/merchant/orders/{id}` | 商家 | 无 | 本店订单列表/明细；他店 404 |
| POST `/merchant/orders/{id}/accept` | 商家 | 无 | 已模拟支付订单接单、预留转已售 |
| POST `/shop/orders/{id}/conversation` | 订单用户 | `{body?}`，空值填默认订单问候 | 201 `{conversation,messages,hasMore}`；重复调用返回同一会话，消息取最新 50 条 |
| GET `/shop/conversations`；GET `/merchant/conversations` | 对应用户/商家 | 无 | 旧兼容列表，最近 100 个会话；新聊天页不用此接口 |
| GET `/shop/conversations/page`；GET `/merchant/conversations/page` | 对应用户/商家 | `size` 默认 20，可选 `beforeId` | `{items,hasMore}`，按会话 ID 倒序 |
| GET `/shop/conversations/{id}`；GET `/merchant/conversations/{id}` | 对应用户/商家 | `size` 默认 50，可选 `beforeId` 或 `afterId` | `{conversation,messages,hasMore}`，与咨询消息分页语义一致 |
| POST `/shop/conversations/{id}/messages`；POST `/shop/conversations/{id}/read` | 用户 | 发消息 `{body,clientMessageId?}`，1–2000 字；已读 `{lastReadMessageId}` | 201 消息；204 已读 |
| POST `/merchant/conversations/{id}/messages`；POST `/merchant/conversations/{id}/read` | 商家 | 同上 | 201 消息；204 已读 |

订单关联商家消息的权限按当前账号与 `shop_conversation.user_id` 或店铺 `merchant_id` 判定；不允许传入自称的用户/商家 ID。不存在或非本人资源统一 404。商家账号访问医生 `/messages/**`、医生账号访问 `/shop/**` 和 `/merchant/**` 均为 403。消息不是正式诊疗或药学咨询通道。

## 消息游标契约（2026-11-17）

- 所有新分页接口 `size` 为 1–100；会话列表 `beforeId`、消息历史 `beforeId` 必须大于 0，消息增量 `afterId` 可为 0，不得同时传 before/after。无效参数返回 400。
- 消息首次不传游标：取最新一页，但响应按 ID 升序；加载更早消息传当前最小消息 ID 为 `beforeId`；新消息传当前最大已收到 ID 为 `afterId`。游标均为排他边界，不要求 ID 连续。
- `hasMore` 是本次查询方向是否还有结果。初始／历史表示还有更早消息；增量表示还有更新消息。空消息列表 `hasMore=false`，不表示会话不存在。
- 已读是“读到某个消息位置”的高水位，不是逐条阅读证明。客户端仅上报可见消息行的最大 ID；服务端验证归属、鉴权并取 `GREATEST(旧游标,上报值)`。读取后新到达但尚未显示的消息不应一起清零；迟到的旧游标不回退。
- 旧无参数数组列表仍保留；详情改为最新 50 条、已读改为必填请求体，因此须配套更新前后端，不支持旧客户端继续无请求体清未读。
- 医疗与商家消息独立鉴权；分页不扩大访问范围。测试与运行方式见[消息分页验收](message-pagination-acceptance.md)。
