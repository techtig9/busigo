import { createServiceRoleSupabase } from "@/lib/supabase/server";
import type { StepDefinition, StepStatus } from "@/types/database";
import type { RunContext, StepHandler } from "./types";
import { MAX_STEPS_PER_RUN } from "./guard-self-trigger";
import { httpRequestStep } from "./steps/http-request";
import { sendEmailStep } from "./steps/send-email";
import { delayStep } from "./steps/delay";
import { filterStep } from "./steps/filter";
import { transformDataStep } from "./steps/transform-data";
import { aiActionStep } from "./steps/ai-action";
import { webhookResponseStep } from "./steps/webhook-response";
import { deductRunCredits } from "@/lib/plans";
import { sendAlertEmail } from "./steps/send-email";

const HANDLERS: Record<string, StepHandler> = {
  http_request: httpRequestStep,
  send_email: sendEmailStep,
  delay: delayStep,
  filter: filterStep,
  transform_data: transformDataStep,
  ai_action: aiActionStep,
  webhook_response: webhookResponseStep,
};

export interface ExecuteRunOptions {
  runId: string;
  workflowId: string;
  userId: string;
  definition: StepDefinition[];
  triggerPayload: Record<string, any>;
  /** Index to resume from — used when a Delay step paused the run and the cron tick resumes it. */
  startAtIndex?: number;
  /** Prior step outputs, needed to resume a run's context after a Delay pause. */
  priorContext?: Record<string, any>;
  /** Called after every single step, in order — the SSE test-run endpoint uses this to stream progress live. */
  onStepUpdate?: (update: {
    stepKey: string;
    type: string;
    status: string;
    output: any;
    error?: string;
    waitingUntil?: string;
  }) => void;
}

export interface ExecuteRunResult {
  finalStatus: "success" | "failed" | "stopped_by_filter" | "waiting";
  webhookResponse?: { statusCode: number; body: any };
}

/**
 * Executes a workflow's step list in order. Every single step's real input/output/status/
 * duration is persisted to workflow_run_steps — no exceptions (Hard Constraint 5). A step is
 * only ever marked success because its real side effect actually succeeded.
 */
export async function executeWorkflowRun(opts: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const supabase = createServiceRoleSupabase();
  const ctx: RunContext = { data: { trigger: opts.triggerPayload, ...(opts.priorContext || {}) } };
  const startIndex = opts.startAtIndex ?? 0;
  let aiActionStepsRun = 0;

  if (opts.definition.length > MAX_STEPS_PER_RUN) {
    await finishRun(supabase, opts.runId, "failed");
    return { finalStatus: "failed" };
  }

  for (let i = startIndex; i < opts.definition.length; i++) {
    const step = opts.definition[i];
    const handler = HANDLERS[step.type];

    if (!handler) {
      await persistStep(supabase, opts.runId, step, "failed", null, `Unknown step type: "${step.type}"`, 0);
      opts.onStepUpdate?.({ stepKey: step.key, type: step.type, status: "failed", output: null, error: `Unknown step type: "${step.type}"` });
      await finishRun(supabase, opts.runId, "failed");
      return { finalStatus: "failed" };
    }

    const started = Date.now();
    const result = await handler({ step, ctx, runId: opts.runId, workflowId: opts.workflowId, userId: opts.userId });
    const durationMs = Date.now() - started;

    // Map the engine-level outcome to the DB's allowed per-step status (success/failed/skipped).
    // "stopped_by_filter" is a real, successful evaluation of the Filter step — recorded as
    // "success" at the step level, with the outcome visible in output.passed; the run itself
    // carries the stopped_by_filter status forward.
    const dbStatus: StepStatus = result.status === "stopped_by_filter" ? "success" : result.status;
    await persistStep(supabase, opts.runId, step, dbStatus, result.output, result.error, durationMs);
    opts.onStepUpdate?.({
      stepKey: step.key,
      type: step.type,
      status: result.status,
      output: result.output,
      error: result.error,
      waitingUntil: result.waitingUntil,
    });

    // Successful steps' output becomes available to every later step under its own key.
    ctx.data[step.key] = result.output;

    if (step.type === "ai_action" && result.status === "success") {
      aiActionStepsRun += 1;
    }

    if (result.waitingUntil) {
      await pauseRun(supabase, opts.runId, result.waitingUntil, i + 1, ctx.data);
      await markRemainingSkipped(supabase, opts.runId, opts.definition, i + 1, true);
      return { finalStatus: "waiting" };
    }

    if (result.status === "failed") {
      await markRemainingSkipped(supabase, opts.runId, opts.definition, i + 1, false);
      await finishRun(supabase, opts.runId, "failed");
      await alertOwnerOfFailure(supabase, opts.workflowId, opts.runId, step.key, result.error);
      return { finalStatus: "failed" };
    }

    if (result.status === "stopped_by_filter") {
      await markRemainingSkipped(supabase, opts.runId, opts.definition, i + 1, false);
      await finishRun(supabase, opts.runId, "stopped_by_filter");
      await deductRunCredits(opts.userId, "stopped_by_filter", aiActionStepsRun);
      return { finalStatus: "stopped_by_filter" };
    }

    if (step.type === "webhook_response") {
      await finishRun(supabase, opts.runId, "success");
      await deductRunCredits(opts.userId, "success", aiActionStepsRun);
      return { finalStatus: "success", webhookResponse: result.output };
    }
  }

  await finishRun(supabase, opts.runId, "success");
  await deductRunCredits(opts.userId, "success", aiActionStepsRun);
  return { finalStatus: "success" };
}

async function persistStep(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  runId: string,
  step: StepDefinition,
  status: StepStatus,
  output: any,
  error: string | undefined,
  durationMs: number
) {
  await supabase.from("workflow_run_steps").insert({
    run_id: runId,
    step_key: step.key,
    type: step.type,
    input: step.config,
    output: error ? { error } : output,
    status,
    duration_ms: durationMs,
  });
}

async function markRemainingSkipped(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  runId: string,
  definition: StepDefinition[],
  fromIndex: number,
  isWaiting: boolean
) {
  if (isWaiting) return; // the paused step's remainder will run later — nothing to mark skipped yet
  const remaining = definition.slice(fromIndex);
  if (remaining.length === 0) return;
  await supabase.from("workflow_run_steps").insert(
    remaining.map((s) => ({
      run_id: runId,
      step_key: s.key,
      type: s.type,
      input: s.config,
      output: null,
      status: "skipped" as StepStatus,
      duration_ms: 0,
    }))
  );
}

async function finishRun(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  runId: string,
  status: "success" | "failed" | "stopped_by_filter"
) {
  await supabase.from("workflow_runs").update({ status, ended_at: new Date().toISOString() }).eq("id", runId);
}

// The schema (as specified) has no dedicated column for "which step to resume from" or
// "the run's accumulated context so far" — both are required to resume a paused run
// correctly. Rather than add a migration, we use a reserved key inside trigger_payload
// (`__resume__`) that's never a real trigger field, so no schema change is needed. The cron
// tick route reads it back out when resuming (see app/api/cron/tick/route.ts).
async function pauseRun(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  runId: string,
  resumeAt: string,
  resumeIndex: number,
  context: Record<string, any>
) {
  const { data: run } = await supabase.from("workflow_runs").select("trigger_payload").eq("id", runId).single();
  const basePayload = { ...(run?.trigger_payload || {}) };
  delete basePayload.__resume__;

  await supabase
    .from("workflow_runs")
    .update({
      status: "waiting",
      resume_at: resumeAt,
      trigger_payload: { ...basePayload, __resume__: { index: resumeIndex, context } },
    })
    .eq("id", runId);
}

async function alertOwnerOfFailure(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  workflowId: string,
  runId: string,
  failedStepKey: string,
  error: string | undefined
) {
  const { data: workflow } = await supabase
    .from("workflows")
    .select("name, user_id")
    .eq("id", workflowId)
    .single();
  if (!workflow) return;

  // In-app notification — shown via the bell icon regardless of whether email delivery
  // works, so a failure is never invisible even if RESEND_API_KEY is misconfigured.
  await supabase.from("notifications").insert({
    user_id: workflow.user_id,
    title: `"${workflow.name}" failed`,
    body: `Failed at step "${failedStepKey}": ${error || "unknown error"}`,
    link: `/runs/${workflowId}/${runId}`,
  });

  const { data: owner } = await supabase.from("users").select("email").eq("id", workflow.user_id).single();
  if (!owner?.email) return;

  try {
    await sendAlertEmail(
      owner.email,
      `busigo: "${workflow.name}" failed at step "${failedStepKey}"`,
      `Your workflow "${workflow.name}" (run ${runId}) failed at step "${failedStepKey}".\n\nError: ${error || "unknown error"}\n\nView the full run trace in your busigo dashboard under Runs.`
    );
  } catch (e) {
    console.error("failed to send failure alert email", e);
  }
}
