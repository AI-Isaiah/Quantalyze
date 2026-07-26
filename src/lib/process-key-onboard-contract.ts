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
 * Phase C simplify — split into a discriminated union on `queued`.
 *
 * Phase 140.1.1 / PYAPIFIX-01 (TS-01 + TS-03) — the union is WIDENED and the
 * mixed-envelope rejection is DELETED, because that rejection asserted a
 * mutual exclusion the domain does not have. The reply carries two
 * INDEPENDENT facts:
 *   - `queued` / `job_state` — a compute job is now enqueued or running for
 *     this verification (`process_key.py:_resume_duplicate_job`).
 *   - `code: "WIZARD_DUPLICATE"` + `idempotent: true` — this submission was a
 *     duplicate; no new verification was created (the duplicate pre-check).
 * Neither implies the other, and `_resume_duplicate_job` exists precisely to
 * produce the state where BOTH are true. So
 * `{queued: true, code: "WIZARD_DUPLICATE", idempotent: true}` is NOT a
 * backbone bug — it is the normal **resumed-wedge** reply: *a duplicate
 * submission whose wedged job we re-enqueued*. Rejecting it fired a 502 +
 * Sentry "process-key onboard contract violation" on a successful resume.
 *
 * The three shapes the Python contract returns:
 *   - `{queued: true,  verification_id: string}` — newly queued.
 *   - `{queued: true,  verification_id: string, code, idempotent}` — a
 *     duplicate whose wedged job was re-enqueued (the resumed wedge).
 *   - `{queued: false, code: string, verification_id?, idempotent?}` —
 *     a duplicate for which no background job applies.
 *
 * ⚠️ The widening deleted ONE false assertion and added THREE true ones (see
 * the invariants in the predicate below). Do NOT widen further: the
 * committed fixture
 * `analytics-service/tests/fixtures/process_key_onboard_contract.json` carries
 * three negative cases whose rejection is asserted by BOTH
 * `tests/lib/process-key-onboard-contract-parity.test.ts` and
 * `analytics-service/tests/test_process_key_onboard_contract.py`. A predicate
 * that degraded toward `() => true` reddens them.
 */
export type ProcessKeyOnboardResponse =
  | {
      queued: true;
      verification_id: string;
      code?: string;
      idempotent?: boolean;
    }
  | {
      queued: false;
      code: string;
      verification_id?: string | null;
      idempotent?: boolean;
    };

/**
 * The one duplicate signal the backbone emits
 * (`process_key.py:_wizard_duplicate_reply`, `:680-690`). Pinned as a literal
 * here and independently in both cross-process test consumers — never read
 * out of the other side's implementation.
 */
const WIZARD_DUPLICATE_CODE = "WIZARD_DUPLICATE";

export function isProcessKeyOnboardResponse(
  body: unknown,
): body is ProcessKeyOnboardResponse {
  if (body === null || typeof body !== "object") return false;
  const r = body as Record<string, unknown>;
  if (typeof r.queued !== "boolean") return false;

  // ── Invariant 1 (BOTH arms, PYAPIFIX-01) — `code`, when present, must be a
  // NON-EMPTY string. `typeof "" === "string"`, so a type-only check would
  // render an unnamed condition as a named one in wizard chrome.
  if (
    r.code !== undefined &&
    (typeof r.code !== "string" || r.code.length === 0)
  ) {
    return false;
  }

  // ── Invariant 2 (BOTH arms, PYAPIFIX-01) — `idempotent`, when present, must
  // be exactly `true` AND paired with the duplicate code. This pins the
  // pairing the emitter guarantees (`process_key.py:680-690` sets both keys in
  // the same dict literal) and is what keeps the widening scoped to the
  // WIZARD_DUPLICATE contract instead of collapsing into a blanket allowance
  // for any mixed envelope.
  //   NOTE: the converse is deliberately NOT enforced — a reply may carry
  //   `code: "WIZARD_DUPLICATE"` without `idempotent` (that shape was legal
  //   before 140.1 and nothing in the contract retired it).
  if (r.idempotent !== undefined) {
    if (r.idempotent !== true) return false;
    if (r.code !== WIZARD_DUPLICATE_CODE) return false;
  }

  if (r.queued) {
    // ── Invariant 3 (queued=true arm) — verification_id MUST be a string.
    // This is the one real invariant this arm has; the widening keeps it.
    // `code`/`idempotent` are now ADMISSIBLE here (the resumed-wedge reply)
    // and were constrained above; the arm already tolerated every other extra
    // key the Python reply carries (ok, job_state, status, trust_tier,
    // correlation_id), so this is a narrowing of falsehood, not of teeth.
    return typeof r.verification_id === "string";
  }
  // queued=false branch: code MUST be present (and, per Invariant 1,
  // a non-empty string); verification_id is optional but typed if present.
  if (typeof r.code !== "string") return false;
  if (
    r.verification_id !== undefined &&
    r.verification_id !== null &&
    typeof r.verification_id !== "string"
  ) {
    return false;
  }
  return true;
}
