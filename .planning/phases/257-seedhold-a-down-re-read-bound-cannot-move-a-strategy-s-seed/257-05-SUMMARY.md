---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
plan: 05
subsystem: analytics-service (PROOF-01 neuter proof, phase gate, ship hand-over)
tags: [seedhold, proof-01, neuter, phase-gate, ship-handover]
requires: [257-01, 257-02, 257-03, 257-04]
provides:
  - "PROOF-01: every Phase 257 mechanism shown able to fail (B1-B8, H1-H3, H5-H7, P1-P3), restored byte-identical"
  - "NEUTER block in the module docstring of tests/test_seedhold_bound.py"
  - "phase gate readings and the ship hand-over (SC-4), carried in this SUMMARY only"
affects: [ship]
key-files:
  modified:
    - analytics-service/tests/test_seedhold_bound.py
key-decisions:
  - "The H6 neuter targets the own-row read's guard (`if isinstance(_own_meta, dict) and SEED_HOLD_KEY in _own_meta:` becomes `if False:`), not plan 04's suggested assignment, because `_own_hold_ms = None` would also trip the invalid-value branch and set `_hold_read_failed`."
status: complete
actuals:
  tokens: 1660   # chars/4 over `git diff 17560ce2f..babf7cb0e` (the one test commit, 6655 chars)
  tasks: 3
  commits: 1
plan_head_before: 17560ce2f2c0b1e8bcccc13d95aa44627208a1d3
plan_head_after: babf7cb0e
completed: 2026-11-28
---

# Phase 257 Plan 05: PROOF-01 neuters, phase gate, ship hand-over Summary

Every Phase 257 gate was shown able to fail on a neutered copy of its own mechanism: 13 Bybit arms (B1-B8), 15 seed-hold arms (H1-H3, H5-H7) and 6 pin-family arms (P1-P3) went RED by name, each neuter was restored with `cp` from a byte backup with `cmp` exit 0 and the same node ids then ran GREEN. There is no `MISSING` line. The full analytics suite, run in a venv with the repo's pinned quantstats and pytest-xdist, is 17948 passed, 0 failed, coverage 95.07 percent.

## Commits

| Commit | Subject |
|--------|---------|
| `babf7cb0e` | test(257-05): PROOF-01 neuter record for the seed-hold and Bybit read-through gates |

`plan_head_before` `17560ce2f`, `git rev-list --count 17560ce2f..HEAD` before this SUMMARY: 1 (the SUMMARY commit follows). The commit changes only the test module's docstring (`git show --numstat`: `58 1`). No production file is committed or staged by this plan.

## The harness

`harness.py` and `specs.py` live in the scratch directory (untracked, never in the repo). For each neuter it copies the file to `<id>.bak`, refuses unless EACH search string occurs exactly once, writes the replacements, runs the named node ids under `-rfEx`, restores with a file copy and runs real `cmp` (abort on non-zero), prints `RED_OK` only when a `FAILED <node>` line names the node, `MISSING` otherwise, then reruns the same ids and prints `GREEN_OK` only on exit 0 with no FAILED line. Node ids are resolved from `--collect-only` first (a substring that does not resolve to exactly one id is a harness error). Never `git checkout`, `git restore` or `git stash`.

Counts over the proof log: `RED_OK B` 13, `RED_OK H` 15, `RED_OK P` 6, `MISSING` 0, `restore cmp exit=0` 20 (17 neuters plus three observation runs), `GREEN_OK` 20, `GREEN_FAIL` 0.

## Neuter results, verbatim (`proof.log`)

Each `SEARCH` line is the exact search text (it matched exactly once) and its replacement. `OBSERVE` lines are the two permanent `RESIDUAL_DOUBLE_FAULT` arms under every H neuter (all stayed xfailed, no XPASS) and, for H5, the two mechanism arms that also went RED. The three `*alone` runs are the HEAD mechanism WITHOUT H1's edit: an observation of redundancy, not a gate (`other` there means the arm passed).

```
SEARCH B1 services/exchange.py: 'refusal.completed_fills = _dedup_on_exec_id(completed_rows)' -> 'refusal.completed_fills = []'
restore cmp exit=0 B1
RED_OK B1 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_the_refusal_carries_what_the_read_completed[two-windows]
RED_OK B1 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
GREEN_OK B1
NEUTERED_RUN_SUMMARY B1 2 failed in 5.35s
SEARCH B2 services/exchange.py: 'completed_through[0] = req.window_end' -> 'completed_through[0] = None'
restore cmp exit=0 B2
RED_OK B2 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_the_refusal_carries_what_the_read_completed[two-windows]
RED_OK B2 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
GREEN_OK B2
NEUTERED_RUN_SUMMARY B2 2 failed in 5.38s
SEARCH B3 services/exchange.py: 'if not items or not next_cursor:' -> 'if True:'
restore cmp exit=0 B3
RED_OK B3 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
GREEN_OK B3
NEUTERED_RUN_SUMMARY B3 1 failed in 5.36s
SEARCH B4 services/job_worker.py: 'elif _bybit_deadline_stop and not _fills_persist_failed:' -> 'elif False:'
restore cmp exit=0 B4
RED_OK B4 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_inside_the_first_window_holds_the_bound_at_the_seed[stop-inside-first-window-set]
RED_OK B4 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
GREEN_OK B4
NEUTERED_RUN_SUMMARY B4 2 failed in 5.39s
SEARCH B5 services/job_worker.py: 'and (not phase2_failed or _bybit_partial_ok)' -> 'and (not phase2_failed)'
restore cmp exit=0 B5
RED_OK B5 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
GREEN_OK B5
NEUTERED_RUN_SUMMARY B5 1 failed in 5.47s
SEARCH B6 services/job_worker.py: '_fills_persist_failed = True' -> 'pass'
restore cmp exit=0 B6
RED_OK B6 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_persist_failure_after_a_stop_keeps_the_walk_start_bound[persist-fails-after-stop-set]
GREEN_OK B6
NEUTERED_RUN_SUMMARY B6 1 failed in 5.92s
SEARCH B7 services/job_worker.py: '_bybit_read_through_ms = e.read_through_ms' -> '_bybit_read_through_ms = e.read_through_ms\n                    phase2_failed = False'
restore cmp exit=0 B7
RED_OK B7 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
RED_OK B7 tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_inside_the_first_window_holds_the_bound_at_the_seed[stop-inside-first-window-set]
GREEN_OK B7
NEUTERED_RUN_SUMMARY B7 2 failed in 5.69s
SEARCH B8 services/exchange.py: 'BYBIT_SYNC_FILLS_READ_DEADLINE_S: float = 420.0' -> 'BYBIT_SYNC_FILLS_READ_DEADLINE_S: float = 840.0'
restore cmp exit=0 B8
RED_OK B8 tests/test_seedhold_bound.py::test_the_bybit_sync_budget_leaves_the_persist_margin
RED_OK B8 tests/test_nullanchor_bound.py::TestBybitReadDeadline::test_the_bybit_read_gets_the_handler_budget_remaining[bybit-320.0]
GREEN_OK B8
NEUTERED_RUN_SUMMARY B8 2 failed in 5.40s
SEARCH H1 services/job_worker.py: '_hold_owned = await db_execute(_write_seed_hold)' -> '_hold_owned = True'
restore cmp exit=0 H1
RED_OK H1 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-set-persistent]
RED_OK H1 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[bybit-first-persistent]
RED_OK H1 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-set-persistent]
RED_OK H1 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[deribit-first-persistent]
OBSERVE H1 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C] xfailed
OBSERVE H1 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C] xfailed
GREEN_OK H1
NEUTERED_RUN_SUMMARY H1 4 failed, 2 xfailed in 5.54s
SEARCH H2 services/job_worker.py: 'if _hold_terms and min(_hold_terms) < fills_since_ms:' -> 'if False:'
restore cmp exit=0 H2
RED_OK H2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-set-persistent]
RED_OK H2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[bybit-first-persistent]
RED_OK H2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-set-persistent]
RED_OK H2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[deribit-first-persistent]
OBSERVE H2 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C] xfailed
OBSERVE H2 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C] xfailed
GREEN_OK H2
NEUTERED_RUN_SUMMARY H2 4 failed, 2 xfailed in 5.44s
SEARCH H3 services/trade_resume.py: '.eq("status", "done")' -> '.in_("status", ["done", "failed_final"])'
restore cmp exit=0 H3
RED_OK H3 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-A]
RED_OK H3 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-first-A]
OBSERVE H3 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C] xfailed
OBSERVE H3 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C] xfailed
GREEN_OK H3
NEUTERED_RUN_SUMMARY H3 2 failed, 2 xfailed in 5.38s
SEARCH H5 services/job_worker.py: 'min(_reach_anchor_ms, _provisional_unread_ms)' -> '_provisional_unread_ms'
restore cmp exit=0 H5
RED_OK H5 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-B]
RED_OK H5 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-B]
OBSERVE H5 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C] xfailed
OBSERVE H5 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C] xfailed
OBSERVE H5 tests/test_seedhold_bound.py::TestSeedHoldMechanism::test_a_failed_hold_read_writes_the_reach_anchor[okx] FAILED
OBSERVE H5 tests/test_seedhold_bound.py::TestSeedHoldMechanism::test_a_failed_hold_read_writes_the_reach_anchor[bybit] FAILED
GREEN_OK H5
NEUTERED_RUN_SUMMARY H5 4 failed, 2 xfailed in 5.48s
SEARCH H6 services/job_worker.py: 'if isinstance(_own_meta, dict) and SEED_HOLD_KEY in _own_meta:' -> 'if False:'
restore cmp exit=0 H6
RED_OK H6 tests/test_seedhold_bound.py::TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[okx-retry-rpc-up]
RED_OK H6 tests/test_seedhold_bound.py::TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[bybit-retry-rpc-down]
OBSERVE H6 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C] xfailed
OBSERVE H6 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C] xfailed
GREEN_OK H6
NEUTERED_RUN_SUMMARY H6 2 failed, 2 xfailed in 5.38s
SEARCH H7 services/job_worker.py: '                    else:\n                        if not _bound_owned:\n' -> '                    else:\n                        try:\n                            ctx.supabase.rpc(\n                                SEED_HOLD_RPC,\n                                {\n                                    "p_job_id": job["id"],\n                                    "p_claim_token": job.get("claim_token"),\n                                    "p_floor_ms": _provisional_unread_ms,\n                                },\n                            ).execute()\n                        except Exception:  # noqa: BLE001\n                            pass\n                        if not _bound_owned:\n'
restore cmp exit=0 H7
RED_OK H7 tests/test_seedhold_bound.py::TestSeedHoldMechanism::test_a_clean_run_writes_no_seed_hold[okx]
OBSERVE H7 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C] xfailed
OBSERVE H7 tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C] xfailed
GREEN_OK H7
NEUTERED_RUN_SUMMARY H7 1 failed, 2 xfailed in 5.39s
SEARCH P1 services/job_worker.py: 'elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:' -> 'elif False:'
SEARCH P1 services/job_worker.py: '_hold_owned = await db_execute(_write_seed_hold)' -> '_hold_owned = True'
restore cmp exit=0 P1
RED_OK P1 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-nullseed-persistent]
RED_OK P1 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-nullseed-persistent]
GREEN_OK P1
NEUTERED_RUN_SUMMARY P1 2 failed in 5.39s
SEARCH P2 services/job_worker.py: 'if not await db_execute(lambda: _set_bound(_unread_from_ms, _covers_from_iso)):' -> 'if not True:'
SEARCH P2 services/job_worker.py: '_hold_owned = await db_execute(_write_seed_hold)' -> '_hold_owned = True'
restore cmp exit=0 P2
RED_OK P2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-set-once]
RED_OK P2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[bybit-first-once]
RED_OK P2 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-set-once]
GREEN_OK P2
NEUTERED_RUN_SUMMARY P2 3 failed in 5.45s
SEARCH P3 services/job_worker.py: 'elif ctx.key_row.get("exchange") == "binance":' -> 'elif False:'
SEARCH P3 services/job_worker.py: '_hold_owned = await db_execute(_write_seed_hold)' -> '_hold_owned = True'
restore cmp exit=0 P3
RED_OK P3 tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-first-persistent]
GREEN_OK P3
NEUTERED_RUN_SUMMARY P3 1 failed in 5.35s
SEARCH P1alone services/job_worker.py: 'elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:' -> 'elif False:'
restore cmp exit=0 P1alone
OBSERVE P1alone tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-nullseed-persistent] other
OBSERVE P1alone tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-nullseed-persistent] other
GREEN_OK P1alone
NEUTERED_RUN_SUMMARY P1alone 2 passed in 5.33s
SEARCH P2alone services/job_worker.py: 'if not await db_execute(lambda: _set_bound(_unread_from_ms, _covers_from_iso)):' -> 'if not True:'
restore cmp exit=0 P2alone
OBSERVE P2alone tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-set-once] other
OBSERVE P2alone tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[bybit-first-once] other
OBSERVE P2alone tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-set-once] other
GREEN_OK P2alone
NEUTERED_RUN_SUMMARY P2alone 3 passed in 5.33s
SEARCH P3alone services/job_worker.py: 'elif ctx.key_row.get("exchange") == "binance":' -> 'elif False:'
restore cmp exit=0 P3alone
OBSERVE P3alone tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-first-persistent] other
GREEN_OK P3alone
NEUTERED_RUN_SUMMARY P3alone 1 passed in 5.33s
```

Every RED above is on the verdict, not on a crash: the failure text of each neutered run is an `AssertionError` naming the gate (`SEEDHOLD-BYBIT`, `SEEDHOLD-WALK-START`, `SEEDHOLD-MECHANISM`, `SEEDHOLD-MARGIN`) with one exception. B7's two arms fail with `IndexError: list index out of range` out of the test helper `_stamped_flag` (`rec.analytics_upserts[-1]`), because a deadline stop that reads as clean writes no flag upsert at all. That is a genuine RED on the named property (the flag), but its message is a crash rather than the arm's own text. Left as is: plan 05's write scope allows no change to the module beyond the docstring. A one-line `if not rec.analytics_upserts: return None` in `_stamped_flag` would make it read as the intended assertion; recorded for the review.

After every neuter: `git status --porcelain -- analytics-service/services` is empty; `git diff --quiet -- analytics-service/services` exits 0 for `exchange.py`, `job_worker.py` and `trade_resume.py`; `git diff --name-only <merge-base> -- TODOS.md CHANGELOG.md VERSION package.json` prints 0 lines.

### Pin families (SC-5)

| Family | HEAD mechanism neutered | Alone (no H1) | With H1's edit |
|--------|-------------------------|---------------|----------------|
| P1 Phase 232 bootstrap anchor stamp | the `nullseed` arms (2 venues) | GREEN, 2 passed | RED_OK x2 |
| P2 epilogue `_set_bound` write | the `once` arms (3 predicted) | GREEN, 3 passed | RED_OK x3 |
| P3 Phase 250 CR-01 Binance reach anchor | binance first-persistent | GREEN, 1 passed | RED_OK x1 |

The plan's SC-5 wording ("the 12 `once` arms, the 4 `nullseed` arms") is wider than its named arms: the three P neuters bite the named subset (2 + 3 + 1 arms). The other `once` and `nullseed` arms (deribit, the other venue permutations) are covered by the same mechanisms but were not named and were not run under a neuter. Recorded, not silently widened.

### Beyond the plan's list

- H5 also reddens the two `TestSeedHoldMechanism::test_a_failed_hold_read_writes_the_reach_anchor` arms (okx, bybit), as plan 04 predicted.
- H1 and H2 are separate neuters with the same four RED arms: H2 (the done-row term) also neuters the own-row term because both pass through the same `_hold_terms` comparison. H6 is isolated from it by neutering the own-row guard instead.
- H4 (the SQL fence predicate in migration `20261128120000`) is cited, not re-run: see the 257-02 SUMMARY.
- SC-1 and SC-2's RED on pre-fix code are plan 01's saved unmarked HEAD runs (cited, not re-run).

## NEUTER block

Added to the module docstring of `analytics-service/tests/test_seedhold_bound.py` in the house format of `test_nullanchor_bound.py`: one entry per neuter (B1-B8, H1-H3, H5-H7, P1-P3) naming its site by search text and its RED arm ids, the H4 pointer, and the sentence on why each P neuter pairs with H1. `grep -a -c "NEUTER (PROOF-01"` is 1. The module still runs `62 passed, 2 xfailed`.

## Phase gate (count lines verbatim)

| Gate | Result |
|------|--------|
| Full analytics suite, venv with `quantstats==0.0.86` and pytest-xdist 3.8.0 (`-n auto --dist loadgroup`, CI's mode), coverage floor 80 | `17948 passed, 107 skipped, 2 xfailed, 2726 warnings in 158.45s (0:02:38)`; `Required test coverage of 80% reached. Total coverage: 95.07%`; exit 0 |
| mypy strict (CI command, local mypy 2.0.0; CI pins 2.4.0 and is binding) | `Success: no issues found in 148 source files` |
| `node scripts/lint-sql-gates.mjs` | `lint-sql-gates: scanned 129 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |
| `node scripts/lint-migration-data-dependence.mjs` | `corpus 350 migration(s), 433 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` |
| `node scripts/lint-app-guc.mjs` | `app-guc: findings 0` (443 files scanned, 5 lineage-annotated) |
| `node scripts/mutation-runner/run.mjs --parse-only` | `STATIC PARSE ONLY - ZERO arms executed ... No static defects. Every prose marker has a twin and every needle still matches.` exit 0 |
| `node scripts/baseline-content-drift-check.mjs` | `functions compared 151 - MATCH 147, DRIFT 3, SNAPSHOT_MISSING 1, SNAPSHOT_ONLY 0, UNCOMPARABLE 0 ... findings 1`, exit 1. Expected and recorded by plan 02: the one finding is `SNAPSHOT_MISSING set_compute_job_seed_hold/3`, because the function is in the generated snapshot and not yet in `supabase/schema/baseline.sql`, which the ship step re-dumps after the PROD apply (hand-over g). It is a stale-baseline drift, not a defect of this phase. |
| vitest sweep over the 49 directory-reading files (`xargs npx vitest run`) | `Test Files  47 passed \| 1 skipped (48)`, `Tests  2734 passed \| 46 skipped (2780)`; exit 0. 49 files matched the grep and 48 ran: one of the matched contract files is not in either vitest project's include list. |
| `node scripts/verify-plan-anchors.mjs` over the five PLAN files | `claims: 22 checked`, `OK: 5 plan file(s), no stale claims.` |

Local environment note: plan 04's serial run on the system Python had 19 failures (18 in `test_metrics.py` and `test_qstats_gate.py` from quantstats 0.0.81 against the repo pin 0.0.86, and `test_xdist_group_is_real.py` from a missing pytest-xdist). A throwaway venv under the scratch directory (`--system-site-packages`, then `pip install quantstats==0.0.86 pytest-xdist`, which added only quantstats, pytest-xdist and execnet) removes all 19: the same suite is 0 failed. That settles them as environmental, so the merge-base worktree comparison was not needed. The 107 skips are database-lane tests (`LANE_DB_URL` unset, no Docker). The run left no untracked or modified file in the tree.

## Ship hand-over (SC-4)

The ship step edits `TODOS.md`, `CHANGELOG.md` and `VERSION`; this plan edited none of them.

### (a) CHANGELOG entry draft (version and date picked at ship)

```
## [X.Y.Z.B] - YYYY-MM-DD

Phase 257 SEEDHOLD: a down re-read bound can no longer move a strategy's seed past a span nobody read, and a Bybit fills read that hits its deadline keeps what it read.

### Fixed
- A sync run whose `set_strategy_fills_reread_bound` write failed now leaves its seed as a `seed_hold_ms` mark on its own `compute_jobs` row, through the new claim-token-fenced RPC `set_compute_job_seed_hold`. The next run lowers its seed to the mark on the latest `done` `sync_trades` row (or on its own re-claimed row), so a daily row stored meanwhile by `cron_sync`, `/fetch-trades` or any other writer no longer hides the unread span. Closes `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`. Venues: Binance, OKX, Bybit and Deribit, set column, first sync and NULL column.
- A Bybit fills read that hit its deadline kept nothing, so every refusal lowered the bound by the overlap and the next run walked the same span again. The reader now hands back the 7-day windows it completed and the end of the last one; the worker persists them, stamps the newest persisted fill at or before that end, and bounds the next run at it (or holds at the seed when no window completed). The run stays flagged `phase2_fill_ingestion_failed`. Closes `[255-BYBIT-DEADLINE-NO-PROGRESS]`.

### Added
- Migration `20261128120000_compute_job_seed_hold.sql` (with its rollback): `public.set_compute_job_seed_hold(uuid, uuid, bigint)`, service-role only, single-statement merge of `seed_hold_ms` into the running job's metadata, fenced on a non-NULL, equal claim token.
- SQL gate `supabase/tests/test_compute_job_seed_hold.sql` (9 arms, 9 twins) and its generated function snapshot.
- `services/trade_resume.py`: `SEED_HOLD_KEY`, `parse_seed_hold`, the fail-open `load_strategy_seed_hold`.

### Changed
- `BYBIT_SYNC_FILLS_READ_DEADLINE_S` is 420 s remaining-budget for a Bybit sync read (the shared handler budget was 840 s remaining-budget), so the persist after a deadline stop fits the 900 s handler. Worst case `(1 + 4r) x 420 + 25 <= 900`, margin 119 s at r = 0.2 s; r is unmeasured. The handler cap is not raised.

### Tests
- `tests/test_seedhold_bound.py`: the SC-1 two-run matrix across four venues, the three hand-off shapes, the retry arms, the Bybit deadline arms, the margin pin, 16 mechanism arms with Python-to-SQL parity, and a PROOF-01 NEUTER block (B1-B8, H1-H3, H5-H7, P1-P3) recorded in the plan 05 SUMMARY.

### Notes
- Residuals, rated under one rule (a lost span is MEDIUM and booked; an over-fetch, a visible stall or an observability gap is LOW and not booked):
  - MEDIUM, booked: `[257-SEEDHOLD-DOUBLE-FAULT]` (bound RPC down and the mark write lost, or a marked run ending `failed_final`, on a set column with no stored fill; pinned by two strict `RESIDUAL_DOUBLE_FAULT` arms).
  - MEDIUM, booked: `[257-SEEDHOLD-HOLD-READ-BLIP]` (hold read fails in a run whose bound RPC works, after an earlier unconsumed mark).
  - MEDIUM, booked: `[257-SEEDHOLD-MARK-REAPED]` (the 30-day `done` reaper deletes the mark with its row).
  - LOW, not booked: a worker round trip above the 0.27 s break-even lets a handler cancel land mid-persist after a deadline stop (no span lost, the job fails loudly); the fee-currency data-quality flags of a deadline stop's persisted windows are discarded (stored fills correct, warning missing); a key re-point inheriting an old mark (over-fetch only); a hold read failing with the bound RPC also down (the fail-safe floor makes it an over-fetch).
  - Info, not booked: Deribit's first sync hands `since_ms = -1` to a reader that ignores it (pre-existing, cosmetic).
- Deploy ordering: the worker's seed-hold write is best-effort. If Railway deploys before the PROD apply the RPC is missing, the write fails, is logged at ERROR, and the run carries on as before the fix.
- After the PROD apply a baseline re-dump clears the `snapshot-only` NAME_SET_RATCHET row for `set_compute_job_seed_hold`.
```

### (b) TODOS changes for the ship PR

Delete the two closed entries `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (`TODOS.md` line 259) and `[255-BYBIT-DEADLINE-NO-PROGRESS]` (line 272, measured at this worktree's HEAD; re-find by id after the rebase).

Output of `grep -a -rln "253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN\|255-BYBIT-DEADLINE-NO-PROGRESS" --exclude-dir=node_modules --exclude-dir=.git .` (28 files, one-per-line in the scratch `pointers.txt`), sorted by what the ship PR should do:

- To edit in the ship PR: `TODOS.md` (delete both entries), `CHANGELOG.md` (6 mentions, all history: leave, they are dated lineage), `.planning/ROADMAP.md` (6 mentions) and `.planning/STATE.md` (1 mention): these belong to the records PR, not the ship branch (ship branch must change nothing under `.planning`).
- Code comments citing the ids as lineage (no behaviour; leave, the id survives as a class label): `analytics-service/services/exchange.py` (1), `analytics-service/services/job_worker.py` (2), `analytics-service/services/trade_resume.py` (1), `analytics-service/tests/test_seedhold_bound.py` (2).
- Planning history of Phases 253, 255 and 257 (`.planning/phases/253-*`: `253-SECURITY.md`, `253-VERIFICATION.md`; `255-*`: CONTEXT, DISCUSSION-LOG, 02-PLAN, 03-PLAN, 03-SUMMARY, RESEARCH, VERIFICATION, REVIEW, REVIEW-R2, SECURITY, PATTERNS; `257-*`: CONTEXT, DISCUSSION-LOG, RESEARCH, 01/03/04/05-PLAN): historical, no pointer to repair.

No test, script or runbook reads `TODOS.md` to keep either entry alive (the grep shows none outside the list above).

DRAFT 1:

- [ ] **`[257-SEEDHOLD-DOUBLE-FAULT]` A sync run whose re-read bound RPC is down and whose seed-hold mark is then lost (the mark write fails, or the run writes it and ends `failed_final`) lets the next run seed past the unread span on a set column with no stored fill** (logged 2026-11-28, Phase 257 SEEDHOLD, MEDIUM, data-integrity, named residual of the founder ruling 2026-11-28 "Job's private record (Recommended)"; owner: founder decision; trigger: `set_strategy_fills_reread_bound` down for a whole run AND `set_compute_job_seed_hold` failing in that run, or a run that wrote its mark failing every retry)
  - **What:** when the bound RPC is down for a whole run, the run records its seed as `seed_hold_ms` in its own `compute_jobs.metadata`, and the next run reads the latest `done` sync_trades row's mark. In each of these cases that run's span is lost once `cron_sync` or `/fetch-trades` stores a daily row:
    - the mark write also fails: the run's `done` row carries no mark and hides any earlier one;
    - the run writes its mark and then ends `failed_final`: the reader reads `done` rows only (research V3).

    A NULL column is still covered, by the intervening run's Phase 232 bootstrap anchor; a set column with no stored fill is not. Measured by plan 04: exactly two strict arms, `TestSeedHoldHandOff::...[okx-set-C]` and `[bybit-set-C]`, carry `RESIDUAL_DOUBLE_FAULT` in `analytics-service/tests/test_seedhold_bound.py` and are RED on the verdict `SEEDHOLD-WALK-START` after the fix; the two first-sync C arms (`okx-first-C`, `bybit-first-C`) are GREEN unmarked. Plan 05 confirmed both set-C arms stay xfailed under every H neuter (none turned XPASS).
  - **Fix direction:** a hand-off that does not depend on the failing write (for example, read the newest row that carries a mark, cleared only once a later run recorded its bound), or hold the daily writers while a mark is outstanding (a founder decision: it changes daily-P&L freshness).
  - **Gate:** the set-column C arms turn GREEN with the marker removed, plus a new `failed_final`-with-mark arm, each shown RED first.

DRAFT 2:

- [ ] **`[257-SEEDHOLD-HOLD-READ-BLIP]` A run whose re-read bound RPC works but whose seed-hold read fails open records its bound past an earlier, unconsumed mark** (logged 2026-11-28, Phase 257 SEEDHOLD, MEDIUM, data-integrity; owner: founder decision; trigger: an earlier run left a mark with the bound RPC down, a daily row was stored since, and the `compute_jobs` read in `load_strategy_seed_hold` fails in the first run after the RPC recovered)
  - **What:** research V3's fail-safe lowers only the seed-hold WRITE to the reach anchor when the hold read failed. A run whose bound RPC works writes no mark, so it seeds and records its provisional bound from the un-lowered seed, and its `done` row then hides the earlier mark. With the RPC down in the same run, the fail-safe makes it an over-fetch only (LOW, not booked). Not pinned by any arm: `TestSeedHoldHandOff` shape B has the bound RPC down (plan 04 measurement).
  - **Fix direction:** on a failed hold read, lower the seed itself to the reach anchor (accepting one full-reach re-read per blip), or retry the read once before failing open.
  - **Gate:** a two-run arm in which run 1 leaves a mark, a daily row lands, and run 2 has the bound RPC up and the hold read raising; run 2's walk start is at or before run 1's, shown RED first.

DRAFT 3:

- [ ] **`[257-SEEDHOLD-MARK-REAPED]` A seed-hold mark is deleted with its job row by the 30-day `done` reaper, so a strategy with no queued sync for 30 days after its last marked run seeds past the span** (logged 2026-11-28, Phase 257 SEEDHOLD, MEDIUM, data-integrity, low likelihood; owner: founder decision; trigger: no queued `sync_trades` job for a strategy within 30 days of a run that left a mark, while daily rows keep arriving)
  - **What:** the mark lives on a `done` row, and `20260515113853_retention_crons_safe.sql` (job `retention_compute_jobs_done`: `WHERE status = 'done' AND created_at < now() - interval '30 days'`, read at this plan) deletes `done` rows 30 days after `created_at`. Research A5's re-check against later migrations (a replacement or an exemption of that job) was NOT done in this plan and is still due at ship. Every later run with the RPC down re-writes the mark, so an outage alone keeps the chain alive. A 30-day gap with no queued sync removes it.
  - **Fix direction:** exempt rows carrying `seed_hold_ms` from the `done` reaper until a later `done` row exists, or move the mark to a home the reaper does not touch (a migration, so a founder decision).
  - **Gate:** a SQL gate in which the reaper keeps a marked `done` row older than 30 days while it is the strategy's newest `done` row, shown RED first.

### (c) Residual ratings, one rule

MEDIUM or above when the outcome is a lost span (data integrity, booked per the founder ruling of 2026-11-28); LOW when the outcome is only an over-fetch, a visible stall or an observability gap (recorded in the phase REVIEW, not booked, CLAUDE.md rule (a)).

| Residual | Outcome | Rating | Booked |
|----------|---------|--------|--------|
| double fault on a set column, with the `failed_final`-with-mark variant | lost span | MEDIUM | yes, DRAFT 1 |
| hold read failing in a run whose bound RPC works | lost span | MEDIUM | yes, DRAFT 2 |
| the same hold-read failure with the RPC down | over-fetch (fail-safe floor) | LOW | no |
| mark ageing out with the 30-day `done` reaper | lost span | MEDIUM | yes, DRAFT 3 |
| worker PostgREST round trip above the 0.27 s break-even (T-257-10, handler cancel mid-persist) | no span lost, the job fails loudly | LOW | no |
| fee-currency DQ flags of a deadline stop's persisted windows discarded | observability gap, stored fills correct | LOW | no |
| key re-point inheriting an old mark | over-fetch only | LOW | no |
| Deribit first sync handing `since_ms = -1` to a reader that ignores it | pre-existing, cosmetic | Info | no |
| B7's IndexError-shaped RED (a test-helper message, found in this plan) | test quality | LOW | no |

### (d) Founder-ruled reviewer gate

migration-reviewer and rls-policy-auditor must report no MEDIUM+ on `20261128120000_compute_job_seed_hold.sql` before merge. It is a new SECURITY DEFINER function, and PROD auto-applies it after TEST on merge (no human reviewer gate since 2026-09-23).

### (e) Timestamp re-check at ship

At write time (local `origin/main` ref `1faea7aba`, v0.133.114.1; the ref moved from `d0398d28c` to `1faea7aba` while this plan ran, another session fetched) the newest migration on origin/main is `20261127220100_api_keys_insert_fence.sql` (new since the merge-base, which carries `20261127220000_strategy_analytics_anon_column_revoke.sql`), so `20261128120000` still sorts after it. It must also sort after the PROD ledger tip: read it with the marker query first, then one read-only MCP query of `supabase_migrations.schema_migrations`. This plan ran no database access, so that half is open. If it does not sort after, rename it and every reference: the SQL gate's setup list and twins, the generated snapshot header, and the census notes.

### (f) Rebase before ship, with a measured conflict list

Phase 256 OKXUNITSWITCH is already merged into this branch (`c4ee28cbe`, merge-base `647c595d7`). origin/main (local ref `1faea7aba`) is now three commits ahead of the merge-base: Phase 260 CIHEADROOM (`d0398d28c`), Phase 243 DBBACKSTOP PR-C (`416a2efb6`, which adds migration `20261127220100_api_keys_insert_fence.sql` and its rollback) and a baseline re-dump (`1faea7aba`, v0.133.114.1, which rewrites `supabase/schema/baseline.sql`, `BASELINE.md` and `baseline-carried-migrations.txt`). `git diff --name-only <merge-base> origin/main` names files this phase also edits: `scripts/baseline-content-drift-check.mjs`, `scripts/dump-sql-functions.ts`, `scripts/mutation-floors.mjs`, `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/mutation-runner-floors.test.ts`, plus the ship-owned ledgers `CHANGELOG.md`, `TODOS.md`, `VERSION` and `package.json`. The new migration and the re-dump move census numbers plan 02 pinned (`COMPARED_FLOOR` 151, the function census, the floors read by symbol, the carried-migrations marker the local-stack lane replays against). Nothing under `analytics-service/` differs on origin/main (0 files). Expect textual or numeric conflicts in the census files; re-measure each pinned number after the rebase, never carry plan 02's. The `findings 1` of the drift check above must be re-read after the rebase too (a re-dump that predates the PROD apply of `20261128120000` still lacks `set_compute_job_seed_hold`).

### (g) Baseline re-dump after the PROD apply

A baseline re-dump follow-up clears the `snapshot-only` NAME_SET_RATCHET row and the `SNAPSHOT_MISSING set_compute_job_seed_hold/3` finding above. The re-dump must regenerate `baseline-carried-migrations.txt` in the same commit.

### (h) Deploy ordering

The worker's seed-hold write is best-effort. If Railway deploys before the PROD apply, `set_compute_job_seed_hold` does not exist, the RPC call raises, the write is logged at ERROR (strategy and exception class only) and the run carries on exactly as it did before this phase. Nothing breaks; the protection starts at the apply.

### (i) Corrections to carry into the records

- CONTEXT's "one transient failed write is enough" was measured false: a single failed provisional write is repaired by the epilogue write seconds later, so the gate needs the RPC down for the whole run (the `persistent` arms; the `once` arms are regression pins).
- RESEARCH A4: the rollback file exists (`supabase/migrations/down/20261128120000-rollback.sql`).
- RESEARCH A6 is resolved: the `compute_jobs_strategy_id` index serves the new reader.
- Plan 04's C-arm classification by measurement: the two first-sync hand-off C arms are GREEN unmarked; only the two set-column C arms stay RED.

### (j) Planner additions to research V3, for review to strike

- The own-row term: the claimed row's own `metadata[seed_hold_ms]` is read as a seed term as well as the latest `done` row (costs no database call; gate: the four `TestSeedHoldRetry` arms, and neuter H6 turns two of them RED).
- No persist-time guard after a Bybit deadline stop; the handler-cancel stall is rated LOW (T-257-10).
- The 420 s Bybit budget (RESEARCH computed 485 s): a lower budget costs only more runs to catch up, never data.

## Deviations from Plan

### Auto-fixed Issues

None in production code (this plan has no production write scope and none was changed).

### Recorded outcomes (not defects)

**1. [Rule 1 - stale text] The module docstring's sentence "There is deliberately no NEUTER block here: plan 05 adds it." was false once the block landed, so it was reworded to "The NEUTER block at the end of this docstring is plan 05's."** The plan's acceptance wording is "added docstring lines and no deleted line"; this one edit makes the numstat `58 1` instead of `58 0`. Leaving a sentence that contradicts the block beneath it seemed worse than one deleted line. Nothing else in the module changed.

**2. [Harness choice] H6 neuters the own-row read's guard rather than plan 04's suggested assignment.** `_own_hold_ms = parse_seed_hold(...)` becoming `None` would also fall into the `if _own_hold_ms is None: _hold_read_failed = True` branch, so the neuter would test two things at once. `if isinstance(_own_meta, dict) and SEED_HOLD_KEY in _own_meta:` becoming `if False:` is the pure "never read" the plan describes.

**3. [Harness choice] H1 is `_hold_owned = await db_execute(_write_seed_hold)` becoming `_hold_owned = True`** (the RPC is never called), using plan 04's own search string, not "the callable returns False before the RPC".

**4. [Plan wording] The SC-5 line "the 12 once arms, the 4 nullseed arms" is wider than the plan's named arms.** The P neuters bite the named 3 once arms, 2 nullseed arms and binance first-persistent; see Pin families above.

**5. [Plan wording] The Task 3 vitest command as written does not run under zsh** (`npx vitest run $(grep ...)` hands vitest one filter with spaces, and it exits `No test files found`). It was rerun with `xargs`, a file list, giving the result above.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema change in this plan.

## Self-Check

- `babf7cb0e` is an ancestor of HEAD; `analytics-service/tests/test_seedhold_bound.py` carries `NEUTER (PROOF-01` once.
- `git diff --quiet e7e58a8ac HEAD -- analytics-service/services` exits 0 (the neutered files are byte-identical to plan 04's commit; `e7e58a8ac` is plan 04's last code commit, `ae5459e90` its production commit, and no commit since touches `services/`).
- `git status --porcelain` is empty before this SUMMARY; `.planning/STATE.md` and `.planning/ROADMAP.md` were not edited, per the orchestrator's brief.

## Self-Check: PASSED
