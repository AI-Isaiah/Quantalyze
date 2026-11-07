import { describe, it, expect } from "vitest";
import { resolvePalette, paletteToCssVars } from "./palette";

/**
 * Phase 195 (D-06) — the dark palettes are deleted (DESIGN.md "Dark mode: Not
 * planned"); the COLORBLIND palette stays, and these pin that it still swaps
 * accent/positive/negative to Oxford Blue / Claret over the light base.
 */
describe("resolvePalette — light palette with a colorblind override", () => {
  it("default is the light palette (white base, Oxford-green accent)", () => {
    const p = resolvePalette({ colorblind: false });
    expect(p.base).toBe("#FFFFFF");
    expect(p.page).toBe("#F8F9FA");
    expect(p.accent).toBe("#1B6B5A");
    expect(p.negative).toBe("#DC2626");
  });

  it("colorblind swaps accent/positive to Oxford Blue and negative to Claret, keeping the light base", () => {
    const p = resolvePalette({ colorblind: true });
    expect(p.accent).toBe("#002554");
    expect(p.positive).toBe("#002554");
    expect(p.negative).toBe("#990019");
    expect(p.base).toBe("#FFFFFF");
    expect(p.surface).toBe("#FFFFFF");
  });
});

describe("paletteToCssVars — always a light colour scheme", () => {
  it("pins colorScheme light and the light text/track tokens, colorblind or not", () => {
    for (const colorblind of [false, true]) {
      const vars = paletteToCssVars(resolvePalette({ colorblind })) as Record<string, string>;
      expect(vars.colorScheme).toBe("light");
      expect(vars["--color-text"]).toBe("#1A1A2E");
      expect(vars["--color-track"]).toBe("#F1F5F9");
    }
  });
});
