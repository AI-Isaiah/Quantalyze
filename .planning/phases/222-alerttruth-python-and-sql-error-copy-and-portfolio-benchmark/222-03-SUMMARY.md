---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
plan: 03
subsystem: analytics-service portfolio benchmark note + adapter tone rule
tags: [ERRC-02, benchmark, adapter, proof-01]
requires: [222-02]
provides:
  - "BENCHMARK_NOTE_NO_SOURCE: a (None, True) benchmark exit is stored as 'benchmark unavailable: no price source' with stale false"
  - "TestBenchmarkOutageIsNotStale: drives both REAL get_benchmark_returns exits through _compute_portfolio_analytics"
  - "benchmarkNoteTone: the amber-only-when-stale rule as an exported predicate beside parseBenchmarkComparison"
affects: [222-04]
tech-stack:
  added: []
  patterns: ["real service exit driven by patching only the services.benchmark source layer, helpers imported from tests.test_benchmark", "tone gated on the stored boolean, never the note string"]
key-files:
  modified:
    - analytics-service/routers/portfolio.py
    - analytics-service/tests/test_portfolio_benchmark_pairing.py
    - src/lib/portfolio-analytics-adapter.ts
    - src/lib/portfolio-analytics-adapter.test.ts
decisions:
  - "benchmarkNoteTone lives in portfolio-analytics-adapter.ts (planner decision): the file holding the parser the founder's 'adapter-level test' names; it has no caller today, like adaptPortfolioAnalytics"
  - "OQ1 (founder 2026-11-25): SC-2 is met by stored stale=false + benchmarkNoteTone + the adapter test; no card or component rebuilt"
metrics:
  tasks: 2
  files: 4
status: complete
actuals:
  tokens: 3200
  tasks: 2
  commits: 2
plan_head_before: dfe876f9d58cf19b5ac94e47d5ff6118c0fdddbb
plan_head_after: 661d3c7420f74df7fd79a940fa8bdab385f28afb
completed: 2026-11-25
---

# Phase 222 Plan 03: AlertTruth portfolio benchmark outage note Summary

A portfolio whose benchmark sources all failed now stores "benchmark unavailable: no price source" with `stale: false`, distinct from the stale-cache note "benchmark unavailable: stale" with `stale: true`; the amber-only-when-stale rule is held as code (`benchmarkNoteTone`) and pinned by adapter tests.

## What changed

- `analytics-service/routers/portfolio.py`: `BENCHMARK_NOTE_NO_SOURCE` beside the three existing constants; the single `benchmark_rets is None or benchmark_stale` condition is split into `is None` -> NO_SOURCE, `elif benchmark_stale` -> STALE. The flagged-empty dict already writes `"stale": benchmark_note == BENCHMARK_NOTE_STALE`, so NO_SOURCE carries stale False with no further edit. `services/benchmark.py` is untouched (`git diff` against the merge-base is empty).
- `analytics-service/tests/test_portfolio_benchmark_pairing.py`: hand-typed `NOTE_NO_SOURCE`; the conflation pin renamed to `test_missing_benchmark_writes_the_named_no_source_note` (stale False); new class `TestBenchmarkOutageIsNotStale` with `test_stale_cache_exit_writes_the_stale_note`, `test_total_source_failure_writes_the_no_source_note` and a `test_the_two_notes_differ` guard.
- `src/lib/portfolio-analytics-adapter.ts`: `export function benchmarkNoteTone`, its doc comment carrying OQ1, the UI-SPEC base/warning/muted classes (break-words included) and the never-from-the-note-string rule.
- `src/lib/portfolio-analytics-adapter.test.ts`: the no-source round-trip case and a `benchmarkNoteTone` describe block (stale true -> warning; no-source, thin, error and a stale-sounding note with stale false -> muted).

## Exit each Python case reached

Both cases patch only `services.benchmark` (`_utc_now` -> `_NOW`, `get_supabase`, `db_execute`, `fetch_btc_daily_prices` raising `httpx_error()`), via helpers imported from `tests.test_benchmark`. The router calls with `days=1000, since=<first portfolio date>`; no recipe cache-age adjustment was needed.

- `test_stale_cache_exit_writes_the_stale_note`: cache `_cache_rows(range(1, 16))` (newest day 1 day old, a miss for the window), fetch fails -> exit (d), `(series, True)` -> note stale, stale True.
- `test_total_source_failure_writes_the_no_source_note`: cache `_cache_rows(range(3, 23))` (newest day 3 days old, past 48 h), fetch fails -> exit (e), `(None, True)`. The captured log line `All benchmark sources failed: synthetic: both sources down. Returning None.` confirms the real exit.

## PROOF-01 records

### Router, pre-fix RED (new tests on the old combined condition)

```
$ .venv/bin/python -m pytest tests/test_portfolio_benchmark_pairing.py -q -k "NamedBenchmarkNotes or OutageIsNotStale"
E         Differing items:
E         {'stale': True} != {'stale': False}
E         {'note': 'benchmark unavailable: stale'} != {'note': 'benchmark unavailable: no price source'}
tests/test_portfolio_benchmark_pairing.py:312: AssertionError
E         Differing items:
E         {'stale': True} != {'stale': False}
E         {'note': 'benchmark unavailable: stale'} != {'note': 'benchmark unavailable: no price source'}
tests/test_portfolio_benchmark_pairing.py:448: AssertionError
FAILED tests/test_portfolio_benchmark_pairing.py::TestNamedBenchmarkNotes::test_missing_benchmark_writes_the_named_no_source_note
FAILED tests/test_portfolio_benchmark_pairing.py::TestBenchmarkOutageIsNotStale::test_total_source_failure_writes_the_no_source_note
2 failed, 6 passed, 7 deselected in 30.64s
```

Exit (d) and the other notes stayed GREEN on pre-fix code, as expected.

### Router, neuter after the fix (single combined condition restored), then `cp` back

```
E         {'note': 'benchmark unavailable: stale'} != {'note': 'benchmark unavailable: no price source'}
E         {'stale': True} != {'stale': False}
FAILED tests/test_portfolio_benchmark_pairing.py::TestNamedBenchmarkNotes::test_missing_benchmark_writes_the_named_no_source_note
FAILED tests/test_portfolio_benchmark_pairing.py::TestBenchmarkOutageIsNotStale::test_total_source_failure_writes_the_no_source_note
2 failed, 13 passed in 17.66s
$ cp <scratch>/portfolio.py.bak routers/portfolio.py && cmp <scratch>/portfolio.py.bak routers/portfolio.py
CMP-SILENT
15 passed in 16.76s
```

### Adapter round-trip, neuter (parseBenchmarkComparison drops `note`), then `cp` back

```
 × carries a string benchmark note and drops a non-string or absent one
 × round-trips the no-source benchmark note with stale false
AssertionError: expected undefined to be 'benchmark unavailable: stale'
AssertionError: expected { symbol: 'BTC', …(4) } to deeply equal { symbol: 'BTC', …(5) }
 Tests  2 failed | 43 passed (45)
CMP-SILENT
 Tests  45 passed (45)
```

### Tone rule, neuter (`return "warning"` unconditionally), then `cp` back

```
 × is muted for the no-source outage, which is stored with stale false
 × is muted for the thin-overlap and computation-failed notes
 × reads the boolean, never the note: a stale-sounding note with stale false is muted
AssertionError: expected 'warning' to be 'muted' // Object.is equality (x3)
 Tests  3 failed | 46 passed (49)
CMP-SILENT
 Tests  49 passed (49)
```

### GREEN

```
$ .venv/bin/python -m pytest tests/test_portfolio_benchmark_pairing.py tests/test_benchmark.py tests/test_benchmark_refresh.py -q
59 passed, 1 warning in 21.14s
$ npx vitest run src/lib/portfolio-analytics-adapter.test.ts
 Tests  49 passed (49)
$ npx eslint src/lib/portfolio-analytics-adapter.ts src/lib/portfolio-analytics-adapter.test.ts   -> clean
$ npx tsc --noEmit   -> exit 0, no output
```

### mypy strict (CI command, `ci.yml` "Type gate - mypy strict over the running-service surface")

```
$ cd analytics-service && .venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 143 source files
```

## Acceptance criteria

- `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"` present in `routers/portfolio.py`; `no price source` present in the pairing test and the adapter test.
- `def test_missing_benchmark_writes_the_named_stale_note` count 0; `class TestBenchmarkOutageIsNotStale` present.
- `export function benchmarkNoteTone` and `break-words` present in the adapter; `benchmarkNoteTone` present in its test.
- `git diff --quiet $(git merge-base HEAD origin/main) -- analytics-service/services/benchmark.py` exits 0.

## Deviations from Plan

None - plan executed exactly as written. The Task 1 adapter case is a pin on existing behaviour; its RED came from the neuter, as the plan states.

## Ship notes (carried from the plan)

- Delete TODOS `[166.4.1-BENCHMARK-OUTAGE-LABEL]` (still present at TODOS.md line 614 on this branch) and name it in the CHANGELOG entry.
- CHANGELOG records the finding: no page renders the portfolio benchmark note today (the card was deleted in Phase 195). SC-2 is met per founder ruling OQ1 by the stored value, `benchmarkNoteTone` and the adapter test.
- Stored `portfolio_analytics` notes written before this change keep "stale" until the next portfolio compute (UI-SPEC U6, no backfill).
- If 236 FIGUREMATH merges first, re-base on it before the single CI run; both plans touch `routers/portfolio.py` in different symbols.

## Known Stubs

None. `benchmarkNoteTone` has no caller by design (OQ1); knip is non-blocking in CI.

## Threat Flags

None. The new note is a fixed constant; no `str(exc)` path added (T-222-07); `services/benchmark.py` unedited (T-222-08).

## Self-Check: PASSED

- Commits `25172a389` and `661d3c742` are ancestors of HEAD.
- All four modified files exist and carry the symbols named above.
