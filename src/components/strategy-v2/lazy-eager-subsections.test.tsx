import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, within } from "@testing-library/react";

/**
 * Phase 170.5 R2-02 — a lazy panel's EAGER sub-sections render whatever the lazy
 * status is; the "Loading…" state lives only inside the sub-sections that read
 * the lazy payload, and the "Couldn’t load this section" banner is drawn once per
 * failed fetch (R3-02: Rolling metrics shows one above its lazy sub-sections).
 *
 * Round 1 (SFH-01) made a failed lazy fetch reach status "error". The Rolling
 * metrics and Returns distribution panels answered that by replacing the WHOLE
 * panel with the banner, hiding computed content that never needed the fetch:
 * the Rolling Sharpe chart (props), and the monthly heatmap, histogram,
 * quantiles and yearly returns (props). These tests drive `status` directly so
 * each lifecycle state is pinned; the real-transport chain is in
 * lazy-panel-fetch-failure.test.tsx.
 */

interface HookReturn {
  ref: (n: HTMLElement | null) => void;
  data: Record<string, unknown> | null;
  status: "idle" | "loading" | "ready" | "error";
}
let mockHookReturn: HookReturn = { ref: () => {}, data: null, status: "idle" };
vi.mock("@/hooks/useLazyPanelMetrics", () => ({
  useLazyPanelMetrics: () => mockHookReturn,
}));

const stub = vi.hoisted(() => (testId: string) => {
  const Stub = () => <div data-testid={testId} />;
  return Stub;
});
vi.mock("@/components/charts/RollingMetrics", () => ({ RollingMetrics: stub("rolling-sharpe") }));
vi.mock("@/components/charts/RollingVolatilityChart", () => ({ RollingVolatilityChart: stub("rolling-volatility") }));
vi.mock("@/components/charts/RollingSortinoChart", () => ({ RollingSortinoChart: stub("rolling-sortino") }));
vi.mock("@/components/charts/RollingAlphaBetaChart", () => ({ RollingAlphaBetaChart: stub("rolling-alpha-beta") }));
vi.mock("@/components/charts/MonthlyHeatmap", () => ({ MonthlyHeatmap: stub("monthly-heatmap") }));
vi.mock("@/components/charts/DailyHeatmap", () => ({ DailyHeatmap: stub("daily-heatmap") }));
vi.mock("@/components/charts/ReturnHistogram", () => ({ ReturnHistogram: stub("return-histogram") }));
vi.mock("@/components/charts/ReturnQuantiles", () => ({ ReturnQuantiles: stub("return-quantiles") }));
vi.mock("@/components/charts/YearlyReturns", () => ({ YearlyReturns: stub("yearly-returns") }));

import { RollingMetricsPanel } from "./RollingMetricsPanel";
import { ReturnsDistributionPanel } from "./ReturnsDistributionPanel";

const BANNER_HEADING = "Couldn’t load this section";
const BANNER_BODY = "Refresh the page to retry. The other panels still work.";

const SERIES = [
  { date: "2024-01-01", value: 0.5 },
  { date: "2024-01-02", value: 0.6 },
];
const ROLLING_METRICS = { sharpe_30d: SERIES, sharpe_90d: SERIES, sharpe_365d: SERIES };
const PANEL5_PAYLOAD = {
  rolling_volatility_6m: SERIES,
  rolling_sortino_6m: SERIES,
  rolling_alpha: SERIES,
  rolling_beta: SERIES,
};
const PANEL4_PAYLOAD = { daily_returns_grid: SERIES };
const MONTHLY = { "2023": { Jan: 0.02 }, "2024": { Jan: 0.04 } };
const QUANTILES = { Daily: [-0.05, -0.01, 0, 0.01, 0.05] };
const RETURNS = Array.from({ length: 30 }, (_, i) => ({
  date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
  value: 1 + i / 100,
}));

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "idle" };
});

/** The sub-section (the h3's wrapping div) a heading title belongs to. */
function sectionOf(container: HTMLElement, title: string): HTMLElement {
  const h3 = Array.from(container.querySelectorAll("h3")).find(
    (h) => h.textContent?.trim() === title,
  );
  if (!h3?.parentElement) throw new Error(`sub-section "${title}" missing`);
  return h3.parentElement;
}

const NOT_READY = ["idle", "loading", "error"] as const;

describe("RollingMetricsPanel: eager content survives every lazy status (R2-02)", () => {
  function renderRolling(historyDays = 365, rolling: typeof ROLLING_METRICS | null = ROLLING_METRICS) {
    return render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={historyDays}
        rolling_metrics={rolling}
        sharpe={1.2}
      />,
    );
  }

  it.each(NOT_READY)("status=%s: window toggle and Rolling Sharpe render, lazy charts do not", (status) => {
    mockHookReturn = { ref: () => {}, data: null, status };
    const { container, queryByTestId, getByRole } = renderRolling();

    expect(getByRole("group", { name: "Rolling window" })).toBeInTheDocument();
    expect(within(sectionOf(container, "Rolling Sharpe")).queryByTestId("rolling-sharpe")).not.toBeNull();
    for (const id of ["rolling-volatility", "rolling-sortino", "rolling-alpha-beta"]) {
      expect(queryByTestId(id)).toBeNull();
    }
  });

  it("status=error: exactly ONE banner (R3-02), outside every sub-section; eager Rolling Sharpe stays; the lazy sub-sections render nothing", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container, getAllByText, getByTestId } = renderRolling();

    // One failed fetch is one notice, not one per lazy sub-section.
    expect(getAllByText(BANNER_HEADING)).toHaveLength(1);
    expect(getAllByText(BANNER_BODY)).toHaveLength(1);
    // Eager Rolling Sharpe is still drawn, and the banner is not inside it.
    expect(getByTestId("rolling-sharpe")).toBeInTheDocument();
    expect(within(sectionOf(container, "Rolling Sharpe")).queryByText(BANNER_HEADING)).toBeNull();
    // The lazy sub-sections draw neither a heading nor a banner of their own.
    const headings = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent?.trim());
    for (const title of ["Rolling volatility", "Rolling Sortino", "Rolling alpha & beta"]) {
      expect(headings).not.toContain(title);
    }
    // The banner sits after Rolling Sharpe (start of the lazy part), not above the toggle.
    const sharpe = sectionOf(container, "Rolling Sharpe");
    const banner = getAllByText(BANNER_HEADING)[0];
    expect(sharpe.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A failed fetch must not borrow the say-why sentence for an absent series.
    expect(container.querySelector('[data-testid="rolling-alpha-beta-why"]')).toBeNull();
  });

  it.each(["idle", "loading"] as const)(
    "status=%s: 'Loading…' is inside the three lazy sub-sections only, never the banner",
    (status) => {
      mockHookReturn = { ref: () => {}, data: null, status };
      const { container, queryByText } = renderRolling();

      expect(queryByText(BANNER_HEADING)).toBeNull();
      expect(within(sectionOf(container, "Rolling Sharpe")).queryByText("Loading…")).toBeNull();
      for (const title of ["Rolling volatility", "Rolling Sortino", "Rolling alpha & beta"]) {
        expect(within(sectionOf(container, title)).getByText("Loading…")).toBeInTheDocument();
      }
    },
  );

  it("status=error with a window the history does not cover: the eager gate line still wins, and there is still exactly one banner", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    // 100 days >= the 90-day panel floor but < the default 6M (180-day) window.
    const { container, getAllByText } = renderRolling(100);

    for (const title of ["Rolling volatility", "Rolling Sortino"]) {
      const sub = within(sectionOf(container, title));
      expect(sub.getByText(/need ≥180 days for 6M rolling window/)).toBeInTheDocument();
      expect(sub.queryByText(BANNER_HEADING)).toBeNull();
    }
    expect(getAllByText(BANNER_HEADING)).toHaveLength(1);
  });

  it("status=error and no stored Sharpe series: the eager 'not yet computed' line renders instead of being hidden", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container } = renderRolling(365, null);

    expect(
      within(sectionOf(container, "Rolling Sharpe")).getByText(/Rolling Sharpe series not yet computed/),
    ).toBeInTheDocument();
  });

  it("status=ready: every chart renders and there is no banner and no loading text", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_PAYLOAD, status: "ready" };
    const { queryByTestId, queryByText } = renderRolling();

    for (const id of ["rolling-sharpe", "rolling-volatility", "rolling-sortino", "rolling-alpha-beta"]) {
      expect(queryByTestId(id)).not.toBeNull();
    }
    expect(queryByText(BANNER_HEADING)).toBeNull();
    expect(queryByText("Loading…")).toBeNull();
  });
});

describe("ReturnsDistributionPanel: eager content survives every lazy status (R2-02)", () => {
  function renderReturns(monthly: typeof MONTHLY | null = MONTHLY) {
    return render(
      <ReturnsDistributionPanel
        strategyId="s1"
        history_days={365}
        monthly_returns={monthly}
        return_quantiles={QUANTILES}
        returns_series={RETURNS}
      />,
    );
  }

  it.each(NOT_READY)("status=%s: monthly heatmap, histogram, quantiles and yearly returns render; daily heatmap does not", (status) => {
    mockHookReturn = { ref: () => {}, data: null, status };
    const { queryByTestId } = renderReturns();

    for (const id of ["monthly-heatmap", "return-histogram", "return-quantiles", "yearly-returns"]) {
      expect(queryByTestId(id)).not.toBeNull();
    }
    expect(queryByTestId("daily-heatmap")).toBeNull();
  });

  it("status=error: exactly one banner, inside the Daily heatmap sub-section", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container, getAllByText } = renderReturns();

    expect(getAllByText(BANNER_HEADING)).toHaveLength(1);
    const daily = within(sectionOf(container, "Daily heatmap"));
    expect(daily.getByText(BANNER_HEADING)).toBeInTheDocument();
    expect(daily.getByText(BANNER_BODY)).toBeInTheDocument();
    // The daily-heatmap EMPTY copy is a claim about the strategy; a failure must not use it.
    expect(container.textContent).not.toContain("Daily heatmap activates after 30 days");
  });

  it.each(["idle", "loading"] as const)("status=%s: 'Loading…' is inside the Daily heatmap sub-section only", (status) => {
    mockHookReturn = { ref: () => {}, data: null, status };
    const { container, getAllByText, queryByText } = renderReturns();

    expect(queryByText(BANNER_HEADING)).toBeNull();
    expect(getAllByText("Loading…")).toHaveLength(1);
    expect(within(sectionOf(container, "Daily heatmap")).getByText("Loading…")).toBeInTheDocument();
  });

  it("status=error: an eager sub-section's own absent-data line still renders (not swallowed by the banner)", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container } = renderReturns(null);

    expect(
      within(sectionOf(container, "Monthly heatmap")).getByText("Monthly heatmap unavailable for this strategy."),
    ).toBeInTheDocument();
  });

  it("status=ready: the daily heatmap renders and there is no banner", () => {
    mockHookReturn = { ref: () => {}, data: PANEL4_PAYLOAD, status: "ready" };
    const { queryByTestId, queryByText } = renderReturns();

    expect(queryByTestId("daily-heatmap")).not.toBeNull();
    expect(queryByText(BANNER_HEADING)).toBeNull();
  });
});
