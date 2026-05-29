import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFERENCES,
  SELF_EDITABLE_PREFERENCE_FIELDS,
  ADMIN_ONLY_PREFERENCE_FIELDS,
  pickSelfEditableFields,
  pickAdminEditableFields,
  validateSelfEditableInput,
  validateAdminEditableInput,
} from "./preferences";

describe("preferences helpers", () => {
  describe("SELF_EDITABLE_PREFERENCE_FIELDS", () => {
    it("contains exactly the Phase 2 self-editable fields", () => {
      expect(SELF_EDITABLE_PREFERENCE_FIELDS).toEqual([
        "mandate_archetype",
        "target_ticket_size_usd",
        "excluded_exchanges",
        "max_weight",
        "preferred_strategy_types",
        "correlation_ceiling",
        "max_drawdown_tolerance",
        "liquidity_preference",
        "style_exclusions",
      ]);
    });

    it("is disjoint from ADMIN_ONLY_PREFERENCE_FIELDS", () => {
      const selfSet = new Set(SELF_EDITABLE_PREFERENCE_FIELDS);
      for (const field of ADMIN_ONLY_PREFERENCE_FIELDS) {
        expect(selfSet.has(field as never)).toBe(false);
      }
    });
  });

  describe("DEFAULT_PREFERENCES", () => {
    it("has generous defaults so eligibility doesn't strip the universe", () => {
      expect(DEFAULT_PREFERENCES.max_drawdown_tolerance).toBe(0.30);
      expect(DEFAULT_PREFERENCES.min_track_record_days).toBe(180);
      expect(DEFAULT_PREFERENCES.min_sharpe).toBe(0.5);
      expect(DEFAULT_PREFERENCES.target_ticket_size_usd).toBe(50000);
      expect(DEFAULT_PREFERENCES.max_aum_concentration).toBe(0.20);
    });

    it("has empty arrays for universe filters (no filter by default)", () => {
      expect(DEFAULT_PREFERENCES.preferred_strategy_types).toEqual([]);
      expect(DEFAULT_PREFERENCES.preferred_markets).toEqual([]);
      expect(DEFAULT_PREFERENCES.excluded_exchanges).toEqual([]);
    });
  });

  describe("pickSelfEditableFields", () => {
    it("keeps the self-editable fields, drops admin-only", () => {
      const input = {
        mandate_archetype: "diversified crypto SMA",
        target_ticket_size_usd: 50000,
        excluded_exchanges: ["bybit"],
        max_drawdown_tolerance: 0.2, // Phase 2: now self-editable (D-06), kept
        founder_notes: "private note", // admin-only, should be dropped
        min_sharpe: 1.5, // admin-only, should be dropped
      };
      const result = pickSelfEditableFields(input);
      expect(result).toEqual({
        mandate_archetype: "diversified crypto SMA",
        target_ticket_size_usd: 50000,
        excluded_exchanges: ["bybit"],
        max_drawdown_tolerance: 0.2,
      });
    });

    it("returns empty object for input with no self-editable fields", () => {
      const input = { founder_notes: "x", min_sharpe: 1.0 };
      expect(pickSelfEditableFields(input)).toEqual({});
    });

    it("handles empty input", () => {
      expect(pickSelfEditableFields({})).toEqual({});
    });

    it("silently drops unknown fields (no throw)", () => {
      const input = { mandate_archetype: "x", __proto__: "bad", sql: "DROP TABLE" };
      const result = pickSelfEditableFields(input);
      expect(result).toEqual({ mandate_archetype: "x" });
    });
  });

  describe("pickAdminEditableFields", () => {
    it("keeps both self-editable AND admin-only fields", () => {
      const input = {
        mandate_archetype: "x",
        target_ticket_size_usd: 50000,
        founder_notes: "private note",
        min_sharpe: 1.5,
        random_field: "dropped",
      };
      const result = pickAdminEditableFields(input);
      expect(result).toHaveProperty("mandate_archetype", "x");
      expect(result).toHaveProperty("target_ticket_size_usd", 50000);
      expect(result).toHaveProperty("founder_notes", "private note");
      expect(result).toHaveProperty("min_sharpe", 1.5);
      expect(result).not.toHaveProperty("random_field");
    });
  });

  describe("validateSelfEditableInput", () => {
    it("returns null for valid input", () => {
      expect(
        validateSelfEditableInput({
          mandate_archetype: "diversified crypto SMA",
          target_ticket_size_usd: 50000,
          excluded_exchanges: ["bybit"],
        }),
      ).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(validateSelfEditableInput({})).toBeNull();
    });

    it("returns null for null/undefined fields", () => {
      expect(
        validateSelfEditableInput({
          mandate_archetype: null,
          target_ticket_size_usd: null,
          excluded_exchanges: null,
        }),
      ).toBeNull();
    });

    it("rejects oversized mandate_archetype", () => {
      const long = "x".repeat(501);
      expect(
        validateSelfEditableInput({ mandate_archetype: long }),
      ).toMatch(/500 characters/);
    });

    it("rejects non-string mandate_archetype", () => {
      expect(
        validateSelfEditableInput({
          mandate_archetype: 42 as unknown as string,
        }),
      ).toMatch(/must be a string/);
    });

    it("rejects negative target_ticket_size_usd", () => {
      expect(
        validateSelfEditableInput({ target_ticket_size_usd: -1 }),
      ).toMatch(/non-negative/);
    });

    it("rejects non-number target_ticket_size_usd", () => {
      expect(
        validateSelfEditableInput({
          target_ticket_size_usd: "50000" as unknown as number,
        }),
      ).toMatch(/must be a number/);
    });

    it("rejects absurdly large target_ticket_size_usd", () => {
      expect(
        validateSelfEditableInput({ target_ticket_size_usd: 10_000_000_000 }),
      ).toMatch(/unrealistically large/);
    });

    it("rejects non-array excluded_exchanges", () => {
      expect(
        validateSelfEditableInput({
          excluded_exchanges: "bybit" as unknown as string[],
        }),
      ).toMatch(/must be an array/);
    });

    it("rejects non-string entries in excluded_exchanges", () => {
      expect(
        validateSelfEditableInput({
          excluded_exchanges: [1, 2] as unknown as string[],
        }),
      ).toMatch(/must be string\[\]/);
    });

    // NEW-C07-01 (audit-2026-05-26 security+red-team) regression tests.
    // Pre-fix: only Array.isArray + typeof e === "string" checked —
    // no count or per-element length cap. Write-amplification attack vector.
    it("NEW-C07-01: rejects excluded_exchanges with more than 100 entries", () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `exchange${i}`);
      expect(
        validateSelfEditableInput({ excluded_exchanges: tooMany }),
      ).toMatch(/at most 100/);
    });

    it("NEW-C07-01: accepts excluded_exchanges at the count cap when every entry is allowlisted", () => {
      // B8: count cap is 100 and the cap check precedes the per-element
      // allowlist check; 100 allowlisted entries must pass.
      const exactly100 = Array.from({ length: 100 }, () => "bybit");
      expect(
        validateSelfEditableInput({ excluded_exchanges: exactly100 }),
      ).toBeNull();
    });

    it("NEW-C07-01: rejects excluded_exchanges with an entry longer than 100 chars (before the allowlist check)", () => {
      const longEntry = "x".repeat(101);
      expect(
        validateSelfEditableInput({ excluded_exchanges: [longEntry] }),
      ).toMatch(/100 characters or less/);
    });

    // B8 (2026-05-29): NEW-C07-01 allowlist half. Previously excluded_exchanges
    // accepted ANY string ≤100 chars; the match engine only ever excludes
    // strategies on the {binance,okx,bybit} allowlist, so a non-allowlisted
    // value is dead data / a typo masking a real exclusion — reject-hard.
    it("NEW-C07-01: accepts allowlisted exchanges in lowercase (wire form)", () => {
      expect(
        validateSelfEditableInput({ excluded_exchanges: ["binance", "okx", "bybit"] }),
      ).toBeNull();
    });

    it("NEW-C07-01: accepts allowlisted exchanges in display case (UI chip form)", () => {
      expect(
        validateSelfEditableInput({ excluded_exchanges: ["Binance", "OKX", "Bybit"] }),
      ).toBeNull();
    });

    it("NEW-C07-01: rejects a non-allowlisted exchange (reject-hard)", () => {
      expect(
        validateSelfEditableInput({ excluded_exchanges: ["binance", "ftx"] }),
      ).toMatch(/unsupported exchange: ftx/);
    });

    it("NEW-C07-01: rejects a free-text string that is not an exchange", () => {
      expect(
        validateSelfEditableInput({ excluded_exchanges: ["not-an-exchange"] }),
      ).toMatch(/unsupported exchange/);
    });

    it("rejects NaN target_ticket_size_usd", () => {
      expect(
        validateSelfEditableInput({ target_ticket_size_usd: NaN }),
      ).toMatch(/must be finite/);
    });

    // ------------------------------------------------------------------
    // Phase 2 mandate validation — MANDATE-01..MANDATE-03 bounds per D-17
    // ------------------------------------------------------------------
    describe("Phase 2 mandate validation", () => {
      // max_weight — 0.05-0.50 per D-17
      it("accepts valid max_weight: 0.25", () => {
        expect(validateSelfEditableInput({ max_weight: 0.25 })).toBeNull();
      });
      it("accepts max_weight: null", () => {
        expect(validateSelfEditableInput({ max_weight: null })).toBeNull();
      });
      it("rejects max_weight below 0.05", () => {
        expect(
          validateSelfEditableInput({ max_weight: 0.04 }),
        ).toMatch(/between 0\.05 and 0\.50/);
      });
      it("rejects max_weight above 0.50", () => {
        expect(
          validateSelfEditableInput({ max_weight: 0.51 }),
        ).toMatch(/between 0\.05 and 0\.50/);
      });
      it("rejects NaN max_weight", () => {
        expect(
          validateSelfEditableInput({ max_weight: NaN }),
        ).toMatch(/must be finite/);
      });
      it("rejects non-number max_weight", () => {
        expect(
          validateSelfEditableInput({ max_weight: "0.25" as unknown as number }),
        ).toMatch(/must be a number/);
      });

      // correlation_ceiling — 0-1 per D-17
      it("accepts valid correlation_ceiling: 0.6", () => {
        expect(
          validateSelfEditableInput({ correlation_ceiling: 0.6 }),
        ).toBeNull();
      });
      it("rejects correlation_ceiling above 1", () => {
        expect(
          validateSelfEditableInput({ correlation_ceiling: 1.1 }),
        ).toMatch(/between 0 and 1/);
      });

      // max_drawdown_tolerance — now self-editable (D-06)
      it("accepts max_drawdown_tolerance: 0.2 via self-editable input", () => {
        expect(
          validateSelfEditableInput({ max_drawdown_tolerance: 0.2 }),
        ).toBeNull();
      });
      it("rejects max_drawdown_tolerance: 1.5 via self-editable", () => {
        expect(
          validateSelfEditableInput({ max_drawdown_tolerance: 1.5 }),
        ).toMatch(/between 0 and 1/);
      });

      // liquidity_preference — enum per D-05
      it("accepts liquidity_preference: high", () => {
        expect(
          validateSelfEditableInput({ liquidity_preference: "high" }),
        ).toBeNull();
      });
      it("accepts liquidity_preference: medium", () => {
        expect(
          validateSelfEditableInput({ liquidity_preference: "medium" }),
        ).toBeNull();
      });
      it("accepts liquidity_preference: low", () => {
        expect(
          validateSelfEditableInput({ liquidity_preference: "low" }),
        ).toBeNull();
      });
      it("rejects liquidity_preference: ultra", () => {
        expect(
          validateSelfEditableInput({
            liquidity_preference: "ultra" as unknown as "high",
          }),
        ).toMatch(/must be high, medium, or low/);
      });

      // style_exclusions — subset of SUBTYPES
      it("accepts valid style_exclusions subset", () => {
        expect(
          validateSelfEditableInput({
            style_exclusions: ["Trend Following", "Momentum"],
          }),
        ).toBeNull();
      });
      it("rejects style_exclusions with unknown value", () => {
        expect(
          validateSelfEditableInput({
            style_exclusions: ["UnknownStyle"],
          }),
        ).toMatch(/contains invalid value/);
      });
      it("rejects non-array style_exclusions", () => {
        expect(
          validateSelfEditableInput({
            style_exclusions: "not-an-array" as unknown as string[],
          }),
        ).toMatch(/must be an array/);
      });

      // preferred_strategy_types — now self-editable (D-03), subset of STRATEGY_TYPES
      it("accepts preferred_strategy_types: [Long-Only]", () => {
        expect(
          validateSelfEditableInput({
            preferred_strategy_types: ["Long-Only"],
          }),
        ).toBeNull();
      });
      it("rejects preferred_strategy_types with unknown value", () => {
        expect(
          validateSelfEditableInput({
            preferred_strategy_types: ["NotAType"],
          }),
        ).toMatch(/contains invalid value/);
      });
    });
  });

  describe("validateAdminEditableInput", () => {
    it("returns null for valid input", () => {
      expect(
        validateAdminEditableInput({
          mandate_archetype: "x",
          target_ticket_size_usd: 50000,
          max_drawdown_tolerance: 0.2,
          min_sharpe: 1.0,
          min_track_record_days: 365,
          max_aum_concentration: 0.15,
          // Phase 2: preferred_strategy_types now validated as subset of
          // STRATEGY_TYPES (D-03); "Trend Following" is a SUBTYPE, not a
          // STRATEGY_TYPE. Use a real STRATEGY_TYPES entry.
          preferred_strategy_types: ["Long-Short"],
          preferred_markets: ["Crypto Spot"],
          founder_notes: "Met at the YC dinner last week.",
        }),
      ).toBeNull();
    });

    it("rejects non-number max_drawdown_tolerance", () => {
      expect(
        validateAdminEditableInput({
          max_drawdown_tolerance: "0.2" as unknown as number,
        }),
      ).toMatch(/must be a number/);
    });

    it("rejects NaN min_sharpe", () => {
      expect(
        validateAdminEditableInput({ min_sharpe: NaN }),
      ).toMatch(/must be finite/);
    });

    it("rejects out-of-range max_drawdown_tolerance", () => {
      expect(
        validateAdminEditableInput({ max_drawdown_tolerance: 1.5 }),
      ).toMatch(/between 0 and 1/);
    });

    it("rejects out-of-range min_track_record_days", () => {
      expect(
        validateAdminEditableInput({ min_track_record_days: 999999 }),
      ).toMatch(/between 0 and 10000/);
    });

    it("rejects non-array preferred_strategy_types", () => {
      expect(
        validateAdminEditableInput({
          preferred_strategy_types: "trend" as unknown as string[],
        }),
      ).toMatch(/must be an array/);
    });

    it("rejects non-string entries in preferred_markets", () => {
      expect(
        validateAdminEditableInput({
          preferred_markets: [1, 2] as unknown as string[],
        }),
      ).toMatch(/must be string\[\]/);
    });

    it("rejects non-string founder_notes", () => {
      expect(
        validateAdminEditableInput({
          founder_notes: 42 as unknown as string,
        }),
      ).toMatch(/must be a string/);
    });

    it("rejects oversized founder_notes", () => {
      expect(
        validateAdminEditableInput({ founder_notes: "x".repeat(10_001) }),
      ).toMatch(/10,000 characters/);
    });

    it("accepts null and undefined values", () => {
      expect(
        validateAdminEditableInput({
          max_drawdown_tolerance: null,
          min_sharpe: null,
          founder_notes: null,
        }),
      ).toBeNull();
    });
  });
});
