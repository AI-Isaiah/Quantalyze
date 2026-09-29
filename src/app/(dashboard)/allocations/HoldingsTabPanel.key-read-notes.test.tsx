import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Review C4 SFH-C4-08 and WR-01. Open Positions keeps each key's rows at that
 * key's own latest read (D-16), so a key that has not read its account for
 * weeks, or has disconnected, still shows its last read. Those rows must say
 * how old they are. And a live key whose last sync could not read its open
 * positions (a derivative-side failure keeps only the spot rows at the key's
 * newest day) must say its positions may be missing, beside the table the
 * owner reads them from.
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
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(props as any)} />);
}

describe("HoldingsTabPanel: open positions say how old an older key's read is (SFH-C4-08)", () => {
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

  it("says nothing for rows that carry no read day", () => {
    renderPanel(
      [perp("key-a", "BTC-PERP"), perp("key-b", "ETH-PERP", "2026-09-29")],
      [apiKey("key-a", "A"), apiKey("key-b", "B")],
    );
    expect(screen.queryByTestId("open-positions-read-day-note")).toBeNull();
  });
});
