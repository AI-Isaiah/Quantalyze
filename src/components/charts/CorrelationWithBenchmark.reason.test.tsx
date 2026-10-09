import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.5 plan 05 Task 3 (D-06, D-07 remainder) — the 90-day rolling BTC
 * correlation names its cause on v2.
 *
 * Today an absent `btc_rolling_correlation_90d` key reads the bare
 * "Benchmark correlation unavailable." in `text-sm`, with no cause. The
 * resolver gains an OPTIONAL context; without it every branch is unchanged
 * (v1 PerformanceReport). With it, an absent key or a 1-point series returns
 * the `btcCorrelationWhy` ladder (90 / 91 and the day count).
 *
 * The panel half runs the real resolver (the CorrelationWithBenchmark module
 * is mocked by spreading the actual module) and mocks only the chart.
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
vi.mock("./CorrelationWithBenchmark", async (importActual) => ({
  ...(await importActual<typeof import("./CorrelationWithBenchmark")>()),
  CorrelationWithBenchmark: () => <div data-testid="correlation-with-benchmark" />,
}));
vi.mock("@/components/strategy-v2/BenchmarkGreeksTable", () => ({
  BenchmarkGreeksTable: () => <div data-testid="benchmark-greeks-table" />,
}));
// The panel imports the chart through the alias; point it at the same mock.
vi.mock("@/components/charts/CorrelationWithBenchmark", async (importActual) => ({
  ...(await importActual<typeof import("./CorrelationWithBenchmark")>()),
  CorrelationWithBenchmark: () => <div data-testid="correlation-with-benchmark" />,
}));

import { resolveBenchmarkCorrelation } from "./CorrelationWithBenchmark";
import { ExposureAndGreeksPanel } from "@/components/strategy-v2/ExposureAndGreeksPanel";
import type { AnalyticsDataQualityFlags } from "@/lib/types";

const CTX = { historyDays: 72, nativeUnit: null, benchmarkUnavailable: false };
const SHORT =
  "Not enough history for the 90-day rolling correlation: needs 91 days paired with BTC; this strategy has 72 days of history.";

function analytics(metrics_json: Record<string, unknown>) {
  return { returns_series: null, metrics_json };
}

describe("resolveBenchmarkCorrelation with a context (D-07 remainder)", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it("absent key, short history -> the 90/91 sentence with the day count", () => {
    expect(
      resolveBenchmarkCorrelation({ ...analytics({}), context: CTX }),
    ).toEqual({ kind: "unavailable", message: SHORT });
  });

  it("benchmark_unavailable -> the unavailable-prices sentence", () => {
    expect(
      resolveBenchmarkCorrelation({
        ...analytics({}),
        context: { ...CTX, benchmarkUnavailable: true },
      }),
    ).toEqual({
      kind: "unavailable",
      message: "BTC benchmark prices were unavailable when this strategy was last computed.",
    });
  });

  it("native unit BTC -> not paired with BTC", () => {
    expect(
      resolveBenchmarkCorrelation({
        ...analytics({}),
        context: { ...CTX, nativeUnit: "BTC" },
      }),
    ).toEqual({ kind: "unavailable", message: "Not paired with BTC: returns are in BTC." });
  });

  it("long history and no flag -> not computed for this strategy", () => {
    expect(
      resolveBenchmarkCorrelation({
        ...analytics({}),
        context: { ...CTX, historyDays: 400 },
      }),
    ).toEqual({
      kind: "unavailable",
      message: "Rolling correlation with BTC is not computed for this strategy.",
    });
  });

  it("a well-formed 1-point series -> the ladder message, not kind ok", () => {
    const r = resolveBenchmarkCorrelation({
      ...analytics({ btc_rolling_correlation_90d: [{ date: "2026-01-01", value: 0.4 }] }),
      context: CTX,
    });
    expect(r).toEqual({ kind: "unavailable", message: SHORT });
  });

  it("a well-formed 2-point series is ok", () => {
    const series = [
      { date: "2026-01-01", value: 0.4 },
      { date: "2026-01-02", value: 0.5 },
    ];
    expect(
      resolveBenchmarkCorrelation({
        ...analytics({ btc_rolling_correlation_90d: series }),
        context: CTX,
      }),
    ).toEqual({ kind: "ok", series });
  });

  it("the [] branch keeps the 250-day insufficient message even with a context", () => {
    const r = resolveBenchmarkCorrelation({
      returns_series: [
        { date: "2026-01-01", value: 1 },
        { date: "2026-01-02", value: 1.01 },
      ],
      metrics_json: { btc_rolling_correlation_90d: [] },
      context: CTX,
    });
    expect(r.kind).toBe("insufficient");
    expect((r as { message: string }).message).toContain("250");
  });

  it("without a context an absent key still reads the bare sentence (v1 unchanged)", () => {
    expect(resolveBenchmarkCorrelation(analytics({}))).toEqual({
      kind: "unavailable",
      message: "Benchmark correlation unavailable.",
    });
  });
});

describe("ExposureAndGreeksPanel Correlation with BTC (v2)", () => {
  const GREEKS = { alpha: 0.05, beta: 1.2, ir: 0.8, treynor: 0.04 };
  function renderPanel(
    metrics_json: Record<string, unknown>,
    history_days: number,
    flags?: AnalyticsDataQualityFlags | null,
  ) {
    mockHookReturn = { ref: () => {}, data: {}, status: "ready" };
    return render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={history_days}
        benchmark_greeks={GREEKS}
        correlation_analytics={analytics(metrics_json)}
        data_quality_flags={flags}
      />,
    );
  }
  const CAPTION =
    "90-day rolling window, paired with BTC. The full-record correlation is in Benchmark greeks.";

  it("absent key at 72 days: a 240px say-why block with the 72-day sentence; the chart is not mounted", () => {
    const { container, queryByTestId } = renderPanel({}, 72);
    const why = queryByTestId("correlation-why");
    expect(why).not.toBeNull();
    expect(why!.style.minHeight).toBe("240px");
    expect(why!.textContent).toBe(SHORT);
    expect(queryByTestId("correlation-with-benchmark")).toBeNull();
    expect(container.textContent).toContain(CAPTION);
    expect(why!.querySelector("p")!.className).toBe("text-xs font-normal text-text-muted");
    expect(container.innerHTML).not.toMatch(/\btext-sm\b/);
  });

  it("a 2-point series mounts the chart and shows the caption", () => {
    const { container, queryByTestId } = renderPanel(
      {
        btc_rolling_correlation_90d: [
          { date: "2026-01-01", value: 0.4 },
          { date: "2026-01-02", value: 0.5 },
        ],
      },
      365,
    );
    expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
    expect(queryByTestId("correlation-why")).toBeNull();
    expect(container.textContent).toContain(CAPTION);
  });

  it("benchmark_unavailable flag names the cause", () => {
    const { queryByTestId } = renderPanel({}, 365, { benchmark_unavailable: true });
    expect(queryByTestId("correlation-why")!.textContent).toBe(
      "BTC benchmark prices were unavailable when this strategy was last computed.",
    );
  });

  it("the native_unit flag is parsed before it reaches visible text", () => {
    const { queryByTestId } = renderPanel({}, 365, {
      native_unit: "<b>x</b>",
    } as AnalyticsDataQualityFlags);
    expect(queryByTestId("correlation-why")!.textContent).toBe(
      "Rolling correlation with BTC is not computed for this strategy.",
    );
  });

  it("the say-why block is neither focusable nor live", () => {
    const { queryByTestId } = renderPanel({}, 72);
    const why = queryByTestId("correlation-why")!;
    for (const el of [why, why.querySelector("p")!]) {
      expect(el.hasAttribute("tabindex")).toBe(false);
      expect(el.hasAttribute("aria-live")).toBe(false);
    }
  });
});
