import type { ModelMetrics, StageKey } from "../api/types";
import { useApi } from "../api/useApi";
import { STAGE_LABELS } from "../format";
import { ActualVsPredictedChart, CalibrationChart, ConfusionMatrix, FeatureImportanceChart, RocChart } from "./charts";
import { Card, ErrorState, LoadingBlock, SelectField, StatCard } from "./ui";

export function StageSelect({ stage, onChange }: { stage: StageKey; onChange: (stage: StageKey) => void }) {
  return (
    <div className="max-w-xs">
      <SelectField label="Model stage" value={stage} onChange={(e) => onChange(e.target.value as StageKey)}>
        {(Object.keys(STAGE_LABELS) as StageKey[]).map((key) => <option key={key} value={key}>{STAGE_LABELS[key]}</option>)}
      </SelectField>
    </div>
  );
}

export function useModelMetrics(stage: StageKey) {
  return useApi<ModelMetrics>("/model/metrics", { stage });
}

/** All values come from held-out test data, as saved by the training run. */
export function ModelEvaluationCharts({ stage }: { stage: StageKey }) {
  const { data, error, reload } = useModelMetrics(stage);
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (!data) return <Card><LoadingBlock lines={8} /></Card>;
  const { test } = data.classifier;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="ROC-AUC" value={test.roc_auc.toFixed(3)} hint={`Baseline ${data.classifier.baseline_test.roc_auc.toFixed(3)}`} />
        <StatCard label="Recall" value={test.recall.toFixed(3)} hint="Share of below-pass results it flagged" />
        <StatCard label="Precision" value={test.precision.toFixed(3)} hint="Share of flags that were below pass" />
        <StatCard label="Grade RMSE" value={data.regressor.test.rmse.toFixed(2)} hint={`Baseline ${data.regressor.baseline_test.rmse.toFixed(2)}, on the 0-20 scale`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <RocChart classifier={data.classifier} />
        <ConfusionMatrix matrix={data.classifier.confusion_matrix} />
        <CalibrationChart classifier={data.classifier} />
        <ActualVsPredictedChart regressor={data.regressor} />
      </div>
      <FeatureImportanceChart classifier={data.classifier} />
    </div>
  );
}
