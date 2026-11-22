import { ArrowLeft, Check, Eye, EyeOff, FileText, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import type { AcademicRecord, Recommendation, StudentDetail } from "../api/types";
import { useApi } from "../api/useApi";
import { StudentProgressChart } from "../components/charts";
import { PredictionTable } from "../components/PredictionTable";
import { RecommendationFormModal, RecordFormModal, StudentFormModal } from "../components/StudentForms";
import { StudentActionsCard } from "../components/SupportActions";
import {
  Button,
  buttonClass,
  Card,
  CardTitle,
  ConfirmDialog,
  DemoBadge,
  EmptyState,
  ErrorState,
  LoadingCards,
  Notice,
  PageHeader,
  Pill,
  TD,
  Table,
} from "../components/ui";
import { useToast } from "../context/ToastContext";
import { STUDY_TIME_LABELS, SUBJECT_LABELS } from "../format";

type Pending =
  | { kind: "student" }
  | { kind: "record"; record: AcademicRecord }
  | { kind: "recommendation"; item: Recommendation };

export default function StudentProfilePage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { data: student, error, status, reload } = useApi<StudentDetail>(`/students/${id}`);
  const [editing, setEditing] = useState(false);
  const [recordForm, setRecordForm] = useState<{ record?: AcademicRecord } | null>(null);
  const [addingAdvice, setAddingAdvice] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) {
    return (
      <Card>
        <ErrorState message={status === 404 ? "This student could not be found." : error} onRetry={status === 404 ? undefined : reload} />
      </Card>
    );
  }
  if (!student) return <LoadingCards />;

  const updateAdvice = async (item: Recommendation, change: Partial<Pick<Recommendation, "status" | "shared_with_student">>, done: string) => {
    try {
      await api.patch(`/students/${student.id}/recommendations/${item.id}`, change);
      toast.success(done);
      reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "student") {
        await api.delete(`/students/${student.id}`);
        toast.success("The student was deleted.");
        navigate("/students");
        return;
      }
      if (pending.kind === "record") await api.delete(`/students/${student.id}/records/${pending.record.id}`);
      else await api.delete(`/students/${student.id}/recommendations/${pending.item.id}`);
      toast.success("Deleted.");
      setPending(null);
      reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/students" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-brand hover:text-navy">
        <ArrowLeft className="size-4" aria-hidden /> Students
      </Link>
      <PageHeader
        title={student.full_name}
        subtitle={[student.student_code, student.year_group, student.email].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link to={`/predictions/new?student=${student.id}`} className={buttonClass()}><Sparkles className="size-4" aria-hidden />Run prediction</Link>
            <Link to={`/reports?student_id=${student.id}`} className={buttonClass("secondary")}><FileText className="size-4" aria-hidden />Report</Link>
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden />Edit</Button>
            <Button variant="secondary" onClick={() => setPending({ kind: "student" })}><Trash2 className="size-4" aria-hidden />Delete</Button>
          </>
        }
      />

      {student.is_demo && (
        <div className="mb-4">
          <Notice><span className="mr-2"><DemoBadge /></span>This is a pseudonymous demonstration record from the UCI dataset, not a student at your institution.</Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <StudentProgressChart records={student.records} />
        <Card>
          <CardTitle title="Latest predictions" subtitle="The newest estimate for each subject." />
          {student.latest_predictions.length === 0 ? (
            <EmptyState title="No predictions yet" action={<Link to={`/predictions/new?student=${student.id}`} className={buttonClass()}>Run a prediction</Link>} />
          ) : <PredictionTable items={student.latest_predictions} />}
          <p className="mt-4 text-sm text-slate-brand">
            Linked student login: {student.linked_user_email ?? "none"}
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <StudentActionsCard
          studentId={student.id}
          studentName={student.full_name}
          subjects={[...new Set(student.records.map((record) => record.subject))]}
        />
      </div>

      <div className="mt-4">
        <Card>
          <CardTitle title="Academic records" action={<Button variant="secondary" onClick={() => setRecordForm({})}><Plus className="size-4" aria-hidden />Add record</Button>} />
          {student.records.length === 0 ? <EmptyState title="No academic records yet" message="Add a record to chart progress and run predictions." /> : (
            <Table head={["Course", "Year", "Period 1", "Period 2", "Final", "Absences", "Study time", "Past failures", "Support", ""]}>
              {student.records.map((record) => (
                <tr key={record.id}>
                  <TD className="font-medium">{SUBJECT_LABELS[record.subject]}</TD>
                  <TD>{record.academic_year}</TD>
                  <TD>{record.period1_grade ?? "—"}</TD>
                  <TD>{record.period2_grade ?? "—"}</TD>
                  <TD>{record.final_grade ?? "—"}</TD>
                  <TD>{record.absences}</TD>
                  <TD className="whitespace-nowrap">{STUDY_TIME_LABELS[record.study_time]}</TD>
                  <TD>{record.past_failures === 3 ? "3+" : record.past_failures}</TD>
                  <TD>{record.school_support ? "Yes" : "No"}</TD>
                  <TD className="text-right whitespace-nowrap">
                    <Link to={`/predictions/new?student=${student.id}&record=${record.id}`} aria-label={`Predict ${SUBJECT_LABELS[record.subject]} ${record.academic_year}`} className="inline-block rounded p-1 text-slate-brand hover:bg-lavender hover:text-brand"><Sparkles className="size-4" aria-hidden /></Link>
                    <button type="button" aria-label={`Edit ${SUBJECT_LABELS[record.subject]} ${record.academic_year}`} onClick={() => setRecordForm({ record })} className="cursor-pointer rounded p-1 text-slate-brand hover:bg-lavender hover:text-brand"><Pencil className="size-4" aria-hidden /></button>
                    <button type="button" aria-label={`Delete ${SUBJECT_LABELS[record.subject]} ${record.academic_year}`} onClick={() => setPending({ kind: "record", record })} className="cursor-pointer rounded p-1 text-slate-brand hover:bg-red-50 hover:text-red-700"><Trash2 className="size-4" aria-hidden /></button>
                  </TD>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardTitle
            title="Recommendations"
            subtitle="Suggestions stay private to staff until you share them. Rule-based ones are rules of thumb, not validated interventions."
            action={<Button variant="secondary" onClick={() => setAddingAdvice(true)}><Plus className="size-4" aria-hidden />Add</Button>}
          />
          {student.recommendations.length === 0 ? <EmptyState title="No recommendations yet" message="Running a prediction creates suggestions, or you can write your own." /> : (
            <ul className="divide-y divide-slate-100">
              {student.recommendations.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1 basis-72">
                    <p className={`font-medium ${item.status === "completed" ? "text-slate-brand line-through" : ""}`}>{item.title}</p>
                    <p className="mt-0.5 text-sm text-slate-brand">{item.message}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Pill tone={item.priority === "high" ? "red" : item.priority === "medium" ? "amber" : "slate"}>{item.priority} priority</Pill>
                      <Pill>{item.source === "rule" ? "Rule-based" : "Written by staff"}</Pill>
                      {item.shared_with_student && <Pill tone="brand">Shared with student</Pill>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => updateAdvice(item, { shared_with_student: !item.shared_with_student }, item.shared_with_student ? "No longer shared." : "Shared with the student.")}>
                      {item.shared_with_student ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                      {item.shared_with_student ? "Unshare" : "Share"}
                    </Button>
                    <Button variant="ghost" onClick={() => updateAdvice(item, { status: item.status === "open" ? "completed" : "open" }, item.status === "open" ? "Marked as done." : "Reopened.")}>
                      {item.status === "open" ? <Check className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
                      {item.status === "open" ? "Done" : "Reopen"}
                    </Button>
                    <Button variant="ghost" aria-label={`Delete ${item.title}`} onClick={() => setPending({ kind: "recommendation", item })}><Trash2 className="size-4" aria-hidden /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && <StudentFormModal student={student} onClose={() => setEditing(false)} onSaved={() => { toast.success("Student saved."); setEditing(false); reload(); }} />}
      {recordForm && <RecordFormModal studentId={student.id} record={recordForm.record} onClose={() => setRecordForm(null)} onSaved={() => { toast.success("Record saved."); setRecordForm(null); reload(); }} />}
      {addingAdvice && <RecommendationFormModal studentId={student.id} onClose={() => setAddingAdvice(false)} onSaved={() => { toast.success("Recommendation added."); setAddingAdvice(false); reload(); }} />}
      {pending && (
        <ConfirmDialog
          title={pending.kind === "student" ? "Delete this student?" : pending.kind === "record" ? "Delete this record?" : "Delete this recommendation?"}
          message={pending.kind === "student"
            ? "This permanently removes the student along with their academic records, predictions and recommendations. It cannot be undone."
            : pending.kind === "record"
              ? "This permanently removes the grades in this record. Past predictions stay, but lose the link to it."
              : "This permanently removes the recommendation, including from the student's portal if it was shared."}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
