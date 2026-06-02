import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompositionDonut } from "./CompositionDonut";

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
