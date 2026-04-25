"use client";

/**
 * Phase 09.1 PR1 (dashboard parity) — V2 Overview holdings tile.
 *
 * Compact dashboard variant of `components/HoldingsTable.tsx` (NEW MODE).
 * Distinct from the existing `widgets/positions/PositionsTable` widget,
 * which is the wider detail surface registered as the `positions-table`
 * tile and surfaced via the picker. PR1 brings up `holdings-table` as a
 * first-class entry so `DESIGNER_KEY_TO_WIDGET_ID["holdings"]` resolves to
 * a real component instead of aliasing onto positions-table.
 *
 * Wiring is byte-for-byte equivalent to `HoldingsTabPanel` (Plan 08): the
 * same `toDesignHoldings` adapter call, the same revoked-status join over
 * `apiKeys`, and the same `flaggedHoldingsByRef` keying via
 * `buildHoldingRef`. Future scope: extract a shared hook so the two
 * surfaces don't drift; out of scope for PR1.
 *
 * Visual fidelity: HoldingsTable's NEW MODE renders the prototype's
 * 8-column table (Strategy / Weight / Allocation / MTD / Sharpe / Max DD /
 * Age + sub-row) with its own inline-style + Tailwind hybrid surface.
 * Embedding it inside a 3-column-wide tile preserves that surface — the
 * tile just constrains the outer width.
 */

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  toDesignHoldings,
  type HoldingsAdapterInputs,
} from "../../lib/holdings-adapter";
import { buildHoldingRef } from "../../lib/holding-outcome-adapter";
import { HoldingsTable } from "../../components/HoldingsTable";

export function HoldingsTableWidget({ data }: WidgetProps) {
  const payload = (data ?? {}) as Partial<MyAllocationDashboardPayload>;
  const holdingsSummary = payload.holdingsSummary ?? [];
  const flaggedHoldings = payload.flaggedHoldings ?? [];
  const matchDecisionsByHoldingRef = payload.matchDecisionsByHoldingRef ?? {};
  const apiKeys = payload.apiKeys ?? [];
  const strategies = payload.strategies ?? [];

  // api_key.id → sync_status. Defensive 'unknown' when the FK doesn't
  // resolve (RESTRICT FK should prevent this in practice). Same fallback
  // as HoldingsTabPanel.
  const keyStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of apiKeys) {
      m.set(k.id, k.sync_status ?? "unknown");
    }
    return m;
  }, [apiKeys]);

  const revokedStatusByHoldingId = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const h of holdingsSummary) {
      const ref = buildHoldingRef({
        venue: h.venue,
        symbol: h.symbol,
        holding_type: h.holding_type,
      });
      out[ref] = h.api_key_id
        ? (keyStatusById.get(h.api_key_id) ?? "unknown")
        : "unknown";
    }
    return out;
  }, [holdingsSummary, keyStatusById]);

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
              max_drawdown:
                s.strategy.strategy_analytics.max_drawdown ?? null,
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
          // Phase 06 projection has no per-holding allocated_at; pass null
          // so age renders as em-dash. Same as HoldingsTabPanel.
          allocated_at: null,
        })),
        flaggedHoldings: adapterFlagged,
        matchDecisionsByHoldingRef,
        strategies: adapterStrategies,
        // No holding→strategy correspondence on the payload today; the
        // adapter returns strategy=null per row, matching current UI.
        holdingToStrategyId: {},
      }),
    [
      holdingsSummary,
      adapterFlagged,
      matchDecisionsByHoldingRef,
      adapterStrategies,
    ],
  );

  return (
    <HoldingsTable
      rows={rows}
      revokedStatusByHoldingId={revokedStatusByHoldingId}
      flaggedHoldingsByRef={flaggedHoldingsByRef}
    />
  );
}

export default HoldingsTableWidget;
