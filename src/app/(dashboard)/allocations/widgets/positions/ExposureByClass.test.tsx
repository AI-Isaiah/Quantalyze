import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExposureByClass } from "./ExposureByClass";
import type { ExposureSnapshot, ExposureSlice } from "@/lib/portfolio-exposure";

/**
 * PI-01 ExposureByClass — a segmented composition bar + KPI strip + drilldown
 * table (NOT a donut). These specs pin the 99-UI-SPEC design contract:
 * D-P2 signed math surfaced in the KPI strip, single-class honesty in the
 * legend, verbatim honest-empty copy, and the DESIGN.md no-red/green-on-
 * direction lock. Pure CSS — no recharts, no data fetching.
 */

function snap(slices: ExposureSlice[], overrides: Partial<ExposureSnapshot> = {}): ExposureSnapshot {
  const totalGrossUsd = slices.reduce((a, s) => a + s.valueUsd, 0);
  const totalNetUsd = slices.reduce((a, s) => a + s.signedValueUsd, 0);
  return { asof: "2026-07-11", slices, totalGrossUsd, totalNetUsd, ...overrides };
}

// Hedged book (D-P2): long $300K spot + short $100K derivative.
const HEDGED = snap([
  { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 300000, signedValueUsd: 300000 },
  { holdingType: "derivative", venue: "deribit", symbol: "BTC-PERP", side: "short", valueUsd: 100000, signedValueUsd: -100000 },
]);

describe("<ExposureByClass> — KPI strip (D-P2 signed math)", () => {
  it("renders GROSS/NET/LONG/SHORT for a hedged book with a 'net long' caption", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    expect(screen.getByTestId("kpi-gross").textContent).toBe("$400K");
    expect(screen.getByTestId("kpi-net").textContent).toBe("$200K");
    expect(screen.getByTestId("kpi-long").textContent).toBe("$300K");
    expect(screen.getByTestId("kpi-short").textContent).toBe("$100K");
    expect(screen.getByTestId("net-caption").textContent).toBe("net long");
  });

  it("renders '-$200K' + 'net short' when the book is net short", () => {
    const netShort = snap([
      { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 100000, signedValueUsd: 100000 },
      { holdingType: "derivative", venue: "deribit", symbol: "BTC-PERP", side: "short", valueUsd: 300000, signedValueUsd: -300000 },
    ]);
    render(<ExposureByClass snapshot={netShort} />);
    expect(screen.getByTestId("kpi-net").textContent).toBe("-$200K");
    expect(screen.getByTestId("kpi-long").textContent).toBe("$100K");
    expect(screen.getByTestId("kpi-short").textContent).toBe("$300K");
    expect(screen.getByTestId("net-caption").textContent).toBe("net short");
  });

  it("renders a 'flat' caption when net is 0 with gross > 0", () => {
    const flat = snap([
      { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 200000, signedValueUsd: 200000 },
      { holdingType: "derivative", venue: "deribit", symbol: "BTC-PERP", side: "short", valueUsd: 200000, signedValueUsd: -200000 },
    ]);
    render(<ExposureByClass snapshot={flat} />);
    expect(screen.getByTestId("net-caption").textContent).toBe("flat");
  });
});

describe("<ExposureByClass> — composition bar + legend", () => {
  it("renders exactly one full-width segment for a single-class (all-spot) book and keeps the absent class in the legend", () => {
    const allSpot = snap([
      { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 300000, signedValueUsd: 300000 },
      { holdingType: "spot", venue: "kraken", symbol: "ETH", side: "long", valueUsd: 100000, signedValueUsd: 100000 },
    ]);
    const { container } = render(<ExposureByClass snapshot={allSpot} />);
    const segments = container.querySelectorAll('[data-testid^="exposure-segment-"]');
    expect(segments).toHaveLength(1);
    expect(segments[0].getAttribute("data-testid")).toBe("exposure-segment-spot");
    expect((segments[0] as HTMLElement).style.width).toBe("100%");
    // legend still lists BOTH classes; the absent one reads "Derivatives · —"
    expect(screen.getByTestId("legend-spot").textContent).toContain("Spot");
    expect(screen.getByTestId("legend-derivative").textContent).toContain("Derivatives · —");
    expect(screen.getByTestId("legend-derivative").className).toContain("text-text-muted");
  });

  it("renders two-class legend rows with 1-decimal shares", () => {
    const twoClass = snap([
      { holdingType: "spot", venue: "binance", symbol: "ETH", side: "long", valueUsd: 248000, signedValueUsd: 248000 },
      { holdingType: "derivative", venue: "deribit", symbol: "ETH-PERP", side: "long", valueUsd: 152000, signedValueUsd: 152000 },
    ]);
    render(<ExposureByClass snapshot={twoClass} />);
    expect(screen.getByTestId("legend-spot").textContent).toBe("Spot · $248K (62.0%)");
    expect(screen.getByTestId("legend-derivative").textContent).toBe("Derivatives · $152K (38.0%)");
  });

  it("gives the bar container role=img and a 1-decimal aria-label", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toBe("Gross exposure split: Spot 75.0%, Derivatives 25.0%");
    expect(bar.getAttribute("aria-label")).toMatch(
      /^Gross exposure split: Spot \d+\.\d%, Derivatives \d+\.\d%$/,
    );
  });
});

describe("<ExposureByClass> — honest-empty", () => {
  it("renders exactly the two-line honest-empty copy and no KPI strip for a null snapshot", () => {
    render(<ExposureByClass snapshot={null} />);
    expect(screen.getByText("No position snapshot yet.")).toBeTruthy();
    expect(
      screen.getByText(
        "Exposure appears after your first exchange sync. Snapshots older than 24 months are not shown.",
      ),
    ).toBeTruthy();
    // no fabricated numbers, no KPI strip, no title
    expect(screen.queryByTestId("kpi-gross")).toBeNull();
    expect(screen.queryByText("Exposure by asset class")).toBeNull();
  });
});

describe("<ExposureByClass> — DESIGN.md no-red/green on direction", () => {
  it("never colors long/short with semantic P&L classes or hexes", () => {
    const { container } = render(<ExposureByClass snapshot={HEDGED} />);
    const html = container.innerHTML;
    expect(html).not.toContain("text-positive");
    expect(html).not.toContain("text-negative");
    expect(html).not.toContain("#15803D");
    expect(html).not.toContain("#DC2626");
  });
});
