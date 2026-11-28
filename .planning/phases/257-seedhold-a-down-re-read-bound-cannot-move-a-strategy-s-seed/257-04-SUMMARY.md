---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
plan: 04
subsystem: analytics-service (run_sync_trades_job seed and bound, trade_resume reader), test gate
tags: [seedhold, seed-hold-mark, compute_jobs-metadata, fail-open-reader, double-fault-residual]
requires: [257-02, 257-03]
provides:
  - "services/trade_resume.py: SEED_HOLD_KEY, parse_seed_hold, fail-open load_strategy_seed_hold (latest done sync_trades job)"
  - "services/job_worker.py run_sync_trades_job: SEED_HOLD_RPC; fourth seed term (done-row mark + the claimed row's own mark); seed-hold write in the provisional bound failure arm"
  - "tests/test_seedhold_bound.py: RED_AT_HEAD_HOLD removed from its 21 arms; TestSeedHoldMechanism (16 arms) incl. Python-to-SQL parity"
affects: [257-05]
key-files:
  modified:
    - analytics-service/services/trade_resume.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_seedhold_bound.py
key-decisions:
  - "Founder ruling 2026-11-28, verbatim choice: Job's private record (Recommended). The mark is written through set_compute_job_seed_hold, never a direct compute_jobs write."
  - "The claimed row's own metadata is read as a seed term as well as the latest done row. This is a PLANNER ADDITION to research V3 (the orchestrator may strike it); plan 01's retry arms are its gate and pass with it."
  - "Hand-off C arms classified by measurement: the two set-column arms stay RED (permanent RESIDUAL_DOUBLE_FAULT); the two first-sync arms are GREEN unmarked."
status: complete
actuals:
  tokens: 7700    # chars/4 over `git diff c83190bd1..HEAD` before this SUMMARY (30750 chars)
  tasks: 2
  commits: 2
plan_head_before: c83190bd16cf6a8ac828a9c668521c0c3885913c
plan_head_after: e7e58a8ac
completed: 2026-11-28
---

# Phase 257 Plan 04: the seed hold, wired through the new RPC Summary

When the provisional `set_strategy_fills_reread_bound` write raises, the run now leaves its seed as `seed_hold_ms` on its own `compute_jobs` row (through `set_compute_job_seed_hold`), and the next run lowers its seed to the mark on the latest `done` sync_trades job or on its own re-claimed row. A daily row stored meanwhile by `cron_sync`, `/fetch-trades` or any other writer can no longer move the seed past the span the failed run never read.

## Commits

| Commit | Subject |
|--------|---------|
| `ae5459e90` | fix(257-04): a down re-read bound leaves a seed-hold mark on the job's own row and the next run seeds from it |
| `e7e58a8ac` | test(257-04): seed-hold mechanism pins and Python-to-SQL parity |

`plan_head_before` `c83190bd1`, `git rev-list --count c83190bd1..HEAD` before this SUMMARY: 2 (the SUMMARY commit follows).

## What changed

- `services/trade_resume.py`: `Final` added to the typing import; `SEED_HOLD_KEY`, `parse_seed_hold` (exactly `type(value) is int and value >= 0`, so bool and negatives are refused), `load_strategy_seed_hold` (select `metadata` where strategy, kind `sync_trades`, status `done`, order `created_at` desc, limit 1; never raises; a malformed value logs at ERROR and returns an error tuple).
- `services/job_worker.py`, `run_sync_trades_job` only plus the constant and imports:
  - `SEED_HOLD_RPC` beside `WORKER_FENCE_V2`; `SEED_HOLD_KEY`, `load_strategy_seed_hold`, `parse_seed_hold` imported.
  - `_hold_read_failed = False` beside `_fills_read_skipped`.
  - Seed term inside `if _bound_read:` after the bound term, only when `fills_since_ms is not None`: reads the done-row mark and the claimed row's own `metadata[seed_hold_ms]`, lowers `fills_since_ms` to the earliest valid one, and on a NULL column lets `fills_anchor_iso` follow. An invalid own value sets `_hold_read_failed` and logs at ERROR with the strategy and the value's type only.
  - Seed-hold write inside the provisional `except Exception as exc:` arm after `phase2_error_message`: floor is `min(_reach_anchor_ms, _provisional_unread_ms)` when `_hold_read_failed` else `_provisional_unread_ms`; the claim token goes unconditionally (not behind `WORKER_FENCE_V2`). A raise logs one ERROR naming the strategy and exception class only; a False answer logs a WARNING starting `worker_orphan_write_blocked: set_compute_job_seed_hold`; neither changes the job outcome. The orphan `else` arm writes no mark.
- Not touched: routers, the orphan arm, the Phase-1 store, plan 03's Bybit hunks, `_earliest_through`, the epilogue bound write, `_advance_cursor`, the flag-write block, `.github/workflows/ci.yml`, `_fetch_raw_trades_okx`, `walk_paginated`.

## Gate results (verbatim count lines)

- Hold arms, `pytest tests/test_seedhold_bound.py -q -p no:cacheprovider -k "TestSeedHoldMatrix or TestSeedHoldHandOff or TestSeedHoldRetry"`: `38 passed, 24 deselected, 2 xfailed` (passed plus xfailed = 40; the 2 xfailed are `okx-set-C` and `bybit-set-C`; 0 xpassed).
- Mechanism pins, `-k TestSeedHoldMechanism`: `16 passed, 48 deselected`.
- Whole module: `62 passed, 2 xfailed`. Collected mechanism arms: 16 (plan floor 15).
- `pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py`: `246 passed, 2 xfailed`.
- mypy strict (CI command): `Success: no issues found in 148 source files` (local mypy 2.0.0; CI pins 2.4.0 and is binding).
- Full analytics suite, serial, `python3 -m pytest -q -p no:cacheprovider` (`$SCRATCH/257/p04/full-suite.txt`): `19 failed, 17913 passed, 107 skipped, 2 xfailed, 3953 warnings in 610.65s (0:10:10)`. All 19 failures are environmental and none names this plan's hunks (details under Deferred Issues). Run on the Task-1 production code and the pre-mechanism test module; the mechanism pins were run on their own afterwards (module above).
- Acceptance greps: `def load_strategy_seed_hold` 1; `SEED_HOLD_RPC` in job_worker 2; `_hold_read_failed` 4; `marks=RED_AT_HEAD_HOLD` 0; `marks=RESIDUAL_DOUBLE_FAULT` on exactly the `okx-set-C` and `bybit-set-C` lines; added `table("compute_jobs")` lines in the worker diff vs the merge-base 0; `git diff --quiet <merge-base> -- analytics-service/routers` exits 0; `set_compute_job_seed_hold.sql` referenced in the test module 1.

## C-arm classification by measurement (`$SCRATCH/257/p04/c-arms.txt`)

The hand-off and retry arms were run once with every `RED_AT_HEAD_HOLD` and `RESIDUAL_DOUBLE_FAULT` marker stripped from a byte-backed-up copy (restored with `cp`, `cmp` identical). Result: `2 failed, 38 passed, 8 deselected`.

| Arm | After the fix | Marker |
|-----|---------------|--------|
| okx-set-C | RED on `SEEDHOLD-WALK-START` (run 2 `since_ms` 1781913600000, walk start 1781910000000, after run 1's 1778108400000) | `RESIDUAL_DOUBLE_FAULT` (kept, permanent) |
| bybit-set-C | RED, same verdict | `RESIDUAL_DOUBLE_FAULT` (kept, permanent) |
| okx-first-C | GREEN | none (marker removed) |
| bybit-first-C | GREEN | none (marker removed) |

`grep -a -c '^E .*AssertionError: SEEDHOLD-WALK-START'` is 2 and `grep -a -c '^E .*PREMISE'` is 0: both failures are on the verdict.

## Deviations from Plan

### Recorded outcomes (not defects)

**1. [Measured classification] The two first-sync hand-off C arms (`okx-first-C`, `bybit-first-C`) pass unmarked.**
- **Mechanism (reasoned from the harness shape, not separately instrumented):** in shape C only the intervening run's mark WRITE fails; its `compute_jobs` read works. On a first sync the intervening run sees the moved daily row (a daily seed), reads run 1's mark on the latest `done` row, lowers its seed to it, and its Phase 232 bootstrap anchor (`fills_anchor_iso` follows the lowered seed on a NULL column) stamps the NULL column at that lowered instant. Run 2 therefore seeds from a column at or before run 1's walk start. On a set column nothing stamps the column, so the arm stays RED.
- This is exactly plan 01's prediction. No assertion was changed; the marker was simply removed. The plan records it as a Deviation by design.

**2. [Rule 3 - comment wording] The `SEED_HOLD_RPC` `#:` comment initially quoted `.table("compute_jobs")`, which tripped the plan's own acceptance grep (`^+.*table("compute_jobs")` must be 0).** Reworded to "never a direct table write of the compute_jobs row", amended into the Task-1 commit (not yet pushed).

No existing assertion was changed. No existing test encoded the old behaviour, so no intent-change note applies.

### Test additions beyond the plan's list

One extra mechanism arm, `test_a_false_answer_is_logged_as_an_orphan_and_the_run_finishes`, pins the `worker_orphan_write_blocked: set_compute_job_seed_hold` WARNING path (the plan specified the log but listed no arm for it). 16 mechanism arms instead of the planned 15.

## Notes from the RLS audit (honoured)

- The RPC can RAISE (22023 on a bad floor, 23514 at the 8192-byte metadata size cap) as well as return false. The worker treats any exception as a failed hold write: one ERROR, strategy and exception class only, pinned by `test_a_failed_seed_hold_write_is_logged_and_the_run_finishes` (it asserts the exception's message text is absent from the log). A False answer is a separate branch: a WARNING, no ERROR, pinned by the false-answer arm.
- **No Python path overwrites `compute_jobs.metadata` wholesale (grep result).** Every `table("compute_jobs")` reference in `analytics-service` outside tests (`services/job_worker.py` x5, `services/trade_resume.py`, `routers/process_key.py` x2, `main_worker.py`, `scripts/phase35_backfill_enqueue.py`) is a `select` or an insert of a new row; none issues an update or upsert. The SQL side: every `SET metadata =` in `supabase/migrations/` is a merge (`COALESCE(metadata, '{}') || ...`, a `CASE ... || ...` merge, or `(metadata - 'source') || ...`), so `seed_hold_ms` survives them. The claim RPC re-claim also merges (`COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(...)`).

## Residual measurements for plan 05

Exact search strings of the new hunks (plan 05 neuters by exact text; line numbers are at `e7e58a8ac` and are not the anchors):

| Hunk | Search string | File |
|------|---------------|------|
| H1 the seed-hold write call | `SEED_HOLD_RPC,` (inside `_write_seed_hold`, the dict beginning `"p_job_id": job["id"]`); the awaiting line `_hold_owned = await db_execute(_write_seed_hold)` | `services/job_worker.py` |
| H2 the done-row term | `lambda: load_strategy_seed_hold(ctx.supabase, strategy_id)` and `_hold_terms = [` / `if _hold_terms and min(_hold_terms) < fills_since_ms:` | `services/job_worker.py` |
| H3 the `done` filter | `.eq("status", "done")` (inside `load_strategy_seed_hold`; another `.eq("status", "done")` at job_worker.py is an unrelated reader, so scope the neuter to trade_resume.py) | `services/trade_resume.py` |
| H5 the fail-safe `min(` | `min(_reach_anchor_ms, _provisional_unread_ms)` | `services/job_worker.py` |
| H6 the own-row term | `_own_hold_ms = parse_seed_hold(_own_meta[SEED_HOLD_KEY])` (neuter by making `_own_hold_ms` stay None) | `services/job_worker.py` |
| H7 the log arms | `"sync_trades: could not write the seed-hold mark for strategy "` and `"worker_orphan_write_blocked: set_compute_job_seed_hold "` | `services/job_worker.py` |

Which arm should bite which neuter (predicted, NOT measured here; PROOF-01 is plan 05's): H1 and H2/H3 turn the persistent matrix, hand-off A and B and the retry arms RED; H5 turns `test_a_failed_hold_read_writes_the_reach_anchor` and the malformed arm's second leg RED; H6 turns the `rpc-up`/`rpc-down` retry arms RED; H7 turns the failed-write and false-answer mechanism arms RED. The seed-hold write is gated on `_hold_read_failed` only for its floor, so `okx-first-C` and `bybit-first-C` are predicted to go RED if the bootstrap-anchor follow in the seed term (`fills_anchor_iso = _iso_of_ms(fills_since_ms)` under `if _fills_cursor_ms is None:`) is neutered.

Further measurements:
- The double-fault residual is exactly two strict arms (`okx-set-C`, `bybit-set-C`); T-257-15 and `[257-SEEDHOLD-DOUBLE-FAULT]` stand as MEDIUM, to be booked at ship.
- T-257-13 (`[257-SEEDHOLD-HOLD-READ-BLIP]`): the case "bound RPC working in the same run, after an earlier run left an unconsumed mark, while this run's hold read blips" is not pinned by any arm here (hand-off B has the bound RPC down). Plan 05's hand-over should still draft the TODOS entry; it is a data-integrity MEDIUM per the threat register.
- The own-row read is a planner addition to research V3: it costs no database call (`job.get("metadata")` is the claim RPC's returned row). Its test gate is `TestSeedHoldRetry` (4 arms, all passing).
- Local environment: quantstats 0.0.81 and no pytest-xdist are installed, so the 19 full-suite failures below reproduce on unmodified code regardless of this plan; CI pins 0.0.86 and runs with xdist.

## Deferred Issues (out of scope, causes recorded)

The 19 full-suite failures, none touching this plan's files:
- 18 in `tests/test_metrics.py` and `tests/test_qstats_gate.py` (`test_rank05_quantstats_pin_is_still_0_0_86`, the `test_q166_parity_*` and `test_fig03_*` live-quantstats mirrors): the local environment has quantstats 0.0.81 where the repo pins 0.0.86 (`AssertionError: quantstats pin moved to 0.0.81`).
- 1 in `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`: pytest-xdist is not installed locally (`usage: python3.14 -m pytest` error from the `-n` option the test passes).

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change; the one new call is to the plan-02 RPC under the existing service-role boundary.

## Self-Check

- `ae5459e90` and `e7e58a8ac` are ancestors of HEAD (`git merge-base --is-ancestor` exits 0).
- `analytics-service/services/trade_resume.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_seedhold_bound.py` exist and carry the strings above.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not edited, per the orchestrator's brief.

## Self-Check: PASSED
