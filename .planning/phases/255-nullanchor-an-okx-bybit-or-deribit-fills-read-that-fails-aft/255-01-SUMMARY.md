---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
plan: 01
subsystem: testing
tags: [pytest, analytics-service, okx, bybit, deribit, fills-cursor, two-run-matrix, strict-xfail]

requires:
  - phase: 253
    provides: RereadBounds stateful bound store, column_after_advance, the two-run walk-start harness
provides:
  - SC-1 two-run matrix (30 arms) measured on unmodified code at HEAD
  - SC-2 pin (28 arms) on advance_sync_cursor params and the Binance-only flag surface
affects: [255-02, 255-03]

actuals:
  tokens: 4359
  tasks: 2
  commits: 2
plan_head_before: 10e0ea8c5145a94ff92b51ef553b4a9083102b29
plan_head_after: da199cc74a7111c8db1ca94fbb00b2591049f4de
commits: 2

tech-stack:
  added: []
  patterns:
    - "Measure-first gate: write the matrix, run it unmarked at HEAD, save the run, then mark exactly the measured-RED arms with a strict AssertionError-only xfail"

key-files:
  created:
    - analytics-service/tests/test_nullanchor_bound.py
  modified: []

key-decisions:
  - "Arms are marked from the saved unmarked HEAD run, never from RESEARCH's prediction (the two agreed exactly: 26 RED, 4 GREEN)"
  - "Goldens for the SC-2 pin are hand-typed from the saved HEAD output, not computed"

requirements-completed: [SC-1, SC-2, SC-4]

status: complete
---

# Phase 255 Plan 01: NULLANCHOR gate measured at HEAD Summary

One new test module, `analytics-service/tests/test_nullanchor_bound.py`, holds the SC-1 two-run matrix (30 arms across OKX, Bybit and Deribit, driving the real `run_sync_trades_job` twice) and the SC-2 pin (28 arms) on `advance_sync_cursor` and the Binance-only flag surface. Zero production diff.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | SC-1 two-run matrix through the real handler, measured on unmodified code | 9207d12d8 |
| 2 | SC-2 pin: advance_sync_cursor params and the Binance-only flag surface | da199cc74 |

## Task 1: unmarked HEAD measurement (verbatim)

Saved at `$SCRATCH/255/plan01/matrix-unmarked-head.txt` (untracked scratch). Final count line of the unmarked run:

```
26 failed, 4 passed in 12.22s
```

The 26 `FAILED` lines:

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
```

Wrong-reason check: `grep -a -c '^FAILED'` = 26 and `grep -a -c '^E .*AssertionError: NULLANCHOR-WALK-START'` = 26. Every RED arm failed on the walk-start assertion, none on a premise or harness fault.

### 30-row matrix table (HEAD result, run 2 `since_ms`)

Run 2 `since_ms` was printed from a scratch run (saved at `$SCRATCH/255/plan01/since-null-and-set-head.txt`; first-sync values read from the saved traceback `E` lines). The scratch file was removed, nothing printed is committed. Pass bound: 1778112000000 - 3600000 = 1778108400000 for null/set arms; the venue reach anchor for first-sync arms.

| id | HEAD | run 2 since_ms |
| -- | ---- | -------------- |
| okx-null-429 | RED | 1783987200000 |
| okx-null-cancel | RED | 1783987200000 |
| okx-null-plain | GREEN | 1778112000000 |
| okx-set-429 | RED | 1781913600000 |
| okx-set-cancel | RED | 1781913600000 |
| okx-set-plain | RED | 1781913600000 |
| bybit-null-429 | RED | 1783987200000 |
| bybit-null-cancel | RED | 1783987200000 |
| bybit-null-plain | GREEN | 1778112000000 |
| bybit-set-429 | RED | 1781913600000 |
| bybit-set-cancel | RED | 1781913600000 |
| bybit-set-plain | RED | 1781913600000 |
| deribit-null-429 | RED | 1783987200000 |
| deribit-null-cancel | RED | 1783987200000 |
| deribit-null-plain | GREEN | 1778112000000 |
| deribit-set-429 | RED | 1781913600000 |
| deribit-set-cancel | RED | 1781913600000 |
| deribit-set-plain | RED | 1781913600000 |
| okx-first-429 | RED | 1783987200000 |
| okx-first-cancel | RED | 1783987200000 |
| okx-first-plain | RED | 1783987200000 |
| bybit-first-429 | RED | 1783987200000 |
| bybit-first-cancel | RED | 1783987200000 |
| bybit-first-plain | RED | 1783987200000 |
| deribit-first-429 | RED | 1783987200000 |
| deribit-first-cancel | RED | 1783987200000 |
| deribit-first-plain | RED | 1783987200000 |
| okx-null-trunc | GREEN | 1778112000000 |
| okx-set-trunc | RED | 1781913600000 |
| okx-first-trunc | RED | 1783987200000 |

### Ids carrying the strict marker `RED_AT_HEAD` (plan 02 removes exactly these 26)

okx-null-429, okx-null-cancel, okx-set-429, okx-set-cancel, okx-set-plain, bybit-null-429, bybit-null-cancel, bybit-set-429, bybit-set-cancel, bybit-set-plain, deribit-null-429, deribit-null-cancel, deribit-set-429, deribit-set-cancel, deribit-set-plain, okx-first-429, okx-first-cancel, okx-first-plain, bybit-first-429, bybit-first-cancel, bybit-first-plain, deribit-first-429, deribit-first-cancel, deribit-first-plain, okx-set-trunc, okx-first-trunc.

Unmarked regression pins (GREEN at HEAD, no marker): okx-null-plain, bybit-null-plain, deribit-null-plain, okx-null-trunc.

After marking: module run `4 passed, 26 xfailed`; combined with `tests/test_binancefills_cursor.py` and `tests/test_okxtrades_cursor.py`, Task 1 closed at `96 passed, 26 xfailed`.

## Task 2: SC-2 pin and goldens

28 arms, all PASS at HEAD, no marker: 18 `test_advance_sync_cursor_params_are_unchanged`, 7 `test_no_binance_key_on_a_non_binance_run`, 3 `test_a_failed_epilogue_bound_write_sets_no_binance_flag`. Goldens were measured once at HEAD (saved at `$SCRATCH/255/plan01/advance-golden-head.txt`) and hand-typed into the params. They match RESEARCH's prediction on every arm; Binance's values were measured and are listed here.

`p_last_fetched_ts` goldens (all arms assert the exact six-key set):

| scenario | binance | okx | bybit | deribit |
| -------- | ------- | --- | ----- | ------- |
| clean-null | 2026-07-14T09:00:00+00:00 | same | same | same |
| clean-set | 2026-07-14T09:00:00+00:00 | same | same | same |
| plain-null | 2026-05-07T00:00:00+00:00 | same | same | same |
| plain-set | None | None | None | None |
| trunc-null (okx) | | 2026-05-07T00:00:00+00:00 | | |
| trunc-set (okx) | | None | | |

Flag surface seen at HEAD: on every OKX, Bybit and Deribit plain arm `phase2_fill_ingestion_failed` is True and no `binance_*` key exists; the OKX truncated arms carry only `sync_truncated_okx`. Binance `plain-set` carries `binance_stop_below_cursor` (the Binance-only flag these arms guard against leaking elsewhere).

Final module run count line: `124 passed, 26 xfailed` across `tests/test_nullanchor_bound.py`, `tests/test_binancefills_cursor.py` and `tests/test_okxtrades_cursor.py`; the module alone is 58 arms (30 matrix + 28 SC-2).

## Verification

- `git diff --quiet ddd5be9f -- analytics-service/services analytics-service/routers analytics-service/models` exits 0 (zero production diff).
- CI mypy strict command: `Success: no issues found in 146 source files`. The local binary is mypy 2.0.0 and CI pins 2.4.0, so CI's run is binding.

## Deviations from Plan

### SC-1 "each arm is RED" does not hold for four arms

These four arms are GREEN on unmodified code. They are kept as regression pins, unmarked, and were not forced RED:

- **okx-null-plain, bybit-null-plain, deribit-null-plain.** Run 2's `since_ms` is 1778112000000, the Phase 232 bootstrap anchor that the epilogue stamps when a NULL-column run's fills read fails with a plain exception (the run returns DONE and the epilogue runs). A 429 or cancel skips the epilogue, which is why those arms are RED.
- **okx-null-trunc.** Same mechanism: a truncated OKX read on a NULL column still anchors the column at the daily seed 2026-05-07T00:00:00+00:00 (see the SC-2 golden `okx-trunc-null`), so run 2 walks from 1778112000000.

These four match RESEARCH's prediction exactly (26 RED / 4 GREEN); no arm differs from the prediction.

### Auto-fixed Issues

None. The plan executed as written. Notes:

- `mypy --strict` run directly on the new test module reports one `no-any-return` (`_variant_error` returns a ccxt exception typed Any). CI's mypy command does not cover `tests/`, so this was left untouched.
- The plan's helper wording said run 2 "returns DONE": `_run_job` asserts that itself.

## Known Stubs

None.

## Threat Flags

None. Test-only change; no new network, auth or schema surface.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_nullanchor_bound.py
- FOUND commits: 9207d12d8, da199cc74 (ancestors of HEAD)
- Production diff vs ddd5be9f: none
- STATE.md and ROADMAP.md untouched (orchestrator owns them)
