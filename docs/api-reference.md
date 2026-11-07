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
| GET `/pharmacies/nearby` | 用户 | `?lat=30.5928&lon=114.3055`，WGS84 经纬度 | `200 {source:"OPENSTREETMAP",radiusMeters:5000,pharmacies:[...]}`；最多 30 家、直线距离升序；地图服务异常 502，超限 429 |
| GET `/pharmacies/region` | 用户 | `?lat=30.5928&lon=114.3055`，WGS84 经纬度 | `200 {label,source:"OPENSTREETMAP"}`；大致地区名，逆地理编码不可用时 502；每用户每分钟最多 4 次 |
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
| POST `/shop/orders/{id}/conversation` | 订单用户 | `{body?}`，空值填默认订单问候 | 201 `{conversation,messages}`；重复调用返回同一会话 |
| GET `/shop/conversations`；GET `/shop/conversations/{id}` | 用户 | 无 | 本人订单会话列表/最近 200 条消息 |
| POST `/shop/conversations/{id}/messages`；POST `/shop/conversations/{id}/read` | 用户 | 发消息 `{body}`，1–2000 字；或无请求体标记已读 | 201 消息；204 已读 |
| GET `/merchant/conversations`；GET `/merchant/conversations/{id}` | 商家 | 无 | 本店订单会话列表/详情 |
| POST `/merchant/conversations/{id}/messages`；POST `/merchant/conversations/{id}/read` | 商家 | 同上 | 201 消息；204 已读 |

订单关联商家消息的权限按当前账号与 `shop_conversation.user_id` 或店铺 `merchant_id` 判定；不允许传入自称的用户/商家 ID。不存在或非本人资源统一 404。商家账号访问医生 `/messages/**`、医生账号访问 `/shop/**` 和 `/merchant/**` 均为 403。消息不是正式诊疗或药学咨询通道。
