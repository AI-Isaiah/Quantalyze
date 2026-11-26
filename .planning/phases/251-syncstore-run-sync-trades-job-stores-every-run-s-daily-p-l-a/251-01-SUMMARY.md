---
phase: 251-syncstore-run-sync-trades-job-stores-every-run-s-daily-p-l-a
plan: 01
subsystem: analytics-service
tags: [sync_trades, daily-pnl, data_quality_flags, job_worker, pytest, proof-01]

requires:
  - phase: 186
    provides: "daily_pnl_read_verdict, the one shared reader of the daily-P&L DQ buffer"
  - phase: 222
    provides: "the sync_trades follow-on enqueue outcome and the 429 arm this plan re-enters"
provides:
  - "run_sync_trades_job stores the daily P&L before the balance read and the Phase-2 fills walk"
  - "a daily read refused by the verdict stores nothing, holds last_sync_at and the fills cursor, reports trade_count 0"
  - "the sync-owned daily_pnl refusal keys reach and leave strategy_analytics.data_quality_flags at the handler's one upsert"
affects: [251-02, v1.22 TRUTH ship notes, CHANGELOG at ship]

requirements-completed: [PROOF-01]

plan_head_before: d7cd0443a727d26829e2b37f59c39a354d057620
plan_head_after: 284deab8154a1a2c57a8cd2f866020b4ebae2ef0

actuals:
  tokens: 15174
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "refusal gate through the shared daily_pnl_read_verdict, raise ccxt.RateLimitExceeded with static text into the outer 429 arm"
    - "owned-key replacement: snapshot, pop owned, merge drained, sanitize class, snapshot, write only on a change"

key-files:
  created:
    - analytics-service/tests/test_sync_trades_store_truth.py
  modified:
    - analytics-service/services/job_worker.py

key-decisions:
  - "Followed the plan: _is_sync_owned_daily_pnl_key derives the reason set from daily_pnl_read_verdict({key: True}).reasons, so a reason added to the verdict is owned automatically"
  - "MT5 behaviour unchanged: phase2_ran stays `phase2_failed or phase2_success` (equal to _RAW_TRADE_INGESTION_ENABLED), not the isinstance form PATTERNS suggested"

duration: ~60min
completed: 2026-11-26
status: complete
---

# Phase 251 Plan 01: SYNCSTORE job_worker store truth Summary

**`run_sync_trades_job` now stores every ccxt run's daily P&L right after the read, refuses to store a degraded read, and keeps the `daily_pnl_*` refusal flags on `data_quality_flags` truthful (replaced each run, cleared by a clean read), with 17 neuters proven RED and restored byte-exact.**

## Performance

- **Duration:** about 60 min
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Files:** 1 production file (`analytics-service/services/job_worker.py`, only inside `run_sync_trades_job` plus two module-level names above it), 1 new test file with 32 arms. No edit to `routers/cron.py`, `services/exchange.py` or any existing test.

## Accomplishments

- Item 1: the Phase-1 `sync_trades` store moved into the ccxt arm, after the read, the drain and the refusal check, before `fetch_usdt_balance` and the Phase-2 walk. A run cancelled by `asyncio.wait_for`, or raising in the fills walk, has already stored its daily rows.
- Item 2: a drained flag set that `daily_pnl_read_verdict` names a reason for (Binance income-fallback spot fill, fetch error, OKX non-USD, truncated, deadline, Deribit unsupported venue) stores nothing. The run holds `last_sync_at` and the fills cursor, reports `trade_count` 0, and still writes the balance, enqueues the follow-on and returns DONE. A swallowed rate limit (`RateLimitExceeded` or `DDoSProtection` class) raises `ccxt.RateLimitExceeded` with static text into the outer arm, which awaits `_stamp_429` once and leaves the buffer empty.
- Items 3 and 4: the ccxt daily read is now a reason to read the flag column. A refusal's owned keys land at the existing `_stamp_phase2_flags` upsert (inline literal unchanged, census untouched) with ingestion off. A clean read removes every stored owned key and leaves `daily_pnl_malformed_*` and unrelated keys. The stored class is `verdict.error_class`.
- Flag-block truth: `write_needed` only accumulates (the Phase-1 persist failure's own stamp was being erased by a trailing reset); the Phase-2 recovery arms run only when Phase 2 ran; a failed flag read on a run where Phase 2 did not run skips the write with a WARNING; a refused run keeps a stale `phase1_daily_pnl_persist_failed`.
- An AST pin over `services/exchange.py` fails when a new `daily_pnl_*` flag literal is neither owned nor `daily_pnl_malformed_*`.

## Task Commits

1. **Task 1 (tracer):** `ded880611` fix(251-01): a refused daily P&L read stores nothing; the daily store runs before the fills walk
2. **Task 2:** `4e2ee6904` fix(251-01): refusal flags reach data_quality_flags with ingestion off; write_needed only accumulates
3. **Task 3:** `284deab81` fix(251-01): a clean daily read clears the sync-owned refusal keys; the stored class is sanitized

(`commits: 3` is measured: `git rev-list --count` from the persisted plan ledger base to the last code commit.)

## Pre-fix RED (Task 1, run against the unmodified handler)

Command: `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider`

```
FAILED tests/test_sync_trades_store_truth.py::TestStoreOrder::test_store_before_balance_and_fills_walk
FAILED tests/test_sync_trades_store_truth.py::TestStoreOrder::test_cancelled_fills_walk_keeps_the_daily_store
FAILED tests/test_sync_trades_store_truth.py::TestStoreOrder::test_cancelled_fills_walk_raising_keeps_the_daily_store
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_stores_nothing[binance_income_fallback]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_stores_nothing[fetch_error]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_stores_nothing[non_usd_okx]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_stores_nothing[truncated_okx]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_stores_nothing[deadline_okx]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_stores_nothing[deribit_unsupported_venue]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_refused_read_holds_the_fills_cursor_with_ingestion_on
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_rate_limited_read_reaches_the_429_arm[RateLimitExceeded]
FAILED tests/test_sync_trades_store_truth.py::TestRefusal::test_rate_limited_read_reaches_the_429_arm[DDoSProtection]
12 failed, 1 passed in 16.06s
```

The one pass is `test_malformed_alone_is_not_a_refusal`, the control. Failure reasons were the intended ones: `sync_trades` recorded after `balance` and `fetch_raw` (store-before), no `sync_trades` call at cancel (cancel arm), `'sync_trades' not in [...]` on every refused id including the spot-fill id, `'2026-11-21T10:00:00+00:00' is None` on the fills cursor, and `DID NOT RAISE RateLimitExceeded` on both rate-limit ids.

## Task 2 pre-fix (run against the Task-1 commit)

Command: `... -k TestFlagWrite`

```
FAILED ...TestFlagWrite::test_refused_non_usd_okx_flag_lands_with_flag_off
FAILED ...TestFlagWrite::test_first_sync_refusal_no_row_writes_only_owned_keys
FAILED ...TestFlagWrite::test_flag_load_failed_with_flag_off_writes_nothing[refused]
FAILED ...TestFlagWrite::test_flag_load_failed_with_flag_off_writes_nothing[persist_failed]
FAILED ...TestFlagWrite::test_persist_failure_stamps_persist_failed_flag[ingestion_on]
FAILED ...TestFlagWrite::test_persist_failure_stamps_persist_failed_flag[flag_off]
6 failed, 3 passed, 13 deselected in 10.07s
```

GREEN: the stale-`phase2_*` arm, the malformed-only arm and the MT5 arm (their power is shown by N16, N15, N17).

## Task 3 pre-fix (run against the Task-2 commit)

Command: `... -k "TestOwnedKeyReplacement or TestOwnedKeySet"`

```
FAILED ...TestOwnedKeyReplacement::test_clean_read_pops_every_owned_key[flag_off]
FAILED ...TestOwnedKeyReplacement::test_clean_read_pops_every_owned_key[ingestion_on]
FAILED ...TestOwnedKeyReplacement::test_refused_read_replaces_stored_owned_keys
FAILED ...TestOwnedKeyReplacement::test_owned_error_class_is_the_sanitized_verdict_class[not_identifier]
FAILED ...TestOwnedKeyReplacement::test_refused_read_keeps_a_stale_persist_failed_flag
5 failed, 5 passed, 22 deselected in 10.29s
```

GREEN: the nothing-owned arm, the clear control, the predicate arm, the AST pin and the `identifier` id (power shown by N17, N18, N12, N19).

## PROOF-01

Each neuter was applied to a byte copy kept in the scratchpad, run with `-k` on the named arm, restored with `cp`, then `cmp` (exit 0) and `git diff --quiet` on the file (exit 0), then the whole file re-run. Every `cmp exit: 0` and `git diff --quiet exit: 0` below is verbatim from the run; every GREEN line is the full file (`22 passed` or `13 passed` or `32 passed` is the file's size at that task).

Commands all take the form `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider -k "<expr>"`.

| Neuter | Edit in words | `-k` arm | RED line (first failure, named arm) | cmp | GREEN |
|---|---|---|---|---|---|
| N1 | cut the store block out of the ccxt arm, paste it after the exchange `finally` guarded `if trades and not phase1_read_refused:` | `test_cancelled_fills_walk_keeps_the_daily_store` | `FAILED ...TestStoreOrder::test_cancelled_fills_walk_keeps_the_daily_store` (`the cancelled run must have stored its daily rows`, `assert [] == [[...]]`) | 0 | 13 passed |
| N2 | delete the reasons branch so a refused read falls to the store | `test_refused_read_stores_nothing and binance_income_fallback` | `FAILED ...test_refused_read_stores_nothing[binance_income_fallback]` (`assert 'sync_trades' not in ['sync_trades', 'advance_sync_cursor', 'enqueue_compute_job']`) | 0 | 13 passed |
| N3 | delete the owned-key pop loop | `test_clean_read_pops_every_owned_key and flag_off` | `FAILED ...test_clean_read_pops_every_owned_key[flag_off]` (6 extra owned keys left in the upsert) | 0 | 32 passed |
| N4 | drop `phase1_read_ran` from `needs_flag_write` | `test_refused_non_usd_okx_flag_lands_with_flag_off` | `FAILED ...TestFlagWrite::test_refused_non_usd_okx_flag_lands_with_flag_off` (`assert 0 == 1`, no upsert) | 0 | 22 passed |
| N6 | add the trailing `else: write_needed = False` back after the Phase-2 inner chain | `test_persist_failure_stamps_persist_failed_flag and ingestion_on` | `FAILED ...test_persist_failure_stamps_persist_failed_flag[ingestion_on]` (`assert 0 == 1`) | 0 | 22 passed |
| N8 | delete the rate-limit raise | `test_rate_limited_read_reaches_the_429_arm and RateLimitExceeded and not DDoS` | `FAILED ...test_rate_limited_read_reaches_the_429_arm[RateLimitExceeded]` (`DID NOT RAISE RateLimitExceeded`) | 0 | 13 passed |
| N9 | delete the class sanitize step | `test_owned_error_class_is_the_sanitized_verdict_class and not_identifier` | `FAILED ...test_owned_error_class_is_the_sanitized_verdict_class[not_identifier]` (`'daily_pnl_fetch_error_class' not in {... 'Bad Class!'}`) | 0 | 32 passed |
| N10 | drop `and not phase1_read_refused` from the stale persist-failed clear arm | `test_refused_read_keeps_a_stale_persist_failed_flag` | `FAILED ...test_refused_read_keeps_a_stale_persist_failed_flag` (the two stale keys missing from the upsert) | 0 | 32 passed |
| N11 | make the failed-read skip branch unreachable (`if False:`) so the upsert runs | `test_flag_load_failed_with_flag_off_writes_nothing and refused` | `FAILED ...test_flag_load_failed_with_flag_off_writes_nothing[refused]` (an upsert `{'daily_pnl_non_usd_okx': True}` was written) | 0 | 22 passed |
| N12 | `_is_sync_owned_daily_pnl_key` also returns True for any key starting `daily_pnl_` | `test_owned_predicate_reuses_the_verdict` | `FAILED ...TestOwnedKeySet::test_owned_predicate_reuses_the_verdict` (first extra item `daily_pnl_malformed_okx`) | 0 | 32 passed |
| N12b | same neuter, pop arm | `test_clean_read_pops_every_owned_key and flag_off` | `FAILED ...test_clean_read_pops_every_owned_key[flag_off]`: `daily_pnl_malformed_okx` was popped (`Right contains 1 more item: {'daily_pnl_malformed_okx': True}`) | 0 | 32 passed |
| N13 | drop `and not phase1_read_refused` from `advance_fetched_cursor` | `test_refused_read_holds_the_fills_cursor_with_ingestion_on` | `FAILED ...test_refused_read_holds_the_fills_cursor_with_ingestion_on` (`assert '2026-11-21T10:00:00+00:00' is None`) | 0 | 13 passed |
| N14 | drop the refusal from `trade_count` | `test_refused_read_stores_nothing and non_usd_okx` | `FAILED ...test_refused_read_stores_nothing[non_usd_okx]` on its `trade_count` assertion (`assert 1 == 0`) | 0 | 13 passed |
| N15 | set `phase1_read_ran = True` in the MT5 arm | `test_mt5_run_makes_no_daily_flag_read` | `FAILED ...test_mt5_run_makes_no_daily_flag_read` (`assert 'strategy_analytics' not in ['strategy_analytics']`) | 0 | 22 passed |
| N16 | change `elif phase2_success:` back to `else:` | `test_clean_read_flag_off_leaves_stale_phase2_keys` | `FAILED ...test_clean_read_flag_off_leaves_stale_phase2_keys` (an upsert `{'phase2_recovered_at': ...}` was written) | 0 | 22 passed |
| N17 | `write_needed = True` whenever `phase1_read_ran` | `test_clean_read_with_nothing_owned_stored_writes_nothing` | `FAILED ...test_clean_read_with_nothing_owned_stored_writes_nothing` (an upsert of `{'last_success_snapshot': ...}` was written) | 0 | 32 passed |
| N18 | delete the stale persist-failed clear arm | `test_clean_read_clears_a_stale_persist_failed_flag` | `FAILED ...test_clean_read_clears_a_stale_persist_failed_flag` (`assert 0 == 1`, no upsert) | 0 | 32 passed |
| N19 | on `services/exchange.py`, add one `_record_dq_flag("daily_pnl_p251_planted", True)` after the `daily_pnl_unsupported_venue` call in the `else:` branch of `fetch_daily_pnl` | `test_every_daily_pnl_flag_exchange_records_is_owned_or_malformed` | `FAILED ...TestOwnedKeySet::test_every_daily_pnl_flag_exchange_records_is_owned_or_malformed` (`daily_pnl_p251_planted is recorded by services/exchange.py but is neither owned ... nor a daily_pnl_malformed_* key`) | 0 (`git diff --quiet` on `exchange.py` also 0) | 32 passed |

That is 17 required rows (N1, N2, N3, N4, N6, N8, N9, N10, N11, N12, N13, N14, N15, N16, N17, N18, N19) plus the N12b pop-arm record the plan asks for.

## Regression and mypy lines

- Drivers (`tests/test_sync_trades_store_truth.py tests/test_sync_trades_resume_seed.py tests/test_okxtrades_cursor.py tests/test_mt5_sync_path.py tests/test_failed_status_logged.py tests/test_ana_recon_audit.py tests/test_no_contact_support_copy.py tests/test_daily_pnl_read_verdict.py tests/test_okxtrades_ccy.py`): `1106 passed, 2 warnings in 15.78s` (baseline 1074 + 32 new arms)
- Handler subset (`tests/test_job_worker.py -k "TestSyncTrades or TestAdvanceSyncCursorFence or TestRedTeamSyncTrades or enqueue_failure or sync_trades"`): `28 passed, 110 deselected in 10.51s` (baseline 28)
- Censuses (`tests/test_computation_error_provenance_census.py tests/test_computing_started_at_stamp.py`): `13 passed in 16.21s` (baseline 13); `EXPECTED_INERT_SITES` and `EXPECTED_SKIPPED_UNRESOLVED` untouched
- `tests/test_mt5_handover.py -k sync_job_passes`: `1 passed, 39 deselected in 10.13s` (baseline 1)
- mypy strict on `services/job_worker.py`: `Success: no issues found in 1 source file`
- `tests/test_mt5_sync_path.py` (run in Task 2): green inside the 42-passed census-plus-MT5 run
- `node scripts/verify-plan-anchors.mjs <this plan>`: `OK: 1 plan file(s), no stale claims.`

## Deviations from Plan

None. The plan was executed as written. Notes that are not deviations:

- N11 was applied as `if False:` on the skip branch (making it unreachable) instead of deleting its lines, which is the same behaviour and a one-line byte-exact edit.
- N12 was run twice (the predicate arm, then the pop arm) so the `daily_pnl_malformed_okx` pop is recorded as the plan asks.
- The production line `elif existing_flags.get("phase1_daily_pnl_persist_failed") and not phase1_read_refused:` is longer than 88 columns. The file already has longer lines and no linter is configured in this checkout; left as is.

## Issues Encountered

None blocking. `ruff` is not installed in this checkout, so no formatter or linter run was possible beyond mypy strict.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema; the new exception text is static and the stored class is the verdict's regex-checked identifier (T-251-03).

## Ship notes (for the CHANGELOG)

- A Phase-1 persist failure now actually stamps `phase1_daily_pnl_persist_failed` and `phase1_failed_at` (the `write_needed` overwrite fix), with ingestion on or off.
- A queued Deribit sync is refused by name every run (`daily_pnl_fetch_error` plus `daily_pnl_unsupported_venue`) and holds `last_sync_at`. Pinned by `test_refused_read_stores_nothing[deribit_unsupported_venue]`.
- A refused sync still enqueues the follow-on (the cron's degraded tick does not), and the derive refuses by its own arm. It also still writes the account balance and returns DONE with `trade_count` 0.
- With ingestion off, a failed flag read on a run where Phase 2 did not run skips the flag write, with a WARNING, because an upsert would replace the whole column with a guessed payload.
- The stored `daily_pnl_fetch_error_class` is sanitized: it is `verdict.error_class` (a plain identifier) and absent otherwise.
- With ingestion off, a ccxt run now reads `data_quality_flags` on every run (one extra select per sync) so a clean read can clear the refusal keys an earlier run wrote.
- A run cancelled after the daily store loses its flag write; accepted (T-251-06), the next run re-derives the flags.
- `[222-SYNCTRADES-REREAD-FAILED]` closes at ship (TODOS entry deleted and named in the CHANGELOG by the orchestrator).

## Self-Check: PASSED

- `analytics-service/tests/test_sync_trades_store_truth.py` exists; `analytics-service/services/job_worker.py` modified; `services/exchange.py` byte-identical to HEAD.
- Commits `ded880611`, `4e2ee6904`, `284deab81` are ancestors of HEAD.
- Working tree has no uncommitted change under `analytics-service/` after the last neuter restore.
