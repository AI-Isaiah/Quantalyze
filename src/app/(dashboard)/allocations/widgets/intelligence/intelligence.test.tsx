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
            // current_weight is required now that the composite is weighted
            // (M-0174). A single weight-1 strategy's weighted composite equals
            // its raw series, so these single-strategy fixtures behave exactly
            // as before.
            current_weight: 1,
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

  // M-0174 — the regime composite must be WEIGHTED by current_weight, not an
  // equal-weight mean. A 0.9-weight bullish strategy + a 0.1-weight bearish
  // strategy is a Bull-Market portfolio; an unweighted mean of the two opposing
  // series is flat (Range-bound). This fixture discriminates: it passes only
  // when the dominant-weight strategy drives the label.
  it("M-0174: weights the composite — a 0.9-weight bullish strategy dominates a 0.1-weight bearish one → 'Bull Market'", () => {
    // Strategy A (0.9): down-then-up → bullish crossover when it dominates.
    const bullish = makeReturns(350, (i) => (i < 250 ? -0.001 : 0.02));
    // Strategy B (0.1): up-then-down → bearish on its own.
    const bearish = makeReturns(350, (i) => (i < 250 ? 0.001 : -0.02));
    render(
      <RegimeDetector
        data={{
          strategies: [
            {
              current_weight: 0.9,
              strategy: { strategy_analytics: { daily_returns: bullish } },
            },
            {
              current_weight: 0.1,
              strategy: { strategy_analytics: { daily_returns: bearish } },
            },
          ],
        }}
        {...baseProps}
      />,
    );

    // Weighted: 0.9·(−0.001)+0.1·(0.001)=−0.0008 then 0.9·0.02+0.1·(−0.02)=0.016
    // → down-then-up → bullish crossover. (Equal-weight mean = exactly flat →
    // would render 'Range-bound', so this assertion fails under the unweighted
    // sum/count regression.)
    expect(screen.getByText("Bull Market")).toBeInTheDocument();
    expect(screen.queryByText("Bear Market")).toBeNull();
    expect(screen.queryByText("Range-bound")).toBeNull();
    expect(
      screen.queryByText(/Insufficient data for regime detection/),
    ).toBeNull();
  });

  // M-0174 (override branch) — RegimeDetector reads `data.compositeReturns ??
  // buildCompositeReturns(strategies)`. The precomputed-override side fires in
  // some prod mounts but was otherwise untested here (the strategies fallback
  // is what every other case exercises). Inject a 350-point bullish composite
  // with NO strategies: only the override can drive the label.
  it("M-0174: honors a directly-injected data.compositeReturns over the strategies fallback", () => {
    const composite = makeReturns(350, (i) => (i < 250 ? -0.001 : 0.02));
    render(
      <RegimeDetector
        // strategies empty → the fallback buildCompositeReturns([]) yields [];
        // the injected composite is the ONLY data source.
        data={{ strategies: [], compositeReturns: composite }}
        {...baseProps}
      />,
    );
    // Bullish crossover from the injected series. (Dropping the
    // `data.compositeReturns ??` left operand → fallback over [] strategies →
    // "Insufficient data", so this assertion fails without the override.)
    expect(screen.getByText("Bull Market")).toBeInTheDocument();
    expect(
      screen.queryByText(/Insufficient data for regime detection/),
    ).toBeNull();
  });
});
