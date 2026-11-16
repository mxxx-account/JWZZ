# 2026-11-16：面试版回归与演示验收

基线：`b51bdbf`，业务代码未改；本轮加强模型到咨询的回归脚本并整理演示资料。环境为 Windows 本机、PowerShell 7、已有 Edge 和本机 MySQL；使用现有 JAR、前端依赖和 Python 虚拟环境，没有安装新的依赖。

## 实测结果

| 范围 | 做了什么 | 结果 |
| --- | --- | --- |
| 现有应用健康检查 | 前端首页 3000、Java `/api/health` 8080、Python `/health` 8091 | 三项 HTTP 200；只确认进程可服务，不证明外部模型可用 |
| 旧终端版本与端口保护 | 从 Windows PowerShell 5.1 显式调用 PowerShell 7 执行 `start_local.ps1 -CheckOnly` | 跳过版本冲突，按预期提示 8080 已占用；3000/8080/8091 的监听进程未变化 |
| 启动器离线验证 | DPAPI、凭据更新、子进程环境隔离、占用端口保护、临时进程清理 | **20 项通过**，使用虚构凭据；没有使用真实密钥 |
| Python 组件 | 健康和权限、输入约束、提供商协议、超时、并发和输出校验 | **7 项通过**，无失败 |
| 独立接口全链路 | 临时 Java、真实 Python 网关、本机假提供商及 MySQL | exit 0，**6 组断言通过**，详见下方 |
| Edge 页面回归 | 报告草稿、咨询／撤权、订单库存、商家消息隔离 | **11 项通过**，无失败或跳过，约 1.1 分钟 |

接口全链路的六组断言：

1. 不勾选模型：本地模板，状态为 `NOT_REQUESTED`，假提供商没有收到请求。
2. 主动勾选：真实 Java → Python HTTP 链路拿到合规主题，返回 `MODEL / USED`；提供商请求只包含测量场景、有无可比历史和咨询重点等允许的业务字段，不包含虚构账号、报告时间、血压数值或密码。
3. 模型返回契约外文本或 HTTP 429：两种情况均回退为 `TEMPLATE / UNAVAILABLE`；不重试、没有自动授权或自动创建咨询。
4. 用户显式授权指定医生：授权后仍没有咨询记录。
5. 用户修改并显式提交回退草稿：未接受时医生不能直接进入聊天；接受后看到修改后的内容，回复能被患者收到，授权和消息操作没有继续调用模型。
6. 患者撤权：医生侧会话不再列出，直接读会话与继续发消息均被拒绝（HTTP 404）。

浏览器覆盖：报告助手 5 项（首选项、编辑与填入、请求失败和过期响应、模型选项与状态反馈），用户／医生 4 项（登录、报告授权、接收回复、撤权和布局），商城 2 项（取消回补、模拟支付、接单库存同步和跨角色消息隔离）。其中助手阶段三的两条浏览器用例拦截模型响应，只测试交互和提示；真实 Java/Python 请求由上方接口全链路覆盖。此前并发防超卖、幂等和回补一次的证据仍见[订单验收](../shop-stage4-acceptance.md)与[商城最终回归](2026-11-08-final-regression.md)，本轮不重新压测。

## 如何复现

下列命令仅用于本机开发／测试库。接口脚本会启动临时服务，用随机 `@example.invalid` 账号造数并撤销本次授予的权限；浏览器用例同样会创建虚构记录。账号、指标、消息及订单测试记录可留在使用的本机库中；不要在正式数据环境运行。不要将本机配置内容、Key 或数据库密码贴到报告里。

在 PowerShell 7.4+ 的项目根目录运行：

```powershell
.\scripts\verify_local_launcher.ps1

. .\server\.env.local.ps1
& .\.venv\Scripts\python.exe -m unittest discover -s ai_service/tests -v
& .\.venv\Scripts\python.exe .\scripts\verify_agent_stage3.py
```

现有本机前后端运行后，在已加载本机演示账号配置的测试终端继续：

```powershell
$env:TEST_WEB_URL = 'http://localhost:3000'
$env:TEST_API_URL = 'http://localhost:8080'
Set-Location web
node node_modules/@playwright/test/cli.js test tests/report-assistant-stage3.spec.ts tests/report-assistant-stage2.spec.ts tests/patient-doctor-flow.spec.ts tests/shop-stage4.spec.ts tests/shop-stage5.spec.ts --workers=1
```

## 演示前最后验收（手动）

回归时三个项目端口已占用，保留现有服务，**未对实际应用执行停机、冷启动和重启循环**。没有读取真实凭据、向 DeepSeek 发请求或消耗额度；也没有重跑 Docker Compose 空库部署。健康检查和假模型均不能替代这些结果。

1. 在原项目启动终端按 Ctrl+C，确认 3000/8080/8091 不再由该实例占用；MySQL 不用停止。在新终端按[启动说明](../local-startup.md)用 PowerShell 7 启动项目，确认无需再次输入凭据、看到 `Ready`、浏览器可打开。
2. 按[面试演示脚本](../interview-demo.md)以本地模板走一次患者 → 医生 → 撤权。若决定现场展示真实模型，用虚构血压报告主动勾选并验证一次出现「Python 模型辅助」；如果未启用、不具备网络条件或模型不稳定，直接选模板路线。
3. 正式演示前备好账号、报告、两个浏览器会话和文档，不在投屏输入 Key，也不依赖现场调用一定成功。
