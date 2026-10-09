import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenchmarkComparison } from "./BenchmarkComparison";
import { formatPercent } from "@/lib/utils";

// Phase 166.4.1 D-04 / D-05: the stored `benchmark_comparison.note` is the only
// carrier of WHY the BTC figures are empty (nothing on /portfolios/[id] reads
// data_quality). These strings are fixed by the compute (Plan 01) and must match.
const NOTE_STALE = "benchmark unavailable: stale";
const NOTE_THIN = "benchmark unavailable: fewer than 30 shared days";
const NOTE_ERROR = "benchmark unavailable: computation failed";

const empty = {
  symbol: "BTC",
  correlation: null,
  benchmark_twr: null,
  portfolio_twr: 0.12,
};

function classes(el: HTMLElement): string[] {
  return Array.from(el.classList);
}

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

// DESIGN.md Color: amber is recoverable disclosure, red is permanent failure
// only and never absence, muted is honest-empty. The decision is keyed on the
// stored `stale` boolean, not on the note string.
describe("<BenchmarkComparison> note colour by meaning", () => {
  it("stale note takes warning amber on the chip surface, never red", () => {
    render(
      <BenchmarkComparison
        benchmarkComparison={{ ...empty, stale: true, note: NOTE_STALE }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(NOTE_STALE);
    const c = classes(status);
    expect(c).toContain("text-warning");
    expect(c).toContain("bg-warning-bg");
    expect(c).toContain("border-warning-border");
    expect(c).not.toContain("text-negative");
  });

  it.each([
    ["thin", NOTE_THIN],
    ["crash", NOTE_ERROR],
  ])("%s note is muted: no amber, no red, no green", (_label, note) => {
    render(
      <BenchmarkComparison
        benchmarkComparison={{ ...empty, stale: false, note }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(note);
    const c = classes(status);
    expect(c).toContain("text-text-muted");
    expect(c).not.toContain("text-warning");
    expect(c).not.toContain("text-negative");
    expect(c).not.toContain("text-positive");
  });

  it("renders no status element without a note, and the grid keeps its four labels", () => {
    render(
      <BenchmarkComparison
        benchmarkComparison={{
          symbol: "BTC",
          correlation: 0.31,
          benchmark_twr: 0.12,
          portfolio_twr: 0.18,
          stale: false,
        }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    for (const label of ["Portfolio TWR", "BTC TWR", "Alpha", "Correlation"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("a null comparison still reads 'Benchmark data unavailable.' with no status element", () => {
    render(<BenchmarkComparison benchmarkComparison={null} />);
    expect(screen.getByText("Benchmark data unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never fabricates a zero: with every benchmark figure null no cell renders 0.00%", () => {
    render(
      <BenchmarkComparison
        benchmarkComparison={{ ...empty, stale: false, note: NOTE_THIN }}
      />,
    );
    expect(screen.queryByText("0.00%")).toBeNull();
    expect(screen.getAllByText(formatPercent(null)).length).toBeGreaterThanOrEqual(3);
  });
});
