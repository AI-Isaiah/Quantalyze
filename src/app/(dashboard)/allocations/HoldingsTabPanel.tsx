"use client";

/**
 * Phase 09.1 D-06 + D-11 + D-18 — Holdings tab body.
 *
 * Plan 02 stubbed this panel; Plan 08 fills it with the real adapter-driven
 * HoldingsTable + 3-tab row-expand surface.
 *
 * Wiring:
 *   1. `toDesignHoldings` (Plan 04 adapter) joins holdingsSummary + flagged
 *      + matchDecisions + strategies into the designer row shape. The
 *      adapter's R1 contract requires the caller to supply the
 *      holding→strategy correspondence. There is no such correspondence
 *      surfaced on this payload today, so we pass an empty
 *      `holdingToStrategyId` map and the adapter falls through to
 *      strategy=null for every row.
 *   2. `revokedStatusByHoldingId` is built from props.holdingsSummary ×
 *      props.apiKeys here. Key format: `buildHoldingRef(h)` — same
 *      format the adapter emits as `DesignHoldingRow.id`.
 *   3. `flaggedHoldingsByRef` is keyed by the same buildHoldingRef so the
 *      OutcomeForm in the row-expand "Record outcome" tab gets the right
 *      `top_candidate_strategy_id`.
 *   4. The flagged-holding adapter shape uses `composite_score` (per
 *      Plan 04 R1 narrow boundary), so we map
 *      `top_candidate_composite → composite_score` here.
 */

import { useMemo } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  toDesignHoldings,
  type HoldingsAdapterInputs,
} from "./lib/holdings-adapter";
import { buildHoldingRef } from "./lib/holding-outcome-adapter";
import { HoldingsTable } from "./components/HoldingsTable";

export function HoldingsTabPanel(props: MyAllocationDashboardPayload) {
  const holdingsSummary = props.holdingsSummary ?? [];
  const flaggedHoldings = props.flaggedHoldings ?? [];
  const matchDecisionsByHoldingRef = props.matchDecisionsByHoldingRef ?? {};
  const apiKeys = props.apiKeys ?? [];
  const strategies = props.strategies ?? [];

  // ── Map api_key.id → sync_status. Defensive default 'unknown' when the FK
  //    doesn't resolve (RESTRICT FK should prevent this in practice).
  const keyStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of apiKeys) {
      m.set(k.id, k.sync_status ?? "unknown");
    }
    return m;
  }, [apiKeys]);

  // ── revokedStatusByHoldingId — key by buildHoldingRef so the new
  //    HoldingsTable can look it up against DesignHoldingRow.id.
  const revokedStatusByHoldingId = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const h of holdingsSummary) {
      const ref = buildHoldingRef({
        venue: h.venue,
        symbol: h.symbol,
        holding_type: h.holding_type,
      });
      const status = h.api_key_id
        ? keyStatusById.get(h.api_key_id) ?? "unknown"
        : "unknown";
      out[ref] = status;
    }
    return out;
  }, [holdingsSummary, keyStatusById]);

  // ── holdingToStrategyId — empty map per Plan 04 SUMMARY: the legacy
  //    body has no holding→strategy correspondence. Strategy resolves to
  //    null for every row, matching current UI behavior. Future work can
  //    populate this map from server-side analytics widening.
  const holdingToStrategyId = useMemo<Record<string, string>>(() => ({}), []);

  // ── flaggedHoldingsByRef — keyed by buildHoldingRef. Drives OutcomeForm
  //    strategyId in the row-expand "Record outcome" tab.
  const flaggedHoldingsByRef = useMemo<
    Record<string, { top_candidate_strategy_id: string | null }>
  >(() => {
    const out: Record<string, { top_candidate_strategy_id: string | null }> =
      {};
    for (const f of flaggedHoldings) {
      const ref = buildHoldingRef({
        venue: f.venue,
        symbol: f.symbol,
        holding_type: f.holding_type,
      });
      out[ref] = {
        top_candidate_strategy_id: f.top_candidate_strategy_id ?? null,
      };
    }
    return out;
  }, [flaggedHoldings]);

  // ── adapter input — flagged shape needs composite_score (Plan 04 R1
  //    narrow boundary). The live FlaggedHolding type exposes
  //    top_candidate_composite; map verbatim here.
  const adapterStrategies = useMemo<HoldingsAdapterInputs["strategies"]>(
    () =>
      strategies.map((s) => ({
        id: s.strategy.id,
        name: s.strategy.name,
        alias: s.alias,
        codename: s.strategy.codename,
        strategy_types: s.strategy.strategy_types,
        strategy_analytics: s.strategy.strategy_analytics
          ? {
              sharpe: s.strategy.strategy_analytics.sharpe ?? null,
              max_drawdown: s.strategy.strategy_analytics.max_drawdown ?? null,
              mtd: null,
            }
          : null,
      })),
    [strategies],
  );

  const adapterFlagged = useMemo<HoldingsAdapterInputs["flaggedHoldings"]>(
    () =>
      flaggedHoldings.map((f) => ({
        venue: f.venue,
        symbol: f.symbol,
        holding_type: f.holding_type,
        composite_score: f.top_candidate_composite,
        top_candidate_strategy_id: f.top_candidate_strategy_id,
      })),
    [flaggedHoldings],
  );

  const rows = useMemo(
    () =>
      toDesignHoldings({
        holdingsSummary: holdingsSummary.map((h) => ({
          venue: h.venue,
          symbol: h.symbol,
          holding_type: h.holding_type,
          quantity: h.quantity,
          value_usd: h.value_usd,
          api_key_id: h.api_key_id,
          // Phase 06 projection does not surface per-holding allocated_at
          // yet; pass null so age renders as em-dash.
          allocated_at: null,
        })),
        flaggedHoldings: adapterFlagged,
        matchDecisionsByHoldingRef,
        strategies: adapterStrategies,
        holdingToStrategyId,
      }),
    [
      holdingsSummary,
      adapterFlagged,
      matchDecisionsByHoldingRef,
      adapterStrategies,
      holdingToStrategyId,
    ],
  );

  return (
    <div data-tab-panel="holdings">
      <HoldingsTable
        rows={rows}
        revokedStatusByHoldingId={revokedStatusByHoldingId}
        flaggedHoldingsByRef={flaggedHoldingsByRef}
      />
    </div>
  );
}
