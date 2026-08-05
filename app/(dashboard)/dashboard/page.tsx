import { createServerSupabase } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, statusTone } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { PLAN_CREDITS, planLabel } from "@/lib/plans";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: workflows }, { data: sub }, { data: recentRuns }] = await Promise.all([
    supabase.from("users").select("name").eq("id", user.id).single(),
    supabase.from("workflows").select("id, status").eq("user_id", user.id),
    supabase.from("subscriptions").select("plan, credits_remaining").eq("user_id", user.id).single(),
    supabase
      .from("workflow_runs")
      .select("id, status, started_at, workflow_id, workflows!inner(name, user_id)")
      .eq("workflows.user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(5),
  ]);

  const plan = (sub?.plan as any) || "free";
  const creditsTotal = PLAN_CREDITS[plan as keyof typeof PLAN_CREDITS] ?? 500;
  const creditsRemaining = sub?.credits_remaining ?? 0;
  const pct = Math.min(100, Math.round((creditsRemaining / creditsTotal) * 100));

  const workflowCount = workflows?.length ?? 0;
  const publishedCount = workflows?.filter((w) => w.status === "published").length ?? 0;
  const hasRun = (recentRuns?.length ?? 0) > 0;
  const firstName = (profile?.name || "there").split(" ")[0];

  const onboardingSteps = [
    { label: "Create your first workflow", done: workflowCount > 0, href: "/workflows/new" },
    { label: "Publish it", done: publishedCount > 0, href: "/workflows" },
    { label: "Trigger a test run", done: hasRun, href: "/workflows" },
  ];
  const showOnboarding = onboardingSteps.some((s) => !s.done);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {timeGreeting()}, {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-0.5 text-sm text-slate">Here's what's happening with your workflows.</p>
        </div>
        <Button href="/workflows/new">New workflow</Button>
      </div>

      {showOnboarding && (
        <Card className="animate-slide-up stagger-1 border-signal/30 bg-signal/5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">Getting started</h2>
            <span className="text-xs text-slate">{onboardingSteps.filter((s) => s.done).length}/{onboardingSteps.length}</span>
          </div>
          <div className="mb-3 h-1.5 w-full rounded-full bg-surface">
            <div
              className="h-1.5 rounded-full bg-signal transition-all duration-700"
              style={{ width: `${(onboardingSteps.filter((s) => s.done).length / onboardingSteps.length) * 100}%` }}
            />
          </div>
          <ul className="space-y-2">
            {onboardingSteps.map((step) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm text-ink transition-colors hover:bg-panel/60"
                >
                  {step.done ? (
                    <CheckCircle2 size={16} className="text-signal" />
                  ) : (
                    <Circle size={16} className="text-slate" />
                  )}
                  <span className={step.done ? "text-slate line-through" : ""}>{step.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="animate-slide-up stagger-1 transition-shadow hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">Workflows</p>
          <p className="mt-1 text-2xl font-bold text-ink">{workflowCount}</p>
        </Card>
        <Card className="animate-slide-up stagger-2 transition-shadow hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">Plan</p>
          <p className="mt-1 text-2xl font-bold text-ink">{planLabel(plan)}</p>
        </Card>
        <Card className="animate-slide-up stagger-3 transition-shadow hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate">Credits remaining</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {creditsRemaining.toLocaleString()} <span className="text-sm font-normal text-slate">/ {creditsTotal.toLocaleString()}</span>
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-surface">
            <div className="h-1.5 rounded-full bg-signal transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </Card>
      </div>

      <Card className="animate-slide-up stagger-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-ink">Recent runs</h2>
          <Link href="/runs" className="text-sm text-signal hover:underline">View all</Link>
        </div>
        {!recentRuns || recentRuns.length === 0 ? (
          <p className="text-sm text-slate">No runs yet — publish a workflow and trigger it to see activity here.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {recentRuns.map((run: any) => (
              <li key={run.id} className="flex items-center justify-between py-2.5 text-sm transition-colors hover:bg-surface/60">
                <div>
                  <p className="font-semibold text-ink">{run.workflows?.name}</p>
                  <p className="text-xs text-slate">{formatDate(run.started_at)}</p>
                </div>
                <Badge tone={statusTone(run.status)}>{run.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
