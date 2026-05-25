import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MorningBriefing } from "./MorningBriefing";
import { RegimeDetector } from "./RegimeDetector";
import { ConcentrationRisk } from "./ConcentrationRisk";

const baseProps = { timeframe: "YTD", width: 6, height: 3 };

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
// MorningBriefing
// ---------------------------------------------------------------------------

describe("MorningBriefing", () => {
  it("renders heading and date", () => {
    render(<MorningBriefing data={{}} {...baseProps} />);
    expect(screen.getByText("Morning Briefing")).toBeInTheDocument();
  });

  it("renders narrative summary when available", () => {
    render(
      <MorningBriefing
        data={{ analytics: { narrative_summary: "Markets are up today." } }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("Markets are up today.")).toBeInTheDocument();
  });

  it("renders placeholder when no narrative", () => {
    render(<MorningBriefing data={{}} {...baseProps} />);
    expect(
      screen.getByText("Portfolio briefing not yet generated."),
    ).toBeInTheDocument();
  });

  // M-0173 — the header date is produced by `new Date().toLocaleDateString
  // ("en-US", {...})` at render. Pin the clock so the formatted output is
  // deterministic. We set the system time to mid-UTC-day (12:00Z) so the
  // assertion is stable regardless of the runner's timezone (a date near
  // 00:00Z would print a different calendar day in UTC- offsets). The
  // 'en-US' locale string is locale-stable; this test locks BOTH the format
  // (weekday, long-month, numeric-day, year) and that the date is rendered.
  describe("M-0173 — header date formatting (deterministic clock)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders today's date in 'Weekday, Month D, YYYY' en-US form", () => {
      vi.useFakeTimers();
      // 2026-03-15 is a Sunday. Noon UTC keeps the calendar day stable
      // across runner timezones from UTC-11 to UTC+11.
      vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

      render(<MorningBriefing data={{}} {...baseProps} />);

      // Re-derive the expected string the same way the component does, so the
      // assertion tracks the component's exact Intl formatting (no hardcoded
      // string that would drift if the option set changes) yet remains
      // deterministic under the fixed clock.
      const expected = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      expect(expected).toContain("2026");
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });
});

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

// ---------------------------------------------------------------------------
// ConcentrationRisk
// ---------------------------------------------------------------------------

describe("ConcentrationRisk", () => {
  it("renders empty state with no strategies", () => {
    render(<ConcentrationRisk data={{ strategies: [] }} {...baseProps} />);
    expect(screen.getByText("No allocation data")).toBeInTheDocument();
  });

  it("computes HHI and shows concentration level", () => {
    render(
      <ConcentrationRisk
        data={{
          strategies: [
            { current_weight: 50, strategy: { name: "A", codename: null } },
            { current_weight: 30, strategy: { name: "B", codename: null } },
            { current_weight: 20, strategy: { name: "C", codename: null } },
          ],
        }}
        {...baseProps}
      />,
    );

    // HHI for [0.5, 0.3, 0.2] = 0.25 + 0.09 + 0.04 = 0.38 => Concentrated
    expect(screen.getByText("Concentrated")).toBeInTheDocument();
    expect(screen.getByText("0.380")).toBeInTheDocument();
    // Top 2 = 80%
    expect(screen.getByText(/80\.0%/)).toBeInTheDocument();
  });

  it("shows Diversified for evenly weighted portfolio", () => {
    render(
      <ConcentrationRisk
        data={{
          strategies: [
            { current_weight: 10, strategy: { name: "A", codename: null } },
            { current_weight: 10, strategy: { name: "B", codename: null } },
            { current_weight: 10, strategy: { name: "C", codename: null } },
            { current_weight: 10, strategy: { name: "D", codename: null } },
            { current_weight: 10, strategy: { name: "E", codename: null } },
            { current_weight: 10, strategy: { name: "F", codename: null } },
            { current_weight: 10, strategy: { name: "G", codename: null } },
            { current_weight: 10, strategy: { name: "H", codename: null } },
          ],
        }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("Diversified")).toBeInTheDocument();
  });
});
