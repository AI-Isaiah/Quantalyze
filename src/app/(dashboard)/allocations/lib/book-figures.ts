import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  figureRecord,
  gateAnnualized,
  gatedValue,
  type FigureRecord,
  type FigureState,
} from "@/lib/figure-gate";
import {
  holdingEquityContribution,
  holdingEquityIsReported,
} from "@/lib/holding-equity";

/**
 * Phase 198 plan 01 (D-06, ROUTE-07, SC-2): the ONE figures module the Overview's
 * at-a-glance panel and Scenario's live-book strip both read, so the two surfaces
 * cannot print different values for one payload. Pure: no React, no clock, no I/O.
 *
 * Three research corrections shaped it:
 *   - C5: Book equity is the sum of `holdingEquityContribution` over EVERY
 *     `holdingsSummary` row. It is never read from the baseline's AUM field, which
 *     is basis-dependent (the empty-baseline branch and the per-key branch disagree
 *     about what feeds it). A derivative with no reported P&L adds nothing and is
 *     counted, never silently dropped.
 *   - C6: Scenario's live Sharpe cell was ungated (`metrics={liveMetricsForKpi}`).
 *     `liveBookFigures` judges the live baseline's own record through the 194 D-15
 *     gate, and Scenario now passes this module's gated Sharpe into its strip.
 *   - C7: the figures do not depend on `equityHistoryState`. Scenario's live strip
 *     keeps them populated while the history rebuilds, so the glance must too; a
 *     figure that does not exist is null and prints as a dash.
 */

type Baseline = MyAllocationDashboardPayload["liveBaselineMetrics"];
type Holding = MyAllocationDashboardPayload["holdingsSummary"][number];

/** D-06: names the series behind the glance's return and risk cells, so the blend is not read as the factsheet's. */
export const BOOK_FIGURES_SERIES_CAPTION =
  "Return and risk: live book, blended from each key's daily returns.";

/**
 * The live baseline annualizes at the square root of 365
 * (`liveBaselineMetricsFromPerKeyDailies`), so its record is a crypto record.
 */
const LIVE_BASELINE_PERIODS_PER_YEAR = 365;

export interface LiveBookFigures {
  ytdTwr: number | null;
  /** The Sharpe AFTER the 194 D-15 gate: null when the record is withheld. */
  sharpe: number | null;
  sharpeState: FigureState;
  sharpeRecord: FigureRecord;
  maxDd: number | null;
  /** The last date of the live baseline's equity series, or null when there is none. */
  seriesEndDay: string | null;
}

/**
 * The live book's return and risk figures. Tolerates a null or absent baseline, as
 * Scenario's adapter does: a stale client cache or partial SSR payload degrades to
 * empty figures instead of throwing.
 */
export function liveBookFigures(
  baseline: Baseline | null | undefined,
): LiveBookFigures {
  const equity = baseline?.equity ?? [];
  const seriesStart = equity[0]?.date ?? null;
  const seriesEndDay = equity[equity.length - 1]?.date ?? null;
  const sharpeRecord = figureRecord({
    seriesStart,
    seriesEnd: seriesEndDay,
    headlineSince: null,
    observations: Math.max(equity.length - 1, 0),
    periodsPerYear: LIVE_BASELINE_PERIODS_PER_YEAR,
  });
  const sharpeState = gateAnnualized(sharpeRecord);
  return {
    ytdTwr: baseline?.ytdTwr ?? null,
    sharpe: gatedValue(baseline?.sharpe, sharpeState),
    sharpeState,
    sharpeRecord,
    maxDd: baseline?.maxDd ?? null,
    seriesEndDay,
  };
}

/**
 * Book equity (C5): the sum of every reported contribution. Null for an empty
 * list AND when no row reported one (all derivatives without P&L): a sum over
 * nothing is unknown, never a zero.
 */
export function bookEquityUsd(holdings: ReadonlyArray<Holding>): number | null {
  let total = 0;
  let anyReported = false;
  for (const h of holdings) {
    const c = holdingEquityContribution(h);
    if (c !== null) {
      total += c;
      anyReported = true;
    }
  }
  return anyReported ? total : null;
}

/** Derivative rows whose P&L is not reported: they add nothing to Book equity, and the glance says how many. */
export function unreportedDerivativeCount(
  holdings: ReadonlyArray<Holding>,
): number {
  let n = 0;
  for (const h of holdings) {
    if (h.holding_type === "derivative" && !holdingEquityIsReported(h)) n++;
  }
  return n;
}

/**
 * The caption that states how many derivative rows Book equity left out, or null
 * for none. One copy, printed by the glance and by the Holdings Positions header,
 * so the two surfaces cannot word it differently.
 */
export function unreportedDerivativeCaption(n: number): string | null {
  if (n <= 0) return null;
  return `Excludes ${n} derivative ${n === 1 ? "position" : "positions"} with no reported P&L.`;
}

/** The newest `asof` day across the rows, or null when no row carries one. */
export function holdingsReadDay(
  holdings: ReadonlyArray<Pick<Holding, "asof">>,
): string | null {
  let newest: string | null = null;
  for (const h of holdings) {
    if (typeof h.asof === "string" && (newest === null || h.asof > newest)) {
      newest = h.asof;
    }
  }
  return newest;
}
