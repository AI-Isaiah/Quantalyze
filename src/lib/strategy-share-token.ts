import { createHmac, timingSafeEqual } from "crypto";

/**
 * Derive and verify revocable per-strategy share tokens (phase 164, ruling D-02,
 * as amended by the founder ruling of 2026-08-27).
 *
 *   token = HMAC-SHA256(
 *             SHARE_TOKEN_SECRET,
 *             `qz.strategy-share.v1.${strategy_id}.${nonce}.${generation}`,
 *           ) encoded base64url → 43 chars
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
 * ⭐ THE NONCE IS WHAT MAKES REVOCATION SURVIVE ROW DESTRUCTION, and it is not
 * an optional hardening. `generation` alone is a claim ABOUT A ROW: "this
 * counter advanced". `strategy_shares.strategy_id` carries ON DELETE CASCADE
 * from `strategies`, and `strategies.id` is client-suppliable — so an owner
 * could delete their strategy, re-create it at the SAME uuid, re-mint, and
 * receive a BIT-IDENTICAL token to one they had revoked (MEASURED on a
 * PostgreSQL 16 cluster, 2026-08-27). No database control on `strategy_shares`
 * can even observe that delete. The per-row `nonce` — server-generated,
 * unguessable, immutable, never in the URL — turns the claim into "you hold a
 * token minted against THIS row", which a re-created row cannot satisfy because
 * it draws a fresh `gen_random_uuid()`. The whole delete-and-recreate family
 * dies at once, rather than one enumerated path at a time.
 *
 * ⛔ THE NONCE IS USELESS WITHOUT `REVOKE INSERT(nonce)` IN THE DATABASE.
 * Migration 20260827120000 STEP 2 grants `authenticated` INSERT on
 * (strategy_id, created_by) and UPDATE on (revoked_at, generation) — nothing
 * else. Without those column-scoped grants an owner reads their own nonce under
 * RLS, cascades the row away, and re-inserts it verbatim; the nonce comes back
 * bit-identical and the attack reproduces WITH the nonce in hand (MEASURED both
 * directions). If you are reading this file to change the pre-image, read that
 * STEP 2 first — the two are one mechanism.
 *
 * ⛔ DOMAIN SEPARATION IS PART OF THE PRE-IMAGE, not decoration. The env var is
 * named generically (`SHARE_TOKEN_SECRET`), and the pre-image previously carried
 * no tag at all — so a future "portfolio share" reusing the same secret with its
 * own `${uuid}.${int}` shape would have collided with this one and produced
 * cross-resource replay. `qz.strategy-share.v1.` costs nothing and closes it.
 * The `v1` is there so a future pre-image change can be a NEW tag rather than a
 * silent reinterpretation of the old one.
 *
 * ⭐ INJECTIVITY IS CONDITIONAL, and the condition is the whole argument. The
 * pre-image is `qz.strategy-share.v1.${strategyId}.${nonce}.${generation}`. A
 * separator buys injectivity ONLY over fields that cannot contain it — it is
 * NOT a property of `.` itself. MEASURED: `deriveShareToken("a.b", "c", 1)` and
 * `deriveShareToken("a", "b.c", 1)` produce the IDENTICAL token, because they
 * are the identical character sequence. The test pins that collision on purpose.
 *
 * The condition holds here because every field is `.`-free by construction:
 * `strategyId` and `nonce` are uuids (hex digits and hyphens), and `generation`
 * is a BIGINT with `CHECK (generation >= 1)` that renders as plain digits. Under
 * that condition the split is unambiguous, so no two distinct
 * `(strategy, row, generation)` states can share a token.
 *
 * ⚠️ A CALLER PASSING AN UNVALIDATED STRING WOULD BREAK IT. Every caller reads
 * these values straight out of `strategy_shares`, which is why `serialize` is
 * module-private and why the exported functions are shaped to be filled from a
 * row rather than from a request. Do not add an overload that takes a
 * user-supplied identifier.
 *
 * WHY NOTHING TOKEN-DERIVED IS STORED. The table holds
 * `(strategy_id, generation, nonce, revoked_at)` and never a token, raw or
 * hashed. ⚠️ The nonce is a MAC INPUT, not a token: it derives nothing without
 * the secret, which is not in the database.
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
 * not a bug.
 *
 * ⛔ EACH VERCEL ENVIRONMENT GETS A **DISTINCT** SECRET (founder ruling,
 * 2026-08-27). An earlier version of this docblock said the opposite — "set it
 * identically across every environment" — and that instruction was actively
 * harmful, so it is corrected rather than softened.
 *
 * WHY. Every stored-state revocation scheme, this one included, is defeated by a
 * restore of its own store: a point-in-time restore or a Supabase branch
 * database brings back the authoritative rows — nonce, generation and all — so
 * links revoked after the restore point become live again. Nothing in-database
 * fixes that; hash-at-rest does not survive it either, and neither would an
 * append-only design, because the restore rolls the appends back too. The one
 * real mitigation is operational: if preview, branch and production hold
 * DIFFERENT secrets, then a preview environment seeded from a production
 * snapshot physically CANNOT derive production-valid tokens, however faithful
 * the data copy is. With one shared secret, every branch database is a token
 * factory for production.
 *
 * ⚠️ THE CONSEQUENCE, STATED HONESTLY BECAUSE IT WILL SURPRISE SOMEONE. A share
 * link minted in preview will NOT resolve in production, and vice versa. It will
 * 410 like any unknown token, with no diagnostic distinguishing "wrong
 * environment" from "revoked" — deliberately, since the recipient lane must not
 * be an oracle. That is correct behaviour: a preview link SHOULD be worthless in
 * production. Expect at least one confused bug report, and answer it with this
 * paragraph rather than by unifying the secrets.
 *
 * ⚠️ AND IT MAKES ROTATION PER-ENVIRONMENT TOO: rotating production's secret
 * kills production's links and leaves preview's alone. That is a feature (a
 * smaller blast radius) and a trap (rotating the wrong environment looks like it
 * did nothing). Rotating is also the documented step in any restore runbook.
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

/**
 * ⚠️ A **CHARACTER-COUNT** FLOOR, NOT AN ENTROPY FLOOR — and the comment used to
 * claim otherwise ("256-bit HMAC key floor"), which was false in a way that
 * mattered. The check below is `secret.length < 32` on a JS string, so
 * `"b".repeat(32)` passes with roughly zero entropy, and the test suite PINS
 * that it passes (the `>=`-not-`>` boundary arm). Even read as bytes the claim
 * would be wrong for any non-ASCII secret, where 32 UTF-16 code units is not 32
 * bytes.
 *
 * It is left as a length floor DELIBERATELY, with the comment corrected instead:
 * a length check is the only property a runtime can actually verify — entropy is
 * not measurable from a single sample, so any "entropy floor" here would be
 * theatre that rejects some good secrets and accepts most bad ones. The real
 * control is the operator instruction in SECRET_REMEDY below, which names
 * `openssl rand -base64 48` (≈288 bits, 64 characters). This constant's job is
 * narrow and honest: catch an EMPTY or obviously-placeholder value at boot,
 * loudly, before anyone mints a link with it.
 */
const MIN_SECRET_LENGTH = 32; // characters, not bytes and not bits (demo-pdf's 16 is the weaker precedent)

/**
 * The remedy text. Extracted so the module-load throw and any future boot check
 * cannot drift into telling an operator two different things.
 */
const SECRET_REMEDY =
  "SHARE_TOKEN_SECRET must be set to a string of at least " +
  `${MIN_SECRET_LENGTH} characters. Remedy: generate a SEPARATE one per ` +
  "environment (`openssl rand -base64 48`), add each in Vercel → Settings → " +
  "Environment Variables scoped to that ONE environment (Production, Preview " +
  "and Development each get their own — do NOT reuse a single value, or a " +
  "preview deploy seeded from a production snapshot could derive " +
  "production-valid links), and set another in .env.local for local dev. " +
  "⚠️ Rotating this value revokes EVERY outstanding share link in that " +
  "environment.";

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
 * The domain-separation tag. Its own constant so the test can pin it by name
 * rather than by re-typing the literal, and so a future second share resource
 * has an obvious place to declare a DIFFERENT one.
 *
 * ⛔ Changing this string invalidates every outstanding link, exactly like
 * rotating the secret. If a future pre-image change is needed, bump `v1` to
 * `v2` rather than reinterpreting `v1` — the version is here so the two eras
 * are distinguishable instead of silently overlapping.
 */
const DOMAIN_TAG = "qz.strategy-share.v1";

/**
 * The pinned serialization:
 * `qz.strategy-share.v1.${strategyId}.${nonce}.${generation}`.
 *
 * The founder formula is `tag || strategy_id || nonce || generation`; the `.`
 * separator is the concrete choice, and with three variable fields it is now
 * load-bearing rather than cosmetic.
 *
 * ⭐ INJECTIVE **GIVEN THE FIELD SHAPES** — see the module docblock for the
 * measured demonstration that `.` alone buys nothing. Fields are `.`-free by
 * construction (two uuids and a positive BIGINT), which is what makes the split
 * recoverable and the mapping injective. This function is module-private
 * precisely so that condition cannot be violated by a caller.
 *
 * `strategy-share-token.test.ts` pins the resulting digest to literal vectors,
 * so changing this string — the tag, the separator, the field order, the
 * encoding or the hash — goes RED at authoring time rather than silently
 * invalidating every outstanding link on deploy.
 */
function serialize(
  strategyId: string,
  nonce: string,
  generation: number,
): string {
  return `${DOMAIN_TAG}.${strategyId}.${nonce}.${generation}`;
}

/**
 * Derive the share token for a strategy's share ROW at a given generation.
 *
 * Deterministic: the same `(strategyId, nonce, generation)` always yields the
 * same token, which is what makes Copy Link REUSE a live link instead of minting
 * a new one and breaking the recipient's existing URL. Both `nonce` and
 * `generation` come from the SAME row — `create_strategy_share` returns them
 * together for exactly that reason. Pairing a nonce from one row with a
 * generation from another is meaningless and would simply fail to verify.
 */
export function deriveShareToken(
  strategyId: string,
  nonce: string,
  generation: number,
): string {
  return createHmac("sha256", SECRET)
    .update(serialize(strategyId, nonce, generation))
    .digest("base64url");
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
  nonce: string,
  generation: number,
): boolean {
  if (!TOKEN_RE.test(presented)) return false;
  const expected = deriveShareToken(strategyId, nonce, generation);
  // Lengths are equal by construction (regex above pins 43; the digest is
  // always 43), so this cannot throw on a length mismatch.
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
