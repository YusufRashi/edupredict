import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Link } from "react-router-dom";
import type { Contribution, PredictionDetail } from "../api/types";
import { grade, percent, STAGE_LABELS, SUBJECT_LABELS } from "../format";
import { Card, CardTitle, DemoBadge, Notice, Pill, RiskBadge } from "./ui";

const DIRECTION = {
  raises_risk: { Icon: ArrowUpRight, text: "Raises concern", bar: "bg-amber-500" },
  lowers_risk: { Icon: ArrowDownRight, text: "Lowers concern", bar: "bg-brand" },
  neutral: { Icon: Minus, text: "Little effect", bar: "bg-slate-300" },
};

function ContributionRow({ item, scale }: { item: Contribution; scale: number }) {
  const { Icon, text, bar } = DIRECTION[item.direction];
  const points = Math.abs(item.effect) * 100;
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{item.label}: {String(item.value)}</span>
        <span className="flex items-center gap-1 text-xs text-slate-brand">
          <Icon className="size-3.5" aria-hidden />
          {text}{item.direction !== "neutral" && ` by ${points.toFixed(1)} points`}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100" aria-hidden>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(1, (Math.abs(item.effect) / scale) * 100)}%` }} />
      </div>
      <p className="mt-0.5 text-xs text-slate-brand">Typical value: {String(item.typical_value)}</p>
    </li>
  );
}

export function PredictionResult({ prediction }: { prediction: PredictionDetail }) {
  const scale = Math.max(...prediction.contributions.map((c) => Math.abs(c.effect)), 0.01);
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Model estimate</h2>
          <RiskBadge level={prediction.risk_level} />
          {prediction.is_demo && <DemoBadge />}
          {prediction.student_id === null && <Pill>Hypothetical, not linked to a student</Pill>}
        </div>
        <p className="mb-4 text-sm text-slate-brand">
          {prediction.student_id && prediction.student_name ? (
            <Link to={`/students/${prediction.student_id}`} className="font-medium text-brand hover:underline">{prediction.student_name}</Link>
          ) : "No student selected"}
          {" · "}{SUBJECT_LABELS[prediction.subject]} · {STAGE_LABELS[prediction.stage]}
        </p>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-brand">Chance of a final grade below pass</dt>
            <dd className="text-3xl font-semibold tracking-tight">{percent(prediction.risk_probability)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-brand">Predicted final grade</dt>
            <dd className="text-3xl font-semibold tracking-tight">{grade(prediction.predicted_grade)}<span className="text-base font-normal text-slate-brand"> / 20</span></dd>
            <dd className="text-xs text-slate-brand">Likely range {grade(prediction.grade_interval_low)} to {grade(prediction.grade_interval_high)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-brand">{prediction.predicted_at_risk ? "Confidence in this flag" : "Confidence in no flag"}</dt>
            <dd className="text-3xl font-semibold tracking-tight">{percent(prediction.confidence)}</dd>
            <dd className="text-xs text-slate-brand">
              {prediction.predicted_at_risk
                ? "The estimated chance of a grade below pass. Students are flagged below 50% too, so that fewer are missed."
                : "The estimated chance of a pass."}
            </dd>
          </div>
        </dl>
        {prediction.actual_final_grade !== null && (
          <p className="mt-4 text-sm"><span className="text-slate-brand">Actual final grade on record:</span> <strong>{prediction.actual_final_grade}</strong></p>
        )}
        {prediction.estimates_disagree && (
          <div className="mt-4">
            <Notice tone="warning">
              {prediction.predicted_at_risk
                ? `This student is flagged, but the predicted grade is at or above the pass mark of ${prediction.pass_mark}.`
                : `The predicted grade is below the pass mark of ${prediction.pass_mark}, but this student is not flagged.`}
              {" "}These come from two separate models, so treat this result as less certain.
            </Notice>
          </div>
        )}
        <div className="mt-4"><Notice>{prediction.disclaimer}</Notice></div>
      </Card>

      <Card>
        <CardTitle
          title="What contributed to this estimate"
          subtitle="How the chance changes when each input is swapped for a typical value. This shows how the model behaved, not why a student is doing well or struggling."
        />
        <ul className="divide-y divide-slate-100">
          {prediction.contributions.map((item) => <ContributionRow key={item.feature} item={item} scale={scale} />)}
        </ul>
      </Card>

      {prediction.recommendations.length > 0 && (
        <Card>
          <CardTitle
            title="Support suggestions"
            subtitle="Rules of thumb for you to consider, not validated interventions. Students cannot see these until you share them from their profile."
          />
          <ul className="divide-y divide-slate-100">
            {prediction.recommendations.map((item) => (
              <li key={item.id} className="py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {item.title}
                  <Pill tone={item.priority === "high" ? "red" : item.priority === "medium" ? "amber" : "slate"}>{item.priority} priority</Pill>
                </p>
                <p className="mt-0.5 text-sm text-slate-brand">{item.message}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
