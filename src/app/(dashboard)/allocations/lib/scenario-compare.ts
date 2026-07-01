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
 *   - Heterogeneous windows. Each draft defaults to its OWN coverage/intersection
 *     window and reports its OWN overlap `n`; the helper does not force a shared
 *     window across drafts. Per-persisted-window compare alignment is Phase 59
 *     (PERSIST-03), which wires the saved window in through the same
 *     `defaultWindowFor()` helper.
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
import {
  buildStrategyForBuilderSet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import type { ScenarioDraft } from "./scenario-state";

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
}

/**
 * Re-resolve a saved `draft`'s series from `liveInputs` and run the frozen
 * `computeScenario`, returning the SAME `ComputedMetrics` the composer shows
 * for that draft over the same live inputs.
 *
 * The chain is the composer's verbatim (no new math):
 *   buildStrategyForBuilderSet → overlay draft toggle/weight into projectionState
 *   (NO leverage) → collapseAliasedHoldingStrategies → buildDateMapCache →
 *   computeScenario.
 */
export function computeMetricsForDraft(
  draft: ScenarioDraft,
  liveInputs: ScenarioCompareInputs,
): ComputedMetrics {
  // Read-only-tokens model: live holdings are FIXED context — no per-holding
  // toggle exists, so a current-schema (v2) draft never disables a holding.
  // The disabled set is genuinely always empty (matches the composer's
  // `disabledHoldingRefs` memo).
  const disabledHoldingRefs = new Set<string>();

  const adapterOutput = buildStrategyForBuilderSet(
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

  // Degenerate sets (empty active set, n < 10, NaN-poisoned) return null-metric
  // ComputedMetrics — flow it straight through, NO `?? 0`. The caller renders
  // an honest em-dash via formatPercent/formatNumber.
  return computeScenario(deAliased.strategies, deAliased.state, dateMapCache);
}

/**
 * Build the synthetic "live book" draft: ALL live holdings enabled,
 * equity-weight (the adapter's value-proportional default), no added
 * strategies, no toggle/weight overrides, no leverage. Fed through
 * `computeMetricsForDraft` it computes all six metrics through the SAME engine
 * path so the live-book compare column populates honestly — rather than the
 * thin `payload.liveBaselineMetrics` shape (RESOLVED decision).
 *
 * An empty `toggleByScopeRef` + `weightOverrides` makes `computeMetricsForDraft`
 * fall back to the adapter defaults (every holding selected, value-proportional
 * weights), which IS the live book.
 */
export function buildLiveBookDraft(): ScenarioDraft {
  return {
    schema_version: 2,
    init_holdings_fingerprint: "live-book",
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: {},
    lastEditedAt: new Date(0).toISOString(),
  };
}
