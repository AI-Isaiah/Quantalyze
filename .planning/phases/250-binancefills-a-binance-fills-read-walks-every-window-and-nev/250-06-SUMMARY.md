---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
plan: 06
subsystem: analytics-service/services/exchange.py (Binance fills read, early-stop recording and the overlap exemption)
tags: [binance, ccxt, page-cap, untimed-page, read-through, overlap, PROOF-01, SC-3, SC-5]
status: complete
requires: ["250-02", "250-05"]
provides:
  - "binance_page_cap_symbols, binance_untimed_page_symbols and exactly ONE binance_read_through_ms (the minimum over stopped symbols, across stop kinds) recorded after the gather"
  - "pre_overlap_seed_ms (keyword-only, default None) on _fetch_raw_trades_binance, passed by fetch_raw_trades; a full page re-reading the hour below the seed does not count toward BINANCE_PAGE_CAP (the cap stays 20)"
  - "SC-3 end to end: a capped symbol is stamped at its newest read fill and the next run resumes past the cap, including when the overlap hour below the cap stamp holds 20,081 fills"
affects: [analytics-service/services/exchange.py, analytics-service/tests]
key-files:
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_binancefills_walk.py
    - analytics-service/tests/test_binancefills_e2e.py
    - analytics-service/tests/test_exchange.py
key-decisions:
  - "The exemption counts pages with a while loop and a counted_pages counter; the for-else cap branch (and its WARNING) became the while-else, so every break (empty, short page, untimed, same-ms window complete) keeps its 250-03 precedence over the cap"
requirements-completed: [SC-3, SC-5]
plan_head_before: 7c56ce8900b2a984f31467f6b18aca4a144d859e
plan_head_after: caf000a18152b63eaa8b57b62446309560ab7a6a
commits: 2
actuals:
  tokens: 6600
  tasks: 2
  commits: 2
---

# Phase 250 Plan 06: Page-cap and untimed stops are named with one bound; overlap pages are exempt from the cap Summary

A capped Binance symbol is now named with the newest fill it read, the real sync job stamps no later than that fill, and the next run resumes past the cap. That holds even when the 1 h overlap below the cap stamp holds more fills than 20 pages can serve, because pages that re-read the overlap no longer count toward the cap. The untimed-page stop is named and folded into the same single bound.

## Task commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 2c5657964 | result-loop collection and the three flag recordings; real-constant walk arm and two-run e2e arm; N9, N10e, N21 |
| 2 | caf000a18 | `pre_overlap_seed_ms` and the uncounted overlap pages; full-overlap e2e arm, minimum-bound arm, untimed-page arm (2 cases), legacy cap test extended; N16, N25, N29 |

## RED lines (verbatim)

### Task 1 arms on the 250-05 code (unmodified `services/exchange.py`)

```
E       AssertionError: assert None == ['BTCUSDT']
E        +  where None = <built-in method get of dict object at 0x11cb163c0>('binance_page_cap_symbols')
E        +    where <built-in method get of dict object at 0x11cb163c0> = {}.get
E       AssertionError: the stamp passed the capped symbol's newest read fill
E       assert '2026-10-22T01:00:00+00:00' == '2026-10-21T22:00:00+00:00'
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_capped_window_is_named_with_its_read_through_bound
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_a_capped_symbol_resumes_past_the_cap_on_the_next_run
2 failed, 27 deselected in 10.62s
```

(The walk arm got through its 20-call, one-window, 20,000-row and 19,981-distinct-id assertions on the old code: only the flag was missing. The first draft of the e2e arm read `analytics_upserts[-1]` before the stamp and raised `IndexError` because a run with no flags writes none; the stamp assertion now comes first so the RED line is the stamp.)

### Task 2 arms on the Task 1 code

```
E           AssertionError: run 2 capped again
E           assert 'binance_page_cap_symbols' not in {'binance_page_cap_symbols': ['BTCUSDT'], 'binance_read_through_ms': 1792590582000}
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_a_cap_stamp_whose_overlap_hour_is_full_resumes_past_the_cap
3 failed, 2 passed, 28 deselected in 13.87s
```

Run 2 capped at 1792590582000 = f(19881), before B = 1792590597000, as the plan predicted. The two other FAILED lines in that run were the untimed arm's two cases, caused by my fixture (BTCUSDT's first page had a timestamped fourth row ahead of the untimed row, so the page's last row WAS timed). Fixed before any commit by removing that row; the untimed and minimum-bound arms then passed on the Task 1 recording (as the plan expected: their ability to fail is shown by N16 and N25). The legacy `test_binance_pagination_hits_page_cap` extension also passed on the Task 1 code.

## PROOF-01 records (verbatim)

Backups in the session scratchpad, outside the worktree: `exchange.250-06.t1` and `job_worker.250-06.t1` (Task 1), `exchange.250-06.t2` (Task 2). Each neuter used an asserted single-occurrence replace; each restore was `cp` from the backup and `cmp <backup> <file>` (silent = identical) before the GREEN re-run. `git status` after N10e showed `services/job_worker.py` unmodified.

### N9: `_record_dq_flag("binance_page_cap_symbols", ...)` replaced by `pass`

```
E       AssertionError: assert None == ['BTCUSDT']
E        +  where None = <built-in method get of dict object at 0x11dd323c0>('binance_page_cap_symbols')
E        +    where <built-in method get of dict object at 0x11dd323c0> = {'binance_read_through_ms': 1792607580000}.get
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_capped_window_is_named_with_its_read_through_bound
1 failed, 22 deselected in 10.03s
cmp silent
1 passed, 22 deselected in 9.64s
```

### N21: the cap branch's WARNING call deleted from `_fetch_one`

```
E       AssertionError: exactly one cap WARNING must name the symbol
E       assert 0 == 1
E        +  where 0 = len([])
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_capped_window_is_named_with_its_read_through_bound
1 failed, 22 deselected in 9.89s
cmp silent
1 passed, 22 deselected in 10.50s
```

### N10e: `services/job_worker.py` gate, `if _read_through is not None:` -> `if False and _read_through is not None:` (the bound filter dropped)

```
E       AssertionError: the stamp passed the capped symbol's newest read fill
E       assert '2026-10-22T01:00:00+00:00' == '2026-10-21T22:00:00+00:00'
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_a_capped_symbol_resumes_past_the_cap_on_the_next_run
1 failed, 5 deselected in 10.19s
cmp silent
1 passed, 5 deselected in 10.33s
```

### N16: `binance_read_through_ms` recorded once per stopped symbol (`for _b in stop_bounds: _record_dq_flag(...)`) instead of once as the minimum

```
E       AssertionError: assert 3589902000000 == 1794934800000
E        +  where 3589902000000 = <built-in method get of dict object at 0x11a114080>('binance_read_through_ms')
E       AssertionError: assert 3589841100000 == 1794917100000
E        +  where 3589841100000 = <built-in method get of dict object at 0x119e51640>('binance_read_through_ms')
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_two_stopped_symbols_record_the_smaller_bound_once
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_page_it_cannot_page_past_is_named_with_a_bound[beside-a-capped-symbol]
2 failed, 2 passed, 22 deselected in 15.05s
cmp silent
4 passed, 22 deselected in 12.38s
```

(The buffer SUMS the two bounds: 1794934800000 + 1794967200000 = 3589902000000, an instant after both. The second failure shows the same sum across stop kinds, a capped and an untimed symbol.)

### N25: the `binance_untimed_page_symbols` record deleted AND the untimed kind dropped from the bounds list

```
E       AssertionError: assert None == ['BTCUSDT']
E        +  where None = <built-in method get of dict object at 0x11bfef900>('binance_untimed_page_symbols')
E        +    where <built-in method get of dict object at 0x11bfef900> = {}.get
E       AssertionError: assert None == ['BTCUSDT']
E        +  where None = <built-in method get of dict object at 0x11c53e6c0>('binance_untimed_page_symbols')
E        +    where <built-in method get of dict object at 0x11c53e6c0> = {'binance_page_cap_symbols': ['ETHUSDT'], 'binance_read_through_ms': 1794917100000}.get
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_page_it_cannot_page_past_is_named_with_a_bound[untimed-alone]
FAILED tests/test_binancefills_walk.py::TestBinanceFillsStops::test_a_page_it_cannot_page_past_is_named_with_a_bound[beside-a-capped-symbol]
2 failed, 2 passed, 22 deselected in 11.14s
cmp silent
4 passed, 22 deselected in 14.88s
```

### N29: every full page counted toward the cap (the exemption test replaced by an unconditional `counted_pages += 1`)

```
E           AssertionError: run 2 capped again
E           assert 'binance_page_cap_symbols' not in {'binance_page_cap_symbols': ['BTCUSDT'], 'binance_read_through_ms': 1792590582000}
FAILED tests/test_binancefills_e2e.py::TestBinanceFillsThroughTheSyncJob::test_a_cap_stamp_whose_overlap_hour_is_full_resumes_past_the_cap
1 failed, 6 deselected in 15.80s
cmp silent
1 passed, 6 deselected in 14.44s
```

## Legacy test note (`tests/test_exchange.py::test_binance_pagination_hits_page_cap`)

Old: no assertion on the cap flags. New: also asserts `binance_page_cap_symbols == ["BTCUSDT"]` and `binance_read_through_ms == 1700000000999 + 20 * 1_000_000` (the last row timestamp of its 20th page, 1700020000999). No fixture row lies in the hour below its `since_ms` (rows start at `since_ms` itself), so no `since_ms` move was needed and all 20 pages stay counted: exactly 20 calls. The docstring carries the same Old -> New note.

## Verification

- Plan's Task 2 command (`pytest tests/test_binancefills_walk.py tests/test_binancefills_e2e.py tests/test_binancefills_cursor.py tests/test_exchange.py tests/test_ana_recon_audit.py -k "inance or c13_03" --durations=5`): `72 passed, 222 deselected`. Slowest: the full-overlap arm 2.13 s, the real-constant walk arm 0.85 s (the plan's runtime record: 2.13 s for the full-overlap arm, two runs of 20 and 22 pages through the real job).
- Wave sampling (`tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py`): `395 passed, 1 skipped` (the skip is the one noted in 250-05).
- CI mypy strict: `Success: no issues found in 143 source files`.
- Acceptance greps: `_record_dq_flag("binance_read_through_ms"` in `_fetch_raw_trades_binance` = 1; `binance_page_cap_symbols` = 1; `pre_overlap_seed_ms=since_ms` in `fetch_raw_trades` = 1; `pre_overlap_seed_ms` in `_fetch_raw_trades_binance` = 4; `binance_untimed_page_symbols` = 1; `git diff --quiet $(git merge-base HEAD origin/main) -- analytics-service/services/ingestion/binance.py` exits 0.
- `test_c13_03_binance_cursor_advances_without_plus_one` still passes (the literal `next_since == current_since` is kept).

## For the ship CHANGELOG

Re-read pages inside the 1 h overlap no longer count toward `BINANCE_PAGE_CAP`, so a capped Binance symbol always resumes past its cap (no fromId paging needed; the cap stays 20). A symbol whose walk stops at the cap, or at a full page with no timestamp, is named (`binance_page_cap_symbols`, `binance_untimed_page_symbols`) and the cursor is stamped no later than the earliest stopped symbol's newest read fill (one `binance_read_through_ms`).

## Deviations from Plan

**1. [Own-test fix] Two fixture errors fixed before any commit.** (a) The Task 1 e2e arm checked the analytics upsert before the stamp, so its first RED was an `IndexError`; the stamp assertion now comes first. (b) The untimed arm's BTCUSDT held a timestamped fourth row that sorted into the first page ahead of the untimed row; the row was removed so the page's last row is the untimed one, as the plan specifies. Neither touched production code.

**2. [Test shape] The two-run arms do not share `flags` across runs.** The plan did not ask for it and sharing would test 250-02's self-heal rather than the producer; run 2's analytics upserts are checked for the absence of `binance_page_cap_symbols` instead.

**3. [Test shape] The untimed arm's second case puts the capped symbol (ETHUSDT, bound S + 5 min) below the untimed bound (S + 2 h)**, so the minimum is taken across stop kinds and a "first stopped symbol wins" bug would also go RED.

No Rule 1-4 deviations in production code. Write scope held: `services/exchange.py` hunks are only the keyword-only parameter and its docstring sentence, the Binance branch call in `fetch_raw_trades`, the count in `_fetch_one`'s page loop (for-else -> while-else; the requests, same-ms block, window exits and cap WARNING are unchanged), the result loop's collection, and the three flag recordings. `services/job_worker.py` and `services/ingestion/binance.py` are untouched; `tests/_binance_fills.py` needed no switch. No `STATE.md` or `ROADMAP.md` change (orchestrator-owned).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-250-11 (one minimum recording; N16 and the spy in `test_two_stopped_symbols_record_the_smaller_bound_once`), T-250-15 (overlap pages exempt, bounded by one hour of fills and, from 250-07, the read deadline; N29) and T-250-16 (untimed stop named with a bound; N25) are mitigated and pinned.

## Notes for later plans

- 250-07: the deadline stop's kind `"deadline"` is not collected here. Add it to the result loop's collection beside `cap` and `untimed` and to the same `stop_bounds` list, so the one `min(stop_bounds)` recording covers it; the gate already reads `binance_deadline_symbols`. The deadline check must run before EVERY request, exempt or counted: exempt pages are uncounted and only the deadline (and an hour of fills) bounds them.
- `_fetch_one`'s page loop is now `while counted_pages < BINANCE_PAGE_CAP` with a while-else cap branch; a `continue` added inside it would skip the count, so use `break` for exits.
- `BinanceAdapter.fetch_raw` passes no seed, so every page counts there exactly as in 250-03.

## Self-Check: PASSED

- FOUND: analytics-service/services/exchange.py, analytics-service/tests/test_binancefills_walk.py, analytics-service/tests/test_binancefills_e2e.py, analytics-service/tests/test_exchange.py
- FOUND commits: 2c5657964, caf000a18 (both ancestors of HEAD); `git rev-list --count 7c56ce890..HEAD` = 2 before this SUMMARY
- `git diff --quiet "$(git merge-base HEAD origin/main)" -- analytics-service/services/ingestion/binance.py` exits 0
