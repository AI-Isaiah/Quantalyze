# Phase 146 — RATE: audit + close the two verified rate-limit gaps — CONTEXT

**Mode: autonomous continuation of /gsd-autonomous (founder directive 2026-08-18: "Continue
autonomously with 146"). No discuss-phase ran; decisions below are recorded orchestrator
calls, each reversible at the ship human gate. Founder ruling in force (v1.16, 2026-08-03):
LIGHT review depth for phases 141–146.**

## Locked decisions

- **D-146-1 (RATE-05 disposition):** `withAuthLimited` IS the required HOF — it composes
  `withAuth` with per-route limiting, and the living invariants
  (`src/lib/seam-ratelimit-posture.invariant.test.ts` + `limiter-ordering.test.ts`
  completeness) already fail any new limiterless/unclassified seam route. RATE-05 closes as
  VERIFIED-EXISTING with a fresh-grep receipt, NOT by building a second wrapper. Recorded
  as an orchestrator call per the research's recommendation; reversal point = ship gate.
- **D-146-2 (scope):** close the TWO verified gaps only — (a) `admin/match/eval` (mirror
  the sibling recompute's inline `adminActionLimiter` + `rateLimitDenyJson`; move the 3
  test rosters same-commit), (b) Python `match.py` `/recompute` + `/eval` (slowapi
  `partial(tenant_or_platform_key, scope=…)`; move the 5 pytest/structural gates
  same-commit, DELETE the deliberate tripwire `test_match_routes_still_have_no_limiter`,
  add `request: Request` params). No new sweep, no speculative limiter additions.
- **D-146-3 (140.1 obligations):** the 4 ledger rows assigned to Phase 146 are IN scope:
  TS-21 (=RATE-03), TS-22 (=RATE-04 parity audit as a committed artifact), TS-23-remainder
  (migrate the 4 bare-scalar `HTTPException(429)` sites onto `service_error`, preserving
  Retry-After; ONE 429 shape wins — pick the `service_error` envelope, document), TS-36
  (pytest binding `verify_tenant_claim` to the committed `tenant-claim-parity.json`).
- **D-146-4 (RATE-04 mismatches):** the parity audit RECORDS mismatches with a
  recommendation each; changing live limit VALUES is founder territory — file value-change
  candidates to TODOS, do not retune numbers in this phase.

## Constraints (standing)

- Every census/grep in RESEARCH.md was taken at the 145 branch tip — RE-RUN at execution.
- ⛔ No migration expected; if one becomes necessary before 2026-08-19 12:00 UTC it must
  sort ABOVE `20260819120000`.
- Tests: every new/changed gate observed RED under a documented neuter before restore.
- pytest only from `analytics-service/` with `python3`; mypy --strict before ship.
- ⛔ Nothing touches PROD; no packages installed; never print secret values.

## Deferred (never silently absorbed)

- Limit-value retuning (RATE-04 mismatch remediation) → TODOS with the measured numbers.
