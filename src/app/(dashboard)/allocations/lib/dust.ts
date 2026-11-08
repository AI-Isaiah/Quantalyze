/**
 * The dust rule for Holdings (Phase 198, D-04, LEAN-06): a position worth
 * under $50 or under 0.1% of the book is "small", and the tables fold it
 * behind a control. Pure, no React, so the table, the control and its
 * announcement cannot disagree.
 *
 * Comparisons are strict: D-04 says "under", so exactly $50 or exactly 0.1%
 * of Book equity is not dust.
 *
 * Rows that are never dust, so they are never hidden as "small":
 * - an unpriced row (`priced: false`),
 * - a row on a key that needs attention (`trustedKey: false`),
 * - a row with no finite value.
 *
 * The caller derives the two flags, so the mapping lives here once:
 * - `priced` is `!holdingIsPriceGap(row)` for a spot row, or a finite mark for
 *   a derivative row;
 * - `trustedKey` is `!keyNeedsAttention(key)` and `!source_key_missing`.
 *
 * `valueUsd` is the row's printed USD value (`value_usd` for spot,
 * `notional_usd` for a derivative), compared as a magnitude.
 */

export const DUST_ABS_USD = 50;
export const DUST_BOOK_SHARE = 0.001;

export interface DustRow {
  valueUsd: number | null;
  priced: boolean;
  trustedKey: boolean;
}

export function isDust(row: DustRow, bookEquityUsd: number | null): boolean {
  if (!row.priced || !row.trustedKey) return false;
  const v = row.valueUsd;
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  const magnitude = Math.abs(v);
  if (magnitude < DUST_ABS_USD) return true;
  return (
    typeof bookEquityUsd === "number" &&
    Number.isFinite(bookEquityUsd) &&
    bookEquityUsd > 0 &&
    magnitude < DUST_BOOK_SHARE * bookEquityUsd
  );
}

export const DUST_RULE_CAPTION =
  "Small positions are under $50 or under 0.1% of book equity.";

const positions = (n: number): string =>
  n === 1 ? "1 small position" : `${n} small positions`;

export function dustControlLabel(n: number, expanded: boolean): string {
  return expanded ? "Hide small positions" : `Show ${positions(n)}`;
}

export function dustAnnouncement(n: number, shown: boolean): string {
  return `${positions(n)} ${shown ? "shown" : "hidden"}.`;
}

export function dustHiddenLine(n: number): string {
  return `${positions(n)} hidden.`;
}
