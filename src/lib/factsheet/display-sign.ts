/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH (B7, B8, D-07, UI-SPEC section 3.2) — the
 * rounding-aware percent and ratio formatters, and the tone, shared by the OG
 * share card and (plan 09) the factsheet KPI strip.
 *
 * ONE RULE: the sign and the tone of a printed figure come from the value ROUNDED
 * to the precision it is printed at, never from the raw value. A drawdown of
 * -0.0004 prints "0.0%", and printing it "-0.0%" or colouring it red tells a
 * reader there is a loss where the page shows none. A non-finite or missing value
 * prints "—" and carries no tone, since a dash is not good or bad news.
 *
 * PURE and client-safe on purpose: no `server-only`, no React. The Node OG route
 * and the client strip both import it.
 */

const DASH = "—";

/** Percent-units value rounded to `dp` places; `0` for anything that rounds to zero (never `-0`). */
function roundedPercent(v: number, dp: number): number {
  const r = Number((v * 100).toFixed(dp));
  return r === 0 ? 0 : r;
}

function isNumber(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

/**
 * Signed percent: `+0.7%`, `-3.1%`. A value that rounds to zero prints `0.0%` with
 * no sign. `v` is a decimal return (0.007 is 0.7%).
 */
export function formatSignedPercent(v: number | null | undefined, dp = 1): string {
  if (!isNumber(v)) return DASH;
  const r = roundedPercent(v, dp);
  return `${r > 0 ? "+" : ""}${r.toFixed(dp)}%`;
}

/**
 * Unsigned percent, the Max DD convention: a negative value carries its own
 * minus, a positive one no plus. A value that rounds to zero prints `0.0%`.
 */
export function formatUnsignedPercent(v: number | null | undefined, dp = 1): string {
  if (!isNumber(v)) return DASH;
  return `${roundedPercent(v, dp).toFixed(dp)}%`;
}

/** A ratio (Sharpe and kin). A value that rounds to zero prints `0.00`, never `-0.00`. */
export function formatRatio(v: number | null | undefined, dp = 2): string {
  if (!isNumber(v)) return DASH;
  const r = Number(v.toFixed(dp));
  return (r === 0 ? 0 : r).toFixed(dp);
}

/**
 * The tone of a percent figure printed at `dp` places: `positive` above zero,
 * `negative` below, `undefined` for a rounded zero and for a non-finite or
 * missing value. Callers that never colour a positive (Max DD) discard
 * `positive`.
 */
export function percentTone(v: number | null | undefined, dp = 1): "positive" | "negative" | undefined {
  if (!isNumber(v)) return undefined;
  const r = roundedPercent(v, dp);
  return r > 0 ? "positive" : r < 0 ? "negative" : undefined;
}

/**
 * The tone of a ratio (the strip's Information Ratio) printed at `dp` places, from
 * the value ROUNDED to that precision, exactly as `formatRatio` prints it: a value
 * that prints `0.00` carries no tone, so `-0.004` is never a red "0.00". A
 * non-finite or missing value has none either. (Plan 09; `percentTone` is the
 * percent-unit sibling and would scale the value by 100.)
 */
export function ratioTone(v: number | null | undefined, dp = 2): "positive" | "negative" | undefined {
  if (!isNumber(v)) return undefined;
  const r = Number(v.toFixed(dp));
  return r > 0 ? "positive" : r < 0 ? "negative" : undefined;
}
