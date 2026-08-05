"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { canUseFeature } from "@/lib/plans";
import type { ConnectionService } from "@/types/database";
import { revalidatePath } from "next/cache";

export async function joinConnectionQueueAction(service: ConnectionService) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const gate = await canUseFeature(user.id, { action: "connect_app" });
  if (!gate.allowed) throw new Error(gate.reason);

  const { data: existing } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", user.id)
    .eq("service", service)
    .single();

  if (!existing) {
    const { error } = await supabase.from("connections").insert({ user_id: user.id, service, status: "queued" });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/connections");
}
