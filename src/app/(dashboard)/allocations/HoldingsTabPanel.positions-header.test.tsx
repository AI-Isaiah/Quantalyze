import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * Phase 198 plan 11 (C5, SC-2): the Holdings "Positions" header and the
 * Overview's glance read ONE payload. SC-2 means one number in two places must
 * be one string, and C5 means Book equity is defined once (`bookEquityUsd`), so
 * both surfaces render from a single payload object here and the assertions
 * compare their printed text byte for byte. A header that summed spot rows only,
 * or a caption copied inline into one surface, makes a case below fail.
 */

vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { GlancePanel } from "./components/GlancePanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";

const spot = (symbol: string, value_usd: number, asof?: string) => ({
  symbol,
  quantity: 1,
  mark_price_usd: value_usd,
  value_usd,
  venue: "binance",
  holding_type: "spot" as const,
  api_key_id: "key-a",
  side: "flat" as const,
  entry_price: null,
  unrealized_pnl_usd: null,
  ...(asof ? { asof } : {}),
});

const perp = (
  symbol: string,
  unrealized_pnl_usd: number | null,
  asof?: string,
) => ({
  symbol,
  quantity: 1,
  mark_price_usd: 100,
  value_usd: 30_000,
  venue: "binance",
  holding_type: "derivative" as const,
  api_key_id: "key-a",
  side: "long" as const,
  entry_price: 90,
  unrealized_pnl_usd,
  ...(asof ? { asof } : {}),
});

const KEYS = [
  { id: "key-a", sync_status: "complete", exchange: "binance", label: "Main" },
];

function payload(holdingsSummary: unknown[]) {
  return {
    portfolio: null,
    analytics: null,
    apiKeys: KEYS,
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    holdingsSummary,
    snapshotCount: 30,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [],
    activeVenues: [],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    strategies: [],
    liveBaselineMetrics: null,
    exposure: EMPTY_EXPOSURE,
  };
}

/** Renders the Holdings panel and the glance from the SAME payload object. */
function renderBoth(holdingsSummary: unknown[]) {
  const p = payload(holdingsSummary);
  render(
    <>
      <GlancePanel
        liveBaselineMetrics={null}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        holdingsSummary={p.holdingsSummary as any}
        allKeysStale={false}
      />
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <HoldingsTabPanel {...(p as any)} />
    </>,
  );
  const glance = (id: string) => screen.getByTestId(id);
  const positions = () =>
    document.querySelector("section#positions") as HTMLElement;
  return { glance, positions };
}

const BOOK = [
  spot("BTC", 40_000, "2026-11-07"),
  spot("ETH", 2_500, "2026-11-06"),
  perp("BTC-PERP", 1_200, "2026-11-07"),
];

describe("Positions header: Book equity, one string with the glance", () => {
  it("prints Book equity and the read day, byte-equal to the glance's figure", () => {
    const { glance } = renderBoth(BOOK);
    const header = screen.getByTestId("positions-book-equity");
    expect(header.textContent).toBe("Book equity $43,700 · read Nov 7, 2026");
    expect(glance("glance-book-equity").textContent).toBe("$43,700");
    expect(header.textContent).toContain(glance("glance-book-equity").textContent);
  });

  it("derivative equity counts in the header exactly as in the glance (never spot rows only)", () => {
    // WHY: a header summed over spot rows alone would read $42,500 here.
    renderBoth(BOOK);
    expect(screen.getByTestId("positions-book-equity").textContent).not.toContain(
      "$42,500",
    );
  });

  it("the glance's Positions count equals the position rows the section lists", () => {
    const { glance, positions } = renderBoth(BOOK);
    const rows = within(positions())
      .getAllByRole("row")
      .filter((r) => r.closest("tbody") !== null);
    expect(rows).toHaveLength(3);
    expect(glance("glance-positions").textContent).toBe(String(rows.length));
  });

  it("states the unreported-derivative caption in both places, plural", () => {
    renderBoth([spot("BTC", 40_000), perp("A-PERP", null), perp("B-PERP", null)]);
    const line = "Excludes 2 derivative positions with no reported P&L.";
    expect(screen.getByTestId("positions-unreported-caption").textContent).toBe(line);
    expect(screen.getByTestId("glance-book-equity").parentElement?.textContent).toContain(line);
  });

  it("keeps the singular for one derivative", () => {
    renderBoth([spot("BTC", 40_000), perp("A-PERP", null)]);
    const line = "Excludes 1 derivative position with no reported P&L.";
    expect(screen.getByTestId("positions-unreported-caption").textContent).toBe(line);
    expect(screen.getByTestId("glance-book-equity").parentElement?.textContent).toContain(line);
  });

  it("shows no caption when every derivative reports its P&L", () => {
    renderBoth(BOOK);
    expect(screen.queryByTestId("positions-unreported-caption")).toBeNull();
  });

  it("drops the read half when no row carries a read day, never inventing one", () => {
    renderBoth([spot("BTC", 40_000), spot("ETH", 2_500), perp("BTC-PERP", 1_200)]);
    expect(screen.getByTestId("positions-book-equity").textContent).toBe(
      "Book equity $43,700",
    );
  });

  it("an empty book reads a dash, never $0", () => {
    renderBoth([]);
    const text = screen.getByTestId("positions-book-equity").textContent;
    expect(text).toBe("Book equity —");
    expect(text).not.toContain("$0");
  });
});
