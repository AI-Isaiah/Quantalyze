import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "./types";
import { buildFactsheetPayload } from "./build-payload";
import { equityCurveToDailyReturns } from "./resolve-series";

// Phase 147 / SC2 — ONE series-resolution mechanism. Both functions moved verbatim to the
// leaf `./resolve-series` (which does NOT import ./build-payload) so the OG route and the
// public share page can resolve a series without pulling build-payload's transitive graph;
// re-exported here so existing importers keep their specifier at zero diff.
export { equityCurveToDailyReturns, resolveDailyReturnSeries } from "./resolve-series";

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
      // FINDING-6 style (#597 part 2, BLEND-02): allocator portfolio blends are
      // derived from live API equity curves — every supported venue is crypto
      // today, so under the blend rule (84-CONTEXT.md, any-crypto-leg → 365) the
      // portfolio series is calendar-daily → the risk metrics (ann_vol / sharpe /
      // sortino) annualize on √365. CAGR stays on the calendar clock (invariant).
      // A future non-crypto venue must derive this from the book's key roster
      // (blendPeriodsPerYear over the constituent keys) instead of a literal.
      assetClass: "crypto",
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
