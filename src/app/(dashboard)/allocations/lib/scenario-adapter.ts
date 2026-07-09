/**
 * Pure TypeScript — no fetch, no side effects.
 * No network calls, no browser-storage / DOM access, no implicit time reads.
 *
 * Phase 10 Plan 01 — projects (holdings, addedStrategies, lookup maps) into the
 * unified `StrategyForBuilder[]` shape that the frozen `src/lib/scenario.ts`
 * engine consumes verbatim. Zero changes to scenario.ts allowed (SCENARIO-05
 * regression-pinned).
 *
 * The adapter is the pure projection layer. The composer (Plan 06) calls
 * `computeScenario(strategies, state, dateMapCache)` with this output verbatim.
 *
 * F9 H-0133 — be precise about where `weightOverrides` actually flow: the
 * composer applies them to the COMMIT diffs (handleCommit reads
 * `draft.weightOverrides[id] ?? 0`), NOT to the live projection. The projection
 * uses the default weights computed here (holdings value-proportional, added
 * strategies 0). The weight-0 default for added strategies is therefore a
 * DELIBERATE, test-pinned invariant (scenario-adapter.test.ts "added strategy
 * default weight is 0 …"): a non-zero default would let a never-weighted add
 * slip a fabricated dollar size past handleCommit's per-row gate. The
 * consequence — an added strategy contributes nothing to the projected curve
 * until weighted, and the slider does not yet move the projection — is a known
 * limitation tracked by H-0133's remaining root cause (wire weightOverrides
 * into the projection state at the composer), NOT something the adapter should
 * paper over by synthesizing a weight.
 *
 * B4-pinned signature: positional args, NOT a single inputs object. The
 * `addedStrategies` arg is `AddedStrategy[]` (lightweight; minted by
 * scenario-state.ts's add* helpers — H5 brand) and the lookup-map keys use
 * `StrategyForBuilderId` (the same brand). A hand-rolled `StrategyForBuilder`
 * literal cannot pass through as an AddedStrategy at compile time.
 */
import type { DailyPoint, ScenarioState, StrategyForBuilder } from "@/lib/scenario";
import { type AddedStrategy } from "./scenario-state";

/**
 * H5 — phantom branded type. Re-exported here so adapter callers can use it
 * without importing from the state module directly. The brand is the same
 * underlying `string & { readonly __brand: "scenario-builder-id" }` declared
 * in scenario-state.ts; this declaration is structurally identical so values
 * minted there carry the brand through to this adapter's lookup-map keys.
 *
 * Compile-time guarantee: a hand-rolled `string` literal cannot be used as a
 * key in `Record<StrategyForBuilderId, ...>` without an explicit cast, and a
 * fully-constructed `StrategyForBuilder` cannot be passed where the adapter
 * expects an `AddedStrategy[]` because `AddedStrategy.id` carries the brand.
 */
export type StrategyForBuilderId = string & {
  readonly __brand: "scenario-builder-id";
};

/**
 * The added-strategy unit construction shared by the surviving series-space
 * builders — `mergeAddedIntoPerKeySet` (the per-key path) and `buildAddedOnlySet`
 * (the added-only path). One
 * `StrategyForBuilder` per added strategy: real series from the returns
 * lookup (or [] — warm-up-gated out, never a fabricated series), metadata
 * from the metadata lookup with the public/null default.
 */
function buildAddedUnits(
  addedStrategies: AddedStrategy[],
  addedStrategyReturnsLookup: Record<StrategyForBuilderId, DailyPoint[]>,
  addedStrategyMetadataLookup: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe" | "asset_class">
  >,
): StrategyForBuilder[] {
  return addedStrategies.map((a) => {
    const meta = addedStrategyMetadataLookup[a.id] ?? {
      disclosure_tier: "public" as const,
      cagr: null,
      sharpe: null,
      asset_class: null,
    };
    const returns = addedStrategyReturnsLookup[a.id] ?? [];
    return {
      id: a.id,
      name: a.name,
      codename: null,
      disclosure_tier: meta.disclosure_tier,
      strategy_types: a.strategy_types,
      markets: a.markets,
      start_date: returns[0]?.date ?? null,
      daily_returns: returns,
      cagr: meta.cagr,
      sharpe: meta.sharpe,
      volatility: null,
      max_drawdown: null,
      // Phase 84 (BLEND-01): carry the metadata lookup's asset_class so the
      // blend basis (blendPeriodsPerYear) can read it downstream; null when the
      // lookup entry is absent (the default-meta branch above) — an unknown
      // leg keeps the conservative 252 blend default.
      asset_class: meta.asset_class ?? null,
    };
  });
}

/**
 * Phase 37 Plan 02 (DSRC-01) — SIBLING per-key builder. Emits one
 * `StrategyForBuilder` per `api_key_id` (the projection unit is the data source,
 * i.e. the connected exchange `api_key`, NOT a holding or a blended book). This
 * is the structural change that lets the composer (Plan 03) honestly
 * include/exclude each data source: each unit's `daily_returns` is that key's
 * own (date, daily_return) series, so excluding one re-blends the curve + every
 * KPI from the remaining keys via the frozen engine.
 *
 * This is a standalone per-key builder (NOT a branch inside a holdings path) so
 * the positional signature stays
 * byte-identical (RESEARCH §Alternatives A4). The unit-construction loop mirrors
 * the verified SSR helper `liveBaselineMetricsFromPerKeyDailies`
 * (queries.ts:2225-2251) — one unit per key, `disclosure_tier: "exploratory"`,
 * null scalar metrics, weight = the key's clamped equity share. The literal
 * shape is duplicated locally (not imported from queries.ts) to avoid a module
 * cycle, consistent with the existing per-key duplication noted in PATTERNS
 * §"No Analog Found".
 *
 * CRITICAL (Pitfall 1) — pass RAW equity-share weights. Do NOT renormalize them
 * to sum-to-1 here. The frozen `computeScenario` engine renormalizes per-day
 * over the SELECTED set (`r / activeWeightSum`, scenario.ts) and `normWeight`
 * divides by the selected-set weight mass. Renormalizing here would
 * double-normalize and skew the curve. The `weights.A === 70` test
 * (scenario-adapter.test.ts) pins this: adding a sum-to-1 pass turns it red.
 *
 * @param perKeyReturnsByApiKeyId  api_key_id → that key's DailyPoint[] series
 *   (already grouped at SSR by `buildPerKeyReturnsByApiKeyId`). Keys with an
 *   empty/absent series are skipped entirely.
 * @param equityByApiKeyId  api_key_id → that key's current equity share (Σ
 *   `holdingEquityContribution` over the key's holdings, D2). Negative shares
 *   are clamped to 0; a missing entry defaults to 0.
 */
export function buildPerKeyStrategyForBuilderSet(
  perKeyReturnsByApiKeyId: Record<string, DailyPoint[]>,
  equityByApiKeyId: Record<string, number>,
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  const strategies: StrategyForBuilder[] = [];
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};

  for (const [apiKeyId, returns] of Object.entries(perKeyReturnsByApiKeyId)) {
    // Skip empty/absent series — a key with no per-key history cannot contribute
    // (mirrors liveBaselineMetricsFromPerKeyDailies, queries.ts:2226).
    if (!returns || returns.length === 0) continue;
    strategies.push({
      id: apiKeyId, // id === api_key_id (DSRC-01: keyed per data source)
      name: `key ${apiKeyId}`,
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [],
      markets: [],
      start_date: returns[0]?.date ?? null,
      daily_returns: returns,
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
      // Phase 84 (BLEND-01): a per-key unit IS a connected exchange data source,
      // and every SUPPORTED_EXCHANGE is a crypto venue today (isCryptoExchange,
      // closed-sets.ts) — so a per-key leg is a crypto leg under the blend rule
      // (84-CONTEXT.md D). When a non-crypto venue is ever added to
      // SUPPORTED_EXCHANGES this literal must derive from the key's exchange.
      asset_class: "crypto",
    });
    selected[apiKeyId] = true; // default included (CONTEXT Area 1)
    // RAW clamped equity-share USD — NOT a sum-to-1 fraction (Pitfall 1). The
    // engine renormalizes over the selected set. Clamp negative equity to 0.
    weights[apiKeyId] = Math.max(0, equityByApiKeyId[apiKeyId] ?? 0);
    // Same "2022-01-01" sentinel the frozen engine uses (SCENARIO-05) when a
    // series carries no leading date — never back-extrapolates a real series.
    startDates[apiKeyId] = returns[0]?.date ?? "2022-01-01";
  }

  return { strategies, state: { selected, weights, startDates } };
}

/**
 * P61-BUG-1 fix (prod canary 2026-07-02) — merge the draft's ADDED strategies
 * into the per-key unit set so a drawer-add participates in the book-mode
 * projection. Before this, `activeAdapterOutput` in book mode (per-key gate
 * satisfied — every real book) was `perKeyAdapterOutput` alone: the added
 * units were built on the holdings path and then discarded wholesale, leaving
 * every add inert (checked toggle, live weight input, zero engine effect).
 * This is the CSV-strategies-plus-API-keys mixed blend path.
 *
 * WEIGHT COMMENSURABILITY (the one real design point): per-key weights arrive
 * RAW (USD equity — Pitfall 1 above), while added-strategy weights are 0–1
 * fractions from `draft.weightOverrides`. Merging them raw would keep adds
 * inert (0.5 vs 70_000). So the per-key weights are normalized to EQUITY
 * SHARES (÷ Σ) here, at the merge point only:
 *   - the per-key-only blend is numerically IDENTICAL (the frozen engine
 *     renormalizes per-day over the selected set — w/Σw is scale-invariant),
 *     so the `weights.A === 70` raw-weight pin on the builder stays true and
 *     the DSRC recompute oracles stay green;
 *   - an added fraction w now reads "w of the whole book" against the keys'
 *     Σshares = 1 (an added 0.5 → 0.5/1.5 of the blend once selected).
 * Added units keep the deliberate weight-0 default (F9 H-0133) — the draft's
 * weightOverrides overlay happens downstream in the composer's
 * projectionState, exactly like the holdings path.
 *
 * A no-added call returns the per-key output UNCHANGED (raw weights and all)
 * so the pure per-key path is byte-identical to Phase 37.
 */
export function mergeAddedIntoPerKeySet(
  perKey: { strategies: StrategyForBuilder[]; state: ScenarioState },
  addedStrategies: AddedStrategy[],
  addedStrategyReturnsLookup: Record<StrategyForBuilderId, DailyPoint[]>,
  addedStrategyMetadataLookup: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe" | "asset_class">
  >,
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  if (addedStrategies.length === 0) return perKey;

  const addedAsBuilder = buildAddedUnits(
    addedStrategies,
    addedStrategyReturnsLookup,
    addedStrategyMetadataLookup,
  );

  // Normalize per-key RAW USD equity to shares (see WEIGHT COMMENSURABILITY).
  // Σ ≤ 0 (degenerate all-zero-equity book) keeps the raw 0s — identical to
  // the pre-merge behavior for that degenerate case.
  const totalEquity = Object.values(perKey.state.weights).reduce(
    (s, w) => s + w,
    0,
  );
  const weights: Record<string, number> = {};
  for (const [id, w] of Object.entries(perKey.state.weights)) {
    weights[id] = totalEquity > 0 ? w / totalEquity : w;
  }

  const selected: Record<string, boolean> = { ...perKey.state.selected };
  const startDates: Record<string, string> = { ...perKey.state.startDates };
  for (const s of addedAsBuilder) {
    selected[s.id] = true;
    weights[s.id] = 0; // F9 H-0133 deliberate 0 default (overlay downstream)
    startDates[s.id] = s.start_date ?? "2022-01-01";
  }

  return {
    strategies: [...perKey.strategies, ...addedAsBuilder],
    state: { selected, weights, startDates },
  };
}

/**
 * Phase 63 Plan 01 (ENGINE-04 precondition b, Wave-0) — the ONE shared
 * added-only engine-set construction. This is the empty-per-key reduction of
 * `mergeAddedIntoPerKeySet`, made greppable: with no per-key units to merge,
 * the survivor's early-return and share-normalization drop out, leaving exactly
 * the added trio (selected=true, weight-0 default, "2022-01-01" startDate
 * sentinel). It therefore reproduces today's blank-mode output byte-for-byte —
 * `mergeAddedIntoPerKeySet({ strategies: [], state: { selected: {}, weights: {},
 * startDates: {} } }, added, ...)` — so the staged deletions (Plans 02–04) can
 * swap every holdings path for this single wrapper without changing the
 * gate=false / blank-mode numbers.
 *
 * Delegates unit construction to the private `buildAddedUnits` (shared with the
 * builder + the merge survivor) — the weight-0 / warm-up / metadata defaults are
 * F9 H-0133 test-pinned invariants; NEVER hand-roll an inline StrategyForBuilder
 * literal here. Mirrors the signature/JSDoc convention of
 * `buildPerKeyStrategyForBuilderSet`.
 *
 * @param addedStrategies  the draft's added strategies (branded AddedStrategy[]).
 * @param addedStrategyReturnsLookup  strategy id → that strategy's DailyPoint[].
 * @param addedStrategyMetadataLookup  strategy id → disclosure/cagr/sharpe/
 *   asset_class meta (asset_class → null when the entry is absent).
 */
export function buildAddedOnlySet(
  addedStrategies: AddedStrategy[],
  addedStrategyReturnsLookup: Record<StrategyForBuilderId, DailyPoint[]>,
  addedStrategyMetadataLookup: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe" | "asset_class">
  >,
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  const addedAsBuilder = buildAddedUnits(
    addedStrategies,
    addedStrategyReturnsLookup,
    addedStrategyMetadataLookup,
  );

  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};
  for (const s of addedAsBuilder) {
    selected[s.id] = true;
    weights[s.id] = 0; // F9 H-0133 deliberate 0 default (overlay downstream)
    startDates[s.id] = s.start_date ?? "2022-01-01";
  }

  return {
    strategies: addedAsBuilder,
    state: { selected, weights, startDates },
  };
}
