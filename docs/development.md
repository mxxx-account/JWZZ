# 本地开发

## 前置条件

- Node.js 20 或更新版本
- JDK 17（当前机器已安装；新版服务以 JDK 17 为基线）
- Maven 3.9+
- Docker Compose（运行 MySQL、Redis 时）

## 启动

1. `docker compose up -d mysql redis`
2. `cd server && mvn spring-boot:run`
3. `cd web && npm install && npm run dev`
4. 打开 `http://localhost:3000`；服务健康检查在 `http://localhost:8080/api/health`

当前仅为工程骨架。正式的指标判断规则和用户权限会在后续阶段加入。
