"""The weekly support list, follow-up actions and results."""

from datetime import timedelta

import pytest
from conftest import FEATURES
from sqlalchemy import update

from app.database import utcnow
from app.models import SupportAction
from app.services.support import describe_changes, main_reasons

WEAK = {**FEATURES, "G1": 4, "G2": 4, "absences": 20}
STRONG = {**FEATURES, "G1": 17, "G2": 17, "absences": 0}


def in_days(days: int) -> str:
    return (utcnow().date() + timedelta(days=days)).isoformat()


def watchlist(actor, **params):
    response = actor.http.get("/api/support/watchlist", params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def flagged(educator, make_student):
    """A student with an open course and a real prediction that flags it."""
    student = make_student("W-1", period1_grade=4, period2_grade=4, final_grade=None, absences=20)
    response = educator.http.post("/api/predictions", json={
        "stage": "period2", "features": WEAK, "student_id": student["id"],
        "academic_record_id": student["record"]["id"],
    })
    assert response.status_code == 201
    assert response.json()["predicted_at_risk"] is True
    student["prediction"] = response.json()
    return student


def plan(actor, student, **body):
    return actor.http.post("/api/support/actions", json={
        "student_id": student["id"], "subject": "math", "action_type": "tutoring",
        "due_date": in_days(7), **body,
    })


class TestWatchlist:
    def test_flagged_course_needs_action_and_shows_reasons(self, educator, flagged):
        body = watchlist(educator)
        assert body["total"] == 1
        item = body["items"][0]
        assert item["state"] == "needs_action"
        assert item["student_code"] == "W-1"
        assert item["next_action"] is None
        assert item["reasons"]
        assert not any(reason.startswith("Subject") for reason in item["reasons"])
        assert body["counts"]["needs_action"] == 1

    def test_low_concern_course_stays_off_the_list(self, educator, make_student):
        student = make_student("W-2", period1_grade=17, period2_grade=17, final_grade=None)
        educator.http.post("/api/predictions", json={
            "stage": "period2", "features": STRONG, "student_id": student["id"],
            "academic_record_id": student["record"]["id"]})
        assert watchlist(educator)["total"] == 0

    def test_course_with_a_final_grade_leaves_the_list(self, educator, flagged):
        record = flagged["record"]
        educator.http.put(f"/api/students/{flagged['id']}/records/{record['id']}",
                          json={**{k: record[k] for k in ("subject", "academic_year")},
                                "period1_grade": 4, "period2_grade": 4, "final_grade": 6,
                                "absences": 20})
        assert watchlist(educator)["total"] == 0

    def test_hypothetical_predictions_never_appear(self, educator):
        educator.http.post("/api/predictions", json={"stage": "period2", "features": WEAK})
        assert watchlist(educator)["total"] == 0

    def test_planned_action_moves_it_to_in_progress(self, educator, flagged):
        assert plan(educator, flagged).status_code == 201
        item = watchlist(educator)["items"][0]
        assert item["state"] == "in_progress"
        assert item["next_action"]["action_type"] == "tutoring"
        assert item["next_action"]["is_overdue"] is False

    def test_missed_follow_up_is_overdue_and_listed_first(self, educator, db, flagged,
                                                          make_student):
        other = make_student("W-3", period1_grade=4, period2_grade=4, final_grade=None)
        educator.http.post("/api/predictions", json={
            "stage": "period2", "features": WEAK, "student_id": other["id"],
            "academic_record_id": other["record"]["id"]})
        action_id = plan(educator, flagged).json()["id"]
        db.execute(update(SupportAction).where(SupportAction.id == action_id)
                   .values(due_date=utcnow().date() - timedelta(days=3)))
        db.commit()

        body = watchlist(educator)
        assert [i["state"] for i in body["items"]] == ["overdue", "needs_action"]
        assert body["items"][0]["next_action"]["is_overdue"] is True
        assert body["counts"]["overdue"] == 1

    def test_done_action_waits_for_new_results_then_asks_again(self, educator, flagged):
        action_id = plan(educator, flagged).json()["id"]
        educator.http.patch(f"/api/support/actions/{action_id}",
                            json={"status": "done", "outcome_note": "Met twice."})
        assert watchlist(educator)["items"][0]["state"] == "followed_up"

        educator.http.post("/api/predictions", json={
            "stage": "period2", "features": WEAK, "student_id": flagged["id"],
            "academic_record_id": flagged["record"]["id"]})
        item = watchlist(educator)["items"][0]
        assert item["state"] == "needs_action"
        assert item["actions_done"] == 1

    def test_students_who_just_got_worse_come_first_within_a_state(self, educator, make_student):
        def score(student, features):
            educator.http.post("/api/predictions", json={
                "stage": "period2", "features": features, "student_id": student["id"],
                "academic_record_id": student["record"]["id"]})

        # "Steady" has the higher estimate, but has not changed. "Worsening" just has.
        steady = make_student("W-9", period1_grade=2, period2_grade=2, final_grade=None)
        worsening = make_student("W-10", period1_grade=6, period2_grade=6, final_grade=None)
        score(steady, {**WEAK, "G1": 2, "G2": 2})
        score(worsening, {**WEAK, "G1": 7, "G2": 7, "absences": 2})
        score(worsening, {**WEAK, "G1": 7, "G2": 7, "absences": 12})

        codes = [item["student_code"] for item in watchlist(educator)["items"]]
        assert codes == ["W-10", "W-9"]

    def test_filters_and_counts(self, educator, make_user, flagged):
        colleague = make_user("educator")
        plan(educator, flagged, owner_id=colleague.id)
        assert watchlist(educator, mine=True)["total"] == 0
        assert watchlist(colleague, mine=True)["total"] == 1
        assert watchlist(educator, q="w-1")["total"] == 1
        assert watchlist(educator, q="nobody")["total"] == 0
        assert watchlist(educator, subject="portuguese")["total"] == 0
        filtered = watchlist(educator, state="needs_action")
        assert filtered["total"] == 0
        assert filtered["counts"]["in_progress"] == 1


class TestReasons:
    @staticmethod
    def contribution(feature, value, typical, effect, direction="raises_risk"):
        return {"feature": feature, "label": feature.title(), "value": value,
                "typical_value": typical, "effect": effect, "direction": direction}

    def test_keeps_meaningful_reasons_in_order_and_at_most_three(self):
        items = [self.contribution(name, 5, 10, 0.3 - i / 100)
                 for i, name in enumerate(["g1", "g2", "failures", "studytime"])]
        assert main_reasons(items) == ["G1: 5", "G2: 5", "Failures: 5"]

    def test_leaves_out_small_effects_and_things_lowering_concern(self):
        assert main_reasons([
            self.contribution("g1", 8, 11, 0.02),
            self.contribution("g2", 15, 11, -0.2, "lowers_risk"),
        ]) == []

    def test_leaves_out_the_subject(self):
        assert main_reasons([self.contribution("subject", "math", "portuguese", 0.2)]) == []

    def test_good_attendance_is_never_a_concern_but_poor_attendance_is(self):
        assert main_reasons([self.contribution("absences", 0, 2, 0.1)]) == []
        assert main_reasons([self.contribution("absences", 18, 2, 0.1)]) == ["Absences: 18"]


class TestChanges:
    def make(self, level="low", **features):
        return type("P", (), {"risk_level": level, "input_features": features})()

    def test_no_previous_prediction_means_no_changes(self):
        assert describe_changes(self.make(), None) == []

    def test_reports_real_differences_with_their_values(self):
        texts = [c["text"] for c in describe_changes(
            self.make("high", absences=15, G1=6), self.make("low", absences=4, G1=12))]
        assert texts == ["Concern rose from low to high", "Absences up from 4 to 15",
                         "First period grade down from 12 to 6"]

    def test_improvements_are_marked_better(self):
        changes = describe_changes(self.make("low", absences=2), self.make("high", absences=9))
        assert {c["direction"] for c in changes} == {"better"}

    def test_small_differences_are_not_reported(self):
        assert describe_changes(self.make(absences=5, G1=11), self.make(absences=4, G1=10)) == []

    def test_compares_grades_when_a_new_period_arrives(self):
        changes = describe_changes(self.make(G1=12, G2=7), self.make(G1=12))
        assert changes[0]["text"] == "Grade dropped from 12 to 7 in the second period"

    def test_watchlist_shows_changes_after_a_new_prediction(self, educator, flagged):
        educator.http.post("/api/predictions", json={
            "stage": "period2", "features": {**WEAK, "absences": 30},
            "student_id": flagged["id"], "academic_record_id": flagged["record"]["id"]})
        item = watchlist(educator)["items"][0]
        assert "Absences up from 20 to 30" in [c["text"] for c in item["changes"]]


class TestActions:
    def test_defaults_owner_to_the_creator(self, educator, flagged):
        body = plan(educator, flagged).json()
        assert body["owner_id"] == educator.id
        assert body["status"] == "planned"
        assert body["student_name"] == flagged["full_name"]

    @pytest.mark.parametrize("change", [
        {"action_type": "magic"}, {"subject": "history"}, {"due_date": "soon"},
        {"note": "x" * 2001},
    ])
    def test_rejects_invalid_input(self, educator, flagged, change):
        assert plan(educator, flagged, **change).status_code == 422

    def test_rejects_past_due_date(self, educator, flagged):
        assert plan(educator, flagged, due_date=in_days(-5)).status_code == 422

    def test_rejects_owner_who_is_not_active_staff(self, educator, student_user, flagged):
        assert plan(educator, flagged, owner_id=student_user.id).status_code == 422
        assert plan(educator, flagged, owner_id=999999).status_code == 422

    def test_rejects_another_students_prediction(self, educator, flagged, make_student):
        other = make_student("W-4")
        response = plan(educator, other, prediction_id=flagged["prediction"]["id"])
        assert response.status_code == 404

    def test_unknown_student_is_404(self, educator):
        assert plan(educator, {"id": 999999}).status_code == 404

    def test_complete_records_time_and_outcome(self, educator, flagged):
        action_id = plan(educator, flagged).json()["id"]
        body = educator.http.patch(f"/api/support/actions/{action_id}", json={
            "status": "done", "outcome_note": "Attended tutoring."}).json()
        assert body["status"] == "done"
        assert body["completed_at"] is not None
        assert body["outcome_note"] == "Attended tutoring."

    def test_reopening_clears_the_completion_time(self, educator, flagged):
        action_id = plan(educator, flagged).json()["id"]
        url = f"/api/support/actions/{action_id}"
        educator.http.patch(url, json={"status": "done"})
        assert educator.http.patch(url, json={"status": "planned"}).json()["completed_at"] is None

    def test_reschedule_and_reassign(self, educator, make_user, flagged):
        colleague = make_user("educator")
        url = f"/api/support/actions/{plan(educator, flagged).json()['id']}"
        body = educator.http.patch(url, json={"due_date": in_days(14),
                                              "owner_id": colleague.id}).json()
        assert body["due_date"] == in_days(14)
        assert body["owner_id"] == colleague.id
        assert educator.http.patch(url, json={"due_date": in_days(-9)}).status_code == 422

    def test_list_filters_by_student_and_status(self, educator, flagged, make_student):
        other = make_student("W-5")
        plan(educator, flagged)
        plan(educator, other)
        assert educator.http.get("/api/support/actions").json()["total"] == 2
        found = educator.http.get("/api/support/actions",
                                  params={"student_id": flagged["id"]}).json()
        assert [a["student_id"] for a in found["items"]] == [flagged["id"]]
        assert educator.http.get("/api/support/actions",
                                 params={"status": "done"}).json()["total"] == 0

    def test_delete(self, educator, flagged):
        url = f"/api/support/actions/{plan(educator, flagged).json()['id']}"
        assert educator.http.delete(url).status_code == 204
        assert educator.http.delete(url).status_code == 404

    def test_deleting_the_student_removes_their_actions(self, educator, flagged):
        plan(educator, flagged)
        educator.http.delete(f"/api/students/{flagged['id']}")
        assert educator.http.get("/api/support/actions").json()["total"] == 0

    def test_students_cannot_touch_actions_or_see_them(self, educator, student_user, flagged):
        action_id = plan(educator, flagged).json()["id"]
        http = student_user.http
        assert plan(student_user, flagged).status_code == 403
        assert http.patch(f"/api/support/actions/{action_id}",
                          json={"status": "done"}).status_code == 403
        assert http.delete(f"/api/support/actions/{action_id}").status_code == 403
        assert http.post("/api/support/refresh").status_code == 403

    def test_staff_list_has_only_active_staff_names(self, educator, admin, make_user):
        make_user("student")
        people = educator.http.get("/api/support/staff").json()
        assert {p["id"] for p in people} == {educator.id, admin.id}
        assert all(set(p) == {"id", "full_name"} for p in people)


class TestRefresh:
    def test_scores_only_new_or_changed_open_records(self, educator, make_student):
        student = make_student("W-6", period1_grade=4, period2_grade=4, final_grade=None)
        make_student("W-7", final_grade=12)  # finished course: nothing to predict
        assert educator.http.post("/api/support/refresh").json() == {"scored": 1, "remaining": 0}
        assert educator.http.post("/api/support/refresh").json()["scored"] == 0

        record = student["record"]
        educator.http.put(f"/api/students/{student['id']}/records/{record['id']}", json={
            "subject": "math", "academic_year": record["academic_year"], "period1_grade": 3,
            "period2_grade": 3, "absences": 25})
        assert educator.http.post("/api/support/refresh").json()["scored"] == 1
        assert educator.http.get("/api/predictions").json()["total"] == 2

    def test_changed_record_shows_up_as_a_change(self, educator, make_student):
        student = make_student("W-8", period1_grade=9, period2_grade=8, final_grade=None,
                               absences=2)
        educator.http.post("/api/support/refresh")
        record = student["record"]
        educator.http.put(f"/api/students/{student['id']}/records/{record['id']}", json={
            "subject": "math", "academic_year": record["academic_year"], "period1_grade": 5,
            "period2_grade": 4, "absences": 30})
        educator.http.post("/api/support/refresh")
        texts = [c["text"] for c in watchlist(educator)["items"][0]["changes"]]
        assert "Absences up from 2 to 30" in texts
        assert "Second period grade down from 8 to 4" in texts


class TestResults:
    def test_empty_system_reports_zeros_and_no_rates(self, educator):
        body = educator.http.get("/api/support/results").json()
        assert body["flagged_courses"] == 0
        assert body["with_completed_action"]["pass_rate"] is None
        assert body["actions"]["total"] == 0

    def test_counts_follow_what_really_happened(self, educator, flagged):
        action_id = plan(educator, flagged).json()["id"]
        before = educator.http.get("/api/support/results").json()
        assert before["without_completed_action"]["courses"] == 1
        assert before["with_completed_action"]["courses"] == 0
        assert before["actions"]["planned"] == 1

        educator.http.patch(f"/api/support/actions/{action_id}", json={"status": "done"})
        record = flagged["record"]
        educator.http.put(f"/api/students/{flagged['id']}/records/{record['id']}", json={
            "subject": "math", "academic_year": record["academic_year"], "period1_grade": 4,
            "period2_grade": 4, "final_grade": 11})
        after = educator.http.get("/api/support/results").json()
        helped = after["with_completed_action"]
        assert (helped["courses"], helped["finals_known"], helped["passed"]) == (1, 1, 1)
        assert helped["pass_rate"] == 1.0
        assert helped["small_group"] is True
        assert after["actions"]["done"] == 1

    def test_cancelled_action_does_not_count_as_help(self, educator, flagged):
        action_id = plan(educator, flagged).json()["id"]
        educator.http.patch(f"/api/support/actions/{action_id}", json={"status": "cancelled"})
        body = educator.http.get("/api/support/results").json()
        assert body["with_completed_action"]["courses"] == 0
        assert body["actions"]["cancelled"] == 1
