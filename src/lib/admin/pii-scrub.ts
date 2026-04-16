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
  "secret",
  "signature",
  "passphrase",
  "authorization",
  "x-mbx-apikey",
  "ok-access-sign",
]);

const DENYLIST_PREFIX = ["sb-ec-"];

// JWT shape: three base64url segments separated by dots. Not a signature
// check — just pattern recognition for the shape we know is bearer-ish.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

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
