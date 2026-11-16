# 报告解读与咨询准备 Agent：阶段三 Python 模型接入

这一阶段在原有报告页上增加可选的模型辅助。原报告、同条件对比、授权和咨询仍由 Java 处理。默认使用本地模板，不要求启动 Python，也不发起外部请求。

## 实施方案

| 层 | 职责 | 不做什么 |
| --- | --- | --- |
| Next.js 报告页 | 选择咨询重点、主动勾选外部模型、展示来源、编辑并填入草稿 | 不保存模型密钥，不自动授权或发送 |
| Spring Boot | 核对报告归属和支持范围，决定是否调用 Python，校验主题并渲染文字，失败回退模板 | 不把报告原文、数值、日期、个人资料或手写内容交给 Python |
| Python 网关 | 接收限定字段、调用支持 JSON 输出的 Chat Completions 接口、校验模型选择 | 不连数据库、不登录用户、不执行工具、不给出诊断或用药建议 |

Java 到 Python 的请求只包含 `context`（居家或诊室）、`hasComparableHistory`（有无同条件历史）和 `focus`（咨询重点枚举）。Python 让模型返回语气与两个不同的问题主题，而不是自由生成医疗文本。无可比历史时不允许模型选历史对比；Java 再校验一次，并用预定义安全文字组成草稿。这样可以用真实模型做主题选择，同时不会把模型生成的任意文字展示给用户。

实现使用 Python 3.10+ 标准库，无新增 Python 或 Maven 依赖。Python 仅监听本机回环地址，与 Java 之间使用共享令牌。提供商凭据只配置在 Python 进程中。Java 按用户限制每分钟 5 次模型尝试，单实例最多同时向网关发起 4 个请求，等候模型结果最多 7 秒。模型超时、不可用、限流或输出不符合约定时，返回本地模板；不自动重试。不为这个功能新增数据库表。这里仅用于虚构数据的本地演示，不是面向真实患者的上线方案；即使没有原始数值，也不把这三个派生字段视为允许随意外发的数据。

## 真实模型怎么开

**日常启动推荐使用[本机加密配置与一键启动](local-startup.md)**：仅首次输入 Key，由脚本管理 Java—Python 共享令牌；以后一个 PowerShell 7.4+ 终端运行 `./scripts/start_local.ps1 -WithAi`。下方保留手动分终端方式用于排查，不要同时启动两套实例。

需要已构建的阶段三后端、现有前端依赖、本机 MySQL，以及一个支持 Chat Completions JSON 输出的模型账号。下方以 [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 文档中的模型为例。换供应商时，用对方支持 `response_format: {"type":"json_object"}` 的模型 ID 和 Base URL，不要把 `/chat/completions` 写进 Base URL。

先在自己电脑生成随机共享令牌，例如在项目根目录执行 `& .\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(36))"`。仅在本机复制该令牌给下面两个终端，不把令牌或模型密钥发到聊天、写进源码、提交到 Git。

**终端 1：Python 网关**（从项目根目录启动；不要加载数据库配置）：

```powershell
$env:JWZZ_AGENT_SHARED_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host '输入共享令牌' -AsSecureString)).Password
$env:JWZZ_AI_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host '输入模型 API Key' -AsSecureString)).Password
$env:JWZZ_AI_BASE_URL = 'https://api.deepseek.com'
$env:JWZZ_AI_MODEL = 'deepseek-flash'
$env:JWZZ_AI_ALLOW_LOCAL_PROVIDER = 'false'
& .\.venv\Scripts\python.exe -m ai_service
```

当前机器的项目虚拟环境已安装 Python 3.12；若另一台机器已有 Python 3.10+，可以改用 `python -m ai_service`。访问 `http://127.0.0.1:8091/health` 可检查进程是否在运行；健康检查不会请求提供商，也不验证密钥是否能实际调用。

**终端 2：Java 后端**（若 8080 已运行本项目后端，先停掉该实例再启用新配置；从项目根目录启动）：

```powershell
. .\server\.env.local.ps1
$env:JWZZ_AGENT_MODEL_ENABLED = 'true'
$env:JWZZ_AGENT_URL = 'http://127.0.0.1:8091/v1/report-draft'
$env:JWZZ_AGENT_SHARED_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host '输入同一个共享令牌' -AsSecureString)).Password
java -jar server/target/server-0.1.0-SNAPSHOT.jar --spring.profiles.active=dev --server.address=127.0.0.1
```

**终端 3：前端**（从项目根目录启动，已有前端进程可复用）：

```powershell
cd web
node node_modules/next/dist/bin/next dev --hostname localhost --port 3000
```

平时只演示本地模板时，不需要终端 1，也不需要密钥或启用 Java 开关。外部模型可能按供应商规则计费；验收只用虚构数据，勾选后才允许调用。

## 页面验收

1. 用测试用户登录，从「我的报告与授权」打开一份虚构血压报告。确认没有勾选「允许外部模型辅助（仅限虚构数据）」时，点击「生成咨询草稿」仍是本地模板。
2. 点击「调整生成选项」，选择「咨询重点」，勾选外部模型，再生成草稿。只有供应商调用成功且结果通过双重校验，页面才显示「Python 模型辅助」。验证仍可编辑、授权后主动填入；没有点击「提交咨询并打开消息」，医生不会收到消息。
3. 停掉自己启动的 Python 服务，再用模型选项生成一次草稿。应提示模型不可用并给出本地模板；原报告、对比、手写咨询都可以继续使用。

## 自动化复验

以下命令使用本机 Python，无需安装依赖或提供外部 API Key。全链路脚本会启动临时 Java、Python 和本地假提供商，退出时只停止脚本自己的服务。它会在已配置的本地开发库创建一名随机 `@example.invalid` 测试用户与虚构报告，不会创建医生授权或咨询；这些测试数据留在所用开发库。

```powershell
# 项目根目录；先停止占用旧 JAR 的项目后端，再打包（使用当前电脑已有离线缓存）
. .\server\.env.local.ps1
$env:JWZZ_IT_DB_URL = $env:DB_URL
mvn -o -s "$env:USERPROFILE/.m2/settings.xml" '-Dmaven.repo.local=.maven-repository' -f server/pom.xml package

& .\.venv\Scripts\python.exe -m unittest discover -s ai_service/tests -v
& .\.venv\Scripts\python.exe .\scripts\verify_agent_stage3.py
```

前后端启动后，还可以在另一个 PowerShell 终端复跑浏览器流程。测试将验证显式勾选、切换报告清除模型选择、模板回退提示，以及原有授权和提交行为：

```powershell
. .\server\.env.local.ps1
cd web
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/report-assistant-stage3.spec.ts tests/report-assistant-stage2.spec.ts tests/patient-doctor-flow.spec.ts --workers=1
```

Java 接口仍是 `POST /api/reports/{reportId}/assistant`，请求新增可选的 `focus` 与 `useModel`，旧客户端仍能用模板。响应标记 `mode: "MODEL" | "TEMPLATE"` 与 `modelStatus`：`NOT_REQUESTED`、`DISABLED`、`USED`、`UNAVAILABLE`。

## 本次验证记录

- Java + 本机 MySQL：44 项通过，无失败、错误或跳过；后端 JAR 打包成功。
- Python：7 项通过，包括鉴权、字段限制、非法主题、超时、并发上限、限流和禁止重定向。
- 本地全链路：新版 Java 通过真实 HTTP 请求访问本机 Python，再请求本机假提供商；确认不勾选无外部请求、模型只收到三个允许的上下文字段、有效主题可生成草稿、429 和不合规输出触发模板，且未创建授权或咨询。
- TypeScript 检查和 Next.js 生产构建通过；Edge 浏览器 9 项通过（助手第三阶段 2 项、第二阶段 3 项、原用户／医生流程 4 项）。第三阶段浏览器用例拦截草稿响应以验证页面状态；Java、Python 与模型协议由全链路脚本另行覆盖。
- 未使用真实 API Key、未调用外部供应商。配置真实模型后，需要按页面验收步骤再完成一次实际供应商联调。
