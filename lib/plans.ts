import { createServiceRoleSupabase } from "@/lib/supabase/server";
import type { Plan } from "@/types/database";
import {
  CREDIT_COST_CEILING_USD,
  PLAN_CREDITS,
  PLAN_PRICE_USD,
  ANNUAL_DISCOUNT_PCT,
  annualMonthlyPrice,
  LAUNCH_DISCOUNT_PCT,
  launchMonthlyPrice,
  CREDIT_TOPUPS,
  topupMarginPct,
  planMarginPct,
  PLAN_LIMITS,
  CREDIT_COSTS,
  planLabel,
} from "@/lib/pricing";

// All plan/credit/price configuration now lives in lib/pricing.ts (pure, dependency-free —
// see the strategy comment there — and directly unit-tested in test/pricing.test.mjs).
// Re-exported here so existing imports of `@/lib/plans` for pricing data keep working; this
// file itself only adds the Supabase-backed access-control logic that USES that data.
export {
  CREDIT_COST_CEILING_USD,
  PLAN_CREDITS,
  PLAN_PRICE_USD,
  ANNUAL_DISCOUNT_PCT,
  annualMonthlyPrice,
  LAUNCH_DISCOUNT_PCT,
  launchMonthlyPrice,
  CREDIT_TOPUPS,
  topupMarginPct,
  planMarginPct,
  PLAN_LIMITS,
  CREDIT_COSTS,
  planLabel,
};

export type FeatureCheck =
  | { action: "publish_workflow"; currentWorkflowCount: number }
  | { action: "add_step"; stepType: string; currentStepCount: number }
  | { action: "use_ai_action" }
  | { action: "use_version_history" }
  | { action: "connect_app" }
  | { action: "trigger_run" }; // credits check

export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;
}

interface UserPlanInfo {
  role: "user" | "admin";
  plan: Plan;
  creditsRemaining: number;
}

async function getUserPlanInfo(userId: string): Promise<UserPlanInfo | null> {
  const supabase = createServiceRoleSupabase();
  const { data: user } = await supabase.from("users").select("role").eq("id", userId).single();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, credits_remaining")
    .eq("user_id", userId)
    .single();

  if (!user || !sub) return null;
  return { role: user.role, plan: sub.plan as Plan, creditsRemaining: sub.credits_remaining };
}

/**
 * Single shared gate for every plan-limited action. role = 'admin' always bypasses it —
 * admins get unlimited access with zero credit deduction (Phase 1.9).
 */
export async function canUseFeature(userId: string, check: FeatureCheck): Promise<FeatureCheckResult> {
  const info = await getUserPlanInfo(userId);
  if (!info) return { allowed: false, reason: "No active subscription found." };
  if (info.role === "admin") return { allowed: true };

  const limits = PLAN_LIMITS[info.plan];

  switch (check.action) {
    case "publish_workflow":
      if (check.currentWorkflowCount >= limits.maxWorkflows) {
        return {
          allowed: false,
          reason: `Your ${info.plan} plan allows up to ${limits.maxWorkflows} workflows. Upgrade to publish more.`,
        };
      }
      return { allowed: true };

    case "add_step":
      if (check.stepType === "ai_action" && !limits.aiActionStep) {
        return { allowed: false, reason: `AI Action steps require the Starter plan or higher. Upgrade to use this step type.` };
      }
      if (check.currentStepCount >= limits.maxStepsPerWorkflow) {
        return {
          allowed: false,
          reason: `Your ${info.plan} plan allows up to ${limits.maxStepsPerWorkflow} steps per workflow. Upgrade for more.`,
        };
      }
      return { allowed: true };

    case "use_ai_action":
      return limits.aiActionStep
        ? { allowed: true }
        : { allowed: false, reason: "AI Action steps require the Starter plan or higher." };

    case "use_version_history":
      return limits.versionHistory
        ? { allowed: true }
        : { allowed: false, reason: "Version history requires the Starter plan or higher." };

    case "connect_app":
      return limits.appConnections
        ? { allowed: true }
        : { allowed: false, reason: "App connections require the Pro plan." };

    case "trigger_run":
      if (info.creditsRemaining < CREDIT_COSTS.RUN_SUCCESS_OR_STOPPED) {
        return { allowed: false, reason: "You're out of credits for this billing cycle. Upgrade or wait for renewal." };
      }
      return { allowed: true };

    default:
      return { allowed: true };
  }
}

/**
 * Deducts credits for a completed run. Never called for a run that ends `failed` — the
 * executor only calls this on the success / stopped_by_filter paths. Admins are exempt.
 */
export async function deductRunCredits(userId: string, outcome: "success" | "stopped_by_filter", aiActionStepsRun: number) {
  const supabase = createServiceRoleSupabase();
  const { data: user } = await supabase.from("users").select("role").eq("id", userId).single();
  if (user?.role === "admin") return;

  const cost = CREDIT_COSTS.RUN_SUCCESS_OR_STOPPED + aiActionStepsRun * CREDIT_COSTS.AI_ACTION_STEP;

  const { data: sub } = await supabase.from("subscriptions").select("id, credits_remaining").eq("user_id", userId).single();
  if (!sub) return;

  await supabase
    .from("subscriptions")
    .update({ credits_remaining: Math.max(0, sub.credits_remaining - cost) })
    .eq("id", sub.id);
}
