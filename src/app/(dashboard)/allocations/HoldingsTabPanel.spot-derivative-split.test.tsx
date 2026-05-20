import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * Regression — 2026-05-20 spot/derivative split.
 *
 * Bug shape: a derivative position appeared as a second "holding" row in
 * the Holdings table, alongside spot USDT, with the derivative's notional
 * (CCXT `size_usd`, written to `allocator_holdings.value_usd`) shown as
 * its "value". This conflates two semantics:
 *
 *   - spot.value_usd        = qty × mark_price  → IS the equity contribution
 *   - derivative.value_usd  = size_usd notional → is NOT the equity
 *     contribution; the actual equity contribution is `unrealized_pnl_usd`
 *
 * Result: a leveraged perp swamped the weight denominator and inflated
 * apparent allocation. The equity-curve chart (computed in Python) was
 * always correct — the bug was purely in the dashboard holdings panel.
 *
 * Fix: partition holdingsSummary into spot (→ HoldingsTable) and
 * derivative (→ OpenPositionsTable) at the panel boundary. This test
 * encodes the invariant: a derivative row MUST NOT reach HoldingsTable's
 * `rows` prop, and its `unrealized_pnl_usd` MUST be the one surfaced as
 * the equity contribution on OpenPositionsTable.
 */

// Both child components stubbed so we can inspect the props each receives
// without depending on their internal rendering. Props are serialized to
// JSON on a data attribute and read back in the assertions.
vi.mock("./components/HoldingsTable", () => ({
  HoldingsTable: (props: { rows?: Array<{ symbol: string; alloc: number }> }) => (
    <div
      data-testid="holdings-table-stub"
      data-rows={JSON.stringify(props.rows ?? [])}
    />
  ),
}));

vi.mock("./components/OpenPositionsTable", () => ({
  OpenPositionsTable: (props: {
    rows?: Array<{
      symbol: string;
      notional_usd: number;
      unrealized_pnl_usd: number | null;
      side: string;
    }>;
  }) => (
    <div
      data-testid="open-positions-table-stub"
      data-rows={JSON.stringify(props.rows ?? [])}
    />
  ),
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";

const SPOT_USDT = {
  symbol: "USDT",
  quantity: 1_000,
  mark_price_usd: 1,
  value_usd: 1_000,
  venue: "binance",
  holding_type: "spot" as const,
  api_key_id: "key-1",
  side: "flat" as const,
  entry_price: null,
  unrealized_pnl_usd: null,
};

/** A leveraged perp: 500k notional, but only +250 USD unrealized PnL. */
const PERP_ETH = {
  symbol: "ETHUSDT",
  quantity: 200,
  mark_price_usd: 2_500,
  value_usd: 500_000, // notional — MUST NOT be the equity contribution
  venue: "binance",
  holding_type: "derivative" as const,
  api_key_id: "key-1",
  side: "long" as const,
  entry_price: 2_498.75,
  unrealized_pnl_usd: 250,
};

const PAYLOAD = {
  portfolio: null,
  analytics: null,
  apiKeys: [
    { id: "key-1", sync_status: "complete", venue: "binance", key_label: "BNB" },
  ],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [SPOT_USDT, PERP_ETH],
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
};

function renderAndReadProps() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { container } = render(<HoldingsTabPanel {...(PAYLOAD as any)} />);
  const holdingsStub = container.querySelector(
    "[data-testid='holdings-table-stub']",
  );
  const positionsStub = container.querySelector(
    "[data-testid='open-positions-table-stub']",
  );
  expect(holdingsStub).not.toBeNull();
  expect(positionsStub).not.toBeNull();
  const holdingsRows = JSON.parse(
    holdingsStub!.getAttribute("data-rows") ?? "[]",
  ) as Array<{ symbol: string; alloc: number }>;
  const positionRows = JSON.parse(
    positionsStub!.getAttribute("data-rows") ?? "[]",
  ) as Array<{
    symbol: string;
    notional_usd: number;
    unrealized_pnl_usd: number | null;
    side: string;
  }>;
  return { holdingsRows, positionRows };
}

describe("HoldingsTabPanel — spot vs derivative split (2026-05-20 regression)", () => {
  it("Holdings table receives ONLY spot rows", () => {
    const { holdingsRows } = renderAndReadProps();
    expect(holdingsRows.map((r) => r.symbol)).toEqual(["USDT"]);
  });

  it("derivative's notional (500k) MUST NOT appear in the Holdings table", () => {
    const { holdingsRows } = renderAndReadProps();
    // Pre-fix: a row with alloc=500_000 would be present here, swamping
    // the spot row's weight. Post-fix: derivatives are partitioned out.
    expect(holdingsRows.find((r) => r.alloc === 500_000)).toBeUndefined();
    expect(holdingsRows.find((r) => r.symbol === "ETHUSDT")).toBeUndefined();
  });

  it("Open Positions table receives the derivative row with notional + unrealized PnL", () => {
    const { positionRows } = renderAndReadProps();
    expect(positionRows).toHaveLength(1);
    expect(positionRows[0].symbol).toBe("ETHUSDT");
    expect(positionRows[0].side).toBe("long");
    // Notional surfaces as exposure (clearly labeled in the UI), NOT
    // equity. The 500k must be visible in the position row.
    expect(positionRows[0].notional_usd).toBe(500_000);
    // Unrealized PnL — the actual equity contribution — must be forwarded.
    expect(positionRows[0].unrealized_pnl_usd).toBe(250);
  });

  it("Open Positions table does NOT receive spot rows", () => {
    const { positionRows } = renderAndReadProps();
    expect(positionRows.find((r) => r.symbol === "USDT")).toBeUndefined();
  });
});
