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
    it("contains exactly the 3 v1 self-editable fields", () => {
      expect(SELF_EDITABLE_PREFERENCE_FIELDS).toEqual([
        "mandate_archetype",
        "target_ticket_size_usd",
        "excluded_exchanges",
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
    it("keeps only the 3 self-editable fields", () => {
      const input = {
        mandate_archetype: "diversified crypto SMA",
        target_ticket_size_usd: 50000,
        excluded_exchanges: ["bybit"],
        max_drawdown_tolerance: 0.2, // admin-only, should be dropped
        founder_notes: "private note", // admin-only, should be dropped
        min_sharpe: 1.5, // admin-only, should be dropped
      };
      const result = pickSelfEditableFields(input);
      expect(result).toEqual({
        mandate_archetype: "diversified crypto SMA",
        target_ticket_size_usd: 50000,
        excluded_exchanges: ["bybit"],
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

    it("rejects NaN target_ticket_size_usd", () => {
      expect(
        validateSelfEditableInput({ target_ticket_size_usd: NaN }),
      ).toMatch(/must be finite/);
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
          preferred_strategy_types: ["Trend Following"],
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
