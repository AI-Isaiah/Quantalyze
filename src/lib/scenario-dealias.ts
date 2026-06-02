/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 *
 * audit-2026-05-07 H-0487 / H-0493 — multi-venue aliasing de-duplication for
 * the live-holdings scenario path.
 *
 * `reconstructHoldingReturnsByScopeRef` (queries.ts) keys its OUTPUT by the
 * venue-distinct `holding:{venue}:{symbol}:{holding_type}` scopeRef, but the
 * per-holding return series is reconstructed from `allocator_equity_snapshots.
 * breakdown`, a JSONB blob keyed by SYMBOL ONLY (the documented M5 caveat).
 * So an allocator holding BTC on both Binance and OKX — or BTC spot AND a BTC
 * perp — gets two distinct scopeRefs whose reconstructed series are byte-for-
 * byte identical. Fed to the frozen `computeScenario` engine as two separate
 * "strategies", that engine dutifully computes a Pearson correlation of
 * exactly 1.0 between them and folds it into `avg_pairwise_correlation`
 * (the "average pairwise correlation across holdings" KPI). The number is
 * fake-precise: it reports a perfect correlation the venue-level series were
 * never independently measured to have — it is an artifact of the symbol-keyed
 * breakdown, not real market behaviour.
 *
 * The honest fix is to NOT present two aliases of one exposure to the
 * correlation engine. Because their series are identical, collapsing the
 * aliased group into a single representative with the SUMMED weight is exactly
 * weight-equivalent for the composite equity curve / Sharpe / TWR / max-DD
 * (merging two identical-series weighted slots into one summed-weight slot is
 * the same weighted sum), so this changes ONLY the fabricated rho=1.0 pair —
 * `avg_pairwise_correlation` now reflects genuine distinct-symbol exposures.
 *
 * Why collapse here (at the `computeScenario` boundary) and not earlier:
 * `scenario.ts` is frozen (SCENARIO-05) and the producer's per-scopeRef
 * aliasing is its documented contract (other consumers look returns up by
 * scopeRef). A prior attempt emitted an `aliasedScopeRefs` sentinel but never
 * *consumed* it in the correlation fold, so the misleading number survived and
 * the change was reverted as inert. This collapse consumes the aliasing
 * directly — the only mechanism that actually corrects the KPI.
 */
import type { ScenarioState, StrategyForBuilder } from "@/lib/scenario";

/**
 * Collapse holding "strategies" that resolve to the same underlying symbol —
 * and therefore, given the symbol-keyed breakdown, the same reconstructed
 * return series — into one representative before `computeScenario`.
 *
 * `symbolByHoldingId` maps a holding scopeRef (`holding:{venue}:{symbol}:
 * {holding_type}`) to its bare symbol. Strategies whose id is NOT in the map
 * (added/browsed strategies, which carry their own genuine return series) pass
 * through untouched — only holdings are aliased by the symbol-keyed breakdown.
 *
 * Merge semantics within an aliased group:
 *  - representative = the group's first member (all members share the series).
 *  - selected = true iff ANY member is selected — toggling one venue of an
 *    exposure off must not silently drop the exposure while another venue
 *    stays on.
 *  - weight = Σ weights of the SELECTED members (total exposure to the symbol).
 *    `computeScenario` re-normalizes weights across the selected set, so the
 *    collapsed slot carries the combined share.
 *
 * Pure: returns new arrays/objects; inputs are not mutated.
 */
export function collapseAliasedHoldingStrategies(
  strategies: ReadonlyArray<StrategyForBuilder>,
  state: ScenarioState,
  symbolByHoldingId: ReadonlyMap<string, string>,
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  const passthrough: StrategyForBuilder[] = [];
  const bySymbol = new Map<string, StrategyForBuilder[]>();
  for (const s of strategies) {
    const symbol = symbolByHoldingId.get(s.id);
    if (symbol === undefined) {
      passthrough.push(s);
      continue;
    }
    const group = bySymbol.get(symbol);
    if (group) group.push(s);
    else bySymbol.set(symbol, [s]);
  }

  const outStrategies: StrategyForBuilder[] = [];
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};

  const carry = (id: string): void => {
    selected[id] = state.selected[id] ?? false;
    weights[id] = state.weights[id] ?? 0;
    if (state.startDates[id] !== undefined) startDates[id] = state.startDates[id];
  };

  for (const s of passthrough) {
    outStrategies.push(s);
    carry(s.id);
  }

  for (const group of bySymbol.values()) {
    if (group.length === 1) {
      const only = group[0];
      outStrategies.push(only);
      carry(only.id);
      continue;
    }
    // Aliased group (same symbol => identical reconstructed series). Merge
    // into one representative so computeScenario never reports a fabricated
    // rho=1.0 between venue/instrument aliases of a single exposure.
    const rep = group[0];
    outStrategies.push(rep);
    let summedSelectedWeight = 0;
    let anySelected = false;
    for (const member of group) {
      if (state.selected[member.id]) {
        anySelected = true;
        summedSelectedWeight += state.weights[member.id] ?? 0;
      }
    }
    selected[rep.id] = anySelected;
    weights[rep.id] = summedSelectedWeight;
    if (state.startDates[rep.id] !== undefined) {
      startDates[rep.id] = state.startDates[rep.id];
    }
  }

  return { strategies: outStrategies, state: { selected, weights, startDates } };
}
