"""The weekly support workflow: who needs attention, what changed, and whether help followed.

The list is built from stored predictions and actions, so it always reflects what is
really on record. Nothing here creates, assumes or estimates an action or an outcome.
"""

from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import as_utc, utcnow
from app.models import AcademicRecord, Prediction, Student, SupportAction, User
from app.services.predictions import (
    create_prediction,
    get_pipeline,
    latest_prediction_ids,
    record_features,
    stage_for_record,
)
from ml.config import PASS_MARK

FLAGGED_LEVELS = ("moderate", "high")
LEVEL_ORDER = {"low": 0, "moderate": 1, "high": 2}
STATE_ORDER = {"overdue": 0, "needs_action": 1, "in_progress": 2, "followed_up": 3}
ABSENCE_CHANGE = 3
GRADE_CHANGE = 2
MIN_REASON_EFFECT = 0.03  # three percentage points on the estimate
MAX_REFRESH = 500
SMALL_GROUP = 30


def today() -> date:
    return utcnow().date()


def course_is_open(record: AcademicRecord | None, student: Student) -> bool:
    """A recorded final grade ends a course.

    Demonstration records all have final grades, because they come from a finished dataset.
    They stay open so that the workflow can be tried, and the interface labels them as demo.
    """
    return record is None or record.final_grade is None or student.is_demo


def describe_changes(latest: Prediction, previous: Prediction | None) -> list[dict[str, str]]:
    """Plain statements of what differs from the last prediction for this course."""
    if previous is None:
        return []
    changes: list[dict[str, str]] = []
    before, after = LEVEL_ORDER[previous.risk_level], LEVEL_ORDER[latest.risk_level]
    if after != before:
        verb = "rose" if after > before else "fell"
        changes.append({
            "direction": "worse" if after > before else "better",
            "text": f"Concern {verb} from {previous.risk_level} to {latest.risk_level}",
        })

    old, new = previous.input_features, latest.input_features
    if "absences" in old and "absences" in new:
        difference = new["absences"] - old["absences"]
        if abs(difference) >= ABSENCE_CHANGE:
            change = "up" if difference > 0 else "down"
            changes.append({
                "direction": "worse" if difference > 0 else "better",
                "text": f"Absences {change} from {old['absences']} to {new['absences']}",
            })
    for key, label in (("G1", "First period grade"), ("G2", "Second period grade")):
        if key in old and key in new:
            difference = new[key] - old[key]
            if abs(difference) >= GRADE_CHANGE:
                change = "down" if difference < 0 else "up"
                changes.append({
                    "direction": "worse" if difference < 0 else "better",
                    "text": f"{label} {change} from {old[key]} to {new[key]}",
                })
    if "G1" in new and "G2" in new and "G2" not in old:
        difference = new["G2"] - new["G1"]
        if abs(difference) >= GRADE_CHANGE:
            change = "dropped" if difference < 0 else "rose"
            changes.append({
                "direction": "worse" if difference < 0 else "better",
                "text": f"Grade {change} from {new['G1']} to {new['G2']} in the second period",
            })
    return changes


def main_reasons(contributions: list[dict[str, Any]]) -> list[str]:
    """The few inputs worth a teacher's attention. The prediction page keeps the full list.

    Leaves out small effects and the subject itself, which nobody can act on. Also leaves out
    "fewer absences than typical": the model does raise its estimate there, because some
    students in the data with zero absences have very low final grades, but good attendance
    is not something to raise with a student as a concern.
    """
    reasons = [
        c for c in contributions
        if c["direction"] == "raises_risk"
        and c["effect"] >= MIN_REASON_EFFECT
        and c["feature"] != "subject"
        and not (c["feature"] == "absences" and c["value"] <= c["typical_value"])
    ]
    return [f"{c['label']}: {c['value']}" for c in reasons[:3]]


def action_summary(action: SupportAction) -> dict[str, Any]:
    student = action.student
    return {
        "id": action.id,
        "student_id": action.student_id,
        "student_name": student.full_name,
        "student_code": student.student_code,
        "is_demo": student.is_demo,
        "subject": action.subject,
        "prediction_id": action.prediction_id,
        "action_type": action.action_type,
        "note": action.note,
        "status": action.status,
        "due_date": action.due_date,
        "is_overdue": action.status == "planned" and action.due_date < today(),
        "owner_id": action.owner_id,
        "owner_name": action.owner.full_name if action.owner else None,
        "outcome_note": action.outcome_note,
        "completed_at": action.completed_at,
        "created_by_name": action.created_by.full_name if action.created_by else None,
        "created_at": action.created_at,
    }


def _actions_by_course(db: Session) -> dict[tuple[int, str], list[SupportAction]]:
    actions = db.scalars(
        select(SupportAction).options(selectinload(SupportAction.student),
                                      selectinload(SupportAction.owner),
                                      selectinload(SupportAction.created_by))
        .order_by(SupportAction.due_date, SupportAction.id)
    ).all()
    grouped: dict[tuple[int, str], list[SupportAction]] = defaultdict(list)
    for action in actions:
        grouped[(action.student_id, action.subject)].append(action)
    return grouped


def _state(latest: Prediction, actions: list[SupportAction]) -> str | None:
    """Where this course stands. None means that it does not belong on the list."""
    planned = [a for a in actions if a.status == "planned"]
    if any(a.due_date < today() for a in planned):
        return "overdue"
    if planned:
        return "in_progress"
    if latest.risk_level not in FLAGGED_LEVELS:
        return None
    # Help given since this estimate was made: wait for new results before asking again.
    created = as_utc(latest.created_at)
    if any(a.status == "done" and a.completed_at and as_utc(a.completed_at) >= created
           for a in actions):
        return "followed_up"
    return "needs_action"


def build_watchlist(db: Session) -> list[dict[str, Any]]:
    latest_rows = db.scalars(
        select(Prediction).options(selectinload(Prediction.student))
        .where(Prediction.id.in_(latest_prediction_ids()))
    ).all()
    record_ids = [p.academic_record_id for p in latest_rows if p.academic_record_id]
    records = {r.id: r for r in db.scalars(
        select(AcademicRecord).where(AcademicRecord.id.in_(record_ids)))} if record_ids else {}

    # Earlier predictions for each course, newest first, to find what has changed.
    previous: dict[tuple[int, str], Prediction] = {}
    latest_ids = {p.id for p in latest_rows}
    for prediction in db.scalars(
        select(Prediction).where(Prediction.student_id.is_not(None),
                                 Prediction.id.not_in(latest_ids))
        .order_by(Prediction.id.desc())
    ):
        previous.setdefault((prediction.student_id, prediction.subject), prediction)

    actions = _actions_by_course(db)
    items: list[dict[str, Any]] = []
    for latest in latest_rows:
        student = latest.student
        record = records.get(latest.academic_record_id)
        if not course_is_open(record, student):
            continue
        key = (student.id, latest.subject)
        course_actions = actions.get(key, [])
        state = _state(latest, course_actions)
        if state is None:
            continue
        planned = [a for a in course_actions if a.status == "planned"]
        items.append({
            "student_id": student.id,
            "student_name": student.full_name,
            "student_code": student.student_code,
            "year_group": student.year_group,
            "is_demo": student.is_demo,
            "subject": latest.subject,
            "prediction_id": latest.id,
            "risk_level": latest.risk_level,
            "risk_probability": latest.risk_probability,
            "predicted_grade": latest.predicted_grade,
            "assessed_at": latest.created_at,
            "state": state,
            "reasons": main_reasons(latest.contributions),
            "changes": describe_changes(latest, previous.get(key)),
            "next_action": action_summary(planned[0]) if planned else None,
            "actions_done": sum(a.status == "done" for a in course_actions),
        })
    # Within each state, students who just got worse come before those who have not changed.
    items.sort(key=lambda i: (
        STATE_ORDER[i["state"]],
        not any(c["direction"] == "worse" for c in i["changes"]),
        -i["risk_probability"],
        i["student_name"],
    ))
    return items


def refresh_predictions(db: Session, actor: User) -> dict[str, int]:
    """Re-score open courses whose record changed after their last prediction."""
    newest = dict(db.execute(
        select(Prediction.academic_record_id, func.max(Prediction.created_at))
        .where(Prediction.academic_record_id.is_not(None))
        .group_by(Prediction.academic_record_id)
    ).all())
    records = db.scalars(
        select(AcademicRecord).options(selectinload(AcademicRecord.student))
        .order_by(AcademicRecord.id)
    ).all()
    stale = []
    for record in records:
        if not course_is_open(record, record.student):
            continue
        last = newest.get(record.id)
        if last is None or as_utc(record.updated_at) > as_utc(last):
            stale.append(record)

    pipeline = get_pipeline()
    for record in stale[:MAX_REFRESH]:
        create_prediction(db, pipeline, stage=stage_for_record(record),
                          features=record_features(record), actor=actor,
                          student=record.student, record=record)
    return {"scored": min(len(stale), MAX_REFRESH),
            "remaining": max(0, len(stale) - MAX_REFRESH)}


def _outcome(courses: list[dict[str, Any]]) -> dict[str, Any]:
    finals = [c["final"] for c in courses if c["final"] is not None]
    passed = sum(grade >= PASS_MARK for grade in finals)
    return {
        "courses": len(courses),
        "finals_known": len(finals),
        "passed": passed,
        "pass_rate": round(passed / len(finals), 4) if finals else None,
        "small_group": len(finals) < SMALL_GROUP,
    }


def build_results(db: Session, include_demo: bool) -> dict[str, Any]:
    """Counts of what was flagged, what was done, and how those courses ended."""
    flagged_rows = db.execute(
        select(Prediction.student_id, Prediction.subject, func.max(Prediction.id))
        .where(Prediction.student_id.is_not(None), Prediction.risk_level.in_(FLAGGED_LEVELS))
        .group_by(Prediction.student_id, Prediction.subject)
    ).all()
    prediction_ids = [row[2] for row in flagged_rows]
    predictions = {p.id: p for p in db.scalars(
        select(Prediction).options(selectinload(Prediction.student))
        .where(Prediction.id.in_(prediction_ids)))} if prediction_ids else {}
    record_ids = [p.academic_record_id for p in predictions.values() if p.academic_record_id]
    finals = dict(db.execute(select(AcademicRecord.id, AcademicRecord.final_grade)
                             .where(AcademicRecord.id.in_(record_ids))).all()) if record_ids else {}

    actions = _actions_by_course(db)
    helped: list[dict[str, Any]] = []
    not_helped: list[dict[str, Any]] = []
    demo_courses = 0
    for student_id, subject, prediction_id in flagged_rows:
        prediction = predictions[prediction_id]
        if prediction.student.is_demo:
            demo_courses += 1
            if not include_demo:
                continue
        course = {"final": finals.get(prediction.academic_record_id)}
        done = any(a.status == "done" for a in actions.get((student_id, subject), []))
        (helped if done else not_helped).append(course)

    every_action = [a for group in actions.values() for a in group
                    if include_demo or not a.student.is_demo]
    return {
        "pass_mark": PASS_MARK,
        "include_demo": include_demo,
        "flagged_courses": len(helped) + len(not_helped),
        "demo_courses": demo_courses,
        "actions": {
            "total": len(every_action),
            "planned": sum(a.status == "planned" for a in every_action),
            "overdue": sum(a.status == "planned" and a.due_date < today() for a in every_action),
            "done": sum(a.status == "done" for a in every_action),
            "cancelled": sum(a.status == "cancelled" for a in every_action),
        },
        "with_completed_action": _outcome(helped),
        "without_completed_action": _outcome(not_helped),
    }
