import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StrategyV2Detail } from "@/lib/queries";

/**
 * M-1149 (audit-2026-05-07) — DrawdownPanel 'use client' boundary (MA-7).
 *
 * PR #86 (v0.17.1.3) added 'use client' to DrawdownPanel.tsx so both
 * Recharts-backed children (DrawdownChart, WorstDrawdowns) mount in a
 * single hydration pass. The panel had no test file, so removing the
 * directive would silently re-introduce the server/client seam at the
 * chart subtree. This pins the directive (source-shape) and the
 * chart-vs-banner branch on history_days.
 *
 * The two Recharts children are mocked — jsdom has no layout engine and
 * ResponsiveContainer renders nothing useful; we only need to know WHICH
 * subtree mounts (the real charts vs the partial-data banner).
 */

vi.mock("@/components/charts/DrawdownChart", () => ({
  DrawdownChart: () => <div data-testid="drawdown-chart" />,
}));
vi.mock("@/components/charts/WorstDrawdowns", () => ({
  WorstDrawdowns: () => <div data-testid="worst-drawdowns" />,
}));

import { DrawdownPanel } from "./DrawdownPanel";

function panel3(
  overrides: Partial<StrategyV2Detail["panel3"]> = {},
): StrategyV2Detail["panel3"] {
  return {
    drawdown_series: [
      { date: "2026-01-01", value: 0 },
      { date: "2026-01-02", value: -0.05 },
    ],
    drawdown_episodes: [],
    ...overrides,
  };
}

describe("DrawdownPanel — 'use client' boundary + history gate (M-1149)", () => {
  it("source carries the load-bearing 'use client' directive on line 1", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/DrawdownPanel.tsx"),
      "utf-8",
    );
    // Removing this directive re-introduces the SSR/client straddle the
    // MA-7 fix landed to remove.
    expect(src).toMatch(/^"use client";/);
  });

  it("renders the DrawdownChart when history_days >= 30 and a series is present", () => {
    render(<DrawdownPanel panel3={panel3()} history_days={90} />);
    expect(screen.getByTestId("drawdown-chart")).toBeInTheDocument();
    // The Worst-5 table always mounts (it has its own empty-state copy).
    expect(screen.getByTestId("worst-drawdowns")).toBeInTheDocument();
    // The partial-data banner must NOT replace the chart.
    expect(screen.queryByText("Awaiting more data")).toBeNull();
  });

  it("replaces the chart with the partial-data banner when history_days < 30", () => {
    render(<DrawdownPanel panel3={panel3()} history_days={29} />);
    expect(screen.getByText("Awaiting more data")).toBeInTheDocument();
    expect(screen.queryByTestId("drawdown-chart")).toBeNull();
    // Worst-5 table still renders below the banner.
    expect(screen.getByTestId("worst-drawdowns")).toBeInTheDocument();
  });

  it("shows the banner when history_days is sufficient but no drawdown_series exists", () => {
    render(
      <DrawdownPanel
        panel3={panel3({ drawdown_series: null })}
        history_days={90}
      />,
    );
    expect(screen.getByText("Awaiting more data")).toBeInTheDocument();
    expect(screen.queryByTestId("drawdown-chart")).toBeNull();
  });
});
