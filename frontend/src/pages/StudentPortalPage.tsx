import { BookOpen, CalendarX, CheckCircle2, Lightbulb, Link2Off } from "lucide-react";
import type { StudentDetail } from "../api/types";
import { useApi } from "../api/useApi";
import { StudentProgressChart } from "../components/charts";
import { Card, CardTitle, DemoBadge, EmptyState, ErrorState, LoadingCards, Notice, PageHeader, Pill, StatCard, TD, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { grade, STUDY_TIME_LABELS, SUBJECT_LABELS } from "../format";

const PASS_MARK = 10;

export default function StudentPortalPage() {
  const { user } = useAuth();
  const { data, error, status, reload } = useApi<StudentDetail>("/students/me");

  if (status === 404) {
    return (
      <>
        <PageHeader title={`Welcome, ${user?.full_name ?? ""}`} />
        <Card>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Link2Off className="size-8 text-slate-400" aria-hidden />
            <p className="font-medium">Your account is not linked to a student record yet</p>
            <p className="max-w-md text-sm text-slate-brand">Ask your school to link the email you registered with. Your grades and feedback will then appear here.</p>
          </div>
        </Card>
      </>
    );
  }
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (!data) return <LoadingCards count={3} />;

  const finals = data.records.flatMap((record) => (record.final_grade === null ? [] : [record.final_grade]));
  const average = finals.length ? finals.reduce((sum, value) => sum + value, 0) / finals.length : null;
  const passed = finals.filter((value) => value >= PASS_MARK).length;
  const absences = data.records.reduce((sum, record) => sum + record.absences, 0);
  const openAdvice = data.recommendations.filter((item) => item.status === "open");
  const doneAdvice = data.recommendations.filter((item) => item.status === "completed");

  return (
    <>
      <PageHeader title={`Welcome, ${data.full_name}`} subtitle={[data.student_code, data.year_group].filter(Boolean).join(" · ")} />
      {data.is_demo && (
        <div className="mb-4">
          <Notice><span className="mr-2"><DemoBadge /></span>This is a demonstration account using a pseudonymous record from a public dataset.</Notice>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Average final grade" value={grade(average)} hint={finals.length ? `Out of 20, from ${finals.length} ${finals.length === 1 ? "course" : "courses"}` : "No final grades yet"} icon={<BookOpen className="size-4" aria-hidden />} />
        <StatCard label="Courses passed" value={finals.length ? `${passed} of ${finals.length}` : "—"} hint={`Pass mark is ${PASS_MARK} out of 20`} icon={<CheckCircle2 className="size-4" aria-hidden />} />
        <StatCard label="Absences" value={absences} hint="Across all your courses" icon={<CalendarX className="size-4" aria-hidden />} />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
        <StudentProgressChart records={data.records} passMark={PASS_MARK} />
        <Card>
          <CardTitle title="Feedback and recommendations" subtitle="Shared with you by your educators." />
          {data.recommendations.length === 0 ? <EmptyState title="Nothing shared yet" message="Feedback from your educators will appear here." /> : (
            <ul className="divide-y divide-slate-100">
              {[...openAdvice, ...doneAdvice].map((item) => (
                <li key={item.id} className="flex gap-3 py-3">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className={item.status === "completed" ? "text-slate-brand line-through" : ""}>{item.title}</span>
                      {item.status === "completed" && <Pill tone="green">Done</Pill>}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-brand">{item.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardTitle title="Performance history" />
          {data.records.length === 0 ? <EmptyState title="No academic records yet" /> : (
            <Table head={["Course", "Year", "Period 1", "Period 2", "Final", "Absences", "Study time"]}>
              {data.records.map((record) => (
                <tr key={record.id}>
                  <TD className="font-medium">{SUBJECT_LABELS[record.subject]}</TD>
                  <TD>{record.academic_year}</TD>
                  <TD>{record.period1_grade ?? "—"}</TD>
                  <TD>{record.period2_grade ?? "—"}</TD>
                  <TD>{record.final_grade ?? "—"}</TD>
                  <TD>{record.absences}</TD>
                  <TD className="whitespace-nowrap">{STUDY_TIME_LABELS[record.study_time]}</TD>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
