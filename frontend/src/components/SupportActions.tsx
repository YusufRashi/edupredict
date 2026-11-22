import { CalendarClock, Check, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import type { ActionType, Page, StaffMember, Subject, SupportAction } from "../api/types";
import { useApi } from "../api/useApi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ACTION_LABELS, dateTime, dueDate, localDate, SUBJECT_LABELS } from "../format";
import { Button, Card, CardTitle, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Modal, Pill, SelectField, TextAreaField, TextField } from "./ui";

export function ActionFormModal({
  studentId,
  studentName,
  subject,
  subjects,
  predictionId,
  onClose,
  onSaved,
}: {
  studentId: number;
  studentName: string;
  subject?: Subject;
  subjects?: Subject[];
  predictionId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const staff = useApi<StaffMember[]>("/support/staff");
  const options = subjects?.length ? subjects : (["math", "portuguese"] as Subject[]);
  const [chosenSubject, setChosenSubject] = useState<Subject>(subject ?? options[0]);
  const [actionType, setActionType] = useState<ActionType>("meeting");
  const [due, setDue] = useState(localDate(7));
  const [owner, setOwner] = useState(String(user?.id ?? ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/support/actions", {
        student_id: studentId,
        subject: chosenSubject,
        action_type: actionType,
        due_date: due,
        owner_id: owner ? Number(owner) : null,
        note: note.trim() || null,
        prediction_id: predictionId ?? null,
      });
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Plan support for ${studentName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!subject && (
          <SelectField label="Subject" value={chosenSubject} onChange={(e) => setChosenSubject(e.target.value as Subject)}>
            {options.map((value) => <option key={value} value={value}>{SUBJECT_LABELS[value]}</option>)}
          </SelectField>
        )}
        <SelectField label="What will happen" value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}>
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((value) => <option key={value} value={value}>{ACTION_LABELS[value]}</option>)}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Follow up by" type="date" required min={localDate()} value={due} onChange={(e) => setDue(e.target.value)} />
          <SelectField label="Responsible" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {staff.data?.map((person) => <option key={person.id} value={person.id}>{person.full_name}{person.id === user?.id ? " (you)" : ""}</option>)}
          </SelectField>
        </div>
        <TextAreaField label="Note (optional)" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>Save plan</Button>
        </div>
      </form>
    </Modal>
  );
}

export function CompleteActionModal({ action, onClose, onSaved }: { action: SupportAction; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/support/actions/${action.id}`, { status: "done", outcome_note: outcome.trim() || null });
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Mark as done: ${ACTION_LABELS[action.action_type]}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-brand">{action.student_name}, {SUBJECT_LABELS[action.subject]}</p>
        <TextAreaField label="What happened? (optional)" rows={3} maxLength={2000} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>Mark as done</Button>
        </div>
      </form>
    </Modal>
  );
}

export function RescheduleActionModal({ action, onClose, onSaved }: { action: SupportAction; onClose: () => void; onSaved: () => void }) {
  const [due, setDue] = useState(localDate(7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/support/actions/${action.id}`, { due_date: due });
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Modal title="Change the follow-up date" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-brand">Currently {dueDate(action.due_date)}.</p>
        <TextField label="New date" type="date" required min={localDate()} value={due} onChange={(e) => setDue(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>Save date</Button>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_PILL = {
  planned: <Pill tone="brand">Planned</Pill>,
  done: <Pill tone="green">Done</Pill>,
  cancelled: <Pill>Cancelled</Pill>,
};

/** Every support step for one student, on their profile. Staff only. */
export function StudentActionsCard({ studentId, studentName, subjects }: { studentId: number; studentName: string; subjects: Subject[] }) {
  const toast = useToast();
  const actions = useApi<Page<SupportAction>>("/support/actions", { student_id: studentId, page_size: 100 });
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<SupportAction | null>(null);
  const [rescheduling, setRescheduling] = useState<SupportAction | null>(null);
  const [deleting, setDeleting] = useState<SupportAction | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (message: string) => {
    toast.success(message);
    setAdding(false);
    setCompleting(null);
    setRescheduling(null);
    setDeleting(null);
    actions.reload();
  };

  const cancel = async (action: SupportAction) => {
    try {
      await api.patch(`/support/actions/${action.id}`, { status: "cancelled" });
      done("The plan was cancelled.");
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/support/actions/${deleting.id}`);
      done("Deleted.");
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle
        title="Support plan"
        subtitle="Who is doing what, and by when. Students cannot see this."
        action={<Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />Plan support</Button>}
      />
      {actions.error ? <ErrorState message={actions.error} onRetry={actions.reload} /> : !actions.data ? <LoadingBlock lines={3} /> : actions.data.items.length === 0 ? (
        <EmptyState title="Nothing planned yet" message="Plan a step here or from the This week list." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {actions.data.items.map((action) => (
            <li key={action.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1 basis-72">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {ACTION_LABELS[action.action_type]}, {SUBJECT_LABELS[action.subject]}
                  {STATUS_PILL[action.status]}
                  {action.is_overdue && <Pill tone="red">Overdue</Pill>}
                </p>
                <p className="mt-0.5 text-xs text-slate-brand">
                  {action.status === "done" && action.completed_at ? `Done ${dateTime(action.completed_at)}` : `Follow up by ${dueDate(action.due_date)}`}
                  {action.owner_name ? ` · ${action.owner_name}` : " · Nobody assigned"}
                </p>
                {action.note && <p className="mt-1 text-sm whitespace-pre-wrap text-slate-brand">{action.note}</p>}
                {action.outcome_note && <p className="mt-1 text-sm whitespace-pre-wrap"><span className="font-medium">Outcome: </span>{action.outcome_note}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {action.status === "planned" && (
                  <>
                    <Button variant="ghost" onClick={() => setCompleting(action)}><Check className="size-4" aria-hidden />Done</Button>
                    <Button variant="ghost" onClick={() => setRescheduling(action)}><CalendarClock className="size-4" aria-hidden />Reschedule</Button>
                    <Button variant="ghost" onClick={() => cancel(action)}><X className="size-4" aria-hidden />Cancel plan</Button>
                  </>
                )}
                <Button variant="ghost" aria-label={`Delete ${ACTION_LABELS[action.action_type]}`} onClick={() => setDeleting(action)}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <ActionFormModal studentId={studentId} studentName={studentName} subjects={subjects} onClose={() => setAdding(false)} onSaved={() => done("The plan was saved.")} />}
      {completing && <CompleteActionModal action={completing} onClose={() => setCompleting(null)} onSaved={() => done("Marked as done.")} />}
      {rescheduling && <RescheduleActionModal action={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => done("The date was changed.")} />}
      {deleting && <ConfirmDialog title="Delete this step?" message="This removes it from the student's history and from Results. To keep a record, cancel it instead." confirmLabel="Delete" busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </Card>
  );
}
