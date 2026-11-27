---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
plan: 03
subsystem: analytics-service
tags: [proof-01, neuter, okx, bybit, deribit, fills-cursor, reread-bound, job_worker, pytest]

requires:
  - phase: 255-01
    provides: SC-1 two-run matrix (26 arms RED on unmodified code) and the SC-2 pin
  - phase: 255-02
    provides: the per-strategy re-read bound gated on `_bound_read` (Binance, OKX, Bybit, Deribit)
provides:
  - SC-4 / PROOF-01 evidence: ten neuters (N1 to N10), every named arm seen RED by node id, restored with cp and cmp 0, then GREEN
  - the NEUTER block (N1 to N10) in the docstring of tests/test_nullanchor_bound.py
  - the SC-3 ship hand-over (items 1 to 5)
affects: [255-ship]

actuals:
  tokens: 950
  tasks: 3
  commits: 2
plan_head_before: 97150d085683e702126352ce2fa165b14167b06a
plan_head_after: da7f274fb1f988022ed8861af73219865fc3589b
commits: 2

tech-stack:
  added: []
  patterns:
    - "A proof harness that prints RED_OK per named node id only when a FAILED line names it, restores with cp from a byte backup, and prints GREEN_OK only on a clean rerun"

key-files:
  created: []
  modified:
    - analytics-service/tests/test_nullanchor_bound.py

key-decisions:
  - "No arm needed strengthening: every one of the 21 named arms went RED on the first run of its neuter, so no test-only change beyond the docstring was made"

requirements-completed: [SC-1, SC-2, SC-3, SC-4]

status: complete
---

# Phase 255 Plan 03: PROOF-01 neuters and the SC-3 ship hand-over Summary

Every Phase 255 gate was shown able to fail: ten neuters of the fixed `run_sync_trades_job` (N1 to N10) each turned its 21 named arms RED by node id, were restored with `cp` from a byte backup of plan 02's committed file (`cmp` exit 0), and the same arms reran GREEN; `job_worker.py` is byte-identical to `01c430a67` and the tree is clean.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (tracer) | Proof harness end to end on N1; NEUTER block header and N1 entry | `301eb2ee48878aaf3d2822e4a6ebe86bd46c67ac` |
| 2 | N2 to N10 through the same harness; NEUTER block complete | `da7f274fb1f988022ed8861af73219865fc3589b` |
| 3 | Phase-gate runs and the SC-3 hand-over | no repository change (outputs are this SUMMARY) |

## What was done

- Backup: `job_worker.py.post` was taken from the clean tree and `git show 01c430a67:analytics-service/services/job_worker.py | cmp - job_worker.py.post` exits 0 (byte-identical to plan 02's final commit, as plan 02 stated).
- `neuter.py` (search file, replace file, exactly one occurrence or exit 2) and `proof.sh` implement THE PROOF CONTRACT literally; the harness is scratch (untracked) under the session scratchpad.
- Node ids: every id in the plan's neuter list collected under exactly that spelling; no id was renamed. N7's third id is `tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_raised_okx_read_never_sets_a_binance_flag`, confirmed with `--collect-only`.
- N1's whole-module run (informational, separate neuter/run/restore cycle with its own `restore cmp exit=0` line): the pre-fix gating on the fixed code fails 39 of 71 arms in the module.
- The module docstring of `tests/test_nullanchor_bound.py` now carries the `NEUTER (PROOF-01 ...)` block with ten entries, each naming its site and the arms it turns RED. Nothing else in the module changed (71 passed after).

## SC coverage

- SC-1's RED on pre-fix code is plan 01's saved unmarked HEAD run, `26 failed, 4 passed in 12.22s` (see 255-01-SUMMARY.md, "Task 1: unmarked HEAD measurement (verbatim)"). N1 restores the pre-fix gating on the fixed code and turns SC-1 arms RED again (five named arms plus 34 more in the whole-module run).
- SC-2's pin bites: N6 and N9 (no `binance_*` key off Binance) and N10 (the golden `advance_sync_cursor` stamp) each turn a named SC-2 arm RED.
- SC-4: N1 to N10 below.

## PROOF-01 (verbatim)

Saved at `$SCRATCH/255/plan03/proof-output.txt` (untracked scratch). Filtered as 253-04 did: the neuter diffs, the `neutered occurrences=1` lines, the FAILED lines, the count lines, the `RED_OK` lines, the `restore cmp exit=0` lines and the `GREEN_OK` lines are kept; pytest's captured source and log dumps are dropped. Totals: 21 `RED_OK`, 10 `GREEN_OK`, 0 `_MISSING` lines, 11 `neutered occurrences=1` and 11 `restore cmp exit=0` (ten neuters plus N1's whole-module cycle).

```
=== N1 ===
neutered occurrences=1
2437c2437
<                 _bound_read = _reach_anchor_ms is not None
---
>                 _bound_read = _binance_read
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-null-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-set-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[okx-first-429]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx]
5 failed in 27.62s
RED_OK N1 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-null-429]
RED_OK N1 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-cancel]
RED_OK N1 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-set-plain]
RED_OK N1 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[okx-first-429]
RED_OK N1 tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx]
restore cmp exit=0
5 passed in 59.83s
GREEN_OK N1
=== N1 whole-module (informational) ===
neutered occurrences=1
39 failed, 32 passed in 37.38s
restore cmp exit=0
=== N2 ===
neutered occurrences=1
2544c2544
<                             lambda: _set_bound(_provisional_unread_ms, None)
---
>                             lambda: True
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-null-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-null-cancel]
3 failed in 49.22s
RED_OK N2 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-null-429]
RED_OK N2 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-cancel]
RED_OK N2 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-null-cancel]
restore cmp exit=0
3 passed in 51.67s
GREEN_OK N2
=== N3 ===
neutered occurrences=1
2838c2838
<             elif phase2_failed or any(
---
>             elif False and (phase2_failed or any(
2841c2841
<             ):
---
>             )):
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-set-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc]
2 failed in 12.09s
RED_OK N3 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-set-plain]
RED_OK N3 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc]
restore cmp exit=0
2 passed in 14.53s
GREEN_OK N3
=== N4 ===
neutered occurrences=1
2431c2431
<                         - BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS * 86_400_000
---
>                         - 730 * 86_400_000
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_first_sync_provisional_row_is_the_venue_reach_anchor[bybit]
2 failed in 11.93s
RED_OK N4 tests/test_nullanchor_bound.py::TestBoundOffBinance::test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock
RED_OK N4 tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_first_sync_provisional_row_is_the_venue_reach_anchor[bybit]
restore cmp exit=0
2 passed in 9.03s
GREEN_OK N4
=== N5 ===
neutered occurrences=1
2540c2540
<                         fills_since_ms if fills_since_ms is not None else _reach_anchor_ms
---
>                         fills_since_ms - _exchange.OVERLAP_WINDOW_MS - 1 if fills_since_ms is not None else _reach_anchor_ms
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx]
1 failed in 27.97s
RED_OK N5 tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx]
restore cmp exit=0
1 passed in 23.22s
GREEN_OK N5
=== N6 ===
neutered occurrences=1
3092,3093c3092
<             _binance_read
<             and _fills_cursor_ms is not None
---
>             _fills_cursor_ms is not None
FAILED tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_no_binance_key_on_a_non_binance_run[okx-plain-set]
1 failed in 25.58s
RED_OK N6 tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_no_binance_key_on_a_non_binance_run[okx-plain-set]
restore cmp exit=0
1 passed in 22.81s
GREEN_OK N6
=== N7 ===
neutered occurrences=1
2437c2437
<                 _bound_read = _reach_anchor_ms is not None
---
>                 _bound_read = _binance_read = _reach_anchor_ms is not None
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc]
FAILED tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_no_binance_key_on_a_non_binance_run[okx-plain-set]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_raised_okx_read_never_sets_a_binance_flag
3 failed in 23.60s
RED_OK N7 tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc]
RED_OK N7 tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_no_binance_key_on_a_non_binance_run[okx-plain-set]
RED_OK N7 tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_raised_okx_read_never_sets_a_binance_flag
restore cmp exit=0
3 passed in 51.56s
GREEN_OK N7
=== N8 ===
neutered occurrences=1
2591d2590
<                             _bound_read = False
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write[okx]
1 failed in 17.78s
RED_OK N8 tests/test_nullanchor_bound.py::TestBoundOffBinance::test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write[okx]
restore cmp exit=0
1 passed in 40.65s
GREEN_OK N8
=== N9 ===
neutered occurrences=1
3131,3132c3131
<                 if _binance_read:
<                     exchange_dq_flags["binance_stop_below_cursor"] = True
---
>                 exchange_dq_flags["binance_stop_below_cursor"] = True
FAILED tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_a_failed_epilogue_bound_write_sets_no_binance_flag[okx]
1 failed in 25.97s
RED_OK N9 tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_a_failed_epilogue_bound_write_sets_no_binance_flag[okx]
restore cmp exit=0
1 passed in 33.25s
GREEN_OK N9
=== N10 ===
neutered occurrences=1
3050c3050
<     elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:
---
>     elif False:
FAILED tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_advance_sync_cursor_params_are_unchanged[okx-plain-null]
FAILED tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_advance_sync_cursor_params_are_unchanged[binance-plain-null]
2 failed in 20.15s
RED_OK N10 tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_advance_sync_cursor_params_are_unchanged[okx-plain-null]
RED_OK N10 tests/test_nullanchor_bound.py::TestAdvanceSyncCursorUnchanged::test_advance_sync_cursor_params_are_unchanged[binance-plain-null]
restore cmp exit=0
2 passed in 10.71s
GREEN_OK N10
```

### N1 whole-module FAILED lines (informational; `n1-whole-module.txt`)

```
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-null-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-null-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-set-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-set-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[okx-set-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-null-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-null-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[bybit-set-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-null-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-null-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-set-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-set-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_run2_walks_from_run1_walk_start[deribit-set-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[okx-first-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[okx-first-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[okx-first-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[bybit-first-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[bybit-first-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[bybit-first-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[deribit-first-429]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[deribit-first-cancel]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_first_sync_run2_walks_from_the_reach_anchor[deribit-first-plain]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-set-trunc]
FAILED tests/test_nullanchor_bound.py::TestNullAnchorMatrix::test_okx_truncated_read_run2_walks_from_run1_walk_start[okx-first-trunc]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[okx]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[bybit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_clean_read_writes_the_seed_then_clears[deribit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_failed_bound_write_skips_the_read_and_holds_the_daily_store[okx]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_failed_bound_write_skips_the_read_and_holds_the_daily_store[bybit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_failed_bound_write_skips_the_read_and_holds_the_daily_store[deribit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write[okx]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write[bybit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write[deribit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_first_sync_provisional_row_is_the_venue_reach_anchor[okx]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_first_sync_provisional_row_is_the_venue_reach_anchor[bybit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_a_first_sync_provisional_row_is_the_venue_reach_anchor[deribit]
FAILED tests/test_nullanchor_bound.py::TestBoundOffBinance::test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock
39 failed, 32 passed in 37.38s
```

## Phase gate

- Full analytics suite, CI's `python` job command without `-n auto --dist loadgroup` (pytest-xdist is not installed locally):
  `cd analytics-service && python3 -m pytest -q -p no:cacheprovider --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`
  Result, verbatim count and coverage lines (`full-suite-full.txt`; the first run gave the same 19 failures, `19 failed, 17496 passed, 107 skipped, 3950 warnings in 770.57s (0:12:50)`):

  ```
  TOTAL                                       34002   1686    95%
  Required test coverage of 80% reached. Total coverage: 95.04%
  19 failed, 17496 passed, 107 skipped, 3950 warnings in 675.28s (0:11:15)
  ```
  The 19 failures are local-environment causes, listed under "Local-only failures"; the coverage floor is met.
- CI mypy strict (`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 146 source files`. The local binary is 2.0.0 and CI pins 2.4.0, so CI's run is binding.
- Quick command (`tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py`): `163 passed in 32.95s`.
- Clean tree: `git status --porcelain -- analytics-service` is empty and `cmp analytics-service/services/job_worker.py job_worker.py.post` exits 0.
- `git diff --quiet ddd5be9f -- supabase TODOS.md CHANGELOG.md VERSION package.json` exits 0.

## Ship hand-over (SC-3, for /gsd-ship; this plan edits none of these files)

1. **Delete** the `TODOS.md` entry `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` (bullet and all sub-bullets) and name it in the CHANGELOG entry. Gate: `grep -a -c '253-NULL-COLUMN-ANCHOR-ALL-VENUES' TODOS.md` must print 0.
2. **Rewrite** `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` with a dated CORRECTED bullet, keeping the old text as lineage. Scope is now OKX, Bybit and Deribit as well as Binance, measured reachable on a set column and on a first sync for all three venues, not on a NULL column with a seed; Deribit's real impact is nil. Trigger: a PostgREST or RPC outage longer than a cron cycle, or a rollback of migration 20261126150000, live while the switch is on. Owner: to be named by the ship step.
3. **Report that residual to the founder as a decision item.** A fail-closed refusal is not small: `cron_sync` and `/fetch-trades` store daily rows without the bound, so a refusal there is a behaviour change on a separate path.
4. **Book a MEDIUM+ residual** (per CONTEXT "Failure variants") for the OKX silent early stop on a stuck pagination cursor (`natural_break = True` in `_fetch_raw_trades_okx_inst_type`). No flag is raised on that path, so the epilogue cannot keep the bound for it.
5. **CHANGELOG notes:**
   - the SC-1 arms that were GREEN on unmodified code (deviation from SC-1's wording; 26 RED and 4 GREEN at HEAD, the 4 stay as regression pins);
   - the Bybit 365-day first-sync sliver (RESEARCH; not a skipped span by the product's own rule);
   - assumption A1 (OKX `begin` older than 3 months), with the sibling evidence that the bills-archive walk already sends now minus 93 days;
   - the first-sync retry cost (RESEARCH Pitfall 4) and the one-hour bound creep per failed run (Pitfall 5);
   - no migration is part of this phase;
   - the bound table's catalog COMMENTs still say Binance (CONTEXT Deferred);
   - the transitional strict-marker history (plan 01 carried a strict expected-failure marker on 26 arms, plan 02 removed it in the fix commit).

For the verifier: per CLAUDE.md, a verifier run on this phase converts `covered_files` / `covered_digest` to `drift_subjects` plus `verified_at_sha`.

## Deviations from Plan

None - plan executed exactly as written.

Notes (operational, not plan deviations):
- My first N2 to N5 invocation was typed in zsh, where `"$R[okx-null-429]"` expands as a subscript of `$R` and yields an empty node id, so pytest ran the whole suite under N2 with the neuter in place. I killed it, restored `job_worker.py` with `cp` from the byte backup (`cmp` exit 0), truncated the bogus N2 section from `proof-output.txt`, added an abort on an empty or malformed node id to `proof.sh`, and re-ran N2 to N10 from a bash driver. The recorded evidence above is only from the corrected runs.
- The 19 local-only full-suite failures are recorded in "Local-only failures" below.

## Local-only failures

The serial full suite fails 19 tests, all local-environment causes outside this phase's files:
- 18 in `tests/test_metrics.py` and `tests/test_qstats_gate.py`: the local `quantstats` is 0.0.81 while the repo pins 0.0.86 (`test_rank05_quantstats_pin_is_still_0_0_86` fails on `assert '0.0.81' == '0.0.86'`, and the parity and fig03 arms compare live quantstats against mirrors derived from 0.0.86).
- 1 in `tests/test_xdist_group_is_real.py`: pytest-xdist is not installed locally.
Re-running those three files alone gives the same 19 failed (`19 failed, 360 passed`). Phase 255 touched none of `services/metrics.py`, quantstats or the xdist config (`git diff --stat ddd5be9f..HEAD -- analytics-service` lists only `exchange.py`, `job_worker.py`, `trade_resume.py` and six test files). CI's `python` job on the PR is binding.

## Known Stubs

None.

## Threat Flags

None. This plan changes no production file: `job_worker.py` is neutered only in place and restored byte-identical (T-255-10 held: `cmp` before and after every neuter, abort on a non-zero restore, clean tree at the end). T-255-09 held: `RED_OK` is printed per node id only when a FAILED line names it, and no `_MISSING` line exists.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_nullanchor_bound.py (`NEUTER (PROOF-01` block, 10 entries `^  N[0-9]`)
- FOUND commits: 301eb2ee4, da7f274fb (ancestors of HEAD)
- `cmp analytics-service/services/job_worker.py job_worker.py.post` exits 0; `git status --porcelain -- analytics-service` is empty
- No change under supabase/, TODOS.md, CHANGELOG.md, VERSION, package.json; STATE.md and ROADMAP.md untouched (orchestrator owns them)
