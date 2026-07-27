/**
 * Phase 140.2-09 / TS-04 — the ONE `X-Tenant-Claim` mint.
 *
 * WHAT THIS FILE IS FOR. `src/lib/tenant-claim.ts` is the single HMAC
 * construction behind the header the Python rate limiter buckets on
 * (`analytics-service/services/rate_limit.py:verify_tenant_claim`). It was
 * extracted here from `process-key-client.ts`, which had the only copy; a second
 * copy in `analytics-client.ts` would have been two implementations of a wire
 * format that has to agree with a THIRD implementation in another language.
 *
 * ORACLE DISCIPLINE (the rule this whole programme exists to enforce). Every
 * expected MAC below is either
 *   (a) recomputed IN THIS FILE with `node:crypto`'s `createHmac`, or
 *   (b) read from `tests/fixtures/tenant-claim-parity.json`, whose values were
 *       computed once by a standalone `node -e` process.
 * Nothing on the expected side is imported from the module under test, and there
 * is no `vi.mock` of it. An oracle that asks the code under test what it expects
 * cannot fail — that is exactly how 140.1's mutation #3 (`default_platform_key`
 * returning an empty string, which makes slowapi skip limiting ENTIRELY) shipped
 * green against an identity assertion.
 *
 * WHY THE REFUSALS ARE TESTED AS HARD AS THE HAPPY PATH. `tenant_or_platform_key`
 * returns `<scope>:t:<payload>` with the payload VERBATIM. A claim minted over an
 * empty payload therefore collapses every caller into ONE bucket while looking,
 * from every log line and every `toBeDefined()` assertion, exactly like working
 * per-tenant isolation. Silence is the dangerous default here, so absence of a
 * payload and absence of a secret are both loud.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mintTenantClaim, TenantClaimError } from "./tenant-claim";

/** The independent oracle. Same algorithm, written out by hand. */
function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * The TTL, HAND-TYPED. Deliberately not imported: importing the constant would
 * make this assertion "the module agrees with itself", which is true of every
 * value it could possibly hold. 300 seconds is far longer than the request the
 * claim accompanies and far shorter than anything worth stealing out of a log.
 */
const EXPECTED_TTL_SECONDS = 300;

interface ParityCase {
  name: string;
  why: string;
  payload: string;
  secret: string;
  exp: number;
  claim: string;
}
const FIXTURE = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/tenant-claim-parity.json"),
    "utf8",
  ),
) as { ttl_seconds: number; cases: ParityCase[] };

afterEach(() => {
  vi.useRealTimers();
});

describe("[140.2-09 / TS-04] mintTenantClaim — wire format", () => {
  it("produces `<payload>.<exp>.<hmac>` whose MAC verifies under an HMAC computed here", () => {
    const claim = mintTenantClaim("user-42", "internal-test-token");

    // rsplit-compatible: the Python side splits on the LAST two dots.
    const parts = claim.split(".");
    expect(parts).toHaveLength(3);
    const [payload, exp, mac] = parts;

    expect(payload).toBe("user-42");
    expect(mac).toBe(hmacHex("internal-test-token", `${payload}.${exp}`));

    // The secret is the HMAC key, never the payload and never the wire value.
    expect(claim).not.toContain("internal-test-token");
    // 512 is `_CLAIM_MAX_CHARS` in rate_limit.py — a longer claim is dropped
    // wholesale and the caller silently falls back to the platform bucket.
    expect(claim.length).toBeLessThanOrEqual(512);
  });

  it("mints an exp exactly TTL seconds ahead of a STUBBED clock (crypto untouched)", () => {
    // Fixed clock, real crypto. Stubbing the crypto instead would test nothing:
    // the MAC is the half that has to agree with another language.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    const claim = mintTenantClaim("user-42", "internal-test-token");
    const exp = Number(claim.split(".")[1]);

    expect(exp).toBe(1_700_000_000 + EXPECTED_TTL_SECONDS);
  });

  it("mints an EXACT claim string under a fixed clock", () => {
    vi.useFakeTimers();
    // now = exp - TTL, so the mint's own `floor(now/1000) + 300` lands on 1900000000.
    vi.setSystemTime(new Date((1_900_000_000 - EXPECTED_TTL_SECONDS) * 1000));

    expect(
      mintTenantClaim("11111111-2222-3333-4444-555555555555", "internal-test-token"),
    ).toBe(
      "11111111-2222-3333-4444-555555555555.1900000000.b6c8871017dcf8dd2410083e6f00536bb251f1fd7fe7880072c875c4ddd323b5",
    );
  });

  it("two DIFFERENT payloads on the SAME clock and secret produce DIFFERENT claims", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((2_524_608_300 - EXPECTED_TTL_SECONDS) * 1000));

    const a = mintTenantClaim("tenant-a", "internal-test-token");
    const b = mintTenantClaim("tenant-b", "internal-test-token");

    expect(a).not.toBe(b);
    // Not merely different STRINGS — different MACs. Two claims that differed
    // only in their payload prefix while sharing a MAC would both fail
    // `compare_digest` and both fall back to the platform bucket.
    expect(a.split(".")[2]).not.toBe(b.split(".")[2]);
  });

  it("the SAME payload under two different secrets produces two different MACs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    const withReal = mintTenantClaim("user-42", "internal-test-token");
    const withWrong = mintTenantClaim("user-42", "ANALYTICS_SERVICE_KEY-value");

    // This is the M44 shape: minting with the WRONG env secret still produces a
    // syntactically perfect claim. Only the MAC tells the two apart, which is
    // why the verification above recomputes it rather than pattern-matching.
    expect(withReal.split(".")[2]).not.toBe(withWrong.split(".")[2]);
  });
});

describe("[140.2-09 / TS-04] mintTenantClaim — the four fail-loud refusals", () => {
  it("REFUSES an empty payload rather than minting a claim over nothing", () => {
    // A claim over "" verifies fine and buckets every caller to `<scope>:t:` —
    // one shared window wearing the costume of per-tenant isolation.
    expect(() => mintTenantClaim("", "internal-test-token")).toThrow(
      TenantClaimError,
    );
  });

  it("REFUSES a whitespace-only payload", () => {
    expect(() => mintTenantClaim("   ", "internal-test-token")).toThrow(
      TenantClaimError,
    );
    expect(() => mintTenantClaim("\t\n", "internal-test-token")).toThrow(
      TenantClaimError,
    );
  });

  it("REFUSES a payload containing a dot (the Python parse is rsplit-ambiguous)", () => {
    // `verify_tenant_claim` uses `rsplit(".", 2)` precisely so a dotted payload
    // still parses — but the payload then reaches `<scope>:t:<payload>` with the
    // dots in it, and a future non-UUID identifier could collide with another
    // tenant's claim tail. Refuse at the mint while every real payload is a
    // dot-free UUID (or the literal "public").
    expect(() => mintTenantClaim("user.42", "internal-test-token")).toThrow(
      TenantClaimError,
    );
  });

  it("REFUSES an absent or empty secret rather than minting an unverifiable claim", () => {
    // THE dangerous one. An empty secret yields a syntactically valid claim that
    // fails `compare_digest` on every request, so every route silently stays on
    // `platform:<path>` with no error anywhere. RESEARCH A3: it could not be
    // confirmed that INTERNAL_API_TOKEN is set in the Vercel production env.
    expect(() => mintTenantClaim("user-42", "")).toThrow(TenantClaimError);
    expect(() =>
      mintTenantClaim("user-42", undefined as unknown as string),
    ).toThrow(TenantClaimError);
  });

  it("names the error so a caller can tell a mint refusal from a transport failure", () => {
    let caught: unknown;
    try {
      mintTenantClaim("", "internal-test-token");
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).name).toBe("TenantClaimError");
    // The message must never echo the secret.
    expect((caught as Error).message).not.toContain("internal-test-token");
  });
});

describe("[140.2-09 / TS-04] the committed cross-language parity fixture", () => {
  it("pins the TTL the fixture's exp values were derived from", () => {
    expect(FIXTURE.ttl_seconds).toBe(EXPECTED_TTL_SECONDS);
  });

  it("has cases (a fixture that silently emptied would vacuously pass every case below)", () => {
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(4);
  });

  it.each(FIXTURE.cases)(
    "round-trips fixture case $name through the shipped mint",
    ({ payload, secret, exp, claim }: ParityCase) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date((exp - EXPECTED_TTL_SECONDS) * 1000));

      expect(mintTenantClaim(payload, secret)).toBe(claim);
    },
  );

  it.each(FIXTURE.cases)(
    "fixture case $name is internally consistent under an independently computed HMAC",
    ({ payload, secret, exp, claim }: ParityCase) => {
      // Guards the fixture itself: a hand-edited `claim` that no longer matches
      // its own payload/exp/secret would otherwise turn the round-trip above
      // into a pin on a typo.
      expect(claim).toBe(
        `${payload}.${exp}.${hmacHex(secret, `${payload}.${exp}`)}`,
      );
    },
  );
});
