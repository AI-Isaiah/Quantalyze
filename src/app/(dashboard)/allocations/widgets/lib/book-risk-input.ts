import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 169.4-01 (SC2): the ONE place the Allocations Risk tab maps the
 * allocator's book onto the risk widgets.
 *
 * Every risk widget reads `compositeReturns` first and falls back to
 * `buildCompositeReturns(strategies)`, the legacy portfolio-strategies set. On
 * a key-connected book that set is empty or zero-weighted, so VaR read
 * "Insufficient return data" while the Overview charted the book (169 RESEARCH
 * root cause G). This adapter sets `compositeReturns` to the book's own daily
 * returns (`equityDailyReturns`, the series the Overview's factsheet is built
 * from), as they come: no reweighting, no reordering.
 *
 * It returns the WHOLE payload and overrides only the fields it owns, so every
 * other field a widget reads (169.4-02's BTC series among them) passes through
 * unchanged. Call it only when `equityHistoryState` is "ready": while the
 * history is rebuilding `equityDailyReturns` is `[]` by contract, and the Risk
 * tab shows the rebuilding panel instead of any widget.
 */
export function bookRiskInput(
  payload: MyAllocationDashboardPayload,
): MyAllocationDashboardPayload & {
  compositeReturns: MyAllocationDashboardPayload["equityDailyReturns"];
} {
  return {
    ...payload,
    compositeReturns: payload.equityDailyReturns ?? [],
  };
}
