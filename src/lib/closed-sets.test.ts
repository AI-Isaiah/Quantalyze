import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPORTED_EXCHANGES,
  UI_EXCHANGE_CODES,
  FUNDING_EXCHANGES,
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
    it("SUPPORTED_EXCHANGES is the canonical lowercase wire form (key-save boundary)", () => {
      // Phase 68 (DRB-02): the key-save boundary admits deribit. This is the
      // widened allowlist a key-save request clears at the TS layer.
      expect(SUPPORTED_EXCHANGES).toEqual(["binance", "okx", "bybit", "deribit"]);
    });

    it("EXCHANGES (display) is the 3-value UI-offered set — OQ4 Phase-69 gate pin", () => {
      // Regression: the UI chip-group importers rendered ["Binance","OKX","Bybit"].
      // OQ4 GATE: EXCHANGES derives from UI_EXCHANGE_CODES (NOT the widened
      // SUPPORTED_EXCHANGES) so the marketing count + chips stay 3-exchange and
      // "Deribit" is NOT offered until Phase 69 flips UI_EXCHANGE_CODES.
      expect(EXCHANGES).toEqual(["Binance", "OKX", "Bybit"]);
    });

    it("UI_EXCHANGE_CODES and FUNDING_EXCHANGES stay 3-value and exclude deribit (OQ4 + Pitfall 2)", () => {
      // These two consts are DECOUPLED from the widened SUPPORTED_EXCHANGES on
      // purpose: UI_EXCHANGE_CODES gates the public dropdown/marketing (Phase 69
      // flips it) and FUNDING_EXCHANGES gates the sync-funding/reconcile crons
      // (Phase 70 flips it). A deribit leak into either is exactly what this pins.
      expect(UI_EXCHANGE_CODES).toEqual(["binance", "okx", "bybit"]);
      expect(FUNDING_EXCHANGES).toEqual(["binance", "okx", "bybit"]);
      expect((UI_EXCHANGE_CODES as readonly string[]).includes("deribit")).toBe(false);
      expect((FUNDING_EXCHANGES as readonly string[]).includes("deribit")).toBe(false);
    });

    // OQ4 chip-surface guard (Phase 68 code-review H1): the value-space pins
    // above catch a re-widened CONST, but not a COMPONENT that imports the
    // widened `SUPPORTED_EXCHANGES` to build rendered exchange chips/options.
    // That is exactly how RequestIntroButton leaked a selectable "Deribit"
    // chip. Pin every user-facing exchange-selection surface to the decoupled
    // UI set: they must NOT import SUPPORTED_EXCHANGES (they use
    // UI_EXCHANGE_CODES or the display EXCHANGES). A new chip surface added to
    // this list, or an old one reverted to SUPPORTED_EXCHANGES, fails here.
    it("user-facing exchange-chip components never import the widened SUPPORTED_EXCHANGES (OQ4)", () => {
      const CHIP_SURFACES = [
        "components/strategy/RequestIntroButton.tsx",
        "components/landing/VerificationForm.tsx",
      ];
      for (const rel of CHIP_SURFACES) {
        const src = readFileSync(join(__dirname, "..", rel), "utf8");
        const importsWidened =
          /import\s*\{[^}]*\bSUPPORTED_EXCHANGES\b[^}]*\}/.test(src);
        expect(
          importsWidened,
          `${rel} imports SUPPORTED_EXCHANGES — a user-facing chip surface must ` +
            `use UI_EXCHANGE_CODES so Deribit is not offered until Phase 69`,
        ).toBe(false);
        expect(/\bUI_EXCHANGE_CODES\b/.test(src)).toBe(true);
      }
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
      expect(isSupportedExchange("deribit")).toBe(true); // Phase 68: deribit is in the key-save allowlist
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
