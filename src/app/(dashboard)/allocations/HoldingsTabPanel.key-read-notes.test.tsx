import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  HoldingsTable: () => <div />,
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
