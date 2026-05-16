/**
 * audit-2026-05-07 H-1116 / M-0909 / M-0910 regression test —
 * Funding fee runtime guard at the trust boundary.
 *
 * Mirrors the pattern in `positions-runtime-guard-g12e.test.ts`. The
 * funding_fees rows surface to UI consumers (per-symbol breakdown,
 * audit panels); without a Zod parse layer, a NUMERIC-as-string from
 * PostgREST or a future column addition would either silently drop
 * rows or `NaN`-poison downstream math.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseFundingFeeRows,
  buildFundingMatchKey,
  type FundingFee,
} from "@/lib/types";

const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  strategy_id: "11111111-1111-1111-1111-111111111111",
  exchange: "binance" as const,
  symbol: "BTC-USDT",
  amount: -1.25,
  currency: "USDT",
  timestamp: "2026-01-01T00:00:00Z",
  match_key: "fake",
  raw_data: { incomeType: "FUNDING_FEE" },
  created_at: "2026-01-01T00:01:00Z",
};

describe("parseFundingFeeRows — H-1116 trust-boundary guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("accepts a well-formed row", () => {
    const out = parseFundingFeeRows([baseRow]);
    expect(out).toHaveLength(1);
    expect(out[0].exchange).toBe("binance");
  });

  it("coerces NUMERIC-as-string from PostgREST", () => {
    const out = parseFundingFeeRows([{ ...baseRow, amount: "-1.25" }]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(-1.25);
  });

  it("drops rows with an unknown exchange (typo guard)", () => {
    const out = parseFundingFeeRows([{ ...baseRow, exchange: "binnance" }]);
    expect(out).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("drops rows with malformed timestamp", () => {
    const out = parseFundingFeeRows([{ ...baseRow, timestamp: "yesterday" }]);
    expect(out).toHaveLength(0);
  });

  it("drops rows with an unexpected extra column (strict guard)", () => {
    const out = parseFundingFeeRows([{ ...baseRow, extra_column: "drift" }]);
    expect(out).toHaveLength(0);
  });

  it("redacts row contents in warn output — only path/code surfaces", () => {
    parseFundingFeeRows([{ ...baseRow, amount: "definitely not a number" }]);
    const calls = warnSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("definitely not a number");
  });
});

describe("buildFundingMatchKey — M-0909 canonical constructor", () => {
  it("produces a stable key for the same 8-hour bucket", () => {
    const k1 = buildFundingMatchKey({
      strategy_id: "S",
      exchange: "binance",
      symbol: "BTC-USDT",
      timestamp: "2026-01-01T00:05:00Z",
    });
    const k2 = buildFundingMatchKey({
      strategy_id: "S",
      exchange: "binance",
      symbol: "BTC-USDT",
      timestamp: "2026-01-01T07:59:00Z",
    });
    expect(k1).toBe(k2);
  });

  it("produces different keys across 8-hour bucket boundaries", () => {
    const k1 = buildFundingMatchKey({
      strategy_id: "S",
      exchange: "binance",
      symbol: "BTC-USDT",
      timestamp: "2026-01-01T07:59:00Z",
    });
    const k2 = buildFundingMatchKey({
      strategy_id: "S",
      exchange: "binance",
      symbol: "BTC-USDT",
      timestamp: "2026-01-01T08:01:00Z",
    });
    expect(k1).not.toBe(k2);
  });

  it("brand prevents an arbitrary string from satisfying the type", () => {
    // The brand is a compile-time check; runtime is still a string.
    // We exercise the constructor path to lock in the canonical format.
    const k = buildFundingMatchKey({
      strategy_id: "S1",
      exchange: "okx",
      symbol: "ETH-USDT",
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(k).toMatch(/^S1:okx:ETH-USDT:/);
  });
});

describe("FundingFee discriminated union — M-0910", () => {
  it("narrows raw_data to BinanceFundingRaw on exchange='binance'", () => {
    const fee: FundingFee = {
      id: "f1",
      strategy_id: "S",
      exchange: "binance",
      symbol: "BTC-USDT",
      amount: -1,
      currency: "USDT",
      timestamp: "2026-01-01T00:00:00Z",
      match_key: buildFundingMatchKey({
        strategy_id: "S",
        exchange: "binance",
        symbol: "BTC-USDT",
        timestamp: "2026-01-01T00:00:00Z",
      }),
      raw_data: { incomeType: "FUNDING_FEE", tranId: 1 },
      created_at: "2026-01-01T00:01:00Z",
    };
    // Type-narrowing exercise: the body of this branch sees BinanceFundingRaw
    // (lacking instId etc.) so a typo would fail to compile.
    if (fee.exchange === "binance" && fee.raw_data) {
      expect(fee.raw_data.incomeType).toBe("FUNDING_FEE");
    }
  });
});
