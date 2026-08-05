import { createServerSupabase } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { planLabel } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: sub } = await supabase.from("subscriptions").select("plan").eq("user_id", user.id).single();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-ink">Settings</h1>
      <Card>
        <h2 className="font-bold text-ink">Account behavior</h2>
        <ul className="mt-3 space-y-3 text-sm text-slate">
          <li>
            <span className="font-semibold text-ink">Failure alerts —</span> always on. Any run that ends failed
            emails you, naming the step that failed.
          </li>
          <li>
            <span className="font-semibold text-ink">Credit renewal —</span> your {planLabel((sub?.plan as any) || "free")} plan's
            credits reset at the start of each billing cycle; unused credits don't roll over.
          </li>
          <li>
            <span className="font-semibold text-ink">Trigger rate limit —</span> each workflow accepts up to 30
            triggers per minute, to protect your credits from a runaway loop.
          </li>
          <li>
            <span className="font-semibold text-ink">Step cap —</span> a single run executes at most 25 steps.
          </li>
        </ul>
      </Card>
    </div>
  );
}
