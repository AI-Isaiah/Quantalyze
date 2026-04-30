import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeMixSubPanel } from "./TradeMixSubPanel";

/**
 * TradeMixSubPanel tests.
 *
 * Covers 2-bucket horizontal-bar render, percent + raw count
 * label-OUTSIDE-bar layout, auto-detection of 4-bucket from buckets
 * shape (KPI-17 v0.17.1 flip), the empty state, the section
 * break/border classes, and the H3 styling.
 */
describe("TradeMixSubPanel", () => {
  it("Test 6: 2-bucket render — Long 64% / Short 36% bars with #1B6B5A and #94A3B8 fills", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 1247, total_notional: 1 },
          short: { count: 701, total_notional: 1 },
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
          long: { count: 1247, total_notional: 1 },
          short: { count: 701, total_notional: 1 },
        }}
      />,
    );
    expect(screen.getByText("(1,247 fills)")).not.toBeNull();
    expect(screen.getByText("(701 fills)")).not.toBeNull();
  });

  it("Test 8: 2-bucket buckets shape renders 2 bars", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 100, total_notional: 1 },
          short: { count: 100, total_notional: 1 },
        }}
      />,
    );
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(2);
  });

  it("Test 9: 4-bucket buckets shape renders 4 bars (KPI-17 v0.17.1 flip)", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long_maker: { count: 100, total_notional: 1 },
          long_taker: { count: 200, total_notional: 1 },
          short_maker: { count: 50, total_notional: 1 },
          short_taker: { count: 150, total_notional: 1 },
        }}
      />,
    );
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(4);

    // total = 500. Bars: 20%, 40%, 10%, 30%.
    expect((bars[0] as HTMLElement).style.width).toBe("20%");
    expect((bars[1] as HTMLElement).style.width).toBe("40%");
    expect((bars[2] as HTMLElement).style.width).toBe("10%");
    expect((bars[3] as HTMLElement).style.width).toBe("30%");

    // Long maker = solid CHART_ACCENT (#1B6B5A); long taker = same color, 0.6 opacity.
    expect((bars[0] as HTMLElement).style.backgroundColor).toBe("rgb(27, 107, 90)");
    expect((bars[0] as HTMLElement).style.opacity).toBe("1");
    expect((bars[1] as HTMLElement).style.backgroundColor).toBe("rgb(27, 107, 90)");
    expect((bars[1] as HTMLElement).style.opacity).toBe("0.6");

    // Short maker = solid CHART_TEXT_MUTED (#94A3B8); short taker = same, 0.6 opacity.
    expect((bars[2] as HTMLElement).style.backgroundColor).toBe("rgb(148, 163, 184)");
    expect((bars[2] as HTMLElement).style.opacity).toBe("1");
    expect((bars[3] as HTMLElement).style.backgroundColor).toBe("rgb(148, 163, 184)");
    expect((bars[3] as HTMLElement).style.opacity).toBe("0.6");

    // All 4 labels render
    expect(screen.getByText("Long maker")).not.toBeNull();
    expect(screen.getByText("Long taker")).not.toBeNull();
    expect(screen.getByText("Short maker")).not.toBeNull();
    expect(screen.getByText("Short taker")).not.toBeNull();
  });

  it("Test 9b: 4-bucket render with all-taker fills (OKX prod shape) — maker bars at 0%", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long_maker: { count: 0, total_notional: 0 },
          long_taker: { count: 120, total_notional: 1 },
          short_maker: { count: 0, total_notional: 0 },
          short_taker: { count: 80, total_notional: 1 },
        }}
      />,
    );
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(4);
    expect((bars[0] as HTMLElement).style.width).toBe("0%");
    expect((bars[1] as HTMLElement).style.width).toBe("60%");
    expect((bars[2] as HTMLElement).style.width).toBe("0%");
    expect((bars[3] as HTMLElement).style.width).toBe("40%");
  });

  it("Test 9c: 4-bucket buckets with total=0 falls back to empty-state message", () => {
    const { container } = render(
      <TradeMixSubPanel
        buckets={{
          long_maker: { count: 0, total_notional: 0 },
          long_taker: { count: 0, total_notional: 0 },
          short_maker: { count: 0, total_notional: 0 },
          short_taker: { count: 0, total_notional: 0 },
        }}
      />,
    );
    const bars = container.querySelectorAll("[data-trade-mix-bar]");
    expect(bars.length).toBe(0);
    expect(
      screen.getByText("Trade mix unavailable for this strategy."),
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

  it("Test 13: approximate=true renders the 'Approximate — close-shorts bucketed by fill side' chip", () => {
    render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 100, total_notional: 1 },
          short: { count: 50, total_notional: 1 },
        }}
        approximate={true}
      />,
    );
    expect(
      screen.getByText("Approximate — close-shorts bucketed by fill side"),
    ).not.toBeNull();
  });

  it("Test 14: approximate omitted/false suppresses the chip", () => {
    const { rerender } = render(
      <TradeMixSubPanel
        buckets={{
          long: { count: 100, total_notional: 1 },
          short: { count: 50, total_notional: 1 },
        }}
      />,
    );
    expect(screen.queryByText(/Approximate/)).toBeNull();

    rerender(
      <TradeMixSubPanel
        buckets={{
          long: { count: 100, total_notional: 1 },
          short: { count: 50, total_notional: 1 },
        }}
        approximate={false}
      />,
    );
    expect(screen.queryByText(/Approximate/)).toBeNull();
  });
});
