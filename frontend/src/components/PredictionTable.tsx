import { Link } from "react-router-dom";
import type { PredictionSummary } from "../api/types";
import { dateTime, grade, percent, STAGE_LABELS, SUBJECT_LABELS } from "../format";
import { DemoBadge, RiskBadge, TD, Table } from "./ui";

export function PredictionTable({ items, detailed = false }: { items: PredictionSummary[]; detailed?: boolean }) {
  const head = detailed
    ? ["Student", "Course", "Stage", "Concern", "Chance below pass", "Predicted grade", "Actual final", "Run"]
    : ["Student", "Course", "Concern", "Predicted grade"];
  return (
    <Table head={head}>
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-lavender/50">
          <TD>
            <Link to={`/predictions/${item.id}`} className="font-medium text-brand hover:underline">
              {item.student_name ?? "Hypothetical scenario"}
            </Link>
            {item.is_demo && <span className="ml-2"><DemoBadge /></span>}
          </TD>
          <TD>{SUBJECT_LABELS[item.subject]}</TD>
          {detailed && <TD className="whitespace-nowrap">{STAGE_LABELS[item.stage]}</TD>}
          <TD><RiskBadge level={item.risk_level} /></TD>
          {detailed && <TD>{percent(item.risk_probability)}</TD>}
          <TD className="whitespace-nowrap">{grade(item.predicted_grade)} / 20</TD>
          {detailed && <TD>{item.actual_final_grade ?? "—"}</TD>}
          {detailed && <TD className="whitespace-nowrap text-slate-brand">{dateTime(item.created_at)}</TD>}
        </tr>
      ))}
    </Table>
  );
}
