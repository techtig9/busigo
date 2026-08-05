import { createServerSupabase, createServiceRoleSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { formatDate } from "@/lib/utils";
import { SubscriptionOverrideRow } from "./SubscriptionOverrideRow";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  // Service-role client — the admin panel deliberately reads across every user, which RLS
  // would otherwise block.
  const admin = createServiceRoleSupabase();
  const [{ data: users }, { data: subs }, { data: payments }] = await Promise.all([
    admin.from("users").select("id, name, email, role, created_at").order("created_at", { ascending: false }),
    admin.from("subscriptions").select("id, user_id, plan, status, credits_remaining, renews_at"),
    admin.from("payments").select("id, user_id, amount, status, created_at").order("created_at", { ascending: false }).limit(50),
  ]);

  const subsByUser = new Map((subs || []).map((s) => [s.user_id, s]));
  const usersById = new Map((users || []).map((u) => [u.id, u]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Admin</h1>

      <Card>
        <h2 className="mb-3 font-bold text-ink">Users & subscriptions</h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline text-xs uppercase tracking-wide text-slate">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              <th className="py-2">Plan / Status</th>
              <th className="py-2">Credits</th>
              <th className="py-2">Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {(users || []).map((u) => {
              const sub = subsByUser.get(u.id);
              return (
                <tr key={u.id}>
                  <td className="py-2">{u.name || "—"}</td>
                  <td className="py-2 text-slate">{u.email}</td>
                  <td className="py-2 capitalize">{u.role}</td>
                  <td className="py-2 capitalize">{sub ? `${sub.plan} / ${sub.status}` : "—"}</td>
                  <td className="py-2">{sub?.credits_remaining ?? "—"}</td>
                  <td className="py-2">
                    <SubscriptionOverrideRow userId={u.id} currentPlan={sub?.plan || "free"} currentStatus={sub?.status || "active"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-ink">Recent payments</h2>
        {!payments || payments.length === 0 ? (
          <p className="text-sm text-slate">No payments yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hairline text-xs uppercase tracking-wide text-slate">
              <tr>
                <th className="py-2">User</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Status</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">{usersById.get(p.user_id)?.email || p.user_id}</td>
                  <td className="py-2">${Number(p.amount || 0).toFixed(2)}</td>
                  <td className="py-2 capitalize">{p.status}</td>
                  <td className="py-2 text-slate">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
