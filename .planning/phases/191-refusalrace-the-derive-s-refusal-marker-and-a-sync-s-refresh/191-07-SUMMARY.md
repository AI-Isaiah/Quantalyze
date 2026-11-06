---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 07
subsystem: analytics-service
tags: [python, retraction, d-01, d-08, sc-2]
requirements-completed: [SC-2]
status: complete
completed: 2026-11-05
commits: 2
plan_head_before: 9fa001a570fc2b9696f775c13e61e800e5918f7b
plan_head_after: a76511d836dcb68f89d93b30ef1c854bd5a0ecf7
actuals:
  tokens: 8800
  tasks: 2
  commits: 2
key-files:
  modified:
    - analytics-service/services/ingestion/long_fetch.py
    - analytics-service/tests/test_ledger_refresh_reuse_collision.py
---

# Phase 191 Plan 07: Python retraction as one rpc Summary

`_retract_refresh_marker_on_reuse` now makes ONE `retract_ledger_refresh_marker` rpc and maps its
four answers; its read-modify-write body is gone, `long_fetch.py` holds no `compute_jobs` table
query, and `no_row` is loud (error line plus exactly one tagged Sentry capture).

## What changed

- `long_fetch.py`: `RETRACT_REFRESH_MARKER_RPC` and `RETRACTION_OUTCOMES` (`Final`), the helper
  reduced to the rpc and the outcome map. `retracted` logs the existing warning with the returned
  marker; `done` with a marker logs the existing info line; `done` without one and `no_marker` are
  quiet; `no_row` logs the existing error line and captures once; a falsy job id makes no call;
  an outcome outside `RETRACTION_OUTCOMES` or a non-dict `data` raises `RuntimeError`; an rpc
  exception propagates to the tail's `try:`. The `LEDGER_REFRESH_JOB_SOURCES` import left with the
  read.
- Docstring: the read-modify-write RESIDUAL paragraph (and its sentence naming the enqueue RPC as
  the real closure) is replaced by the D-01 account (one UPDATE in SQL, Python sends only the id
  and the correlation id) and D-02's dedup-to-retraction gap described as unchanged and not that
  race. The WHY paragraphs on `metadata->>'source'` and the union of markers are kept.
- Tests: `_Queue.retract` mirrors the SQL contract, `_queue_supabase` serves the rpc and counts
  `compute_jobs` table accesses (`capture["compute_jobs_table_calls"]`). `TestRetractionHelper`
  and the end-to-end tail test assert exactly one hand-typed
  `("retract_ledger_refresh_marker", {"p_job_id", "p_correlation_id"})` call and, for direct
  helper calls, zero table accesses. `TestRetractionAuditTrailTellsTheTruth` is rewritten around
  the four answers plus unrecognised outcome, five non-object answers and an rpc exception.

## Verify

| Check | Result |
|---|---|
| plan anchors (`node scripts/verify-plan-anchors.mjs`) | OK, 3 claims, exit 0 |
| Task 1 filter `-k "Retraction or deduped_onto_a_refresh"` at HEAD before edit | 14 selected, 14 passed (baseline) |
| `test_ledger_refresh_reuse_collision.py` after Task 1 / Task 2 | 57 passed / 66 passed |
| five modules (`reuse_collision`, `test_long_fetch`, `follow_on_guard`, `mt5_derive_branch`, `composite_nondestructive`) | 187 passed |
| CI's mypy line verbatim from `analytics-service/` | `Success: no issues found in 132 source files` (after Task 1 and Task 2) |
| static: `table("compute_jobs")` outside comments in long_fetch.py | 0 (baseline 3) |
| static: constant line and `.rpc(RETRACT_REFRESH_MARKER_RPC` call | present |
| static: `merge arm in` | 0 (baseline 1); `matched_no_row` and `D-02` present |

## RED proof (SC-2, D-04)

All restores from byte backups under the cache dir, `cmp -s` silent each time; no git
checkout/restore/stash.

Task 1, today's body (`long_fetch.py.before`, the read-modify-write) under the converted tests,
filter `Retraction or deduped_onto_a_refresh`: `8 failed, 7 passed, 42 deselected`. Failing:
`TestUserResyncInheritsAMarkedRefresh::test_tail_enqueue_that_deduped_onto_a_refresh_retracts_the_marker`,
`TestRetractionHelper::{test_single_key_marker_is_retracted, test_composite_marker_is_retracted_too,
test_an_unmarked_job_is_left_alone, test_no_metadata_at_all_is_left_alone,
test_done_job_with_marker_is_not_rewritten, test_running_job_with_marker_is_still_retracted}` and
the audit-trail Sentry case. Representative message: `AssertionError: the tail did not retract
through the one-statement SQL function (Phase 191 D-01) ...` and `assert [] == [('retract_ledger_refresh_marker',
{'p_job_id': 'job-1', 'p_correlation_id': 'cid-d15'})]`. New body restored, green.

Task 2, whole module on the old body: `17 failed, 49 passed` (the Task 1 seven plus the missing-row,
Sentry, unrecognised-outcome, five non-object and rpc-exception cases). Restored, `66 passed`.

Task 2 semantic neuters on the new body, each restored, each green again:

| Neuter | Failing |
|---|---|
| drop the `RETRACTION_OUTCOMES` membership check | `test_an_unrecognised_outcome_raises` (1) |
| drop the Sentry capture call | `test_a_missing_row_also_raises_exactly_one_operator_signal`, `test_a_sentry_transport_failure_never_masks_the_helper` (2) |
| log the retracted warning for every answer | done-with-marker, done-without, no-marker, missing-row, operator-signal, sentry-failure cases (6) |

## Retired cases

`test_a_job_that_finishes_between_read_and_write_is_not_called_retracted` and
`test_a_row_that_vanishes_between_read_and_write_is_an_error` modelled the read-to-write window
(Phase 191 D-01: one UPDATE has no such window). What they observed is now the `done` and `no_row`
cases, driven by the row's state when the function runs. `_Queue.after_next_read` and its hook
call sites are removed.

## Deviations from Plan

- **[Rule 3 - sequencing] Sentry capture landed in Task 1, not Task 2.** Task 1's own verify
  filter (`-k Retraction`) selects `TestRetractionAuditTrailTellsTheTruth`, whose Sentry case
  would be red with only the temporary error line, so the capture block went in with the
  tracer commit to keep every commit green. Task 2 then added the docstring, the full audit-trail
  conversion and the neuters. To serve the old hook-based cases in the interim, the rpc branch
  briefly fired `after_next_read`; Task 2 removed it.
- **`refresh_marker` Sentry tag is the literal `"unknown"` on `no_row`.** The function reports no
  marker when no row exists, so the old `str(marker)` value cannot be supplied. The tag key and
  the static message are unchanged. The old test asserted the real marker there; it now asserts
  `"unknown"`.
- **D-08 says "warning log plus one Sentry capture"; the plan and the existing line are an error
  line.** Kept the existing `refresh_marker_retraction_matched_no_row` error line (plan task text,
  and "keep today's log lines"); it is the louder of the two. Flagged for the reviewer.

## Known Stubs

None.

## Threat Flags

None. T-191-19, T-191-20 and T-191-21 are mitigated and tested as the plan states.

## Notes for the reviewer

- ruff reports `F401 unittest.mock.AsyncMock` in the test file. It is pre-existing at the plan's
  base commit and out of scope; not touched.
- No PROD or TEST access was made. No `STATE.md` or `ROADMAP.md` edit.

## Self-Check: PASSED

Both commits are ancestors of HEAD (`8a9aa54bc`, `a76511d83`); both modified files exist; the
`commits:` count is measured from the plan ledger (2).
