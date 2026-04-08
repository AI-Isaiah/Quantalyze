import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/demo/match/[allocator_id]
//
// PUBLIC demo endpoint — no auth. This mirrors /api/admin/match/[allocator_id]
// but is HARD-LOCKED to the ALLOCATOR_ACTIVE seed UUID so a forwarded demo
// link cannot be pointed at a real allocator's match queue.
//
// Used by /demo/founder-view which renders AllocatorMatchQueue with
// forceReadOnly=true and sourceApiPath="/api/demo/match".
const ALLOCATOR_ACTIVE_ID = "aaaaaaaa-0001-4000-8000-000000000002";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const { allocator_id } = await params;

  // Hard assert: only the seeded Active Allocator is readable from this route.
  // Any other UUID (including admin-visible ones) gets a 403 to avoid exposing
  // real allocator state through the public demo lane.
  if (allocator_id !== ALLOCATOR_ACTIVE_ID) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  try {
    // Latest batch for this allocator
    const { data: batchRowRaw, error: batchErr } = await admin
      .from("match_batches")
      .select(
        "id, computed_at, mode, filter_relaxed, candidate_count, excluded_count, " +
          "engine_version, weights_version, effective_preferences, " +
          "effective_thresholds, source_strategy_count, latency_ms",
      )
      .eq("allocator_id", allocator_id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (batchErr) throw batchErr;
    const batchRow = batchRowRaw as Record<string, unknown> | null;

    // Preferences (full row — safe because allocator_id is pinned to the seed UUID)
    const { data: preferences } = await admin
      .from("allocator_preferences")
      .select("*")
      .eq("user_id", allocator_id)
      .maybeSingle();

    // Allocator profile
    const { data: profile } = await admin
      .from("profiles")
      .select("id, display_name, company, email, role, allocator_status, preferences_updated_at")
      .eq("id", allocator_id)
      .single();

    // Recent decisions (last 50)
    const { data: decisions } = await admin
      .from("match_decisions")
      .select(
        "id, strategy_id, decision, founder_note, contact_request_id, created_at, " +
          "strategies!match_decisions_strategy_id_fkey(id, name, codename, disclosure_tier)",
      )
      .eq("allocator_id", allocator_id)
      .order("created_at", { ascending: false })
      .limit(50);

    // Already-sent contact requests
    const { data: existingContactRequests } = await admin
      .from("contact_requests")
      .select("strategy_id, created_at, status")
      .eq("allocator_id", allocator_id);

    if (!batchRow) {
      return NextResponse.json({
        profile,
        preferences,
        batch: null,
        candidates: [],
        excluded: [],
        decisions: decisions ?? [],
        existing_contact_requests: existingContactRequests ?? [],
      });
    }

    // Candidates + excluded for the latest batch
    const { data: candidateRows, error: candErr } = await admin
      .from("match_candidates")
      .select(
        "id, strategy_id, score, score_breakdown, reasons, rank, exclusion_reason, exclusion_provenance, " +
          "strategies!match_candidates_strategy_id_fkey(id, name, codename, disclosure_tier, " +
          "strategy_types, supported_exchanges, aum, max_capacity, user_id)",
      )
      .eq("batch_id", batchRow.id as string)
      .order("rank", { ascending: true, nullsFirst: false });

    if (candErr) throw candErr;

    const candidateRowsArr = (candidateRows as unknown as Array<Record<string, unknown>>) ?? [];

    const candidates = candidateRowsArr.filter((r) => r.exclusion_reason === null);
    const excluded = candidateRowsArr.filter((r) => r.exclusion_reason !== null);

    // Bulk analytics fetch
    const strategyIds = candidateRowsArr
      .map((r) => r.strategy_id as string)
      .filter(Boolean);
    let analyticsByStrategyId: Record<string, Record<string, unknown>> = {};
    if (strategyIds.length > 0) {
      const { data: analyticsRows } = await admin
        .from("strategy_analytics")
        .select(
          "strategy_id, sharpe, sortino, max_drawdown, cagr, volatility, " +
            "six_month_return, cumulative_return, total_aum, sparkline_returns",
        )
        .in("strategy_id", strategyIds);
      const analyticsArr = (analyticsRows as unknown as Array<Record<string, unknown>>) ?? [];
      analyticsByStrategyId = Object.fromEntries(
        analyticsArr.map((row) => [row.strategy_id as string, row]),
      );
    }

    const enrichWithAnalytics = (rows: Array<Record<string, unknown>>) =>
      rows.map((r) => ({
        ...r,
        analytics: analyticsByStrategyId[r.strategy_id as string] ?? null,
      }));

    return NextResponse.json({
      profile,
      preferences,
      batch: batchRow,
      candidates: enrichWithAnalytics(candidates),
      excluded: enrichWithAnalytics(excluded),
      decisions: decisions ?? [],
      existing_contact_requests: existingContactRequests ?? [],
    });
  } catch (err) {
    console.error("[api/demo/match/[allocator_id]] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
