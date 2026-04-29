import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeMixSubPanel } from "./TradeMixSubPanel";

/**
 * Phase 14b-04 Task 1 — TradeMixSubPanel tests.
 *
 * Tests 6–12 cover 2-bucket horizontal-bar render, percent + raw count
 * label-OUTSIDE-bar layout, default `mode='2-bucket'`, the descoped
 * 4-bucket fallback message (KPI-17 partial — v0.17.1 flip), the empty
 * state, the section break/border classes, and the H3 styling.
 */
describe("TradeMixSubPanel — Phase 14b-04 Task 1", () => {
  it("Test 6: 2-bucket render — Long 64% / Short 36% bars with #1B6B5A and #94A3B8 fills", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 1247, total_notional: 1, avg_holding_period_hours: 0 },
          short: { count: 701, total_notional: 1, avg_holding_period_hours: 0 },
        }}
      />,
    );

    // 2 bars rendered
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(2);

    // Long bar: 64% width, CHART_ACCENT fill
    const longBar = bars[0] as HTMLElement;
    expect(longBar.style.width).toBe("64%");
    expect(longBar.style.backgroundColor).toBe("rgb(27, 107, 90)");

    // Short bar: 36% width, CHART_TEXT_MUTED fill
    const shortBar = bars[1] as HTMLElement;
    expect(shortBar.style.width).toBe("36%");
    expect(shortBar.style.backgroundColor).toBe("rgb(148, 163, 184)");

    // Percent labels render OUTSIDE the bars (not nested inside)
    expect(longBar.textContent).toBe("");
    expect(shortBar.textContent).toBe("");
    expect(screen.getByText("64%")).not.toBeNull();
    expect(screen.getByText("36%")).not.toBeNull();
  });

  it("Test 7: raw counts render next to percent labels in 12px regular muted", () => {
    render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 1247, total_notional: 1, avg_holding_period_hours: 0 },
          short: { count: 701, total_notional: 1, avg_holding_period_hours: 0 },
        }}
      />,
    );
    expect(screen.getByText("(1,247 fills)")).not.toBeNull();
    expect(screen.getByText("(701 fills)")).not.toBeNull();
  });

  it("Test 8: mode prop defaults to '2-bucket' (no explicit mode)", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 100, total_notional: 1, avg_holding_period_hours: 0 },
          short: { count: 100, total_notional: 1, avg_holding_period_hours: 0 },
        }}
      />,
    );
    // Default mode renders 2 bars (not the 4-bucket fallback message)
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(2);
  });

  it("Test 9: mode='4-bucket' renders fallback message — NOT 4 bars (KPI-17 partial; v0.17.1)", () => {
    const { container } = render(
      <TradeMixSubPanel
        mode="4-bucket"
        buckets={{
          long_maker: { count: 100, total_notional: 1, avg_holding_period_hours: 0 },
          long_taker: { count: 100, total_notional: 1, avg_holding_period_hours: 0 },
          short_maker: { count: 100, total_notional: 1, avg_holding_period_hours: 0 },
          short_taker: { count: 100, total_notional: 1, avg_holding_period_hours: 0 },
        }}
      />,
    );
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(0);
    expect(
      screen.getByText("4-bucket maker/taker mode is reserved for v0.17.1."),
    ).not.toBeNull();
  });

  it("Test 10: empty state — renders heading + 'Trade mix unavailable for this strategy.'", () => {
    const { container } = render(<TradeMixSubPanel />);
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(0);
    expect(
      screen.getByText("Trade mix unavailable for this strategy."),
    ).not.toBeNull();
    // Heading still renders
    expect(screen.getByText("Trade mix")).not.toBeNull();
  });

  it("Test 11: container has mt-8 border-t border-border pt-6 (UI-SPEC §3.3 break)", () => {
    const { container } = render(<TradeMixSubPanel />);
    const root = container.firstElementChild as HTMLElement;
    const cls = root.getAttribute("class") ?? "";
    expect(cls).toContain("mt-8");
    expect(cls).toContain("border-t");
    expect(cls).toContain("border-border");
    expect(cls).toContain("pt-6");
  });

  it("Test 12: H3 'Trade mix' (sentence-case) with 12px uppercase tracking-wider text-text-secondary", () => {
    const { container } = render(<TradeMixSubPanel />);
    const h3 = container.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3?.textContent).toBe("Trade mix");
    const cls = h3?.getAttribute("class") ?? "";
    expect(cls).toContain("text-xs");
    expect(cls).toContain("font-normal");
    expect(cls).toContain("uppercase");
    expect(cls).toContain("tracking-wider");
    expect(cls).toContain("text-text-secondary");
  });
});
