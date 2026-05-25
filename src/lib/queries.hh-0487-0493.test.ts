import { describe, it, expect, vi } from "vitest";

/**
 * audit-2026-05-07 H-0487 / H-0493 regression tests
 *
 * Root cause: `reconstructHoldingReturnsByScopeRef` maps by symbol-only, so
 * when an allocator holds BTC on both Binance and OKX the two scope_refs
 * get IDENTICAL series. Downstream consumers (correlation displays,
 * diversification widgets) have no way to know the pairwise correlation
 * is 1.0 by construction — not real market behaviour.
 *
 * Fix: `deriveAliasedScopeRefs` computes the set of scope_refs that share
 * a symbol with at least one other scope_ref in the result. Consumers can
 * check this set and surface a disclaimer before rendering correlation scores.
 *
 * These tests fail WITHOUT the `deriveAliasedScopeRefs` export by ensuring
 * the function exists and correctly identifies aliased entries.
 */

vi.mock("server-only", () => ({}));

import {
  reconstructHoldingReturnsByScopeRef,
  deriveAliasedScopeRefs,
  type MyAllocationDashboardPayload,
} from "./queries";

type Holding = Pick<
  MyAllocationDashboardPayload["holdingsSummary"][number],
  "symbol" | "venue" | "holding_type"
>;
type Snapshot = { asof: string; breakdown: Record<string, number> | null };

describe("deriveAliasedScopeRefs — H-0487/H-0493 multi-venue alias sentinel", () => {
  it("H-0487-T1: empty inputs → empty aliased set", () => {
    const result = deriveAliasedScopeRefs([], {});
    expect(result.size).toBe(0);
  });

  it("H-0487-T2: single venue per symbol → no aliases", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000, ETH: 30000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000, ETH: 31000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
    ];
    const series = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    const aliased = deriveAliasedScopeRefs(holdings, series);
    // WHY this matters: BTC and ETH are distinct symbols, so their scope_refs
    // have independent series. No diversification score is degenerate.
    expect(aliased.size).toBe(0);
  });

  it("H-0487-T3: BTC on binance + okx → BOTH scope_refs marked aliased (M5 multi-venue)", () => {
    // This test is the regression anchor for H-0487. Without deriveAliasedScopeRefs,
    // a consumer rendering pairwise correlation BTC@binance vs BTC@okx sees 1.0
    // and displays a fake diversification score — the allocator believes they're
    // diversified when the data layer has collapsed two exposures into one series.
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 55000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" },
    ];
    const series = reconstructHoldingReturnsByScopeRef(snapshots, holdings);

    // Pre-condition: the two scope_refs DO map to identical series (M5 caveat)
    expect(series["holding:binance:BTC:spot"]).toEqual(
      series["holding:okx:BTC:spot"],
    );

    const aliased = deriveAliasedScopeRefs(holdings, series);

    // WHY: both scope_refs must be flagged so the consumer can surface a
    // disclaimer. Missing either one means the degenerate pair is invisible.
    expect(aliased.has("holding:binance:BTC:spot")).toBe(true);
    expect(aliased.has("holding:okx:BTC:spot")).toBe(true);
    expect(aliased.size).toBe(2);
  });

  it("H-0487-T4: three venues same symbol → all three marked aliased", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 51000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" },
      { symbol: "BTC", venue: "bybit", holding_type: "spot" },
    ];
    const series = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    const aliased = deriveAliasedScopeRefs(holdings, series);

    // WHY: a 3-venue fan-out is even more misleading — a diversification widget
    // would show 3 rows all correlated 1.0, inflating apparent coverage.
    expect(aliased.has("holding:binance:BTC:spot")).toBe(true);
    expect(aliased.has("holding:okx:BTC:spot")).toBe(true);
    expect(aliased.has("holding:bybit:BTC:spot")).toBe(true);
    expect(aliased.size).toBe(3);
  });

  it("H-0487-T5: mixed — BTC aliased across venues, ETH not aliased (single venue)", () => {
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000, ETH: 3000 } },
      { asof: "2026-01-02", breakdown: { BTC: 51000, ETH: 3100 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" },
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
    ];
    const series = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    const aliased = deriveAliasedScopeRefs(holdings, series);

    // WHY: ETH is single-venue so its correlation with anything else is real data.
    // Only the BTC pair should be flagged; incorrectly flagging ETH would suppress
    // valid correlation information.
    expect(aliased.has("holding:binance:BTC:spot")).toBe(true);
    expect(aliased.has("holding:okx:BTC:spot")).toBe(true);
    expect(aliased.has("holding:binance:ETH:spot")).toBe(false);
    expect(aliased.size).toBe(2);
  });

  it("H-0493-T6: scope_refs absent from the series record are NOT marked aliased", () => {
    // If BTC on binance has ≥2 snapshots but BTC on okx has <2, only binance
    // gets a series entry. The okx scope_ref is absent — it cannot be aliased.
    const snapshots: Snapshot[] = [
      { asof: "2026-01-01", breakdown: { BTC: 50000 } },
      { asof: "2026-01-02", breakdown: { BTC: 51000 } },
    ];
    const holdings: Holding[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "okx", holding_type: "spot" }, // same series BUT...
    ];
    // Pass a series map that only has the binance entry (simulating the case
    // where the okx holding is listed in holdingsSummary but has no snapshot data)
    const series = reconstructHoldingReturnsByScopeRef(snapshots, holdings);
    // Both are populated since the snapshot has BTC data for both venue scopes
    // (the symbol-only keying means both get the same series). This validates
    // that when both ARE present, both get flagged.
    const aliased = deriveAliasedScopeRefs(holdings, series);
    expect(aliased.size).toBe(2); // Both present → both aliased

    // Now test with a truncated series map (okx absent)
    const truncatedSeries: Record<string, typeof series[string]> = {
      "holding:binance:BTC:spot": series["holding:binance:BTC:spot"],
      // okx intentionally omitted
    };
    const aliasedTruncated = deriveAliasedScopeRefs(holdings, truncatedSeries);
    // WHY: only one entry for the BTC symbol in the series → not aliased,
    // the single-entry is the sole representation of BTC.
    expect(aliasedTruncated.size).toBe(0);
  });

  it("H-0493-T7: payload type includes aliasedScopeRefs field", () => {
    // Compile-time guard: MyAllocationDashboardPayload must include aliasedScopeRefs.
    // WHY: without this field in the type, composer consumers can't access the
    // sentinel via the typed payload — they'd have to cast to `any`, defeating
    // the purpose of the fix.
    const payload: Pick<MyAllocationDashboardPayload, "aliasedScopeRefs"> = {
      aliasedScopeRefs: new Set(["holding:binance:BTC:spot"]),
    };
    expect(payload.aliasedScopeRefs).toBeInstanceOf(Set);
    expect(payload.aliasedScopeRefs!.has("holding:binance:BTC:spot")).toBe(true);
  });
});
