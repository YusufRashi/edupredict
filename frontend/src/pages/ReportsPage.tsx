import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cleanParams, downloadFile, errorMessage } from "../api/client";
import type { Report } from "../api/types";
import { useApi } from "../api/useApi";
import { Button, Card, DemoBadge, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, SelectField, TD, Table } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { columnLabel, dateTime } from "../format";

type Kind = "performance" | "risk";

export default function ReportsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student_id") ?? "";
  const [kind, setKind] = useState<Kind>("performance");
  const [subject, setSubject] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [risk, setRisk] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = kind === "performance"
    ? { subject, year_group: yearGroup, student_id: studentId }
    : { subject, risk_level: risk };
  const yearGroups = useApi<string[]>("/students/year-groups");
  const { data, error, reload } = useApi<Report>(`/reports/${kind}`, filters);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(`/reports/${kind}`, cleanParams({ ...filters, format: "csv" }), `edupredict-${kind}-report.csv`);
      toast.success("Your CSV file has been downloaded.");
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Generate a report, then export it to CSV or print it."
        actions={
          <>
            <Button variant="secondary" busy={exporting} disabled={!data?.total} onClick={exportCsv}><Download className="size-4" aria-hidden />Export CSV</Button>
            <Button variant="secondary" disabled={!data?.total} onClick={() => window.print()}><Printer className="size-4" aria-hidden />Print</Button>
          </>
        }
      />

      <div className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Report" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="performance">Student performance</option>
          <option value="risk">Academic risk</option>
        </SelectField>
        <SelectField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">All</option><option value="math">Mathematics</option><option value="portuguese">Portuguese</option>
        </SelectField>
        {kind === "performance" ? (
          <SelectField label="Year group" value={yearGroup} onChange={(e) => setYearGroup(e.target.value)}>
            <option value="">All</option>
            {yearGroups.data?.map((value) => <option key={value} value={value}>{value}</option>)}
          </SelectField>
        ) : (
          <SelectField label="Concern level" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option value="">All</option><option value="low">Lower</option><option value="moderate">Moderate</option><option value="high">Higher</option>
          </SelectField>
        )}
      </div>

      {studentId && kind === "performance" && (
        <div className="no-print mb-4">
          <Notice>
            This report covers one student.{" "}
            <button type="button" className="cursor-pointer font-medium text-brand hover:underline" onClick={() => setParams({})}>Show all students</button>
          </Notice>
        </div>
      )}

      <Card>
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <LoadingBlock lines={8} /> : (
          <>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{data.title}</h2>
              <p className="text-sm text-slate-brand">Generated {dateTime(data.generated_at)} by {data.generated_by}. {data.total} rows. Pass mark {data.pass_mark} / 20.</p>
              {data.demo_rows > 0 && <p className="mt-2 flex flex-wrap items-center gap-2 text-sm"><DemoBadge />{data.demo_rows} of these rows are demonstration data.</p>}
              {kind === "risk" && <p className="mt-2 text-sm text-slate-brand">{data.disclaimer}</p>}
            </div>
            {data.total === 0 ? <EmptyState title="Nothing to report" message="No rows match these filters." /> : (
              <Table head={data.columns.map(columnLabel)}>
                {data.rows.map((row, index) => (
                  <tr key={index}>
                    {data.columns.map((column) => (
                      <TD key={column} className="whitespace-nowrap">{column === "predicted_at" && row[column] ? dateTime(String(row[column])) : (row[column] ?? "—")}</TD>
                    ))}
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>
    </>
  );
}
