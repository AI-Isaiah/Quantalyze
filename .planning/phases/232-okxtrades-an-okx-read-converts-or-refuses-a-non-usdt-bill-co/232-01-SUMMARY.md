---
phase: 232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co
plan: 01
subsystem: analytics-service sync_trades fills cursor
tags: [VREAD-08, PROOF-01, run_sync_trades_job, advance_sync_cursor, last_fetched_trade_timestamp]
requires:
  - phase: 231
    provides: "dependency-232 hand-off (WR-03, gap 1): a raised fetch advanced the fills cursor"
provides:
  - "api_keys.last_fetched_trade_timestamp is a stored-through mark: the newest persisted fill or untouched"
  - "the fills read seeds from min(cursor, stored fills high-water), so an ahead key re-reads its skipped days"
  - "a bootstrap refusal anchors the cursor at its read start"
affects: [222-ALERTTRUTH (re-bases on run_sync_trades_job), 232-02, 232-03]
tech-stack:
  added: []
  patterns: ["stored-through cursor stamp", "fail-open stored high-water helper", "refuse-then-clean sequence tests"]
key-files:
  created:
    - analytics-service/tests/test_okxtrades_cursor.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/trade_resume.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_ana_recon_audit.py
    - analytics-service/tests/test_sync_trades_resume_seed.py
    - analytics-service/tests/test_mt5_sync_path.py
key-decisions:
  - "Ruling Q1 seed rule min(column, newest stored fill else daily seed) and the bootstrap anchor, as ruled"
  - "Ruling Q7: any truthy sync_truncated_* flag holds the cursor"
  - "Planner refinement: the anchor also covers a partial persist (same unstored span, same flag)"
requirements-completed: [VREAD-08, PROOF-01]
duration: ~95 min
completed: 2026-11-24
status: complete
actuals:
  tokens: 13300
  tasks: 3
  commits: 3
plan_head_before: 5e9524f7ef181f83cb9cf1ceb85c4277f9b2ff1e
plan_head_after: 94fd95693a9095283421d2c03214c00e8fe938c2
commits: 3
---

# Phase 232 Plan 01: VREAD-08 fills cursor never runs ahead of stored trades

The fills cursor now stamps the ISO timestamp of the newest fill a run persisted (or nothing), holds on every refused, partial, truncated or Phase-1-failed read, and the fills read is clamped to the stored fills high-water so a key found ahead re-reads its skipped days.

closes-todos: 167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD (VREAD-08)

## Environment

Interpreter: Python 3.12.13, ccxt 4.5.89, mypy 2.4.0, in the worktree-local git-ignored `analytics-service/.venv` (base interpreter taken from the main checkout's venv, which was not modified). CI mypy command: `Success: no issues found in 142 source files`.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | e33b47829 | epilogue gate and stored-through stamp; `test_okxtrades_cursor.py` harness + 2 tracer arms |
| 2 | e1b80dae0 | `load_strategy_fill_high_water`, clamped seed, `fills_anchor_iso` and the anchor; the 11 other arms |
| 3 | 94fd95693 | test flips, C-1 test rewritten to drive the job, MT5 assertion, docstring, one added arm |

Final verification (the plan's affected set, 12 files): `484 passed, 31 skipped` (all 31 skips are live-DB / lane tests that need `LANE_DB_URL` or a configured test Supabase project, unset locally; none is in a file this plan edited except `test_job_worker.py:4283`, a lane test, unchanged). `node scripts/verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.`

## Task 1 RED lines taken on HEAD (before any production edit)

```
E       AssertionError: a refused fills read must hold the fills cursor (VREAD-08); the old rule stamped wall-clock now
E       assert '2026-11-24T15:45:42.196663+00:00' is None
E       AssertionError: assert '2026-11-24T1....262504+00:00' == '2026-06-01T09:00:00+00:00'
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_a_refused_fills_read_holds_the_cursor
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_the_cursor_stamps_the_newest_stored_fill_not_now
2 failed in 13.89s
```

## Task 2 RED lines (tests written first, run on the Task-1 code before the seed and anchor edits)

```
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_an_ahead_cursor_reads_from_the_newest_stored_fill
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_an_ahead_cursor_with_no_stored_fill_reads_from_the_daily_seed
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_a_failed_fill_high_water_read_takes_the_earlier_of_cursor_and_daily_seed
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_a_bootstrap_refusal_anchors_at_the_read_start
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_a_partial_persist_at_bootstrap_anchors_at_the_read_start
FAILED tests/test_okxtrades_cursor.py::TestFillsCursorNeverRunsAhead::test_bootstrap_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears
6 failed, 11 passed in 5.13s
```
After the edits: `20 passed in 4.60s` (`test_okxtrades_cursor.py` + `test_sync_trades_resume_seed.py`).

## Test flips (old and new expectation)

- `tests/test_job_worker.py::TestAdvanceSyncCursorFence::test_threads_claim_token_when_fence_on` (ingestion OFF): `assert params["p_last_fetched_ts"] is not None` became `is None`, message: no fill was persisted so the fills cursor is left untouched (VREAD-08); before Phase 232 it stamped wall-clock now.
- `tests/test_ana_recon_audit.py::test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance` rewritten in place, same name, async: old body re-typed `(not raw_fills) or (phase2_complete and not phase1_failed)` inline and grepped the source (could never go RED). New body drives the real `run_sync_trades_job` with the `sync_trades` RPC raising (`phase1_failed`), two fills persisted, asserts `p_last_fetched_ts is None` and `p_last_sync_at is None`, plus a control run (RPC succeeds) asserting the stamp equals the newest fill's ISO timestamp.
- `tests/test_mt5_sync_path.py::test_run_sync_trades_job_mt5_routes_balance_and_skips_ccxt`: added `advance["p_last_fetched_ts"] is None` beside the `p_last_sync_at` assertion.
- `tests/test_sync_trades_resume_seed.py`: module docstring only, decision 4 restated as the earlier of the cursor and the stored fills high-water.
- No other test in the census broke. `TestSyncTradesPhase2PartialBatchFailure` is unedited and green.

guard-note: `TestSyncTradesPhase2PartialBatchFailure` stays green only because its `key_row` has no fills column and its bare MagicMock supabase yields no daily seed, so `fills_anchor_iso` is None and the anchor writes nothing. It is NOT proof that a partial persist never anchors; that case is `test_a_partial_persist_at_bootstrap_anchors_at_the_read_start`.

## HEAD (pre-fix) RED of the flipped and new-assertion tests

Pre-fix `services/job_worker.py` from base `5e9524f7e` swapped in (byte backup, restored with `cp`, `cmp` identical):

```
FAILED tests/test_mt5_sync_path.py::test_run_sync_trades_job_mt5_routes_balance_and_skips_ccxt
FAILED tests/test_job_worker.py::TestAdvanceSyncCursorFence::test_threads_claim_token_when_fence_on
FAILED tests/test_ana_recon_audit.py::test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance
(+ 16 arms of tests/test_okxtrades_cursor.py)
19 failed, 170 passed, 1 skipped
E   AssertionError: the MT5 arm reads no fills, so the fills cursor is left untouched (VREAD-08); before Phase 232 it stamped wall-clock now
E   AssertionError: no fill was persisted, so the fills cursor must be left untouched (VREAD-08); before Phase 232 it stamped wall-clock now
E   AssertionError: assert '2026-11-24T1....426405+00:00' == '2026-06-01T09:00:00+00:00'
```
(On pre-fix code the rewritten C-1 test passes its Phase-1-failed hold line, since the old gate already held there, and goes RED on its control line, where the old code stamped now instead of the newest fill.)

## PROOF-01 records

Scratch directory (outside the repo, `mktemp -d`): `/var/folders/3y/kf3qlnbx58v3jnwys2pc89_r0000gn/T/tmp.zJLlCfiB6W`, byte backup `job_worker.py.bak` of the final `services/job_worker.py`. Each block: neuter edit, RED run, `cp` restore, `cmp` (no output, exit 0), GREEN run. No `git checkout`, `restore` or `stash` was used.

### N1 gate also passes on an empty fill list and stamps wall-clock now
```
-    advance_fetched_cursor = (
+    advance_fetched_cursor = (not raw_fills) or (
-            _p_last_fetched = max(coerce_to_aware_utc(fill["timestamp"], "sync_trades") for fill in raw_fills).isoformat()
+            _p_last_fetched = datetime.now(timezone.utc).isoformat()
$ pytest tests/test_okxtrades_cursor.py tests/test_mt5_sync_path.py tests/test_job_worker.py tests/test_ana_recon_audit.py -q --tb=line
FAILED ...::test_a_refused_fills_read_holds_the_cursor
FAILED ...::test_the_cursor_stamps_the_newest_stored_fill_not_now
FAILED ...::test_a_truncated_fills_read_holds_the_cursor
FAILED ...::test_a_run_with_no_fills_leaves_the_column_untouched[ingestion-off]
FAILED ...::test_a_run_with_no_fills_leaves_the_column_untouched[clean-empty-read]
FAILED ...::test_an_unparsable_fill_timestamp_holds_the_cursor[unparsable]
FAILED ...::test_an_unparsable_fill_timestamp_holds_the_cursor[missing]
FAILED ...::test_a_bootstrap_refusal_anchors_at_the_read_start
FAILED ...::test_a_bootstrap_refusal_with_no_seed_writes_nothing
FAILED ...::test_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears
FAILED ...::test_bootstrap_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears
FAILED tests/test_mt5_sync_path.py::test_run_sync_trades_job_mt5_routes_balance_and_skips_ccxt
FAILED tests/test_job_worker.py::TestAdvanceSyncCursorFence::test_threads_claim_token_when_fence_on
FAILED tests/test_ana_recon_audit.py::test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance
14 failed, 175 passed, 1 skipped, 50 warnings in 5.70s
test_okxtrades_cursor.py:342: AssertionError: a refused fills read must hold the fills cursor (VREAD-08); the old rule stamped wall-clock now
test_mt5_sync_path.py:349: AssertionError: the MT5 arm reads no fills, so the fills cursor is left untouched (VREAD-08); ...
$ cp byte-backup services/job_worker.py ; cmp services/job_worker.py byte-backup   -> identical (exit 0, no output)
GREEN: 189 passed, 1 skipped, 50 warnings in 7.87s
```

### N2 drop only the `not phase2_failed` conjunct (arm redesigned, see Deviations)
```
-        and not phase2_failed
         and not phase1_failed
$ pytest tests/test_okxtrades_cursor.py -q --tb=line
test_okxtrades_cursor.py:469: AssertionError: a Phase-2-failed run holds the stored-through stamp; the only write is the bootstrap anchor at the read start
FAILED ...::test_a_failed_phase_two_holds_the_cursor_even_with_fills_in_hand
1 failed, 17 passed in 5.29s
cmp vs byte backup: identical (exit 0, no output)
GREEN: 18 passed in 4.73s
```

### N3 stamp wall-clock now under the new gate
```
-            _p_last_fetched = max(coerce_to_aware_utc(...) for fill in raw_fills).isoformat()
+            _p_last_fetched = datetime.now(timezone.utc).isoformat()
$ pytest tests/test_okxtrades_cursor.py -q --tb=line
test_okxtrades_cursor.py:353: AssertionError: assert '2026-11-24T1....753999+00:00' == '2026-06-01T09:00:00+00:00'
FAILED ...::test_the_cursor_stamps_the_newest_stored_fill_not_now
FAILED ...::test_a_truncated_fills_read_holds_the_cursor
FAILED ...::test_an_unparsable_fill_timestamp_holds_the_cursor[unparsable]
FAILED ...::test_an_unparsable_fill_timestamp_holds_the_cursor[missing]
4 failed, 13 passed in 11.85s
cmp vs byte backup: identical (exit 0, no output)
GREEN: 17 passed in 15.86s
```
(The three non-stamp arms went RED because the neuter bypasses the `try` that catches an undatable fill, and the truncated arm's control run stamps.)

### N4 seed the fills read from the parsed column alone
```
-                fills_since_ms = (None if _seed_bound_ms is None else min(_fills_cursor_ms, _seed_bound_ms))
+                fills_since_ms = _fills_cursor_ms
$ pytest tests/test_okxtrades_cursor.py -q --tb=line
FAILED ...::test_an_ahead_cursor_reads_from_the_newest_stored_fill
FAILED ...::test_an_ahead_cursor_with_no_stored_fill_reads_from_the_daily_seed
FAILED ...::test_a_failed_fill_high_water_read_takes_the_earlier_of_cursor_and_daily_seed
3 failed, 14 passed in 15.71s
cmp vs byte backup: identical (exit 0, no output)
GREEN: 17 passed in 8.61s
```

### N5 drop the `sync_truncated_` conjunct
```
-        and not any(key.startswith("sync_truncated_") and value for key, value in exchange_dq_flags.items())
$ pytest tests/test_okxtrades_cursor.py -q --tb=line
test_okxtrades_cursor.py:429: AssertionError: a truncated fills read must hold the fills cursor (ruling Q7)
FAILED ...::test_a_truncated_fills_read_holds_the_cursor
1 failed, 16 passed in 8.11s
cmp vs byte backup: identical (exit 0, no output)
GREEN: 17 passed in 11.65s
```

### N6 drop the anchor assignment
```
-        _p_last_fetched = fills_anchor_iso
+        _p_last_fetched = None
$ pytest tests/test_okxtrades_cursor.py -q --tb=line
test_okxtrades_cursor.py:512: AssertionError: assert None == '2026-05-07T00:00:00+00:00'
test_okxtrades_cursor.py:542: AssertionError: assert None == '2026-05-07T00:00:00+00:00'
test_okxtrades_cursor.py:603: AssertionError: the anchor is written
FAILED ...::test_a_bootstrap_refusal_anchors_at_the_read_start
FAILED ...::test_a_partial_persist_at_bootstrap_anchors_at_the_read_start
FAILED ...::test_bootstrap_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears
3 failed, 14 passed in 5.75s
cmp vs byte backup: identical (exit 0, no output)
GREEN: 17 passed in 4.57s
```

### N7 a column with no stored fill falls back to the daily seed alone
```
-                    else min(_fills_cursor_ms, _seed_bound_ms)
+                    else (_seed_bound_ms if _fill_hw_ms is None else min(_fills_cursor_ms, _seed_bound_ms))
$ pytest tests/test_okxtrades_cursor.py -q --tb=line
FAILED ...::test_bootstrap_refusal_then_clean_rereads_the_refused_span_before_the_flag_clears
1 failed, 16 passed in 6.40s
cmp vs byte backup: identical (exit 0, no output)
GREEN: 17 passed in 6.15s
```
(N2 to N7 GREEN counts of 17 predate the 18th arm added after the N2 finding; the final file is `18 passed` for `test_okxtrades_cursor.py`.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's neuter design] N2 could not bite the planned arm**
- **Found during:** Task 3 PROOF-01.
- **Issue:** the plan expected dropping `not phase2_failed` to turn the refused arm RED. It does not: a raised fetch leaves `raw_fills` empty, which already fails the gate, so the conjunct is redundant on that path (first N2 run: `17 passed`, neuter did not bite).
- **Fix:** found the one reachable state where the conjunct matters (fills returned, then the DQ drain raises inside the same try: fills in hand, persisted, Phase 2 marked failed) and added `test_a_failed_phase_two_holds_the_cursor_even_with_fills_in_hand` (a 14th arm; `_run_job` gained a `fills_drain_error` argument). N2 now goes RED on it.
- **Files modified:** `analytics-service/tests/test_okxtrades_cursor.py`. **Commit:** 94fd95693.

**2. [Rule 2 - Robustness] stamp `except` tuple widened**
- The plan names `KeyError`/`ValueError`. The epilogue runs after the fills are persisted, so any other error from dating a fill would fail an otherwise-done job. The tuple is `(KeyError, ValueError, TypeError, OverflowError, OSError)` (the last two come from `datetime.fromtimestamp` on a huge ms value). The WARNING still names only the strategy and the exception class. **Commit:** e33b47829.

None beyond these. The code changes otherwise follow the plan and rulings as written.

## Records

planner-refinement: the bootstrap anchor also covers a partial persist (`phase2_failed` True with the column NULL and a non-NULL seed), not only a raised fetch; both leave an unstored span under the same `phase2_fill_ingestion_failed` flag. Pinned by `test_a_partial_persist_at_bootstrap_anchors_at_the_read_start`; reversible by deleting the `elif` branch.

handoff-222: routed by name to Phase 222 ALERTTRUTH (shares `run_sync_trades_job`, re-bases on it): (1) gap 3, the Phase-1 persist ordered after the Phase-2 walk, so a first sync whose walk hits the 900 s handler timeout loses that run's Phase-1 daily P&L; (2) the Phase-1 store under flags; (3) the public `daily_pnl_*` flags no run ever clears; (4) the flags no run ever stores: with `USE_RAW_TRADE_INGESTION` off and Phase 1 fine, `needs_flag_write` is False, so a drained `daily_pnl_*` refusal flag (plan 232-03's `daily_pnl_non_usd_okx` among them) never reaches `data_quality_flags` while `last_sync_at` still advances. All in `run_sync_trades_job`, outside this fence.

handoff-coordinator: one-time post-merge PROD repair of columns already ahead (marker query first). Set `last_fetched_trade_timestamp` to the newest stored fill, NULL where none; a direct UPDATE because the RPC's CASE cannot lower the column. Counts before, from CONTEXT (2026-11-24): Bybit 1 key ahead by 33.0 days, OKX 2 keys ahead by at most 6.0 days, plus the stale wall-clock stamps on keys with no stored fill (Bybit 4, OKX 2, MT5 10). Counts after: taken by the coordinator, then the TODOS gate's repeated read. The read clamp makes an ahead column harmless at once; the repair only removes the stale values.

consequence: a quiet key's fills window now grows every run from its last stored fill (the cursor no longer jumps to now). A Bybit key whose last fill is older than two years refuses its fills read each run (`BybitTradeWindowIncomplete`).

ship-note: keep `USE_RAW_TRADE_INGESTION` off until this phase is on main. The ship PR deletes the `TODOS.md` entry `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` and names it in the CHANGELOG entry. The one live code pointer to it (the comment above the fills seed) was rewritten in Task 2; this plan did not edit `TODOS.md`, `CHANGELOG.md` or `VERSION`.

known-limit: a first sync whose daily seed is NULL (full reach) has nothing to anchor; accepted per ruling Q1 (raw ingestion is off).

## job_worker.py diff hunk headers (`git diff -U0 5e9524f7e HEAD -- analytics-service/services/job_worker.py`)

```
@@ -129,0 +130 @@ from services.exchange_pagination import PaginationCeilingExceeded
@@ -137 +138,4 @@ from services.sfox_client import SfoxClient  # type annotations only
@@ -2125,0 +2130,4 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2226,5 +2234,13 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2233 +2249 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2234,0 +2251,17 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2654,10 +2687,3 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2665,14 +2691,55 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2694,4 +2761,5 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2709 +2776,0 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
@@ -2713,2 +2780,2 @@ async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
```
Every hunk is inside `run_sync_trades_job` or on the two import spans (lines 130 and 138 to 141). No migration, no RPC change, no edit to `run_sync_funding_job`, `okx_archive_job.py`, `funding_fetch.py`, `services/exchange.py` or the realized-refusal sets.

## Known Stubs

None.

## Threat Flags

None. T-232-01 (stamp), T-232-02 (flag survives until covered) and T-232-03 (log names strategy and exception class only; asserted in `test_an_unparsable_fill_timestamp_holds_the_cursor`) are mitigated.

## Self-Check: PASSED

Files found: `analytics-service/tests/test_okxtrades_cursor.py`, `analytics-service/services/trade_resume.py` (`def load_strategy_fill_high_water`), this SUMMARY. Commits found on HEAD: e33b47829, e1b80dae0, 94fd95693. `git rev-list --count 5e9524f7e..HEAD` = 3 at write time (the SUMMARY commit follows).

## post-merge:

Approved one-time PROD step (coordinator, 2026-11-24). NOT run during execution or ship. The phase agent runs it only after Phase 232 has merged AND Railway has deployed the merge commit.

1. Marker query first, via the Supabase MCP on the project named in `supabase/.temp/project-ref`:
   `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`
   It must return the PRODUCTION comment. NULL or anything else: stop, write nothing.
2. Read (counts only, no ids or values in tracked text): how many `api_keys` rows have `last_fetched_trade_timestamp` ahead of the newest stored fill (`trades.is_fill = true`, joined through `strategies.api_key_id`), and how many have a non-NULL timestamp with no stored fill at all.
3. One-time UPDATE scoped by the explicit key ids found in step 2 (a literal id list, never an unscoped predicate): set `last_fetched_trade_timestamp` to that key's newest stored fill timestamp, or NULL where the key has no stored fill.
4. Re-run the step-2 read; both counts must be 0. Report counts before and after only.

### Result: DONE (2026-11-24)

On 2026-11-24, after #1330 (3e7d377da) merged, main CI went green (CI, Contracts) and Railway deployed 3e7d377da on both services (SUCCESS). The marker query ran first and returned the PRODUCTION comment. The UPDATE was scoped by 20 explicit key ids and also guarded by the "ahead" predicate.

Before:
- 20 keys had `last_fetched_trade_timestamp` ahead of their newest stored fill.
- Bybit 5: 4 with no stored fill, 1 ahead of a stored fill.
- MT5 10: all with no stored fill.
- OKX 5: 2 with no stored fill, 3 ahead of a stored fill.

Updated: 20 rows.
- Set to NULL: 16 (Bybit 4, MT5 10, OKX 2).
- Set to the newest stored fill: 4 (Bybit 1, OKX 3).

After:
- 4 keys have a cursor set, and all 4 equal their newest stored fill.
- 0 keys are ahead of their newest stored fill.

This also closes the TODOS gate's repeated-read check: the same read now finds 0 keys ahead.
