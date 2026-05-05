import "server-only";
import { headers } from "next/headers";

// Phase 16 / OBSERV-01 — server-side correlation_id helper.
//
// Header name lower-cased here for headers.get() (HTTP normalization).
// The wire form is PascalCase ("X-Correlation-Id") to match existing
// X-Api-Version / X-Service-Key precedent in src/lib/analytics-client.ts L70-71.
//
// Filename is kebab-case per CONVENTIONS.md (analytics-client.ts, alert-ack-token.ts).
// PATTERNS.md §Phase-Specific Note 3 explicitly overrides RESEARCH.md's camelCase
// `correlationId.ts` suggestion in favor of repo convention.
export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Read the inbound correlation_id from the current request headers, or
 * generate a fresh UUID v4 if absent. Use at every Route Handler / Server
 * Action entry that fans out to analyticsRequest() so the chain stays
 * joinable end-to-end across Next.js → FastAPI → structlog → Sentry.
 *
 * Node 20+ provides `crypto.randomUUID()` as a global; this repo runs on
 * Node 20 (CI) and Vercel runtime is 24 LTS — no polyfill needed.
 */
// Valid inbound correlation_id shape — 1..128 characters from a conservative
// allowlist (alnum + dot/dash/underscore/colon). The allowlist deliberately
// excludes CR, LF, NUL, and any whitespace/control characters so a hostile
// upstream cannot inject `\r\nX-Forwarded-For: evil` and split the structlog
// record downstream. UUID v4 (36 chars) and broker-correlated IDs (typically
// `<broker>:<uuid>` or `<wizard>:<uuid>`) both pass cleanly.
const CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

export async function getCorrelationId(): Promise<string> {
  const h = await headers();
  // Phase-16 IN-02 + adversarial review: an upstream proxy that strips the
  // value, sends an empty string, or injects whitespace/CR-LF must NOT bypass
  // the joinability invariant. `??` only fires on null/undefined, so any
  // empty/whitespace/garbage string would re-broadcast verbatim. Trim first,
  // shape-check against a conservative allowlist, fall back to a fresh UUID
  // if the inbound value fails to look like a real correlation_id.
  const raw = h.get(CORRELATION_HEADER);
  if (raw === null) return crypto.randomUUID();
  const trimmed = raw.trim();
  if (!CORRELATION_ID_SHAPE.test(trimmed)) return crypto.randomUUID();
  return trimmed;
}
