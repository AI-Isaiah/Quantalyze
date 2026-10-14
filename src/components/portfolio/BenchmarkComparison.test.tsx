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

// Phase 170.6 plan 02 (D-02, D-03, D-05): the comparator panel colours a figure by the
// sign of the value ROUNDED to the 2 dp it prints, through the one utils tone helper.
describe("<BenchmarkComparison> rounded-sign tone (170.6 D-03)", () => {
  function alphaEl(alphaInputs: { portfolio_twr: number; benchmark_twr: number }) {
    render(
      <BenchmarkComparison
        benchmarkComparison={{
          symbol: "BTC",
          correlation: 0.5,
          stale: false,
          ...alphaInputs,
        }}
      />,
    );
    return screen.getByText("Alpha").nextElementSibling as HTMLElement;
  }

  it("an alpha of -0.00004 prints 0.00% and carries neither tone", () => {
    // 0.1 - 0.10004 = -0.00004 (alpha is the portfolio TWR minus the benchmark TWR).
    const el = alphaEl({ portfolio_twr: 0.1, benchmark_twr: 0.10004 });
    expect(el.textContent).toBe("0.00%");
    expect(el.className).not.toContain("text-negative");
    expect(el.className).not.toContain("text-positive");
  });

  it("an alpha of -0.05 prints -5.00% and is red", () => {
    const neg = alphaEl({ portfolio_twr: 0.1, benchmark_twr: 0.15 });
    expect(neg.textContent).toBe("-5.00%");
    expect(neg.className).toContain("text-negative");
  });

  it("an alpha of +0.05 prints +5.00% and is green", () => {
    const pos = alphaEl({ portfolio_twr: 0.15, benchmark_twr: 0.1 });
    expect(pos.textContent).toBe("+5.00%");
    expect(pos.className).toContain("text-positive");
  });
});
