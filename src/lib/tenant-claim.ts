import { createHmac } from "node:crypto";

/**
 * Phase 140.2-09 / TS-04 — THE `X-Tenant-Claim` mint. One implementation.
 *
 * Extracted verbatim (algorithm unchanged, so the wire bytes cannot move) from
 * `process-key-client.ts`, which held the only copy until this phase. The
 * extraction is the point: `analytics-client.ts` now mints the same header, and
 * two copies of an HMAC construction that must also agree with a THIRD
 * implementation in another language
 * (`analytics-service/services/rate_limit.py:verify_tenant_claim`) is the drift
 * class this programme exists to close.
 *
 * WIRE FORMAT `<payload>.<exp>.<hex-hmac-sha256>`, MAC over `"<payload>.<exp>"`,
 * key = `INTERNAL_API_TOKEN`. The verifying half parses with `rsplit(".", 2)`,
 * drops anything over 512 characters, rejects an expired `exp`, and compares
 * with `hmac.compare_digest`. The committed case table binding the two sides to
 * the same bytes is `tests/fixtures/tenant-claim-parity.json`.
 *
 * WHY THIS EXISTS AT ALL. `/process-key` used to be throttled by ONE 100/hour
 * bucket keyed on a hash of `INTERNAL_API_TOKEN` — a single shared platform
 * secret, so that was one window for every tenant at once.
 *
 * WHY NOT JUST `X-User-Id` (which is already sent alongside it). It is unsigned
 * client-controlled input. Bucketing on it lets any holder of the internal token
 * set a fresh uuid per request and bypass the limiter entirely, or set a
 * victim's uuid and drain their window (the PR#241 red-team finding). The HMAC
 * is what makes the same identifier trustworthy at the limiter, which is why the
 * Python key function deliberately ignores `X-User-Id` and reads only the claim.
 *
 * WHY NO NEW SECRET. `INTERNAL_API_TOKEN` is already the credential this seam
 * authenticates with and is already present on both sides, so the claim adds no
 * new trust surface: an attacker who has it already holds full `/process-key`
 * auth, and the limiter is not the marginal loss.
 *
 * ⚠️ SERVER-ONLY BY CONSTRUCTION. This module imports `node:crypto` and is
 * reached only from `process-key-client.ts` / `analytics-client.ts`, neither of
 * which is imported by any `"use client"` file. It is deliberately NOT one of
 * the dependency-free seam leaves (`seam-errors.ts`, `seam-discriminator.ts`,
 * `seam-redaction.ts`) — folding a `node:crypto` import into one of those would
 * break the purity guard that makes them bundle-safe.
 */

/**
 * How long a minted claim stays valid.
 *
 * Short on purpose. The claim is a bearer of tenant identity for the rate
 * limiter, so a value captured from a log line or an intermediary must not be a
 * permanent key to that tenant's window. Five minutes is far longer than the
 * request it accompanies and far shorter than anything worth stealing.
 *
 * Deliberately NOT exported. A test that imports this constant and asserts the
 * mint agrees with it asserts nothing — `src/lib/tenant-claim.test.ts` and
 * `tests/fixtures/tenant-claim-parity.json` both hand-type 300 instead.
 */
const TENANT_CLAIM_TTL_SECONDS = 300;

/**
 * Thrown when a claim CANNOT be minted honestly.
 *
 * A named class rather than a bare `Error` because the callers sit next to
 * transport code whose catch arms classify by error shape: `analytics-client`
 * maps aborts to `AnalyticsTimeoutError` and everything else to "service not
 * reachable". A mint refusal is neither — it is a configuration or programming
 * fault on OUR side, and reporting it as a dead upstream is exactly the silent
 * degradation these guards exist to prevent. (Both call sites mint OUTSIDE their
 * transport `try` for the same reason.)
 */
/**
 * A SERVER-DERIVED tenant identity, threaded from a route handler to a seam
 * wrapper so the wrapper can mint a claim over it.
 *
 * WHY AN OBJECT AND NOT A BARE `userId: string`. On `validateKey` / `encryptKey`
 * the identity parameter sits directly beside `passphrase` — two adjacent
 * `string`s where a transposition compiles cleanly and mints the claim over a
 * USER-CHOSEN SECRET: a credential in an outbound header, and every caller
 * silently sharing one bucket keyed on it. That is threat T-140.2-09-02 with the
 * compiler unable to help. A one-field object cannot be confused with a
 * credential, so the mistake becomes a type error instead of a leak.
 *
 * The wrappers that already carried an identity before this phase keep their
 * existing `actorId` / `userId` string parameters — enumerated rather than
 * counted, because the sentence that stood here said "the THREE wrappers" and
 * then listed FIVE names, which is the defect class 140.5 exists to close
 * (verified at HEAD, 2026-07-29, each signature read):
 * `computePortfolioAnalytics`, `runPortfolioOptimizer`,
 * `findReplacementCandidates`, `simulateAddCandidate`, `recomputeMatch`. Those
 * are pre-existing signatures with no adjacent secret, and churning them would
 * be scope creep.
 *
 * The wrappers that DO take this type are `validateKey`, `encryptKey`,
 * `optimizeScenarioWeights` and `evalMatch` — so the interface is applied, not
 * merely declared. (`140.5-RESEARCH` §11 recorded it as "exists and is NOT
 * applied"; that was measured against `mintTenantClaim` alone and does not hold
 * of the file.) As of 140.5-07 `mintTenantClaim` itself takes it too, which is
 * what makes the transposition uncompilable rather than merely discouraged.
 */
export interface TenantIdentity {
  /**
   * The authenticated `user.id` from the route's server session — never a
   * value the caller supplied, and never `X-User-Id` (which is unsigned client
   * input the Python limiter deliberately ignores).
   *
   * ONE server-side literal is also admitted: `"public"`, the anonymous teaser
   * bucket. `verify-strategy`'s route passes it through `postProcessKey`'s
   * `userId` field so all unauthenticated traffic shares a window isolated from
   * every authenticated tenant. It is a constant in OUR source, not a value that
   * arrived over the wire, so it satisfies "server-derived" in the sense that
   * matters here.
   */
  readonly userId: string;
}

export class TenantClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantClaimError";
  }
}

/**
 * Mint the `X-Tenant-Claim` the Python limiter buckets on.
 *
 * ⚠️ THE FIRST PARAMETER IS AN OBJECT, AND THAT IS THE WHOLE POINT (140.5-07 /
 * SEAMPROSE-05, closing WP-13's F5). This function used to read
 * `mintTenantClaim(payload: string, secret: string)` — two ADJACENT SAME-TYPED
 * strings, one of which is the platform secret. Transposing them compiled
 * cleanly and passed all three guards below (`INTERNAL_API_TOKEN` is non-empty
 * and dot-free, and a `user.id` is a non-empty "secret"), so the mint returned
 * `<INTERNAL_API_TOKEN>.<exp>.<mac-keyed-by-userId>` and both call sites put
 * that value into an outbound header. Wrapping the identity in a ONE-FIELD
 * OBJECT makes the transposition a TYPE ERROR instead: a `string` is not
 * assignable to `TenantIdentity`, at every call site that exists and every one
 * that does not yet — the compiler enforces it with no per-site edit.
 *
 * ⚠️ LATENT, NOT LIVE, AND DO NOT OVERSTATE IT. Both mint sites pass
 * server-derived values today (`postProcessKey`'s `args.userId` from `withAuth`,
 * and `analyticsRequest`'s `options.tenantId`), so no transposition is on the
 * wire and none ever was. This is a type hazard closed at the signature, not an
 * exploited path. Recorded at that severity deliberately: RESEARCH §11 measured
 * it, and inflating it would be the security theatre this programme rejects.
 *
 * The reciprocal shape — `mintTenantClaim({ userId: theSecret }, theUserId)` —
 * still compiles, and no type can prevent it. What the object buys is that the
 * mistake now has to be WRITTEN OUT rather than committed by getting two bare
 * arguments in the wrong order. That is the same bound `PostProcessKeyArgs`
 * accepts for the identical reason.
 *
 * @param identity - the SERVER-DERIVED tenant identity. Never a caller-supplied
 *   value — `tenant_or_platform_key` returns `<scope>:t:<userId>` with the field
 *   VERBATIM, so a caller who controls it controls which window they spend.
 * @param secret - `INTERNAL_API_TOKEN`, read at CALL time by the caller.
 *
 * @throws {TenantClaimError} on an empty/whitespace-only payload, a payload
 *   containing a `.`, or an absent/empty secret. All three are LOUD on purpose;
 *   see the individual guards.
 */
export function mintTenantClaim(identity: TenantIdentity, secret: string): string {
  // Read through an optional chain rather than a bare `identity.userId`. The
  // TYPE says this cannot be nullish, and from TypeScript it cannot — but the
  // three guards below are the fail-loud contract this module is FOR, and a
  // JavaScript caller (or an `as unknown as` in a test) passing nothing would
  // otherwise raise a bare TypeError instead of the named TenantClaimError the
  // callers' catch arms classify on. GUARD 1 absorbs it.
  const payload: string = identity?.userId;

  // GUARD 1 — an empty payload is the worst possible success. It mints a claim
  // that verifies perfectly and buckets EVERY caller to `<scope>:t:`, i.e. one
  // shared window wearing the costume of per-tenant isolation. 140.1's
  // mutation #3 is the receipt: `default_platform_key` returning an empty string
  // makes slowapi skip limiting entirely, and it shipped GREEN against an
  // identity assertion. Refuse rather than mint.
  if (typeof payload !== "string" || payload.trim() === "") {
    throw new TenantClaimError(
      "X-Tenant-Claim: refusing to mint over an empty tenant payload — " +
        "an empty payload buckets every caller together, which is worse than no claim at all.",
    );
  }

  // GUARD 2 — the Python parse is `rsplit(".", 2)`, which is dot-TOLERANT by
  // design so the format stays unambiguous. That tolerance is not a licence: a
  // dotted payload reaches `<scope>:t:<payload>` with its dots intact, and a
  // future non-UUID identifier could then be crafted to collide with another
  // tenant's key. Every real payload today is a dot-free UUID or the literal
  // "public"; hold that property at the boundary rather than hoping.
  if (payload.includes(".")) {
    throw new TenantClaimError(
      "X-Tenant-Claim: refusing to mint a payload containing '.' — " +
        "the verifier parses with rsplit('.', 2) and the payload reaches the bucket key verbatim.",
    );
  }

  // GUARD 3 — THE dangerous absence. An empty secret still produces a
  // syntactically valid claim; it just fails `compare_digest` on every request,
  // so every route silently stays on `platform:<path>` with no error anywhere
  // and SC7 no-ops in production while every test passes. RESEARCH A3 could not
  // confirm `INTERNAL_API_TOKEN` is present in the Vercel production env, so
  // this is the one guard standing between a missing env var and an invisible
  // regression. The message names the variable and never echoes its value.
  if (typeof secret !== "string" || secret === "") {
    throw new TenantClaimError(
      "X-Tenant-Claim: INTERNAL_API_TOKEN is not configured — refusing to mint an " +
        "unverifiable claim, which would silently leave this route on a platform-wide bucket.",
    );
  }

  const exp = Math.floor(Date.now() / 1000) + TENANT_CLAIM_TTL_SECONDS;
  const signed = `${payload}.${exp}`;
  const mac = createHmac("sha256", secret).update(signed).digest("hex");
  return `${signed}.${mac}`;
}
