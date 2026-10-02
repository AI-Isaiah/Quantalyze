/**
 * Engine-independent chart tick values (Phase 169.1.1 HYDRATIONTICKS).
 *
 * A chart rendered on the server (Node) and hydrated in the browser (Chromium)
 * must compute the same tick values, or a tick label's text differs between the
 * two and React discards the server tree (React #418). The engine's native
 * power and base-10 logarithm functions are implementation-approximated: the
 * ECMAScript spec lets each engine choose its own approximation, and Node 22
 * and Chromium 153 were measured to disagree by one ulp on the power of ten for
 * several exponents (including -4 and -5) and on the logarithm for a few
 * percent of inputs. A one-ulp difference in the step is enough to turn the
 * zero tick into a tiny negative number in one engine and exact 0 in the other,
 * which prints as "-0.0%" on one side and "+0.0%" on the other.
 *
 * So this module never calls a transcendental Math function. The base-10
 * exponent is read from `toExponential()` (shortest round-trip, exactly
 * specified) and the power of ten is parsed from a decimal literal (correctly
 * rounded, exactly specified). Everything else is `+ - * /`, `Math.ceil` and
 * `Math.abs`, which are exactly rounded IEEE-754 operations in every engine.
 *
 * Founder decision 2026-10-02 ("Minimal fix", recorded in the phase CONTEXT and
 * the ROADMAP): keep the existing `step = nice * magnitude` and the running
 * `v += step` accumulation, change only the source of the power of ten, and
 * snap a tick that lands within a millionth of a step of the anchor onto the
 * anchor exactly. Rebuilding ticks as an integer index times the step, rounded
 * to the step's decimals, was measured to move non-zero labels that browsers
 * show today, so it is not used.
 *
 * Known edge, not special-cased: an input exactly one ulp below a power of ten
 * (for example the double just under 1e-4) has a `toExponential()` exponent one
 * lower than its rounded logarithm would give, so it picks `nice = 10` at the
 * lower decade instead of `nice = 1` at the upper one. The step is the same
 * decimal value, and both engines compute it identically.
 */

/** A tick within `step * TICK_SNAP_RATIO` of the anchor is emitted as the anchor exactly. */
export const TICK_SNAP_RATIO = 1e-6;

/**
 * 10 to the integer power `n`, correctly rounded and identical in every
 * conformant engine (parsed from the decimal literal `1e<n>`).
 */
export function pow10(n: number): number {
  return Number(`1e${n}`);
}

/**
 * The base-10 exponent of `|x|` as printed by `toExponential()`, for example
 * -4 for 2.986e-4. Returns 0 for 0 and for non-finite input (NaN, ±Infinity),
 * matching the `|| 0` fallback the tick code used before this module.
 */
export function decimalExponent(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const s = Math.abs(x).toExponential();
  return Number(s.slice(s.indexOf("e") + 1));
}

/**
 * Nicely rounded tick values across `[lo, hi]`: a step of 1, 2, 5 or 10 times a
 * power of ten near `(hi - lo) / divisor`, starting at the first multiple of the
 * step at or above `lo`, at most `cap` values. A value within
 * `step * TICK_SNAP_RATIO` of `anchor` is emitted as `anchor` exactly; every
 * value is positive zero rather than -0.
 *
 * Returns `[]` when `hi <= lo` or either bound is non-finite. Callers keep
 * their own degenerate-domain return and their own label formatter.
 */
export function niceStepValues(
  lo: number,
  hi: number,
  divisor: number,
  cap: number,
  anchor = 0,
): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [];
  const span = hi - lo;
  const rough = span / divisor;
  const magnitude = pow10(decimalExponent(rough));
  const normalized = rough / magnitude;
  let nice: number;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3) nice = 2;
  else if (normalized < 7) nice = 5;
  else nice = 10;
  const step = nice * magnitude;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.001 && out.length < cap; v += step) {
    out.push(Math.abs(v - anchor) < step * TICK_SNAP_RATIO ? anchor + 0 : v + 0);
  }
  return out;
}

/**
 * The tolerance for "is this tick the baseline": the smallest positive gap
 * between consecutive values times `TICK_SNAP_RATIO`, or 0 when there are fewer
 * than two values (which reduces the compare to exact equality).
 */
export function tickTolerance(values: readonly number[]): number {
  let minGap = Infinity;
  for (let i = 1; i < values.length; i++) {
    const gap = Math.abs(values[i] - values[i - 1]);
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  return minGap === Infinity ? 0 : minGap * TICK_SNAP_RATIO;
}
