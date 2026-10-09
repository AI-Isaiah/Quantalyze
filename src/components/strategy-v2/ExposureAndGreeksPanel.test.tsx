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
// 2026-10-09 Phase 170.5-05: the panel now calls the REAL resolver itself, so the
// module mock spreads the actual exports and replaces only the chart component.
vi.mock("@/components/charts/CorrelationWithBenchmark", async (importActual) => ({
  ...(await importActual<typeof import("@/components/charts/CorrelationWithBenchmark")>()),
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

// 2026-10-09 Phase 170.5 (D-03): producer writes USD notional
const SAMPLE_EXPOSURE = [
  { date: "2024-01-01", gross: 53505.06, net: 53505.06 },
  { date: "2024-01-02", gross: 18164.46, net: -48544.8 },
];
const SAMPLE_TURNOVER = [
  { date: "2024-01-01", value: 0.21 },
  { date: "2024-01-02", value: 0.19 },
];
const SAMPLE_GREEKS = {
  alpha: 0.05,
  beta: 1.2,
  // 2026-10-09 Phase 170.5 (D-07): the fifth figure
  correlation: 0.4,
  ir: 0.8,
  treynor: 0.04,
};
const SAMPLE_CORRELATION_ANALYTICS = {
  returns_series: [
    { date: "2024-01-01", value: 1.0 },
    { date: "2024-01-02", value: 1.01 },
  ],
  // 2026-10-09 Phase 170.5-05: the panel mounts the chart only for a resolved
  // 2-point series, so the fixture carries the producer key (metrics.py).
  metrics_json: {
    benchmark_returns: [],
    btc_rolling_correlation_90d: [
      { date: "2024-01-01", value: 0.4 },
      { date: "2024-01-02", value: 0.5 },
    ],
  },
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

  it("Test 6: panel-level partial data when history_days < 30 (exposure and turnover only; greeks are not gated, 170.5 WR-01; correlation is not gated, 170.5 R2-03)", () => {
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
      "This strategy needs at least 30 days of trading history to compute exposure and turnover.",
    );
    // The 30-day gate replaces the lazy sub-sections only
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(queryByTestId("turnover-chart")).toBeNull();
    // 170.5 R2-03: correlation reads eager props (its resolver is given history_days
    // and names a short history itself), so the exposure gate leaves it. This
    // assertion was `toBeNull()` and encoded the gate swallowing it.
    expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
    // 170.5 WR-01: the greeks come from the factsheet's joint (10-day floor), so the gate leaves them
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
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
        benchmark_joint={{ kind: "computed", paired: 120, flatLeg: false }}
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
    // 2026-10-09 Phase 170.5 (D-07): five live figures plus the reason line
    expect(lastBenchmarkGreeksProps).toEqual({
      alpha: SAMPLE_GREEKS.alpha,
      beta: SAMPLE_GREEKS.beta,
      correlation: SAMPLE_GREEKS.correlation,
      ir: SAMPLE_GREEKS.ir,
      treynor: SAMPLE_GREEKS.treynor,
      reason: null,
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
    // 2026-10-09 Phase 170.5 (D-03, D-04): reason by cause
    expect(container.textContent).toContain(
      "Net and gross exposure isn’t available for this strategy: no position-snapshot exposure series is stored for it.",
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
    // 2026-10-09 Phase 170.5 (D-03, D-04): reason by cause
    expect(container.textContent).toContain(
      "Turnover isn’t available for this strategy: no turnover series is computed for it.",
    );
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
    // 2026-10-09 Phase 170.5 (D-03, D-04): reason by cause
    expect(container.textContent).toContain(
      "Net and gross exposure isn’t available for this strategy: no position-snapshot exposure series is stored for it.",
    );
    expect(container.textContent).toContain(
      "Turnover isn’t available for this strategy: no turnover series is computed for it.",
    );
    // Correlation + Greeks still render — they do not depend on lazy data
    expect(queryByTestId("correlation-with-benchmark")).not.toBeNull();
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
  });

  it("Test 9a: status='loading' → centered Loading…; lazy sub-components absent, greeks (eager) render", () => {
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
    // 170.5 WR-02: nothing is loading for the greeks, they are already in the props
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
  });

  it("Test 9b: status='error' → error PartialDataBanner on the lazy part; greeks (eager) still render", () => {
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
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
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
