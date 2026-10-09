/**
 * Phase 170.5 (D-07) - the v2 formatters for the five Benchmark greeks cells.
 *
 * One formatter module for the surface family (DESIGN: no inline `toFixed` in a
 * component). The digits are the factsheet's `pct(v, true)` and `num(v)`
 * (`MetricsColumn.tsx`, module-private there): the percent is x100 to 2 dp, the
 * number is 2 dp, so a non-zero figure prints the same string on both pages.
 *
 * On top of those digits sits the DESIGN Numbers Contract: the sign and the
 * tone are taken from the ROUNDED value. A value that rounds to zero prints
 * unsigned (`0.00` / `0.00%`) and is not negative, a `-0` never prints, and
 * `negative` is true only when the printed number is below zero. The flag is
 * computed from the same rounded number the cell prints, so text and colour
 * cannot disagree (T-170.5-22).
 *
 * A non-finite or nullish input returns `null`, which `MetricCell` prints as
 * the em dash (UI-SPEC "NaN to dash rule"). It is never 0.
 *
 * 170.6 DISPLAYPOLISH owns signed zero and red-for-non-negative everywhere else
 * on the page; it rebases onto these two functions.
 */
export interface FormattedFigure {
  text: string;
  /** True only when the ROUNDED, printed value is below zero. */
  negative: boolean;
}

function roundedFigure(
  value: number | null | undefined,
  scale: number,
  suffix: string,
  plus: boolean,
): FormattedFigure | null {
  if (value == null || !Number.isFinite(value)) return null;
  const fixed = (value * scale).toFixed(2);
  const rounded = Number(fixed);
  // Rounds to zero (including -0): unsigned, neutral.
  if (rounded === 0) return { text: `0.00${suffix}`, negative: false };
  if (rounded < 0) return { text: `${fixed}${suffix}`, negative: true };
  return { text: `${plus ? "+" : ""}${fixed}${suffix}`, negative: false };
}

/** A fraction as a signed percent to 2 dp: 0.123456 -> `+12.35%`. */
export function fmtSignedPct2(value: number | null | undefined): FormattedFigure | null {
  return roundedFigure(value, 100, "%", true);
}

/** A number to 2 dp, no plus sign: 0.38412 -> `0.38`. */
export function fmtNum2(value: number | null | undefined): FormattedFigure | null {
  return roundedFigure(value, 1, "", false);
}
