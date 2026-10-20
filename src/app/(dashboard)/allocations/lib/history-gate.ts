import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 170.4 plan 04 (D-04, D-07, D-09) — the one gate the Overview and the
 * Risk tab choose their state through.
 *
 * On 2026-10-03 PROD, an allocator with a connected key and an empty book saw
 * the rebuilding panel on Risk and "No positions to analyze yet" on Overview:
 * the Overview's empty-holdings early return ran before its rebuilding branch,
 * and Risk had no empty-book branch at all. Two hand-written gates over one
 * payload is the defect, so both tabs now call this function and cannot
 * diverge on the state or on the reason line's key list.
 *
 * - `no_eligible_key` (D-09): the book is empty, nothing is syncing and the
 *   allocator has no eligible key. Both tabs show the connect-a-key card,
 *   whatever the history state.
 * - `rebuilding` (D-04): the equity history is not ready. It wins over the
 *   connected-but-empty card, so an allocator WITH an eligible key sees the
 *   rebuilding panel on both tabs. FAIL-CLOSED: anything other than an
 *   explicit `"ready"` (missing, null, "", an unknown or mis-cased state)
 *   reads as rebuilding, so no curve, KPI or risk widget renders over a
 *   history the producer withholds.
 * - `ready`: the tab renders its figures. A ready history renders them
 *   whether or not the book holds positions (167.1.2.1.2 D-04, 2026-10-20): a
 *   book whose positions are all closed still has a history worth drawing, and
 *   the Overview and the Risk tab must agree for one payload.
 *
 * D-07: "has an eligible key" is the payload's `hasConnectedKeys`, the
 * server-side `apiKeys.some(isPerKeyDailiesEligibleKey)` (src/lib/queries.ts).
 * It is never derived from holdings, `apiKeys.length`, `activeVenues` or
 * portfolios, and a missing flag reads as no eligible key (the conservative
 * default the Overview already used). Pure; no React.
 */
export type HistoryGate =
  | "no_eligible_key"
  | "rebuilding"
  | "ready";

export type HistoryGateInput = Partial<
  Pick<
    MyAllocationDashboardPayload,
    "equityHistoryState" | "hasConnectedKeys" | "holdingsSummary" | "hasSyncing"
  >
>;

export function historyGate(payload: HistoryGateInput): HistoryGate {
  const bookEmpty = (payload.holdingsSummary ?? []).length === 0;
  const empty = bookEmpty && !(payload.hasSyncing ?? false);
  if (empty && payload.hasConnectedKeys !== true) return "no_eligible_key";
  if (payload.equityHistoryState !== "ready") return "rebuilding";
  return "ready";
}

/**
 * The keys a `key_not_syncing` reason is about, resolved to the owner's own key
 * rows (review C2 round 2 IN-04): an id missing from `apiKeys` makes the set
 * unknown (null), so the line falls back to its unnamed form rather than
 * naming a different key. Shared by Overview and Risk so both name the same
 * key.
 */
export function resolveNotSyncingKeys(
  payload: Partial<
    Pick<
      MyAllocationDashboardPayload,
      "equityHistoryNotSyncingKeyIds" | "apiKeys"
    >
  >,
): MyAllocationDashboardPayload["apiKeys"] | null {
  const ids = payload.equityHistoryNotSyncingKeyIds ?? [];
  if (ids.length === 0) return null;
  const byId = new Map((payload.apiKeys ?? []).map((k) => [k.id, k]));
  const keys = ids.map((id) => byId.get(id));
  return keys.every((k) => k !== undefined) ? keys : null;
}
