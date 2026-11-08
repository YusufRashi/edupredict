"""Load, validate, clean and split the UCI Student Performance dataset."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from ml.config import (
    GRADE_COLUMNS,
    IDENTITY_COLUMNS,
    PASS_MARK,
    RANDOM_STATE,
    RAW_DIR,
    RAW_FILES,
)

EXPECTED_COLUMNS = [
    "school", "sex", "age", "address", "famsize", "Pstatus", "Medu", "Fedu", "Mjob", "Fjob",
    "reason", "guardian", "traveltime", "studytime", "failures", "schoolsup", "famsup", "paid",
    "activities", "nursery", "higher", "internet", "romantic", "famrel", "freetime", "goout",
    "Dalc", "Walc", "health", "absences", "G1", "G2", "G3",
]

VALID_RANGES = {
    "age": (15, 22), "studytime": (1, 4), "failures": (0, 4), "absences": (0, 93),
    "G1": (0, 20), "G2": (0, 20), "G3": (0, 20),
}


@dataclass
class CleaningReport:
    rows_by_subject: dict[str, int] = field(default_factory=dict)
    missing_values: int = 0
    exact_duplicates_removed: int = 0
    out_of_range_removed: int = 0
    rows_after_cleaning: int = 0
    distinct_student_groups: int = 0
    groups_in_both_subjects: int = 0
    zero_final_with_nonzero_g2: int = 0


def dataset_sha256(raw_dir: Path = RAW_DIR) -> str:
    digest = hashlib.sha256()
    for filename in sorted(RAW_FILES.values()):
        digest.update((raw_dir / filename).read_bytes())
    return digest.hexdigest()


def load_raw(raw_dir: Path = RAW_DIR) -> pd.DataFrame:
    frames = []
    for subject, filename in RAW_FILES.items():
        frame = pd.read_csv(raw_dir / filename, sep=";")
        missing = set(EXPECTED_COLUMNS) - set(frame.columns)
        if missing:
            raise ValueError(f"{filename} is missing columns: {sorted(missing)}")
        frame["subject"] = subject
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def clean(raw: pd.DataFrame) -> tuple[pd.DataFrame, CleaningReport]:
    """Return modelling-ready rows plus a report of everything that was done.

    Duplicates are only removed within a subject: the same student taking both
    courses is two legitimate rows, handled by grouping at split time instead.
    """
    report = CleaningReport(
        rows_by_subject={k: int(v) for k, v in raw["subject"].value_counts().items()},
        missing_values=int(raw[EXPECTED_COLUMNS].isna().sum().sum()),
    )
    frame = raw.dropna(subset=EXPECTED_COLUMNS)

    before = len(frame)
    frame = frame.drop_duplicates()
    report.exact_duplicates_removed = before - len(frame)

    before = len(frame)
    mask = np.ones(len(frame), dtype=bool)
    for column, (low, high) in VALID_RANGES.items():
        mask &= frame[column].between(low, high).to_numpy()
    frame = frame[mask].reset_index(drop=True)
    report.out_of_range_removed = before - len(frame)

    frame["student_group"] = frame[IDENTITY_COLUMNS].astype(str).agg("|".join, axis=1)
    frame["at_risk"] = (frame["G3"] < PASS_MARK).astype(int)
    frame["parental_education"] = np.where(
        frame[["Medu", "Fedu"]].max(axis=1) >= 3, "higher", "lower"
    )

    subjects_per_group = frame.groupby("student_group")["subject"].nunique()
    report.rows_after_cleaning = len(frame)
    report.distinct_student_groups = int(subjects_per_group.size)
    report.groups_in_both_subjects = int((subjects_per_group > 1).sum())
    report.zero_final_with_nonzero_g2 = int(((frame["G3"] == 0) & (frame["G2"] > 0)).sum())
    return frame, report


def load_clean() -> tuple[pd.DataFrame, CleaningReport]:
    return clean(load_raw())


@dataclass
class Splits:
    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame

    def summary(self) -> dict:
        out = {}
        for name in ("train", "validation", "test"):
            part: pd.DataFrame = getattr(self, name)
            out[name] = {
                "rows": len(part),
                "student_groups": int(part["student_group"].nunique()),
                "at_risk_rate": round(float(part["at_risk"].mean()), 4),
                "by_subject": {k: int(v) for k, v in part["subject"].value_counts().items()},
            }
        return out


def group_split(frame: pd.DataFrame) -> Splits:
    """Deterministic, roughly 60/20/20 split that keeps each student group together."""
    outer = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    dev_idx, test_idx = next(outer.split(frame, frame["at_risk"], frame["student_group"]))
    dev = frame.iloc[dev_idx]

    inner = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=RANDOM_STATE)
    train_idx, val_idx = next(inner.split(dev, dev["at_risk"], dev["student_group"]))

    splits = Splits(
        train=dev.iloc[train_idx].reset_index(drop=True),
        validation=dev.iloc[val_idx].reset_index(drop=True),
        test=frame.iloc[test_idx].reset_index(drop=True),
    )
    assert_no_group_overlap(splits)
    return splits


def assert_no_group_overlap(splits: Splits) -> None:
    train = set(splits.train["student_group"])
    validation = set(splits.validation["student_group"])
    test = set(splits.test["student_group"])
    if train & validation or train & test or validation & test:
        raise ValueError("A student group appears in more than one split (data leakage).")


__all__ = [
    "CleaningReport", "EXPECTED_COLUMNS", "GRADE_COLUMNS", "Splits", "assert_no_group_overlap",
    "clean", "dataset_sha256", "group_split", "load_clean", "load_raw",
]
