import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.5 plan 05 Task 2 (D-03, D-06) — Net & gross exposure draws every
 * valid series, dates it, and otherwise names one cause.
 *
 * Fixture values are the producer's: USD notional summed from position
 * snapshots (`position_reconstruction.py`, `gross += abs(size_usd)`), and a
 * CSV-sourced strategy that nevertheless holds a position-reconstructed series
 * (strategy B on PROD). The pre-170.5 panel guarded only `length > 0`.
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

let lastNetGrossData: unknown = null;
vi.mock("@/components/charts/NetGrossExposureChart", () => ({
  NetGrossExposureChart: ({ data }: { data: unknown }) => {
    lastNetGrossData = data;
    return <div data-testid="net-gross-chart" />;
  },
}));

vi.mock("@/components/charts/TurnoverChart", () => ({
  TurnoverChart: () => <div data-testid="turnover-chart" />,
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

const USD_POINTS = [
  { date: "2026-05-27", gross: 53505.06, net: 53505.06 },
  { date: "2026-06-01", gross: 18164.46, net: -48544.8 },
];

const FEW = "Net and gross exposure isn’t available for this strategy: the stored series has fewer than 2 valid points.";
const CSV = "Net and gross exposure isn’t available for this strategy: it was uploaded as a CSV file, and no position-level series is stored for it.";
const ABSENT = "Net and gross exposure isn’t available for this strategy: no position-snapshot exposure series is stored for it.";

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

function exposureSection(container: HTMLElement): HTMLElement {
  const h3 = Array.from(container.querySelectorAll("h3")).find(
    (h) => h.textContent === "Net & gross exposure",
  );
  expect(h3).toBeDefined();
  return h3!.parentElement as HTMLElement;
}

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "ready" };
  lastNetGrossData = null;
});

describe("ExposureAndGreeksPanel Net & gross exposure (D-03)", () => {
  it("two USD points on a csv_source strategy draw exactly those points with the through-date caption", () => {
    const { queryByTestId, container } = renderPanel(
      { exposure_series: USD_POINTS },
      { csv_source: true },
    );
    expect(queryByTestId("net-gross-chart")).not.toBeNull();
    expect(lastNetGrossData).toEqual(USD_POINTS);
    expect(exposureSection(container).textContent).toContain(
      "USD notional, from position snapshots through 2026-06-01.",
    );
  });

  it("the caption names the LATEST kept date, not the last array position", () => {
    const { container } = renderPanel({
      exposure_series: [
        { date: "2026-06-01", gross: 2, net: 1 },
        { date: "2026-05-27", gross: 1, net: 1 },
      ],
    });
    expect(exposureSection(container).textContent).toContain("through 2026-06-01.");
  });

  it("one valid point plus one {date: 7} point says fewer than 2 valid points and renders no caption", () => {
    const { queryByTestId, container } = renderPanel({
      exposure_series: [
        { date: "2026-05-27", gross: 1, net: 1 },
        { date: 7, gross: 1, net: 1 },
      ],
    });
    expect(queryByTestId("net-gross-chart")).toBeNull();
    const text = exposureSection(container).textContent ?? "";
    expect(text).toContain(FEW);
    expect(text).not.toContain("USD notional");
  });

  it("a NaN gross on one of two points leaves one valid point and says why", () => {
    const { queryByTestId, container } = renderPanel({
      exposure_series: [
        { date: "2026-05-27", gross: 1, net: 1 },
        { date: "2026-05-28", gross: Number.NaN, net: 1 },
      ],
    });
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(exposureSection(container).textContent).toContain(FEW);
  });

  it("absent exposure and turnover on a CSV upload says the CSV sentence", () => {
    const { container } = renderPanel({}, { csv_source: true });
    expect(exposureSection(container).textContent).toContain(CSV);
  });

  it("absent with no flags says no position-snapshot exposure series is stored", () => {
    const { container } = renderPanel({}, null);
    expect(exposureSection(container).textContent).toContain(ABSENT);
  });

  it("the caption and the reason carry the 12px caption token and no tabindex or aria-live", () => {
    const drawn = renderPanel({ exposure_series: USD_POINTS });
    const caption = exposureSection(drawn.container).querySelector("p");
    expect(caption).not.toBeNull();
    for (const el of [caption!]) {
      expect(el.className).toContain("text-xs");
      expect(el.className).toContain("font-normal");
      expect(el.className).toContain("text-text-muted");
      expect(el.hasAttribute("tabindex")).toBe(false);
      expect(el.hasAttribute("aria-live")).toBe(false);
    }
    drawn.unmount();
    const said = renderPanel({}, null);
    const reason = exposureSection(said.container).querySelector("p");
    expect(reason!.className).toContain("text-xs font-normal text-text-muted");
    expect(reason!.hasAttribute("tabindex")).toBe(false);
    expect(reason!.hasAttribute("aria-live")).toBe(false);
  });
});
