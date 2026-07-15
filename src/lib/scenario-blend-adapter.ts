/**
 * Backbone-routed blend-panel adapter (SC-1, Phase 108).
 *
 * Reproduces the EXACT public shape of the retired legacy blend-panels module
 * (deleted in Plan 108-02), but derives every rolling series from the ONE
 * canonical backbone — the POPULATION-std primitives in `factsheet/rolling.ts`
 * (the same code the full backbone series-bundle entry calls) — and the
 * quantiles from `factsheet/quantiles.ts::quantileSummary`. No second
 * Sharpe/annualization stack, no sample-std (÷ n−1) math lives here.
 *
 * Pure TS, zero side-effects (no fetch / DOM / time). Consumes the frozen
 * engine's UNROUNDED `portfolio_daily_returns` (`{ date, value }[]`, where
 * `value` is the daily RETURN) — mirroring the sibling adapter
 * `scenario-factsheet-payload.ts` (synthesize-a-minimal-input discipline).
 *
 * USER DECISIONS honoured (108-CONTEXT):
 *   - Parity std: POPULATION std is canonical (backbone). The prior module used
 *     SAMPLE std (÷ n−1). The shift is sub-1px on the chart line; a ~0.2–0.8%
 *     relative shift IS visible in the rolling vol/Sharpe HOVER TOOLTIPS
 *     (2-decimal percent, e.g. 3M vol 25.00% → 24.80%) — accepted as the
 *     canonical population-std value (user-confirmed), an intentional convention
 *     unification (one rolling-std path), NOT a regression. (Do not claim it is
 *     invisible at display precision — the tooltip is hover-visible.)
 *   - Adapter route: call the backbone PRIMITIVES with the caller's EXPLICIT
 *     rolling window (63/126/252) — this preserves the 3M/6M/12M toggle WITHOUT
 *     the heavy full backbone series-bundle entry per toggle press.
 *   - Quantile whiskers: keep min/max — { All: [min, p25, p50, p75, max] };
 *     the backbone's p05/p95 shape is NOT adopted (avoids a visible regression).
 *   - usableN gate: re-homed here (co-located with the derivation) so the 3
 *     ScenarioComposer UI keys stay in sync — reproduced verbatim from the
 *     retired module (WR-02 contract).
 *
 * OUTPUT-SHAPE SEAM: the backbone primitives return `Array<number | null>`
 * PARALLEL to `rets` — a leading-warmup `null` prefix (null for i < window−1)
 * then a finite value at every subsequent index (degenerate slice → 0, never an
 * interior null). We zip index i against `portfolioDaily[i].date` and drop the
 * null entries, reproducing today's compacted `{ date, value }[]` (length
 * n − window + 1, first point dated at the window's last day).
 */
import { rollingVol, rollingSharpe, rollingSortino } from "@/lib/factsheet/rolling";
import { quantileSummary } from "@/lib/factsheet/quantiles";

/** Below this many usable points every series collapses to []/{}. */
const MIN_USABLE = 10;

/**
 * Five-number whisker summary for a quantile band: `[min, p25, p50, p75, max]`.
 *
 * A LABELED TUPLE (108-CONTEXT §Quantile whiskers) — NOT a bare `number[]` — so the
 * USER DECISION that the tails are the ABSOLUTE min/max (not p05/p95) is compiler-locked
 * at the type: the position of each element is fixed and named, and a producer that
 * emitted a p05/p95 shape or a wrong-length array is a compile error. Runtime output is
 * byte-identical to the prior `number[]` (a tuple IS a `number[]` to every consumer).
 */
export type QuantileWhiskers = [min: number, p25: number, p50: number, p75: number, max: number];

export interface BlendPanelSeries {
  /** CUMULATIVE-wealth series for ReturnHistogram (it derives daily internally). [] if degenerate. */
  histogramSeries: { date: string; value: number }[];
  /** Record<periodLabel, [min,p25,p50,p75,max]> for ReturnQuantiles. {} if degenerate. */
  quantiles: Record<string, QuantileWhiskers>;
  /** { sharpe_365d: series } so RollingMetrics resolves CHART_ACCENT. {} if degenerate. */
  rollingSharpe: Record<string, { date: string; value: number }[]>;
  /** population-std × √N (periodsPerYear, default 252), warmup dropped. [] if degenerate. */
  rollingVol: { date: string; value: number }[];
  /** downside RMS ÷ TOTAL window n × √N, warmup dropped. [] if degenerate. */
  rollingSortino: { date: string; value: number }[];
  /** Count of usable daily returns — drives the empty branch + disclosure copy. */
  usableN: number;
}

const EMPTY: Omit<BlendPanelSeries, "usableN"> = {
  histogramSeries: [],
  quantiles: {},
  rollingSharpe: {},
  rollingVol: [],
  rollingSortino: [],
};

/**
 * Zip a backbone primitive's index-parallel `Array<number | null>` against the
 * daily dates and drop null entries, reproducing the compacted `{ date, value }[]`
 * dated at each window's last day. The primitives emit ONLY a leading-warmup
 * null prefix, so this is a leading-warmup drop in practice; the `!== null`
 * filter is a defensive guard, robust regardless of where nulls sit.
 */
function zipDrop(
  values: Array<number | null>,
  portfolioDaily: { date: string; value: number }[],
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null) out.push({ date: portfolioDaily[i].date, value: v });
  }
  return out;
}

/**
 * Derive every blend-graph series from the frozen engine's unrounded
 * `portfolio_daily_returns`, routed through the canonical backbone primitives.
 * See the file header for the LOCKED convention pins.
 */
export function deriveBlendPanels(
  portfolioDaily: { date: string; value: number }[],
  window: number, // 63 | 126 | 252 (3M/6M/12M toggle)
  periodsPerYear = 252, // #597 — 252 traditional (default) / 365 crypto
): BlendPanelSeries {
  // ── Degenerate guard FIRST (re-homed VERBATIM, WR-02 pin) ─────────────
  // Count finite points; any non-finite value present collapses every series.
  let usableN = 0;
  let hasNonFinite = false;
  for (const p of portfolioDaily) {
    if (Number.isFinite(p.value)) usableN++;
    else hasNonFinite = true;
  }
  if (
    hasNonFinite ||
    portfolioDaily.length < MIN_USABLE ||
    portfolioDaily.length < window
  ) {
    // A non-finite value poisons the ENTIRE series → 0 USABLE points (report 0,
    // NOT the finite count) so the composer's `usableN < window` gate renders
    // the "Awaiting more data" banner instead of an empty chart. A merely-too-
    // short (all-finite) series keeps its real count: a smaller window can
    // legitimately recover it. Length checks use `portfolioDaily.length` (NOT
    // usableN) — preserve exactly (WR-02).
    return { ...EMPTY, usableN: hasNonFinite ? 0 : usableN };
  }

  const rets = portfolioDaily.map((p) => p.value);

  // ── Histogram cumulative-wealth (cumprod(1+r)) ────────────────────────
  // Copied verbatim from the retired module; this is the same geometric wealth
  // `compute.ts::cumEq` produces (NOT a second-Sharpe compute), safest for parity.
  let c = 1;
  const histogramSeries = portfolioDaily.map((p) => {
    c *= 1 + p.value;
    return { date: p.date, value: c };
  });

  // ── Quantiles — reshape backbone output to KEEP min/max whiskers ──────
  const q = quantileSummary(rets);
  const quantiles: Record<string, QuantileWhiskers> = {
    All: [q.min, q.p25, q.p50, q.p75, q.max],
  };

  // ── Rolling series — backbone POPULATION-std primitives at the EXPLICIT
  //    window (toggle-preserving); zip + drop the leading warmup null prefix. ──
  return {
    histogramSeries,
    quantiles,
    rollingSharpe: {
      sharpe_365d: zipDrop(rollingSharpe(rets, window, periodsPerYear), portfolioDaily),
    },
    rollingVol: zipDrop(rollingVol(rets, window, periodsPerYear), portfolioDaily),
    rollingSortino: zipDrop(rollingSortino(rets, window, periodsPerYear), portfolioDaily),
    usableN,
  };
}
