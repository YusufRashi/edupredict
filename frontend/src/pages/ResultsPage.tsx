import { useState } from "react";
import type { OutcomeGroup, SupportResults } from "../api/types";
import { useApi } from "../api/useApi";
import { Card, CardTitle, CheckboxField, ErrorState, LoadingCards, Notice, PageHeader, Pill, StatCard, TD, Table } from "../components/ui";
import { percent } from "../format";

function OutcomeRow({ label, group }: { label: string; group: OutcomeGroup }) {
  return (
    <tr>
      <TD className="font-medium">{label}</TD>
      <TD>{group.courses}</TD>
      <TD>{group.finals_known}</TD>
      <TD>{group.passed}</TD>
      <TD>
        {group.finals_known === 0 ? "—" : percent(group.pass_rate)}
        {group.finals_known > 0 && group.small_group && <span className="ml-2"><Pill tone="amber">Small group</Pill></span>}
      </TD>
    </tr>
  );
}

export default function ResultsPage() {
  const [includeDemo, setIncludeDemo] = useState(true);
  const { data, error, reload } = useApi<SupportResults>("/support/results", { include_demo: includeDemo });

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;

  return (
    <>
      <PageHeader title="Results" subtitle="What was flagged, what was done about it, and how those courses ended." />
      <div className="mb-4">
        <CheckboxField label="Include demonstration students" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
      </div>
      {!data ? <LoadingCards /> : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard tone="peach" label="Courses flagged" value={data.flagged_courses} hint={data.include_demo && data.demo_courses ? `${data.demo_courses} are demonstration data` : "At moderate or higher concern"} />
            <StatCard tone="green" label="Steps completed" value={data.actions.done} hint={`${data.actions.total} planned in total`} />
            <StatCard tone="blue" label="Steps in progress" value={data.actions.planned} hint={`${data.actions.cancelled} cancelled`} />
            <StatCard tone="rose" label="Overdue" value={data.actions.overdue} hint="Follow-up date has passed" />
          </div>

          <Card>
            <CardTitle title="How flagged courses ended" subtitle={`Pass means a final grade of ${data.pass_mark} or above out of 20.`} />
            <Table head={["Group", "Flagged courses", "Final grade known", "Passed", "Pass rate"]}>
              <OutcomeRow label="At least one step completed" group={data.with_completed_action} />
              <OutcomeRow label="No step completed" group={data.without_completed_action} />
            </Table>
            <div className="mt-4">
              <Notice tone="warning">
                This table counts what happened. It does not prove that support caused a result. Teachers
                may choose to help some students over others, so the two groups can differ from the start.
                Fewer than 30 known final grades in a group is too few to compare.
              </Notice>
            </div>
          </Card>

          {data.include_demo && data.demo_courses > 0 && (
            <Notice>Demonstration students have final grades from the original dataset. Those results happened long before this system existed, so no support here could have affected them. Untick the box above to see only your own students.</Notice>
          )}
        </div>
      )}
    </>
  );
}
