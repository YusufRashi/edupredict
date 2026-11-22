import { AlertTriangle, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { ModelInfo, StageKey } from "../api/types";
import { useApi } from "../api/useApi";
import { ModelEvaluationCharts, StageSelect, useModelMetrics } from "../components/ModelEvaluation";
import { Card, CardTitle, ErrorState, LoadingBlock, LoadingCards, Notice, PageHeader, Pill, TD, Table } from "../components/ui";
import { columnLabel, dateTime, percent } from "../format";

const ratio = (value: number | null) => (value === null ? "—" : value.toFixed(3));

function Comparison({ stage }: { stage: StageKey }) {
  const { data, error, reload } = useModelMetrics(stage);
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (!data) return <Card><LoadingBlock /></Card>;
  const { classifier, regressor } = data;
  return (
    <>
      <Card>
        <CardTitle title="Algorithms compared" subtitle={`Chosen by ${classifier.selection_metric} (classifier) and ${regressor.selection_metric} (regressor). Test data was not used to choose.`} />
        <h3 className="mb-1 text-sm font-medium">Below-pass classifier</h3>
        <Table head={["Algorithm", "CV mean", "Accuracy", "Precision", "Recall", "F1", "ROC-AUC", ""]}>
          {classifier.comparison.map((row) => (
            <tr key={row.algorithm}>
              <TD className="font-medium">{row.algorithm}</TD>
              <TD>{row.cv_mean.toFixed(3)} ± {row.cv_std.toFixed(3)}</TD>
              <TD>{row.validation.accuracy.toFixed(3)}</TD>
              <TD>{row.validation.precision.toFixed(3)}</TD>
              <TD>{row.validation.recall.toFixed(3)}</TD>
              <TD>{row.validation.f1.toFixed(3)}</TD>
              <TD>{row.validation.roc_auc.toFixed(3)}</TD>
              <TD>{row.selected && <Pill tone="brand">Selected</Pill>}</TD>
            </tr>
          ))}
        </Table>
        <h3 className="mt-6 mb-1 text-sm font-medium">Final grade regressor</h3>
        <Table head={["Algorithm", "CV mean", "MAE", "MSE", "RMSE", "R²", ""]}>
          {regressor.comparison.map((row) => (
            <tr key={row.algorithm}>
              <TD className="font-medium">{row.algorithm}</TD>
              <TD>{row.cv_mean.toFixed(3)} ± {row.cv_std.toFixed(3)}</TD>
              <TD>{row.validation.mae.toFixed(3)}</TD>
              <TD>{row.validation.mse.toFixed(3)}</TD>
              <TD>{row.validation.rmse.toFixed(3)}</TD>
              <TD>{row.validation.r2.toFixed(3)}</TD>
              <TD>{row.selected && <Pill tone="brand">Selected</Pill>}</TD>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-slate-brand">Values above come from the validation split. The grade range shown with predictions aims for 80% and covered {percent(regressor.interval_coverage_test, 1)} of the test set.</p>
      </Card>

      <Card>
        <CardTitle title="Outcomes by concern level (test set)" subtitle={`Moderate starts at ${percent(classifier.risk_bands.moderate_from)} and higher at ${percent(classifier.risk_bands.high_from)}.`} />
        <Table head={["Level", "Courses", "Actually below pass"]}>
          {classifier.band_outcomes.map((row) => (
            <tr key={row.level}>
              <TD className="capitalize">{row.level}</TD>
              <TD>{row.students}</TD>
              <TD>{percent(row.observed_below_pass_rate, 1)}</TD>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <CardTitle title="Fairness audit (test set)" subtitle="Differences between groups. These attributes are used only for this audit, never as model inputs." />
        <div className="mb-3"><Notice tone="warning">Groups are small, so differences are uncertain. A difference here is a reason to look closer, not a verdict either way. Groups marked small have too few students to compare.</Notice></div>
        {data.fairness.map((audit) => (
          <div key={audit.attribute} className="mb-5 last:mb-0">
            <h3 className="mb-1 text-sm font-medium">{columnLabel(audit.attribute)}</h3>
            <Table head={["Group", "Courses", "Actually below pass", "Flagged", "Recall", "False positive rate", "Grade MAE", ""]}>
              {audit.groups.map((group) => (
                <tr key={group.group}>
                  <TD>{group.group}</TD>
                  <TD>{group.n}</TD>
                  <TD>{percent(group.actual_below_pass_rate, 1)}</TD>
                  <TD>{percent(group.flagged_rate, 1)}</TD>
                  <TD>{ratio(group.recall)}</TD>
                  <TD>{ratio(group.false_positive_rate)}</TD>
                  <TD>{group.grade_mae.toFixed(2)}</TD>
                  <TD>{group.small_sample && <Pill tone="amber">Small</Pill>}</TD>
                </tr>
              ))}
            </Table>
          </div>
        ))}
      </Card>
    </>
  );
}

export default function ModelPage() {
  const { data, error, reload } = useApi<ModelInfo>("/model/info");
  const [stage, setStage] = useState<StageKey>("period1");

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (!data) return <LoadingCards />;
  const current = data.stages.find((item) => item.key === stage) ?? data.stages[0];
  const { dataset } = data;

  return (
    <>
      <PageHeader title="Model information" subtitle="Read directly from the metadata saved by the training run." />
      <div className="space-y-4">
        <Card>
          <CardTitle title="What the model predicts" />
          <p className="text-sm">{data.target.description}</p>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle title="Dataset" />
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-brand">Source</dt><dd><a href={dataset.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">{dataset.source}<ExternalLink className="size-3" aria-hidden /></a></dd></div>
              <div><dt className="text-slate-brand">Licence</dt><dd className="font-medium">{dataset.licence}</dd></div>
              <div><dt className="text-slate-brand">Context</dt><dd>{dataset.context}</dd></div>
              <div><dt className="text-slate-brand">Size</dt><dd>{dataset.cleaning.rows_after_cleaning.toLocaleString()} course rows from {dataset.cleaning.distinct_student_groups} distinct student groups, {dataset.cleaning.missing_values} missing values</dd></div>
              <div><dt className="text-slate-brand">Citation</dt><dd className="text-xs">{dataset.citation}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardTitle title="Training" />
            <dl className="mb-4 space-y-2 text-sm">
              <div><dt className="text-slate-brand">Trained</dt><dd className="font-medium">{dateTime(data.trained_at)}</dd></div>
              <div><dt className="text-slate-brand">Version</dt><dd className="font-mono text-xs break-all">{data.version}</dd></div>
              <div><dt className="text-slate-brand">Split</dt><dd>{dataset.split_method}</dd></div>
            </dl>
            <Table head={["Split", "Rows", "Student groups", "Below pass"]}>
              {Object.entries(dataset.splits).map(([name, split]) => (
                <tr key={name}>
                  <TD className="capitalize">{name}</TD>
                  <TD>{split.rows}</TD>
                  <TD>{split.student_groups}</TD>
                  <TD>{percent(split.at_risk_rate, 1)}</TD>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <Card>
          <CardTitle title="Limitations" subtitle="Please read these before relying on an estimate." />
          <ul className="space-y-2 text-sm">
            {data.limitations.map((item) => (
              <li key={item} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />{item}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle title="Excluded from the model" subtitle="Columns in the dataset that the deployed models never see, and why." />
          <div className="max-h-72 overflow-y-auto">
            <Table head={["Column", "Reason"]}>
              {Object.entries(data.feature_policy.excluded).map(([name, reason]) => (
                <tr key={name}><TD className="font-mono text-xs">{name}</TD><TD>{reason}</TD></tr>
              ))}
            </Table>
          </div>
        </Card>

        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div>
            <h2 className="text-lg font-semibold">{current.label}: selected algorithms and evaluation</h2>
            <p className="text-sm text-slate-brand">
              {current.description} Classifier: {current.classifier_algorithm}. Regressor: {current.regressor_algorithm}.
              Test MAE {current.regressor_test.mae.toFixed(2)}, MSE {current.regressor_test.mse.toFixed(2)}, RMSE {current.regressor_test.rmse.toFixed(2)}, R² {current.regressor_test.r2.toFixed(3)}.
              Test accuracy {current.classifier_test.accuracy.toFixed(3)}, F1 {current.classifier_test.f1.toFixed(3)}.
            </p>
          </div>
          <StageSelect stage={stage} onChange={setStage} />
        </div>
        <ModelEvaluationCharts stage={stage} />
        <Comparison stage={stage} />
      </div>
    </>
  );
}
