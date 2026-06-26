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
  // COUPLING: grouping by bare symbol is correct ONLY while
  // reconstructHoldingReturnsByScopeRef (queries.ts) keys the reconstructed
  // series by symbol alone — that is what makes same-symbol members share a
  // byte-identical series, which is what makes the summed-weight merge
  // weight-equivalent. If the breakdown is ever made venue-aware (distinct
  // series per venue), THIS collapse must be revisited (or removed) in the
  // same change, or it would silently merge genuinely-distinct exposures.
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
  // R4 — carry the optional per-strategy leverage through the collapse. Only
  // emit it when the input state carries it, so a pre-R4 state (no leverage)
  // returns a byte-identical { selected, weights, startDates } shape and every
  // existing de-alias test stays green.
  const hasLeverage = state.leverage !== undefined;
  const leverage: Record<string, number> = {};

  const carry = (id: string): void => {
    selected[id] = state.selected[id] ?? false;
    weights[id] = state.weights[id] ?? 0;
    if (state.startDates[id] !== undefined) startDates[id] = state.startDates[id];
    if (hasLeverage) leverage[id] = state.leverage![id] ?? 1;
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
    // R4 — weighted-average leverage across the SELECTED members so the merged
    // exposure reflects each venue's leverage in proportion to its weight
    // (Σ wᵢ·Lᵢ / Σ wᵢ); without this, a per-row leverage on an aliased venue
    // would be silently dropped at the collapse.
    let weightedLevSum = 0;
    for (const member of group) {
      if (state.selected[member.id]) {
        anySelected = true;
        const w = state.weights[member.id] ?? 0;
        summedSelectedWeight += w;
        if (hasLeverage) weightedLevSum += w * (state.leverage![member.id] ?? 1);
      }
    }
    selected[rep.id] = anySelected;
    weights[rep.id] = summedSelectedWeight;
    if (hasLeverage) {
      leverage[rep.id] =
        summedSelectedWeight > 0 ? weightedLevSum / summedSelectedWeight : 1;
    }
    // Carry the EARLIEST include-from across the aliased group, not blindly the
    // representative's. The weight-equivalence guarantee relies on aliased
    // members sharing a start date — which they do today, since they share a
    // byte-identical symbol-keyed series (so dailyReturns[0].date is equal) and
    // the SSR path passes no startDates at all. This is therefore a no-op now;
    // it keeps the merge correct-by-construction (never LATER than any member)
    // if a per-holding include-from control is ever added. ISO dates compare
    // lexicographically = chronologically.
    let earliestStart: string | undefined;
    for (const member of group) {
      const sd = state.startDates[member.id];
      if (sd !== undefined && (earliestStart === undefined || sd < earliestStart)) {
        earliestStart = sd;
      }
    }
    if (earliestStart !== undefined) {
      startDates[rep.id] = earliestStart;
    }
  }

  return {
    strategies: outStrategies,
    state: hasLeverage
      ? { selected, weights, startDates, leverage }
      : { selected, weights, startDates },
  };
}

/**
 * Inverse of the collapse, for the weight-optimizer apply path (OPT-01).
 *
 * The optimizer runs over the DE-ALIASED universe (one slot per bare symbol —
 * `computeScenario` must never see two identical series, which min-vol treats as
 * a degenerate ρ=1 pair the solver can split arbitrarily). So its suggested
 * vector is keyed by each aliased group's REPRESENTATIVE ref. The draft, though,
 * stores weights on the RAW per-venue refs, and `applyWeightOverrides`
 * renormalizes over the raw enabled set. Feeding the rep-keyed vector straight in
 * leaves every collapsed-away venue duplicate carrying its STALE draft weight,
 * which the single renormalize folds back in — so the committed blend drifts off
 * the optimizer's suggestion (the more aliased mass, the larger the drift). This
 * only bites multi-venue / spot+perp books; a one-venue-per-symbol book has no
 * duplicates and the mapping is the identity.
 *
 * Map the suggested vector back onto the raw SELECTED basis:
 *  - aliased HOLDING ref: assign its symbol-group's whole suggested share to the
 *    group's FIRST selected raw member, 0 to the rest, so the applied vector
 *    covers the full enabled holding basis and `applyWeightOverrides`' single
 *    renormalize is inert. The members share a byte-identical series, so ANY split
 *    summing to the share is weight-equivalent for `computeScenario` — the same
 *    equivalence the forward collapse relies on. (ponytail: first-member, not a
 *    proportional split; switch to proportional only if a 0%-weight duplicate row
 *    reads as confusing to allocators.)
 *  - PASSTHROUGH ref (an added/browsed strategy, or — on the per-key data-sources
 *    path — an api_key unit; anything not in `symbolByHoldingId`): there is no
 *    aliasing, so the rep id IS the raw ref and the weight passes through by id
 *    unchanged. On a one-venue-per-symbol or all-passthrough book this whole
 *    function is therefore the identity. (Note: per-key units are not part of the
 *    draft's `toggleByScopeRef` renormalize basis at all — the per-key engine
 *    renormalizes those itself over the sum-to-1 vector, so the
 *    "renormalize-is-inert" reasoning above is specifically about the HOLDING
 *    basis, not this arm.)
 *
 * Routing the share by SYMBOL (not blindly onto the rep id) matters when the
 * representative member is itself toggled off while another venue of the same
 * symbol stays on: the rep id is still a vector key, but it is not a selected raw
 * ref, so the share must land on the venue that IS selected.
 *
 * Precondition (holds for the optimizer call site): every rep key in
 * `deAliasedWeights` whose symbol has ANY selected raw member — the call site
 * filters the optimizer's universe to selected de-aliased slots, and the forward
 * collapse marks a slot selected iff a member is. A rep whose symbol-group has NO
 * selected raw member contributes nothing (its share is dropped), which would
 * silently shrink that exposure; only feed this a vector restricted to selected
 * slots.
 *
 * Pure: reads `rawState.selected`; returns a new object.
 */
export function mapDeAliasedWeightsToRawBasis(
  deAliasedWeights: Record<string, number>,
  rawState: ScenarioState,
  symbolByHoldingId: ReadonlyMap<string, string>,
): Record<string, number> {
  const selectedRawIds = Object.keys(rawState.selected).filter(
    (id) => rawState.selected[id],
  );
  const selectedSet = new Set(selectedRawIds);
  // Selected raw holdings bucketed by bare symbol — the redistribution targets.
  const selectedBySymbol = new Map<string, string[]>();
  for (const id of selectedRawIds) {
    const sym = symbolByHoldingId.get(id);
    if (sym === undefined) continue; // passthrough — handled by id below
    const g = selectedBySymbol.get(sym);
    if (g) g.push(id);
    else selectedBySymbol.set(sym, [id]);
  }

  // Zero every selected raw ref FIRST so the result covers the full renormalize
  // basis; the optimizer's shares then overwrite their targets.
  const out: Record<string, number> = {};
  for (const id of selectedRawIds) out[id] = 0;

  for (const [repId, w] of Object.entries(deAliasedWeights)) {
    const sym = symbolByHoldingId.get(repId);
    if (sym === undefined) {
      if (selectedSet.has(repId)) out[repId] = w;
      continue;
    }
    const members = selectedBySymbol.get(sym);
    if (members && members.length > 0) out[members[0]] = w;
  }
  return out;
}
