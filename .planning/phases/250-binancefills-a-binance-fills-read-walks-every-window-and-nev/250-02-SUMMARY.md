---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 02
subsystem: analytics-service (sync_trades fills-cursor gate)
tags: [binance, cursor-gate, read-through-bound, SC-2, SC-3, SC-4, PROOF-01]
status: complete
requires: [250-01]
provides:
  - "the fills-cursor gate of run_sync_trades_job stamps the newest PERSISTED fill at or before binance_read_through_ms, exact to the millisecond"
  - "a stop record without a usable plain-int bound holds the cursor (anchors a NULL column) and logs one WARNING"
  - "a stopped read that left nothing stampable anchors a NULL column at the read start"
  - "binance_unlisted_symbols and binance_fills_reach_clamped never hold"
  - "the SC-4 precondition comment above _RAW_TRADE_INGESTION_ENABLED, quiet-prefix exception named"
affects: [analytics-service/services/job_worker.py, analytics-service/tests]
tech-stack:
  added: []
  patterns: ["bound only selects among persisted fills, never stamped itself", "unusable stop record == hold (a swallowed flag must not read as no-stop)"]
key-files:
  created:
    - analytics-service/tests/test_binancefills_cursor.py
  modified:
    - analytics-service/services/job_worker.py
key-decisions:
  - "The bound is datetime(1970,1,1,UTC) + timedelta(milliseconds=B), gated by type(value) is int and >= 0 (bool excluded); OverflowError leaves it unusable (a hold)"
  - "The unusable-stop hold is applied as a follow-up statement after the HEAD _fills_incomplete any(...) expression (not folded into that expression) so the HEAD text and the plan's awk acceptance range stay intact; semantics are the plan's OR"
requirements-completed: [SC-2, SC-3, SC-4, SC-5]
plan_head_before: aa8d83e6089651e2346950718f1bcec32628048d
plan_head_after: 910cd40e98ad366c999393ab45b3b511be18c4a0
commits: 3
actuals:
  tokens: 5910
  tasks: 3
  commits: 3
---

# Phase 250 Plan 02: The fills-cursor gate honours a stopped read's bound Summary

The Binance fills-cursor gate in `run_sync_trades_job` now stamps only a persisted fill at or before `binance_read_through_ms`, holds when a stop record lost its bound, anchors a NULL column when a stop stored nothing stampable, never holds on the unlisted or clamp flags, and the switch comment records the Phase 250 precondition with the quiet-prefix exception.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | a672a4d58 | bound filter in the gate; tracer and millisecond arms |
| 2 | b63d17d7d | holds win, stop anchor, unusable-bound hold (T-250-05, T-250-08) |
| 3 | 910cd40e9 | non-holding flags, transient refuse-then-clean, SC-4 comment |

## Tests

`tests/test_binancefills_cursor.py`: 18 collected cases, all GREEN. `tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_sync_trades_resume_seed.py tests/test_job_worker.py`: 170 passed, 1 skipped (pre-existing). `tests/test_okxtrades_cursor.py` is unedited (`git diff --quiet` exits 0). All arms drive the real `run_sync_trades_job`.

mypy (CI command): `Success: no issues found in 143 source files`.

## Tracer RED on pre-fix code (unmodified job_worker.py, verbatim)

```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_tracer_a_stopped_read_stamps_the_newest_fill_at_or_before_its_bound
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_the_bound_is_inclusive_to_the_millisecond
2 failed in 10.15s
E       AssertionError: a stopped read must stamp the newest persisted fill at or before its read-through bound, not the newest fill of every symbol
E       assert '2026-06-03T09:00:00+00:00' == '2026-06-01T09:00:00+00:00'
E       assert '2026-06-03T09:00:00+00:00' == '2026-06-01T09:00:00.123000+00:00'
```

After the Task 1 edit: `2 passed`.

## Task 2 arms RED on the Task 1 code (before the anchor and unusable-bound edit)

```
FAILED ...test_a_stop_with_nothing_stampable_anchors_a_null_column[every-fill-after-the-bound]
FAILED ...test_a_stop_with_nothing_stampable_anchors_a_null_column[empty-fill-list]
FAILED ...test_a_stop_record_without_a_usable_bound_holds[cap-list-alone]
FAILED ...test_a_stop_record_without_a_usable_bound_holds[untimed-list-alone]
FAILED ...test_a_stop_record_without_a_usable_bound_holds[deadline-list-alone]
FAILED ...test_a_stop_record_without_a_usable_bound_holds[bound-is-bool]
FAILED ...test_a_stop_record_without_a_usable_bound_holds[bound-is-str]
FAILED ...test_a_stop_record_without_a_usable_bound_holds[bound-is-negative]
FAILED ...test_a_stop_record_without_a_usable_bound_anchors_a_null_column
9 failed, 6 passed in 36.10s
```
As predicted, `test_a_hold_beats_a_stop` and the two-stop and set-column arms were already GREEN (the filter sat under `if advance_fetched_cursor`).

## PROOF-01 records (verbatim)

Method for every neuter: byte backup of `services/job_worker.py` in the session scratchpad (outside the worktree), edit, run `pytest tests/test_binancefills_cursor.py -q -p no:cacheprovider`, `cp` the backup back, `cmp` (silent = identical), re-run GREEN. Backups: `.../scratchpad/job_worker.250-02.t1` (N10), `.t2` (N11, N12, N20), `.t3` (N7, N8). The `cmp` lines below are `cmp <backup> analytics-service/services/job_worker.py && echo "cmp silent"`.

### N10: drop the bound filter (stamp = plain maximum)

```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_tracer_a_stopped_read_stamps_the_newest_fill_at_or_before_its_bound
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_the_bound_is_inclusive_to_the_millisecond
2 failed in 22.71s
cmp silent
2 passed in 10.40s
```

### N11: stamp a bound-filtered fill even under a hold (`if advance_fetched_cursor or (bool(raw_fills) and _read_through is not None and not phase2_failed):`)

```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_hold_beats_a_stop[partial-symbols]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_hold_beats_a_stop[sync-truncated]
2 failed, 13 passed in 22.36s
cmp silent
15 passed in 17.96s
```
(A first, cruder N11 that dropped the `not _fills_incomplete` conjunct outright also turned the unusable-bound arms RED; it was replaced by the narrower neuter above so only the hold arm names the defect. Its GREEN restore was `cmp`-silent too.)

### N12: delete the trailing stop-anchor statement

```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_with_nothing_stampable_anchors_a_null_column[every-fill-after-the-bound]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_with_nothing_stampable_anchors_a_null_column[empty-fill-list]
2 failed, 13 passed in 24.93s
cmp silent
15 passed in 38.86s
```

### N20: delete the unusable-stop hold (`_fills_incomplete = True` after the WARNING)

```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_holds[cap-list-alone]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_holds[untimed-list-alone]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_holds[deadline-list-alone]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_holds[bound-is-bool]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_holds[bound-is-str]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_holds[bound-is-negative]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_stop_record_without_a_usable_bound_anchors_a_null_column
7 failed, 8 passed in 23.32s
cmp silent
15 passed in 23.71s
```

### N7: add a non-holding key to the holding predicate of `_fills_incomplete`

`binance_unlisted_symbols`:
```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_non_holding_flag_alone_stamps_the_newest_fill[unlisted-symbols]
1 failed, 17 passed in 18.92s
cmp silent
```
`binance_fills_reach_clamped`:
```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_non_holding_flag_alone_stamps_the_newest_fill[reach-clamped]
1 failed, 17 passed in 17.12s
cmp silent
```

### N8: drop the `binance_partial_symbols` disjunct of `_fills_incomplete`

```
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_hold_beats_a_stop[partial-symbols]
FAILED tests/test_binancefills_cursor.py::TestBinanceFillsCursorGate::test_a_transiently_failed_symbol_holds_then_is_reread_clean
2 failed, 16 passed in 19.70s
cmp silent
18 passed in 18.39s
```

## For the ship CHANGELOG (SC-4)

Keep `USE_RAW_TRADE_INGESTION` off for Binance until this release (Phase 250, SC-1 to SC-3) is on main; it is one of several venue conditions for that switch. One named exception to SC-1 ships with it (the quiet-prefix deadline known limit, founder ruling 2026-11-25 UTC): a sync read stopped by its deadline over a prefix holding no stored fill leaves the cursor where it was, named by `binance_deadline_symbols` on every such run and bounded by the reach clamp.

## Deviations from Plan

**1. [Minor, structural] `_fills_incomplete` extension is a follow-up statement, not folded into the `any(...)`.**
The plan text says `_fills_incomplete` "becomes the HEAD expression OR (...)" and to compute the bound "before `_fills_incomplete`". The plan's own acceptance greps run an awk range starting at the line `_fills_incomplete = any(` and require `binance_read_through_ms` and `timedelta(milliseconds=` inside it. To satisfy both, the HEAD `any(...)` expression is untouched, the bound is computed right after it, and `if _fills_stopped and _read_through is None: ... _fills_incomplete = True` follows. The semantics are identical (HEAD OR unusable-stop); the `advance_fetched_cursor` expression and the bootstrap-anchor `elif` keep their HEAD text. The WARNING fires only when the unusable stop is what makes the read incomplete.

Otherwise: plan executed as written. Write scope held: `git diff -U0` shows hunks only in the gate block and the comment above `_RAW_TRADE_INGESTION_ENABLED`; nothing from 'NEW-C12-05 (CL12): fenced epilogue write' onward, no Phase 1 / Phase 2 ordering change.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface. T-250-05, T-250-06, T-250-07, T-250-08 mitigations are in place and pinned (N20, millisecond arm, comment, N11).

## Notes for later plans

- 250-03/250-06/250-07 produce `binance_read_through_ms` (plain int, one `_record_dq_flag` call per read, minimum over stopped symbols) and the three stop lists exactly as the frozen contract states; this gate already consumes them and holds on any stop list whose bound is missing.
- The quiet-prefix deadline limit (a deadline stop over a prefix with no stored fill) is exactly the "nothing stampable" case: a set column stays, a NULL column anchors at the read start.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_binancefills_cursor.py
- FOUND commits: a672a4d58, b63d17d7d, 910cd40e9 (all ancestors of HEAD)
- `git diff --quiet -- analytics-service/tests/test_okxtrades_cursor.py` exits 0
- grep acceptance: `Phase 250 BINANCEFILLS (SC-4):` 1, `USE_RAW_TRADE_INGESTION", "false"` 1, `quiet-prefix deadline known limit` 1, `founder ruling 2026-11-25` 1
