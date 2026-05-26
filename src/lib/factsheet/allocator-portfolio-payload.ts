import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import type { DailyReturn, FactsheetPayload } from "./types";
import { buildFactsheetPayload } from "./build-payload";

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

export interface AllocatorPortfolioMetadata {
  allocatorId: string;
  portfolioName?: string | null;
  computedAt?: string | null;
  markets?: string[];
  startDate?: string | null;
  aum?: number | null;
}

/**
 * Build a portfolio-level FactsheetPayload from the allocator's blended
 * equity curve. Returns null when the input series is too short for any
 * meaningful metric (the factsheet builder's own length threshold).
 *
 * This is the bridge that lets the existing factsheet v2 panel components
 * render against a portfolio aggregate without duplicating their math. The
 * blended `equityDailyPoints` is already the server's source of truth
 * (computed by the Python cron from `allocator_equity_snapshots.value_usd`),
 * so this converter just reshapes it; it does NOT re-aggregate from
 * per-strategy series.
 */
export function buildAllocatorPortfolioFactsheetPayload(
  equityDailyPoints: DailyPoint[],
  meta: AllocatorPortfolioMetadata,
): FactsheetPayload | null {
  const dailyReturns = equityCurveToDailyReturns(equityDailyPoints);
  if (dailyReturns.length < 2) return null;

  // Use a stable synthetic strategyId so the FactsheetProvider's
  // localStorage persistence keys per allocator rather than colliding
  // across users on a shared device.
  const strategyId = `portfolio:${meta.allocatorId}`;
  const portfolioName = meta.portfolioName?.trim() || "My Portfolio";

  return buildFactsheetPayload(
    {
      id: strategyId,
      name: portfolioName,
      types: ["allocator_portfolio"],
      markets: meta.markets ?? [],
      computedAt: meta.computedAt ?? new Date().toISOString(),
      trustTier: null,
      // FINDING-6 (b06-silentfailure): Allocator portfolio blends are always
      // derived from live API equity curves — not CSV uploads. Explicitly pass
      // "api" so AllocatorSection and PeerPercentilePanel are NOT suppressed
      // for allocator dashboard factsheets under the no-invented-data gate.
      // Without this, the conservative default ("csv") silently hides both panels.
      ingestSource: "api",
      description: null,
      subtypes: [],
      supportedExchanges: [],
      leverageRange: null,
      aum: meta.aum ?? null,
      maxCapacity: null,
      avgDailyTurnover: null,
      startDate: meta.startDate ?? null,
      benchmark: null,
    },
    dailyReturns,
  );
}
