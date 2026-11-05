# 本地开发

## 前置条件

- Node.js 20 或更新版本
- JDK 17（当前机器已安装；新版服务以 JDK 17 为基线）
- Maven 3.9+
- 本机 MySQL 8 或 Docker Compose（二选一；当前项目账号只访问 `jwzz` 库）

## 启动

1. 使用已安装的 MySQL，确保存在 `jwzz` 数据库及一个仅有该库权限的项目用户。Docker 是可选方式：`docker compose up -d mysql redis`。
2. 把 `server/env.example.ps1` 复制为 `server/.env.local.ps1`，填入项目用户密码及仅供本地演示的医生密码。该文件被 Git 忽略，不要把 root 密码放进项目配置。
3. 在 PowerShell 中执行 `cd server`、`. .\.env.local.ps1`、`mvn spring-boot:run`。Spring Boot 启动时由 Flyway 自动运行数据库迁移。
4. 在另一个终端执行 `cd web`、`npm install`、`npm run dev`。
5. 打开 `http://localhost:3000`，点击“检查后端连接”；服务接口是 `http://localhost:8080/api/health`。各阶段验收步骤见 [阶段 2](stage2-acceptance.md)、[阶段 3](stage3-acceptance.md)、[阶段 4](stage4-acceptance.md)。

阶段 5 若启用 Redis，当前电脑可在已有 Ubuntu WSL 中执行 `wsl -d Ubuntu -u root -- service redis-server start`，并保持一个 Ubuntu 终端打开，以免 WSL 空闲退出。然后在启动 Java 的同一终端设 `$env:JWZZ_REDIS_ENABLED='true'`。Redis 运行在 `localhost:6379`；不启用时咨询仍可运行，但限流只在单个 Java 实例内生效，不能宣称跨实例一致。验收步骤见 [阶段 5](stage5-acceptance.md)。

当前机器已找到 MySQL Server 8.0.46，服务名为 `MySQL80`。`jwzz` 数据库和本机专用账号已创建，Flyway 负责自动迁移。阶段 5 已在现有 Ubuntu WSL 安装 Redis 7，本机测试通过 `localhost:6379` 连接。

阶段 4 已加入指标报告快照、幂等生成和同条件趋势图。规则尚未经过临床审核，不能作为诊断或治疗依据。报告由用户在“最近录入”中主动生成。

阶段 5 后的消息页迭代见[消息页验收](messages-acceptance.md)：患者和医生分别使用 `/patient/messages`、`/doctor/messages`。此迭代不属于暂缓的阶段 6。
