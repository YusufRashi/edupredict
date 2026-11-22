import pytest
from conftest import FEATURES
from sqlalchemy import select, update

from app.models import ModelVersion, Prediction, PredictionHistory
from app.services.predictions import get_pipeline, stage_for_record
from app.services.recommendations import build_recommendations
from ml.config import EXCLUDED_FEATURES


def predict(actor, **body):
    return actor.http.post("/api/predictions", json={"stage": "period2", "features": FEATURES,
                                                     **body})


def test_response_is_exactly_the_model_output(educator):
    response = predict(educator)
    assert response.status_code == 201
    body = response.json()
    direct = get_pipeline().predict("period2", FEATURES)
    assert body["risk_probability"] == direct.risk_probability
    assert body["risk_level"] == direct.risk_level
    assert body["predicted_grade"] == direct.predicted_grade
    assert body["confidence"] == direct.confidence
    assert body["classifier_algorithm"] == direct.classifier_algorithm
    assert body["model_version"] == get_pipeline().version


def test_response_explains_itself_and_states_limits(educator):
    body = predict(educator).json()
    assert {c["feature"] for c in body["contributions"]} == set(FEATURES)
    assert "not a judgment" in body["disclaimer"]
    assert body["is_demo"] is False
    assert body["history"][0]["action"] == "created"


def test_a_what_if_scenario_saves_no_recommendations(educator):
    body = predict(educator).json()
    assert body["student_id"] is None
    assert body["recommendations"] == []


def test_excluded_attributes_never_affect_or_appear_in_results(educator):
    base = predict(educator).json()
    sneaky = predict(educator, features={**FEATURES, "sex": "F", "Medu": 0, "age": 22}).json()
    assert base["risk_probability"] == sneaky["risk_probability"]
    assert not set(EXCLUDED_FEATURES) & set(sneaky["input_features"])


@pytest.mark.parametrize("stage,field,value", [
    ("period2", "G1", 25), ("period2", "subject", "history"), ("period2", "studytime", 0),
    ("period2", "absences", "lots"), ("period2", "failures", 4),
])
def test_invalid_features_get_422_with_a_useful_message(educator, stage, field, value):
    response = predict(educator, stage=stage, features={**FEATURES, field: value})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("grade,flagged,disagree", [
    (8.0, True, False), (12.0, False, False), (9.5, False, True), (10.0, True, True),
])
def test_reports_when_grade_and_flag_disagree(educator, db, grade, flagged, disagree):
    prediction_id = predict(educator).json()["id"]
    db.execute(update(Prediction).where(Prediction.id == prediction_id)
               .values(predicted_grade=grade, predicted_at_risk=flagged))
    db.commit()
    body = educator.http.get(f"/api/predictions/{prediction_id}").json()
    assert body["estimates_disagree"] is disagree
    assert body["pass_mark"] == 10


def test_later_stage_needs_its_grades(educator):
    missing = {k: v for k, v in FEATURES.items() if k != "G2"}
    assert predict(educator, stage="period2", features=missing).status_code == 422
    assert predict(educator, stage="period1", features=missing).status_code == 201


def test_unknown_stage_is_rejected(educator):
    assert predict(educator, stage="final").status_code == 422


def test_links_to_student_and_shows_actual_outcome(educator, make_student):
    student = make_student("P-1", final_grade=14)
    body = predict(educator, student_id=student["id"],
                   academic_record_id=student["record"]["id"]).json()
    assert body["student_code"] == "P-1"
    assert body["actual_final_grade"] == 14
    assert body["recommendations"]
    assert all(item["shared_with_student"] is False for item in body["recommendations"])


def test_unknown_student_and_mismatched_record(educator, make_student):
    first, second = make_student("P-2"), make_student("P-3")
    assert predict(educator, student_id=999999).status_code == 404
    assert predict(educator, student_id=first["id"],
                   academic_record_id=second["record"]["id"]).status_code == 404
    assert predict(educator, student_id=first["id"], academic_record_id=first["record"]["id"],
                   features={**FEATURES, "subject": "portuguese"}).status_code == 422


def test_rerun_replaces_unshared_advice_but_keeps_shared(educator, make_student):
    student = make_student("P-4")
    weak = {**FEATURES, "G1": 4, "G2": 4, "absences": 20}
    first = predict(educator, student_id=student["id"], features=weak).json()
    keep, *others = first["recommendations"]
    assert others
    url = f"/api/students/{student['id']}/recommendations"
    educator.http.patch(f"{url}/{keep['id']}", json={"shared_with_student": True})

    second = predict(educator, student_id=student["id"], features=weak).json()
    current = educator.http.get(f"/api/students/{student['id']}").json()["recommendations"]
    # Compare by owning prediction: SQLite may reuse the IDs of deleted rows.
    from_first = {item["id"] for item in current if item["prediction_id"] == first["id"]}
    assert from_first == {keep["id"]}
    assert any(item["prediction_id"] == second["id"] for item in current)


def test_history_lists_filters_and_paginates(educator, make_student):
    student = make_student("P-5")
    predict(educator, student_id=student["id"])
    predict(educator, student_id=student["id"], features={**FEATURES, "G1": 2, "G2": 2})
    predict(educator)

    everything = educator.http.get("/api/predictions").json()
    assert everything["total"] == 3
    assert everything["items"][0]["id"] > everything["items"][-1]["id"]
    assert educator.http.get("/api/predictions",
                             params={"student_id": student["id"]}).json()["total"] == 2
    assert educator.http.get("/api/predictions", params={"q": "P-5"}).json()["total"] == 2
    assert educator.http.get("/api/predictions",
                             params={"risk_level": "high"}).json()["total"] == 1
    assert educator.http.get("/api/predictions",
                             params={"page_size": 1, "page": 3}).json()["pages"] == 3


def test_get_one_and_404(educator):
    prediction_id = predict(educator).json()["id"]
    assert educator.http.get(f"/api/predictions/{prediction_id}").status_code == 200
    assert educator.http.get("/api/predictions/999999").status_code == 404


def test_review_adds_to_the_audit_trail(educator, db):
    prediction_id = predict(educator).json()["id"]
    url = f"/api/predictions/{prediction_id}/review"
    assert educator.http.post(url, json={"note": ""}).status_code == 422
    body = educator.http.post(url, json={"note": "Spoke to the student."}).json()
    assert [h["action"] for h in body["history"]] == ["created", "reviewed"]
    assert body["history"][1]["note"] == "Spoke to the student."
    assert len(db.scalars(select(PredictionHistory)).all()) == 2


def test_prediction_records_which_model_made_it(educator, db):
    predict(educator)
    version = db.scalar(select(ModelVersion).where(ModelVersion.stage == "period2"))
    assert version.version == get_pipeline().version
    assert version.is_active


def test_model_unavailable_returns_503(educator, monkeypatch):
    from ml.predict import ModelUnavailableError

    def broken():
        raise ModelUnavailableError("missing")

    monkeypatch.setattr("app.routes.predictions.get_pipeline", broken)
    response = predict(educator)
    assert response.status_code == 503
    assert "missing" not in response.text


def test_model_metrics_come_from_training_metadata(educator):
    metadata = get_pipeline().metadata
    info = educator.http.get("/api/model/info").json()
    assert info["version"] == metadata["version"]
    assert info["dataset"]["licence"] == "CC BY 4.0"
    assert info["limitations"]
    for stage in ("intake", "period1", "period2"):
        metrics = educator.http.get("/api/model/metrics", params={"stage": stage}).json()
        assert metrics["classifier"]["test"] == metadata["stages"][stage]["classifier"]["test"]
        assert metrics["fairness"]
        assert "artifact_sha256" not in metrics["classifier"]


class Record:
    def __init__(self, g1, g2):
        self.period1_grade, self.period2_grade = g1, g2


@pytest.mark.parametrize("g1,g2,stage", [(None, None, "intake"), (10, None, "period1"),
                                         (10, 10, "period2")])
def test_stage_follows_available_grades(g1, g2, stage):
    assert stage_for_record(Record(g1, g2)) == stage


def test_recommendation_rules():
    base = {"studytime": 2, "absences": 0, "failures": 0, "schoolsup": "yes", "higher": "yes"}
    categories = lambda features, level: {  # noqa: E731
        item["category"] for item in build_recommendations(features, level)}
    assert categories({**base, "G1": 15}, "low") == {"encouragement"}
    assert "tutoring" in categories({**base, "G1": 8}, "moderate")
    assert "attendance" in categories({**base, "absences": 12}, "low")
    assert "foundations" in categories({**base, "failures": 1}, "low")
    assert "study-habits" in categories({**base, "studytime": 1}, "low")
    assert "school-support" in categories({**base, "schoolsup": "no"}, "high")
    assert "check-in" in categories(base, "high")


def test_recommendation_wording_never_labels_the_student():
    features = {"G1": 2, "G2": 2, "absences": 30, "failures": 3, "studytime": 1, "schoolsup": "no",
                "higher": "no"}
    text = " ".join(item["message"] + item["title"]
                    for item in build_recommendations(features, "high")).lower()
    for word in ("risk", "fail ", "dropout", "probability"):
        assert word not in text
