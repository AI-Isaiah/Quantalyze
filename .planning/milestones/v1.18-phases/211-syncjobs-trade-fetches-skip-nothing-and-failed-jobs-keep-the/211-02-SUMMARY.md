---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 02
subsystem: analytics-service
tags: [stitch-composite, stamp-failed, entry-snapshot, d-15, tdd, 161.1-D5]

requires: []
provides:
  - "run_stitch_composite_job reads strategy_analytics.computation_status once at handler entry (marked jobs only) and _stamp_failed judges D-15 protection from that snapshot"
affects: [TODOS 161.1-D5, SC-3, SC-4]

status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 3
plan_head_before: 431b28c281b12ec9bbf2ab4235ab79d37d48c2b2
plan_head_after: 2e35928da68bb1cd11d74efaf4ddc9874d2f09c3

tech-stack:
  added: []
  patterns:
    - "closure variable captured at handler entry, gated on the refresh marker (mirror of the derive _read_entry_publish_state block)"
    - "test fake serves a per-read status sequence and lets a None entry mean answer-this-read"

key-files:
  created:
    - analytics-service/tests/test_stitch_composite_entry_snapshot.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_stitch_composite_job.py
    - analytics-service/tests/test_ledger_refresh_composite_nondestructive.py

key-decisions:
  - "The snapshot is a closure variable (_entry_computation_status), not a parameter of _stamp_failed: the closure already captures strategy_id, job and supabase"
  - "Entry read is gated on metadata.source == LEDGER_REFRESH_COMPOSITE_SOURCE; an unmarked job issues no extra read and keeps the loud path"
  - "The data_quality_flags read stays live at stamp time for M-2's merge; _read_existing_failed_row selects that column only"

requirements-completed: [SC-3, SC-4]
---

# Phase 211 Plan 02: Composite stamp judges the entry status Summary

A marked composite refresh is now judged against the `computation_status` it held before any work ran, so a sibling SQL-bridge call mid-crawl can no longer disarm the D-15 guard (TODOS `161.1-D5`, the F2 shape).

## What changed

- `run_stitch_composite_job` (`analytics-service/services/job_worker.py`): after `_stitch_start`, a marked job (`metadata.source == LEDGER_REFRESH_COMPOSITE_SOURCE`) selects `computation_status` only, through `db_read_with_retry`, into `_entry_computation_status`. No row or a non-string status leaves it `None`, which takes the LOUD path.
- A failed entry read logs one ERROR, captures once, and raises `RefreshMarkerRereadUnavailable` (TRANSIENT) before any crawl or write. A member of `_READ_PROGRAMMING_ERRORS` is logged and captured, then re-raised unchanged (filed `unknown`). No `aclose_exchange` step: no exchange is open there.
- `_stamp_failed`: `_read_existing_failed_row` now selects `data_quality_flags` only (still live, still through `_stamp_io` with `_STAMP_OP_STATUS_READ`); `existing_status` comes from `_entry_computation_status`. The comment above the read and the D-09 retry comment were rewritten. The marker re-read, `_stamp_io`, `_upsert_error_only`, the loud `_upsert` and every log line are unchanged.
- Test fake (`tests/test_stitch_composite_job.py`): `_FakeSupabase(existing_status_by_read=...)` serves one status per answering `strategy_analytics` read, then falls back to `existing_status`; a `None` entry in `analytics_read_raises` means "answer this read". Defaults leave every other construction unchanged.
- `tests/test_stitch_composite_entry_snapshot.py` (new): `TestCompositeStampJudgesTheEntryStatus` (two F2 cases), `TestCompositeEntryReadFailure` (transient case plus four programming-error params), `TestUnmarkedCompositeTakesNoEntryRead`.
- Four marked stamp-read tests in `tests/test_ledger_refresh_composite_nondestructive.py` re-pointed with a leading `None` entry and read counts grown by one for the marked cases; the unmarked param is untouched. Each docstring carries a dated sentence.

## RED on the unchanged handler (Task 1, tests written first)

```
E  AssertionError: a marked job reads strategy_analytics once at entry (the status snapshot) and once at stamp time (the live flags for M-2's merge); saw 1
E  assert 1 == 2   (test_f2_protected_direction_entry_complete_with_warnings)
E  AssertionError: 1
E  assert 1 == 2   (test_f2_loud_direction_entry_computing)
```

Both fail on the read count (`analytics_reads == 1` on the unchanged handler).

## Neuter proofs (SC-4)

Each: backup of `job_worker.py` to the scratchpad, neuter, run `tests/test_stitch_composite_entry_snapshot.py`, restore with `cp`, `cmp` byte-identical, rerun GREEN (8 passed).

| Neuter | Change | RED tests | Restore |
|---|---|---|---|
| N1 (oracle, D5-6) | `_stamp_failed` reads `existing_status` from the live row again and the select is widened back to both columns; entry read kept | `TestCompositeStampJudgesTheEntryStatus::test_f2_protected_direction_entry_complete_with_warnings` (loud payload written, `computation_status` leaked), `::test_f2_loud_direction_entry_computing` (error-only payload written, `computation_status` None) | cp, cmp identical, 8 passed |
| N2 (re-raise, D5-3) | non-programming-error branch swallows (log, capture, snapshot left None) | `TestCompositeEntryReadFailure::test_a_failed_entry_read_fails_transient_and_writes_nothing` (filed `permanent`, loud stamp written); the programming-error params stay green because the swallow does not touch their branch | cp, cmp identical, 8 passed |
| N3 (gate, D5-3) | marker check replaced by `if True:` | `TestUnmarkedCompositeTakesNoEntryRead::test_an_unmarked_job_reads_once_and_stamps_loud` (`analytics_reads == 2`) | cp, cmp identical, 8 passed |

The first N1 attempt failed to apply (its anchor matched three `select("data_quality_flags")` sites), so its "8 passed" was vacuous and was discarded; N1 was re-run with a unique anchor and the results above are from that run.

## Verification

- `tests/test_stitch_composite_entry_snapshot.py tests/test_stitch_composite_job.py tests/test_ledger_refresh_composite_nondestructive.py tests/test_stamp_io_exhaustive.py tests/test_ledger_refresh_gates.py tests/test_failed_status_logged.py tests/test_probe_composite_claimtime.py tests/test_ledger_refresh_reuse_collision.py`: 399 passed (run before the pytest.param tidy; the three composite files re-run afterward: 139 passed). `test_no_verification_or_publish_status_write_source_scan` green.
- mypy strict exactly as CI's python job: `Success: no issues found in 139 source files`.
- `verify-plan-anchors.mjs` on the plan: 15 claims, OK.
- Acceptance greps: `"data_quality_flags, computation_status"` 0; `.select("computation_status")` 1; `_entry_computation_status` 4; stale `_read_existing_failed_row`-answers comment 0; test count grep 9 (>= 8).

## Deviations from Plan

None to code. One process note: the plan's `grep -c 'def test_\|pytest.param'` acceptance counted 5 on the first Task 2 commit because the programming-error cases used a list plus `ids=`; they were respelled as `pytest.param` in a third commit so the literal grep reads 9. The test count was already 8.

Tracer gate: the Task 1 verify command was re-run end-to-end after the commit (104 passed) before Task 2 expanded; no `blocking-human` gate on the task.

## Known Stubs

None.

## Threat Flags

None. T-211-04 and T-211-05 mitigated and pinned by N1 and N2.

## Self-Check: PASSED

- `analytics-service/tests/test_stitch_composite_entry_snapshot.py` exists; commits `d9992ac85`, `c2da7a686`, `2e35928da` are ancestors of HEAD.
