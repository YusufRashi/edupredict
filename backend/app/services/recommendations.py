"""Transparent rules that turn a prediction into support suggestions.

These are fixed educational rules of thumb, not model output and not validated
interventions. Each carries source="rule", so the UI can say so. Wording stays
supportive, and never mentions a risk score, because educators may share these
with the student.
"""

from typing import Any

ABSENCE_ATTENTION_LEVEL = 10


def build_recommendations(features: dict[str, Any], risk_level: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    needs_support = risk_level in ("moderate", "high")
    priority = "high" if risk_level == "high" else "medium"

    grades = [features[k] for k in ("G1", "G2") if features.get(k) is not None]
    if grades and min(grades) < 10:
        items.append({
            "category": "tutoring",
            "title": "Plan targeted help with recent topics",
            "message": "Recent period grades are below the pass mark. Go through recent "
                       "assessments together and choose one or two topics to focus on next.",
            "priority": priority,
        })
    if features.get("absences", 0) >= ABSENCE_ATTENTION_LEVEL:
        items.append({
            "category": "attendance",
            "title": "Talk about attendance",
            "message": "Absences are building up. A supportive conversation can reveal any "
                       "barriers and help to arrange a way to catch up on missed work.",
            "priority": priority if needs_support else "medium",
        })
    if features.get("failures", 0) >= 1:
        items.append({
            "category": "foundations",
            "title": "Check the foundations from earlier courses",
            "message": "An earlier course was not passed. Check that the skills this course "
                       "builds on are secure, and revisit any that are not.",
            "priority": priority if needs_support else "low",
        })
    if features.get("studytime") == 1:
        items.append({
            "category": "study-habits",
            "title": "Build a regular weekly study plan",
            "message": "Reported study time is under two hours a week. Agree a realistic "
                       "routine with short, regular sessions.",
            "priority": "medium" if needs_support else "low",
        })
    if needs_support and features.get("schoolsup") == "no":
        items.append({
            "category": "school-support",
            "title": "Consider extra school support",
            "message": "No extra school support is recorded. Consider whether the school's "
                       "learning support would help.",
            "priority": priority,
        })
    if needs_support and features.get("higher") == "no":
        items.append({
            "category": "guidance",
            "title": "Have a conversation about goals",
            "message": "Talk about goals after school, and how this course connects to them.",
            "priority": "low",
        })
    if risk_level == "high":
        items.append({
            "category": "check-in",
            "title": "Arrange a one-to-one check-in",
            "message": "A one-to-one meeting soon is a chance to talk through how the course is "
                       "going, and to agree next steps together.",
            "priority": "high",
        })
    if not items:
        items.append({
            "category": "encouragement",
            "title": "Keep up the current approach",
            "message": "Nothing currently stands out as needing extra support. Keep up the "
                       "current routine and check progress after the next assessment.",
            "priority": "low",
        })
    return items
