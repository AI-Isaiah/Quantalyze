import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrategyMtdBars } from "./StrategyMtdBars";

const sampleRows = [
  { strategy_id: "a", strategy_name: "Aurora Trend", return_mtd: 0.032 },
  { strategy_id: "b", strategy_name: "Stellar Neutral", return_mtd: 0.024 },
  { strategy_id: "c", strategy_name: "Nebula Basis", return_mtd: 0.003 },
  { strategy_id: "d", strategy_name: "Orion L/S", return_mtd: -0.004 },
  { strategy_id: "e", strategy_name: "Pending", return_mtd: null },
];

describe("StrategyMtdBars", () => {
  it("renders all strategy names", () => {
    render(<StrategyMtdBars rows={sampleRows} />);
    expect(screen.getByText("Aurora Trend")).toBeInTheDocument();
    expect(screen.getByText("Stellar Neutral")).toBeInTheDocument();
    expect(screen.getByText("Nebula Basis")).toBeInTheDocument();
    expect(screen.getByText("Orion L/S")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("sorts winners above losers (DESC by return_mtd)", () => {
    const { container } = render(<StrategyMtdBars rows={sampleRows} />);
    const strategyNameCells = Array.from(
      container.querySelectorAll("p.text-text-primary"),
    );
    const names = strategyNameCells.map((el) => el.textContent);
    // Sorted order: Aurora (+3.2%) > Stellar (+2.4%) > Nebula (+0.3%)
    // > Orion (-0.4%) > Pending (null last).
    expect(names).toEqual([
      "Aurora Trend",
      "Stellar Neutral",
      "Nebula Basis",
      "Orion L/S",
      "Pending",
    ]);
  });

  it("renders an empty state when no rows are provided", () => {
    render(<StrategyMtdBars rows={[]} />);
    expect(screen.getByText(/No strategies in your book/i)).toBeInTheDocument();
  });

  it("renders the section heading", () => {
    render(<StrategyMtdBars rows={sampleRows} />);
    expect(screen.getByText("MTD Return by Strategy")).toBeInTheDocument();
  });

  it("exposes the bar panel via aria-label", () => {
    render(<StrategyMtdBars rows={sampleRows} />);
    expect(
      screen.getByLabelText("MTD return by strategy"),
    ).toBeInTheDocument();
  });
});
