import { randomBytes, createHash } from "crypto";

/**
 * Mint and hash revocable read-only scenario-share tokens.
 *
 * A share link embeds a 256-bit CSPRNG bearer token in its URL. The raw token
 * is NEVER persisted: only its sha256 hex digest (`token_hash`) is stored in
 * `scenario_shares` and passed to the `get_shared_scenario(p_token_hash)` RPC
 * (Plan 25-01). A DB-read leak therefore exposes only hashes, never a usable
 * live link, and a row can be revoked by setting `revoked_at` (impossible with
 * a stateless HMAC token — the revocation requirement is why this is a
 * random+stored-hash model, NOT the keyed-MAC model of `demo-pdf-token.ts`).
 *
 *   raw   = randomBytes(32) -> base64url, no padding, 43 chars  (lives ONLY in the URL)
 *   hash  = sha256(raw) hex, 64 lowercase chars                 (the only thing at rest)
 *
 * DIGEST SOURCE-OF-TRUTH: `hashShareToken` is the single place the sha256
 * algorithm is defined for this path. The `get_shared_scenario(p_token_hash)`
 * RPC matches `scenario_shares.token_hash` against exactly this digest — the
 * generate route stores `hashShareToken(raw)` and the public page passes
 * `hashShareToken(token)` as `p_token_hash`. The two sides MUST stay aligned:
 * pgcrypto `digest` is not enabled in any migration, so the hash is computed in
 * Node here and never in SQL. Changing the algorithm here without changing the
 * RPC predicate would make every lookup silently miss.
 *
 * No env secret is read: entropy comes from `randomBytes`, not a keyed MAC.
 */

/**
 * Mint a fresh share token. Returns the raw token (for the URL) and its sha256
 * hex hash (for storage / the RPC predicate). `hash === hashShareToken(raw)`.
 */
export function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url"); // 256-bit; URL-safe, no padding
  return { raw, hash: hashShareToken(raw) };
}

/**
 * Deterministic sha256 hex digest of a raw share token — the single algorithm
 * the recipient route uses to look up `scenario_shares.token_hash` and that the
 * `get_shared_scenario(p_token_hash)` RPC matches against. Same input -> same
 * 64-char lowercase hex.
 */
export function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
