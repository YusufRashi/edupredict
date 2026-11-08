"""Reusable inference pipeline.

Each saved model is a complete scikit-learn Pipeline, so preprocessing fitted at
training time is applied here automatically. There is no second copy of the
preprocessing logic to keep in sync.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from ml.config import ARTIFACT_DIR, FEATURE_SPECS, PASS_MARK, STAGES


class ModelUnavailableError(RuntimeError):
    """Artifacts are missing or failed their integrity check."""


class InvalidFeaturesError(ValueError):
    """Input does not match what the requested stage requires."""


@dataclass
class Contribution:
    feature: str
    label: str
    value: Any
    typical_value: Any
    effect: float  # change in risk probability compared with the typical value
    direction: str  # "raises_risk", "lowers_risk" or "neutral"


@dataclass
class PredictionResult:
    stage: str
    predicted_at_risk: bool
    risk_probability: float
    risk_level: str
    confidence: float
    predicted_grade: float
    grade_interval_low: float
    grade_interval_high: float
    contributions: list[Contribution]
    model_version: str
    classifier_algorithm: str
    regressor_algorithm: str

    def to_dict(self) -> dict:
        return asdict(self)


def validate_features(stage: str, features: dict[str, Any]) -> dict[str, Any]:
    """Return only the features this stage uses, or raise with every problem found."""
    if stage not in STAGES:
        raise InvalidFeaturesError(f"Unknown stage '{stage}'. Use one of: {', '.join(STAGES)}.")
    clean: dict[str, Any] = {}
    errors: list[str] = []
    for name in STAGES[stage].features:
        spec = FEATURE_SPECS[name]
        value = features.get(name)
        if value is None or value == "":
            errors.append(f"{spec.label} is required for this stage.")
        elif spec.kind == "choice":
            if value not in spec.choices:
                errors.append(f"{spec.label} must be one of: {', '.join(spec.choices)}.")
            else:
                clean[name] = value
        else:
            if isinstance(value, bool) or int(value) != value:
                errors.append(f"{spec.label} must be a whole number.")
            elif not spec.minimum <= value <= spec.maximum:
                errors.append(f"{spec.label} must be between {spec.minimum} and {spec.maximum}.")
            else:
                clean[name] = int(value)
    if errors:
        raise InvalidFeaturesError(" ".join(errors))
    return clean


class PredictionPipeline:
    def __init__(self, artifact_dir: Path | str = ARTIFACT_DIR):
        self.artifact_dir = Path(artifact_dir)
        metadata_path = self.artifact_dir / "metadata.json"
        if not metadata_path.exists():
            raise ModelUnavailableError(
                f"No trained model at {self.artifact_dir}. Run: python -m ml.train"
            )
        self.metadata: dict = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.version: str = self.metadata["version"]
        self._models: dict[str, dict[str, Any]] = {}
        for stage, info in self.metadata["stages"].items():
            self._models[stage] = {
                task: self._load(info[task]["artifact"], info[task]["artifact_sha256"])
                for task in ("classifier", "regressor")
            }

    def _load(self, filename: str, expected_sha: str):
        path = self.artifact_dir / filename
        if not path.exists():
            raise ModelUnavailableError(f"Missing model artifact: {filename}")
        # joblib executes code on load, so only exact files from training are accepted.
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha:
            raise ModelUnavailableError(f"Integrity check failed for {filename}")
        return joblib.load(path)

    def _risk_level(self, stage: str, probability: float) -> str:
        bands = self.metadata["stages"][stage]["classifier"]["risk_bands"]
        if probability >= bands["high_from"]:
            return "high"
        if probability >= bands["moderate_from"]:
            return "moderate"
        return "low"

    def predict(self, stage: str, features: dict[str, Any]) -> PredictionResult:
        clean = validate_features(stage, features)
        info = self.metadata["stages"][stage]
        columns = STAGES[stage].features
        classifier = self._models[stage]["classifier"]
        regressor = self._models[stage]["regressor"]
        row = pd.DataFrame([clean], columns=columns)

        probability = float(classifier.predict_proba(row)[0, 1])
        threshold = info["classifier"]["risk_bands"]["moderate_from"]
        at_risk = probability >= threshold
        grade = float(min(20.0, max(0.0, regressor.predict(row)[0])))
        half_width = info["regressor"]["interval_half_width_80"]

        return PredictionResult(
            stage=stage,
            predicted_at_risk=bool(at_risk),
            risk_probability=round(probability, 4),
            risk_level=self._risk_level(stage, probability),
            confidence=round(max(probability, 1 - probability), 4),
            predicted_grade=round(grade, 2),
            grade_interval_low=round(max(0.0, grade - half_width), 2),
            grade_interval_high=round(min(20.0, grade + half_width), 2),
            contributions=self._contributions(classifier, clean, columns, probability, info),
            model_version=self.version,
            classifier_algorithm=info["classifier"]["algorithm"],
            regressor_algorithm=info["regressor"]["algorithm"],
        )

    @staticmethod
    def _contributions(classifier, clean, columns, probability, info) -> list[Contribution]:
        """Occlusion: swap each feature for its typical training value and re-score.

        Model-agnostic and simple to explain. Effects are local to this input, do not
        sum to the total, and describe the model's behaviour rather than causes.
        """
        reference = info["reference_profile"]
        variants = pd.DataFrame(
            [{**clean, name: reference[name]} for name in columns], columns=columns
        )
        scores = classifier.predict_proba(variants)[:, 1]
        items = []
        for name, score in zip(columns, scores, strict=False):
            effect = round(probability - float(score), 4)
            direction = (
                "neutral" if abs(effect) < 0.005 else "raises_risk" if effect > 0 else "lowers_risk"
            )
            items.append(Contribution(name, FEATURE_SPECS[name].label, clean[name],
                                      reference[name], effect, direction))
        return sorted(items, key=lambda item: abs(item.effect), reverse=True)


__all__ = [
    "Contribution", "InvalidFeaturesError", "ModelUnavailableError", "PASS_MARK",
    "PredictionPipeline", "PredictionResult", "validate_features",
]
