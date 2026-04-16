import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioAlerts } from "./PortfolioAlerts";
import { ExchangeStatus } from "./ExchangeStatus";
import { StrategyHealth } from "./StrategyHealth";
import { DataFreshness } from "./DataFreshness";

const baseProps = { timeframe: "YTD", width: 6, height: 3 };

// ---------------------------------------------------------------------------
// PortfolioAlerts
// ---------------------------------------------------------------------------

describe("PortfolioAlerts", () => {
  it("renders empty state when no alerts", () => {
    render(
      <PortfolioAlerts
        data={{ alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 } }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("No active alerts")).toBeInTheDocument();
  });

  it("renders severity counts correctly", () => {
    render(
      <PortfolioAlerts
        data={{ alertCount: { critical: 0, high: 3, medium: 1, low: 2, total: 6 } }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/3 high-severity alerts/)).toBeInTheDocument();
    expect(screen.getByText(/1 medium-severity alert$/)).toBeInTheDocument();
    expect(screen.getByText(/2 low-severity alerts/)).toBeInTheDocument();
  });

  it("renders singular alert text", () => {
    render(
      <PortfolioAlerts
        data={{ alertCount: { critical: 0, high: 1, medium: 0, low: 0, total: 1 } }}
        {...baseProps}
      />,
    );
    expect(screen.getByText(/1 high-severity alert$/)).toBeInTheDocument();
  });

  it("renders null data gracefully", () => {
    render(<PortfolioAlerts data={{}} {...baseProps} />);
    expect(screen.getByText("No active alerts")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExchangeStatus
// ---------------------------------------------------------------------------

describe("ExchangeStatus", () => {
  it("renders empty state", () => {
    render(<ExchangeStatus data={{ apiKeys: [] }} {...baseProps} />);
    expect(screen.getByText("No exchange connections")).toBeInTheDocument();
  });

  it("renders exchange rows with names", () => {
    const now = new Date().toISOString();
    render(
      <ExchangeStatus
        data={{
          apiKeys: [
            { id: "1", exchange: "Binance", label: "main", is_active: true, last_sync_at: now },
            { id: "2", exchange: "Bybit", label: "sub", is_active: false, last_sync_at: null },
          ],
        }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("Binance")).toBeInTheDocument();
    expect(screen.getByText("Bybit")).toBeInTheDocument();
    expect(screen.getByText("Never synced")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StrategyHealth
// ---------------------------------------------------------------------------

describe("StrategyHealth", () => {
  it("renders empty state", () => {
    render(<StrategyHealth data={{ strategies: [] }} {...baseProps} />);
    expect(screen.getByText("No strategies to monitor")).toBeInTheDocument();
  });

  it("renders strategy names with health labels", () => {
    render(
      <StrategyHealth
        data={{
          strategies: [
            {
              strategy_id: "s1",
              strategy: {
                name: "Alpha Strategy",
                codename: null,
                strategy_analytics: { cagr: 0.12, sharpe: 1.5 },
              },
            },
            {
              strategy_id: "s2",
              strategy: {
                name: "Beta Strategy",
                codename: "BETA",
                strategy_analytics: null,
              },
            },
          ],
        }}
        {...baseProps}
      />,
    );
    expect(screen.getByText("Alpha Strategy")).toBeInTheDocument();
    expect(screen.getByText("BETA")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DataFreshness
// ---------------------------------------------------------------------------

describe("DataFreshness", () => {
  it("renders all five data sources", () => {
    render(<DataFreshness data={{}} {...baseProps} />);
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("Prices")).toBeInTheDocument();
    expect(screen.getByText("Correlations")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
  });

  it("shows Available when analytics present", () => {
    render(
      <DataFreshness
        data={{ analytics: { twr: 0.1 } }}
        {...baseProps}
      />,
    );
    const available = screen.getAllByText("Available");
    expect(available.length).toBeGreaterThan(0);
  });

  it("shows No data when data is missing", () => {
    render(<DataFreshness data={{}} {...baseProps} />);
    const noData = screen.getAllByText("No data");
    expect(noData.length).toBe(5);
  });
});
