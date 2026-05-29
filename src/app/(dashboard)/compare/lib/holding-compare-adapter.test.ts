/**
 * Phase 09 / Task 1 — Unit tests for holding-compare-adapter.ts
 *
 * TDD RED phase: tests written before implementation.
 * Covers parseHoldingCompareId including finding-f6 charset validation.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseHoldingCompareId,
  fetchHoldingCompareItem,
} from "./holding-compare-adapter";

// Minimal thenable Supabase stub for the single query fetchHoldingCompareItem
// runs: .from(t).select(c).eq(c,v).order(c,o).limit(n) then awaited → {data,error}.
type SnapRow = {
  asof: string;
  breakdown: Record<string, number> | null;
  pre_terminus_balance_unknown?: boolean | null;
};
function fakeSupabase(rows: SnapRow[]): SupabaseClient {
  const builder = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("parseHoldingCompareId (unit)", () => {
  it("parses valid holding id", () => {
    expect(parseHoldingCompareId("holding:binance:BTC:spot")).toEqual({
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
    });
  });

  it("accepts underscores and hyphens in parts (matches Phase 08 D-08 scope_ref charset)", () => {
    expect(parseHoldingCompareId("holding:binance_us:BTC-USD:spot")).toEqual({
      venue: "binance_us",
      symbol: "BTC-USD",
      holding_type: "spot",
    });
  });

  it("returns null for UUID", () => {
    expect(
      parseHoldingCompareId("11111111-2222-3333-4444-555555555555"),
    ).toBeNull();
  });

  it("returns null for malformed prefix", () => {
    expect(parseHoldingCompareId("holding:malformed")).toBeNull();
    expect(parseHoldingCompareId("holding:a:b:c:d")).toBeNull();
    expect(parseHoldingCompareId("not-a-holding")).toBeNull();
  });

  describe("finding f6 — charset validation against [A-Za-z0-9_-]", () => {
    it("rejects holding_ref with '/' in symbol", () => {
      expect(parseHoldingCompareId("holding:binance:BTC/USDT:spot")).toBeNull();
    });

    it("rejects holding_ref with ';' (SQL-injection-style)", () => {
      expect(
        parseHoldingCompareId("holding:binance:BTC;drop:spot"),
      ).toBeNull();
    });

    it("rejects holding_ref with space in venue", () => {
      expect(
        parseHoldingCompareId("holding:bin ance:BTC:spot"),
      ).toBeNull();
    });

    it("rejects holding_ref with quote in holding_type", () => {
      expect(
        parseHoldingCompareId('holding:binance:BTC:sp"ot'),
      ).toBeNull();
    });

    it("rejects empty parts (finding f6)", () => {
      expect(parseHoldingCompareId("holding::BTC:spot")).toBeNull();
      expect(parseHoldingCompareId("holding:binance::spot")).toBeNull();
      expect(parseHoldingCompareId("holding:binance:BTC:")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// CL9 / NEW-C01-11 — terminus-flagged rows must NOT feed the /compare metrics.
//
// WHY: a row with pre_terminus_balance_unknown was reconstructed against a zero
// baseline (OKX 90-day terminus clamped the funding deposit out of the window),
// so its per-symbol breakdown ramps up from zero as in-window trades land —
// the pct_change return series (and thus cumulative_return / Sharpe / drawdown /
// vol) is corrupt. This is a SECOND read boundary on allocator_equity_snapshots
// (the dashboard is the first); these tests pin that it applies the same filter.
// They FAIL if the adapter drops the flag filter (the garbage rows then produce
// non-null, distorted analytics).
// ---------------------------------------------------------------------------
describe("fetchHoldingCompareItem — CL9 terminus suppression", () => {
  const REF = "holding:binance:BTC:spot";

  it("returns null when EVERY row is terminus-flagged (garbage suppressed, not displayed)", async () => {
    // Breakdown values that WOULD compute non-null metrics if not filtered.
    const rows: SnapRow[] = [
      { asof: "2026-01-01", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: true },
      { asof: "2026-01-02", breakdown: { BTC: 150 }, pre_terminus_balance_unknown: true },
      { asof: "2026-01-03", breakdown: { BTC: 90 }, pre_terminus_balance_unknown: true },
    ];
    const item = await fetchHoldingCompareItem({
      allocator_id: "alloc-1",
      holding_ref: REF,
      supabase: fakeSupabase(rows),
    });
    // All flagged → <2 trustworthy points → null analytics → "not available".
    expect(item).toBeNull();
  });

  it("computes metrics from ONLY the trustworthy rows when flagged rows are interleaved", async () => {
    // Two trustworthy points (BTC 100 → 110, +10%) plus flagged garbage that, if
    // included, would inject spurious returns and a fake drawdown.
    const withFlagged: SnapRow[] = [
      { asof: "2026-01-01", breakdown: { BTC: 5 }, pre_terminus_balance_unknown: true },
      { asof: "2026-01-02", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      { asof: "2026-01-03", breakdown: { BTC: 110 }, pre_terminus_balance_unknown: false },
      { asof: "2026-01-04", breakdown: { BTC: 9999 }, pre_terminus_balance_unknown: true },
    ];
    const cleanOnly: SnapRow[] = [
      { asof: "2026-01-02", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      { asof: "2026-01-03", breakdown: { BTC: 110 }, pre_terminus_balance_unknown: false },
    ];
    const a = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(withFlagged),
    });
    const b = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(cleanOnly),
    });
    expect(a).not.toBeNull();
    // Filtering flagged rows → identical analytics to the clean-only series.
    expect(a!.analytics).toEqual(b!.analytics);
    // And the single clean +10% step is what's measured (no flagged distortion).
    expect(a!.analytics.cumulative_return).toBeCloseTo(0.1, 6);
    expect(a!.analytics.max_drawdown).toBe(0);
  });

  it("is a no-op when no row is flagged (clean series still computes normally)", async () => {
    const rows: SnapRow[] = [
      { asof: "2026-01-01", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      { asof: "2026-01-02", breakdown: { BTC: 120 }, pre_terminus_balance_unknown: false },
    ];
    const item = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(rows),
    });
    expect(item).not.toBeNull();
    expect(item!.analytics.cumulative_return).toBeCloseTo(0.2, 6);
  });
});
