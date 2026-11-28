---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 11
fixed_at: 2026-11-28T00:00:00Z
review_path: .planning/phases/252-deribitoptions-a-deribit-options-strategy-s-published-figure/252-REVIEW-GAP3.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 252: Code Review Fix Report, gap plan 11

**Source review:** 252-REVIEW-GAP3.md
**Scope:** WR-01 only (Info findings IN-01 to IN-05 are recorded in the review and not fixed, per the TODOS rule).

## Fixed Issues

### WR-01: the reused crawl's account state can sit on the far side of the 08:00 UTC settlement from the option-mark cap

**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_stitch_composite_job.py`
**Commit:** 636dce4d5
**Status:** fixed: requires human verification (a timing and logic fix; the tests drive the settled-day clock, not a real boundary).

**Applied fix (inside `run_stitch_composite_job` only):**
- `member_cash_crawl` entries are now `(report, account_state, settled_day)`. The settled day is `_last_settled_option_mark_day()`, read in the cash pass right after the member's account-state read and before its crawl, so a settlement during the crawl is also caught. `_last_settled_option_mark_day` joins the function's existing local import from `services.deribit_ingest`.
- On the smoothed pass the reuse branch compares the current `_last_settled_option_mark_day()` with the stored day. When it differs it releases the retained rows and raises `DeribitTransientReadError` before `build_deribit_options_basis_ledger` runs. Step 6b's existing arm applies: escape (job retried) on earlier attempts, degrade to the cash headline with `unsmoothed_options_book` on the last.
- `_release_cash_crawl` unpacks the three-tuple. The tolerance, the assembly and every other behaviour are unchanged. The new comments avoid the publish-status word, so `test_no_verification_or_publish_status_write_source_scan` still passes.

**Tests added** (`tests/test_stitch_composite_job.py`, end of file, helper `_g252_run_across_settlement` with a controlled settled-day clock):
- `test_g252_settlement_between_cash_read_and_smoothed_reuse_retries_the_job`: day advances after the cash read; on attempt 1 of 3 the job escapes `DeribitTransientReadError`, the options builder is never awaited, no `strategy_analytics` or `csv_daily_returns` write, seeded flags untouched.
- `test_g252_settlement_between_cash_read_and_smoothed_reuse_degrades_on_the_last_attempt`: attempt 3 of 3 returns DONE with cash only, `mtm_gated_reason == unsmoothed_options_book`, no `headline_basis`, no `smoothed_mtm` basis.
- `test_g252_unchanged_settled_day_between_cash_read_and_reuse_still_promotes`: day unchanged; the options builder runs for both members and `headline_basis == smoothed_mtm`.

## PROOF-01 (neuter, RED, restore, GREEN), recorded verbatim

Neuter: byte copy of `services/job_worker.py` kept in the scratchpad, then the guard line `if _last_settled_option_mark_day() != _settled_at_read:` replaced with `if False:`.

```
$ pytest tests/test_stitch_composite_job.py -q -p no:cacheprovider -k "settlement_between or settled_day"
FAILED tests/test_stitch_composite_job.py::test_g252_settlement_between_cash_read_and_smoothed_reuse_retries_the_job
FAILED tests/test_stitch_composite_job.py::test_g252_settlement_between_cash_read_and_smoothed_reuse_degrades_on_the_last_attempt
2 failed, 1 passed, 134 deselected in 10.60s
$ cp <backup> services/job_worker.py ; cmp <backup> services/job_worker.py
cmp=0
$ pytest tests/test_stitch_composite_job.py -q -p no:cacheprovider -k "settlement_between or settled_day"
3 passed, 134 deselected in 22.10s
```

The mirror case (unchanged day, promotes) stays green under the neuter by design: it pins that the guard does not fire on every stitch.

## Gates

From `analytics-service/` with `.venv/bin/python`, run after the fix and before the commit:

- `pytest tests/test_stitch_composite_job.py tests/test_stitch_composite.py tests/test_composite_headline_parity.py tests/test_stamp_io_exhaustive.py -q -p no:cacheprovider`: `298 passed, 117 warnings in 70.01s`.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: `Success: no issues found in 151 source files`.

Verification ran in the main working tree of the `quantalyze-wt-252c` checkout (branch `gsd/phase-252-crawl`), not an extra isolated worktree.

## Residual note

The guard compares the settled day at the cash state read with the settled day at reuse. The smoothed assembly then reads the clock once more inside the options builder, so a settlement landing in the few milliseconds between the guard and that read is still possible. That window is the same one a single-pass build always had, and closing it needs the read instant threaded into `deribit_ingest.py`, the founder-scope alternative the review named.

---

_Fixed: 2026-11-28_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
