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
}

type AdminClient = ReturnType<typeof createAdminClient>;

function extractStrategy(raw: unknown): StrategySummary | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
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
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
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
    const strategyRaw = row.strategies;
    const strategy = extractStrategy(strategyRaw);
    const analytics = toAnalyticsSummary(
      strategy
        ? ((strategyRaw as Record<string, unknown>).strategy_analytics as unknown)
        : null,
    );
    return {
      id: row.id as string,
      rank: (row.rank as number | null) ?? null,
      score: (row.score as number) ?? 0,
      reasons: (row.reasons as string[] | null) ?? [],
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
  if (latestRows.length > 0) {
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
  return { recommendations: [], usedBatchId: null, fellBackToPrevious: false };
}
