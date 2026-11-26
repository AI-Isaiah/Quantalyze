---
phase: 253-binancecursor-a-stopped-binance-fills-read-below-a-cursor-th
plan: 04
subsystem: analytics-service
tags: [binance, data-quality-flags, derive-prestamp, csv-rebuild, failure-writers, flag-clear, proof-01]
requires:
  - "253-02: _binance_read local in run_sync_trades_job and the binance_stop_below_cursor predicate"
provides:
  - "services/binance_sync_flags.py: BINANCE_SYNC_FLAG_KEYS (nine keys), carry_binance_sync_flags, clear_absent_binance_sync_flags, read_binance_sync_flags (guarded, never raises)"
  - "the nine sync-time binance_* keys survive the derive prestamp, the CSV rebuild and the derive-failed, insufficient-history, truncated and config-failed stamps"
  - "the next clean Binance sync clears every allowlisted key it did not raise (D-09)"
  - "the _RAW_TRADE_INGESTION_ENABLED comment says the SC-3 gap is closed and how; the TODOS entry is deleted"
affects: [ship]
tech-stack:
  added: []
  patterns: ["explicit allowlist with per-key shape validators (the _last_success_snapshot isinstance posture)", "guarded read that never raises so a failure stamp always lands", "ast parity scan tying an allowlist to its producers"]
key-files:
  created:
    - analytics-service/services/binance_sync_flags.py
    - analytics-service/tests/test_binance_sync_flags.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_csv_analytics_runner.py
    - analytics-service/tests/test_binancefills_cursor.py
    - analytics-service/tests/test_stamp_io_exhaustive.py
    - TODOS.md
key-decisions:
  - "Open Question 1 resolved by CARRYING, failure writers included (plan-checker revision 1): one guarded read, read_binance_sync_flags, serves the four wholesale failure writers; a failing read logs one WARNING and carries nothing, the stamp lands."
  - "The clear is gated on _binance_read and not phase2_failed and not flag_load_failed (D-09); it runs outside the exchange_dq_flags_present branch because the clean path has an empty drain."
  - "test_stamp_io_exhaustive.py (not in the plan's files_modified) was taught the guarded read's own disposition instead of weakening the guarded read; see Deviations."
status: complete
actuals:
  tokens: 12476
  tasks: 3
  commits: 4
plan_head_before: 03cb2ae7414b4778fbff41cced3d8f68053ff7b2
plan_head_after: 893d9ab1178b5f1b56aba6f9b77de28a2948ef3d
commits: 4
---

# Phase 253 Plan 04: the run-time signal lasts, and the records say the gap is closed

A sync-time `binance_*` data-quality key now outlives the chained derive and the CSV rebuild (and every wholesale failure stamp between them), and is cleared by the next Binance sync that did not raise it; the `_RAW_TRADE_INGESTION_ENABLED` comment says the SC-3 gap is closed and the closed TODOS entry is gone.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | 4d33d07f0 | feat(253-04): carry the sync-time binance_* data-quality keys through the derive prestamp, the CSV rebuild and every failure writer |
| 2 | 12f5e6354 | feat(253-04): the next clean Binance sync clears the binance_* keys it did not raise, and the allowlist is pinned to its producers |
| 3a (deviation) | fc542c562 | test(253-04): the stamp-I/O census holds the guarded binance_* flag read to its own disposition |
| 3b | 893d9ab11 | docs(253-04): the open SC-3 gap comment at _RAW_TRADE_INGESTION_ENABLED says it is closed and how; the closed TODOS entry is deleted |

`commits: 4` is MEASURED from the on-disk ledger (`git rev-list --count 03cb2ae74..HEAD`, run before this SUMMARY's own commit). `actuals.tokens` is chars/4 over the added lines of `analytics-service` between `03cb2ae74` and `893d9ab11` (49904 chars).

## What shipped

- **`services/binance_sync_flags.py` (new leaf, imports `logging`, `copy`, `typing` only).** `BINANCE_SYNC_FLAG_KEYS` is the explicit nine-key allowlist (never a prefix match): True-only `binance_fills_reach_clamped`, `binance_fill_cursor_advance_plus1`, `binance_stop_below_cursor`; non-empty list of str `binance_partial_symbols`, `binance_unlisted_symbols`, `binance_page_cap_symbols`, `binance_untimed_page_symbols`, `binance_deadline_symbols`; non-negative non-bool int `binance_read_through_ms`. `carry_binance_sync_flags(flags)` returns deep copies of the valid ones (`{}` for a non-dict, never raises, logs nothing). `clear_absent_binance_sync_flags(existing, fresh)` pops every allowlisted key absent from `fresh` and reports whether it popped. `read_binance_sync_flags(supabase, strategy_id)` is one `strategy_analytics` read that returns the carried keys and, on ANY exception, logs one WARNING naming the strategy and the exception class and returns `{}`.
- **`run_derive_broker_dailies_job`.** The raw row of the existing last-success read is kept in `_prior_analytics_row` (same read, same failure behaviour); one `_prestamp_flags.update(carry_binance_sync_flags(...))` beside the `LAST_SUCCESS_SNAPSHOT_KEY` assignment, behind an `isinstance(..., dict)` guard, so a first derive with no prior row writes exactly today's flags. The nested `_upsert` of the derive-failed stamp builds `{"csv_source": True, **read_binance_sync_flags(ctx.supabase, strategy_id)}` before the payload dict.
- **`run_csv_strategy_analytics`.** `DataQualityFlags` declares the nine keys; one carry after the `daily_pnl_malformed_` loop, outside both `_warned` loops, so a flagged strategy stays exact-string `complete`. `_mark_failed` (insufficient history), `_mark_truncated` and `_mark_config_failed` build their flags with the guarded read. `_mark_unrecoverable` is unchanged and pinned by an arm.
- **`run_sync_trades_job` flag merge (D-09).** After the `exchange_dq_flags_present` branch: when `_binance_read and not phase2_failed and not flag_load_failed`, `clear_absent_binance_sync_flags(existing_flags, exchange_dq_flags)`; one `elif` in the non-failed chain sets `write_needed` when only the clear changed the row.
- **Records.** The second-gap paragraph of the `_RAW_TRADE_INGESTION_ENABLED` comment is rewritten in present tense (per-strategy re-read bound through the fenced `set_strategy_fills_reread_bound` of migration `20261126140000`, round-3 predicate, flags carried through derive and CSV rebuild on the failure writes too, cleared by the next clean sync); the switch stays off for Binance and no Phase 253 plan turns it on (SC-4, D-10). The constant and its env read are byte-unchanged. The first FIX MID-TERM entry of `TODOS.md` (bullet and four sub-bullets, 6 lines) is deleted.

## Verification

| Check | Result |
|---|---|
| plan task 1 verify (`-k "binance or BinanceSyncFlag or daily_pnl_malformed or DroppedRow or NavReconstruction or insufficient or truncat or config"`) | `50 passed, 162 deselected` |
| plan task 2 verify (`test_binance_sync_flags.py test_binancefills_cursor.py test_okxtrades_cursor.py`) | `165 passed` |
| plan task 3 verify, six suites (`test_binance_sync_flags`, `test_binancefills_cursor`, `test_okxtrades_cursor`, `test_binancefills_e2e`, `test_derive_broker_dailies_dualmode`, `test_csv_analytics_runner`) | `388 passed, 68 warnings in 14.36s` |
| plan's mypy line: `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py services/analytics_runner.py services/binance_sync_flags.py services/trade_resume.py` | `Success: no issues found in 4 source files` |
| CI's own mypy command (`.github/workflows/ci.yml`, step "Type gate - mypy strict over the running-service surface"): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 145 source files` |
| broad regression, every `tests/test_*.py` naming `run_sync_trades_job`, `run_derive_broker_dailies_job`, `run_csv_strategy_analytics`, `analytics_runner` or `job_worker` (175 files, one process) | FIRST run: `10 failed, 7665 passed, 51 skipped` (all 10 in `test_stamp_io_exhaustive.py`, see Deviation 1). After the census fix that file alone: `112 passed`. The other 174 files were not re-run after the fix (nothing else changed), so the post-fix whole-set number is not measured |
| skips in that run, from `-rs` | 51, all `LANE_DB_URL unset` / `test Supabase project not configured` / `local-stack lane not configured` live-DB arms, one `got empty parameter set` (`test_mt5_validate.py:713`) and one `P1 TODO` pre-existing skip in `test_compute_jobs_fencing.py:1980`. These live arms did NOT run (no Docker here); CI's lane jobs are their first run against this change |
| `grep -c "BINANCE_SYNC_FLAG_KEYS" services/binance_sync_flags.py` | 3 |
| `grep -v '^\s*#' services/job_worker.py \| grep -c "carry_binance_sync_flags("` / same on `analytics_runner.py` | 1 / 1 |
| `grep -v '^\s*#' ... \| grep -c "clear_absent_binance_sync_flags("` on `job_worker.py` | 1 |
| `grep -c "binance_stop_below_cursor: bool" services/analytics_runner.py` | 1 |
| `grep -v '^\s*#' ... \| grep -c '"data_quality_flags": {"csv_source": True},'` on `analytics_runner.py` / `job_worker.py` | 0 / 0 |
| `grep -v '^\s*#' ... \| grep -c "read_binance_sync_flags("` on `analytics_runner.py` / `job_worker.py` | 3 / 1 |
| `grep -c "def test_" tests/test_binance_sync_flags.py` | 16 (88 collected cases) |
| `grep -c "250-BINANCE-STOP-BELOW-CURSOR" TODOS.md` / `services/job_worker.py` | 0 / 0 |
| `grep -a -rln "250-BINANCE-STOP-BELOW-CURSOR" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .` | prints only `CHANGELOG.md` (history, named again at ship). The plan's `\| grep -v "^./CHANGELOG.md$"` filter does not strip it on macOS, because BSD grep prints `CHANGELOG.md` without the `./`; `\| grep -v '^CHANGELOG.md$'` prints nothing |
| `grep -c 'os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true"' services/job_worker.py` | 1 (switch default unchanged) |
| `grep -c "strategy_fills_reread_bounds" services/job_worker.py` | 2 |
| `git diff --quiet HEAD -- .planning/STATE.md .planning/ROADMAP.md` | exit 0 (untouched) |

## Binance API docs

Not consulted in this plan, deliberately: it changes no Binance read semantics (no request parameter, window, page size, ordering or endpoint). It only decides how long the data-quality flags that the existing read already records live on `strategy_analytics`. The spot `GET /api/v3/myTrades` semantics were read in plan 02 (see 253-02-SUMMARY.md); the futures `GET /fapi/v1/userTrades` page was not independently re-read there either (JS-rendered, empty to curl), and it was not re-attempted here.

## PROOF-01 (verbatim)

Script `$SCRATCH/253/plan04/proof.sh` (neuters through `neuter.py`, each requiring exactly one occurrence), output `proof-output.txt`; the F12 and F13 to F16 blocks are `proof-f12.txt` and `proof-f13-16.txt`. Every neuter starts from the post-fix byte backup (`job_worker.py.post`, `analytics_runner.py.post`, `binance_sync_flags.py.post`, `test_stamp_io_exhaustive.py.post`), is restored with `cp`, verified with `cmp`, then the same arm is rerun GREEN. `git checkout`, `restore` and `stash` were never used. The blocks below are the saved output filtered to the neuter diff, the `FAILED` lines, the pytest count lines, the `cmp` lines and the GREEN reruns; pytest's captured source and log dumps (one 200-line dump under F11) are dropped, nothing else is edited. `$SCRATCH` is the executing session's scratchpad directory (a local path, kept out of tracked text).

Plan neuters F1 to F7 and extra neuters F8 to F11 (derive, CSV, clear, parity, failure writers, the guarded read's never-raise):

```
post backups cmp=0
===== F1 =====
neutered occurrences=1
11955,11961c11955
<     _prestamp_flags.update(
<         carry_binance_sync_flags(
<             _prior_analytics_row.get("data_quality_flags")
<             if isinstance(_prior_analytics_row, dict)
<             else None
<         )
<     )
---
>     pass
--- neutered run:
FAILED tests/test_derive_broker_dailies_dualmode.py::TestStrategyModeBinanceSyncFlagCarry::test_the_sync_time_keys_survive_the_prestamp
1 failed, 4 warnings in 6.19s
restore cmp exit=0
--- GREEN rerun:
1 passed, 4 warnings in 5.32s
===== F2 =====
neutered occurrences=1
2395c2395
<             for _binance_key, _binance_value in carry_binance_sync_flags(existing_flags).items():
---
>             for _binance_key, _binance_value in {}.items():
--- neutered run:
FAILED tests/test_csv_analytics_runner.py::test_binance_sync_flags_are_carried_through_the_rebuild_and_never_promote
1 failed in 5.51s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.32s
===== F3 =====
neutered occurrences=1
3025,3028c3025
<             elif binance_flags_cleared:
<                 # Phase 253 (D-09): the clear above removed keys and nothing else changed;
<                 # the row must still be written or the stale keys stay on it.
<                 write_needed = True
---
> 
--- neutered run:
FAILED tests/test_binancefills_cursor.py::TestBinanceSyncFlagClearing::test_a_clean_binance_sync_removes_the_keys_run_one_wrote_and_still_writes_the_row
1 failed in 5.41s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.29s
===== F4 =====
neutered occurrences=1
2973c2973
<         if _binance_read and not phase2_failed and not flag_load_failed:
---
>         if _binance_read and not flag_load_failed:
--- neutered run:
FAILED tests/test_binancefills_cursor.py::TestBinanceSyncFlagClearing::test_a_raised_binance_read_keeps_the_keys_run_one_wrote
1 failed in 5.36s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.28s
===== F5 =====
neutered occurrences=1
48d47
<     "binance_deadline_symbols",
--- neutered run:
FAILED tests/test_binance_sync_flags.py::test_the_allowlist_equals_the_set_of_binance_keys_the_producers_write
1 failed in 5.40s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.29s
===== F6 =====
neutered occurrences=1
6325d6324
<                     **read_binance_sync_flags(ctx.supabase, strategy_id),
--- neutered run:
FAILED tests/test_derive_broker_dailies_dualmode.py::TestStrategyModeBinanceSyncFlagCarry::test_the_derive_failed_stamp_still_carries_the_sync_time_keys
1 failed, 1 warning in 5.32s
restore cmp exit=0
--- GREEN rerun:
1 passed, 1 warning in 5.21s
===== F7 =====
neutered occurrences=1
2621d2620
<                     **read_binance_sync_flags(supabase, strategy_id),
--- neutered run:
>       assert failed[0]["data_quality_flags"] == _BINANCE_FAILED_FLAGS
FAILED tests/test_csv_analytics_runner.py::test_the_truncated_failure_writer_still_carries_the_binance_sync_flags
1 failed in 5.25s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.23s
===== F8 =====
neutered occurrences=1
2973c2973
<         if _binance_read and not phase2_failed and not flag_load_failed:
---
>         if not phase2_failed and not flag_load_failed:
--- neutered run:
FAILED tests/test_binancefills_cursor.py::TestBinanceSyncFlagClearing::test_an_okx_sync_keeps_the_binance_keys
1 failed in 5.27s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.18s
===== F9 =====
neutered occurrences=1
2694d2693
<                     **read_binance_sync_flags(supabase, strategy_id),
--- neutered run:
>       assert await _failed_upsert_flags(sb) == _BINANCE_FAILED_FLAGS
FAILED tests/test_csv_analytics_runner.py::test_the_config_failure_writer_still_carries_the_binance_sync_flags
1 failed in 5.29s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.18s
===== F10 =====
neutered occurrences=1
1978d1977
<                         **read_binance_sync_flags(supabase, strategy_id),
--- neutered run:
>       assert failed[0]["data_quality_flags"] == _BINANCE_FAILED_FLAGS
FAILED tests/test_csv_analytics_runner.py::test_the_insufficient_history_failure_writer_still_carries_the_binance_sync_flags
1 failed in 5.27s
restore cmp exit=0
--- GREEN rerun:
1 passed in 5.29s
===== F11 =====
neutered occurrences=1
132a133
>         raise
--- neutered run:
FAILED tests/test_derive_broker_dailies_dualmode.py::TestStrategyModeBinanceSyncFlagCarry::test_a_failing_prior_flags_read_logs_and_the_failed_stamp_still_lands
FAILED tests/test_csv_analytics_runner.py::test_a_failing_prior_flags_read_never_blocks_the_failure_stamp
2 failed, 1 warning in 5.66s
restore cmp exit=0
--- GREEN rerun:
2 passed, 1 warning in 5.19s
===== final: all touched suites on restored code =====
final cmp job_worker.py exit=0
final cmp analytics_runner.py exit=0
final cmp binance_sync_flags.py exit=0
377 passed, 68 warnings in 8.77s
```

F12 (added with the census fix, Deviation 1): the guarded read re-raises; the new census arm goes RED on all five discovered calls:

```
===== F12 (guarded read re-raises): census arm =====
neutered occurrences=1
132a133
>         raise
--- neutered run:
FAILED tests/test_stamp_io_exhaustive.py::test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp[single-key-loud-over-retracted-row-call1-strategy_analytics.select.eq.maybe_single]
FAILED tests/test_stamp_io_exhaustive.py::test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp[single-key-loud-over-missing-row-call1-strategy_analytics.select.eq.maybe_single]
FAILED tests/test_stamp_io_exhaustive.py::test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp[single-key-unmarked-call0-strategy_analytics.select.eq.maybe_single]
FAILED tests/test_stamp_io_exhaustive.py::test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp[single-key-loud-over-other-source-call1-strategy_analytics.select.eq.maybe_single]
FAILED tests/test_stamp_io_exhaustive.py::test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp[single-key-marked-over-unpublished-row-call0-strategy_analytics.select.eq.maybe_single]
5 failed, 1 passed, 106 deselected, 16 warnings in 6.56s
restore cmp exit=0
--- GREEN rerun:
112 passed, 57 warnings in 7.76s
```

F13 to F16 (added so each shape validator and the clear's fresh-key test are shown to bite; run against `tests/test_binance_sync_flags.py`):

```
===== F13 =====
neutered occurrences=1
63c63
<         return value is True
---
>         return bool(value)
--- neutered run:
FAILED tests/test_binance_sync_flags.py::test_a_true_only_key_rejects_anything_but_true[1-binance_fills_reach_clamped]
FAILED tests/test_binance_sync_flags.py::test_a_true_only_key_rejects_anything_but_true[1-binance_fill_cursor_advance_plus1]
FAILED tests/test_binance_sync_flags.py::test_a_true_only_key_rejects_anything_but_true[1-binance_stop_below_cursor]
FAILED tests/test_binance_sync_flags.py::test_a_true_only_key_rejects_anything_but_true[x-binance_fills_reach_clamped]
FAILED tests/test_binance_sync_flags.py::test_a_true_only_key_rejects_anything_but_true[x-binance_fill_cursor_advance_plus1]
FAILED tests/test_binance_sync_flags.py::test_a_true_only_key_rejects_anything_but_true[x-binance_stop_below_cursor]
restore cmp exit=0
--- GREEN rerun:
88 passed in 5.24s
===== F14 =====
neutered occurrences=1
71c71
<         return isinstance(value, int) and not isinstance(value, bool) and value >= 0
---
>         return isinstance(value, int) and value >= 0
--- neutered run:
FAILED tests/test_binance_sync_flags.py::test_the_read_through_key_rejects_anything_but_a_non_negative_non_bool_int[True]
FAILED tests/test_binance_sync_flags.py::test_the_read_through_key_rejects_anything_but_a_non_negative_non_bool_int[False]
2 failed, 5 passed, 81 deselected in 5.18s
restore cmp exit=0
--- GREEN rerun:
88 passed in 5.23s
===== F15 =====
neutered occurrences=1
65,69c65
<         return (
<             isinstance(value, list)
<             and len(value) > 0
<             and all(isinstance(item, str) for item in value)
<         )
---
>         return isinstance(value, list) and len(value) > 0
--- neutered run:
FAILED tests/test_binance_sync_flags.py::test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str[bad1-binance_partial_symbols]
FAILED tests/test_binance_sync_flags.py::test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str[bad1-binance_unlisted_symbols]
FAILED tests/test_binance_sync_flags.py::test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str[bad1-binance_page_cap_symbols]
FAILED tests/test_binance_sync_flags.py::test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str[bad1-binance_untimed_page_symbols]
FAILED tests/test_binance_sync_flags.py::test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str[bad1-binance_deadline_symbols]
FAILED tests/test_binance_sync_flags.py::test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str[bad2-binance_partial_symbols]
restore cmp exit=0
--- GREEN rerun:
88 passed in 5.40s
===== F16 =====
neutered occurrences=1
103c103
<         if key in existing and key not in fresh:
---
>         if key in existing:
--- neutered run:
FAILED tests/test_binance_sync_flags.py::test_clear_keeps_a_key_the_fresh_run_raised_and_reports_the_rest
1 failed, 87 deselected in 5.43s
restore cmp exit=0
--- GREEN rerun:
88 passed in 5.28s
```

Reading of the proof: F1 and F2 take the derive hop and the CSV hop RED; F6, F7, F9 and F10 take the four wholesale failure writers RED one by one; F3 and F4 and F8 take the clearing arms RED (the write without a changed row, the raised read, the OKX key); F5 takes the parity scan RED; F11 and F12 show the guarded read's "never raises" is load-bearing in both the plan's arms and the census; F13 to F16 show the validators and the clear's `fresh` test bite.

### RED before the fix (TDD sequence, disclosed)

The tasks carry `tdd="true"`; RED and GREEN for each task share ONE commit (no history rewrite). RED was seen before each production edit:

- Task 1: `tests/test_csv_analytics_runner.py -k "binance_sync or insufficient_history_failure or failing_prior or truncated_failure or config_failure or unrecoverable_failure"`: `5 failed, 8 passed, 84 deselected` (the CSV hop and the four failure-writer arms RED; the seven malformed-value arms and the unrecoverable pin were GREEN as they must be before the fix: they assert absence, and `_mark_unrecoverable` is unchanged). `tests/test_derive_broker_dailies_dualmode.py -k BinanceSyncFlagCarry`: `3 failed, 3 passed` (the prestamp hop, the failed-stamp carry and the failing-read arm RED; the three no-prior-row arms GREEN, they are the T-253-14 safety net).
- Task 2: `TestBinanceSyncFlagClearing`: `3 failed, 4 passed` (the clean run, the all-nine and the only-unraised arms RED; the raised, OKX, switched-off and failed-load arms GREEN before the fix, they are the "removes nothing" negatives and are shown to bite by F4 and F8). The leaf tests (`test_binance_sync_flags.py`) were written after the leaf module shipped in task 1, so they were GREEN on their first run; their bite is shown by F5 and F13 to F16.

## Deviations from Plan

**1. [Rule 3 - Blocking] `test_stamp_io_exhaustive.py` (not in the plan's `files_modified`) held the guarded flag read to the wrong disposition**
- **Found during:** the broad regression run after task 3's PROOF-01 (10 failures, all `test_a_failing_stamp_call_keeps_the_cause_and_files_transient` and `test_a_programming_error_in_a_stamp_call_is_unknown_and_captured` over the five single-key scenarios that reach the derive-failed `_upsert`).
- **Issue:** that file DISCOVERS every `.execute()` issued while `_stamp_strategy_analytics_failed` is on the stack and makes each one fail in turn, asserting the job is filed `transient` (or `unknown`) with the curated cause. The new `read_binance_sync_flags` read sits inside that closure (the plan puts it in `_upsert`), was discovered, and its failure is swallowed BY DESIGN (plan truth: a failing prior-flags read logs a WARNING, carries nothing, and the failed stamp still lands), so the job was filed `permanent` with the stamp landed.
- **Fix:** the guarded read keeps its disposition (the plan, T-253-16 and the founder's SC-3 text all pin it); the census learned that disposition, the way it already carries the single-key heal's different one. Discovery marks calls issued from inside `read_binance_sync_flags` (`_Call.guarded`, a stack check on the function name and file); they leave the transient and unknown parametrisations, and a new arm `test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp` (five cases) asserts that failing the read leaves the outcome exactly the clean run's (filing, the one write, ERROR count, capture count) and adds ONE WARNING naming the strategy and the class. An anti-vacuity arm pins which five scenarios discover the guarded call, so the parametrisation cannot silently vanish. The module docstring records the new exception beside the heal's. Final: `112 passed`.
- **Alternative rejected:** making the read raise through `_stamp_io` would turn a transient flag-read blip into a transient failure of a TERMINAL failure stamp, and the retry would re-derive; the plan-checker's revision 1 chose never-raise for exactly that.
- **Files modified:** `analytics-service/tests/test_stamp_io_exhaustive.py`. **Commit:** fc542c562.
- **For the reviewer:** this is a plan gap (the plan did not list the census among the files its closure change touches). Worth a second look that "census exception by function name" is an acceptable shape.

**2. [Scope note] Extra neuters F8 to F16 beyond the plan's F1 to F7**
- Added because each locks a guarded behaviour with its own arm: F8 the OKX negative, F9 and F10 the other two CSV failure writers, F11 and F12 the never-raise of the guarded read (plan arms and census arm), F13 to F16 the shape validators and the clear's `fresh` test.

**3. [Honest limit] One arm cannot be neutered to RED**
- `test_a_failed_flag_load_pops_nothing_from_a_dict_the_run_never_read` pins pre-existing behaviour (a failed flag load writes a new-keys-only recovery payload). Dropping `not flag_load_failed` from the clear guard changes nothing observable, because `clear_absent_binance_sync_flags` on the `{}` the failed load falls back to pops nothing. The term is defensive; the arm documents the pre-existing behaviour, it does not gate the term.

**4. [Acceptance command note]** the BSD-grep `./` artifact on the CHANGELOG filter, recorded in the table above.

No Rule 1 or 2 production deviation: the production code matched the plan's design on its first green run.

## Records recorded rather than fixed (for the ship CHANGELOG)

- **(a)** A failing guarded read inside a failure writer carries nothing (one WARNING, the stamp lands). The keys then ride only until the next Binance sync raises them again; the re-read guarantee does not depend on them (it lives in `strategy_fills_reread_bounds`).
- **(b)** Open Question 3: the sync epilogue's OWN failed flag LOAD (pre-existing) replaces the column with the new keys only; a run-1 key is then not carried into run 2's row. Pinned by an arm, not fixed.
- **(c)** Plan 02's open item, unchanged and not scoped here: a failed bound write on a NULL column sets `_p_last_fetched = None`, which also discards the NULL-column bootstrap anchor (`fills_anchor_iso`), so the column stays NULL and the bound unwritten. Candidate fix remains "hold to `fills_anchor_iso`" in a later plan.
- **(d)** Pre-existing, noticed and not touched: in the flag-merge chain, `phase1_failed` sets `write_needed = True` and the final `else` of the phase-2 branch can set it back to `False` when nothing else changed. Out of this plan's write scope.
- **(e)** TODOS entries this phase closes, to be named in the ship CHANGELOG entry: `[250-BINANCE-STOP-BELOW-CURSOR]` (deleted in 893d9ab11). `CHANGELOG.md` itself still cites the id as history and is written at ship, not here.
- The whole path is dormant while `USE_RAW_TRADE_INGESTION` stays off for Binance (SC-4): no Binance key writes any of these flags in production until the switch is flipped, which no Phase 253 plan does.

## `git diff` of job_worker.py against the write_scope

`git diff -U0 03cb2ae74 -- analytics-service/services/job_worker.py` (1 file changed, 63 insertions, 18 deletions). Hunk headers, each mapped to the plan's write_scope by symbol:

```
@@ -141,0 +142,5 @@                 import of services.binance_sync_flags
@@ -346,14 +351,20 @@               module comment above _RAW_TRADE_INGESTION_ENABLED (the SC-3 paragraph; the constant and env read are NOT in the hunk)
@@ -2955,0 +2967,11 @@               run_sync_trades_job: the clear, between `existing_flags.update(exchange_dq_flags)` and the NEW-C12-02 block
@@ -3002,0 +3025,4 @@               run_sync_trades_job: the one `elif binance_flags_cleared`
@@ -6293,0 +6320,7 @@               run_derive_broker_dailies_job nested _upsert: _derive_failed_flags before the dict
@@ -6307 +6340 @@                 same _upsert: the data_quality_flags VALUE only
@@ -11687,0 +11721,3 @@             run_derive_broker_dailies_job: the new local _prior_analytics_row
@@ -11700,3 +11736,2 @@            run_derive_broker_dailies_job: the _read_last_success_row result handling
@@ -11916,0 +11952,10 @@            run_derive_broker_dailies_job: the one carry statement beside LAST_SUCCESS_SNAPSHOT_KEY
```

NOT touched, by construction and by the hunk list: the plan 02 seed, predicate and bound-write blocks, `_advance_cursor`, the enqueue tail (Phase 251), `_RAW_TRADE_INGESTION_ENABLED` and its env read, and every other key of the derive-failed payload. `analytics_runner.py` diff (`46 insertions, 3 deletions`): the import, the nine `DataQualityFlags` keys, the one carry loop after the `daily_pnl_malformed_` loop, and the three failure writers' `data_quality_flags` values only; `_mark_unrecoverable` and `_guard_failure_payload_inplace` unchanged.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-253-12 (explicit nine-key allowlist, shape validators, symbol names only, no UI reads any `binance_*` key): `test_binance_sync_flags.py`, F5, F13 to F15. T-253-13 (a carried key never promotes the status): the CSV hop arm asserts exact `"complete"` and `computation_warned is False`; the derive arm asserts none of the nine is in `NAV_TWR_GUARD_KEYS` or `ALLOCATED_CAPITAL_GUARD_KEYS`. T-253-14 (first derive): the no-prior-row, no-binance-keys and empty-row arms. T-253-16 (guarded read inside a failure writer): the read-raises arms in derive, CSV, the leaf and the census, F11 and F12. T-253-15 (flag sticks forever or a raised read clears it): F3, F4, F8.

## Housekeeping

- Steps skipped per the orchestrator override: `state.advance-plan`, `state.update-progress`, `state.record-metric`, `state.add-decision`, `state.record-session`, `roadmap.update-plan-progress`, `requirements.mark-complete` (SC-3 and SC-4 and SC-5 are NOT marked complete by this plan), and no final STATE/ROADMAP/REQUIREMENTS commit. `.planning/STATE.md` and `.planning/ROADMAP.md` are byte-unchanged.
- No Docker, no TEST or PROD database touched. The PROOF-01 byte backups and scratch files live only under `$SCRATCH/253/plan04/`.

## Self-Check: PASSED

- FOUND: analytics-service/services/binance_sync_flags.py
- FOUND: analytics-service/tests/test_binance_sync_flags.py
- FOUND commits: 4d33d07f0, 12f5e6354, fc542c562, 893d9ab11 (all ancestors of HEAD)
- STATE.md and ROADMAP.md untouched (orchestrator override); no Docker, TEST or PROD access.
