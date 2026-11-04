"""Local FastAPI service for the Electron desktop client.

It binds only to 127.0.0.1 and never persists submitted health information.
"""

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))
from config import MODELS_DIR, MODEL_FEATURES  # noqa: E402


class AssessmentInput(BaseModel):
    age: float = Field(ge=18, le=100)
    gender: Literal[1, 2]
    HbA1c: float = Field(ge=3, le=20)
    diabetes_duration: float = Field(ge=0, le=80)
    systolic_bp: float = Field(ge=70, le=260)
    diastolic_bp: float = Field(ge=35, le=160)
    total_cholesterol: float = Field(ge=50, le=600)
    triglycerides: float = Field(ge=20, le=2000)
    HDL: float = Field(ge=5, le=200)
    glucose: float = Field(ge=20, le=800)
    uric_acid: float = Field(ge=1, le=25)


class Factor(BaseModel):
    feature: str
    direction: Literal["增加模型风险", "降低模型风险"]
    contribution: float


class AssessmentResult(BaseModel):
    model_version: str
    risk_probability: float
    screening_threshold: float
    screening_flag: bool
    screening_message: str
    recommendation: str
    top_factors: list[Factor]
    disclaimer: str


DISPLAY_NAMES = {
    "age": "年龄",
    "HbA1c": "糖化血红蛋白",
    "diabetes_duration": "糖尿病病程",
    "systolic_bp": "收缩压",
    "diastolic_bp": "舒张压",
    "total_cholesterol": "总胆固醇",
    "triglycerides": "甘油三酯",
    "HDL": "高密度脂蛋白胆固醇",
    "glucose": "血糖",
    "uric_acid": "尿酸",
    "gender_1": "性别（编码 1）",
    "gender_2": "性别（编码 2）",
}


@lru_cache
def load_assets() -> tuple[object, dict, object]:
    model = joblib.load(MODELS_DIR / "dkd_risk_model.joblib")
    metadata = json.loads((MODELS_DIR / "model_metadata.json").read_text(encoding="utf-8"))
    classifier = model.named_steps["classifier"]
    explainer = shap.TreeExplainer(classifier)
    return model, metadata, explainer


def shap_contributions(model: object, explainer: object, row: pd.DataFrame) -> list[Factor]:
    transformed = model.named_steps["preprocessor"].transform(row)
    names = model.named_steps["preprocessor"].get_feature_names_out()
    names = [name.replace("numeric__", "").replace("categorical__", "") for name in names]
    values = explainer.shap_values(transformed)
    if isinstance(values, list):
        values = values[1]
    elif np.ndim(values) == 3:
        values = values[:, :, 1]
    contributions = values[0]
    selected = np.argsort(np.abs(contributions))[::-1][:3]
    return [
        Factor(
            feature=DISPLAY_NAMES.get(names[index], names[index]),
            direction="增加模型风险" if contributions[index] >= 0 else "降低模型风险",
            contribution=round(float(contributions[index]), 4),
        )
        for index in selected
    ]


app = FastAPI(title="DKD Risk Screening Engine", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict:
    _, metadata, _ = load_assets()
    return {"status": "ok", "model_version": metadata["model_version"]}


@app.post("/predict", response_model=AssessmentResult)
def predict(payload: AssessmentInput) -> AssessmentResult:
    model, metadata, explainer = load_assets()
    row = pd.DataFrame([payload.model_dump()], columns=MODEL_FEATURES)
    probability = float(model.predict_proba(row)[0, 1])
    threshold = float(metadata["threshold"])
    flag = probability >= threshold
    if flag:
        message = "本次模型筛查结果提示需关注。"
        recommendation = "建议携带近期体检结果咨询医生或专业医疗人员，并按其建议复查相关指标。"
    else:
        message = "本次模型筛查结果未达到预设关注阈值。"
        recommendation = "建议继续按医疗人员建议进行常规随访和体检；如有不适或既往异常结果，请及时咨询医生。"
    return AssessmentResult(
        model_version=metadata["model_version"],
        risk_probability=round(probability, 4),
        screening_threshold=round(threshold, 4),
        screening_flag=flag,
        screening_message=message,
        recommendation=recommendation,
        top_factors=shap_contributions(model, explainer, row),
        disclaimer="本工具仅用于科研原型和风险筛查，不能替代医生诊断、处方或治疗决策。",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
