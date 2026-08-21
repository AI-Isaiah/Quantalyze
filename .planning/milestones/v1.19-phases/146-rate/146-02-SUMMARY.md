---
phase: 146-rate
plan: 02
subsystem: analytics-service rate limiting / error contract
tags: [slowapi, fastapi, ratelimit, service-error, tenant-claim, pytest, mypy]
requires: [146-01]
provides:
  - "RATE-03/TS-21: slowapi 30/min tenant limits on match.py /recompute + /eval"
  - "TS-23-remainder: one 429 raise-site shape (nested service_error envelope)"
  - "TS-36: Python-side parity pytest bound to tenant-claim-parity.json bytes"
affects: [146-03, verification]
key-files:
  created:
    - analytics-service/tests/test_tenant_claim_parity.py
  modified:
    - analytics-service/routers/match.py
    - analytics-service/routers/simulator.py
    - analytics-service/routers/portfolio.py
    - analytics-service/services/rate_limit.py
    - analytics-service/tests/test_limiter_identity.py
    - analytics-service/tests/test_status_contract_match_sim_portfolio.py
    - analytics-service/tests/test_match_router.py
    - analytics-service/tests/test_simulator_router.py
    - src/lib/analytics-client.ts
decisions:
  - "D-146-3 executed: nested service_error envelope WINS as the one 429 raise-site shape"
  - "match.py force-floor wait_s clamped max(1,...) — contract requires positive Retry-After; body interpolates the SAME clamped value so header/copy agree"
  - "/cron-recompute deliberately stays unlimited (cron surface, service-key gated; decision #7 analogy, A2 out of scope)"
metrics:
  duration: ~35min
  completed: 2026-08-18
status: complete
actuals:
  tokens: 7819   # chars/4 over the realized diff (31,275 chars)
  tasks: 3
  commits: 3
---

# Phase 146 Plan 02: Python rate-limit gap + 429 shape + parity pytest Summary

**One-liner:** slowapi 30/min `tenant_or_platform_key` limits landed on match.py `/recompute` + `/eval` with all five pytest gates moved same-commit and the tripwire deleted; the four bare-scalar 429 sites migrated onto the nested `service_error` envelope with Retry-After preserved; TS-36 parity pytest binds `verify_tenant_claim` to the committed fixture bytes.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | `bad30cf8` | feat: slowapi tenant limits on match routes (RATE-03/TS-21) + same-commit gate moves (match.py, test_limiter_identity.py, rate_limit.py, analytics-client.ts in ONE commit) |
| 2 | `9323c1cd` | refactor: four bare-scalar 429s → service_error envelope, Retry-After preserved (TS-23) |
| 3 | `2030a158` | test: TS-36 tenant-claim parity pytest bound to committed fixture bytes |

## Which-shape-wins decision (D-146-3, documented per plan)

The **nested `service_error` envelope** (internal.py's PYAPIFIX2-03 worked example) is the ONE
winning 429 raise-site shape. Rationale: internal.py already proved it in production; the flat
main.py handler shape cannot be adopted by a raise site (it is a returned JSONResponse from an
exception handler, not an HTTPException); the TS discriminator already tolerates all three shapes
(140.2-06) so no TS change is forced. This migration REDUCES raise-site shapes from two to one.
Each migrated site carries a TS-23 citation comment; zero `status_code=429` bare raises remain
across the three routers (was 4 at HEAD, per the plan-check-corrected verify).

**Consequence accepted:** match.py's force-floor `wait_s` is now clamped `max(1, ...)` because
`error_contract._validate` requires a positive `retry_after`. The old unclamped "Retry-After: 0"
arm is traded away; body copy interpolates the SAME clamped value so header and body still agree
(the consistency pin in test_match_router was re-derived, not deleted).

## /cron-recompute out-of-scope note

`POST /api/match/cron-recompute` deliberately stays unlimited: cron surface, service-key gated
(requirements decision #7 analogy; A2 recorded OUT of scope). Recorded in rate_limit.py's
module docstring where the now-false "No limiter at all" sentence was replaced.

## Neuter-RED records (verbatim heads)

**Pre-deletion tripwire RED** (observed AFTER limiters landed, BEFORE deletion — the natural
observation):
```
>       assert not [n for n in rl.limiter._route_limits if n.startswith("routers.match.")]
E       AssertionError: assert not ['routers.match.recompute', 'routers.match.eval_metrics']
tests/test_limiter_identity.py:600: AssertionError
FAILED tests/test_limiter_identity.py::TestClassClosure::test_match_routes_still_have_no_limiter
1 failed, 67 deselected
```

**Task 1 neuter** (decorator removed from `/recompute` only) — BOTH expected gates RED, exit 1:
```
E       AssertionError: the set of statically rate-limited routes changed: unexpected=[], missing=['routers.match.recompute']
FAILED tests/test_limiter_identity.py::TestClassClosure::test_rate_limited_route_set_is_a_literal
E       AssertionError: /api/match/recompute never answered 429 within 31 calls — the RATE-03 slowapi floor is not enforced.
FAILED tests/test_limiter_identity.py::TestClassClosure::test_match_recompute_actually_throttles
2 failed, 66 deselected
```
Restored → 68 passed, exit 0.

**Task 2 neuters** (per-site `retry_after=` kwarg dropped, one at a time; each exit 1, each
restored to exit 0). All four RED with the same contract fail-loud (the header cannot silently
vanish — `_validate` now enforces it at construction):
```
E   ValueError: a 429 must carry Retry-After (STATUS_CONTRACT.md §1)
```
- match.py `retry_after=wait_s` → test_force_true_throttled_429_when_called_twice_quickly RED
- simulator.py `retry_after=_SIMULATOR_USER_RATE_WINDOW_SEC` → test_simulator_per_user_quota_429_advertises_its_window RED
- portfolio.py `retry_after=_BRIDGE_USER_RATE_WINDOW_SEC` → test_bridge_per_user_cap_429_advertises_its_window RED
- portfolio.py `retry_after=_VERIFY_STRATEGY_EMAIL_RATE_WINDOW_SEC` → test_verify_strategy_per_email_cap_429_advertises_its_window RED

**Task 3 neuter** (flipped last hex char of tenant-a's MAC in a TEMP COPY, loader pointed at it;
exit 1):
```
E       AssertionError: case 'tenant-a': the Python verifier no longer accepts the committed wire bytes the TS mint is pinned to — the two implementations have drifted
E       assert None == 'tenant-a'
FAILED tests/test_tenant_claim_parity.py::test_verify_tenant_claim_accepts_the_committed_bytes[tenant-a]
1 failed, 4 passed
```
Loader restored → 5 passed, exit 0. `tenant-claim-parity.json` byte-unchanged (empty git diff).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Direct `recompute()` calls broke under the slowapi wrapper**
- **Found during:** Task 2 (surfaced by the touched-file test run)
- **Issue:** `test_match_router.py::TestRecomputeSerializationLock` calls `recompute()` directly (not via TestClient); slowapi's wrapper requires the `request` argument to be a real starlette Request → `Exception: parameter 'request' must be an instance of starlette.requests.Request`
- **Fix:** `_direct_recompute_request()` helper building a real starlette Request with a per-call unique `X-Service-Key` (private limiter bucket)
- **Files:** tests/test_match_router.py — **Commit:** 9323c1cd

**2. [Rule 1 - Bug] Cross-file limiter-bucket contamination from the new behavioural probe**
- **Found during:** Task 2 analysis of fix #1
- **Issue:** the Task-1 behavioural test drove 31 requests on the shared unverified-credential bucket; test_match_router.py drives ~23 match POSTs on the same bucket — within a 60s window a full-suite run could inherit a spent budget and flake
- **Fix:** unique per-run `X-Service-Key` in the probe → private bucket
- **Files:** tests/test_limiter_identity.py — **Commit:** 9323c1cd

**3. [Rule 1 - Bug] Fifth stale scalar-detail assertion found by the verify sweep**
- **Found during:** Task 2 verify (`-k "429 or retry_after or rate_limit"`)
- **Issue:** `test_simulator_router.py::test_over_budget_user_429s_other_user_unaffected` asserted `r.json()["detail"].lower()` (scalar) → `AttributeError: 'dict' object has no attribute 'lower'` post-migration
- **Fix:** re-pointed to envelope (`code == "RATE_LIMITED"` + human copy)
- **Files:** tests/test_simulator_router.py — **Commit:** 9323c1cd

**4. [Rule 2 - inherent] match.py force-floor clamp** — see shape-decision section; forced by the
contract's positive-Retry-After validation, documented at the site and in the re-derived test pin.

## Close-out gates

- Full suite from `analytics-service/` with `python3 -m pytest -q`: **5178 passed, 89 skipped**, exit 0 (113s)
- `python3 -m mypy --strict services/rate_limit.py routers/match.py routers/simulator.py routers/portfolio.py tests/test_tenant_claim_parity.py`: **Success: no issues found in 5 source files** (zero `# type: ignore` added)
- Task-2 verify: `status_code=429` count across the three routers = **0** (was 4 at HEAD); `-k "429 or retry_after or rate_limit"` → 71 passed, exit 0
- IP_KEYED_CLASS and EXPECTED_CLASS_SIZE=9 byte-unchanged; existing limit VALUES untouched (D-146-4)
- Zero files under supabase/migrations/ in the diff; zero new packages; REQUIREMENTS.md untouched (verification owns ticks)

## Known Stubs

None — no placeholder values, no skipped tests, no unrun verifies introduced.

## Self-Check: PASSED

- analytics-service/tests/test_tenant_claim_parity.py: FOUND
- Commits bad30cf8, 9323c1cd, 2030a158: FOUND in `git log`
- tests/fixtures/tenant-claim-parity.json: byte-unchanged (git status clean)
