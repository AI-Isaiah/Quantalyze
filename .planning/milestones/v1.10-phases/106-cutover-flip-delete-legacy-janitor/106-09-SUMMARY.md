---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 09
subsystem: analytics
tags: [dark-path-deletion, grep-gate, backbone-unification, run_strategy_analytics, tdd, source-scan-test]

# Dependency graph
requires:
  - phase: 106-08
    provides: "run_compute_analytics_job / compute_analytics HTTP re-entry points retired (run_strategy_analytics left with zero live callers)"
provides:
  - "The trades-based dark chain run_strategy_analytics is DELETED — nothing can recompute a strategy off the non-backbone route"
  - "Permanent source-scan grep-gate (test_dark_path_deleted.py) enforcing the deletion invariants across both runtimes forever"
  - "run_csv_strategy_analytics is the SOLE live derive entry point; every shared metric helper preserved"
affects: [106 Stage B close, backbone-unification verification, future analytics-runner work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-direction permanent grep-gate: NEGATIVE (retired tokens absent) + POSITIVE SC-3 (live path/helpers present) so a vacuous over-broad deletion fails loud"
    - "Comment-stripped literal-count source scan mirroring test_cash_basis_series_sc4.py (_repo_root/_strip_comment)"

key-files:
  created:
    - "analytics-service/tests/test_dark_path_deleted.py"
  modified:
    - "analytics-service/services/analytics_runner.py"
    - "analytics-service/tests/test_analytics_runner.py"
    - "analytics-service/tests/test_cash_basis_series_sc4.py"
    - "analytics-service/tests/fixtures/regen_golden.py"
    - "analytics-service/services/position_reconstruction.py"

key-decisions:
  - "KEEP every private helper (_compute_*, _load_position_time_series, _merge_into_top_level_flags, TradeMix*, DataQualityFlags) — each retains direct unit/parity/golden-fixture test callers, so caller-count did NOT hit zero. When in doubt, KEEP."
  - "Restore the compute_all_metrics import as an explicit patch seam (# noqa: F401) for the run_csv CSV tests — the full pytest suite is the arbiter, and it demanded it."
  - "Only genuinely-orphaned symbols died: run_strategy_analytics itself, SiblingKind, and 6 imports it solely used."

patterns-established:
  - "Pattern: prune tests first by their end-to-end invocation of the deleted fn, then let the suite reveal any over-deletion of shared seams"

requirements-completed: [BB-03]

# Metrics
duration: ~55min
completed: 2026-07-15
---

# Phase 106 Plan 09: Delete the dark run_strategy_analytics chain (D4 final) Summary

**The trades-based dark analytics chain (run_strategy_analytics + SiblingKind + its ~910-line compute body) is deleted, ~40 dark-chain tests pruned, and a permanent two-direction grep-gate (test_dark_path_deleted.py) now keeps the non-backbone compute path from ever returning unnoticed.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 (Task 1 TDD-RED gate, Task 2 deletion + GREEN)
- **Files modified:** 5 (1 created, 4+1 modified)

## Accomplishments
- Deleted `run_strategy_analytics` (the ~910-line trades compute fn) and the orphaned `SiblingKind` Literal from `analytics_runner.py`; dropped the 6 imports it solely used.
- Installed the permanent grep-gate `test_dark_path_deleted.py` — NEGATIVE asserts (0 `run_strategy_analytics` / `run_compute_analytics_job` / quoted `"compute_analytics"` / `BROKER_DAILIES_VIA_FUNDING` across the live py surface; deleted files stay absent; TS re-entry stays dead) + POSITIVE SC-3 asserts (live CSV path + shared helpers present).
- Pruned ~40 dark-chain integration tests + orphaned fixtures + the now-dead `_DEFAULT_RETURNS_META`, while KEEPING every shared-helper / CSV-runner / NAV-safety test.
- Full suite GREEN (3687 passed / 93 skipped); coverage 89.01% → **89.05%** (`--cov-fail-under=80` holds); mypy clean; gate 6/6 GREEN.

## Task Commits

1. **Task 1: dark-path deletion grep-gate (RED on the surviving chain)** - `08668fe9` (test)
   - Partial-RED evidence: `test_dark_chain_run_strategy_analytics_fully_deleted` FAILED (analytics_runner.py: 5 refs) and `test_compute_analytics_job_reentry_deleted` FAILED (1 docstring ref); the other 4 (flag deleted, files absent, TS dead, SC-3 KEEP anchors present) PASSED.
2. **Task 2: delete the run_strategy_analytics chain + prune its test surface (GREEN)** - `9c778ecb` (feat!)

## Files Created/Modified
- `analytics-service/tests/test_dark_path_deleted.py` - **created**; permanent source-scan grep-gate (2 directions, comment-stripped counts).
- `analytics-service/services/analytics_runner.py` - deleted `run_strategy_analytics` + `SiblingKind`; pruned 6 solely-used imports; rewrote module / DataQualityFlags / run_csv docstrings; restored `compute_all_metrics` as a documented patch seam.
- `analytics-service/tests/test_analytics_runner.py` - pruned ~40 dark-chain tests + orphaned fixtures + dead `_DEFAULT_RETURNS_META`; kept helper/CSV/NAV-safety tests; refreshed stale comments.
- `analytics-service/tests/test_cash_basis_series_sc4.py` - updated the persist-seam docstring premise (count invariant UNTOUCHED).
- `analytics-service/tests/fixtures/regen_golden.py` - updated stale comment reference.
- `analytics-service/services/position_reconstruction.py` - updated stale docstring annotation pointing at the deleted fn.

## SC-2 Pre-delete Grep (verbatim, live-caller check)
`git grep -n "run_strategy_analytics" -- analytics-service src` returned ONLY non-callers: the def + docstrings in `analytics_runner.py` itself; `#`/JSDoc comments in `position_reconstruction.py:167`, `regen_golden.py:509`, `test_csv_analytics_runner.py:682`, `SyncProgress.tsx:55`; the pruned `test_analytics_runner.py`; the sc4 docstring; and the new gate test. The ONLY live invocations (`await run_strategy_analytics(...)`) were all inside `test_analytics_runner.py` (pruned this task). **Zero live callers → SC-2 satisfied.** Post-delete grep on the live py surface (`services/routers/scripts/main`): **ZERO**.

## Shared-Helper Discipline (SC-3) — deleted vs kept
**Deleted (grep proved zero callers anywhere, incl. tests):**
- `run_strategy_analytics` — its only invocations were the pruned tests.
- `SiblingKind` — used only inside the deleted fn (1698/1703), no test refs.
- Imports solely used by the deleted fn: `os`, `typing.Literal`, `services.db.one`, `services.db.rows`, `services.nav_twr.NavReconstructionError`, `services.transforms.trades_to_daily_returns_with_status`.
- Test fixtures orphaned by the pruning: `_minimal_daily_rows`, `_build_balance_flag_mock_supabase`, `_run_and_get_success_upsert`, `_run_and_get_data_quality_flags`, `_build_runner_mock_supabase`, `_sample_position_snapshot_rows`, `_build_daily_rows`, `_trades_runner_supabase`, and the dead constant `_DEFAULT_RETURNS_META`.

**Kept (caller-count did NOT hit zero — justifying grep):**
- `run_csv_strategy_analytics`, `compute_all_metrics`, `trades_to_daily_returns_with_status` (explicit KEEP list).
- `_compute_volume_metrics`, `_compute_position_side_volume_pcts`, `_compute_derived_trade_metrics`, `_compute_volume_aggregator`, `_compute_trade_mix` — live callers in `test_metrics_parity.py`, `test_metrics_minigolden.py`, `test_position_reconstruction.py`, `regen_golden.py`.
- `_has_maker_taker_coverage`, `_is_trade_mix_approximate`, `_load_position_time_series` — direct unit-test callers (`test_has_maker_taker_*`, `test_is_trade_mix_approximate_*`, `TestLoadPositionTimeSeriesNavSafety`).
- `_merge_into_top_level_flags` — live caller in `test_equity_fallback.py`.
- `TradeMixBucket/TradeMix4Bucket/TradeMix2Bucket/TradeMixResult` (used by kept `_compute_trade_mix`), `DataQualityFlags` (shared with `run_csv` at its data-quality-flags assignment), `_make_paged_range`, `_make_paginated_order_mock`.

## Coverage (before/after)
- **Before** (working changes stash-restored, HEAD = 08668fe9): 14055 stmts / 1545 missed → **89.01%** (2 RED gate failures as expected).
- **After**: 13836 stmts / 1515 missed → **89.05%**. 219 covered statements deleted together with their covering tests; `--cov-fail-under=80` holds comfortably both sides.

## Decisions Made
- KEEP-all-helpers: the per-helper caller grep showed every private helper retains a non-dark-chain test caller (metrics-parity / golden-fixture / equity-fallback / NAV-safety unit tests). Their production caller (the dark chain) died, but caller-count did not hit zero → KEPT per "when in doubt KEEP."
- `compute_all_metrics` restored as a patch seam: it is not called directly in `analytics_runner` (scalar compute runs inside `derive_basis_series` since Phase 105), but 5 KEPT CSV-runner tests `patch("services.analytics_runner.compute_all_metrics", ...)`. Retained with an explanatory comment + `# noqa: F401` (the surgical fix that reproduces the exact prior passing state).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored the compute_all_metrics import (broke 5 KEPT CSV tests)**
- **Found during:** Task 2 (full-suite run)
- **Issue:** Ruff flagged `compute_all_metrics` as unused (run_csv routes through `derive_basis_series`), so I initially removed it; this broke the patch-setup of 5 KEPT `test_csv_run_*` tests that `patch("services.analytics_runner.compute_all_metrics", ...)` with an `AttributeError`.
- **Fix:** Restored the import with an explanatory comment + `# noqa: F401` (patch seam). SC-3 explicitly lists `compute_all_metrics` as KEEP.
- **Verification:** `test_analytics_runner.py` 103 passed; full suite 3687 passed.
- **Committed in:** `9c778ecb`

**2. [Rule 3 - Blocking / orchestrator-directed] Updated position_reconstruction.py stale docstring**
- **Found during:** Task 2 (SC-2 grep)
- **Issue:** `position_reconstruction.py:167` docstring pointed at "analytics_runner.run_strategy_analytics" — a dangling reference after deletion. The orchestrator explicitly directed updating this comment (not a caller). File is not in the plan's `<files>` list.
- **Fix:** Reworded the annotation to point at the retained `_compute_derived_trade_metrics` / exposure helpers. Staged as an explicit file (orchestrator-named).
- **Verification:** mypy clean; no live-caller impact.
- **Committed in:** `9c778ecb`

**3. [Rule 2 - Dead-code cleanup] Removed 6 solely-used imports + dead _DEFAULT_RETURNS_META + orphaned fixtures + SiblingKind**
- **Found during:** Task 2
- **Issue:** Deleting the fn orphaned its imports, the `_DEFAULT_RETURNS_META` constant, ~8 test fixtures, and `SiblingKind`.
- **Fix:** Removed each after grep proved zero remaining callers (incl. tests). Left pre-existing unrelated debt untouched (F821 `trunc`, F841 winners/losers, F401 `DEFAULT_PERIODS_PER_YEAR` — all pre-existing, out of scope).
- **Verification:** Full suite + coverage green; mypy clean.
- **Committed in:** `9c778ecb`

---

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking/orchestrator-directed, 1 dead-code cleanup)
**Impact on plan:** No scope creep. All fixes serve the plan's deletion goal or restore known-good behavior. The KEEP-all-helpers reading is more conservative than the plan's illustrative "delete each private helper" line, but strictly honors the plan's overriding "when in doubt KEEP / full suite is the arbiter" directive — every helper retained has a live test caller.

## Out-of-scope non-caller references (left intentionally)
`test_csv_analytics_runner.py:682` and `src/components/strategy/SyncProgress.tsx:55` retain historical `#`/JSDoc comment mentions of `run_strategy_analytics`. These are non-executable, not scanned by the permanent gate, and not in the plan's file scope — left untouched (surgical). Two stale `#` comment blocks in `test_analytics_runner.py` were refreshed for accuracy since they directly headed deleted tests.

## Issues Encountered
- The 5 CSV-runner test failures (compute_all_metrics patch seam) — root-caused and fixed within Task 2 (deviation #1) before committing.

## Next Phase Readiness
- 106 Stage B D4 (final ordered step) complete: the dark path is gone and permanently gated.
- No PR/push performed (per task instruction). Branch `feat/106-stage-b-cutover-delete-legacy` carries 106-06/07/08/09.

## Self-Check: PASSED
- FOUND: analytics-service/tests/test_dark_path_deleted.py
- FOUND: .planning/phases/106-cutover-flip-delete-legacy-janitor/106-09-SUMMARY.md
- FOUND commit 08668fe9 (Task 1) / 9c778ecb (Task 2)
- `async def run_strategy_analytics` occurrences in analytics_runner.py: 0

---
*Phase: 106-cutover-flip-delete-legacy-janitor*
*Completed: 2026-07-15*
