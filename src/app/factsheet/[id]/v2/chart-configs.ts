import type { ComparatorBlock, FactsheetPayload } from "@/lib/factsheet/types";

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
  [K in keyof ComparatorBlock]: ComparatorBlock[K] extends (Array<number | null> | number[] | null) ? K : never;
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
  /** Close path to baseline and render filled area (used by Underwater chart). */
  fill?: boolean;
  /** Shade payload.strategyWorst10 periods behind the line (Worst-DDs chart). */
  ddHighlights?: boolean;
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
};

export const CHART_CONFIGS: ChartConfig[] = [
  {
    key: "cumulative",
    title: "Cumulative Returns",
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
    const raw = payload[cfg.stratField] as ReadonlyArray<number | null>;
    out.push({
      name: isDrawdown ? "Drawdown" : payload.strategyName,
      values: rebase(raw),
      color: isDrawdown ? "var(--color-negative)" : "var(--color-accent)",
      width: cfg.stratWidth ?? (cfg.fill ? 1.0 : 1.6),
      opacity: 1.0,
      fill: cfg.fill,
    });
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
