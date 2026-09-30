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
 * window (MTD, YTD, 3M, 6M, 1Y) ending after `through` is null, never +0.00%.
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
  const lastDate = dates[dates.length - 1];
  const pastThrough = aligned.through === null || (lastDate !== undefined && lastDate > aligned.through);

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

  // The per-day arrays keep their type and today's arithmetic (an uncovered day
  // enters them as 0) until 169.5-02 (chart arrays) and 169.5-04 (dailyReturns).
  const filled = benchReturns.map(r => r ?? 0);
  const cumulative = cumEq(filled);
  const cumVsBench = stratEquity.map((s, i) => {
    const b = cumulative[i];
    return b !== 0 ? s / b : 1;
  });
  // Vol-match: scale bench returns so its annualized vol equals strategy's,
  // then compound. Lets users compare both curves on a single chart fairly.
  // D-59: the scale inherits the comparator basis through benchSummary.ann_vol
  // (a switched input, no new ratio: D-36, the compute-once gate holds).
  const vmScale = benchSummary && benchSummary.ann_vol > 0 ? stratAnnVol / benchSummary.ann_vol : 1;
  const volMatched = cumEq(filled.map(r => r * vmScale));
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
    dailyReturns: filled,
    rollingVol: rollingVol(filled, rollWindowDays),
    rollingSharpe: rollingSharpe(filled, rollWindowDays),
    rollingSortino: rollingSortino(filled, rollWindowDays),
    volMatched,
    volMatchedLabel: `${short} × ${vmScale.toFixed(2)}`,
    rollingBeta: rollingBeta(stratReturns, filled, rollBetaWindowDays),
    through: aligned.through,
  };
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
  return { returns, paired: returns.map(r => r != null), through };
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
