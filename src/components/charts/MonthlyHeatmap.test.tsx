import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MonthlyHeatmap } from "./MonthlyHeatmap";

/**
 * Phase 14b-02 / DESIGN-01 — MonthlyHeatmap identity audit.
 *
 * Tests:
 *   8. For value 0.07, rendered cell has style.backgroundColor='#16A34A',
 *      style.opacity≈0.7 (NOT bg-emerald-400). For value -0.07,
 *      backgroundColor='#DC2626', opacity≈0.7. NO bg-emerald-* / bg-red-*
 *      Tailwind class anywhere.
 *   9. font-medium scan: file source contains zero `font-medium` matches.
 */

describe("MonthlyHeatmap — DESIGN-01 identity (14b-02)", () => {
  it("Test 8: cell uses inline-style hex + opacity; no bg-emerald/red Tailwind classes", () => {
    const data = {
      "2024": {
        Jan: 0.07,   // expect #16A34A @ 0.7
        Feb: -0.07,  // expect #DC2626 @ 0.7
        Mar: 0.0,    // expect #FFFFFF @ 1.0
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
    expect(janCell?.style.backgroundColor).toMatch(/#16A34A|rgb\(22,\s*163,\s*74\)/i);
    expect(parseFloat(janCell?.style.opacity ?? "1")).toBeCloseTo(0.7, 2);

    // Find the Feb cell (negative -0.07).
    const febCell = Array.from(container.querySelectorAll('div[title="-7.0%"]'))[0] as HTMLElement | undefined;
    expect(febCell).toBeDefined();
    expect(febCell?.style.backgroundColor).toMatch(/#DC2626|rgb\(220,\s*38,\s*38\)/i);
    expect(parseFloat(febCell?.style.opacity ?? "1")).toBeCloseTo(0.7, 2);
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
