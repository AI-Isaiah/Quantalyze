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

/**
 * Phase 169 D-50 — the sign of a money value AS IT WILL BE READ, i.e. of the
 * value rounded to cents. This is the ONE rounding decision both the text sign
 * (`formatUsdSigned`) and a P&L colour read, so the two cannot disagree: a
 * value that rounds to zero (-0.0001, 0.004) is `"zero"`, which shows no sign
 * and the neutral colour, never a red "−$0" (DESIGN.md: red is never for a
 * zero). `null` means there is no value to sign (null or non-finite input).
 *
 * `toFixed(2)` rounds the exact binary value half away from zero, the same
 * rule `toLocaleString` applies, so the rounded value here is the one the text
 * shows. A negative that rounds to zero parses back as -0, which is neither
 * above nor below 0.
 */
export type MoneySign = "positive" | "negative" | "zero";

export function signAtCents(n: number | null): MoneySign | null {
  if (n == null || !Number.isFinite(n)) return null;
  const rounded = Number(n.toFixed(2));
  if (rounded > 0) return "positive";
  if (rounded < 0) return "negative";
  return "zero";
}

/**
 * Phase 169 D-50 — a signed money amount (unrealized P&L) at 2 decimals, e.g.
 * "+$0.37", "−$0.21" (U+2212 minus), "+$1,300.00". The sign comes from
 * `signAtCents`, so a value that rounds to zero reads "$0.00" with no sign.
 * Null or non-finite renders the em-dash, never a fabricated $0.00.
 * Assignable to `KeyTrustClauseRender.amount`.
 */
export function formatUsdSigned(n: number | null): string {
  const sign = signAtCents(n);
  if (sign === null) return "—";
  const magnitude = Math.abs(Number((n as number).toFixed(2))).toLocaleString(
    "en-US",
    {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  );
  if (sign === "positive") return `+${magnitude}`;
  if (sign === "negative") return `−${magnitude}`;
  return magnitude;
}

/**
 * Phase 169 D-50 — a unit price (entry, mark). A price of $1 or more shows 2
 * decimals ("$60,000.00"); a price under $1 shows 4 significant digits
 * ("$0.4213", "$0.00009876"), so a sub-dollar instrument never reads "$0".
 * A sub-dollar price that rounds to 1 at 4 significant digits takes the $1
 * form ("$1.00"), and a zero price, which has no significant digits, reads
 * "$0.00". Null or non-finite renders the em-dash.
 *
 * Amounts (AUM, notional, allocations) are NOT prices and stay whole dollars
 * through `formatUsd`.
 */
export function formatUsdPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const subDollar = n !== 0 && Math.abs(Number(n.toPrecision(4))) < 1;
  return n.toLocaleString(
    "en-US",
    subDollar
      ? {
          style: "currency",
          currency: "USD",
          minimumSignificantDigits: 4,
          maximumSignificantDigits: 4,
        }
      : {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
  );
}
