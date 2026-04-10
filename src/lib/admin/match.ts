import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { castRow, castRows } from "@/lib/supabase/cast";

/**
 * Shared payload builder for the per-allocator Match Queue.
 *
 * Why this helper exists
 *   Two routes need byte-identical SELECT logic:
 *     1. /api/admin/match/[allocator_id] — auth-gated; admin-only.
 *     2. /api/demo/match/[allocator_id] — public, HARD-LOCKED to the seed
 *        ALLOCATOR_ACTIVE UUID.
 *   Keeping the SELECT logic inline in both routes drifted in earlier
 *   sprints (demo route forgot a column; admin route forgot a filter).
 *   Extracting them into this single helper guarantees the two routes
 *   can never diverge again.
 *
 *   The caller is responsible for auth/authorization. This helper only
 *   knows "give me the payload for allocator X using admin credentials".
 *
 * Column enumeration
 *   The `allocator_preferences` SELECT used to be `*`. Hardened here by
 *   listing columns explicitly — after migration 017 revoke'd email +
 *   linkedin on profiles, the same principle applies to any table that
 *   might grow PII. Add new columns here when the UI starts consuming
 *   them; wildcard selects are a forever footgun.
 */

// --- Preference column list ------------------------------------------------
// The exact columns consumed by AllocatorMatchQueue.tsx + PreferencesPanel.
// If you add a new column that the queue reads, add it here too — the
// TypeScript type on `AllocatorPreferences` in AllocatorMatchQueue.tsx is the
// source of truth.
const ALLOCATOR_PREFERENCES_COLUMNS =
  "user_id, mandate_archetype, target_ticket_size_usd, excluded_exchanges, " +
  "max_drawdown_tolerance, min_track_record_days, min_sharpe, " +
  "max_aum_concentration, preferred_strategy_types, preferred_markets, " +
  "founder_notes, updated_at";

// --- Return type -----------------------------------------------------------
// Kept deliberately loose (Record<string, unknown> for the batch JSONB fields
// and nested relationships) so the consuming React components — which own
// their own type definitions — receive exactly the same JSON shape they got
// before the extract. Tightening these further is worth a separate PR.

export interface AllocatorMatchPayload {
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown> | null;
  batch: Record<string, unknown> | null;
  candidates: Array<Record<string, unknown>>;
  excluded: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  existing_contact_requests: Array<{
    strategy_id: string;
    created_at: string;
    status: string;
  }>;
}

export async function getAllocatorMatchPayload(
  admin: SupabaseClient,
  allocatorId: string,
): Promise<AllocatorMatchPayload> {
  // ── Parallel fan-out ───────────────────────────────────────────────
  // These five queries are mutually independent: none references a field
  // from any of the others. Firing them sequentially used to cost ~5 ×
  // (one Supabase RTT) ≈ 200-400ms on a cold queue load. Fan them out in
  // parallel so the total latency drops to roughly one RTT.
  //
  // The ONLY dependency is from `match_batches` → `match_candidates`
  // (we need batch.id to filter candidates), so the candidates fetch
  // stays sequential after the fan-out resolves.
  //
  // Error handling: `allocator_preferences` uses `.maybeSingle()` whose
  // null/no-row path is legitimate — but a real error (e.g., a dropped
  // column due to schema drift) must still bubble up as a 500. We keep
  // the same pair of (data, error) checks as the sequential version.
  const [
    batchRes,
    preferencesRes,
    profileRes,
    decisionsRes,
    existingContactRequestsRes,
  ] = await Promise.all([
    admin
      .from("match_batches")
      .select(
        "id, computed_at, mode, filter_relaxed, candidate_count, excluded_count, " +
          "engine_version, weights_version, effective_preferences, " +
          "effective_thresholds, source_strategy_count, latency_ms",
      )
      .eq("allocator_id", allocatorId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("allocator_preferences")
      .select(ALLOCATOR_PREFERENCES_COLUMNS)
      .eq("user_id", allocatorId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select(
        "id, display_name, company, email, role, allocator_status, preferences_updated_at",
      )
      .eq("id", allocatorId)
      .single(),
    admin
      .from("match_decisions")
      .select(
        "id, strategy_id, decision, founder_note, contact_request_id, created_at, " +
          "strategies!match_decisions_strategy_id_fkey(id, name, codename, disclosure_tier)",
      )
      .eq("allocator_id", allocatorId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("contact_requests")
      .select("strategy_id, created_at, status")
      .eq("allocator_id", allocatorId),
  ]);

  // Surface errors from every fan-out query consistently. Previously only
  // batch + preferences were error-checked; profile/decisions/contact-requests
  // silently coerced their errors into null/[], which would render a
  // "profile unknown, no history" UI state that looks like real data but is
  // actually a network or schema drift failure. Throw on any real error so
  // the UI gets a 500 rather than a misleading empty state.
  if (batchRes.error) throw batchRes.error;
  if (preferencesRes.error) throw preferencesRes.error;
  if (profileRes.error) throw profileRes.error;
  if (decisionsRes.error) throw decisionsRes.error;
  if (existingContactRequestsRes.error) throw existingContactRequestsRes.error;

  const batchRow = (batchRes.data as Record<string, unknown> | null) ?? null;
  const preferences = preferencesRes.data;
  const profile = profileRes.data;
  const decisions = decisionsRes.data;
  const existingContactRequests = existingContactRequestsRes.data;

  if (!batchRow) {
    return {
      profile: castRow<Record<string, unknown>>(profile, "profile"),
      preferences:
        castRow<Record<string, unknown> | null>(preferences ?? null, "preferences"),
      batch: null,
      candidates: [],
      excluded: [],
      decisions:
        castRows<Record<string, unknown>>(decisions),
      existing_contact_requests:
        castRows<{ strategy_id: string; created_at: string; status: string }>(existingContactRequests),
    };
  }

  // Candidates + excluded for the latest batch — explicit column projection
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

  // Supabase's generated row types for Postgres select strings with inline
  // joins don't flatten cleanly into Record<string, unknown> — the generic
  // `GenericStringError` type leaks through. Use castRows to centralize
  // the cast surface. The consuming React components in
  // AllocatorMatchQueue.tsx own the narrow CandidateRow type.
  const candidateRowsArr = castRows<Record<string, unknown>>(candidateRows);

  // Split into candidates (eligible) and excluded
  const candidates = candidateRowsArr.filter((r) => r.exclusion_reason === null);
  const excluded = candidateRowsArr.filter((r) => r.exclusion_reason !== null);

  // Bulk analytics fetch — one round trip for every candidate's strategy_id
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
    const analyticsArr =
      (analyticsRows as Array<Record<string, unknown>> | null) ?? [];
    analyticsByStrategyId = Object.fromEntries(
      analyticsArr.map((row) => [row.strategy_id as string, row]),
    );
  }

  const enrichWithAnalytics = (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => ({
      ...r,
      analytics: analyticsByStrategyId[r.strategy_id as string] ?? null,
    }));

  return {
    profile: castRow<Record<string, unknown>>(profile, "profile"),
    preferences:
      castRow<Record<string, unknown> | null>(preferences ?? null, "preferences"),
    batch: batchRow,
    candidates: enrichWithAnalytics(candidates),
    excluded: enrichWithAnalytics(excluded),
    decisions:
      castRows<Record<string, unknown>>(decisions),
    existing_contact_requests:
      castRows<{ strategy_id: string; created_at: string; status: string }>(existingContactRequests),
  };
}
