# Docker Compose 全新环境验收

`compose.full.yaml` 与原有 `compose.yaml` 分开：前者包含 MySQL、Redis、Spring Boot、Next.js 四服务，用 `jwzz-fresh` 项目名与自己的 MySQL 卷验证“空库→Flyway V1–V6→可用页面”；本机既有 MySQL/Redis 端口不映射、不覆盖。前后端映射在 `127.0.0.1:8081` 和 `127.0.0.1:3001`。Compose 文件中的默认密码仅供本机演示，不能用于公网部署。

## 常规命令

若 Windows 已有 Docker Desktop，从项目根目录执行：

```powershell
docker compose -f compose.full.yaml -p jwzz-fresh config --quiet
docker compose -f compose.full.yaml -p jwzz-fresh up --build -d
docker compose -f compose.full.yaml -p jwzz-fresh ps
```

当前机器改用已有 Ubuntu WSL 内的 Docker Engine/Compose（不需要 Docker Desktop 图形界面）：

```powershell
wsl -d Ubuntu -u root -- service docker start
wsl -d Ubuntu -u root -- docker compose -f '/mnt/d/codex++/project/见微知著/compose.full.yaml' -p jwzz-fresh config --quiet
wsl -d Ubuntu -u root -- docker compose -f '/mnt/d/codex++/project/见微知著/compose.full.yaml' -p jwzz-fresh up --build -d
wsl -d Ubuntu -u root -- docker compose -f '/mnt/d/codex++/project/见微知著/compose.full.yaml' -p jwzz-fresh ps
```

启动后访问 `http://localhost:3001`、`http://localhost:8081/api/health`；查看后端日志确认 Flyway 迁移到 V6。演示医生密码默认 `ChangeThisDemoPassword123!`，也可在运行 Compose 的环境设置 `JWZZ_COMPOSE_DOCTOR_PASSWORD` 覆盖。独立环境的消息 API 验收：

```powershell
./scripts/verify_messages.ps1 -BaseUrl 'http://127.0.0.1:8081' -DoctorPassword 'ChangeThisDemoPassword123!'
```

该脚本会创建少量随机测试记录。**不要**对仍需保留的环境执行 `down -v`；`down` 只停服务，`down -v` 会删除该项目的 MySQL 卷。清理由用户确认后再做。

## 本机网络说明

本机 WSL 直接访问 Docker Hub 曾超时。排查时通过一个仅绑定 WSL 虚拟网卡的临时转发进程 `scripts/wsl_proxy_relay.mjs`，把 WSL 请求转给 Windows 已存在的 `127.0.0.1:7890` 代理；随后临时以 Docker 官方支持的 `dockerd --http-proxy/--https-proxy` 参数启动 daemon。转发进程不是项目运行时依赖，也不应暴露到公网。若使用常规网络或 Docker Desktop，无需这一步。Docker Hub 或 Windows 代理不可用时，镜像拉取会失败，不能把 Compose 配置校验视作完整启动通过。实际结果与阻塞见[测试报告](test-report.md)。
