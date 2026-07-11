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
import { blendPeriodsPerYear } from "@/lib/closed-sets";
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { sanitizeLeverageMap } from "@/lib/leverage";

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
  /**
   * PRESENT-03 / red-team F3 — the shared draft blends the owner's PERSISTED
   * book members (`memberKeyIds`) with catalog adds; only the catalog legs are
   * publicly computable here (the live-book boundary never resolves the owner's
   * per-key book series), so the rendered projection is the renormalized added
   * legs. `true` when the draft is MIXED, driving the public page's one-line
   * honesty caption. Computed from the already-decoded draft JSONB ONLY — no
   * RPC/SQL change, zero private data.
   */
  isMixed: boolean;
  /**
   * Phase 84 (BLEND-01) — the blend annualization basis actually used for this
   * projection: √365 if ANY SELECTED leg is crypto, else √252
   * (blendPeriodsPerYear). The page threads this IDENTICAL value into
   * ScenarioBenchmarkSection so the vs-BTC risk math rides the same clock as the
   * KPI strip. An all-unknown / empty-lookup blend → 252, byte-identical to the
   * pre-84 default (the whole no-lookup suite is that regression pin).
   */
  periodsPerYear: number;
  /**
   * LEV-02 (Phase 90.5 round-2 H-1) — TRUE when the saved draft applies a
   * per-strategy leverage multiplier ≠ 1 to a SELECTED, WEIGHTED added leg (the
   * composer's `leverageApplied` rule). The persisted leverage is now part of
   * what the scenario MEANS, so the shared projection runs it (state.leverage
   * below) AND the page must LABEL the modeled state — a leveraged share is a
   * what-if, not the strategy's realized track. Drives the page's one-line
   * modeled caption. Holdings-ref leverage never counts here (holdings refs are
   * the owner's private book and never resolve to a public series).
   */
  leveraged: boolean;
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
  /**
   * Phase 84 (BLEND-01) — strategy id → asset_class, sourced by the SSR caller
   * (page.tsx) from a published-rows-only `strategies` read of the RPC series
   * ids (a zero-DDL sibling read; the phase-29 exit gate forbids widening the
   * get_shared_scenario RPC/migration). Absent id / undefined lookup → null, the
   * conservative √252 leg, byte-identical to the pre-84 default.
   */
  assetClassById?: Record<string, string | null>,
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
      // Phase 84 (BLEND-01): the leg's asset_class from the caller's published-
      // only lookup (absent → null, the √252 leg). Feeds the blend basis below.
      asset_class: assetClassById?.[id] ?? null,
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
    // invariant in scenario-adapter.ts buildAddedUnits — a non-zero
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
  // minting these on the same honest rule — book-only ⇔ zero added strategies —
  // so this branch keeps ALREADY-MINTED links honest.)
  //
  // MEMBER-03 (unified book-only definition) — detection stays on the RESOLVED
  // `strategies.length`, NEVER `draft.memberKeyIds.length`. This is the ONE
  // public-page module: it has no owner gate / eligible-ids server-side, so it
  // must NOT run any gate-based membership derivation here. A pre-v4 /
  // v2 / v3 share arrives with membership UNDERIVED (undefined); keying the
  // branch on the strategies count means such a share is still surfaced
  // honestly and the code is never forced to read `.length` off an undefined
  // membership. Any draft with zero added series — WITH or WITHOUT book
  // members — is honest-absence "book-only" (no RPC expansion). The mint gate
  // keys on the same honest rule (zero added strategies); this branch is its
  // resolved-projection counterpart.
  if (strategies.length === 0) {
    return { kind: "honest-absence", reason: "book-only" };
  }

  // LEV-02 (round-2 H-1) — the persisted per-strategy leverage IS now part of
  // the saved scenario (the German user's "leverage saved WITH the scenario"
  // request). The recipient MUST project at the OWNER's saved multipliers, or
  // the same scenario name renders a different track on the public page than in
  // the owner's composer (the v1.5 PERSIST-02 cross-surface-divergence class).
  // Thread the sanitized map onto the engine `state.leverage` (clamp-on-read via
  // sanitizeLeverageMap, D3 — a tampered persisted value is clamped, never
  // poisons the curve). computeScenario's `lev()` only reads leverage for the
  // iterated added legs, so a holdings-ref leverage entry (owner book, never in
  // the public series) is inert.
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
  // There is NO alias-collapse step here (strategies are built
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
  // LOW-1 (round-3) — signal:false: this is the PUBLIC anonymous share render.
  // A corrupt persisted value would otherwise fire a Sentry warning on EVERY
  // anonymous view (a quota-burn vector on a public URL). The coercion still
  // clamps identically; the actionable owner-facing signal lives on the
  // composer rehydrate path.
  const leverage = sanitizeLeverageMap(draft.leverageOverrides, {
    signal: false,
  });
  const state: ScenarioState = {
    selected,
    weights,
    startDates,
    leverage,
    ...(window ? { window } : {}),
  };
  // The composer's `leverageApplied` rule: a multiplier only "modeled" the
  // projection when it is ≠ 1 on a SELECTED, positively-weighted leg — a stale
  // multiplier on a toggled-off / zero-weight leg contributes nothing, so it
  // must not raise the modeled caption.
  const leveraged = Object.entries(leverage).some(
    ([id, L]) =>
      Number.isFinite(L) &&
      L !== 1 &&
      selected[id] === true &&
      (weights[id] ?? 0) > 0,
  );
  const dateMapCache = buildDateMapCache(strategies);
  // Phase 84 (BLEND-01) — the blend annualizes √365 if ANY SELECTED leg is
  // crypto, else √252 (blendPeriodsPerYear). SELECTED-only (the engine's
  // activeStrategies gate) — a toggled-off crypto leg must not flip a tradfi
  // blend. All-unknown / empty lookup → 252, byte-identical to the pre-84
  // default (the whole no-lookup suite is that regression pin).
  const basis = blendPeriodsPerYear(strategies.filter((s) => selected[s.id]));
  const metrics = computeScenario(strategies, state, dateMapCache, basis);

  const portfolioDaily = metrics.portfolio_daily_returns ?? [];

  return {
    kind: "ok",
    name: row.name,
    metrics,
    portfolioDaily,
    strategyNames,
    // PRESENT-03 — the draft is MIXED when it carries persisted book members.
    // The addedStrategies-non-empty half of MIXED is guaranteed BY CONSTRUCTION
    // here: the :214 `strategies.length === 0` book-only guard already
    // honest-absenced a zero-added draft, so the ok branch needs only the
    // membership check. Null-safe `?? []` (the Phase-62 book-only-predicate
    // precedent): a pre-v4 decode leaves membership undefined at runtime despite
    // the required-at-v4 type → falsy → false → no caption for unknown
    // membership.
    isMixed: (draft.memberKeyIds ?? []).length > 0,
    // Phase 84 (BLEND-01) — the basis the projection actually used, so the page
    // threads the IDENTICAL clock into ScenarioBenchmarkSection.
    periodsPerYear: basis,
    // LEV-02 (round-2 H-1) — surface the modeled-leverage caption when a
    // selected, weighted leg carries a multiplier ≠ 1.
    leveraged,
  };
}
