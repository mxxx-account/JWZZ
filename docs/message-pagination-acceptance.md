# 新主线阶段 1：消息分页与增量加载验收

日期：2026-11-17。状态：代码与自动化验证完成，等待用户验收。阶段 2 尚未开始。完整顺序见[七阶段路线](next-roadmap.md)。

## 1. 交付内容

适用于用户—医生咨询消息、用户—商家订单消息，两套权限保持隔离。

| 操作 | 现在的行为 |
| --- | --- |
| 打开消息页 | 会话先取 20 个；底部“加载更多会话”逐页展开，不再止于最近 100 个 |
| 打开会话 | 先取最新 50 条，显示在消息底部；旧咨询超过 500 条也能看到新消息 |
| 向上翻历史 | 到顶部自动取上一页，也可点“加载更早消息”；插入后保留阅读位置 |
| 有新消息 | 约 8 秒轮询，只请求本地最大已收到 ID 之后的消息，分批补齐并按 ID 去重 |
| 正在阅读历史 | 新消息不强制把人拖到底部；点“回到最新消息”返回底部 |
| 已读 | 仅上报可见消息行的最大 ID；看历史时未显示的新消息保留未读 |
| 切换会话 | 中止旧请求并检查世代编号，旧响应不覆盖新会话；保留原有发送重试 ID 机制 |
| 断网／恢复 | 保留已经加载的内容；轮询、online 或标签页重新可见时重试；同步成功清除连接提示 |

会话按创建 ID 倒序，不按最近活动自动置顶。搜索和“未读”筛选只针对已加载会话，页头明确写“已加载”。已读采用累计位置，不代表逐条阅读凭证。没有新增数据库迁移、依赖下载、外部模型调用或真实医疗数据处理。

## 2. 原因与实现记录

原咨询详情固定截取最早 500 条，商家详情固定保留最近 200 条，没有前后游标；因此长会话可能看不到新消息或无法找回旧消息。旧已读实现直接读取数据库最大消息 ID，在 GET 与 POST 之间新来的消息也可能被清零。

本次统一增加 `ChatPage`、方向性 `hasMore` 和排他 ID 游标。数据库仍逐请求检查角色、会话参与者与报告授权。已读请求必须提供 `lastReadMessageId`，归属错误返回 400；数据库 `GREATEST` 防止低游标迟到覆盖高游标。前端共享 `useChatPages`，但不共享两个业务域的数据和授权。

“增量每轮最多 10 页”是请求预算，不是丢弃上限；未补齐时下一轮从已收到的最大 ID 继续。发送成功后也走增量读取，不直接用发送返回 ID 跳过可能同时到达的对方消息。

## 3. 自动化验证结果

环境：Windows、Java 17、本机 MySQL、Next 开发模式、现有 Edge；临时前后端端口 3004/8084，AI 与 Redis 在此验收实例中关闭。**端口和构建目录隔离，数据库并未隔离**。

| 验证 | 结果与覆盖 |
| --- | --- |
| Maven 离线 package | 45 项测试，0 失败、0 错误、0 跳过；含真实 MySQL 集成与既有事务／并发回归 |
| 新增 `ChatPaginationIntegrationTest` | 两域各 620 条历史完整遍历；咨询新增 125 条增量分批读回；107 个咨询、106 个商家会话翻页；边界参数、迟到已读、撤权、越权 |
| 修订 199／200／201 条边界测试 | 最新页 50 条，全部 201 条可以分页读回，不再沿用固定 200 条旧契约 |
| 浏览器最终回归 | 12 项全部通过（约 1.2 分钟）：新分页 4 项、用户医生流程 4 项、报告草稿 3 项、商家隔离 1 项 |
| 新分页浏览器用例 | 每域模拟 620 条历史＋125 条离线新消息；会话 20→40；历史 50→100；补齐后 225 条无重复；看历史时不误清新增未读；切换丢弃迟到响应 |
| 真实 HTTP 脚本 | 最新／历史／增量／空页、分页路由、双游标 400、页大小超限 400、缺少／跨会话已读 400、GET 后新消息保留未读、旧游标不回退、撤权通过 |
| TypeScript | `tsc --noEmit` 通过 |

浏览器新分页的长历史使用可控响应，用于稳定复现竞态；真实 MySQL 测试验证查询语义，既有浏览器流程与 HTTP 脚本验证完整接口链路。不是“所有长历史浏览器样本均直接写入数据库”，也不是生产并发／压力测试结论。

### 测试期间发现的问题

1. 初跑后端有 1 条旧断言失败：仍要求详情 200 条。更新为最新 50 条并增加完整历史验证后，45 项全过。
2. 沙箱无法启动 Edge，初跑浏览器均在启动阶段失败，未执行业务断言；允许启动本机测试浏览器后正常执行。
3. 商家旧测试把 HTTP 地址写死为 8080，隔离服务 8084 下出现预期 404、实际 401。改用 `TEST_API_URL`，不改变业务鉴权以迁就测试；最终全过。
4. 在干净 PowerShell 中直接构造 WebRequestSession 时 Utility 模块未加载；接口脚本加显式导入后通过。
5. 同步成功后清除暂时断网提示，增加对应前端断言，最终 12 项重新通过。

原始本机记录（不提交 Git）：`.local-run/pagination-server/surefire-reports/`、`.local-run/pagination-e2e.json`、`.local-run/pagination-preview-*/`。前端 UI 与 HTTP 用例会创建 `example.invalid` 虚构账号和演示业务记录；不是整轮自动回滚。新增 MySQL 分页用例在回滚事务内运行，不保留其 620 条等批量样本。请勿对生产数据库执行。

## 4. 现在如何验收

此前占用 3000/8080 的旧服务没有被强行停止。**不能用新前端配旧后端验收**：旧后端不认识 `/page`，旧已读接口也没有新契约。先使用以下独立预览；同一浏览器不要同时登录新旧服务，Cookie 在相同主机上可能互相影响。

在 PowerShell **7.4+** 的项目根目录执行（本机 QA JAR 已构建）：

```powershell
Set-Location 'D:\codex++\project\见微知著'
.\scripts\start_pagination_preview.ps1
```

看到 Ready 后打开 `http://localhost:3004`，用原有虚构账号登录。此终端保持打开；Ctrl+C 停止本次预览。脚本不杀占用端口的服务；若提示端口占用，先确认是否已有本次预览，不重复启动。AI 不启动，不加载其加密凭据。

1. 用户分别进入“咨询消息”“商家消息”，确认顶部对象、提示、输入框和发送按钮完整。
2. 选择较长会话，向上滚动，确认历史增加且没有突然跳到底部；左侧滚动至底部可加载更多会话。
3. 两个独立浏览器登录双方。接收方停在历史位置，发送方发消息；等待同步后接收方仍保持原位置，点击“回到最新消息”后已读更新。
4. 快速切换两个会话，确认标题和正文不串；离线后恢复，确认记录补齐且无重复。
5. 用户撤销报告授权，医生侧对应会话仍会消失；商家端看不到医生咨询。

若旧账号数据不足 50 条或 20 个会话，不会显示无意义的“加载更多”。无需手工发送几百条，长历史边界由上述可复现测试覆盖。

验收通过后如回到普通 3000/8080 启动：在原启动终端 Ctrl+C 停止旧项目服务（不停止 MySQL），重新构建默认 JAR，再运行原启动器；无需重新填写 DeepSeek 凭据。

```powershell
. .\server\.env.local.ps1
# -o 只使用现有 Maven 缓存；新电脑缺依赖时需先按开发文档准备
mvn -o -s "$env:USERPROFILE/.m2/settings.xml" '-Dmaven.repo.local=.maven-repository' -f server/pom.xml package
.\scripts\start_local.ps1 -WithAi
```

## 5. 复现自动化

项目根目录、PowerShell 7.4+，先确认连接的是开发库：

```powershell
. .\server\.env.local.ps1
$env:JWZZ_IT_DB_URL = $env:DB_URL
$qaBuild = Join-Path $PWD '.local-run/pagination-server'
mvn -o -s "$env:USERPROFILE/.m2/settings.xml" '-Dmaven.repo.local=.maven-repository' "-Djwzz.build.directory=$qaBuild" -f server/pom.xml package
.\scripts\start_pagination_preview.ps1
```

另开一个同版本终端，在项目根目录：

```powershell
. .\server\.env.local.ps1
.\scripts\verify_messages.ps1 -BaseUrl http://localhost:8084
node web/node_modules/typescript/bin/tsc --noEmit --project web/tsconfig.json
$env:TEST_WEB_URL = 'http://localhost:3004'
$env:TEST_API_URL = 'http://localhost:8084'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $PWD '.local-run/pagination-e2e.json'
Set-Location web
node node_modules/@playwright/test/cli.js test tests/chat-pagination.spec.ts tests/patient-doctor-flow.spec.ts tests/report-assistant-stage2.spec.ts tests/shop-stage5.spec.ts --workers=1 --reporter=list,json
```

独立前端输出到 `.next-pagination`（Git 忽略）。Next 开发模式可能重写自动类型引用；正常启动会按默认 `.next` 重新生成。本次未增加生产构建、Compose、消息容量压测或真实模型调用验收；不得把历史测试结果视为本轮全量覆盖。

## 6. 后续边界

本阶段完成后先用户验收，再进入通知中心与事务 Outbox。当前仍是约 8 秒轮询，不是实时推送；列表摘要存在逐会话查询，已展开列表每次重新分页获取，历史 DOM 随主动加载增长。全库会话搜索、全局未读聚合、虚拟列表和百万消息容量验证不在本阶段交付范围内。
