import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReturnQuantiles } from "./ReturnQuantiles";

/**
 * Phase 14b-02 / DESIGN-01 — ReturnQuantiles identity audit.
 *
 * Tests:
 *   6. Box stroke + fill + median line all use #1B6B5A (CHART_ACCENT)
 *      — replacing legacy #0D9488. Whiskers KEEP #94A3B8 (CHART_TEXT_MUTED)
 *      because they are strokes, not text fills (A11Y-01 forbidden-as-text
 *      rule does NOT apply per UI-SPEC §5).
 *   7. Y-axis tick text uses CHART_FONT_MONO (var(--font-mono), monospace) —
 *      NOT the legacy "'JetBrains Mono', monospace" hand-rolled literal.
 */

const SAMPLE: Record<string, number[]> = {
  Daily: [-0.05, -0.01, 0.0, 0.01, 0.05],
  Weekly: [-0.10, -0.03, 0.01, 0.04, 0.10],
};

describe("ReturnQuantiles — DESIGN-01 identity (14b-02)", () => {
  it("Test 6: box rect stroke + fill use CHART_ACCENT '#1B6B5A'; whisker stroke stays '#94A3B8'", () => {
    const { container } = render(<ReturnQuantiles data={SAMPLE} />);
    const boxes = container.querySelectorAll("rect");
    expect(boxes.length).toBeGreaterThan(0);
    for (const r of Array.from(boxes)) {
      expect(r.getAttribute("fill")).toBe("#1B6B5A");
      expect(r.getAttribute("stroke")).toBe("#1B6B5A");
    }
    // Median line: stroke=#1B6B5A.
    // Whisker lines: stroke=#94A3B8.
    const lines = Array.from(container.querySelectorAll("line"));
    const accentStrokes = lines.filter((l) => l.getAttribute("stroke") === "#1B6B5A");
    const mutedStrokes = lines.filter((l) => l.getAttribute("stroke") === "#94A3B8");
    expect(accentStrokes.length).toBeGreaterThan(0);
    expect(mutedStrokes.length).toBeGreaterThan(0);
    // No legacy teal anywhere.
    const legacyStrokes = lines.filter((l) => l.getAttribute("stroke") === "#0D9488");
    expect(legacyStrokes.length).toBe(0);
  });

  it("Test 7: Y-axis tick text uses CHART_FONT_MONO (var(--font-mono), monospace)", () => {
    const { container } = render(<ReturnQuantiles data={SAMPLE} />);
    const yLabels = container.querySelectorAll('text[font-family]');
    expect(yLabels.length).toBeGreaterThan(0);
    let foundMono = false;
    for (const t of Array.from(yLabels)) {
      const ff = t.getAttribute("font-family") ?? "";
      if (ff.includes("var(--font-mono)")) {
        foundMono = true;
        break;
      }
    }
    expect(foundMono).toBe(true);
  });
});
