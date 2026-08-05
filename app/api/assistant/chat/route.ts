import { createServerSupabase } from "@/lib/supabase/server";
import { PLAN_CREDITS, PLAN_PRICE_USD, planLabel } from "@/lib/plans";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function buildAccountContext(userId: string) {
  const supabase = createServerSupabase();

  const [{ data: profile }, { data: sub }, { data: workflows }, { data: recentRuns }] = await Promise.all([
    supabase.from("users").select("name").eq("id", userId).single(),
    supabase.from("subscriptions").select("plan, credits_remaining").eq("user_id", userId).single(),
    supabase.from("workflows").select("id, name, status, trigger_type, definition").eq("user_id", userId),
    supabase
      .from("workflow_runs")
      .select("status, started_at, workflow_id, workflows!inner(name, user_id)")
      .eq("workflows.user_id", userId)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  const plan = (sub?.plan as any) || "free";
  const creditsTotal = PLAN_CREDITS[plan] ?? 0;
  const creditsRemaining = sub?.credits_remaining ?? 0;

  const workflowSummaries = (workflows || []).map(
    (w: any) => `- "${w.name}" (${w.status}, ${w.trigger_type} trigger, ${(w.definition || []).length} steps)`
  );

  const runs = recentRuns || [];
  const failed = runs.filter((r: any) => r.status === "failed");
  const failureRate = runs.length > 0 ? Math.round((failed.length / runs.length) * 100) : 0;

  return `
Account context (real data, gathered just now — use it, don't guess):
- User's name: ${profile?.name || "unknown"}
- Plan: ${planLabel(plan)}${PLAN_PRICE_USD[plan] != null ? ` ($${PLAN_PRICE_USD[plan]}/mo)` : ""}
- Credits: ${creditsRemaining.toLocaleString()} remaining of ${creditsTotal.toLocaleString()} this cycle (${creditsTotal > 0 ? Math.round((creditsRemaining / creditsTotal) * 100) : 0}% left)
- Workflows (${workflows?.length ?? 0} total):
${workflowSummaries.length ? workflowSummaries.join("\n") : "  (none yet)"}
- Last ${runs.length} runs: ${failed.length} failed (${failureRate}% failure rate)${
    failed[0] ? `, most recent failure was on "${(failed[0] as any).workflows?.name}"` : ""
  }
`.trim();
}

const SYSTEM_PROMPT = `You are the busigo Assistant, a helpful in-app guide for busigo — an AI-powered business
process automation platform (trigger -> ordered list of steps: HTTP Request, Send Email, Delay,
Filter, Transform Data, AI Action, Webhook Response).

Your job is to help the signed-in user understand their account and make good decisions:
explain what's happening in their workflows and runs, suggest fixes when something is failing,
recommend when upgrading plan or buying credit top-ups would actually help (only when it
genuinely would — never push an upgrade that wouldn't help their stated problem), and explain
how credits, steps, and triggers work.

Ground every specific claim about the user's own account in the "Account context" block you're
given — never invent workflow names, run counts, or credit numbers that aren't in it. If
something isn't in the context, say you don't have that detail rather than guessing.

You are advisory only: you cannot create, edit, publish, or run a workflow yourself, and you
should say so plainly if asked to take an action — then explain how the user can do it
themselves in the dashboard (e.g. "open Workflows > [name] and add a Filter step").

Keep answers short and concrete — a few sentences or a short list, not an essay. No preamble.`;

function toGeminiContents(messages: { role: "user" | "assistant"; content: string }[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages } = (await request.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Bad request", { status: 400 });
  }

  const context = await buildAccountContext(user.id);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const geminiResponse = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
          {
            method: "POST",
            headers: {
              "x-goog-api-key": process.env.GOOGLE_AI_API_KEY ?? "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${context}` }] },
              contents: toGeminiContents(messages.slice(-12)),
              generationConfig: { maxOutputTokens: 600 },
            }),
          }
        );

        if (!geminiResponse.ok || !geminiResponse.body) {
          throw new Error(`Gemini API failed: ${geminiResponse.status}`);
        }

        const reader = geminiResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) controller.enqueue(encoder.encode(text));
            } catch {
              // Partial/malformed chunk — skip it rather than crash the whole stream.
            }
          }
        }
      } catch (e) {
        console.error("assistant chat error", e);
        controller.enqueue(encoder.encode("\n\n(Sorry — something went wrong reaching the assistant.)"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
