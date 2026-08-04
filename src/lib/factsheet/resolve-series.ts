import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import type { DailyReturn } from "./types";

/**
 * Convert an allocator's blended equity-wealth curve into the daily-return
 * series the FactsheetPayload builder expects. `equityDailyPoints` carries
 * wealth values (cumulative product of 1 + r); successive ratios recover
 * the daily-return series.
 *
 * Returns an empty array when the input has fewer than two points (the
 * factsheet builder bails on series length below 2 anyway).
 */
export function equityCurveToDailyReturns(
  points: DailyPoint[],
): DailyReturn[] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const sorted = [...points]
    .filter(
      (p) =>
        p &&
        typeof p.date === "string" &&
        Number.isFinite(p.value) &&
        p.value > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: DailyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const curr = sorted[i].value;
    if (prev > 0 && Number.isFinite(curr)) {
      out.push({ date: sorted[i].date, value: curr / prev - 1 });
    }
  }
  return out;
}

/**
 * Resolve the analytics-row return series into the daily-return shape the
 * factsheet builder expects, handling the analytics-service column drift.
 *
 * The analytics-service writes the cumprod equity curve to
 * `strategy_analytics.returns_series`; the `daily_returns` column is only
 * populated by CSV ingest. Analytics-only strategies leave `daily_returns`
 * null, so reading it alone strands the factsheet on the "still computing"
 * placeholder even though the real series exists in `returns_series`. Try
 * the daily-return column first (cheaper, no derivation), fall back to
 * deriving from the wealth curve.
 */
export function resolveDailyReturnSeries(
  dailyReturnsRaw: unknown,
  returnsSeriesRaw: unknown,
): DailyReturn[] {
  const direct = normalizeDailyReturns(dailyReturnsRaw);
  if (direct.length > 0) return direct;
  return equityCurveToDailyReturns(normalizeDailyReturns(returnsSeriesRaw));
}
