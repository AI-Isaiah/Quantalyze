// Compile-time contract guard: tsc --noEmit fails here if the TradeMetrics
// fields read by MetricPanel.tsx are renamed, removed, or widened.

import { describe, it, expect } from "vitest";
import type { TradeMetrics, TradeMixBuckets, TradeMixBucket } from "@/lib/types";

type _MetricPanelTradeFields =
  | TradeMetrics["total_positions"]
  | TradeMetrics["long_count"]
  | TradeMetrics["win_rate"]
  | TradeMetrics["trade_mix"];

type _MetricPanelTradeMixFields =
  | NonNullable<TradeMixBuckets["long_maker"]>["count"]
  | NonNullable<TradeMixBuckets["long_taker"]>["count"]
  | NonNullable<TradeMixBuckets["short_maker"]>["count"]
  | NonNullable<TradeMixBuckets["short_taker"]>["count"];

// Width pins: fail if a field is widened (e.g. number → number | null), which
// would let MetricPanel silently absorb the drift instead of failing tsc.
type _TotalPositionsIsNumber = TradeMetrics["total_positions"] extends number ? true : false;
type _LongCountIsNumber = TradeMetrics["long_count"] extends number ? true : false;
type _WinRateIsNumber = TradeMetrics["win_rate"] extends number ? true : false;
type _BucketCountIsNumber = TradeMixBucket["count"] extends number ? true : false;
const _totalPositionsIsNumber: _TotalPositionsIsNumber = true;
const _longCountIsNumber: _LongCountIsNumber = true;
const _winRateIsNumber: _WinRateIsNumber = true;
const _bucketCountIsNumber: _BucketCountIsNumber = true;

// Exported references so the unused-type checker doesn't elide the guard.
export type _MetricPanelContract =
  | _MetricPanelTradeFields
  | _MetricPanelTradeMixFields;

describe("MetricPanel TradeMetrics contract", () => {
  // No-op at runtime — exists so vitest picks up the file and the type-level
  // guards above are compiled.
  it("compiles against the live TradeMetrics shape", () => {
    expect(_totalPositionsIsNumber && _longCountIsNumber && _winRateIsNumber && _bucketCountIsNumber).toBe(true);
  });
});
