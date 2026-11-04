"""Generate a plain-language model card from generated training artifacts."""

import json

import pandas as pd

from config import MODELS_DIR, REPORTS_DIR


def main() -> None:
    comparison = pd.read_csv(REPORTS_DIR / "model_comparison.csv")
    metadata = json.loads((MODELS_DIR / "model_metadata.json").read_text(encoding="utf-8"))
    chosen = comparison.loc[comparison["name"] == metadata["model_name"]].iloc[0]
    text = f"""# 模型卡：DKD 风险筛查模型\n\n## 模型身份\n\n- 版本：`{metadata['model_version']}`\n- 入选模型：`{metadata['model_name']}`\n- 用途：基于常规体检信息的肾损伤标志物风险筛查原型。\n- 禁止用途：临床诊断、处方、治疗决策或紧急分诊。\n\n## 输入\n\n{', '.join(metadata['feature_names'])}\n\n`UACR`、`eGFR`、`serum_creatinine` 被明确排除，避免用构造标签的肾脏指标预测标签本身。\n\n## 数据划分\n\n- 训练：{', '.join(metadata['training_cycles'])}\n- 留出测试：{', '.join(metadata['test_cycles'])}\n- 阈值：{chosen['threshold']:.3f}（训练集内交叉验证预测确定）\n\n## 留出测试集表现\n\n| 指标 | 数值 |\n|---|---:|\n| ROC-AUC | {chosen['test_roc_auc']:.3f} |\n| PR-AUC | {chosen['test_pr_auc']:.3f} |\n| Brier score | {chosen['brier_score']:.3f} |\n| 灵敏度 | {chosen['sensitivity']:.3f} |\n| 特异度 | {chosen['specificity']:.3f} |\n\n## 已知限制\n\n1. 数据为横断面整理数据，不能解释为对未来 DKD 发病的纵向预测。\n2. DKD 标签与常见 UACR/eGFR 阈值规则有 16 条记录不一致，必须追溯标签生成规则。\n3. 测试 ROC-AUC 处于有限水平；客户端只能称为研究性风险筛查，不能使用诊断性措辞。\n4. 训练数据来自 NHANES 背景，不代表模型已在中国人群中验证。\n5. 缺失输入由训练期中位数/众数规则处理；客户端应提醒用户补齐体检数据。\n"""
    (REPORTS_DIR / "model_card.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
