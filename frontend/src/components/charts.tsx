import { Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { AcademicRecord, Distribution, ModelMetrics, RiskLevel, SubjectPerformance, Trends } from "../api/types";
import { percent, RISK_LABELS, SUBJECT_LABELS } from "../format";
import { Card, CardTitle, EmptyState, TD, Table } from "./ui";

// Validated with the dataviz palette checker: both pass color-vision separation on white.
// A subject keeps its color everywhere, whichever filters are applied.
export const SERIES = { math: "#635BDB", portuguese: "#0F9D8A" } as const;
const NEUTRAL = "#94A3B8";
const GRID = "#E8E8EF";
const AXIS = { fontSize: 12, fill: "#64748B" };
const RISK_COLORS: Record<RiskLevel, string> = { low: "#0CA30C", moderate: "#FAB219", high: "#D03B3B" };
const TOOLTIP = {
  contentStyle: { borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 12 },
  cursor: { fill: "#F4F3FF" },
};

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-brand">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={item.dashed ? { borderTop: `2px dashed ${item.color}`, height: 0, width: 14, borderRadius: 0 } : { background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A chart card with a data-table alternative, so no reading depends on seeing the chart. */
export function ChartCard({
  title,
  subtitle,
  head,
  rows,
  children,
}: {
  title: string;
  subtitle?: string;
  head: string[];
  rows: ReactNode[][];
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card>
      <CardTitle
        title={title}
        subtitle={subtitle}
        action={
          <button
            type="button"
            onClick={() => setAsTable(!asTable)}
            aria-pressed={asTable}
            className="no-print inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap text-slate-brand hover:bg-lavender hover:text-navy"
          >
            <Table2 className="size-3.5" aria-hidden />
            {asTable ? "View chart" : "View table"}
          </button>
        }
      />
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <Table head={head}>
            {rows.map((row, index) => (
              <tr key={index}>{row.map((cell, cellIndex) => <TD key={cellIndex}>{cell}</TD>)}</tr>
            ))}
          </Table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

const subjectLegend = (subjects: readonly ("math" | "portuguese")[]) =>
  subjects.map((subject) => ({ label: SUBJECT_LABELS[subject], color: SERIES[subject] }));

export function GradeDistributionChart({ data, subject }: { data: Distribution; subject?: "math" | "portuguese" | "" }) {
  const shown = subject ? ([subject] as const) : (["math", "portuguese"] as const);
  const total = data.grades.reduce((sum, row) => sum + row.math + row.portuguese, 0);
  return (
    <ChartCard
      title="Final grade distribution"
      subtitle={`Recorded final grades on the 0-20 scale. The dashed line marks the pass mark of ${data.pass_mark}.`}
      head={["Grade", ...shown.map((s) => SUBJECT_LABELS[s])]}
      rows={data.grades.map((row) => [row.grade, ...shown.map((s) => row[s])])}
    >
      {total === 0 ? (
        <EmptyState title="No final grades yet" message="This chart fills in once academic records have final grades." />
      ) : (
        <>
          {shown.length > 1 && <Legend items={[...subjectLegend(shown), { label: "Pass mark", color: "#64748B", dashed: true }]} />}
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.grades} barGap={2} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="grade" tick={AXIS} tickLine={false} axisLine={{ stroke: "#CBD5E1" }} />
              <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip {...TOOLTIP} labelFormatter={(label) => `Grade ${label}`} />
              <ReferenceLine x={data.pass_mark} stroke="#64748B" strokeDasharray="4 4" />
              {shown.map((s) => (
                <Bar isAnimationActive={false} key={s} dataKey={s} name={SUBJECT_LABELS[s]} fill={SERIES[s]} radius={[4, 4, 0, 0]} maxBarSize={14} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

export function RiskDonut({ counts, title = "Academic concern levels", subtitle = "Latest prediction per student and subject." }: { counts: Record<RiskLevel, number>; title?: string; subtitle?: string }) {
  const levels: RiskLevel[] = ["low", "moderate", "high"];
  const total = levels.reduce((sum, level) => sum + counts[level], 0);
  const data = levels.map((level) => ({ name: RISK_LABELS[level], level, value: counts[level] }));
  return (
    <ChartCard title={title} subtitle={subtitle} head={["Level", "Courses", "Share"]} rows={data.map((row) => [row.name, row.value, total ? percent(row.value / total) : "—"])}>
      {total === 0 ? (
        <EmptyState title="No predictions yet" message="Run a prediction for a student to see this breakdown." />
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-6">
          <div className="relative size-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie isAnimationActive={false} data={data} dataKey="value" nameKey="name" innerRadius={56} outerRadius={82} paddingAngle={2} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270}>
                  {data.map((row) => <Cell key={row.level} fill={RISK_COLORS[row.level]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP.contentStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold">{total.toLocaleString()}</span>
              <span className="text-xs text-slate-brand">courses</span>
            </div>
          </div>
          <ul className="space-y-2 text-sm">
            {data.map((row) => (
              <li key={row.level} className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ background: RISK_COLORS[row.level] }} />
                <span className="text-slate-brand">{row.name}</span>
                <span className="font-medium">{row.value}</span>
                <span className="text-xs text-slate-brand">({percent(row.value / total)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

export function PeriodTrendChart({ data, passMark = 10 }: { data: Trends["grades_by_period"]; passMark?: number }) {
  const shown = (["math", "portuguese"] as const).filter((s) => data.some((row) => row[s] !== undefined && row[s] !== null));
  return (
    <ChartCard
      title="Average grade through the course"
      subtitle="Average across all current records, per grading period."
      head={["Period", ...shown.map((s) => SUBJECT_LABELS[s])]}
      rows={data.map((row) => [row.period, ...shown.map((s) => row[s] ?? "—")])}
    >
      {shown.length === 0 ? (
        <EmptyState title="No grades yet" />
      ) : (
        <>
          {shown.length > 1 && <Legend items={subjectLegend(shown)} />}
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ left: -20, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={{ stroke: "#CBD5E1" }} />
              <YAxis domain={[0, 20]} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP.contentStyle} />
              <ReferenceLine y={passMark} stroke="#64748B" strokeDasharray="4 4" />
              {shown.map((s) => (
                <Line isAnimationActive={false} key={s} type="monotone" dataKey={s} name={SUBJECT_LABELS[s]} stroke={SERIES[s]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

export function PredictionActivityChart({ data }: { data: Trends["predictions_per_day"] }) {
  return (
    <ChartCard title="Predictions run per day" subtitle="Real run dates, including demonstration seeding." head={["Date", "Predictions"]} rows={data.map((row) => [row.date, row.count])}>
      {data.length === 0 ? (
        <EmptyState title="No predictions yet" />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: "#CBD5E1" }} />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP} />
            <Bar isAnimationActive={false} dataKey="count" name="Predictions" fill={SERIES.math} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function SubjectComparisonChart({ subjects }: { subjects: SubjectPerformance[] }) {
  const data = subjects.map((row) => ({
    name: SUBJECT_LABELS[row.subject],
    subject: row.subject,
    passRate: row.pass_rate === null ? null : Math.round(row.pass_rate * 1000) / 10,
  }));
  return (
    <ChartCard
      title="Subject comparison"
      subtitle="Share of recorded final grades at or above the pass mark."
      head={["Subject", "Records", "Avg first period", "Avg second period", "Avg final", "Pass rate", "Avg absences"]}
      rows={subjects.map((row) => [SUBJECT_LABELS[row.subject], row.records, row.average_period1 ?? "—", row.average_period2 ?? "—", row.average_final ?? "—", percent(row.pass_rate, 1), row.average_absences ?? "—"])}
    >
      {subjects.length === 0 ? (
        <EmptyState title="No academic records yet" />
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(120, subjects.length * 72)}>
          <BarChart data={data} layout="vertical" margin={{ left: 16, right: 40 }}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={88} />
            <Tooltip {...TOOLTIP} formatter={(value) => [`${value}%`, "Pass rate"]} />
            <Bar isAnimationActive={false} dataKey="passRate" name="Pass rate" radius={[0, 4, 4, 0]} maxBarSize={28} label={{ position: "right", fontSize: 12, fill: "#111827", formatter: (v: unknown) => (v === null ? "" : `${v}%`) }}>
              {data.map((row) => <Cell key={row.subject} fill={SERIES[row.subject]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/** One line per course, across the three grading periods. */
export function StudentProgressChart({ records, passMark = 10 }: { records: AcademicRecord[]; passMark?: number }) {
  const courses = records.map((record) => ({ key: `r${record.id}`, label: `${SUBJECT_LABELS[record.subject]} ${record.academic_year}`, record }));
  const rows = [
    { period: "First period", field: "period1_grade" as const },
    { period: "Second period", field: "period2_grade" as const },
    { period: "Final", field: "final_grade" as const },
  ].map(({ period, field }) => ({ period, ...Object.fromEntries(courses.map((c) => [c.key, c.record[field]])) }));
  const hasGrades = records.some((r) => r.period1_grade !== null || r.period2_grade !== null || r.final_grade !== null);
  return (
    <ChartCard
      title="Progress through the course"
      subtitle={`Grades on the 0-20 scale. The dashed line marks the pass mark of ${passMark}.`}
      head={["Course", "First period", "Second period", "Final"]}
      rows={courses.map((c) => [c.label, c.record.period1_grade ?? "—", c.record.period2_grade ?? "—", c.record.final_grade ?? "—"])}
    >
      {!hasGrades ? (
        <EmptyState title="No grades recorded yet" />
      ) : (
        <>
          {courses.length > 1 && <Legend items={courses.map((c) => ({ label: c.label, color: SERIES[c.record.subject] }))} />}
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rows} margin={{ left: -20, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={{ stroke: "#CBD5E1" }} />
              <YAxis domain={[0, 20]} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP.contentStyle} />
              <ReferenceLine y={passMark} stroke="#64748B" strokeDasharray="4 4" />
              {courses.map((c) => (
                <Line isAnimationActive={false} key={c.key} type="monotone" dataKey={c.key} name={c.label} stroke={SERIES[c.record.subject]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

export function RocChart({ classifier }: { classifier: ModelMetrics["classifier"] }) {
  const diagonal = [{ x: 0, y: 0 }, { x: 1, y: 1 }] as const;
  return (
    <ChartCard
      title="ROC curve (test set)"
      subtitle={`Area under the curve: ${classifier.test.roc_auc.toFixed(3)}. The dashed diagonal is what guessing would give.`}
      head={["False positive rate", "True positive rate"]}
      rows={classifier.roc_curve.map((point) => [point.fpr, point.tpr])}
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart margin={{ left: -10, right: 16, top: 8, bottom: 16 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey="fpr" domain={[0, 1]} tick={AXIS} tickLine={false} label={{ value: "False positive rate", position: "insideBottom", offset: -8, ...AXIS }} />
          <YAxis type="number" dataKey="tpr" domain={[0, 1]} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP.contentStyle} />
          <ReferenceLine segment={diagonal} stroke={NEUTRAL} strokeDasharray="4 4" />
          <Line isAnimationActive={false} data={classifier.roc_curve} dataKey="tpr" name="True positive rate" stroke={SERIES.math} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CalibrationChart({ classifier }: { classifier: ModelMetrics["classifier"] }) {
  const points = classifier.calibration;
  const diagonal = [{ x: 0, y: 0 }, { x: 1, y: 1 }] as const;
  return (
    <ChartCard
      title="Calibration (test set)"
      subtitle="Estimated probability against how often it really happened. Closer to the diagonal is better."
      head={["Estimated", "Observed"]}
      rows={points.map((point) => [percent(point.predicted, 1), percent(point.observed, 1)])}
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart margin={{ left: -10, right: 16, top: 8, bottom: 16 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey="predicted" domain={[0, 1]} tick={AXIS} tickLine={false} label={{ value: "Estimated probability", position: "insideBottom", offset: -8, ...AXIS }} />
          <YAxis type="number" dataKey="observed" domain={[0, 1]} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP.contentStyle} />
          <ReferenceLine segment={diagonal} stroke={NEUTRAL} strokeDasharray="4 4" />
          <Line isAnimationActive={false} data={points} dataKey="observed" name="Observed rate" stroke={SERIES.math} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FeatureImportanceChart({ classifier }: { classifier: ModelMetrics["classifier"] }) {
  const data = classifier.feature_importance;
  return (
    <ChartCard
      title="What the model relies on most"
      subtitle="Permutation importance: how much test performance drops when a feature is shuffled."
      head={["Feature", "Importance", "Std"]}
      rows={data.map((row) => [row.label, row.importance, row.std])}
    >
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={150} interval={0} />
          <Tooltip {...TOOLTIP} />
          <Bar isAnimationActive={false} dataKey="importance" name="Importance" fill={SERIES.math} radius={[0, 4, 4, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ActualVsPredictedChart({ regressor }: { regressor: ModelMetrics["regressor"] }) {
  const diagonal = [{ x: 0, y: 0 }, { x: 20, y: 20 }] as const;
  return (
    <ChartCard
      title="Predicted against actual final grade (test set)"
      subtitle="Each dot is one held-out course. Dots on the diagonal are exact predictions."
      head={["Actual", "Predicted"]}
      rows={regressor.actual_vs_predicted.map((point) => [point.actual, point.predicted])}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ left: -10, right: 16, top: 8, bottom: 16 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey="actual" name="Actual" domain={[0, 20]} tick={AXIS} tickLine={false} label={{ value: "Actual final grade", position: "insideBottom", offset: -8, ...AXIS }} />
          <YAxis type="number" dataKey="predicted" name="Predicted" domain={[0, 20]} tick={AXIS} tickLine={false} axisLine={false} />
          <ZAxis range={[28, 28]} />
          <Tooltip contentStyle={TOOLTIP.contentStyle} cursor={{ strokeDasharray: "3 3" }} />
          <ReferenceLine segment={diagonal} stroke={NEUTRAL} strokeDasharray="4 4" />
          <Scatter isAnimationActive={false} data={regressor.actual_vs_predicted} fill={SERIES.math} fillOpacity={0.55} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ConfusionMatrix({ matrix }: { matrix: ModelMetrics["classifier"]["confusion_matrix"] }) {
  const cells = [
    { label: "Correctly not flagged", value: matrix.tn, hint: "Passed, not flagged", good: true },
    { label: "False alarm", value: matrix.fp, hint: "Passed, but flagged", good: false },
    { label: "Missed", value: matrix.fn, hint: "Below pass, not flagged", good: false },
    { label: "Correctly flagged", value: matrix.tp, hint: "Below pass, flagged", good: true },
  ];
  return (
    <Card>
      <CardTitle title="Confusion matrix (test set)" subtitle="Counts of held-out courses, with flagging at the moderate threshold." />
      <div className="grid grid-cols-2 gap-2">
        {cells.map((cell) => (
          <div key={cell.label} className={`rounded-xl p-4 ${cell.good ? "bg-lavender" : "bg-slate-100"}`}>
            <p className="text-2xl font-semibold">{cell.value}</p>
            <p className="text-sm font-medium">{cell.label}</p>
            <p className="text-xs text-slate-brand">{cell.hint}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
