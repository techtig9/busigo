import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopNav } from "@/components/dashboard/TopNav";
import { Footer } from "@/components/Footer";
import { ChatWidget } from "@/components/assistant/ChatWidget";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("name, role").eq("id", user.id).single();
  const { data: sub } = await supabase.from("subscriptions").select("plan").eq("user_id", user.id).single();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, link, read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(15);

  const isAdmin = profile?.role === "admin";

  return (
    <div className="flex min-h-screen">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopNav
          userName={profile?.name || user.email || "Account"}
          plan={sub?.plan || "free"}
          isAdmin={isAdmin}
          notifications={notifications || []}
        />
        <main className="flex-1 bg-canvas p-6">{children}</main>
        <Footer />
      </div>
      {/* Assistant only ever mounts inside this auth-gated layout — it requires a signed-in
          user both here and, redundantly, inside its own API route. */}
      <ChatWidget />
    </div>
  );
}
