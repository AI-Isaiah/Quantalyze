import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 199 CONTRAST — every tinted chip tone is AA on its own tint.
 *
 * Badge's tone maps, and OwnershipTag's INK map, pair `bg-<token>/<alpha>`
 * with `text-<token>`. The raw badge tokens are 1.99-4.27:1 on their own /10
 * tint (axe color-contrast flagged /strategies at 12.48px), so the gate reads
 * the real class strings from source and the real hexes from globals.css and
 * asserts >= 4.5:1 for every pair, tint composited over white (surface).
 * Luminance trio copied verbatim from tests/a11y/chip-contrast.test.ts.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgb(hex: string): [number, number, number] {
  const cleaned = hex.replace("#", "");
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  return (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
}

/** Token at `alpha` percent over white, rounded per channel like the browser. */
function tintOverWhite(hex: string, alphaPct: number): [number, number, number] {
  const a = alphaPct / 100;
  const [r, g, b] = rgb(hex);
  return [r, g, b].map((v) => Math.round(255 * (1 - a) + v * a)) as [
    number,
    number,
    number,
  ];
}

function readRepo(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf-8");
}

function tokenHex(css: string, name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!match?.[1]) throw new Error(`globals.css is missing --color-${name}`);
  return match[1];
}

const SOURCES = [
  { file: "src/components/ui/Badge.tsx", minPairs: 15 },
  { file: "src/components/strategy/OwnershipTag.tsx", minPairs: 2 },
  { file: "src/components/exchanges/allocator-sync-pill-styles.ts", minPairs: 4 },
] as const;

/**
 * Every `bg-<token>/<alpha> text-<token>` pairing, in source order. Also reads
 * the sync-pill map's `{ bg: "bg-<token>/<alpha>", text: "text-<token>" }` shape.
 */
function tintedPairs(source: string): Array<{ bg: string; alpha: number; fg: string }> {
  const re = /bg-([a-z-]+)\/(\d+)(?:",\s*text:\s*")?\s*text-([a-z-]+)/g;
  return [...source.matchAll(re)].map((m) => ({
    bg: m[1]!,
    alpha: Number(m[2]),
    fg: m[3]!,
  }));
}

describe("tinted chip tone contrast (199 CONTRAST)", () => {
  const css = readRepo("src/app/globals.css");

  for (const { file, minPairs } of SOURCES) {
    it(`${file}: every tone's text is at least 4.5:1 on its own tint`, () => {
      const pairs = tintedPairs(readRepo(file));
      expect(pairs.length, `${file} pair count`).toBeGreaterThanOrEqual(minPairs);
      for (const { bg, alpha, fg } of pairs) {
        const ratio = getContrastRatio(
          rgb(tokenHex(css, fg)),
          tintOverWhite(tokenHex(css, bg), alpha),
        );
        expect(
          ratio,
          `${file} text-${fg} on bg-${bg}/${alpha} = ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
