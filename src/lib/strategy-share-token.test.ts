import { describe, it, expect, afterEach, vi } from "vitest";

import { deriveShareToken, verifyShareToken } from "@/lib/strategy-share-token";
import { hashShareToken, mintShareToken } from "@/lib/scenario-share-token";

/**
 * Phase 164 / SHARE-01 — the strategy share-token contract (ruling D-02).
 *
 * What these pins protect, in order of how badly each failure would hurt:
 *
 *   1. DERIVABILITY. The token is re-derived from `(strategy_id, generation)`
 *      on every Copy Link, which is the ONLY way a second click can hand back
 *      the SAME URL. A hash-only-at-rest model (the scenario one) cannot do
 *      that, so it would silently break the recipient's existing link on every
 *      re-copy — the founder-hit defect wearing a different hat.
 *   2. REVOCATION. `generation` is the revocation mechanism. If gen 1 and gen 2
 *      ever produced the same token, `generation += 1` would revoke nothing and
 *      a "revoked" link would keep working. That is the assertion below with
 *      the largest blast radius.
 *   3. ALGORITHM STABILITY. A silent change to the hash, the encoding, or the
 *      serialization separator invalidates EVERY outstanding link at once
 *      without anyone noticing until a recipient complains. The literal digest
 *      vector is what makes such a change go red at authoring time.
 *   4. CROSS-NAMESPACE REPLAY. A scenario share token is format-identical to a
 *      strategy one (both 43-char base64url). It must never verify here.
 *   5. LOUD MISCONFIG. A missing/short secret must throw at MODULE LOAD, not at
 *      first share.
 *
 * FIXTURE COUPLING, stated rather than assumed: the digest vectors below are
 * computed under the fixture secret `src/test-setup.ts` installs before its env
 * snapshot. The first test asserts that value explicitly, so if the fixture
 * ever changes, ONE test fails with an obvious reason instead of four failing
 * with "wrong digest".
 */

const FIXTURE_SECRET =
  "test-fixture-share-token-secret-not-a-real-secret-0123456789";

/** A fixed, obviously-synthetic strategy id. Never a real row. */
const STRATEGY_ID = "11111111-2222-3333-4444-555555555555";

/** base64url (RFC 4648 §5), no padding, 32-byte digest → exactly 43 chars. */
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

afterEach(() => {
  vi.resetModules();
});

describe("the fixture the vectors below are computed under", () => {
  it("test-setup installs the exact fixture secret these vectors assume", () => {
    // If this fails, the vectors are stale — recompute them, do not "fix" the
    // assertions by reading the new value out of the implementation.
    expect(process.env.SHARE_TOKEN_SECRET).toBe(FIXTURE_SECRET);
    expect(FIXTURE_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});

describe("deriveShareToken", () => {
  it("matches a LITERAL precomputed vector (pins hash + encoding + separator)", () => {
    // HMAC-SHA256(FIXTURE_SECRET, `${STRATEGY_ID}.1`) → base64url.
    // Hand-computed once at authoring time. A change to the algorithm, the
    // digest encoding, or the `.` separator MUST land here as a failure — the
    // alternative is every outstanding share link dying silently on deploy.
    expect(deriveShareToken(STRATEGY_ID, 1)).toBe(
      "LAbG-N22cfd1QIkGZATK9n5yLlB7GhXQ1ZyBEzeKCGo",
    );
  });

  it("returns a 43-char base64url token (the format the route guards on)", () => {
    const token = deriveShareToken(STRATEGY_ID, 7);
    expect(token).toMatch(BASE64URL_43);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("is deterministic — the SAME inputs re-derive the SAME token (this is what makes Copy Link reuse a live link)", () => {
    expect(deriveShareToken(STRATEGY_ID, 3)).toBe(
      deriveShareToken(STRATEGY_ID, 3),
    );
  });

  it("generation 1 and generation 2 yield DIFFERENT tokens (this IS the revocation mechanism)", () => {
    const gen1 = deriveShareToken(STRATEGY_ID, 1);
    const gen2 = deriveShareToken(STRATEGY_ID, 2);
    expect(gen2).not.toBe(gen1);
    // Pin gen 2 literally too: if the counter ever stopped entering the
    // serialization, `not.toBe` alone could still pass by accident on some
    // future shape, but this cannot.
    expect(gen2).toBe("IqyrPWBTQuFnPoDlnCZNIqmB3_qAob5GFAP1FWM3INo");
  });

  it("a different strategy id yields a different token (the id is inside the MAC, not beside it)", () => {
    expect(deriveShareToken("99999999-8888-7777-6666-555555555555", 1)).not.toBe(
      deriveShareToken(STRATEGY_ID, 1),
    );
  });

  it("a DIFFERENT secret yields a different token — rotation is the global kill-switch", async () => {
    // The secret is read once at module scope, so a fresh module registry is
    // the only honest way to exercise a second secret.
    process.env.SHARE_TOKEN_SECRET =
      "another-secret-that-is-at-least-32-chars-long";
    vi.resetModules();
    const fresh = await import("@/lib/strategy-share-token");
    const rotated = fresh.deriveShareToken(STRATEGY_ID, 1);
    expect(rotated).toBe("LyNkArYBehdxLiKDLhJG6HBK4Zhx9AJbMHXokXs7kzM");
    expect(rotated).not.toBe(deriveShareToken(STRATEGY_ID, 1));
  });
});

describe("cross-namespace separation from the scenario share token", () => {
  it("hashes the same input to a DIFFERENT value than the scenario module", () => {
    // Different primitive (keyed HMAC vs bare sha256), different encoding
    // (base64url vs hex). One namespace serving two resources is what would
    // make a cross-resource replay possible if either lookup ever loosened.
    const serialization = `${STRATEGY_ID}.1`;
    const strategyToken = deriveShareToken(STRATEGY_ID, 1);
    const scenarioDigest = hashShareToken(serialization);
    expect(strategyToken).not.toBe(scenarioDigest);
    // …and not merely because of the encoding: the underlying bytes differ too.
    expect(Buffer.from(strategyToken, "base64url").toString("hex")).not.toBe(
      scenarioDigest,
    );
  });

  it("a REAL scenario share token never verifies as a strategy token, despite an identical format", () => {
    // This is the replay attempt spelled out: `mintShareToken().raw` is also a
    // 43-char base64url string, so it sails through the format guard and is
    // rejected only by the MAC comparison.
    const { raw } = mintShareToken();
    expect(raw).toMatch(BASE64URL_43);
    expect(verifyShareToken(raw, STRATEGY_ID, 1)).toBe(false);
  });
});

describe("verifyShareToken", () => {
  it("accepts the token derived for the same (strategy, generation)", () => {
    expect(verifyShareToken(deriveShareToken(STRATEGY_ID, 4), STRATEGY_ID, 4)).toBe(
      true,
    );
  });

  it("rejects a token derived for a PREVIOUS generation (a revoked link stays dead)", () => {
    expect(verifyShareToken(deriveShareToken(STRATEGY_ID, 1), STRATEGY_ID, 2)).toBe(
      false,
    );
  });

  it("rejects a token derived for a different strategy", () => {
    const other = deriveShareToken("99999999-8888-7777-6666-555555555555", 1);
    expect(verifyShareToken(other, STRATEGY_ID, 1)).toBe(false);
  });

  it("rejects wrong-length and non-base64url input at the FORMAT GUARD, before any compare", () => {
    const valid = deriveShareToken(STRATEGY_ID, 1);
    // Too short / too long — `timingSafeEqual` THROWS on a length mismatch, so
    // reaching it with an unguarded input would be a 500, not a `false`.
    expect(verifyShareToken(valid.slice(0, 42), STRATEGY_ID, 1)).toBe(false);
    expect(verifyShareToken(`${valid}A`, STRATEGY_ID, 1)).toBe(false);
    expect(verifyShareToken("", STRATEGY_ID, 1)).toBe(false);
    // Correct length, illegal alphabet (`+` and `/` are base64, not base64url;
    // `.` and `%` are neither).
    expect(verifyShareToken("+".repeat(43), STRATEGY_ID, 1)).toBe(false);
    expect(verifyShareToken("/".repeat(43), STRATEGY_ID, 1)).toBe(false);
    expect(verifyShareToken(`${valid.slice(0, 42)}%`, STRATEGY_ID, 1)).toBe(false);
  });

  it("does not throw on hostile input — every rejection is a bare false", () => {
    for (const hostile of [
      "../../etc/passwd",
      "%00",
      "null",
      " ".repeat(43),
      "🙂".repeat(43),
    ]) {
      expect(() => verifyShareToken(hostile, STRATEGY_ID, 1)).not.toThrow();
      expect(verifyShareToken(hostile, STRATEGY_ID, 1)).toBe(false);
    }
  });
});

describe("SHARE_TOKEN_SECRET fails LOUD at module load (D-02)", () => {
  it("throws with a NAMED remedy when the secret is absent", async () => {
    delete process.env.SHARE_TOKEN_SECRET;
    vi.resetModules();
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(
      /SHARE_TOKEN_SECRET must be set/,
    );
  });

  it("the thrown message actually tells the operator what to DO (a bare 'invalid config' is the failure this replaces)", async () => {
    delete process.env.SHARE_TOKEN_SECRET;
    vi.resetModules();
    // Not decorative: the entire point of D-02 is that the founder does not
    // discover the misconfiguration by clicking Copy Link in production. An
    // error naming neither the remedy nor the rotation consequence would leave
    // them exactly as stuck as a silent failure.
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(/Vercel/);
    vi.resetModules();
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(
      /\.env\.local/,
    );
    vi.resetModules();
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(
      /revokes EVERY outstanding share link/,
    );
  });

  it("throws when the secret is present but SHORTER than the 32-char floor", async () => {
    process.env.SHARE_TOKEN_SECRET = "a".repeat(31);
    vi.resetModules();
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(
      /at least 32 characters/,
    );
  });

  it("accepts a secret at exactly the 32-char floor (the boundary is >=, not >)", async () => {
    process.env.SHARE_TOKEN_SECRET = "b".repeat(32);
    vi.resetModules();
    const fresh = await import("@/lib/strategy-share-token");
    expect(fresh.deriveShareToken(STRATEGY_ID, 1)).toMatch(BASE64URL_43);
  });
});
