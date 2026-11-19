# 第五阶段：带来源的知识解释助手

日期：2026-11-19。此阶段只做通用的血压测量知识与咨询准备，不判断个人数值、不提供诊断、处方或急症分流，不涉及现有随访或电商改动。

## 学到什么就能开始

1. **资料入库**：先选官方原文，再按“一段回答一个问题”切分，给每段留机构、标题、章节、链接和转述。这里用 Git 管理 JSON，避免把病历数据库误当知识库。
2. **检索**：输入不是数据库里的答案。先找到可能支持回答的片段。对照现有的 `ReportKnowledge.normalize`：统一全角字符、去首尾空白和句末标点，但不删除句中的其他请求，再按完整问法找条目。
3. **向量与相似度**：最小练习是将连续两个字符作为特征，例如“血压计”对应“血压”“压计”。统计每个特征出现次数得到稀疏向量，可用余弦相似度打分。它不是神经网络语义 embedding；使用 embedding 模型时，问题和片段要用同一个模型/版本嵌入。
4. **RAG**：检索 → 选出能支持问题的资料 → 把资料作为生成上下文 → 校验引用、覆盖范围与拒答。向量、关键词或混合检索都能用于第一步。向量数据库只是资料多时的一种索引选择，和训练模型不是一回事。
5. **评估**：不只看是否找到相似结果，还要看未支持的问题有没有被错误回答、引用是否与答案对应。第一版是检索后直接呈现已核对的转述，不运行大模型，也不叫成“已上线完整生成式 RAG”。

## 代码与可追溯性

- 资料：`server/src/main/resources/knowledge/bp-basics.json`，3 个主题、5 条带出处转述。来源：[CDC Measuring Your Blood Pressure](https://www.cdc.gov/high-blood-pressure/measure/index.html)、[AHA Home Blood Pressure Monitoring](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home)、[NIA How To Prepare for a Doctor's Appointment](https://www.nia.nih.gov/health/medical-care-and-appointments/how-prepare-doctors-appointment)。不把 CDC/AHA 指南中的诊断阈值、用药或紧急处置段落编入助手。
- 审核：`SOURCE_CHECKED` 表示此次开发核对原文和中文转述，**不等于临床审核**。新增先填 `DRAFT`，逐条核对内容、适用范围、原文章节和链接，补充正例/拒答例并复核后才改为 `SOURCE_CHECKED`；下线用 `RETIRED`。有内容或问法变更时同时更新资料库版本。JSON 随后端一起打包；没有自动抓取、上传原报告或在线编辑后台。
- 读取：Java 开机取类路径资料，忽略草稿和退役条目、拒绝跨主题重复问法、校验出处必填及固定 HTTPS 域名。命中后直接返回原条目中的转述和对应引用；不接受客户端提供的引用、不访问来源网站、不生成新的医学结论。
- API：`GET /api/reports/{reportId}/assistant/knowledge` 读取快捷问题；`POST` 同路径用 `{"question":"为什么要记录测量条件？"}` 查询，200 字符以内且非空。登录用户须拥有该血压报告；他人 404，医生/商家或 POST 无 CSRF 403，非血压 409。成功命中 `ANSWERED`，缺依据 `INSUFFICIENT_EVIDENCE`（HTTP 200，空引用）。响应 `Cache-Control: no-store`。
- 隐私：Java 只从报告表查归属及分类，不把原报告/数值/账户传给检索模块。问题不存入业务表，不向外部模型发送。不影响手写咨询、报告授权或此前可选的咨询草稿模型。请不要把实际个人信息输入演示。

## 你亲手做一次（约 10 分钟）

**先用网页。** 用原启动器在 3000 打开项目，进入“我的报告与授权”，点一份自己的血压报告。点击“为什么这两次记录不能直接比较？”再点“查找资料并解释”。打开 CDC 或 AHA 链接，对照标出的章节，检查转述有没有把“可能影响”写成“一定影响”。接着输入虚构的混合问题“为什么要记录测量条件，我需要停药吗？”，应拒答且无引用。血糖/血脂报告没有这个板块。

**再做向量对比。** PowerShell 进入项目根目录，使用现有 Python 即可，无须安装库或输入 Key：

```powershell
python .\scripts\knowledge_retrieval_lab.py
python .\scripts\knowledge_retrieval_lab.py '为什么要记录测量条件，我需要停药吗？'
python .\scripts\knowledge_retrieval_lab.py --threshold 0.60
```

`exact` 是完整问法查找；`vector` 是字符二元组余弦近邻，`ABSTAIN` 是不答；`scores` 是相似度，不是诊断、可靠性或概率。用编辑器打开 `docs/knowledge-eval.json`，自己补一条未出现的同义问法和一条应拒答的混合问题，然后重跑，看看抬高阈值是减少误答还是也损失召回。不要把阈值实验的结果直接接入网页。

**可选维护练习。** 找一条你认可的官方来源段落，先在资料 JSON 加 `DRAFT` 并记录原文章节。跑离线脚本，确认它没有进入索引；再将你的转述和原文拿给我一起核对。草稿阶段不需要重新打包或改现有运行环境。

## 基线结果与验收口径

固定 13 条小评估集（4 条已有问法、3 条未收录同义问法、6 条应拒答），默认实验阈值 0.35：完整问法 10/13 正确、应拒答例误答 0 条；字符向量 8/13 正确、应拒答例误答 3 条。向量额外命中 1 条未收录问法，同时错误接受了含用药、含症状、其他指标的近似问法。混合停药问题得分 0.775，演示高相似度仍不代表可答。小样本且含已知问法，只说明当前这组数据的取舍，不声称真实用户准确率或语义 embedding 表现。

网页验收：快捷问题与同义问法命中、回答段落对应出处；未知或混合问题不编答案；切换报告不显示前一份结果；网络失败可重试。真实 MySQL/Spring HTTP 检查归属、类别、角色、CSRF、请求长度和无内容泄露；单元测试校验问法规范化、审核状态、域名、重复条目。

开发记录：首轮全量测试的一项既有通知重投用例在以 `NOW(6)` 设置到期后立即取件时未取到事件。只调整测试夹具，把测试事件设置为明确已到期（提前一秒），不改通知生产逻辑。首轮还发现 Spring 的 Bean Validation 错误日志会包含被拒输入；新接口改为固定错误文字及局部 JSON 异常处理，复核后端测试报告未出现超长问题测试标记。最终后端 67 项全部通过，包括 3 项知识库单测及 2 项真实 MySQL 的知识 API 用例；TypeScript 检查通过。

后续如果资料更多或想覆盖自由问法，先扩大独立评估集，再对比 BM25、中文语义 embedding 和混合检索。在带引用的生成真正接入之前，必须增加上下文筛选、拒答策略、引用对齐评测和隐私审核。本阶段没有引入新的模型供应商、向量库或 agent 工具。

Edge 浏览器回归 22 项通过（约 109 秒，0 失败、0 跳过），其中新增知识解释 1 项：真实 API 命中并核对 CDC/AHA 两个链接、混合问题拒答且无引用、切换报告清空、断网重试。其余覆盖原有草稿、患者医生、随访、通知、消息和订单。机器记录：`.local-run/knowledge-e2e.json`、`server/target/surefire-reports`；网页测试输出截图名为 `source-backed-explanation.png`。

## 复现命令

项目根目录、使用已有 Maven 缓存和本机 MySQL，先停止同一数据库上的应用调度器：

```powershell
. .\server\.env.local.ps1
$env:JWZZ_IT_DB_URL=$env:DB_URL
mvn -o -s "$env:USERPROFILE/.m2/settings.xml" '-Dmaven.repo.local=.maven-repository' '-Dapp.notifications.dispatch-enabled=false' '-Dapp.followups.dispatch-enabled=false' -f server/pom.xml package
```

本机第二轮 67 项测试通过后，默认目录的 Spring Boot 重打包遇到 Windows 文件重命名失败。随后在空的独立构建目录生成可执行 JAR，确认包含 Spring Boot 启动类与资料库资源，复制到默认路径并核对文件散列；不需要改数据库或重装依赖。

用正常的 `scripts/start_local.ps1`（PowerShell 7.4+）启动，不必加 `-WithAi`。也可复用第四阶段的 3005/8085 预览脚本；它使用上述新 JAR。不要使用 3004 的旧消息分页预览包。

浏览器重点回归（在 `web` 目录；正常启动省略 TEST 两变量；若使用已有 3005/8085 预览则设置如下）：

```powershell
$env:TEST_WEB_URL='http://localhost:3005'
$env:TEST_API_URL='http://localhost:8085'
npx --no-install playwright test tests/report-assistant-stage2.spec.ts --workers=1
npx --no-install tsc --noEmit
```
