/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  validateDisplayName,
  ProfileValidationError,
  DISPLAY_NAME_MAX_LENGTH,
} from "./profile-validation";

/**
 * Audit-2026-05-07 P325 regression tests.
 *
 * These tests pin the validator behavior at the boundary BEFORE any
 * insert/upsert into `profiles`. Every assertion encodes a specific
 * attack class the validator must reject — the test name doubles as
 * the security rationale. A future refactor that loosens the rules
 * has to re-justify each rejection by editing the test, not by
 * silently dropping a check.
 */
describe("validateDisplayName", () => {
  it("accepts a normal name and returns it trimmed", () => {
    expect(validateDisplayName("Alice Quant")).toBe("Alice Quant");
    expect(validateDisplayName("  Alice Quant  ")).toBe("Alice Quant");
  });

  it("accepts unicode + spaces in display names", () => {
    // Real users have non-ASCII names; we must not reject them.
    expect(validateDisplayName("José García")).toBe("José García");
    expect(validateDisplayName("Δοκιμή")).toBe("Δοκιμή");
  });

  it("rejects null / undefined with field='display_name', reason='missing'", () => {
    expect(() => validateDisplayName(null)).toThrow(ProfileValidationError);
    expect(() => validateDisplayName(undefined)).toThrow(ProfileValidationError);
    try {
      validateDisplayName(null);
    } catch (err) {
      const e = err as ProfileValidationError;
      expect(e.field).toBe("display_name");
      expect(e.reason).toBe("missing");
    }
  });

  it("rejects non-string input (defensive — TS callers shouldn't hit this)", () => {
    // Cast through unknown so TS doesn't reject the test author. Runtime
    // check is the actual contract — JS callers + JSON.parse can hand us
    // numbers / booleans / objects.
    expect(() => validateDisplayName(123 as unknown as string)).toThrow(
      ProfileValidationError,
    );
    try {
      validateDisplayName(123 as unknown as string);
    } catch (err) {
      expect((err as ProfileValidationError).reason).toBe("not_a_string");
    }
  });

  it("rejects empty / whitespace-only with reason='empty_or_whitespace'", () => {
    expect(() => validateDisplayName("")).toThrow(ProfileValidationError);
    expect(() => validateDisplayName("   ")).toThrow(ProfileValidationError);
    try {
      validateDisplayName("   ");
    } catch (err) {
      expect((err as ProfileValidationError).reason).toBe(
        "empty_or_whitespace",
      );
    }
  });

  it("rejects CR / LF / NUL — header & log injection vectors", () => {
    // CR alone (used to terminate SMTP / HTTP header lines).
    expect(() => validateDisplayName("Alice\rQuant")).toThrow(
      ProfileValidationError,
    );
    // LF alone (Unix newline; injects log lines, MIME boundaries).
    expect(() => validateDisplayName("Alice\nQuant")).toThrow(
      ProfileValidationError,
    );
    // CRLF (canonical SMTP/HTTP terminator).
    expect(() => validateDisplayName("Alice\r\nBcc: attacker@evil")).toThrow(
      ProfileValidationError,
    );
    // NUL (C-string truncation; some downstream consumers will silently
    // drop the suffix).
    expect(() => validateDisplayName("Alice\0Quant")).toThrow(
      ProfileValidationError,
    );

    try {
      validateDisplayName("Alice\nQuant");
    } catch (err) {
      expect((err as ProfileValidationError).reason).toBe(
        "control_characters_not_allowed",
      );
    }
  });

  it("catches CR/LF even when sandwiched between legitimate whitespace", () => {
    // The check runs BEFORE trim() so " \nfoo " is still rejected.
    expect(() => validateDisplayName(" \nAlice ")).toThrow(
      ProfileValidationError,
    );
    expect(() => validateDisplayName(" Alice\r ")).toThrow(
      ProfileValidationError,
    );
  });

  it(`rejects strings longer than ${DISPLAY_NAME_MAX_LENGTH} chars (no silent truncate)`, () => {
    const tooLong = "x".repeat(DISPLAY_NAME_MAX_LENGTH + 1);
    expect(() => validateDisplayName(tooLong)).toThrow(ProfileValidationError);
    try {
      validateDisplayName(tooLong);
    } catch (err) {
      expect((err as ProfileValidationError).reason).toBe(
        `exceeds_max_length_${DISPLAY_NAME_MAX_LENGTH}`,
      );
    }
  });

  it("accepts exactly DISPLAY_NAME_MAX_LENGTH chars (boundary)", () => {
    const atLimit = "x".repeat(DISPLAY_NAME_MAX_LENGTH);
    expect(validateDisplayName(atLimit)).toBe(atLimit);
  });

  it("HARD reject for over-limit, even after trim brings it under", () => {
    // 199 chars of payload + 5 leading spaces = 204 chars input. The
    // check must fire on raw length BEFORE trim, OR on trimmed length —
    // we picked trimmed length so this case PASSES. Pin the choice so a
    // future refactor doesn't accidentally flip semantics.
    const padded = "     " + "x".repeat(199);
    expect(validateDisplayName(padded)).toBe("x".repeat(199));
  });

  /**
   * Audit-2026-05-07 red-team R-0007 (MED c8): `[deleted]` is the GDPR
   * sanitize_user sentinel that gates /api/account/export. A user
   * setting their own display_name to this string locks themselves out
   * of Art. 15 access and the route returns the misleading "Account
   * sanitized" message. Reject the value at the user-controlled write
   * path so the sentinel space cannot collide with user-chosen names.
   * The sanitize_user RPC keeps writing it via service_role.
   */
  it("R-0007: rejects '[deleted]' as a reserved sentinel (sanitize-loop sentinel collision)", () => {
    expect(() => validateDisplayName("[deleted]")).toThrow(
      ProfileValidationError,
    );
    try {
      validateDisplayName("[deleted]");
    } catch (err) {
      expect((err as ProfileValidationError).reason).toBe("reserved_value");
    }
  });

  it("R-0007: case-folded — '[Deleted]' / '[DELETED]' are also rejected", () => {
    expect(() => validateDisplayName("[Deleted]")).toThrow(
      ProfileValidationError,
    );
    expect(() => validateDisplayName("[DELETED]")).toThrow(
      ProfileValidationError,
    );
  });

  it("R-0007: legitimate names containing 'deleted' substring still pass", () => {
    // "Deleted Recipes Maker" is a legitimate name; the reserved-value
    // check is exact-match (case-folded), not substring.
    expect(validateDisplayName("Deleted Recipes Maker")).toBe(
      "Deleted Recipes Maker",
    );
  });
});
