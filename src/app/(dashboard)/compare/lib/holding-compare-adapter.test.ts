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
  HoldingCompareLoadError,
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

  // Review round 1 (SFH INFO-02) logged a query error; round 2 (SFH-R2-02)
  // stops folding it into the same null as "no rows". A null is rendered as
  // "This comparison isn't available", which tells the allocator the holding
  // does not exist. RLS hides an unowned holding as ZERO rows, never as an
  // error, so throwing leaks nothing (D-15) and the route's error boundary
  // offers a retry. The database message is logged, never thrown.
  it("a query error throws HoldingCompareLoadError (not the 'not available' null) and logs the message only", async () => {
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
      const p = fetchHoldingCompareItem({
        allocator_id: "alloc-1", holding_ref: REF, supabase,
      });
      await expect(p).rejects.toBeInstanceOf(HoldingCompareLoadError);
      // The database's message is logged, and never rides the thrown error.
      await expect(p).rejects.not.toThrow(/boom/);
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

// ---------------------------------------------------------------------------
// Phase 167.1.2 review round 2 (WR-01) — the "ready" branch stays under test.
//
// WHY: D-13 withholds the analytics behind HOLDING_COMPARE_HISTORY_STATE, and
// plan 11 must DECIDE whether /compare flips back. The docblock promises that
// the flip restores the pre-D-13 behaviour. Without these tests that promise
// is unpinned: the module constant makes the "ready" return unreachable, and
// round 1 deleted the case that pinned which rows the ready branch feeds the
// math. The `historyState` seam reaches it without changing the production
// default. These FAIL if the ready branch reads unfiltered rows, drops or
// alters the analytics, or if the flip changes availability.
// ---------------------------------------------------------------------------
describe("fetchHoldingCompareItem — the 'ready' branch (plan 11's flip)", () => {
  const REF = "holding:binance:BTC:spot";

  // Restored from before round 1 (deleted there with nothing reaching the
  // ready branch in its place), now run against historyState "ready".
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
      historyState: "ready",
    });
    const b = await fetchHoldingCompareItem({
      allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(cleanOnly),
      historyState: "ready",
    });
    expect(a).not.toBeNull();
    expect(a!.historyState).toBe("ready");
    expect(b!.historyState).toBe("ready");
    // Filtering flagged rows → identical analytics to the clean-only series.
    expect(a!.analytics).toEqual(b!.analytics);
    // And the single clean +10% step is what's measured (no flagged distortion).
    expect(a!.analytics!.cumulative_return).toBeCloseTo(0.1, 6);
    expect(a!.analytics!.max_drawdown).toBe(0);
  });

  it("the flip restores the pre-D-13 behaviour: same availability, and 'ready' carries exactly the analytics the math computes", async () => {
    const CASES: Array<[string, SnapRow[]]> = [
      ["available clean series", [
        { asof: "2026-01-01", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
        { asof: "2026-01-02", breakdown: { BTC: 200 }, pre_terminus_balance_unknown: false },
        { asof: "2026-01-03", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      ]],
      ["no rows", []],
      ["one trustworthy point among flagged", [
        { asof: "2026-01-01", breakdown: { BTC: 5 }, pre_terminus_balance_unknown: true },
        { asof: "2026-01-02", breakdown: { BTC: 100 }, pre_terminus_balance_unknown: false },
      ]],
      ["symbol absent", [
        { asof: "2026-01-01", breakdown: { ETH: 1 }, pre_terminus_balance_unknown: false },
        { asof: "2026-01-02", breakdown: { ETH: 2 }, pre_terminus_balance_unknown: false },
      ]],
    ];
    // Only the first case is available; the rest pin that the flip does not
    // make an unavailable holding appear. Counted so the loop cannot pass by
    // skipping every comparison.
    let compared = 0;
    for (const [label, rows] of CASES) {
      const rebuilding = await fetchHoldingCompareItem({
        allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(rows),
      });
      const ready = await fetchHoldingCompareItem({
        allocator_id: "alloc-1", holding_ref: REF, supabase: fakeSupabase(rows),
        historyState: "ready",
      });
      // Availability is the same rule in both states.
      expect(ready === null, label).toBe(rebuilding === null);
      if (ready === null || rebuilding === null) continue;
      // The default (constant) is still "rebuilding" and carries no number.
      expect(rebuilding.historyState, label).toBe("rebuilding");
      expect(rebuilding.analytics, label).toBeNull();
      // "ready" is the pre-D-13 item: the same identity fields plus the
      // analytics reconstructAndAnalyze computes over the trustworthy rows.
      const trustworthy = rows.filter((r) => !r.pre_terminus_balance_unknown);
      expect(ready, label).toEqual({
        kind: "holding",
        holding_ref: REF,
        venue: "binance",
        symbol: "BTC",
        holding_type: "spot",
        historyState: "ready",
        analytics: reconstructAndAnalyze(trustworthy, "BTC"),
      });
      expect(ready.analytics!.sharpe, label).not.toBeNull();
      compared++;
    }
    expect(compared).toBe(1);
  });
});
