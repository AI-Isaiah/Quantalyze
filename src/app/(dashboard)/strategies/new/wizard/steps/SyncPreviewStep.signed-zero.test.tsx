/**
 * Phase 170.6 DISPLAYPOLISH plan 10 (D-02, D-03): the wizard's sync preview prints
 * CAGR, Max DD, cumulative return, its metrics and the member contributions without a
 * signed zero, and colours a contribution from its rounded 1 dp value.
 *
 * Every expected string is typed by hand. Each "-0.0004" / "-0.004" input rounds to
 * zero at the precision the preview prints it; today each prints a "-" / "−" / "+".
 */
import { describe, it, expect } from "vitest";
import {
  contributionToneClass,
  formatCagr,
  formatContribution,
  formatMetric,
} from "./SyncPreviewStep";

describe("formatCagr (CAGR, Max DD, cumulative return) prints no signed zero", () => {
  it("0 prints 0.0%, not +0.0%", () => {
    expect(formatCagr(0)).toBe("0.0%");
  });
  it("-0.0004 prints 0.0%, not -0.0%", () => {
    expect(formatCagr(-0.0004)).toBe("0.0%");
  });
  it("a real gain keeps its plus and a real loss its minus", () => {
    expect(formatCagr(0.123)).toBe("+12.3%");
    expect(formatCagr(-0.123)).toBe("-12.3%");
  });
  it("null stays a dash", () => {
    expect(formatCagr(null)).toBe("—");
  });
});

describe("formatContribution prints no signed zero and keeps the U+2212 minus", () => {
  it("-0.0004 prints 0.0%, not −0.0%", () => {
    expect(formatContribution(-0.0004)).toBe("0.0%");
  });
  it("0 prints 0.0%, not +0.0%", () => {
    expect(formatContribution(0)).toBe("0.0%");
  });
  it("a real gain prints +5.0% and a real loss prints with U+2212", () => {
    expect(formatContribution(0.05)).toBe("+5.0%");
    expect(formatContribution(-0.05)).toBe("−5.0%");
  });
  it("null stays a dash, never a fabricated 0%", () => {
    expect(formatContribution(null)).toBe("—");
  });
});

describe("formatMetric prints no signed zero", () => {
  it("a Sharpe of -0.004 prints 0.00", () => {
    expect(formatMetric(-0.004)).toBe("0.00");
  });
  it("a volatility of -0.0004 prints 0.0%", () => {
    expect(formatMetric(-0.0004, "%")).toBe("0.0%");
  });
  it("real values keep their digits", () => {
    expect(formatMetric(1.87)).toBe("1.87");
    expect(formatMetric(-1.236)).toBe("-1.24");
    expect(formatMetric(0.2234, "%")).toBe("22.3%");
  });
  it("null and NaN stay a dash", () => {
    expect(formatMetric(null)).toBe("—");
    expect(formatMetric(Number.NaN)).toBe("—");
  });
});

describe("contributionToneClass colours on the rounded 1 dp sign (D-03)", () => {
  it("-0.0004 (prints 0.0%) is neither red nor green", () => {
    const cls = contributionToneClass(-0.0004);
    expect(cls).not.toContain("text-negative");
    expect(cls).not.toContain("text-positive");
    expect(cls).toBe("text-text-primary");
  });
  it("0 is neutral", () => {
    expect(contributionToneClass(0)).toBe("text-text-primary");
  });
  it("a real gain is positive, a real loss negative", () => {
    expect(contributionToneClass(0.05)).toBe("text-positive");
    expect(contributionToneClass(-0.05)).toBe("text-negative");
  });
  it("null stays muted", () => {
    expect(contributionToneClass(null)).toBe("text-text-muted");
  });
});
