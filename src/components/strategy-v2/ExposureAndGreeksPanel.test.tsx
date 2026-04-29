import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Phase 14b-05 Task 2 — ExposureAndGreeksPanel (Panel 7) wrapper tests.
 *
 * 11 acceptance criteria covering chrome, panel-level partial-data,
 * lazy lifecycle, all 4 sub-sections (Net&Gross / Turnover / Correlation /
 * Greeks), per-sub-section empty fallbacks, and the lazy-hook contract
 * (panelId='panel7', fetchOnIntersect=true).
 *
 * Strategy:
 *   - Mock useLazyPanelMetrics so each test drives status + data + spies opts
 *   - Mock all 4 sub-components so the test asserts on routing/composition,
 *     not paint
 */

interface HookReturn {
  ref: (n: HTMLElement | null) => void;
  data: {
    exposure_series?: { date: string; gross: number; net: number }[];
    turnover_series?: { date: string; value: number }[];
  } | null;
  status: "idle" | "loading" | "ready" | "error";
}

let mockHookReturn: HookReturn = {
  ref: () => {},
  data: null,
  status: "idle",
};
let lastHookArgs: { panelId: string; opts: Record<string, unknown> } = {
  panelId: "",
  opts: {},
};

vi.mock("@/hooks/useLazyPanelMetrics", () => ({
  useLazyPanelMetrics: (panelId: string, opts: Record<string, unknown>) => {
    lastHookArgs = { panelId, opts: opts ?? {} };
    return mockHookReturn;
  },
}));

let lastNetGrossData: unknown = null;
vi.mock("@/components/charts/NetGrossExposureChart", () => ({
  NetGrossExposureChart: ({ data }: { data: unknown }) => {
    lastNetGrossData = data;
    return <div data-testid="net-gross-chart" />;
  },
}));

let lastTurnoverData: unknown = null;
vi.mock("@/components/charts/TurnoverChart", () => ({
  TurnoverChart: ({ data }: { data: unknown }) => {
    lastTurnoverData = data;
    return <div data-testid="turnover-chart" />;
  },
}));

let lastCorrelationAnalytics: unknown = null;
vi.mock("@/components/charts/CorrelationWithBenchmark", () => ({
  CorrelationWithBenchmark: ({ analytics }: { analytics: unknown }) => {
    lastCorrelationAnalytics = analytics;
    return <div data-testid="correlation-with-benchmark" />;
  },
}));

let lastBenchmarkGreeksProps: Record<string, unknown> = {};
vi.mock("./BenchmarkGreeksTable", () => ({
  BenchmarkGreeksTable: (props: Record<string, unknown>) => {
    lastBenchmarkGreeksProps = props;
    return <div data-testid="benchmark-greeks-table" />;
  },
}));

import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";

const SAMPLE_EXPOSURE = [
  { date: "2024-01-01", gross: 0.8, net: 0.5 },
  { date: "2024-01-02", gross: 0.85, net: 0.4 },
];
const SAMPLE_TURNOVER = [
  { date: "2024-01-01", value: 0.21 },
  { date: "2024-01-02", value: 0.19 },
];
const SAMPLE_GREEKS = {
  alpha: 0.05,
  beta: 1.2,
  ir: 0.8,
  treynor: 0.04,
};
const SAMPLE_CORRELATION_ANALYTICS = {
  returns_series: [
    { date: "2024-01-01", value: 1.0 },
    { date: "2024-01-02", value: 1.01 },
  ],
  metrics_json: { benchmark_returns: [] },
};

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "idle" };
  lastHookArgs = { panelId: "", opts: {} };
  lastNetGrossData = null;
  lastTurnoverData = null;
  lastCorrelationAnalytics = null;
  lastBenchmarkGreeksProps = {};
});

describe("ExposureAndGreeksPanel — Phase 14b-05 Task 2", () => {
  it("Test 5: chrome — section[data-panel='exposure'] with 14a chrome classes + aria-label", () => {
    const { container } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    const section = container.querySelector('section[data-panel="exposure"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-label")).toBe(
      "Exposure & benchmark greeks",
    );
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

  it("Test 6: panel-level partial data when history_days < 30", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "ready" };
    const { container, queryByTestId } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={20}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    const banner = container.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Awaiting more data");
    expect(banner?.textContent).toContain(
      "This strategy needs at least 30 days of trading history to compute exposure and benchmark greeks.",
    );
    // No sub-components rendered
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(queryByTestId("turnover-chart")).toBeNull();
    expect(queryByTestId("correlation-with-benchmark")).toBeNull();
    expect(queryByTestId("benchmark-greeks-table")).toBeNull();
  });

  it("Test 7: ready full — 4 sub-sections render in order with verbatim H3 titles", () => {
    mockHookReturn = {
      ref: () => {},
      data: {
        exposure_series: SAMPLE_EXPOSURE,
        turnover_series: SAMPLE_TURNOVER,
      },
      status: "ready",
    };
    const { container } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    // 4 H3s in order
    const h3s = container.querySelectorAll("h3");
    const h3Texts = Array.from(h3s).map((h) => h.textContent);
    expect(h3Texts).toEqual([
      "Net & gross exposure",
      "Turnover",
      "Correlation with BTC",
      "Benchmark greeks",
    ]);
    // All 4 sub-components mounted
    expect(screen.getByTestId("net-gross-chart")).not.toBeNull();
    expect(screen.getByTestId("turnover-chart")).not.toBeNull();
    expect(screen.getByTestId("correlation-with-benchmark")).not.toBeNull();
    expect(screen.getByTestId("benchmark-greeks-table")).not.toBeNull();
    // Data routed correctly
    expect(lastNetGrossData).toEqual(SAMPLE_EXPOSURE);
    expect(lastTurnoverData).toEqual(SAMPLE_TURNOVER);
    expect(lastCorrelationAnalytics).toEqual(SAMPLE_CORRELATION_ANALYTICS);
    expect(lastBenchmarkGreeksProps).toEqual({
      alpha: SAMPLE_GREEKS.alpha,
      beta: SAMPLE_GREEKS.beta,
      ir: SAMPLE_GREEKS.ir,
      treynor: SAMPLE_GREEKS.treynor,
    });
  });

  it("Test 8a: empty exposure_series → SubBanner replaces NetGross only; other sections unaffected", () => {
    mockHookReturn = {
      ref: () => {},
      data: {
        exposure_series: [],
        turnover_series: SAMPLE_TURNOVER,
      },
      status: "ready",
    };
    const { container, queryByTestId } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(container.textContent).toContain(
      "Net & gross exposure unavailable for this strategy.",
    );
    // Other 3 sub-sections still render
    expect(queryByTestId("turnover-chart")).not.toBeNull();
    expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
  });

  it("Test 8b: empty turnover_series → SubBanner replaces Turnover only", () => {
    mockHookReturn = {
      ref: () => {},
      data: {
        exposure_series: SAMPLE_EXPOSURE,
        turnover_series: [],
      },
      status: "ready",
    };
    const { container, queryByTestId } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    expect(queryByTestId("turnover-chart")).toBeNull();
    expect(container.textContent).toContain("Turnover unavailable for this strategy.");
    expect(queryByTestId("net-gross-chart")).not.toBeNull();
  });

  it("Test 8c: data === null at ready → both NetGross + Turnover sub-banners render", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "ready" };
    const { container, queryByTestId } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(queryByTestId("turnover-chart")).toBeNull();
    expect(container.textContent).toContain("Net & gross exposure unavailable");
    expect(container.textContent).toContain("Turnover unavailable");
    // Correlation + Greeks still render — they do not depend on lazy data
    expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
  });

  it("Test 9a: status='loading' → centered Loading…; no sub-components", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "loading" };
    const { container, queryByTestId } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    expect(container.textContent).toContain("Loading");
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(queryByTestId("benchmark-greeks-table")).toBeNull();
  });

  it("Test 9b: status='error' → error PartialDataBanner; no sub-components", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container, queryByTestId } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    const banner = container.querySelector('[role="status"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Couldn");
    expect(queryByTestId("net-gross-chart")).toBeNull();
  });

  it("Test 10: no forbidden type-scale classes in rendered output", () => {
    mockHookReturn = {
      ref: () => {},
      data: {
        exposure_series: SAMPLE_EXPOSURE,
        turnover_series: SAMPLE_TURNOVER,
      },
      status: "ready",
    };
    const { container } = render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bfont-medium\b/);
    expect(html).not.toMatch(/\btext-sm\b/);
    expect(html).not.toMatch(/\btext-xl\b/);
    expect(html).not.toMatch(/\btext-2xl\b/);
  });

  it("Test 11: useLazyPanelMetrics called with panelId='panel7' + fetchOnIntersect=true + strategyId", () => {
    render(
      <ExposureAndGreeksPanel
        strategyId="s1"
        history_days={365}
        benchmark_greeks={SAMPLE_GREEKS}
        correlation_analytics={SAMPLE_CORRELATION_ANALYTICS}
      />,
    );
    expect(lastHookArgs.panelId).toBe("panel7");
    expect(lastHookArgs.opts.fetchOnIntersect).toBe(true);
    expect(lastHookArgs.opts.strategyId).toBe("s1");
  });
});
