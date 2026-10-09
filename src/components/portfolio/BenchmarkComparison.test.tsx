import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenchmarkComparison } from "./BenchmarkComparison";
import { formatPercent } from "@/lib/utils";

// Phase 166.4.1 D-04 / D-05: the stored `benchmark_comparison.note` is the only
// carrier of WHY the BTC figures are empty (nothing on /portfolios/[id] reads
// data_quality). These strings are fixed by the compute (Plan 01) and must match.
const NOTE_THIN = "benchmark unavailable: fewer than 30 shared days";

describe("<BenchmarkComparison> stored note (D-04 / D-05)", () => {
  it("renders the stored note verbatim as a polite status line, with the BTC figures as em-dashes", () => {
    render(
      <BenchmarkComparison
        benchmarkComparison={{
          symbol: "BTC",
          correlation: null,
          benchmark_twr: null,
          portfolio_twr: 0.12,
          stale: false,
          note: NOTE_THIN,
        }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(NOTE_THIN);
    expect(status.textContent).toBe(NOTE_THIN);
    expect(status).toHaveAttribute("aria-live", "polite");

    // Numbers Contract: a null figure is an em-dash, never 0. BTC TWR, Alpha
    // (needs the benchmark) and Correlation are the three em-dashes.
    const dash = formatPercent(null);
    expect(screen.getAllByText(dash)).toHaveLength(3);
    expect(screen.getByText(formatPercent(0.12))).toBeInTheDocument();
  });
});
