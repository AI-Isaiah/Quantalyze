import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { keyAttentionChipLabel } from "@/lib/closed-sets";

/**
 * Phase 198 plan 11 (D-04, LEAN-06): dust is hidden to show what matters, and
 * hiding is a view choice that must never move a figure. So these cases pin two
 * things at once: WHICH rows hide (strict edges; an unpriced or untrusted row is
 * never "small"), and that every total, count and note is identical whether the
 * dust is hidden or shown. A table that filtered its rows array instead of
 * skipping ids would move the derivatives footer and fail the totals case.
 */

vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";
import { DUST_RULE_CAPTION } from "./lib/dust";

type Row = Record<string, unknown>;

const spot = (symbol: string, value_usd: number, over: Row = {}): Row => ({
  symbol,
  quantity: 1,
  mark_price_usd: value_usd,
  value_usd,
  venue: "binance",
  holding_type: "spot",
  api_key_id: "key-a",
  side: "flat",
  entry_price: null,
  unrealized_pnl_usd: null,
  ...over,
});

const perp = (
  symbol: string,
  notional: number,
  unrealized_pnl_usd: number | null,
  over: Row = {},
): Row => ({
  symbol,
  quantity: 1,
  mark_price_usd: 100,
  value_usd: notional,
  venue: "binance",
  holding_type: "derivative",
  api_key_id: "key-a",
  side: "long",
  entry_price: 90,
  unrealized_pnl_usd,
  ...over,
});

const KEYS = [
  { id: "key-a", sync_status: "complete", exchange: "binance", label: "Main" },
  { id: "key-bad", sync_status: "revoked", exchange: "binance", label: "Old" },
];

function payload(holdingsSummary: Row[]) {
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
    exposure: EMPTY_EXPOSURE,
  };
}

function renderBook(book: Row[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(payload(book) as any)} />);
}

const positions = () => document.querySelector("section#positions") as HTMLElement;
const spotWrap = () => document.getElementById("positions-spot") as HTMLElement;
const derivWrap = () => document.getElementById("positions-derivatives") as HTMLElement;
const control = () => screen.queryByRole("button", { name: /small positions?$/i });

/** The symbols of a table's body rows, in document order. */
function symbols(wrap: HTMLElement): string[] {
  return within(wrap)
    .queryAllByRole("row")
    .filter((r) => r.closest("tbody") !== null)
    .map((r) => (r.querySelector("td span")?.textContent ?? "?").split("· ").pop() ?? "?");
}

/** Everything the toggle must not move. */
function figures() {
  const exposure = document.querySelector('section[aria-label="Exposure"]');
  return {
    header: screen.getByTestId("positions-book-equity").textContent,
    caption: screen.queryByTestId("positions-unreported-caption")?.textContent ?? null,
    exposure: exposure?.textContent,
    footer: positions().querySelector("tfoot")?.textContent ?? null,
    unavailable:
      screen.queryByTestId("open-positions-pnl-unavailable-note")?.textContent ?? null,
    untrusted: screen.queryByTestId("open-positions-untrusted-note")?.textContent ?? null,
    pointer: spotWrap().textContent?.includes("open position") ?? false,
  };
}

beforeEach(() => {
  // HoldingNoteRow reads its note on mount; nothing is saved here.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Book equity 40042: BTC 40000 + DOGE 12 + the derivative's 30 of P&L.
const DUST_BOOK = [spot("DOGE", 12), spot("BTC", 40_000), perp("SMALL-PERP", 30, 30)];

describe("dust is hidden by default behind one control", () => {
  it("hides the small spot and derivative rows and offers one honest button", () => {
    renderBook(DUST_BOOK);
    expect(symbols(spotWrap())).toEqual(["BTC"]);
    expect(within(derivWrap()).queryByText(/SMALL-PERP/)).toBeNull();
    const button = screen.getByRole("button", { name: "Show 2 small positions" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("positions-spot positions-derivatives");
    expect(screen.getByText(DUST_RULE_CAPTION)).toBeTruthy();
  });

  it("shows them in their normal sort position, announces it, and hides again on a second press", () => {
    renderBook(DUST_BOOK);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 small positions" }));
    // Payload order, DOGE first: a revealed row is not appended at the end.
    expect(symbols(spotWrap())).toEqual(["DOGE", "BTC"]);
    expect(symbols(derivWrap())).toEqual(["SMALL-PERP"]);
    const hide = screen.getByRole("button", { name: "Hide small positions" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    expect(within(positions()).getByRole("status").textContent).toBe("2 small positions shown.");
    fireEvent.click(hide);
    expect(within(positions()).getByRole("status").textContent).toBe("2 small positions hidden.");
    expect(symbols(spotWrap())).toEqual(["BTC"]);
  });

  it("reads 'Show 1 small position' for one", () => {
    renderBook([spot("DOGE", 12), spot("BTC", 40_000)]);
    expect(screen.getByRole("button", { name: "Show 1 small position" })).toBeTruthy();
  });

  it("a remount (a reload) hides dust again", () => {
    const first = renderBook(DUST_BOOK);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 small positions" }));
    expect(symbols(spotWrap())).toEqual(["DOGE", "BTC"]);
    first.unmount();
    renderBook(DUST_BOOK);
    expect(symbols(spotWrap())).toEqual(["BTC"]);
  });
});

describe("hiding dust never moves a figure", () => {
  // Two small derivatives, one with no reported P&L, so the footer total, the
  // P&L-unavailable note and the unreported caption all have something to say.
  // A third, an untrusted key's large position, feeds the key-trust note.
  const BOOK = [
    spot("DOGE", 12),
    spot("BTC", 40_000),
    perp("SMALL-A", 30, 30),
    perp("SMALL-B", 20, null),
    perp("BIG-PERP", 30_000, 500, { api_key_id: "key-bad" }),
  ];

  it("the header, Exposure, the derivatives footer, its notes and the spot pointer are identical hidden and shown", () => {
    renderBook(BOOK);
    const hidden = figures();
    expect(hidden.footer).toBeTruthy();
    expect(hidden.unavailable).toBeTruthy();
    expect(hidden.untrusted).toBeTruthy();
    expect(hidden.caption).toBe("Excludes 1 derivative position with no reported P&L.");
    fireEvent.click(screen.getByRole("button", { name: /Show \d small positions?/ }));
    expect(figures()).toEqual(hidden);
  });

  it("the glance-facing row count includes dust: the header's Book equity is the same either way", () => {
    renderBook(BOOK);
    const before = screen.getByTestId("positions-book-equity").textContent;
    fireEvent.click(screen.getByRole("button", { name: /Show \d small positions?/ }));
    expect(screen.getByTestId("positions-book-equity").textContent).toBe(before);
    expect(before).toBe("Allocation equity $40,542");
  });
});

describe("the rule's edges", () => {
  it("exactly $50 stays visible", () => {
    // Book 40050: 0.1% is 40.05, so $50 is neither under $50 nor under 0.1%.
    renderBook([spot("BTC", 40_000), spot("FIFTY", 50), spot("FORTY9", 49.99)]);
    expect(symbols(spotWrap())).toEqual(["BTC", "FIFTY"]);
  });

  it("exactly 0.1% of Book equity stays visible; a dollar under it hides", () => {
    // Book 1,000,000: 0.1% is exactly 1000.
    renderBook([spot("BIG", 998_001), spot("EXACT", 1000), spot("UNDER", 999)]);
    expect(symbols(spotWrap())).toEqual(["BIG", "EXACT"]);
  });

  it("with no usable Book equity only the $50 test applies", () => {
    // Derivatives with no reported P&L: Book equity is 0, so no 0.1% share exists.
    renderBook([perp("SIXTY", 60, null), perp("THIRTY", 30, null)]);
    expect(symbols(derivWrap())).toEqual(["SIXTY"]);
    expect(screen.getByRole("button", { name: "Show 1 small position" })).toBeTruthy();
  });

  it("an unpriced spot row worth $3 is never dust", () => {
    renderBook([
      spot("BTC", 40_000),
      spot("NOPRICE", 3, { mark_price_usd: null }),
    ]);
    expect(symbols(spotWrap())).toEqual(["BTC", "NOPRICE"]);
    expect(control()).toBeNull();
  });

  it("a $3 row on a key that needs attention stays visible with its chip and filter", () => {
    renderBook([spot("BTC", 40_000), spot("BADKEY", 3, { api_key_id: "key-bad" })]);
    expect(symbols(spotWrap())).toEqual(["BTC", "BADKEY"]);
    const chip = keyAttentionChipLabel({ sync_status: "revoked", disconnected_at: null });
    expect(within(spotWrap()).getByText(chip as string)).toBeTruthy();
    expect(within(spotWrap()).getByRole("checkbox")).toBeTruthy();
    expect(control()).toBeNull();
  });

  it("a row on a key missing from the key list is never dust", () => {
    renderBook([spot("BTC", 40_000), spot("GONE", 3, { api_key_id: "key-nobody" })]);
    expect(symbols(spotWrap())).toEqual(["BTC", "GONE"]);
  });
});

describe("zero dust renders nothing of the control", () => {
  it("no button, no caption and no live-region text", () => {
    renderBook([spot("BTC", 40_000), perp("BIG-PERP", 30_000, 500)]);
    expect(control()).toBeNull();
    expect(screen.queryByText(DUST_RULE_CAPTION)).toBeNull();
    expect(within(positions()).queryAllByRole("status")).toHaveLength(0);
  });

  it("an empty book keeps each table's shipped empty line and no control", () => {
    renderBook([]);
    expect(within(spotWrap()).getByText("No holdings to display.")).toBeTruthy();
    expect(within(derivWrap()).getByText("No open derivative positions.")).toBeTruthy();
    expect(control()).toBeNull();
  });
});

describe("a table whose rows are all hidden says so", () => {
  it("spot: '1 small position hidden.' instead of the shipped empty lines", () => {
    renderBook([spot("DOGE", 12), perp("BIG-PERP", 30_000, 1000)]);
    expect(within(spotWrap()).getByText("1 small position hidden.")).toBeTruthy();
    expect(within(spotWrap()).queryByText(/No spot holdings|No holdings to display/)).toBeNull();
  });

  it("derivatives: '2 small positions hidden.' instead of its shipped line", () => {
    renderBook([spot("BTC", 40_000), perp("A-PERP", 30, 5), perp("B-PERP", 20, 5)]);
    expect(within(derivWrap()).getByText("2 small positions hidden.")).toBeTruthy();
    expect(within(derivWrap()).queryByText("No open derivative positions.")).toBeNull();
  });
});
