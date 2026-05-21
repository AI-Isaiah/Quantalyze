import type { createAdminClient } from "@/lib/supabase/admin";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

/**
 * Demo match-recommendations fetcher.
 *
 * Extracted from `src/app/demo/page.tsx` so the two-batch fallback chain
 * (latest batch → previous batch when latest is empty) is unit-testable
 * without spinning up Next.js. The /demo page calls this with an admin
 * Supabase client and a list of recent batch IDs; if the latest batch
 * produced zero candidates, the fallback prevents the friend's forwarded
 * URL from landing on an empty page.
 */

type StrategySummary = Pick<
  Strategy,
  "id" | "name" | "codename" | "disclosure_tier" | "description"
>;

type AnalyticsSummary = Pick<
  StrategyAnalytics,
  "cagr" | "sharpe" | "max_drawdown"
>;

export interface RecommendationRow {
  id: string;
  rank: number | null;
  score: number;
  reasons: string[];
  strategy: StrategySummary;
  analytics: AnalyticsSummary | null;
}

export interface BatchSummary {
  id: string;
  computed_at?: string;
  /**
   * audit-2026-05-07 C-0123 — number of candidates this batch produced
   * (column `match_batches.candidate_count`, default 0). The recompute
   * writer sets this AFTER inserting `match_candidates` rows, so it
   * doubles as the success discriminator that closes the race window
   * where a `match_batches` row exists but its candidates have not yet
   * been written. Treated as a "fresh / ready" gate when paired with
   * `latestRows.length >= 3`. Optional for backwards-compat with the
   * older `BatchSummary` callers; missing values are treated as
   * "unknown success state" and the row-count threshold alone gates.
   */
  candidate_count?: number;
}

/**
 * audit-2026-05-07 C-0123 — minimum candidates the latest batch must
 * return before we treat it as the authoritative recommendation set.
 * Below this we prefer to fall back to the previous batch rather than
 * render a sparse "Top matches" list (the friend-forwarded URL case).
 *
 * Why >= 3 specifically: the demo UI renders up to 3 cards under the
 * "Top matches" heading. A latest-batch result of 1-2 candidates is
 * usually one of:
 *   (a) the recompute is mid-flight (race: batch row inserted but only
 *       1-2 candidates persisted so far — gated by `candidate_count`),
 *   (b) heavy exclusion filters left only 1-2 rows ranked non-null
 *       (the bug the finding cites — friend sees a half-broken page).
 * Falling back to the previous batch is strictly better for both.
 */
export const MIN_LATEST_RECOMMENDATIONS = 3;

type AdminClient = ReturnType<typeof createAdminClient>;

// Supabase nested selects return either an object or an array-wrapped
// object depending on the FK cardinality. Normalize to a plain record or
// null so the field extractors below stay trivial.
function unwrapRow(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function extractStrategy(raw: unknown): StrategySummary | null {
  const r = unwrapRow(raw);
  if (!r) return null;
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    codename: (r.codename as string | null) ?? null,
    disclosure_tier:
      (r.disclosure_tier as StrategySummary["disclosure_tier"]) ?? undefined,
    description: (r.description as string | null) ?? null,
  };
}

function toAnalyticsSummary(raw: unknown): AnalyticsSummary | null {
  const r = unwrapRow(raw);
  if (!r) return null;
  return {
    cagr: (r.cagr as number | null) ?? null,
    sharpe: (r.sharpe as number | null) ?? null,
    max_drawdown: (r.max_drawdown as number | null) ?? null,
  };
}

/**
 * Fetch the top 3 non-excluded recommendations for a given match batch.
 */
export async function fetchCandidatesForBatch(
  admin: AdminClient,
  batchId: string,
): Promise<RecommendationRow[]> {
  const { data: rows } = await admin
    .from("match_candidates")
    .select(
      `id, rank, score, reasons, exclusion_reason,
       strategies!inner (
         id, name, codename, disclosure_tier, description,
         strategy_analytics (cagr, sharpe, max_drawdown)
       )`,
    )
    .eq("batch_id", batchId)
    .is("exclusion_reason", null)
    .not("rank", "is", null)
    .order("rank", { ascending: true })
    .limit(3);

  return ((rows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const strategyRow = unwrapRow(row.strategies);
    const strategy = extractStrategy(strategyRow);
    const analytics = toAnalyticsSummary(strategyRow?.strategy_analytics);
    return {
      id: row.id as string,
      rank: (row.rank as number | null) ?? null,
      score: (row.score as number) ?? 0,
      reasons: (row.reasons as string[] | null) ?? [],
      // `strategies!inner` guarantees a non-null strategy row in production,
      // but the test fake and any future RLS misconfig could violate it —
      // fall back to a stub rather than crash the page.
      strategy: strategy ?? {
        id: row.strategy_id as string,
        name: "",
        codename: null,
        disclosure_tier: undefined,
        description: null,
      },
      analytics,
    };
  });
}

/**
 * Resolve the recommendation set for the demo page using the two-batch
 * fallback chain. If the latest batch produced any candidates, return them
 * with that batch ID. If empty, fall back to the previous batch (so the
 * friend's forwarded URL never lands on an empty appendix). Returns
 * `usedBatchId === null` when no batch produced candidates.
 *
 * Sequential by design, not parallel: the common case is that the latest
 * batch produced candidates, so we only hit Supabase once. Firing both
 * queries in parallel would double the Supabase request budget per demo
 * page load to save ~50ms on the rare fallback path. If the latest batch
 * miss rate ever rises above ~20%, revisit.
 */
export interface ResolveRecommendationsArgs {
  admin: AdminClient;
  batches: BatchSummary[];
}

export interface ResolveRecommendationsResult {
  recommendations: RecommendationRow[];
  usedBatchId: string | null;
  fellBackToPrevious: boolean;
}

export async function resolveDemoRecommendations(
  args: ResolveRecommendationsArgs,
): Promise<ResolveRecommendationsResult> {
  const { admin, batches } = args;
  if (batches.length === 0) {
    return { recommendations: [], usedBatchId: null, fellBackToPrevious: false };
  }
  const latest = batches[0];
  const latestRows = await fetchCandidatesForBatch(admin, latest.id);
  // audit-2026-05-07 C-0123 — tighten the fallback threshold. Previously
  // any non-empty result claimed batches[0], so the friend-forwarded URL
  // landed on a 1-card "Top matches" page when exclusion filters left
  // ranked-null. Now require BOTH:
  //   1. at least MIN_LATEST_RECOMMENDATIONS hydrated rows, and
  //   2. when the caller provides `candidate_count`, the writer-side
  //      success discriminator agrees the batch is fully populated
  //      (candidate_count >= MIN_LATEST_RECOMMENDATIONS). This closes
  //      the race window where the batch row exists but only 1-2 of
  //      its candidates have been inserted.
  // When `candidate_count` is undefined we fall back to the row-count
  // gate alone — older callers (and the unit-test fake) don't supply
  // it, and the row count is still a strictly tighter guarantee than
  // the previous "> 0".
  const latestSuccess =
    latest.candidate_count === undefined
      ? true
      : latest.candidate_count >= MIN_LATEST_RECOMMENDATIONS;
  if (latestRows.length >= MIN_LATEST_RECOMMENDATIONS && latestSuccess) {
    return {
      recommendations: latestRows,
      usedBatchId: latest.id,
      fellBackToPrevious: false,
    };
  }
  if (batches.length > 1) {
    const prior = batches[1];
    const priorRows = await fetchCandidatesForBatch(admin, prior.id);
    if (priorRows.length > 0) {
      return {
        recommendations: priorRows,
        usedBatchId: prior.id,
        fellBackToPrevious: true,
      };
    }
  }
  // No prior fallback available: render whatever the latest produced
  // (may be empty, may be 1-2 cards). Better than showing nothing when
  // the friend has no prior-batch parachute.
  if (latestRows.length > 0) {
    return {
      recommendations: latestRows,
      usedBatchId: latest.id,
      fellBackToPrevious: false,
    };
  }
  return { recommendations: [], usedBatchId: null, fellBackToPrevious: false };
}
