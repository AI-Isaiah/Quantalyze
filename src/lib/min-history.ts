/**
 * Minimum-history thresholds for institutional-fidelity charts.
 *
 * Charts in PerformanceReport (CorrelationWithBenchmark, WorstDrawdowns,
 * RollingMetrics, …) project an "this number is robust" aesthetic — clean
 * lines, precise tabular-nums, dashed average reference lines. A 90-day
 * correlation or 30-day Sharpe is statistically meaningless to a serious
 * allocator; surfacing them with the same dignified styling is exactly
 * the "misrepresent risk under specific data conditions" trust regression
 * audit-2026-05-07 G11.A.5 (P69) flagged.
 *
 * Each chart imports its threshold from here and renders an
 * "Insufficient history" empty state below threshold instead of a
 * fully-styled chart. Numbers are conservative defaults; when DESIGN.md
 * or the analytics team formalises an institutional-fidelity bar, update
 * here — single synchronisation point across charts.
 */

/** 90-day rolling correlation needs at least one full Sharpe-ratio year of aligned points. */
export const CORRELATION_90D_MIN_DAYS = 250;

/** Top-N drawdown table needs a full year of history to produce meaningful peak-trough episodes. */
export const WORST_DRAWDOWNS_MIN_DAYS = 365;

/** Long-run Sharpe reference line needs a full year so the average isn't a 30-day artifact. */
export const ROLLING_SHARPE_MIN_DAYS = 365;

/**
 * Render a friendly "insufficient history" message for a chart that
 * needs `requiredDays` of history but only has `actualDays`. Keeps copy
 * consistent across surfaces.
 */
export function insufficientHistoryMessage(
  metric: string,
  requiredDays: number,
  actualDays: number,
): string {
  return `Insufficient history for institutional-grade ${metric} (have ${actualDays} days, need ${requiredDays}).`;
}
