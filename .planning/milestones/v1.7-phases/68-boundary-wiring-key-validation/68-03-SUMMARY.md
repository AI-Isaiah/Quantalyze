---
phase: 68-boundary-wiring-key-validation
plan: 03
subsystem: testing
tags: [deribit, parity-contract, zod, pydantic, sql-check, boundary, byte-pin]

# Dependency graph
requires:
  - phase: 68-boundary-wiring-key-validation
    provides: "68-01 widened SUPPORTED_EXCHANGES + FUNDING_EXCHANGES const, three widened pydantic Literals, and the 20260704200446 boundary-CHECK migration whose named constraints the parity test resolves"
provides:
  - "Vitest contract matrix proving TS↔SQL set-equality (incl. deribit) on api_keys/compute_jobs/strategy_verifications key boundaries"
  - "Vitest rejects:['deribit'] pins on funding_fees + position_snapshots (EXCLUDE direction)"
  - "Pytest Literal-inclusion pins (get_args) on all three pydantic Literals + four widened SQL constraint names"
  - "Pytest exclusion pins on SUPPORTED_SOURCES, process_key flow sets, _FUNDING_BUCKET_HOURS, funding CHECK migration — each Phase-70/71 commented"
affects: [70-ingestion-funding, 71-positions, 72-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Both-directions boundary parity: CONTAIN (set-equality on widened boundaries) + EXCLUDE (rejects/absence pins) in the SAME PR as the wiring"
    - "Phase-named exclusion pins so a future flip must consciously edit a failing test — drift is structurally impossible"

key-files:
  created:
    - analytics-service/tests/test_boundary_literals_parity.py
  modified:
    - src/__tests__/contracts/check-zod-db-check-parity.test.ts
    - analytics-service/tests/test_funding_match_key_sql_parity.py

key-decisions:
  - "position_snapshots.exchange spec pins an explicit 3-value literal (NOT FUNDING_EXCHANGES) — semantically distinct surface that happens to share the 3 codes"
  - "strategy_verifications.source ts = [...SUPPORTED_EXCHANGES, 'csv'] (live verify write path admits csv; frozen verification_requests_legacy deliberately uncovered)"
  - "process_key per-flow allow-sets pinned via source-text read (method-local dict literal, not importable)"

requirements-completed: [DRB-02]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 68 Plan 03: DRB-02 Parity Contract Test (both runtimes, both directions) Summary

**The deribit key-save allowlist (TS ↔ pydantic ↔ SQL CHECK) is now pinned set-equal on every widened boundary, while the funding / ingestion-registry / position surfaces are pinned to EXCLUDE deribit with Phase-70/71 flip comments — boundary drift (TS admits what the DB rejects → 23514) is now structurally impossible, and both directions land in the same PR as the wiring (roadmap SC1).**

## Performance
- **Duration:** ~12 min
- **Tasks:** 2
- **Files:** 3 (1 created, 2 modified)

## Accomplishments
- Extended the vitest B9 parity matrix: added `api_keys.exchange`, `strategy_verifications.source` (ts: SUPPORTED_EXCHANGES + `csv`), and `position_snapshots.exchange` specs; decoupled the `funding_fees.exchange` spec from `SUPPORTED_EXCHANGES` to `FUNDING_EXCHANGES` + `rejects: ["deribit"]`; pinned `position_snapshots.exchange` with `rejects: ["deribit"]`; updated the `EXPECTED_COLUMNS` identity guard.
- New `test_boundary_literals_parity.py`: `typing.get_args` inclusion pins on all three pydantic Literals + a set-equality drift guard on `VerifyStrategyRequest.exchange`; migration-text pins asserting the four canonical `ADD CONSTRAINT` names each appear once and admit `'deribit'`; exclusion pins on `SUPPORTED_SOURCES` and the `process_key` per-flow sets.
- Extended `test_funding_match_key_sql_parity.py` with the BYB-02 exclusion half: `_FUNDING_BUCKET_HOURS` has no deribit key, and the 3-exchange funding CHECK migration text carries no `'deribit'`.
- Both mutation checks performed and reverted (below).

## Task Commits
1. **Task 1: Extend vitest contract matrix** — `b1008ccb` (test)
2. **Task 2: Pytest Literal + exclusion parity** — `3f85418a` (test)

## Files Created/Modified
- `src/__tests__/contracts/check-zod-db-check-parity.test.ts` — imported `FUNDING_EXCHANGES`; decoupled funding spec; added 3 boundary specs; updated `EXPECTED_COLUMNS`.
- `analytics-service/tests/test_boundary_literals_parity.py` (NEW) — pydantic Literal inclusion/set-equality + SQL widen pins + ingestion exclusion pins.
- `analytics-service/tests/test_funding_match_key_sql_parity.py` — added `TestFundingExcludesDeribit` (`_FUNDING_BUCKET_HOURS` + funding CHECK migration).

## Verification
- `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts --no-file-parallelism` → **19 passed** (was 15 specs + identity = 16; now 18 specs + identity = 19). The whole suite is GREEN — the 68-01 expected-RED funding_fees case is resolved.
- `cd analytics-service && .venv/bin/python -m pytest tests/test_boundary_literals_parity.py tests/test_funding_match_key_sql_parity.py -q` → **13 passed** (no segfault; these files are I/O-free / no pandas construction).
- `npx tsc --noEmit` → exit 0. `npm run lint` → 0 errors (1 pre-existing warning in `EquityChart.tsx`, out of scope).
- `mypy --strict` on both touched `.py` files → Success, no issues.
- **Mutation check 1 (vitest):** removing `'deribit'` from the `api_keys` named `ADD CONSTRAINT` IN-list made the suite FAIL (`api_keys.exchange` onlyInTs=['deribit']) — proves the spec resolves the new named constraint, not the stale inline CREATE. Reverted; migration byte-identical.
- **Mutation check 2 (pytest):** adding `"deribit": 1` to `_FUNDING_BUCKET_HOURS` made `test_funding_bucket_hours_excludes_deribit` FAIL. Reverted; `funding_fetch.py` byte-identical.

## Deviations from Plan
None — plan executed as written. The Source Literal set-equality was pinned as membership-only (Source also carries `csv`), consistent with the plan's inclusion-pin intent. REGISTRY.md was inspected; its lone B8 row references `SUPPORTED_EXCHANGES` generically and does not enumerate per-column parity coverage, so no update was required (Task 1 read_first "update if it indexes covered columns" — it does not).

## Known Stubs
None.

## Threat Flags
None — pure test files, zero new packages, no new network/auth/schema surface (T-68-SC accept: zero installs).

## Self-Check: PASSED
- `src/__tests__/contracts/check-zod-db-check-parity.test.ts` exists; `analytics-service/tests/test_boundary_literals_parity.py` exists; `analytics-service/tests/test_funding_match_key_sql_parity.py` exists.
- Commits `b1008ccb` and `3f85418a` present in git history.

---
*Phase: 68-boundary-wiring-key-validation*
*Completed: 2026-07-04*
