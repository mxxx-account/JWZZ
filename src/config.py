from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = PROJECT_ROOT / "nhanes_dkd_dataset.csv"
REPORTS_DIR = PROJECT_ROOT / "reports"
MODELS_DIR = PROJECT_ROOT / "models"

TARGET = "DKD"
TRAIN_CYCLES = {"2011-2012", "2013-2014", "2015-2016"}
TEST_CYCLES = {"2017-2018", "2017-2020"}

# These are the only fields that the first desktop client may send to the model.
NUMERIC_FEATURES = [
    "age",
    "HbA1c",
    "diabetes_duration",
    "systolic_bp",
    "diastolic_bp",
    "total_cholesterol",
    "triglycerides",
    "HDL",
    "glucose",
    "uric_acid",
]
CATEGORICAL_FEATURES = ["gender"]
MODEL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# They must never be passed to the prediction model.
LEAKAGE_COLUMNS = ["UACR", "eGFR", "serum_creatinine"]

