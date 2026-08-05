"use server";

import { createServerSupabase } from "@/lib/supabase/server";

export interface SearchResult {
  workflows: { id: string; name: string; status: string; trigger_type: string }[];
  runs: { id: string; workflow_id: string; workflow_name: string; status: string; started_at: string }[];
}

const EMPTY: SearchResult = { workflows: [], runs: [] };

/**
 * Backs the dashboard top-nav search box. Uses the request-bound client (not service-role),
 * so Postgres RLS — not application code — is what actually scopes every result to the
 * signed-in user's own data; see the "own workflows crud" / "own runs" policies in
 * supabase/schema.sql. That means this function doesn't need to (and deliberately doesn't)
 * hand-roll a user_id filter on runs — even a bug here couldn't leak another user's data.
 *
 * Split into plain, individually well-supported filters (ilike, in) rather than one clever
 * combined query — a filter across a joined/embedded table inside a single .or() string is
 * exactly the kind of thing that *looks* right but is easy to get subtly wrong against real
 * PostgREST without a live instance to test against.
 */
export async function searchAction(rawQuery: string): Promise<SearchResult> {
  const query = rawQuery.trim();
  if (query.length < 2) return EMPTY;

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const escaped = query.replace(/[%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

  const { data: matchedWorkflows } = await supabase
    .from("workflows")
    .select("id, name, status, trigger_type")
    .eq("user_id", user.id)
    .ilike("name", pattern)
    .order("created_at", { ascending: false })
    .limit(5);

  const matchedWorkflowIds = (matchedWorkflows || []).map((w) => w.id);

  const [{ data: runsByStatus }, { data: runsByWorkflow }] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select("id, workflow_id, status, started_at, workflows(name)")
      .ilike("status", pattern)
      .order("started_at", { ascending: false })
      .limit(5),
    matchedWorkflowIds.length > 0
      ? supabase
          .from("workflow_runs")
          .select("id, workflow_id, status, started_at, workflows(name)")
          .in("workflow_id", matchedWorkflowIds)
          .order("started_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const runMap = new Map<string, any>();
  for (const r of [...(runsByStatus || []), ...(runsByWorkflow || [])]) {
    runMap.set(r.id, r);
  }

  return {
    workflows: matchedWorkflows || [],
    runs: Array.from(runMap.values())
      .slice(0, 5)
      .map((r: any) => ({
        id: r.id,
        workflow_id: r.workflow_id,
        workflow_name: r.workflows?.name || "Unknown workflow",
        status: r.status,
        started_at: r.started_at,
      })),
  };
}
