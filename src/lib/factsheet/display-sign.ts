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
 * Phase 170.6 DISPLAYPOLISH (D-02, D-03, D-04, D-05): this module is the ONE place the
 * rule lives. The general primitives (`roundForDisplay`, `signTone`, `formatFixedSigned`,
 * `drawdownTone`, `isPrintedZero`) are what every formatter in the repo calls; the five
 * percent / ratio exports below are thin wrappers over them.
 *
 * PURE and client-safe on purpose: no `server-only`, no React. The Node OG route
 * and the client strip both import it.
 */

const DASH = "—";

function isNumber(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

/**
 * The value times `scale`, rounded to `dp` places, as a number. `null` for a missing or
 * non-finite value. Never `-0`: a value that rounds to zero is `0`. The rounding is
 * exactly the one `toFixed` prints, so it agrees with the printed digits.
 */
export function roundForDisplay(v: number | null | undefined, dp: number, scale = 1): number | null {
  if (!isNumber(v)) return null;
  const r = Number((v * scale).toFixed(dp));
  return r === 0 ? 0 : r;
}

/**
 * `positive` above zero, `negative` below, taken from the value ROUNDED to the printed
 * precision (D-03). `undefined` for a rounded zero and for a non-finite or missing value.
 */
export function signTone(v: number | null | undefined, dp: number, scale = 1): "positive" | "negative" | undefined {
  const r = roundForDisplay(v, dp, scale);
  if (r == null) return undefined;
  return r > 0 ? "positive" : r < 0 ? "negative" : undefined;
}

export interface FixedSignedOptions {
  /** Decimal places printed. */
  dp: number;
  /** Multiplier applied before printing (100 for a decimal return shown as a percent). */
  scale?: number;
  /** Text appended after the digits (`%`, `pp`). */
  suffix?: string;
  /** Prefix a `+` on a figure that rounds above zero. */
  plus?: boolean;
  /** The glyph for a figure that rounds below zero. */
  minus?: string;
}

/**
 * A fixed-decimal figure with the sign picked from the ROUNDED value (D-02). DETECT-ONLY:
 * the digits are the raw value's own `toFixed` string with any leading `-` removed, exactly
 * the digits a bare `toFixed` prints, so no non-zero figure changes by a digit. The rounded
 * value only chooses the glyph: `plus` text when it is above zero, `minus` when below,
 * nothing at a rounded zero. A non-finite or missing value prints a dash.
 */
export function formatFixedSigned(v: number | null | undefined, opts: FixedSignedOptions): string {
  const { dp, scale = 1, suffix = "", plus = false, minus = "-" } = opts;
  const r = roundForDisplay(v, dp, scale);
  if (r == null) return DASH;
  const digits = ((v as number) * scale).toFixed(dp).replace(/^-/, "");
  const glyph = r > 0 ? (plus ? "+" : "") : r < 0 ? minus : "";
  return `${glyph}${digits}${suffix}`;
}

/**
 * The tone of a max-drawdown figure (D-04, "Max drawdown is never green"): `negative`
 * exactly when the ROUNDED value is below zero, otherwise `undefined`. It never returns
 * `positive`, so a rounded-zero or dash drawdown is never red and no drawdown is green.
 */
export function drawdownTone(v: number | null | undefined, dp: number, scale = 1): "negative" | undefined {
  return signTone(v, dp, scale) === "negative" ? "negative" : undefined;
}

/**
 * The rule stated over a string: true when the text carries at least one digit and no digit
 * other than `0` ("-0.00", "−0.0%" and "0" are zeros, "—" is not). For callers whose digits
 * come from a formatter that is not `toFixed` (Intl, variable-precision delta formatters):
 * they print as today, then drop the sign and the tone when the printed digits are all zero.
 */
export function isPrintedZero(text: string): boolean {
  return /\d/.test(text) && !/[1-9]/.test(text);
}

/**
 * Signed percent: `+0.7%`, `-3.1%`. A value that rounds to zero prints `0.0%` with
 * no sign. `v` is a decimal return (0.007 is 0.7%).
 */
export function formatSignedPercent(v: number | null | undefined, dp = 1): string {
  return formatFixedSigned(v, { dp, scale: 100, suffix: "%", plus: true });
}

/**
 * Unsigned percent, the Max DD convention: a negative value carries its own
 * minus, a positive one no plus. A value that rounds to zero prints `0.0%`.
 */
export function formatUnsignedPercent(v: number | null | undefined, dp = 1): string {
  return formatFixedSigned(v, { dp, scale: 100, suffix: "%" });
}

/** A ratio (Sharpe and kin). A value that rounds to zero prints `0.00`, never `-0.00`. */
export function formatRatio(v: number | null | undefined, dp = 2): string {
  return formatFixedSigned(v, { dp });
}

/**
 * The tone of a percent figure printed at `dp` places: `positive` above zero,
 * `negative` below, `undefined` for a rounded zero and for a non-finite or
 * missing value. Callers that never colour a positive (Max DD) use `drawdownTone`.
 */
export function percentTone(v: number | null | undefined, dp = 1): "positive" | "negative" | undefined {
  return signTone(v, dp, 100);
}

/**
 * The tone of a ratio (the strip's Information Ratio) printed at `dp` places, from
 * the value ROUNDED to that precision, exactly as `formatRatio` prints it: a value
 * that prints `0.00` carries no tone, so `-0.004` is never a red "0.00". A
 * non-finite or missing value has none either. (`percentTone` is the percent-unit
 * sibling and scales the value by 100.)
 */
export function ratioTone(v: number | null | undefined, dp = 2): "positive" | "negative" | undefined {
  return signTone(v, dp);
}
