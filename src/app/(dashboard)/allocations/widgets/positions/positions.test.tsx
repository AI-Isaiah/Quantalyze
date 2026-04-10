import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PositionsTable from "./PositionsTable";
import TradingActivityLog from "./TradingActivityLog";
import TradeVolume from "./TradeVolume";
import ExposureByAsset from "./ExposureByAsset";
import NetExposure from "./NetExposure";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeStrategy(overrides: {
  name: string;
  weight: number;
  allocated: number;
  cagr: number;
  sharpe: number;
}) {
  return {
    strategy_id: `strat-${overrides.name}`,
    current_weight: overrides.weight,
    allocated_amount: overrides.allocated,
    alias: null,
    strategy: {
      id: `strat-${overrides.name}`,
      name: overrides.name,
      codename: null,
      disclosure_tier: "institutional",
      strategy_types: [],
      markets: [],
      start_date: "2023-01-01",
      strategy_analytics: {
        daily_returns: [],
        cagr: overrides.cagr,
        sharpe: overrides.sharpe,
        volatility: 0.15,
        max_drawdown: -0.12,
        sortino: 1.8,
        calmar: 2.1,
      },
    },
  };
}

const MOCK_DATA = {
  strategies: [
    makeStrategy({ name: "Alpha Momentum", weight: 0.4, allocated: 40000, cagr: 0.25, sharpe: 1.5 }),
    makeStrategy({ name: "Beta Neutral", weight: 0.35, allocated: 35000, cagr: 0.18, sharpe: 1.2 }),
    makeStrategy({ name: "Gamma Trend", weight: 0.25, allocated: 25000, cagr: 0.32, sharpe: 2.0 }),
  ],
};

const WIDGET_PROPS = {
  data: MOCK_DATA,
  timeframe: "YTD",
  width: 800,
  height: 400,
};

// ---------------------------------------------------------------------------
// PositionsTable tests
// ---------------------------------------------------------------------------

describe("PositionsTable", () => {
  it("renders correct number of data rows", () => {
    render(<PositionsTable {...WIDGET_PROPS} />);
    // 3 strategies = 3 rows
    expect(screen.getByText("Alpha Momentum")).toBeInTheDocument();
    expect(screen.getByText("Beta Neutral")).toBeInTheDocument();
    expect(screen.getByText("Gamma Trend")).toBeInTheDocument();
  });

  it("shows empty state when no strategies", () => {
    render(<PositionsTable data={{ strategies: [] }} timeframe="YTD" width={800} height={400} />);
    expect(screen.getByText("No positions data available")).toBeInTheDocument();
  });

  it("renders all 12 column headers at width >= 600", () => {
    render(<PositionsTable {...WIDGET_PROPS} />);
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Allocated")).toBeInTheDocument();
    expect(screen.getByText("CAGR")).toBeInTheDocument();
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getByText("Max DD")).toBeInTheDocument();
    expect(screen.getByText("Sortino")).toBeInTheDocument();
    expect(screen.getByText("Vol")).toBeInTheDocument();
    expect(screen.getByText("Win Rate")).toBeInTheDocument();
    expect(screen.getByText("Calmar")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("column visibility toggles hide/show columns", () => {
    render(<PositionsTable {...WIDGET_PROPS} />);

    // Open the gear dropdown
    fireEvent.click(screen.getByTestId("column-visibility-toggle"));

    // Uncheck "Sharpe"
    const sharpeCheckbox = screen.getByTestId("col-toggle-sharpe");
    fireEvent.click(sharpeCheckbox);

    // Sharpe column header should be gone (the button text, not the checkbox label)
    const headers = document.querySelectorAll("th button");
    const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
    expect(headerTexts).not.toContain("Sharpe");

    // Re-check "Sharpe"
    fireEvent.click(sharpeCheckbox);
    const headersAfter = document.querySelectorAll("th button");
    const headerTextsAfter = Array.from(headersAfter).map((h) => h.textContent?.trim());
    expect(headerTextsAfter).toContain("Sharpe");
  });

  it("shows fewer columns at narrow widths", () => {
    render(<PositionsTable data={MOCK_DATA} timeframe="YTD" width={280} height={400} />);
    // At width < 300: only Strategy + Weight
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.getByText("Weight")).toBeInTheDocument();
    // CAGR should not be visible as a column header (but might be in the dropdown)
    const headers = document.querySelectorAll("th button");
    const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
    expect(headerTexts).not.toContain("CAGR");
  });
});

// ---------------------------------------------------------------------------
// TODO widget tests
// ---------------------------------------------------------------------------

describe("TradingActivityLog (TODO)", () => {
  it("renders placeholder message", () => {
    render(<TradingActivityLog {...WIDGET_PROPS} />);
    expect(
      screen.getByText(/Trade log requires a trades query endpoint/),
    ).toBeInTheDocument();
  });
});

describe("TradeVolume (TODO)", () => {
  it("renders placeholder message", () => {
    render(<TradeVolume {...WIDGET_PROPS} />);
    expect(
      screen.getByText(/Trade volume chart requires the same trades query endpoint/),
    ).toBeInTheDocument();
  });
});

describe("ExposureByAsset (TODO)", () => {
  it("renders placeholder message", () => {
    render(<ExposureByAsset {...WIDGET_PROPS} />);
    expect(
      screen.getByText(/Asset-level exposure breakdown requires position-level data/),
    ).toBeInTheDocument();
  });
});

describe("NetExposure (TODO)", () => {
  it("renders placeholder message", () => {
    render(<NetExposure {...WIDGET_PROPS} />);
    expect(
      screen.getByText(/Net exposure tracking requires historical position data/),
    ).toBeInTheDocument();
  });
});
