import { createHmac } from "crypto";

import { describe, it, expect, afterEach, vi } from "vitest";

import { deriveShareToken, verifyShareToken } from "@/lib/strategy-share-token";
import { hashShareToken, mintShareToken } from "@/lib/scenario-share-token";

/**
 * Phase 164 / SHARE-01 — the strategy share-token contract (ruling D-02, as
 * amended by the founder ruling of 2026-08-27 that put a per-row nonce and a
 * domain tag into the MAC pre-image).
 *
 * What these pins protect, in order of how badly each failure would hurt:
 *
 *   1. DERIVABILITY. The token is re-derived from
 *      `(strategy_id, nonce, generation)` on every Copy Link, which is the ONLY
 *      way a second click can hand back the SAME URL. A hash-only-at-rest model
 *      (the scenario one) cannot do that, so it would silently break the
 *      recipient's existing link on every re-copy — the founder-hit defect
 *      wearing a different hat.
 *   2. REVOCATION. `generation` is the revocation mechanism WITHIN one row. If
 *      gen 1 and gen 2 ever produced the same token, `generation += 1` would
 *      revoke nothing and a "revoked" link would keep working.
 *   2b. DURABLE REVOCATION ACROSS ROW DESTRUCTION. `nonce` is what makes
 *      revocation survive the row being deleted and re-created — via the
 *      `strategies` ON DELETE CASCADE, an admin DELETE, or a route nobody has
 *      built yet. A re-created row restarts at generation 1, so `generation`
 *      cannot possibly distinguish it from the original; only the nonce can.
 *      Between them, 2 and 2b are the two assertions here with the largest
 *      blast radius. ⚠️ NEITHER IS SUFFICIENT ALONE, and neither is sufficient
 *      without the database half: the nonce closes nothing unless
 *      `strategy_shares` also denies clients any write naming it (migration
 *      20260827120000 STEP 2, pinned by SHAPE 3b / NONCE 1 / NONCE 2 in
 *      supabase/tests/test_strategy_shares_rls.sql). This file cannot see that,
 *      so do not read a green run here as "the nonce is doing its job".
 *   3. ALGORITHM STABILITY. A silent change to the hash, the encoding, the
 *      serialization separator, the DOMAIN TAG or the field ORDER invalidates
 *      EVERY outstanding link at once without anyone noticing until a recipient
 *      complains. The literal digest vectors are what make such a change go red
 *      at authoring time.
 *   4. CROSS-NAMESPACE REPLAY. A scenario share token is format-identical to a
 *      strategy one (both 43-char base64url). It must never verify here. The
 *      domain tag additionally protects against a FUTURE resource reusing the
 *      generically-named `SHARE_TOKEN_SECRET`.
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

/**
 * A fixed, obviously-synthetic per-row nonce (founder ruling 2026-08-27). In
 * production this is `gen_random_uuid()` on `strategy_shares.nonce`, returned by
 * `create_strategy_share` alongside the generation.
 */
const NONCE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** A SECOND nonce, standing in for the row a cascade-rebirth would create. */
const OTHER_NONCE = "ffffffff-0000-1111-2222-333333333333";

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
  it("matches a LITERAL precomputed vector (pins hash + encoding + separator + domain tag + field order)", () => {
    // HMAC-SHA256(
    //   FIXTURE_SECRET,
    //   `qz.strategy-share.v1.${STRATEGY_ID}.${NONCE}.1`,
    // ) → base64url.
    // Recomputed at the 2026-08-27 nonce ruling. The REASONING behind this
    // vector is unchanged — only the number moved, because the pre-image gained
    // a domain tag and a third field. A change to the algorithm, the digest
    // encoding, the `.` separator, the tag or the field ORDER must land here as
    // a failure; the alternative is every outstanding share link dying silently
    // on deploy.
    expect(deriveShareToken(STRATEGY_ID, NONCE, 1)).toBe(
      "B4G1sT0z_UKvu7TOdacGDY_TVi4kxNUZDufQZUvwyBg",
    );
  });

  it("the domain tag is INSIDE the MAC — an untagged pre-image derives something else entirely", () => {
    // Not a restatement of the vector above. The tag exists because
    // SHARE_TOKEN_SECRET is named generically: a future "portfolio share"
    // reusing it with its own `${uuid}.${uuid}.${int}` pre-image would have
    // collided with this one field-for-field and produced cross-resource replay.
    // This pins that the tag really participates, by exhibiting the digest the
    // UNTAGGED pre-image would have produced and asserting we do not emit it.
    const untagged = createHmac("sha256", FIXTURE_SECRET)
      .update(`${STRATEGY_ID}.${NONCE}.1`)
      .digest("base64url");
    expect(untagged).toBe("ncgZPhJnkfstjCJu4WsmGPCVqBnoZ8oA7e1dOSyRCBc");
    expect(deriveShareToken(STRATEGY_ID, NONCE, 1)).not.toBe(untagged);
  });

  it("returns a 43-char base64url token (the format the route guards on)", () => {
    const token = deriveShareToken(STRATEGY_ID, NONCE, 7);
    expect(token).toMatch(BASE64URL_43);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("is deterministic — the SAME inputs re-derive the SAME token (this is what makes Copy Link reuse a live link)", () => {
    expect(deriveShareToken(STRATEGY_ID, NONCE, 3)).toBe(
      deriveShareToken(STRATEGY_ID, NONCE, 3),
    );
  });

  it("generation 1 and generation 2 yield DIFFERENT tokens (this IS the revocation mechanism)", () => {
    const gen1 = deriveShareToken(STRATEGY_ID, NONCE, 1);
    const gen2 = deriveShareToken(STRATEGY_ID, NONCE, 2);
    expect(gen2).not.toBe(gen1);
    // Pin gen 2 literally too: if the counter ever stopped entering the
    // serialization, `not.toBe` alone could still pass by accident on some
    // future shape, but this cannot.
    expect(gen2).toBe("EhUUYMpM8XrjEvXpIkgrG3KZcy6IIeVfJTJSn3Cb3OA");
  });

  it("a different NONCE at the SAME generation yields a different token — this is what makes a re-created row's links dead", () => {
    // ⭐ THE ASSERTION WITH THE LARGEST BLAST RADIUS IN THIS FILE, after the
    // generation one. `strategy_shares.strategy_id` cascades from `strategies`,
    // and `strategies.id` is client-suppliable, so an owner can destroy their
    // share row and re-create it — and the re-created row is at generation 1
    // again, because the counter genuinely was discarded. Nothing about
    // `generation` can distinguish the two rows. The NONCE is the only thing
    // that does. If these two ever produced the same token, deleting and
    // re-creating a strategy would resurrect every link it had revoked.
    const original = deriveShareToken(STRATEGY_ID, NONCE, 1);
    const rebirth = deriveShareToken(STRATEGY_ID, OTHER_NONCE, 1);
    expect(rebirth).not.toBe(original);
    // Pinned literally for the same reason gen 2 is: if the nonce ever stopped
    // entering the serialization, `not.toBe` could still pass by accident on
    // some future shape — this cannot.
    expect(rebirth).toBe("Qm0NkqqKwWYPSj9-VQBGeofHZTUMFvQxGgdtSdhWF-w");
  });

  it("injectivity is a PRECONDITION on the field shapes — NOT a property of the separator", () => {
    // ⛔ THIS TEST WAS WRITTEN THE OTHER WAY ROUND FIRST, AND IT FAILED. The
    // first draft asserted that shifting a `.` between two fields could not
    // collide. It collides. `"a.b" + "." + "c"` and `"a" + "." + "b.c"` are the
    // SAME character sequence, so they are the same pre-image and the same
    // digest — verified below rather than described. A separator buys
    // injectivity ONLY over fields that cannot contain it, and stating that as
    // a property of `.` would have been exactly the kind of comfortable
    // hand-wave this pin exists to prevent.
    expect(deriveShareToken("a.b", "c", 1)).toBe(deriveShareToken("a", "b.c", 1));

    // ⇒ The safety of the real pre-image rests ENTIRELY on the field shapes,
    // so those are what get pinned. Both variable fields are uuids — hex digits
    // and hyphens, no `.` available — and every caller reads them straight out
    // of `strategy_shares`, where they are `uuid` columns.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const field of [STRATEGY_ID, NONCE, OTHER_NONCE]) {
      expect(field).toMatch(UUID_RE);
      expect(field).not.toContain(".");
    }

    // ⚠️ AND THE COUNTER MUST RENDER AS PLAIN DIGITS, which is the one field
    // whose interpolation could smuggle a `.` in. `String()` on a non-integer
    // does exactly that — the counterexample is asserted, not assumed. In the
    // database `generation` is BIGINT with CHECK (generation >= 1), only ever
    // written as `generation + 1`, so it cannot be fractional; if that ever
    // changes, this is the line that should stop being true.
    expect(String(1.5)).toContain(".");
    for (const g of [1, 2, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER]) {
      expect(String(g)).toMatch(/^\d+$/);
    }
  });

  it("a different strategy id yields a different token (the id is inside the MAC, not beside it)", () => {
    expect(
      deriveShareToken("99999999-8888-7777-6666-555555555555", NONCE, 1),
    ).not.toBe(deriveShareToken(STRATEGY_ID, NONCE, 1));
  });

  it("a DIFFERENT secret yields a different token — rotation is the PER-ENVIRONMENT kill-switch", async () => {
    // The secret is read once at module scope, so a fresh module registry is
    // the only honest way to exercise a second secret.
    //
    // ⭐ THIS IS ALSO THE PER-ENVIRONMENT-SECRET PROPERTY (founder ruling
    // 2026-08-27), not merely a rotation test. Production, Preview and
    // Development each hold a DISTINCT SHARE_TOKEN_SECRET, so a preview
    // deployment seeded from a production snapshot — same strategy_id, same
    // nonce, same generation, every row byte-identical — still cannot derive a
    // production-valid token. That is exactly the pair of derivations below.
    process.env.SHARE_TOKEN_SECRET =
      "another-secret-that-is-at-least-32-chars-long";
    vi.resetModules();
    const fresh = await import("@/lib/strategy-share-token");
    const rotated = fresh.deriveShareToken(STRATEGY_ID, NONCE, 1);
    expect(rotated).toBe("yFSKkpXZOsK56Z33eGDShAlGx4kf8CJHVNO1NoYLIlY");
    expect(rotated).not.toBe(deriveShareToken(STRATEGY_ID, NONCE, 1));
  });
});

describe("cross-namespace separation from the scenario share token", () => {
  it("hashes the same input to a DIFFERENT value than the scenario module", () => {
    // Different primitive (keyed HMAC vs bare sha256), different encoding
    // (base64url vs hex), and — since 2026-08-27 — a domain tag inside the
    // pre-image as well. One namespace serving two resources is what would make
    // a cross-resource replay possible if either lookup ever loosened.
    const serialization = `${STRATEGY_ID}.${NONCE}.1`;
    const strategyToken = deriveShareToken(STRATEGY_ID, NONCE, 1);
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
    expect(verifyShareToken(raw, STRATEGY_ID, NONCE, 1)).toBe(false);
  });
});

describe("verifyShareToken", () => {
  it("accepts the token derived for the same (strategy, generation)", () => {
    expect(verifyShareToken(
        deriveShareToken(STRATEGY_ID, NONCE, 4),
        STRATEGY_ID,
        NONCE,
        4,
      )).toBe(
      true,
    );
  });

  it("rejects a token derived for a PREVIOUS generation (a revoked link stays dead)", () => {
    expect(verifyShareToken(
        deriveShareToken(STRATEGY_ID, NONCE, 1),
        STRATEGY_ID,
        NONCE,
        2,
      )).toBe(
      false,
    );
  });

  it("rejects a token derived for a different strategy", () => {
    const other = deriveShareToken(
      "99999999-8888-7777-6666-555555555555",
      NONCE,
      1,
    );
    expect(verifyShareToken(other, STRATEGY_ID, NONCE, 1)).toBe(false);
  });

  it("rejects wrong-length and non-base64url input at the FORMAT GUARD, before any compare", () => {
    const valid = deriveShareToken(STRATEGY_ID, NONCE, 1);
    // Too short / too long — `timingSafeEqual` THROWS on a length mismatch, so
    // reaching it with an unguarded input would be a 500, not a `false`.
    expect(verifyShareToken(valid.slice(0, 42), STRATEGY_ID, NONCE, 1)).toBe(false);
    expect(verifyShareToken(`${valid}A`, STRATEGY_ID, NONCE, 1)).toBe(false);
    expect(verifyShareToken("", STRATEGY_ID, NONCE, 1)).toBe(false);
    // Correct length, illegal alphabet (`+` and `/` are base64, not base64url;
    // `.` and `%` are neither).
    expect(verifyShareToken("+".repeat(43), STRATEGY_ID, NONCE, 1)).toBe(false);
    expect(verifyShareToken("/".repeat(43), STRATEGY_ID, NONCE, 1)).toBe(false);
    expect(verifyShareToken(`${valid.slice(0, 42)}%`, STRATEGY_ID, NONCE, 1)).toBe(false);
  });

  it("does not throw on hostile input — every rejection is a bare false", () => {
    for (const hostile of [
      "../../etc/passwd",
      "%00",
      "null",
      " ".repeat(43),
      "🙂".repeat(43),
    ]) {
      expect(() => verifyShareToken(hostile, STRATEGY_ID, NONCE, 1)).not.toThrow();
      expect(verifyShareToken(hostile, STRATEGY_ID, NONCE, 1)).toBe(false);
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

  it("accepts a secret at exactly the 32-CHARACTER floor — and `bbbb…` is 32 characters, which is the honest limit of this check", async () => {
    // ⚠️ READ THE ASSERTION LITERALLY. This pins the boundary as `>=`, not `>`.
    // It does NOT pin that the secret is strong, and the input makes that
    // impossible to misread: `"b".repeat(32)` has essentially zero entropy and
    // is ACCEPTED. That is deliberate and is now stated in the module too — the
    // constant is a CHARACTER count, not the "256-bit HMAC key floor" its
    // comment used to claim.
    //
    // Why not enforce entropy instead: entropy is not measurable from a single
    // sample, so any runtime "entropy floor" would reject some good secrets and
    // accept most bad ones — theatre with a failure mode. The real control is
    // the operator instruction in SECRET_REMEDY (`openssl rand -base64 48`,
    // ≈288 bits), and this check's narrow job is to catch an empty or
    // placeholder value loudly at boot.
    process.env.SHARE_TOKEN_SECRET = "b".repeat(32);
    vi.resetModules();
    const fresh = await import("@/lib/strategy-share-token");
    expect(fresh.deriveShareToken(STRATEGY_ID, NONCE, 1)).toMatch(BASE64URL_43);
  });

  it("the remedy tells the operator to use a DISTINCT secret per environment (founder ruling 2026-08-27)", async () => {
    // Not decorative, and not a restatement of the `Vercel` arm above. The
    // previous guidance was to set ONE value across every environment, which
    // maximised the blast radius of a restore: a preview or branch database
    // seeded from a production snapshot could derive production-valid tokens,
    // because every MAC input in the row is copied verbatim. The ONLY mitigation
    // is that the environments hold different keys. If someone reverts the
    // docblock to "identical everywhere", this goes red.
    delete process.env.SHARE_TOKEN_SECRET;
    vi.resetModules();
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(
      /SEPARATE one per environment/,
    );
    vi.resetModules();
    await expect(import("@/lib/strategy-share-token")).rejects.toThrow(
      /do NOT reuse a single value/,
    );
  });
});
