---
phase: 251-syncstore-run-sync-trades-job-stores-every-run-s-daily-p-l-a
verified: 2026-11-26T00:00:00Z
status: passed
score: 6/6 must-haves verified
verified_at_sha: 58adf26be33cf745ef5f25c04c040eb7b3da6ece
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_sync_trades_store_truth.py
  - analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py
behavior_unverified: 0
overrides_applied: 0
---

# Phase 251: SYNCSTORE Verification Report

**Phase Goal:** Every run of `run_sync_trades_job` keeps the daily P&L it read and records its refusal flags truthfully (ROADMAP Phase 251 items 1-4, plus `[222-SYNCTRADES-REREAD-FAILED]`).
**Verified:** 2026-11-26
**Status:** passed
**Re-verification:** No, initial verification
**Method:** code read of `git diff d7cd0443a..HEAD -- analytics-service/`, targeted test runs, mypy strict, one fresh byte-backup neuter (two, see PROOF-01). No full suite, no mutation runner, no Docker (load limit).

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | SC-1 the Phase-1 daily P&L is stored through `sync_trades` before the Phase-2 walk; a cancelled or raised walk has already stored it | VERIFIED | `job_worker.py` ccxt arm (~2268-2324): drain, verdict, then the `sync_trades` RPC inside the arm, then `account_balance = await fetch_usdt_balance`, then the Phase-2 block. `persist_exc` catches `Exception`, so a `CancelledError` (BaseException) is not swallowed into `phase1_failed`. Tests `TestStoreOrder::test_store_before_balance_and_fills_walk`, `test_cancelled_fills_walk_keeps_the_daily_store` (drives `asyncio.wait_for` cancel, harness line 432) and `..._raising_...` pass; pre-fix RED recorded in the 01 SUMMARY (3 of the 12 REDs) |
| 2 | SC-2 a refused read (reason named by `daily_pnl_read_verdict`) stores nothing, holds `last_sync_at`, never stamps `phase1_daily_pnl_persist_failed`, `trade_count` 0; rate limit reaches the 429 arm; Binance income-fallback fixture RED on old code | VERIFIED | Verdict is the shared reader (no fourth predicate). `rate_limited` is checked before `reasons` and raises `ccxt.RateLimitExceeded` with static text into the outer arm; a reason sets `phase1_read_refused` (never `phase1_failed`), skips the store; `_p_last_sync = None if phase1_read_refused`; `advance_fetched_cursor` requires `not phase1_read_refused`; `trade_count=0 if (phase1_failed or phase1_read_refused)`. `TestRefusal` (parametrized incl. `binance_income_fallback`, rate-limit `RateLimitExceeded` and `DDoSProtection`) passes; both neuters below went RED |
| 3 | SC-3 a clean read removes the owned refusal keys (reason keys plus `daily_pnl_fetch_error_class`, `daily_pnl_unsupported_venue`); `daily_pnl_malformed_*` untouched | VERIFIED | `_is_sync_owned_daily_pnl_key` = two named companions or membership in `daily_pnl_read_verdict({key: True}).reasons`; owned keys are popped when `phase1_read_ran`, the drained set merged back, a write happens only if owned_before != owned_after. `test_clean_read_pops_every_owned_key` (flag off and on), `test_owned_predicate_reuses_the_verdict` (malformed not owned), and the AST pin over `services/exchange.py` pass |
| 4 | SC-4 with `USE_RAW_TRADE_INGESTION` off and Phase 1 fine, a drained refusal flag reaches `data_quality_flags` at the sync's own write and `last_sync_at` does not advance | VERIFIED | `needs_flag_write` now includes `phase1_read_ran`; `write_needed` only accumulates (the old trailing `else: write_needed = False` is gone); the write reuses the single `_stamp_phase2_flags` upsert (no new write site, census files unchanged and green). `test_refused_non_usd_okx_flag_lands_with_flag_off`, `test_first_sync_refusal_no_row_writes_only_owned_keys`, `test_flag_load_failed_with_flag_off_writes_nothing` pass |
| 5 | SC-5 re-read raising after a zero-row write: outcome decided, pinned by a live-lane test, log line says what happened | VERIFIED (live arm CI-bound) | Decision recorded in CONTEXT (DONE; write raising stays FAILED). Code (~3127-3217): write and re-read in separate `try` scopes; re-read raising sets `_nothing_published = False` and logs "the re-read of the publish state then raised - nothing was written, returning DONE"; the "may still hang" line is gone. Mocked twin `TestRereadAfterZeroRowWrite` (5 arms) passes. Live arm `test_reread_failure_after_a_zero_row_write_keeps_the_published_row` exists in `test_sync_trades_enqueue_failure_bridge_live.py`; it skips locally by design and runs in CI's `python` job (see Ship obligations) |
| 6 | SC-6 PROOF-01: each gate RED on pre-fix or neutered copy with named arm, restored from byte backup, GREEN, recorded in SUMMARY | VERIFIED | 01 SUMMARY carries the pre-fix RED blocks for all three tasks and a 17-neuter table (N1-N4, N6, N8-N19, N12b) with `cmp exit: 0`; 02 SUMMARY carries N5, N7, N20 and the pre-fix RED. Independent spot-check below |

**Score:** 6/6 truths verified, 0 behavior-unverified (every behavior-dependent truth has a passing behavioral test).

## PROOF-01 independent spot-check

Backup `<scratchpad>/job_worker.251.bak`; `git diff --quiet` was 0 before each neuter.

| Neuter (verifier's own) | Arm | RED | Restore | GREEN |
|---|---|---|---|---|
| N13: dropped `and not phase1_read_refused` from `advance_fetched_cursor` | `test_refused_read_holds_the_fills_cursor_with_ingestion_on` | `1 failed, 36 deselected` | `cmp exit 0`, `git diff --quiet` 0 | `37 passed` |
| Review IN-04 gap: replaced the `_p_last_sync` line with `(_now_iso if not phase1_failed else None)` (drops the refusal hold) | whole file | `FAILED ...test_refused_read_stores_nothing[binance_income_fallback]`, `[fetch_error]`, `[non_usd_okx]`, `[truncated_okx]`, `[deadline_okx]`, `[deribit_unsupported_venue]` | `cmp exit 0`, `git diff --quiet` 0 | `37 passed` |

The second row closes review IN-04: the "holds `last_sync_at`" clause has no recorded dedicated neuter in the SUMMARY, but it does bite (verified here). The "never stamps `phase1_daily_pnl_persist_failed`" clause is covered by the same refusal arm by inspection (refusal sets `phase1_read_refused`, never `phase1_failed`), not by a separate neuter; recorded as LOW per the review.

## Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/services/job_worker.py` | VERIFIED | substantive, wired inside `run_sync_trades_job`; mypy strict clean |
| `analytics-service/tests/test_sync_trades_store_truth.py` | VERIFIED | 37 arms, drive the real handler with the real `_record_dq_flag` buffer |
| `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` | VERIFIED (CI-bound) | 11 tests; 3 new live arms skip locally |
| `services/exchange.py`, `routers/cron.py` | untouched | as decided (cron already refuses degraded reads) |

## Behavioral Spot-Checks

| Command | Result | Status |
|---|---|---|
| `python3 -m pytest tests/test_sync_trades_store_truth.py tests/test_sync_trades_enqueue_failure_bridge_live.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_daily_pnl_read_verdict.py -q -p no:cacheprovider` | `1053 passed, 10 skipped` (10 = live arms, local-stack lane not configured) | PASS |
| `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py` | `Success: no issues found in 1 source file` | PASS |

## Requirements Coverage

ROADMAP lists `Requirements: TBD`; both plans claim only PROOF-01 (covered by SC-6). No orphaned requirement.

## Anti-Patterns

No TBD/FIXME/XXX marker introduced in the diff that lacks a reference. Review (251-REVIEW.md) found 0 CRITICAL/HIGH/MEDIUM and 5 LOW + 4 INFO; the silent-failure hunter found one non-user-facing MEDIUM (SFH-M1, failure log of the flag upsert names no keys), booked for TODOS at ship as `[251-FLAG-WRITE-FAILURE-LOG]` per the repo review rule; it does not defeat any success criterion (outcome and truthfulness of the stored flags are unchanged, only the log text is thin).

## CI-bound checks (confirmed at ship, not gaps, not human_needed)

The three live arms skip off CI and are a decided, recorded arrangement (CONTEXT "Decided autonomously"). The ship step must confirm these names as passed in the `python` job's log for the ship PR's head SHA:
- `test_reread_failure_after_a_zero_row_write_keeps_the_published_row` (SC-5)
- `test_a_clean_sync_removes_a_stored_refusal_key_and_keeps_the_rest` (A1)
- `test_a_refused_first_sync_creates_a_row_carrying_only_the_refusal_key` (Q2)

## Ship obligations (by design, not gaps)

- SC-5: delete TODOS `[222-SYNCTRADES-REREAD-FAILED]` in the ship PR and name it in the CHANGELOG (`### Fixed`).
- Book `[251-FLAG-WRITE-FAILURE-LOG]` (SFH-M1) in TODOS.md at ship.
- CHANGELOG must carry the ship notes from both SUMMARYs: persist failure now actually stamps `phase1_daily_pnl_persist_failed`; a queued Deribit sync is refused by name every run; a refused sync still writes balance, enqueues the follow-on and returns DONE; flag-load failure with Phase 2 not run skips the write; one extra `strategy_analytics` select per ccxt sync; a run cancelled after the store loses its flag write; the T-222-13 residual.

## Human Verification Required

None.

## Gaps Summary

No gaps. Recorded LOW items (not blockers): IN-01 geo-block reaches `_stamp_429` as a rate limit (mirrors the derive, fix lives in `services/exchange.py`); IN-02 `phase2_ran` is the ingestion flag so an MT5 run with ingestion on still runs the recovery arm and the comment overstates it (pre-existing, flag off in PROD); IN-03 live SC-5 arm does not assert the raise fired (the mocked twin pins it); IN-05 AST pin sees literal first arguments only.

---

_Verified: 2026-11-26_
_Verifier: Claude (gsd-verifier)_
