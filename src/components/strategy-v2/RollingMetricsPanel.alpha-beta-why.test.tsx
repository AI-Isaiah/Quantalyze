import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";

/**
 * Phase 170.5 plan 02 (D-01, D-06) — the Rolling alpha & beta sub-section.
 *
 * Today it is an empty heading whenever the lazy payload carries no alpha/beta
 * points (the chart returns null and the section was built `gated={false}`).
 * The contract pinned here: at every toggle position the section shows the
 * window caption and EITHER the chart (2+ points carrying a finite value) OR
 * the cause in a 250px block, so toggling never moves the page.
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
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: () => <div data-testid="rolling-metrics" />,
}));
vi.mock("@/components/charts/RollingVolatilityChart", () => ({
  RollingVolatilityChart: () => <div data-testid="rolling-volatility" />,
}));
vi.mock("@/components/charts/RollingSortinoChart", () => ({
  RollingSortinoChart: () => <div data-testid="rolling-sortino" />,
}));
let lastAlphaBetaProps: { alpha?: unknown; beta?: unknown } = {};
vi.mock("@/components/charts/RollingAlphaBetaChart", () => ({
  RollingAlphaBetaChart: (props: { alpha: unknown; beta: unknown }) => {
    lastAlphaBetaProps = props;
    return <div data-testid="rolling-alpha-beta" />;
  },
}));

import { RollingMetricsPanel } from "./RollingMetricsPanel";
import type { AnalyticsDataQualityFlags } from "@/lib/types";

const CAPTION =
  "90-day rolling window, paired with BTC. The 3M / 6M / 12M toggle sets the charts above, not this one.";
const WHY_UNAVAILABLE =
  "BTC benchmark prices were unavailable when this strategy was last computed.";
const WHY_SHORT_90 =
  "Not enough history for the 90-day rolling window: needs 91 days paired with BTC; this strategy has 90 days of history.";
const WHY_UNIT = "Not paired with BTC: returns are in BTC.";
const WHY_OTHERWISE = "Rolling alpha and beta are not computed for this strategy.";

function renderPanel(opts: {
  lazy: Record<string, unknown>;
  history_days: number;
  flags?: AnalyticsDataQualityFlags | null;
}) {
  mockHookReturn = { ref: () => {}, data: opts.lazy, status: "ready" };
  const utils = render(
    <RollingMetricsPanel
      strategyId="s1"
      history_days={opts.history_days}
      rolling_metrics={null}
      sharpe={null}
      data_quality_flags={opts.flags}
    />,
  );
  const alphaBetaSection = () => {
    const h3 = Array.from(utils.container.querySelectorAll("h3")).find(
      (n) => n.textContent === "Rolling alpha & beta",
    );
    if (!h3 || !h3.parentElement) throw new Error("alpha/beta section missing");
    return h3.parentElement;
  };
  return { ...utils, alphaBetaSection };
}

function clickEachWindow(
  utils: ReturnType<typeof renderPanel>,
  check: () => void,
) {
  for (const label of ["3M", "6M", "12M"]) {
    const btn = Array.from(utils.container.querySelectorAll("button")).find(
      (b) => b.textContent === label,
    );
    if (!btn) throw new Error(`toggle ${label} missing`);
    fireEvent.click(btn);
    check();
  }
}

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "idle" };
  lastAlphaBetaProps = {};
});

const EMPTY = { rolling_alpha: [], rolling_beta: [] };

describe("RollingMetricsPanel alpha & beta — say-why at every window (D-01)", () => {
  it("benchmark_unavailable: the reason shows at 3M, 6M and 12M in a 250px block, chart never mounted", () => {
    const u = renderPanel({
      lazy: EMPTY,
      history_days: 112,
      flags: { benchmark_unavailable: true },
    });
    clickEachWindow(u, () => {
      const section = u.alphaBetaSection();
      expect(section.textContent).toContain(WHY_UNAVAILABLE);
      const why = section.querySelector('[data-testid="rolling-alpha-beta-why"]');
      expect(why).not.toBeNull();
      expect((why as HTMLElement).style.minHeight).toBe("250px");
      expect(section.querySelector('[data-testid="rolling-alpha-beta"]')).toBeNull();
    });
  });

  it("short history (90 days, no flags): names the 91-day need and the strategy's own days", () => {
    const u = renderPanel({ lazy: EMPTY, history_days: 90 });
    clickEachWindow(u, () => {
      expect(u.alphaBetaSection().textContent).toContain(WHY_SHORT_90);
    });
  });

  it("native unit: says the returns are not paired with BTC", () => {
    const u = renderPanel({
      lazy: EMPTY,
      history_days: 400,
      flags: { native_unit: "BTC" },
    });
    clickEachWindow(u, () => {
      expect(u.alphaBetaSection().textContent).toContain(WHY_UNIT);
    });
  });

  it("otherwise: the generic sentence", () => {
    const u = renderPanel({ lazy: EMPTY, history_days: 400 });
    expect(u.alphaBetaSection().textContent).toContain(WHY_OTHERWISE);
  });

  it("a 1-point series says why and never mounts the chart", () => {
    const u = renderPanel({
      lazy: {
        rolling_alpha: [{ date: "2026-06-01", value: 0.1 }],
        rolling_beta: [],
      },
      history_days: 91,
    });
    expect(u.alphaBetaSection().textContent).toContain(WHY_OTHERWISE);
    expect(u.queryByTestId("rolling-alpha-beta")).toBeNull();
  });

  it("two dates holding only NaN values say why (non-finite points never draw)", () => {
    const u = renderPanel({
      lazy: {
        rolling_alpha: [
          { date: "2026-06-01", value: Number.NaN },
          { date: "2026-06-02", value: Number.NaN },
        ],
        rolling_beta: [
          { date: "2026-06-01", value: Number.NaN },
          { date: "2026-06-02", value: Number.NaN },
        ],
      },
      history_days: 400,
    });
    expect(u.alphaBetaSection().textContent).toContain(WHY_OTHERWISE);
    expect(u.queryByTestId("rolling-alpha-beta")).toBeNull();
  });

  it("two dates with one finite alpha each mount the chart", () => {
    const u = renderPanel({
      lazy: {
        rolling_alpha: [
          { date: "2026-06-01", value: 0.1 },
          { date: "2026-06-02", value: 0.2 },
        ],
        rolling_beta: [],
      },
      history_days: 400,
    });
    expect(u.queryByTestId("rolling-alpha-beta")).not.toBeNull();
    expect(u.queryByTestId("rolling-alpha-beta-why")).toBeNull();
  });

  it("with 2 finite points the chart receives the hook's arrays by reference", () => {
    const alpha = [
      { date: "2026-06-01", value: 0.1 },
      { date: "2026-06-02", value: 0.2 },
    ];
    const beta = [
      { date: "2026-06-01", value: 0.9 },
      { date: "2026-06-02", value: 0.8 },
    ];
    renderPanel({
      lazy: { rolling_alpha: alpha, rolling_beta: beta },
      history_days: 400,
    });
    expect(lastAlphaBetaProps.alpha).toBe(alpha);
    expect(lastAlphaBetaProps.beta).toBe(beta);
  });
});

describe("RollingMetricsPanel alpha & beta — caption and focus (D-01)", () => {
  it("the caption shows in the say-why state and in the chart state, and only in the alpha/beta section", () => {
    const why = renderPanel({ lazy: EMPTY, history_days: 400 });
    expect(why.alphaBetaSection().textContent).toContain(CAPTION);
    expect(why.container.textContent?.split(CAPTION).length).toBe(2);
    why.unmount();

    const chart = renderPanel({
      lazy: {
        rolling_alpha: [
          { date: "2026-06-01", value: 0.1 },
          { date: "2026-06-02", value: 0.2 },
        ],
        rolling_beta: [],
      },
      history_days: 400,
    });
    expect(chart.alphaBetaSection().textContent).toContain(CAPTION);
    expect(chart.container.textContent?.split(CAPTION).length).toBe(2);
  });

  it("neither the caption nor the say-why block is focusable or aria-live", () => {
    const u = renderPanel({ lazy: EMPTY, history_days: 400 });
    const section = u.alphaBetaSection();
    const why = section.querySelector('[data-testid="rolling-alpha-beta-why"]')!;
    const captionEl = Array.from(section.querySelectorAll("p")).find(
      (p) => p.textContent === CAPTION,
    )!;
    for (const el of [why, why.querySelector("p")!, captionEl]) {
      expect(el.hasAttribute("tabindex")).toBe(false);
      expect(el.hasAttribute("aria-live")).toBe(false);
    }
  });
});
