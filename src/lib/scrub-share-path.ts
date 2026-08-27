/**
 * Phase 164 / SHARE-01 ("never discloses") — redact the recipient capability
 * token out of any URL-shaped string before it leaves the process.
 *
 * ⛔ WHY THIS EXISTS AT ALL. Under ruling D-01 the share token is a PATH
 * SEGMENT (`/factsheet-share/<token>`), not a query parameter. A path segment
 * is carried by every channel that records a request path — and this repo has
 * three of them that cross a trust boundary: Sentry (`src/instrumentation.ts`
 * forwards the raw request path into `extra.path` on every server error),
 * Plausible (records pathnames site-wide; mitigated in `src/app/layout.tsx`),
 * and the `Referer` header on same-origin navigation (mitigated by the
 * per-route `no-referrer` block in `next.config.ts`). This module is the
 * Sentry half. There was NO existing scrub anywhere in `src/` when it was
 * written (`grep -rn "beforeSend|beforeBreadcrumb" src/` returned zero hits),
 * so it has no analog to copy and is deliberately NOT shared with
 * `demo-pdf-token.ts`, whose token is a different resource in a different
 * namespace.
 *
 * ⚠️ SCOPE, STATED HONESTLY. Scrubbing here protects the fields THIS repo
 * hands to a third party. It does nothing about the operator-side channels the
 * threat register accepts rather than mitigates (T-164-17): Vercel's own access
 * logs, CDN logs, the recipient's browser history, and link unfurlers that
 * fetch the URL server-side. Revocability — bumping `strategy_shares.generation`
 * — is the designed mitigation for those, not redaction.
 *
 * ⛔ DELIBERATELY NOT SCOPED TO THE 43-CHARACTER TOKEN SHAPE. A malformed token
 * (`/factsheet-share/lolno`) reaches the same error paths as a well-formed one,
 * and the miss redirect (`/factsheet-share/gone`) is a path on this route too.
 * Matching "any segment under the share prefix" keeps the rule uniform and
 * unconditional: there is no input for which the scrubber decides NOT to
 * redact, so there is no shape a future caller can get wrong. Replacing `gone`
 * with the placeholder loses nothing — the miss classes are already
 * indistinguishable by design.
 */

/**
 * The share route prefix. One constant so the scrubber, the analytics
 * suppression in `src/app/factsheet/[id]/v2/factsheet-analytics.ts` and the
 * route itself cannot drift apart into three spellings of the same path.
 *
 * ⚠️ It is NOT imported by `next.config.ts` or by `src/app/layout.tsx`: both of
 * those need the prefix inside a string literal that a build-time config or a
 * rendered DOM attribute consumes, and the tests for those two sites assert on
 * the literal they emit. Drift there is caught by those tests, not by sharing
 * this constant.
 */
export const SHARE_ROUTE_PREFIX = "/factsheet-share";

/** What every share-route segment collapses to. Mirrors the Next.js dynamic
 *  segment name so a scrubbed Sentry URL reads as the ROUTE it was, which is
 *  the diagnostic value we actually want to keep. */
export const SHARE_PATH_PLACEHOLDER = `${SHARE_ROUTE_PREFIX}/[token]`;

/**
 * Any single segment following the share prefix.
 *
 * The class is RFC 3986 `pchar` — `unreserved / pct-encoded / sub-delims / ":"
 * / "@"` — i.e. exactly the characters a URL path segment may legally contain.
 * It therefore stops at `/`, at `?`, at `#` and at anything that cannot be in a
 * path at all (whitespace, quotes, angle brackets), so a suffix of any of those
 * kinds survives intact: the scrub removes the capability and nothing else.
 *
 * ⚠️ THE FIRST DRAFT USED `[^/?#]+` AND THAT WAS WRONG — caught by the
 * multiple-occurrence vector, not by review. Sentry breadcrumb messages are
 * FREE TEXT, so a token is routinely followed by prose on the same line; the
 * permissive class ate `" failed; retried https:"` along with the token and
 * produced a corrupted message. Bounding the class to what a path segment can
 * actually hold fixes it at the root.
 *
 * ⚠️ THE CLASS IS DELIBERATELY WIDER THAN THE TOKEN ALPHABET (`[A-Za-z0-9_-]`).
 * base64url is a strict subset of `pchar`, so widening can only ever consume
 * MORE than the token, never less — over-matching costs a trailing comma in a
 * log line, under-matching would leak the capability. The asymmetry decides it.
 *
 * Global: one string can carry the URL more than once (a Sentry event's
 * `request.url` and its `transaction` commonly both do).
 */
const SHARE_PATH_RE = /\/factsheet-share\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+/g;

/**
 * Replace every share-route segment in `value` with the `[token]` placeholder.
 *
 * Pure, total, and idempotent: the placeholder itself matches the pattern and
 * maps to itself, so double-scrubbing a string is a no-op rather than a
 * corruption. Strings with no share path pass through byte-identical.
 */
export function scrubSharePath(value: string): string {
  return value.replace(SHARE_PATH_RE, SHARE_PATH_PLACEHOLDER);
}
