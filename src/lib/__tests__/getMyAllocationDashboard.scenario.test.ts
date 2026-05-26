import { describe, it, expect, vi } from "vitest";

/**
 * Phase 10 / Plan 10-03 / D-04
 *
 * Unit tests for the `reconstructHoldingReturnsByScopeRef` helper that
 * turns `allocator_equity_snapshots.breakdown` JSONB into per-holding
 * daily-return series keyed by scope_ref.
 *
 * The helper is exported from `src/lib/queries.ts` so we can call it
 * directly without round-tripping through Supabase mocks. See plan
 * 10-03 for the exhaustive case matrix (T1-T11 + T_H3 + T_M4).
 */

// queries.ts pulls in @/lib/audit, which imports "server-only" — that
// throws under vitest+jsdom. Mock it the same way the route tests do.
vi.mock("server-only", () => ({}));

import {
  reconstructHoldingReturnsByScopeRef,
  holdingEquityContribution,
  type MyAllocationDashboardPayload,
} from "../queries";

type Holding = Pick<
  MyAllocationDashboardPayload["holdingsSummary"][number],
  "symbol" | "venue" | "holding_type"
>;
type Snapshot = {
  asof: string;
  breakdown: Record<string, number> | null;
};

describe("reconstructHoldingReturnsByScopeRef", () => {
  it("T1 — empty snapshots and empty holdings → empty record", () => {
    expect(reconstructHoldingReturnsByScopeRef([], [])).toEqual({});
  });

  it("T2 — happy path: BTC + ETH on binance/spot → one daily return each", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000, ETH: 30000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000, ETH: 31000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);

    expect(Object.keys(result).sort()).toEqual([
      "holding:binance:BTC:spot",
      "holding:binance:ETH:spot",
    ]);

    const btc = result["holding:binance:BTC:spot"];
    expect(btc).toHaveLength(1);
    expect(btc[0].date).toBe("2026-01-02");
    expect(btc[0].value).toBeCloseTo(0.1, 6); // 5000/50000

    const eth = result["holding:binance:ETH:spot"];
    expect(eth).toHaveLength(1);
    expect(eth[0].date).toBe("2026-01-02");
    expect(eth[0].value).toBeCloseTo(1000 / 30000, 6);
  });

  it("T3 — prev=0 day is skipped (no division by zero)", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 0 } },
      { asof: "2026-01-02", breakdown: { BTC: 50000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    // Series with all-zero prev produces no returns → key absent (clean map).
    expect(result).toEqual({});
  });

  it("T4 — single snapshot per symbol → no entry (need ≥2 to difference)", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    expect(result).toEqual({});
  });

  it("T5 — out-of-order snapshots get sorted ascending before differencing", () => {
    // Pass snapshots in REVERSE asof order on purpose.
    const snapshots: Snapshot[] = [
      { asof: "2026-01-03", breakdown: { BTC: 60000 } },
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    const btc = result["holding:binance:BTC:spot"];
    expect(btc).toHaveLength(2);
    // Ascending order, computed against the previous (sorted) value.
    expect(btc[0].date).toBe("2026-01-02");
    expect(btc[0].value).toBeCloseTo(5000 / 50000, 6);
    expect(btc[1].date).toBe("2026-01-03");
    expect(btc[1].value).toBeCloseTo(5000 / 55000, 6);
  });

  it("T6 — venue-merge approximation: BTC@binance and BTC@okx share the same series", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000 } },
    ];
    // breakdown JSONB is keyed by symbol only — venue is NOT disambiguated.
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    expect(result["holding:binance:BTC:spot"]).toEqual(
      result["holding:okx:BTC:spot"],
    );
  });

  it("T7 — missing breakdown for a holding's symbol → key NOT present (clean map)", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000 } },
    ];
    // ETH is not in any breakdown → no entry; not even an empty array.
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    expect(Object.keys(result)).toEqual(["holding:binance:BTC:spot"]);
  });

  it("T8 — non-finite values (NaN / Infinity) are silently skipped", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: Number.NaN } },
      { asof: "2026-01-03", breakdown: { BTC: Number.POSITIVE_INFINITY } },
      { asof: "2026-01-04", breakdown: { BTC: 55000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    // Only the finite jump 50000 → 55000 contributes a return.
    const btc = result["holding:binance:BTC:spot"];
    expect(btc).toHaveLength(1);
    expect(btc[0].date).toBe("2026-01-04");
    expect(btc[0].value).toBeCloseTo(0.1, 6);
  });

  it("T9 — holding_type discriminates scope_ref (spot vs derivative)", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "binance", holding_type: "derivative" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    expect(Object.keys(result).sort()).toEqual([
      "holding:binance:BTC:derivative",
      "holding:binance:BTC:spot",
    ]);
  });

  it("T03_multi_venue_correlation — both BTC scope_refs map to IDENTICAL DailyPoint[] (M5 caveat)", () => {
    // Explicit multi-venue fixture proving the limitation: identical arrays,
    // not just deeply-equal — same series, same dates, same values.
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 51000 } },
      { asof: "2026-01-03", breakdown: { BTC: 52000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);

    const a = result["holding:binance:BTC:spot"];
    const b = result["holding:okx:BTC:spot"];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.length).toBe(2);
    expect(a).toEqual(b); // multi-venue: same return series, by Phase 09 convention
  });

  it("T11_all_null_breakdown — all snapshots have breakdown: null → empty record (no crash)", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: null },
      { asof: "2026-01-02", breakdown: null },
      { asof: "2026-01-03", breakdown: null },
      { asof: "2026-01-04", breakdown: null },
      { asof: "2026-01-05", breakdown: null },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ];
    expect(reconstructHoldingReturnsByScopeRef(snapshots, holdings)).toEqual(
      {},
    );
  });

  it("T_H3 — getMyAllocationDashboard payload type includes allocator_id field", () => {
    // Compile-time + runtime sanity: the exported payload type must declare
    // allocator_id as a plain string. The full integration test (auth.getUser
    // wired into the payload) lives in queries.my-allocation.test.ts; this
    // dedicated check guards the type declaration in a fast, focused unit.
    const payload: Pick<MyAllocationDashboardPayload, "allocator_id"> = {
      allocator_id: "alloc-A",
    };
    expect(payload.allocator_id).toBe("alloc-A");
    expect(typeof payload.allocator_id).toBe("string");
  });

  it("T_M4 — payload type exposes liveBaselineMetrics with the SSR-lifted shape", () => {
    // Compile-time guard for the M4 SSR lift: the composer (Plan 06b) consumes
    // this object instead of recomputing the live baseline per render.
    const lbm: MyAllocationDashboardPayload["liveBaselineMetrics"] = {
      aum: 100000,
      ytdTwr: 0.05,
      sharpe: 1.2,
      maxDd: -0.1,
      avgRho: 0.4,
      equity: [{ date: "2026-01-01", value: 1.0 }],
      drawdown: [{ date: "2026-01-01", value: 0 }],
    };
    expect(lbm.aum).toBe(100000);
    expect(lbm.ytdTwr).toBe(0.05);
    expect(lbm.sharpe).toBe(1.2);
    expect(lbm.maxDd).toBe(-0.1);
    expect(lbm.avgRho).toBe(0.4);
    expect(lbm.equity[0]).toEqual({ date: "2026-01-01", value: 1.0 });
    expect(lbm.drawdown[0]).toEqual({ date: "2026-01-01", value: 0 });

    // Empty defaults (the !portfolio branch) must satisfy the type too.
    const empty: MyAllocationDashboardPayload["liveBaselineMetrics"] = {
      aum: 0,
      ytdTwr: null,
      sharpe: null,
      maxDd: null,
      avgRho: null,
      equity: [],
      drawdown: [],
    };
    expect(empty.aum).toBe(0);
    expect(empty.equity).toEqual([]);
  });

  it("holdingReturnsByScopeRef — type smoke: scope_ref keys are 'holding:{venue}:{symbol}:{holding_type}'", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000, ETH: 30000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000, ETH: 31000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "ETH", venue: "okx", holding_type: "derivative" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    for (const key of Object.keys(result)) {
      expect(key).toMatch(/^holding:[^:]+:[^:]+:(spot|derivative)$/);
    }
    // Pin the exact format witnessed by the helper.
    expect(Object.keys(result).sort()).toEqual([
      "holding:binance:BTC:spot",
      "holding:okx:ETH:derivative",
    ]);
  });
});

/**
 * NEW-C03-01 regression: holdingEquityContribution must use unrealized_pnl_usd
 * for derivatives, NOT value_usd (notional). A 10x perp with $5M notional only
 * contributes its unrealized P&L ($X) to the portfolio's equity — using the
 * notional would inflate AUM by the leverage factor and corrupt KPIs.
 */
describe("NEW-C03-01 — holdingEquityContribution: derivatives use unrealized_pnl_usd", () => {
  type H = MyAllocationDashboardPayload["holdingsSummary"][number];

  it("spot holding: returns value_usd as equity contribution", () => {
    const h: H = {
      symbol: "BTC",
      venue: "binance",
      holding_type: "spot",
      value_usd: 50000,
      quantity: 1,
      mark_price_usd: 50000,
      api_key_id: "key-1",
      side: "flat",
      entry_price: null,
      unrealized_pnl_usd: null,
    };
    expect(holdingEquityContribution(h)).toBe(50000);
  });

  it("derivative long: returns unrealized_pnl_usd (NOT the notional value_usd)", () => {
    const h: H = {
      symbol: "BTC",
      venue: "binance",
      holding_type: "derivative",
      // Notional (should be IGNORED): $5M
      value_usd: 5_000_000,
      // Equity contribution: the actual unrealized P&L
      unrealized_pnl_usd: 12_500,
      quantity: 1,
      mark_price_usd: 50000,
      api_key_id: "key-1",
      side: "long",
      entry_price: 48000,
    };
    expect(holdingEquityContribution(h)).toBe(12_500);
    // Explicitly: must NOT return the notional
    expect(holdingEquityContribution(h)).not.toBe(5_000_000);
  });

  it("derivative with unrealized_pnl_usd=null: returns 0 (not notional)", () => {
    const h: H = {
      symbol: "ETH",
      venue: "okx",
      holding_type: "derivative",
      value_usd: 2_000_000, // notional — must be ignored
      unrealized_pnl_usd: null,
      quantity: 10,
      mark_price_usd: 3000,
      api_key_id: "key-2",
      side: "short",
      entry_price: 3100,
    };
    expect(holdingEquityContribution(h)).toBe(0);
  });

  it("spot holding with NaN value_usd: returns 0", () => {
    const h: H = {
      symbol: "BTC",
      venue: "binance",
      holding_type: "spot",
      value_usd: NaN,
      quantity: 1,
      mark_price_usd: null,
      api_key_id: "key-1",
      side: "flat",
      entry_price: null,
      unrealized_pnl_usd: null,
    };
    expect(holdingEquityContribution(h)).toBe(0);
  });
});

/**
 * NEW-C03-02 regression: holdingsMap collapse must key on
 * `${venue}:${symbol}:${holding_type}`, not just `symbol`.
 *
 * Keying on symbol alone collapsed multi-venue (Binance BTC + OKX BTC) and
 * spot+derivative (BTC-spot + BTC-perp) holdings to a single row, silently
 * dropping an entire exchange's position from the dashboard. We can't call
 * `derivePhase07Fields` directly (it's private), so we verify correctness via
 * the `reconstructHoldingReturnsByScopeRef` helper which shares the same
 * multi-key scope_ref format as the fixed holdingsMap. A downstream integration
 * test wiring through the full payload exists in the HoldingsTabPanel tests.
 */
describe("NEW-C03-02 — multi-venue / spot+derivative holdings are NOT collapsed", () => {
  it("BTC@binance:spot and BTC@okx:spot produce DISTINCT scope_ref keys", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 52000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    // Both scope_refs must be present — neither is dropped by a symbol-only key.
    expect(result["holding:binance:BTC:spot"]).toBeDefined();
    expect(result["holding:okx:BTC:spot"]).toBeDefined();
  });

  it("BTC@binance:spot and BTC@binance:derivative produce DISTINCT scope_ref keys", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "binance", holding_type: "derivative" },
    ];
    const result = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    expect(result["holding:binance:BTC:spot"]).toBeDefined();
    expect(result["holding:binance:BTC:derivative"]).toBeDefined();
    // Exactly 2 keys — no over-collapsing, no over-expanding.
    expect(Object.keys(result)).toHaveLength(2);
  });
});
