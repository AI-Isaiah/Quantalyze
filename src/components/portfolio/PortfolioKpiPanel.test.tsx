import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioKpiPanel } from "./PortfolioKpiPanel";
import {
  formatCurrency,
  formatPercent,
  formatNumber,
} from "@/lib/utils";
import type { PortfolioAnalytics } from "@/lib/types";

/**
 * Phase 100 / 100-03 (PI-06) — field-mapping regression for the KpiStrip →
 * KpiPanel fold. The adapter replaced the deleted centered-Cards KPI row at
 * `portfolios/[id]/page.tsx:291`; this suite is the no-regress contract that
 * the fold changed presentation ONLY, never a value / label / color.
 *
 * Threat T-100-08 (silent value drift MTD/YTD/AUM): the tests below fail if
 *   - MTD is relabeled YTD,
 *   - the AUM cell is dropped,
 *   - any value stops matching the SAME formatters the deleted row used
 *     (formatCurrency / formatPercent / formatNumber; null → "—"),
 *   - the correlationColor ≥0.7-red pre-existing risk signal regresses.
 */

// Fixed fixture: mixed real + null values, and a correlation in the ≥0.7 band
// so the pre-existing correlationColor red case is asserted.
const FIXTURE = {
  total_aum: 1_500_000, // formatCurrency → "$1.5M"
  return_mtd: 0.0234, // formatPercent → "+2.34%", metricColor → text-positive
  avg_pairwise_correlation: 0.75, // formatNumber → "0.75", correlationColor ≥0.7 → text-negative
  portfolio_sharpe: null, // formatNumber(null) → "—", metricColor(null) → text-text-muted
} as PortfolioAnalytics;

/** Extract [label, valueEl] pairs from the rendered KpiPanel group, in order. */
function readCells() {
  const group = screen.getByRole("group", { name: "Portfolio KPIs" });
  return Array.from(group.children).map((cell) => {
    const divs = cell.querySelectorAll("div");
    return {
      label: divs[0]?.textContent ?? null,
      valueEl: cell.querySelector<HTMLDivElement>("div.font-mono"),
    };
  });
}

describe("PortfolioKpiPanel — field-mapping no-regress (T-100-08)", () => {
  it("renders exactly 4 cells in canonical order, AUM first (AUM is NOT dropped)", () => {
    render(<PortfolioKpiPanel analytics={FIXTURE} />);
    const labels = readCells().map((c) => c.label);
    expect(labels).toEqual([
      "AUM",
      "MTD TWR",
      "Avg Correlation",
      "Portfolio Sharpe",
    ]);
  });

  it("MTD label stays MTD — never relabeled YTD", () => {
    render(<PortfolioKpiPanel analytics={FIXTURE} />);
    expect(screen.getByText("MTD TWR")).toBeTruthy();
    // Hard fail if any cell were labeled YTD.
    expect(screen.queryByText("YTD TWR")).toBeNull();
    expect(screen.queryByText(/YTD/)).toBeNull();
  });

  it("values are byte-identical to the deleted row's formatters (null → '—')", () => {
    render(<PortfolioKpiPanel analytics={FIXTURE} />);
    const cells = readCells();
    // AUM via formatCurrency
    expect(cells[0].valueEl?.textContent).toBe(
      formatCurrency(FIXTURE.total_aum),
    );
    expect(cells[0].valueEl?.textContent).toBe("$1.5M");
    // MTD TWR via formatPercent
    expect(cells[1].valueEl?.textContent).toBe(
      formatPercent(FIXTURE.return_mtd),
    );
    expect(cells[1].valueEl?.textContent).toBe("+2.34%");
    // Avg Correlation via formatNumber
    expect(cells[2].valueEl?.textContent).toBe(
      formatNumber(FIXTURE.avg_pairwise_correlation),
    );
    expect(cells[2].valueEl?.textContent).toBe("0.75");
    // Portfolio Sharpe null → em-dash
    expect(cells[3].valueEl?.textContent).toBe(
      formatNumber(FIXTURE.portfolio_sharpe),
    );
    expect(cells[3].valueEl?.textContent).toBe("—");
  });

  it("colors match the byte-identical contract (metricColor + correlationColor)", () => {
    render(<PortfolioKpiPanel analytics={FIXTURE} />);
    const cells = readCells();
    // AUM: neutral primary text.
    expect(cells[0].valueEl?.className).toContain("text-text-primary");
    // MTD positive → metricColor text-positive.
    expect(cells[1].valueEl?.className).toContain("text-positive");
    // Avg Correlation ≥0.7 → correlationColor text-negative (pre-existing
    // risk signal preserved VERBATIM — no-regress).
    expect(cells[2].valueEl?.className).toContain("text-negative");
    // Sharpe null → metricColor text-text-muted.
    expect(cells[3].valueEl?.className).toContain("text-text-muted");
  });

  it("correlationColor bands preserved verbatim across the ≥0.7 / ≥0.4 / <0.4 thresholds", () => {
    // ≥0.7 → red (asserted above); this pins the other two bands so a future
    // refactor can't silently shift the pre-existing risk-signal thresholds.
    const { rerender } = render(
      <PortfolioKpiPanel
        analytics={{ ...FIXTURE, avg_pairwise_correlation: 0.5 } as PortfolioAnalytics}
      />,
    );
    let corr = readCells()[2].valueEl;
    expect(corr?.className).toContain("text-text-secondary"); // 0.4–0.7 band

    rerender(
      <PortfolioKpiPanel
        analytics={{ ...FIXTURE, avg_pairwise_correlation: 0.2 } as PortfolioAnalytics}
      />,
    );
    corr = readCells()[2].valueEl;
    expect(corr?.className).toContain("text-positive"); // <0.4 band

    rerender(
      <PortfolioKpiPanel
        analytics={{ ...FIXTURE, avg_pairwise_correlation: null } as PortfolioAnalytics}
      />,
    );
    corr = readCells()[2].valueEl;
    expect(corr?.className).toContain("text-text-muted"); // null band
  });
});
