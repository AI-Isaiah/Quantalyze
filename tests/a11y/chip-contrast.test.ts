import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 170 / CHIP — grey data-state chips on bg-track.
 *
 * Luminance trio copied verbatim from tests/a11y/palette-contrast.test.ts
 * (the repo's "don't hand-roll, except this helper"). The gate reads the
 * real tokens from globals.css and the real class pairs from the two chip
 * sources, so a revert to text-text-muted (4.34:1) fails here. The 164.9.4
 * e2e-seeded axe color-contrast check is the end gate.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

const CHIP_SOURCES = [
  "src/app/(dashboard)/allocations/components/CoverageStateChip.tsx",
  "src/components/strategy/StrategyTable.tsx",
] as const;

function readRepo(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8");
}

function tokenHex(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!match?.[1]) throw new Error(`globals.css is missing --${name}`);
  return match[1];
}

/** Every `text-text-<x> bg-track` pairing, in source order. */
function textOnTrack(source: string): string[] {
  const found: string[] = [];
  const re = /text-text-([a-z0-9-]+)\s+bg-track/g;
  for (const match of source.matchAll(re)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

describe("grey data-state chip contrast (170 CHIP)", () => {
  const css = readRepo("src/app/globals.css");
  const secondary = tokenHex(css, "color-text-secondary");
  const muted = tokenHex(css, "color-text-muted");
  const track = tokenHex(css, "color-track");

  it("reads two secondary-on-track pairs per chip file, each at least 4.5:1", () => {
    for (const file of CHIP_SOURCES) {
      const pairs = textOnTrack(readRepo(file));
      expect(pairs, file).toHaveLength(2);
      expect(pairs, file).toEqual(["secondary", "secondary"]);
      for (const tone of pairs) {
        const fg = tokenHex(css, `color-text-${tone}`);
        expect(
          getContrastRatio(fg, track),
          `${file} text-text-${tone} on bg-track`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("still distinguishes muted-on-track, which stays below 4.5:1", () => {
    // 4.344 at the locked tokens. If this climbs to 4.5 the gate no longer
    // tells a revert from the fix.
    expect(getContrastRatio(muted, track)).toBeLessThan(4.5);
    expect(getContrastRatio(secondary, track)).toBeGreaterThanOrEqual(4.5);
  });
});
