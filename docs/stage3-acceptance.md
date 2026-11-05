# 阶段 3 验收：指标录入与规则草案

## 先明确边界

本阶段可以保存血压、血糖和血脂的原始数据、测量条件及换算值。规则仅是本地 `dev` 环境的研发预览，状态为 `AWAITING_CLINICAL_REVIEW`；正式环境不会返回阈值解读。它不输出疾病概率、不确诊、不推荐药物。规则不适用于未成年人和妊娠期；指尖/随机/餐后血糖不会套用空腹实验室血浆规则。某些明显低值不在当前草案解释范围，页面不应把它们标成“正常”。如有明显不适或异常读数，应寻求医疗人员帮助。

## 页面验收

1. 按 [本地开发说明](development.md) 启动 MySQL、Java 后端和 Next.js，打开 [http://localhost:3000](http://localhost:3000)，登录普通用户。进入“用户工作台”，找到“录入体检指标”。
2. 选“血压”，保持“居家测量”，填收缩压 `130`、舒张压 `80`，点击保存。应看到原始值、标准值、研发预览标签，以及规则版本和来源链接。
3. 选“血糖”，测量条件选“空腹实验室血浆”，填 `100`，单位选 `mg/dL`。保存后应显示约 `5.5499 mmol/L`，并进入中间参考区间。切换为“指尖血糖”再次保存时，不应显示这条空腹血浆规则。
4. 选“血脂”，只填甘油三酯 `150 mg/dL`，其余留空。应显示约 `1.6936 mmol/L` 和甘油三酯参考提示。LDL 等指标只保存，不会凭单个数值宣称风险等级。
5. 尝试收缩压 `70`、舒张压 `80`；后端应拒绝。将测量时间改到未来一天也应拒绝。页面目前对后端校验错误只显示 HTTP 400，后续会改善为逐字段提示。

阶段 3 保存的是指标记录，不会自动生成报告。报告生成与趋势图属于阶段 4。

## 自动化验收

后端以 `dev` 配置运行时，在项目根目录的 PowerShell 7 中执行：

```powershell
.\scripts\verify_stage3.ps1
```

脚本会创建随机测试账号并保存少量测试指标，不会删除记录。单元测试用 `cd server` 后执行 `mvn test`。

## 接口和规则来源

`POST /api/indicators` 仅普通用户可调用。请求示例：

```json
{
  "category": "GLUCOSE",
  "measuredAt": "2026-11-05T09:00:00",
  "context": "FASTING_PLASMA",
  "ageYears": 22,
  "pregnant": false,
  "values": { "blood_glucose": { "value": 100, "unit": "mg/dL" } }
}
```

`GET /api/indicators` 返回当前用户最近 100 条指标明细。接口使用阶段 2 的会话和 CSRF 机制；医生不能调用。当前规则代码是 `BP_CATEGORY`、`FPG_CATEGORY`、`TG_REFERENCE`，规则版本 `draft-2026-01`。

来源（需要临床顾问核对本项目适用人群与中文措辞后才能正式启用）：

- 血压分类：[AHA/ACC 2025 高血压指南概览](https://professional.heart.org/en/science-news/2025-high-blood-pressure-guideline/top-things-to-know)。
- 空腹实验室血浆血糖界限：[ADA 2026 糖尿病诊断与分类标准](https://diabetesjournals.org/care/article/49/Supplement_1/S27/163926)。诊断需要临床复核，本项目单次录入不作诊断。
- 甘油三酯常用参考值与 LDL 的个体化目标：[美国心脏协会血脂说明](https://www.heart.org/en/health-topics/cholesterol/about-cholesterol/what-your-cholesterol-levels-mean)。
- 单位换算：[NIDDK 血糖换算表](https://www.niddk.nih.gov/-/media/Files/Strategic-Plans/Diabetes-in-America-3rd-Edition/DIA_Conversions.pdf)、[NCBI 血脂换算系数](https://www.ncbi.nlm.nih.gov/books/NBK83505/)。
