# 第二阶段：通知中心与可靠异步任务

实施：2026-11-17～2026-11-18。范围按[下一轮路线](next-roadmap.md)执行；第三阶段随访与记录提醒尚未实现。本页同时记录设计、验证方式和人工验收步骤。

状态：开发及本阶段自动化回归完成，待用户验收。本机默认启动器使用的 `server/target` JAR 已重新构建，后续无需再用旧阶段 JAR。

## 1. 本阶段交付

| 触发操作 | 接收方 | 详情入口 |
| --- | --- | --- |
| 用户提交新咨询 | 定向医生 | 医生首页待咨询列表；仍需医生接受 |
| 医生在消息页或旧回复接口回复 | 咨询所属用户 | 对应咨询会话 |
| 商家接受已模拟支付的订单 | 订单所属用户 | 对应订单详情 |
| 待支付订单超时关闭 | 订单所属用户 | 对应订单详情 |

三个角色导航栏均有“通知”，但本阶段没有需要发给商家的事件，商家通知列表为空属于正常情况。不会把医疗报告、聊天正文、指标数值、用户姓名复制进通知正文或事件表。历史业务不批量补发通知，只有升级后触发的新事件会入队。

通知中心提供全部／未读筛选、每页 20 条、继续加载、手动刷新、约 8 秒后台刷新和独立已读。导航角标是当前账号**全部可访问通知**的未读数，不局限于已加载页。点击“标为已读”不会清聊天未读；“查看详情”先确认通知已读，再进入业务页面，目标接口仍然鉴权。报告撤权后，医生相关通知列表、未读统计和标记接口均不再可访问。

## 2. 可靠性设计与边界

1. 业务事务中写 `notification_outbox`。事件写入失败，咨询／消息／接单／关单一起回滚；未提交的事件不能被 worker 看到。
2. 事件只含稳定业务键、类型、接收者和资源 ID。稳定键例：`consultation:<id>:submitted`、`consultation-message:<id>:reply`、`order:<id>:accepted`、`order:<id>:expired`。唯一约束防止同事件重复入队；相同键不同内容拒绝提交。
3. 后台默认每 2 秒扫描，每批最多 50 次。MySQL `FOR UPDATE SKIP LOCKED` 排他选取事件，多个 worker 可以处理不同事件；不需要 Redis 分布式锁或额外消息队列。
4. 通知写入与事件 `DELIVERED` 在同一数据库事务里。`user_notification.event_id` 唯一；重投递也只有一条通知。进程在提交前退出则整体回滚，提交后退出则结果已经持久化。
5. 可记录的投递失败先回滚到保存点，再记录失败状态；重试间隔依次 5、10、20、40 秒，第 5 次失败转 `FAILED`，停止自动重试。错误记录只保存异常类名，不保存敏感异常正文。
6. 数据库整体不可用／连接断开可能导致连失败记录也无法提交；此时日志记录故障，下轮继续尝试，不能声称所有故障都最多重试 5 次。任务恢复依赖数据库最终恢复和 worker 再次启动。
7. 默认保持单体定时任务，不引入网络投递。保证的是数据库内通知效果幂等，不宣称邮件／短信端到端 exactly-once 或绝不丢失。没有站外推送、浏览器系统通知或即时送达 SLA。

订单超时检查仍是现有约 30 秒扫描；到期后可能再等待通知 worker 和页面刷新。用户主动取消未超时订单不生成“超时关闭”通知。重复接单、重复超时释放和相同客户端消息 ID 重试不会生成第二条同事件通知。

## 3. 新表与接口

迁移 `V13__notification_outbox.sql` 只新增表，不改旧迁移，不删除旧数据。

| 表 | 关键字段／约束 |
| --- | --- |
| `notification_outbox` | `event_key UNIQUE`、`event_type`、`recipient_id`、`resource_id`、`status`、`attempts`、`available_at`、`last_error`、创建／完成时间；状态与事件类型 CHECK；扫描索引 `(status,available_at,id)` |
| `user_notification` | `event_id UNIQUE`、接收者、事件类型、资源 ID、创建时间、`read_at`；列表与未读索引；事件和接收者外键 |

资源 ID 是多态业务引用，不是跨多表外键；查询时按事件类型重新校验资源归属及医生授权。客户端不能指定接收者 ID，也不能创建通知或重试内部任务。

| 接口 | 请求／响应 |
| --- | --- |
| GET `/api/notifications` | `size` 默认 20，范围 1–100；可选排他 `beforeId>0`、`unreadOnly=true/false`；返回 `{items,hasMore}`，按通知 ID 倒序 |
| GET `/api/notifications/unread-count` | `{unreadCount}`，只统计本人当前有权限看到的未读通知 |
| POST `/api/notifications/{id}/read` | 无请求体，成功 204，重复调用安全；需登录与 CSRF，他人或撤权通知 404 |

每条通知包含 `id,type,resourceId,title,description,href,createdAt,readAt`。href 由服务端固定模板构造，不接收任意外部 URL。没有“全部已读”操作，避免顺手清掉尚未查看的内容。

## 4. 测试记录

真实环境：Windows、Java 17、MySQL 8、Next 开发服务、现有 Microsoft Edge；使用缓存 Maven 依赖，未下载新依赖，未调用外部 AI。测试实例端口 3005/8085，和既有实例进程／构建目录分开，但**共享本机开发数据库**。

- 后端：**49 项通过，0 失败、0 错误、0 跳过**。新增 `NotificationIntegrationTest` 四项综合用例验证业务与事件一起回滚、两种医生回复路径、发送幂等、跨角色隔离、撤权隐藏、部分投递回滚、5 次失败终止、人工重投与 worker 重新创建后恢复、6 worker 并发投递 42 个事件不重复、41 条用户通知分页、订单库存与事件回滚、重复接单／超时释放只通知一次。
- 前端：**最终 15 项通过，0 失败、0 跳过**（约 1.1 分钟）。新增 3 项验证真实咨询／回复通知、接单通知和订单深链接，以及 41 条通知的分页、未读筛选、断线恢复与窄屏布局；原有 12 项覆盖聊天分页、用户／医生流程、报告草稿和商家消息隔离。已查看通知中心截图，导航、正文和操作按钮完整显示。
- TypeScript 静态检查通过。通知页面截图另有本机记录。

新增后端用例清理自己创建的账号、通知和业务样本；浏览器端真实流程会保留 `example.invalid` 虚构账号和演示记录，末尾撤销测试报告授权／暂停测试店铺。不要对真实生产数据执行。

故障记录：首次新增测试有 Java 断言重载歧义，已改为先赋值再比较；测试 SQL 别名 `delayed` 与 MySQL 语法冲突，改为 `is_delayed`；PowerShell 将未加引号的 Maven `-Dapp.notifications.dispatch-enabled=false` 拆开，复现命令已加引号。浏览器初轮为 14 通过、1 失败，原因是全局 `role=alert` 同时选中了 Next 路由播报节点，已把断言限定在通知中心区域。没有通过取消断言来绕过检查。

原始结果（Git 忽略）：`.local-run/notifications-server/surefire-reports/`、`.local-run/notifications-e2e.json`、`.local-run/notifications-preview-*/`。UI 截图位于 `web/test-results/notifications-通知真实链路：咨询提交、回复、已读独立、越权与撤权/notification-center.png`。

测试边界：恢复用例为重新创建 worker 并重读持久化队列，不是强杀 JVM／MySQL 的完整灾难演练；超时关单路径由真实 MySQL 集成测试触发，不在浏览器里等待 15 分钟。分页 UI 使用 41 条可控响应；新咨询、回复、接单的浏览器流程使用真实 API 与定时投递。未做新版 Compose 全新环境、通知吞吐压测和生产容量认证。

## 5. 手工验收

按原方式启动新版前后端后，进入导航“通知”。也可单独使用本阶段预览。即使终端是 Windows PowerShell 5.1，下列完整命令也会用本机已有 PowerShell 7 执行，无需再配置 API Key：

```powershell
& 'C:\Users\王\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -File 'D:\codex++\project\见微知著\scripts\start_notifications_preview.ps1'
```

预览打开 `http://localhost:3005`；使用原有虚构账号，AI 默认关闭。保持终端打开，Ctrl+C 关闭本次预览。不同时登录相同主机上的新旧服务，避免 Session Cookie 互相影响。

1. 用户向已授权医生提交新咨询；医生等数秒后看到“通知”角标，进入通知中心，点“查看详情”回到首页接受咨询。
2. 医生回复；用户通知中心出现回复通知。仅点“标为已读”，咨询消息未读仍保留；再查看详情进入对应聊天，聊天按自己的已读规则更新。
3. 用户模拟支付订单，商家接单；用户看到接单通知并直达正确订单，重复接单不新增通知。
4. 另建一笔不支付的演示订单，超过 15 分钟并等待扫描／刷新后，可看到超时关闭通知（不要在真实数据上手工修改截止时间）。
5. 撤销报告授权，医生刷新通知后相关通知消失；商家通知页不包含医疗咨询。
6. 通知较多时点加载更多；切换未读筛选；临时断网再恢复后可刷新，不清空已有通知。

通过后再进入第三阶段“咨询结束与随访记录”，届时接入用户设置／确认的记录提醒，不由 AI 自动决定复查时间。

## 6. 自动化复现（PowerShell 7.4+）

先停止通知投递实例，避免定时任务与故障注入测试竞争。只操作开发库。已有 V13 的本机可直接执行：

```powershell
Set-Location 'D:\codex++\project\见微知著'
. .\server\.env.local.ps1
$env:JWZZ_IT_DB_URL=$env:DB_URL
mvn -o -s "$env:USERPROFILE/.m2/settings.xml" '-Dmaven.repo.local=.maven-repository' "-Djwzz.build.directory=$PWD/.local-run/notifications-server" '-Dapp.notifications.dispatch-enabled=false' -f server/pom.xml package
node web/node_modules/typescript/bin/tsc --noEmit --project web/tsconfig.json
.\scripts\start_notifications_preview.ps1
```

新库先构建（同一 Maven 命令加 `-DskipTests`），运行预览让 Flyway 迁移，然后停止预览，再运行完整测试。不需要修改 `.env.local.ps1` 的账号密码。测试参数关闭的是测试上下文 worker，不会把最终 JAR 的默认 worker 关掉。

另一个终端运行浏览器回归：

```powershell
Set-Location 'D:\codex++\project\见微知著'
. .\server\.env.local.ps1
$env:TEST_WEB_URL='http://localhost:3005'
$env:TEST_API_URL='http://localhost:8085'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME=Join-Path $PWD '.local-run/notifications-e2e.json'
Set-Location web
node node_modules/@playwright/test/cli.js test tests/notifications.spec.ts tests/chat-pagination.spec.ts tests/patient-doctor-flow.spec.ts tests/report-assistant-stage2.spec.ts tests/shop-stage5.spec.ts --workers=1 --reporter=list,json
```

默认启动器仍使用 `server/target/server-0.1.0-SNAPSHOT.jar`；更新源码后需停止旧后端并重新构建默认 JAR（移除 `-Djwzz.build.directory` 参数），不能把新前端配旧 JAR。独立预览输出 `.next-notifications`，不提交构建产物、凭据或日志。

## 7. 失败任务排查与恢复

仅维护者在本地数据库工具中查询；当前没有管理员角色或公开重投 API：

```sql
SELECT id,event_type,status,attempts,available_at,last_error,created_at
FROM notification_outbox WHERE status IN ('PENDING','FAILED')
ORDER BY available_at,id LIMIT 100;
```

先修复原因，再核对具体 `id`、接收者和业务事件。确需重投时先导出该事件行作为操作记录，然后对**单个明确 ID**执行参数化更新：`UPDATE notification_outbox SET status='PENDING',attempts=0,available_at=CURRENT_TIMESTAMP(6) WHERE id=? AND status='FAILED'`。记录操作人、原因、时间及原 attempts；不可全表重置，应用尚无独立管理员重投审计表。重复投递不会重建已存在的通知，也不会重发原业务操作。

可用 `--app.notifications.dispatch-enabled=false` 临时暂停 worker，事件仍随业务写入；恢复后自动处理积压。`--app.notifications.poll-ms=2000` 是默认轮询间隔。不要把临时关闭参数用于验收通知出现。通知表目前没有自动清理／归档，长期运行需另设保留策略和监控，不能承诺容量无限。
