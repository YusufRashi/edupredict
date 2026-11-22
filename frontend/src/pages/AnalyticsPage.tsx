import { useState } from "react";
import type { Distribution, Performance, StageKey, Trends } from "../api/types";
import { useApi } from "../api/useApi";
import { GradeDistributionChart, PeriodTrendChart, PredictionActivityChart, RiskDonut, SubjectComparisonChart } from "../components/charts";
import { ModelEvaluationCharts, StageSelect } from "../components/ModelEvaluation";
import { Card, ErrorState, LoadingBlock, PageHeader, SelectField } from "../components/ui";

function Slot({ error, retry }: { error: string | null; retry: () => void }) {
  return <Card>{error ? <ErrorState message={error} onRetry={retry} /> : <LoadingBlock lines={7} />}</Card>;
}

export default function AnalyticsPage() {
  const [subject, setSubject] = useState<"" | "math" | "portuguese">("");
  const [days, setDays] = useState("30");
  const [stage, setStage] = useState<StageKey>("period1");

  const distribution = useApi<Distribution>("/analytics/distribution", { subject });
  const trends = useApi<Trends>("/analytics/trends", { subject, days });
  const performance = useApi<Performance>("/analytics/performance");

  return (
    <>
      <PageHeader title="Analytics" subtitle="Calculated live from the records and predictions in this system, including any demonstration data." />
      <div className="no-print mb-4 grid max-w-md grid-cols-2 gap-3">
        <SelectField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value as typeof subject)}>
          <option value="">All subjects</option>
          <option value="math">Mathematics</option>
          <option value="portuguese">Portuguese</option>
        </SelectField>
        <SelectField label="Prediction activity" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Last 7 active days</option>
          <option value="30">Last 30 active days</option>
          <option value="90">Last 90 active days</option>
        </SelectField>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {distribution.data ? <GradeDistributionChart data={distribution.data} subject={subject} /> : <Slot error={distribution.error} retry={distribution.reload} />}
        {distribution.data ? <RiskDonut counts={distribution.data.risk_distribution} /> : <Slot error={distribution.error} retry={distribution.reload} />}
        {trends.data ? <PeriodTrendChart data={trends.data.grades_by_period} passMark={distribution.data?.pass_mark} /> : <Slot error={trends.error} retry={trends.reload} />}
        {trends.data ? <PredictionActivityChart data={trends.data.predictions_per_day} /> : <Slot error={trends.error} retry={trends.reload} />}
      </div>
      <div className="mt-4">
        {performance.data ? <SubjectComparisonChart subjects={performance.data.subjects} /> : <Slot error={performance.error} retry={performance.reload} />}
      </div>

      <section aria-labelledby="evaluation" className="mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="evaluation" className="text-lg font-semibold">Model evaluation</h2>
            <p className="text-sm text-slate-brand">Results on the held-out UCI test set, which is not your data.</p>
          </div>
          <StageSelect stage={stage} onChange={setStage} />
        </div>
        <ModelEvaluationCharts stage={stage} />
      </section>
    </>
  );
}
