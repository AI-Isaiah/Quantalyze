---
phase: 105-composite-the-one-csv-finalize-route
plan: 05
subsystem: analytics-worker
tags: [composite, backbone-unification, collapse-1, collapse-5, sc-5, low-2, bb-02]
requires: [105-01, 105-03]
provides:
  - composite-cash-on-shared-derive
  - metrics_result_for-deleted-grep-gate-zero
  - one-periods-per-year-rule-with-retained-failloud
  - ordered-idempotent-composite-finalize
  - low-2-benchmark-identity-on-composite-derives
affects:
  - analytics-service/services/job_worker.py (composite region only)
tech-stack:
  patterns: [shared-derive_basis_series-route, ordered-idempotent-finalize, densify-zero_fill, nan_dates-schema2]
key-files:
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_composite_headline_parity.py
    - analytics-service/tests/test_stitch_composite_job.py
decisions:
  - "Collapse #5 is a provable no-op on live scalars (F-1 backstop shipped with composite GA); tests characterize the safety invariant rather than drive a behavioral RED."
  - "Composite cash scalar input is gap_fill_daily_returns(stitched_cash) verbatim from the deleted closure → byte-identical legacy oracle by construction; densify='zero_fill' + nan_dates for the in-index member-guard NaN."
  - "SC-5 ordered-idempotent only — cash+MTM series + dailies land before the DONE-bearing headline flip; no DDL, no SECDEF finalize RPC (rides 106). Pre-existing re-derive death window documented accepted-transient."
metrics:
  duration_min: 24
  completed: 2026-07-14
  tasks: 3
  files: 3
  commits: [5a3c7f00, cfaf7046, 4d2e91d4]
---

# Phase 105 Plan 05: Composite Core — Collapse #1 + #5 + SC-5 + LOW-2 Summary

Composite cash joins the ONE shared `derive_basis_series` route (the last cash bypass — `_metrics_result_for` deleted, grep-gate zero), the composite annualization clock collapses to the single `asset_class` rule with the venue blend retained as a fail-loud cross-check, the finalize sequence is ordered-idempotent (both basis series persisted before the DONE-bearing headline flip), and the LOW-2 BTC benchmark identity is carried on both composite derives.

## What shipped

### Task 1 — Collapse #5 (D4): asset_class is THE clock selector (commit 5a3c7f00)
- `periods_per_year` now binds `periods_per_year_for_asset_class(strat_row.asset_class)` — the ONE rule (SC-2), agreeing with every #597 asset-class surface by construction.
- The legacy #597 venue blend survives as `_venue_blend_periods`, feeding the SAME `_stamp_failed` PERMANENT arm as a retained fail-loud sanity cross-check (D4). A wrong-`asset_class` composite still fails PERMANENT — never silently annualizes √252. `_COMPOSITE_DEGRADE_VENUES` kept as the unknown-venue backstop.
- Tests: `-k periods` parametrized equality safety-pin (asset_class rule == venue blend across every valid composite fixture shape) + `test_traditional_asset_class_composite_fails_loud_retained_check` (traditional/deribit → PERMANENT, compute never reached).

### Task 2 — Collapse #1 (SC-1): re-route composite cash; DELETE the closure (commit cfaf7046)
- Composite cash routes through `derive_basis_series(stitched_cash, benchmark_rets, periods_per_year=…, cumulative_method=…, day_basis=…, benchmark_symbol="BTC", scalar_returns=gap_fill_daily_returns(stitched_cash), densify_policy="zero_fill")`.
- The bespoke `_metrics_result_for` closure is DELETED; the basis_series import is hoisted above the cash derive; downstream `.insufficient_window` / `.sibling_kinds` reads and the docstring/comments repointed onto `_cash_basis_result` / the shared route.
- F-5 `ValueError` arm re-homed onto the derive's ValueError (same PERMANENT disposition + scrubbed message) with a heal-delete (`persist_basis_series(result=None)`) of any stale cash series row.
- LOW-2: `benchmark_symbol="BTC"` added to BOTH composite derives (payload-only; no reader consumes `conventions.benchmark` this phase).
- Coupled existing MTM tests updated because cash now shares the helper: derive/persist calls filtered by basis (cash carries the `densify_policy` zero_fill bridge; the mark_to_market persist by `basis`), and the overlap test's stitch-call index dropped from the 3rd to the 2nd (cash no longer double-stitches — it reuses `stitched_cash`).

### Task 3 — SC-5 (D5): ordered-idempotent finalize (commit 4d2e91d4)
- Added `_persist_cash_series` beside `_persist_mtm_series`; BOTH basis series + the reconcile-delete + dailies upserts land BEFORE `_write_headline_and_by_basis` (the DONE-bearing scalar/status flip is LAST). Verified nothing DONE-bearing precedes the series persists (no single-key prestamp pattern exists in the composite path).
- D5 honest boundary documented in the persist-sequence comment: ordered-idempotent = gated eventual consistency; the re-derive death window (old scalar + partial dailies until retry) is PRE-EXISTING and unchanged; strict atomicity (SECDEF finalize RPC) deferred to 106's fold migration; NO DDL.

## Verification results (report items)

- **grep-gate:** `git grep _metrics_result_for | wc -l` == **0** repo-wide (code + comments + docstrings + tests). `basis_series.py` shows 0 and was NOT touched (purged by 105-01).
- **SC-4 flagship dual-run** (`test_composite_sc4_flagship_member_guard_nan_dual_run_dict_equal`): member-guard-NaN + inter-member-gap fixture; new-route cash `metrics_json` is **DICT-EQUAL (`==`, byte-identity, no tolerance)** to the in-test legacy oracle `compute_all_metrics(gap_fill_daily_returns(stitch), None, geometric/calendar/√365).metrics_json`. headline == by-basis cash_settlement preserved. Captured cash `BasisSeriesResult`: `conventions.densify=="zero_fill"`, `conventions.benchmark=="BTC"`, `nan_dates==["2024-01-02"]` (non-empty). Persisted cash payload (via the cash ordering test): `schema==2`, `conventions.densify=="zero_fill"`, `conventions.benchmark=="BTC"`.
- **#5 two-rules-equal + retained fail-loud:** equality pin GREEN across all valid fixture shapes; `test_traditional_asset_class_composite_fails_loud_retained_check` GREEN (PERMANENT, no csv write, no by-basis); existing parity `test_traditional_asset_class_composite_fails_loud_mismatch_guard` unchanged + GREEN.
- **SC-5 ordering + kill-point + heal:** `test_cash_series_persists_before_done_scalar_write` GREEN (cash series RPC index < headline index); `test_cash_series_persist_failure_aborts_before_any_done_headline` GREEN (raising cash persist → abort, cash RPC attempted, NO complete headline; clean re-run completes = idempotent heal); F-5 `test_simple_basis_interior_nan_guard_permanent_not_unclassified` extended to assert the cash-series heal-delete, GREEN; existing `test_mtm_series_persists_before_done_scalar_write` GREEN unmodified.
- **Owned suites:** `tests/test_stitch_composite_job.py` + `tests/test_composite_headline_parity.py` → **79 passed**.
- **Full-suite coverage wave gate:** `pytest --cov --cov-fail-under=80` → **3717 passed, 93 skipped, 1 failed**, total coverage **92.56%** (gate 80% met). The single failure is a cross-agent seam guard (see Deviations) — NOT a regression in owned code.

## Deviations from Plan

### [BLOCKER — cross-agent seam] `test_single_cash_settlement_persist_seam` needs count bump (sibling-owned, locked no-touch)

- **Found during:** Task 3 full-suite wave gate.
- **Issue:** `tests/test_cash_basis_series_sc4.py::test_single_cash_settlement_persist_seam` scans job_worker.py and asserts exactly ONE result-bearing `basis="cash_settlement"` persist (the A3 honest-absence guard). SC-5's composite cash-series persist (`_persist_cash_series`, job_worker.py:4736, `result=_cash_basis_result`) is the legitimate SECOND result-bearing site, so the assertion now sees 2 and fails (`total=4, heals=2, result-bearing=2, expected 1`).
- **Why it's not a bug:** the composite persist is honest (persists the stitched composite series, never fabricates); it does not violate A3. The test's "exactly ONE" invariant predates composite joining the persist route and is now outdated by exactly one legitimate site. Both 105-04 (single-key) and 105-05 (composite) now write a cash series; the shared guard must expect 2.
- **Why NOT fixed here:** `test_cash_basis_series_sc4.py` is a LOCKED no-touch owned by the concurrent 105-04 sibling. I did not touch it (all 3 of my commits touched only my 3 owned files).
- **Required one-line fix (route to the file owner):** in `test_single_cash_settlement_persist_seam`, bump the expected result-bearing cash-persist count from 1 to 2 (i.e. `assert total - heals == 2`) and update the docstring to acknowledge the composite SC-5 site (`run_stitch_composite_job._persist_cash_series`) as the second legitimate result-bearing persist. Until this lands, the phase-level full-suite wave gate carries this one known failure.

### Auto-fixed (Rule 1/3 — within owned files)
- **[Rule 1] M-3 source-scan compliance:** an initial Task-1 comment used the word "published", tripping `test_no_verification_or_publish_status_write_source_scan`. Reworded to "live composite" (same commit, 5a3c7f00).
- **[Rule 3] Coupled-test call-count updates:** cash joining the shared helper changed derive/persist call counts and the stitch-call index that four existing MTM tests asserted on. Updated those assertions (filter by basis / by the cash-only zero_fill bridge; overlap stitch index 3→2) — behavior-preserving, intent unchanged.

## TDD note
Tasks 2 and 3 followed genuine RED→GREEN (falsifiable neuters named in every new docstring). Task 1 (collapse #5) is a **provable no-op on live scalars** (F-1 backstop shipped in the same commit as composite GA, so no shipping composite ever carried a divergent clock) — a strict behavioral RED is unachievable by construction; its tests are safety-pins/characterization + the retained fail-loud guard. Committed as a single `feat` with that rationale stated (not a faked RED).

## Self-Check: PASSED
- job_worker.py, test_composite_headline_parity.py, test_stitch_composite_job.py all present and modified.
- Commits 5a3c7f00, cfaf7046, 4d2e91d4 exist in `git log`.
- `git grep _metrics_result_for` == 0; basis_series.py untouched.
