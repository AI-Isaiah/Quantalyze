import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiStrip } from "./KpiStrip";
import type { ComputedMetrics } from "@/lib/scenario";

/**
 * Phase 07 / 07-03 — KpiStrip warm-up + stale + venue-specific rendering.
 *
 * Covered behaviours:
 *   - Default warm-up copy when `snapshotCount < 30 && !allKeysStale` and
 *     venue context is absent or ≥ 3 months.
 *   - VOICES-ACCEPTED f9 venue-specific copy: when minHistoryDepthMonths
 *     < 3 AND activeVenues is non-empty, substitute "Only {N} months of
 *     history available on {venues.join(", ")}".
 *   - Staleness suppresses the warm-up helper entirely (07-05 WarningBanner
 *     carries the global stale copy).
 *   - Sufficient data (snapshotCount >= 30) → no warm-up helper.
 */

// Empty ComputedMetrics skeleton — all numerics null so the KpiStrip hits
// the warm-up render branch for every annualised KPI.
const EMPTY_METRICS: ComputedMetrics = {
  n: 0,
  twr: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  max_drawdown: null,
  max_dd_days: null,
  correlation_matrix: null,
  avg_pairwise_correlation: null,
  equity_curve: [],
  effective_start: null,
  effective_end: null,
};

describe("KpiStrip — warm-up + stale + venue-specific rendering", () => {
  it("Test B (default warm-up): snapshotCount=10 + no venue context → renders em-dash AND 'Warming up — need 20 more days of synced data.'", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={10}
        allKeysStale={false}
        minHistoryDepthMonths={null}
        activeVenues={[]}
      />,
    );
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThan(0);
    // At least one KPI cell should render the em-dash placeholder.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("Test C (sufficient data): snapshotCount=30 + numeric CAGR → no 'Warming up' copy anywhere", () => {
    const metrics: ComputedMetrics = {
      ...EMPTY_METRICS,
      cagr: 0.12,
      sharpe: 1.5,
      sortino: 2.0,
      volatility: 0.25,
      max_drawdown: -0.15,
      twr: 0.18,
    };
    render(
      <KpiStrip
        analytics={null}
        metrics={metrics}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
        allKeysStale={false}
        minHistoryDepthMonths={24}
        activeVenues={["Binance"]}
      />,
    );
    expect(screen.queryByText(/Warming up/)).toBeNull();
    expect(screen.queryByText(/Only .* months of history/)).toBeNull();
  });

  it("Test D (stale suppresses warm-up helper): snapshotCount=45 + allKeysStale=true + null metrics → em-dash, NO Warming up, NO Only copy", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={45}
        allKeysStale={true}
        minHistoryDepthMonths={24}
        activeVenues={["Binance"]}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Warming up/)).toBeNull();
    expect(screen.queryByText(/Only .* months of history/)).toBeNull();
  });

  it("Test E (venue-specific OKX — f9): snapshotCount=10 + minHistoryDepthMonths=3 + activeVenues=['OKX'] → 'Only 3 months of history available on OKX', NO default copy", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={10}
        allKeysStale={false}
        minHistoryDepthMonths={3}
        activeVenues={["OKX"]}
      />,
    );
    expect(
      screen.getAllByText("Only 3 months of history available on OKX").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Warming up — need/)).toBeNull();
  });

  it("Test F (venue-specific multi — f9): minHistoryDepthMonths=3 + activeVenues=['Binance','OKX'] → 'Only 3 months of history available on Binance, OKX'", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={5}
        allKeysStale={false}
        minHistoryDepthMonths={3}
        activeVenues={["Binance", "OKX"]}
      />,
    );
    expect(
      screen.getAllByText("Only 3 months of history available on Binance, OKX")
        .length,
    ).toBeGreaterThan(0);
  });

  it("Test G (Binance default — f9): minHistoryDepthMonths=24 + activeVenues=['Binance'] → DEFAULT warm-up copy, NOT venue-specific", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={10}
        allKeysStale={false}
        minHistoryDepthMonths={24}
        activeVenues={["Binance"]}
      />,
    );
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Only .* months of history/)).toBeNull();
  });

  it("Test H (Bybit default — f9): minHistoryDepthMonths=24 + activeVenues=['Bybit'] → DEFAULT warm-up copy", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={null}
        snapshotCount={10}
        allKeysStale={false}
        minHistoryDepthMonths={24}
        activeVenues={["Bybit"]}
      />,
    );
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Only .* months of history/)).toBeNull();
  });
});
