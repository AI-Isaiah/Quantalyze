/**
 * Phase 09 / Task 1 — Unit tests for holding-compare-adapter.ts
 *
 * TDD RED phase: tests written before implementation.
 * Covers parseHoldingCompareId including finding-f6 charset validation.
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseHoldingCompareId,
  fetchHoldingCompareItem,
  reconstructAndAnalyze,
  HOLDING_COMPARE_HISTORY_STATE,
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

  // Phase 167.1.2 / D-13: the item no longer carries analytics while the
  // history is rebuilt, so the filter is pinned through AVAILABILITY here: one
  // trustworthy point among flagged rows is "not available" ONLY if the flagged
  // rows are dropped (unfiltered, the three points would compute and return an
  // item). The metric math itself is pinned on reconstructAndAnalyze below.
  it("drops flagged rows before the availability decision: one trustworthy point among flagged rows is not available", async () => {
    const rows: SnapRow[] = [
      { asof: "2026-01-01", breakdown: { BTC: 5 }, pre_terminus_balance_unknown: true },
      { asof: "2026-01-02", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      { asof: "2026-01-03", breakdown: { BTC: 9999 }, pre_terminus_balance_unknown: true },
    ];
    const item = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(rows),
    });
    expect(item).toBeNull();
  });

  it("the metric math: +10% over two clean points, no drawdown; flagged garbage would distort it", () => {
    const clean = [
      { asof: "2026-01-02", breakdown: { BTC: 100 } },
      { asof: "2026-01-03", breakdown: { BTC: 110 } },
    ];
    const a = reconstructAndAnalyze(clean, "BTC");
    expect(a.cumulative_return).toBeCloseTo(0.1, 6);
    expect(a.max_drawdown).toBe(0);
    // Positive control for the filter above: the same series WITH the flagged
    // rows computes something else.
    const withGarbage = reconstructAndAnalyze(
      [{ asof: "2026-01-01", breakdown: { BTC: 5 } }, ...clean, { asof: "2026-01-04", breakdown: { BTC: 9999 } }],
      "BTC",
    );
    expect(withGarbage.cumulative_return).not.toBeCloseTo(0.1, 6);
  });

  it("is a no-op when no row is flagged: a clean 2-point series is available", async () => {
    const rows: SnapRow[] = [
      { asof: "2026-01-01", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      { asof: "2026-01-02", breakdown: { BTC: 120 }, pre_terminus_balance_unknown: false },
    ];
    const item = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(rows),
    });
    expect(item).not.toBeNull();
    expect(reconstructAndAnalyze(rows, "BTC").cumulative_return).toBeCloseTo(0.2, 6);
  });
});

// ---------------------------------------------------------------------------
// Phase 167.1.2 / D-13 ("Hide it until correct", extended to /compare).
//
// Why this matters: return, Sharpe, max drawdown and vol here are level ratios
// over allocator_equity_snapshots.breakdown. That store can count one exchange
// account twice when two keys read it (a +100% / -50% day inside one symbol's
// series), and a $-level ratio reads buying more of a symbol as a gain. My
// Allocation withholds the same store (D-02). While it is rebuilt, the item
// must carry NO number to the browser, and the availability rule must not
// change (D-15: an unowned or missing holding is still indistinguishable).
// ---------------------------------------------------------------------------
describe("fetchHoldingCompareItem — 167.1.2 D-13 analytics withheld while rebuilding", () => {
  const REF = "holding:binance:BTC:spot";
  const CLEAN: SnapRow[] = [
    { asof: "2026-01-01", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
    { asof: "2026-01-02", breakdown: { BTC: 200 }, pre_terminus_balance_unknown: false },
    { asof: "2026-01-03", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
  ];

  it("the switch is 'rebuilding' (plan 11 owns the flip)", () => {
    expect(HOLDING_COMPARE_HISTORY_STATE).toBe("rebuilding");
  });

  it("an available holding comes back with historyState 'rebuilding' and analytics null, although the series WOULD compute", async () => {
    // Positive control: this is exactly the +100% / -50% shape D-01 produces,
    // and it computes non-null metrics.
    expect(reconstructAndAnalyze(CLEAN, "BTC").sharpe).not.toBeNull();
    const item = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(CLEAN),
    });
    expect(item).not.toBeNull();
    expect(item!.historyState).toBe("rebuilding");
    expect(item!.analytics).toBeNull();
    expect(item!.symbol).toBe("BTC");
  });

  // Review round 1 (SFH INFO-02): a query error used to fold silently into the
  // same null as "no rows". The caller still gets null (D-15), but the failure
  // is logged server-side so a transient outage is not invisible.
  it("a query error still returns null to the caller but is logged, not swallowed", async () => {
    const builder = {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      },
    };
    const supabase = { from: () => builder } as unknown as SupabaseClient;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const item = await fetchHoldingCompareItem({
        allocator_id: "alloc-1", holding_ref: REF, supabase,
      });
      expect(item).toBeNull();
      expect(spy).toHaveBeenCalledWith(
        "[holding-compare-adapter.fetchHoldingCompareItem] supabase error:",
        "boom",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("availability is unchanged: no rows is still null (no existence leak)", async () => {
    const item = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase([]),
    });
    expect(item).toBeNull();
  });
});
