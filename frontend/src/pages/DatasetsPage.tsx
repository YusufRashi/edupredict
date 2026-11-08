import { Download, Play, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api, downloadFile, errorMessage } from "../api/client";
import type { Dataset, Page } from "../api/types";
import { useApi } from "../api/useApi";
import { Button, Card, CardTitle, CheckboxField, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Pagination, Pill, TD, Table, TextField } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { columnLabel, dateTime, fileSize } from "../format";

const STATUS_TONE = { validated: "brand", processed: "green", rejected: "red" } as const;

function ReportModal({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const report = dataset.validation_report;
  return (
    <Modal title={dataset.name} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p><Pill tone={STATUS_TONE[dataset.status]}>{columnLabel(dataset.status)}</Pill> <span className="ml-1 text-slate-brand">{dataset.row_count} {dataset.row_count === 1 ? "row" : "rows"}, {dataset.column_count} columns, {fileSize(dataset.size_bytes)}</span></p>
        {report.file_error && <p role="alert" className="text-red-700">{report.file_error}</p>}
        {report.profile && (
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt className="text-slate-brand">Distinct students</dt><dd className="font-medium">{report.profile.distinct_students}</dd></div>
            <div><dt className="text-slate-brand">Rows by subject</dt><dd className="font-medium">{Object.entries(report.profile.subjects).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}</dd></div>
            <div><dt className="text-slate-brand">Final grades present</dt><dd className="font-medium">{report.profile.final_grades_present}</dd></div>
            <div><dt className="text-slate-brand">Average final grade</dt><dd className="font-medium">{report.profile.average_final_grade ?? "—"}</dd></div>
          </dl>
        )}
        {report.errors.length > 0 && (
          <div>
            <p className="mb-1 font-medium">{report.error_count} problems found{report.error_count > report.errors.length ? `, first ${report.errors.length} shown` : ""}</p>
            <div className="max-h-64 overflow-y-auto">
              <Table head={["Line", "Column", "Problem"]}>
                {report.errors.map((item, index) => (
                  <tr key={index}><TD>{item.line}</TD><TD className="font-mono text-xs">{item.column}</TD><TD>{item.message}</TD></tr>
                ))}
              </Table>
            </div>
          </div>
        )}
        {dataset.processing_summary && (
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(dataset.processing_summary).map(([key, value]) => (
              <div key={key}><dt className="text-slate-brand">{columnLabel(key)}</dt><dd className="font-medium">{value}</dd></div>
            ))}
          </dl>
        )}
      </div>
    </Modal>
  );
}

export default function DatasetsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const datasets = useApi<Page<Dataset>>("/datasets", { page, page_size: 10 });
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Dataset | null>(null);
  const [importing, setImporting] = useState<Dataset | null>(null);
  const [runPredictions, setRunPredictions] = useState(false);
  const [deleting, setDeleting] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    if (name.trim()) form.append("name", name.trim());
    try {
      const { data } = await api.post<Dataset>("/datasets/upload", form);
      if (data.status === "rejected") {
        toast.error("The file failed validation, so it was not kept. See the problems listed.");
        setViewing(data);
      } else {
        toast.success("The file passed validation and is ready to import.");
      }
      setFile(null);
      setName("");
      if (fileInput.current) fileInput.current.value = "";
      datasets.reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setUploading(false);
    }
  };

  const process = async () => {
    if (!importing) return;
    setBusy(true);
    try {
      const { data } = await api.post<Dataset>(`/datasets/${importing.id}/process`, null, { params: { run_predictions: runPredictions } });
      toast.success("The dataset was imported.");
      setImporting(null);
      setRunPredictions(false);
      setViewing(data);
      datasets.reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/datasets/${deleting.id}`);
      toast.success("The upload was deleted.");
      setDeleting(null);
      datasets.reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const template = () => downloadFile("/datasets/template", {}, "edupredict-import-template.csv").catch((failure) => toast.error(errorMessage(failure)));

  if (datasets.status === 403) {
    return (
      <>
        <PageHeader title="Datasets" />
        <Card><ErrorState message="You do not have permission to manage datasets. An administrator can turn this on for educators in Settings." /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Datasets" subtitle="Import academic records from a CSV file. Files are validated first, and nothing changes until you import." actions={<Button variant="secondary" onClick={template}><Download className="size-4" aria-hidden />Download template</Button>} />
      <div className="space-y-4">
        <Card>
          <CardTitle title="Upload a CSV" subtitle="UTF-8 CSV using the template's columns. Every row must pass for the file to be accepted." />
          <form onSubmit={upload} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label htmlFor="dataset-file" className="mb-1 block text-sm font-medium">File</label>
              <input id="dataset-file" ref={fileInput} type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-lavender file:px-2 file:py-1 file:text-sm" />
            </div>
            <TextField label="Name (optional)" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" busy={uploading} disabled={!file}><Upload className="size-4" aria-hidden />Upload</Button>
          </form>
        </Card>

        <Card>
          <CardTitle title="Uploads" />
          {datasets.error ? <ErrorState message={datasets.error} onRetry={datasets.reload} /> : !datasets.data ? <LoadingBlock /> : datasets.data.items.length === 0 ? <EmptyState title="No uploads yet" message="Download the template to see the expected format." /> : (
            <>
              <Table head={["Name", "Status", "Rows", "Size", "Uploaded", "By", ""]}>
                {datasets.data.items.map((dataset) => (
                  <tr key={dataset.id}>
                    <TD><button type="button" className="cursor-pointer font-medium text-brand hover:underline" onClick={() => setViewing(dataset)}>{dataset.name}</button></TD>
                    <TD><Pill tone={STATUS_TONE[dataset.status]}>{columnLabel(dataset.status)}</Pill></TD>
                    <TD>{dataset.row_count}</TD>
                    <TD>{fileSize(dataset.size_bytes)}</TD>
                    <TD className="whitespace-nowrap text-slate-brand">{dateTime(dataset.created_at)}</TD>
                    <TD>{dataset.uploaded_by_name ?? "—"}</TD>
                    <TD className="text-right whitespace-nowrap">
                      {dataset.status === "validated" && <Button variant="ghost" onClick={() => setImporting(dataset)}><Play className="size-4" aria-hidden />Import</Button>}
                      <Button variant="ghost" aria-label={`Delete ${dataset.name}`} onClick={() => setDeleting(dataset)}><Trash2 className="size-4" aria-hidden /></Button>
                    </TD>
                  </tr>
                ))}
              </Table>
              <Pagination page={datasets.data.page} pages={datasets.data.pages} total={datasets.data.total} onChange={setPage} />
            </>
          )}
        </Card>
      </div>

      {viewing && <ReportModal dataset={viewing} onClose={() => setViewing(null)} />}
      {importing && (
        <Modal title={`Import ${importing.name}?`} onClose={() => setImporting(null)}>
          <p className="text-sm text-slate-brand">This adds or updates {importing.row_count} academic records. An existing student code or course is updated with the file's values. All rows succeed together, or nothing changes.</p>
          <div className="mt-4"><CheckboxField label="Also run predictions" hint="Scores each record at the latest stage its grades allow." checked={runPredictions} onChange={(e) => setRunPredictions(e.target.checked)} /></div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImporting(null)}>Cancel</Button>
            <Button busy={busy} onClick={process}>Import</Button>
          </div>
        </Modal>
      )}
      {deleting && <ConfirmDialog title="Delete this upload?" message="This removes the uploaded file and its entry. Students already imported from it stay." confirmLabel="Delete upload" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </>
  );
}
