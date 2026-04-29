import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 14b-03 Task 2 — RollingMetricsPanel (Panel 5) wrapper tests.
 *
 * Strategy:
 *   - Mock useLazyPanelMetrics to drive { ref, data, status } directly
 *   - Mock the 4 child charts so we can inspect the props passed to them
 *     (especially the `data` prop keys for the Sharpe Grok B-01 mapping)
 *
 * 13 acceptance criteria covering chrome, partial-data routing, lifecycle,
 * window-toggle dispatch, and Grok B-01 SHARPE_KEY_BY_WINDOW table.
 */

interface HookReturn {
  ref: (n: HTMLElement | null) => void;
  data: Record<string, unknown> | null;
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

let lastRollingMetricsProps: {
  data?: Record<string, unknown>;
  overallSharpe?: number | null;
} = {};
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: (props: {
    data: Record<string, unknown>;
    overallSharpe?: number | null;
  }) => {
    lastRollingMetricsProps = props;
    return (
      <div
        data-testid="rolling-metrics"
        data-keys={Object.keys(props.data).join(",")}
      />
    );
  },
}));
let lastVolData: unknown = null;
vi.mock("@/components/charts/RollingVolatilityChart", () => ({
  RollingVolatilityChart: ({ data }: { data: unknown }) => {
    lastVolData = data;
    return <div data-testid="rolling-volatility" />;
  },
}));
let lastSortinoData: unknown = null;
vi.mock("@/components/charts/RollingSortinoChart", () => ({
  RollingSortinoChart: ({ data }: { data: unknown }) => {
    lastSortinoData = data;
    return <div data-testid="rolling-sortino" />;
  },
}));
let lastAlphaBetaProps: { alpha?: unknown; beta?: unknown } = {};
vi.mock("@/components/charts/RollingAlphaBetaChart", () => ({
  RollingAlphaBetaChart: (props: { alpha: unknown; beta: unknown }) => {
    lastAlphaBetaProps = props;
    return <div data-testid="rolling-alpha-beta" />;
  },
}));

import { RollingMetricsPanel } from "./RollingMetricsPanel";

const ROLLING_METRICS_FULL = {
  sharpe_30d: [
    { date: "2024-01-01", value: 0.5 },
    { date: "2024-01-02", value: 0.6 },
  ],
  sharpe_90d: [
    { date: "2024-01-01", value: 0.7 },
    { date: "2024-01-02", value: 0.8 },
  ],
  sharpe_365d: [
    { date: "2024-01-01", value: 1.0 },
    { date: "2024-01-02", value: 1.1 },
  ],
};

const PANEL5_LAZY_FULL = {
  rolling_volatility_3m: [{ date: "2024-01-01", value: 0.21 }],
  rolling_volatility_6m: [{ date: "2024-01-01", value: 0.18 }],
  rolling_volatility_12m: [{ date: "2024-01-01", value: 0.15 }],
  rolling_sortino_3m: [{ date: "2024-01-01", value: 1.2 }],
  rolling_sortino_6m: [{ date: "2024-01-01", value: 1.4 }],
  rolling_sortino_12m: [{ date: "2024-01-01", value: 1.6 }],
  rolling_alpha: [{ date: "2024-01-01", value: 0.05 }],
  rolling_beta: [{ date: "2024-01-01", value: 0.92 }],
};

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "idle" };
  lastRollingMetricsProps = {};
  lastVolData = null;
  lastSortinoData = null;
  lastAlphaBetaProps = {};
});

describe("RollingMetricsPanel — Phase 14b-03 Task 2", () => {
  it("Test 1: chrome — section[data-panel='rolling'] with 14a chrome classes + aria-label", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "idle" };
    const { container } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    const section = container.querySelector('section[data-panel="rolling"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-label")).toBe("Rolling metrics");
    const cls = section?.getAttribute("class") ?? "";
    expect(cls).toContain("mt-8");
    expect(cls).toContain("min-h-[240px]");
    expect(cls).toContain("rounded-lg");
    expect(cls).toContain("border-border");
    expect(cls).toContain("bg-surface");
    expect(cls).toContain("p-6");
    expect(cls).toContain("shadow-card");
  });

  it("Test 2: panel-level partial data when history_days < 90 — banner only, no charts", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container, queryByTestId } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={60}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    const banner = container.querySelector('[role="status"]');
    expect(banner?.textContent).toContain(
      "This strategy needs at least 90 days of trading history for rolling 3M metrics.",
    );
    expect(queryByTestId("rolling-metrics")).toBeNull();
    expect(queryByTestId("rolling-volatility")).toBeNull();
    expect(queryByTestId("rolling-sortino")).toBeNull();
    expect(queryByTestId("rolling-alpha-beta")).toBeNull();
  });

  it("Test 3: default 6M active — SegmentedControl with 3 buttons; 6M aria-pressed=true", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    const group = container.querySelector('[role="group"][aria-label="Rolling window"]');
    expect(group).not.toBeNull();
    const buttons = Array.from(group!.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["3M", "6M", "12M"]);
    const sixM = buttons.find((b) => b.textContent?.trim() === "6M");
    expect(sixM?.getAttribute("aria-pressed")).toBe("true");
    const threeM = buttons.find((b) => b.textContent?.trim() === "3M");
    expect(threeM?.getAttribute("aria-pressed")).toBe("false");
  });

  it("Test 4: clicking 12M switches Vol/Sortino series from _6m to _12m payload key", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    // Default = 6M
    expect(lastVolData).toBe(PANEL5_LAZY_FULL.rolling_volatility_6m);
    expect(lastSortinoData).toBe(PANEL5_LAZY_FULL.rolling_sortino_6m);

    const buttons = Array.from(container.querySelectorAll("button"));
    const twelveM = buttons.find((b) => b.textContent?.trim() === "12M");
    fireEvent.click(twelveM!);
    expect(lastVolData).toBe(PANEL5_LAZY_FULL.rolling_volatility_12m);
    expect(lastSortinoData).toBe(PANEL5_LAZY_FULL.rolling_sortino_12m);
  });

  it("Test 5: Sharpe key mapping (Grok B-01) — 6M default → sharpe_90d; 3M → sharpe_90d; 12M → sharpe_365d", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    // Default 6M → sharpe_90d (closest available — 180d not persisted)
    expect(Object.keys(lastRollingMetricsProps.data ?? {})).toEqual(["sharpe_90d"]);
    expect((lastRollingMetricsProps.data as Record<string, unknown>).sharpe_90d).toBe(
      ROLLING_METRICS_FULL.sharpe_90d,
    );

    const buttons = Array.from(container.querySelectorAll("button"));
    const threeM = buttons.find((b) => b.textContent?.trim() === "3M");
    fireEvent.click(threeM!);
    expect(Object.keys(lastRollingMetricsProps.data ?? {})).toEqual(["sharpe_90d"]);

    const twelveM = buttons.find((b) => b.textContent?.trim() === "12M");
    fireEvent.click(twelveM!);
    expect(Object.keys(lastRollingMetricsProps.data ?? {})).toEqual(["sharpe_365d"]);
    expect((lastRollingMetricsProps.data as Record<string, unknown>).sharpe_365d).toBe(
      ROLLING_METRICS_FULL.sharpe_365d,
    );
  });

  it("Test 6: Sharpe fallback chain (Grok B-01) — sparse rolling_metrics with only sharpe_30d, 3M active uses fallback", () => {
    const sparse = { sharpe_30d: ROLLING_METRICS_FULL.sharpe_30d };
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={sparse}
        sharpe={1.2}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const threeM = buttons.find((b) => b.textContent?.trim() === "3M");
    fireEvent.click(threeM!);
    // 3M primary = sharpe_90d (absent), fallback = sharpe_30d → present
    expect(Object.keys(lastRollingMetricsProps.data ?? {})).toEqual(["sharpe_30d"]);
  });

  it("Test 7: Sharpe gated when ALL 3 keys absent — null rolling_metrics renders sub-banner not chart", () => {
    // WR-03: history_days=365 meets the window threshold, so the banner must say
    // "not yet computed" rather than the misleading "need ≥N days" copy.
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container, queryByTestId } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={null}
        sharpe={null}
      />,
    );
    expect(queryByTestId("rolling-metrics")).toBeNull();
    expect(container.textContent).toContain(
      "Rolling Sharpe series not yet computed for this strategy.",
    );
    // Must NOT show the history-shortage copy for a strategy with 365 days.
    expect(container.textContent).not.toContain("Awaiting more data — need");
  });

  it("Test 7b: Sharpe gated when rolling_metrics={} (empty object)", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { queryByTestId } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={{}}
        sharpe={null}
      />,
    );
    expect(queryByTestId("rolling-metrics")).toBeNull();
  });

  it("Test 8: window-specific sub-banner when history_days < threshold (6M default w/ 120d → sub-banner)", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container, queryByTestId } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={120}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    // panel-level NOT gated (≥90), but 6M default needs ≥180 → sub-banner
    expect(container.textContent).toContain(
      "Awaiting more data — need ≥180 days for 6M rolling window.",
    );
    expect(queryByTestId("rolling-metrics")).toBeNull();
    expect(queryByTestId("rolling-volatility")).toBeNull();
    expect(queryByTestId("rolling-sortino")).toBeNull();
  });

  it("Test 9: 12M sub-banner — history_days=200, click 12M → all 3 windowed sub-charts gate", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container, queryByTestId } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={200}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const twelveM = buttons.find((b) => b.textContent?.trim() === "12M");
    fireEvent.click(twelveM!);
    expect(container.textContent).toContain(
      "Awaiting more data — need ≥365 days for 12M rolling window.",
    );
    expect(queryByTestId("rolling-volatility")).toBeNull();
    expect(queryByTestId("rolling-sortino")).toBeNull();
    expect(queryByTestId("rolling-metrics")).toBeNull();
  });

  it("Test 10: 100d history with 3M active renders all sub-charts; 6M default flips to sub-banner", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container, queryByTestId } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={100}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    // 6M default — needs ≥180 → gated
    expect(queryByTestId("rolling-volatility")).toBeNull();
    const buttons = Array.from(container.querySelectorAll("button"));
    const threeM = buttons.find((b) => b.textContent?.trim() === "3M");
    fireEvent.click(threeM!);
    // 3M needs ≥90 — 100d satisfies, sub-charts render
    expect(queryByTestId("rolling-volatility")).not.toBeNull();
    expect(queryByTestId("rolling-sortino")).not.toBeNull();
    expect(queryByTestId("rolling-metrics")).not.toBeNull();
  });

  it("Test 11: H3 sub-headings render in canonical order with canonical class set", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    const { container } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    const h3s = Array.from(container.querySelectorAll("h3"));
    expect(h3s.map((h) => h.textContent)).toEqual([
      "Rolling Sharpe",
      "Rolling volatility",
      "Rolling Sortino",
      "Rolling alpha & beta",
    ]);
    for (const h3 of h3s) {
      const cls = h3.getAttribute("class") ?? "";
      expect(cls).toContain("text-xs");
      expect(cls).toContain("font-normal");
      expect(cls).toContain("uppercase");
      expect(cls).toContain("tracking-wider");
      expect(cls).toContain("text-text-secondary");
      expect(cls).not.toContain("font-medium");
      expect(cls).not.toContain("text-sm");
    }
  });

  it("Test 12: lifecycle copy — loading shows aria-live=polite Loading…; error shows error banner", () => {
    mockHookReturn = { ref: () => {}, data: null, status: "loading" };
    const { container: loadingContainer } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    const live = loadingContainer.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain("Loading…");

    mockHookReturn = { ref: () => {}, data: null, status: "error" };
    const { container: errorContainer } = render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    expect(errorContainer.textContent).toContain("Couldn’t load this section");
  });

  it("Test 13: source contains zero inline tick={{...}} object literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/RollingMetricsPanel.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/tick=\{\{/);
  });

  it("Test 14 (Grok B-01): source contains SHARPE_KEY_BY_WINDOW table with all 3 persisted keys; non-persisted 180d key absent", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/RollingMetricsPanel.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/SHARPE_KEY_BY_WINDOW/);
    expect(src).toMatch(/sharpe_30d/);
    expect(src).toMatch(/sharpe_90d/);
    expect(src).toMatch(/sharpe_365d/);
    // Construct the forbidden literal at runtime so this test file does not
    // trip the phase-level grep guard against the non-persisted 180d key
    // (Grok B-01: that grep MUST return zero across the panel + chart trees).
    const forbidden = ["sharpe", "180d"].join("_");
    expect(src.includes(forbidden)).toBe(false);
  });

  it("Test 15: alpha+beta sub-chart receives lazy payload arrays directly (not window-segmented)", () => {
    mockHookReturn = { ref: () => {}, data: PANEL5_LAZY_FULL, status: "ready" };
    render(
      <RollingMetricsPanel
        strategyId="s1"
        history_days={365}
        rolling_metrics={ROLLING_METRICS_FULL}
        sharpe={1.2}
      />,
    );
    expect(lastAlphaBetaProps.alpha).toBe(PANEL5_LAZY_FULL.rolling_alpha);
    expect(lastAlphaBetaProps.beta).toBe(PANEL5_LAZY_FULL.rolling_beta);
  });

  it("Test 16: source forbids v2 type-contract violators (font-medium / text-sm / text-xl / text-2xl)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/RollingMetricsPanel.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/font-medium/);
    expect(src).not.toMatch(/text-sm/);
    expect(src).not.toMatch(/text-xl/);
    expect(src).not.toMatch(/text-2xl/);
  });
});
