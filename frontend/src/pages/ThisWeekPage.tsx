import { AlertCircle, ArrowDownRight, ArrowUpRight, CalendarClock, Check, ClipboardList, Hourglass, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import type { SupportAction, WatchItem, Watchlist, WatchState } from "../api/types";
import { useApi, useDebounced } from "../api/useApi";
import { ActionFormModal, CompleteActionModal, RescheduleActionModal } from "../components/SupportActions";
import { Avatar, Button, Card, CheckboxField, DemoBadge, EmptyState, ErrorState, LoadingBlock, Notice, PageBanner, Pagination, RiskBadge, TextField, TONE_STYLES, type Tone } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { ACTION_LABELS, dueDate, SUBJECT_LABELS } from "../format";

const STATES: { key: WatchState; label: string; hint: string; icon: typeof AlertCircle; tone: Tone }[] = [
  { key: "overdue", label: "Overdue", hint: "A follow-up date has passed", icon: AlertCircle, tone: "rose" },
  { key: "needs_action", label: "Needs a plan", hint: "Flagged, and nothing is planned", icon: ClipboardList, tone: "peach" },
  { key: "in_progress", label: "In progress", hint: "A follow-up is scheduled", icon: Hourglass, tone: "blue" },
  { key: "followed_up", label: "Followed up", hint: "Helped; waiting for new results", icon: Check, tone: "green" },
];

function WatchCard({
  item,
  onPlan,
  onComplete,
  onReschedule,
}: {
  item: WatchItem;
  onPlan: (item: WatchItem) => void;
  onComplete: (action: SupportAction) => void;
  onReschedule: (action: SupportAction) => void;
}) {
  const action = item.next_action;
  return (
    <li className={`rounded-xl border p-4 ${item.state === "overdue" ? "border-red-300 bg-red-50/40" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Avatar name={item.student_name} />
        <div className="min-w-0 flex-1 basis-64">
          <p className="flex flex-wrap items-center gap-2">
            <Link to={`/students/${item.student_id}`} className="font-semibold text-brand hover:underline">{item.student_name}</Link>
            <span className="text-sm text-slate-brand">{SUBJECT_LABELS[item.subject]}</span>
            <RiskBadge level={item.risk_level} />
            {item.is_demo && <DemoBadge />}
          </p>

          {item.changes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {item.changes.map((change) => (
                <li key={change.text} className="flex items-center gap-1.5 font-medium">
                  {change.direction === "worse"
                    ? <ArrowUpRight className="size-4 shrink-0 text-red-700" aria-label="Worse" />
                    : <ArrowDownRight className="size-4 shrink-0 text-green-700" aria-label="Better" />}
                  {change.text}
                </li>
              ))}
            </ul>
          )}

          {item.reasons.length > 0 && (
            <p className="mt-1.5 text-sm text-slate-brand">
              <span className="font-medium">Main reasons:</span> {item.reasons.join(" · ")}
            </p>
          )}

          {action && (
            <p className="mt-1.5 text-sm">
              <span className="font-medium">{ACTION_LABELS[action.action_type]}</span>
              {" · "}{action.owner_name ?? "Nobody assigned"}
              {" · "}
              <span className={action.is_overdue ? "font-semibold text-red-700" : "text-slate-brand"}>
                {action.is_overdue ? "was due" : "follow up by"} {dueDate(action.due_date)}
              </span>
            </p>
          )}
          {item.state === "followed_up" && (
            <p className="mt-1.5 text-sm text-slate-brand">{item.actions_done} {item.actions_done === 1 ? "step" : "steps"} completed. Update the grades or absences when there are new results.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {action ? (
            <>
              <Button variant="primary" aria-label={`Mark done for ${item.student_name}, ${SUBJECT_LABELS[item.subject]}`} onClick={() => onComplete(action)}><Check className="size-4" aria-hidden />Mark done</Button>
              <Button variant="secondary" aria-label={`Reschedule for ${item.student_name}, ${SUBJECT_LABELS[item.subject]}`} onClick={() => onReschedule(action)}><CalendarClock className="size-4" aria-hidden />Reschedule</Button>
            </>
          ) : (
            <Button variant={item.state === "needs_action" ? "primary" : "secondary"} aria-label={`Plan support for ${item.student_name}, ${SUBJECT_LABELS[item.subject]}`} onClick={() => onPlan(item)}>
              {item.state === "needs_action" ? "Plan support" : "Plan more support"}
            </Button>
          )}
          <Link to={`/predictions/${item.prediction_id}`} className="rounded-lg px-2 py-2 text-sm text-slate-brand hover:bg-lavender hover:text-navy">Details</Link>
        </div>
      </div>
    </li>
  );
}

export default function ThisWeekPage() {
  const toast = useToast();
  const [state, setState] = useState<WatchState | "">("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [planning, setPlanning] = useState<WatchItem | null>(null);
  const [completing, setCompleting] = useState<SupportAction | null>(null);
  const [rescheduling, setRescheduling] = useState<SupportAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const q = useDebounced(search);

  useEffect(() => setPage(1), [state, mine, q]);

  const list = useApi<Watchlist>("/support/watchlist", { state, mine: mine || "", q, page });

  const saved = (message: string) => {
    toast.success(message);
    setPlanning(null);
    setCompleting(null);
    setRescheduling(null);
    list.reload();
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data } = await api.post<{ scored: number; remaining: number }>("/support/refresh");
      if (data.scored === 0) toast.success("Everything is up to date. No records have changed.");
      else toast.success(`Updated ${data.scored} ${data.scored === 1 ? "course" : "courses"} from changed records.${data.remaining ? ` Run again for the other ${data.remaining}.` : ""}`);
      list.reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setRefreshing(false);
    }
  };

  const counts = list.data?.counts;
  const anyDemo = list.data?.items.some((item) => item.is_demo);
  const nothingAtAll = counts && Object.values(counts).every((value) => value === 0);

  return (
    <>
      <PageBanner
        title="This week"
        subtitle="Who needs attention now, and what is already being done. Most urgent first."
        image="/images/library.webp"
        position="center 35%"
        actions={<Button variant="secondary" busy={refreshing} onClick={refresh}><RefreshCw className="size-4" aria-hidden />Update from records</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STATES.map(({ key, label, hint, icon: Icon, tone }) => (
          <button
            key={key}
            type="button"
            aria-pressed={state === key}
            onClick={() => setState(state === key ? "" : key)}
            className={`cursor-pointer rounded-2xl border p-4 text-left transition-colors hover:border-brand ${TONE_STYLES[tone].card} ${state === key ? "border-brand ring-1 ring-brand" : "border-transparent"}`}
          >
            <span className="flex items-center justify-between gap-2 text-sm text-slate-600">
              {label}
              <span className={`rounded-full p-1.5 ${TONE_STYLES[tone].icon}`}><Icon className="size-4" aria-hidden /></span>
            </span>
            <span className="mt-1 block text-4xl font-semibold tracking-tight">{counts ? counts[key] : "—"}</span>
            <span className="mt-1 block text-xs text-slate-600">{hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Card>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="relative w-full max-w-xs">
              <TextField label="Find a student" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Search className="pointer-events-none absolute top-9 right-3 size-4 text-slate-400" aria-hidden />
            </div>
            <CheckboxField label="Only follow-ups assigned to me" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          </div>

          {anyDemo && (
            <div className="mb-4">
              <Notice>Demo students come from a finished dataset, so they stay on this list even though their final grades are known. Nothing here has been planned for them unless someone at your school added it.</Notice>
            </div>
          )}

          {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <LoadingBlock lines={8} /> : list.data.items.length === 0 ? (
            nothingAtAll && !mine && !q ? (
              <EmptyState title="Nobody needs attention right now" message="Students appear here when a prediction flags them. After adding or changing records, choose Update from records." />
            ) : (
              <EmptyState title="Nothing matches" message="Try another filter." />
            )
          ) : (
            <>
              <ul className="space-y-3">
                {list.data.items.map((item) => (
                  <WatchCard key={`${item.student_id}-${item.subject}`} item={item} onPlan={setPlanning} onComplete={setCompleting} onReschedule={setRescheduling} />
                ))}
              </ul>
              <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onChange={setPage} />
            </>
          )}
        </Card>
      </div>

      {planning && (
        <ActionFormModal
          studentId={planning.student_id}
          studentName={planning.student_name}
          subject={planning.subject}
          predictionId={planning.prediction_id}
          onClose={() => setPlanning(null)}
          onSaved={() => saved("The plan was saved.")}
        />
      )}
      {completing && <CompleteActionModal action={completing} onClose={() => setCompleting(null)} onSaved={() => saved("Marked as done.")} />}
      {rescheduling && <RescheduleActionModal action={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => saved("The date was changed.")} />}
    </>
  );
}
