import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DrawdownChart from "./DrawdownChart";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

// jsdom has no layout; stub ResponsiveContainer so the chart renders at a fixed
// size (mirrors DrawdownChart.scenario.test.tsx).
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc" style={{ width: 400, height: 300 }}>
        {children}
      </div>
    ),
  };
});

const base = { timeframe: "ALL" as const, width: 6, height: 4 };
const EMPTY = "No drawdown data available";

const equitySeries: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  value: 100 + (i < 15 ? -i : i - 30), // dip then recover → real drawdown
}));

describe("DrawdownChart — inline riskWidgetDataSchema validation (B21)", () => {
  it("malformed `data` with no equityDailyPoints → empty render, no crash", () => {
    // The fallback path: safeParse rejects a non-array `strategies` and returns
    // [] instead of feeding "nope" into buildCompositeReturns. FAILS without the
    // B21 safeParse guard.
    render(<DrawdownChart data={{ strategies: "nope" } as never} {...base} />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });

  it("valid `data.compositeReturns` (no parallel prop) → renders, not empty", () => {
    const compositeReturns: DailyPoint[] = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, "0")}`,
      value: i % 3 === 0 ? -0.04 : 0.01,
    }));
    render(
      <DrawdownChart
        data={{ strategies: [], compositeReturns } as never}
        {...base}
      />,
    );
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("live-mount contract: data={{}} + equityDailyPoints → renders (not empty)", () => {
    // Pins that the {} literal the real ScenarioComposer mount passes still
    // produces a chart via the equityDailyPoints early-return (never reaches the
    // safeParse, which would reject {}).
    render(
      <DrawdownChart data={{}} {...base} equityDailyPoints={equitySeries} />,
    );
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});
