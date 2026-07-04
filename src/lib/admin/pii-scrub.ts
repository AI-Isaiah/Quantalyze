/**
 * PII scrub for admin-visible JSONB blobs.
 *
 * Admin pages surface raw JSONB columns (e.g. contact_requests.mandate_context
 * + portfolio_snapshot) for founder triage. The underlying writers are trusted
 * server-side code, but defense-in-depth is cheap: if a future caller ever
 * writes credential-shaped data into those blobs, this walker redacts it
 * before the admin page emits HTML. The walker is also the place where
 * exchange account IDs are truncated to their last 4 chars.
 *
 * The denylist is key-name based (case-insensitive). The JWT detector is
 * value-based and catches ad-hoc tokens embedded in freeform strings.
 * Everything else passes through unchanged.
 */

const DENYLIST_EXACT = new Set<string>([
  "apikey",
  "apisecret",
  // Phase 16 / OBSERV-04 — snake_case wire forms used by ConnectKeyStep
  // (api_key/api_secret) must be denied alongside their concatenated
  // variants. Keep both: scrubPii is also applied to JSONB fields where
  // legacy concatenated keys appear.
  "api_key",
  "api_secret",
  "secret",
  "signature",
  "passphrase",
  "authorization",
  "x-mbx-apikey",
  "ok-access-sign",
  // Phase 16 / OBSERV-07 — internal API token must never land in admin
  // JSONB blobs or Sentry breadcrumbs (route.ts forwards it as a header
  // on the seam to FastAPI; outbound HTTP breadcrumbs would otherwise
  // capture it).
  "x-internal-token",
  // Phase 18 / FIX-04 — Adversarial revision 2026-05-06 (Grok B1):
  // Bybit v5 + OKX broker-quirk header keys promoted to the canonical
  // denylist so both runtimes (TS + Python redact.py) share the same
  // surface. Mirrors analytics-service/sentry_init.py _PII_KEYS subset.
  "x-bapi-apikey",
  "x-bapi-sign",
  "x-bapi-signature",
  "ok-access-passphrase",
  "ok-access-key",
  "ok-access-timestamp",
]);

const DENYLIST_PREFIX = ["sb-ec-"];

// JWT shape: three base64url segments separated by dots. Not a signature
// check — just pattern recognition for the shape we know is bearer-ish.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// JWT-shaped substring detector for freeform strings. The 10-char minimum
// per segment keeps the false-positive rate low (e.g., `a.b.c` is not a
// JWT shape). Used by `scrubFreeformString` to catch JWTs embedded inside
// larger strings (e.g. `Authorization: Bearer eyJ...`) where the anchored
// `JWT_SHAPE` regex above would not match.
const JWT_SUBSTRING =
  /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

// Sensitive `key: value` / `key=value` substring detector. Built dynamically
// from `DENYLIST_EXACT` + `DENYLIST_PREFIX` so Pass 1/4 of `scrubFreeformString`
// can never drift from the object-walker denylist. Phase 18 / FIX-04 caught a
// drift class where `x-bapi-apikey` / `ok-access-passphrase` / `sb-ec-*` were
// in the object-key denylist but absent from the freeform regex. Regex-meta
// chars in keys are escaped before alternation. Extra alternates (`password`,
// `token`, `credential`, `cookie`, `session`, `bearer`) cover key-SHAPED words
// that don't exactly match a denylist entry.
const REGEX_META = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_META, "\\$&");
}
// CR-1 (2026-07-04): the bare `secret` / `token` alternates (the former from
// DENYLIST_EXACT, the latter here) only match at a `\b` word boundary. A
// compound key like `client_secret` / `access_token` / `db_password` has a
// word-char `[a-z0-9]_` prefix immediately before the suffix, which SUPPRESSES
// the `\b` — so `client_secret=VALUE` slipped through unredacted while
// `signature=VALUE` (no prefix) was caught. Fix the CLASS by allowing an
// optional vendor/scope prefix `(?:[a-z0-9]+[-_])?` on the credential-bearing
// suffixes. Strictly a superset of the old alternates (prefix is optional), so
// no benign line that was previously redacted stops being redacted. `key` is
// only generalized behind the `api` anchor to avoid over-redacting benign
// `key: value` log lines. Byte-parity with redact.py::_FREEFORM_KEY_ALTERNATES.
const FREEFORM_KEY_ALTERNATES: ReadonlyArray<string> = [
  "(?:[a-z0-9]+[-_])?api[-_]?key",
  "(?:[a-z0-9]+[-_])?secret",
  "api[-_]?secret", // concatenated apisecret/apiSecret: the optional prefix above REQUIRES a separator
  "(?:[a-z0-9]+[-_])?password",
  "(?:[a-z0-9]+[-_])?token",
  "credential",
  "cookie",
  "session",
  "bearer",
];
const SENSITIVE_KEY_VALUE = new RegExp(
  "\\b((?:" +
    [
      ...Array.from(DENYLIST_EXACT).map(escapeRegex),
      ...DENYLIST_PREFIX.map((p) => `${escapeRegex(p)}[A-Za-z0-9_-]*`),
      ...FREEFORM_KEY_ALTERNATES,
    ].join("|") +
    "))\\s*[:=]+\\s*['\"]?([^\\s'\"]+)['\"]?",
  "gi",
);

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";

function isDenylistedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (DENYLIST_EXACT.has(lower)) return true;
  for (const prefix of DENYLIST_PREFIX) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

function scrubString(value: string): string {
  return JWT_SHAPE.test(value) ? REDACTED_JWT : value;
}

/**
 * Recursive JSONB walker. Plain data in → plain data out, with any
 * denylisted keys or JWT-shaped strings replaced in place.
 *
 * Cycles: JSON does not have cycles by construction. The `max_depth` guard
 * (default 100, value-symmetric with `redact.py::MAX_DEPTH`) bounds
 * pathological deeply-nested input so a malicious adversary can't push V8
 * past its hard stack ceiling. On overflow the offending node is replaced
 * with `[REDACTED]` and sibling scrubbing continues — partial-scrub fail
 * mode.
 *
 * **Cross-language asymmetry (Claude adv round-2 conf 6):** the Python
 * mirror RAISES `RecursionError` on overflow; the upstream
 * `_redact_processor` catches and returns the FULL UNSCRUBBED document
 * (fail-OPEN). The TS side here returns a partially-scrubbed document
 * (fail-CLOSED at the offending node). The values are equal but the
 * failure modes differ. This is a deliberate trade-off: the TS surface is
 * admin-page rendering (fail-closed is safer) while the Python surface is
 * Sentry breadcrumbs (fail-open keeps observability online). When a parity
 * test on a 110-deep dict is added, lock both behaviors explicitly.
 */
const MAX_DEPTH = 100;

function scrubPiiInner(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => scrubPiiInner(item, depth + 1));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (isDenylistedKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubPiiInner(source[key], depth + 1);
    }
    return out;
  }

  return value;
}

export function scrubPii(value: unknown): unknown {
  return scrubPiiInner(value, 0);
}

/**
 * Truncate an exchange account ID to "***<last4>". Strings shorter than 8
 * chars are returned as-is — truncating a 5-char id reveals nearly the whole
 * thing, so it's better to leave it alone and let the display layer decide.
 * Non-strings pass through unchanged.
 */
export function truncateAccountId(id: string): string {
  if (typeof id !== "string") return id;
  if (id.length < 8) return id;
  return `***${id.slice(-4)}`;
}

/**
 * Four-pass redaction for freeform strings (e.g. wizard `debug_context`
 * lines copied to clipboard via `<ErrorEnvelope>`). Use this for any
 * user-visible exfiltration surface where the value is a free-form string
 * that may contain `key: value` shapes, whole-string JWTs, or JWTs
 * embedded in larger lines (`Authorization: Bearer <JWT>`).
 *
 * Pass 1 — `SENSITIVE_KEY_VALUE`: redacts `key: value` / `key=value`
 *          shapes for the denylist of key-shaped names (apikey, secret,
 *          passphrase, token, authorization, bearer, etc.). Replaces the
 *          value with `[REDACTED]`, preserves the key for forensic context.
 * Pass 2 — `scrubPii` (string path): catches whole-string JWTs (anchored
 *          regex). The object-key-based denylist is irrelevant here since
 *          the input is a string, not a record.
 * Pass 3 — `JWT_SUBSTRING`: catches JWT-shaped substrings embedded
 *          ANYWHERE in the line. Loads-bearing for `Authorization: Bearer
 *          <JWT>` style payloads where Pass 1 captures only `Bearer` (the
 *          key-shaped word) and Pass 2's anchored match fails.
 * Pass 4 — `SENSITIVE_KEY_VALUE` (transitive re-walk): re-runs the
 *          key-value sub on Pass 3's output to catch denylisted-key shapes
 *          that an earlier redaction may have surfaced (Phase 18 / WR-01
 *          parity with `redact.py` Grok B1 secondary pass). Cheap — `RegExp`
 *          test is O(n) over an already-redacted line.
 *
 * Together the four passes give the same coverage as the original
 * inline implementation in `ErrorEnvelope.tsx` (Phase 17 / DESIGN-02 /
 * CR-01) and BYTE-FOR-BYTE parity with `analytics-service/services/
 * redact.py::scrub_freeform_string`. Future denylist additions need
 * only one edit.
 */
export function scrubFreeformString(value: string): string {
  // Pass 1: key:value substring redaction.
  const pass1 = value.replace(SENSITIVE_KEY_VALUE, (_match, keyName) => {
    return `${keyName}: [REDACTED]`;
  });
  // Pass 2: scrubPii's whole-string JWT detector. scrubPii returns the
  // input unchanged for non-JWT strings, so this is a no-op when the
  // string isn't an anchored JWT. Coerce defensively in case a future
  // scrubPii change widens the return type.
  const pass2 = scrubPii(pass1);
  const asString =
    typeof pass2 === "string" ? pass2 : String(pass2 ?? "");
  // Pass 3: substring JWT redaction (catches embedded JWTs).
  const pass3 = asString.replace(JWT_SUBSTRING, REDACTED_JWT);
  // Pass 4: transitive re-walk (Phase 18 / WR-01 — parity with
  // redact.py Grok B1 secondary). Catches denylisted key:value shapes
  // that survived Pass 1 because Pass 1 redaction or Pass 3 JWT
  // substitution exposed a fresh `key: value` shape on the same line.
  return pass3.replace(SENSITIVE_KEY_VALUE, (_match, keyName) => {
    return `${keyName}: [REDACTED]`;
  });
}
