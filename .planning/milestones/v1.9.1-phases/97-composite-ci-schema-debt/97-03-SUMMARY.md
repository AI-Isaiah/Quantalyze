---
phase: 97-composite-ci-schema-debt
plan: 03
subsystem: testing
tags: [pytest, compute_jobs, fencing, ci, supabase, deferral, ReadTimeout]

# Dependency graph
requires:
  - phase: 97-01
    provides: per-run-job_id claim scoping inside the 3 skipped tests (isolation precondition of the future re-enable) + shared file ownership of test_compute_jobs_fencing.py
provides:
  - Re-justified deferral of the 3 flaky live-DB late-mark fence tests (CI-02.1 closed via the "explicitly re-justified" arm)
  - Evidence trail a future re-enable needs (ReadTimeout root cause, why CI-01 does not cover it, the _rpc_retry_timeout guard recipe, the non-ship canary protocol)
affects: [milestone-ship-python-check]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferral-as-documentation: the skip-reason text + TODOS.md tracker are the only artifacts preventing a naive re-enable that flakes the ship PR — kept mutually consistent, dated, and evidence-cited"
    - "Guard-wrapped re-enable recipe: _rpc_retry_timeout turns a genuine timeout into pytest.skip (a BaseException the tests' except Exception cannot swallow) while the asserted serialization_failure re-raises and still reaches the assertion"

key-files:
  created:
    - .planning/phases/97-composite-ci-schema-debt/97-03-SUMMARY.md
  modified:
    - analytics-service/tests/test_compute_jobs_fencing.py
    - TODOS.md

key-decisions:
  - "Re-justify, do NOT re-enable (locked decision 3): re-enabling pre-ship would re-introduce the load-timeout flake with no offline venue to prove stability — the ship PR itself would be the first canary"
  - "CI-01 (per-run-job_id scoping, absorbing PR #610) fixed foreign-row isolation under xdist — orthogonal to the httpx.ReadTimeout contention flake, so it does not make the 3 tests safe to re-enable"
  - "All 3 tests stay collected-and-skipped (never deleted); zero test-body changes; nothing in this plan can redden the ship PR's python check"

# Metrics
metrics:
  duration: ~15m
  completed: 2026-07-12
  tasks: 2
  files: 2
---

# Phase 97 Plan 03: Re-justify Flaky Live-DB Fence-Test Deferral Summary

Closed CI-02.1 by RE-JUSTIFYING (not re-enabling) the deferral of the 3 flaky live-DB late-mark fence tests: the `httpx.ReadTimeout @ ~120s under live-DB suite load` root cause is orthogonal to the foreign-row isolation gap CI-01 fixed, so the tests stay collected-and-skipped with a dated, evidence-cited re-justification in both the skip reasons and the TODOS.md L165 tracker.

## What Was Built

**Task 1 — skip reasons (`test_compute_jobs_fencing.py`)** (commit `2213bc81`)
Rewrote the headline test's `@pytest.mark.skip(reason=...)` with a 4-part re-justification, in order:
1. Root cause: `httpx.ReadTimeout @ ~120s` under live-DB suite load (shared test-project contention, python CI concurrent with e2e) — unchanged since the 2026-05-13 investigation.
2. Re-justified 2026-07-12 (Phase 97 / CI-02.1): CI-01's per-run-`job_id` scoping fixed a *different* failure mode (foreign-row isolation under xdist); it does NOT address this timeout, so it does not make these safe. Pre-ship re-enable declined — stabilization is only demonstrable on live CI, so the ship PR would have been the canary.
3. Contract independently pinned: mocked equivalents (`_is_serialization_failure`, `LATE_MARK_IGNORED`, `dispatch_tick` token threading) + the 9 other live fence tests + the migration-117 self-verify DO block.
4. Sanctioned post-ship re-enable recipe: wrap the contention-prone RPCs (`reset_stalled_compute_jobs`, the late `mark_compute_job_done`/`mark_compute_job_failed`) in the existing `_rpc_retry_timeout` guard (timeout → `pytest.skip`, a `BaseException`; `serialization_failure` re-raises and reaches the assertion), then canary on a non-ship PR.

The two cross-referencing tests were updated to cite the 2026-07-12 re-justification and the `_rpc_retry_timeout` re-enable route, keeping their concise "same pattern — see headline" style.

**Task 2 — TODOS.md L165 tracker** (commit `cdf536ed`)
Surgical Edit appending a dated `**Re-justified 2026-07-12 (Phase 97 / v1.9.1 CI-02.1)**` subsection to the "PR #149 (audit-2026-05-07 P97)" block, with the 5 required elements (a)–(e): CI-01 orthogonality, declined pre-ship re-enable rationale, the pinned contract, the concrete guard-wrapped recipe + non-ship canary protocol, and the 97-01 isolation-precondition note. The 2026-05-13 investigation history above it is preserved verbatim.

## Verification Evidence

- `pytest --collect-only -k "late_mark"` lists all 3 target tests plus their 3 mocked `dispatch_tick` equivalents — none deleted, all collected-and-skipped.
- Offline subset of the fencing file: `15 passed, 28 skipped` (the 3 targets among the skips), green under the pinned `.venv` interpreter.
- `grep -c "Re-justified 2026-07" test_compute_jobs_fencing.py` → 3; `grep "Re-justified 2026-07-12"` present in both the test file and TODOS.md, mutually consistent.
- `TODOS.md` line count 737 → 776 (+39, insertion only — no Write-truncation); `deferred 2026-05-13` header and `989 other live-DB tests pass` evidence both intact.

## Deviations from Plan

None — plan executed exactly as written. Both tasks are documentation/skip-reason edits only; no behavioral test changes, no new flake surface introduced onto the milestone→main ship PR's python check.

## Self-Check: PASSED

- FOUND: `analytics-service/tests/test_compute_jobs_fencing.py` (modified, 3 skip reasons re-justified)
- FOUND: `TODOS.md` (modified, L165 tracker re-justification appended)
- FOUND: commit `2213bc81` (Task 1)
- FOUND: commit `cdf536ed` (Task 2)
- CONFIRMED: 3 tests collected-and-skipped (not deleted, not silently re-enabled)
