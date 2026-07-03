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
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
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
  /** Full-resolution daily portfolio returns for the BTC benchmark inner-join.
   *  The page passes these to ScenarioBenchmarkSection, which recomputes the
   *  benchmark internally — this layer does not pre-compute it. */
  portfolioDaily: DailyPoint[];
  /** De-aliased strategy-id → name map for the correlation heatmap labels. */
  strategyNames: Record<string, string>;
}

/** Undecodable / version-ahead / unparseable draft — render the honest-absence
 *  EmptyStateCard, NEVER a live-book substitution (DI-23-01). */
export interface ResolvedHonestAbsence {
  kind: "honest-absence";
  /**
   * P61-BUG-2 — why the scenario can't be displayed, so the page can say the
   * honest thing. "book-only": the draft is built solely on the owner's
   * private book sources (API keys), which the live-book boundary deliberately
   * never resolves on this public page — there is nothing computable to show.
   * Absent → the original undecodable-format copy.
   */
  reason?: "book-only";
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
    // v1.6 MEMBER-01 — neutral/empty; this default is discarded on every
    // non-"ok" outcome (never read), so empty membership keeps the no-leak
    // guarantee intact.
    memberKeyIds: [],
    lastEditedAt: "",
  };
}

/**
 * Resolve a `get_shared_scenario` RPC row into a render-ready projection or an
 * honest-absence signal. The BTC benchmark series is NOT consumed here: the
 * page passes the resolved `portfolioDaily` to ScenarioBenchmarkSection, which
 * recomputes the benchmark internally from the BTC series. This layer owns only
 * the codec-trichotomy + the scenario projection.
 */
export function resolveSharedScenario(
  row: SharedScenarioRow,
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
    // when the toggle entry is absent — added strategies enter enabled). This
    // mirrors computeMetricsForDraft's owner-side rule (`toggle === undefined ?
    // default(true) : toggle`).
    selected[id] = draft.toggleByScopeRef[id] !== false;
    // WR-05 — derive the weight EXACTLY as the owner's projection does
    // (scenario-compare.ts computeMetricsForDraft): take the explicit override
    // ONLY when it is a finite number, else fall back to the engine default for
    // an un-overridden ADDED strategy, which is 0 (the deliberate, test-pinned
    // invariant in scenario-adapter.ts buildStrategyForBuilderSet — a non-zero
    // default would let a never-weighted add slip a fabricated size past the
    // commit gate). The prior `?? 0` diverged from the owner in two ways: it
    // passed a NaN/Infinity override straight through to computeScenario (the
    // owner rejects non-finite and falls back to 0), and `??` only guards
    // null/undefined. Matching the finite-guard makes the SHARED projection
    // equal the OWNER's saved projection for any mixed explicit/implicit-weight
    // draft — the page's whole value proposition is an honest projection.
    const ov = draft.weightOverrides[id];
    weights[id] = typeof ov === "number" && Number.isFinite(ov) ? ov : 0;
    startDates[id] = daily[0]?.date ?? "2022-01-01";
  }

  // P61-BUG-2 — a BOOK-ONLY draft (no added strategies) has nothing this page
  // is allowed to compute: its projection units are the owner's private
  // per-key book series, which the live-book boundary above deliberately
  // never resolves here. Rendering the metrics of an empty set produced a
  // dead em-dash shell ("0 overlapping days", every metric "—") that read as
  // a broken link. Surface the designed honest-absence state instead, with
  // the reason so the page can say why. (The share-mint route now also rejects
  // minting these via the shared null-safe `isBookOnlyDraft` predicate — this
  // branch keeps ALREADY-MINTED links honest.)
  //
  // MEMBER-03 (unified book-only definition) — detection stays on the RESOLVED
  // `strategies.length`, NEVER `draft.memberKeyIds.length`. This is the ONE
  // public-page module: it has no owner gate / eligible-ids server-side, so it
  // must NOT run any gate-based membership derivation here. A pre-v4 /
  // v2 / v3 share arrives with membership UNDERIVED (undefined); keying the
  // branch on the strategies count means such a share is still surfaced
  // honestly and the code is never forced to read `.length` off an undefined
  // membership. Any draft with zero added series — WITH or WITHOUT book
  // members — is honest-absence "book-only" (no RPC expansion). The mint gate's
  // `isBookOnlyDraft` is the same null-safe predicate; this branch is its
  // resolved-projection counterpart.
  if (strategies.length === 0) {
    return { kind: "honest-absence", reason: "book-only" };
  }

  // No leverage is persisted in the draft schema (it is transient UI state), so
  // the shared projection runs at the persisted weights with default 1.0
  // leverage — the honest reflection of what was saved.
  //
  // v1.5 PERSIST-02 — thread the OWNER's saved coverage window VERBATIM. The
  // window rides in the returned `draft` JSONB (get_shared_scenario returns the
  // draft whole; no RPC/SQL change). A SAVED window is read directly onto the
  // engine state — never re-derived from the recipient's visible published
  // series (which may have drifted since save → divergent membership;
  // Phase-59 Pitfall 5).
  //
  // Ship-review RT-1 — a WINDOWLESS draft (a pre-v1.5 upgraded-v2 share, or a
  // v3 saved before a window was chosen) gets the INTERSECTION DEFAULT, derived
  // from the selected strategies' series just built above via the ONE shared
  // helper chain (coverageSpanOf → defaultWindowFor) that the composer's
  // WINDOW-01 auto-default and scenario-compare use. This is the locked
  // 59-CONTEXT Area 2 Q4 rule: "Pre-v1.5 shared draft (v2, no window) →
  // recipient defaults to intersection (same rule as owner reopen)". The prior
  // union-when-absent path here made the SAME scenario compute under a
  // DIFFERENT divisor rule on the share page than in the owner's composer.
  // Determinism: same helper over the same inputs → the lexicographically
  // identical window the owner's composer defaults to for these series (pinned
  // in share-resolve.test.ts). No spans / empty intersection → null → NO
  // window key, and the engine's union-when-absent guard applies (matching the
  // composer's WINDOW-06 empty-intersection behavior).
  //
  // There is NO collapseAliasedHoldingStrategies here (strategies are built
  // straight from addedStrategies), so `state` IS the engine state — inject
  // directly (Pitfall 4 N/A).
  const window =
    draft.window ??
    defaultWindowFor(
      strategies.flatMap((s) => {
        if (selected[s.id] === false) return []; // spans of SELECTED strategies only
        const span = coverageSpanOf(s.daily_returns);
        return span ? [span] : [];
      }),
    );
  const state: ScenarioState = {
    selected,
    weights,
    startDates,
    ...(window ? { window } : {}),
  };
  const dateMapCache = buildDateMapCache(strategies);
  const metrics = computeScenario(strategies, state, dateMapCache);

  const portfolioDaily = metrics.portfolio_daily_returns ?? [];

  return {
    kind: "ok",
    name: row.name,
    metrics,
    portfolioDaily,
    strategyNames,
  };
}
