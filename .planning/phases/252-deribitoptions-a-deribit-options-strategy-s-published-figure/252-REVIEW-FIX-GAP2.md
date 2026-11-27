---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
fixed_at: 2026-11-27
review_path: .planning/phases/252-deribitoptions-a-deribit-options-strategy-s-published-figure/252-REVIEW-GAP2.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 252 gap plans 09 and 10: Code Review Fix Report

**Fixed at:** 2026-11-27
**Source review:** `252-REVIEW-GAP2.md` (WR-01, WR-02) plus the silent-failure-hunter finding SFH-MEDIUM-1
**Iteration:** 1
**Isolation:** edited and committed directly in the existing phase worktree (branch `gsd/phase-252-mtm`), as briefed. All gates ran in that worktree, not the main checkout.

**Summary:**
- Findings in scope: 3 (all MEDIUM). LOW/Info items (IN-01..IN-08) were not touched.
- Fixed: 3
- Skipped: 0
- No migration, no Railway, no PROD touched. No new abstractions.

## Fixed Issues

### WR-01: a transient in the now-unconditional smoothed pass can sink a healthy cash composite

**Status:** fixed: requires human verification (control-flow / retry-policy change)
**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_stitch_composite_job.py`
**Commit:** `7be54fbf3` (wording follow-up `6bbe725d5`, see Note below)

**Applied fix.** `run_stitch_composite_job` can know its attempt number without new plumbing: the job row already carries `attempts` and `max_attempts`, and sibling handlers read them with the same pattern (both must be `int`, a row without both counts reads as not final). `_smoothed_final_attempt` is computed once before the smoothed pass. Then:
- a `DeribitTransientReadError` escaping the smoothed `_reconstruct_all` is caught by a new `except` arm; on a non-final attempt it is re-raised unchanged (retry as before), on the final attempt it degrades (`smoothed_result = None`, WARNING logged with the scrubbed text);
- a returned `DispatchResult` with `error_kind == "transient"` (429 / geo-block) degrades on the final attempt and still returns on earlier ones;
- a permanent preflight / unsupported-venue `DispatchResult` still returns, on every attempt.

A degrade means `smoothed_result` None, so not promoted (cause `smoothed_basis_not_computed`), so the cash headline plus `mtm_gated_reason = unsmoothed_options_book` and no `headline_basis`. The per-crawl timeout (third exit in the review) already degrades through the existing `asyncio.TimeoutError` arm for the outer wait; the inner 810 s crawl bound returns a transient `DispatchResult`, which is now covered by the second bullet. The stale in-code comment that said a transient "still surfaces as a whole-job retry" was updated.

**Intent change recorded.** T-252-27 / `test_g252_transient_in_the_smoothed_pass_retries_the_job_and_writes_nothing` accepted "transients surface exactly as with the flag on" on every attempt. That test is UNCHANGED and still green: it runs a job dict with no attempt counts, which reads as not final, so it keeps pinning "earlier attempts retry and write nothing". Only the last attempt changed: the additive basis never sinks the cash composite there. This supersedes the plan-level acceptance of T-252-27 for the last attempt only. It was a planner acceptance, not a founder ruling, so no CONTEXT/ROADMAP edit is made here (the review's alternative branch, recording a founder preference, is not taken).

**Tests added** (`tests/test_stitch_composite_job.py`; `_g252_run` gained a `job_extra` argument):
- `test_g252_smoothed_transient_on_the_last_attempt_ships_the_cash_composite[transient_dispatch_result]` and `[escaping_transient_read]`: attempts 3 of 3, outcome DONE, no `headline_basis`, `mtm_gated_reason == unsmoothed_options_book`, no `smoothed_mtm` key, headline equals `cash_settlement`.
- `test_g252_escaping_transient_read_before_the_last_attempt_still_retries`: attempts 1 of 3, the `DeribitTransientReadError` still escapes.

**PROOF-01** (analytics-service, backup copies in the session scratchpad, restored with `cp`, `cmp` exit 0 each time):
- Neuter A (`_smoothed_final_attempt` forced False via `and False`):
  `FAILED tests/test_stitch_composite_job.py::test_g252_smoothed_transient_on_the_last_attempt_ships_the_cash_composite[transient_dispatch_result]`
  `FAILED tests/test_stitch_composite_job.py::test_g252_smoothed_transient_on_the_last_attempt_ships_the_cash_composite[escaping_transient_read]`
  `2 failed, 2 passed, 121 deselected`. Restore `cmp=0`.
- Neuter B (`_smoothed_final_attempt` forced True via `) or True`):
  `FAILED tests/test_stitch_composite_job.py::test_g252_transient_in_the_smoothed_pass_retries_the_job_and_writes_nothing`
  `FAILED tests/test_stitch_composite_job.py::test_g252_escaping_transient_read_before_the_last_attempt_still_retries`
  `2 failed, 2 passed, 121 deselected`. Restore `cmp=0`, GREEN (`23 passed` over `-k g252` with all three commits' tests).

### WR-02: a promoted headline demotes silently when marks age past retention

**Status:** fixed
**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_stitch_composite_job.py`
**Commit:** `72a624982` (wording follow-up `6bbe725d5`)

**Applied fix.** After the persist's existing `existing_flags = _flags_object_or_dropped(...)` read, when `not smoothed_promoted` and `existing_flags.get(HEADLINE_BASIS_FLAG) == HEADLINE_BASIS_SMOOTHED`, the function logs at WARNING and calls `sentry_sdk.capture_message(..., level="warning")` inside the same `new_scope()` pattern the file uses elsewhere, with tags `compute_job_id` and `headline_demotion_cause`. The cause is the not-promoted cause literal (`smoothed_basis_not_computed`, `retention_bucketed_option_days`, `smoothed_chain_broken`), or `not_option_active` when the composite stopped being option-active (`smoothed_ok` False). The Sentry text carries the cause only: no id, date or amount (the log line carries the strategy id like every other line in this function).

**Which read.** The function's existing `_read_existing_flags` (the `data_quality_flags` read at persist). No new DB query was added.

**Not done (out of this brief's scope).** The review's part (a), recording the time limit in `252-CONTEXT.md` and the ROADMAP 252 section, needs the founder-ruling wording and was not part of the three-fix brief; it is still open.

**Test added:** `test_g252_withdrawing_a_published_smoothed_headline_is_logged_and_reported`: a prior `headline_basis` row plus a P3 (retention) stitch gives exactly one WARNING containing `withdrawn` and the cause, one `capture_message` with `level="warning"` and the cause in the text and no strategy id; a control run that DOES promote from the same prior flags reports nothing.

**PROOF-01:** neuter (`not smoothed_promoted` replaced by `False`):
`FAILED tests/test_stitch_composite_job.py::test_g252_withdrawing_a_published_smoothed_headline_is_logged_and_reported` / `1 failed, 124 deselected`. Restore `cmp=0`, GREEN.

### SFH-MEDIUM-1: a promoted row with no usable smoothed series seeds the smoothed basis

**Status:** fixed
**Files modified:** `src/lib/factsheet/composite-read-path.ts`, `src/lib/factsheet/composite-read-path.headline-basis.test.ts`
**Commit:** `301f5e2a8`

**Applied fix.** `smoothedHeadline` moved from before the series reads to after the `Promise.all` that produces `smoothedSeries`, and now reads `isSmoothedHeadlineRow(dqf) && smoothedAvailable && smoothedSeries !== null`. A marker with smoothed scalars but a null series gives no `headlineBasis`; `applyHeadlineBasis` still redacts the cash object on the marker, so the row stays cash-withheld by name.

**Deviation from the brief, stated.** The brief asked for "non-null and `dailyReturns.length >= 2`". `parseMtmSeriesPayload` (behind `readSmoothedSeries`) already returns null below two valid rows, so non-null implies at least two, and a separate length check would be dead code. Not covered: `build-payload` dedups by date before its own `>= 2` test, so a stored series of two rows on the same date could still pass this check and then emit no bundle. That needs the payload's normaliser in the read path; it was not added and the case needs a producer that writes duplicate dates, which the Python writer does not.

**Tests.** `mockAdmin` now takes an optional smoothed-series payload and answers the `kind = smoothed_mtm_daily_returns` read. The existing arm (a) now supplies a series and gained `seriesByBasis.smoothed_mtm` defined (anti-vacuity; without a series the promoted arm no longer seeds, by design). New arm `(c2)` (two cases: series row missing, series with a single valid row): marker + smoothed scalars, no usable series, so no `headlineBasis` in opts or payload, no `seriesByBasis.smoothed_mtm`, and cash withheld by the options sentence.

**PROOF-01:** neuter (drop `&& smoothedSeries !== null`):
`× (c2) a marker and smoothed scalars but the series row is missing: no headlineBasis, cash withheld`
`× (c2) a marker and smoothed scalars but the series has a single valid row: no headlineBasis, cash withheld`
`Tests  2 failed | 48 passed (50)`. Restore `cmp=0`, `Tests  50 passed (50)`.

## Note on the follow-up commit

`6bbe725d5` is wording only. `test_no_verification_or_publish_status_write_source_scan` asserts `run_stitch_composite_job`'s source never contains the word that names the publish status; my WR-01 and WR-02 comments and log text used it. Found by the full gate run (not by the `-k g252` runs), reworded to "promoted".

## Gates

Run in the worktree (not the main checkout):
- `pytest tests/test_stitch_composite_job.py tests/test_stitch_composite.py tests/test_composite_headline_parity.py`: 174 tests; first full run had the one source-scan failure above, fixed in `6bbe725d5`; final run after all commits: `174 passed, 54 warnings` (exit 0).
- `mypy --strict ... services/job_worker.py services/stitch_composite.py`: Success, no issues found in 2 source files (run again after the reword: exit 0).
- `vitest` on `src/lib/factsheet`, the census test and `src/app/factsheet/[id]/v2`: 3796 passed, 3 failed. Two are the known local-only `compute.conventions` fixtures B and C. The third, `FactsheetBody.advanced.test.tsx` ("writes 'open' and 'closed'..."), timed out under load at 6.1 s in the combined run and passed 26 of 26 when run alone; it touches no file of this round. `RiskTabPanel.book-series` did not fail this run.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.

---

_Fixed: 2026-11-27_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
