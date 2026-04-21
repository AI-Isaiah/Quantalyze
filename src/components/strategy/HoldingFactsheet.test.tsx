/**
 * Phase 09 / Task 2 — HoldingFactsheet unit tests (finding g4).
 *
 * TDD RED phase: tests written before implementation.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoldingFactsheet } from "./HoldingFactsheet";
import type { HoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";

const SAMPLE: HoldingCompareItem = {
  kind: "holding",
  holding_ref: "holding:binance:BTC:spot",
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  analytics: {
    cumulative_return: 0.42,
    sharpe: 1.8,
    max_drawdown: -0.15,
    vol: 0.55,
  },
};

describe("HoldingFactsheet (finding g4)", () => {
  it("renders 'Holding' header badge", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.getByText(/Holding/i)).toBeInTheDocument();
  });

  it("renders ticker + venue + holding_type", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText(/binance/i)).toBeInTheDocument();
    expect(screen.getByText(/spot/i)).toBeInTheDocument();
  });

  it("renders all four computed metric labels", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    // Labels (DM Sans typography expected via DESIGN.md — tests validate presence not class)
    expect(screen.getByText(/cumulative|return/i)).toBeInTheDocument();
    expect(screen.getByText(/sharpe/i)).toBeInTheDocument();
    expect(screen.getByText(/drawdown/i)).toBeInTheDocument();
    expect(screen.getByText(/vol/i)).toBeInTheDocument();
  });

  it("renders em-dash for null metrics", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: {
        cumulative_return: null,
        sharpe: null,
        max_drawdown: null,
        vol: null,
      },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("exposes data-testid='holding-factsheet' on root", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
  });
});
