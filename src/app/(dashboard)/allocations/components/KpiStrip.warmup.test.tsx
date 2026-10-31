import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiStrip } from "./KpiStrip";
import type { ComputedMetrics } from "@/lib/scenario";

/**
 * Phase 07 / 07-03 — KpiStrip warm-up + stale rendering (Phase 176: counted on
 * derived days, generic countdown copy only).
 *
 * Covered behaviours:
 *   - Default warm-up copy when `snapshotCount !== null && snapshotCount < 30
 *     && !allKeysStale`.
 *   - `snapshotCount === null` (a rebuilding book) never warms up (T-176-13).
 *   - The venue-specific "Only N months of history available" copy is gone
 *     (D-07); the removed props are ignored.
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

describe("KpiStrip — warm-up + stale rendering", () => {
  it("Test B (default warm-up): snapshotCount=10 → renders em-dash AND 'Warming up — need 20 more days of synced data.'", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={10}
        allKeysStale={false}
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
        snapshotCount={30}
        allKeysStale={false}
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
        snapshotCount={45}
        allKeysStale={true}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Warming up/)).toBeNull();
    expect(screen.queryByText(/Only .* months of history/)).toBeNull();
  });

  // Phase 176 (D-07): the venue-specific "Only N months of history" copy is gone
  // with the legacy `history_depth_months` column it read. A caller that still
  // passes the removed props (a stale cast payload) gets the generic countdown.
  it("Test E (removed props ignored): a props object still carrying minHistoryDepthMonths=3 and activeVenues=['OKX'] with snapshotCount=10 → generic countdown, NO 'months of history' copy", () => {
    const removedProps = {
      minHistoryDepthMonths: 3,
      activeVenues: ["OKX"],
    } as unknown as Record<string, never>;
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={10}
        allKeysStale={false}
        {...removedProps}
      />,
    );
    expect(
      screen.getAllByText("Warming up — need 20 more days of synced data.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/months of history/)).toBeNull();
  });

  // Phase 176 (T-176-13, Discretion): `snapshotCount` is null while the history
  // is rebuilding (the producer withholds the count with the curve). In JS
  // `null < 30` is true, so an unguarded gate would print "need 30 more days"
  // over a history that may be years long and suppress the scenario primary.
  it("Test N (null count = rebuilding): snapshotCount=null → NO 'Warming up' copy, and the scenario primary shows", () => {
    const scenario: ComputedMetrics = {
      ...EMPTY_METRICS,
      n: 252,
      twr: 0.18,
      sharpe: 1.51,
      max_drawdown: -0.04,
    };
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={null}
        allKeysStale={false}
        mode="scenario"
        scenarioMetrics={scenario}
        liveMetrics={EMPTY_METRICS}
      />,
    );
    expect(screen.queryByText(/Warming up/)).toBeNull();
    expect(screen.getByText("1.51")).toBeTruthy();
  });

  it("Test O (null count, live mode): snapshotCount=null with null metrics → em-dash cells, NO countdown", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        snapshotCount={null}
        allKeysStale={false}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Warming up/)).toBeNull();
  });
});
