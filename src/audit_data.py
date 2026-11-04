"""Read-only audit of the supplied modelling dataset."""

import json

import pandas as pd

from config import DATA_PATH, LEAKAGE_COLUMNS, REPORTS_DIR, TARGET


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {DATA_PATH}")

    REPORTS_DIR.mkdir(exist_ok=True)
    df = pd.read_csv(DATA_PATH)

    required = {"SEQN", "cycle", TARGET, "UACR", "eGFR", *LEAKAGE_COLUMNS}
    missing_columns = sorted(required - set(df.columns))
    if missing_columns:
        raise ValueError(f"Dataset misses required columns: {missing_columns}")
    if not set(df[TARGET].dropna().unique()).issubset({0, 1}):
        raise ValueError("DKD must be encoded as 0/1.")

    threshold_positive = (df["UACR"] >= 30) | (df["eGFR"] < 60)
    inconsistent = df.loc[df[TARGET].notna() & (df[TARGET].astype(int) != threshold_positive.astype(int))].copy()

    report = {
        "source_file": str(DATA_PATH),
        "rows": int(len(df)),
        "columns": list(df.columns),
        "duplicate_seqn": int(df["SEQN"].duplicated().sum()),
        "dkd_counts": {str(k): int(v) for k, v in df[TARGET].value_counts(dropna=False).sort_index().items()},
        "dkd_rate": float(df[TARGET].mean()),
        "missing_values": {k: int(v) for k, v in df.isna().sum().sort_values(ascending=False).items()},
        "cycles": {str(k): int(v) for k, v in df["cycle"].value_counts().sort_index().items()},
        "leakage_columns": LEAKAGE_COLUMNS,
        "uacr_egfr_rule_disagreements": int(len(inconsistent)),
        "audit_note": (
            "The DKD label does not exactly equal UACR >= 30 or eGFR < 60 for every row. "
            "Confirm the original label-generation rule before making clinical claims."
        ),
    }

    (REPORTS_DIR / "data_quality_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    df.isna().sum().sort_values(ascending=False).rename("missing_count").to_csv(
        REPORTS_DIR / "missing_values.csv", encoding="utf-8-sig"
    )
    inconsistent.to_csv(REPORTS_DIR / "label_rule_disagreements.csv", index=False, encoding="utf-8-sig")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

