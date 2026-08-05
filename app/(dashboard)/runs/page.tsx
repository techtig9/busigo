import { createServerSupabase } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function RunsOverviewPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name, status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data: recentRuns } = await supabase
    .from("workflow_runs")
    .select("id, status, started_at, workflow_id, workflows!inner(name, user_id)")
    .eq("workflows.user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(20);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Runs</h1>

      <Card>
        <h2 className="mb-3 font-bold text-ink">By workflow</h2>
        {!workflows || workflows.length === 0 ? (
          <p className="text-sm text-slate">No workflows yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {workflows.map((wf) => (
              <li key={wf.id} className="flex items-center justify-between py-2.5">
                <Link href={`/runs/${wf.id}`} className="text-sm font-semibold text-ink hover:text-signal">
                  {wf.name}
                </Link>
                <Badge tone={wf.status === "published" ? "signal" : "slate"}>{wf.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-ink">Recent activity, all workflows</h2>
        {!recentRuns || recentRuns.length === 0 ? (
          <p className="text-sm text-slate">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {recentRuns.map((run: any) => (
              <li key={run.id} className="flex items-center justify-between py-2.5 text-sm">
                <Link href={`/runs/${run.workflow_id}/${run.id}`} className="text-ink hover:text-signal">
                  {run.workflows?.name} <span className="text-xs text-slate">— {formatDate(run.started_at)}</span>
                </Link>
                <Badge tone={statusTone(run.status)}>{run.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
