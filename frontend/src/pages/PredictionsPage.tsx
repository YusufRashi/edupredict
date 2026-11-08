import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Page, PredictionSummary } from "../api/types";
import { useApi, useDebounced } from "../api/useApi";
import { PredictionTable } from "../components/PredictionTable";
import { buttonClass, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, SelectField, TextField } from "../components/ui";

export default function PredictionsPage() {
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("");
  const [stage, setStage] = useState("");
  const [subject, setSubject] = useState("");
  const [dataType, setDataType] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(query);

  useEffect(() => setPage(1), [q, risk, stage, subject, dataType]);

  const { data, error, reload } = useApi<Page<PredictionSummary>>("/predictions", {
    q, risk_level: risk, stage, subject, is_demo: dataType, page, page_size: 15,
  });
  const filtered = Boolean(q || risk || stage || subject || dataType);

  return (
    <>
      <PageHeader
        title="Predictions"
        subtitle="Every prediction that has been run, newest first."
        actions={<Link to="/predictions/new" className={buttonClass()}><Sparkles className="size-4" aria-hidden />New prediction</Link>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField label="Student" placeholder="Name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
          <SelectField label="Concern" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option value="">All</option><option value="low">Lower</option><option value="moderate">Moderate</option><option value="high">Higher</option>
          </SelectField>
          <SelectField label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All</option><option value="intake">Start of course</option><option value="period1">After first period</option><option value="period2">After second period</option>
          </SelectField>
          <SelectField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All</option><option value="math">Mathematics</option><option value="portuguese">Portuguese</option>
          </SelectField>
          <SelectField label="Data type" value={dataType} onChange={(e) => setDataType(e.target.value)}>
            <option value="">All</option><option value="false">Institution</option><option value="true">Demonstration</option>
          </SelectField>
        </div>
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <LoadingBlock lines={8} /> : data.items.length === 0 ? (
          <EmptyState title={filtered ? "No predictions match these filters" : "No predictions yet"} action={filtered ? undefined : <Link to="/predictions/new" className={buttonClass()}>Run a prediction</Link>} />
        ) : (
          <>
            <PredictionTable items={data.items} detailed />
            <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
