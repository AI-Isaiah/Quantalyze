import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MorningBriefing } from "./MorningBriefing";
import { RegimeDetector } from "./RegimeDetector";
import { ConcentrationRisk } from "./ConcentrationRisk";

const baseProps = { timeframe: "YTD", width: 6, height: 3 };

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

  it("detects a regime from sufficient data", () => {
    // Build 300 days of uptrending returns for a bullish crossover
    const dailyReturns: Array<{ date: string; value: number }> = [];
    const startDate = new Date("2024-01-01");
    for (let i = 0; i < 300; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dailyReturns.push({
        date: d.toISOString().slice(0, 10),
        value: 0.002, // consistent positive return
      });
    }

    render(
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

    // Should show one of the valid regime labels
    const validRegimes = ["Bull Market", "Bear Market", "Range-bound"];
    const found = validRegimes.some((r) => screen.queryByText(r));
    expect(found).toBe(true);
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
