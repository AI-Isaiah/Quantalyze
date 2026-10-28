import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Review C4 SFH-C4-08 and WR-01. Open Positions keeps each key's rows at that
 * key's own latest read (D-16), so a key that has not read its account for
 * weeks, or has disconnected, still shows its last read. Those rows must say
 * how old they are. And a key whose rows on screen came from a poll that could
 * not read its open positions (a derivative-side failure keeps only the spot
 * rows at the key's newest day) must say its positions are missing, beside the
 * table the owner reads them from, for as long as those rows are shown.
 */

vi.mock("./components/HoldingsTable", () => ({
  // The stub carries the panel's show-revoked toggle so a test can turn it off.
  HoldingsTable: ({
    onShowRevokedChange,
  }: {
    onShowRevokedChange: (next: boolean) => void;
  }) => (
    <div data-testid="holdings-table-stub">
      <button
        type="button"
        data-testid="stub-hide-revoked"
        onClick={() => onShowRevokedChange(false)}
      />
    </div>
  ),
}));
vi.mock("./components/OpenPositionsTable", () => ({
  OpenPositionsTable: () => <div data-testid="open-positions-table-stub" />,
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";

const perp = (api_key_id: string, symbol: string, asof?: string) => ({
  symbol,
  quantity: 1,
  mark_price_usd: 100,
  value_usd: 100,
  venue: "binance",
  holding_type: "derivative" as const,
  api_key_id,
  side: "long" as const,
  entry_price: 90,
  unrealized_pnl_usd: 10,
  ...(asof ? { asof } : {}),
});

const apiKey = (
  id: string,
  label: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  exchange: "binance",
  label,
  is_active: true,
  sync_status: "complete",
  last_sync_at: null,
  account_balance_usdt: null,
  created_at: "2026-01-01T00:00:00Z",
  sync_error: null,
  last_429_at: null,
  disconnected_at: null,
  ...overrides,
});

function renderPanel(
  holdingsSummary: unknown[],
  apiKeys: unknown[],
  partialPositionReads: unknown[] = [],
) {
  const props = {
    portfolio: null,
    analytics: null,
    apiKeys,
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    equitySnapshots: [],
    holdingsSummary,
    snapshotCount: 30,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [],
    minHistoryDepthMonths: null,
    activeVenues: [],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    strategies: [],
    exposure: EMPTY_EXPOSURE,
    partialPositionReads,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(props as any)} />);
}

describe("HoldingsTabPanel: open positions say how old an older key's read is (SFH-C4-08)", () => {
  // Pinned so the absolute arm below (SFH-R2-03) does not move with the clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the key, its read day and its positions when that day is older than the newest read", () => {
    renderPanel(
      [
        perp("key-old", "BTC-PERP", "2026-08-31"),
        perp("key-old", "SOL-PERP", "2026-08-31"),
        perp("key-new", "ETH-PERP", "2026-09-29"),
      ],
      [
        apiKey("key-old", "Old", { disconnected_at: "2026-09-01T00:00:00Z" }),
        apiKey("key-new", "New"),
      ],
    );
    const notes = screen.getAllByTestId("open-positions-read-day-note");
    expect(notes.map((n) => n.textContent)).toEqual([
      "Positions from the Binance key Old are as last read on 2026-08-31: BTC-PERP, SOL-PERP.",
    ]);
  });

  it("says nothing when every key read on the same day", () => {
    renderPanel(
      [perp("key-a", "BTC-PERP", "2026-09-29"), perp("key-b", "ETH-PERP", "2026-09-29")],
      [apiKey("key-a", "A"), apiKey("key-b", "B")],
    );
    expect(screen.queryByTestId("open-positions-read-day-note")).toBeNull();
  });

  it("SFH-R2-03: a one-key book whose only key last read weeks ago is dated", () => {
    renderPanel(
      [perp("key-a", "BTC-PERP", "2026-09-08")],
      [apiKey("key-a", "Main", { sync_status: "error" })],
    );
    expect(
      screen.getAllByTestId("open-positions-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Positions from the Binance key Main are as last read on 2026-09-08: BTC-PERP.",
    ]);
  });

  it("SFH-R2-03: every key equally stale, every key dated", () => {
    renderPanel(
      [perp("key-a", "BTC-PERP", "2026-09-20"), perp("key-b", "ETH-PERP", "2026-09-20")],
      [apiKey("key-a", "A"), apiKey("key-b", "B")],
    );
    expect(
      screen.getAllByTestId("open-positions-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Positions from the Binance key A are as last read on 2026-09-20: BTC-PERP.",
      "Positions from the Binance key B are as last read on 2026-09-20: ETH-PERP.",
    ]);
  });

  it("SFH-R2-03: a read from yesterday is not dated (the daily poll may not have run yet)", () => {
    renderPanel([perp("key-a", "BTC-PERP", "2026-09-28")], [apiKey("key-a", "Main")]);
    expect(screen.queryByTestId("open-positions-read-day-note")).toBeNull();
  });

  it("SFH-R2-03: a read from two days ago is dated", () => {
    renderPanel([perp("key-a", "BTC-PERP", "2026-09-27")], [apiKey("key-a", "Main")]);
    expect(screen.getAllByTestId("open-positions-read-day-note")).toHaveLength(1);
  });

  it("says nothing for rows that carry no read day", () => {
    renderPanel(
      [perp("key-a", "BTC-PERP"), perp("key-b", "ETH-PERP", "2026-09-29")],
      [apiKey("key-a", "A"), apiKey("key-b", "B")],
    );
    expect(screen.queryByTestId("open-positions-read-day-note")).toBeNull();
  });
});

describe("HoldingsTabPanel: a key whose rows' poll could not read its positions says so (WR-01, WR-R2-03)", () => {
  // The line is bound to the poll that wrote the rows on screen
  // (`partialPositionReads`, from the reader), never to the key's current
  // `sync_status`: a later failed poll writes no rows, so the partial rows and
  // the line both stay.
  const partial = [{ api_key_id: "key-a", asof: "2026-09-05" }];
  const spot = { ...perp("key-a", "USDT", "2026-09-05"), holding_type: "spot" as const };

  it("names the key and its sync day", () => {
    renderPanel([spot], [apiKey("key-a", "Main", { sync_status: "complete_with_warnings" })], partial);
    expect(
      screen.getByTestId("open-positions-partial-read-note").textContent,
    ).toBe(
      "Open positions from the Binance key Main could not be read on its sync of 2026-09-05. Any it holds are missing below until a sync reads them.",
    );
  });

  it.each([["rate_limited"], ["error"], ["syncing"], ["complete"]])(
    "stays when the key's current status moved on to %s",
    (status) => {
      renderPanel([spot], [apiKey("key-a", "Main", { sync_status: status })], partial);
      expect(screen.getAllByTestId("open-positions-partial-read-note")).toHaveLength(1);
    },
  );

  it("says nothing when the rows' poll read the positions, whatever the key's status says", () => {
    renderPanel([spot], [apiKey("key-a", "Main", { sync_status: "complete_with_warnings" })], []);
    expect(screen.queryByTestId("open-positions-partial-read-note")).toBeNull();
  });

  it("a departed key's rows say so without promising a sync", () => {
    renderPanel(
      [spot],
      [apiKey("key-a", "Old", { disconnected_at: "2026-09-10T00:00:00Z" })],
      partial,
    );
    expect(
      screen.getByTestId("open-positions-partial-read-note").textContent,
    ).toBe(
      "Open positions from the Binance key Old could not be read on its sync of 2026-09-05. Any it held then are missing below.",
    );
  });

  it.each([
    ["an MT5 account (its warnings are not a positions read)", "mt5"],
    ["an sFOX account (its warnings are not a positions read)", "sfox"],
  ])("says nothing for %s", (_label, exchange) => {
    renderPanel([{ ...spot, venue: exchange }], [apiKey("key-a", "Main", { exchange })], partial);
    expect(screen.queryByTestId("open-positions-partial-read-note")).toBeNull();
  });
});

const spotRow = (api_key_id: string, symbol: string, asof?: string, venue = "binance") => ({
  symbol,
  quantity: 1,
  mark_price_usd: 100,
  value_usd: 100,
  venue,
  holding_type: "spot" as const,
  api_key_id,
  ...(asof ? { asof } : {}),
});

describe("HoldingsTabPanel: a stale key's spot rows say how old their read is (167.1.2.1.2 D-05)", () => {
  // Same pinned clock as the Open Positions arms: 2026-09-29 12:00Z, so
  // yesterday UTC is 2026-09-28.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the key, its read day and its spot symbols in the pinned sentence", () => {
    // WHY (D-05): a spot balance carried from an old read looks current in the
    // table, which carries no date column. The line is the only place the
    // owner learns how old the figure is.
    renderPanel(
      [
        spotRow("key-main", "BTC", "2026-09-20"),
        spotRow("key-main", "USDT", "2026-09-20"),
        perp("key-new", "ETH-PERP", "2026-09-29"),
      ],
      [apiKey("key-main", "Main"), apiKey("key-new", "New")],
    );
    expect(
      screen.getAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual(["Spot holdings from the Binance key Main are as last read on 2026-09-20: BTC, USDT."]);
  });

  it("wraps long unbroken symbols instead of overflowing a 375px page (class tokens pinned)", () => {
    // WHY (D-05, UI-SPEC): an MT5 ACCOUNT-<hex> symbol ran 160px past its card
    // at 375px in v0.132.0.1. jsdom cannot measure layout, so the tokens that
    // prevent that are pinned here; the real 375/390 measurement is a backstop.
    renderPanel(
      [spotRow("key-main", "ACCOUNT-0123456789abcdef0123456789abcdef", "2026-09-20", "mt5")],
      [apiKey("key-main", "Main", { exchange: "mt5" })],
    );
    const note = screen.getByTestId("holdings-read-day-note");
    const tokens = note.className.split(/\s+/);
    expect(tokens).toEqual(expect.arrayContaining(["text-xs", "text-text-muted", "[overflow-wrap:anywhere]"]));
    for (const forbidden of ["truncate", "whitespace-nowrap", "overflow-x-hidden"]) {
      expect(tokens).not.toContain(forbidden);
    }
    // No margin, padding or px max-w: the section's grid gap spaces it.
    expect(tokens.filter((t) => /^(m|p|max-w)[a-z]?-/.test(t))).toEqual([]);
  });

  it("sits in the Exchange Positions section after the spot table and before Open Positions", () => {
    // WHY (D-05): the line dates the table directly above it; placed after
    // Open Positions it would read as dating the derivative rows.
    renderPanel(
      [spotRow("key-main", "BTC", "2026-09-20"), perp("key-new", "ETH-PERP", "2026-09-29")],
      [apiKey("key-main", "Main"), apiKey("key-new", "New")],
    );
    const note = screen.getByTestId("holdings-read-day-note");
    // The Overview section renders a HoldingsTable stub too, so scope to the
    // note's own section.
    const section = note.parentElement as HTMLElement;
    const spotTable = within(section).getByTestId("holdings-table-stub");
    const openTable = within(section).getByTestId("open-positions-table-stub");
    expect(section.getAttribute("aria-label")).toBeNull();
    expect(section.querySelector("h3")?.textContent).toBe("Exchange Positions");
    expect(spotTable.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(openTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  const positionLines = () =>
    screen.queryAllByTestId("open-positions-read-day-note").map((n) => n.textContent);

  it("an unlabelled key reads 'the Binance key', a key missing from the list 'a Binance key'", () => {
    // WHY (D-08): the spot line reuses keyPhrase, so a blank label or a dropped
    // key never prints "undefined" or an empty name in front of the date.
    renderPanel(
      [
        spotRow("key-blank", "BTC", "2026-09-20"),
        spotRow("key-gone", "USDT", "2026-09-20"),
        perp("key-new", "ETH-PERP", "2026-09-29"),
      ],
      [apiKey("key-blank", "  "), apiKey("key-new", "New")],
    );
    expect(
      screen.queryAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Spot holdings from the Binance key are as last read on 2026-09-20: BTC.",
      "Spot holdings from a Binance key are as last read on 2026-09-20: USDT.",
    ]);
  });

  it("dates a one-key book whose only read is old (the reference is yesterday UTC)", () => {
    // WHY (SFH-R2-03 carried to spot): comparing only to the newest read never
    // dated a book with a single key, so one key failing for weeks showed
    // undated balances.
    renderPanel([spotRow("key-a", "BTC", "2026-09-08")], [apiKey("key-a", "Main")]);
    expect(
      screen.queryAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Spot holdings from the Binance key Main are as last read on 2026-09-08: BTC.",
    ]);
  });

  it("a read from yesterday is not dated, a read from two days ago is", () => {
    // WHY: the daily poll runs at 04:00 UTC, so between midnight and the poll
    // a healthy key's latest read is yesterday's. Flagging it would cry wolf
    // every morning.
    const { unmount } = renderPanel([spotRow("key-a", "BTC", "2026-09-28")], [apiKey("key-a", "Main")]);
    expect(screen.queryAllByTestId("holdings-read-day-note")).toHaveLength(0);
    unmount();
    renderPanel([spotRow("key-a", "BTC", "2026-09-27")], [apiKey("key-a", "Main")]);
    expect(screen.queryAllByTestId("holdings-read-day-note")).toHaveLength(1);
  });

  it("says nothing for spot rows without a read day, and renders no element when nothing is stale", () => {
    // WHY: a legacy payload has no asof; inventing a date or an "unknown" line
    // would assert something the data does not say.
    renderPanel(
      [
        spotRow("key-a", "BTC"),
        spotRow("key-b", "ETH", "2026-09-29"),
        perp("key-b", "ETH-PERP", "2026-09-29"),
      ],
      [apiKey("key-a", "A"), apiKey("key-b", "B")],
    );
    expect(screen.queryAllByTestId("holdings-read-day-note")).toHaveLength(0);
  });

  it("gives one line per stale key in first-appearance order, each naming only its own symbols, and none for a fresh key", () => {
    // WHY: one line per key keeps the section short and lets the owner match a
    // date to the key whose rows it dates; a fresh key beside a stale one must
    // not be dragged into the sentence.
    renderPanel(
      [
        spotRow("key-b", "SOL", "2026-09-18"),
        spotRow("key-a", "BTC", "2026-09-20"),
        spotRow("key-fresh", "ETH", "2026-09-29"),
        spotRow("key-b", "USDC", "2026-09-18"),
        spotRow("key-a", "USDT", "2026-09-20"),
      ],
      [apiKey("key-a", "A"), apiKey("key-b", "B"), apiKey("key-fresh", "Fresh")],
    );
    expect(
      screen.queryAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Spot holdings from the Binance key B are as last read on 2026-09-18: SOL, USDC.",
      "Spot holdings from the Binance key A are as last read on 2026-09-20: BTC, USDT.",
    ]);
  });

  it("dates one key's read the same on the spot line and the Open Positions line (shared reference)", () => {
    // WHY (T-167.1.2.1.2-07): a read from yesterday is dated only because
    // another key read today. If the spot line took its reference from the spot
    // rows alone, key-a's spot balance would read as current while its
    // positions beside it read as stale, two contradictory dates for one read.
    renderPanel(
      [
        spotRow("key-a", "BTC", "2026-09-28"),
        perp("key-a", "BTC-PERP", "2026-09-28"),
        perp("key-b", "ETH-PERP", "2026-09-29"),
      ],
      [apiKey("key-a", "A"), apiKey("key-b", "B")],
    );
    expect(
      screen.queryAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Spot holdings from the Binance key A are as last read on 2026-09-28: BTC.",
    ]);
    expect(positionLines()).toEqual([
      "Positions from the Binance key A are as last read on 2026-09-28: BTC-PERP.",
    ]);
  });

  it("a key with only dated spot rows gets only the spot line, a key with only dated positions only the Open Positions line", () => {
    // WHY: each line dates its own table; a line under the wrong table would
    // date rows the sentence does not name.
    renderPanel(
      [
        spotRow("key-spot", "BTC", "2026-09-20"),
        perp("key-perp", "ETH-PERP", "2026-09-21"),
      ],
      [apiKey("key-spot", "S"), apiKey("key-perp", "P")],
    );
    expect(
      screen.queryAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Spot holdings from the Binance key S are as last read on 2026-09-20: BTC.",
    ]);
    expect(positionLines()).toEqual([
      "Positions from the Binance key P are as last read on 2026-09-21: ETH-PERP.",
    ]);
  });

  it("still dates a revoked, disconnected key's stale spot rows (the line ignores the Show-revoked toggle)", () => {
    // WHY: the toggle acts inside HoldingsTable and the hidden-count footer
    // discloses hidden rows. If the line followed the toggle, a departed key's
    // stale balance would lose its date exactly when the owner hides it, and
    // the figure would look current the moment it is shown again.
    renderPanel(
      [spotRow("key-old", "BTC", "2026-09-01"), perp("key-new", "ETH-PERP", "2026-09-29")],
      [
        apiKey("key-old", "Old", { sync_status: "revoked", disconnected_at: "2026-09-02T00:00:00Z" }),
        apiKey("key-new", "New"),
      ],
    );
    expect(
      screen.queryAllByTestId("holdings-read-day-note").map((n) => n.textContent),
    ).toEqual([
      "Spot holdings from the Binance key Old are as last read on 2026-09-01: BTC.",
    ]);
  });
});

describe("HoldingsTabPanel: a spot row with no price is named under the spot table (167.2.1.1.1.1 D-07, P3)", () => {
  // A gap row: a positive quantity with no usable mark. Its stored value is 0.
  const gapRow = (api_key_id: string, symbol: string, mark: number | null = 0) => ({
    ...spotRow(api_key_id, symbol),
    mark_price_usd: mark,
    value_usd: 0,
  });
  const note = () => screen.queryAllByTestId("holdings-price-gap-note");

  it("one gap row beside a priced one reads the singular sentence, in the muted wrapping class", () => {
    // WHY (D-07): the tab shows no AUM figure, so the line is where the
    // allocator learns the unpriced row is not in portfolio AUM.
    renderPanel(
      [gapRow("key-a", "ZZZ"), spotRow("key-a", "BTC")],
      [apiKey("key-a", "A")],
    );
    expect(note().map((n) => n.textContent)).toEqual([
      "1 holding has no price, so portfolio AUM leaves it out.",
    ]);
    const el = note()[0];
    const tokens = el.className.split(/\s+/);
    expect(tokens.sort()).toEqual(["[overflow-wrap:anywhere]", "text-text-muted", "text-xs"]);
    expect(el.hasAttribute("role")).toBe(false);
    expect(el.hasAttribute("aria-live")).toBe(false);
  });

  it("sits after the spot table and the read-day notes and before Open Positions", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    try {
      renderPanel(
        [{ ...gapRow("key-a", "ZZZ"), asof: "2026-09-20" }, perp("key-b", "ETH-PERP", "2026-09-29")],
        [apiKey("key-a", "A"), apiKey("key-b", "B")],
      );
      const gap = screen.getByTestId("holdings-price-gap-note");
      const readDay = screen.getByTestId("holdings-read-day-note");
      const section = gap.parentElement as HTMLElement;
      const spotTable = within(section).getByTestId("holdings-table-stub");
      const openTable = within(section).getByTestId("open-positions-table-stub");
      expect(spotTable.compareDocumentPosition(gap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(readDay.compareDocumentPosition(gap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(gap.compareDocumentPosition(openTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("three gap rows read the plural sentence with the count", () => {
    renderPanel(
      [gapRow("key-a", "AAA"), gapRow("key-a", "BBB", null), gapRow("key-a", "CCC", -1)],
      [apiKey("key-a", "A")],
    );
    expect(note().map((n) => n.textContent)).toEqual([
      "3 holdings have no price, so portfolio AUM leaves them out.",
    ]);
  });

  it("says nothing for priced rows, a quantity-0 mark-0 row, or a derivative with mark 0", () => {
    // WHY: only a spot row the book holds without a price is a gap; a closed
    // row and a derivative (valued by its P&L) are not.
    renderPanel(
      [
        spotRow("key-a", "BTC"),
        { ...spotRow("key-a", "DUST"), quantity: 0, mark_price_usd: 0, value_usd: 0 },
        { ...perp("key-a", "ETH-PERP"), mark_price_usd: 0 },
      ],
      [apiKey("key-a", "A")],
    );
    expect(note()).toHaveLength(0);
  });

  it("still counts a gap row on a revoked key after the show-revoked toggle is turned off", () => {
    // WHY: the toggle hides rows inside the table; the note counts all spot
    // rows, as the read-day note does, so hiding a row does not hide the fact.
    renderPanel(
      [gapRow("key-old", "ZZZ")],
      [apiKey("key-old", "Old", { sync_status: "revoked", disconnected_at: "2026-09-02T00:00:00Z" })],
    );
    // The Overview section renders a HoldingsTable stub too; the Exchange
    // Positions table is the one in the note's own section.
    const section = screen.getByTestId("holdings-price-gap-note").parentElement as HTMLElement;
    fireEvent.click(within(section).getByTestId("stub-hide-revoked"));
    expect(note().map((n) => n.textContent)).toEqual([
      "1 holding has no price, so portfolio AUM leaves it out.",
    ]);
  });
});
