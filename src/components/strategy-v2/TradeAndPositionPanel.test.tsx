import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TradeMetrics } from "@/lib/types";

/**
 * Phase 14b-04 Task 2 — TradeAndPositionPanel (Panel 6) wrapper tests.
 *
 * Strategy:
 *   - Mock useLazyPanelMetrics to drive { ref, data, status } AND inspect
 *     the opts object passed to it (Test 8 — Grok B-04 fetchOnIntersect=false).
 *   - Mock TradeMixSubPanel so we can inspect the props it receives
 *     (Test 7 — mode='2-bucket').
 *   - Mock fetchStrategyLazyMetricsClient and assert it is NEVER called
 *     (Test 8 — no network call fired).
 *
 * 12 acceptance criteria covering chrome, partial-data routing, all 4
 * metric rows + Trade Mix sub-panel, and the Grok B-04 invariants
 * (no lazy fetch, eager rows survive lazy 'error', placeholder still
 * renders rows).
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

const fetchClientSpy = vi.fn();
vi.mock("@/lib/queries-client", () => ({
  fetchStrategyLazyMetricsClient: (...args: unknown[]) => {
    fetchClientSpy(...args);
    return Promise.resolve({});
  },
}));

let lastTradeMixProps: { buckets?: unknown; mode?: string } = {};
vi.mock("./TradeMixSubPanel", () => ({
  TradeMixSubPanel: (props: { buckets?: unknown; mode?: string }) => {
    lastTradeMixProps = props;
    return <div data-testid="trade-mix-subpanel" data-mode={props.mode} />;
  },
}));

import { TradeAndPositionPanel } from "./TradeAndPositionPanel";

const TM_FULL: TradeMetrics & Record<string, unknown> = {
  total_positions: 1948,
  open_positions: 12,
  closed_positions: 1936,
  win_rate: 0.642,
  avg_roi: 0.018,
  avg_duration_days: 4.7,
  long_count: 1247,
  short_count: 701,
  best_trade_roi: 0.42,
  worst_trade_roi: -0.18,
  expectancy: 0.0234,
  risk_reward_ratio: 1.42,
  weighted_risk_reward_ratio: 1.31,
  sqn: 2.18,
  profit_factor_long: 1.62,
  profit_factor_short: 1.04,
  trade_mix: {
    long: { count: 1247, total_notional: 1, avg_holding_period_hours: 0 },
    short: { count: 701, total_notional: 1, avg_holding_period_hours: 0 },
  },
  // Volume aggregator extras (Phase 12 Plan 12-05 SUMMARY)
  gross_volume_usd: 12_500_000,
  mean_trade_size_usd: 6_400,
  daily_turnover_usd: 320_000,
  monthly_turnover_usd: 9_700_000,
  payoff_ratio: 1.55,
  profit_factor: 1.38,
  winners_count: 1251,
  losers_count: 685,
};

beforeEach(() => {
  mockHookReturn = { ref: () => {}, data: null, status: "idle" };
  lastHookArgs = { panelId: "", opts: {} };
  lastTradeMixProps = {};
  fetchClientSpy.mockClear();
});

describe("TradeAndPositionPanel — Phase 14b-04 Task 2", () => {
  it("Test 1: chrome — section[data-panel='trades'] with 14a chrome classes + aria-label", () => {
    const { container } = render(
      <TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />,
    );
    const section = container.querySelector('section[data-panel="trades"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute("aria-label")).toBe("Trades & positions");
    const cls = section?.getAttribute("class") ?? "";
    expect(cls).toContain("mt-8");
    expect(cls).toContain("min-h-[240px]");
    expect(cls).toContain("rounded-lg");
    expect(cls).toContain("border-border");
    expect(cls).toContain("bg-surface");
    expect(cls).toContain("p-6");
    expect(cls).toContain("shadow-card");
  });

  it("Test 2: panel-level partial data when trade_metrics === null OR total_positions === 0", () => {
    // Case A: trade_metrics is null
    const { container: c1, queryByText } = render(
      <TradeAndPositionPanel strategyId="s1" trade_metrics={null} />,
    );
    const banner1 = c1.querySelector('[role="status"]');
    expect(banner1?.textContent).toContain("Awaiting more data");
    expect(banner1?.textContent).toContain(
      "This strategy hasn't logged any trades yet.",
    );
    expect(queryByText("Total trades")).toBeNull();

    // Case B: total_positions === 0
    const { container: c2 } = render(
      <TradeAndPositionPanel
        strategyId="s1"
        trade_metrics={{ ...TM_FULL, total_positions: 0 }}
      />,
    );
    const banner2 = c2.querySelector('[role="status"]');
    expect(banner2).not.toBeNull();
  });

  it("Test 3: Trade summary row — 6 cells with verbatim labels + win-rate format", () => {
    const { container } = render(
      <TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />,
    );
    // H3
    expect(screen.getByText("Trade summary")).not.toBeNull();
    // 6 verbatim labels
    expect(screen.getAllByText("Total trades").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Long").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Short").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Wins")).not.toBeNull();
    expect(screen.getByText("Losses")).not.toBeNull();
    // Win rate: (0.642 * 100).toFixed(1) + '%' = "64.2%"
    expect(screen.getAllByText("64.2%").length).toBeGreaterThanOrEqual(1);
    // Total trades formatted with thousands separator
    expect(screen.getByText("1,948")).not.toBeNull();
    // Wins / Losses raw counts
    expect(screen.getByText("1,251")).not.toBeNull();
    expect(screen.getByText("685")).not.toBeNull();
    // Body shows the section regardless of useless container query
    expect(container.querySelector('[data-panel="trades"]')).not.toBeNull();
  });

  it("Test 4: Position summary row — 6 cells with avg duration formatted as '4.7 d'", () => {
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />);
    expect(screen.getByText("Position summary")).not.toBeNull();
    expect(screen.getByText("Open")).not.toBeNull();
    expect(screen.getByText("Closed")).not.toBeNull();
    expect(screen.getByText("Avg duration")).not.toBeNull();
    expect(screen.getByText("4.7 d")).not.toBeNull();
    // Open / Closed counts
    expect(screen.getByText("12")).not.toBeNull();
    expect(screen.getByText("1,936")).not.toBeNull();
  });

  it("Test 5: Risk-Reward row — 8 cells incl. SQN + negative styling on negative R:R / SQN", () => {
    const tmNeg = {
      ...TM_FULL,
      risk_reward_ratio: -0.42,
      sqn: -1.1,
      expectancy: -0.05,
    };
    const { container } = render(
      <TradeAndPositionPanel strategyId="s1" trade_metrics={tmNeg} />,
    );
    expect(screen.getByText("Risk-reward profile")).not.toBeNull();
    // 8 verbatim labels
    expect(screen.getByText("R:R")).not.toBeNull();
    expect(screen.getByText("Weighted R:R")).not.toBeNull();
    expect(screen.getByText("Profit factor")).not.toBeNull();
    expect(screen.getByText("Payoff ratio")).not.toBeNull();
    expect(screen.getByText("Long PF")).not.toBeNull();
    expect(screen.getByText("Short PF")).not.toBeNull();
    expect(screen.getByText("Expectancy")).not.toBeNull();
    expect(screen.getByText("SQN")).not.toBeNull();
    // Negative R:R value formatted with toFixed(2) and styled negative
    const rrCell = screen.getByText("-0.42");
    expect(rrCell.getAttribute("class") ?? "").toContain("text-negative");
    const sqnCell = screen.getByText("-1.10");
    expect(sqnCell.getAttribute("class") ?? "").toContain("text-negative");
    // Null Risk-Reward weighted still in TM_FULL — expected to render value not em-dash
    void container;
  });

  it("Test 5b: Risk-Reward — null values render em-dash", () => {
    const tmNull = {
      ...TM_FULL,
      risk_reward_ratio: null,
      weighted_risk_reward_ratio: null,
      sqn: null,
      expectancy: null,
      profit_factor_long: null,
      profit_factor_short: null,
      payoff_ratio: null,
      profit_factor: null,
    } as TradeMetrics & Record<string, unknown>;
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={tmNull} />);
    // 8 em-dashes from the RR row + possibly more from elsewhere — at least 8
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(8);
  });

  it("Test 6: Volume row — 4 cells with USD compact format ($12.5M etc.)", () => {
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />);
    expect(screen.getByText("Volume metrics")).not.toBeNull();
    expect(screen.getByText("Gross volume")).not.toBeNull();
    expect(screen.getByText("Mean trade size")).not.toBeNull();
    expect(screen.getByText("Daily turnover")).not.toBeNull();
    expect(screen.getByText("Monthly turnover")).not.toBeNull();
    // Compact USD: 12_500_000 → "$12.5M", 6_400 → "$6.4K", 320_000 → "$320K", 9_700_000 → "$9.7M"
    expect(screen.getByText("$12.5M")).not.toBeNull();
    expect(screen.getByText("$6.4K")).not.toBeNull();
    expect(screen.getByText("$320K")).not.toBeNull();
    expect(screen.getByText("$9.7M")).not.toBeNull();
  });

  it("Test 7: TradeMixSubPanel mounted with mode='2-bucket' and trade_mix buckets", () => {
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />);
    expect(screen.getByTestId("trade-mix-subpanel").getAttribute("data-mode")).toBe(
      "2-bucket",
    );
    expect(lastTradeMixProps.mode).toBe("2-bucket");
    expect(lastTradeMixProps.buckets).toEqual(TM_FULL.trade_mix);
  });

  it("Test 8: Grok B-04 — useLazyPanelMetrics called with fetchOnIntersect: false; fetch never fires", () => {
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />);
    expect(lastHookArgs.panelId).toBe("panel6");
    // Hook receives fetchOnIntersect=false (Grok B-04 — no network call)
    expect(lastHookArgs.opts.fetchOnIntersect).toBe(false);
    // No matter how the lazy lifecycle drives, fetchStrategyLazyMetricsClient
    // must NEVER be invoked. The Panel6 component does not call it directly,
    // and the hook's branch with fetchOnIntersect=false never reaches the
    // dynamic import path.
    expect(fetchClientSpy).not.toHaveBeenCalled();
  });

  it("Test 9: Grok B-04 — eager rows survive lazy status='error'", () => {
    mockHookReturn = {
      ref: () => {},
      data: null,
      status: "error",
    };
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />);
    // The 4 metric rows still render fully — the lazy 'error' state does NOT
    // mask valid eager data.
    expect(screen.getByText("Trade summary")).not.toBeNull();
    expect(screen.getByText("Position summary")).not.toBeNull();
    expect(screen.getByText("Risk-reward profile")).not.toBeNull();
    expect(screen.getByText("Volume metrics")).not.toBeNull();
    expect(screen.getByText("1,948")).not.toBeNull();
    // No partial-data banner (since trade_metrics is populated)
    const banner = document.querySelector('[role="status"]');
    expect(banner).toBeNull();
  });

  it("Test 10: Grok B-04 — at status='idle' (pre-intersect), eager rows still render", () => {
    mockHookReturn = {
      ref: () => {},
      data: null,
      status: "idle",
    };
    render(<TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />);
    // Eager rows render unconditionally — no dependency on intersection.
    expect(screen.getByText("Total trades")).not.toBeNull();
    expect(screen.getByText("1,948")).not.toBeNull();
  });

  it("Test 11: Each MetricCell uses its own <dl> — total <dl> count = sum of all cells", () => {
    const { container } = render(
      <TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />,
    );
    const dls = container.querySelectorAll("dl");
    // 6 (Trade) + 6 (Position) + 8 (RR) + 4 (Volume) = 24
    expect(dls.length).toBe(24);
  });

  it("Test 12: no forbidden type-scale classes in rendered output", () => {
    const { container } = render(
      <TradeAndPositionPanel strategyId="s1" trade_metrics={TM_FULL} />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bfont-medium\b/);
    expect(html).not.toMatch(/\btext-sm\b/);
    expect(html).not.toMatch(/\btext-xl\b/);
    expect(html).not.toMatch(/\btext-2xl\b/);
    expect(html).not.toMatch(/text-\[14px\]/);
  });
});
