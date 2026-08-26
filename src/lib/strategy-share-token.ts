import { createHmac, timingSafeEqual } from "crypto";

/**
 * Derive and verify revocable per-strategy share tokens (phase 164, ruling D-02).
 *
 *   token = HMAC-SHA256(SHARE_TOKEN_SECRET, `${strategy_id}.${generation}`)
 *           encoded base64url → 43 chars
 *
 * ⛔ THIS IS A **STATEFUL** KEYED MAC, AND THE DISTINCTION IS LOAD-BEARING.
 * `src/lib/scenario-share-token.ts:10-12` documents a rejection of "the
 * keyed-MAC model of `demo-pdf-token.ts`" because a *stateless* MAC cannot be
 * revoked. That reasoning is correct and is NOT contradicted here: the
 * revocation mechanism in this model is the stored `generation` counter, not
 * the MAC. Bumping `strategy_shares.generation` changes the derived token, so
 * every previously-copied link stops verifying — one atomic increment, and
 * double-revoke converges instead of erroring.
 *
 * ⛔ SEPARATE MODULE FROM `scenario-share-token.ts` ON PURPOSE. Do not import
 * it, do not extend it, do not "unify" them. Its test pins its digest to a
 * literal vector, and one token namespace serving two resources invites
 * cross-resource replay the moment either lookup loosens. The cross-namespace
 * divergence is pinned in `strategy-share-token.test.ts`.
 *
 * WHY NOTHING TOKEN-DERIVED IS STORED. The table holds
 * `(strategy_id, generation, revoked_at)` and never a token, raw or hashed.
 * Storing the raw token would make the database itself a disclosure surface (a
 * backup, a log line, a support query, a future RLS mistake all hand out
 * working links). Storing only a HASH — the scenario model — makes the raw
 * token unrecoverable, so every Copy Link would have to MINT a new one and
 * silently break the recipient's existing link. Re-derivability is the reuse
 * requirement, stated precisely.
 *
 * ⚠️ ROTATION IS A GLOBAL KILL-SWITCH, BY DESIGN. Changing
 * `SHARE_TOKEN_SECRET` changes every derived MAC at once, so every outstanding
 * share link stops working immediately. That is the intended emergency lever,
 * not a bug — but it is also why the value must be set identically across every
 * Vercel environment rather than per-environment by accident.
 *
 * ⚠️ D-07 REVISIT THRESHOLD — RECORDED, NOT LEFT IMPLICIT. A pure MAC carries
 * no lookup key and nothing token-derived is at rest, so the recipient route
 * cannot do an indexed equality lookup: it scans ACTIVE share rows and
 * `timingSafeEqual`-compares, rate-limited before any DB or crypto work.
 * `UNIQUE(strategy_id)` caps that at one active row per strategy. Today the
 * active-share count is 0. **Revisit when active (non-revoked) `strategy_shares`
 * rows exceed 1,000.** The O(1) alternative is a self-locating token
 * (`<share_row_id>.<mac>`); it EXTENDS the token format beyond the founder
 * formula and therefore needs founder sign-off — do not adopt it silently.
 */

const MIN_SECRET_LENGTH = 32; // 256-bit HMAC key floor (demo-pdf's 16 is the weaker precedent)

/**
 * The remedy text. Extracted so the module-load throw and any future boot check
 * cannot drift into telling an operator two different things.
 */
const SECRET_REMEDY =
  "SHARE_TOKEN_SECRET must be set to a string of at least " +
  `${MIN_SECRET_LENGTH} characters. Remedy: generate one locally ` +
  "(`openssl rand -base64 48`), add it in Vercel → Settings → Environment " +
  "Variables for ALL environments and redeploy, and set it in .env.local for " +
  "local dev. ⚠️ Rotating this value revokes EVERY outstanding share link.";

/**
 * ⛔ MODULE-SCOPE VALIDATION — THIS IS THE D-02 HARD STOP.
 *
 * The founder ruling is explicit that a missing secret must fail at module load
 * / boot, NOT at first share. `demo-pdf-token.ts` validates lazily inside its
 * signer, which is exactly the silent-prod-misconfig class this phase exists to
 * remove: the failure would surface as a founder clicking Copy Link in
 * production and getting nothing useful.
 *
 * The read is a LITERAL `process.env.SHARE_TOKEN_SECRET` rather than an indexed
 * `process.env[SECRET_ENV]` so the env-manifest contract gate
 * (`src/__tests__/contracts/env-manifest.test.ts`) can DISCOVER it — a computed
 * read is invisible to that grep and would have to be parked in its
 * INDIRECT_READS exemption, which is how a key stops being enforced.
 *
 * BLAST RADIUS, honestly stated: a throw here fails every module that imports
 * this one — the recipient token page, the mint route, the revoke route, and
 * the owner-lane share-state read. It does NOT take down unrelated routes.
 * Tests set a fixture value in `src/test-setup.ts` before the env snapshot.
 */
function readSecretOrThrow(): string {
  const secret = process.env.SHARE_TOKEN_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(SECRET_REMEDY);
  }
  return secret;
}

const SECRET = readSecretOrThrow();

/**
 * The pinned serialization: `${strategyId}.${generation}`.
 *
 * The founder formula is `strategy_id || generation`; the `.` separator is the
 * concrete choice. UUIDs are fixed-width so concatenation could not actually be
 * ambiguous, but an explicit separator costs nothing and survives a future id
 * shape that is not fixed-width. `strategy-share-token.test.ts` pins the
 * resulting digest to a literal vector, so changing this string — or the
 * encoding, or the hash — goes RED rather than silently invalidating every
 * outstanding link.
 */
function serialize(strategyId: string, generation: number): string {
  return `${strategyId}.${generation}`;
}

/**
 * Derive the share token for a strategy at a given generation.
 *
 * Deterministic: the same `(strategyId, generation)` always yields the same
 * token, which is what makes Copy Link REUSE a live link instead of minting a
 * new one and breaking the recipient's existing URL.
 */
export function deriveShareToken(
  strategyId: string,
  generation: number,
): string {
  return createHmac("sha256", SECRET).update(serialize(strategyId, generation)).digest("base64url");
}

/** 32-byte base64url digest, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Constant-time verification of a presented token against ONE candidate row.
 *
 * ORDER IS LOAD-BEARING: the format guard runs FIRST, so a malformed or
 * wrong-length input is rejected before any buffer is built. That also
 * guarantees both buffers are exactly 43 bytes by the time `timingSafeEqual`
 * is reached — the function throws on a length mismatch, and the demo-pdf
 * precedent (`demo-pdf-token.ts:95-97`) is the same validate-before-Buffer
 * discipline.
 *
 * Returns a bare boolean and NEVER the failure reason: a caller must not be
 * able to distinguish "malformed" from "wrong generation" from "no such row".
 */
export function verifyShareToken(
  presented: string,
  strategyId: string,
  generation: number,
): boolean {
  if (!TOKEN_RE.test(presented)) return false;
  const expected = deriveShareToken(strategyId, generation);
  // Lengths are equal by construction (regex above pins 43; the digest is
  // always 43), so this cannot throw on a length mismatch.
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
