# Windows 本机加密配置与一键启动

适用：当前电脑的本地开发／演示。首次输入一次 DeepSeek API Key，以后由启动脚本自动加载；不需要每次复制 Key 和 Java—Python 通信令牌。本方案不更改业务代码，也不是生产部署方案。

## 1. 哪些文件会提交到 GitHub

| 文件 | 用途 | 是否提交 |
| --- | --- | --- |
| `scripts/setup_local_ai.ps1` | 交互输入 Key、生成内部令牌、加密保存 | 是，不含真实凭据 |
| `scripts/start_local.ps1` | 检查配置，启动／停止本次的前端、Java、可选 Python 进程 | 是，不含真实凭据 |
| `scripts/local_launcher_common.ps1` | 加密、权限限制、进程环境隔离等公共函数 | 是，不含真实凭据 |
| `scripts/local.settings.psd1` | 提供商地址、模型 ID、超时时间 | 是，只能填非敏感设置 |
| `%LOCALAPPDATA%\JWZZ\ai-credentials.clixml` | **加密后的 Key 和共享令牌，合存在一个文件里** | **否，在项目目录外** |
| `server/.env.local.ps1` | 原有数据库、演示账号等本机配置 | 否，已被 `.gitignore` 忽略 |
| `.local-run/<本次启动编号>/` | 前端、后端和 Python 各自的日志 | 否，已被 `.gitignore` 忽略 |

在当前 Windows 账号下，凭据文件通常是 `C:\Users\王\AppData\Local\JWZZ\ai-credentials.clixml`，实际以脚本输出的路径为准。即使把此文件误复制到仓库，`.gitignore` 也会忽略同名文件，但不要使用 `git add -f` 强制添加。

加密使用 Windows DPAPI：通常只有**原电脑上的原 Windows 用户**能解密，目录另设仅该用户可访问的权限。它不是云端保险箱，不防已能以该用户身份运行的恶意程序；服务调用时凭据仍须短暂出现在进程内存／子进程环境中。换电脑、换 Windows 用户或重装系统后，应重新配置，不能靠 Git 同步凭据。数据库配置沿用原文件，**本次没有把数据库密码也改成加密保存**。

## 2. 打开 PowerShell 7.4 或以上

从终端执行：

```powershell
$PSVersionTable.PSVersion
```

如果显示 `7.4` 或更新版本，直接继续。Windows 自带的 **Windows PowerShell 5.1 不支持本方案的子进程独立环境参数**。本机已找到可用 PowerShell 7.6.9，不需要再下载；如果当前终端是 5.1，执行下列命令进入已有的 PowerShell 7：

```powershell
& 'C:\Users\王\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile
```

上面是当前机器的实际路径，换电脑后请用那台电脑自己的 `pwsh`。之后所有命令都在新打开的 PowerShell 7 中运行：

```powershell
Set-Location 'D:\codex++\project\见微知著'
```

若遇到“禁止运行脚本”，先查看 `Get-ExecutionPolicy -List`。仅在自己信任此仓库、且没有组织策略限制时，可以在当前终端执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`；此设置只对该终端有效。不要求修改整机策略或始终以管理员运行。

## 3. 首次配置：你亲自输入 Key

已有的 `server/.env.local.ps1` 继续使用，不覆盖、不重新填写数据库密码。MySQL 需要保持启动；如果该文件开启 Redis，也按原方式运行 Redis，或明确将 `JWZZ_REDIS_ENABLED` 改成 `false` 使用本机降级。

先检查 `scripts/local.settings.psd1`。文件已沿用项目当前配置：

```powershell
@{
    AiBaseUrl = 'https://api.deepseek.com'
    AiModel = 'deepseek-flash'
    AiTimeoutSeconds = 5
}
```

如果此前你成功调用的是其他模型 ID，请把 `AiModel` 改成那个已验证的 ID。这里只填地址和模型名，**不要填 API Key／令牌**。Base URL 不含 `/chat/completions`，不把 Key 填在 URL 里。超时最多 5 秒，给 Java 的 7 秒整体等待留出余量。

然后执行：

```powershell
.\scripts\setup_local_ai.ps1
```

出现 `Paste your complete DeepSeek API key (input is hidden)` 后：

1. 从你自己的安全保存位置复制**完整** API Key，不能复制网页上带 `*****` 的掩码值。
2. 粘贴到终端的隐藏输入提示中并回车，不要粘贴到聊天、脚本源码或普通命令参数里。输入会被遮蔽；不同终端显示可能不同。
3. 看到 `Saved Windows-encrypted credentials to: ...` 即表示本机保存成功。共享令牌由脚本随机生成，不需要你记住或输入。
4. 按自己的习惯清理剪贴板，避免其他应用读到刚复制的 Key。

此步骤**不会调用 DeepSeek，不验证余额和 Key 是否有效**。重复无参数运行时发现文件已存在会直接退出，不会覆盖。之前手动使用的内部共享令牌不必保留，但接下来 Java 和 Python 都要由新脚本重新启动，避免新旧令牌混用。

## 4. 首次切换：先停旧实例，再检查

在之前运行前端、Java、Python 的终端分别按 `Ctrl+C` 停止它们；**不需要停止 MySQL／Redis**。只停你自己确认的本项目进程，不要看到端口占用就批量结束所有 Java／Node 进程。

回到项目根目录执行预检：

```powershell
.\scripts\start_local.ps1 -WithAi -CheckOnly
```

`Preflight passed` 表示必需文件／配置可读取，3000、8080、8091 端口空闲。预检不启动服务，也不连接数据库或外部供应商。如果端口被占用，脚本明确报错，不会自动杀掉旧进程。可只读查看占用情况：

```powershell
Get-NetTCPConnection -LocalPort 3000,8080,8091 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
# 用查到的具体进程号确认身份，例如 Get-Process -Id 12345；不要直接照抄示例进程号停止程序。
```

## 5. 以后每次启动：一条命令，一个终端

```powershell
Set-Location 'D:\codex++\project\见微知著'
.\scripts\start_local.ps1 -WithAi
```

脚本依次启动 Python、Java、Next.js 并检查本地健康接口；看到 `Ready: http://localhost:3000` 后，在浏览器打开该地址。**这个终端保持打开**，不需要再分别开三个服务终端。使用其他终端做开发操作仍然可以。

- DeepSeek Key 只传给 Python；Java 只有数据库配置及共享令牌；前端不会从启动器收到这些凭据。
- 脚本使用 `.venv/Scripts/python.exe`，不使用本机旧版 `python`；用 `node` 直接启动项目已有 Next.js CLI，不依赖当前机器有问题的 npm 启动包装器。
- 脚本只读已构建的 `server/target/server-0.1.0-SNAPSHOT.jar`，**不自动编译、安装依赖、启动数据库或调用模型**。后端代码修改后必须先停止旧实例、重新打包，再启动，否则仍是旧后端。
- 停止时在该终端按 **Ctrl+C**，脚本清理自己创建的进程及其子进程，不停止已有 MySQL／Redis。不要用强制结束终端的方式代替正常停止；异常强制退出后可能需要确认端口是否仍被占用。
- 任一服务启动失败或随后退出，启动器会报告错误并清理本次启动的其他服务。日志在 `.local-run/<本次启动编号>/` 的 `java.log`、`python.log`、`web.log` 及对应 `.error.log` 中；不主动打印凭据，但业务日志也可能含数据，**不要未经检查就分享整份日志**。

只体验不调用模型的基础功能时，可以运行：

```powershell
.\scripts\start_local.ps1
```

这时仅启动 Java 和前端，显式关闭 Java 的模型开关，不读取 AI 凭据，也不启动 Python。

## 6. 你的首次验收

1. 完成配置、启动后登录测试用户，打开虚构血压报告。
2. 不勾选外部模型，生成咨询草稿，应继续走本地模板。
3. 主动勾选外部模型后生成，成功时应显示「Python 模型辅助」。健康接口正常**不等于**模型调用成功；只有这一步才验证提供商实际调用，可能产生正常 API 费用。
4. 在启动终端按 Ctrl+C；确认服务已停止。再运行 `start_local.ps1 -WithAi`，不应再要求输入 Key 或令牌，原功能应可用。

只使用虚构报告。授权、填入草稿和提交咨询仍由你手动操作，不自动向医生发送消息。

## 7. 更换 Key、换电脑与常见问题

更换 DeepSeek Key（先停止项目；内部令牌保留）：

```powershell
.\scripts\setup_local_ai.ps1 -UpdateApiKey
.\scripts\start_local.ps1 -WithAi
```

更换 Windows 用户、文件损坏或需要同时重置两项凭据：

```powershell
.\scripts\setup_local_ai.ps1 -Reset
```

如已有文件，脚本要求输入 `YES` 后才覆盖；然后输入完整 Key。重置后必须重启 Java、Python，不能与旧实例混用。

| 提示／情况 | 处理方式 |
| --- | --- |
| `AI credentials not found` | 用当前 Windows 用户运行一次 `setup_local_ai.ps1` |
| `Cannot decrypt credentials` | 使用原 Windows 用户和原电脑；无法恢复时重新配置，而不是把文件发给他人 |
| `Port ... is already in use` | 回原启动终端停止确认过的旧实例；脚本不会自动处理未知进程 |
| 缺少 JAR、Next CLI 或虚拟环境 | 参照 [本地开发说明](development.md) 和 [阶段三文档](agent-stage3-acceptance.md) 恢复依赖／打包；脚本不下载 |
| Java 启动失败 | 看本次 `java.log`／`.error.log`，检查 MySQL 运行状态和本机数据库配置 |
| UI 回退本地模板 | 检查模型开关、Key／余额、网络、模型 ID、响应是否超时或不合规；这不是凭据未保存的充分证据 |

离线验证脚本可随时复跑，不需要真实 Key、数据库或正在运行的应用：

```powershell
.\scripts\verify_local_launcher.ps1
```

它仅在项目 `.local-run` 下临时创建虚构凭据和测试进程，完成后删除自己创建的临时目录。不会读取 `%LOCALAPPDATA%\JWZZ`。验证范围及结果见 [启动器测试记录](testing/2026-11-16-local-launcher.md)。
