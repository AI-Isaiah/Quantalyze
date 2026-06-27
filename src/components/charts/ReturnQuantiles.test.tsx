import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

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
 *
 * Phase 47 Plan 04 / CHART-02 + CHART-03 — Wave-1 viewport-branch coverage.
 * ReturnQuantiles grew an `isMobile ? mobileValue : todaysLiteral` conditional
 * (viewBox height, axis/period fontSize, y-gridline density) when it was wrapped
 * in ResponsiveChartFrame. The branch-coverage ratchet (vitest.config.ts
 * branches ≥ 72) is a BLOCKING CI gate, so the new branch is exercised in the
 * SAME wave it was introduced: tests 8–10 below mock `useBreakpoint` and render
 * the chart with the hook forced to BOTH "desktop" and "mobile". They double as
 * a FALSIFIABLE desktop byte-identity assertion — the desktop render must keep
 * today's literal viewBox (0 0 600 200) and fontSize (10 y-tick / 11 period), so
 * mutating a desktop literal makes the assertion FAIL (the in-wave half of the
 * no-recompute proof; Plan 05 bakes the full Playwright golden).
 */

// Mock the breakpoint seam so each render can pick the branch deterministically.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { ReturnQuantiles } from "./ReturnQuantiles";

const mockedUseBreakpoint = vi.mocked(useBreakpoint);

function setBreakpoint(bp: "mobile" | "tablet" | "desktop") {
  mockedUseBreakpoint.mockReturnValue(bp);
}

const SAMPLE: Record<string, number[]> = {
  Daily: [-0.05, -0.01, 0.0, 0.01, 0.05],
  Weekly: [-0.10, -0.03, 0.01, 0.04, 0.10],
};

describe("ReturnQuantiles — DESIGN-01 identity (14b-02)", () => {
  beforeEach(() => {
    setBreakpoint("desktop");
  });

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

  it("Test 8 (Phase 47): desktop render keeps today's literal viewBox 0 0 600 200 + fontSize 10/11 (byte-identity)", () => {
    setBreakpoint("desktop");
    const { container } = render(<ReturnQuantiles data={SAMPLE} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Desktop viewBox MUST be today's literal — mutating VB_H_DESKTOP fails this.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 600 200");
    // Y-axis tick fonts (the mono labels) are today's literal 10 on desktop.
    const yTicks = Array.from(container.querySelectorAll("text[font-family]"));
    expect(yTicks.length).toBeGreaterThan(0);
    for (const t of yTicks) {
      expect(t.getAttribute("font-size")).toBe("10");
    }
    // Period labels (no font-family attr) are today's literal 11 on desktop.
    const periodLabels = Array.from(container.querySelectorAll("text:not([font-family])"));
    expect(periodLabels.length).toBe(Object.keys(SAMPLE).length);
    for (const t of periodLabels) {
      expect(t.getAttribute("font-size")).toBe("11");
    }
    // Desktop draws the full 5-gridline set (5 mono y-tick labels).
    expect(yTicks.length).toBe(5);
    // Parity-only: no interaction surface invented on this no-hover chart.
    expect(svg?.getAttribute("tabindex")).toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
  });

  it("Test 9 (Phase 47): mobile render bumps fonts, reduces gridlines, and raises the viewBox height", () => {
    setBreakpoint("mobile");
    const { container } = render(<ReturnQuantiles data={SAMPLE} />);
    const svg = container.querySelector("svg");
    // Taller mobile viewBox (portrait, CHART-03) — differs from the desktop literal.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 600 280");
    // Mobile y-tick + period fonts are bumped well above the desktop 10/11.
    const yTicks = Array.from(container.querySelectorAll("text[font-family]"));
    for (const t of yTicks) {
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(20);
    }
    const periodLabels = Array.from(container.querySelectorAll("text:not([font-family])"));
    for (const t of periodLabels) {
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(20);
    }
    // Reduced y-gridline density (5 → 3) so the bumped labels have room at 320px.
    expect(yTicks.length).toBe(3);
    // Still no interaction surface on the no-hover chart.
    expect(svg?.getAttribute("tabindex")).toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
  });

  it("Test 10 (Phase 47): mobile viewBox height differs from desktop (the conditional is LIVE, not dead)", () => {
    setBreakpoint("desktop");
    const { container: desktop } = render(<ReturnQuantiles data={SAMPLE} />);
    const desktopVB = desktop.querySelector("svg")?.getAttribute("viewBox");
    setBreakpoint("mobile");
    const { container: mobile } = render(<ReturnQuantiles data={SAMPLE} />);
    const mobileVB = mobile.querySelector("svg")?.getAttribute("viewBox");
    expect(desktopVB).not.toBe(mobileVB);
  });
});
