# 质量阶段测试报告

最新修复验证见 [消息幂等修复与扩展测试](testing/2026-11-08-message-idempotency-fix.md)：第二轮两条失败场景修复；后端 27 项、浏览器 21 项通过且无跳过。第二轮原始失败证据保留，基础设施故障与部署验收仍待测。

2026-11-08 第二轮专项见 [竞争、真实长聊天与网络异常报告](testing/2026-11-08-round2.md)：后端 27 项通过；浏览器 18 项中 16 通过、2 失败，确认两套消息在回执丢失后重试会重复持久化，待修复。此轮不能标记全量验收通过。

最新一轮独立记录见 [2026-11-08 第一轮综合测试报告](testing/2026-11-08-round1.md)：后端 23 项、浏览器 11 项均通过且无跳过，并保存接口脚本与短压测原始记录。该轮为基础回归，不表示下述历史部署阻塞或完整质量计划已经全部验收。

执行日期：2026-11-05 至 2026-11-06（Asia/Shanghai）。对象：当前 Next.js + Spring Boot + MySQL/Redis Web 平台；旧 DKD 模型与 Electron 原型不在本轮范围。使用随机 `.invalid` 演示用户和非真实体检值，不使用真实患者资料。

## 结果摘要

| 层次 | 命令/场景 | 结果 |
|---|---|---|
| Java 单元 | `cd server; mvn -o test` | 11 个规则边界、输入校验和本地限流并发断言通过；可选集成测试未设环境变量时跳过 |
| MySQL 事务 | 加载 `server/.env.local.ps1`，设 `JWZZ_IT_DB_URL=$env:DB_URL`，运行 `mvn -o -Dtest=MessageTransactionIntegrationTest test` | 1 个真实 MySQL 集成测试通过：无效发送者触发 FK 错误后咨询回滚，正常路径咨询与首条消息一起提交；测试只清理随机生成的测试记录 |
| HTTP 权限/流程 | `./scripts/verify_stage2.ps1`、`verify_stage3.ps1`、`verify_stage4.ps1`、`verify_stage5.ps1`、`verify_messages.ps1` | 五套均通过：匿名/跨用户/跨医生访问、CSRF、授权及撤销、报告幂等、接单、已读、聊天 |
| HTTP 并发 | 阶段 4、5 脚本 | 8 个并发报告生成请求返回同一报告 ID；8 个并发接单请求恰有 1 个成功、7 个 409；第 6 次咨询触发 429 |
| 前端关键流程 | `cd web; npm run typecheck`；加载演示医生密码后 `npm run test:e2e` | TypeScript 通过；本机 Edge 无头模式 1 条完整患者→医生→患者流程通过，包括空值校验、录入、报告、授权、默认消息、接单回复和撤销 |
| 完整容器环境 | `compose.full.yaml` | Compose 语义校验通过；WSL Docker Engine 29.1.3 / Compose 2.40.3 可运行官方 Redis 7 容器并从 Windows 访问映射端口。MySQL 镜像拉取时官方 Docker Hub 连接反复 EOF/TLS 握手失败，**四服务全新启动尚未通过** |

前端自动化发现并修复了一个交互缺陷：医生接单后的提示曾覆盖右下角“发送”按钮。已把提示移至顶部并在 5 秒后消失；修复后的端到端用例通过。

容器验收的具体记录：`docker compose ... config --quiet` 返回 0；官方 `redis:7-alpine` 镜像拉取成功，临时 `jwzz-probe` 容器内 `redis-cli ping` 返回 `PONG`，Windows 对其 `127.0.0.1:16379` 端口连接成功；临时容器随后已停止并自动移除。完整 `up --build` 在 `mysql:8.4` 拉取阶段失败，原因是 `registry-1.docker.io`/云端层下载的 EOF 与 TLS 握手失败，尚未进入后端/前端 Dockerfile 构建，因此不能把容器化应用写成已通过。已安装的 WSL Docker Engine、Compose、Buildx 保留；此前未完成的 Docker Desktop 临时安装包已删除。待代理连接恢复后按[Compose 验收说明](compose-validation.md)重跑并更新本报告。

11 月 6 日收尾重试时，Windows 本机代理 `127.0.0.1:7890` 已不监听；不经代理的 `docker pull mysql:8.4` 又因连接 Docker Hub 超时失败。重新执行 Compose `config --quiet` 仍通过。当前阻塞是镜像下载，**不是四服务启动成功的证据**。

收尾时已停止临时 WSL 代理转发和使用代理参数手动启动的 `dockerd`，恢复默认 Docker 服务；`docker ps` 无遗留测试容器。本机既有 MySQL/Redis 数据未被删除或覆盖。

## 有记录的接口压测

脚本：`node scripts/load_test.mjs`。本机 Windows Node 24.19.0 → `http://127.0.0.1:8080` Spring Boot → 本机 MySQL 8；各路由预热 15 次，随后**并发 20、每路由 400 次 GET**。每组创建一个独立随机测试用户，并为其准备 1 或 60 份版本化报告。脚本只对 GET 接口施压；创建报告为串行准备步骤。记录了响应字节数、吞吐、p50/p95/p99、最大耗时和错误数。去除测试用户身份信息后的原始指标保存在仓库的 [1 份报告结果](performance-r1.json) 和 [60 份报告结果](performance-r60.json)；脚本生成的完整本机记录仍在忽略目录 `reports/`。

| 路由 | 1 份报告：吞吐 / p95 | 60 份报告：吞吐 / p95 | 60 份时每响应约 | 错误 |
|---|---:|---:|---:|---:|
| `/api/health` | 3008 次/秒 / 12.0 ms | 2449 次/秒 / 13.6 ms | 39 B | 0 |
| `/api/public/indicators` | 738 次/秒 / 39.4 ms | 739 次/秒 / 38.6 ms | 1.2 KB | 0 |
| `/api/indicators` | 3375 次/秒 / 13.8 ms | 1707 次/秒 / 22.6 ms | 26.8 KB | 0 |
| `/api/reports` | 3405 次/秒 / 14.8 ms | 380 次/秒 / 79.1 ms | 81.1 KB | 0 |

**实际观察到的瓶颈：报告列表。** 60 份相对 1 份报告时，该路由吞吐约降至 1/9，p95 升至约 5.3 倍。源码中 `ReportStore.ownedBy` 无分页，`ReportController` 又逐份解析完整 `report_json`；与响应由约 1.35 KB 增至约 81 KB 一致。严格说这只是**端到端瓶颈定位及代码层推断**，尚未将网络传输、JSON 序列化和 MySQL 查询各自耗时剖析。不能据此宣称系统最大承载量或生产环境 SLA。优先改进建议：分页/游标、列表摘要与详情分离，再用相同脚本复测；不要先盲目加线程池。

## 复现与限制

```powershell
cd server
mvn -o test
. .\.env.local.ps1
$env:JWZZ_IT_DB_URL=$env:DB_URL
mvn -o -Dtest=MessageTransactionIntegrationTest test
cd ..
./scripts/verify_stage2.ps1
./scripts/verify_stage3.ps1
./scripts/verify_stage4.ps1
./scripts/verify_stage5.ps1
./scripts/verify_messages.ps1
$env:LOAD_REPORTS='60'; $env:LOAD_REQUESTS='400'; $env:LOAD_CONCURRENCY='20'
node scripts/load_test.mjs
cd web
npm run typecheck
npm run test:e2e
```

压测脚本只允许 `localhost`/`127.0.0.1`，报告数、请求数、并发都设硬上限，避免误打生产。所有接口压测数字只代表这台电脑、本轮数据量和单次运行，未测试多用户混合写入、真实网络、长时间稳定性或多实例。浏览器测试依赖本机 Microsoft Edge；不下载 Playwright 自带浏览器。规则仍待临床审核，不可用测试通过代替医学验证。

## 2026-11-07 商城第五阶段增量验证

本节不修改上方 11 月 5–6 日的历史结果。新增 Flyway V11 订单会话表；真实 MySQL 集成测试验证跨用户／跨商家 404、订单会话并发唯一、首消息失败整体回滚、8 路并发发送与未读游标。浏览器自动化覆盖用户发起、商家回复、医生接口与商家接口隔离；详情和全部测试步骤见[第五阶段验收](shop-stage5-acceptance.md)。本机消息接口有界压测的原始数字在[JSON 记录](shop-message-performance.json)，可用 `node scripts/shop_message_load.mjs` 复现。此记录不替代对真实医疗或电商业务的安全审核。
