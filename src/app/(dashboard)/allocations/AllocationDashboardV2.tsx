"use client";

import { useMemo } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EmptyState } from "./EmptyState";
import { AlertBanner } from "./components/AlertBanner";
import { KeyFilterPanel } from "./components/KeyFilterPanel";
import { useExcludedKeyIds } from "./hooks/useExcludedKeyIds";
import { InsightStrip } from "@/components/portfolio/InsightStrip";
import EquityChartWidget from "./widgets/performance/EquityChart";
import { buildAllocatorPortfolioFactsheetPayload } from "@/lib/factsheet/allocator-portfolio-payload";
import {
  FactsheetProvider,
} from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";

/**
 * Overview = factsheet shell. Full-width blended equity curve mounted at
 * the top of the article (via the FactsheetBody `topSlot`), followed by
 * the full factsheet panel set: KpiStrip → SectionNav → ControlBar →
 * MasterBrush → Performance / Distribution / Heatmaps / Stress / Returns
 * Signatures / Streaks panels on the left, MetricsColumn on the right.
 *
 * The blended `equityDailyPoints` is the server's source of truth —
 * aggregated across every API-connected strategy in the allocator's
 * portfolio via `allocator_equity_snapshots` — so the factsheet payload
 * builder just reshapes it into a `FactsheetPayload` and the existing
 * factsheet v2 panel components render against it verbatim. The strategy
 * header is suppressed (the AllocationsTabs page header already names
 * the surface) and the demo AllocatorSection is suppressed (this IS the
 * allocator's view; demo portfolios are out of place here).
 */
export function AllocationDashboardV2(props: MyAllocationDashboardPayload) {
  const {
    portfolio,
    holdingsSummary = [],
    hasSyncing = false,
    analytics,
    flaggedHoldings = [],
    equityDailyPoints,
    activeVenues = [],
    snapshotCount,
    apiKeys = [],
    allocator_id: allocatorId,
  } = props;

  // Per-API-key include/exclude — display-time filter for Overview
  // aggregates. Excluded keys still ingest server-side (the toggle does
  // NOT pause sync); we just drop their holdingsSummary rows from the
  // client-side projection so KPIs / holdings tiles reflect the
  // user-curated subset. The equity curve + factsheet panels still read
  // the pre-blended server snapshots — the KeyFilterPanel surfaces a
  // caveat when this divergence is active (see KeyFilterPanel.tsx for
  // the rationale + the gap-tracking comment).
  const { excluded: excludedKeyIds } = useExcludedKeyIds(allocatorId);

  const filteredHoldingsSummary = useMemo(() => {
    if (excludedKeyIds.size === 0) return holdingsSummary;
    return holdingsSummary.filter((row) => !excludedKeyIds.has(row.api_key_id));
  }, [holdingsSummary, excludedKeyIds]);

  const holdingsEmpty = filteredHoldingsSummary.length === 0;

  const factsheetPayload = useMemo(
    () =>
      buildAllocatorPortfolioFactsheetPayload(equityDailyPoints, {
        allocatorId: props.allocator_id,
        portfolioName: portfolio?.name ?? "My Portfolio",
        computedAt: analytics?.computed_at ?? null,
        markets: activeVenues,
        startDate: equityDailyPoints[0]?.date ?? null,
        aum: analytics?.total_aum ?? null,
      }),
    [
      equityDailyPoints,
      props.allocator_id,
      portfolio,
      analytics,
      activeVenues,
    ],
  );

  if (holdingsEmpty && !hasSyncing) {
    return (
      <div data-ui-v2-shell="true">
        <EmptyState hasSyncing={false} />
      </div>
    );
  }

  const equitySlot = (
    <section
      aria-label="Portfolio equity curve"
      className="mt-6"
      data-testid="overview-equity-curve"
    >
      <EquityChartWidget
        data={props as unknown as Record<string, unknown>}
        timeframe="YTD"
        width={0}
        height={0}
      />
    </section>
  );

  return (
    <div data-ui-v2-shell="true" className="relative">
      {portfolio != null && <AlertBanner portfolioId={portfolio.id} />}
      <InsightStrip
        analytics={analytics}
        portfolioId={portfolio?.id ?? null}
        flaggedCount={flaggedHoldings.length}
        className="mt-3 px-1"
      />
      <KeyFilterPanel
        allocatorId={allocatorId}
        apiKeys={apiKeys}
        holdingsSummary={holdingsSummary}
      />

      {factsheetPayload ? (
        <FactsheetProvider payload={factsheetPayload}>
          <FactsheetBody
            payload={factsheetPayload}
            hideHeader
            hideAllocatorSection
            hideFooter
            topSlot={equitySlot}
          />
        </FactsheetProvider>
      ) : (
        <>
          {equitySlot}
          <div
            role="status"
            data-testid="overview-factsheet-warmup"
            className="mx-auto mt-8 max-w-[1100px] py-12 text-center"
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">
              Portfolio factsheet
            </p>
            <p className="mt-3 text-sm text-text-secondary">
              Aggregated factsheet panels appear once at least two days of
              blended equity history are available. The data flows from
              the API keys you connect on the My Allocation page.
            </p>
            {snapshotCount > 0 && snapshotCount < 2 && (
              <p className="mt-2 text-[11px] text-text-muted">
                {snapshotCount} snapshot recorded so far.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
