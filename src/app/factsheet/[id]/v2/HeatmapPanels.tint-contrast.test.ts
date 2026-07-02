/**
 * Phase 60 regression — heatmap cell labels must meet WCAG AA (4.5:1).
 *
 * The composer-axe e2e (CI run 28608544275) caught `tintFor` flipping to white
 * text at intensity a > 0.55 while the mixed background in the a ≈ 0.55–0.95
 * band toward #DC2626 is too light for white at 4.5:1 (measured 3.62:1 on a
 * −19% month). The golden fixtures' near-zero cells never enter that band, so
 * only a real return series surfaces it. This sweep pins the WHOLE curve for
 * every palette variant: without the computed-contrast fix it fails at the
 * exact mid-band intensities axe flagged.
 */
import { describe, expect, it } from "vitest";
import { tintFor } from "./HeatmapPanels";
import { resolvePalette } from "./palette";

function relativeLuminance(color: string): number {
  const nums = color.startsWith("rgb")
    ? (color.match(/\d+/g)?.map(Number) as [number, number, number])
    : ([
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
      ] as [number, number, number]);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(nums[0]) + 0.7152 * lin(nums[1]) + 0.0722 * lin(nums[2]);
}

function contrastRatio(c1: string, c2: string): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const VARIANTS = [
  { darkMode: false, colorblind: false },
  { darkMode: true, colorblind: false },
  { darkMode: false, colorblind: true },
  { darkMode: true, colorblind: true },
] as const;

describe("tintFor — WCAG AA contrast sweep (heatmap labels are text-micro → 4.5:1)", () => {
  for (const mode of VARIANTS) {
    const p = resolvePalette(mode);
    const palette = { base: p.base, accent: p.accent, negative: p.negative };
    const label = `dark=${mode.darkMode} colorblind=${mode.colorblind}`;

    it(`every intensity from full-negative to full-positive passes 4.5:1 (${label})`, () => {
      const failures: string[] = [];
      // t = v/maxAbs swept in 1% steps; skips t=0 (var()-based fg, covered below).
      for (let i = -100; i <= 100; i++) {
        if (i === 0) continue;
        const v = i / 100;
        const { bg, fg } = tintFor(v, 1, palette);
        const ratio = contrastRatio(bg, fg);
        if (ratio < 4.5) {
          failures.push(`t=${v}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("t=0 and no-data cells keep their token-based colors (no regression of the neutral branch)", () => {
    const zero = tintFor(0, 1);
    expect(zero.fg).toBe("var(--color-text-muted)");
    const noData = tintFor(Number.NaN, 1);
    expect(noData.bg).toContain("var(--color-surface-subtle");
  });

  it("pins the exact cell axe flagged: −19% month at maxAbs≈0.21 now passes", () => {
    // CI run 28608544275: bg #e45757, white fg, 3.62:1 on "2025-08: -18.98%".
    const { bg, fg } = tintFor(-0.1898, 0.21);
    expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(4.5);
  });
});
