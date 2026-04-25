import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * v0.15.7.0 — HoldingsTabPanel revoked-status join (regression coverage
 * for the deleted T12b that lived in AllocationDashboard.revoked-holdings.test.tsx).
 *
 * Contract under test: HoldingsTabPanel builds `revokedStatusByHoldingId`
 * by joining `props.apiKeys` (api_key.id → sync_status) onto
 * `props.holdingsSummary` (api_key_id) and keying the result by
 * `buildHoldingRef(h)`. The join must:
 *
 *   1. Resolve `revoked` for a holding whose api_key_id points to a
 *      revoked apiKey row.
 *   2. Resolve `complete` for a holding whose api_key_id points to a
 *      complete apiKey row.
 *   3. Default to `unknown` when api_key_id is null OR the FK doesn't
 *      resolve (defensive — RESTRICT FK should prevent the latter).
 *
 * The test stubs HoldingsTable to a marker that exposes the
 * `revokedStatusByHoldingId` prop verbatim, so the assertion is
 * end-to-end: real adapter + real useMemo, only the visual layer mocked.
 */

vi.mock("./components/HoldingsTable", () => ({
  HoldingsTable: (props: { revokedStatusByHoldingId?: Record<string, string> }) => (
    <div
      data-testid="holdings-table-stub"
      data-revoked-map={JSON.stringify(props.revokedStatusByHoldingId ?? {})}
    />
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
  const stub = container.querySelector("[data-testid='holdings-table-stub']");
  expect(stub).not.toBeNull();
  const raw = stub!.getAttribute("data-revoked-map");
  return JSON.parse(raw ?? "{}") as Record<string, string>;
}

describe("HoldingsTabPanel — revokedStatusByHoldingId join (T12b regression)", () => {
  it("revoked apiKey → 'revoked' in revokedStatusByHoldingId", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(REVOKED_HOLDING);
    expect(map[ref]).toBe("revoked");
  });

  it("complete apiKey → 'complete' in revokedStatusByHoldingId", () => {
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
