import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import type { PredictionDetail } from "../api/types";
import { useApi } from "../api/useApi";
import { PredictionResult } from "../components/PredictionResult";
import { Button, Card, CardTitle, ErrorState, LoadingCards, PageHeader, TextAreaField } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { dateTime } from "../format";

export default function PredictionDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, status, reload } = useApi<PredictionDetail>(`/predictions/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (error) return <Card><ErrorState message={status === 404 ? "This prediction could not be found." : error} onRetry={status === 404 ? undefined : reload} /></Card>;
  if (!data) return <LoadingCards />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`/predictions/${data.id}/review`, { note: note.trim() });
      toast.success("Your review was recorded.");
      setNote("");
      reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/predictions" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-brand hover:text-navy">
        <ArrowLeft className="size-4" aria-hidden /> Predictions
      </Link>
      <PageHeader title={`Prediction #${data.id}`} subtitle={`Run ${dateTime(data.created_at)}${data.requested_by_name ? ` by ${data.requested_by_name}` : ""}`} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <PredictionResult prediction={data} />
        <div className="space-y-4">
          <Card>
            <CardTitle title="Your review" subtitle="Record your own judgment next to the estimate." />
            <form onSubmit={submit} className="space-y-3">
              <TextAreaField label="Note" required rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="submit" busy={busy} disabled={!note.trim()}>Save review</Button>
            </form>
          </Card>
          <Card>
            <CardTitle title="History" />
            <ol className="space-y-3 text-sm">
              {data.history.map((entry, index) => (
                <li key={index}>
                  <p className="font-medium capitalize">{entry.action}{entry.actor_name ? ` by ${entry.actor_name}` : ""}</p>
                  {entry.note && <p className="whitespace-pre-wrap">{entry.note}</p>}
                  <p className="text-xs text-slate-brand">{dateTime(entry.created_at)}</p>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardTitle title="Model used" />
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-brand">Risk classifier</dt><dd className="font-medium">{data.classifier_algorithm}</dd></div>
              <div><dt className="text-slate-brand">Grade regressor</dt><dd className="font-medium">{data.regressor_algorithm}</dd></div>
              <div><dt className="text-slate-brand">Version</dt><dd className="font-mono text-xs break-all">{data.model_version}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
