import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import type { AcademicRecord, Page, PredictionDetail, PredictionOptions, StageKey, StudentDetail, StudentListItem } from "../api/types";
import { useApi, useDebounced } from "../api/useApi";
import { PredictionResult } from "../components/PredictionResult";
import { Button, Card, CardTitle, EmptyState, ErrorState, LoadingBlock, PageHeader, SelectField, TextField } from "../components/ui";
import { SUBJECT_LABELS } from "../format";

type Values = Record<string, string>;

const DEFAULTS: Values = {
  subject: "math", studytime: "2", failures: "0", absences: "0",
  schoolsup: "no", activities: "no", higher: "yes", G1: "", G2: "",
};

function fromRecord(record: AcademicRecord): Values {
  return {
    subject: record.subject,
    studytime: String(record.study_time),
    failures: String(record.past_failures),
    absences: String(record.absences),
    schoolsup: record.school_support ? "yes" : "no",
    activities: record.activities ? "yes" : "no",
    higher: record.wants_higher_education ? "yes" : "no",
    G1: record.period1_grade === null ? "" : String(record.period1_grade),
    G2: record.period2_grade === null ? "" : String(record.period2_grade),
  };
}

/** The latest stage whose grades are all known, matching the backend's rule. */
function stageFor(record: AcademicRecord): StageKey {
  if (record.period1_grade === null) return "intake";
  return record.period2_grade === null ? "period1" : "period2";
}

export default function NewPredictionPage() {
  const [params] = useSearchParams();
  const options = useApi<PredictionOptions>("/predictions/options");
  const [stage, setStage] = useState<StageKey>("period1");
  const [values, setValues] = useState<Values>(DEFAULTS);
  const [studentId, setStudentId] = useState(params.get("student") ?? "");
  const [recordId, setRecordId] = useState(params.get("record") ?? "");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionDetail | null>(null);
  const q = useDebounced(search);

  const matches = useApi<Page<StudentListItem>>(q ? "/students" : null, { q, page_size: 8 });
  const student = useApi<StudentDetail>(studentId ? `/students/${studentId}` : null);
  const selected = studentId ? student.data : null;
  const record = useMemo(() => selected?.records.find((r) => String(r.id) === recordId) ?? null, [selected, recordId]);

  // Start from the stored record, so that the entered values match what is on file.
  useEffect(() => {
    if (record) {
      setValues(fromRecord(record));
      setStage(stageFor(record));
    }
  }, [record]);

  const stageInfo = options.data?.stages.find((s) => s.key === stage);
  const fields = stageInfo?.features ?? [];

  const update = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!options.data) return;
    setBusy(true);
    setError(null);
    const features: Record<string, string | number> = {};
    for (const name of fields) {
      const spec = options.data.features[name];
      features[name] = spec.kind === "int" ? Number(values[name]) : values[name];
    }
    try {
      const { data } = await api.post<PredictionDetail>("/predictions", {
        stage,
        features,
        student_id: studentId ? Number(studentId) : null,
        academic_record_id: recordId ? Number(recordId) : null,
      });
      setResult(data);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  if (options.error) return <Card><ErrorState message={options.error} onRetry={options.reload} /></Card>;

  return (
    <>
      <PageHeader title="New prediction" subtitle="Estimates the chance of a final course grade below the pass mark. It does not predict dropout." />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          {!options.data ? <LoadingBlock lines={10} /> : (
            <form onSubmit={submit} className="space-y-5">
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold">Student (optional)</legend>
                {selected ? (
                  <>
                    <p className="flex items-center justify-between gap-2 rounded-lg bg-lavender px-3 py-2 text-sm">
                      <span className="font-medium">{selected.full_name} ({selected.student_code})</span>
                      <button type="button" className="cursor-pointer text-brand hover:underline" onClick={() => { setStudentId(""); setRecordId(""); setValues(DEFAULTS); setSearch(""); }}>Change</button>
                    </p>
                    <SelectField label="Academic record" hint="Fills in the form from what is on file." value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                      <option value="">Enter values by hand</option>
                      {selected.records.map((r) => <option key={r.id} value={r.id}>{SUBJECT_LABELS[r.subject]} {r.academic_year}</option>)}
                    </SelectField>
                  </>
                ) : studentId && student.error ? (
                  <p role="alert" className="text-sm text-red-700">{student.error}</p>
                ) : (
                  <div>
                    <TextField label="Find a student" placeholder="Name or code" hint="Leave blank to try a hypothetical scenario." value={search} onChange={(e) => setSearch(e.target.value)} />
                    {q && matches.data && (
                      matches.data.items.length === 0 ? <p className="mt-2 text-sm text-slate-brand">No students found.</p> : (
                        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                          {matches.data.items.map((item) => (
                            <li key={item.id}>
                              <button type="button" onClick={() => setStudentId(String(item.id))} className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-lavender">
                                {item.full_name} <span className="text-slate-brand">({item.student_code})</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                )}
              </fieldset>

              <SelectField label="Point in the course" hint={stageInfo?.description} value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
                {options.data.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </SelectField>

              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold">Academic information</legend>
                {fields.map((name) => {
                  const spec = options.data!.features[name];
                  if (spec.kind === "choice") {
                    const locked = name === "subject" && record !== null;
                    return (
                      <SelectField key={name} label={spec.label} hint={spec.help} disabled={locked} value={values[name]} onChange={(e) => update(name, e.target.value)}>
                        {spec.choices.map((choice) => (
                          <option key={choice} value={choice}>
                            {name === "subject" ? SUBJECT_LABELS[choice as "math"] : choice === "yes" ? "Yes" : "No"}
                          </option>
                        ))}
                      </SelectField>
                    );
                  }
                  return (
                    <TextField key={name} label={spec.label} hint={spec.help} type="number" required step={1} min={spec.minimum ?? undefined} max={spec.maximum ?? undefined} value={values[name]} onChange={(e) => update(name, e.target.value)} />
                  );
                })}
              </fieldset>

              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <Button type="submit" busy={busy} className="w-full"><Sparkles className="size-4" aria-hidden />Run prediction</Button>
            </form>
          )}
        </Card>

        <div aria-live="polite">
          {result ? (
            <>
              <PredictionResult prediction={result} />
              <p className="mt-4 text-sm">
                <Link to={`/predictions/${result.id}`} className="font-medium text-brand hover:underline">Open this prediction to add your review</Link>
              </p>
            </>
          ) : (
            <Card>
              <CardTitle title="Result" />
              <EmptyState title="No result yet" message="Fill in the form and run a prediction. The result here comes directly from the trained model." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
