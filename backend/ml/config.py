"""Single source of truth for what the models may see and predict.

Training, inference, the API schemas and the frontend form all derive from the
definitions here, so that the feature policy cannot drift between them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
RAW_DIR = ML_DIR / "data" / "raw"
REPORTS_DIR = ML_DIR / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"
ARTIFACT_DIR = Path(os.environ.get("MODEL_ARTIFACT_DIR", ML_DIR / "artifacts"))

RANDOM_STATE = 42
PASS_MARK = 10  # Portuguese 0-20 scale: a final grade of 10 or above is a pass.
PIPELINE_VERSION = "1.0.0"

DATASET_INFO = {
    "name": "Student Performance",
    "source": "UCI Machine Learning Repository, dataset 320",
    "url": "https://archive.ics.uci.edu/dataset/320/student+performance",
    "doi": "10.24432/C5TG7T",
    "licence": "CC BY 4.0",
    "citation": (
        "Cortez, P. & Silva, A. M. G. (2008). Using data mining to predict secondary "
        "school student performance. Proceedings of the 5th Future Business Technology "
        "Conference, 5-12."
    ),
    "context": (
        "Two Portuguese secondary schools (Gabriel Pereira and Mousinho da Silveira), "
        "Mathematics and Portuguese language courses, data collected 2005-2006."
    ),
}

RAW_FILES = {"math": "student-mat.csv", "portuguese": "student-por.csv"}

# The columns the dataset authors use to match one student across both course
# files (see student-merge.R in the UCI archive). The same key must never appear
# on both sides of a split, or the test set would contain "known" students.
IDENTITY_COLUMNS = [
    "school", "sex", "age", "address", "famsize", "Pstatus", "Medu", "Fedu",
    "Mjob", "Fjob", "reason", "nursery", "internet",
]

GRADE_COLUMNS = ["G1", "G2", "G3"]

NUMERIC_BASE_FEATURES = ["studytime", "failures", "absences"]
CATEGORICAL_FEATURES = ["subject", "schoolsup", "activities", "higher"]

# Every raw column deliberately kept out of the deployed models, and why.
EXCLUDED_FEATURES = {
    "sex": "Protected characteristic.",
    "age": "Protected characteristic.",
    "address": "Urban/rural home address: socio-economic and geographic proxy.",
    "famsize": "Family circumstance outside the student's control.",
    "Pstatus": "Parents' cohabitation status: family circumstance.",
    "Medu": "Mother's education: socio-economic proxy.",
    "Fedu": "Father's education: socio-economic proxy.",
    "Mjob": "Mother's job: socio-economic proxy.",
    "Fjob": "Father's job: socio-economic proxy.",
    "guardian": "Family circumstance.",
    "famsup": "Family support: family circumstance.",
    "famrel": "Quality of family relationships: private and family-related.",
    "paid": "Paid extra classes: reflects ability to pay.",
    "internet": "Home internet access: socio-economic proxy.",
    "nursery": "Nursery attendance: socio-economic proxy.",
    "romantic": "Private personal information.",
    "health": "Health status: sensitive personal information.",
    "Dalc": "Workday alcohol use: sensitive personal information.",
    "Walc": "Weekend alcohol use: sensitive personal information.",
    "freetime": "Private lifestyle information.",
    "goout": "Private lifestyle information.",
    "traveltime": "Home-to-school travel time: geographic proxy.",
    "school": "Specific to the two source schools; would not transfer elsewhere.",
    "reason": "Reason for choosing the school; not an academic measure.",
}


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    label: str
    kind: str  # "int" or "choice"
    help: str
    minimum: int | None = None
    maximum: int | None = None
    choices: tuple[str, ...] = ()


FEATURE_SPECS: dict[str, FeatureSpec] = {
    spec.name: spec
    for spec in [
        FeatureSpec("subject", "Subject", "choice", "Course being predicted.",
                    choices=("math", "portuguese")),
        FeatureSpec("studytime", "Weekly study time", "int",
                    "1: under 2h, 2: 2-5h, 3: 5-10h, 4: over 10h.", 1, 4),
        FeatureSpec("failures", "Past class failures", "int",
                    "Number of past class failures. Enter 3 for three or more.", 0, 3),
        FeatureSpec("absences", "School absences", "int", "Absences recorded so far.", 0, 93),
        FeatureSpec("schoolsup", "Extra school support", "choice",
                    "Currently receives extra educational support from the school.",
                    choices=("yes", "no")),
        FeatureSpec("activities", "Extracurricular activities", "choice",
                    "Takes part in extracurricular activities.", choices=("yes", "no")),
        FeatureSpec("higher", "Wants higher education", "choice",
                    "Student reports wanting to continue to higher education.",
                    choices=("yes", "no")),
        FeatureSpec("G1", "First period grade", "int", "Grade on the 0-20 scale.", 0, 20),
        FeatureSpec("G2", "Second period grade", "int", "Grade on the 0-20 scale.", 0, 20),
    ]
}


@dataclass(frozen=True)
class Stage:
    key: str
    label: str
    description: str
    grade_features: tuple[str, ...]

    @property
    def numeric_features(self) -> list[str]:
        return NUMERIC_BASE_FEATURES + list(self.grade_features)

    @property
    def features(self) -> list[str]:
        return self.numeric_features + CATEGORICAL_FEATURES


# Three models, because a grade may only be used once it would really exist.
# Each stage sees only what is known at that point in the school year.
STAGES: dict[str, Stage] = {
    "intake": Stage("intake", "Start of course",
                    "No grades yet. Uses only study habits, history and support.", ()),
    "period1": Stage("period1", "After first period",
                     "Adds the first period grade (G1).", ("G1",)),
    "period2": Stage("period2", "After second period",
                     "Adds both period grades (G1 and G2).", ("G1", "G2")),
}

# Columns used only to audit fairness on the held-out test set. Never model inputs.
AUDIT_GROUPS = {
    "sex": {"F": "Female", "M": "Male"},
    "address": {"U": "Urban", "R": "Rural"},
    "parental_education": {"higher": "Parent with secondary or higher education",
                           "lower": "Parents below secondary education"},
    "school": {"GP": "Gabriel Pereira", "MS": "Mousinho da Silveira"},
}

TARGET_DESCRIPTION = (
    "The classifier estimates the probability that a student's final grade in a course "
    f"(G3) will be below {PASS_MARK} out of 20, the pass mark in this dataset. The regressor "
    "estimates the final grade itself. Neither predicts dropout: the dataset has no dropout "
    "label, and a final grade of 0 does not establish that a student left school."
)

LIMITATIONS = [
    "Trained on two Portuguese secondary schools, 2005-2006. Results may not transfer to other "
    "countries, grading systems, age groups or decades without retraining and local validation.",
    "The models predict a final grade below the pass mark. They do not predict dropout, ability "
    "or potential.",
    "Associations are not causes. A listed contributing factor shows what moved this estimate, "
    "not why a student is struggling or what would change the outcome.",
    "Historical data can encode bias. Removing protected attributes does not remove it, because "
    "other inputs can act as proxies. See the fairness audit for measured differences by group.",
    "Some records have a final grade of 0 after a non-zero second period grade. The dataset does "
    "not explain them, and they make final grades harder to predict.",
    "Study time, activities and aspirations are self-reported and absences come from school "
    "records, so input quality varies.",
    "Fairness audit groups are small, so differences between groups have wide uncertainty.",
    "Predictions are decision support for educators and must never be the sole basis for a "
    "decision about a student.",
]
