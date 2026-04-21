/**
 * Unit tests for scope-ref parse/build helpers.
 *
 * Covers Research Finding #9 edge cases for the holding scope_ref format:
 * `{venue}:{symbol}:{holding_type}` where venue is lowercase, symbol is
 * uppercase alphanumeric (CCXT-stripped per Phase 06 D-16), and holding_type
 * is one of {"spot", "derivative"}.
 *
 * Phase 08 Plan 01 Task 1 (RED) — these tests fail until `src/lib/notes/scope-ref.ts`
 * is created in Task 2 with the HOLDING_SCOPE_RE regex + parse/build functions.
 */

import { describe, it, expect } from "vitest";
import {
  buildHoldingScopeRef,
  parseHoldingScopeRef,
} from "@/lib/notes/scope-ref";

describe("buildHoldingScopeRef", () => {
  it("builds a 3-part colon-separated scope_ref from parts", () => {
    expect(
      buildHoldingScopeRef({
        venue: "binance",
        symbol: "BTC",
        holding_type: "spot",
      }),
    ).toBe("binance:BTC:spot");
  });

  it("builds a derivative scope_ref with stripped CCXT symbol", () => {
    expect(
      buildHoldingScopeRef({
        venue: "okx",
        symbol: "BTCUSDT",
        holding_type: "derivative",
      }),
    ).toBe("okx:BTCUSDT:derivative");
  });
});

describe("parseHoldingScopeRef", () => {
  it("parses a spot scope_ref round-trip", () => {
    expect(parseHoldingScopeRef("binance:BTC:spot")).toEqual({
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
    });
  });

  it("parses a derivative scope_ref round-trip", () => {
    expect(parseHoldingScopeRef("okx:BTCUSDT:derivative")).toEqual({
      venue: "okx",
      symbol: "BTCUSDT",
      holding_type: "derivative",
    });
  });

  it("returns null for malformed scope_ref (2 parts only)", () => {
    expect(parseHoldingScopeRef("binance:BTC")).toBeNull();
  });

  it("returns null when venue is uppercase", () => {
    expect(parseHoldingScopeRef("Binance:BTC:spot")).toBeNull();
  });

  it("returns null when symbol is lowercase", () => {
    expect(parseHoldingScopeRef("binance:btc:spot")).toBeNull();
  });

  it("returns null for unknown holding_type", () => {
    expect(parseHoldingScopeRef("binance:BTC:margin")).toBeNull();
  });

  it("returns null when symbol contains '/' (Research Finding #9)", () => {
    expect(parseHoldingScopeRef("binance:BTC/USDT:derivative")).toBeNull();
  });
});
