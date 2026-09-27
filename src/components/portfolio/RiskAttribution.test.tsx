import type React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RiskAttribution } from "./RiskAttribution";

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
          { strategy_id: "a", strategy_name: "Yield A", marginal_risk_pct: null, weight_pct: 0.5, standalone_vol: 0 },
          { strategy_id: "b", strategy_name: "Yield B", marginal_risk_pct: null, weight_pct: 0.5, standalone_vol: 0 },
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
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Alpha", marginal_risk_pct: 0.8, weight_pct: 0.3, standalone_vol: 0.2 },
          { strategy_id: "b", strategy_name: "Beta", marginal_risk_pct: 0.2, weight_pct: 0.7, standalone_vol: 0.1 },
        ]}
      />,
    );
    expect(screen.getByText("Overweight risk")).toBeInTheDocument();
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });
});
