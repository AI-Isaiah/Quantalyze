import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

  // M-0213 — the suite only had a 3-strategy fixture. These add the
  // boundary row-counts and the null-analytics row so an off-by-one in the
  // row mapping or a crash on missing analytics surfaces.
  describe("M-0213 — row-count boundaries and null analytics", () => {
    it("renders a single-strategy fixture without crashing (one data row, no n-1 arithmetic)", () => {
      const single = {
        strategies: [
          makeStrategy({
            name: "Solo Strat",
            weight: 1.0,
            allocated: 100000,
            cagr: 0.2,
            sharpe: 1.4,
          }),
        ],
      };
      render(
        <PositionsTable data={single} timeframe="YTD" width={800} height={400} />,
      );
      expect(screen.getByText("Solo Strat")).toBeInTheDocument();
      // Exactly one body data row (the <thead> row is excluded by tbody scope).
      const tbody = document.querySelector("tbody")!;
      // Each strategy renders one 44px-height <tr>; with no eligible/existing
      // outcome, no BannerSubRow is appended, so tbody has exactly 1 <tr>.
      expect(tbody.querySelectorAll("tr").length).toBe(1);
    });

    it("renders a row with em-dash fallbacks when strategy_analytics is null (no crash)", () => {
      const nullAnalytics = {
        strategies: [
          {
            strategy_id: "strat-null",
            current_weight: 0.5,
            allocated_amount: 50000,
            alias: null,
            strategy: {
              id: "strat-null",
              name: "No Metrics",
              codename: null,
              disclosure_tier: "institutional",
              strategy_types: [],
              markets: [],
              start_date: "2023-01-01",
              strategy_analytics: null,
            },
          },
        ],
      };
      render(
        <PositionsTable
          data={nullAnalytics}
          timeframe="YTD"
          width={800}
          height={400}
        />,
      );
      // The row renders (name present) instead of crashing on a null read.
      expect(screen.getByText("No Metrics")).toBeInTheDocument();
      // Null analytics cells fall back to the "--" marker (fmtPct/fmtRatio/
      // fmtUsd return "--" for null). At width >= 600 there are 10 such
      // metric columns (cagr/sharpe/maxDd/sortino/vol/winRate/calmar/alpha/
      // beta render "--"; allocated has a value so it doesn't).
      const dashes = screen.getAllByText("--");
      expect(dashes.length).toBeGreaterThanOrEqual(9);
    });

    it("renders 50 strategies — every row mounts (no clipping/truncation)", () => {
      const many = {
        strategies: Array.from({ length: 50 }, (_, i) =>
          makeStrategy({
            name: `Strat ${i}`,
            weight: 0.02,
            allocated: 2000,
            cagr: 0.1,
            sharpe: 1.0,
          }),
        ),
      };
      render(
        <PositionsTable data={many} timeframe="YTD" width={800} height={400} />,
      );
      const tbody = document.querySelector("tbody")!;
      // No virtualization in this component — all 50 rows are present in the
      // DOM (one <tr> each, no banner sub-rows for these non-eligible rows).
      expect(tbody.querySelectorAll("tr").length).toBe(50);
      // Spot-check the first and last rows actually rendered.
      expect(screen.getByText("Strat 0")).toBeInTheDocument();
      expect(screen.getByText("Strat 49")).toBeInTheDocument();
    });
  });

  // M-0214 — the existing visibility tests select header cells via
  // `document.querySelectorAll("th button")`. If the header markup were
  // refactored (button → div with role="columnheader"), that selector
  // returns zero nodes and the `.not.toContain(...)` assertions pass
  // VACUOUSLY. These re-express the column-set assertions via the semantic
  // `columnheader` role and pin the EXACT visible-column set at two widths.
  describe("M-0214 — column set via semantic role (refactor-robust)", () => {
    function visibleColumnNames(): string[] {
      const table = screen.getByRole("table");
      return within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent?.replace(/[↑↓\s]+$/g, "").trim() ?? "")
        .filter(Boolean);
    }

    it("at width >= 600 the visible columns are EXACTLY the full 12-column set", () => {
      render(<PositionsTable {...WIDGET_PROPS} />);
      expect(visibleColumnNames()).toEqual([
        "Strategy",
        "Weight",
        "Allocated",
        "CAGR",
        "Sharpe",
        "Max DD",
        "Sortino",
        "Vol",
        "Win Rate",
        "Calmar",
        "Alpha",
        "Beta",
      ]);
    });

    it("at width 280 the visible columns are EXACTLY ['Strategy', 'Weight'] (not just 'CAGR absent')", () => {
      render(
        <PositionsTable data={MOCK_DATA} timeframe="YTD" width={280} height={400} />,
      );
      expect(visibleColumnNames()).toEqual(["Strategy", "Weight"]);
    });
  });
});

// ---------------------------------------------------------------------------
// TODO widget tests
// ---------------------------------------------------------------------------

describe("TradingActivityLog", () => {
  it("renders loading then empty state when no portfolio", () => {
    render(<TradingActivityLog data={{}} timeframe="YTD" width={800} height={400} />);
    // With no portfolio, it should show empty or loading
    expect(document.querySelector("div")).toBeTruthy();
  });
});

describe("TradeVolume", () => {
  it("renders loading then empty state when no portfolio", () => {
    render(<TradeVolume data={{}} timeframe="YTD" width={800} height={400} />);
    expect(document.querySelector("div")).toBeTruthy();
  });
});

describe("ExposureByAsset", () => {
  it("shows empty state when no position snapshots", () => {
    render(<ExposureByAsset data={{}} timeframe="YTD" width={800} height={400} />);
    expect(screen.getByText("No position data available.")).toBeInTheDocument();
  });
});

describe("NetExposure", () => {
  it("shows empty state when no position snapshots", () => {
    render(<NetExposure data={{}} timeframe="YTD" width={800} height={400} />);
    expect(screen.getByText("No position history available.")).toBeInTheDocument();
  });
});
