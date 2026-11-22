import { Activity, AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2, Database, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Distribution, ModelInfo, Overview, Page, PredictionSummary, Subject, SystemOverview, Trends } from "../api/types";
import { useApi } from "../api/useApi";
import { GradeDistributionChart, PeriodTrendChart, RiskDonut } from "../components/charts";
import { PredictionTable } from "../components/PredictionTable";
import {
  Avatar,
  buttonClass,
  Card,
  CardTitle,
  DemoBadge,
  EmptyState,
  ErrorState,
  HeroStat,
  LoadingBlock,
  LoadingCards,
  Notice,
  PageHeader,
  RiskBadge,
  Segmented,
  StatCard,
  TD,
  Table,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { actionLabel, dateOnly, dateTime, grade, percent, STAGE_LABELS, SUBJECT_LABELS } from "../format";

const SEE_MORE = "rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-navy hover:bg-slate-50";

function DemoNotice({ overview }: { overview: Overview }) {
  if (overview.demo_students === 0) return null;
  return (
    <div className="mb-4">
      <Notice>
        <span className="mr-2"><DemoBadge /></span>
        These figures include {overview.demo_students} demonstration students from the held-out UCI
        test set, under pseudonyms. Their predictions are real model output, but they are not
        students at your institution.
      </Notice>
    </div>
  );
}

function SummaryCards({ overview }: { overview: Overview }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
      <HeroStat
        label="Pass rate"
        value={percent(overview.pass_rate)}
        action={
          <Link to="/this-week" className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
            Open this week <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      >
        Average final grade <strong>{grade(overview.average_final_grade)}</strong> out of 20, from {overview.final_grades_recorded} recorded
      </HeroStat>
      <section className="grid gap-3 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-card sm:grid-cols-3">
        <StatCard tone="blue" label="Students" value={overview.total_students.toLocaleString()} hint={`${overview.total_records.toLocaleString()} course records`} icon={<Users className="size-4" aria-hidden />} />
        <StatCard tone="green" label="Predictions run" value={overview.total_predictions.toLocaleString()} hint={overview.demo_predictions ? `${overview.demo_predictions} from demo seeding` : "All from your school"} icon={<Sparkles className="size-4" aria-hidden />} />
        <StatCard tone="peach" label="Need attention" value={overview.students_needing_attention.toLocaleString()} hint="Latest estimate is moderate or higher" icon={<AlertTriangle className="size-4" aria-hidden />} />
      </section>
    </div>
  );
}

/** Concern levels, for all courses or one subject. Each choice asks the API for its own figures. */
function ConcernPanel() {
  const [subject, setSubject] = useState<"" | Subject>("");
  const { data, error, reload } = useApi<Distribution>("/analytics/distribution", { subject });
  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (!data) return <Card><LoadingBlock lines={6} /></Card>;
  return (
    <RiskDonut
      counts={data.risk_distribution}
      subtitle="Latest prediction for each course."
      controls={
        <Segmented
          label="Subject"
          value={subject}
          onChange={setSubject}
          options={[
            { value: "", label: "All" },
            { value: "math", label: SUBJECT_LABELS.math },
            { value: "portuguese", label: SUBJECT_LABELS.portuguese },
          ]}
        />
      }
    />
  );
}

function RecentPredictions() {
  const { data, loading, error, reload } = useApi<Page<PredictionSummary>>("/predictions", { page_size: 6 });
  return (
    <Card>
      <CardTitle title="Recent predictions" action={<Link to="/predictions" className={SEE_MORE}>See more</Link>} />
      {loading && !data ? <LoadingBlock /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.items.length ? (
        <EmptyState title="No predictions yet" action={<Link to="/predictions/new" className={buttonClass()}>Run a prediction</Link>} />
      ) : <PredictionTable items={data.items} />}
    </Card>
  );
}

function AttentionList() {
  const { data, loading, error, reload } = useApi<PredictionSummary[]>("/analytics/attention", { limit: 6 });
  return (
    <Card>
      <CardTitle title="Students requiring attention" subtitle="Highest estimates first." action={<Link to="/this-week" className={SEE_MORE}>See more</Link>} />
      {loading && !data ? <LoadingBlock /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState title="No students flagged" message="No latest prediction is at moderate or higher concern." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={item.student_name ?? "?"} />
              <div className="min-w-0 flex-1">
                <Link to={`/students/${item.student_id}`} className="block truncate text-sm font-medium hover:text-brand hover:underline">{item.student_name}</Link>
                <p className="truncate text-xs text-slate-brand">{SUBJECT_LABELS[item.subject]}</p>
              </div>
              <RiskBadge level={item.risk_level} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EducatorDashboard({ overview }: { overview: Overview }) {
  const distribution = useApi<Distribution>("/analytics/distribution");
  const trends = useApi<Trends>("/analytics/trends");
  return (
    <>
      <PageHeader
        title="Dashboard overview"
        subtitle="How your students are doing overall."
        actions={<Link to="/predictions/new" className={buttonClass()}><Sparkles className="size-4" aria-hidden />New prediction</Link>}
      />
      <DemoNotice overview={overview} />
      <SummaryCards overview={overview} />
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {distribution.data ? <GradeDistributionChart data={distribution.data} /> : <Card>{distribution.error ? <ErrorState message={distribution.error} onRetry={distribution.reload} /> : <LoadingBlock />}</Card>}
        <ConcernPanel />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentPredictions />
        <AttentionList />
      </div>
      <div className="mt-4">
        {trends.data ? <PeriodTrendChart data={trends.data.grades_by_period} passMark={overview.pass_mark} /> : <Card>{trends.error ? <ErrorState message={trends.error} onRetry={trends.reload} /> : <LoadingBlock />}</Card>}
      </div>
    </>
  );
}

function AdminDashboard({ overview }: { overview: Overview }) {
  const system = useApi<SystemOverview>("/analytics/system");
  const model = useApi<ModelInfo>("/model/info");
  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Platform-wide activity, access and model status." actions={<Link to="/users" className={buttonClass("secondary")}>Manage users</Link>} />
      <DemoNotice overview={overview} />
      <SummaryCards overview={overview} />

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ConcernPanel />

        <Card>
          <CardTitle title="Model information" action={<Link to="/model" className={SEE_MORE}>Details</Link>} />
          {model.loading && !model.data ? <LoadingBlock /> : model.error ? <ErrorState message={model.error} onRetry={model.reload} /> : model.data && (
            <dl className="space-y-3 text-sm">
              <div><dt className="text-slate-brand">Trained</dt><dd className="font-medium">{dateOnly(model.data.trained_at)}</dd></div>
              <div><dt className="text-slate-brand">Dataset</dt><dd className="font-medium">{model.data.dataset.name} ({model.data.dataset.cleaning.rows_after_cleaning.toLocaleString()} rows)</dd></div>
              {model.data.stages.map((stage) => (
                <div key={stage.key}>
                  <dt className="text-slate-brand">{STAGE_LABELS[stage.key]}</dt>
                  <dd className="font-medium">{stage.classifier_algorithm}, ROC-AUC {stage.classifier_test.roc_auc.toFixed(3)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        <Card>
          <CardTitle title="System overview" />
          {system.loading && !system.data ? <LoadingBlock /> : system.error ? <ErrorState message={system.error} onRetry={system.reload} /> : system.data && (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-2"><dt className="flex items-center gap-2 text-slate-brand"><CheckCircle2 className="size-4 text-green-700" aria-hidden />Database</dt><dd className="font-medium capitalize">{system.data.database_status}</dd></div>
              <div className="flex justify-between gap-2"><dt className="flex items-center gap-2 text-slate-brand"><Users className="size-4" aria-hidden />Active users</dt><dd className="font-medium">{system.data.active_users}</dd></div>
              <div className="flex justify-between gap-2"><dt className="pl-6 text-slate-brand">Admins</dt><dd>{system.data.users_by_role.admin}</dd></div>
              <div className="flex justify-between gap-2"><dt className="pl-6 text-slate-brand">Educators</dt><dd>{system.data.users_by_role.educator}</dd></div>
              <div className="flex justify-between gap-2"><dt className="pl-6 text-slate-brand">Students</dt><dd>{system.data.users_by_role.student}</dd></div>
              <div className="flex justify-between gap-2"><dt className="flex items-center gap-2 text-slate-brand"><Database className="size-4" aria-hidden />Datasets</dt><dd className="font-medium">{system.data.datasets}</dd></div>
              <div className="flex justify-between gap-2"><dt className="flex items-center gap-2 text-slate-brand"><BrainCircuit className="size-4" aria-hidden />Active models</dt><dd className="font-medium">{system.data.active_models.length}</dd></div>
            </dl>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle title="Recent activity" subtitle="From the audit log." />
          {system.data && (system.data.recent_activity.length === 0 ? <EmptyState title="No activity yet" /> : (
            <Table head={["Action", "By", "When"]}>
              {system.data.recent_activity.map((item) => (
                <tr key={item.id}>
                  <TD><span className="inline-flex items-center gap-2"><Activity className="size-3.5 text-slate-brand" aria-hidden />{actionLabel(item.action)}</span></TD>
                  <TD>{item.actor}</TD>
                  <TD className="whitespace-nowrap text-slate-brand">{dateTime(item.created_at)}</TD>
                </tr>
              ))}
            </Table>
          ))}
        </Card>
        <RecentPredictions />
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const overview = useApi<Overview>("/analytics/overview");
  if (overview.error) return <Card><ErrorState message={overview.error} onRetry={overview.reload} /></Card>;
  if (!overview.data || !user) return <LoadingCards />;
  return user.role === "admin"
    ? <AdminDashboard overview={overview.data} />
    : <EducatorDashboard overview={overview.data} />;
}
