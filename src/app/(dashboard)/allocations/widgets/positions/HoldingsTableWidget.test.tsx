import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { HoldingsTableWidget } from "./HoldingsTableWidget";

// next/navigation is consumed by HoldingsTable's row-expand surface; stub it
// so the widget can render under jsdom without a Next router context.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type DashboardPayload = MyAllocationDashboardPayload;
type DashboardHolding = DashboardPayload["holdingsSummary"][number];
type DashboardApiKey = DashboardPayload["apiKeys"][number];
type DashboardFlagged = DashboardPayload["flaggedHoldings"][number];

function buildHolding(
  overrides: Partial<DashboardHolding> = {},
): DashboardHolding {
  return {
    symbol: "BTC",
    quantity: 1,
    mark_price_usd: null,
    value_usd: 1_000_000,
    venue: "binance",
    holding_type: "spot",
    api_key_id: "ak-1",
    // NEW-C03-10: required-but-nullable fields
    side: null,
    entry_price: null,
    unrealized_pnl_usd: null,
    ...overrides,
  };
}

function buildApiKey(
  overrides: Partial<DashboardApiKey> = {},
): DashboardApiKey {
  return {
    id: "ak-1",
    exchange: "binance",
    label: "Main",
    is_active: true,
    sync_status: "ok",
    last_sync_at: "2026-04-01T00:00:00Z",
    account_balance_usdt: null,
    created_at: "2026-01-01T00:00:00Z",
    // NEW-C03-09: fields now required on MyAllocationDashboardPayload.apiKeys
    sync_error: null,
    last_429_at: null,
    disconnected_at: null,
    ...overrides,
  };
}

function buildFlagged(
  overrides: Partial<DashboardFlagged> = {},
): DashboardFlagged {
  // FlaggedHolding type from holding-outcome-adapter; required-only fields
  // listed here, optionals defaulted. Wide cast is fine for the widget
  // contract (uses only venue/symbol/holding_type/composite/strategy_id).
  return {
    holding_ref: "holding:binance:BTC:spot",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    value_usd: 1_000_000,
    weight: 0.5,
    breach_reasons: ["max_weight"],
    top_candidate_strategy_id: "strat-1",
    top_candidate_strategy_name: "Helios Perp Basis",
    top_candidate_composite: 80,
    ...overrides,
  } as DashboardFlagged;
}

function makeData(
  opts: Partial<{
    holdingsSummary: DashboardHolding[];
    apiKeys: DashboardApiKey[];
    flaggedHoldings: DashboardFlagged[];
    matchDecisionsByHoldingRef: DashboardPayload["matchDecisionsByHoldingRef"];
    strategies: DashboardPayload["strategies"];
  }> = {},
): unknown {
  return {
    holdingsSummary: opts.holdingsSummary ?? [],
    apiKeys: opts.apiKeys ?? [],
    flaggedHoldings: opts.flaggedHoldings ?? [],
    matchDecisionsByHoldingRef: opts.matchDecisionsByHoldingRef ?? {},
    strategies: opts.strategies ?? [],
  };
}

function renderWidget(data: unknown) {
  return render(
    <HoldingsTableWidget
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data={data as any}
      timeframe="YTD"
      width={0}
      height={0}
    />,
  );
}

// ---------------------------------------------------------------------------
// Empty payload
// ---------------------------------------------------------------------------

describe("HoldingsTableWidget — empty payload", () => {
  it("renders the HoldingsTable empty-state card with 'No holdings to display.' copy", () => {
    renderWidget(makeData({}));
    expect(screen.getByText("No holdings to display.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Holdings", level: 3 }),
    ).toBeInTheDocument();
  });

  it("renders cleanly when data prop is undefined (defensive)", () => {
    renderWidget(undefined);
    expect(screen.getByText("No holdings to display.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Populated payload
// ---------------------------------------------------------------------------

describe("HoldingsTableWidget — populated payload", () => {
  it("renders one row per holdingsSummary entry with the right venue+symbol", () => {
    renderWidget(
      makeData({
        holdingsSummary: [
          buildHolding({ symbol: "BTC", venue: "binance" }),
          buildHolding({ symbol: "ETH", venue: "okx", api_key_id: "ak-2" }),
        ],
        apiKeys: [
          buildApiKey({ id: "ak-1", exchange: "binance" }),
          buildApiKey({ id: "ak-2", exchange: "okx" }),
        ],
      }),
    );
    // The DesignHoldingsTable surfaces SYMBOL + VENUE per row.
    expect(screen.getByText(/BTC/i)).toBeInTheDocument();
    expect(screen.getByText(/ETH/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stale path — sync_status revoked
// ---------------------------------------------------------------------------

describe("HoldingsTableWidget — stale path (revoked api key)", () => {
  it("propagates sync_status='revoked' through revokedStatusByHoldingId", () => {
    // Render with a revoked key and confirm no crash + the row still
    // surfaces. The visual treatment (strikethrough + amber chip) is
    // unit-tested inside HoldingsTable's own test files.
    renderWidget(
      makeData({
        holdingsSummary: [buildHolding({ symbol: "SOL", api_key_id: "ak-1" })],
        apiKeys: [
          buildApiKey({ id: "ak-1", sync_status: "revoked", is_active: false }),
        ],
      }),
    );
    expect(screen.getByText(/SOL/i)).toBeInTheDocument();
  });

  it("propagates flagged metadata via flaggedHoldingsByRef", () => {
    // Smoke: widget mounts when flagged metadata is present. Detailed
    // bridge-banner rendering is covered by HoldingsTable's own tests.
    renderWidget(
      makeData({
        holdingsSummary: [
          buildHolding({ symbol: "BTC", venue: "binance", holding_type: "spot" }),
        ],
        apiKeys: [buildApiKey({ id: "ak-1" })],
        flaggedHoldings: [buildFlagged()],
        matchDecisionsByHoldingRef: {
          "holding:binance:BTC:spot": null,
        },
      }),
    );
    expect(screen.getByText(/BTC/i)).toBeInTheDocument();
  });
});
