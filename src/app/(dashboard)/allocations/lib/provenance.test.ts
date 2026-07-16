import { describe, it, expect } from "vitest";
import { deriveProvenance } from "./provenance";

/**
 * Phase 111 / CONSTIT-02 — deriveProvenance unit coverage.
 *
 * deriveProvenance maps a constituent's server-truth provenance metadata
 * (`trust_tier` + `is_composite`) to the presentation badge union
 * `ProvenanceTier | null` with a fixed precedence:
 *   1. is_composite === true            → "composite"   (composite identity wins)
 *   2. trust_tier is a valid TrustTier  → that tier
 *   3. otherwise                        → null          (badge hidden; honest absence)
 *
 * The four taxonomy variants (api-verified / csv / self-reported / composite)
 * must all be derivable, plus the honest-null case. Per-key constituents are
 * "api_verified" by CONSTRUCTION — a per-key unit IS a connected exchange key —
 * so they reach deriveProvenance with trust_tier "api_verified".
 */
describe("deriveProvenance (CONSTIT-02)", () => {
  it("derives all three verification tiers when not composite", () => {
    expect(deriveProvenance({ trust_tier: "api_verified", is_composite: false })).toBe(
      "api_verified",
    );
    expect(deriveProvenance({ trust_tier: "csv_uploaded", is_composite: false })).toBe(
      "csv_uploaded",
    );
    expect(deriveProvenance({ trust_tier: "self_reported", is_composite: false })).toBe(
      "self_reported",
    );
  });

  it("derives 'composite' when is_composite === true (composite wins over any tier)", () => {
    expect(deriveProvenance({ trust_tier: null, is_composite: true })).toBe("composite");
    // Precedence: a composite book supersedes a single verification tier.
    expect(deriveProvenance({ trust_tier: "api_verified", is_composite: true })).toBe(
      "composite",
    );
    expect(deriveProvenance({ trust_tier: "self_reported", is_composite: true })).toBe(
      "composite",
    );
  });

  it("returns null (honest absence) when there is no composite flag and no valid tier", () => {
    expect(deriveProvenance({ trust_tier: null, is_composite: false })).toBeNull();
    expect(deriveProvenance({ trust_tier: undefined, is_composite: false })).toBeNull();
    expect(deriveProvenance({})).toBeNull();
  });

  it("ignores an unrecognised trust_tier string (never invents a badge)", () => {
    expect(deriveProvenance({ trust_tier: "totally_bogus", is_composite: false })).toBeNull();
    expect(deriveProvenance({ trust_tier: "composite", is_composite: false })).toBeNull();
    expect(deriveProvenance({ trust_tier: "", is_composite: false })).toBeNull();
  });

  it("only a STRICT is_composite===true triggers composite (truthy non-true does not)", () => {
    // The server already coerces to a strict boolean; guard against a caller
    // passing a truthy-but-not-true value from a stale/loosely-typed path.
    expect(
      deriveProvenance({ trust_tier: "csv_uploaded", is_composite: 1 as unknown as boolean }),
    ).toBe("csv_uploaded");
    expect(
      deriveProvenance({ trust_tier: null, is_composite: 1 as unknown as boolean }),
    ).toBeNull();
  });

  it("per-key constituents resolve to api-verified by construction", () => {
    // A per-key unit is minted one-per-connected-exchange-key by the
    // scenario-adapter; callers pass trust_tier "api_verified" for it, and it is
    // never composite. This pins the RESEARCH "per-key ⇒ api-verified" rule.
    expect(
      deriveProvenance({ trust_tier: "api_verified", is_composite: false }),
    ).toBe("api_verified");
  });
});
