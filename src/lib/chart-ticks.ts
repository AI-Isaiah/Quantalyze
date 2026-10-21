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

/** The SVG `text-anchor` values a tick label can take. */
export type TickLabelAnchor = "start" | "middle" | "end";

/**
 * Estimated rendered width of a label, in the SVG's own user units:
 * `label.length * fontSize * 0.6`. Geist Mono advances 0.6 em, so this is exact
 * for the mono labels and an over-estimate for DM Sans, which only makes
 * `fitTickLabel` anchor inward slightly earlier.
 *
 * Deterministic on purpose (Phase 170.1.3 NARROWCHARTS). A DOM measurement
 * (`getBBox`, `getComputedTextLength`) would give the server and the browser
 * different answers and so different markup, which is React #418 (the reason
 * this module exists).
 */
export function estLabelWidth(label: string, fontSize: number): number {
  return label.length * fontSize * 0.6;
}

/** The clear gap, in the SVG's user units, between two drawn x tick labels. */
export const X_TICK_GAP_PX = 8;

/**
 * Which x tick values a category axis draws, chosen in arithmetic so that no
 * two drawn labels overlap and the server and the browser agree (Phase 170.1.3
 * NARROWCHARTS, D-03b). Both the oldest and the newest value keep their label
 * and the ones between are spread evenly (one label only when the plot is
 * narrower than one pitch, and then it is the newest). `values` are evenly
 * spaced across `[plotLeft, plotRight]` (a point scale) in an SVG `svgWidth`
 * wide, and `labelW` is the width the label is drawn at (`estLabelWidth`).
 *
 * Why not leave the choice to Recharts: `interval="preserveStartEnd"` measures
 * each label in a hidden span in the body font (DM Sans) while the chart draws
 * it in Geist Mono, so the pick depends on the host's font rasteriser and the
 * measured box is not the drawn one (another host can pick other labels, and
 * about a third of data windows drew two labels over each other).
 * Why not `thinXTicks` (EquityChart): it returns the list unchanged at 400 px
 * and wider, and spaces by a fixed pitch rather than by the label width.
 *
 * The newest label is centred on `plotRight`, which is nearer the SVG edge than
 * half its width, and `EdgeFitXTick` moves it in by that overshoot. The pitch
 * includes the overshoot, so the moved label still clears the one before it.
 */
export function fitXTickValues<T>(
  values: T[],
  labelW: number,
  plotLeft: number,
  plotRight: number,
  svgWidth: number,
): T[] {
  const overshoot = Math.max(0, labelW / 2 - (svgWidth - plotRight));
  const pitch = labelW + X_TICK_GAP_PX + overshoot;
  const maxTicks = Math.max(1, Math.floor((plotRight - plotLeft) / pitch));
  if (values.length <= maxTicks) return values;
  // Keep both ends and space the rest evenly. A rounded index gap is at least floor(gap), so `count`
  // is the largest number of labels whose floor(gap) still spans `pitch` of the plot.
  const last = values.length - 1;
  const step = Math.ceil((last * pitch) / (plotRight - plotLeft));
  const count = 1 + Math.floor(last / step);
  if (count < 2) return [values[last]];
  return Array.from({ length: count }, (_, j) => values[Math.round((j * last) / (count - 1))]);
}

/**
 * Where an axis tick label is anchored so that its box stays inside its own
 * SVG (Phase 170.1.3 D-02, UI-SPEC C-3). `x` is the tick position, `[minX,
 * maxX]` the SVG's own coordinate extent (`0` and `width`, or `0` and the
 * viewBox width), `anchor` the caller's default (usually `"middle"`).
 *
 * The estimated box is computed for the given anchor. A box whose left edge is
 * below `minX` returns `"start"` (the label starts at its tick); otherwise a
 * box whose right edge is above `maxX` returns `"end"` (the label ends at its
 * tick); otherwise the caller's anchor. `x` is never moved and a label that
 * already fits keeps its position, which is what keeps a wide desktop chart
 * unchanged. Labels are never hidden, truncated or shrunk.
 */
export function fitTickLabel(
  x: number,
  label: string,
  fontSize: number,
  minX: number,
  maxX: number,
  anchor: TickLabelAnchor = "middle",
): { x: number; textAnchor: TickLabelAnchor } {
  const w = estLabelWidth(label, fontSize);
  const left = anchor === "middle" ? x - w / 2 : anchor === "start" ? x : x - w;
  const right = left + w;
  if (left < minX) return { x, textAnchor: "start" };
  if (right > maxX) return { x, textAnchor: "end" };
  return { x, textAnchor: anchor };
}

/**
 * Em-box ascent as a multiple of the font size: an upper bound on how far an
 * SVG text box reaches above its baseline. Geist Mono measured at 1.0 em in
 * Chromium (a 13 px label at baseline 10 was cut by exactly 3 px); the 5%
 * margin covers a fallback monospace face. Deterministic, not a DOM read.
 */
const TEXT_ASCENT_EM = 1.05;

/**
 * The baseline to draw a label at so its box does not start above the SVG's
 * top edge (Phase 170.1.3 D-03c). `y` is the caller's baseline; a larger font
 * (the mobile arms) needs a lower one. A baseline that already clears the top
 * keeps `y`, so a desktop arm that was never cut is unchanged.
 */
export function fitBaselineY(y: number, fontSize: number): number {
  const top = Math.ceil(fontSize * TEXT_ASCENT_EM);
  return y < top ? top : y;
}
