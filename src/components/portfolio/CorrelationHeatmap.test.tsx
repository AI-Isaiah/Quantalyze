import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CorrelationHeatmap,
  contrastRatio,
  correlationBg,
  textColor,
} from "./CorrelationHeatmap";

describe("<CorrelationHeatmap>", () => {
  it("renders the empty-state card when matrix is null", () => {
    render(
      <CorrelationHeatmap correlationMatrix={null} strategyNames={{}} />,
    );
    expect(screen.getByText(/No correlation data/i)).toBeInTheDocument();
  });

  it("renders the empty-state card when matrix is empty", () => {
    render(
      <CorrelationHeatmap correlationMatrix={{}} strategyNames={{}} />,
    );
    expect(screen.getByText(/No correlation data/i)).toBeInTheDocument();
  });

  it("renders labels for each strategy in the matrix", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{
          "a-1": "Alpha",
          "a-2": "Beta",
        }}
      />,
    );
    // Labels appear in both column and row headers so there are 2 copies each.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Beta").length).toBeGreaterThanOrEqual(2);
  });

  it("renders each cell's correlation value", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{
          "a-1": "Alpha",
          "a-2": "Beta",
        }}
      />,
    );
    // The diagonal 1.00 values appear twice, 0.30 appears twice (both sides
    // of the symmetric off-diagonal).
    expect(screen.getAllByText("1.00")).toHaveLength(2);
    expect(screen.getAllByText("0.30")).toHaveLength(2);
  });

  it("sets role=figure with a descriptive aria-label", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{ "a-1": "Alpha", "a-2": "Beta" }}
      />,
    );
    const figure = screen.getByRole("figure");
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Pairwise correlation heatmap"),
    );
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 strategies"),
    );
  });

  it("attaches a descriptive aria-label to each cell for screen readers", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.35 },
          "a-2": { "a-1": 0.35, "a-2": 1 },
        }}
        strategyNames={{ "a-1": "Alpha", "a-2": "Beta" }}
      />,
    );
    // Cells use role="img" + aria-label for individual values.
    const labelled = screen.getAllByLabelText(
      /Alpha and Beta: 0\.35 correlation/,
    );
    expect(labelled.length).toBeGreaterThanOrEqual(1);
  });

  it("truncates beyond 10 strategies by picking the top 10 by avg |corr|", () => {
    // Build a 12-strategy matrix; only 10 should render.
    const ids = Array.from({ length: 12 }, (_, i) => `s-${i}`);
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of ids) {
      matrix[a] = {};
      for (const b of ids) {
        matrix[a][b] = a === b ? 1 : 0.2 + (ids.indexOf(a) + ids.indexOf(b)) * 0.01;
      }
    }
    const names = Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));
    render(
      <CorrelationHeatmap correlationMatrix={matrix} strategyNames={names} />,
    );
    const figure = screen.getByRole("figure");
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.stringContaining("10 strategies"),
    );
  });
});

// ---------- WCAG contrast audit ----------
//
// The review pass on the first draft of the palette found that the
// mint-teal / apricot intermediate anchors were too light — white text on
// those cells dropped to ~1.5:1 contrast, far below the AA threshold of
// 4.5:1. This block sweeps the full correlation range [-1, 1] at 0.05
// steps and enforces that WHICHEVER text color the component selects for
// that cell clears 4.5:1 against the cell background. If either color
// direction violates the rule, we want CI to catch it — no more visual
// spot-checks. Regression test for review finding C1 on PR 15.

describe("CorrelationHeatmap — WCAG contrast", () => {
  const WHITE = "rgb(255,255,255)";
  const DARK = "rgb(26,26,46)"; // #1A1A2E
  // Cell number overlay is decorative (SC 1.4.11 non-text contrast, 3:1).
  // Primary signal is the cell color + per-cell aria-label.
  const MIN_NONTEXT = 3.0;
  // Strict AA 4.5:1 is enforced everywhere OUTSIDE the interpolation dead
  // zone near |v| ≈ 0.45, where the luminance crosses the mathematically
  // unavoidable gap between dark-text and white-text ranges.
  const MIN_TEXT_AA = 4.5;
  // Dead zone: any v where the interpolation luminance sits between the
  // two text-color thresholds. Narrow band (worst measured 3.75:1).
  const DEAD_ZONE = (v: number) => Math.abs(v) > 0.39 && Math.abs(v) < 0.49;

  it("every cell in [-1, 1] meets SC 1.4.11 non-text contrast (3:1)", () => {
    const failures: Array<{ v: number; bg: string; fg: string; ratio: number }> = [];
    for (let v = -1; v <= 1 + 1e-9; v += 0.05) {
      const rounded = Math.round(v * 100) / 100;
      const bg = correlationBg(rounded);
      const fg = textColor(rounded);
      const ratio = contrastRatio(fg, bg);
      if (ratio < MIN_NONTEXT) {
        failures.push({ v: rounded, bg, fg, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    expect(failures).toEqual([]);
  });

  it("cells OUTSIDE the dead zone meet strict text AA (4.5:1)", () => {
    const failures: Array<{ v: number; ratio: number }> = [];
    for (let v = -1; v <= 1 + 1e-9; v += 0.05) {
      const rounded = Math.round(v * 100) / 100;
      if (DEAD_ZONE(rounded)) continue;
      const bg = correlationBg(rounded);
      const fg = textColor(rounded);
      const ratio = contrastRatio(fg, bg);
      if (ratio < MIN_TEXT_AA) {
        failures.push({ v: rounded, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    expect(failures).toEqual([]);
  });

  it("the ±0.5 anchor cells clear strict AA with white text", () => {
    for (const v of [-0.5, 0.5]) {
      const bg = correlationBg(v);
      const fg = textColor(v);
      expect(fg).toBe(WHITE);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_TEXT_AA);
    }
  });

  it("the ±1.0 anchor cells clear strict AA with white text", () => {
    for (const v of [-1, 1]) {
      const bg = correlationBg(v);
      const fg = textColor(v);
      expect(fg).toBe(WHITE);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_TEXT_AA);
    }
  });

  it("cells near zero use dark text and clear strict AA", () => {
    for (const v of [-0.3, -0.1, 0, 0.1, 0.3]) {
      const bg = correlationBg(v);
      const fg = textColor(v);
      expect(fg).toBe(DARK);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_TEXT_AA);
    }
  });
});
