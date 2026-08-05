"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { canUseFeature, PLAN_LIMITS } from "@/lib/plans";
import type { StepDefinition, TriggerType, Plan } from "@/types/database";
import { nextRunAfter } from "@/lib/engine/cron";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireUser() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function createWorkflowAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const triggerType = String(formData.get("trigger_type") || "webhook") as TriggerType;
  const templateId = String(formData.get("template_id") || "");

  if (!name) throw new Error("Workflow name is required.");

  const { count } = await supabase
    .from("workflows")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const gate = await canUseFeature(user.id, { action: "publish_workflow", currentWorkflowCount: count ?? 0 });
  if (!gate.allowed) throw new Error(gate.reason);

  let definition: StepDefinition[] = [];
  if (templateId) {
    const { data: template } = await supabase.from("templates").select("definition").eq("id", templateId).single();
    if (template) definition = template.definition as StepDefinition[];
  }

  const { data: workflow, error } = await supabase
    .from("workflows")
    .insert({ user_id: user.id, name, description, trigger_type: triggerType, definition, status: "draft" })
    .select("id")
    .single();

  if (error || !workflow) throw new Error(error?.message || "Could not create workflow.");

  return workflow.id as string;
}

export async function saveDefinitionAction(workflowId: string, definition: StepDefinition[]) {
  const { supabase, user } = await requireUser();

  const { data: sub } = await supabase.from("subscriptions").select("plan").eq("user_id", user.id).single();
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
  const limits = PLAN_LIMITS[(sub?.plan as Plan) || "free"];

  if (profile?.role !== "admin") {
    if (definition.length > limits.maxStepsPerWorkflow) {
      throw new Error(`Your plan allows up to ${limits.maxStepsPerWorkflow} steps per workflow.`);
    }
    if (!limits.aiActionStep && definition.some((s) => s.type === "ai_action")) {
      throw new Error("AI Action steps require the Starter plan or higher.");
    }
  }

  const { error } = await supabase
    .from("workflows")
    .update({ definition })
    .eq("id", workflowId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath(`/workflows/${workflowId}`);
}

export async function saveVersionAction(workflowId: string) {
  const { supabase, user } = await requireUser();

  const gate = await canUseFeature(user.id, { action: "use_version_history" });
  if (!gate.allowed) throw new Error(gate.reason);

  const { data: workflow } = await supabase
    .from("workflows")
    .select("definition")
    .eq("id", workflowId)
    .eq("user_id", user.id)
    .single();
  if (!workflow) throw new Error("Workflow not found.");

  const { error } = await supabase
    .from("workflow_versions")
    .insert({ workflow_id: workflowId, definition: workflow.definition });
  if (error) throw new Error(error.message);

  revalidatePath(`/workflows/${workflowId}`);
}

export async function rollbackToVersionAction(workflowId: string, versionId: string) {
  const { supabase, user } = await requireUser();

  const { data: version } = await supabase
    .from("workflow_versions")
    .select("definition, workflow_id")
    .eq("id", versionId)
    .single();
  if (!version || version.workflow_id !== workflowId) throw new Error("Version not found.");

  const { error } = await supabase
    .from("workflows")
    .update({ definition: version.definition })
    .eq("id", workflowId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/workflows/${workflowId}`);
}

export async function publishWorkflowAction(workflowId: string) {
  const { supabase, user } = await requireUser();

  const { count } = await supabase
    .from("workflows")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "published")
    .neq("id", workflowId);

  const gate = await canUseFeature(user.id, { action: "publish_workflow", currentWorkflowCount: count ?? 0 });
  if (!gate.allowed) throw new Error(gate.reason);

  const { data: workflow } = await supabase
    .from("workflows")
    .select("definition, trigger_type, trigger_config")
    .eq("id", workflowId)
    .eq("user_id", user.id)
    .single();
  if (!workflow) throw new Error("Workflow not found.");
  if (!workflow.definition || (workflow.definition as any[]).length === 0) {
    throw new Error("Add at least one step before publishing.");
  }

  await supabase.from("workflow_versions").insert({ workflow_id: workflowId, definition: workflow.definition });

  const updates: Record<string, any> = { status: "published" };
  if (workflow.trigger_type === "schedule") {
    const cron = (workflow.trigger_config as any)?.cron;
    if (!cron) throw new Error("Set a cron expression before publishing a scheduled workflow.");
    const next = nextRunAfter(cron, new Date());
    if (!next) throw new Error("That cron expression couldn't be parsed. Use standard 5-field syntax, e.g. \"0 9 * * *\".");
    updates.next_run_at = next.toISOString();
  }

  const { error } = await supabase.from("workflows").update(updates).eq("id", workflowId).eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/workflows/${workflowId}`);
  revalidatePath("/workflows");
}

export async function updateTriggerConfigAction(workflowId: string, triggerConfig: Record<string, any>) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("workflows")
    .update({ trigger_config: triggerConfig })
    .eq("id", workflowId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/workflows/${workflowId}`);
}

export async function unpublishWorkflowAction(workflowId: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("workflows")
    .update({ status: "draft" })
    .eq("id", workflowId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/workflows/${workflowId}`);
  revalidatePath("/workflows");
}

export async function duplicateWorkflowAction(workflowId: string) {
  const { supabase, user } = await requireUser();

  const { data: original } = await supabase
    .from("workflows")
    .select("name, description, trigger_type, trigger_config, definition")
    .eq("id", workflowId)
    .eq("user_id", user.id)
    .single();
  if (!original) throw new Error("Workflow not found.");

  const { data: copy, error } = await supabase
    .from("workflows")
    .insert({
      user_id: user.id,
      name: `${original.name} (copy)`,
      description: original.description,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      definition: original.definition,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !copy) throw new Error(error?.message || "Could not duplicate workflow.");

  revalidatePath("/workflows");
  return copy.id as string;
}

export async function regenerateWebhookTokenAction(workflowId: string) {
  const { supabase, user } = await requireUser();
  const newToken = crypto.randomUUID();

  const { error } = await supabase
    .from("workflows")
    .update({ trigger_token: newToken })
    .eq("id", workflowId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/workflows/${workflowId}`);
}

export async function deleteWorkflowAction(workflowId: string) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("workflows").delete().eq("id", workflowId).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/workflows");
  redirect("/workflows");
}

export async function saveFormFieldsAction(workflowId: string, slug: string, fields: any[]) {
  const { supabase, user } = await requireUser();

  const { data: workflow } = await supabase
    .from("workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("user_id", user.id)
    .single();
  if (!workflow) throw new Error("Workflow not found.");

  const { data: existing } = await supabase.from("forms").select("id").eq("workflow_id", workflowId).single();

  if (existing) {
    const { error } = await supabase.from("forms").update({ slug, fields }).eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("forms").insert({ workflow_id: workflowId, slug, fields });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/workflows/${workflowId}`);
  revalidatePath("/forms");
}
