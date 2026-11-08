import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Phase 198 plan 12 (C9, OQ-7 assumed, LEAN-06): a flag is per scope ref and
 * Holdings rows are per API key, so one flag marks EVERY key's row of its ref and
 * one action opens one form. The write must stay on the key-free ref: a row id
 * carries `#api_key_id`, and sending that as the holding ref would write a decision
 * about one key's copy of a holding the match batch never keyed (T-198-21). A flag
 * with no rendered row, missing from the read or hidden as dust, must still be
 * reachable (T-198-22), never silently dropped (D-02).
 */

const sendBridgeIntro = vi.fn();
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/bridge/send-intro", () => ({
  sendBridgeIntro: (...a: unknown[]) => sendBridgeIntro(...a),
}));

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
  { id: "key-bad", sync_status: "revoked", exchange: "binance", label: "Old" },
];

const BTC_K1 = "holding:binance:BTC:spot#k1";
const BTC_K2 = "holding:binance:BTC:spot#k2";
const BANNER = "Record outcome for Bridge-introduced strategy";

const BOOK: Row[] = [
  hold("BTC", 40_000, { api_key_id: "k1" }),
  hold("BTC", 30_000, { api_key_id: "k2" }),
  hold("ETH", 25_000, { venue: "okx" }),
  hold("BTC", 50_000, { holding_type: "derivative", side: "long", entry_price: 1, unrealized_pnl_usd: 100 }),
];

function renderPanel(book: Row[], flags: unknown[], decisions: Record<string, { id: string } | null> = {}) {
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
    matchDecisionsByHoldingRef: decisions,
    strategies: [],
    exposure: EMPTY_EXPOSURE,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(p as any)} />);
}

const rowEl = (id: string) => document.querySelector(`[data-position-row="${id}"]`) as HTMLElement;
const FLAGS = [
  flag("binance", "BTC", "spot", "cand-btc"),
  flag("binance", "BTC", "derivative", "cand-btc-perp"),
];

beforeEach(() => {
  sendBridgeIntro.mockReset();
  sendBridgeIntro.mockResolvedValue({ ok: true, matchDecisionId: "md-1" });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("flagged rows", () => {
  it("marks both BTC spot rows and the derivative, not OKX ETH, and mounts no separate list", () => {
    renderPanel(BOOK, FLAGS);
    expect(within(rowEl(BTC_K1)).getByText("Flagged")).toBeTruthy();
    expect(within(rowEl(BTC_K2)).getByText("Flagged")).toBeTruthy();
    expect(within(rowEl("holding:binance:BTC:derivative#k1")).getByText("Flagged")).toBeTruthy();
    expect(within(rowEl("holding:okx:ETH:spot#k1")).queryByText("Flagged")).toBeNull();
    expect(screen.queryByText("Candidate Strategy")).toBeNull();
  });

  it("opens one form at a time, under the row pressed", () => {
    renderPanel(BOOK, FLAGS);
    fireEvent.click(within(rowEl(BTC_K1)).getByRole("button", { name: "Record outcome…" }));
    let regions = screen.getAllByRole("region", { name: BANNER });
    expect(regions).toHaveLength(1);
    expect(rowEl(BTC_K1).nextElementSibling?.contains(regions[0])).toBe(true);
    fireEvent.click(within(rowEl(BTC_K2)).getByRole("button", { name: "Record outcome…" }));
    regions = screen.getAllByRole("region", { name: BANNER });
    expect(regions).toHaveLength(1);
    expect(rowEl(BTC_K2).nextElementSibling?.contains(regions[0])).toBe(true);
  });

  it("the send-intro write carries the key-free ref and the flag's candidate", async () => {
    renderPanel(BOOK, FLAGS);
    fireEvent.click(within(rowEl(BTC_K1)).getByRole("button", { name: "Record outcome…" }));
    fireEvent.click(screen.getByRole("button", { name: "Allocated" }));
    await waitFor(() => expect(sendBridgeIntro).toHaveBeenCalledTimes(1));
    const arg = sendBridgeIntro.mock.calls[0][0] as { holdingRef: string; topCandidateStrategyId: string };
    expect(arg.holdingRef).toBe("holding:binance:BTC:spot");
    expect(arg.holdingRef).not.toContain("#");
    expect(arg.topCandidateStrategyId).toBe("cand-btc");
  });

  it("a decision made from one key's row is reused by the other key's row, never sent twice", async () => {
    renderPanel(BOOK, FLAGS);
    fireEvent.click(within(rowEl(BTC_K1)).getByRole("button", { name: "Record outcome…" }));
    fireEvent.click(screen.getByRole("button", { name: "Allocated" }));
    await waitFor(() => expect(sendBridgeIntro).toHaveBeenCalledTimes(1));
    // The banner gives way to the allocation form once the decision exists.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Allocated" })).toBeNull());
    fireEvent.click(within(rowEl(BTC_K2)).getByRole("button", { name: "Record outcome…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Allocated" }));
    expect(sendBridgeIntro).toHaveBeenCalledTimes(1);
  });

  it("with no flags: no chip, no action, no list", () => {
    renderPanel(BOOK, []);
    expect(screen.queryByText("Flagged")).toBeNull();
    expect(screen.queryByRole("button", { name: "Record outcome…" })).toBeNull();
    expect(screen.queryByText("Candidate Strategy")).toBeNull();
  });
});

describe("a flag with no rendered row is never dropped (T-198-22)", () => {
  it("a flag on a position not in the read renders through the list, and only that flag", () => {
    renderPanel(BOOK, [...FLAGS, flag("binance", "SOL", "spot", "cand-sol")]);
    const header = screen.getByText("Candidate Strategy");
    const list = header.closest("table") as HTMLElement;
    expect(within(list).getByText("SOL")).toBeTruthy();
    expect(within(list).queryByText("BTC")).toBeNull();
    expect(within(list).getAllByRole("row")).toHaveLength(2); // header + SOL
  });

  describe("flagged dust", () => {
    const DUST_BOOK = [hold("BTC", 40_000), hold("DOGE", 12)];
    const DOGE = [flag("binance", "DOGE", "spot", "cand-doge")];
    const dogeRows = () =>
      [...document.querySelectorAll("tr")].filter((tr) => /DOGE/.test(tr.textContent ?? "") && !tr.querySelector("th"));

    it("hidden dust: the list carries DOGE, its form opens without the toggle", () => {
      renderPanel(DUST_BOOK, DOGE);
      expect(document.querySelector('[data-position-row$="DOGE:spot#k1"]')).toBeNull();
      const list = screen.getByText("Candidate Strategy").closest("table") as HTMLElement;
      expect(within(list).getByText("DOGE")).toBeTruthy();
      expect(dogeRows()).toHaveLength(1);
      fireEvent.click(within(list).getByRole("button", { name: "Expand review" }));
      expect(screen.getByRole("region", { name: BANNER })).toBeTruthy();
    });

    it("after Show 1 small position, DOGE is in its own row with the chip and the list is gone", () => {
      renderPanel(DUST_BOOK, DOGE);
      fireEvent.click(screen.getByRole("button", { name: "Show 1 small position" }));
      const row = document.querySelector('[data-position-row$="DOGE:spot#k1"]') as HTMLElement;
      expect(within(row).getByText("Flagged")).toBeTruthy();
      expect(within(row).getByRole("button", { name: "Record outcome…" })).toBeTruthy();
      expect(screen.queryByText("Candidate Strategy")).toBeNull();
      expect(dogeRows()).toHaveLength(1);
    });
  });

  it("a flagged row on a key hidden by the untrusted-key filter stays reachable through the list", () => {
    const book = [hold("BTC", 40_000), hold("OLD", 5_000, { api_key_id: "key-bad" })];
    renderPanel(book, [flag("binance", "OLD", "spot", "cand-old")]);
    // Shown by default: the row carries the chip, no list.
    expect(within(rowEl("holding:binance:OLD:spot#key-bad")).getByText("Flagged")).toBeTruthy();
    expect(screen.queryByText("Candidate Strategy")).toBeNull();
    // Hide untrusted-key holdings: the row leaves the table, the flag moves to the list.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(rowEl("holding:binance:OLD:spot#key-bad")).toBeNull();
    const list = screen.getByText("Candidate Strategy").closest("table") as HTMLElement;
    expect(within(list).getByText("OLD")).toBeTruthy();
  });
});
