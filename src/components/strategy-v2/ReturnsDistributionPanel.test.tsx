import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 14b-02 — ReturnsDistributionPanel (Panel 4) wrapper tests.
 *
 * 12 acceptance criteria covering chrome, partial-data routing, lazy
 * lifecycle, sub-section banners, and Grok W-01 (useMemo + memo pairing).
 *
 * Strategy: mock `useLazyPanelMetrics` so each test can drive `status` /
 * `data` directly. Mock the heavy chart components so this test focuses
 * on the panel routing logic rather than chart rendering (those have
 * their own co-located tests).
 */

interface HookReturn {
  ref: (n: HTMLElement | null) => void;
  data: { daily_returns_grid?: { date: string; value: number }[] } | null;
  status: "idle" | "loading" | "ready" | "error";
}

let mockHookReturn: HookReturn = {
  ref: () => {},
  data: null,
  status: "idle",
};

vi.mock("@/hooks/useLazyPanelMetrics", () => ({
  useLazyPanelMetrics: () => mockHookReturn,
}));

// Mock the 5 sub-charts so the test asserts on routing, not paint.
let dailyHeatmapRenderCount = 0;
let lastDailyHeatmapDataRef: unknown = null;
vi.mock("@/components/charts/MonthlyHeatmap", () => ({
  MonthlyHeatmap: ({ data }: { data: unknown }) => (
    <div data-testid="monthly-heatmap" data-rows={Object.keys(data as object).length} />
  ),
}));
vi.mock("@/components/charts/DailyHeatmap", () => ({
  DailyHeatmap: ({ data }: { data: { date: string; value: number }[] }) => {
    dailyHeatmapRenderCount++;
    lastDailyHeatmapDataRef = data;
    return <div data-testid="daily-heatmap" data-len={data.length} />;
  },
}));
vi.mock("@/components/charts/ReturnHistogram", () => ({
  ReturnHistogram: ({ benchmarkReturns }: { benchmarkReturns?: unknown }) => (
    <div data-testid="return-histogram" data-benchmark={benchmarkReturns ? "yes" : "no"} />
  ),
}));
vi.mock("@/components/charts/ReturnQuantiles", () => ({
  ReturnQuantiles: () => <div data-testid="return-quantiles" />,
}));
vi.mock("@/components/charts/YearlyReturns", () => ({
  YearlyReturns: () => <div data-testid="yearly-returns" />,
}));

// Import AFTER vi.mock declarations so the mocks are applied.
import { ReturnsDistributionPanel } from "./ReturnsDistributionPanel";

const FULL_MONTHLY: Record<string, Record<string, number>> = {
  "2023": { Jan: 0.02, Feb: -0.01, Mar: 0.03 },
  "2024": { Jan: 0.04, Feb: 0.02 },
};
const FULL_QUANTILES: Record<string, number[]> = {
  Daily: [-0.05, -0.01, 0, 0.01, 0.05],
  Weekly: [-0.10, -0.03, 0.01, 0.04, 0.10],
};
function makeReturns(n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    value: 1 + Math.sin(i / 3) * 0.05,
  }));
}

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "idle" };
  dailyHeatmapRenderCount = 0;
  lastDailyHeatmapDataRef = null;
});

describe("ReturnsDistributionPanel — Phase 14b-02", () => {
  it("Test 1: chrome — section[data-panel='returns-distribution'] with 14a chrome classes", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "idle" };
    const { container } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const section = container.querySelector('section[data-panel="returns-distribution"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-label")).toBe("Returns distribution");
    const cls = section?.getAttribute("class") ?? "";
    expect(cls).toContain("mt-8");
    expect(cls).toContain("min-h-[240px]");
    expect(cls).toContain("rounded-lg");
    expect(cls).toContain("border");
    expect(cls).toContain("border-border");
    expect(cls).toContain("bg-surface");
    expect(cls).toContain("p-6");
    expect(cls).toContain("shadow-card");
  });

  it("Test 2: panel-level partial data when history_days < 30 — banner only, no sub-charts", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "ready" };
    const { container, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={20}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const banner = container.querySelector('[role="status"]');
    expect(banner?.textContent).toContain("This strategy needs at least 30 days of trading history to populate Returns distribution.");
    expect(queryByTestId("monthly-heatmap")).toBeNull();
    expect(queryByTestId("daily-heatmap")).toBeNull();
    expect(queryByTestId("return-histogram")).toBeNull();
    expect(queryByTestId("return-quantiles")).toBeNull();
    expect(queryByTestId("yearly-returns")).toBeNull();
  });

  it("Test 3: placeholder before intersection — data-panel-status='placeholder', no sub-charts", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "idle" };
    const { container, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const section = container.querySelector('section[data-panel="returns-distribution"]');
    expect(section?.getAttribute("data-panel-status")).toBe("placeholder");
    expect(queryByTestId("monthly-heatmap")).toBeNull();
  });

  it("Test 4: loading state — H2 + 'Loading…' under aria-live=polite, no sub-charts", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "loading" };
    const { container, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain("Loading…");
    expect(queryByTestId("monthly-heatmap")).toBeNull();
  });

  it("Test 5: ready full — all 5 sub-charts render in order", () => {
    mockHookReturn = {
      ref: () => {},
      data: { daily_returns_grid: [{ date: "2024-01-01", value: 0.01 }] },
      status: "ready",
    };
    const { getAllByRole, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const h3s = getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(h3s).toEqual([
      "Monthly heatmap",
      "Daily heatmap",
      "Return histogram",
      "Return quantiles",
      "Yearly returns",
    ]);
    expect(queryByTestId("monthly-heatmap")).not.toBeNull();
    expect(queryByTestId("daily-heatmap")).not.toBeNull();
    expect(queryByTestId("return-histogram")).not.toBeNull();
    expect(queryByTestId("return-quantiles")).not.toBeNull();
    expect(queryByTestId("yearly-returns")).not.toBeNull();
  });

  it("Test 6: empty daily_returns_grid → DailyHeatmap region replaced by sub-banner", () => {
    mockHookReturn = {
      ref: () => {},
      data: { daily_returns_grid: [] },
      status: "ready",
    };
    const { container, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    expect(queryByTestId("daily-heatmap")).toBeNull();
    expect(container.textContent).toContain("Daily heatmap activates after 30 days of trading history.");
    // Other 4 charts still render full.
    expect(queryByTestId("monthly-heatmap")).not.toBeNull();
    expect(queryByTestId("return-histogram")).not.toBeNull();
    expect(queryByTestId("return-quantiles")).not.toBeNull();
    expect(queryByTestId("yearly-returns")).not.toBeNull();
  });

  it("Test 7: history_days < 365 → YearlyReturns region replaced by sub-banner", () => {
    mockHookReturn = {
      ref: () => {},
      data: { daily_returns_grid: [{ date: "2024-01-01", value: 0.01 }] },
      status: "ready",
    };
    const { container, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={180}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    expect(queryByTestId("yearly-returns")).toBeNull();
    expect(container.textContent).toContain("Yearly returns activates after 1 year of trading history.");
    expect(queryByTestId("monthly-heatmap")).not.toBeNull();
    expect(queryByTestId("daily-heatmap")).not.toBeNull();
    expect(queryByTestId("return-histogram")).not.toBeNull();
    expect(queryByTestId("return-quantiles")).not.toBeNull();
  });

  it("Test 8: error state renders error banner", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container, queryByTestId } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    expect(container.textContent).toContain("Couldn’t load this section");
    expect(container.textContent).toContain("Refresh the page to retry. The other panels still work.");
    expect(queryByTestId("monthly-heatmap")).toBeNull();
  });

  it("Test 9: H3 sub-headings use canonical class set; forbidden classes absent", () => {
    mockHookReturn = {
      ref: () => {},
      data: { daily_returns_grid: [{ date: "2024-01-01", value: 0.01 }] },
      status: "ready",
    };
    const { container } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const h3s = Array.from(container.querySelectorAll("h3"));
    expect(h3s.length).toBe(5);
    for (const h3 of h3s) {
      const cls = h3.getAttribute("class") ?? "";
      expect(cls).toContain("text-xs");
      expect(cls).toContain("font-normal");
      expect(cls).toContain("uppercase");
      expect(cls).toContain("tracking-wider");
      expect(cls).toContain("text-text-secondary");
      expect(cls).not.toContain("font-medium");
      expect(cls).not.toContain("text-sm");
      expect(cls).not.toContain("text-xl");
      expect(cls).not.toContain("text-2xl");
    }
  });

  it("Test 10: source contains zero inline tick={{...}} object literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/ReturnsDistributionPanel.tsx"),
      "utf-8",
    );
    const matches = src.match(/tick=\{\{/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it("Test 11 (Grok W-01): source uses useMemo with daily_returns_grid dependency", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/ReturnsDistributionPanel.tsx"),
      "utf-8",
    );
    // Match useMemo block whose dependency array references daily_returns_grid.
    const useMemoCalls = src.match(/useMemo[\s\S]*?daily_returns_grid/g) ?? [];
    expect(useMemoCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 12 (Grok W-01): re-renders with same data ref pass stable reference to DailyHeatmap", () => {
    const grid = [
      { date: "2024-01-01", value: 0.01 },
      { date: "2024-01-02", value: -0.01 },
    ];
    mockHookReturn = { ref: () => {}, data: { daily_returns_grid: grid }, status: "ready" };
    const { rerender } = render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    const refAfterFirst = lastDailyHeatmapDataRef;
    expect(refAfterFirst).toBeDefined();
    // Re-render the parent with same props — the hook still returns the
    // SAME data object reference (mockHookReturn unchanged), so useMemo's
    // dependency stays equal and the data prop reference stays stable.
    rerender(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={FULL_MONTHLY}
        return_quantiles={FULL_QUANTILES}
        returns_series={makeReturns(30)}
      />,
    );
    expect(lastDailyHeatmapDataRef).toBe(refAfterFirst);
  });
});
