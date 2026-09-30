import type { ComparatorBlock } from "./types";
import type { CoveredAlignment } from "./align";
import { compute, cumEq } from "./compute";
import { jointMetrics } from "./joint";
import { rollingVol, rollingSharpe, rollingSortino, rollingBeta } from "./rolling";

/**
 * Build one comparator block from aligned strategy + benchmark return series.
 * Ports `_comparator_block()` from the mockup generator. Carries every
 * per-comparator series the chart engine reads on picker swap.
 *
 * Series added per slice as charts come online:
 *   - cumulative      → CumulativeChart base bench line
 *   - cumVsBench      → CumVsBenchChart (strategy ÷ comparator, rebased to 1.0)
 *   - dailyReturns    → DailyReturnsChart overlay
 *   - rollingVol      → RollingVolChart overlay
 *
 * Phase 169.5 (SC3, D-09, D-54, D-58, D-59, D-64): `bench` is the coverage-aware
 * alignment from `alignCoveredReturns` (a plain array is read as its own
 * coverage: a null is uncovered, every non-null index paired). The comparator's
 * own summary is computed over the covered indices only, on the comparator's
 * basis `benchPeriodsPerYear` (the caller passes the smaller of the strategy's
 * and the comparator's basis; it is not recomputed here). `jointMetrics` stays
 * on the strategy's `periodsPerYear` over the PAIRED indices (166.4 D-A). A
 * window (MTD, YTD, 3M, 6M, 1Y) is null, never +0.00%, when the comparator is past
 * its coverage: a date on its own calendar lies after `through` (review WR-01).
 *
 * Phase 169.5 plan 02 (SC3, D-09, D-21, D-59 as amended, D-60 fix, D-64): the
 * CHART per-day arrays are null wherever the helper's return is null, so no chart
 * draws a flat comparator line over dates it has no prices for:
 *   - `cumulative` / `volMatched` compound the covered returns only and are null
 *     at an uncovered index (the level resumes from its last value after a gap);
 *     `cumVsBench` is null where `cumulative` is;
 *   - `rollingVol` / `rollingSharpe` / `rollingSortino` are, at an index at or past
 *     the warm-up whose own return is non-null, the `rolling.ts` statistic over the
 *     NON-NULL returns of the same strategy-date window, on `benchPeriodsPerYear`;
 *     null when the index is uncovered or the window holds fewer than 2 points;
 *   - `rollingBeta` (a joint series, no annualization basis) is, at a PAIRED index
 *     at or past the warm-up, `rolling.ts` `rollingBeta` over the window's PAIRED
 *     indices only, both legs compacted over the same indices; null when the index
 *     is unpaired or the window holds fewer than 2 paired points. On a dense, fully
 *     paired series the compaction is a no-op.
 *
 * Phase 169.5 plan 04 (SC3, D-09, D-21, D-64): `dailyReturns` is the helper's
 * SERIES as it stands, null wherever it has no return (never 0), so the EoY table,
 * the EoY bars and the histogram overlay never count an uncovered day as a 0%
 * comparator day. It is the series, not the pairing: day one is the comparator's
 * own return dated the first strategy date (null when there is none), and an
 * interval unpaired only because a benchmark date is missing inside it keeps its
 * series value.
 */
export function buildComparatorBlock(
  label: string,
  short: string,
  bench: CoveredAlignment | ReadonlyArray<number | null>,
  stratReturns: number[],
  stratEquity: number[],
  dates: string[],
  stratAnnVol: number,
  rollWindowDays: number,
  rollBetaWindowDays: number,
  // #597 — the strategy's annualization basis (252 traditional / 365 crypto).
  // Applied to the joint (alpha/TE/info-ratio/treynor): joint metrics describe
  // the strategy (166.4 D-A). Default 252 keeps existing callers byte-identical.
  periodsPerYear = 252,
  // Phase 169.5 D-59 (as amended 2026-09-27): the comparator's own summary basis.
  benchPeriodsPerYear = periodsPerYear,
): ComparatorBlock {
  const aligned = toAlignment(bench, dates);
  const benchReturns = aligned.returns;

  const coveredReturns: number[] = [];
  const coveredDates: string[] = [];
  for (let i = 0; i < benchReturns.length; i++) {
    const r = benchReturns[i];
    if (r != null) {
      coveredReturns.push(r);
      coveredDates.push(dates[i]);
    }
  }
  const benchSummary =
    coveredReturns.length > 0 ? compute(coveredReturns, coveredDates, 0, benchPeriodsPerYear) : null;
  // Phase 169.5 review WR-01: past coverage on the comparator's OWN calendar
  // (`isPastCoverage` in align.ts, the rule the picker caption also calls), never a
  // raw-date compare: a weekday comparator's Friday close covers a weekend last date.
  const pastThrough = aligned.coveredToEnd !== true;

  const pairedIdx: number[] = [];
  for (let i = 0; i < aligned.paired.length; i++) if (aligned.paired[i]) pairedIdx.push(i);
  const joint =
    pairedIdx.length > 0
      ? jointMetrics(
          pairedIdx.map(i => stratReturns[i]),
          pairedIdx.map(i => benchReturns[i] as number),
          0,
          periodsPerYear,
        )
      : null;

  const coveredEquity = cumEq(coveredReturns);
  const cumulative = scatterCovered(benchReturns, coveredEquity);
  const cumVsBench = stratEquity.map((s, i) => {
    const b = cumulative[i];
    if (b == null) return null;
    return b !== 0 ? s / b : 1;
  });
  // Vol-match: scale bench returns so its annualized vol equals strategy's,
  // then compound. Lets users compare both curves on a single chart fairly.
  // D-59: the scale inherits the comparator basis through benchSummary.ann_vol
  // (a switched input, no new ratio: D-36, the compute-once gate holds).
  const vmScale = benchSummary && benchSummary.ann_vol > 0 ? stratAnnVol / benchSummary.ann_vol : 1;
  const scaledCovered = coveredReturns.map(r => r * vmScale);
  const volMatched = scatterCovered(benchReturns, cumEq(scaledCovered));
  return {
    name: label,
    shortName: short,
    summary: benchSummary
      ? {
          cum_ret: benchSummary.cum_ret,
          cagr: benchSummary.cagr,
          ann_vol: benchSummary.ann_vol,
          sharpe: benchSummary.sharpe,
          sortino: benchSummary.sortino,
          calmar: benchSummary.calmar,
          max_dd: benchSummary.max_dd,
          longest_dd: benchSummary.longest_dd,
          mtd: pastThrough ? null : benchSummary.mtd,
          ytd: pastThrough ? null : benchSummary.ytd,
          p3m: pastThrough ? null : benchSummary.p3m,
          p6m: pastThrough ? null : benchSummary.p6m,
          p1y: pastThrough ? null : benchSummary.p1y,
          win_rate: benchSummary.win_rate,
          profit_factor: benchSummary.profit_factor,
        }
      : null,
    joint,
    cumulative,
    cumVsBench,
    dailyReturns: benchReturns.slice(),
    rollingVol: rollingOverCovered(benchReturns, rollWindowDays, w => rollingVol(w, w.length, benchPeriodsPerYear)),
    rollingSharpe: rollingOverCovered(benchReturns, rollWindowDays, w => rollingSharpe(w, w.length, benchPeriodsPerYear)),
    rollingSortino: rollingOverCovered(benchReturns, rollWindowDays, w => rollingSortino(w, w.length, benchPeriodsPerYear)),
    volMatched,
    volMatchedLabel: `${short} × ${vmScale.toFixed(2)}`,
    rollingBeta: rollingBetaOverPaired(stratReturns, aligned, rollBetaWindowDays),
    through: aligned.through,
  };
}

/**
 * Phase 169.5-02 (SC3, D-09) — place the per-covered-index values `perCovered`
 * (one per non-null entry of `returns`, in order) back on the full axis, null at
 * every uncovered index.
 */
function scatterCovered(returns: ReadonlyArray<number | null>, perCovered: readonly number[]): Array<number | null> {
  let j = 0;
  return returns.map(r => (r == null ? null : perCovered[j++]));
}

/**
 * Phase 169.5-02 (D-59 as amended) — a comparator rolling statistic over each
 * window's NON-NULL returns only: at an index at or past the warm-up whose own
 * return is non-null, `stat` (a `rolling.ts` helper called with the compacted
 * slice's length as its window) over the non-null returns in the same
 * strategy-date window, taking its last value; null when the index is uncovered or
 * the window holds fewer than 2 points. A closed-market null never enters a window
 * as a 0% day.
 */
function rollingOverCovered(
  returns: ReadonlyArray<number | null>,
  window: number,
  stat: (w: number[]) => Array<number | null>,
): Array<number | null> {
  const out: Array<number | null> = new Array(returns.length).fill(null);
  for (let i = window - 1; i < returns.length; i++) {
    if (returns[i] == null) continue;
    const w: number[] = [];
    for (let k = i - window + 1; k <= i; k++) {
      const r = returns[k];
      if (r != null) w.push(r);
    }
    if (w.length < 2) continue;
    out[i] = stat(w)[w.length - 1];
  }
  return out;
}

/**
 * Phase 169.5-02 (D-60 fix, D-64) — rolling beta over PAIRED intervals only: at a
 * paired index at or past the warm-up, `rolling.ts` `rollingBeta` over the
 * window's paired indices (strategy and comparator compacted over the SAME
 * indices), taking its last value; null when the index is unpaired or the window
 * holds fewer than 2 paired points. A closed-market day, an unpaired
 * Friday-to-Monday interval and an interval spanning a missing benchmark date
 * (166.4 review WR-01) never enter a beta window.
 */
function rollingBetaOverPaired(
  stratReturns: readonly number[],
  aligned: CoveredAlignment,
  window: number,
): Array<number | null> {
  const n = Math.min(stratReturns.length, aligned.returns.length);
  const out: Array<number | null> = new Array(n).fill(null);
  for (let i = window - 1; i < n; i++) {
    if (!aligned.paired[i] || aligned.returns[i] == null) continue;
    const ws: number[] = [];
    const wb: number[] = [];
    for (let k = i - window + 1; k <= i; k++) {
      const b = aligned.returns[k];
      if (aligned.paired[k] && b != null) {
        ws.push(stratReturns[k]);
        wb.push(b);
      }
    }
    if (ws.length < 2) continue;
    out[i] = rollingBeta(ws, wb, ws.length)[ws.length - 1];
  }
  return out;
}

/** A plain array is its own coverage: null uncovered, non-null covered and paired. */
function toAlignment(
  bench: CoveredAlignment | ReadonlyArray<number | null>,
  dates: string[],
): CoveredAlignment {
  if (!Array.isArray(bench)) return bench as CoveredAlignment;
  const returns = [...(bench as ReadonlyArray<number | null>)];
  let through: string | null = null;
  for (let i = 0; i < returns.length; i++) if (returns[i] != null) through = dates[i] ?? through;
  // A plain array has no calendar: covered to the end exactly when its last entry is.
  const coveredToEnd = returns.length > 0 && returns[returns.length - 1] != null;
  return { returns, paired: returns.map(r => r != null), through, coveredToEnd };
}

/** The "no comparator selected" block — all series null, picker still works. */
export const noneComparatorBlock: ComparatorBlock = {
  name: "None",
  shortName: "—",
  summary: null,
  joint: null,
  cumulative: null,
  cumVsBench: null,
  dailyReturns: null,
  rollingVol: null,
  rollingSharpe: null,
  rollingSortino: null,
  volMatched: null,
  volMatchedLabel: null,
  rollingBeta: null,
};

/**
 * Phase 169.5 (SC3, D-09, D-54): the unavailable form of a comparator whose
 * prices could not be read. `noneComparatorBlock`-shaped with its name kept,
 * `summary` null and `through` null; never the bundled fixture.
 */
export function unavailableComparatorBlock(label: string, short: string): ComparatorBlock {
  return { ...noneComparatorBlock, name: label, shortName: short, through: null };
}
