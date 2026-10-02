---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 02
subsystem: analytics
tags: [job-worker, broker-derive, ordered-idempotent, partial-write, sc4, tdd]

# Dependency graph
requires:
  - phase: 106-01
    provides: env pin/ratify of the unified backbone (Stage A wave 1)
  - phase: 105.1
    provides: single-key broker-derive seam with paired MTM + cash series persists
provides:
  - single-key broker-derive seam now persists BOTH basis series BEFORE the DONE-gating metrics_json_by_basis scalar prestamp (series-first, mirroring the composite seam)
  - partial-write window reversed into the self-healing fresh-series + stale-scalar direction
  - stale composite cross-reference comment corrected to the post-swap single-key order
affects: [106.1 series-store fold, 106-verify, composite-single-key ordering parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "series-before-scalar ordered-idempotent write: gate scalar lands AFTER its series so a mid-write worker death leaves fresh-series+stale-scalar (benign, self-healing) not fresh-scalar+stale-series (harmful mislabeled read)"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_job_worker.py

key-decisions:
  - "D5/M2: moved the WHOLE prestamp (metrics_json_by_basis assignment + upsert def + await) as one unit to after both persist_basis_series calls; kept the side-effect-free _prestamp_payload dict INIT in place"
  - "Moved the MED-HIGH by-basis-authoritative rationale comment WITH the assignment (kept attached to its code) rather than orphaning it above the init"
  - "Patched persist_basis_series at its SOURCE module (services.basis_series) because job_worker imports it function-locally"

patterns-established:
  - "Ordering test via a single unified event log recording persist_basis_series calls + the by-basis scalar upsert + the enqueue RPC, then asserting index(scalar) > both series AND < enqueue"

requirements-completed: [BB-03]

# Metrics
duration: 18min
completed: 2026-07-14
---

# Phase 106 Plan 02: M2 single-key seam series-before-scalar ordering Summary

**The single-key broker-derive seam now persists both basis series before the DONE-gating `metrics_json_by_basis` scalar prestamp, reversing its partial-write window into the same self-healing (fresh-series + stale-scalar) direction the composite seam already uses — a pure ordering swap, zero DDL, zero payload change.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-14
- **Completed:** 2026-07-14
- **Tasks:** 3 (RED → GREEN → REFACTOR)
- **Files modified:** 2

## Accomplishments
- Prestamp write moved from BEFORE the two `persist_basis_series` calls to AFTER both (still before the CSV enqueue RPC), mirroring the composite seam (cash series → MTM series → DONE-bearing scalar LAST).
- RED→GREEN ordering test pins the invariant with a unified event log: it failed against the scalar-first code (`events=['scalar_prestamp', 'series:mark_to_market', 'series:cash_settlement', 'enqueue']`) and passes after the swap.
- Stale composite cross-reference comment fixed — the drifted `:3112-3136` anchor is gone; the comment now names the single-key broker-derive seam and notes both seams are series-first as of 106-02/D5.

## Task Commits

Each task was committed atomically to `gsd/v1.10-portfolio-intelligence-options-mtm`:

1. **RED: failing series-before-scalar ordering test** - `23bfca23` (test)
2. **GREEN: single-key seam persists both series before the scalar prestamp** - `05f869f5` (feat)
3. **REFACTOR: fix stale composite cross-ref comment** - `56221947` (refactor)

_TDD plan: 3 commits, RED→GREEN→REFACTOR gate sequence satisfied._

## Files Created/Modified
- `analytics-service/services/job_worker.py` — moved the `metrics_json_by_basis` assignment + `_prestamp_dq_flags` def + `await db_execute(_prestamp_dq_flags)` from :3163-3175 to after the cash-series persist (before the enqueue); left the `_prestamp_payload` dict INIT in place with a pointer comment; copied the composite self-healing rationale onto the moved block; corrected the stale composite comment.
- `analytics-service/tests/test_job_worker.py` — added `TestDeriveBrokerDailies::test_series_persist_before_scalar_prestamp_then_enqueue` (unified-event-log ordering assertion).

## TDD Gate Compliance
- RED gate: `23bfca23` `test(106-02): …` — test failed for the right reason (ordering assertion `0 > 1`), not a harness error. Count/presence assertions (exactly 1 prestamp, 1 enqueue, both series present) passed in RED, isolating the failure to ORDER.
- GREEN gate: `05f869f5` `feat(106-02): …` — test passes; full `test_job_worker.py` suite green (120 passed, 1 skipped).
- REFACTOR gate: `56221947` `refactor(106-02): …` — comment-only.

## Verification
- `python -m pytest tests/test_job_worker.py tests/test_cash_basis_series_sc4.py` → **135 passed, 1 skipped**.
- Sibling seam suites `tests/test_cash_basis_series_sc4.py tests/test_csv_analytics_runner.py tests/test_mtm_single_key.py` → **68 passed** (no reddening).
- SC-4 seam-count invariant `test_single_cash_settlement_persist_seam` (exactly 2 result-bearing cash persists) still holds — the swap moved the scalar, never added a persist.
- `grep -n ":3112-3136" services/job_worker.py` → empty (stale anchor gone).
- Pre-move PATTERNS subtlety verified: grep of the moved-over range (:3176-:3275) found no reader of `strategy_analytics` / `data_quality_flags` / the prestamp — a clean whole-payload move, no split needed.
- mypy on `services/job_worker.py`: 4 `union-attr` errors remain at lines 4408/4679/4810/4817 — all in the COMPOSITE seam, untouched by this plan, and PROVEN pre-existing (same 4 on base `45900f48`). This change introduces zero new type errors. (Local-venv mypy drift per project notes; CI gates against a pinned uv venv.)

## Deviations from Plan

### Auto-fixed Issues
None — no Rule 1/2/3 fixes were needed.

### Judgment deviations (documented, no user gate)

**1. [Comment placement] Moved the MED-HIGH by-basis rationale comment WITH the assignment**
- **Found during:** GREEN (Task 2)
- **Issue:** The plan said the assignment/def/await move and the long MED-HIGH rationale comment "may stay". Leaving that comment (which documents the `metrics_json_by_basis` value logic) at the old location while the assignment moves ~110 lines away would orphan it — a detailed comment about an assignment that no longer follows it.
- **Fix:** Moved the MED-HIGH comment together with the assignment so the rationale stays attached to the code it explains. The side-effect-free `_prestamp_payload` dict INIT stayed in place with a short pointer comment. Behavior identical; purely a comment-locality choice.
- **Files modified:** analytics-service/services/job_worker.py
- **Commit:** 05f869f5

### Bookkeeping W2 (sibling order-tests) — did NOT materialize
- The plan-check WARNING W2 flagged that the swap might redden `test_cash_basis_series_sc4.py` and `test_csv_analytics_runner.py` if they asserted the old scalar-first order. **Neither reddened.** The SC-4 tests are dual-run byte-identity comparisons (Run A as-shipped vs Run B cash-no-opped, both on the SAME build) and compare payload equality, not absolute scalar-vs-series order — so they are order-insensitive to this swap. No sibling test asserts scalar-first order; the only grep hit for a "series-before-persist" style assertion is this plan's own new test asserting the NEW correct order. **No sibling test files were modified** — the plan's files_modified stands as-is (job_worker.py + test_job_worker.py only).

## Known Stubs
None.

## Threat Flags
None — no new network endpoints, auth paths, file access, or schema changes. The change is an in-process reordering of two independent idempotent writes to `strategy_analytics_series` / `strategy_analytics` (threat T-106-03 mitigation from the plan's threat model, now implemented).

## Self-Check: PASSED
- FOUND: analytics-service/services/job_worker.py (modified)
- FOUND: analytics-service/tests/test_job_worker.py (modified)
- FOUND commit: 23bfca23 (RED)
- FOUND commit: 05f869f5 (GREEN)
- FOUND commit: 56221947 (REFACTOR)
