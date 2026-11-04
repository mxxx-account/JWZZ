"""Create SHAP-based global explanations for the selected deployable model."""

import json

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap

from config import DATA_PATH, MODELS_DIR, MODEL_FEATURES, REPORTS_DIR, TARGET, TEST_CYCLES


def main() -> None:
    model_path = MODELS_DIR / "dkd_risk_model.joblib"
    if not model_path.exists():
        raise FileNotFoundError("Train a model first: python src/train.py")

    REPORTS_DIR.mkdir(exist_ok=True)
    metadata = json.loads((MODELS_DIR / "model_metadata.json").read_text(encoding="utf-8"))
    pipeline = joblib.load(model_path)
    classifier = pipeline.named_steps["classifier"]
    if not hasattr(classifier, "feature_importances_"):
        raise TypeError("Selected model is not tree-based; add a compatible SHAP explainer before running this script.")

    df = pd.read_csv(DATA_PATH)
    sample = df.loc[df["cycle"].isin(TEST_CYCLES), MODEL_FEATURES + [TARGET]].sample(
        n=min(300, int(df["cycle"].isin(TEST_CYCLES).sum())), random_state=42
    )
    transformed = pipeline.named_steps["preprocessor"].transform(sample[MODEL_FEATURES])
    feature_names = pipeline.named_steps["preprocessor"].get_feature_names_out()
    display_names = [name.replace("numeric__", "").replace("categorical__", "") for name in feature_names]

    raw_values = shap.TreeExplainer(classifier).shap_values(transformed)
    if isinstance(raw_values, list):
        shap_values = raw_values[1]
    elif np.ndim(raw_values) == 3:
        shap_values = raw_values[:, :, 1]
    else:
        shap_values = raw_values

    importance = pd.DataFrame(
        {"feature": display_names, "mean_abs_shap": np.abs(shap_values).mean(axis=0)}
    ).sort_values("mean_abs_shap", ascending=False)
    importance.to_csv(REPORTS_DIR / "shap_global_importance.csv", index=False, encoding="utf-8-sig")

    top = importance.head(10).iloc[::-1]
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.barh(top["feature"], top["mean_abs_shap"], color="#2563eb")
    ax.set(xlabel="Mean |SHAP value|", title=f"Global explanation: {metadata['model_name']}")
    fig.tight_layout()
    fig.savefig(REPORTS_DIR / "shap_global_importance.png", dpi=180)
    plt.close(fig)
    print(importance.to_string(index=False))


if __name__ == "__main__":
    main()

