# 见微知著（JWZZ）

体检指标解读与健康风险管理平台。第一版以血压、血糖、血脂的录入、规则化解读、历史趋势和双角色报告查看为目标。项目中的提示是健康信息展示，不是疾病诊断。

## 新版项目

- `web/`：Next.js、React、TypeScript 前端
- `server/`：Java、Spring Boot 业务后端
- `docs/`：产品范围、架构与实施清单

此前的 `src/`、`backend/`、`desktop/`、`models/`、`reports/` 暂作 DKD 模型与 Electron 原型研究资料保留。原始 CSV 不进入 Git 仓库。现有模型尚未接入新版用户评估流程。

开发说明见 [docs/development.md](docs/development.md)，任务清单见 [docs/implementation-plan.md](docs/implementation-plan.md)，输入设计见 [docs/indicator-dictionary.md](docs/indicator-dictionary.md)。报告与趋势验收见 [docs/stage4-acceptance.md](docs/stage4-acceptance.md)，演示咨询与 Redis 验收见 [docs/stage5-acceptance.md](docs/stage5-acceptance.md)。规则仍是待临床审核的研发预览。

当前 Web 平台的[架构图](docs/architecture.md)、[数据库设计图](docs/database-design.md)、[接口文档](docs/api-reference.md)、[测试与压测报告](docs/test-report.md)、[Docker Compose 验收说明](docs/compose-validation.md)、[技术难点与取舍](docs/technical-tradeoffs.md)及[演示脚本](docs/demo-script.md)已单独整理。

## 旧模型原型

本仓库先完成可复现的机器学习模型，再接入 Electron 桌面客户端。

## 当前研究定位

这是基于整理后 NHANES 数据的横断面风险筛查模型原型，不是纵向发病预测模型，也不能用于临床诊断或治疗决策。

主模型不会使用 `UACR`、`eGFR` 或 `serum_creatinine` 作为输入，因为它们与 `DKD` 标签存在直接关系，会造成标签泄露。

## 运行顺序

```powershell
.\.venv\Scripts\python.exe src\audit_data.py
.\.venv\Scripts\python.exe src\train.py
.\.venv\Scripts\python.exe src\explain_model.py
.\.venv\Scripts\python.exe src\generate_model_card.py
```

审计和训练产物会写入 `reports/`，可部署模型会写入 `models/`。
