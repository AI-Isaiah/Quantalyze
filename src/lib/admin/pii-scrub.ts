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

// Sensitive `key: value` / `key=value` substring detector. Anchored on a
// key-shaped substring (one of the listed words) followed by `=`, `:`,
// `=>`, or whitespace, then captures the value up to the next
// whitespace/quote/end-of-string. Mirrors the DENYLIST_EXACT contract:
// any future denylist key SHOULD be reflected here too.
const SENSITIVE_KEY_VALUE = new RegExp(
  "\\b((?:api[-_]?key|api[-_]?secret|x-mbx-apikey|ok-access-sign|secret|passphrase|password|token|credential|cookie|session|authorization|bearer))\\s*[:=]+\\s*['\"]?([^\\s'\"]+)['\"]?",
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
 * Cycles: JSON does not have cycles by construction. If a caller hands a
 * non-JSON object graph with cycles, this will overflow the stack. That
 * is acceptable — the expected input is strictly JSONB read from Postgres.
 */
export function scrubPii(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => scrubPii(item));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (isDenylistedKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubPii(source[key]);
    }
    return out;
  }

  return value;
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
 * Three-pass redaction for freeform strings (e.g. wizard `debug_context`
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
 *
 * Together the three passes give the same coverage as the original
 * inline implementation in `ErrorEnvelope.tsx` (Phase 17 / DESIGN-02 /
 * CR-01) but lives in the canonical PII module so future denylist
 * additions need only one edit.
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
  return asString.replace(JWT_SUBSTRING, REDACTED_JWT);
}
