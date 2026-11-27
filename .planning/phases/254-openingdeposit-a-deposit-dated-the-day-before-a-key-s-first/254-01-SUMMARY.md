---
phase: 254-openingdeposit-a-deposit-dated-the-day-before-a-key-s-first
plan: 01
subsystem: analytics-service
tags: [allocator-equity, replay-key-equity, opening-deposit, out-of-window-flow, proof-01, neuter, pytest]

requires:
  - phase: 167.1.2.2
    provides: the D-13 opening run and the D-14 zero-start band that full-history keys keep
  - phase: 234
    provides: the stated-tail-day comment style and the `fbd` flows the exemption reads
provides:
  - the opening-deposit exemption in `replay_key_equity` (off full history, deposit only, exactly the day before the first return day)
  - the count flag `opening_deposit_exempted: 1` (never in the payload's flag tokens)
  - SC-1 to SC-3 and writer-basis arms, three old-rule tests reworked, the NEUTER block N1 to N10
affects: [254-ship, allocator-equity-derive]

actuals:
  tokens: 4145
  tasks: 3
  commits: 3
plan_head_before: 68c0043384304e0a24baeecb93cf08677279e83a
plan_head_after: fcb8769996091ef8ea8b917ff12c641899f1ded5
commits: 3

tech-stack:
  added: []
  patterns:
    - "A narrow exemption beside an unchanged D-13 path: the same `fbd` day lookup, gated on `history_reaches_inception` being False, so the zero-start check is never skipped"

key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/allocator_equity_compose.py
    - analytics-service/tests/test_allocator_equity_inception.py

key-decisions:
  - "The exemption is deposit-only (net flow strictly positive), off full history only, reads `fbd`, and carries the int flag `opening_deposit_exempted: 1` (CONTEXT locked decisions)"
  - "Tasks 1 and 2 are `tdd=\"true\"` but the plan fixes one commit per task, so the SC-1 RED is captured as a saved run on unmodified code rather than as a separate RED commit (see Deviations)"

requirements-completed: []

status: complete
---

# Phase 254 Plan 01: OPENINGDEPOSIT Summary

On a key whose history does not reach the account's start (every Bybit key), a deposit dated exactly the day before its first return day is now its opening deposit: it is not counted in `out_of_window_flows`, the key carries the count flag `opening_deposit_exempted: 1`, and no level changes. Full-history keys (Deribit, MT5) keep the D-13 zero-start path byte-unchanged, and every neuter N1 to N10 turned its named arms RED by node id and was restored byte-identical.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (tracer) | Bybit opening deposit through the derive job, RED at HEAD, the exemption, old-rule tests reworked | `beda8870d` |
| 2 | SC-2, SC-3 and writer-basis arms, the stale prose, full suite against the baseline | `c2a48311e` |
| 3 | PROOF-01 N1 to N10 and the NEUTER block | `fcb876999` |

## What was done

- Baseline first: the full analytics suite on the clean tree (19 failed, 17633 passed), failure set saved, no edit under `analytics-service` until its count line was written.
- Tracer: A1, A2, A3 added and seen RED on unmodified code (3 failed, 43 passed). The exemption went in as the three insertions of the implementation contract plus the dated code-site comment. The module then failed exactly the four old-rule ids, which were reworked.
- Task 2: B1, B2, B3, B4 (two ids), C1 (two ids) and D1 added; the comment above `FULL_HISTORY_VENUES`, the `replay_key_equity` docstring, the `compose_allocator_equity` docstring and the test module docstring carry the dated ruling. The `FULL_HISTORY_VENUES` assignment, `_INCEPTION_ZERO_START_BAND`, the source of `_opening_flow_run` (sha256 `f32134b9a7bf6336983413092eb67e86809fccf9a2a664aa2b1e186cebb1b110`) and the `if opening_run:` block (21 lines) are byte-unchanged (all re-run after the prose edits and after the NEUTER block). The compose diff is one hunk inside the `full_history_keys` paragraph. `supabase`, `src`, `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` and `.planning` are untouched against the plan's base `68c004338`.
- Task 3: `neuter.py` (exactly one occurrence or exit 2) and `proof.sh` implement the proof contract; the harness is scratch (untracked). The one change from the contract text: the `RED_OK` match is anchored (`grep '^FAILED '`, strip ` - reason`, `grep -F -x`) instead of an unanchored substring, so a node id that prefixes another cannot be read as RED.
- Every collected node id matched the plan's spelling; no id was renamed. No arm needed strengthening: every named arm went RED on the first run of its neuter, so `proof-output.txt` was produced in one pass and was not re-run.

## Pre-fix RED (verbatim)

SC-1's RED on unmodified code (`red-prefix.txt`, before the fix; the three `FAILED` lines and the count line):

```
FAILED tests/test_allocator_equity_inception.py::test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window
FAILED tests/test_allocator_equity_inception.py::test_the_opening_deposit_off_full_history_is_not_judged_by_the_zero_start_band
FAILED tests/test_allocator_equity_inception.py::test_job_exempts_a_bybit_opening_deposit_end_to_end
3 failed, 43 passed in 11.03s
```

After the fix and before the rework (`after-fix-before-rework.txt`): exactly the four old-rule ids failed, the documented intent change.

```
FAILED tests/test_allocator_equity_inception.py::test_venue_without_full_history_is_unchanged
FAILED tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[binance-True]
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[okx-True]
4 failed, 42 passed in 9.76s
```

After the rework (`task1-green.txt`): `46 passed in 10.36s`. After task 2 and task 3 the module is `54 passed`.

## PROOF-01 (verbatim)

`proof-output.txt`, kept as the harness wrote it: each neuter's diff, the `neutered occurrences=1` line, the `FAILED` lines, the `RED_OK` lines, the count lines, the `restore cmp exit=0` line and the `GREEN_OK` line (pytest's captured source and log dumps are in the per-neuter scratch files and are not quoted).

Tally: `RED_OK` 32 (6 + 2 + 1 + 6 + 6 + 5 + 2 + 1 + 1 + 2), `GREEN_OK` 10, `restore cmp exit=0` 10, `neutered occurrences=1` 10, no `_MISSING` line.

```
=== N1 ===
neutered occurrences=1
1695c1695
<         if not history_reaches_inception:
---
>         if False:
FAILED tests/test_allocator_equity_inception.py::test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window
FAILED tests/test_allocator_equity_inception.py::test_the_opening_deposit_off_full_history_is_not_judged_by_the_zero_start_band
FAILED tests/test_allocator_equity_inception.py::test_job_exempts_a_bybit_opening_deposit_end_to_end
FAILED tests/test_allocator_equity_inception.py::test_a_two_day_run_off_full_history_exempts_only_the_day_before
FAILED tests/test_allocator_equity_inception.py::test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit
FAILED tests/test_allocator_equity_inception.py::test_the_opening_deposit_exemption_reads_the_writer_flows_on_the_writer_basis
6 failed in 12.84s
RED_OK N1 tests/test_allocator_equity_inception.py::test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window
RED_OK N1 tests/test_allocator_equity_inception.py::test_the_opening_deposit_off_full_history_is_not_judged_by_the_zero_start_band
RED_OK N1 tests/test_allocator_equity_inception.py::test_job_exempts_a_bybit_opening_deposit_end_to_end
RED_OK N1 tests/test_allocator_equity_inception.py::test_a_two_day_run_off_full_history_exempts_only_the_day_before
RED_OK N1 tests/test_allocator_equity_inception.py::test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit
RED_OK N1 tests/test_allocator_equity_inception.py::test_the_opening_deposit_exemption_reads_the_writer_flows_on_the_writer_basis
restore cmp exit=0
6 passed in 12.71s
GREEN_OK N1
=== N2 ===
neutered occurrences=1
1697c1697
<             if fbd.get(opening_eve, 0.0) > 0.0:
---
>             if fbd.get(opening_eve, 0.0) != 0.0:
FAILED tests/test_allocator_equity_inception.py::test_a_withdrawal_the_day_before_the_first_return_stays_out_of_window[withdrawal]
FAILED tests/test_allocator_equity_inception.py::test_a_withdrawal_the_day_before_the_first_return_stays_out_of_window[net-withdrawal-day]
2 failed in 11.12s
RED_OK N2 tests/test_allocator_equity_inception.py::test_a_withdrawal_the_day_before_the_first_return_stays_out_of_window[withdrawal]
RED_OK N2 tests/test_allocator_equity_inception.py::test_a_withdrawal_the_day_before_the_first_return_stays_out_of_window[net-withdrawal-day]
restore cmp exit=0
2 passed in 8.96s
GREEN_OK N2
=== N3 ===
neutered occurrences=1
1696c1696
<             opening_eve = (date.fromisoformat(lo) - timedelta(days=1)).isoformat()
---
>             opening_eve = (date.fromisoformat(lo) - timedelta(days=2)).isoformat()
FAILED tests/test_allocator_equity_inception.py::test_a_deposit_two_days_before_the_first_return_stays_out_of_window
1 failed in 10.45s
RED_OK N3 tests/test_allocator_equity_inception.py::test_a_deposit_two_days_before_the_first_return_stays_out_of_window
restore cmp exit=0
1 passed in 13.45s
GREEN_OK N3
=== N4 ===
neutered occurrences=1
1699c1699
<                 out_of_window_flows -= 1
---
>                 out_of_window_flows = 0
FAILED tests/test_allocator_equity_inception.py::test_a_two_day_run_off_full_history_exempts_only_the_day_before
FAILED tests/test_allocator_equity_inception.py::test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit
FAILED tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[binance-True]
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[okx-True]
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[bybit-True]
6 failed in 12.86s
RED_OK N4 tests/test_allocator_equity_inception.py::test_a_two_day_run_off_full_history_exempts_only_the_day_before
RED_OK N4 tests/test_allocator_equity_inception.py::test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit
RED_OK N4 tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
RED_OK N4 tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[binance-True]
RED_OK N4 tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[okx-True]
RED_OK N4 tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[bybit-True]
restore cmp exit=0
6 passed in 13.36s
GREEN_OK N4
=== N5 ===
neutered occurrences=1
1695c1695
<         if not history_reaches_inception:
---
>         if True:
FAILED tests/test_allocator_equity_inception.py::test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[inside-band]
FAILED tests/test_allocator_equity_inception.py::test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[outside-band]
FAILED tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[deribit-False]
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[mt5-False]
FAILED tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[MT5-False]
6 failed in 13.31s
RED_OK N5 tests/test_allocator_equity_inception.py::test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[inside-band]
RED_OK N5 tests/test_allocator_equity_inception.py::test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[outside-band]
RED_OK N5 tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
RED_OK N5 tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[deribit-False]
RED_OK N5 tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[mt5-False]
RED_OK N5 tests/test_allocator_equity_inception.py::test_job_reads_the_venue_from_api_keys[MT5-False]
restore cmp exit=0
6 passed in 14.07s
GREEN_OK N5
=== N6 ===
neutered occurrences=1
1875c1875
<     if opening_deposit_exempted:
---
>     if False:
FAILED tests/test_allocator_equity_inception.py::test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window
FAILED tests/test_allocator_equity_inception.py::test_the_opening_deposit_off_full_history_is_not_judged_by_the_zero_start_band
FAILED tests/test_allocator_equity_inception.py::test_a_two_day_run_off_full_history_exempts_only_the_day_before
FAILED tests/test_allocator_equity_inception.py::test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit
FAILED tests/test_allocator_equity_inception.py::test_the_opening_deposit_exemption_reads_the_writer_flows_on_the_writer_basis
5 failed in 11.09s
RED_OK N6 tests/test_allocator_equity_inception.py::test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window
RED_OK N6 tests/test_allocator_equity_inception.py::test_the_opening_deposit_off_full_history_is_not_judged_by_the_zero_start_band
RED_OK N6 tests/test_allocator_equity_inception.py::test_a_two_day_run_off_full_history_exempts_only_the_day_before
RED_OK N6 tests/test_allocator_equity_inception.py::test_a_post_window_flow_stays_out_of_window_beside_an_exempted_opening_deposit
RED_OK N6 tests/test_allocator_equity_inception.py::test_the_opening_deposit_exemption_reads_the_writer_flows_on_the_writer_basis
restore cmp exit=0
5 passed in 8.45s
GREEN_OK N6
=== N7 ===
neutered occurrences=1
1877c1877
<         flags["opening_deposit_exempted"] = 1
---
>         flags["opening_deposit_exempted"] = True
FAILED tests/test_allocator_equity_inception.py::test_job_exempts_a_bybit_opening_deposit_end_to_end
FAILED tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
2 failed in 9.07s
RED_OK N7 tests/test_allocator_equity_inception.py::test_job_exempts_a_bybit_opening_deposit_end_to_end
RED_OK N7 tests/test_allocator_equity_inception.py::test_compose_passes_full_history_keys_to_the_replay
restore cmp exit=0
2 passed in 8.49s
GREEN_OK N7
=== N8 ===
neutered occurrences=1
1697c1697
<             if fbd.get(opening_eve, 0.0) > 0.0:
---
>             if _flows_by_day(flows).get(opening_eve, 0.0) > 0.0:
FAILED tests/test_allocator_equity_inception.py::test_the_opening_deposit_exemption_reads_the_writer_flows_on_the_writer_basis
1 failed in 8.62s
RED_OK N8 tests/test_allocator_equity_inception.py::test_the_opening_deposit_exemption_reads_the_writer_flows_on_the_writer_basis
restore cmp exit=0
1 passed in 8.79s
GREEN_OK N8
=== N9 ===
neutered occurrences=1
1294c1294
< FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5"})
---
> FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5", "bybit"})
FAILED tests/test_allocator_equity_inception.py::test_reason_is_blocking_and_the_band_and_venues_are_the_founders
1 failed in 8.91s
RED_OK N9 tests/test_allocator_equity_inception.py::test_reason_is_blocking_and_the_band_and_venues_are_the_founders
restore cmp exit=0
1 passed in 8.25s
GREEN_OK N9
=== N10 ===
neutered occurrences=1
1247c1247
< _INCEPTION_ZERO_START_BAND = 1e-4
---
> _INCEPTION_ZERO_START_BAND = 1e-3
FAILED tests/test_allocator_equity_inception.py::test_reason_is_blocking_and_the_band_and_venues_are_the_founders
FAILED tests/test_allocator_equity_inception.py::test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[outside-band]
2 failed in 8.88s
RED_OK N10 tests/test_allocator_equity_inception.py::test_reason_is_blocking_and_the_band_and_venues_are_the_founders
RED_OK N10 tests/test_allocator_equity_inception.py::test_a_full_history_opening_deposit_is_still_judged_by_the_zero_start_band[outside-band]
restore cmp exit=0
2 passed in 8.74s
GREEN_OK N10
```

After the run: `cmp analytics-service/services/allocator_equity_derive.py` against the byte backup exits 0 and `git status --porcelain -- analytics-service` is empty.

## Old-rule assertions changed

Each carries a dated note naming Phase 254, founder ruling 2026-11-26, "Exempt it, book for v1.23".

- `test_venue_without_full_history_is_unchanged` (deleted) is replaced by A1, `test_a_bybit_opening_deposit_the_day_before_the_first_return_is_not_out_of_window`. Before: the default and the explicit `history_reaches_inception=False` call on a single day -1 deposit read as one `out_of_window_flow` with flags `{"out_of_window_flows": 1}`. After: the same fixture and the same default-vs-explicit comparison read `degrade_reasons == frozenset()`, flags `{"opening_deposit_exempted": 1}`, trustworthy, the levels unchanged, the two series equal. The section header is renamed "a venue without full history: the opening deposit (Phase 254)".
- `_compose` / `test_compose_passes_full_history_keys_to_the_replay` (E1). Before: a single day -1 deposit, so a key outside `full_history_keys` kept `out_of_window_flow`. After: the two-day run (days -2 and -1), so the full-history key reconciles both days and any other key keeps exactly one `out_of_window_flow` (day -2) and the wiring stays distinguishable; the test gains `"opening_deposit_exempted" not in other["flags"]`. Its three assertion groups are kept.
- `test_job_reads_the_venue_from_api_keys` (E2). Before: a single day -1 deposit, `binance` and `okx` blocked by position. After: `_job_inputs(exchange, flows={-2: 60_000.0, -1: 40_000.0})`, the parametrize list is `deribit/False, mt5/False, MT5/False, binance/True, okx/True, bybit/True` (ids `deribit-False` to `bybit-True`), assertions unchanged. `_job_inputs(exchange, flows=None)` keeps today's `{-1: 100_000.0}` row for every other caller.
- No other module pinned the old rule: the full-suite set difference is empty, so no deviation file was edited.

## Full suite (baseline vs post-fix)

Command, both runs (CI's `python` job command without `-n auto --dist loadgroup`, because pytest-xdist is not installed locally), from `analytics-service/`:

```
python3 -m pytest -q -p no:cacheprovider --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80
```

- Baseline (clean tree at `68c004338`): `19 failed, 17633 passed, 107 skipped, 3953 warnings in 1293.27s (0:21:33)`; `TOTAL                                       34108   1683    95%`; `Required test coverage of 80% reached. Total coverage: 95.07%`.
- Post-fix (all code changes in): `19 failed, 17644 passed, 107 skipped, 3953 warnings in 926.49s (0:15:26)`; `TOTAL                                       34116   1683    95%`; `Required test coverage of 80% reached. Total coverage: 95.07%`.
- `cmp base-failed.txt post-failed.txt` reports the same set, and `new-failures.txt` is empty (0 bytes).

`base-failed.txt` (all 19, all local-only; the same 19 fail in the post-fix run):

```
FAILED tests/test_metrics.py::test_fig03_live_greeks_and_r_squared_on_a_strategy_gap_pair
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[benign_all_positive]
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[benign_mixed]
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns]
FAILED tests/test_metrics.py::test_fig03_live_rolling_alpha_matches_the_mirror
FAILED tests/test_metrics.py::test_fig03_live_sortino_matches_the_skipna_count
FAILED tests/test_metrics.py::test_fig03_serenity_is_the_historical_tail_not_the_parametric_default
FAILED tests/test_metrics.py::test_fig03_stored_cvar_keeps_the_repo_floor_index_rule
FAILED tests/test_metrics.py::test_fig03_time_in_market_is_the_unrounded_observed_exposure[fig03_gappy]
FAILED tests/test_metrics.py::test_fig03_win_rate_is_nan_invariant
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_all_positive]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_mixed]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns]
FAILED tests/test_metrics.py::test_rank05_quantstats_pin_is_still_0_0_86
FAILED tests/test_qstats_gate.py::test_fig03_cvar_honours_prepare_returns_false
FAILED tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix
```

Causes: 18 are the `tests/test_metrics.py` and `tests/test_qstats_gate.py` quantstats arms. This machine has quantstats 0.0.81 where the repo pins 0.0.86 (`cvar() got an unexpected keyword argument 'method'`, `quantstats pin moved to 0.0.81`, mirror drift from 0.0.86). The 19th, `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`, needs pytest-xdist, which is not installed locally. `tests/test_legacy_table_not_named.py::test_no_production_string_names_a_dropped_object` passed in-tree both before and after, so it is not in the set.

## mypy

CI's "Type gate - mypy strict over the running-service surface" command, from `analytics-service/`:

```
mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
```

Result: `Success: no issues found in 146 source files` (local mypy 2.0.0; CI's `python` job pins its own version and is binding).

## ruff

```
ruff check --no-cache services/allocator_equity_derive.py services/allocator_equity_compose.py tests/test_allocator_equity_inception.py
```

Result: `All checks passed!` (ruff 0.15.7; not a CI gate, this phase's pre-push hygiene check).

## Deviations from Plan

1. **[Process] No separate RED commit for the TDD tasks.** Tasks 1 and 2 carry `tdd="true"`, and `tdd.md` describes a `test(...)` RED commit before a `feat(...)` commit for `type: tdd` plans. This plan is `type: execute` and fixes one commit per task, with the `feat` message for task 1. The SC-1 RED is instead a saved run on unmodified code (`red-prefix.txt`, quoted above) and the pre-existing tests passed in it. No gate was skipped; the evidence is the saved run and the PROOF-01 neuters.
2. **[Process] `proof.sh` anchored match.** The `RED_OK` test is `grep -F -x` on the `FAILED` line with its ` - reason` suffix stripped, tighter than the contract's substring match. It can only turn a `RED_OK` into a `RED_MISSING`, never the reverse, and none occurred.
3. **[Count] "62 modules" read as 65 at HEAD.** Not load-bearing: the gate is the full-suite set difference, which is empty.

No Rule 1 to 4 deviations. No authentication gates. No package was installed.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the count flag `opening_deposit_exempted`, an int that `_bool_flag_tokens` (which keeps only `True`) never lets into the payload; A3 and E1 assert it is absent from the payload's `flags`, and N7 (a `True` flag) turns both RED. T-254-01 to T-254-05 mitigations are each pinned (B1, B3, B4, C1 with N2, N3, N4, N5; the byte checks; N7; the anchored `RED_OK`; `cmp` before and after every neuter). T-254-06 and T-254-07 are accepted as the plan states and are named in the `replay_key_equity` docstring.

## Ship notes (this plan edits none of these files)

- No `TODOS.md` entry is closed by this phase (measured at planning: `TODOS.md` names no Phase 254 entry).
- The CHANGELOG entry names: the 2026-11-26 founder ruling "Exempt it, book for v1.23"; the new count flag `opening_deposit_exempted` (not in the payload); the known retention-edge limit (on OKX and Bybit a day -1 deposit is exempted even when the returns start at the retention edge rather than at the account's start); the re-entry-segment KNOWN EDGE (a later segment of a Deribit or MT5 key split at an unpriced hole is replayed with `history_reaches_inception` False, so the day before that segment's first return day is exempted the same way; such a segment never had the D-13 check, no level changes, PROD impact today is nil); and that the one PROD book's `out_of_window_flow` clears on its next daily derive while `window_truncated` stays. No migration, no reader change, no PROD write.
- A verifier run converts `covered_files` / `covered_digest` to `drift_subjects` plus `verified_at_sha` (CLAUDE.md).
- Local-only baseline failures: 18 quantstats-pin arms and 1 xdist arm, identical before and after; CI's `python` job on the PR is binding.

## Self-Check: PASSED

- Commits `beda8870d`, `c2a48311e`, `fcb876999` are ancestors of HEAD.
- The three modified files exist; `git status --porcelain -- analytics-service` is empty; `allocator_equity_derive.py` is byte-equal to the post-task-2 backup.
