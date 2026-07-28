---
phase: 101-options-mtm-toggle
plan: 02
subsystem: analytics-service (CSV finalizer / data_quality_flags bridge / sc-4 gate)
tags: [mtm, mtm_gated_reason, data_quality_flags, csv_finalizer, deribit, options, sc-4, pnl_basis]

# Dependency graph
requires:
  - phase: 101-01
    provides: "single-key MTM second-pass persistence + MTM_REASON_SUMMARY_COVERAGE reason constant + _prestamp_dq_flags mtm_gated_reason stamp"
provides:
  - "mtm_gated_reason SURVIVES the CSV finalizer's wholesale data_quality_flags rebuild (present-only, non-promoting) for single-key rows"
  - "composite→single exclusion: a stale composite-era mtm_gated_reason never masquerades as a fresh single-key verdict"
  - "mtm_gated_reason enumerated in the DataQualityFlags TypedDict (run_csv_strategy_analytics is now a producer)"
  - "phase SC-4 gate passed: cash pins green with zero edits, full analytics suite ≥80% coverage (92.36%)"
affects:
  - "Phase 102 (read side): page.tsx / build-payload / FactsheetView SegmentedControl now find a persisted mtm_gated_reason to render the disabled-with-reason toggle"

# Tech tracking
tech-stack:
  added: []   # zero new packages
  patterns:
    - "present-only, non-promoting flag carry across a wholesale-rebuild seam (mirrors insufficient_window / HARD-04)"
    - "by-basis / by-reason composite→single exclusion sharing the one _was_composite lookup with the Finding-5 NULLing"

key-files:
  created: []
  modified:
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_csv_analytics_runner.py

key-decisions:
  - "Carry mtm_gated_reason ONLY when truthy AND not _was_composite — never synthesize, never carry a composite-era reason"
  - "mtm_gated_reason is an availability annotation (never touches _warned / computation_status), mirroring insufficient_window"
  - "Ship-time re-derive is an OPERATIONAL step (OQ-3), NOT an in-phase task: the worker must be deployed to Railway before a re-derive can write the new key"

patterns-established:
  - "Producer of a data_quality_flags key MUST enumerate it in the DataQualityFlags TypedDict (docstring contract)"
  - "A wholesale-rebuild seam bridges only keys it explicitly carries; new prestamped keys must be added to the bridge or they are wiped"

requirements-completed: [MTM-01]

# Metrics
duration: ~45min
completed: 2026-07-12
---

# Phase 101 Plan 02: MTM gated-reason finalizer bridge + SC-4 gate Summary

**`mtm_gated_reason` now survives the CSV finalizer's wholesale `data_quality_flags` rebuild (present-only, non-promoting, composite→single-excluded), completing the single-key honest-gate contract; phase SC-4 gate green with the cash pins untouched.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-12
- **Tasks:** 2 (Task 1 code + tests; Task 2 verification gate)
- **Files modified:** 2

## Accomplishments

- **The bridge (load-bearing).** `run_csv_strategy_analytics` rebuilds `data_quality_flags` wholesale after every broker derive (`analytics_runner.py:2318` fresh `{"csv_source": True}` dict; `mtm_gated_reason` is NOT among the NAV/ALLOCATED guard-key bridges at :2349–2361). Without a carry, the reason plan 101-01 prestamps in `_prestamp_dq_flags` is wiped seconds after being stamped, leaving the Phase-102 disabled-with-reason toggle with nothing to read. Added a present-only carry immediately after the `ALLOCATED_CAPITAL_GUARD_KEYS` loop and before the `csv_status` computation.
- **Non-promoting.** The carry deliberately does NOT touch `_warned`, so a degraded-MTM single-key row still reports exact-string `computation_status == "complete"` / `computation_warned is False` — an availability annotation, exactly like `insufficient_window` (HARD-04). The composite path likewise never promotes on this key.
- **Composite→single exclusion.** The carry is gated on `not _was_composite`, so a stale composite-era reason (e.g. `unsmoothed_options_book`) never survives into a fresh single-key headline — mirrors the existing Finding-5 by-basis NULLing (`analytics_runner.py:2372–2406`). Hoisted `_was_composite = bool(existing_flags.get("composite"))` above the bridge so the exclusion and `_clear_stale_by_basis` share one lookup.
- **TypedDict enumeration.** `run_csv_strategy_analytics` is now a producer of `mtm_gated_reason`, so per the `DataQualityFlags` docstring contract the key is enumerated (`analytics_runner.py`, near `insufficient_window`).
- **SC-4 gate green.** Cash pins pass with **zero edits**; full analytics suite green at **92.36% coverage** (gate ≥80).

## Task Commits

1. **Task 1: Bridge mtm_gated_reason through the finalizer flag rebuild** — `2c25b858` (feat)
2. **Task 2: Phase SC-4 gate** — verification gate, no source changes (no commit)

_Note: `.planning/` is gitignored/local on this project, so this SUMMARY and STATE are not committed (per project convention + executor instruction: never stage `.planning/`)._

## Files Created/Modified

- `analytics-service/services/analytics_runner.py` — present-only, non-promoting `mtm_gated_reason` carry across the wholesale flag rebuild + composite→single exclusion + hoisted `_was_composite`; enumerated `mtm_gated_reason` in the `DataQualityFlags` TypedDict.
- `analytics-service/tests/test_csv_analytics_runner.py` — four RED-first wiring tests (reason survives; non-promoting; dropped on composite→single; absence-is-absence). One assertion imports `MTM_REASON_SUMMARY_COVERAGE` from `services.stitch_composite` so a constant rename cannot silently decouple the two sites.

## Test results

- **New finalizer tests:** `tests/test_csv_analytics_runner.py -k mtm_gated_reason` → **4 passed**. Whole file → **26 passed**.
- **Cash pins (SC-4), zero edits:** `test_zavara_acceptance.py`, `test_deribit_txn.py`, `test_allocated_capital.py`, `test_deribit_acceptance.py`, `test_deribit_ground_truth.py` → **268 passed**; `git diff --stat` on those files is EMPTY (no edits were required — SC-4 held by construction, the cash pass is a fully independent `combine_native_ledger(pnl_basis="cash_settlement")` call).
- **Full analytics suite w/ coverage gate:** `pytest --cov --cov-fail-under=80 --ignore=tests/e2e` → **3637 passed, 93 skipped, 1 failed** at **92.36% coverage** (gate ≥80 reached).
  - The single failure is the **pre-existing, unrelated** `test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union` (audit taxonomy TS↔Python drift), logged in `deferred-items.md`. It touches no file in this plan; my commit (HEAD~1..HEAD) changed only `analytics_runner.py` + `test_csv_analytics_runner.py`.
  - Env note: the full suite requires the repo `.venv` (Python 3.12 with `pandera` etc.); the ambient Homebrew Python 3.14 lacks `pandera` and cannot collect the CSV-validator modules. Run gates via `analytics-service/.venv/bin/python -m pytest`.

### Neuter-falsifiability confirmations

| Neuter | Test(s) that went RED |
|--------|-----------------------|
| Remove the present-only carry (`data_quality_flags["mtm_gated_reason"] = _mtm_reason`) | `test_mtm_gated_reason_survives_finalizer_single_key` (confirmed RED in the initial RED run: reason wiped to `{csv_source, benchmark_*}`) |
| Drop the `and not _was_composite` exclusion (`if _mtm_reason:`) | `test_mtm_gated_reason_dropped_on_composite_to_single` **AND** the pre-existing `test_noncomposite_rederive_nulls_stale_by_basis` — the stale `unsmoothed_options_book` survived into single-key flags |

The exclusion is therefore double-guarded (my new test + the pre-existing Finding-5 test). Both neuters were applied and restored via a backup copy; the restored file is byte-identical (`if _mtm_reason and not _was_composite:` present at `analytics_runner.py:2389`).

### Pitfall-2 guard (RESEARCH: MTM must NOT match cash)

Grepped the new test block for any cash-vs-MTM equality assertion on returns/metrics — **NONE**. The MTM tests assert reason presence/absence, never numeric equality to the cash track (the MTM curve re-dates premium off the trade day BY DESIGN and must not match the cash-basis track). Parity assertions elsewhere are cash-vs-cash only.

## Coverage delta

Full-suite coverage **92.36%**, comfortably above the `--cov-fail-under=80` gate. The bridge is a few additive lines fully exercised by the four new wiring tests; no coverage exclusion was needed.

## Deviations from Plan

None affecting design. Two mechanical adaptations, neither a behavior change:

1. **[Rule 3 — Blocking] Ran the suite via the repo `.venv` (Python 3.12).** The ambient `python3` is Homebrew 3.14 and lacks `pandera`, so 5 CSV-validator test modules failed collection. Resolved by invoking `analytics-service/.venv/bin/python -m pytest` (the CI-pinned interpreter with `requirements.txt` deps). No package install performed; no code change. Recorded so the land flow runs gates against `.venv`, not the ambient interpreter.
2. **TypedDict enumeration of `mtm_gated_reason`.** The plan specified the carry but not the TypedDict edit; the `DataQualityFlags` docstring mandates that any new producer enumerate its key. Added `mtm_gated_reason: str` (Rule 2 — correctness/contract compliance; keeps the typed-key drift guard meaningful). mypy on `analytics_runner.py`: clean.

## Issues Encountered

- Pre-existing lint: `ruff check` reports 10 errors in `analytics_runner.py`/`test_csv_analytics_runner.py` — all at pre-existing lines (58, 799–800, 986, 2050–2051, 2516–2517), NONE within my added ranges. Out of scope per the deviation SCOPE BOUNDARY; not touched.
- A pre-existing, unrelated git `stash@{0}` exists on the repo; left untouched.

## Ship-time operational step (OQ-3 — REQUIRED before Phase 102 live verification)

> **This is an OPERATIONAL step, NOT an in-phase code task.** A code edit alone changes only how NEW derives are written; existing single-key Deribit options rows have no `metrics_json_by_basis.mark_to_market` and no prestamped `mtm_gated_reason` until they are re-derived. The worker must be **deployed to Railway** before a re-derive can write the new key (deploys ride merge-to-main), so this runs at land time, not now.

**Verbatim post-deploy backfill + SC-4 live verification:**

1. **Deploy verification first.** After merge + green CI, confirm the analytics worker actually deployed to Railway — deploys **silently SKIP on a red main CI** (need a green-first-try main). Verify:
   - `railway deployment list` → the top deployment's `commitHash` matches the merged commit.
   - Railway `/health` responds OK.
   Do NOT proceed to the re-derive until both are confirmed.
2. **Enqueue a re-derive for EACH single-key Deribit options strategy** (e.g. the Zavara book):
   - `SELECT enqueue_compute_job(strategy_id, 'derive_broker_dailies');` (or the wizard's re-sync path).
   - Requires `USE_COMPUTE_JOBS_QUEUE=true` in prod (already set per MEMORY).
3. **Verify per strategy — BOTH outcomes are honest:**
   - `strategy_analytics.metrics_json_by_basis ? 'mark_to_market'` is **true** (MTM data present, seven finite headline scalars), **OR**
   - `data_quality_flags->>'mtm_gated_reason'` is `mtm_summary_coverage_incomplete` (a genuinely-uncoverable book honestly degraded).
   - Never neither, never a fabricated line.
4. **SC-4 live check:** the headline scalars **and** `csv_daily_returns` for that strategy are **byte-identical vs. their pre-deploy values** (adding the MTM pass must not perturb the cash track). Zavara's corroborated window (Aug 2025–Mar 2026) is post-rollout, so it should reconstruct rather than degrade — but the honest gate covers the general case.
5. **Assumption A2 (explicit):** if the target book has **pre-2025-01-12** option activity, there is no boundary-book V₀ anchor → the MTM basis fails loud → the gate **degrading-with-reason is the CORRECT outcome, not a bug**. Do not "fix" a degraded pre-rollout book; verify the reason is stamped and cash still ships.
6. **Phase 102 gating:** Phase 102 (UI toggle wiring + composite MTM compose + Zavara MTM regression + the `unsmoothed_options_book` reason-copy rewrite) **consumes this persisted data**. Do NOT start Phase-102 live verification before this backfill runs, or it will find the `mark_to_market` key absent and mis-read the state as a bug.

## Next Phase Readiness

- **MTM-01 core is complete on the analytics side.** For a single-key options book the worker now persists either `metrics_json_by_basis.mark_to_market` (honest data present, plan 101-01) or a **surviving** `mtm_gated_reason` (honest degrade, this plan) — never neither, never a fabricated line.
- `cash_settlement` output byte-identical: every pre-existing cash pin green without edits (SC-4).
- **Blocker for Phase 102 live work:** the ship-time re-derive above MUST run after deploy so the persisted data exists. The read-side toggle, composite MTM compose, Zavara MTM regression, and the Phase-90 `unsmoothed_options_book` reason-copy rewrite are all Phase 102.

## Self-Check: PASSED
- `analytics-service/services/analytics_runner.py` — FOUND (modified; bridge at :2389, TypedDict key enumerated)
- `analytics-service/tests/test_csv_analytics_runner.py` — FOUND (modified; 4 new mtm_gated_reason tests, all green)
- Commit `2c25b858` — present in `git log` on `gsd/v1.10-portfolio-intelligence-options-mtm`.

---
*Phase: 101-options-mtm-toggle*
*Completed: 2026-07-12*
