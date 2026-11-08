import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import type { AcademicRecord, Recommendation, StudentDetail } from "../api/types";
import { STUDY_TIME_LABELS } from "../format";
import { Button, CheckboxField, Modal, SelectField, TextAreaField, TextField } from "./ui";

function FormActions({ busy, error, onCancel, label }: { busy: boolean; error: string | null; onCancel: () => void; label: string }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={busy}>{label}</Button>
      </div>
    </>
  );
}

export function StudentFormModal({ student, onClose, onSaved }: { student?: StudentDetail; onClose: () => void; onSaved: (saved: StudentDetail) => void }) {
  const [code, setCode] = useState(student?.student_code ?? "");
  const [name, setName] = useState(student?.full_name ?? "");
  const [email, setEmail] = useState(student?.email ?? "");
  const [yearGroup, setYearGroup] = useState(student?.year_group ?? "");
  const [linked, setLinked] = useState(student?.linked_user_email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      student_code: code.trim(),
      full_name: name.trim(),
      email: email.trim() || null,
      year_group: yearGroup.trim() || null,
      linked_user_email: linked.trim() || null,
    };
    try {
      const { data } = student
        ? await api.put<StudentDetail>(`/students/${student.id}`, body)
        : await api.post<StudentDetail>("/students", body);
      onSaved(data);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Modal title={student ? "Edit student" : "Add student"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Student code" required maxLength={40} hint="Letters, numbers, hyphens and underscores." value={code} onChange={(e) => setCode(e.target.value)} />
        <TextField label="Full name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Year group (optional)" maxLength={40} value={yearGroup} onChange={(e) => setYearGroup(e.target.value)} />
        <TextField label="Linked student login (optional)" type="email" hint="The email of the student's account. Linking lets them see this record." value={linked} onChange={(e) => setLinked(e.target.value)} />
        <FormActions busy={busy} error={error} onCancel={onClose} label={student ? "Save changes" : "Add student"} />
      </form>
    </Modal>
  );
}

const toGrade = (value: string): number | null => (value === "" ? null : Number(value));
const fromGrade = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));

export function RecordFormModal({ studentId, record, onClose, onSaved }: { studentId: number; record?: AcademicRecord; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState<string>(record?.subject ?? "math");
  const [year, setYear] = useState(record?.academic_year ?? "");
  const [g1, setG1] = useState(fromGrade(record?.period1_grade));
  const [g2, setG2] = useState(fromGrade(record?.period2_grade));
  const [final, setFinal] = useState(fromGrade(record?.final_grade));
  const [absences, setAbsences] = useState(String(record?.absences ?? 0));
  const [studyTime, setStudyTime] = useState(String(record?.study_time ?? 2));
  const [failures, setFailures] = useState(String(record?.past_failures ?? 0));
  const [support, setSupport] = useState(record?.school_support ?? false);
  const [activities, setActivities] = useState(record?.activities ?? false);
  const [higher, setHigher] = useState(record?.wants_higher_education ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      subject,
      academic_year: year.trim(),
      period1_grade: toGrade(g1),
      period2_grade: toGrade(g2),
      final_grade: toGrade(final),
      absences: Number(absences),
      study_time: Number(studyTime),
      past_failures: Number(failures),
      school_support: support,
      activities,
      wants_higher_education: higher,
    };
    try {
      if (record) await api.put(`/students/${studentId}/records/${record.id}`, body);
      else await api.post(`/students/${studentId}/records`, body);
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const gradeProps = { type: "number", min: 0, max: 20, step: 1, hint: "0 to 20. Blank if not known." };
  return (
    <Modal title={record ? "Edit academic record" : "Add academic record"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="math">Mathematics</option>
            <option value="portuguese">Portuguese</option>
          </SelectField>
          <TextField label="Academic year" required placeholder="2025/26" hint="For example 2025 or 2025/26." value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="First period grade" {...gradeProps} value={g1} onChange={(e) => setG1(e.target.value)} />
          <TextField label="Second period grade" {...gradeProps} value={g2} onChange={(e) => setG2(e.target.value)} />
          <TextField label="Final grade" {...gradeProps} value={final} onChange={(e) => setFinal(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Absences" type="number" required min={0} max={93} step={1} value={absences} onChange={(e) => setAbsences(e.target.value)} />
          <SelectField label="Weekly study time" value={studyTime} onChange={(e) => setStudyTime(e.target.value)}>
            {Object.entries(STUDY_TIME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectField>
          <SelectField label="Past class failures" value={failures} onChange={(e) => setFailures(e.target.value)}>
            <option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3 or more</option>
          </SelectField>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <CheckboxField label="Extra school support" checked={support} onChange={(e) => setSupport(e.target.checked)} />
          <CheckboxField label="Extracurricular activities" checked={activities} onChange={(e) => setActivities(e.target.checked)} />
          <CheckboxField label="Wants higher education" checked={higher} onChange={(e) => setHigher(e.target.checked)} />
        </div>
        <FormActions busy={busy} error={error} onCancel={onClose} label={record ? "Save record" : "Add record"} />
      </form>
    </Modal>
  );
}

export function RecommendationFormModal({ studentId, onClose, onSaved }: { studentId: number; onClose: () => void; onSaved: (item: Recommendation) => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("medium");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<Recommendation>(`/students/${studentId}/recommendations`, {
        title: title.trim(), message: message.trim(), priority, shared_with_student: shared,
      });
      onSaved(data);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a recommendation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextAreaField label="Message" required rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
        <SelectField label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </SelectField>
        <CheckboxField label="Share with the student" hint="They will see it in their portal." checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <FormActions busy={busy} error={error} onCancel={onClose} label="Add recommendation" />
      </form>
    </Modal>
  );
}
