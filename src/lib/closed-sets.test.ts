import { describe, it, expect } from "vitest";
import {
  SUPPORTED_EXCHANGES,
  EXCHANGES,
  EXCHANGE_DISPLAY,
  exchangeEnum,
  isSupportedExchange,
  SIGNUP_ROLES,
  SELF_EDITABLE_PREFERENCE_FIELDS,
  ADMIN_ONLY_PREFERENCE_FIELDS,
  LIQUIDITY_PREFERENCES,
  MAGNITUDE_CAPS,
} from "./closed-sets";
import { ROLES } from "./types";

// B8 — closed-set registry. These tests pin the registry's contents and the
// derivations that other modules + the UI depend on. A drift here (re-widened
// set, wrong cap, casing mismatch) is exactly the class B8 closes.
describe("closed-sets registry", () => {
  describe("exchanges (value-space A)", () => {
    it("SUPPORTED_EXCHANGES is the canonical lowercase wire form", () => {
      expect(SUPPORTED_EXCHANGES).toEqual(["binance", "okx", "bybit"]);
    });

    it("EXCHANGES (display) is DERIVED from the base — byte-identical to the legacy hand-maintained tuple", () => {
      // Regression: the UI chip-group importers rendered ["Binance","OKX","Bybit"];
      // the derivation must produce the same values in the same order so no
      // chip label changes.
      expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit"]);
    });

    it("EXCHANGE_DISPLAY has a label for every supported code (satisfies guarantee, checked at runtime too)", () => {
      for (const code of SUPPORTED_EXCHANGES) {
        expect(EXCHANGE_DISPLAY[code]).toBeTruthy();
        expect(EXCHANGE_DISPLAY[code].toLowerCase()).toBe(code);
      }
      expect(Object.keys(EXCHANGE_DISPLAY).sort()).toEqual(
        [...SUPPORTED_EXCHANGES].sort(),
      );
    });

    it("exchangeEnum parses lowercase codes and rejects anything else", () => {
      expect(exchangeEnum.safeParse("binance").success).toBe(true);
      expect(exchangeEnum.safeParse("Binance").success).toBe(false);
      expect(exchangeEnum.safeParse("ftx").success).toBe(false);
    });

    it("isSupportedExchange is case-insensitive membership", () => {
      expect(isSupportedExchange("binance")).toBe(true);
      expect(isSupportedExchange("Binance")).toBe(true);
      expect(isSupportedExchange("BYBIT")).toBe(true);
      expect(isSupportedExchange("ftx")).toBe(false);
      expect(isSupportedExchange("deribit")).toBe(false); // wider ccxt set, not the user allowlist
      expect(isSupportedExchange("")).toBe(false);
    });
  });

  describe("signup roles (security boundary)", () => {
    it("SIGNUP_ROLES mirrors the handle_new_user trigger allowlist exactly", () => {
      expect(SIGNUP_ROLES).toEqual(["manager", "allocator", "both"]);
    });

    it("does NOT contain an elevated/internal role", () => {
      expect((SIGNUP_ROLES as readonly string[]).includes("admin")).toBe(false);
      expect((SIGNUP_ROLES as readonly string[]).includes("service_role")).toBe(false);
    });

    it("the types.ts ROLES UI list cannot drift from SIGNUP_ROLES", () => {
      // ROLES drives the role picker; its value set must equal SIGNUP_ROLES so
      // the closed set is single-sourced.
      expect(ROLES.map((r) => r.value).sort()).toEqual([...SIGNUP_ROLES].sort());
    });
  });

  describe("preference field sets (re-exported from preferences.ts)", () => {
    it("SELF_EDITABLE_PREFERENCE_FIELDS is the 9-key allocator-writable set", () => {
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

    it("self-editable and admin-only field sets are disjoint", () => {
      const self = new Set<string>(SELF_EDITABLE_PREFERENCE_FIELDS);
      for (const f of ADMIN_ONLY_PREFERENCE_FIELDS) {
        expect(self.has(f)).toBe(false);
      }
    });

    it("LIQUIDITY_PREFERENCES is the closed liquidity set", () => {
      expect(LIQUIDITY_PREFERENCES).toEqual(["high", "medium", "low"]);
    });
  });

  describe("magnitude caps", () => {
    it("pins the cap boundary values that the routes + validators consume", () => {
      expect(MAGNITUDE_CAPS.MAX_NAME_CHARS).toBe(80);
      expect(MAGNITUDE_CAPS.MAX_MANDATE_CHARS).toBe(500);
      expect(MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS).toBe(5000);
      expect(MAGNITUDE_CAPS.MAX_FOUNDER_NOTES_CHARS).toBe(10_000);
      expect(MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD).toBe(1_000_000_000);
      expect(MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD).toBe(1_000_000_000_000);
      expect(MAGNITUDE_CAPS.MAX_EXCLUDED_EXCHANGES_COUNT).toBe(100);
      expect(MAGNITUDE_CAPS.MAX_EXCLUDED_EXCHANGE_LENGTH).toBe(100);
    });

    it("the AUM dollar cap is strictly larger than the ticket-size cap (distinct semantics)", () => {
      expect(MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD).toBeGreaterThan(
        MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD,
      );
    });
  });
});
