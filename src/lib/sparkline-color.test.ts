/**
 * Phase 13 / Plan 13-04 / DISCO-04 — sparklineColor helper unit tests.
 *
 * These tests pin the DESIGN.md DIFF-05 single-accent rule:
 *   - sparkline_returns final value > 0  → var(--color-accent)
 *   - sparkline_returns final value < 0  → var(--color-negative)
 *   - sparkline_returns final value == 0 → var(--color-chart-benchmark)
 *   - empty / nullish input               → var(--color-chart-benchmark)
 *
 * The helper returns CSS variable strings (NOT hex literals) so the design
 * tokens remain the single source of truth — a token swap propagates to the
 * sparkline strokes without any code change here.
 */

import { describe, it, expect } from "vitest";
import { sparklineColor } from "./sparkline-color";

describe("sparklineColor", () => {
  it("returns var(--color-accent) when final value > 0", () => {
    expect(sparklineColor([0, 0.05, 0.1])).toBe("var(--color-accent)");
  });

  it("returns var(--color-negative) when final value < 0", () => {
    expect(sparklineColor([0, -0.02, -0.05])).toBe("var(--color-negative)");
  });

  it("returns var(--color-chart-benchmark) when final value === 0", () => {
    expect(sparklineColor([0.01, -0.01, 0])).toBe(
      "var(--color-chart-benchmark)",
    );
  });

  it("returns var(--color-chart-benchmark) on empty array", () => {
    expect(sparklineColor([])).toBe("var(--color-chart-benchmark)");
  });

  it("handles single-element arrays — value is also the final", () => {
    expect(sparklineColor([0.5])).toBe("var(--color-accent)");
    expect(sparklineColor([-0.5])).toBe("var(--color-negative)");
    expect(sparklineColor([0])).toBe("var(--color-chart-benchmark)");
  });

  it("ignores intermediate values — only the final value drives the color", () => {
    // Path goes positive → negative → positive, ends positive → accent.
    expect(sparklineColor([0.5, -0.3, 0.1])).toBe("var(--color-accent)");
    // Path goes positive → positive → negative, ends negative → negative.
    expect(sparklineColor([0.5, 0.3, -0.1])).toBe("var(--color-negative)");
  });
});
