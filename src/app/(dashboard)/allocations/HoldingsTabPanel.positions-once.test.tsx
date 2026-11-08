import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Phase 198 plan 12 (D-02, E5, LEAN-06): each position is listed ONCE on the
 * Holdings panel. The cause of the bug this pins was a second listing: flagged
 * positions appeared in the positions tables AND in the separate flagged list,
 * so one holding read as two. The count is per row id (key, venue, symbol, type),
 * so two keys' rows of one symbol are two rows, never merged and never doubled.
 */

vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/bridge/send-intro", () => ({ sendBridgeIntro: vi.fn() }));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";

type Row = Record<string, unknown>;

const hold = (symbol: string, value_usd: number, over: Row = {}): Row => ({
  symbol,
  quantity: 1,
  mark_price_usd: value_usd,
  value_usd,
  venue: "binance",
  holding_type: "spot",
  api_key_id: "k1",
  side: "flat",
  entry_price: null,
  unrealized_pnl_usd: null,
  ...over,
});

const flag = (venue: string, symbol: string, type: string, id: string) => ({
  venue,
  symbol,
  holding_type: type,
  value_usd: 40_000,
  top_candidate_strategy_id: id,
  top_candidate_name: `Cand ${symbol}`,
  top_candidate_composite: 70,
  breach_reasons: ["max_weight"],
});

const KEYS = [
  { id: "k1", sync_status: "complete", exchange: "binance", label: "One" },
  { id: "k2", sync_status: "complete", exchange: "binance", label: "Two" },
];

const BOOK: Row[] = [
  hold("BTC", 40_000, { api_key_id: "k1" }),
  hold("BTC", 30_000, { api_key_id: "k2" }),
  hold("USDT", 20_000),
  hold("ETH", 25_000, { venue: "okx" }),
  hold("BTC", 50_000, { holding_type: "derivative", side: "long", entry_price: 1, unrealized_pnl_usd: 100 }),
];

const FLAGS = [
  flag("binance", "BTC", "spot", "cand-btc"),
  flag("binance", "BTC", "derivative", "cand-btc-perp"),
];

function renderPanel(book: Row[], flags: unknown[]) {
  const p = {
    portfolio: null,
    analytics: null,
    apiKeys: KEYS,
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    holdingsSummary: book,
    snapshotCount: 30,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [],
    activeVenues: [],
    flaggedHoldings: flags,
    matchDecisionsByHoldingRef: {},
    strategies: [],
    exposure: EMPTY_EXPOSURE,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(p as any)} />);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rowId = (h: Row) => `holding:${h.venue}:${h.symbol}:${h.holding_type}#${h.api_key_id}`;

describe("each position is listed once (D-02, E5)", () => {
  it("every holdings row id appears in exactly one [data-position-row] across the panel", () => {
    renderPanel(BOOK, FLAGS);
    const marked = [...document.querySelectorAll("[data-position-row]")].map((e) =>
      e.getAttribute("data-position-row"),
    );
    expect(marked.length).toBe(BOOK.length);
    for (const h of BOOK) {
      expect(marked.filter((id) => id === rowId(h))).toHaveLength(1);
    }
  });

  it("each symbol is in exactly as many table rows as there are position rows of it", () => {
    renderPanel(BOOK, FLAGS);
    const trs = [...document.querySelectorAll("tr")];
    for (const symbol of ["BTC", "USDT", "ETH"]) {
      const expected = BOOK.filter((h) => h.symbol === symbol).length;
      const holding = trs.filter((tr) => new RegExp(`· ${symbol}$`).test(tr.querySelector("td span")?.textContent ?? ""));
      expect(holding).toHaveLength(expected);
    }
    // Flagged list is not mounted for flags that match a row, so no list header.
    expect(screen.queryByText("Candidate Strategy")).toBeNull();
  });

  it("the cash row's Type cell reads Cash", () => {
    renderPanel(BOOK, FLAGS);
    const cash = document.querySelector(`[data-position-row="${rowId(hold("USDT", 0))}"]`) as HTMLElement;
    expect(cash.querySelectorAll("td")[1].textContent).toBe("Cash");
  });
});
