import { describe, it, expect } from "vitest";
import {
  canonicalizeExchange,
  canonicalizeExchangeList,
  DISCOVERY_CATEGORIES,
} from "./constants";

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

// M-0507 — DISCOVERY_CATEGORIES `group` field data integrity.
//
// Sidebar.tsx buckets categories by `cat.group`:
//   let bucket = discoveryGroups.find((g) => g.label === cat.group);
//   if (!bucket) { bucket = { label: cat.group, items: [] }; ... }
//
// A 6th entry added without a `group` field would build a bucket with
// `label: undefined`, rendering an empty-label sub-section header. A typo
// like `group: 'TradeFi'` would silently create a phantom 3rd section
// between Digital Assets and TradFi. The Sidebar render tests assert
// display labels, but nothing asserts the constant-level data integrity
// that the sidebar's grouping logic depends on. These tests are that gate.
describe("DISCOVERY_CATEGORIES — `group` field integrity (M-0507)", () => {
  // The only two groups the Sidebar sub-section logic expects to render.
  const KNOWN_GROUPS = new Set(["Digital Assets", "TradFi"]);

  it("every entry has a non-empty string `group` field", () => {
    // A missing/empty group ⇒ Sidebar builds { label: undefined/'' , items }
    // ⇒ empty sub-section header.
    for (const cat of DISCOVERY_CATEGORIES) {
      expect(typeof cat.group).toBe("string");
      expect(cat.group.length).toBeGreaterThan(0);
    }
  });

  it("every `group` is one of the two known sidebar sections (catches typos like 'TradeFi')", () => {
    for (const cat of DISCOVERY_CATEGORIES) {
      expect(KNOWN_GROUPS.has(cat.group)).toBe(true);
    }
  });

  it("exposes exactly the two known groups (no phantom 3rd section)", () => {
    const present = new Set(DISCOVERY_CATEGORIES.map((c) => c.group));
    expect(present).toEqual(KNOWN_GROUPS);
  });

  it("every slug is non-empty and unique (downstream find(c => c.slug === slug) contract)", () => {
    const slugs = DISCOVERY_CATEGORIES.map((c) => c.slug);
    for (const slug of slugs) {
      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("first-seen group order is Digital Assets → TradFi (sidebar renders groups in first-appearance order)", () => {
    const orderedGroups: string[] = [];
    for (const cat of DISCOVERY_CATEGORIES) {
      if (!orderedGroups.includes(cat.group)) orderedGroups.push(cat.group);
    }
    expect(orderedGroups).toEqual(["Digital Assets", "TradFi"]);
  });
});
