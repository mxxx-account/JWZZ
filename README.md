# 见微知著（JWZZ）

见微知著是一个面向本地演示的健康记录、报告咨询与健康用品商城平台。用户可以录入体检指标、查看历史趋势、生成报告并授权给医生；也可以在演示店铺搜索商品、下单和联系商家。项目包含用户、医生、商家三端，使用同一套 Web 前端和业务后端。

> **项目边界**：指标解读是待临床审核的规则预览，不是诊断或用药建议。医生账号用于演示，未做资质核验。商城不展示定位或真实附近药店，支付、履约及退款均为模拟，不涉及真实资金、处方、发货或退款。请使用虚构账号和数据。

## 当前功能

| 角色 | 可以做什么 |
| --- | --- |
| 用户 | 录入血压、血糖、血脂，查看趋势和报告档案；按报告授权／撤权、提交咨询、查看医生回复；搜索演示商品和店铺，管理单店购物车、模拟下单／支付并联系商家。 |
| 医生 | 查看获授权的报告和待接受咨询，接受后回复；用户撤权后不能继续访问对应报告和会话。 |
| 商家 | 创建演示店铺，管理商品、上架和库存，接受已模拟支付的订单，处理订单消息；不能访问医疗报告或医生咨询。 |

- **报告与咨询**：报告保留生成时的数据与规则版本。同一次录入重复生成报告会返回同一份；授权以单份报告为单位。咨询消息和订单消息是独立会话，支持未读状态及重试去重。
- **报告解读与咨询准备**：血压报告可对比更早的同条件记录，生成可编辑草稿。默认走 Java 模板；本地配置并主动勾选后，可通过 Python 接入外部模型来选择咨询主题。授权和提交仍由用户操作。见 [Python 模型接入与验收](docs/agent-stage3-acceptance.md)。
- **订单与库存**：购物车不预留库存；下单时服务端在事务内核对价格与可售库存。待支付订单取消或超时后释放预留；商家接单后页面自动重新读取库存，不用手动刷新整页。
- **模拟履约与退款**：商家发货、用户收货完成、整单退款申请与审核、模拟退货验收、唯一退款流水。未接单释放预留，未发货恢复库存，退货后仅明确验收可再售才入库，报损不回补。见[本阶段验收](docs/fulfillment-acceptance.md)。
- **消息分页**：咨询消息和商家消息均支持会话分页、最新 50 条消息、向上加载历史、断网后按消息 ID 增量补齐；已读游标只推进到当前可见消息位置。会话按创建 ID 倒序，搜索／未读筛选暂限已加载会话。见[本阶段验收与复现](docs/message-pagination-acceptance.md)。
- **通知中心**：导航栏显示全局通知未读数；新咨询、医生回复、商家接单和待支付订单超时关闭产生站内通知，支持分页、未读筛选、标记已读与详情跳转。事务 Outbox 保证业务与事件一起提交；后台有界重试并通过唯一约束去重。通知已读不等于聊天已读；咨询结束和用户确认的记录提醒也会产生通知。见[通知中心验收](docs/notifications-acceptance.md)。

- **咨询与随访**：医生结束咨询并保存不可变小结、待办建议；结束后的聊天只读。用户可确认医生提出的提醒，或自己设置、取消提醒，到期进入通知中心；完成待办可关联自己的新报告，关联不自动授权医生。见[随访验收与测试记录](docs/followups-acceptance.md)。

下一轮按[已确定的七阶段路线](docs/next-roadmap.md)推进：消息分页 → 通知中心 → 咨询结束与随访 → 模拟履约与退款 → 带来源的知识解释 → 可恢复咨询准备 → 受控只读 Agent。每阶段验收后再进入下一阶段。

## 技术与目录

- 前端：Next.js、React、TypeScript；浏览器回归使用 Playwright。
- 后端：Java 17、Spring Boot、Spring Security；使用会话 Cookie 与 CSRF 校验。
- 数据：MySQL 8、Flyway V1–V15；Redis 可选，用于缓存和限流，关闭或不可用时支持本机降级，不能视为跨实例一致限流。

| 路径 | 内容 |
| --- | --- |
| `web/` | 三角色 Web 界面、浏览器测试和生产包冒烟测试 |
| `server/` | 业务 API、数据库迁移、后端与 MySQL 集成测试 |
| `ai_service/` | 可选的本机 Python 模型网关及离线测试，不是 Web 默认启动依赖 |
| `scripts/`、`docs/` | 启动及验收脚本、架构、接口和测试报告 |
| `src/`、`backend/`、`desktop/`、`models/` | 保留的 DKD 模型和 Electron 原型，不是当前 Web 服务的依赖 |

## 本地启动（Windows PowerShell）

**当前电脑推荐：** 已有数据库配置、后端 JAR 和前端／Python 环境时，用 PowerShell **7.4+** 执行下列命令。首次由你在隐藏输入中填写 API Key，脚本用 Windows DPAPI 加密保存到项目目录外；以后无需重复输入 Key 或共享令牌。脚本和非敏感设置可提交 GitHub，真实凭据不提交。详见[一步一步配置与启动](docs/local-startup.md)。

```powershell
# 在项目根目录，首次执行一次（不会调用模型）
.\scripts\setup_local_ai.ps1
# 停止之前的前端、Java、Python 实例后；MySQL/Redis 保持原运行方式
.\scripts\start_local.ps1 -WithAi -CheckOnly
# 每次启动只需这一条；保持终端打开，Ctrl+C 停止本次服务
.\scripts\start_local.ps1 -WithAi
```

不需要外部模型时运行 `./scripts/start_local.ps1`，只启动前后端。启动器使用已有 JAR，不自动构建／下载依赖。首次在新电脑搭建环境，或希望分别启动服务时，继续按下面步骤操作。

准备 Node.js ≥ 20.9、JDK 17、Maven 3.9+ 和 MySQL 8。先创建 `jwzz` 数据库与仅有该库权限的账号。Redis 不必安装才能体验；若暂未启动，在本地配置中将 `JWZZ_REDIS_ENABLED` 设为 `false`。

后端终端（从项目根目录开始）：

```powershell
cd server
if (-not (Test-Path .\.env.local.ps1)) { Copy-Item .\env.example.ps1 .\.env.local.ps1 }
# 编辑 .env.local.ps1，填写本机数据库凭据和演示医生密码，再执行：
. .\.env.local.ps1
mvn spring-boot:run
```

后端启动时由 Flyway 执行数据库迁移。配置示例启用 `dev`，用于本地演示医生／商家注册和规则预览；本地配置文件不应提交到 Git。

前端终端（从项目根目录开始）：

```powershell
cd web
npm ci
npm run dev
```

访问 [Web 首页](http://localhost:3000)，后端健康接口为 [`/api/health`](http://localhost:8080/api/health)。已有依赖时可直接运行 `npm run dev`。更多环境设置见[本地开发说明](docs/development.md)。如选择容器路线，请先读 [Docker Compose 验收说明](docs/compose-validation.md)；不要在本机 MySQL 或 Redis 已占用相同端口时重复启动容器依赖。

## 演示路线

1. **面试主线：报告与咨询**。录入两次同条件的虚构血压 → 生成报告并查看历史对比 → 生成并编辑咨询草稿（默认本地模板，可选模型辅助）→ 授权、填入、主动提交 → 医生接受并回复 → 患者撤权。[6–8 分钟演示脚本](docs/interview-demo.md)含无网备选路线。
2. **备选：订单库存与商家消息**。商家备货并开启演示营业 → 用户搜索有货商品、下单并模拟支付 → 商家接单 → 校验库存同步和订单会话。事务、幂等与防超卖见[订单验收](docs/shop-stage4-acceptance.md)，角色消息隔离见[订单消息验收](docs/shop-stage5-acceptance.md)。

不勾选时不会调用外部模型；模型不可用则仍可用本地草稿继续咨询。AI 不会自动授权或发消息。

## 测试与验收

- [第五阶段：带来源的血压知识解释与动手练习](docs/knowledge-assistant-acceptance.md)：在自己的血压报告下查询已核对的短资料；含出处、版本和拒答。Python 离线实验演示完整问法与字符向量检索的差异。

[2026-11-19 模拟履约与退款回归](docs/fulfillment-acceptance.md)：后端 62 项、浏览器 21 项及类型检查全部通过。包含并发退款幂等、资金流水故障回滚、退货入库与报损分支，以及原有订单库存同步和消息权限回归。

[2026-11-18 咨询与随访回归](docs/followups-acceptance.md)：后端 55 项、浏览器 17 项及类型检查通过。包含结束幂等、提醒确认/取消/真实到期、独立报告授权，以及测试发现并修复的 MySQL 旧快照并发状态回退问题。

[2026-11-18 通知中心回归](docs/notifications-acceptance.md)：后端 49 项、浏览器 15 项及类型检查通过。包含真实业务事件投递、故障注入、有界重试、并发去重、已读隔离和撤权检查。

[2026-11-17 消息分页验收记录](docs/message-pagination-acceptance.md)：后端 45 项（含真实 MySQL）通过，相关浏览器回归 12 项通过，消息 HTTP 验收通过。新旧前后端必须配套升级；本机验收可使用独立端口 3004/8084，详见记录。

[面试版关键回归](docs/testing/2026-11-16-demo-regression.md)区分本地假模型全链路、现有服务上的页面回归和需手动验收的启动／真实供应商调用。现场验收请使用虚构数据。

前后端运行后，从项目根目录执行 `./scripts/run_quality_checks.ps1`。该脚本使用本地配置运行后端测试、接口脚本、类型检查和浏览器回归；浏览器用例需要本机 Microsoft Edge，部分医生流程需要演示账号。请仅连接本地开发或测试库运行。

[2026-11-08 最终回归](docs/testing/2026-11-08-final-regression.md)记录：后端 **27 项**、开发模式浏览器 **21 项**、生产前端包 **4 项**以及 **5 套接口脚本**全部通过。消息重试去重和接单后库存同步均已通过回归。完整 Docker Compose 空库启动仍因镜像下载超时未验收；HTTP 探针响应差异仍待复核。上述结果不等同于正式上线验收。

更多资料：[架构设计](docs/architecture.md) · [数据库设计](docs/database-design.md) · [接口文档](docs/api-reference.md) · [指标字典](docs/indicator-dictionary.md) · [测试与压测汇总](docs/test-report.md) · [技术取舍](docs/technical-tradeoffs.md)

## 旧 DKD 研究原型

基于整理后 NHANES 数据的横断面风险筛查原型，**未接入当前 Web 用户评估**，不是纵向发病预测或临床诊断工具。`UACR`、`eGFR`、`serum_creatinine` 与 DKD 标签直接相关，不作为模型输入，以避免标签泄露。

复现实验需要自行准备 `nhanes_dkd_dataset.csv`（未纳入 Git），并按 `requirements.txt` 安装 Python 依赖。将数据放在项目根目录，在根目录依次运行：

```powershell
python src/audit_data.py
python src/train.py
python src/explain_model.py
python src/generate_model_card.py
```

报告写入 `reports/`，模型产物写入 `models/`。启动当前 Web 项目不需要训练模型或准备这份数据。
