/**
 * The record length, stated one way (Phase 169 D-12, D-25; SC5).
 *
 * Every factsheet site that states how long a record is (the Strategy Thesis
 * sentence, "Years Observed", the Main Metrics observation warning and the Terms
 * panel's "Sample size") formats it here, so the page cannot state it two ways.
 *
 * Unit contract:
 *   - `years` is CALENDAR years, exactly as `compute()` reports it (first to
 *     last observation date, days / 365.25). This module has no other clock and
 *     never derives years from `n`: an observation count divided by 252 or by
 *     `periodsPerYear` reads a sparse or a 24/7 record as the wrong length.
 *   - `n` is the observation COUNT, one per daily return in the series. It is
 *     stated as "daily observations", never "trading days", because a 24/7
 *     venue has no trading days.
 *   - A non-finite value is the em-dash, never 0 (DESIGN.md Numbers Contract).
 */

export type RecordLength = {
  /** Calendar years to two decimals ("0.45"), or "—". */
  years: string;
  /** The count with thousands separators ("166 daily observations"). */
  observations: string;
  /** The whole statement ("0.45 years, 166 daily observations"). */
  text: string;
};

export function formatRecordLength({ n, years }: { n: number; years: number }): RecordLength {
  const yearsText = Number.isFinite(years) ? years.toFixed(2) : "—";
  const count = Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
  const observations = `${count} daily ${n === 1 ? "observation" : "observations"}`;
  const yearsPart = yearsText === "—" ? "—" : `${yearsText} years`;
  return { years: yearsText, observations, text: `${yearsPart}, ${observations}` };
}
