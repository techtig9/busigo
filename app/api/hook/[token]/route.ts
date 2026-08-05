import { createServiceRoleSupabase } from "@/lib/supabase/server";
import { executeWorkflowRun } from "@/lib/engine/executor";
import { isRateLimited } from "@/lib/engine/rate-limit";
import { canUseFeature } from "@/lib/plans";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: NextRequest, token: string) {
  const supabase = createServiceRoleSupabase();

  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, user_id, definition, status, trigger_type")
    .eq("trigger_token", token)
    .single();

  if (!workflow || workflow.status !== "published" || workflow.trigger_type !== "webhook") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (await isRateLimited(workflow.id)) {
    return NextResponse.json({ error: "Rate limit exceeded — too many triggers in the last minute." }, { status: 429 });
  }

  const gate = await canUseFeature(workflow.user_id, { action: "trigger_run" });
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 402 });
  }

  let body: any = {};
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  } else if (request.method !== "GET") {
    try {
      body = { raw: await request.text() };
    } catch {
      body = {};
    }
  }

  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const triggerPayload = { ...query, ...body };

  const { data: run } = await supabase
    .from("workflow_runs")
    .insert({ workflow_id: workflow.id, trigger_source: "webhook", status: "running", trigger_payload: triggerPayload })
    .select("id")
    .single();

  if (!run) {
    return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  }

  const result = await executeWorkflowRun({
    runId: run.id,
    workflowId: workflow.id,
    userId: workflow.user_id,
    definition: workflow.definition,
    triggerPayload,
  });

  if (result.webhookResponse) {
    return NextResponse.json(result.webhookResponse.body, { status: result.webhookResponse.statusCode });
  }

  return NextResponse.json({ ok: result.finalStatus === "success", runId: run.id, status: result.finalStatus });
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  return handle(request, params.token);
}

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  return handle(request, params.token);
}
