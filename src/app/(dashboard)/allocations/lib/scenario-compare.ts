/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 *
 * Plan 23-03 (PERSIST-04) — the compare engine. Extracts the composer's
 * adapter → projectionState → de-alias → computeScenario chain
 * (the composer's `projectionState` memo) into a testable pure helper so a SAVED
 * draft re-resolves its return series from the live payload and runs the
 * FROZEN `computeScenario` (SCENARIO-05) — yielding the SAME `ComputedMetrics`
 * the composer would show for that draft over the same live inputs. No new
 * compute algorithm is invented here; this module only re-applies the existing
 * chain to a draft + live-input pair off the React render path.
 *
 * Honesty invariants this helper preserves (test-pinned in scenario-compare.test.ts):
 *
 *   - NO leverage. Leverage is ephemeral `useState` in the composer
 *     (the composer's `leverageByRef` state), NEVER persisted — a saved `ScenarioDraft`
 *     carries no leverage field. The projection state built here OMITS the
 *     optional `leverage` map entirely, so `computeScenario`'s `lev()` defaults
 *     every leg to 1 and the byte-identical pre-R4 path runs. We never read a
 *     `leverage` field off the draft even if one is smuggled on.
 *
 *   - Degenerate → null. `computeScenario` returns null-metric `ComputedMetrics`
 *     for degenerate sets (empty active set, n < 10, NaN-poisoned curve). We let
 *     that null flow straight through — NO `?? 0` — so the render layer shows an
 *     honest em-dash, never a fabricated 0.
 *
 *   - Heterogeneous windows (v1.5 PERSIST-03). Each draft is computed at its OWN
 *     persisted `draft.window` (injected POST-collapse onto `deAliased.state` —
 *     Pitfall 4). Two drafts with DIFFERENT windows compute independently; the
 *     helper never force-aligns a shared window across drafts. A SAVED draft
 *     with NO `window` (a pre-v1.5 v2 draft, or a v3 saved before a window was
 *     chosen) defaults to the INTERSECTION of its selected spans via the shared
 *     scenario-window helpers — the same rule the composer's WINDOW-01
 *     auto-default and share-resolve apply (ship-review RT-1; 59-CONTEXT Area 3
 *     Q4: "A windowless v2 draft in a compare set → intersection default (same
 *     rule everywhere)"). The ONE structural exception is the live-book column
 *     (`opts.liveBook`): the allocator's own book is NOT a saved scenario and
 *     stays on the engine's UNION-when-absent path — the Phase-55 own-book
 *     union lock. The window is threaded as an engine COMPUTE input, never as
 *     a factsheet view-clamp.
 *
 *   - Live-book column computed through the SAME engine path over a synthetic
 *     "all live holdings, equity-weight" draft (`buildLiveBookDraft`) — NOT the
 *     thin `payload.liveBaselineMetrics` shape, which leaves cagr/sortino/
 *     volatility null and would surface 3 unintended em-dashes on a healthy book.
 *     An em-dash on a genuinely-degenerate live book is then honest, not an
 *     artifact of a thin baseline shape (RESOLVED decision, RESEARCH Q4/A4).
 */

import {
  buildDateMapCache,
  computeScenario,
  type ComputedMetrics,
  type DailyPoint,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { collapseAliasedHoldingStrategies } from "@/lib/scenario-dealias";
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
import {
  buildPerKeyStrategyForBuilderSet,
  buildStrategyForBuilderSet,
  mergeAddedIntoPerKeySet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import { SCENARIO_SCHEMA_VERSION, type ScenarioDraft } from "./scenario-state";

/**
 * The slice of the composer's live payload the compare engine needs. Mirrors
 * the inputs the composer assembles before its `buildStrategyForBuilderSet`
 * adapter call:
 *   - holdingsSummary            — the live holdings (symbol/venue/type/value)
 *   - holdingReturnsByScopeRef   — reconstructed per-holding series, keyed by ref
 *   - addedStrategyReturnsLookup — payload.strategies → daily_returns, by id
 *   - addedStrategyMetadataLookup— payload.strategies → tier/cagr/sharpe, by id
 *   - symbolByHoldingId          — ref → bare symbol (the de-alias collapse key)
 */
export interface ScenarioCompareInputs {
  holdingsSummary: Array<{
    symbol: string;
    venue: string;
    holding_type: "spot" | "derivative";
    value_usd: number;
  }>;
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
  addedStrategyReturnsLookup: Record<string, DailyPoint[]>;
  addedStrategyMetadataLookup: Record<
    string,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  >;
  symbolByHoldingId: ReadonlyMap<string, string>;
  /**
   * P61-BUG-2 — the per-key channel, mirroring the composer's book-mode
   * engine selection. When `perKeyDailiesGateSatisfied` is true the draft
   * computes on PER-KEY units merged with its added strategies (the same set
   * the composer projects), NOT on the holdings-snapshot units — whose spans
   * differ from the series the draft was authored on, which made every saved
   * book draft compute EMPTY under its persisted window ("0 overlapping
   * days"). Three fields come verbatim from the live payload;
   * `equityByApiKeyId` is derived by the panel from the payload's holdings
   * rows (mirroring the composer's memo). Absent → the legacy holdings path
   * runs unchanged.
   */
  perKeyReturnsByApiKeyId?: Record<string, DailyPoint[]>;
  eligibleApiKeyIds?: string[];
  equityByApiKeyId?: Record<string, number>;
  perKeyDailiesGateSatisfied?: boolean;
}

/**
 * Options for `computeMetricsForDraft`. Ship-review RT-1 — the live-book
 * exception is STRUCTURAL (an explicit compute input the caller declares),
 * never inferred from draft contents / name matching.
 */
export interface ComputeMetricsForDraftOptions {
  /**
   * Phase-55 own-book union lock: the live-book column is the allocator's own
   * book, NOT a saved scenario, so a windowless live-book draft must NOT get
   * the saved-scenario intersection default — it stays on the engine's
   * UNION-when-absent path. Set by ScenarioComparePanel for the
   * `buildLiveBookDraft()` column ONLY.
   */
  liveBook?: boolean;
}

/**
 * Re-resolve a saved `draft`'s series from `liveInputs` and run the frozen
 * `computeScenario`, returning the SAME `ComputedMetrics` the composer shows
 * for that draft over the same live inputs.
 *
 * The chain is the composer's verbatim (no new math). Which builder runs
 * mirrors the composer's engine-set selection (P61-BUG-2):
 *   - per-key gate satisfied → buildPerKeyStrategyForBuilderSet →
 *     mergeAddedIntoPerKeySet (per-key units + the draft's added strategies)
 *   - otherwise → buildStrategyForBuilderSet (holdings-snapshot units)
 * then in both cases: overlay draft toggle/weight into projectionState
 * (NO leverage) → collapseAliasedHoldingStrategies → buildDateMapCache →
 * computeScenario.
 */
export function computeMetricsForDraft(
  draft: ScenarioDraft,
  liveInputs: ScenarioCompareInputs,
  opts: ComputeMetricsForDraftOptions = {},
): ComputedMetrics {
  // Read-only-tokens model: live holdings are FIXED context — no per-holding
  // toggle exists, so a current-schema (v2) draft never disables a holding.
  // The disabled set is genuinely always empty (matches the composer's
  // `disabledHoldingRefs` memo).
  const disabledHoldingRefs = new Set<string>();

  // P61-BUG-2 — mirror the composer's engine-set selection (`usePerKeySources`):
  // per-key units merged with the draft's added strategies when the D3 gate is
  // satisfied, else the legacy holdings+added path. Same eligible-key filter
  // as the composer (DSRC-03 honesty fix: blend ONLY the keys that get a
  // toggle row). `includeByApiKeyId` is ephemeral UI state (never persisted),
  // so a saved draft correctly computes with ALL eligible keys included.
  const usePerKeySources = liveInputs.perKeyDailiesGateSatisfied === true;
  let adapterOutput: {
    strategies: StrategyForBuilder[];
    state: ScenarioState;
  };
  if (usePerKeySources) {
    const all = liveInputs.perKeyReturnsByApiKeyId ?? {};
    const eligible = new Set(liveInputs.eligibleApiKeyIds ?? []);
    const eligibleOnly = Object.fromEntries(
      Object.entries(all).filter(([id]) => eligible.has(id)),
    );
    adapterOutput = mergeAddedIntoPerKeySet(
      buildPerKeyStrategyForBuilderSet(
        eligibleOnly,
        liveInputs.equityByApiKeyId ?? {},
      ),
      draft.addedStrategies,
      liveInputs.addedStrategyReturnsLookup as Record<
        StrategyForBuilderId,
        DailyPoint[]
      >,
      liveInputs.addedStrategyMetadataLookup as Record<
        StrategyForBuilderId,
        Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
      >,
    );
  } else {
    adapterOutput = buildStrategyForBuilderSet(
      liveInputs.holdingsSummary,
      disabledHoldingRefs,
      draft.addedStrategies,
      liveInputs.holdingReturnsByScopeRef,
      liveInputs.addedStrategyReturnsLookup as Record<
        StrategyForBuilderId,
        DailyPoint[]
      >,
      liveInputs.addedStrategyMetadataLookup as Record<
        StrategyForBuilderId,
        Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
      >,
    );
  }

  // Overlay the draft's toggle + weight state onto the adapter defaults BEFORE
  // the collapse, so computeScenario reflects exactly what the saved draft
  // encodes — the same wiring the composer does in its `projectionState` memo.
  //
  // Deliberately NO `leverage` key: leverage is never persisted (a saved draft
  // has no leverage field), so omitting it makes computeScenario's `lev()`
  // default every leg to 1 and runs the byte-identical pre-R4 path. We read
  // ONLY draft.toggleByScopeRef / draft.weightOverrides — never any leverage.
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  for (const s of adapterOutput.strategies) {
    const toggle = draft.toggleByScopeRef[s.id];
    selected[s.id] =
      toggle === undefined
        ? (adapterOutput.state.selected[s.id] ?? true)
        : toggle;
    const ov = draft.weightOverrides[s.id];
    weights[s.id] =
      typeof ov === "number" && Number.isFinite(ov)
        ? ov
        : (adapterOutput.state.weights[s.id] ?? 0);
  }
  const projectionState: ScenarioState = {
    selected,
    weights,
    startDates: adapterOutput.state.startDates,
  };

  const deAliased = collapseAliasedHoldingStrategies(
    adapterOutput.strategies,
    projectionState,
    liveInputs.symbolByHoldingId,
  );
  const dateMapCache = buildDateMapCache(deAliased.strategies);

  // v1.5 PERSIST-03 — inject the engine window POST-collapse (Pitfall 4).
  // `collapseAliasedHoldingStrategies` reconstructs `state` and silently drops
  // any `window` set on the PRE-collapse `projectionState`, so the window MUST
  // be spread onto `deAliased.state` here (the canonical engineState idiom,
  // mirroring ScenarioComposer's `engineState` memo). Precedence:
  //
  //   1. `draft.window` — the persisted window, verbatim.
  //   2. Windowless SAVED draft (ship-review RT-1) — the INTERSECTION default,
  //      derived from the post-collapse selected strategies via the ONE shared
  //      helper chain (coverageSpanOf → defaultWindowFor), the same rule the
  //      composer's WINDOW-01 auto-default and share-resolve apply (locked
  //      59-CONTEXT Area 3 Q4: "A windowless v2 draft in a compare set →
  //      intersection default (same rule everywhere)"). No spans / empty
  //      intersection → null → no window key (engine union guard, matching the
  //      composer's WINDOW-06 behavior).
  //   3. `opts.liveBook` — the live-book column stays WINDOWLESS (Phase-55
  //      own-book union lock): the allocator's own book is not a saved
  //      scenario, so no intersection default is derived for it.
  const engineWindow =
    draft.window ??
    (opts.liveBook
      ? null
      : defaultWindowFor(
          deAliased.strategies.flatMap((s) => {
            // Spans of SELECTED strategies only — the composer's
            // `selectedSpanById` rule (`selected === false` is skipped;
            // absent counts as selected).
            if (deAliased.state.selected[s.id] === false) return [];
            const span = coverageSpanOf(s.daily_returns);
            return span ? [span] : [];
          }),
        ));
  const engineState = engineWindow
    ? { ...deAliased.state, window: engineWindow }
    : deAliased.state;

  // Degenerate sets (empty active set, n < 10, NaN-poisoned) return null-metric
  // ComputedMetrics — flow it straight through, NO `?? 0`. The caller renders
  // an honest em-dash via formatPercent/formatNumber.
  return computeScenario(deAliased.strategies, engineState, dateMapCache);
}

/**
 * Build the synthetic "live book" draft: the WHOLE live book enabled at its
 * natural weights, no added strategies, no toggle/weight overrides, no
 * leverage. With the per-key gate satisfied that is the per-key blend at
 * equity shares (P61-BUG-2 — the same Phase-36 per-key basis as
 * liveBaselineMetrics); otherwise all live holdings at the adapter's
 * value-proportional default. Fed through
 * `computeMetricsForDraft` it computes all six metrics through the SAME engine
 * path so the live-book compare column populates honestly — rather than the
 * thin `payload.liveBaselineMetrics` shape (RESOLVED decision).
 *
 * An empty `toggleByScopeRef` + `weightOverrides` makes `computeMetricsForDraft`
 * fall back to the adapter defaults (every holding selected, value-proportional
 * weights), which IS the live book.
 *
 * Ship-review RT-1: callers computing THIS draft must pass
 * `{ liveBook: true }` to `computeMetricsForDraft` so the own-book column stays
 * on the union path (Phase-55 lock) instead of the saved-scenario intersection
 * default — the exception is declared at the call site, never name-matched.
 */
export function buildLiveBookDraft(): ScenarioDraft {
  return {
    // The synthetic draft never round-trips the codec (computeMetricsForDraft
    // consumes it directly), but pin the CURRENT version constant so a future
    // bump can never leave this literal behind as a stale-looking v2.
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "live-book",
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: {},
    // v1.6 MEMBER-01 — the synthetic live-book draft has no explicit book
    // members (it IS the union own-book path, not a saved series); empty is the
    // honest value.
    memberKeyIds: [],
    lastEditedAt: new Date(0).toISOString(),
  };
}
