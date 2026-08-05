import { createServerSupabase, createServiceRoleSupabase } from "@/lib/supabase/server";
import { executeWorkflowRun } from "@/lib/engine/executor";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sse(obj: any): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, user_id, definition")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (!workflow) return new Response("Workflow not found", { status: 404 });

  const { payload } = await request.json();

  const stream = new ReadableStream({
    async start(controller) {
      const admin = createServiceRoleSupabase();
      const { data: run } = await admin
        .from("workflow_runs")
        .insert({
          workflow_id: workflow.id,
          trigger_source: "manual_test",
          status: "running",
          trigger_payload: payload,
        })
        .select("id")
        .single();

      if (!run) {
        controller.enqueue(sse({ type: "done", finalStatus: "error: could not create run" }));
        controller.close();
        return;
      }

      try {
        const result = await executeWorkflowRun({
          runId: run.id,
          workflowId: workflow.id,
          userId: user.id,
          definition: workflow.definition,
          triggerPayload: payload,
          onStepUpdate: (update) => {
            controller.enqueue(sse({ type: "step", ...update }));
          },
        });
        controller.enqueue(sse({ type: "done", finalStatus: result.finalStatus }));
      } catch (e: any) {
        controller.enqueue(sse({ type: "done", finalStatus: `error: ${e.message}` }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
