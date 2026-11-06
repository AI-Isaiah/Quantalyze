---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 06
subsystem: analytics-worker
tags: [job-worker, refusal-marker, stamp-io, jsonb-merge, rpc]
requires:
  - phase: 191-05
    provides: "mark_compute_job_kept_figures live on PROD with the intended ACL (gate-pr2: open)"
provides:
  - "MARK_KEPT_FIGURES_RPC and a one-rpc _mark_job_kept_figures with the D-07 confirmed-write check"
  - "converted marker tests asserting one rpc, no compute_jobs update, ordering; a parametrized non-True-answer test"
affects: [191-09]
tech-stack:
  added: []
  patterns: ["one SQL merge statement behind _stamp_io; only an exact True answer counts as written"]
key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
key-decisions:
  - "RuntimeError (not KeyError/TypeError/AssertionError) on a non-True answer, so _stamp_io files it StampIOUnavailable (TRANSIENT) and not unknown"
requirements-completed: [SC-2]
status: complete
completed: 2026-11-05
commits: 2
plan_head_before: 9fa001a570fc2b9696f775c13e61e800e5918f7b
plan_head_after: 1ac3d6df5d118be8aed55b7d630791a827dddcd2
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 191 Plan 06: the derive's refusal marker as one merge rpc Summary

The derive's refusal marker is now one `mark_compute_job_kept_figures` rpc carrying only the job id, through `_stamp_io`, and counts as written only when the function answers exactly `True`; the tests fail on today's read-modify-write replace.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | b84f36a8f | feat(191-06): the derive's refusal marker is one merge rpc through _stamp_io |
| 2 | 1ac3d6df5 | test(191-06): a marker the function did not confirm fails the job TRANSIENT with no sentence |

## What changed

- `MARK_KEPT_FIGURES_RPC: Final[str] = "mark_compute_job_kept_figures"` beside `READ_REFUSAL_KEPT_FIGURES_KEY`, commented as a cross-language contract with migration 20261106120000 (pinned by plan 191-09).
- `_mark_job_kept_figures` is one `ctx.supabase.rpc(MARK_KEPT_FIGURES_RPC, {"p_job_id": job.get("id")}).execute()`. A `.data` that is not `True` raises `RuntimeError` naming the answer's type and value (D-07). The `_stamp_io(... op=_STAMP_OP_REFUSAL_MARKER_WRITE ...)` wrapper, the `if keep_numbers and final_refusal:` guard and the position before `_upsert_error_only` are unchanged. The unfenced write is parity with before (D-09).
- The comment above the closure no longer justifies a read-modify-write; it names the merge function, D-03, D-07 and D-09.
- Tests: `_build_ctx` records `("rpc", name)` in `capture["ops"]` and answers `True` for the marker function; `_refuse` gained `marker_rpc_answer` and `capture_into` knobs and `break_the_job_marker_write` now makes the rpc raise; `_assert_nothing_else_written` allows the marker rpc (RESEARCH Pitfall 1). The no-numbers and retryable-refusal tests additionally assert no marker rpc at all.

## Verification

- Marker selection (`-k "Refusal or marker"`): 28 passed before Task 2, 32 after (four new parametrized cases).
- Three modules (`test_derive_broker_dailies_dualmode.py`, `test_stamp_io_exhaustive.py`, `test_ledger_refresh_composite_nondestructive.py`): 243 passed.
- CI's mypy line verbatim from `analytics-service/`: `Success: no issues found in 132 source files`.
- Task 1 grep checks: stale sentence count 0, constant line present, `.rpc(` passes the constant. `verify-plan-anchors.mjs`: OK, 3 claims.

## RED proof (SC-2, D-04)

Old closure restored from the byte backup (`cp job_worker.py.before` over the working file), converted tests run: **8 failed, 20 passed**.

- `test_where_numbers_exist_the_refusal_is_error_only_and_keeps_them[complete]` and `[computing-over-published-headline-with-null-by-basis]`
- `test_the_job_marker_is_merged_into_the_live_metadata_not_written_over_it`
- `test_a_refusal_on_a_job_a_users_sync_now_took_over_is_marked_too`
- `test_a_final_refusal_writes_the_marker_before_the_sentence[transient-on-the-last-attempt]`, `[repeat-deadline-is-permanent]`, `[permanent-on-the-first-attempt]`
- `test_a_marker_that_did_not_land_fails_the_job_transient_and_writes_no_sentence`

Seven fail with `AssertionError: assert [] == [('mark_compute_job_kept_figures', {'p_job_id': 'j-st'})]` ("Right contains one more item"): the old closure issues no rpc. The eighth fails with `Failed: DID NOT RAISE StampIOUnavailable`: the old closure reads `compute_jobs` and updates it, so the knob that now makes the rpc raise never fires. After `cp job_worker.py.after` back, `cmp -s` was silent and the selection was green again.

## D-07 neuter reading

With the closure's check neutered (`if _answer is not True:` changed to `if False:`, from a byte backup), the parametrized test `test_a_marker_the_function_did_not_confirm_fails_the_job_transient_with_no_sentence` failed for all four answers (`false-no-row-changed`, `none-no-answer`, `one-is-not-true`, `string-true-is-not-true`), each with `Failed: DID NOT RAISE StampIOUnavailable`. Restored; `cmp -s` silent; the file matched the committed version (`git diff --stat` empty).

## Deviations from Plan

None - plan executed exactly as written. One note: the plan's step "point `break_the_job_marker_write` at the rpc" needed a `capture_into` knob on `_refuse` so the parametrized test can read what was written after the derive raised (the helper returns nothing when it raises). Test-only, no behaviour change.

## Known Stubs

None.

## Threat Flags

None. No new network surface; the call targets the existing service-role-only function.

## Self-Check: PASSED

- b84f36a8f and 1ac3d6df5 are ancestors of HEAD.
- `analytics-service/services/job_worker.py` and `analytics-service/tests/test_derive_broker_dailies_dualmode.py` exist and carry the changes above.
