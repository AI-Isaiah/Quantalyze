import { metricsBasisSeries } from "@/lib/factsheet/compute";
import type { ComparatorBlock, FactsheetPayload } from "@/lib/factsheet/types";
import { unitTag, withUnit } from "@/lib/factsheet/returns-unit";
import type { UnitSegmentPoint, UnitSegmentsView, UnitSwitchView } from "@/lib/factsheet/unit-segments";
import type { HeadlineNote } from "./MetricsColumn";

/**
 * Static configs that drive `<TimeSeriesChart>`. Each entry describes one
 * chart slot — title, value format, scale behavior, which strategy series
 * to render as the base line, and which comparator-block field becomes the
 * second series on picker swap.
 *
 * Mirrors the `charts_payload.charts` object in `/tmp/gen_factsheet_v3.py`
 * but keeps the resolution lazy: the strategy series is a key into the
 * payload, the comparator series is a key into the active comparator block.
 */

export type ChartValueFormat = "growth" | "percent" | "ratio";

/**
 * Keys of ComparatorBlock whose value is a numeric-series type (array of
 * number | null, or null). Non-series fields (name, shortName, summary,
 * joint, volMatchedLabel) are excluded so a misconfigured comparatorField
 * fails to compile instead of silently resolving to nothing at runtime.
 * (NEW-C20-11)
 */
export type ComparatorSeriesKey = {
  // 194 plan 24 (D-14): `-?` and `Exclude<..., undefined>` let the OPTIONAL numeric-array keys
  // (`rollingVol1y`, ...) qualify; a string or object field still fails to compile.
  [K in keyof ComparatorBlock]-?: Exclude<ComparatorBlock[K], undefined> extends (Array<number | null> | number[] | null) ? K : never;
}[keyof ComparatorBlock];

export type ChartConfig = {
  key: string;
  title: string;
  subtitle?: string;
  valueFormat: ChartValueFormat;
  /** Y-axis allows log/linear toggle. Only meaningful for growth format. */
  scalable: boolean;
  /** Default Y scale (only used when scalable=true). */
  defaultScale: "log" | "linear";
  /** Horizontal reference line value, e.g., 0 for percent / 1 for growth. */
  baseline?: number;
  /** N samples at the start are statistically noisy — shade with a warmup band. */
  warmup?: number;
  /** Optional fixed plot height in viewBox units (default 280). */
  height?: number;
  /** Which strategy series provides the base line (null = no strategy line). */
  stratField:
    | "strategyEquity"
    | "strategyReturns"
    | "strategyRollingVol"
    | "strategyRollingSharpe"
    | "strategyRollingSortino"
    // 194 plan 24 (D-14, additive): the 365-day window's series, optional on the payload.
    | "strategyRollingVol1y"
    | "strategyRollingSharpe1y"
    | "strategyRollingSortino1y"
    | "strategyDrawdowns"
    | null;
  /** Which comparator-block field provides the comparator series.
   *  Restricted to fields whose value is a numeric array (never string/object
   *  fields) so a misconfigured chart fails to compile. (NEW-C20-11) */
  comparatorField: ComparatorSeriesKey | null;
  /** When true, the comparator IS the primary line — label uses `comparatorAsPrimaryPrefix`. */
  comparatorAsPrimary?: boolean;
  comparatorAsPrimaryPrefix?: string;
  /** Override the comparator legend label by reading a string field off the block (e.g., "volMatchedLabel"). */
  comparatorLabelField?: keyof ComparatorBlock;
  /**
   * Phase 164.6.6.2 (D-09, UI-SPEC A8): the title names the strategy's returns
   * unit when it has one (`Cumulative Returns in BTC`). Applied by
   * {@link applyChartUnit}; the static config never carries a unit.
   */
  unitTitle?: boolean;
  /**
   * Phase 164.6.6.2 (D-09, UI-SPEC A9, A10): the subtitle for a strategy with a
   * returns unit. The unit is the parameter, so no config hard-codes one.
   */
  unitSubtitle?: (unit: string) => string;
  /** Close path to baseline and render filled area (used by Underwater chart). */
  fill?: boolean;
  /** Shade payload.strategyWorst10 periods behind the line (Worst-DDs chart). */
  ddHighlights?: boolean;
  /** Render the FS-01/FS-02 composite seam overlay: per-key boundary markers
   *  (payload.segmentBoundaries) + gap seams (payload.missingSegments). Set true
   *  only on key:"cumulative". Absent (single-key) or with both payload fields
   *  absent → renders nothing (byte-identical). Mirrors ddHighlights gating. */
  segmentMarkers?: boolean;
  /** Phase 167.2.1.1.1 (NAVMTM) plan 10, D-08: render the start-of-marks note when
   *  `payload.marksSince` falls inside the drawn range: a solid secondary line, the
   *  tracked label and an HTML caption (UI-SPEC). Set true only on key:"cumulative"
   *  (the one equity chart of the published factsheet). Absent, or with no
   *  `marksSince` in range, renders nothing. Mirrors segmentMarkers gating. */
  marksStart?: boolean;
  /** Phase 256 (OKXUNITSWITCH) plan 07, UI-SPEC A: draw a switched strategy's two native
   *  segments (`payload.unitSwitch` + `payload.unitSegments`) as two separate lines with a real
   *  break, a marker and unit codes, instead of the one headline USD line. Set true only on
   *  key:"cumulative", the one chart that draws native units; every other curve draws the
   *  headline USD series unbroken. Absent, or with either payload field absent, renders
   *  today's single series. Mirrors segmentMarkers / marksStart gating. */
  unitSwitch?: boolean;
  /** Per-config stroke widths. Daily Returns wants a thin line so the noise reads as noise. */
  stratWidth?: number;
  comparatorWidth?: number;
  /** When zoomed (xRange[0] > 0), divide each series by series[xRange[0]] so the visible
   *  window starts at the natural baseline (0% growth, 1.0× ratio). Required for the
   *  cumulative-style charts so a 1Y zoom shows that year's return, not absolute equity. */
  rebaseOnZoom?: boolean;
  /** Render mode. Default "line" draws series as continuous paths. "bars" draws
   *  one vertical bar per observation from the baseline — canonical for daily
   *  returns where the series isn't truly continuous. */
  kind?: "line" | "bars";
  /** When true, draw a horizontal reference line at mean(strategy series) — used
   *  on the rolling vol/sharpe/sortino charts so the viewer can see at a glance
   *  whether the current value is above or below the strategy's average. */
  showStratAverage?: boolean;
  /** Phase 237 FACT-01 (UI-SPEC 1.6 row 3): when present the chart renders its header title and
   *  this note and nothing else (no subtitle, frame, bands, line, crosshair or caption). Set by
   *  `PerformanceCharts` on the `worstDDs` entry only, on a Withheld full-history view, from the
   *  verdict it computes where the chart mounts. Absent renders exactly as before. */
  withheldNote?: HeadlineNote;
  /** Phase 237 FACT-01 (UI-SPEC 1.6 row 4): when true the crosshair tooltip's strategy row prints
   *  a dash at the series' LAST index, the figure the Rolling Metrics "Now" cells dash. Set by
   *  `PerformanceCharts` on the rolling charts at full history on a Withheld view, the way
   *  `showStratAverage` is switched off there. Absent or false renders exactly as before. */
  lastPointWithheld?: boolean;
  /** Phase 169.1 (D-38 as narrowed by D-84): join the STRATEGY line across the
   *  days the payload's day basis excluded. Under `dayBasis: "active"` the rolling
   *  Sharpe is null on every excluded (zero-return) day, exactly as the engine's
   *  (D-27), and the line would otherwise break at each one. Only those nulls are
   *  bridged: the leading warm-up and any no-dispersion window (founder D7, null
   *  since Phase 166.2) stay a gap, because no Sharpe exists there. The values are
   *  never rewritten; only the drawn path changes. Never applied to a comparator
   *  line (Phase 169.5 plan 02 relies on it breaking past `through`). Set on the
   *  `rollingSharpe` entry only. */
  bridgeBasisExcludedDays?: boolean;
};

/**
 * Phase 164.6.6.2 (D-09): the config a chart is drawn from for a strategy whose
 * returns are in `unit`. `null` is the USD family and returns the SAME config
 * reference, so a USD chart takes the same early return and cannot differ.
 * `TimeSeriesChart` is a frozen island; it only ever sees the title and subtitle
 * (and, through `ariaLabel`, the title), exactly as for the rolling-window
 * relabel `PerformanceCharts` already does.
 */
export function applyChartUnit(cfg: ChartConfig, unit: string | null): ChartConfig {
  if (unit == null) return cfg;
  if (!cfg.unitTitle && !cfg.unitSubtitle) return cfg;
  return {
    ...cfg,
    title: cfg.unitTitle ? withUnit(cfg.title, unit) : cfg.title,
    subtitle: cfg.unitSubtitle ? cfg.unitSubtitle(unit) : cfg.subtitle,
  };
}

export const CHART_CONFIGS: ChartConfig[] = [
  {
    key: "cumulative",
    title: "Cumulative Returns",
    unitTitle: true,
    valueFormat: "growth",
    scalable: true,
    defaultScale: "log",
    // Anchor the Y domain at par (1.0) so a small-return curve doesn't
    // sweep floor-to-ceiling. Also draws the emphasized par gridline so
    // viewers can judge magnitude at a glance. (NEW-C20-05)
    baseline: 1,
    stratField: "strategyEquity",
    comparatorField: "cumulative",
    rebaseOnZoom: true,
    // FS-01/FS-02 composite seam overlay lives on the cumulative track only.
    segmentMarkers: true,
    // D-08: the start-of-marks note lives on the cumulative track only.
    marksStart: true,
    // Phase 256 (UI-SPEC A): the unit-switch two-segment break lives on the cumulative track only.
    unitSwitch: true,
  },
  {
    key: "cumVsBench",
    title: "Cumulative Returns vs Benchmark",
    subtitle: "strategy ÷ comparator, rebased to 1.0",
    valueFormat: "growth",
    scalable: false,
    defaultScale: "linear",
    baseline: 1,
    stratField: null,
    comparatorField: "cumVsBench",
    comparatorAsPrimary: true,
    comparatorAsPrimaryPrefix: "Strategy ÷ ",
    rebaseOnZoom: true,
  },
  {
    key: "volMatched",
    title: "Cumulative Returns — Volatility Matched",
    subtitle: "comparator returns scaled so its ann vol equals the strategy's",
    valueFormat: "growth",
    scalable: true,
    defaultScale: "log",
    // Anchor at 1.0 par so magnitude is legible. (NEW-C20-05)
    baseline: 1,
    stratField: "strategyEquity",
    comparatorField: "volMatched",
    comparatorLabelField: "volMatchedLabel",
    rebaseOnZoom: true,
  },
  {
    key: "dailyReturns",
    title: "Daily Returns",
    valueFormat: "percent",
    scalable: false,
    defaultScale: "linear",
    baseline: 0,
    height: 220,
    stratField: "strategyReturns",
    comparatorField: "dailyReturns",
    // Daily returns are discrete observations, not a continuous series. Bars
    // are the canonical pattern (Quantstats, FactSet, Bloomberg). One vertical
    // bar per day from the 0% baseline — positive teal / negative red.
    kind: "bars",
  },
  {
    key: "rollingVol",
    title: "Rolling Volatility (6mo)",
    valueFormat: "percent",
    scalable: false,
    defaultScale: "linear",
    warmup: 126,
    height: 200,
    stratField: "strategyRollingVol",
    comparatorField: "rollingVol",
    showStratAverage: true,
  },
  {
    key: "rollingSharpe",
    title: "Rolling Sharpe (6mo)",
    valueFormat: "ratio",
    scalable: false,
    defaultScale: "linear",
    baseline: 0,
    warmup: 126,
    height: 200,
    stratField: "strategyRollingSharpe",
    comparatorField: "rollingSharpe",
    showStratAverage: true,
    bridgeBasisExcludedDays: true,
  },
  {
    key: "rollingSortino",
    title: "Rolling Sortino (6mo)",
    valueFormat: "ratio",
    scalable: false,
    defaultScale: "linear",
    baseline: 0,
    warmup: 126,
    height: 200,
    stratField: "strategyRollingSortino",
    comparatorField: "rollingSortino",
    showStratAverage: true,
  },
  {
    key: "rollingBeta",
    title: "Rolling β (90d) vs Comparator",
    subtitle: "rolling regression β of strategy on comparator · first 90d are warmup",
    valueFormat: "ratio",
    scalable: false,
    defaultScale: "linear",
    baseline: 0,
    warmup: 90,
    height: 200,
    stratField: null,
    comparatorField: "rollingBeta",
    comparatorAsPrimary: true,
    comparatorAsPrimaryPrefix: "Rolling β vs ",
  },
  {
    key: "worstDDs",
    title: "Worst 10 Drawdown Periods",
    subtitle: "strategy equity · shaded bands mark the deepest 10 drawdowns",
    unitSubtitle: (unit) => `strategy equity in ${unit} · shaded bands mark the deepest 10 drawdowns`,
    valueFormat: "growth",
    scalable: true,
    defaultScale: "log",
    // Anchor at 1.0 par so magnitude is legible. (NEW-C20-05)
    baseline: 1,
    stratField: "strategyEquity",
    comparatorField: null,
    ddHighlights: true,
    rebaseOnZoom: true,
  },
  {
    key: "underwaterAcc",
    title: "Underwater Chart for Accumulated Capital",
    subtitle: "drawdown from running peak",
    unitSubtitle: (unit) => `drawdown from running peak, in ${unit}`,
    valueFormat: "percent",
    scalable: false,
    defaultScale: "linear",
    baseline: 0,
    height: 160,
    stratField: "strategyDrawdowns",
    comparatorField: null,
    fill: true,
  },
];

/** Resolve a chart config + payload to the actual array of series for rendering. */
export type ResolvedSeries = {
  name: string;
  values: ReadonlyArray<number | null>;
  color: string;
  width: number;
  opacity: number;
  fill?: boolean;
  /** Per-index: true where the day basis excluded the day, so `buildPath` joins
   *  a null there instead of breaking the line (D-38, D-84). Strategy series of an
   *  opted-in config only; absent everywhere else. Index-aligned with `values`. */
  bridgeAt?: ReadonlyArray<boolean>;
  /** Phase 256 (UI-SPEC A8): set only on a native unit-switch segment. The unit its values are
   *  measured in; a hover reading prints it (`1.03× in BTC`), so neither segment is unlabelled. */
  unit?: string;
  /** Phase 256 (UI-SPEC A8): indices below this are drawn but not hoverable. The coin segment's
   *  base vertex sits at the x of the last USD day and reads the USD point there, never a coin day. */
  hoverFrom?: number;
};

export function resolveSeries(
  cfg: ChartConfig,
  payload: FactsheetPayload,
  comparator: ComparatorBlock,
  xStart = 0,
): ResolvedSeries[] {
  // Rebase-on-zoom: when xStart > 0 and cfg.rebaseOnZoom is true, divide each
  // series by its value at xStart. Cumulative-style charts (growth format)
  // visually start at +0% (1.0×) in the zoomed window so a 1Y zoom shows that
  // year's growth, not absolute equity-from-inception. At xStart=0 this is a
  // no-op since series[0] ≈ 1.0 in growth space.
  const shouldRebase = !!cfg.rebaseOnZoom && xStart > 0;
  const rebase = (values: ReadonlyArray<number | null>): ReadonlyArray<number | null> => {
    if (!shouldRebase) return values;
    let base: number | null = null;
    for (let i = xStart; i < values.length; i++) {
      const v = values[i];
      if (v != null && Number.isFinite(v) && v > 0) { base = v; break; }
    }
    if (base == null || base === 0) return values;
    return values.map(v => (v == null || !Number.isFinite(v)) ? v : v / base!);
  };

  const out: ResolvedSeries[] = [];
  if (cfg.stratField) {
    const isDrawdown = cfg.stratField === "strategyDrawdowns";
    // 194 plan 24: the 1y series are optional (null under 365 days); an absent one is no
    // strategy line, as an absent comparator array is no comparator line below.
    const raw = payload[cfg.stratField] as ReadonlyArray<number | null> | null | undefined;
    if (raw) {
      out.push({
        name: isDrawdown ? "Drawdown" : payload.strategyName,
        values: rebase(raw),
        color: isDrawdown ? "var(--color-negative)" : "var(--color-accent)",
        width: cfg.stratWidth ?? (cfg.fill ? 1.0 : 1.6),
        opacity: 1.0,
        fill: cfg.fill,
        // D-84: the mask comes from the same helper that made the exclusion, so
        // there is no second rule. On the calendar basis it excludes no day and
        // the mask is all false (the line draws exactly as before).
        ...(cfg.bridgeBasisExcludedDays
          ? {
              bridgeAt: metricsBasisSeries(payload.strategyReturns, payload.dates, {
                dayBasis: payload.dayBasis,
              }).positions.map((pos) => pos === null),
            }
          : {}),
      });
    }
  }
  if (cfg.comparatorField) {
    const cmpRaw = comparator[cfg.comparatorField];
    if (Array.isArray(cmpRaw)) {
      const labelOverride = cfg.comparatorLabelField
        ? (comparator[cfg.comparatorLabelField] as unknown)
        : null;
      const cmpName = cfg.comparatorAsPrimary
        ? `${cfg.comparatorAsPrimaryPrefix ?? "Strategy ÷ "}${comparator.shortName}`
        : typeof labelOverride === "string" && labelOverride
          ? labelOverride
          : comparator.name;
      out.push({
        name: cmpName,
        values: cmpRaw as ReadonlyArray<number | null>,
        color: cfg.comparatorAsPrimary ? "var(--color-accent)" : "var(--color-text-muted)",
        width: cfg.comparatorWidth ?? (cfg.comparatorAsPrimary ? 1.6 : 1.3),
        opacity: cfg.comparatorAsPrimary ? 1.0 : 0.85,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Phase 256 (OKXUNITSWITCH) plan 07: the two native segments of a switched strategy.
// ---------------------------------------------------------------------------------------------

/** Index of `target` in ascending ISO `dates`, or -1 when absent. */
function indexOfDay(dates: readonly string[], target: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] === target) return mid;
    if (dates[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Last index whose date is at or before `target`, or -1 when every date sorts after it. */
function lastIndexAtOrBefore(dates: readonly string[], target: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * One native segment compounded within its own unit from 1.00, indexed onto the shared headline
 * `dates` by day. A day the headline does not carry gets no index of its own, but its return is
 * still compounded, so the level drawn at every plotted day is the true native cumulative and no
 * value is interpolated or invented (UI-SPEC A.0). A return of -100% or worse ruins the segment
 * and it stays at zero rather than turning positive again.
 */
function compoundNative(points: readonly UnitSegmentPoint[], dates: readonly string[]): (number | null)[] {
  const out: (number | null)[] = new Array(dates.length).fill(null);
  let cum = 1;
  for (const p of points) {
    const growth = 1 + p.value;
    cum = growth > 0 ? cum * growth : 0;
    const idx = indexOfDay(dates, p.date);
    if (idx >= 0) out[idx] = cum;
  }
  return out;
}

/** The first positive finite value at or after `from`: the rebase divisor `resolveSeries` uses. */
function rebaseBase(values: ReadonlyArray<number | null>, from: number): number | null {
  for (let i = Math.max(0, from); i < values.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function anyFinite(values: ReadonlyArray<number | null>, from: number, to: number): boolean {
  for (let i = Math.max(0, from); i <= to && i < values.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) return true;
  }
  return false;
}

/** What the cumulative chart draws for a switched strategy in the current window. */
export type UnitSwitchLayout = {
  /** Index of the last USD day (S) on the headline axis; the coin base vertex sits at its x. */
  idxS: number;
  /** Switch inside the window with both segments drawn: the marker and both unit codes. */
  marker: boolean;
  /** Window wholly on one side of the switch: the one unit code drawn at the plot's top-left. */
  singleUnit: string | null;
  /** The coin segment holds only its base, so there is no coin day to draw yet. */
  baseOnly: boolean;
  /** A comparator is drawn (it stops at S). */
  comparatorActive: boolean;
};

/**
 * Phase 256 (UI-SPEC A): the cumulative chart's series for a switched strategy.
 *
 * Replaces the one headline strategy line with up to two native segments, each compounded in its
 * own unit from 1.00 and drawn as its OWN series, so the chart draws two separate `<path>`
 * elements and nothing joins the two units (the founder's "no line joining the two units").
 * The comparator is cut at S: a USD benchmark beside a coin-measured line invites the
 * cross-unit comparison SC-3 forbids.
 *
 * Null (the caller draws today's single series, byte-identical) when the config does not opt in,
 * either payload field is absent, the strategy line did not resolve, or nothing of either segment
 * is inside the window. `xRange[1]` is clamped to the axis here; `xRange[0]` feeds the rebase
 * exactly as `resolveSeries` does, and a rebase never crosses S: a window starting inside the USD
 * segment rebases only the USD part, one starting inside the coin segment only the coin part.
 */
export function resolveUnitSwitchChart(
  cfg: ChartConfig,
  payload: FactsheetPayload,
  comparator: ComparatorBlock,
  xRange: readonly [number, number],
): { series: ResolvedSeries[]; layout: UnitSwitchLayout } | null {
  const sw: UnitSwitchView | undefined = payload.unitSwitch;
  const seg: UnitSegmentsView | undefined = payload.unitSegments;
  if (!cfg.unitSwitch || !cfg.stratField || !sw || !seg) return null;
  if (!Array.isArray(seg.fromReturns) || !Array.isArray(seg.toReturns)) return null;
  // The strategy series is first whenever it resolved; without it there is nothing to replace.
  if (payload[cfg.stratField] == null) return null;
  const base = resolveSeries(cfg, payload, comparator, xRange[0]);
  if (base.length === 0) return null;

  const dates = payload.dates;
  const idxS = lastIndexAtOrBefore(dates, sw.lastFromDay);
  if (idxS < 0) return null;
  const xStart = xRange[0];
  const xEnd = Math.min(xRange[1], dates.length - 1);
  const rebase = !!cfg.rebaseOnZoom && xStart > 0;
  const baseOnly = seg.toReturns.length === 0;

  let usdVals = compoundNative(seg.fromReturns, dates);
  const usdVisible = anyFinite(usdVals, xStart, Math.min(xEnd, idxS));
  if (usdVisible && rebase) {
    const b = rebaseBase(usdVals, xStart);
    if (b != null) usdVals = usdVals.map((v) => (v == null ? v : v / b));
  }

  let coinVals: (number | null)[] = baseOnly ? [] : compoundNative(seg.toReturns, dates);
  let coinVisible = false;
  if (!baseOnly) {
    coinVisible = anyFinite(coinVals, Math.max(xStart, idxS + 1), xEnd);
    if (xStart > idxS) {
      // Window wholly in the coin segment: rebased at the window start; its base vertex is behind us.
      if (coinVisible && rebase) {
        const b = rebaseBase(coinVals, xStart);
        if (b != null) coinVals = coinVals.map((v) => (v == null ? v : v / b));
      }
    } else {
      // The coin base vertex: 1.00 at the x of the last USD day.
      coinVals[idxS] = 1;
    }
  }
  if (!usdVisible && !coinVisible) return null;

  const width = cfg.stratWidth ?? 1.6;
  const native = (unit: string, values: (number | null)[], hoverFrom?: number): ResolvedSeries => ({
    name: `${payload.strategyName} ${unitTag(unit)}`,
    values,
    color: "var(--color-accent)",
    width,
    opacity: 1.0,
    unit,
    ...(hoverFrom != null ? { hoverFrom } : {}),
  });
  const strategy: ResolvedSeries[] = [];
  if (usdVisible) strategy.push(native(sw.fromUnit, usdVals));
  if (coinVisible) strategy.push(native(sw.toUnit, coinVals, idxS + 1));

  // The comparator stops at S, so its path ends at the same x as the USD path.
  const comparators = base.slice(1).map((s) => ({
    ...s,
    values: s.values.map((v, i) => (i > idxS ? null : v)),
  }));

  const marker = usdVisible && coinVisible;
  return {
    series: [...strategy, ...comparators],
    layout: {
      idxS,
      marker,
      singleUnit: marker || baseOnly ? null : usdVisible ? sw.fromUnit : sw.toUnit,
      baseOnly,
      comparatorActive: base.length > 1,
    },
  };
}
