---
phase: 102-options-mtm-factsheet-composite-regression
plan: 02
subsystem: analytics
tags: [mtm, composite, stitch, anchor-race, sc-4, regression, deribit, options]

# Dependency graph
requires:
  - phase: 101-options-mtm-toggle
    provides: "single-key MTM second pass + persisted metrics_json_by_basis.mark_to_market + the MTM structural-degrade catch stamping MTM_REASON_SUMMARY_COVERAGE (the reason-classification site this plan refines)"
  - phase: 102-options-mtm-factsheet-composite-regression (plan 01)
    provides: "frontend disabled-with-reason copy switch that pins the mtm_anchor_race string literal on the TS side (this plan defines its Python owner)"
provides:
  - "MTM_REASON_ANCHOR_RACE vocabulary constant (single admissibility-vocabulary owner in stitch_composite.py)"
  - "InceptionReconciliationError classified as the distinct transient mtm_anchor_race reason inside the EXISTING MTM structural-degrade catch (label-only; degrade semantics unchanged — cash still ships DONE)"
  - "Option A compose pins: options-member composite honest-disabled with the exact unsmoothed_options_book literal, no persisted mark_to_market key, marked (never zero-filled) per-member coverage"
  - "MTM-03 analytics static byte-identity regression evidence (nine cash-pin files byte-identical, full suite green ≥80% coverage)"
affects: [ship-time OQ-3 live Zavara MTM corroboration, future composite-MTM parity milestone (Option B, out of scope)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reason CLASSIFICATION is label-only inside an existing degrade catch — isinstance disambiguation, never a new re-raise/retry/tuple change"
    - "Rename-decouple guard: value-import the machine reason constant + pin it character-exact to the frontend literal (mirrors the 101-02 MTM_REASON_SUMMARY_COVERAGE guard)"

key-files:
  created:
    - .planning/phases/102-options-mtm-factsheet-composite-regression/102-02-SUMMARY.md
  modified:
    - analytics-service/services/stitch_composite.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_mtm_single_key.py
    - analytics-service/tests/test_stitch_composite.py
    - analytics-service/tests/test_stitch_composite_job.py

key-decisions:
  - "Option A (LOCKED, no escalation): options-member composites stay honestly gated OFF; mark_to_market_available and the composite MTM pass stay READ-ONLY; NO new valuation math"
  - "mtm_anchor_race is a distinct transient reason that STILL DEGRADES (cash ships) — the propagate-to-retry alternative was rejected because a persistent InceptionReconciliationError would retry the whole derive to failed_final and sink the healthy cash headline"
  - "Existing suite already covered marked-coverage / no-mark_to_market-key / perp-only; the genuinely new guarantee added is the rename-decouple guard tying MTM_REASON_OPTIONS to its frontend literal"

patterns-established:
  - "Label-only classification inside a degrade path: isinstance(_mtm_exc, InceptionReconciliationError) ? MTM_REASON_ANCHOR_RACE : MTM_REASON_SUMMARY_COVERAGE"
  - "Single admissibility-vocabulary owner (stitch_composite.py) — single-key and composite MTM reasons never fork"

requirements-completed: [MTM-02, MTM-03]

# Metrics
duration: ~35min
completed: 2026-07-12
---

# Phase 102 Plan 02: Option A Compose + Anchor-Race Classification + Static Regression Summary

**Same-anchor MTM race now stamps the distinct transient `mtm_anchor_race` reason (label-only, cash still ships DONE) and options-member composites are pinned honestly-disabled — with the full analytics cash-pin suite byte-identical and the anchor-race/compose keystones proven neuter-falsifiable.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-12
- **Completed:** 2026-07-12
- **Tasks:** 2 (both TDD, RED-first)
- **Files modified:** 5 (2 production, 3 test)

## Accomplishments

- **Deferred anchor-race known-limitation RESOLVED** (the deferred-items.md exit condition): a mid-crawl account event on the single-key MTM second pass that raises `InceptionReconciliationError` now degrades with the honest transient reason `mtm_anchor_race` instead of the permanent-sounding `mtm_summary_coverage_incomplete`. Cash STILL ships DONE; there is NO new retry path — a persistent inception breach still degrades, never retry-to-`failed_final`.
- **`MTM_REASON_ANCHOR_RACE` defined** in `stitch_composite.py` (the single admissibility-vocabulary owner), with a docstring stating the persistent-breach caveat (the copy promises re-computation only, never recovery) — the Python owner for the string literal plan 102-01 already pinned on the TS side.
- **Option A compose pins (MTM-02):** the options-member composite is pinned honest-disabled with the exact `unsmoothed_options_book` literal via a value-imported constant (rename-decouple guard), no persisted `mark_to_market` key, and marked (never zero-filled) per-member coverage; the perp-only native composite still admits MTM end-to-end (verify-only).
- **MTM-03 static regression gate (SC-4 non-options):** the nine analytics cash-pin files are byte-identical (zero edits, `git diff --stat` empty) and the full suite is green at 92.40% coverage — with the pre-existing `test_audit.py` taxonomy drift as the SOLE red (confirmed not entangled with the new reason).

## Task Commits

1. **Task 1: MTM_REASON_ANCHOR_RACE — honest transient classification** — `1c6bac6a` (feat)
2. **Task 2: Option A compose pins + MTM-03 static regression gate** — `a3730f27` (test)

_Both tasks TDD, RED-first. Task 1 combines the vocabulary constant + the label-only production change + the RACE tests in one atomic commit (the tests reference the constant and would not import without it)._

## Files Created/Modified

- `analytics-service/services/stitch_composite.py` — added `MTM_REASON_ANCHOR_RACE = "mtm_anchor_race"` with the full Phase-102 docstring (transient race, degrade-not-retry rationale, persistent-breach honesty caveat). `mark_to_market_available` UNCHANGED (Option A).
- `analytics-service/services/job_worker.py` — inside the EXISTING MTM structural-degrade catch (`as _mtm_exc`), replaced the unconditional `mtm_gated_reason = MTM_REASON_SUMMARY_COVERAGE` with `MTM_REASON_ANCHOR_RACE if isinstance(_mtm_exc, InceptionReconciliationError) else MTM_REASON_SUMMARY_COVERAGE`. Added `MTM_REASON_ANCHOR_RACE` to the reason-constant import and `InceptionReconciliationError` from `services.native_nav`. Updated the stale comment near the SERIES_UNCOMPUTABLE degrade to name both reasons. The catch tuple, degrade semantics, and the separate outer cash-crawl `NavReconstructionError` fail-permanent path are all untouched.
- `analytics-service/tests/test_mtm_single_key.py` — RACE-1 (`InceptionReconciliationError` → `mtm_anchor_race`, by-basis SQL NULL, cash ships DONE) and RACE-2 (a plain `NavReconstructionError` still keeps `mtm_summary_coverage_incomplete`). RACE-3 (transient `ValueError` propagates) is the pre-existing `test_transient_valueerror_on_mtm_propagates`, confirmed green unmodified.
- `analytics-service/tests/test_stitch_composite.py` — COMPOSE-1 rename-decouple guard: `mark_to_market_available` over an options member returns `(False, MTM_REASON_OPTIONS)` and `MTM_REASON_OPTIONS == "unsmoothed_options_book"`.
- `analytics-service/tests/test_stitch_composite_job.py` — strengthened the existing options-composite job pin to assert `"mark_to_market" not in by_basis` and to tie the reason to the value-imported `MTM_REASON_OPTIONS` constant.

## Decisions Made

- **Option A, no escalation** (per RESEARCH Q3 + CONTEXT locked boundary): options-member composites stay honestly gated OFF. Option B (composing MTM across members) crosses the LOCKED "NO new valuation math" boundary and there is no live options composite to serve (Zavara is single-key). `mark_to_market_available` and the composite MTM pass (`job_worker.py:4171-4324`) were left READ-ONLY.
- **Label-only, degrade-preserving classification** for the anchor race — no re-raise, no retry, no catch-tuple change. `InceptionReconciliationError` is documented permanent/structural (`native_nav.py:594`); a propagate-to-retry would sink the healthy cash headline (deferred-items.md option-2 risk, rejected).
- **Extend, don't duplicate:** the existing suite already pinned marked-coverage (`test_ccxt_member_degrades_not_permanent_fail`, `test_coverage_mask_marks_gap_days_without_zero_filling`), the no-`mark_to_market`-key contract, and perp-only `(True, None)`. The one genuinely new compose guarantee — the rename-decouple guard tying `MTM_REASON_OPTIONS` to its frontend literal — was added; the job-level pin was strengthened in place rather than duplicated.

## Deviations from Plan

None — plan executed exactly as written. Line numbers were re-located by grep (`as _mtm_exc`, `MTM_REASON_SUMMARY_COVERAGE`) per the plan's drift warning; the actual catch was at `job_worker.py:~2381/2398` and the stale comment at `~2983`, both ~80 lines off the SUMMARY absolutes as forecast. `InceptionReconciliationError` was confirmed defined in `services.native_nav:137` (subclass of `nav_twr.NavReconstructionError`) and was unimported in `job_worker.py` — added as specified.

## Neuter-Confirmation (falsifiability, performed not claimed)

- **Anchor-race label — RACE-1:** neutered the production line to unconditional `MTM_REASON_SUMMARY_COVERAGE` → `test_inception_reconciliation_on_mtm_stamps_anchor_race` RED (`assert 'mtm_summary_coverage_incomplete' == 'mtm_anchor_race'`). Restored → green.
- **Anchor-race guard — RACE-2:** neutered to unconditional `MTM_REASON_ANCHOR_RACE` (classify all structural failures as anchor-race) → `test_non_inception_structural_mtm_failure_keeps_coverage_reason` RED. Restored → green.
- **Compose honest-disabled — COMPOSE-1/COMPOSE-2:** neutered the `mark_to_market_available` options branch to not gate (fall through to `(True, None)`) → both `test_mtm_gate_options_reason_pins_frontend_literal` and `test_mtm_gated_reason_in_dq_flags_when_option_active` RED. Restored → green.

## Test Results

- `tests/test_mtm_single_key.py` — 22 passed (was 20; +RACE-1, +RACE-2).
- `tests/test_stitch_composite.py tests/test_stitch_composite_job.py tests/test_mtm_single_key.py` — 106 passed.
- Nine cash-pin files (`test_golden_parity`, `test_metrics_parity`, `test_metrics_minigolden`, `test_composite_headline_parity`, `test_zavara_acceptance`, `test_deribit_acceptance`, `test_deribit_ground_truth`, `test_allocated_capital`, `test_deribit_txn`) — 325 passed, `git diff --stat` EMPTY (byte-identical, zero edits).
- Full suite (`pytest tests --ignore=tests/e2e --cov --cov-fail-under=80`) — **3645 passed, 93 skipped, 1 failed**. Coverage **92.40%** (≥ 80% gate). SOLE red = pre-existing `test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union` (`AuditAction` Literal ↔ TS union drift; zero `mtm` references in that test — the new reason does NOT entangle it, confirming the RESEARCH grep).
- `mypy services/job_worker.py services/stitch_composite.py` — Success, no issues. (ruff is not installed in the analytics `.venv`; not gated there — mypy is the 101 practice.)

## Coverage Delta

Full-suite coverage 92.40% (well above the 80% gate). New per-file: `test_stitch_composite.py` 100%, `test_stitch_composite_job.py` 99%, `test_mtm_single_key.py` module fully exercised. No coverage regression introduced.

## Issues Encountered

None. The pre-existing `test_audit.py` taxonomy failure is the only red and is out of scope (deferred-items.md) — it touches no plan file and is independent of the MTM reason vocabulary.

## Ship-Time Gate (carried forward verbatim — NOT attested in-phase)

**MTM-03(b) LIVE Zavara MTM corroboration — post-deploy operational gate (OQ-3, 101-02 SUMMARY §Ship-time):**
after merge + green-first-try main CI, verify the Railway worker deployed (deployment
commitHash + /health), enqueue `derive_broker_dailies` per single-key Deribit options
strategy, then verify EITHER `metrics_json_by_basis ? 'mark_to_market'` with seven finite
scalars OR an honest `mtm_gated_reason` — never neither — AND cash headline +
csv_daily_returns byte-identical vs pre-deploy (live SC-4), THEN eyeball the Zavara MTM
curve corroborates in the factsheet toggle. Neither 102 plan claims live MTM attestation.

**Operational detail (from MEMORY):** Railway analytics deploys ride merge-to-main and silently SKIP on red CI (need GREEN-first-try); verify via `railway deployment list` (commitHash) + `/health` before enqueuing. Re-derive backfill is `enqueue_compute_job(strategy_id, 'derive_broker_dailies')`; env key on Railway is `SUPABASE_SERVICE_KEY`. The backfill is the only step that POPULATES `metrics_json_by_basis.mark_to_market` for existing rows — no live MTM data exists until it runs.

## Next Phase Readiness

- MTM-02 (Option A) and MTM-03 (analytics static half) complete. The `mtm_anchor_race` Python owner is now defined for the frontend literal plan 102-01 pinned.
- The v1.10 milestone's ship flow must run the OQ-3 ship-time gate above (live Zavara corroboration) after merge + green main CI — it cannot be attested during phase-execute.
- Option B (composite options-MTM parity) remains explicitly out of scope — a separate milestone if ever desired.

## Self-Check: PASSED

- FOUND: `.planning/phases/102-options-mtm-factsheet-composite-regression/102-02-SUMMARY.md`
- FOUND commit `1c6bac6a` (feat 102-02: anchor-race classification)
- FOUND commit `a3730f27` (test 102-02: Option A compose pins)

_Note: `.planning/` is gitignored (local-only ledger, per project convention) — the SUMMARY and STATE updates live locally and are intentionally NOT committed. The two task commits are the tracked deliverable._

---
*Phase: 102-options-mtm-factsheet-composite-regression*
*Completed: 2026-07-12*
