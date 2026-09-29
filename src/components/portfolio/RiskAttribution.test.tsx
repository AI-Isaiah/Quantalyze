import type React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RiskAttribution } from "./RiskAttribution";
import { adaptPortfolioAnalytics } from "@/lib/portfolio-analytics-adapter";
import complete from "@/__tests__/fixtures/portfolio-analytics/complete.json";

// The stacked bar is not under test here; render its containers as plain
// wrappers so jsdom does not need a measured layout.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const NullComponent = () => null;
  return {
    ResponsiveContainer: Passthrough,
    BarChart: Passthrough,
    Bar: NullComponent,
    XAxis: NullComponent,
    YAxis: NullComponent,
  };
});
vi.mock("@/components/charts/TouchTooltip", () => ({ TouchTooltip: () => null }));

/** The producer's rows, parsed exactly as `/portfolios/[id]` parses them. */
function producerRows() {
  const parsed = adaptPortfolioAnalytics(complete);
  const rows = parsed?.risk_decomposition;
  if (!rows || rows.length !== 3) {
    throw new Error("complete.json no longer carries the three-row risk_decomposition this test reads");
  }
  return rows;
}

/** Strategy | Weight % | Risk % | Standalone Vol | Assessment, for one strategy's row. */
function cellsOf(strategyName: string): HTMLElement[] {
  const row = screen.getByText(strategyName).closest("tr");
  expect(row).not.toBeNull();
  return within(row as HTMLElement).getAllByRole("cell");
}

/**
 * 169 D-49 (routed 2026-09-26, R1). The producer
 * (`analytics-service/services/portfolio_risk.py` `compute_risk_decomposition`,
 * `analytics-service/routers/portfolio.py`) sends `marginal_risk_pct` and
 * `weight_pct` in PERCENT, 0 to 100, and the adapter passes them through
 * unchanged. `formatPercent` takes a FRACTION, so a 28% risk share fed straight
 * to it rendered "+2800.00%". These rows come from the adapter's own fixture,
 * so a unit drift at the producer's end or at this component reddens here.
 * Weights and shares are an unsigned domain: no "+".
 */
describe("<RiskAttribution> — the producer's percent shape (169 D-49)", () => {
  it("renders each weight and risk share once, unsigned, at 1 decimal place", () => {
    const rows = producerRows();
    render(<RiskAttribution data={rows} />);

    const expected = [
      { weight: "40.0%", share: "28.0%" },
      { weight: "35.0%", share: "58.0%" },
      { weight: "25.0%", share: "14.0%" },
    ];
    rows.forEach((row, i) => {
      const cells = cellsOf(row.strategy_name);
      expect(cells[1].textContent).toBe(expected[i].weight);
      expect(cells[2].textContent).toBe(expected[i].share);
      // The Standalone Vol cell (index 3) is left alone (D-49), so the
      // no-sign / no-double-scale checks are scoped to the two percent cells.
      for (const cell of [cells[1], cells[2]]) {
        expect(cell.textContent).not.toContain("+");
        expect(cell.textContent).not.toMatch(/\d{3,}\.\d%/);
      }
    });
  });

  it("assesses each row percent against percent: Balanced, Overweight risk, Balanced", () => {
    const rows = producerRows();
    render(<RiskAttribution data={rows} />);

    // 28 <= 40 x 1.3; 58 > 35 x 1.3 (45.5); 14 <= 25 x 1.3.
    const expected = ["Balanced", "Overweight risk", "Balanced"];
    rows.forEach((row, i) => {
      expect(cellsOf(row.strategy_name)[4].textContent).toBe(expected[i]);
    });
  });
});

/**
 * 166.1 D7 (founder 2026-09-26) / round-1 SFH MEDIUM-2. A portfolio that
 * carries no risk (two constant yields, or all-zero legs) has no risk share to
 * apportion, so the producer emits `marginal_risk_pct: null`. The table must
 * show "—" for the share and for the assessment. Before, the share arrived as
 * 0 and the row read "+0.00%" and "Balanced": a claim about a split that does
 * not exist.
 */
describe("<RiskAttribution> — a risk share that does not exist", () => {
  it("renders a null risk share and its assessment as a colorless dash", () => {
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Yield A", marginal_risk_pct: null, weight_pct: 50, standalone_vol: 0 },
          { strategy_id: "b", strategy_name: "Yield B", marginal_risk_pct: null, weight_pct: 50, standalone_vol: 0 },
        ]}
      />,
    );
    const row = screen.getByText("Yield A").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement).getAllByRole("cell");
    // Strategy | Weight % | Risk % | Standalone Vol | Assessment
    expect(cells[2].textContent).toBe("—");
    expect(cells[4].textContent).toBe("—");
    expect(within(row as HTMLElement).queryByText("Balanced")).toBeNull();
    expect(within(row as HTMLElement).queryByText("Overweight risk")).toBeNull();
    expect(cells[4].querySelector(".text-positive, .text-negative")).toBeNull();
  });

  it("keeps the assessment for a real risk share", () => {
    // Percent, as the producer sends it (169 D-49): 80 > 30 x 1.3 (39) is
    // overweight; 20 <= 70 x 1.3 (91) is balanced.
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Alpha", marginal_risk_pct: 80, weight_pct: 30, standalone_vol: 0.2 },
          { strategy_id: "b", strategy_name: "Beta", marginal_risk_pct: 20, weight_pct: 70, standalone_vol: 0.1 },
        ]}
      />,
    );
    expect(cellsOf("Alpha")[4].textContent).toBe("Overweight risk");
    expect(cellsOf("Beta")[4].textContent).toBe("Balanced");
  });
});
