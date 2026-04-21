/**
 * Phase 09 / Task 1 — Unit tests for holding-compare-adapter.ts
 *
 * TDD RED phase: tests written before implementation.
 * Covers parseHoldingCompareId including finding-f6 charset validation.
 */
import { describe, it, expect } from "vitest";
import { parseHoldingCompareId } from "./holding-compare-adapter";

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
