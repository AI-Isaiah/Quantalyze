import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { bridgeOutcomeCurvesLimiter, checkLimit } from "@/lib/ratelimit";

/**
 * GET /api/bridge/outcome/[id]/curves
 *
 * Phase 5 D-16: lazy sparkline data for the Outcomes Dashboard expanded row.
 * Returns equity curves of both the original (underperformer) and replacement
 * strategies, rebased to 100 at `allocated_at`, windowed 180 days forward.
 *
 * Auth (T-05-01 mitigation): ownership proved FIRST via user-scoped SELECT
 * on bridge_outcomes (RLS filters by allocator_id=auth.uid()). 404 if not
 * owned. ONLY AFTER ownership proof do we hit admin client.
 *
 * Original strategy resolution (D-20a revised): the underperformer id
 * lives on match_decisions.original_strategy_id, NOT on bridge_outcomes.
 * We hop bridge_outcomes.match_decision_id -> match_decisions.original_strategy_id
 * via an admin-client SELECT (match_decisions has no allocator-self-SELECT
 * RLS policy). If match_decision_id is null (theoretical case per migration
 * 059 ON DELETE SET NULL), the original series is returned as []; the UI
 * renders em-dash per D-03.
 *
 * Rate limit (T-05-02 + Voice-D10): bridgeOutcomeCurvesLimiter (60/60s per
 * user). Distinct from userActionLimiter (5/60s) so curve-exploration does
 * not burn budget reserved for sensitive POSTs.
 *
 * Auth inlined (not withAuth) — withAuth does not forward dynamic-route
 * ctx.params. See src/app/api/strategies/draft/[id]/route.ts precedent.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getAuthedUserIdOrError(
  _req: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Approval gate (PR #266 follow-up): bridge-outcome curves are
  // allocator-dashboard data; pending-approval users have no business
  // reading them.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;
  return { userId: user.id };
}

type ReturnsPoint = { date: string; value: number };

/**
 * Rebase cumulative NAV to 100 at allocated_at. Pitfall 5: if exact anchor
 * missing, fall-forward to first date >= allocated_at. Pitfall 2: series
 * is cumulative equity, NOT daily returns — take ratio, never sum.
 */
function rebaseToAnchor(
  series: ReturnsPoint[],
  allocatedAt: string,
): Array<{ date: string; nav: number }> {
  if (!series || series.length === 0) return [];

  const postAnchor = series
    .filter((p) => p.date >= allocatedAt)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (postAnchor.length === 0) return [];

  const anchorValue = postAnchor[0].value;
  if (!anchorValue || anchorValue <= 0) return [];

  return postAnchor.map((p) => ({
    date: p.date,
    nav: (100 * p.value) / anchorValue,
  }));
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const authResult = await getAuthedUserIdOrError(req);
  if (authResult instanceof NextResponse) return authResult;
  const userId = authResult.userId;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Voice-D10: dedicated limiter; does not share budget with userActionLimiter.
  // B15: consume the token AFTER input validation so a malformed request
  // rejected with 400 never burns one of the caller's own rate-limit tokens.
  const rl = await checkLimit(
    bridgeOutcomeCurvesLimiter,
    `bridge_outcome_curves:${userId}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Step 1: ownership gate via user-scoped client (RLS enforces allocator_id=auth.uid()).
  const supabase = await createClient();
  const { data: outcome, error: outcomeErr } = await supabase
    .from("bridge_outcomes")
    .select("id, allocator_id, strategy_id, match_decision_id, allocated_at")
    .eq("id", id)
    .maybeSingle();

  if (outcomeErr || !outcome) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // C-0080 (audit-2026-05-07): defense-in-depth cross-tenant guard. RLS
  // policy bridge_outcomes_select_own already filters by allocator_id=auth.uid()
  // at the DB layer, but this route then hops to the admin client to read
  // strategy_analytics. An explicit app-layer equality check ensures that
  // even if RLS were ever weakened or misconfigured, a probe that knows an
  // outcome UUID from a different tenant cannot reach the admin-hop branch.
  // Return 404 (not 403) so the response cannot distinguish "exists but not
  // yours" from "doesn't exist".
  if ((outcome as { allocator_id: string }).allocator_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allocatedAt = (outcome as { allocated_at: string | null }).allocated_at;
  if (!allocatedAt) {
    // Rejected outcomes have allocated_at=null — no rebase anchor.
    return NextResponse.json({
      original: [],
      replacement: [],
      allocated_at: null,
    });
  }

  const strategyId = (outcome as { strategy_id: string }).strategy_id;
  const matchDecisionId = (outcome as { match_decision_id: string | null }).match_decision_id;

  // Step 2: resolve original_strategy_id via match_decisions (admin client —
  // match_decisions has no allocator-self-SELECT RLS policy).
  const admin = createAdminClient();
  let originalStrategyId: string | null = null;
  if (matchDecisionId) {
    const { data: decision, error: decisionErr } = await admin
      .from("match_decisions")
      .select("original_strategy_id")
      .eq("id", matchDecisionId)
      .maybeSingle();
    if (!decisionErr && decision) {
      originalStrategyId = (decision as { original_strategy_id: string | null }).original_strategy_id;
    }
  }

  // Step 3: returns_series for both strategies (non-null ids only).
  const strategyIds = [strategyId, ...(originalStrategyId ? [originalStrategyId] : [])];
  const { data: analytics, error: analyticsErr } = await admin
    .from("strategy_analytics")
    .select("strategy_id, returns_series")
    .in("strategy_id", strategyIds);

  if (analyticsErr) {
    console.error("[api/bridge/outcome/curves] analytics fetch error:", analyticsErr);
    return NextResponse.json({ error: "Failed to load curves" }, { status: 500 });
  }

  const rowsByStrategy = new Map<string, ReturnsPoint[]>();
  for (const row of analytics ?? []) {
    const sid = (row as { strategy_id: string }).strategy_id;
    const series = (row as { returns_series: ReturnsPoint[] | null }).returns_series ?? [];
    rowsByStrategy.set(sid, series);
  }

  // Step 4: rebase + window.
  const windowEnd = addDaysISO(allocatedAt, 180);
  const rebaseAndWindow = (sid: string | null) => {
    if (!sid) return [];
    const series = rowsByStrategy.get(sid) ?? [];
    return rebaseToAnchor(series, allocatedAt).filter((p) => p.date <= windowEnd);
  };

  return NextResponse.json({
    original: rebaseAndWindow(originalStrategyId),
    replacement: rebaseAndWindow(strategyId),
    allocated_at: allocatedAt,
  });
}
