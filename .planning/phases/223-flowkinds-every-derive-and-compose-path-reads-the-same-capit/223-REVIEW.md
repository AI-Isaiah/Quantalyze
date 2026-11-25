---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
reviewed: 2026-11-24T16:02:34Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - analytics-service/services/okx_archive_job.py
  - analytics-service/services/funding_fetch.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/exchange.py
  - analytics-service/tests/test_job_worker_sync_funding.py
  - analytics-service/tests/test_funding_fetch.py
  - analytics-service/tests/test_job_worker_funding_cursor.py
  - analytics-service/tests/test_okx_archive_apply.py
  - analytics-service/tests/test_bybitreads_census_pins.py
  - analytics-service/tests/test_daily_pnl_read_verdict.py
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 223: Code Review Report

**Reviewed:** 2026-11-24T16:02:34Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** clean

## Summary

Scope: `git diff 62c402d19..HEAD -- analytics-service` in the worktree on branch
`gsd/phase-223-flowkinds`. That is `okx_archive_job._live_reference`, `fetch_funding_bybit`
(`until_ms`), `bybit_funding_windows`, `run_sync_funding_job`'s Bybit arm and
`_store_funding_window`, the `daily_pnl_read_verdict` docstring, and their tests. The caller
asked for MEDIUM and above only (bugs, data-integrity risks, silent failures, tests that cannot
fail), so this report has no LOW or Info items. Necessity was not assessed because it falls
outside that brief, so `necessity:` is left out of the frontmatter.

I checked the code against the locked founder rulings in `223-CONTEXT.md` and found no
MEDIUM-or-above defect.

What was traced, and why each holds:

- **Ruling 1 (OKX live funding, named stop).** `fetch_funding_okx(..., on_malformed="raise")`
  raises `FundingRowsMalformed` only after the full walk (`_raise_if_malformed`). `_within` lets
  a non-timeout exception through unchanged, because its `except TimeoutError` does not catch
  this one. `_live_reference` is the first call in `_evaluate`, and `_evaluate`'s docstring says
  every stop there comes before any write. The test runs the real fetcher in both `calibrate`
  and `apply` and asserts zero writes and no apply RPC. A clean-read twin shows the stop fires
  on a dropped row and not merely because the keyword is passed.
- **C27 prefix invariant.** The handler takes one clock reading. `bybit_funding_windows` reuses
  `exchange_pagination._windows`, so each handler window is a single inner window: its width is
  at most 7 days, which is no more than the contract's `window_max_days=7`. Both categories of
  window k are fetched before window k is stored. Rows are sorted by `timestamp`, a `datetime`
  from `_parse_ts_ms`. Bybit's `transactionTime` is an epoch-ms digit string, which takes the
  `isdigit()` branch and yields a tz-aware value. Only a non-digit ISO string without an offset
  could come back naive, and Bybit does not send one. Rows go out in 500-row slices, and the
  walk returns at the first slice that reports an error.
  `db_execute` is `loop.run_in_executor(_DB_EXECUTOR, fn)`
  (`services/db.py`), so a timeout during an in-flight slice leaves that thread to finish its
  write, but the next slice never starts. The stored rows remain a prefix.
  Every unstored row has `timestamp >= max_ts`, and the next attempt starts at
  `max_ts - FUNDING_CURSOR_OVERLAP_DAYS`, so it re-reads all of them, ties included.
- **No hidden timeout (ruling 3).** There is no self-deadline. The real-dispatch test runs
  `asyncio.wait_for` and asserts FAILED/transient `Handler exceeded timeout` after exactly two
  stored windows. The exchange closes in `finally` on the cancel path and on the early `return`.
- **Malformed rows stay dropped in `run_sync_funding_job`.** All three venue arms call the
  fetcher without `on_malformed`. The parametrized test runs the real fetchers against a fake
  endpoint. It goes red if the caller starts raising (the exception would propagate) or stops
  dropping (two rows would be stored).
- **Tests can fail.** I checked this by inspection and did not re-run the mutations. Each C27
  test asserts something its mechanism changes: the per-window store (timeline), the sort
  (order), the slice stop (upsert count 3 vs 2, fetch count 2 vs 1) and the window seam
  (contiguity). The RED runs under a neuter are recorded in `223-04-SUMMARY.md` (the tracer and
  PROOF-01's five mechanisms) and in `223-05-SUMMARY.md` (each venue arm of the FLOWK-02
  decision). Four C27 tests (resume, empty window, no window left, 429 mid-walk) carry no
  neuter record, as the plan specifies.
- **Other writers to `funding_fees`.** The prefix argument needs this handler to be the only
  automated writer. In `services/`, `routers/` and `scripts/`, every other `funding_fees`
  reference is a read: `position_reconstruction.py:839` and `scripts/bybit_reconcile.py:134`.
  The only other caller of `upsert_funding_rows` is the operator script
  `scripts/backfill_funding.py`. No job can store newer rows in the middle of a backfill.
- **Blast radius.** I ran every test module that references `fetch_funding_okx`,
  `fetch_funding_bybit`, `run_sync_funding_job`, `okx_archive` or `upsert_funding_rows`
  (33 modules): 2642 passed, 1 skipped.
- `mypy --strict --config-file=pyproject.toml` on the three changed service files: no issues.
  The six touched test modules alone: 792 passed.

Known behaviours that were recorded on purpose and are not counted as findings: an inverse
request is refused and logged once per window when a key lacks inverse scope, and the
dropped-row WARNING repeats once per window. `223-RESEARCH.md` §219 and A3 cover both, along
with threat T-223-09 (accepted) and `223-04-SUMMARY.md`. Each is a request-count cost, not a
data loss: the old single walk let the cursor move past skipped inverse history in the same way.
RESEARCH A2 also holds as a pre-existing behaviour, not a regression. A single window over
`MAX_PAGES` raises `FundingFetchCeilingExceeded` on every run. The walk now keeps the earlier
windows, where the old single walk stored nothing.

All reviewed files meet the MEDIUM-and-above bar. No issues found.

---

_Reviewed: 2026-11-24T16:02:34Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter (2026-11-24), MEDIUM and above

**SFH-1 (MEDIUM, booked, not fixed): a run of empty leading windows does not move the funding cursor.** In `run_sync_funding_job`, an empty Bybit window stores nothing, so the resume point (newest stored `funding_fees.timestamp` minus 2 days) does not advance across a leading stretch of empty windows. The hunter's wedge scenario assumed about 7 s per empty window, but that figure is the average for row-heavy windows. An empty window costs two requests, about 0.26 s each at the 231 probe's measured 1438 calls in 379 s. A fully empty 53-window first walk therefore takes about 30 s, well inside the 180 s budget. **Disposition:** not user-facing and not data-integrity, because no published number reads `funding_fees` (CONTEXT, sync_funding decision). Under the workflow's MEDIUM rule there is no fixer round. It is recorded here as a known limit, and it is reopened if a first walk is measured timing out before its first row.
