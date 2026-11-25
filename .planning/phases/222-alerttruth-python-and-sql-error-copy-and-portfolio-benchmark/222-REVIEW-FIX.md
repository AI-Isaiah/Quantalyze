---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
fixed_at: 2026-11-25T14:20:00Z
review_path: .planning/phases/222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark/222-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 222: Code Review Fix Report

**Fixed at:** 2026-11-25T14:20:00Z
**Source review:** 222-REVIEW.md (WR-01 from the reviewer, SFH-01 from the silent-failure-hunter)
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (the two MEDIUMs)
- Fixed: 2
- Skipped: 0
- Not touched, by instruction: WR-02, IN-01, IN-02 (IN-02 is the same observation as SFH-01 and is closed by it), and every LOW/INFO item.

**Where verification ran:** the main checkout of the isolated Phase 222 worktree, `/Users/helios-mammut/claude-projects/quantalyze-wt-222` on branch `gsd/phase-222-alerttruth`. The live module ran against the local-stack lane booted from that worktree (loopback only; no remote database touched). The lane's analytics container (logflare) would not turn healthy on this machine, so the lane was booted with `-x logflare,vector` through a throwaway copy of `scripts/local-stack/run.sh`. The copy was deleted straight after the boot, and `git status` shows no change under `scripts/`. The lane was stopped with `run.sh down` and 0 `supabase_*` containers remain.

## Fixed Issues

### WR-01: tests could not catch a weakened published check

**Files modified:** `analytics-service/tests/test_job_worker.py`, `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py`
**Commit:** 8e82ab636
**Status:** fixed (test-only; no production change)
**Applied fix:**
- Offline: `test_a_non_success_row_with_old_figures_is_not_published`, parametrized as `failed_with_old_figures` and `pending_with_figures`. Each asserts FAILED / transient and exactly one `failed` write.
- Live: `test_a_failed_row_with_old_figures_is_not_published_and_ends_failed`. It seeds `failed` + `metrics_json`, drives the real handler and the real mark RPCs on the last attempt, and asserts the row ends `failed` with the literal transient sentence, `failed_final`, figures untouched.

**RED** (the review's mutation, applied to `_strategy_has_published_numbers` from a byte backup: `return isinstance(row, dict) and row.get("metrics_json") is not None`):

```
FAILED tests/test_job_worker.py::TestSyncTradesEnqueueFailurePublishState::test_a_non_success_row_with_old_figures_is_not_published[failed_with_old_figures]
FAILED tests/test_job_worker.py::TestSyncTradesEnqueueFailurePublishState::test_a_non_success_row_with_old_figures_is_not_published[pending_with_figures]
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
2 failed, 136 deselected in 93.41s (0:01:33)

tests/test_sync_trades_enqueue_failure_bridge_live.py::test_a_failed_row_with_old_figures_is_not_published_and_ends_failed
E       AssertionError: {'computation_status': 'complete', 'computation_error': None, 'computation_warned': False, 'metrics_json': {'marker': 'p222-published-figures', 'sharpe': 1.25}}
E       assert 'complete' == 'failed'
cmp silent (restored)
```

The live line is the resurrection the review describes: a strategy whose last computation failed is shown `complete` with a NULL error.

**GREEN** (restored predicate, no live skip):

```
3 passed, 141 deselected, 2 warnings in 57.60s
```

### SFH-01: publish read and `failed` write are not atomic

**Files modified:** `analytics-service/services/job_worker.py` (enqueue-failure tail only), `analytics-service/tests/test_job_worker.py`, `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py`, `analytics-service/tests/test_failed_status_logged.py`
**Commit:** 1d5f488ff
**Status:** fixed: requires human verification (concurrency/logic fix; the semantic change below is for the founder to confirm)
**Applied fix:** the unconditional `.upsert(payload, on_conflict="strategy_id")` is now one conditional UPDATE:

```python
ctx.supabase.table("strategy_analytics")
    .update(_enqueue_failed_payload)
    .eq("strategy_id", strategy_id)
    .not_.in_("computation_status", sorted(STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES))
    .or_("computation_status.neq.computing,metrics_json.is.null")
    .execute()
```

The filter is the exact inverse of `_strategy_has_published_numbers`, so a row published between the read and the write is not matched and is left untouched. `computation_status` is `NOT NULL` (baseline), so the `neq` filter cannot drop a NULL-status row. The five-key payload, its sentence, the FAILED/transient return and the unstamped status are unchanged.

**Deliberate narrowing, and why:** the review suggested an insert-if-absent fallback for the no-row case. I did not add one. `test_computation_error_provenance_census.py` counts sentence-writing statements by payload shape and pins `EXPECTED_INERT_SITES = 1` (a founder ruling this task keeps unchanged). A second statement carrying the same payload (the first attempt, UPDATE plus `ignore_duplicates` upsert) made it count 2 and failed:

```
AssertionError: expected exactly 1 INERT writer (P1, job_worker._mark_analytics_failed ...), found 2
```

So the fix is one statement. Consequence, for the founder to confirm: with NO strategy_analytics row the handler no longer writes one. The handler still returns FAILED / transient, and `mark_compute_job_failed` then runs the status bridge, which creates the row (branch (a) `computing` while retries remain, branch (b) `failed` with the curated transient sentence at the last attempt). The live no-row cases still pass (`test_nothing_published_ends_failed_with_the_retries_exhausted_sentence`, `test_nothing_published_on_a_first_attempt_retries_and_reads_computing`). The only window that differs is a mark-RPC failure right after an enqueue failure on a never-written strategy, where the row stays absent until the reaper requeues the job.

**Gate collateral (not new behaviour):** three existing gates recorded the write as an upsert, so they now record the UPDATE payload. These are the hang test in `test_job_worker.py` (its `on_conflict` pin is replaced by a pointer to the new filter test), the `_run` harness of `TestSyncTradesEnqueueFailurePublishState`, and `_drive_sync_trades_enqueue_failed` in `test_failed_status_logged.py`.

**New gates:**
- Offline `test_failed_write_is_conditional_on_nothing_published`. It pins the exact chain `update -> eq(strategy_id) -> not_.in_(["complete", "complete_with_warnings"]) -> or_("computation_status.neq.computing,metrics_json.is.null") -> execute`.
- Live `test_a_row_published_between_the_read_and_the_write_is_not_overwritten`. It wraps `db_read_with_retry` so that right after the handler's publish read returns (no row), a `complete_with_warnings` + `computation_warned = true` row is written through the lane. It then asserts the row as the handler leaves it, before the mark RPC and bridge run. This is also the live proof that the PostgREST `not_.in_` and `or_` syntax is accepted and filters correctly.

**RED** (production neutered to the pre-fix unconditional upsert, from a byte backup):

```
E       AssertionError: ['upsert']
E       assert ['upsert'] == ['update', 'u...r_().execute']
E       AssertionError: {'computation_status': 'failed', 'computation_warned': False, 'computation_error': 'Analytics enqueue failed during sy... retry — use the contact form if this persists.', 'metrics_json': {'marker': 'p222-pu...
E       assert 'failed' == 'complete_with_warnings'
FAILED tests/test_job_worker.py::TestSyncTradesEnqueueFailurePublishState::test_failed_write_is_conditional_on_nothing_published
FAILED tests/test_sync_trades_enqueue_failure_bridge_live.py::test_a_row_published_between_the_read_and_the_write_is_not_overwritten
2 failed, 144 deselected in 41.28s
cmp silent (restored)
```

**GREEN** (fix restored; `test_job_worker.py`, the live module, the provenance census, `test_failed_status_logged.py`, `test_no_contact_support_copy.py`, `test_live_db_reach_roster.py`, `test_computing_started_at_stamp.py`):

```
203 passed, 1 skipped, 71 warnings in 166.68s (0:02:46)
SKIPPED [1] tests/test_job_worker.py:4570: LANE_DB_URL unset (local dev) ...
```

The one skip is an unrelated psycopg module that needs `LANE_DB_URL`. It is not part of this finding, and every live test in `test_sync_trades_enqueue_failure_bridge_live.py` ran (8 passed, none skipped). `EXPECTED_INERT_SITES` is unchanged at 1 and the census passes.

**mypy strict** (the CI command, whole service tree):

```
Success: no issues found in 143 source files
```

## Skipped Issues

None.

---

_Fixed: 2026-11-25T14:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
