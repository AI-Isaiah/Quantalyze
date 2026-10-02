---
phase: 36-repoint-stats-reads
plan: 03
subsystem: api
tags: [scenario, computeScenario, csv_daily_returns, allocator-overview, supabase, vitest, rls]

# Dependency graph
requires:
  - phase: 36-01
    provides: csv_daily_returns per-key axis (id/api_key_id/allocator_id columns + nullable strategy_id) in database.types.ts + the migration + owner RLS
  - phase: 35
    provides: dual-mode derive_broker_dailies job that writes per-key (api_key_id, date, daily_return) rows; phase35_backfill_enqueue
provides:
  - Overview equity-curve + KPIs repointed onto a per-api_key_id blend of csv_daily_returns through the frozen computeScenario engine
  - liveBaselineMetricsFromPerKeyDailies (per-key blend) + allActiveKeysHavePerKeyDailies (D3 all-or-nothing gate) + buildPerKeyReturnsByApiKeyId (grouping)
  - all-or-nothing fallback to the existing snapshot reconstruction (never a mixed annualization basis)
affects: [37-composer-per-source-toggle, 38-composer-factsheet-parity, phase36-operational-backfill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling-selector seam: a new liveBaselineMetricsFromPerKeyDailies mirrors liveBaselineMetricsFromHoldings byte-identically, selected by a pure D3 gate at one seam, reused in both return branches — fallback stays the original function untouched"
    - "Date-window-bounded per-key fetch (.gte('date', <730d ago>) + flat .limit(20000) ceiling) instead of a bare ascending .limit() that would silently drop the newest rows across K keys"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts

key-decisions:
  - "Implemented the seam as a sibling liveBaselineMetricsFromPerKeyDailies (planner's-discretion option) so liveBaselineMetricsFromHoldings stays the byte-identical fallback and the output contract is provably unchanged"
  - "D3 predicate = presence of >=1 per-key row per active key (apiKeys.filter is_active); empty active set also returns false (no per-key blend without active keys)"
  - "Bounded the per-key fetch by a 730-day date window, not a bare ascending limit, because a per-key series spans K keys and an ascending .limit(730) would truncate the newest ~730/K days and corrupt the curve"
  - "No de-alias collapse in the per-key path: per-key strategies are already one-per-key (no symbol-keyed alias), but avgRho is still sourced from computeScenario.avg_pairwise_correlation so the contract field is populated"

patterns-established:
  - "Pattern 1: compute liveBaselineMetrics ONCE at the gate seam and reuse the single value in both the !portfolio and portfolio return branches (replacing two inline calls)"
  - "Pattern 2: falsifiable honesty tests — the divergence fixture makes per-key != snapshot, and the mixed-population test asserts the FALLBACK is taken (NOT the per-key-only blend), so a per-key-partial gate or a revert each fail a named test"

requirements-completed: [UNIFY-01, UNIFY-02, UNIFY-03]

# Metrics
duration: 18min
completed: 2026-06-25
---

# Phase 36 Plan 03: Repoint Overview stats onto per-key csv_daily_returns Summary

**Allocator Overview equity-curve + KPIs (Sharpe / returns / vol / max-DD / avg-ρ) now derive from a per-`api_key_id` blend of `csv_daily_returns` through the frozen `computeScenario` engine, behind an all-or-nothing D3 gate that falls back to the existing snapshot reconstruction whenever any active key lacks a per-key series — AUM stays from holdings and the holdings read is provably untouched.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-25T07:05:00Z
- **Completed:** 2026-06-25T07:14:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 3

## Accomplishments
- Added a per-key `csv_daily_returns` fetch to `getMyAllocationDashboard`'s Step-1 fan-out (user client + owner RLS, `.eq("allocator_id", userId)`, `.gte("date", <730d ago>)` date-window bound, `.limit(20000)` flat safety ceiling).
- Added `liveBaselineMetricsFromPerKeyDailies` — one `StrategyForBuilder` per `api_key_id` (daily_returns = that key's series, weight = Σ `holdingEquityContribution` over holdings carrying that key) → same `computeScenario` → same wealth-conversion → same `deriveSnapshotDrawdowns` → same empty-default as the holdings path, so the `liveBaselineMetrics` shape is byte-identical.
- Added the D3 all-or-nothing predicate `allActiveKeysHavePerKeyDailies` (+ `buildPerKeyReturnsByApiKeyId` grouping) and wired the seam to compute `liveBaselineMetrics` ONCE — per-key blend when every active key has dailies, else the snapshot reconstruction — reused in both the `!portfolio` and portfolio return branches.
- AUM stays summed from holdings on both branches (D2); `liveBaselineMetricsFromHoldings`, `reconstructHoldingReturnsByScopeRef`, `derivePhase07Fields`, the `allocator_holdings` fetch, and `computeScenario` are unchanged (UNIFY-03).
- Pinned all of it with falsifiable tests: per-key-vs-fallback divergence, fallback-branch regression, mixed-population honesty guard, AUM-unchanged, the D3 predicate / grouping units, and shape-identity between branches.

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-key fetch + per-key blend + D3 all-or-nothing gate** - `e69970af` (feat)
2. **Task 2: Per-key / fallback / mixed-population / shape-identity tests** - `586998ac` (test)

_Note: This plan's two tasks are both `tdd="true"`. The implementation (Task 1) landed as a single `feat` commit and the falsifiable coverage (Task 2) as a single `test` commit; the test infrastructure (mock arm + `.gte` filter op) needed to exist for the existing suite to run against the new fetch, so it shipped with the test commit._

## Files Created/Modified
- `src/lib/queries.ts` - per-key fetch in the fan-out; `liveBaselineMetricsFromPerKeyDailies` + `allActiveKeysHavePerKeyDailies` + `buildPerKeyReturnsByApiKeyId`; the D3 seam computing `liveBaselineMetrics` once; both return branches now reference the single value.
- `src/lib/queries.my-allocation.test.ts` - `csvDailyReturns` mock state + `case "csv_daily_returns"` rowsFor arm + `.gte` date-window filter op; the per-key / fallback / mixed-population / AUM tests; D3-predicate + grouping unit tests.
- `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` - import of the two exported helpers; the shape-identity describe block (non-empty curves + empty-default), asserting identical key sets + value types + AUM=Σholdings on both branches.

## Decisions Made
- **Sibling selector over an inner helper:** kept `liveBaselineMetricsFromHoldings` byte-identical as the fallback; the per-key path is a separate function selected by a pure gate. This is the smallest diff that proves the output contract is unchanged.
- **Date-window bound, not ascending `.limit(730)`:** a per-key series spans K keys; an ascending row-count limit would silently drop the newest rows. `.gte("date", <730d ago>)` keeps each key's full window; `.limit(20000)` is a flat ceiling (≈27 keys × 730d) for the DoS bound (T-36-03-03).
- **`computeScenario` n>=10 floor:** the engine returns an empty curve below 10 common dates; test fixtures were sized to 13 snapshots / 12+ per-key rows so both branches produce real curves (see Issues).

## Deviations from Plan

None - plan executed exactly as written. The two-task TDD structure produced one `feat` + one `test` commit (no separate RED commit, since the implementation and its falsifiable coverage are tightly coupled at the same seam and the existing suite served as the regression guard during implementation). All deviation rules (1-4) were inapplicable — no bugs, missing functionality, blockers, or architectural changes were encountered.

## Issues Encountered
- **Empty curve on first test run:** the initial Phase-36 test fixtures used 8 snapshots / 8 per-key rows, but `computeScenario` returns an empty `equity_curve` below `n >= 10` common dates (an existing engine floor, scenario.ts:210). Resolved by sizing the fixtures to 13 snapshots (→ 12 reconstructed returns) and 12+ per-key rows so both the per-key blend and the snapshot fallback produce real, divergent curves — making the divergence and honesty assertions meaningful rather than trivially-equal-empty. No production code changed; this was a test-fixture sizing fix.

## User Setup Required
None - no external service configuration required for the code. Per the plan's D6 operational note, the per-key blend only SHOWS once per-key rows exist in prod: after 36-01/02/03 ship + deploy, run `railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"` (service-role) and wait for the worker to drain. That backfill already exists from Phase 35 and is out of scope for this plan.

## Next Phase Readiness
- Overview stats are repointed and gated; the `liveBaselineMetrics` contract is unchanged, so Phase 37 (composer per-source toggle / per-`api_key` adapter re-key) and Phase 38 (composer factsheet-parity chart) inherit a stable SSR baseline.
- No blockers. The per-key basis is dormant until the post-deploy backfill populates `csv_daily_returns`; allocators with a non-derivable key (MT5/IBKR) correctly stay on the snapshot basis (D3) — honest, not a regression.

---
*Phase: 36-repoint-stats-reads*
*Completed: 2026-06-25*

## Self-Check: PASSED

- FOUND: `.planning/phases/36-repoint-stats-reads/36-03-SUMMARY.md`
- FOUND: `src/lib/queries.ts`
- FOUND: `src/lib/queries.my-allocation.test.ts`
- FOUND: `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts`
- FOUND commit: `e69970af` (feat — Task 1)
- FOUND commit: `586998ac` (test — Task 2)
- Verification: `npx tsc --noEmit` exits 0; `npx eslint src/lib/queries.ts` clean; `npx vitest run src/lib/queries.my-allocation.test.ts src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` → 73 passed.
