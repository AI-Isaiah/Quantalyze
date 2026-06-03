import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

/**
 * Phase 14b-06 Task 3 — HeadlineMetricsPanel (Panel 2) segmented-control
 * unlock + Log returns lazy fetch tests.
 *
 * Coverage (10 acceptance criteria):
 *   1. 4 buttons all enabled (no aria-disabled)
 *   2. Default Cumulative — EquityCurve renders cumulative series
 *   3. Rolling Sharpe view → RollingMetrics with rolling_metrics + sharpe avg
 *   4. Log returns view → fetchStrategyLazyMetricsClient(id, "equity") fires once
 *   5. Props extension — strategyId + rolling_metrics required
 *   6. No regression — KPI strip + BTC checkbox + partial-data banners intact
 *   7. Forbidden classes — no font-medium / text-sm etc.
 *   8. Grok B-03 — exact equity-fetch invocation + cache-on-toggle
 *   9. Grok B-03 — empty payload graceful fallback (PartialDataBanner)
 *  10. Grok B-03 — fetch error path (PartialDataBanner)
 *
 * IMPORTANT: this panel uses `fetchStrategyLazyMetricsClient` from
 * `@/lib/queries-client` (the client-safe mirror created in Plan 14b-01)
 * — NOT `fetchStrategyLazyMetrics` from `@/lib/queries` (server-only,
 * blocked by Turbopack inside any "use client" module graph). The plan
 * 14b-06 Task 3 originally specified the server-side function; the
 * Wave-3 executor honored the constraint via Rule-3 deviation since
 * importing the server-only path from a client component breaks the build.
 */

// Mock chart libs that don't render under jsdom.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});
vi.mock("lightweight-charts", () => ({
  LineSeries: "LineSeries",
  createChart: () => ({
    addSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addAreaSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addLineSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    removeSeries: () => {},
    timeScale: () => ({ fitContent: () => {}, applyOptions: () => {} }),
    applyOptions: () => {},
    resize: () => {},
    remove: () => {},
    subscribeCrosshairMove: () => {},
    unsubscribeCrosshairMove: () => {},
  }),
}));

// Mock EquityCurve / DrawdownChart / RollingMetrics so we can inspect
// the props passed without invoking the real chart implementations.
let lastEquityCurveProps: {
  data?: { date: string; value: number }[];
  benchmarkSeries?: unknown;
  hideBenchmarkToggle?: boolean;
  // monotonically increasing per render so tests can detect remounts
  __renderId?: number;
} = {};
let equityCurveRenderCount = 0;
vi.mock("@/components/charts/EquityCurve", () => ({
  EquityCurve: (props: {
    data: { date: string; value: number }[];
    benchmarkSeries?: unknown;
    hideBenchmarkToggle?: boolean;
  }) => {
    equityCurveRenderCount++;
    lastEquityCurveProps = { ...props, __renderId: equityCurveRenderCount };
    return (
      <div
        data-testid="equity-curve"
        data-len={props.data.length}
        data-first-date={props.data[0]?.date ?? ""}
      />
    );
  },
}));

vi.mock("@/components/charts/DrawdownChart", () => ({
  DrawdownChart: (props: {
    data: { date: string; value: number }[];
    benchmarkSeries?: unknown;
  }) => (
    <div data-testid="drawdown-chart" data-len={props.data.length} />
  ),
}));

let lastRollingProps: {
  data?: Record<string, unknown>;
  overallSharpe?: number | null;
} = {};
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: (props: {
    data: Record<string, unknown>;
    overallSharpe?: number | null;
  }) => {
    lastRollingProps = props;
    return <div data-testid="rolling-metrics" />;
  },
}));

// Drive the lazy fetch from the test (mock the client-safe RPC wrapper).
// Tests override `fetchMock.mockImplementation(...)` per case.
const fetchMock = vi.fn();
vi.mock("@/lib/queries-client", () => ({
  fetchStrategyLazyMetricsClient: (...args: unknown[]) => fetchMock(...args),
}));

// Import under test AFTER all vi.mock calls.
import { HeadlineMetricsPanel } from "./HeadlineMetricsPanel";

const PANEL2_HEADLINE = {
  cumulative_return: 0.42,
  cagr: 0.18,
  sharpe: 1.5,
  sortino: 2.1,
  max_drawdown: -0.12,
  volatility: 0.16,
};

const PANEL2_EQUITY = {
  series: [
    { date: "2025-01-01", value: 1.0 },
    { date: "2025-12-31", value: 1.42 },
  ],
  btc_overlay: [
    { date: "2025-01-01", value: 1.0 },
    { date: "2025-12-31", value: 1.3 },
  ],
};

const ROLLING_METRICS = {
  sharpe_30d: [{ date: "2025-01-01", value: 0.5 }],
  sharpe_90d: [{ date: "2025-01-01", value: 0.7 }],
  sharpe_365d: [{ date: "2025-01-01", value: 1.0 }],
};

const BASE_PROPS = {
  strategyId: "abc-123",
  panel2Headline: PANEL2_HEADLINE,
  panel2Equity: PANEL2_EQUITY,
  rolling_metrics: ROLLING_METRICS,
  history_days: 365,
};

beforeEach(() => {
  fetchMock.mockReset();
  equityCurveRenderCount = 0;
  lastEquityCurveProps = {};
  lastRollingProps = {};
});

describe("HeadlineMetricsPanel — Phase 14b-06 Task 3", () => {
  it("Test 1: 4 segmented-control buttons all enabled (no aria-disabled)", () => {
    const { container } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    const group = container.querySelector('[role="group"][aria-label="Equity chart view"]');
    expect(group).not.toBeNull();
    const buttons = Array.from(group!.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      "Cumulative",
      "Underwater",
      "Rolling Sharpe",
      "Log returns",
    ]);
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("Test 2: default Cumulative — EquityCurve renders cumulative series", () => {
    const { getByTestId } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    const eq = getByTestId("equity-curve");
    expect(eq.getAttribute("data-first-date")).toBe("2025-01-01");
    // No fetch fires until the user clicks Log returns.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 3: Rolling Sharpe → RollingMetrics rendered with rolling_metrics + sharpe avg", () => {
    const { container, getByTestId } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    const rs = buttons.find((b) => b.textContent?.trim() === "Rolling Sharpe");
    fireEvent.click(rs!);
    expect(getByTestId("rolling-metrics")).not.toBeNull();
    expect(lastRollingProps.data).toBe(ROLLING_METRICS);
    expect(lastRollingProps.overallSharpe).toBe(PANEL2_HEADLINE.sharpe);
  });

  it("Test 3b: Rolling Sharpe — empty rolling_metrics renders PartialDataBanner", () => {
    const { container, queryByTestId } = render(
      <HeadlineMetricsPanel {...BASE_PROPS} rolling_metrics={null} />,
    );
    const rs = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Rolling Sharpe",
    );
    fireEvent.click(rs!);
    expect(queryByTestId("rolling-metrics")).toBeNull();
    expect(container.textContent).toContain("Rolling Sharpe series not yet computed for this strategy.");
  });

  it("Test 4: Log returns triggers fetch + renders EquityCurve with log_returns_series", async () => {
    fetchMock.mockResolvedValue({
      log_returns_series: [
        { date: "2025-01-01", value: 0.0 },
        { date: "2025-01-02", value: 0.01 },
      ],
    });
    const { container, getByTestId } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    const lr = buttons.find((b) => b.textContent?.trim() === "Log returns");
    fireEvent.click(lr!);

    // While loading, no EquityCurve render with log series — instead loading copy.
    expect(container.textContent).toContain("Loading…");

    await waitFor(() => {
      expect(getByTestId("equity-curve")).not.toBeNull();
    });
    expect(lastEquityCurveProps.data).toEqual([
      { date: "2025-01-01", value: 0.0 },
      { date: "2025-01-02", value: 0.01 },
    ]);
    expect(lastEquityCurveProps.benchmarkSeries).toBeNull();
  });

  it("Test 5: props extension — strategyId is required and rolling_metrics is wired", () => {
    // Compile-time check via instantiation — TS forbids omitting strategyId.
    // At runtime: render with all required props and verify the panel mounts.
    const { container } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    expect(container.querySelector('section[data-panel="headline-equity"]')).not.toBeNull();
  });

  it("Test 6 (no regression): KPI strip + BTC checkbox + partial-data banners preserved", () => {
    // KPI strip (history_days=365)
    const { container, rerender, queryByText } = render(
      <HeadlineMetricsPanel {...BASE_PROPS} />,
    );
    expect(container.textContent).toContain("Cum return");
    expect(container.textContent).toContain("CAGR");
    expect(container.textContent).toContain("Sharpe");
    expect(container.textContent).toContain("Sortino");
    expect(container.textContent).toContain("Max DD");
    expect(container.textContent).toContain("Vol");

    // BTC checkbox visible in cumulative
    expect(queryByText("BTC benchmark")).not.toBeNull();

    // history_days < 30 — KPI banner replaces strip
    rerender(<HeadlineMetricsPanel {...BASE_PROPS} history_days={20} />);
    expect(container.textContent).toContain(
      "This strategy needs at least 30 days of trading history",
    );

    // history_days < 7 — chart banner
    rerender(<HeadlineMetricsPanel {...BASE_PROPS} history_days={5} />);
    expect(container.textContent).toContain(
      "This strategy needs at least 7 days of equity history.",
    );
  });

  it("Test 6b: BTC checkbox hidden in Rolling Sharpe / Log returns views", () => {
    fetchMock.mockResolvedValue({
      log_returns_series: [{ date: "2025-01-01", value: 0 }],
    });
    const { container, queryByText } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    // Cumulative — visible
    expect(queryByText("BTC benchmark")).not.toBeNull();

    const buttons = Array.from(container.querySelectorAll("button"));
    fireEvent.click(buttons.find((b) => b.textContent?.trim() === "Rolling Sharpe")!);
    expect(queryByText("BTC benchmark")).toBeNull();

    fireEvent.click(buttons.find((b) => b.textContent?.trim() === "Log returns")!);
    expect(queryByText("BTC benchmark")).toBeNull();
  });

  it("Test 6c (H-1252): a stale strategy-A log_returns fetch is discarded after strategyId changes to B", async () => {
    // Reproduces the cross-strategy reuse race that `key={strategy.id}` prevents
    // in production but which the hook-level mountedRef/versionRef guard must
    // handle on its own (belt-and-suspenders). RollingMetricsPanel et al. get
    // this guard via useLazyPanelMetrics; HeadlineMetricsPanel fetches inline.
    // Without the guard, A's late resolve overwrites B's panel state.
    let resolveA: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );

    const { container, rerender } = render(
      <HeadlineMetricsPanel {...BASE_PROPS} strategyId="strat-A" />,
    );

    // Activate Log returns for strategy A — fetch is now in flight (loading).
    const lrButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Log returns",
    )!;
    fireEvent.click(lrButton);
    expect(container.textContent).toContain("Loading…");
    expect(container.querySelector('[data-testid="equity-curve"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("strat-A", "equity");

    // Cross-strategy reuse: SAME React instance, new strategyId (no key remount).
    rerender(<HeadlineMetricsPanel {...BASE_PROPS} strategyId="strat-B" />);

    // Resolve A's now-stale fetch. Without the versionRef guard this would
    // setLogReturns(A) + setLogReturnsStatus("ready") on the B-bound instance,
    // rendering A's distinctive 2099 series into B's panel.
    await act(async () => {
      resolveA({ log_returns_series: [{ date: "2099-01-01", value: 0.99 }] });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Guard held: A's resolve discarded → still loading, no EquityCurve for B.
    expect(container.querySelector('[data-testid="equity-curve"]')).toBeNull();
    expect(container.textContent).toContain("Loading…");
    // No second fetch dispatched (status was "loading" ≠ "idle" after rerender).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 7: forbidden classes absent (no font-medium / text-xl / text-2xl)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/HeadlineMetricsPanel.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/font-medium/);
    expect(src).not.toMatch(/text-xl/);
    expect(src).not.toMatch(/text-2xl/);
  });

  it("Test 8 (Grok B-03): fetchStrategyLazyMetricsClient called exactly once with ('abc-123', 'equity'); cached on toggle-back", async () => {
    fetchMock.mockResolvedValue({
      log_returns_series: [
        { date: "2025-01-01", value: 0.0 },
        { date: "2025-01-02", value: 0.01 },
      ],
    });
    const { container, getByTestId } = render(
      <HeadlineMetricsPanel {...BASE_PROPS} strategyId="abc-123" />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const cum = buttons.find((b) => b.textContent?.trim() === "Cumulative")!;
    const lr = buttons.find((b) => b.textContent?.trim() === "Log returns")!;

    fireEvent.click(lr);
    await waitFor(() => {
      expect(getByTestId("equity-curve")).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("abc-123", "equity");

    // Toggle Cumulative → Log returns. Cached log_returns_series should
    // skip the second fetch.
    fireEvent.click(cum);
    fireEvent.click(lr);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 9 (Grok B-03): empty equity payload renders PartialDataBanner with 'Log returns series unavailable'", async () => {
    fetchMock.mockResolvedValue({});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, queryByTestId } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    const lr = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Log returns",
    )!;
    fireEvent.click(lr);
    await waitFor(() => {
      expect(container.textContent).toContain("Log returns series unavailable for this strategy.");
    });
    // EquityCurve does NOT render in this state.
    expect(queryByTestId("equity-curve")).toBeNull();
    // Empty payload is NOT an error path; console.error must NOT have been called.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("Test 10 (Grok B-03): fetch error path renders PartialDataBanner; console.error logged once", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<HeadlineMetricsPanel {...BASE_PROPS} />);
    const lr = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Log returns",
    )!;
    fireEvent.click(lr);
    await waitFor(() => {
      expect(container.textContent).toContain("Log returns series unavailable for this strategy.");
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
