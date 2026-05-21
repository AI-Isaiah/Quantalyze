import { describe, it, expect } from "vitest";
import { canonicalizeExchange, canonicalizeExchangeList } from "./constants";

// Regression: /qa 2026-05-21 ISSUE-004. The wizard's
// create_wizard_strategy seeded strategies.supported_exchanges with
// lowercase ('bybit' / 'okx' / 'binance') from api_keys.exchange, but
// the MetadataStep chip group compared selected entries case-sensitively
// against canonical EXCHANGES ('Bybit' / 'OKX' / 'Binance'). On resume,
// the user clicked the chip that already matched their key — adding
// 'Bybit' alongside 'bybit' — and finalize-wizard persisted both,
// producing the "Supported exchanges: bybit, Bybit" copy on every
// allocator-facing card.
describe("canonicalizeExchange", () => {
  it("maps lowercase api_keys.exchange to canonical case", () => {
    expect(canonicalizeExchange("bybit")).toBe("Bybit");
    expect(canonicalizeExchange("okx")).toBe("OKX");
    expect(canonicalizeExchange("binance")).toBe("Binance");
  });

  it("returns the canonical form unchanged when already canonical", () => {
    expect(canonicalizeExchange("Bybit")).toBe("Bybit");
    expect(canonicalizeExchange("OKX")).toBe("OKX");
    expect(canonicalizeExchange("Binance")).toBe("Binance");
  });

  it("normalizes arbitrary case mixes to canonical", () => {
    expect(canonicalizeExchange("BYBIT")).toBe("Bybit");
    expect(canonicalizeExchange("Okx")).toBe("OKX");
    expect(canonicalizeExchange("bInAnCe")).toBe("Binance");
  });

  it("leaves unknown exchanges unchanged (forward-compat / legacy)", () => {
    // 'coinbase' is in the seed data for one legacy row; the helper
    // must NOT silently drop it to '' or to the empty string — let
    // the chip group fail to render it instead.
    expect(canonicalizeExchange("coinbase")).toBe("coinbase");
    expect(canonicalizeExchange("Kraken")).toBe("Kraken");
  });

  it("returns empty / nullish input unchanged", () => {
    expect(canonicalizeExchange("")).toBe("");
  });
});

describe("canonicalizeExchangeList", () => {
  it("collapses ['bybit', 'Bybit'] to ['Bybit'] (the original bug)", () => {
    expect(canonicalizeExchangeList(["bybit", "Bybit"])).toEqual(["Bybit"]);
  });

  it("collapses ['Okx', 'OKX'] to ['OKX']", () => {
    expect(canonicalizeExchangeList(["Okx", "OKX"])).toEqual(["OKX"]);
  });

  it("dedupes across all three case-variants in any order", () => {
    expect(
      canonicalizeExchangeList(["BINANCE", "Binance", "binance", "BiNaNcE"]),
    ).toEqual(["Binance"]);
  });

  it("preserves the order of first occurrence", () => {
    // The chip group emits entries in user-click order; surface that
    // back to the user instead of reordering on persist.
    expect(canonicalizeExchangeList(["okx", "bybit", "binance"])).toEqual([
      "OKX",
      "Bybit",
      "Binance",
    ]);
  });

  it("preserves unknown exchanges without dropping them", () => {
    expect(canonicalizeExchangeList(["bybit", "coinbase"])).toEqual([
      "Bybit",
      "coinbase",
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(canonicalizeExchangeList([])).toEqual([]);
  });
});
