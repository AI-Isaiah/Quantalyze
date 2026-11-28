---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
plan: 01
subsystem: analytics-service (run_sync_trades_job seed and bound, Bybit fills reader), test gate
tags: [seedhold, two-run-matrix, strict-xfail, bybit-deadline, measured-at-head]
requires: []
provides:
  - "analytics-service/tests/test_seedhold_bound.py: the SC-1 matrix, hand-off, retry and SC-2 Bybit gate, measured on unmodified code"
  - "three strict AssertionError-only markers that plans 03 and 04 remove in their fix commits"
affects: [257-02, 257-03, 257-04, 257-05]
tech-stack:
  added: []
  patterns: ["two real run_sync_trades_job runs per arm with a per-run job identity", "a stateful compute_jobs fake that models the SQL claim-token fence", "strict xfail(raises=AssertionError) markers bound to a saved unmarked HEAD run"]
key-files:
  created:
    - analytics-service/tests/test_seedhold_bound.py
  modified:
    - .planning/ROADMAP.md
key-decisions:
  - "Every arm is classified from one saved UNMARKED run on unmodified code; the measurement matched RESEARCH's prediction exactly, so there is no deviation."
  - "ROADMAP SC-2 reworded per RESEARCH Pitfall 3 in its own docs commit, so the ship filter can drop it."
status: complete
actuals:
  tokens: 21000
  tasks: 2
  commits: 3
plan_head_before: daa550f6d71b5c8ba47d0db2c9b29d27ce43a6ce
plan_head_after: a4ca953a0de470e687ea1e5fd673b2be87f46199
completed: 2026-11-28
---

# Phase 257 Plan 01: the seed-hold gate, measured on unmodified code Summary

One new test module (47 arms) drives the real `run_sync_trades_job` for every SC-1 and SC-2 arm; on unmodified code 30 arms are RED on their own verdict and carry strict expected-failure markers, 17 are GREEN and stay as regression pins. No production file changed.

## Commits

| Commit | Subject |
|--------|---------|
| `b5b0fb347` | test(257-01): seed-hold matrix, hand-off and retry arms, measured at HEAD |
| `a43d909b0` | test(257-01): Bybit deadline arms against the real reader, measured at HEAD |
| `a4ca953a0` | docs(257): SC-2 reworded to what the mechanism can assert (research Pitfall 3) |

`plan_head_before` `daa550f6d`, `plan_head_after` `a4ca953a0`, `git rev-list --count` between them: 3. The docs commit (`a4ca953a0`) touches `.planning/ROADMAP.md` only, 1 insertion and 1 deletion.

## The HEAD measurement, verbatim

Premise at plan start: `git diff --quiet "$(git merge-base HEAD origin/main)" -- analytics-service/services analytics-service/routers analytics-service/models` exited 0 (the merge-base was `98723795b`, not the `9c5c414b0` the plan quoted from revision 1; the plan's precondition says to use the merge-base, so this is the correct reading and not a deviation).

### Task 1: hold-unmarked-head (matrix, hand-off, retry), command `pytest tests/test_seedhold_bound.py -q -p no:cacheprovider -k "TestSeedHoldMatrix or TestSeedHoldHandOff or TestSeedHoldRetry"`

```
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[binance-set-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-set-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[okx-first-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[bybit-set-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[bybit-first-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[deribit-set-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldMatrix::test_run2_walks_at_or_before_run1_walk_start[deribit-first-persistent]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-A]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-B]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-set-C]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-first-A]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-first-B]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[okx-first-C]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-A]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-B]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-set-C]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-first-A]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-first-B]
FAILED tests/test_seedhold_bound.py::TestSeedHoldHandOff::test_an_intervening_row_never_hides_run1_hold[bybit-first-C]
FAILED tests/test_seedhold_bound.py::TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[okx-retry-rpc-up]
FAILED tests/test_seedhold_bound.py::TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[okx-retry-rpc-down]
FAILED tests/test_seedhold_bound.py::TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[bybit-retry-rpc-up]
FAILED tests/test_seedhold_bound.py::TestSeedHoldRetry::test_a_retried_attempt_keeps_attempt_one_hold[bybit-retry-rpc-down]
23 failed, 17 passed in 8.03s
```

Counted on the traceback lines, not on the FAILED lines: `grep -a -c '^FAILED'` is 23, `grep -a -c '^E .*AssertionError: SEEDHOLD-WALK-START'` is 23, `grep -a -c '^E .*PREMISE'` is 0. Every RED arm failed on its verdict.

### Task 2: bybit-unmarked-head, command `pytest tests/test_seedhold_bound.py -q -p no:cacheprovider -k TestBybitDeadlineKeepsWhatItRead`

```
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_the_refusal_carries_what_the_read_completed[two-windows]
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_the_refusal_carries_what_the_read_completed[first-window]
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-set]
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_after_two_windows_persists_them_and_advances[stop-after-two-windows-null]
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_inside_the_first_window_holds_the_bound_at_the_seed[stop-inside-first-window-set]
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_stop_inside_the_first_window_holds_the_bound_at_the_seed[stop-inside-first-window-null]
FAILED tests/test_seedhold_bound.py::TestBybitDeadlineKeepsWhatItRead::test_a_persist_failure_after_a_stop_keeps_the_walk_start_bound[persist-fails-after-stop-set]
7 failed, 40 deselected in 9.50s
```

`grep -a -c '^FAILED'` 7, `grep -a -c '^E .*AssertionError: SEEDHOLD-BYBIT'` 7, `grep -a -c '^E .*PREMISE'` 0. The premises held in every arm (5 requests at the 4.5 s budget, 1 request at 0.5 s, reason `deadline`).

The Bybit unmarked run was taken by removing `marks=RED_AT_HEAD_BYBIT, ` from a byte-backed-up copy of the module, running, then restoring with `cp` and checking with `cmp` (identical).

## The 40-row table (matrix, hand-off, retry)

Run 2's `since_ms` was printed from a scratch run with a scratch pytest plugin (nothing printed in the committed module); `walk` is `since_ms` minus the 3600000 ms overlap, compared with run 1's walk start.

| id | at HEAD | run 2 `since_ms` | run 1 walk start | note |
|----|---------|------------------|------------------|------|
| binance-set-persistent | RED | 1781913600000 | 1778108400000 | the column, past run 1's seed |
| binance-first-persistent | GREEN | 1776772800000 | 1776772800000 | Phase 250 CR-01 reach anchor |
| binance-nullseed-persistent | GREEN | 1778112000000 | 1778108400000 | Phase 232 bootstrap anchor |
| binance-set-once | GREEN | 1778108399999 | 1778108400000 | epilogue write repairs a one-off failure |
| binance-first-once | GREEN | 1776772799999 | 1776772800000 | epilogue write |
| binance-nullseed-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| okx-set-persistent | RED | 1781913600000 | 1778108400000 | |
| okx-first-persistent | RED | 1783987200000 | 1776081600000 | |
| okx-nullseed-persistent | GREEN | 1778112000000 | 1778108400000 | Phase 232 bootstrap anchor |
| okx-set-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| okx-first-once | GREEN | 1776081599999 | 1776081600000 | epilogue write |
| okx-nullseed-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| bybit-set-persistent | RED | 1781913600000 | 1778108400000 | |
| bybit-first-persistent | RED | 1783987200000 | 1752580800000 | |
| bybit-nullseed-persistent | GREEN | 1778112000000 | 1778108400000 | Phase 232 bootstrap anchor |
| bybit-set-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| bybit-first-once | GREEN | 1752580799999 | 1752580800000 | epilogue write |
| bybit-nullseed-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| deribit-set-persistent | RED | 1781913600000 | 1778108400000 | |
| deribit-first-persistent | RED | 1783987200000 | 0 | |
| deribit-nullseed-persistent | GREEN | 1778112000000 | 1778108400000 | Phase 232 bootstrap anchor |
| deribit-set-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| deribit-first-once | GREEN | -1 | 0 | cosmetic, pre-existing: the bound `1969-12-31T23:59:59.999000+00:00` parses to -1, and `fetch_deribit_fills` ignores `since_ms` (RESEARCH side observation; not fixed here) |
| deribit-nullseed-once | GREEN | 1778108399999 | 1778108400000 | epilogue write |
| okx-set-A | RED | 1781913600000 | 1778108400000 | |
| okx-set-B | RED | 1781913600000 | 1778108400000 | |
| okx-set-C | RED | 1781913600000 | 1778108400000 | permanent residual marker |
| okx-first-A | RED | 1783987200000 | 1776081600000 | |
| okx-first-B | RED | 1783987200000 | 1776081600000 | |
| okx-first-C | RED | 1783987200000 | 1776081600000 | predicted GREEN after plan 04 |
| bybit-set-A | RED | 1781913600000 | 1778108400000 | |
| bybit-set-B | RED | 1781913600000 | 1778108400000 | |
| bybit-set-C | RED | 1781913600000 | 1778108400000 | permanent residual marker |
| bybit-first-A | RED | 1783987200000 | 1752580800000 | |
| bybit-first-B | RED | 1783987200000 | 1752580800000 | |
| bybit-first-C | RED | 1783987200000 | 1752580800000 | predicted GREEN after plan 04 |
| okx-retry-rpc-up | RED | 1781913600000 | 1778108400000 | attempt 2's own walk |
| okx-retry-rpc-down | RED | 1781913600000 | 1778108400000 | run 2 on a new row |
| bybit-retry-rpc-up | RED | 1781913600000 | 1778108400000 | attempt 2's own walk |
| bybit-retry-rpc-down | RED | 1781913600000 | 1778108400000 | run 2 on a new row |

## The 7-row Bybit table

`bound after run 1` and run 2's `since_ms` at HEAD come from a scratch run (run 2 never executes inside a committed arm at HEAD, because run 1's assertions fail first). The two reader arms read the refusal's attributes through `getattr`.

| id | at HEAD | observed at HEAD |
|----|---------|------------------|
| two-windows (reader) | RED | completed fill ids `[]`, `read_through_ms` absent (want `w1`, `w2` and 1779318000001) |
| first-window (reader) | RED | `completed_fills` None, `read_through_ms` absent (want `[]` and None) |
| stop-after-two-windows-set | RED | persisted `[]`; bound after run 1 `2026-05-06T22:59:59.999000+00:00`; stamp None; run 2 `since_ms` 1778108399999 (walk 1778104799999, below run 1's 1778108400000: the creep) |
| stop-after-two-windows-null | RED | persisted `[]`; bound `2026-05-06T22:59:59.999000+00:00`; stamp `2026-05-07T00:00:00+00:00`; run 2 `since_ms` 1778108399999 |
| stop-inside-first-window-set | RED | persisted `[]`; bound `2026-05-06T22:59:59.999000+00:00` (want the seed `2026-05-07T00:00:00+00:00` exactly); run 2 `since_ms` 1778108399999 |
| stop-inside-first-window-null | RED | same bound; stamp `2026-05-07T00:00:00+00:00`; run 2 `since_ms` 1778108399999 |
| persist-fails-after-stop-set | RED | the completed windows' fills were never sent to the upsert (`upsert_calls` 0) |

## Marker ids (plans 03 and 04 remove exactly these)

`RED_AT_HEAD_HOLD` (21, plan 04 removes it in its fix commit):
- matrix (7): `binance-set-persistent`, `okx-set-persistent`, `okx-first-persistent`, `bybit-set-persistent`, `bybit-first-persistent`, `deribit-set-persistent`, `deribit-first-persistent`
- hand-off (10): `okx-set-A`, `okx-set-B`, `okx-first-A`, `okx-first-B`, `okx-first-C`, `bybit-set-A`, `bybit-set-B`, `bybit-first-A`, `bybit-first-B`, `bybit-first-C`
- retry (4): `okx-retry-rpc-up`, `okx-retry-rpc-down`, `bybit-retry-rpc-up`, `bybit-retry-rpc-down`

`RESIDUAL_DOUBLE_FAULT` (2, permanent; named residual `[257-SEEDHOLD-DOUBLE-FAULT]`): `okx-set-C`, `bybit-set-C`.

`RED_AT_HEAD_BYBIT` (7, plan 03 removes it in its fix commit): `two-windows`, `first-window`, `stop-after-two-windows-set`, `stop-after-two-windows-null`, `stop-inside-first-window-set`, `stop-inside-first-window-null`, `persist-fails-after-stop-set`.

Plan 04 should re-measure `okx-first-C` and `bybit-first-C` after its fix: they are predicted to turn GREEN (the intervening run's Phase 232 bootstrap anchor follows the lowered seed into the column), and if the prediction is wrong plan 04 moves them to `RESIDUAL_DOUBLE_FAULT` by measurement.

## ROADMAP hunk

`.planning/ROADMAP.md`, `### Phase 257: SEEDHOLD`, success criterion 2, one scoped edit (commit `a4ca953a0`):

```
-... its fills are persisted, the bound advances to the end of the last completed window, and run 2's seed is at that mark, so its walk starts no earlier than the mark minus the 1 h overlap. ...
+... its fills are persisted (a window it read only in part is not), the bound equals the end of the last completed window (the mark), and run 2's walk start equals the newest completed-window fill minus the 1 h overlap and is later than run 1's walk start (reworded 2026-11-28: the cursor is stamped with the newest persisted fill and never the mark, so run 2's seed is that fill; `257-RESEARCH.md` Pitfall 3). ...
```

## Deviations from Plan

None. Every arm's HEAD result equals RESEARCH's prediction and the plan's: 7 RED matrix arms, 8 hand-off A/B, 4 hand-off C (2 under the permanent residual marker, 2 under `RED_AT_HEAD_HOLD`), 4 retry arms, 7 Bybit arms; 17 GREEN pins (Binance first sync, every NULL-column-with-seed arm, all 12 `once` arms). The counts the plan predicted (23 under the hold markers in all, 7 Bybit) were met, so no arm needed reclassifying and no assertion was changed to make the measurement agree.

SC-1's "RED on `origin/main`" wording holds only for the `persistent` arms, as RESEARCH Pitfall 1 states: the 12 `once` arms are GREEN because the epilogue write repairs a single failed provisional write, so CONTEXT's "one transient failed write is enough" is false at HEAD. The GREEN arms are kept as regression pins and are reported here, never forced RED.

Harness notes (not deviations): the `JobsStore.reclaim` and the `FlakyBounds` counter follow the plan's description exactly; `_Outcome` and `_Recorder` are imported by name from `tests.test_okxtrades_cursor` for type annotations in addition to the names the plan listed. The agent-namespace branch allow-list of the pre-commit safety check was not applied: the plan was dispatched onto the manual plan worktree branch `wt/257-p01` (not a protected branch, not detached), as the orchestrator's brief instructed.

## Verification

- `pytest tests/test_seedhold_bound.py -q -p no:cacheprovider`: `17 passed, 30 xfailed` (47 collected: 24 + 12 + 4 + 7). 0 failed, 0 xpassed.
- `pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py tests/test_okxtrades_cursor.py tests/test_binancefills_cursor.py -q -p no:cacheprovider`: `201 passed, 30 xfailed`.
- CI mypy strict command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 146 source files` (local mypy 2.0.0; CI pins 2.4.0 and is binding).
- `git diff --quiet "$(git merge-base HEAD origin/main)" -- analytics-service/services analytics-service/routers analytics-service/models` exits 0 (zero production diff).
- Acceptance greps: collect counts 40 and 7; `marks=RESIDUAL_DOUBLE_FAULT` on exactly the `okx-set-C` and `bybit-set-C` lines; `strict=True` 3 and `raises=AssertionError` 3; the SC-2 rewording present once and the old clause absent.
- PROOF-01 is not part of this plan (plan 05 adds the NEUTER block); the byte-backup discipline was applied to the one in-place edit of the module (the marker strip for the Bybit measurement, restored with `cp` and `cmp`-checked).

## Known Stubs

None.

## Threat Flags

None. The plan adds only a test module and one ROADMAP sentence; it opens no endpoint, auth path or schema surface.

## Self-Check: PASSED

- FOUND: `analytics-service/tests/test_seedhold_bound.py`
- FOUND: commits `b5b0fb347`, `a43d909b0`, `a4ca953a0` are ancestors of HEAD
