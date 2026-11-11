import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExposureByClass } from "./ExposureByClass";
import type { ExposureSnapshot, ExposureSlice } from "@/lib/portfolio-exposure";

/**
 * PI-01 ExposureByClass — a segmented composition bar + five-cell KPI strip
 * (NOT a donut, and no per-position table: LEAN-06). These specs pin the
 * 99-UI-SPEC design contract, with Phase 198 ROUTE-08 (a Cash cell, cash out of
 * the other figures) and every money value in `formatUsd` whole dollars:
 * D-P2 signed math surfaced in the KPI strip, single-class honesty in the
 * legend, verbatim honest-empty copy, and the DESIGN.md no-red/green-on-
 * direction lock. Pure CSS — no recharts, no data fetching.
 */

type SliceInput = Omit<ExposureSlice, "apiKeyId"> & { apiKeyId?: string | null };

function snap(slices: SliceInput[], overrides: Partial<ExposureSnapshot> = {}): ExposureSnapshot {
  const full: ExposureSlice[] = slices.map((s) => ({ ...s, apiKeyId: s.apiKeyId ?? null }));
  const totalGrossUsd = full.reduce((a, s) => a + s.valueUsd, 0);
  const totalNetUsd = full.reduce((a, s) => a + s.signedValueUsd, 0);
  return {
    asof: "2026-07-11",
    oldestAsof: "2026-07-11",
    slices: full,
    totalGrossUsd,
    totalNetUsd,
    cashUsd: null,
    ...overrides,
  };
}

// Hedged book (D-P2): long $300K spot + short $100K derivative.
const HEDGED = snap([
  { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 300000, signedValueUsd: 300000 },
  { holdingType: "derivative", venue: "deribit", symbol: "BTC-PERP", side: "short", valueUsd: 100000, signedValueUsd: -100000 },
]);

describe("<ExposureByClass> — KPI strip (D-P2 signed math)", () => {
  it("renders GROSS/NET/LONG/SHORT in whole dollars for a hedged book with a 'net long' caption", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    expect(screen.getByTestId("kpi-gross").textContent).toBe("$400,000");
    expect(screen.getByTestId("kpi-net").textContent).toBe("$200,000");
    expect(screen.getByTestId("kpi-long").textContent).toBe("$300,000");
    expect(screen.getByTestId("kpi-short").textContent).toBe("$100,000");
  });

  it("D-08: the Gross and Net KPIs name their quantity, Long, Short and Cash keep their labels", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    const labelOf = (testid: string) => screen.getByTestId(testid).previousElementSibling?.textContent;
    expect(labelOf("kpi-gross")).toBe("Gross exposure");
    expect(labelOf("kpi-net")).toBe("Net exposure");
    expect(labelOf("kpi-long")).toBe("Long");
    expect(labelOf("kpi-short")).toBe("Short");
    expect(labelOf("kpi-cash")).toBe("Cash");
    expect(screen.getByTestId("net-caption").textContent).toBe("net long");
  });

  it("renders '-$200,000' + 'net short' when the book is net short", () => {
    const netShort = snap([
      { holdingType: "spot", venue: "binance", symbol: "BTC", side: "long", valueUsd: 100000, signedValueUsd: 100000 },
      { holdingType: "derivative", venue: "deribit", symbol: "BTC-PERP", side: "short", valueUsd: 300000, signedValueUsd: -300000 },
    ]);
    render(<ExposureByClass snapshot={netShort} />);
    expect(screen.getByTestId("kpi-net").textContent).toBe("-$200,000");
    expect(screen.getByTestId("kpi-long").textContent).toBe("$100,000");
    expect(screen.getByTestId("kpi-short").textContent).toBe("$300,000");
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
    expect(screen.getByTestId("legend-spot").textContent).toBe("Spot · $248,000 (62.0%)");
    expect(screen.getByTestId("legend-derivative").textContent).toBe("Derivatives · $152,000 (38.0%)");
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
  it("renders the two-line empty copy, no KPI strip and no 24-month claim for a null snapshot", () => {
    render(<ExposureByClass snapshot={null} />);
    expect(screen.getByText("No current positions.")).toBeTruthy();
    expect(
      screen.getByText("Exposure appears once a key's latest sync reads a position."),
    ).toBeTruthy();
    // The per-key reader has no date window, so a 24-month claim would be false.
    expect(document.body.textContent).not.toContain("24 months");
    // no fabricated numbers, no KPI strip, no title
    expect(screen.queryByTestId("kpi-gross")).toBeNull();
    expect(screen.queryByText("Exposure by asset class")).toBeNull();
  });
});

describe("<ExposureByClass> — read-day stamp (D-01)", () => {
  it("names the one day every key was read on", () => {
    render(<ExposureByClass snapshot={snap(HEDGED.slices, { asof: "2026-10-03", oldestAsof: "2026-10-03" })} />);
    expect(screen.getByText("as of Oct 3, 2026")).toBeTruthy();
  });

  it("names the range when the keys were read on different days", () => {
    render(<ExposureByClass snapshot={snap(HEDGED.slices, { asof: "2026-10-03", oldestAsof: "2026-10-01" })} />);
    expect(screen.getByText("as of Oct 1, 2026 to Oct 3, 2026")).toBeTruthy();
  });

  it("renders no stamp at all, and never an invented day, when no row has a read day", () => {
    const { container } = render(
      <ExposureByClass snapshot={snap(HEDGED.slices, { asof: null, oldestAsof: null })} />,
    );
    expect(container.textContent).not.toContain("as of");
    expect(container.textContent).not.toContain("null");
  });
});

// LEAN-06: the per-slice drilldown table and its Key column are gone. The drilldown
// re-listed every position the Positions tables list, and keys are named there.
describe("<ExposureByClass> — no position listing (LEAN-06)", () => {
  it("holds no table, no row and no 'Exposure by venue and symbol' region", () => {
    const { container } = render(<ExposureByClass snapshot={HEDGED} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("tr")).toBeNull();
    expect(screen.queryByTestId("drilldown")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.textContent).not.toContain("Exposure by venue and symbol");
  });
});

describe("<ExposureByClass> — the Cash cell and cash-free bar (ROUTE-08)", () => {
  it("prints the cash total in the fifth cell", () => {
    render(<ExposureByClass snapshot={snap(HEDGED.slices, { cashUsd: 10000 })} />);
    expect(screen.getByTestId("kpi-cash").textContent).toBe("$10,000");
  });

  it("prints $0 when cash rows were read and summed to zero", () => {
    render(<ExposureByClass snapshot={snap(HEDGED.slices, { cashUsd: 0 })} />);
    expect(screen.getByTestId("kpi-cash").textContent).toBe("$0");
  });

  it("prints an em dash, never $0, when no cash row was read", () => {
    render(<ExposureByClass snapshot={snap(HEDGED.slices, { cashUsd: null })} />);
    expect(screen.getByTestId("kpi-cash").textContent).toBe("—");
  });

  it("orders the five cells Gross, Net, Long, Short, Cash", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    const ids = Array.from(document.querySelectorAll('[data-testid^="kpi-"]')).map((e) =>
      e.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["kpi-gross", "kpi-net", "kpi-long", "kpi-short", "kpi-cash"]);
  });

  it("BTC spot 40000 + a 20000 short derivative + 10000 USDT: gross $60,000, bar shares of 60000, cash apart", () => {
    // The snapshot is cash-free by construction (exposureSnapshotFromHoldings), so
    // the card is handed slices without the USDT row and the cash total beside them.
    const book = snap(
      [
        { holdingType: "spot", venue: "binance", symbol: "BTC", side: "flat", valueUsd: 40000, signedValueUsd: 40000 },
        { holdingType: "derivative", venue: "deribit", symbol: "BTC-PERP", side: "short", valueUsd: 20000, signedValueUsd: -20000 },
      ],
      { cashUsd: 10000 },
    );
    render(<ExposureByClass snapshot={book} />);
    expect(screen.getByTestId("kpi-gross").textContent).toBe("$60,000");
    expect(screen.getByTestId("kpi-cash").textContent).toBe("$10,000");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Gross exposure split: Spot 66.7%, Derivatives 33.3%",
    );
    expect(screen.getByTestId("legend-spot").textContent).toBe("Spot · $40,000 (66.7%)");
    expect(screen.getByTestId("legend-derivative").textContent).toBe("Derivatives · $20,000 (33.3%)");
    expect(screen.queryByTestId("legend-cash")).toBeNull();
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
