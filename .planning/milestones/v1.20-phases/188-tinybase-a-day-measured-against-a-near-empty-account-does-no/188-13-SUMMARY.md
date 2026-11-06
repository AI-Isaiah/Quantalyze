---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 13
subsystem: analytics-service derive (csv_daily_returns reconcile delete)
tags: [tinybase, gap-closure, reconcile-delete, key-mode, strategy-mode]
requires: [188-01, 188-02, 188-03, 188-04, 188-05, 188-06, 188-07, 188-08, 188-09, 188-10]
provides:
  - "_tiny_base_days_stored: the one stated list of a derive run"
  - "_reconcile_hull: the reconcile delete span over payload days and stated days"
affects: [188-12, 188-14, 188-15, 188-16]
key-files:
  modified:
    - analytics-service/services/job_worker.py
  created:
    - analytics-service/tests/test_tiny_base_reconcile.py
decisions:
  - "Gap 2: no new degrade reason. KEY_INPUTS_MISMATCH already makes the book untrustworthy, which is loud; after this fix the invariant holds by construction and the book arm pins it. A new reason would need new copy and edit DegradeReason / _BLOCKING_REASONS, which this phase's PATTERNS keeps out of bounds."
  - "The hull, not a second delete: the delete keeps one rule (every calendar day of the span the payload lacks), so a mark-gap day between a stated leading day and the first measured row is treated like the same day inside the old span."
status: complete
commits: 3
plan_head_before: 3e7547bd2988097560d761c0b4362daf68d1ca29
plan_head_after: fdf04162d4984d0ad6ad3f09d8cabce44ec7fae8
actuals:
  tokens: 4400    # chars/4 over the added lines of the two files (17529 chars)
  tasks: 2
  commits: 3
requirements-completed: [SC-2, SC-3, SC-4, SC-5]
---

# Phase 188 Plan 13: the reconcile delete covers every day the derive states as left out

The derive's reconcile delete now spans the hull of the payload series' days and the run's own stated tiny-base days, so a row an earlier derive stored on a stated day is removed at the tail (key C's PROD shape), at the leading edge, and between, in key mode and in strategy mode.

## What changed

`analytics-service/services/job_worker.py` (the only source file):

- `_tiny_base_days_stored(meta, returns, applied, *, key_mode)`: private, beside `_calendar_days_absent_from`. The one source of a run's stated list. Key mode returns exactly what `key_inputs.tiny_base_days` stored before; strategy mode returns exactly what the pre-stamp stored before (realized days kept only when they are NaN days of the final series once marks were applied, R2-02).
- `_reconcile_hull(index_days, named_days)`: the smallest and largest ISO day over both inputs; `ValueError` with static text when both are empty.
- Three call sites read the helper: the key-mode epilogue (`_tiny_listed`), the strategy pre-stamp (`_tiny_listed_days`), and the reconcile span (`_span_start, _span_end = _reconcile_hull(...)`). The upsert-first order, `_calendar_days_absent_from`, the `in.(...)` batching, the `gte`/`lte` bound and the per-axis `eq` scope are untouched. The "SPAN/SCOPE bound" comment is rewritten for the hull.
- The key-mode epilogue's local import lost `tiny_base_day_list`, which that block no longer uses.

`analytics-service/tests/test_tiny_base_reconcile.py` (new, 7 tests): the two key-tail arms, the key and strategy leading-edge arms, the strategy tail arm, the scope guard arm, and the no-stated-day arm. It imports only existing symbols, so it runs against the pre-fix file.

## Commits

- `abb068754` test(188-13): RED - stale rows on stated tiny tail days survive the derive
- `1b9cbc761` fix(188-13): the reconcile delete covers every day the derive states as left out
- `fdf04162d` test(188-13): the leading edge, strategy mode and the scope guards of the reconcile span

## Plan-time facts, re-measured (2026-11-05, Step 0)

- Precondition: `git merge-base --is-ancestor <last origin/main commit touching job_worker.py> HEAD` exited 0 after `git fetch origin`. `verify-plan-anchors.mjs` exited 0 (4 claims checked).
- The tail arm was RED before the fix (premise held): all three seeded stale rows remained on 2026-03-07, 03-08 and 03-09, and the sole-key book composed `key_inputs_mismatch`.
- Leading edge: the stated list is `["2026-03-07", "2026-03-08"]` and the rows are exactly 03-10 = 212/100588 and 03-11 = 200/100800, in both modes.
- Strategy mode needs `services.nav_twr.flow_coverage_terminus_day` pinned to `None` (the test helper `_derive_strategy` does it).

## Evidence (logs in the untracked scratch directory `/tmp/tinybase-13`)

RED against today's code:

- **red1** (Task 1, the two tail arms before the fix): `FAILED ...::test_key_tail_stale_rows_on_stated_days_are_deleted` and `...::test_key_tail_book_is_trustworthy_after_the_derive`, both on assertions (extra stated days `03-07 03-08 03-09`), no collection ERROR.
- **red2** (Task 2, the whole module against the pre-fix `job_worker.py`, written with `git show <plan base>:analytics-service/services/job_worker.py`): 6 failed, 1 passed. FAILED: `test_key_tail_stale_rows_on_stated_days_are_deleted`, `test_key_tail_book_is_trustworthy_after_the_derive`, `test_key_leading_edge_stale_rows_are_deleted`, `test_strategy_tail_stale_rows_on_stated_days_are_deleted`, `test_strategy_leading_edge_stale_rows_are_deleted` (all five required), and `test_rows_outside_the_hull_and_other_scopes_are_kept` (its stated days hold stale rows pre-fix). `test_with_no_stated_day_the_span_is_the_payload_span` passes pre-fix by design: with no stated day the span is unchanged. Restored from the byte backup `job_worker.fixed`; `cmp -s` passed and `git diff` on the file was clean.

Scope-bound neuters (each from the byte backup `job_worker.bak`, restored and `cmp -s` checked before the next):

- **neuter1** (hull start fixed to `"2000-01-01"`): 2 failed, 5 passed. FAILED `test_rows_outside_the_hull_and_other_scopes_are_kept` and `test_with_no_stated_day_the_span_is_the_payload_span` (the 02-20 rows are deleted).
- **neuter2** (hull end fixed to `"2099-12-31"`): 2 failed, 5 passed. FAILED the same two arms (the 03-11 rows are deleted).
- **neuter3** (the `if is_key_mode:` / `else:` `eq` block removed from `_reconcile_span_delete`), `tests/test_derive_broker_dailies_dualmode.py -k span_delete`: 2 failed, 106 deselected. FAILED `TestDerivePersistReconcilesAxis::test_key_mode_span_delete_scoped_to_api_key_axis` and `TestDerivePersistReconcilesAxis::test_strategy_mode_span_delete_reconciles_refused_day`. The existing axis tests are the real guard of the per-axis scope; the new sibling-row assertion would also fail there, but through the shared fake, not an assertion, so it is not counted.
- After all drills: `cmp -s job_worker.py job_worker.fixed` and `cmp -s job_worker.py job_worker.bak` both passed, `git diff` on the file clean.

GREEN:

- The 13 modules of Task 1's verify: 364 passed. Module `test_tiny_base_reconcile.py`: 7 passed.
- CI's pytest line verbatim from `analytics-service/` with the main checkout's venv (`pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`): exit 0, 14358 passed, 101 skipped, total coverage 94.58% (`Required test coverage of 80% reached`). The 101 skips are existing suite skips this plan did not touch (their reasons were not inspected); none of this plan's 7 tests is skipped.
- CI's mypy line verbatim: `Success: no issues found in 132 source files`.
- Acceptance greps: `returns.index.min().date().isoformat()` 0 (was 1), `_reconcile_hull(` 2, `_tiny_base_days_stored(` 4, `git diff <plan base> HEAD --stat -- analytics-service/` lists only `services/job_worker.py` and `tests/test_tiny_base_reconcile.py`.

## Deviations from Plan

None - plan executed exactly as written. (Scratch directory is `/tmp/tinybase-13`, as the plan names it. The plan's Task 2 Step 2 calls the working tree "committed" while the new test arms were still uncommitted; only `job_worker.py` is overwritten there and it was committed, so nothing uncommitted was lost.)

## Observations (recorded only, not changed)

- **The `< 2` interpretable-days short-circuit** writes and deletes no `csv_daily_returns` row by design (it persists only `key_inputs`), so a stated day there would keep an earlier row. It is not reachable for keys C, k1 or k2 (years of measured rows) and VERIFICATION does not name it.
- **Gap 2's design decision:** no new degrade reason (see `decisions`). `test_key_tail_book_is_trustworthy_after_the_derive` pins `degrade_reasons == []`, `is_trustworthy`, no return on a stated day and every mark reproduced within rel 1e-9.
- **Plan 12 / 15 relevance:** the 24 stale rows (keys C, k1, k2, 2026-10-27..2026-11-03) are deleted by the next derive after this ships; nothing re-inserts them. The plan-12 baseline capture is the only record of their values.
- **Gaps this plan does not address:** VERIFICATION's other gaps (the baseline-before-ship requirement, the 233 stated-but-not-reproduced realized-era days named in `188-11-SUMMARY.md`, the sliver-day naming question) are outside this plan's files and are not claimed closed here.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change. The delete stays the existing service-role delete scoped by its axis. No new log line; `_reconcile_hull`'s `ValueError` has static text (T-188-31).

No PROD or shared-TEST access was made, no migration, no TypeScript change.

## Self-Check: PASSED

- `analytics-service/tests/test_tiny_base_reconcile.py`: FOUND
- `analytics-service/services/job_worker.py` (`_reconcile_hull(` x2, `_tiny_base_days_stored(` x4): FOUND
- commits `abb068754`, `1b9cbc761`, `fdf04162d`: ancestors of HEAD
