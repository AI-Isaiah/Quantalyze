import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";

// GET /api/admin/match/[allocator_id]
//
// Returns the latest match batch for the given allocator, joined to strategies,
// analytics, preferences, and recent decisions. Also returns the set of
// (strategy_id) pairs where a contact_request ALREADY EXISTS so the Send Intro
// modal can show the already-sent state before submission.
//
// Payload size budget: < 500 KB at N=30 (enforced in tests).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const { allocator_id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!(await isAdminUser(supabase, user))) {
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

    // Preferences (full row; admin can see everything)
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
          "strategies!match_decisions_strategy_id_fkey(id, name, codename)",
      )
      .eq("allocator_id", allocator_id)
      .order("created_at", { ascending: false })
      .limit(50);

    // Already-sent contact requests (for the "already sent" check on Send Intro)
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

    // Candidates + excluded for the latest batch — explicit column projection
    const { data: candidateRows, error: candErr } = await admin
      .from("match_candidates")
      .select(
        "id, strategy_id, score, score_breakdown, reasons, rank, exclusion_reason, exclusion_provenance, " +
          "strategies!match_candidates_strategy_id_fkey(id, name, codename, " +
          "strategy_types, supported_exchanges, aum, max_capacity, user_id)",
      )
      .eq("batch_id", batchRow.id as string)
      .order("rank", { ascending: true, nullsFirst: false });

    if (candErr) throw candErr;

    const candidateRowsArr = (candidateRows as unknown as Array<Record<string, unknown>>) ?? [];

    // Split into candidates and excluded
    const candidates = candidateRowsArr.filter((r) => r.exclusion_reason === null);
    const excluded = candidateRowsArr.filter((r) => r.exclusion_reason !== null);

    // Fetch strategy_analytics in one bulk query for the strategy_ids we need
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

    // Attach analytics to each candidate row so the UI has everything it needs
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
    console.error("[api/admin/match/[allocator_id]] error:", err);
    // Don't leak Postgres constraint/column names to the client.
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
