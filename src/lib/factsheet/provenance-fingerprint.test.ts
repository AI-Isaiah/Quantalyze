import { describe, it, expect } from "vitest";
import { provenanceFingerprint } from "./provenance-fingerprint";

/**
 * The fingerprint is a factsheet cache-key member (TRADESYNC plan 10). It exists
 * so a provenance write that does not move `computed_at` still changes the key.
 * The two properties that matter are therefore: equal provenance gives an equal
 * key (no needless cache churn), and different provenance gives a different key
 * (the page refreshes). Absent provenance must be a fixed literal, not a hash.
 */
describe("provenanceFingerprint", () => {
  it("is the literal 'none' for absent provenance", () => {
    expect(provenanceFingerprint(null)).toBe("none");
    expect(provenanceFingerprint(undefined)).toBe("none");
  });

  it("is 16 lowercase hex characters for present provenance", () => {
    expect(provenanceFingerprint({ gaps: [] })).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for equal values", () => {
    const a = { gaps: [{ from: "2026-01-01", to: "2026-01-03" }] };
    const b = { gaps: [{ from: "2026-01-01", to: "2026-01-03" }] };
    expect(provenanceFingerprint(a)).toBe(provenanceFingerprint(b));
  });

  it("changes when a gap is added, so a provenance write moves the cache key", () => {
    const before = provenanceFingerprint({ gaps: [] });
    const after = provenanceFingerprint({
      gaps: [{ from: "2026-01-01", to: "2026-01-03" }],
    });
    expect(after).not.toBe(before);
  });

  it("an empty object is present provenance, not 'none'", () => {
    expect(provenanceFingerprint({})).not.toBe("none");
  });
});
