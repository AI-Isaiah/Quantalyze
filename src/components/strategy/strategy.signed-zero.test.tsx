/**
 * Phase 170.6 DISPLAYPOLISH plan 10 (D-02): the holding factsheet, the compare
 * equity overlay's y ticks and the compare correlation matrix never print a signed
 * zero. A value that rounds to zero at its printed precision prints unsigned.
 *
 * Every expected string is typed by hand. The inputs are raw values that round to
 * zero (-0.00004 as a return, -0.004 as a ratio or a correlation, -0.3 as a whole
 * percent tick); today each prints with a leading "-".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { HoldingFactsheet } from "./HoldingFactsheet";
import { CompareEquityOverlay } from "./CompareEquityOverlay";
import { CompareCorrelationMatrix } from "./CompareCorrelationMatrix";
import type { HoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

const captured = vi.hoisted(() => ({
  tickFormatter: null as ((v: number) => string) | null,
  pearson: -0.004 as number | null,
}));

// ResponsiveContainer measures 0x0 in jsdom, so it is a plain div, and so is the chart root
// (the CompareEquityOverlay.test.tsx idiom); YAxis records the
// real `tickFormatter` the component passes (no test-only prop), and renders nothing.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    YAxis: ({ tickFormatter }: { tickFormatter: (v: number) => string }) => {
      captured.tickFormatter = tickFormatter;
      return null;
    },
  };
});
vi.mock("@/components/charts/TouchTooltip", () => ({ TouchTooltip: () => null }));

// The matrix cell prints `pearson(a, b)`. A real series pair cannot be built to give
// exactly -0.004, so the correlation is pinned; the overlap and the formatting are real.
vi.mock("@/lib/return-stats", async () => {
  const actual = await vi.importActual<typeof import("@/lib/return-stats")>("@/lib/return-stats");
  return { ...actual, pearson: () => captured.pearson };
});

afterEach(() => {
  cleanup();
  captured.tickFormatter = null;
  captured.pearson = -0.004;
});

function holding(analytics: NonNullable<HoldingCompareItem["analytics"]>): HoldingCompareItem {
  return {
    kind: "holding",
    holding_ref: "holding:binance:BTC:spot",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    historyState: "ready",
    analytics,
  };
}

describe("HoldingFactsheet prints no signed zero (D-02)", () => {
  it("a cumulative return of -0.00004 prints 0.00%, a Sharpe of -0.004 prints 0.00", () => {
    const { container } = render(
      <HoldingFactsheet
        item={holding({ cumulative_return: -0.00004, sharpe: -0.004, max_drawdown: -0.15, vol: 0.55, priced_days: 40 })}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("0.00%");
    expect(text).not.toContain("-0.00");
    expect(screen.getAllByText("0.00%").length).toBe(1); // the return
    expect(screen.getAllByText("0.00").length).toBe(1); // the Sharpe
  });

  it("non-zero figures keep their sign and digits", () => {
    render(
      <HoldingFactsheet
        item={holding({ cumulative_return: -0.0342, sharpe: -1.236, max_drawdown: -0.15, vol: 0.55, priced_days: 40 })}
      />,
    );
    expect(screen.getByText("-3.42%")).toBeInTheDocument();
    expect(screen.getByText("-1.24")).toBeInTheDocument();
    expect(screen.getByText("-15.00%")).toBeInTheDocument();
  });

  it("a drawdown of -0.00004 prints 0.00%", () => {
    const { container } = render(
      <HoldingFactsheet
        item={holding({ cumulative_return: 0.42, sharpe: 1.8, max_drawdown: -0.00004, vol: 0.55, priced_days: 40 })}
      />,
    );
    expect(container.textContent).not.toContain("-0.00");
    expect(screen.getByText("0.00%")).toBeInTheDocument();
  });
});

function overlayItem(): { strategy: Strategy; analytics: StrategyAnalytics } {
  return {
    strategy: { id: "a", name: "Strategy a" } as unknown as Strategy,
    analytics: {
      cumulative_return: 0.1,
      returns_series: [
        { date: "2025-01-01", value: 1 },
        { date: "2025-01-02", value: 1.1 },
      ],
    } as unknown as StrategyAnalytics,
  };
}

describe("CompareEquityOverlay y ticks print no signed zero (D-02)", () => {
  it("a tick at -0.3 reads 0%, not -0%", () => {
    render(<CompareEquityOverlay items={[overlayItem()]} />);
    expect(captured.tickFormatter).not.toBeNull();
    expect(captured.tickFormatter!(-0.3)).toBe("0%");
  });

  it("real ticks keep their sign: -5 reads -5%, 10 reads 10%, 0 reads 0%", () => {
    render(<CompareEquityOverlay items={[overlayItem()]} />);
    expect(captured.tickFormatter!(-5)).toBe("-5%");
    expect(captured.tickFormatter!(10)).toBe("10%");
    expect(captured.tickFormatter!(0)).toBe("0%");
  });
});

const N = 60;
function matrixItem(id: string, phase: number): { strategy: Strategy; analytics: StrategyAnalytics } {
  const levels = [1];
  for (let i = 0; i < N; i++) levels.push(levels[i] * (1 + 0.004 * Math.sin(i * 1.7 + phase)));
  return {
    strategy: { id, name: id } as unknown as Strategy,
    analytics: {
      returns_series: levels.map((value, i) => ({
        date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
        value,
      })),
    } as unknown as StrategyAnalytics,
  };
}

function pairCellText(): string {
  const { container } = render(
    <CompareCorrelationMatrix items={[matrixItem("a", 0), matrixItem("b", 1)]} />,
  );
  const row = container.querySelectorAll("tbody tr")[0];
  return (row.querySelectorAll("td")[2] as HTMLElement).textContent ?? "";
}

describe("CompareCorrelationMatrix cells print no signed zero (D-02)", () => {
  it("a correlation of -0.004 prints 0.00", () => {
    captured.pearson = -0.004;
    expect(pairCellText()).toBe("0.00");
  });

  it("a correlation of -0.35 keeps its sign and a null stays a dash", () => {
    captured.pearson = -0.35;
    expect(pairCellText()).toBe("-0.35");
    cleanup();
    captured.pearson = null;
    expect(pairCellText()).toBe("—");
  });
});
