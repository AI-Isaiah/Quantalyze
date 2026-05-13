// Compile-time contract guard for MetricPanel's Trade Metrics chip (P2035).
//
// The real work in this file is the type-level assertions below — they fail
// `tsc --noEmit` if any of the `TradeMetrics` fields that MetricPanel.tsx
// reads in the Trade Metrics group is renamed, removed, or has its type
// narrowed in an incompatible way. Pre-fix the chip read
// `total_trades`/`maker_pct`/`long_pct` which don't exist on `TradeMetrics`,
// so the bug was invisible to tsc.
//
// If you change `TradeMetrics`, update MetricPanel.tsx and this guard
// together — otherwise the production UI silently regresses to "—".
//
// We also surface the contract as a runtime test so Vitest's
// "no test suite found" rule is satisfied without disabling the file.

import { describe, it, expect } from "vitest";
import type { TradeMetrics, TradeMixBuckets, TradeMixBucket } from "@/lib/types";

// Fields the chip reads directly off TradeMetrics.
type _MetricPanelTradeFields =
  | TradeMetrics["total_positions"]
  | TradeMetrics["long_count"]
  | TradeMetrics["win_rate"];

// Fields the chip reads off TradeMetrics.trade_mix (4-bucket variant).
type _MetricPanelTradeMixFields =
  | NonNullable<TradeMixBuckets["long_maker"]>["count"]
  | NonNullable<TradeMixBuckets["long_taker"]>["count"]
  | NonNullable<TradeMixBuckets["short_maker"]>["count"]
  | NonNullable<TradeMixBuckets["short_taker"]>["count"];

// `TradeMixBucket.count` is the unit the chip relies on; pin the assumption.
type _BucketCountIsNumber = TradeMixBucket["count"] extends number ? true : false;
const _bucketCountIsNumber: _BucketCountIsNumber = true;

// Exported references so the unused-type checker doesn't elide the guard.
export type _MetricPanelContract =
  | _MetricPanelTradeFields
  | _MetricPanelTradeMixFields;

describe("MetricPanel TradeMetrics contract", () => {
  // This test is a no-op at runtime; it exists so the type-level guards above
  // are compiled as part of the test suite. If any of those types break,
  // `tsc --noEmit` (CI / pre-commit) fails before this file ever runs.
  it("compiles against the live TradeMetrics shape", () => {
    expect(_bucketCountIsNumber).toBe(true);
  });
});
