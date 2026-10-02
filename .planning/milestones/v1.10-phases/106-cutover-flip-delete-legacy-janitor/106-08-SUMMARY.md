---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 08
subsystem: infra
tags: [analytics-worker, compute-jobs-queue, dark-path-retirement, python, fastapi]

# Dependency graph
requires:
  - phase: 106-06
    provides: enqueue_compute_job RPC guard rejecting retired kinds
  - phase: 106-07
    provides: all TS flag-off arms + legacyKeysSyncHandler deleted (re-entry #3 retired)
provides:
  - "All Python dark-path re-entry points to run_strategy_analytics retired (funding-flag epilogue + cron re-sync, HTTP /api/compute-analytics, dispatch arm + handler)"
  - "BROKER_DAILIES_VIA_FUNDING flag deleted; derive_broker_dailies is the unconditional sync follow-on"
  - "run_strategy_analytics has ZERO live callers (SC-2 precondition for 106-09 chain deletion)"
affects: [106-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zombie-order retirement: delete re-entry points BEFORE the core chain (106-09)"
    - "Unknown-kind permanent-FAILED dispatch arm covers stray retired-kind jobs (no per-kind cleanup needed)"

key-files:
  created: []
  modified:
    - services/job_worker.py
    - routers/cron.py
    - main.py
    - main_worker.py
    - models/schemas.py
    - services/analytics_runner.py
    - scripts/phase12_deploy.py

key-decisions:
  - "Cleaned stale flag/kind references in files outside the plan's file list (analytics_runner.py, test_cron_router.py, test_cash_basis_series_sc4.py) because the whole-tree grep gate demands zero references — Rule 3 blocking."
  - "Re-pointed incidental-kind worker tests (unknown-error, status-bridge, dispatch_tick-agnostic, ClaimedJob contract) from the retired compute_analytics to the live compute_analytics_from_csv kind rather than deleting them — they test kind-agnostic plumbing, not the retired handler."

patterns-established:
  - "Pattern: retire dark-path re-entries in the LOCKED zombie order (bulk enqueuer → both funding ternaries → flag constant → HTTP+dispatch) so no live site re-enqueues a retired kind mid-retirement."

requirements-completed: [BB-03]

# Metrics
duration: ~65min
completed: 2026-07-15
---

# Phase 106 Plan 08: Retire Python dark-path re-entries (D4) Summary

**All Python re-entry points to run_strategy_analytics retired in the locked zombie order — funding-flag sync epilogue + cron re-sync, the HTTP /api/compute-analytics route, and the dispatch arm/handler/timeout/watchdog — leaving run_strategy_analytics with zero live callers ahead of the 106-09 chain deletion.**

## Performance

- **Duration:** ~65 min (wall)
- **Started:** 2026-07-15T~08:50Z
- **Completed:** 2026-07-15T09:55Z
- **Tasks:** 2
- **Files modified:** 12 (+3 deleted)

## Accomplishments
- Deleted the unguarded bulk enqueuer `scripts/phase12_backfill_enqueue.py` and its deploy wiring in `phase12_deploy.py` (highest blast radius, retired first).
- Both funding ternaries retired to unconditional `derive_broker_dailies`: the `job_worker` sync epilogue AND the `cron.py` periodic re-sync (the 5th live site — a cron tick would otherwise re-enqueue after the epilogue was clean).
- Deleted the `BROKER_DAILIES_VIA_FUNDING` flag constant + rationale (zero readers remain); `derive_broker_dailies` is now unconditional.
- Deleted the HTTP re-entry `routers/analytics.py` + unregistered from `main.py` + dropped the orphaned `ComputeRequest` schema.
- Deleted the `run_compute_analytics_job` handler, its dispatch arm, its `TIMEOUT_PER_KIND` entry, and its `WATCHDOG_PER_KIND_OVERRIDES` entry. Unknown-kind permanent-FAILED arm (`Unknown job kind`) and the 106-06 RPC guard cover any stray rows.

## Task Commits

Each task was committed atomically:

1. **Task 1: Retire funding-flag + phase12 re-entries (D4 order 1-3)** - `5ac08900` (feat!)
2. **Task 2: Delete compute_analytics HTTP route + dispatch/handler/timeout/watchdog (D4 order 4)** - `58acddf4` (feat!)

## Files Created/Modified

**Deleted:**
- `analytics-service/scripts/phase12_backfill_enqueue.py` — unguarded bulk compute_analytics enqueuer
- `analytics-service/tests/test_phase12_backfill_enqueue.py` — its test
- `analytics-service/routers/analytics.py` — HTTP `/api/compute-analytics` re-entry #4

**Modified:**
- `analytics-service/services/job_worker.py` — flag constant, both-ternary→unconditional epilogue, handler, dispatch arm, TIMEOUT_PER_KIND entry, module docstring + swept comments
- `analytics-service/routers/cron.py` — periodic re-sync unconditional derive_broker_dailies + swept comments
- `analytics-service/main.py` — unregister analytics router (import + include_router)
- `analytics-service/main_worker.py` — watchdog override entry + header comments
- `analytics-service/models/schemas.py` — dropped orphaned `ComputeRequest`
- `analytics-service/services/analytics_runner.py` — swept flag/handler-naming comments (zero-callers note)
- `analytics-service/scripts/phase12_deploy.py` — dropped Step-4 backfill call, import, queue-depth monitor, docstring
- `analytics-service/tests/test_phase12_deploy.py` — backfill-step assertions removed
- `analytics-service/tests/test_job_worker.py` — flag-off + dispatch-routing cases pruned; incidental kinds re-pointed
- `analytics-service/tests/test_main_worker.py` — watchdog override assertion + incidental-kind cases re-pointed
- `analytics-service/tests/test_cron_router.py` — swept flag/kind comments
- `analytics-service/tests/test_cash_basis_series_sc4.py` — swept retired-handler comment

## SC-2 Evidence (caller grep — the precondition 106-09 builds on)

`git grep -n "run_strategy_analytics" -- services routers main.py main_worker.py scripts`:

```
services/analytics_runner.py:7:run_strategy_analytics now has zero live callers and the trades path is slated
services/analytics_runner.py:12:async def run_strategy_analytics(strategy_id: str) -> dict
services/analytics_runner.py:134:    `run_strategy_analytics` / `run_csv_strategy_analytics` PLUS lifted from
services/analytics_runner.py:1209:async def run_strategy_analytics(strategy_id: str) -> dict[str, Any]:
services/analytics_runner.py:2132:    Mirrors the structure of run_strategy_analytics but skips the
services/analytics_runner.py:2156:    # run_strategy_analytics:748-757; the response is unused beyond the
services/position_reconstruction.py:167:    annotation note in analytics_runner.run_strategy_analytics.
```

All remaining hits are the def itself + internal docstrings in `analytics_runner.py`, plus one docstring annotation in `position_reconstruction.py:167` (a comment, not a caller). BOTH prod callers — `routers/analytics.py:24` and `job_worker.py:1607` — are gone. SC-2 satisfied.

## Verify Gate Results

- **Task 1 gate:** `! git grep BROKER_DAILIES_VIA_FUNDING` (clean) && `! -f scripts/phase12_backfill_enqueue.py` && `pytest test_job_worker test_phase12_deploy test_phase35_backfill_enqueue` → **177 passed, 1 skipped**. PASS.
- **Task 2 gate:** `! grep '"compute_analytics"' services/job_worker.py main_worker.py routers/cron.py` (clean) && `! -f routers/analytics.py` && full `pytest -x` → **3720 passed, 93 skipped**. PASS.
- **Coverage:** full suite `--cov-fail-under=80` → **89.01%** (gate held).
- **mypy:** CI-gated surface (`services/ routers/ models/`) clean on all touched files.

## Threat Model Mitigations Confirmed
- **T-106-19** (zombie re-enqueue via cron re-sync): both ternaries deleted in the same task; grep-gate shows zero `BROKER_DAILIES_VIA_FUNDING`.
- **T-106-20** (stray job of deleted kind): unknown-kind permanent-FAILED arm at `job_worker.py` (`Unknown job kind`) verified NOT deleted; 106-06 RPC guard rejects new enqueues.
- **T-106-21** (funding regression): `derive_broker_dailies` was already the prod default (else-branch never taken), so deletion shifts no numbers.

## Decisions Made
- Kept `compute_analytics_from_csv` (live CSV kind — substring cousin), `trades_to_daily_returns_with_status`, `run_derive_broker_dailies_job`, and the unknown-kind FAILED dispatch arm, per the plan's KEEP list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cleaned stale flag/handler references in files outside the plan's per-task file list**
- **Found during:** Task 1 and Task 2
- **Issue:** Task 1's verify gate `! git grep BROKER_DAILIES_VIA_FUNDING -- .` greps the WHOLE tree. Stale comment references to the deleted flag lived in `services/analytics_runner.py` and `tests/test_cron_router.py`, which the plan's `<files>` list did not enumerate. Likewise, after deleting the handler/router in Task 2, stale comment references to `run_compute_analytics_job` / `routers/analytics.py::compute_analytics` remained in `services/analytics_runner.py` (module docstring) and `tests/test_cash_basis_series_sc4.py`.
- **Fix:** Updated those comments to reflect the retirement (no code behavior changed), so the whole-tree grep gate passes and no doc claims a legacy fallback exists.
- **Files modified:** services/analytics_runner.py, tests/test_cron_router.py, tests/test_cash_basis_series_sc4.py
- **Verification:** `git grep BROKER_DAILIES_VIA_FUNDING` returns empty; full suite green.
- **Committed in:** 5ac08900 (Task 1) and 58acddf4 (Task 2)

**2. [Rule 3 - Blocking] Re-pointed incidental-kind worker tests to the live `compute_analytics_from_csv` kind**
- **Found during:** Task 2
- **Issue:** Several tests used `compute_analytics` only as a sample strategy-scoped kind while patching the now-deleted `run_compute_analytics_job` (patch target gone → AttributeError) or asserting a now-retired kind. These test kind-agnostic plumbing (handler-raising classification, status-bridge, `dispatch_tick` forwarding, ClaimedJob contract), not the retired handler.
- **Fix:** Re-pointed each to the live `compute_analytics_from_csv` kind / `run_compute_analytics_from_csv_job` handler, preserving test intent. Deleted only the tests whose sole purpose was the retired path (`test_dispatch_routes_compute_analytics`, `test_sync_trades_enqueues_compute_analytics_when_flag_off`, the phase12 backfill-step tests).
- **Files modified:** tests/test_job_worker.py, tests/test_main_worker.py
- **Verification:** full `pytest -x` green; coverage 89.01% (gate held — dead-code tests deleted alongside dead code).
- **Committed in:** 58acddf4 (Task 2)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking).
**Impact on plan:** Both necessary to pass the plan's own whole-tree grep gates and keep the suite green. No scope creep — all changes are comment sweeps or test re-pointing forced by the deletions the plan mandates.

## Issues Encountered
- Local `python` unavailable outside the venv; used `analytics-service/.venv` for all pytest/mypy runs.
- Pre-existing ruff warnings (F821 `trunc`, unused imports) exist in untouched regions of `analytics_runner.py` and test files. Out of scope — the CI gate is mypy (`services/ routers/ models/`), not ruff, and the touched-file surface is mypy-clean.

## Next Phase Readiness
- **106-09** can now delete the `run_strategy_analytics` chain: SC-2 precondition (zero prod callers) is established and recorded above.
- No blockers. Ships in the single Stage-B PR.

## Self-Check: PASSED
- `routers/analytics.py` MISSING (intentionally deleted) ✓
- `scripts/phase12_backfill_enqueue.py` MISSING (intentionally deleted) ✓
- Commit `5ac08900` FOUND ✓
- Commit `58acddf4` FOUND ✓

---
*Phase: 106-cutover-flip-delete-legacy-janitor*
*Completed: 2026-07-15*
