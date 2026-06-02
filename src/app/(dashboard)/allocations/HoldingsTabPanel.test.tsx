import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * v0.15.7.0 / F4b — HoldingsTabPanel revoked-status join (regression coverage
 * for the deleted T12b that lived in AllocationDashboard.revoked-holdings.test.tsx).
 *
 * Contract under test: HoldingsTabPanel joins `props.apiKeys`
 * (api_key.id → sync_status) onto `props.holdingsSummary` (api_key_id) so each
 * spot position carries the correct `source_key_sync_status`. F4b moved spot
 * positions to the secondary "Exchange Positions" section, rendered via the
 * legacy `HoldingsTable` mode (the `holdings` prop), so the resolved status now
 * lives on `HoldingRow.source_key_sync_status` rather than the design-mode
 * `revokedStatusByHoldingId` map. The join must:
 *
 *   1. Resolve `revoked` for a holding whose api_key_id points to a
 *      revoked apiKey row.
 *   2. Resolve `complete` for a holding whose api_key_id points to a
 *      complete apiKey row.
 *   3. Default to `unknown` when api_key_id is null OR the FK doesn't
 *      resolve (defensive — RESTRICT FK should prevent the latter).
 *
 * The panel now renders `HoldingsTable` twice — once in strategy-row mode
 * (Section 1, `strategyRows`) and once in legacy mode (Section 2, `holdings`).
 * The stub serializes whichever prop is present so the test can pick the
 * legacy (`holdings`) render and assert the per-holding sync status.
 */

vi.mock("./components/HoldingsTable", () => ({
  HoldingsTable: (props: {
    strategyRows?: unknown[];
    holdings?: { id: string; source_key_sync_status: string }[];
  }) =>
    props.holdings ? (
      <div
        data-testid="holdings-table-legacy"
        data-holdings={JSON.stringify(props.holdings)}
      />
    ) : (
      <div data-testid="holdings-table-strategies" />
    ),
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { buildHoldingRef } from "./lib/holding-outcome-adapter";

const REVOKED_HOLDING = {
  symbol: "BTC",
  quantity: 1.5,
  mark_price_usd: 60_000,
  value_usd: 90_000,
  venue: "binance",
  holding_type: "spot" as const,
  api_key_id: "key-revoked",
};

const ACTIVE_HOLDING = {
  symbol: "ETH",
  quantity: 10,
  mark_price_usd: 3000,
  value_usd: 30_000,
  venue: "coinbase",
  holding_type: "spot" as const,
  api_key_id: "key-complete",
};

const ORPHAN_HOLDING = {
  symbol: "SOL",
  quantity: 100,
  mark_price_usd: 100,
  value_usd: 10_000,
  venue: "kraken",
  holding_type: "spot" as const,
  api_key_id: null,
};

const STUB_PAYLOAD = {
  portfolio: null,
  analytics: null,
  apiKeys: [
    {
      id: "key-revoked",
      sync_status: "revoked",
      venue: "binance",
      key_label: "BNB key",
    },
    {
      id: "key-complete",
      sync_status: "complete",
      venue: "coinbase",
      key_label: "CB key",
    },
  ],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [REVOKED_HOLDING, ACTIVE_HOLDING, ORPHAN_HOLDING],
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

function renderPanel() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { container } = render(<HoldingsTabPanel {...(STUB_PAYLOAD as any)} />);
  const stub = container.querySelector("[data-testid='holdings-table-legacy']");
  expect(stub).not.toBeNull();
  const raw = stub!.getAttribute("data-holdings");
  const rows = JSON.parse(raw ?? "[]") as {
    id: string;
    source_key_sync_status: string;
  }[];
  // Build ref → source_key_sync_status for the assertions.
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.source_key_sync_status;
  return map;
}

describe("HoldingsTabPanel — source_key_sync_status join (T12b regression)", () => {
  it("revoked apiKey → 'revoked' on the spot holding row", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(REVOKED_HOLDING);
    expect(map[ref]).toBe("revoked");
  });

  it("complete apiKey → 'complete' on the spot holding row", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(ACTIVE_HOLDING);
    expect(map[ref]).toBe("complete");
  });

  it("holding with null api_key_id → 'unknown' (defensive default)", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(ORPHAN_HOLDING);
    expect(map[ref]).toBe("unknown");
  });
});
