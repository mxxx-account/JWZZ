"""Train and evaluate leakage-safe DKD risk-screening models."""

import json
import warnings

import joblib
import matplotlib
# Training runs headlessly in CI/terminal environments; never require a desktop GUI.
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.calibration import calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

from config import (
    CATEGORICAL_FEATURES,
    DATA_PATH,
    MODELS_DIR,
    MODEL_FEATURES,
    NUMERIC_FEATURES,
    REPORTS_DIR,
    TARGET,
    TEST_CYCLES,
    TRAIN_CYCLES,
)

warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
RANDOM_STATE = 42


def build_preprocessor() -> ColumnTransformer:
    numeric = Pipeline(
        [("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]
    )
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )
    return ColumnTransformer(
        [("numeric", numeric, NUMERIC_FEATURES), ("categorical", categorical, CATEGORICAL_FEATURES)]
    )


def model_candidates() -> dict[str, tuple[object, dict[str, list[object]]]]:
    return {
        "logistic_regression": (
            LogisticRegression(max_iter=3000, random_state=RANDOM_STATE),
            {"classifier__C": [0.1, 1.0, 10.0]},
        ),
        "random_forest": (
            RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1),
            {
                "classifier__n_estimators": [300, 500],
                "classifier__max_depth": [5, None],
                "classifier__min_samples_leaf": [2, 5],
            },
        ),
        "xgboost": (
            XGBClassifier(
                objective="binary:logistic",
                eval_metric="logloss",
                random_state=RANDOM_STATE,
                n_jobs=1,
                tree_method="hist",
            ),
            {
                "classifier__n_estimators": [200, 400],
                "classifier__max_depth": [2, 3],
                "classifier__learning_rate": [0.03, 0.08],
                "classifier__subsample": [0.8],
            },
        ),
        "lightgbm": (
            LGBMClassifier(random_state=RANDOM_STATE, n_jobs=1, verbosity=-1),
            {
                "classifier__n_estimators": [200, 400],
                "classifier__num_leaves": [7, 15],
                "classifier__learning_rate": [0.03, 0.08],
                "classifier__min_child_samples": [20, 40],
            },
        ),
    }


def threshold_from_training_oof(model: Pipeline, x_train: pd.DataFrame, y_train: pd.Series, cv: StratifiedKFold) -> float:
    """Choose a threshold from training-only out-of-fold predictions (Youden J)."""
    oof_probability = cross_val_predict(model, x_train, y_train, cv=cv, method="predict_proba", n_jobs=1)[:, 1]
    fpr, tpr, thresholds = roc_curve(y_train, oof_probability)
    return float(thresholds[np.argmax(tpr - fpr)])


def plot_curves(results: list[dict[str, object]], y_test: pd.Series) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    for item in results:
        fpr, tpr, _ = roc_curve(y_test, item["probability"])
        ax.plot(fpr, tpr, label=f"{item['name']} (AUC={item['test_roc_auc']:.3f})")
    ax.plot([0, 1], [0, 1], "--", color="gray")
    ax.set(xlabel="False positive rate", ylabel="True positive rate", title="Held-out test ROC curves")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(REPORTS_DIR / "test_roc_curves.png", dpi=180)
    plt.close(fig)


def plot_calibration(best: dict[str, object], y_test: pd.Series) -> None:
    observed, predicted = calibration_curve(y_test, best["probability"], n_bins=8, strategy="quantile")
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], "--", color="gray", label="Perfect calibration")
    ax.plot(predicted, observed, "o-", label=best["name"])
    ax.set(xlabel="Predicted probability", ylabel="Observed frequency", title="Held-out test calibration")
    ax.legend()
    fig.tight_layout()
    fig.savefig(REPORTS_DIR / "best_model_calibration.png", dpi=180)
    plt.close(fig)


def main() -> None:
    REPORTS_DIR.mkdir(exist_ok=True)
    MODELS_DIR.mkdir(exist_ok=True)
    df = pd.read_csv(DATA_PATH)

    required = set(MODEL_FEATURES + [TARGET, "cycle"])
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Dataset misses columns: {sorted(missing)}")

    train = df.loc[df["cycle"].isin(TRAIN_CYCLES)].copy()
    test = df.loc[df["cycle"].isin(TEST_CYCLES)].copy()
    if train.empty or test.empty:
        raise ValueError("Time-based train/test split is empty. Check cycle values.")

    x_train, y_train = train[MODEL_FEATURES], train[TARGET].astype(int)
    x_test, y_test = test[MODEL_FEATURES], test[TARGET].astype(int)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    results: list[dict[str, object]] = []

    for name, (classifier, grid) in model_candidates().items():
        pipeline = Pipeline([("preprocessor", build_preprocessor()), ("classifier", classifier)])
        search = GridSearchCV(pipeline, grid, scoring="roc_auc", cv=cv, n_jobs=1, refit=True)
        search.fit(x_train, y_train)
        best_pipeline = search.best_estimator_
        threshold = threshold_from_training_oof(best_pipeline, x_train, y_train, cv)
        probability = best_pipeline.predict_proba(x_test)[:, 1]
        predicted = (probability >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_test, predicted, labels=[0, 1]).ravel()
        results.append(
            {
                "name": name,
                "cv_roc_auc": float(search.best_score_),
                "test_roc_auc": float(roc_auc_score(y_test, probability)),
                "test_pr_auc": float(average_precision_score(y_test, probability)),
                "brier_score": float(brier_score_loss(y_test, probability)),
                "threshold": threshold,
                "sensitivity": float(recall_score(y_test, predicted)),
                "specificity": float(tn / (tn + fp)),
                "precision": float(precision_score(y_test, predicted, zero_division=0)),
                "true_negative": int(tn),
                "false_positive": int(fp),
                "false_negative": int(fn),
                "true_positive": int(tp),
                "best_parameters": json.dumps(search.best_params_, ensure_ascii=False),
                "model": best_pipeline,
                "probability": probability,
            }
        )
        print(f"Finished {name}: test AUC={results[-1]['test_roc_auc']:.3f}")

    summary = pd.DataFrame([{k: v for k, v in item.items() if k not in {"model", "probability"}} for item in results])
    summary.to_csv(REPORTS_DIR / "model_comparison.csv", index=False, encoding="utf-8-sig")
    plot_curves(results, y_test)

    # Choose by cross-validation only; the test set is then used for final reporting.
    best = max(results, key=lambda item: item["cv_roc_auc"])
    plot_calibration(best, y_test)
    joblib.dump(best["model"], MODELS_DIR / "dkd_risk_model.joblib")
    metadata = {
        "model_name": best["name"],
        "model_version": "0.1.0",
        "feature_names": MODEL_FEATURES,
        "excluded_leakage_columns": ["UACR", "eGFR", "serum_creatinine"],
        "threshold": best["threshold"],
        "training_cycles": sorted(TRAIN_CYCLES),
        "test_cycles": sorted(TEST_CYCLES),
        "metrics": {k: v for k, v in best.items() if k not in {"model", "probability", "best_parameters"}},
        "safety_notice": "Research screening prototype only; not for diagnosis or treatment decisions.",
    }
    (MODELS_DIR / "model_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nSelected model:", best["name"])
    print(summary.drop(columns=["best_parameters"]).to_string(index=False))


if __name__ == "__main__":
    main()
