import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Phase 235 HOLD-04. When the dashboard's marker read fails, the Holdings rows
 * are KEPT (hiding them would blank the book), so the Positions section carries
 * one sentence saying the rows may include an account's positions from an earlier
 * day. Without it the Allocation equity header and every row below would be shown
 * silently as if each account's newest day had been checked. Each arm fails if the
 * note goes missing, shows without rows, shows when the read succeeded, or sits
 * somewhere that no longer qualifies the header and the tables.
 */

vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";

// Hand-typed on purpose: never read back from the registry (UI-SPEC 1.2, ASCII apostrophes).
const SENTENCE =
  "We could not check whether each account's newest day could be priced in USD, so the holdings shown may include an account's positions from an earlier day. Reload this page to try again.";
const NOTE = "positions-holdings-unpriced-check-note";
const ID_SELECTOR = '[data-degrade-id="allocation.holdings-unpriced-check-failed"]';

const spot = (symbol: string, value_usd: number) => ({
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
  asof: "2026-11-07",
});

const KEYS = [
  { id: "key-a", sync_status: "complete", exchange: "binance", label: "Main" },
];

function payload(holdingsSummary: unknown[], extra: Record<string, unknown> = {}) {
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
    ...extra,
  };
}

function renderPanel(holdingsSummary: unknown[], extra: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(payload(holdingsSummary, extra) as any)} />);
}

describe("HoldingsTabPanel: the unpriced-check note follows a failed marker read (HOLD-04)", () => {
  it("V1: flag true with rows shows the verbatim sentence, as a status, with its id marker, visible at 390px", () => {
    renderPanel([spot("BTC", 40_000)], { holdingsUnpricedCheckFailed: true });
    const note = screen.getByTestId(NOTE);
    expect(note.textContent).toBe(SENTENCE);
    expect(note.getAttribute("role")).toBe("status");
    expect(note.querySelector(ID_SELECTOR)).not.toBeNull();
    expect(note.className.split(/\s+/)).not.toContain("hidden");
    expect(note.className).not.toContain("md:block");
  });

  it("V2: follows the Allocation equity header and precedes the first table of the Positions section", () => {
    renderPanel([spot("BTC", 40_000)], { holdingsUnpricedCheckFailed: true });
    const note = screen.getByTestId(NOTE);
    const header = screen.getByTestId("positions-book-equity");
    const table = (document.querySelector("section#positions") as HTMLElement).querySelector("table");
    expect(table).not.toBeNull();
    expect(header.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(table as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("V3: flag true with zero rows shows nothing (no earlier-day row can be shown)", () => {
    renderPanel([], { holdingsUnpricedCheckFailed: true });
    // Guard against a vacuous pass: the Positions section itself still renders.
    expect(document.querySelector("section#positions")).not.toBeNull();
    expect(screen.queryByTestId(NOTE)).toBeNull();
  });

  it("V4: flag false, and flag absent, show nothing and leave no id marker in the DOM", () => {
    const { unmount } = renderPanel([spot("BTC", 40_000)], { holdingsUnpricedCheckFailed: false });
    expect(screen.getByTestId("positions-book-equity")).not.toBeNull();
    expect(screen.queryByTestId(NOTE)).toBeNull();
    expect(document.querySelector(ID_SELECTOR)).toBeNull();
    unmount();
    renderPanel([spot("BTC", 40_000)]);
    expect(screen.queryByTestId(NOTE)).toBeNull();
    expect(document.querySelector(ID_SELECTOR)).toBeNull();
  });
});
