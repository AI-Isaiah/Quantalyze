/**
 * Plan 25-04 / SHARE-02 — pure resolve layer for the public share page.
 *
 * PURE module: no Next runtime import, no admin Supabase client, no network
 * call, no DOM / storage / time reads. It takes the leak-scoped
 * `get_shared_scenario` RPC row
 * (already gated on token_hash + revoked_at IS NULL by the SECURITY DEFINER
 * function) and turns it into either a fully server-computed projection
 * (`kind:"ok"`) or an honest-absence signal (`kind:"honest-absence"`). The page
 * mounts the result; this module owns the decision so it is unit-testable
 * without rendering.
 *
 * THE DI-23-01 LANDMINE (the reason this file exists):
 *   `scenarioDraftCodec.decode` returns `value = defaultDraft` on its non-"ok"
 *   outcomes — `"readonly"` (a NEWER build wrote a higher schema_version) and
 *   `"reset"` (parse_failed / schema_invalid / version_mismatch). On the
 *   dashboard `defaultDraft` is the viewer's LIVE holdings; on this PUBLIC page
 *   it would be a live-book-SHAPED object surfaced to an anonymous recipient.
 *   So we BRANCH ON `outcome` and only `"ok"` is rendered. We NEVER read
 *   `.value` on a non-"ok" outcome. As belt-and-braces we also pass a NEUTRAL,
 *   holdings-free default to the codec (there is no viewer book here), so even
 *   if the outcome handling regressed there is no live book to leak.
 *
 * The page resolves ONLY the draft's `addedStrategies[].id` (published) series —
 * exactly what the RPC returns. Holdings refs ("holding:{venue}:{symbol}:{type}")
 * are the allocator's live book and are deliberately NOT in the RPC series, so
 * they never reach the projection. Everything stays in return / percentage form
 * (no USD).
 */
import {
  scenarioDraftCodec,
  type ScenarioDraft,
} from "@/app/(dashboard)/allocations/lib/scenario-state";
import {
  computeScenario,
  buildDateMapCache,
  type ComputedMetrics,
  type ScenarioState,
  type StrategyForBuilder,
  type DailyPoint,
} from "@/lib/scenario";
import {
  computeScenarioBenchmark,
  type ScenarioBenchmark,
} from "@/app/(dashboard)/allocations/lib/scenario-benchmark";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

/** One `get_shared_scenario` series row (RPC `series` jsonb element). */
export interface SharedSeriesRow {
  strategy_id: string;
  /** Raw `strategy_analytics.daily_returns` jsonb — normalized here. */
  daily_returns: unknown;
}

/** The shape the public page receives from the RPC (one row). */
export interface SharedScenarioRow {
  name: string;
  /** Raw draft jsonb from `scenarios.draft` — decoded + outcome-branched here. */
  draft: unknown;
  schema_version: number;
  series: SharedSeriesRow[] | null;
}

/** A fully server-computed, return-form projection ready to render. */
export interface ResolvedOk {
  kind: "ok";
  name: string;
  metrics: ComputedMetrics;
  /** Full-resolution daily portfolio returns for the BTC benchmark inner-join. */
  portfolioDaily: DailyPoint[];
  /** Benchmark active-return metrics (null-safe; computed from the BTC series). */
  benchmark: ScenarioBenchmark;
  /** De-aliased strategy-id → name map for the correlation heatmap labels. */
  strategyNames: Record<string, string>;
}

/** Undecodable / version-ahead / unparseable draft — render the honest-absence
 *  EmptyStateCard, NEVER a live-book substitution (DI-23-01). */
export interface ResolvedHonestAbsence {
  kind: "honest-absence";
}

export type ResolvedSharedScenario = ResolvedOk | ResolvedHonestAbsence;

/**
 * A NEUTRAL, holdings-free default draft passed to the codec. It is returned by
 * the codec on every non-"ok" outcome — but we discard it (we never read
 * `.value` then). Passing an empty one (rather than a live-book-shaped default)
 * is the structural guarantee that NO live book can leak even if the outcome
 * branch regressed. It is at the live schema_version so the codec treats a
 * `null`/absent raw as a benign empty "ok" rather than churning.
 */
function neutralDefaultDraft(): ScenarioDraft {
  return {
    schema_version: 0, // never adopted (decode only returns this on raw==null)
    init_holdings_fingerprint: "",
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: {},
    lastEditedAt: "",
  };
}

/**
 * Resolve a `get_shared_scenario` RPC row into a render-ready projection or an
 * honest-absence signal. `btcDaily` is the public BTC daily-return series (may
 * be `[]` when the benchmark route degraded — the benchmark section then shows
 * its honest "unavailable" empty state).
 */
export function resolveSharedScenario(
  row: SharedScenarioRow,
  btcDaily: DailyPoint[],
): ResolvedSharedScenario {
  // The codec's `decode` takes a raw STRING (localStorage shape). The RPC hands
  // us a parsed jsonb object, so re-serialize it to drive the same trichotomy.
  // (JSON.stringify is pure; a non-serializable input is impossible from jsonb.)
  const codec = scenarioDraftCodec(neutralDefaultDraft());
  const decoded = codec.decode(JSON.stringify(row.draft));

  // DI-23-01: ONLY "ok" renders. "readonly" (version_ahead) and "reset"
  // (parse_failed / schema_invalid / version_mismatch) → honest-absence. We do
  // NOT read `decoded.value` on a non-"ok" outcome (it is the neutral default,
  // and on the dashboard would be a live book).
  if (decoded.outcome !== "ok") {
    return { kind: "honest-absence" };
  }

  const draft = decoded.value;

  // Build the StrategyForBuilder[] from the draft's ADDED strategies only,
  // pairing each with its RPC-resolved published series. Holdings refs are not
  // in `series` and are intentionally never resolved here (live-book boundary).
  const seriesById = new Map<string, DailyPoint[]>();
  for (const s of row.series ?? []) {
    seriesById.set(s.strategy_id, normalizeDailyReturns(s.daily_returns));
  }

  const strategies: StrategyForBuilder[] = [];
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};
  const strategyNames: Record<string, string> = {};

  for (const added of draft.addedStrategies) {
    const id = added.id as string;
    const daily = seriesById.get(id) ?? [];
    strategyNames[id] = added.name;
    strategies.push({
      id,
      name: added.name,
      codename: null,
      disclosure_tier: "public",
      strategy_types: added.strategy_types,
      markets: added.markets,
      start_date: daily[0]?.date ?? null,
      daily_returns: daily,
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
    });
    // An added strategy is "selected" when its ref is toggled on (default true
    // when the toggle entry is absent — added strategies enter enabled).
    selected[id] = draft.toggleByScopeRef[id] !== false;
    weights[id] = draft.weightOverrides[id] ?? 0;
    startDates[id] = daily[0]?.date ?? "2022-01-01";
  }

  // No leverage is persisted in the draft schema (it is transient UI state), so
  // the shared projection runs at the persisted weights with default 1.0
  // leverage — the honest reflection of what was saved.
  const state: ScenarioState = { selected, weights, startDates };
  const dateMapCache = buildDateMapCache(strategies);
  const metrics = computeScenario(strategies, state, dateMapCache);

  const portfolioDaily = metrics.portfolio_daily_returns ?? [];
  const benchmark = computeScenarioBenchmark(portfolioDaily, btcDaily);

  return {
    kind: "ok",
    name: row.name,
    metrics,
    portfolioDaily,
    benchmark,
    strategyNames,
  };
}
