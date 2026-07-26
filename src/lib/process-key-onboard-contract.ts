/**
 * The `/process-key` onboard reply contract — the TypeScript half.
 *
 * ⚠️ LOAD-BEARING LEAF (Phase 140.1.1 / PYAPIFIX-01). This module is a
 * dependency-free LEAF: **zero imports, zero env reads, zero module-load side
 * effects.** Keep it that way. It exists only because the predicate below has
 * to be callable from a test with NO mocks at all.
 *
 * Two consumers:
 *   1. `src/app/api/strategies/finalize-wizard/route.ts` — the production
 *      caller, which narrows the analytics-service reply before forwarding.
 *   2. `tests/lib/process-key-onboard-contract-parity.test.ts` — the
 *      cross-process parity test, which drives this predicate over the
 *      committed fixture
 *      `analytics-service/tests/fixtures/process_key_onboard_contract.json`
 *      that `analytics-service/tests/test_process_key_onboard_contract.py`
 *      pins against a REAL `/process-key` TestClient response.
 *
 * Why the extraction: the predicate used to live at the bottom of
 * `finalize-wizard/route.ts`, whose import graph pulls in `next/server`,
 * `server-only`, the Supabase clients, the rate limiter and the email client.
 * Importing it from a test needs ten `vi.mock(...)` blocks — and PYAPIFIX-01's
 * whole finding is that the Python and TypeScript suites were both green
 * because *each mocked the other*. A contract test wrapped in ten mocks would
 * be a second pair of mocks agreeing with each other, not a fix. So the
 * predicate moved here, unchanged, where both consumers reach the SAME code.
 *
 * Do NOT add an import to this file, and do NOT copy the predicate back into
 * a caller: exactly one implementation must exist, or the parity test stops
 * proving anything about production.
 */

/**
 * audit-2026-05-07 H-0327 — local narrow over the /process-key response
 * shape this handler depends on. Avoids the `Record<string, unknown>`
 * cast at the call site so subsequent property accesses are typed.
 *
 * Phase B simplify — `queued` made required so an upstream
 * `{queued: undefined}` cannot silently coerce into `queued: true` via a
 * `?? true` fallback at the read site.
 *
 * Phase C simplify — split into a discriminated union on `queued`. The
 * Python contract (analytics-service/routers/process_key.py) only ever
 * returns one of two shapes:
 *   - `{queued: true,  verification_id: string}` — newly queued.
 *   - `{queued: false, code: string, verification_id?, idempotent?}` —
 *     dedup hit (WIZARD_DUPLICATE).
 * A mixed envelope (e.g., `{queued: true, code: "WIZARD_DUPLICATE"}`) is
 * a backbone bug; the guard rejects it so the unified-response-parse
 * 502+Sentry path fires instead of silently misrouting wizard chrome.
 */
export type ProcessKeyOnboardResponse =
  | { queued: true; verification_id: string }
  | {
      queued: false;
      code: string;
      verification_id?: string | null;
      idempotent?: boolean;
    };

export function isProcessKeyOnboardResponse(
  body: unknown,
): body is ProcessKeyOnboardResponse {
  if (body === null || typeof body !== "object") return false;
  const r = body as Record<string, unknown>;
  if (typeof r.queued !== "boolean") return false;
  if (r.queued) {
    // queued=true branch: verification_id MUST be a string, and
    // code/idempotent MUST NOT be present (mixed envelope = bug).
    if (typeof r.verification_id !== "string") return false;
    if ("code" in r || "idempotent" in r) return false;
    return true;
  }
  // queued=false branch: code MUST be a string; verification_id and
  // idempotent are optional but must match types if present.
  if (typeof r.code !== "string") return false;
  if (
    r.verification_id !== undefined &&
    r.verification_id !== null &&
    typeof r.verification_id !== "string"
  ) {
    return false;
  }
  if (r.idempotent !== undefined && typeof r.idempotent !== "boolean") {
    return false;
  }
  return true;
}
