import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.5 plan 05 Task 2 (D-04, D-06) — Turnover says why, never empty.
 *
 * The stored turnover rows are `{date, turnover}` (price-scaled, no writer
 * since Phase 106 Stage B) while TurnoverChart plots `value`. Before 170.5 the
 * panel mounted the chart on `length > 0`, so it drew a blank chart for every
 * current strategy. These tests fail on that code and pass on the gate.
 *
 * The data shapes below are the producer's (`position_reconstruction.py`
 * writes `{"date": ..., "turnover": ...}`), not invented ones.
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

let lastTurnoverData: unknown = null;
vi.mock("@/components/charts/TurnoverChart", () => ({
  TurnoverChart: ({ data }: { data: unknown }) => {
    lastTurnoverData = data;
    return <div data-testid="turnover-chart" />;
  },
}));

// The panel calls the real resolver; only the chart component is replaced.
vi.mock("@/components/charts/CorrelationWithBenchmark", async (importActual) => ({
  ...(await importActual<typeof import("@/components/charts/CorrelationWithBenchmark")>()),
  CorrelationWithBenchmark: () => <div data-testid="correlation-with-benchmark" />,
}));

vi.mock("./BenchmarkGreeksTable", () => ({
  BenchmarkGreeksTable: () => <div data-testid="benchmark-greeks-table" />,
}));

import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";
import type { AnalyticsDataQualityFlags } from "@/lib/types";

const GREEKS = { alpha: 0.05, beta: 1.2, ir: 0.8, treynor: 0.04 };
const ANALYTICS = { returns_series: null, metrics_json: {} };

const LEGACY = "Turnover isn’t available for this strategy: the stored turnover figures are not on a percent-of-NAV scale, so they are not shown.";
const FEW = "Turnover isn’t available for this strategy: the stored series has fewer than 2 valid points.";
const CSV = "Turnover isn’t available for this strategy: it was uploaded as a CSV file, and no position-level series is stored for it.";
const ABSENT = "Turnover isn’t available for this strategy: no turnover series is computed for it.";

function renderPanel(
  data: HookReturn["data"],
  flags?: AnalyticsDataQualityFlags | null,
) {
  mockHookReturn = { ref: () => {}, data, status: "ready" };
  return render(
    <ExposureAndGreeksPanel
      strategyId="s1"
      history_days={365}
      benchmark_greeks={GREEKS}
      correlation_analytics={ANALYTICS}
      data_quality_flags={flags}
    />,
  );
}

function turnoverSection(container: HTMLElement): HTMLElement {
  const h3 = Array.from(container.querySelectorAll("h3")).find(
    (h) => h.textContent === "Turnover",
  );
  expect(h3).toBeDefined();
  return h3!.parentElement as HTMLElement;
}

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "ready" };
  lastTurnoverData = null;
});

describe("ExposureAndGreeksPanel Turnover (D-04)", () => {
  it("legacy {date, turnover} rows do not mount the chart; the scale sentence shows (strategy B shape)", () => {
    const { queryByTestId, container } = renderPanel(
      {
        exposure_series: [],
        turnover_series: [{ date: "2026-05-27", turnover: 4210.44 }],
      },
      { csv_source: true },
    );
    expect(queryByTestId("turnover-chart")).toBeNull();
    expect(turnoverSection(container).textContent).toContain(LEGACY);
  });

  it("two {date, value} points mount the chart with exactly those points", () => {
    const points = [
      { date: "2026-05-27", value: 0.2 },
      { date: "2026-05-28", value: 0.1 },
    ];
    const { queryByTestId } = renderPanel({ turnover_series: points });
    expect(queryByTestId("turnover-chart")).not.toBeNull();
    expect(lastTurnoverData).toEqual(points);
  });

  it("two valid plus one malformed entry mount the chart with the two valid points", () => {
    const { queryByTestId } = renderPanel({
      turnover_series: [
        { date: "2026-05-27", value: 0.2 },
        { date: "2026-05-28", value: 0.1 },
        { date: 3, value: "x" },
      ],
    });
    expect(queryByTestId("turnover-chart")).not.toBeNull();
    expect(lastTurnoverData).toEqual([
      { date: "2026-05-27", value: 0.2 },
      { date: "2026-05-28", value: 0.1 },
    ]);
  });

  it("a legacy row beside two valid rows draws the valid rows only", () => {
    renderPanel({
      turnover_series: [
        { date: "2026-05-26", turnover: 4210.44 },
        { date: "2026-05-27", value: 0.2 },
        { date: "2026-05-28", value: 0.1 },
      ],
    });
    expect(lastTurnoverData).toEqual([
      { date: "2026-05-27", value: 0.2 },
      { date: "2026-05-28", value: 0.1 },
    ]);
  });

  it("one {date, value} point says fewer than 2 valid points", () => {
    const { queryByTestId, container } = renderPanel({
      turnover_series: [{ date: "2026-05-27", value: 0.2 }],
    });
    expect(queryByTestId("turnover-chart")).toBeNull();
    expect(turnoverSection(container).textContent).toContain(FEW);
  });

  it("absent turnover and exposure on a CSV upload says the CSV sentence", () => {
    const { container } = renderPanel({}, { csv_source: true });
    expect(turnoverSection(container).textContent).toContain(CSV);
  });

  it("absent with no flags says no turnover series is computed", () => {
    const { container } = renderPanel({}, null);
    expect(turnoverSection(container).textContent).toContain(ABSENT);
  });

  it("the reason element is 12px caption token and not focusable or live", () => {
    const { container } = renderPanel({}, null);
    const p = turnoverSection(container).querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toContain("text-xs");
    expect(p!.className).toContain("font-normal");
    expect(p!.className).toContain("text-text-muted");
    expect(p!.hasAttribute("tabindex")).toBe(false);
    expect(p!.hasAttribute("aria-live")).toBe(false);
  });
});
