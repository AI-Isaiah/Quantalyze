import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExposureByClass } from "./ExposureByClass";
import type { ExposureSnapshot, ExposureSlice } from "@/lib/portfolio-exposure";

/**
 * PI-01 ExposureByClass — a segmented composition bar + KPI strip + drilldown
 * table (NOT a donut). These specs pin the 99-UI-SPEC design contract:
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
    ...overrides,
  };
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
    expect(screen.getByText("as of 2026-10-03")).toBeTruthy();
  });

  it("names the range when the keys were read on different days", () => {
    render(<ExposureByClass snapshot={snap(HEDGED.slices, { asof: "2026-10-03", oldestAsof: "2026-10-01" })} />);
    expect(screen.getByText("as of 2026-10-01 to 2026-10-03")).toBeTruthy();
  });

  it("renders no stamp at all, and never an invented day, when no row has a read day", () => {
    const { container } = render(
      <ExposureByClass snapshot={snap(HEDGED.slices, { asof: null, oldestAsof: null })} />,
    );
    expect(container.textContent).not.toContain("as of");
    expect(container.textContent).not.toContain("null");
  });
});

describe("<ExposureByClass> — Key column (D-08)", () => {
  afterEach(() => vi.restoreAllMocks());

  const TWO_KEYS = snap([
    { apiKeyId: "key-a", holdingType: "spot", venue: "binance", symbol: "BTC", side: "flat", valueUsd: 40000, signedValueUsd: 40000 },
    { apiKeyId: "key-b", holdingType: "spot", venue: "binance", symbol: "BTC", side: "flat", valueUsd: 25000, signedValueUsd: 25000 },
  ]);

  it("names each row's key by the one key-label rule", () => {
    const labels = new Map([
      ["key-a", "Binance — Main"],
      ["key-b", "Binance — ••••ey-b"],
    ]);
    render(<ExposureByClass snapshot={TWO_KEYS} keyLabels={labels} />);
    const rows = screen.getByRole("table").querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Binance — Main");
    expect(rows[1].textContent).toContain("Binance — ••••ey-b");
  });

  it("reads an em-dash, never the raw key id, for a key the panel does not know", () => {
    render(<ExposureByClass snapshot={TWO_KEYS} keyLabels={new Map([["key-a", "Binance — Main"]])} />);
    const rows = screen.getByRole("table").querySelectorAll("tbody tr");
    expect(rows[1].textContent).not.toContain("key-b");
    const cells = rows[1].querySelectorAll("td");
    expect(cells[1].textContent).toBe("—");
    expect(document.body.textContent).not.toContain("key-a|");
  });

  it("renders two keys' one-symbol rows without a duplicate React key warning", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ExposureByClass snapshot={TWO_KEYS} />);
    const dup = err.mock.calls.filter((c) => String(c[0]).includes("same key"));
    expect(dup).toHaveLength(0);
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(2);
  });
});

describe("<ExposureByClass> — drilldown table", () => {
  it("renders a real table with the UI-SPEC columns (plus Key, D-08) in order, sorted by valueUsd desc", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Venue", "Key", "Symbol", "Type", "Side", "Gross", "Net"]);

    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    // binance spot $300K sorts before deribit derivative $100K
    expect(rows[0].textContent).toContain("Binance");
    expect(rows[1].textContent).toContain("Deribit");
  });

  it("renders Type as Spot/Deriv, muted Side, and signed Net without color", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    const rows = screen.getByRole("table").querySelectorAll("tbody tr");
    // spot row
    expect(within(rows[0] as HTMLElement).getByText("Spot")).toBeTruthy();
    // derivative short row
    const shortRow = rows[1] as HTMLElement;
    expect(within(shortRow).getByText("Deriv")).toBeTruthy();
    const sideCell = within(shortRow).getByText("Short");
    expect(sideCell.className).toContain("text-caption");
    expect(sideCell.className).toContain("text-text-secondary");
    const netCell = within(shortRow).getByText("-$100K");
    expect(netCell.className).not.toContain("text-negative");
  });

  it("prints venue display names and a capitalised side, never the raw codes (170.1.2 WR-02)", () => {
    const raw = snap([
      { holdingType: "spot", venue: "okx", symbol: "BTC", side: "long", valueUsd: 300000, signedValueUsd: 300000 },
      { holdingType: "derivative", venue: "sfox", symbol: "ETH-PERP", side: "short", valueUsd: 100000, signedValueUsd: -100000 },
    ]);
    render(<ExposureByClass snapshot={raw} />);
    const rows = screen.getByRole("table").querySelectorAll("tbody tr");
    const cells0 = rows[0].querySelectorAll("td");
    const cells1 = rows[1].querySelectorAll("td");
    expect(cells0[0].textContent).toBe("OKX");
    expect(cells0[4].textContent).toBe("Long");
    expect(cells1[0].textContent).toBe("sFOX");
    expect(cells1[4].textContent).toBe("Short");
  });

  // 2026-10-09 Phase 170.2 H-3: the cap moved onto the ResponsiveTable region.
  // The vertical 12-row cap is unchanged; only the element that carries it moved
  // from the testid wrapper to the focusable, named scroll region.
  const REGION_NAME =
    "Exposure by venue and symbol: Table scrolls horizontally. Swipe or use arrow keys to see more columns.";

  it("is a named, focusable ResponsiveTable region inside the drilldown wrapper (H-3)", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    const region = screen.getByRole("region", { name: REGION_NAME });
    expect(region.getAttribute("tabindex")).toBe("0");
    // The region holds the table, and the wrapper keeps the testid + min-w-0.
    expect(within(region).getByRole("table")).toBeTruthy();
    const wrapper = screen.getByTestId("drilldown");
    expect(wrapper.className).toContain("mt-4");
    expect(wrapper.className).toContain("min-w-0");
    expect(wrapper.contains(region)).toBe(true);
  });

  it("caps the region at max-h-64 with a vertical scroll only when slices exceed 12", () => {
    const many = snap(
      Array.from({ length: 14 }, (_, i) => ({
        holdingType: "spot" as const,
        venue: "binance",
        symbol: `SYM${i}`,
        side: "long" as const,
        valueUsd: (14 - i) * 1000,
        signedValueUsd: (14 - i) * 1000,
      })),
    );
    const { unmount } = render(<ExposureByClass snapshot={many} />);
    const region = screen.getByRole("region", { name: REGION_NAME });
    expect(region.className).toContain("max-h-64");
    expect(region.className).toContain("overflow-y-auto");
    unmount();

    const few = snap(
      Array.from({ length: 5 }, (_, i) => ({
        holdingType: "spot" as const,
        venue: "binance",
        symbol: `SYM${i}`,
        side: "long" as const,
        valueUsd: (5 - i) * 1000,
        signedValueUsd: (5 - i) * 1000,
      })),
    );
    render(<ExposureByClass snapshot={few} />);
    const fewRegion = screen.getByRole("region", { name: REGION_NAME });
    expect(fewRegion.className).not.toContain("max-h-64");
    expect(fewRegion.className).not.toContain("overflow-y-auto");
  });

  it("the scroller is the ResponsiveTable's own: the testid wrapper no longer scrolls", () => {
    render(<ExposureByClass snapshot={HEDGED} />);
    expect(screen.getByTestId("drilldown").className).not.toContain("overflow-x-auto");
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
