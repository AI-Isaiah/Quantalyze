import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegimeDetector } from "./RegimeDetector";

const baseProps = { timeframe: "1YTD" as const, width: 6, height: 3 };

// Build a daily-return series of `len` points starting 2024-01-01, where
// `valueAt(i)` supplies each day's return. Shared by the deterministic
// regime fixtures below.
function makeReturns(
  len: number,
  valueAt: (i: number) => number,
): Array<{ date: string; value: number }> {
  const out: Array<{ date: string; value: number }> = [];
  const start = new Date("2024-01-01");
  for (let i = 0; i < len; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), value: valueAt(i) });
  }
  return out;
}

function renderRegime(dailyReturns: Array<{ date: string; value: number }>) {
  return render(
    <RegimeDetector
      data={{
        strategies: [
          {
            strategy: {
              strategy_analytics: { daily_returns: dailyReturns },
            },
          },
        ],
      }}
      {...baseProps}
    />,
  );
}

// ---------------------------------------------------------------------------
// RegimeDetector
// ---------------------------------------------------------------------------

describe("RegimeDetector", () => {
  it("shows insufficient data message with few data points", () => {
    render(
      <RegimeDetector
        data={{ strategies: [] }}
        {...baseProps}
      />,
    );
    expect(
      screen.getByText(/Insufficient data for regime detection/),
    ).toBeInTheDocument();
  });

  // M-0177 — the prior test accepted ANY of three regime labels via
  // `.some(queryByText)`, which would also pass vacuously if NO label
  // rendered (e.g. the widget degraded to the insufficient-data state) or if
  // a 4th unexpected label appeared. These tests pin the EXACT label for a
  // deterministic input AND assert the insufficient-data empty state is
  // absent, so a math regression that flips the regime — or silently drops to
  // empty — fails visibly.
  it("M-0177: constant-positive series (no MA crossover) renders exactly 'Range-bound', not the empty state", () => {
    // 300 days of constant +0.002 → strictly convex cumulative curve → the
    // 50d MA never crosses the 200d MA → zero crossovers → neutral regime.
    renderRegime(makeReturns(300, () => 0.002));

    expect(screen.getByText("Range-bound")).toBeInTheDocument();
    // The OTHER labels must be absent — proves a single, specific regime.
    expect(screen.queryByText("Bull Market")).toBeNull();
    expect(screen.queryByText("Bear Market")).toBeNull();
    // And the insufficient-data path must NOT be the thing that rendered.
    expect(
      screen.queryByText(/Insufficient data for regime detection/),
    ).toBeNull();
  });

  it("M-0177: down-then-up series produces a bullish crossover → exactly 'Bull Market'", () => {
    // 250 mildly-declining days then 100 strongly-rising days drives the fast
    // MA from below the slow MA to above it → a single bullish crossover.
    const bull = makeReturns(350, (i) => (i < 250 ? -0.001 : 0.02));
    renderRegime(bull);

    expect(screen.getByText("Bull Market")).toBeInTheDocument();
    expect(screen.queryByText("Bear Market")).toBeNull();
    expect(screen.queryByText("Range-bound")).toBeNull();
    expect(
      screen.queryByText(/Insufficient data for regime detection/),
    ).toBeNull();
  });

  it("M-0177: up-then-down series produces a bearish crossover → exactly 'Bear Market'", () => {
    // 250 rising days then 100 sharply-falling days drives the fast MA below
    // the slow MA → a single bearish crossover.
    const bear = makeReturns(350, (i) => (i < 250 ? 0.001 : -0.02));
    renderRegime(bear);

    expect(screen.getByText("Bear Market")).toBeInTheDocument();
    expect(screen.queryByText("Bull Market")).toBeNull();
    expect(screen.queryByText("Range-bound")).toBeNull();
    expect(
      screen.queryByText(/Insufficient data for regime detection/),
    ).toBeNull();
  });
});
