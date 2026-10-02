---
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
plan: 02
subsystem: infra
tags: [seam, retry, backoff, circuit-breaker, resilient-fetch, railway, vitest, tdd]

# Dependency graph
requires:
  - phase: 140.2
    provides: "resilientFetch — the ONE seam transport with the breaker (isBreakerOpen), the unified SEAM_BUDGETS table, seamBreakerVerdict classification, and the ME-03 timeoutMsOverride escape-hatch pattern"
provides:
  - "retriesOverride escape hatch on ResilientFetchInit (integer 0|1, validated above the classification window)"
  - "A bounded retry loop inside resilientFetch (1 + retries attempts) that retries ONLY the counting/transient classes"
  - "SEAM_RETRY_BACKOFF_MS (250) + SEAM_RETRY_JITTER_MAX_MS (250) exported constants — fixed backoff + jitter"
  - "The SC4 breaker-open guarantee: zero attempts when open at entry; a pre-attempt-2 isBreakerOpen re-check thrown above the fetch try so the loop never swallows CircuitOpenError"
  - "Per-attempt recordOnce latch (Class D): retried attempts count independently; within-attempt status+body dedup preserved"
  - "SC-4 falsifiability-ledger row Observed (both breaker gates mutation-tested)"
affects: [141-04, "SEAM retry caller wiring", "process-key-client", "analytics-client", "SC-4b headroom arithmetic"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retry lives in the shared transport (resilientFetch), never in the clients — the loop is the only place that owns the deadline, the breaker check, and the failure classification a retry must respect (RESEARCH Q1)"
    - "Design A: each attempt gets its OWN fresh per-attempt deadline (total worst case = timeoutMs × (1+retries) + backoff)"
    - "Fixed backoff + jitter declared-not-defaulted, beside the BREAKER_STORE constants, so the SC-4b headroom arithmetic can read the max as one number"
    - "Escape-hatch activation: retriesOverride (not the SEAM_BUDGETS row) turns retry on, so plan 04 can key on flow_type not the many-to-one budgetKey"

key-files:
  created:
    - "src/lib/resilient-fetch.retry.test.ts — 15 tests, RED-first, oracle-independent backoff bounds"
  modified:
    - "src/lib/resilient-fetch.ts — retriesOverride type field + validation, retry constants, the retry loop, sleep helper"
    - ".planning/phases/141-.../141-VALIDATION.md — SC-4 ledger row flipped to Observed"

key-decisions:
  - "retriesOverride validated to integer 0|1 with the ME-03 VALUE-check rule (never `\"retriesOverride\" in init`), raised ABOVE the classification window so a bad value is never recorded as Railway degradation"
  - "Backoff, THEN re-check: the read that gates the retry is the freshest one (the breaker may open during the backoff)"
  - "The recordOnce latch is reset PER ATTEMPT; the closure handed to instrumentBody carries the LAST attempt's latch (a post-return body-read failure belongs to the attempt that produced the response)"
  - "A counting status on the last attempt is RETURNED, not thrown, so the caller still sees the 503 body its contract interprets"
  - "All SEAM_BUDGETS rows stay retries:0 and no caller passes the override — the loop is provably dormant until plan 04"

patterns-established:
  - "SC-4 both-gate mutation: delete the pre-attempt-2 re-check → SC4b RED; invert the entry gate → SC4a RED (second member of the class per the ledger)"

requirements-completed: [SEAM-06]

# Metrics
duration: ~46min
completed: 2026-07-31
---

# Phase 141 Plan 02: SEAM-06 bounded retry loop Summary

**A dormant, bounded one-retry loop inside `resilientFetch` — fixed backoff + jitter, per-attempt deadline (Design A), a per-attempt breaker latch, and both breaker gates (entry + pre-attempt-2 re-check) mutation-proven — behind a `retriesOverride` escape hatch so production stays byte-equivalent until plan 04 wires callers.**

## Performance

- **Duration:** ~46 min (includes one watchdog stall recovered mid-edit)
- **Completed:** 2026-07-31
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified) + 1 planning ledger

## Accomplishments
- Built the SEAM-06 retry mechanics half: `retriesOverride` on `ResilientFetchInit`, a `1 + retries` loop wrapping the fetch/verdict path, `SEAM_RETRY_BACKOFF_MS`/`SEAM_RETRY_JITTER_MAX_MS`, and the pre-attempt-2 breaker re-check.
- Proved the SC4 breaker-open guarantee at BOTH positions (open at entry → zero attempts; opens between attempts → the re-check throws `CircuitOpenError` and the loop never swallows it).
- Proved the per-attempt latch (two transient attempts count twice; a status+body pair within one attempt counts once) and that 4xx/`SeamConfigError`/`CircuitOpenError` are never retried.
- Flipped the SC-4 falsifiability-ledger row to Observed with pasted evidence from two mutations.
- Left the loop provably dormant: `SEAM_RETRIES` still `= 0`, all rows `retries:0`, neither client passes the override.

## Task Commits

1. **Task 1: retriesOverride + the retry loop (tests first, loop second)** — `e4f80779` (feat) — TDD RED→GREEN in one file pair.
2. **Task 2: SC-4 falsifiability-ledger observation** — `0b2207cd` (docs) — mutations run, reverted, ledger row updated.

## RED observed first-hand (Task 1)

Before implementation, `resilient-fetch.retry.test.ts` ran with 10 failed / 5 passed. Representative failing assertions:

```
FAIL … SC4b — breaker CLOSED at entry, attempt 1's failure TRIPS it, the re-check throws CircuitOpenError and no second fetch fires
AssertionError: expected null to be an instance of CircuitOpenError
 ❯ src/lib/resilient-fetch.retry.test.ts:435 (RED-phase line)

FAIL … both attempts fail transient → the store records EXACTLY 2 failures (latch resets per attempt)
AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times

FAIL … retriesOverride validation … a negative value → SeamConfigError …
AssertionError: promise resolved "{ ok: true, status: undefined, … }" instead of rejecting
```

After implementation: 15/15 green; the existing `resilient-fetch.test.ts`, `seam-constants.pin.test.ts`, and `seam-budgets.invariant.test.ts` all green UNCHANGED (262 total across the 4 files).

## SC-4 ledger mutations Observed (Task 2)

**Primary mutation — delete the pre-attempt-2 `isBreakerOpen` re-check:**
```
FAIL … SC4b …
AssertionError: expected null to be an instance of CircuitOpenError
 ❯ src/lib/resilient-fetch.retry.test.ts:436
```
With the re-check gone, attempt 1 trips the breaker but the retry fires anyway and the call resolves 200 instead of throwing.

**Adjacent probe (second member of the class) — invert the ENTRY gate `if (breaker.open)` → `if (!breaker.open)`:**
```
FAIL … SC4a — breaker seeded OPEN at entry + retriesOverride:1 → CircuitOpenError, ZERO fetch attempts
AssertionError: expected "vi.fn()" to be called 0 times, but got 1 times
```

Both mutations reverted via `git checkout --`; `grep -rn MUTANT src/` → 0; retry test 15/15 green.

## Files Created/Modified
- `src/lib/resilient-fetch.retry.test.ts` — SC2 mechanics + SC4 breaker gates + per-attempt latch + retriesOverride validation; fake timers for the 250/500 backoff bounds (literals, not imports); harness copied from `resilient-fetch.test.ts`.
- `src/lib/resilient-fetch.ts` — `retriesOverride?` on `ResilientFetchInit`; validation in the pre-window block; `SEAM_RETRY_BACKOFF_MS`/`SEAM_RETRY_JITTER_MAX_MS`; the retry loop (per-attempt deadline, backoff+jitter+re-check, per-attempt latch, counting-status/transport retry eligibility); a `sleep` helper.
- `.planning/phases/141-.../141-VALIDATION.md` — SC-4 row → Observed with evidence.

## Decisions Made
See `key-decisions` frontmatter. The load-bearing ones: the ME-03 value-check for the override, backoff-then-re-check ordering, the per-attempt latch reset with the last-attempt closure semantics, and returning (not throwing) a counting status on the final attempt.

## Deviations from Plan
None — plan executed exactly as written. One process note: reworded the test's header comment to remove the literal token the acceptance grep counts, so `grep -c "vi.stubGlobal" src/lib/resilient-fetch.retry.test.ts` → 0 while the file still installs the fetch double solely through `installFetchMock` (matching the repo's convention of not writing guarded literals in prose).

## Issues Encountered
- A watchdog stall interrupted execution mid-edit (just before adding the `sleep` helper). Recovered by verifying `git status`/greps showed all prior edits intact, then finishing the `sleep` helper and running the suite. No work lost.

## User Setup Required
None — no external service configuration required. The loop is dormant (no row flipped, no caller passes the override).

## Next Phase Readiness
- Plan 04 activates SEAM-06 by passing `retriesOverride` per `flow_type` from `postProcessKey` (and per `budgetKey` on the analytics seam), and enforces the SC-4b headroom invariant (charging the `SEAM_RETRY_BACKOFF_MS + SEAM_RETRY_JITTER_MAX_MS` = 500ms max) plus the allowlist restriction to headroom-safe routes.
- Dormancy verified: `grep -n retriesOverride src/lib/analytics-client.ts src/lib/process-key-client.ts` → 0; `SEAM_RETRIES` still `= 0`.

## Self-Check

- Created file exists: `src/lib/resilient-fetch.retry.test.ts` ✅
- Commits exist: `e4f80779` (task 1), `0b2207cd` (task 2) ✅
- `grep -rn MUTANT src/` → 0 ✅
- tsc --noEmit clean ✅

---
*Phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit*
*Completed: 2026-07-31*
