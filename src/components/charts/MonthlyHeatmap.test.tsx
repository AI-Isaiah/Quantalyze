import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MonthlyHeatmap } from "./MonthlyHeatmap";

/**
 * Phase 14b-02 / DESIGN-01 — MonthlyHeatmap identity audit.
 *
 * Tests:
 *   8. For value 0.07, rendered cell has the saturated-positive bg
 *      (#15803D, green-700) AND no inline opacity (PR #108: opacity was
 *      collapsing fg/bg contrast to ~1:1, axe flagged 138 violations).
 *      For value -0.07, the saturated-negative bg (#B91C1C, red-700).
 *      NO bg-emerald-* / bg-red-* Tailwind class anywhere.
 *   9. font-medium scan: file source contains zero `font-medium` matches.
 */

describe("MonthlyHeatmap — DESIGN-01 identity (14b-02)", () => {
  it("Test 8: cell uses inline-style hex + zero opacity; no bg-emerald/red Tailwind classes", () => {
    const data = {
      "2024": {
        Jan: 0.07,   // expect #15803D (green-700, was 0.7 opacity)
        Feb: -0.07,  // expect #B91C1C (red-700, was 0.7 opacity)
        Mar: 0.0,    // expect #FFFFFF
      },
    };
    const { container } = render(<MonthlyHeatmap data={data} />);
    const html = container.innerHTML;
    // No legacy Tailwind palette classes anywhere in the rendered output.
    expect(/bg-emerald-\d+/.test(html)).toBe(false);
    expect(/bg-red-\d+/.test(html)).toBe(false);

    // Find the Jan cell (positive 0.07) and assert its style.
    const janCell = Array.from(container.querySelectorAll('div[title="7.0%"]'))[0] as HTMLElement | undefined;
    expect(janCell).toBeDefined();
    expect(janCell?.style.backgroundColor).toMatch(
      /#15803D|rgb\(21,\s*128,\s*61\)/i,
    );
    // Opacity must be unset (inline style empty) — see PR #108 contrast fix.
    expect(janCell?.style.opacity).toBe("");

    // Find the Feb cell (negative -0.07).
    const febCell = Array.from(container.querySelectorAll('div[title="-7.0%"]'))[0] as HTMLElement | undefined;
    expect(febCell).toBeDefined();
    expect(febCell?.style.backgroundColor).toMatch(
      /#B91C1C|rgb\(185,\s*28,\s*28\)/i,
    );
    expect(febCell?.style.opacity).toBe("");
  });

  it("Test 9: zero `font-medium` instances in MonthlyHeatmap.tsx source (DESIGN-02 type contract)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/MonthlyHeatmap.tsx"),
      "utf-8",
    );
    const matches = src.match(/\bfont-medium\b/g) ?? [];
    expect(matches.length).toBe(0);
  });
});
