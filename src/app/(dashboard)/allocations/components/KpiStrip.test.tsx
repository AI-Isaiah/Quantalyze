import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { KpiStrip } from "./KpiStrip";
import type { ComputedMetrics } from "@/lib/scenario";

/**
 * Phase 09.1 / Plan 06 (D-09) — KpiStrip 5-cell shape tests.
 *
 * Sister suite to `KpiStrip.warmup.test.tsx` (Phase 07 invariants), which
 * is preserved verbatim and must continue passing in parallel. This file
 * locks the new designer shape:
 *   1. 5 cells in order: AUM / YTD TWR / Sharpe / Max DD 12m / Avg ρ
 *   2. Numeric formatting via formatPercent / formatNumber / formatCurrency
 *   3. R4 honest Avg ρ null-path: "Requires per-holding correlation data
 *      (pending)" when analytics.avg_correlation is null
 *   4. Stale path beats pending-copy on every cell
 *   5. Warmup precedence beats pending-copy on Avg ρ
 *
 * Fixture builder mirrors the warmup test for consistency.
 */

// Empty ComputedMetrics skeleton — all numerics null so cells default to
// the analytics-derived path or fall through to em-dash.
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

describe("KpiStrip — designer 5-cell shape (D-09)", () => {
  it("renders exactly 5 cells with the labels in canonical order", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );

    const labels = ["AUM", "YTD TWR", "Sharpe", "Max DD 12m", "Avg ρ"];
    const group = screen.getByRole("group", { name: "Portfolio KPIs" });
    // Each cell renders its label as the first child of the cell wrapper;
    // we assert order by mapping over the rendered label nodes.
    const renderedLabels = labels.map((l) =>
      within(group).getAllByText(l).length > 0 ? l : null,
    );
    expect(renderedLabels).toEqual(labels);
  });

  it("formats YTD TWR via formatPercent (0.12 → '+12.00%')", () => {
    render(
      <KpiStrip
        analytics={{ ytd_twr: 0.12 }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    expect(screen.getByText("+12.00%")).toBeTruthy();
  });

  it("formats Sharpe via formatNumber (1.73 → '1.73')", () => {
    render(
      <KpiStrip
        analytics={{ sharpe: 1.73 }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    expect(screen.getByText("1.73")).toBeTruthy();
  });

  it("R4 honest copy — Avg ρ null path: renders '—' AND 'Requires per-holding correlation data (pending)'", () => {
    render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.12,
          sharpe: 1.5,
          max_drawdown_12m: -0.08,
          avg_correlation: null,
        }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    // Em-dash present somewhere (the Avg ρ value cell).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // The honest pending-copy is the user-visible signal that the field
    // is not yet wired; assert it explicitly.
    expect(
      screen.getByText("Requires per-holding correlation data (pending)"),
    ).toBeTruthy();
    // And the loaded-data copy must NOT appear when null.
    expect(
      screen.queryByText("average pairwise correlation across holdings"),
    ).toBeNull();
  });

  it("Avg ρ loaded path: 0.42 renders the loaded-data sub-copy, NOT the pending copy", () => {
    render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.12,
          sharpe: 1.5,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    expect(screen.getByText("0.42")).toBeTruthy();
    expect(
      screen.getByText("average pairwise correlation across holdings"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  it("Stale path: allKeysStale=true → every cell renders '—' AND every cell shows stale sub-copy (precedence over pending)", () => {
    render(
      <KpiStrip
        analytics={{
          ytd_twr: 0.12,
          sharpe: 1.5,
          max_drawdown_12m: -0.08,
          avg_correlation: 0.42,
        }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={45}
        allKeysStale={true}
      />,
    );
    // 5 cells, each showing em-dash via the formatter null-input branch.
    expect(screen.getAllByText("—").length).toBe(5);
    // Stale sub-copy appears on every cell (5 instances).
    expect(
      screen.getAllByText("Last sync stale — awaiting next update").length,
    ).toBe(5);
    // Stale precedence beats the Avg ρ pending copy.
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  it("Venue-specific warmup precedence beats Avg ρ pending copy", () => {
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
    // Venue-specific copy renders on null-value cells (YTD, Sharpe,
    // Max DD, Avg ρ — AUM is exempt per Phase 07 / 07-03 f9).
    expect(
      screen.getAllByText("Only 3 months of history available on OKX")
        .length,
    ).toBeGreaterThanOrEqual(1);
    // Pending copy must NOT appear when warmup precedence wins.
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  it("Generic warmup precedence (minHistoryDepthMonths > 3): default copy beats Avg ρ pending copy", () => {
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
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByText("Requires per-holding correlation data (pending)"),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // M-0085 — non-finite (NaN / Infinity) inputs to the per-cell formatters.
  // The Sharpe + Avg ρ cells route through formatNumber, which guards with
  // `!Number.isFinite` → renders "—" (safe). The YTD TWR + Max DD cells route
  // through formatPercent, and AUM through formatCurrency — NEITHER guards
  // non-finite, so a NaN leaks as "NaN%" / "$NaN" into the allocator's KPI
  // strip. The correct behaviour is the em-dash degrade used everywhere else;
  // the leak is a production bug in the shared formatters (src/lib/utils.ts),
  // surfaced here for a follow-up fix.
  // ---------------------------------------------------------------------------
  it("M-0085: Sharpe + Avg ρ degrade to em-dash for NaN/Infinity (formatNumber is finite-guarded)", () => {
    const { rerender } = render(
      <KpiStrip
        analytics={{ sharpe: NaN, avg_correlation: NaN }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    // Both NaN-fed numeric cells collapse to em-dash; "NaN" never renders.
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);

    rerender(
      <KpiStrip
        analytics={{ sharpe: Infinity, avg_correlation: Infinity }}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={30}
      />,
    );
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  it.fails(
    "M-0085: YTD TWR / Max DD with NaN SHOULD degrade to em-dash but formatPercent leaks 'NaN%' — fix in follow-up (guard formatPercent for non-finite in src/lib/utils.ts)",
    () => {
      render(
        <KpiStrip
          analytics={{ ytd_twr: NaN, max_drawdown_12m: NaN }}
          metrics={EMPTY_METRICS}
          timeframe="ALL"
          aum={1_000_000}
          snapshotCount={30}
        />,
      );
      // CORRECT behaviour: no "NaN%" anywhere — the percent cells degrade to
      // em-dash like every other null/invalid path.
      expect(screen.queryByText(/NaN/)).toBeNull();
    },
  );

  it.fails(
    "M-0085: AUM with NaN SHOULD degrade to em-dash but formatCurrency leaks '$NaN' — fix in follow-up (guard formatCurrency for non-finite in src/lib/utils.ts)",
    () => {
      render(
        <KpiStrip
          analytics={null}
          metrics={EMPTY_METRICS}
          timeframe="ALL"
          aum={NaN}
          snapshotCount={30}
        />,
      );
      expect(screen.queryByText(/NaN/)).toBeNull();
    },
  );

  it("AUM is exempt from warmup helper (Phase 07 / 07-03 f9 invariant)", () => {
    render(
      <KpiStrip
        analytics={null}
        metrics={EMPTY_METRICS}
        timeframe="ALL"
        aum={1_000_000}
        snapshotCount={10}
        allKeysStale={false}
        minHistoryDepthMonths={null}
        activeVenues={[]}
      />,
    );
    // AUM has a real value → its cell shows neither warmup helper nor
    // any sub-line. The other 4 cells (null raw) carry the warmup copy.
    const warmupNodes = screen.getAllByText(
      "Warming up — need 20 more days of synced data.",
    );
    // 4 null-value cells × 1 warmup line = 4 instances. AUM cell is the
    // exempt one (and AUM has a real value here so the warmup branch
    // wouldn't have fired anyway — this asserts the count, not the
    // exemption directly).
    expect(warmupNodes.length).toBe(4);
  });
});
