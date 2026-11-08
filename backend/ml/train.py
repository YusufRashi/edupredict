"""Train, compare, evaluate and save the EduPredict models.

Run from backend/:  python -m ml.train

Discipline used to keep the reported numbers honest:
  * Hyperparameters are tuned by cross-validation on the training split only.
  * Algorithms are compared, and thresholds tuned, on the validation split.
  * The test split scores only the chosen model, plus two clearly labelled
    reference points (a baseline and a full-feature benchmark). It never
    influences a choice.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import GridSearchCV, GroupKFold, StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from ml.config import (
    ARTIFACT_DIR,
    AUDIT_GROUPS,
    CATEGORICAL_FEATURES,
    DATASET_INFO,
    EXCLUDED_FEATURES,
    FEATURE_SPECS,
    LIMITATIONS,
    PASS_MARK,
    PIPELINE_VERSION,
    RANDOM_STATE,
    STAGES,
    TARGET_DESCRIPTION,
    Stage,
)
from ml.data import Splits, dataset_sha256, group_split, load_clean

R = RANDOM_STATE

CLASSIFIERS: dict[str, tuple[Any, dict]] = {
    "Logistic Regression": (
        LogisticRegression(max_iter=2000, random_state=R),
        {"model__C": [0.01, 0.1, 1, 10]},
    ),
    "Decision Tree": (
        DecisionTreeClassifier(random_state=R),
        {"model__max_depth": [2, 3, 5, 8], "model__min_samples_leaf": [5, 20]},
    ),
    "Random Forest": (
        RandomForestClassifier(n_estimators=200, random_state=R),
        {"model__max_depth": [4, 8, None], "model__min_samples_leaf": [2, 10]},
    ),
    "Gradient Boosting": (
        GradientBoostingClassifier(random_state=R),
        {"model__n_estimators": [50, 150], "model__learning_rate": [0.03, 0.1],
         "model__max_depth": [2, 3]},
    ),
}

REGRESSORS: dict[str, tuple[Any, dict]] = {
    "Ridge Regression": (Ridge(random_state=R), {"model__alpha": [0.1, 1, 10, 100]}),
    "Decision Tree": (
        DecisionTreeRegressor(random_state=R),
        {"model__max_depth": [2, 3, 5, 8], "model__min_samples_leaf": [5, 20]},
    ),
    "Random Forest": (
        RandomForestRegressor(n_estimators=200, random_state=R),
        {"model__max_depth": [4, 8, None], "model__min_samples_leaf": [2, 10]},
    ),
    "Gradient Boosting": (
        GradientBoostingRegressor(random_state=R),
        {"model__n_estimators": [50, 150], "model__learning_rate": [0.03, 0.1],
         "model__max_depth": [2, 3]},
    ),
}


def rnd(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def make_pipeline(estimator, numeric: list[str], categorical: list[str]) -> Pipeline:
    preprocess = ColumnTransformer(
        [
            ("numeric", StandardScaler(), numeric),
            ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False),
             categorical),
        ]
    )
    return Pipeline([("preprocess", preprocess), ("model", estimator)])


def classification_metrics(y_true, probabilities, threshold: float) -> dict:
    predicted = (probabilities >= threshold).astype(int)
    return {
        "accuracy": rnd(accuracy_score(y_true, predicted)),
        "precision": rnd(precision_score(y_true, predicted, zero_division=0)),
        "recall": rnd(recall_score(y_true, predicted, zero_division=0)),
        "f1": rnd(f1_score(y_true, predicted, zero_division=0)),
        "roc_auc": rnd(roc_auc_score(y_true, probabilities)),
        "pr_auc": rnd(average_precision_score(y_true, probabilities)),
        "brier": rnd(brier_score_loss(y_true, probabilities)),
    }


def regression_metrics(y_true, predicted) -> dict:
    mse = mean_squared_error(y_true, predicted)
    return {
        "mae": rnd(mean_absolute_error(y_true, predicted)),
        "mse": rnd(mse),
        "rmse": rnd(np.sqrt(mse)),
        "r2": rnd(r2_score(y_true, predicted)),
    }


def tune_threshold(y_true, probabilities) -> float:
    """Threshold maximising F1 on validation data. Ties go to the lower one (more recall)."""
    best_threshold, best_f1 = 0.5, -1.0
    # Search rounded values, so the saved threshold is exactly the one that was scored.
    for threshold in np.round(np.arange(0.05, 0.91, 0.01), 2):
        score = f1_score(y_true, (probabilities >= threshold).astype(int), zero_division=0)
        if score > best_f1 + 1e-9:
            best_threshold, best_f1 = float(threshold), float(score)
    return best_threshold


def band_outcomes(y_true, probabilities, moderate: float, high: float) -> list[dict]:
    """What actually happened to test students placed in each risk band."""
    y_true = np.asarray(y_true)
    rows = []
    for level, low, top in [("low", 0.0, moderate), ("moderate", moderate, high),
                            ("high", high, 1.01)]:
        mask = (probabilities >= low) & (probabilities < top)
        rows.append({
            "level": level,
            "students": int(mask.sum()),
            "observed_below_pass_rate": rnd(y_true[mask].mean()) if mask.any() else None,
        })
    return rows


def fairness_audit(test: pd.DataFrame, probabilities, predicted_grades, threshold: float) -> list:
    """Compare error rates by group on held-out data. These columns are never model inputs."""
    predicted = probabilities >= threshold
    y_true = test["at_risk"].to_numpy().astype(bool)
    errors = np.abs(test["G3"].to_numpy() - predicted_grades)
    results = []
    for attribute, labels in AUDIT_GROUPS.items():
        groups = []
        for value, label in labels.items():
            mask = (test[attribute] == value).to_numpy()
            n = int(mask.sum())
            if n == 0:
                continue
            positives = int(y_true[mask].sum())
            negatives = n - positives
            true_pos = int((predicted & y_true & mask).sum())
            false_pos = int((predicted & ~y_true & mask).sum())
            flagged = int((predicted & mask).sum())
            groups.append({
                "group": label,
                "n": n,
                "actual_below_pass": positives,
                "actual_below_pass_rate": rnd(positives / n),
                "flagged_rate": rnd(flagged / n),
                "recall": rnd(true_pos / positives) if positives else None,
                "false_positive_rate": rnd(false_pos / negatives) if negatives else None,
                "precision": rnd(true_pos / flagged) if flagged else None,
                "grade_mae": rnd(errors[mask].mean()),
                "small_sample": bool(positives < 30 or negatives < 30),
            })
        results.append({"attribute": attribute, "groups": groups})
    return results


def select_algorithm(candidates, stage: Stage, splits: Splits, target: str, scoring: str,
                     higher_is_better: bool, cv) -> tuple[str, list[dict], dict]:
    """Tune each algorithm by CV on train, then compare them all on validation."""
    numeric, categorical = stage.numeric_features, CATEGORICAL_FEATURES
    columns = stage.features
    X_train, y_train = splits.train[columns], splits.train[target]
    X_val, y_val = splits.validation[columns], splits.validation[target]
    groups = splits.train["student_group"]

    fitted: dict[str, Any] = {}
    rows: list[dict] = []
    for name, (estimator, grid) in candidates.items():
        search = GridSearchCV(make_pipeline(estimator, numeric, categorical), grid,
                              scoring=scoring, cv=cv, n_jobs=-1, refit=True)
        search.fit(X_train, y_train, groups=groups)
        best = search.best_estimator_
        fitted[name] = best
        sign = 1 if higher_is_better else -1
        best_index = search.best_index_
        row = {
            "algorithm": name,
            "best_params": {k.removeprefix("model__"): v for k, v in search.best_params_.items()},
            "cv_mean": rnd(sign * search.cv_results_["mean_test_score"][best_index]),
            "cv_std": rnd(search.cv_results_["std_test_score"][best_index]),
        }
        if higher_is_better:
            probabilities = best.predict_proba(X_val)[:, 1]
            row["validation"] = classification_metrics(y_val, probabilities, 0.5)
            row["selection_score"] = row["validation"]["pr_auc"]
        else:
            row["validation"] = regression_metrics(y_val, best.predict(X_val))
            row["selection_score"] = row["validation"]["rmse"]
        rows.append(row)

    chooser = max if higher_is_better else min
    selected = chooser(rows, key=lambda r: r["selection_score"])["algorithm"]
    for row in rows:
        row["selected"] = row["algorithm"] == selected
    return selected, rows, fitted


def all_feature_benchmark(estimator, splits: Splits, target: str, stage: Stage, dev: pd.DataFrame):
    """Fit the same algorithm with excluded columns too, to measure what exclusion costs.

    Scored for the report only: this variant is never saved or served.
    """
    extra_numeric = ["age", "Medu", "Fedu", "traveltime", "famrel", "freetime",
                     "goout", "Dalc", "Walc", "health"]
    extra_categorical = ["sex", "address", "famsize", "Pstatus", "Mjob", "Fjob", "guardian",
                         "famsup", "paid", "internet", "nursery", "romantic", "school", "reason"]
    numeric = stage.numeric_features + extra_numeric
    categorical = CATEGORICAL_FEATURES + extra_categorical
    pipeline = make_pipeline(clone(estimator.named_steps["model"]), numeric, categorical)
    pipeline.fit(dev[numeric + categorical], dev[target])
    return pipeline, splits.test[numeric + categorical]


def train_stage(stage: Stage, splits: Splits) -> tuple[dict, Any, Any]:
    columns = stage.features
    dev = pd.concat([splits.train, splits.validation], ignore_index=True)
    X_val = splits.validation[columns]
    X_test = splits.test[columns]
    y_test_class = splits.test["at_risk"]
    y_test_grade = splits.test["G3"]

    # ---- Classifier: will the final grade fall below the pass mark? ----
    class_cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=R)
    selected_c, class_rows, fitted_c = select_algorithm(
        CLASSIFIERS, stage, splits, "at_risk", "average_precision", True, class_cv
    )
    threshold = tune_threshold(splits.validation["at_risk"],
                               fitted_c[selected_c].predict_proba(X_val)[:, 1])
    high_from = round(min(0.9, max(0.6, threshold + 0.15)), 2)

    classifier = clone(fitted_c[selected_c]).fit(dev[columns], dev["at_risk"])
    test_probabilities = classifier.predict_proba(X_test)[:, 1]
    predicted = (test_probabilities >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test_class, predicted, labels=[0, 1]).ravel()
    fpr, tpr, _ = roc_curve(y_test_class, test_probabilities)
    keep = np.unique(np.linspace(0, len(fpr) - 1, min(len(fpr), 60)).astype(int))
    prob_true, prob_pred = calibration_curve(y_test_class, test_probabilities, n_bins=8,
                                             strategy="quantile")

    baseline_c = DummyClassifier(strategy="prior").fit(dev[columns], dev["at_risk"])
    benchmark_c, X_bench_c = all_feature_benchmark(
        fitted_c[selected_c], splits, "at_risk", stage, dev
    )

    importance = permutation_importance(
        classifier, X_test, y_test_class, scoring="average_precision",
        n_repeats=30, random_state=R,
    )
    importances = sorted(
        ({"feature": name, "label": FEATURE_SPECS[name].label,
          "importance": rnd(importance.importances_mean[i]),
          "std": rnd(importance.importances_std[i])} for i, name in enumerate(columns)),
        key=lambda item: item["importance"], reverse=True,
    )

    # ---- Regressor: what will the final grade be? ----
    grade_cv = GroupKFold(n_splits=5, shuffle=True, random_state=R)
    selected_r, grade_rows, fitted_r = select_algorithm(
        REGRESSORS, stage, splits, "G3", "neg_root_mean_squared_error", False, grade_cv
    )
    validation_errors = np.abs(splits.validation["G3"] - fitted_r[selected_r].predict(X_val))
    half_width = rnd(np.quantile(validation_errors, 0.8), 2)

    regressor = clone(fitted_r[selected_r]).fit(dev[columns], dev["G3"])
    test_grades = np.clip(regressor.predict(X_test), 0, 20)
    within = float((np.abs(y_test_grade - test_grades) <= half_width).mean())
    nonzero = (y_test_grade > 0).to_numpy()

    baseline_r = DummyRegressor(strategy="mean").fit(dev[columns], dev["G3"])
    benchmark_r, X_bench_r = all_feature_benchmark(fitted_r[selected_r], splits, "G3", stage, dev)

    reference = {
        name: (int(dev[name].median()) if name in stage.numeric_features
               else str(dev[name].mode().iloc[0]))
        for name in columns
    }
    sample = np.random.default_rng(R).permutation(len(y_test_grade))[:250]

    info = {
        "label": stage.label,
        "description": stage.description,
        "features": columns,
        "reference_profile": reference,
        "classifier": {
            "algorithm": selected_c,
            "selection_metric": "pr_auc on the validation split",
            "best_params": next(r["best_params"] for r in class_rows if r["selected"]),
            "comparison": class_rows,
            "risk_bands": {"moderate_from": threshold, "high_from": high_from},
            "test": classification_metrics(y_test_class, test_probabilities, threshold),
            "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "roc_curve": [{"fpr": rnd(fpr[i]), "tpr": rnd(tpr[i])} for i in keep],
            "calibration": [{"predicted": rnd(p), "observed": rnd(o)}
                            for p, o in zip(prob_pred, prob_true, strict=False)],
            "band_outcomes": band_outcomes(y_test_class, test_probabilities, threshold, high_from),
            "baseline_test": classification_metrics(
                y_test_class, baseline_c.predict_proba(X_test)[:, 1], threshold),
            "all_features_benchmark_test": classification_metrics(
                y_test_class, benchmark_c.predict_proba(X_bench_c)[:, 1], threshold),
            "feature_importance": importances,
        },
        "regressor": {
            "algorithm": selected_r,
            "selection_metric": "rmse on the validation split",
            "best_params": next(r["best_params"] for r in grade_rows if r["selected"]),
            "comparison": grade_rows,
            "interval_half_width_80": half_width,
            "test": regression_metrics(y_test_grade, test_grades),
            "test_excluding_zero_finals": regression_metrics(y_test_grade[nonzero],
                                                             test_grades[nonzero]),
            "interval_coverage_test": rnd(within),
            "baseline_test": regression_metrics(y_test_grade, baseline_r.predict(X_test)),
            "all_features_benchmark_test": regression_metrics(
                y_test_grade, np.clip(benchmark_r.predict(X_bench_r), 0, 20)),
            "actual_vs_predicted": [
                {"actual": int(y_test_grade.iloc[i]), "predicted": rnd(test_grades[i], 2)}
                for i in sample
            ],
        },
        "fairness": fairness_audit(splits.test, test_probabilities, test_grades, threshold),
    }
    return info, classifier, regressor


def sha256_file(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> dict:
    frame, cleaning = load_clean()
    splits = group_split(frame)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    data_sha = dataset_sha256()
    trained_at = datetime.now(UTC).replace(microsecond=0)
    stages: dict[str, dict] = {}
    for key, stage in STAGES.items():
        print(f"Training stage: {key}", flush=True)
        info, classifier, regressor = train_stage(stage, splits)
        for task, model in (("classifier", classifier), ("regressor", regressor)):
            path = ARTIFACT_DIR / f"{key}_{task}.joblib"
            joblib.dump(model, path, compress=3)
            info[task]["artifact"] = path.name
            info[task]["artifact_sha256"] = sha256_file(path)
        stages[key] = info

    metadata = {
        "version": f"{PIPELINE_VERSION}+{data_sha[:8]}.{trained_at:%Y%m%d%H%M%S}",
        "pipeline_version": PIPELINE_VERSION,
        "trained_at": trained_at.isoformat(),
        "dataset": {
            **DATASET_INFO,
            "sha256": data_sha,
            "cleaning": vars(cleaning),
            "splits": splits.summary(),
            "split_method": "Stratified group split (about 60/20/20) by student identity key.",
        },
        "target": {
            "description": TARGET_DESCRIPTION,
            "pass_mark": PASS_MARK,
            "positive_class": f"G3 below {PASS_MARK}",
        },
        "feature_policy": {
            "excluded": EXCLUDED_FEATURES,
            "specs": {
                name: {"label": s.label, "kind": s.kind, "help": s.help, "minimum": s.minimum,
                       "maximum": s.maximum, "choices": list(s.choices)}
                for name, s in FEATURE_SPECS.items()
            },
        },
        "limitations": LIMITATIONS,
        "stages": stages,
    }
    path = ARTIFACT_DIR / "metadata.json"
    path.write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")
    print(f"Saved artifacts to {ARTIFACT_DIR} (version {metadata['version']})")

    from ml.report import write_report  # local import: plotting is not needed for serving
    write_report(metadata)
    return metadata


if __name__ == "__main__":
    main()
