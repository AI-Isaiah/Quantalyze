import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MonteCarloBandChart } from "./MonteCarloBandChart";
import type { MonteCarloBandPoint } from "../lib/scenario-montecarlo";

/**
 * Plan 27-02 — the band chart renders the data (outer + inner band + median) and
 * names itself for assistive tech without becoming a focus stop. It is purely
 * presentational; the honesty/correctness pins live in the lib test.
 */

function bands(n: number): MonteCarloBandPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const w = (i + 1) / n; // widening fan
    return {
      step: i + 1,
      q: { p5: -0.1 * w, p25: -0.05 * w, p50: 0.01 * w, p75: 0.06 * w, p95: 0.12 * w },
    };
  });
}

describe("MonteCarloBandChart", () => {
  it("renders the outer band, inner band, and median path", () => {
    const { getByTestId } = render(<MonteCarloBandChart bands={bands(60)} />);
    expect(getByTestId("montecarlo-band-chart")).toBeInTheDocument();
    expect(getByTestId("mc-band-outer")).toBeInTheDocument();
    expect(getByTestId("mc-band-inner")).toBeInTheDocument();
    expect(getByTestId("mc-median")).toBeInTheDocument();
  });

  it("is role=img with a text alt (named, not an empty keyboard focus stop)", () => {
    const { getByRole } = render(<MonteCarloBandChart bands={bands(60)} />);
    const svg = getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("interval"));
    expect(svg).not.toHaveAttribute("tabindex");
  });

  it("renders nothing for empty bands (the caller gates)", () => {
    const { container } = render(<MonteCarloBandChart bands={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
