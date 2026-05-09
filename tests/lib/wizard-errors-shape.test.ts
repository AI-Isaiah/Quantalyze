import { describe, it, expect } from "vitest";
import { WIZARD_ERROR_COPY, formatKeyError } from "@/lib/wizardErrors";

/**
 * Phase 19 / BACKBONE-08 — H-4 acceptance.
 *
 * Locks the WIZARD_DUPLICATE code: present in the discriminated union AND
 * in WIZARD_ERROR_COPY with the right shape AND surfaced through the same
 * formatKeyError envelope-renderer that the rest of the wizard chrome
 * uses. A literal-in-comment is NOT sufficient — these assertions only
 * pass if the code actually compiles into the union and copy table.
 */
describe("WIZARD_DUPLICATE (Phase 19 / BACKBONE-08)", () => {
  it("WIZARD_ERROR_COPY['WIZARD_DUPLICATE'] is present with shape-valid copy", () => {
    const entry = WIZARD_ERROR_COPY["WIZARD_DUPLICATE"];
    expect(entry).toBeDefined();
    expect(typeof entry.title).toBe("string");
    expect(entry.title.length).toBeGreaterThan(4);
    expect(typeof entry.cause).toBe("string");
    expect(entry.cause.length).toBeGreaterThan(4);
    expect(Array.isArray(entry.fix)).toBe(true);
    expect(entry.fix.length).toBeGreaterThan(0);
    expect(typeof entry.docsHref).toBe("string");
    expect(entry.docsHref).toMatch(/^\/security/);
    expect(Array.isArray(entry.actions)).toBe(true);
    expect(entry.actions.length).toBeGreaterThan(0);
  });

  it("formatKeyError('WIZARD_DUPLICATE') returns the WIZARD_DUPLICATE entry verbatim", () => {
    const result = formatKeyError("WIZARD_DUPLICATE");
    // Title is what the envelope renders as the headline string. Asserting
    // the value (rather than just !== UNKNOWN) makes the test fail loudly
    // if a future copy edit drops the user-facing acknowledgment.
    expect(result.title).toBe(
      WIZARD_ERROR_COPY["WIZARD_DUPLICATE"].title,
    );
    expect(result.title).toMatch(/already submitted/i);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("WIZARD_DUPLICATE introduces no new design tokens (DESIGN.md compliance)", () => {
    // The entry must use the same shape as every other code — no extra
    // fields like `color` or `tone`. Prior copy keys (title/cause/fix/
    // docsHref/actions) form the locked surface; new keys would be a
    // signal that an implementer broke DESIGN.md by adding visual chrome
    // out of band. This guards against accidental shape drift.
    const entry = WIZARD_ERROR_COPY["WIZARD_DUPLICATE"];
    const allowedKeys = new Set([
      "title",
      "cause",
      "fix",
      "docsHref",
      "actions",
    ]);
    for (const key of Object.keys(entry)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
