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

describe("<CompositionDonut> — B14 per-slice freshness", () => {
  it("renders a freshness badge per slice with a computed_at and distinguishes fresh from stale", () => {
    const { container } = render(
      <CompositionDonut
        strategies={[
          { id: "a", name: "Fresh", weight: 0.6, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: hoursAgoIso(2) },
          { id: "b", name: "Stale", weight: 0.4, amount: 500, twr: 0.1, sharpe: 1.0, computedAt: hoursAgoIso(100) },
        ]}
      />,
    );

    expect(screen.getAllByText(/Synced/i)).toHaveLength(2);
    // 2h ago → fresh (positive); 100h ago → stale (negative).
    expect(container.querySelectorAll(".bg-positive")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
  });

  it("renders no freshness badge for a slice missing computed_at", () => {
    render(
      <CompositionDonut
        strategies={[
          { id: "a", name: "NoData", weight: 1, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: null },
        ]}
      />,
    );

    expect(screen.queryByText(/Synced/i)).toBeNull();
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
          { id: "a", name: "Fresh", weight: 0.6, amount: 1000, twr: 0.2, sharpe: 1.5, computedAt: null },
          { id: "b", name: "Other", weight: 0.4, amount: 500, twr: 0.1, sharpe: 1.0, computedAt: null },
        ]}
      />,
    );
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.getAttribute("data-trigger")).toBe("hover");
    expect(tooltip.getAttribute("data-trigger")).not.toBe("click");
  });
});
