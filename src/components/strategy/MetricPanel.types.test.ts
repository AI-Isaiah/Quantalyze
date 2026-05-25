// Compile-time contract guard: tsc --noEmit fails here if the TradeMetrics
// fields read by MetricPanel.tsx are renamed, removed, or widened.

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

type _TotalPositionsIsNumber = TradeMetrics["total_positions"] extends number ? true : false;
type _LongCountIsNumber = TradeMetrics["long_count"] extends number ? true : false;
type _WinRateIsNumber = TradeMetrics["win_rate"] extends number ? true : false;
type _BucketCountIsNumber = TradeMixBucket["count"] extends number ? true : false;
const _widthPins: _TotalPositionsIsNumber & _LongCountIsNumber & _WinRateIsNumber & _BucketCountIsNumber = true;

// Exported so the unused-type checker doesn't elide the guard.
export type _MetricPanelContract = _MetricPanelTradeFields | _MetricPanelTradeMixFields;

describe("MetricPanel TradeMetrics contract", () => {
  it("compiles against the live TradeMetrics shape", () => {
    expect(_widthPins).toBe(true);
  });
});

// M-0579 — avg_holding_period_hours optionality contract.
//
// The original S15f diff declared TradeMixBucket with avg_holding_period_hours
// as a NON-optional `number`, but the field was dropped before merge: the
// Python writer side does NOT emit it and the canonical golden fixture has no
// such key. The production type was fixed to make the field OPTIONAL
// (`avg_holding_period_hours?: number`), so reads return `number | undefined`
// and consumers must null-check. These guards LOCK that contract so a future
// re-tightening to non-optional (which would silently mismatch the fixture and
// hand consumers `undefined` typed as `number`) fails at the type + fixture
// level.

// Compile-time: a bucket literal WITHOUT avg_holding_period_hours must be
// type-valid. If the field were re-made required, this assignment would fail
// `tsc --noEmit`.
const _bucketWithoutHolding: TradeMixBucket = { count: 3, total_notional: 1000 };

// Compile-time: the field, when read, must be `number | undefined` (optional),
// NOT `number`. `extends number ? false : true` is true only while optional.
type _HoldingIsOptional =
  TradeMixBucket["avg_holding_period_hours"] extends number ? false : true;
const _holdingOptionalPin: _HoldingIsOptional = true;

// Exported so the unused-type/var checker doesn't elide the guards.
export const _M0579_bucket = _bucketWithoutHolding;

describe("M-0579 — TradeMixBucket.avg_holding_period_hours is optional", () => {
  it("a bucket literal without avg_holding_period_hours satisfies TradeMixBucket", () => {
    expect(_bucketWithoutHolding.count).toBe(3);
    // Reading the optional field yields undefined (consumers must null-check).
    expect(_bucketWithoutHolding.avg_holding_period_hours).toBeUndefined();
    expect(_holdingOptionalPin).toBe(true);
  });

  it("the canonical golden fixture trade_mix buckets carry no avg_holding_period_hours key", () => {
    // The typed contract (optional) MUST agree with the fixture (absent).
    const fixturePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "analytics-service",
      "tests",
      "fixtures",
      "golden_252d_expected.json",
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
      metrics_json: { trade_metrics?: { trade_mix?: Record<string, unknown> } };
    };
    const tradeMix = fixture.metrics_json.trade_metrics?.trade_mix;
    expect(tradeMix).toBeTruthy();
    for (const bucket of Object.values(tradeMix as Record<string, unknown>)) {
      expect(bucket).toBeTypeOf("object");
      expect(
        Object.prototype.hasOwnProperty.call(
          bucket as object,
          "avg_holding_period_hours",
        ),
      ).toBe(false);
    }
  });
});
