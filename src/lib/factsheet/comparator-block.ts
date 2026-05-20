import type { ComparatorBlock } from "./types";
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
 * Future: volMatched, rollingSharpe/Sortino, rollingBeta.
 */
export function buildComparatorBlock(
  label: string,
  short: string,
  benchReturns: number[],
  stratReturns: number[],
  stratEquity: number[],
  dates: string[],
  stratAnnVol: number,
  rollWindowDays: number,
  rollBetaWindowDays: number,
): ComparatorBlock {
  const benchSummary = compute(benchReturns, dates);
  const joint = jointMetrics(stratReturns, benchReturns);
  const cumVsBench = stratEquity.map((s, i) => {
    const b = benchSummary.eq[i];
    return b !== 0 ? s / b : 1;
  });
  // Vol-match: scale bench returns so its annualized vol equals strategy's,
  // then compound. Lets users compare both curves on a single chart fairly.
  const vmScale = benchSummary.ann_vol > 0 ? stratAnnVol / benchSummary.ann_vol : 1;
  const volMatched = cumEq(benchReturns.map(r => r * vmScale));
  return {
    name: label,
    shortName: short,
    summary: {
      cum_ret: benchSummary.cum_ret,
      cagr: benchSummary.cagr,
      ann_vol: benchSummary.ann_vol,
      sharpe: benchSummary.sharpe,
      sortino: benchSummary.sortino,
      calmar: benchSummary.calmar,
      max_dd: benchSummary.max_dd,
      longest_dd: benchSummary.longest_dd,
      mtd: benchSummary.mtd,
      ytd: benchSummary.ytd,
      p3m: benchSummary.p3m,
      p6m: benchSummary.p6m,
      p1y: benchSummary.p1y,
      win_rate: benchSummary.win_rate,
      profit_factor: benchSummary.profit_factor,
    },
    joint,
    cumulative: benchSummary.eq,
    cumVsBench,
    dailyReturns: benchReturns,
    rollingVol: rollingVol(benchReturns, rollWindowDays),
    rollingSharpe: rollingSharpe(benchReturns, rollWindowDays),
    rollingSortino: rollingSortino(benchReturns, rollWindowDays),
    volMatched,
    volMatchedLabel: `${short} × ${vmScale.toFixed(2)}`,
    rollingBeta: rollingBeta(stratReturns, benchReturns, rollBetaWindowDays),
  };
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
