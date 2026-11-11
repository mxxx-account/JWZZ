# 报告解读与咨询准备 Agent：阶段二验收

用户首页 → 我的报告与授权 → 选择血压报告 → **报告解读与咨询准备**。此阶段接入了 Java 本地模板，不调用外部模型；报告数值和差值来自第一阶段的事实接口。

## 页面验收

1. 用本地测试用户登录。在「录入体检指标」录入两次不同时间的**虚构居家血压**，例如较早的 122.25 / 78 和较晚的 129.5001 / 76，单位 mmHg。在「最近录入」为较晚的一次生成报告。
2. 打开这份报告。对比区应显示本次、上次同条件记录、收缩压差值 **+7.2501**、舒张压差值 **-2**。展开「指标说明」可看到字段解释。如果没有同条件历史，只展示本次，不显示差值。
3. 先不授权，点击「生成咨询草稿」。确认面板标明「本地模板 · 未调用 AI」，可以修改「咨询草稿」，但不能填入咨询框，也没有发出任何消息。
4. 在下方选择测试医生并授权。确认先前的草稿仍在。点击「填入咨询草稿」；若下方咨询框已有手写内容，选择追加、替换或取消。追加超过 1000 字会被阻止，不会截断手写内容。
5. 只有点击原有的「提交咨询并打开消息」，才会创建咨询。用医生账号查看首页「待咨询的报告」，确认收到的是用户最终提交的文字。单纯生成草稿或授权不会提交咨询。

草稿只暂存在当前页面的当前报告中。切换报告或离开页面不会把草稿带到另一份报告，也不会自动保存。血糖、血脂及旧快照不生成模板，可按原流程手动咨询。

## 复跑测试

需要已启动的本机 MySQL 和新版前后端。可以按 [本地开发说明](development.md) 从源码启动后端；若已构建本阶段的后端包，也可在项目根目录执行以下命令。当前机器已有 Web 依赖，可直接调用项目内 Next CLI。

```powershell
# 后端终端：使用已构建的本阶段包
. .\server\.env.local.ps1
java -jar server/target/server-0.1.0-SNAPSHOT.jar --spring.profiles.active=dev --server.address=127.0.0.1
```

```powershell
# 前端终端：在项目根目录执行
cd web
node node_modules/next/dist/bin/next dev --hostname localhost --port 3000
```

```powershell
# 另一个终端：在项目根目录执行
. .\scripts\verify_agent_stage1.ps1 -Full
. .\server\.env.local.ps1
cd web
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/report-assistant-stage2.spec.ts tests/patient-doctor-flow.spec.ts --workers=1
```

Playwright 通过本地开发服务创建随机的 `@example.invalid` 测试数据，不使用真实报告；新增用例会撤销测试授权，但注册的测试账号和数据仍在测试所用的开发库中。

开发验证记录（2026-11-11）：本机 MySQL 后端回归 **35 项通过**（含阶段一 5 项、本阶段新增 3 项），无失败、错误或跳过；TypeScript 类型检查和 Next.js 生产构建通过；Edge 浏览器 **7 项通过**（本阶段 3 项、原用户／医生流程 4 项）。

| 新增浏览器用例 | 覆盖内容 |
| --- | --- |
| 对比到咨询提交 | 旧快照的同条件差值、授权前编辑、授权后保留、追加和替换、用户主动提交、医生看到最终文字 |
| 草稿请求失败 | 保留报告对比与手写内容，重试可恢复 |
| 切换报告 | 模拟旧草稿延迟返回，新报告不会显示旧草稿或旧数值 |

## 接口变更

- `GET /api/reports/{reportId}/assistant/evidence`：复用阶段一，只返回本人报告的结构化事实。
- `POST /api/reports/{reportId}/assistant`：请求体 `{"action":"PREPARE_CONSULTATION"}`，响应含 `reportId`、`mode: "TEMPLATE"`、`questions` 和 `draft`。仅报告本人可读，必须有有效会话与 CSRF；不支持的快照或指标返回 409，不写入数据库。
- 授权和咨询仍走原有接口。未增加依赖、数据库迁移或模型凭证。
