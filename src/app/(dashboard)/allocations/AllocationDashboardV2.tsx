"use client";

import { useMemo } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EmptyState } from "./EmptyState";
import { AlertBanner } from "./components/AlertBanner";
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
    // NEW-C09-04 (B14, audit-2026-05-07): the payload already carries the
    // sync-freshness signal — `allKeysStale` is true when every active
    // api_key's `last_sync_at` is older than 24h, and `lastSyncAt` is the
    // newest of them. The legacy `components/KpiStrip.tsx` consumes it via
    // an `allKeysStale` prop, but the V2 Overview routes through
    // FactsheetBody, which has no equivalent dim-the-cells path. Surface
    // the signal as a non-blocking banner above the InsightStrip so the
    // allocator gets the freshness cue (and a path to retry) instead of
    // looking at full-confidence numbers computed on stale data.
    allKeysStale = false,
    lastSyncAt = null,
    // CL9 / NEW-C01-11: true when the allocator's reconstructed equity history
    // was built against an unknown absolute baseline (OKX 90-day terminus
    // clamped the funding deposit out of the fetch window). The flagged rows
    // are already excluded server-side from equityDailyPoints / KPIs; this just
    // drives the explanatory banner so the missing absolute history doesn't
    // read as a broken connection.
    equityBaselineUnknown = false,
  } = props;

  const holdingsEmpty = holdingsSummary.length === 0;

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
        {/* CL9 / NEW-C01-11: holdingsSummary (allocator_holdings) and
            equityBaselineUnknown (allocator_equity_snapshots) are independent
            sources. A terminus-clamped allocator whose holdings poll hasn't
            landed yet (first-connect race) would otherwise see only the bare
            "connect an exchange" CTA — actively wrong, since they DO have a
            connected key with reconstructed (if baseline-unknown) history.
            Surface the banner here too so the gap reads as a data-horizon
            limit, not a missing connection. */}
        {equityBaselineUnknown && <BaselineUnknownBanner />}
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
        // B21: `data` is `unknown` on WidgetProps; EquityChartWidget validates
        // it through equityChartWidgetDataSchema, so the payload passes as-is
        // (the prior `as unknown as Record<string, unknown>` double-cast is gone).
        // H-0076: width/height omitted — the chart sizes via ResponsiveContainer.
        data={props}
        timeframe="1YTD"
      />
    </section>
  );

  return (
    <div data-ui-v2-shell="true" className="relative">
      {portfolio != null && <AlertBanner portfolioId={portfolio.id} />}
      {/* NEW-C09-04 (B14): freshness banner. Renders only when every active
          API key's last_sync_at is >24h old AND the dashboard is not actively
          syncing right now (hasSyncing suppresses to avoid double-messaging
          with the in-flight SyncProgress pill). Non-blocking: the dashboard
          renders the last-known-good numbers behind it; the banner just
          signals the staleness + offers the Connect Exchange path. */}
      {allKeysStale && !hasSyncing && (
        <StalenessBanner lastSyncAt={lastSyncAt} />
      )}
      {/* CL9 / NEW-C01-11: absolute equity/drawdown history before the live
          window can't be reconstructed (positions were funded before the
          venue's data horizon). Non-blocking — live holdings + AUM behind it
          remain accurate; the trustworthy curve rebuilds as daily snapshots
          accrue. */}
      {equityBaselineUnknown && <BaselineUnknownBanner />}
      <InsightStrip
        analytics={analytics}
        portfolioId={portfolio?.id ?? null}
        flaggedCount={flaggedHoldings.length}
        className="mt-3 px-1"
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

/**
 * NEW-C09-04 (B14, audit-2026-05-07): non-blocking freshness banner.
 *
 * Renders above the InsightStrip when every active API key's `last_sync_at`
 * is older than 24h. The dashboard still renders the last-known-good
 * analytics behind it; this banner just makes the staleness observable so
 * the allocator doesn't read full-confidence numbers as fresh truth.
 *
 * Uses the warning design tokens already in DESIGN.md (`--color-warning-bg`,
 * `--color-warning-border`) — same shape as the dashboard-recovery banner
 * above so the surface stays visually coherent. Dismissal is intentionally
 * NOT supported: the staleness condition is data-driven (resolves only when
 * a key actually syncs successfully) so a one-shot dismiss would let the
 * user re-acquire the wrong mental model on the next page load.
 */
function StalenessBanner({ lastSyncAt }: { lastSyncAt: string | null }) {
  const ageCopy = formatRelativeAge(lastSyncAt);
  return (
    <div
      role="status"
      data-testid="dashboard-staleness-banner"
      className="mb-3 rounded-md border px-4 py-2 text-sm"
      style={{
        background: "var(--color-warning-bg)",
        borderColor: "var(--color-warning-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <span className="font-medium">Analytics may be stale.</span>{" "}
      <span>
        {ageCopy
          ? `Last successful sync was ${ageCopy}.`
          : "No successful sync recorded yet."}
        {" "}Use the API keys panel below to reconnect a key, or wait for
        the next scheduled sync.
      </span>
    </div>
  );
}

/**
 * CL9 / NEW-C01-11: non-blocking banner shown when the allocator's
 * reconstructed equity history was built against an unknown absolute baseline.
 *
 * On venues with a capped trade horizon (OKX's 90-day window), positions
 * funded before that horizon leave the reconstruction with no opening balance,
 * so the absolute equity level — and the drawdown / time-weighted return
 * derived from it — is unreliable for the clamped window. Those rows are
 * excluded server-side from every level-derived surface; this banner explains
 * why the absolute history is short so it doesn't read as a broken connection.
 *
 * Uses the same warning design tokens + role="status" shape as StalenessBanner
 * so the freshness/quality banners stay visually coherent. Not dismissible: the
 * condition is data-driven (resolves only as trustworthy daily-refresh rows
 * accrue), so a one-shot dismiss would let the user re-acquire the wrong mental
 * model on the next load.
 */
function BaselineUnknownBanner() {
  return (
    <div
      role="status"
      data-testid="dashboard-baseline-unknown-banner"
      className="mb-3 rounded-md border px-4 py-2 text-sm"
      style={{
        background: "var(--color-warning-bg)",
        borderColor: "var(--color-warning-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <span className="font-medium">Limited equity history.</span>{" "}
      <span>
        Some positions were funded before your exchange&apos;s available data
        window, so absolute equity and drawdown can&apos;t be reconstructed for
        that earlier period. Your live holdings and current AUM are accurate, and
        a full performance history builds up from here as daily snapshots accrue.
      </span>
    </div>
  );
}

function formatRelativeAge(iso: string | null): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "less than 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
