/**
 * Phase 150 / Plan 150-02 — the shared dollar validator and the shared USD
 * formatter. Both bodies were MOVED here verbatim, not rewritten:
 *
 *   - `isValidDollar` came from `src/app/api/strategies/finalize-wizard/route.ts`
 *     (the aum / max_capacity guard). It was route-local, so Phase 150's
 *     allocation route would otherwise have minted a SECOND dollar validator.
 *   - `formatUsd` came from
 *     `src/app/(dashboard)/allocations/components/HoldingsTable.tsx`, where it
 *     was module-private. The Mark-ownership confirm copy and the Holdings
 *     allocation cells/dialog must render amounts through the SAME formatter —
 *     a second money formatter on this surface is forbidden (150-UI-SPEC).
 *
 * `MAGNITUDE_CAPS` is NOT re-declared and NOT re-exported here: its canonical
 * home is `@/lib/closed-sets` (five existing importers). Downstream consumers
 * import the caps from there directly.
 */

import { MAGNITUDE_CAPS } from "@/lib/closed-sets";

/**
 * The AUM / max-capacity dollar bound: a finite number in [0, 1e12).
 *
 * audit-2026-05-07 H-0325/H-0326 — fail-LOUD on invalid dollar values instead
 * of coercing to NULL. Pre-fix a client typo like '-5' or '1e20' silently
 * dropped to NULL on the server and a strategy finalized with missing AUM — at
 * minimum bad UX, at worst regulatory exposure for a "Verified by Quantalyze"
 * factsheet with no AUM. The contract: client must send a finite number in
 * [0, 1e12), or omit the field (null / undefined) entirely.
 *
 * NOTE the cap split (closed-sets.ts:538-541): this is
 * `MAX_DOLLAR_VALUE_USD` ($1e12), the AUM/capacity bound. The allocation
 * TICKET cap is the distinct `MAX_TICKET_SIZE_USD` ($1e9) — do not conflate.
 */
export const isValidDollar = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v < MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD;

/**
 * Whole-dollar USD rendering for the allocations surface.
 * `null` renders the em-dash, never `$0` (no-invented-data).
 */
export function formatUsd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
