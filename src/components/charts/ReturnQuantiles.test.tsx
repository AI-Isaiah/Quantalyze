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

/**
 * Phase 170.1.3 NARROWCHARTS (D-02, D-03c): the y tick labels are drawn whole.
 *
 * Why: the mobile arm bumps the y font to 22 inside a 600-wide viewBox whose left gutter is 60.
 * "-1.0%" is 5 * 22 * 0.6 = 66 wide and ends 8 left of the plot, so its box started 6 units
 * below the svg's left edge and the composer's phone reading showed it cut. The gutter grows
 * to the widest label plus the 8-unit gap, rounded up to the 4-unit ladder, so the label keeps
 * its right alignment against the axis. Desktop labels fit in 60, so desktop is unchanged.
 * Every expected number is typed by hand.
 */
describe("ReturnQuantiles y tick labels stay inside the svg (170.1.3 D-03c)", () => {
  // One period whose min and max are +-1%: the mobile y labels are "-1.0%", "0.0%", "1.0%".
  const NARROW: Record<string, number[]> = { All: [-0.01, -0.004, 0, 0.004, 0.01] };

  const yLabelTexts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("text[font-family]")) as SVGTextElement[];

  it("mobile: the gutter grows to 76 so the widest label (66 wide) starts at x = 2, not -6", () => {
    setBreakpoint("mobile");
    const { container } = render(<ReturnQuantiles data={NARROW} />);
    const texts = yLabelTexts(container);
    expect(texts.map((t) => t.textContent)).toEqual(["-1.0%", "0.0%", "1.0%"]);
    for (const t of texts) {
      // Right-aligned against the axis (gutter 76 minus the 8 gap).
      expect(t.getAttribute("text-anchor")).toBe("end");
      expect(t.getAttribute("x")).toBe("68");
      // The widest label is 5 chars * 22 * 0.6 = 66 wide: its left edge 68 - 66 = 2 >= 0.
      const w = (t.textContent ?? "").length * 22 * 0.6;
      expect(68 - w).toBeGreaterThanOrEqual(0);
    }
    const grid = container.querySelector("line[stroke='#F1F5F9']");
    expect(grid?.getAttribute("x1")).toBe("76");
  });

  it("desktop: the gutter stays 60 and labels stay at x = 52 (labels fit, nothing moves)", () => {
    setBreakpoint("desktop");
    const { container } = render(<ReturnQuantiles data={NARROW} />);
    for (const t of yLabelTexts(container)) expect(t.getAttribute("x")).toBe("52");
    expect(container.querySelector("line[stroke='#F1F5F9']")?.getAttribute("x1")).toBe("60");
  });
});
