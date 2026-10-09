import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, within } from "@testing-library/react";

/**
 * Phase 170.5 R2-03 - "Correlation with BTC" is resolved from EAGER props
 * (`correlation_analytics`, `data_quality_flags`, `history_days`), so it renders
 * under the 30-day exposure gate and under every lazy panel7 status, exactly as
 * the benchmark greeks do (WR-01 / WR-02). Only exposure and turnover read the
 * lazy payload.
 *
 * Before the fix the sub-section sat inside the `history_days >= 30` gate and
 * inside the lazy ready-branch: a 25-day strategy, or one whose lazy fetch was
 * loading or had failed, lost a figure that needed neither.
 */

interface HookReturn {
  ref: (n: HTMLElement | null) => void;
  data: { exposure_series?: unknown; turnover_series?: unknown } | null;
  status: "idle" | "loading" | "ready" | "error";
}
let mockHookReturn: HookReturn = { ref: () => {}, data: null, status: "ready" };
vi.mock("@/hooks/useLazyPanelMetrics", () => ({
  useLazyPanelMetrics: () => mockHookReturn,
}));
vi.mock("@/components/charts/NetGrossExposureChart", () => ({
  NetGrossExposureChart: () => <div data-testid="net-gross-chart" />,
}));
vi.mock("@/components/charts/TurnoverChart", () => ({
  TurnoverChart: () => <div data-testid="turnover-chart" />,
}));
vi.mock("@/components/charts/CorrelationWithBenchmark", async (importActual) => ({
  ...(await importActual<typeof import("@/components/charts/CorrelationWithBenchmark")>()),
  CorrelationWithBenchmark: () => <div data-testid="correlation-with-benchmark" />,
}));
vi.mock("./BenchmarkGreeksTable", () => ({
  BenchmarkGreeksTable: () => <div data-testid="benchmark-greeks-table" />,
}));

import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";

const GREEKS = { alpha: 0.05, beta: 1.2, correlation: 0.4, ir: 0.8, treynor: 0.04 };
const WITH_SERIES = {
  returns_series: [
    { date: "2024-01-01", value: 1.0 },
    { date: "2024-01-02", value: 1.01 },
  ],
  metrics_json: {
    btc_rolling_correlation_90d: [
      { date: "2024-01-01", value: 0.4 },
      { date: "2024-01-02", value: 0.5 },
    ],
  },
};
const WITHOUT_SERIES = { returns_series: null, metrics_json: {} };
const BANNER_HEADING = "Couldn’t load this section";

function renderPanel(
  historyDays: number,
  analytics: typeof WITH_SERIES | typeof WITHOUT_SERIES = WITH_SERIES,
) {
  return render(
    <ExposureAndGreeksPanel
      strategyId="s1"
      history_days={historyDays}
      benchmark_greeks={GREEKS}
      correlation_analytics={analytics}
    />,
  );
}

function correlationSection(container: HTMLElement): HTMLElement {
  const h3 = Array.from(container.querySelectorAll("h3")).find(
    (h) => h.textContent === "Correlation with BTC",
  );
  expect(h3).toBeDefined();
  return h3!.parentElement as HTMLElement;
}

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "ready" };
});

describe("ExposureAndGreeksPanel: Correlation with BTC is eager (R2-03)", () => {
  it("renders at history_days 25 (below the 30-day exposure gate) while the gate still holds exposure and turnover", () => {
    const { container, queryByTestId } = renderPanel(25);

    expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
    expect(container.textContent).toContain(
      "This strategy needs at least 30 days of trading history to compute exposure and turnover.",
    );
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(queryByTestId("turnover-chart")).toBeNull();
  });

  it("at history_days 25 with no stored series it names the short history in its own reason line", () => {
    const { container } = renderPanel(25, WITHOUT_SERIES);

    const why = within(correlationSection(container)).getByTestId("correlation-why");
    expect(why.textContent).toContain("Not enough history for the 90-day rolling correlation");
    expect(why.textContent).toContain("this strategy has 25 days of history");
  });

  it.each(["idle", "loading", "error"] as const)(
    "lazy status=%s: correlation renders, and the lazy banner never lands inside it",
    (status) => {
      mockHookReturn = { ref: () => {}, data: null, status };
      const { container, queryByTestId } = renderPanel(365);

      expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
      expect(within(correlationSection(container)).queryByText(BANNER_HEADING)).toBeNull();
      expect(within(correlationSection(container)).queryByText("Loading…")).toBeNull();
      // The lazy-dependent part still waits / fails, so the fix did not un-gate it.
      expect(queryByTestId("net-gross-chart")).toBeNull();
      expect(queryByTestId("turnover-chart")).toBeNull();
    },
  );

  it("lazy status=error with no stored series shows the correlation's own reason, not the lazy banner", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container, getAllByText } = renderPanel(365, WITHOUT_SERIES);

    expect(getAllByText(BANNER_HEADING)).toHaveLength(1); // the exposure/turnover banner only
    const why = within(correlationSection(container)).getByTestId("correlation-why");
    expect(why.textContent).toContain("Rolling correlation with BTC is not computed for this strategy.");
  });

  it("keeps the section order: exposure, turnover, correlation, greeks", () => {
    mockHookReturn = {
      ref: () => {},
      data: {
        exposure_series: [
          { date: "2024-01-01", gross: 1, net: 0.5 },
          { date: "2024-01-02", gross: 1, net: 0.5 },
        ],
        turnover_series: [
          { date: "2024-01-01", value: 0.1 },
          { date: "2024-01-02", value: 0.2 },
        ],
      },
      status: "ready",
    };
    const { container } = renderPanel(365);

    const titles = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titles).toEqual([
      "Net & gross exposure",
      "Turnover",
      "Correlation with BTC",
      "Benchmark greeks",
    ]);
  });
});
