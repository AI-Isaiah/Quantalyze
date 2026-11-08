/**
 * Phase 198 plan 12 (C9, D-02, LEAN-06): the flag-to-row map for Holdings.
 *
 * C9: a Bridge flag is keyed per scope ref (`holding:venue:symbol:type`, the match
 * batch's keyspace) and carries no API key, while a Holdings row id is
 * `${ref}#${api_key_id}` (Phase 170.4 D-08, one row per key). So the mapping
 * rule is: a flag reaches EVERY row of its ref, and the row id is split at the
 * LAST `#` to recover that ref. This module fans a flag out and merges nothing.
 *
 * A flag whose ref has no row among the ids the caller renders is returned in
 * `unmatched`, so the caller can show it elsewhere. A flag is never dropped
 * (D-02: nothing is deleted silently).
 *
 * Pure: the result depends only on the flags and the ids passed.
 */
import type { ReactNode } from "react";
import { buildHoldingRef, type FlaggedHolding } from "./holding-outcome-adapter";

/** Props both Holdings position tables take to mark flagged rows. */
export type FlaggedRows = {
  /** Row ids that carry the `Flagged` chip and the `Record outcome…` action. */
  flaggedRowIds: ReadonlySet<string>;
  /** The one row whose outcome sub-row is open, or null. */
  openRowId: string | null;
  onToggle: (rowId: string) => void;
  renderOutcome: (rowId: string) => ReactNode;
};

/** `holding:binance:BTC:spot#k1` -> `holding:binance:BTC:spot`. An id without `#` is returned as is. */
export function refOfRowId(rowId: string): string {
  const i = rowId.lastIndexOf("#");
  return i === -1 ? rowId : rowId.slice(0, i);
}

export function mapFlagsToRows(
  flaggedHoldings: readonly FlaggedHolding[],
  rowIds: readonly string[],
): { flagByRowId: Map<string, FlaggedHolding>; unmatched: FlaggedHolding[] } {
  // One ref per flag, built once. The match batch holds one flag per ref, so
  // the first flag of a ref is the one its rows carry.
  const refs = flaggedHoldings.map((h) => buildHoldingRef(h));
  const flagByRef = new Map<string, FlaggedHolding>();
  flaggedHoldings.forEach((h, i) => {
    if (!flagByRef.has(refs[i])) flagByRef.set(refs[i], h);
  });
  const flagByRowId = new Map<string, FlaggedHolding>();
  const matchedRefs = new Set<string>();
  for (const id of rowIds) {
    const ref = refOfRowId(id);
    const flag = flagByRef.get(ref);
    if (flag) {
      flagByRowId.set(id, flag);
      matchedRefs.add(ref);
    }
  }
  const unmatched = flaggedHoldings.filter((_, i) => !matchedRefs.has(refs[i]));
  return { flagByRowId, unmatched };
}
