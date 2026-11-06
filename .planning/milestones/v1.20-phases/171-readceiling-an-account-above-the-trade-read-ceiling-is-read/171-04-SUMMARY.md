---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 04
subsystem: analytics-service
tags: [trade-read, resumable-read, store, postgrest, bybit, contextvar]

requires:
  - phase: 171-readceiling
    provides: "plan 03's tables allocator_trade_reads and allocator_trade_read_windows (column names only; this plan does not run against them)"
provides:
  - "services/trade_read_store.py: positional trade projection, chunked per-window store, claim bookkeeping (stalled-claims and job-age stops), scoped purges, ContextVar scope, claim deadline, TradeReadDeferred and TradeReadStalled"
  - "tests/test_trade_read_store.py: 23 tests over a JSON-round-tripping fake client"
  - "tests/test_equity_reconstruction.py: _FakeTable.lt, and a delete that honours range and in filters through one predicate shared with select"
affects: [171-07, 171-08, 171-09, 171-10]

actuals:
  tokens: 17200
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "store-fault disposition: None / False / normal return, one class-only WARNING, CancelledError propagates"
    - "ContextVar scope with default None carries the store into a pinned call"
    - "chunked jsonb windows (at most 5,000 trades per request body)"

key-files:
  created:
    - analytics-service/services/trade_read_store.py
    - analytics-service/tests/test_trade_read_store.py
  modified:
    - analytics-service/tests/test_equity_reconstruction.py

key-decisions:
  - "Window metadata is paged by what each page returned and ends on an EMPTY page, not a short one, because a server row cap below the page size makes every page short"
  - "n_trades-versus-array and malformed-trade defects are caught at load_window (metadata never reads the trades column); the database refuses those rows anyway"
  - "purge_expired uses lte (expires_at <= now), the exact complement of the validity test (expires_at > now)"
  - "an empty window is stored as one empty chunk: 'this window held nothing' is a result worth keeping"

patterns-established:
  - "A purge or delete test over the fake is only meaningful once the fake's delete filters like its select (pinned first by test_the_fake_delete_honours_range_and_in_filters)"

requirements-completed: [SC-1]

duration: 31min
completed: 2026-10-27
status: complete
commits: 3
plan_head_before: dc161d9a6651ae50cbba5b6b43a198ee62453692
plan_head_after: 9a6e51e7ab1b1fa275c06c585bb268f43c040267
---

# Phase 171 Plan 04: the trade-read store Summary

**A self-contained store keeps each complete 7-day Bybit window as compact positional trades in chunks of at most 5,000, reads them back as the same trade dicts in the same order, discards anything stale or half-written, and stops a job that makes no progress by name (three stalled claims or a 24 h job age), with every store fault answered as a disposition and never a crash.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-10-27T12:18Z
- **Completed:** 2026-10-27T12:49Z
- **Tasks:** 3 of 3
- **Files:** 2 created, 1 modified (nothing outside the plan's `files_modified`)

## Accomplishments

- Tracer (Task 1): 12,001 ccxt-shaped trades (a third of the fees a dict with a None cost, a third a float, a third None; every seventh `cost` None; prices that are not exactly representable) were saved, written as three chunk rows of 5,000 / 5,000 / 2,001 sharing `chunk_count` 3, and loaded back through `begin_claim`'s metadata and `load_window` as exactly `[unproject_trade(project_trade(t)) for t in originals]`, every `timestamp`, `price`, `amount` and `cost` `==` the original. `_compute_daily_equity` gives equal rows over the originals and over the round-tripped dicts for all four fee shapes, and a control assertion shows a fee is not noise to the replay (so the equality can fail).
- Claim bookkeeping (Task 2): state discarded on another read version, an expired state or an earlier start (a later start keeps state and windows, and the grid origin stays the first claim's start); a new job starts at zero stalled claims and keeps the windows; the fourth `begin_claim` of one job without progress raises `TradeReadStalled("stalled_claims", 3)` and writes nothing; `record_progress` resets the count; `job_too_old` treats an unreadable `created_at` as too old; scoped purges; metadata paging past a row cap.
- Scope (Task 3): frozen `TradeReadScope` in a `ContextVar[TradeReadScope | None]` (default None), a resetting context manager (also on an exception, and isolated per asyncio task), a monotonic-seam deadline, and counts-only stop signals that `classify_exception` does not call permanent.
- Nothing imports `job_worker` or `equity_reconstruction`; nothing calls the store yet.

## Task Commits

1. **Task 1 (tracer): one complete window stored in chunks and read back as the same trades** - `2a443d598` (feat)
2. **Task 2: claim bookkeeping, the stalled and job-age stops, scoped purges, paging, the fake's delete filtering** - `ac8fd1d71` (feat)
3. **Task 3: the scope, the deadline, the deferral signal, log hygiene, drills F-I** - `9a6e51e7a` (feat)

`plan_head_before` (also `PLAN_BASE`) `dc161d9a6651ae50cbba5b6b43a198ee62453692`; `rev-list --count` over the plan: 3.

## Verification evidence

- RED first, each recorded: `red.log` (both tracer tests FAILED, import error not collection error), `red-fake.log` (`test_the_fake_delete_honours_range_and_in_filters` FAILED before the fake change), `red-task2.log` (11 failed), `red-task3.log` (2 failed).
- Full analytics suite (from `analytics-service/`): before the fake change `1 failed (the new fake test, RED), 12927 passed, 96 skipped`; after the fake change, with `test_trade_read_store.py` ignored so only the other tests judge the fake, `12925 passed, 96 skipped` (12927 minus the two tracer tests); final, everything, `12948 passed, 96 skipped` (12925 + 23). No existing test changed outcome. The 96 skips are the same count before and after and are not from this plan.
- CI mypy line verbatim: `Success: no issues found in 124 source files` after each task.
- Drills (module backed up to `store.fixed`, edited, test run, restored with `cp`, `cmp` exit 0 each time):

| Drill | Edit | FAILED line | cmp |
|-------|------|-------------|-----|
| F version gate | `_state_usable` stops checking `read_version` | `FAILED ...::test_stale_state_is_discarded[another_version]` | 0 |
| G whole-window gate | `_meta_of` accepts an incomplete chunk set | `FAILED ...::test_a_half_written_window_is_not_used` | 0 |
| H the stop | `>= STALLED_CLAIMS_LIMIT` becomes `> STALLED_CLAIMS_LIMIT + 100` | `FAILED ...::test_three_stalled_claims_of_one_job_stop_by_name` (and `test_a_new_job_starts_with_a_fresh_count_and_the_stored_windows`) | 0 |
| I fault disposition | `begin_claim`'s `except Exception` removed | `FAILED ...::test_a_store_fault_is_a_disposition_not_a_crash` (and `test_no_store_log_line_carries_a_stored_value`) | 0 |
| J (extra) paging | stop on a short page | `FAILED ...::test_metadata_is_paged_past_a_row_cap` | 0 |
| K (extra) non-finite guard | `_storable` skips the finite check | `FAILED ...::test_a_non_finite_value_is_not_stored[nan|inf|-inf]` | 0 |

## Decisions Made

- **Paging ends on an empty page.** The contract said "until a short page", but `test_metadata_is_paged_past_a_row_cap` (row cap 2, page size 500) makes every page short, so a short-page stop would report two windows of seven. Each request advances by the rows it returned and the loop ends on an empty page (one extra request), with a hard page bound (`_META_MAX_PAGES`) that raises into the fault disposition.
- **Stored `expires_at` is a fixed-width UTC ISO string** (`isoformat(timespec="microseconds")`), so string comparison in the fake orders like time and PostgREST parses it as timestamptz.
- **State upsert is conflict-keyed on `api_key_id`; chunk upserts on `api_key_id,window_start_ms,chunk_index`.** `created_at` is left to the database default.
- **`purge_expired` runs windows first, then state, in one try**: one WARNING per call, whichever table fails.

## Deviations from Plan

### Auto-fixed / judgment calls

**1. [Rule 1 - contract vs test] Defects metadata cannot see are caught at load**
- **Found during:** Task 2 (`test_a_half_written_window_is_not_used`)
- **Issue:** the plan's test says a chunk whose `n_trades` differs from its array length is "absent from `stored`", but the contract also says `begin_claim` never reads the trades column, so the array length is unknowable there. The same holds for a malformed trade row.
- **Fix:** the four metadata-visible defects (missing chunk, two chunk counts, another version, an expired chunk) are asserted absent from `stored`; the two metadata-invisible ones are asserted unusable (`load_window` returns None with one WARNING). The database's `_array_chk` makes the count mismatch unrepresentable in production.
- **Files:** `analytics-service/tests/test_trade_read_store.py`

**2. [Rule 3 - scaffolding order] `TradeReadScope`, `job_too_old` and both exception classes landed in Task 2**
- `test_the_job_age_backstop` (a Task 2 test) needs a scope to ask; the ContextVar, the context manager, the deadline and the log-hygiene test are Task 3 as planned.

**3. Tests that were already green at their RED step**
- Task 1's implementation already satisfied `test_duplicate_writers...`, `test_a_non_finite_value_is_not_stored` and `test_metadata_is_paged_past_a_row_cap`; Task 3's `test_the_stop_signals_carry_counts_only` and `test_no_store_log_line_carries_a_stored_value` were green because Task 2 built the signals and the logging. Drills J and K were added to show the first and third can fail; the log-hygiene test fails under drill I.

**4. Acceptance wording: `grep -ac 'def lt'` is 4, not 1**
- The pattern also matches the existing `def lte` (baseline 3, one of them in unrelated fakes further down the file). The exact `grep -ac 'def lt('` is 1 (baseline 0), which is what the plan's `contains: "def lt("` names.

**5. Scratch directory**
- `/tmp/readceiling-04` is a symlink to a directory under the session scratchpad (the session rule is to use the scratchpad; the plan's verify blocks hardcode `/tmp/readceiling-04`). The venv is a git-ignored symlink to the main checkout's after `requirements.txt` was confirmed byte-identical.

**Total deviations:** none that change a must-have truth; the paging rule above is the one contract-wording departure.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the two tables plan 03 owns; this module reaches them through the service-role client only.

## For the orchestrator and plans 07 to 10

- `begin_claim` raises `TradeReadStalled("stalled_claims", claims)` itself; the `"job_age"` stop is the caller's: check `job_too_old(scope)` and raise `TradeReadStalled("job_age", claims)`.
- `begin_claim` writes `last_job_id`, a UUID column: pass the job's id string (or None), not a free-form token, or the write is refused and the claim reads without the store.
- Call `record_progress` after a claim stores at least one window; the claim is already counted stalled when it starts.
- `save_window` returning False means the window is still held only in the claim; `load_window` returning None means re-read it.
- `STATE_COLUMNS` and `WINDOW_COLUMNS` mirror plan 03's column list exactly (`created_at` is in `WINDOW_COLUMNS` for the static cross-check but is never written, and `updated_at` is written on every state upsert).
- Plan 08's hourly sweep should call `purge_expired(supabase)`.

## Self-Check: PASSED

- `analytics-service/services/trade_read_store.py`, `analytics-service/tests/test_trade_read_store.py`: FOUND.
- Commits `2a443d598`, `ac8fd1d71`, `9a6e51e7a`: ancestors of HEAD on `wt/171-p04`.
- Nothing under `analytics-service/` uncommitted; STATE.md and ROADMAP.md untouched.
