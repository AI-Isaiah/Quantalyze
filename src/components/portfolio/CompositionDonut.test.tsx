import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompositionDonut } from "./CompositionDonut";

// Recharts in jsdom gives ResponsiveContainer zero geometry, so the real
// PieChart/Tooltip never mount and the injected `trigger` can't be observed.
// Replace recharts with passthrough stand-ins (children render through, so the
// constituent table + SyncBadges — which live OUTSIDE the chart and drive the
// B14 specs below — are unaffected) and surface the TouchTooltip-injected
// `trigger` on a data-* attribute for the CHART-01b desktop-byte-identity spec.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const NullComponent = () => null;
  const Tooltip = ({ trigger }: { trigger?: string }) => (
    <div data-testid="tooltip" data-trigger={trigger ?? ""} />
  );
  return {
    ResponsiveContainer: Passthrough,
    PieChart: Passthrough,
    Pie: Passthrough,
    Cell: NullComponent,
    Tooltip,
  };
});

/**
 * B14 — Freshness / Liveness Signaling Contract.
 *
 * CompositionDonut's table renders each slice's TWR / Sharpe from that
 * constituent's own analytics. Without a per-slice liveness signal a stale
 * slice's numbers read as current. These specs pin that each slice carries its
 * own freshness (via the SyncBadge → computeFreshness SoT) and that a slice
 * with no computed_at never fabricates one.
 */
function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** A series-end date N days back — Phase 163 / HONEST-08. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

describe("<CompositionDonut> — B14 per-slice freshness", () => {
  // Phase 167.1.2.2.2 / D-07 — the per-slice badge states the last TRADE FETCH
  // (`tradesFetchedAt`), not the analytics compute time. The stale slice below
  // carries a FRESH `computedAt` (the status bridge re-stamps it on every job
  // transition), so a badge still keyed on it would paint both slices green.
  it("renders a freshness badge per slice with a trade fetch and distinguishes fresh from stale", () => {
    const { container } = render(
      <CompositionDonut
        strategies={[
          // Phase 163 / HONEST-08 — each slice carries a LIVE track record, so
          // nothing outranks the trade sentence and this spec keeps testing
          // the fresh/stale split it was written for.
          { id: "a", name: "Fresh", weight: 0.6, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: hoursAgoIso(1), seriesEnd: isoDaysAgo(1), tradesFetchedAt: hoursAgoIso(2) },
          { id: "b", name: "Stale", weight: 0.4, amount: 500, twr: 0.1, sharpe: 1.0, computedAt: hoursAgoIso(1), seriesEnd: isoDaysAgo(1), tradesFetchedAt: hoursAgoIso(100) },
        ]}
      />,
    );

    expect(screen.getAllByText(/Trades fetched/i)).toHaveLength(2);
    expect(screen.queryByText(/Synced/i)).toBeNull();
    // Fetched 2h ago → current (positive); 100h (4d) ago → stale (negative).
    expect(container.querySelectorAll(".bg-positive")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
  });

  it("HONEST-08: a fresh job over a 112-day-dead series reads the TRACK RECORD", () => {
    const { container } = render(
      <CompositionDonut
        strategies={[
          { id: "a", name: "DeadTrack", weight: 1, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: hoursAgoIso(7), seriesEnd: isoDaysAgo(112), tradesFetchedAt: hoursAgoIso(7) },
        ]}
      />,
    );

    expect(container.querySelectorAll(".bg-positive")).toHaveLength(0);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
    // A current fetch is on the slice, yet the dead track record outranks it.
    expect(screen.queryByText(/Trades fetched/i)).toBeNull();
    expect(screen.getByText(/Track record ends/i)).toBeTruthy();
  });

  // Phase 167.1.2.2.2 / D-07 — REPLACES "an UNKNOWN series end caps the slice
  // dot below fresh": that cap belonged to the retired job-recency claim. The
  // badge now names the TRADE FETCH, which the cron recorded whether or not
  // this slice carries a series, and an absent series contributes nothing to
  // the verdict (UI-SPEC "Badge states", rule 3).
  it("HONEST-08/D-07: an UNKNOWN series end neither caps nor extends the trade claim — the sentence names the fetch", () => {
    const { container } = render(
      <CompositionDonut
        strategies={[
          // IN-02: the null is EXPLICIT. `seriesEnd` became a required prop so
          // "this caller cannot resolve a track-record end" has to be stated
          // rather than achieved by leaving the field off — which is how a
          // future donut caller would have silently reopened HONEST-08.
          { id: "a", name: "NoSeries", weight: 1, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: hoursAgoIso(2), seriesEnd: null, tradesFetchedAt: hoursAgoIso(2) },
        ]}
      />,
    );

    expect(screen.getByText(/Trades fetched 2h ago/i)).toBeTruthy();
    expect(container.querySelectorAll(".bg-positive")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(0);
    // It makes no claim about a track record it cannot see.
    expect(screen.queryByText(/Track record/i)).toBeNull();
  });

  it("renders no freshness badge for a slice with no trade fetch (a fresh computedAt alone fabricates no liveness)", () => {
    render(
      <CompositionDonut
        strategies={[
          // A FRESH computedAt beside no trade fetch and no series: the old
          // badge said "Synced 2h ago" here.
          { id: "a", name: "NoData", weight: 1, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: hoursAgoIso(2), seriesEnd: null, tradesFetchedAt: null },
        ]}
      />,
    );

    expect(screen.queryByText(/Trades fetched|No trade fetch|Track record|Synced/i)).toBeNull();
  });
});

describe("<CompositionDonut> — desktop byte-identity (CHART-01b, PieChart/Cell family)", () => {
  // useBreakpoint is NOT mocked, so the real SSR-safe hook resolves to "desktop"
  // on its all-false jsdom snapshot (useBreakpoint.ts:25-30). The TouchTooltip
  // shim must inject trigger="hover" — Recharts' own default — so the Pie/Cell
  // family's desktop render is byte-identical to the pre-shim chart (Assumption
  // A1). Falsifiable against a hard-coded "click" or a server-mobile read.
  it("renders the Recharts tooltip with trigger=\"hover\" on the default desktop viewport", () => {
    render(
      <CompositionDonut
        strategies={[
          { id: "a", name: "Fresh", weight: 0.6, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: null, seriesEnd: null, tradesFetchedAt: null },
          { id: "b", name: "Other", weight: 0.4, amount: 500, twr: 0.1, sharpe: 1.0, computedAt: null, seriesEnd: null, tradesFetchedAt: null },
        ]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.getAttribute("data-trigger")).toBe("hover");
    expect(tooltip.getAttribute("data-trigger")).not.toBe("click");
  });
});
