"""Exploratory data analysis. Run from backend/:  python -m ml.eda

Writes ml/reports/eda_summary.json and figures to ml/reports/figures/. Every number
in the summary is computed from the raw files when this runs.
"""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import seaborn as sns  # noqa: E402

from ml.config import FIGURES_DIR, PASS_MARK, REPORTS_DIR  # noqa: E402
from ml.data import load_clean  # noqa: E402

PURPLE = "#635BDB"
TEAL = "#0F9D8A"
INK = "#111827"
MUTED = "#64748B"
SUBJECT_COLOURS = {"math": PURPLE, "portuguese": TEAL}
NUMERIC = ["studytime", "failures", "absences", "age", "Medu", "Fedu", "traveltime", "famrel",
           "freetime", "goout", "Dalc", "Walc", "health", "G1", "G2", "G3"]


def _style() -> None:
    sns.set_theme(style="white", rc={
        "axes.edgecolor": "#CBD5E1", "axes.labelcolor": MUTED, "text.color": INK,
        "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False,
        "axes.spines.right": False, "axes.titleweight": "bold","axes.titlesize": 12,
        "figure.dpi": 130, "font.size": 10,
    })


def _save(fig, name: str) -> None:
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / name, bbox_inches="tight")
    plt.close(fig)


def figures(frame) -> None:
    _style()
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(1, 2, figsize=(9, 3.4), sharex=True)
    for ax, (subject, part) in zip(axes, frame.groupby("subject"), strict=False):
        ax.hist(part["G3"], bins=range(0, 22), color=SUBJECT_COLOURS[subject], rwidth=0.88)
        ax.axvline(PASS_MARK, color=INK, linewidth=1, linestyle="--")
        ax.text(PASS_MARK + 0.3, ax.get_ylim()[1] * 0.92, "pass mark", fontsize=8)
        ax.set(title=f"Final grade (G3): {subject}", xlabel="Grade (0-20)", ylabel="Students")
    _save(fig, "grade_distribution.png")

    fig, ax = plt.subplots(figsize=(8.4, 7))
    sns.heatmap(frame[NUMERIC].corr(), cmap="RdBu_r", center=0, vmin=-1, vmax=1, annot=True,
                fmt=".1f", annot_kws={"size": 7}, square=True, linewidths=0.5,
                cbar_kws={"shrink": 0.7, "label": "Pearson correlation"}, ax=ax)
    ax.set_title("Correlation between numeric columns")
    _save(fig, "correlation_heatmap.png")

    fig, ax = plt.subplots(figsize=(4.6, 4.2))
    counts = frame.groupby(["G2", "G3"]).size().reset_index(name="n")
    ax.scatter(counts["G2"], counts["G3"], s=counts["n"] * 7, color=PURPLE, alpha=0.65,
               edgecolor="white", linewidth=0.5)
    ax.set(title="Second period vs final grade", xlabel="G2", ylabel="G3 (dot size = students)")
    _save(fig, "g2_vs_g3.png")

    fig, axes = plt.subplots(1, 3, figsize=(10, 3.2), sharey=True)
    for ax, column, label in zip(axes, ["failures", "studytime", "schoolsup"],
                                 ["Past failures", "Study time band", "Extra school support"],
                                 strict=False):
        rate = frame.groupby(column)["at_risk"].mean().mul(100)
        ax.bar(rate.index.astype(str), rate.values, color=PURPLE, width=0.6)
        ax.set(title=label, ylabel=f"% with G3 below {PASS_MARK}" if ax is axes[0] else "")
    _save(fig, "below_pass_rate_by_feature.png")

    fig, ax = plt.subplots(figsize=(5.4, 3.2))
    ax.hist(frame["absences"], bins=30, color=PURPLE, rwidth=0.88)
    ax.set(title="School absences", xlabel="Absences", ylabel="Students")
    _save(fig, "absences_distribution.png")


def summary(frame, report) -> dict:
    grades = frame.groupby("subject")["G3"]
    correlation = frame[NUMERIC].corr()["G3"].drop("G3").sort_values(key=abs, ascending=False)
    return {
        "shape": {"rows": len(frame), "raw_columns": 33},
        "cleaning": vars(report),
        "column_types": {
            "numeric": [c for c in frame.columns if frame[c].dtype.kind in "iuf"
                        and c != "at_risk"],
            "categorical": [c for c in frame.columns if frame[c].dtype.kind not in "iuf"
                            and c not in ("student_group", "parental_education")],
        },
        "final_grade_by_subject": {
            subject: {
                "n": int(part.size), "mean": round(float(part.mean()), 2),
                "median": float(part.median()), "std": round(float(part.std()), 2),
                "below_pass_rate": round(float((part < PASS_MARK).mean()), 4),
                "zero_finals": int((part == 0).sum()),
            }
            for subject, part in grades
        },
        "final_grade_histogram": {
            subject: {str(g): int((part == g).sum()) for g in range(21)}
            for subject, part in grades
        },
        "absences": {
            "median": float(frame["absences"].median()), "max": int(frame["absences"].max()),
            "skew": round(float(frame["absences"].skew()), 2),
        },
        "correlation_with_g3": {k: round(float(v), 3) for k, v in correlation.items()},
    }


def main() -> dict:
    frame, report = load_clean()
    figures(frame)
    result = summary(frame, report)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (REPORTS_DIR / "eda_summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("cleaning", "final_grade_by_subject", "absences",
                                             "correlation_with_g3")}, indent=2))
    return result


if __name__ == "__main__":
    main()
