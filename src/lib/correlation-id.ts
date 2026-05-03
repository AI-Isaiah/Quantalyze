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
export async function getCorrelationId(): Promise<string> {
  const h = await headers();
  return h.get(CORRELATION_HEADER) ?? crypto.randomUUID();
}
