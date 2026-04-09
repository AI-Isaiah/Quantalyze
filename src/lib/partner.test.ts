import { describe, it, expect } from "vitest";
import { PARTNER_TAG_RE, isValidPartnerTag } from "./partner";

describe("partner.ts", () => {
  describe("PARTNER_TAG_RE", () => {
    it("accepts lowercase letters, digits, and hyphens", () => {
      expect(PARTNER_TAG_RE.test("alpha")).toBe(true);
      expect(PARTNER_TAG_RE.test("alpha-pilot-2026")).toBe(true);
      expect(PARTNER_TAG_RE.test("0-9-a-z")).toBe(true);
    });

    it("rejects uppercase, whitespace, and special characters", () => {
      expect(PARTNER_TAG_RE.test("Alpha")).toBe(false);
      expect(PARTNER_TAG_RE.test("alpha pilot")).toBe(false);
      expect(PARTNER_TAG_RE.test("alpha_pilot")).toBe(false);
      expect(PARTNER_TAG_RE.test("alpha/pilot")).toBe(false);
    });
  });

  describe("isValidPartnerTag", () => {
    it("returns true for valid tag strings", () => {
      expect(isValidPartnerTag("alpha")).toBe(true);
      expect(isValidPartnerTag("cap-intro-pilot")).toBe(true);
      expect(isValidPartnerTag("2026-q2")).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isValidPartnerTag("")).toBe(false);
    });

    it("rejects non-string inputs", () => {
      expect(isValidPartnerTag(undefined)).toBe(false);
      expect(isValidPartnerTag(null)).toBe(false);
      expect(isValidPartnerTag(42)).toBe(false);
      expect(isValidPartnerTag({})).toBe(false);
      expect(isValidPartnerTag([])).toBe(false);
    });

    it("rejects uppercase letters", () => {
      expect(isValidPartnerTag("Alpha")).toBe(false);
      expect(isValidPartnerTag("ALPHA")).toBe(false);
    });

    it("rejects whitespace", () => {
      expect(isValidPartnerTag(" alpha")).toBe(false);
      expect(isValidPartnerTag("alpha ")).toBe(false);
      expect(isValidPartnerTag("alpha pilot")).toBe(false);
    });

    it("narrows the type to string on the truthy branch", () => {
      const raw: unknown = "alpha";
      if (isValidPartnerTag(raw)) {
        // If the type guard didn't narrow, this .length access would error
        // under `strict: true`. Test passes iff tsc is happy AND the runtime
        // assertion holds.
        expect(raw.length).toBeGreaterThan(0);
      } else {
        throw new Error("type guard should have narrowed raw to string");
      }
    });
  });
});
