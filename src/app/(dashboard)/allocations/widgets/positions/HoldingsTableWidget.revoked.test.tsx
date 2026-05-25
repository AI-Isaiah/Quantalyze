import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * H-1206 — HoldingsTableWidget revoked-status join coverage.
 *
 * The existing 'propagates sync_status=revoked through
 * revokedStatusByHoldingId' test only asserts the row is in the DOM
 * (`getByText(/SOL/i)`) — it never verifies the holding actually receives
 * the 'revoked' status. HoldingsTableWidget is the V2 dashboard surface
 * (distinct from the Holdings tab body), so its api_key.id → sync_status
 * join is independent code from HoldingsTabPanel's. A refactor that drops
 * the FK match (returning 'unknown' instead of 'revoked') would silently
 * pass the smoke test while breaking the strikethrough + amber chip.
 *
 * Same idiom as HoldingsTabPanel.test.tsx (T12b): stub HoldingsTable to a
 * marker that surfaces the `revokedStatusByHoldingId` prop verbatim as a
 * JSON attribute, then assert the join end-to-end (real adapter + real
 * useMemo, only the visual layer mocked). The widget also mounts
 * OpenPositionsTable; stub it too so the assertion targets only the join.
 */

vi.mock("../../components/HoldingsTable", () => ({
  HoldingsTable: (props: {
    revokedStatusByHoldingId?: Record<string, string>;
  }) => (
    <div
      data-testid="holdings-table-stub"
      data-revoked-map={JSON.stringify(props.revokedStatusByHoldingId ?? {})}
    />
  ),
}));

vi.mock("../../components/OpenPositionsTable", () => ({
  OpenPositionsTable: () => <div data-testid="open-positions-stub" />,
}));

// next/navigation is consumed transitively; stub it for jsdom safety.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { HoldingsTableWidget } from "./HoldingsTableWidget";
import { buildHoldingRef } from "../../lib/holding-outcome-adapter";

const REVOKED_HOLDING = {
  symbol: "SOL",
  quantity: 100,
  mark_price_usd: 100,
  value_usd: 10_000,
  venue: "binance",
  holding_type: "spot" as const,
  api_key_id: "key-revoked",
};

const COMPLETE_HOLDING = {
  symbol: "BTC",
  quantity: 1,
  mark_price_usd: 60_000,
  value_usd: 60_000,
  venue: "okx",
  holding_type: "spot" as const,
  api_key_id: "key-complete",
};

const ORPHAN_HOLDING = {
  symbol: "ETH",
  quantity: 10,
  mark_price_usd: 3_000,
  value_usd: 30_000,
  venue: "kraken",
  holding_type: "spot" as const,
  api_key_id: null,
};

function makeData() {
  return {
    holdingsSummary: [REVOKED_HOLDING, COMPLETE_HOLDING, ORPHAN_HOLDING],
    apiKeys: [
      { id: "key-revoked", sync_status: "revoked", exchange: "binance", label: "BNB", is_active: false, last_sync_at: null, account_balance_usdt: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "key-complete", sync_status: "complete", exchange: "okx", label: "OKX", is_active: true, last_sync_at: "2026-04-01T00:00:00Z", account_balance_usdt: null, created_at: "2026-01-01T00:00:00Z" },
    ],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    strategies: [],
  };
}

function renderAndReadMap(): Record<string, string> {
  const { container } = render(
    <HoldingsTableWidget
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data={makeData() as any}
      timeframe="YTD"
      width={0}
      height={0}
    />,
  );
  const stub = container.querySelector(
    "[data-testid='holdings-table-stub']",
  );
  expect(stub).not.toBeNull();
  return JSON.parse(stub!.getAttribute("data-revoked-map") ?? "{}") as Record<
    string,
    string
  >;
}

describe("HoldingsTableWidget — H-1206 revokedStatusByHoldingId join", () => {
  it("revoked apiKey → 'revoked' for the joined holding ref (not just row-in-DOM)", () => {
    const map = renderAndReadMap();
    const ref = buildHoldingRef(REVOKED_HOLDING);
    expect(map[ref]).toBe("revoked");
  });

  it("complete apiKey → 'complete' for the joined holding ref", () => {
    const map = renderAndReadMap();
    const ref = buildHoldingRef(COMPLETE_HOLDING);
    expect(map[ref]).toBe("complete");
  });

  it("holding with null api_key_id → 'unknown' (defensive default)", () => {
    const map = renderAndReadMap();
    const ref = buildHoldingRef(ORPHAN_HOLDING);
    expect(map[ref]).toBe("unknown");
  });
});
