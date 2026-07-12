// UX-02 (#30) — client-safe wizard correlation id.
//
// Why this module exists:
//   The server-side helper `src/lib/correlation-id.ts` is server-scoped (it
//   imports the request-headers API) and therefore CANNOT be imported into a
//   client wizard step. Before this module, each step displayed an id read from
//   the `<meta name="x-correlation-id">` PAGE-RENDER tag but SENT nothing on its
//   fetches — so the id the user copied out of an error envelope matched NOTHING
//   the failing request logged (support dead-end).
//
//   Server `getCorrelationId()` (correlation-id.ts) already PREFERS a valid
//   inbound `X-Correlation-Id` header over generating a fresh UUID. So if the
//   client generates one id per wizard session, sends it on every wizard fetch,
//   AND displays that same id, the chain becomes joinable end-to-end:
//   client-displayed id === request header === server logs === Sentry
//   `correlation_id` tag === `compute_jobs.metadata.correlation_id`.
//
// Shape (`wizard:<uuid-v4>`):
//   The documented `<context>:<uuid>` form (mirrors the broker-correlated
//   `<broker>:<uuid>` ids). `wizard:` + a 36-char uuid = 43 chars, well within
//   the server allowlist `CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/`
//   (the colon is explicitly permitted), so the server accepts it verbatim
//   rather than falling back to a fresh UUID.
//
// One id per session:
//   The id is module-memoized — the FIRST call generates it, every later call
//   in the same page/module lifetime returns the same value. That is what makes
//   the DISPLAYED id and the SENT header identical.

let cached: string | null = null;

/**
 * Return the wizard session correlation id (`wizard:<uuid-v4>`), generating it
 * lazily on first call and returning the SAME value on every subsequent call
 * for the life of the module (one id per wizard session / page load).
 *
 * `crypto.randomUUID()` is a global in modern browsers and Node 20+ (same
 * precedent as `correlation-id.ts`).
 */
export function getWizardCorrelationId(): string {
  if (cached === null) {
    cached = `wizard:${crypto.randomUUID()}`;
  }
  return cached;
}

/**
 * `fetch` wrapper that stamps the wizard session correlation id onto the
 * `X-Correlation-Id` header of every request, so the id displayed to the user
 * is exactly the id logged by the server for that request.
 *
 * Header merge semantics: caller-supplied headers (plain object OR `Headers`
 * instance) are preserved, then the session id is `set` LAST — so the session
 * id deterministically WINS over any caller-supplied `X-Correlation-Id`. This is
 * intentional: the whole point is a single stable session id, and a per-call
 * override would break the log-matching contract.
 */
export function wizardFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Correlation-Id", getWizardCorrelationId());
  return fetch(input, { ...init, headers });
}

/**
 * Test-only: clear the module memo so each test starts from a fresh session id.
 */
export function _resetWizardCorrelationIdForTests(): void {
  cached = null;
}
