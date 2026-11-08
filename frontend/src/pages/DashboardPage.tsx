import { Activity, AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, Database, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { Distribution, ModelInfo, Overview, Page, PredictionSummary, SystemOverview, Trends } from "../api/types";
import { useApi } from "../api/useApi";
import { GradeDistributionChart, PeriodTrendChart, RiskDonut } from "../components/charts";
import { PredictionTable } from "../components/PredictionTable";
import {
  buttonClass,
  Card,
  CardTitle,
  DemoBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  LoadingCards,
  Notice,
  PageHeader,
  StatCard,
  TD,
  Table,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { actionLabel, dateOnly, dateTime, grade, percent, STAGE_LABELS } from "../format";

function DemoNotice({ overview }: { overview: Overview }) {
  if (overview.demo_students === 0) return null;
  return (
    <div className="mb-6">
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Students" value={overview.total_students.toLocaleString()} hint={`${overview.total_records.toLocaleString()} course records`} icon={<Users className="size-4" aria-hidden />} />
      <StatCard label="Predictions run" value={overview.total_predictions.toLocaleString()} hint={overview.demo_predictions ? `${overview.demo_predictions} from demo seeding` : undefined} icon={<Sparkles className="size-4" aria-hidden />} />
      <StatCard label="Need attention" value={overview.students_needing_attention.toLocaleString()} hint="Latest estimate is moderate or higher" icon={<AlertTriangle className="size-4" aria-hidden />} />
      <StatCard label="Average final grade" value={grade(overview.average_final_grade)} hint={`Pass rate ${percent(overview.pass_rate)} of ${overview.final_grades_recorded} recorded`} icon={<BookOpen className="size-4" aria-hidden />} />
    </div>
  );
}

function RecentPredictions({ title = "Recent predictions" }: { title?: string }) {
  const { data, loading, error, reload } = useApi<Page<PredictionSummary>>("/predictions", { page_size: 6 });
  return (
    <Card>
      <CardTitle title={title} action={<Link to="/predictions" className="text-sm font-medium text-brand hover:underline">View all</Link>} />
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
      <CardTitle title="Students requiring attention" subtitle="Highest estimates first. Use alongside what you know of the student." />
      {loading && !data ? <LoadingBlock /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.length ? (
        <EmptyState title="No students flagged" message="No latest prediction is at moderate or higher concern." />
      ) : <PredictionTable items={data} />}
    </Card>
  );
}

function EducatorDashboard({ overview, name }: { overview: Overview; name: string }) {
  const distribution = useApi<Distribution>("/analytics/distribution");
  const trends = useApi<Trends>("/analytics/trends");
  return (
    <>
      <PageHeader
        title={`Welcome, ${name}`}
        subtitle="An overview of your students, and who may need support."
        actions={<Link to="/predictions/new" className={buttonClass()}><Sparkles className="size-4" aria-hidden />New prediction</Link>}
      />
      <DemoNotice overview={overview} />
      <SummaryCards overview={overview} />
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {distribution.data ? <GradeDistributionChart data={distribution.data} /> : <Card>{distribution.error ? <ErrorState message={distribution.error} onRetry={distribution.reload} /> : <LoadingBlock />}</Card>}
        {trends.data ? <PeriodTrendChart data={trends.data.grades_by_period} passMark={overview.pass_mark} /> : <Card>{trends.error ? <ErrorState message={trends.error} onRetry={trends.reload} /> : <LoadingBlock />}</Card>}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <AttentionList />
        <RecentPredictions />
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
        <RiskDonut counts={overview.risk_distribution} />

        <Card>
          <CardTitle title="Model information" action={<Link to="/model" className="text-sm font-medium text-brand hover:underline">Details</Link>} />
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
    : <EducatorDashboard overview={overview.data} name={user.full_name} />;
}
