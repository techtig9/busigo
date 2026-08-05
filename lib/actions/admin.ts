"use server";

import { createServerSupabase, createServiceRoleSupabase } from "@/lib/supabase/server";
import { PLAN_CREDITS } from "@/lib/plans";
import type { Plan } from "@/types/database";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("Admin access required.");
  return user;
}

export async function overrideSubscriptionAction(targetUserId: string, plan: Plan, status: string) {
  await requireAdmin();
  const admin = createServiceRoleSupabase();
  const { error } = await admin
    .from("subscriptions")
    .update({ plan, status, credits_remaining: PLAN_CREDITS[plan] })
    .eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
