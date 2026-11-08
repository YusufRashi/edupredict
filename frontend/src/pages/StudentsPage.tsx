import { Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import type { Page, StudentDetail, StudentListItem } from "../api/types";
import { useApi, useDebounced } from "../api/useApi";
import { StudentFormModal } from "../components/StudentForms";
import {
  Button,
  Card,
  ConfirmDialog,
  DemoBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pagination,
  RiskBadge,
  SelectField,
  TD,
  Table,
  TextField,
} from "../components/ui";
import { useToast } from "../context/ToastContext";
import { grade, SUBJECT_LABELS } from "../format";

export default function StudentsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [subject, setSubject] = useState("");
  const [risk, setRisk] = useState("");
  const [dataType, setDataType] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StudentListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(query);

  // A changed filter can leave the current page out of range.
  useEffect(() => setPage(1), [q, yearGroup, subject, risk, dataType]);

  const students = useApi<Page<StudentListItem>>("/students", {
    q, year_group: yearGroup, subject, risk_level: risk, is_demo: dataType, page, page_size: 15,
  });
  const yearGroups = useApi<string[]>("/students/year-groups");
  const filtered = Boolean(q || yearGroup || subject || risk || dataType);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/students/${deleting.id}`);
      toast.success(`${deleting.full_name} was deleted.`);
      setDeleting(null);
      students.reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Search the directory, open a profile, or add a student."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Add student</Button>}
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-1">
            <TextField label="Search" placeholder="Name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Search className="pointer-events-none absolute top-9 right-3 size-4 text-slate-400" aria-hidden />
          </div>
          <SelectField label="Year group" value={yearGroup} onChange={(e) => setYearGroup(e.target.value)}>
            <option value="">All</option>
            {yearGroups.data?.map((value) => <option key={value} value={value}>{value}</option>)}
          </SelectField>
          <SelectField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All</option>
            <option value="math">Mathematics</option>
            <option value="portuguese">Portuguese</option>
          </SelectField>
          <SelectField label="Latest concern" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option value="">All</option>
            <option value="low">Lower</option>
            <option value="moderate">Moderate</option>
            <option value="high">Higher</option>
          </SelectField>
          <SelectField label="Data type" value={dataType} onChange={(e) => setDataType(e.target.value)}>
            <option value="">All</option>
            <option value="false">Institution</option>
            <option value="true">Demonstration</option>
          </SelectField>
        </div>

        {students.error ? <ErrorState message={students.error} onRetry={students.reload} /> : !students.data ? <LoadingBlock lines={8} /> : students.data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No students match these filters" : "No students yet"}
            message={filtered ? "Try removing a filter." : "Add a student, or import a CSV from the Datasets page."}
            action={filtered ? undefined : <Button onClick={() => setCreating(true)}>Add student</Button>}
          />
        ) : (
          <>
            <Table head={["Name", "Code", "Year group", "Subjects", "Avg final", "Latest concern", ""]}>
              {students.data.items.map((student) => (
                <tr key={student.id} className="hover:bg-lavender/50">
                  <TD>
                    <Link to={`/students/${student.id}`} className="font-medium text-brand hover:underline">{student.full_name}</Link>
                    {student.is_demo && <span className="ml-2"><DemoBadge /></span>}
                  </TD>
                  <TD className="text-slate-brand">{student.student_code}</TD>
                  <TD>{student.year_group ?? "—"}</TD>
                  <TD>{student.subjects.map((s) => SUBJECT_LABELS[s]).join(", ") || "—"}</TD>
                  <TD>{grade(student.average_final_grade)}</TD>
                  <TD>{student.highest_risk ? <RiskBadge level={student.highest_risk} /> : <span className="text-slate-brand">Not run</span>}</TD>
                  <TD className="text-right">
                    <button type="button" aria-label={`Delete ${student.full_name}`} onClick={() => setDeleting(student)} className="cursor-pointer rounded p-1 text-slate-brand hover:bg-red-50 hover:text-red-700">
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </TD>
                </tr>
              ))}
            </Table>
            <Pagination page={students.data.page} pages={students.data.pages} total={students.data.total} onChange={setPage} />
          </>
        )}
      </Card>

      {creating && (
        <StudentFormModal
          onClose={() => setCreating(false)}
          onSaved={(saved: StudentDetail) => {
            toast.success(`${saved.full_name} was added.`);
            navigate(`/students/${saved.id}`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this student?"
          message={<>This permanently removes <strong>{deleting.full_name}</strong> along with their academic records, predictions and recommendations. It cannot be undone.</>}
          confirmLabel="Delete student"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}
