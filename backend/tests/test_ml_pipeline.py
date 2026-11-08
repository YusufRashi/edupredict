"""Tests for data handling, leakage prevention, inference and metric honesty."""

import json
import shutil

import numpy as np
import pandas as pd
import pytest

from ml.config import ARTIFACT_DIR, EXCLUDED_FEATURES, GRADE_COLUMNS, STAGES
from ml.data import (
    EXPECTED_COLUMNS,
    Splits,
    assert_no_group_overlap,
    clean,
    group_split,
    load_clean,
    load_raw,
)
from ml.predict import (
    InvalidFeaturesError,
    ModelUnavailableError,
    PredictionPipeline,
    validate_features,
)
from ml.train import classification_metrics, regression_metrics, tune_threshold

FEATURES = {"subject": "math", "studytime": 2, "failures": 0, "absences": 4, "schoolsup": "no",
            "activities": "yes", "higher": "yes", "G1": 12, "G2": 13}


@pytest.fixture(scope="module")
def frame():
    return load_clean()[0]


@pytest.fixture(scope="module")
def splits(frame):
    return group_split(frame)


@pytest.fixture(scope="module")
def pipeline():
    return PredictionPipeline(ARTIFACT_DIR)


class TestDataCleaning:
    def test_loads_every_row_of_both_courses(self):
        raw = load_raw()
        assert (raw["subject"] == "math").sum() == 395
        assert (raw["subject"] == "portuguese").sum() == 649

    def test_report_describes_the_real_data(self):
        _, report = load_clean()
        assert report.missing_values == 0
        assert report.rows_after_cleaning == 1044
        assert report.groups_in_both_subjects > 300

    def test_removes_duplicates_and_out_of_range_rows(self):
        raw = load_raw().head(20)
        bad = raw.iloc[[0]].copy()
        bad["G3"] = 25
        cleaned, report = clean(pd.concat([raw, raw.iloc[[1]], bad], ignore_index=True))
        assert report.exact_duplicates_removed == 1
        assert report.out_of_range_removed == 1
        assert len(cleaned) == 20

    def test_same_student_in_two_courses_is_not_a_duplicate(self):
        raw = load_raw().head(1)
        other_course = raw.copy()
        other_course["subject"] = "portuguese"
        cleaned, report = clean(pd.concat([raw, other_course], ignore_index=True))
        assert len(cleaned) == 2
        assert report.groups_in_both_subjects == 1

    def test_at_risk_means_below_pass_mark(self, frame):
        assert ((frame["G3"] < 10) == frame["at_risk"].astype(bool)).all()


class TestLeakagePrevention:
    def test_no_student_group_crosses_a_split(self, splits):
        assert_no_group_overlap(splits)

    def test_overlap_check_really_detects_leakage(self, splits):
        leaky = Splits(splits.train, splits.validation, splits.train.head(3))
        with pytest.raises(ValueError, match="leakage"):
            assert_no_group_overlap(leaky)

    def test_split_uses_every_row_once_at_about_60_20_20(self, frame, splits):
        assert len(splits.train) + len(splits.validation) + len(splits.test) == len(frame)
        assert len(splits.test) / len(frame) == pytest.approx(0.2, abs=0.03)
        assert len(splits.validation) / len(frame) == pytest.approx(0.2, abs=0.03)

    def test_split_is_deterministic(self, frame, splits):
        again = group_split(frame)
        assert list(again.test["student_group"]) == list(splits.test["student_group"])

    def test_final_grade_is_never_a_feature(self):
        for stage in STAGES.values():
            assert "G3" not in stage.features
            assert "at_risk" not in stage.features

    def test_each_stage_only_sees_grades_that_would_exist(self):
        assert not set(GRADE_COLUMNS) & set(STAGES["intake"].features)
        assert "G1" in STAGES["period1"].features and "G2" not in STAGES["period1"].features
        assert {"G1", "G2"} <= set(STAGES["period2"].features)

    def test_excluded_columns_are_never_features(self):
        for stage in STAGES.values():
            assert not set(EXCLUDED_FEATURES) & set(stage.features)

    def test_feature_policy_accounts_for_every_raw_column(self):
        used = {f for stage in STAGES.values() for f in stage.features}
        assert set(EXPECTED_COLUMNS) - {"G3"} <= used | set(EXCLUDED_FEATURES)


class TestValidation:
    def test_keeps_only_features_for_the_stage(self):
        assert "G1" not in validate_features("intake", FEATURES)

    def test_requires_grades_for_later_stage(self):
        with pytest.raises(InvalidFeaturesError, match="First period grade"):
            validate_features("period1", {k: v for k, v in FEATURES.items() if k != "G1"})

    @pytest.mark.parametrize("field,value", [("G1", 21), ("G1", -1), ("studytime", 9),
                                             ("subject", "history"), ("G1", 3.5), ("G1", True)])
    def test_rejects_bad_values(self, field, value):
        with pytest.raises(InvalidFeaturesError):
            validate_features("period2", {**FEATURES, field: value})

    def test_unknown_stage(self):
        with pytest.raises(InvalidFeaturesError, match="Unknown stage"):
            validate_features("final", FEATURES)


class TestInference:
    @pytest.mark.parametrize("stage", list(STAGES))
    def test_output_is_well_formed(self, pipeline, stage):
        result = pipeline.predict(stage, FEATURES)
        assert 0 <= result.risk_probability <= 1
        assert result.confidence == pytest.approx(
            max(result.risk_probability, 1 - result.risk_probability), abs=1e-3)
        assert 0 <= result.grade_interval_low <= result.predicted_grade
        assert result.predicted_grade <= result.grade_interval_high <= 20
        assert result.risk_level in {"low", "moderate", "high"}
        assert {c.feature for c in result.contributions} == set(STAGES[stage].features)

    def test_much_lower_grades_raise_risk(self, pipeline):
        strong = pipeline.predict("period2", {**FEATURES, "G1": 17, "G2": 17})
        weak = pipeline.predict("period2", {**FEATURES, "G1": 5, "G2": 5})
        assert weak.risk_probability > strong.risk_probability
        assert weak.predicted_grade < strong.predicted_grade
        assert weak.risk_level != "low"
        assert strong.risk_level == "low"

    def test_contributions_explain_low_grades(self, pipeline):
        result = pipeline.predict("period2", {**FEATURES, "G1": 5, "G2": 5})
        top = result.contributions[0]
        assert top.feature in {"G1", "G2"}
        assert top.direction == "raises_risk"

    def test_extra_inputs_are_ignored_not_used(self, pipeline):
        base = pipeline.predict("period1", FEATURES)
        extra = pipeline.predict("period1", {**FEATURES, "sex": "F", "G2": 0})
        assert base.risk_probability == extra.risk_probability

    def test_missing_artifacts_raise_clear_error(self, tmp_path):
        with pytest.raises(ModelUnavailableError, match="ml.train"):
            PredictionPipeline(tmp_path)

    def test_tampered_model_is_rejected(self, tmp_path):
        for item in ARTIFACT_DIR.iterdir():
            if item.is_file():
                shutil.copy(item, tmp_path / item.name)
        with (tmp_path / "intake_classifier.joblib").open("ab") as handle:
            handle.write(b"tampered")
        with pytest.raises(ModelUnavailableError, match="Integrity"):
            PredictionPipeline(tmp_path)


class TestMetricsAreReal:
    """Rebuild each saved number from saved models and held-out rows."""

    @pytest.mark.parametrize("stage", list(STAGES))
    def test_saved_metrics_match_recomputation(self, pipeline, splits, stage):
        info = pipeline.metadata["stages"][stage]
        test = splits.test
        columns = STAGES[stage].features
        models = pipeline._models[stage]

        probabilities = models["classifier"].predict_proba(test[columns])[:, 1]
        threshold = info["classifier"]["risk_bands"]["moderate_from"]
        recomputed = classification_metrics(test["at_risk"], probabilities, threshold)
        assert recomputed == pytest.approx(info["classifier"]["test"], abs=1e-3)

        grades = np.clip(models["regressor"].predict(test[columns]), 0, 20)
        assert regression_metrics(test["G3"], grades) == pytest.approx(
            info["regressor"]["test"], abs=1e-3)

    def test_models_beat_the_no_information_baseline(self, pipeline):
        for info in pipeline.metadata["stages"].values():
            classifier = info["classifier"]
            assert classifier["test"]["pr_auc"] > classifier["baseline_test"]["pr_auc"]
            assert info["regressor"]["test"]["rmse"] < info["regressor"]["baseline_test"]["rmse"]

    def test_metadata_states_no_dropout_claim(self, pipeline):
        text = json.dumps(pipeline.metadata["target"]).lower()
        assert "neither predicts dropout" in text

    def test_all_four_algorithms_were_compared(self, pipeline):
        for info in pipeline.metadata["stages"].values():
            assert len(info["classifier"]["comparison"]) == 4
            assert sum(r["selected"] for r in info["classifier"]["comparison"]) == 1


class TestThreshold:
    def test_tune_threshold_finds_separating_value(self):
        y = np.array([0, 0, 0, 1, 1, 1])
        p = np.array([0.1, 0.2, 0.3, 0.7, 0.8, 0.9])
        assert 0.3 < tune_threshold(y, p) <= 0.7
