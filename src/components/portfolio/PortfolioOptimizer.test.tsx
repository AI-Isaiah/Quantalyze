/**
 * PortfolioOptimizer — shared optimizer component mounted on BOTH /allocations
 * (via OptimizerPanel) and /portfolios/[id]. Red-team F-2 honesty regression:
 * the metric cells must NOT render unitless quantities as signed percentages.
 *
 *   - `corr_with_portfolio` is a -1..1 correlation → plain decimal ("0.45"),
 *     never "+45.00%".
 *   - `sharpe_lift` is a unitless Sharpe delta → signed decimal ("+0.15"),
 *     never "+15.00%".
 *   - `dd_improvement` IS a fraction of NAV → stays a percentage ("+3.00%").
 *
 * Because this is the shared component, the corrected formatting applies
 * identically on /portfolios/[id].
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PortfolioOptimizer, {
  type OptimizerSuggestion,
} from "./PortfolioOptimizer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const SUGGESTION: OptimizerSuggestion = {
  strategy_id: "s-1",
  strategy_name: "Uncorrelated Vol",
  corr_with_portfolio: 0.45,
  sharpe_lift: 0.15,
  dd_improvement: 0.03,
  score: 0.8,
};

/** The value <p> is the 2nd <p> inside the MetricCell that owns `label`. */
function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  const cell = labelEl.parentElement as HTMLElement;
  const ps = cell.querySelectorAll("p");
  return ps[1]?.textContent ?? "";
}

function renderOptimizer() {
  return render(
    <PortfolioOptimizer
      portfolioId="p1"
      initialSuggestions={[SUGGESTION]}
      computedAt="2026-07-11T00:00:00Z"
      computationStatus="complete"
    />,
  );
}

describe("PortfolioOptimizer metric formatting (F-2 honesty)", () => {
  it("renders correlation as a plain decimal, NOT a percentage", () => {
    renderOptimizer();
    const value = metricValue("Corr w/ portfolio");
    expect(value).toBe("0.45");
    expect(value).not.toMatch(/%/);
    expect(value).not.toBe("+45.00%"); // the old formatPercent output
  });

  it("renders Sharpe lift as a signed decimal, NOT a percentage", () => {
    renderOptimizer();
    const value = metricValue("Sharpe lift");
    expect(value).toBe("+0.15");
    expect(value).not.toMatch(/%/);
    expect(value).not.toBe("+15.00%"); // the old formatPercent output
  });

  it("keeps DD improve as a percentage (it IS a fraction of NAV)", () => {
    renderOptimizer();
    expect(metricValue("DD improve")).toBe("+3.00%");
  });

  it("does not render a raw correlation anywhere as a signed percentage", () => {
    const { container } = renderOptimizer();
    expect(container.textContent).not.toContain("+45.00%");
    expect(container.textContent).not.toContain("+15.00%");
  });
});
