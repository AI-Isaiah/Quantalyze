// UX-02 (#30) — client-safe wizard correlation ids.
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
//   client generates one id per request, sends it on every wizard fetch, AND a
//   step that renders a failed request's envelope displays that SAME id, the
//   chain becomes joinable end-to-end: client-displayed id === request header
//   === server logs === Sentry `correlation_id` tag ===
//   `compute_jobs.metadata.correlation_id`.
//
// ⛔ REVERSED 2026-09-22 (164.6.5-07 / D-14) — READ THIS BEFORE TRUSTING THE
// SHAPE ABOVE. This module used to mint ONE id per page load, cache it, and
// stamp that SAME id on every `wizardFetch` call for the module's lifetime.
// MEASURED in a real incident: the founder's two key-validation retries, 45s
// and 55s apart in one open tab, rendered the IDENTICAL correlation id — so the
// "email us with the correlation id" instruction in that same error copy could
// not tell support which of two different failures the id named. A per-page-
// load id is the wrong grain for "identify THIS failed request".
//
//   The fix is NOT a straight replace. `getWizardCorrelationId()` is preserved
//   byte-for-byte — same name, same memoization, same `wizard:<uuid>` shape —
//   because it is ALREADY emitted into funnel telemetry that joins on it, and
//   silently changing an existing telemetry field's cardinality changes the
//   meaning of historical rows (D-14's own stated cost). What changes is
//   `wizardFetch`: it now mints a FRESH id on every call for the
//   `X-Correlation-Id` header (mirroring the per-call shape
//   `analytics-client.ts`'s `analyticsRequest` already uses for the same
//   reason), and carries the page-load id ADDITIVELY on its own header
//   (`X-Wizard-Page-Load-Id`) so nothing that still wants one stable
//   per-page-load value loses it.
//
//   The header-merge rule is likewise REVERSED. Before, the session id was
//   `set` LAST so it deterministically won over any caller-supplied
//   `X-Correlation-Id` — the docblock reasoned that a per-call override would
//   break the log-matching contract. That reasoning is now backwards by
//   measurement: the per-call value is exactly what makes log matching work
//   across two attempts, and the memoized value is what broke it. A caller-
//   supplied `X-Correlation-Id` is now RESPECTED; a fresh id is minted only
//   when the caller supplies none.
//
// Shape (`wizard:<uuid-v4>`, both headers):
//   The documented `<context>:<uuid>` form (mirrors the broker-correlated
//   `<broker>:<uuid>` ids). `wizard:` + a 36-char uuid = 43 chars, well within
//   the server allowlist `CORRELATION_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/`
//   (the colon is explicitly permitted), so the server accepts it verbatim
//   rather than falling back to a fresh UUID.
//
// ⛔ THE FINALIZE DEDUPE IS OUT OF SCOPE AND UNTOUCHED BY THIS CHANGE.
//   `src/app/api/strategies/finalize-wizard/route.ts` deliberately keys its
//   dedupe off the draft row's stable `wizard_session_id`, never off this
//   header, and its own comment already explains why: a value that changes per
//   request would be worse than sending nothing for a dedupe key. Nothing here
//   moves that key onto `X-Correlation-Id` or `X-Wizard-Page-Load-Id`.

let cached: string | null = null;

/** Mint a fresh `wizard:<uuid-v4>` id. `crypto.randomUUID()` is a global in
 * modern browsers and Node 20+ (same precedent as `correlation-id.ts`). */
function mintWizardId(): string {
  return `wizard:${crypto.randomUUID()}`;
}

/** `X-Correlation-Id`: carries a FRESH id per `wizardFetch` call (or the
 * caller's own supplied value) — see the module docblock's D-14 reversal. */
const CORRELATION_HEADER = "X-Correlation-Id";

/** `X-Wizard-Page-Load-Id`: carries the STABLE `getWizardCorrelationId()`
 * value, additive, so a per-page-load join is still available. Named
 * distinctly from the unrelated "wizard session id" the finalize dedupe reads
 * from `localStorage.ts`'s `newWizardSessionId()` — a different value with a
 * different job, per this plan's own correction of the original scout note. */
const PAGE_LOAD_HEADER = "X-Wizard-Page-Load-Id";

/**
 * Return the wizard page-load correlation id (`wizard:<uuid-v4>`), generating
 * it lazily on first call and returning the SAME value on every subsequent
 * call for the life of the module (one id per page load). UNCHANGED by the
 * 2026-09-22 reversal above — this function's behavior, name and meaning are
 * exactly what they were: existing funnel telemetry joins on it.
 */
export function getWizardCorrelationId(): string {
  if (cached === null) {
    cached = mintWizardId();
  }
  return cached;
}

/** Optional extras for `wizardFetch`. Additive — every existing 2-argument
 * call site keeps compiling and behaving as before. */
export interface WizardFetchOptions {
  /**
   * Invoked with the exact `X-Correlation-Id` value this call put on the
   * wire (freshly minted, or the caller-supplied value if one was given).
   * A step that renders a failed request's error envelope uses this to show
   * the id of THAT attempt rather than the page-load id — see plan
   * 164.6.5-07 task 2/3.
   */
  onCorrelationId?: (id: string) => void;
}

/**
 * `fetch` wrapper for the wizard's requests. Stamps TWO headers on every
 * call:
 *
 *   - `X-Correlation-Id`: a FRESH id minted for THIS call, unless the caller
 *     already supplied one (respected, never overwritten — see the D-14
 *     reversal above).
 *   - `X-Wizard-Page-Load-Id`: the stable per-page-load id
 *     (`getWizardCorrelationId()`), always set, additive.
 *
 * The optional third argument lets a caller capture the exact value that went
 * on the `X-Correlation-Id` wire for this call, to render alongside a failed
 * request's error envelope.
 */
export function wizardFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: WizardFetchOptions,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const correlationId = headers.get(CORRELATION_HEADER) ?? mintWizardId();
  headers.set(CORRELATION_HEADER, correlationId);
  headers.set(PAGE_LOAD_HEADER, getWizardCorrelationId());
  options?.onCorrelationId?.(correlationId);
  return fetch(input, { ...init, headers });
}

/**
 * Test-only: clear the module memo so each test starts from a fresh page-load
 * id.
 */
export function _resetWizardCorrelationIdForTests(): void {
  cached = null;
}
