---
phase: 84-blend-allocation-asset-class-annualization
plan: 01
subsystem: analytics
tags: [annualization, asset-class, blend, closed-sets, scenario-adapter, sharpe, "#597"]

# Dependency graph
requires:
  - phase: "#597 (single-strategy asset-class annualization, v0.39.0.0)"
    provides: "annualizationPeriods() / calendarYears() / isCryptoExchange() closed-set helpers; StrategyForBuilder.asset_class optional field on the scenario type"
provides:
  - "blendPeriodsPerYear(legs) — the ONE blend-rule mapping (√365 if ANY leg crypto, else √252)"
  - "asset_class populated on every adapter-built StrategyForBuilder unit (per-key 'crypto'; added from metadata lookup / null)"
affects: [84-02, 84-03, 84-04, 84-05, 84-06, 84-07, scenario-composer, allocator-portfolio, blend-KPIs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Blend basis single-sourced: blendPeriodsPerYear(legs) mirrors annualizationPeriods(assetClass) — every wave-2/3 blend KPI call site derives from this ONE helper, never a hand-rolled second rule"
    - "Structural param type ({ asset_class?: string | null }) keeps closed-sets.ts on its zod-only module-header contract (no scenario→closed-sets cycle)"
    - "Additive-optional metadata channel: widening the adapter's Pick<StrategyForBuilder, ...> lookup broke no caller because asset_class is optional (tsc-verified)"

key-files:
  created: []
  modified:
    - "src/lib/closed-sets.ts"
    - "src/lib/closed-sets.test.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-adapter.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts"

key-decisions:
  - "Exact-match 'crypto' only (no case/alias widening) — DB stores lowercase; pinned by the 'CRYPTO'→252 test (T-84-01 tampering mitigation)"
  - "Per-key units are 'crypto' unconditionally today (every SUPPORTED_EXCHANGE is a crypto venue, isCryptoExchange); commented to derive from the key's exchange when a non-crypto venue is ever added"
  - "Added units carry the metadata lookup's asset_class, null when the entry is absent (conservative — an unknown leg keeps the 252 blend default byte-identical)"

patterns-established:
  - "One closed-set registry maps a SET of legs → periods (blend), sibling to the SINGLE-value annualizationPeriods"
  - "Adapter units carry honest asset_class metadata; nothing reads it yet (zero behavior change) — wave-2/3 will thread blendPeriodsPerYear over the active units"

requirements-completed: [BLEND-01]

# Metrics
duration: ~8min
completed: 2026-07-10
---

# Phase 84 Plan 01: Blend-rule foundations (blendPeriodsPerYear + adapter asset_class) Summary

**Landed the two wave-1 foundations of the #597 blend rule: the single `blendPeriodsPerYear(legs)` closed-set helper (√365 if ANY constituent leg is crypto, else √252) and honest `asset_class` metadata on every scenario-adapter-built unit — zero behavior change, because nothing reads asset_class yet.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-10T01:15Z
- **Completed:** 2026-07-10T01:22Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4

## Accomplishments
- `blendPeriodsPerYear(legs: ReadonlyArray<{ asset_class?: string | null }>): number` exported from `src/lib/closed-sets.ts`, directly after `annualizationPeriods` — the ONE place mapping a set of legs → periods. All six locked-rule cases pinned (crypto+tradfi→365, pure-tradfi→252, empty→252, null/undefined/missing→252, one-crypto-flips-all→365, 'CRYPTO'→252 exact-match).
- `asset_class` populated on every adapter-built `StrategyForBuilder` unit: per-key units carry `"crypto"`; added units carry the metadata lookup's `asset_class` (or `null` when the entry is absent). The shared metadata-lookup `Pick` was widened additively at all three param positions plus its JSDoc.
- All 42 tests across both suites green; `tsc --noEmit` clean, proving the optional-field widening broke no existing caller literal (ScenarioComposer / ScenarioComparePanel / scenario-compare).

## Task Commits

Each task was committed atomically:

1. **Task 1: blendPeriodsPerYear helper in closed-sets.ts** - `b1647a1e` (feat, TDD RED→GREEN in one commit)
2. **Task 2: Populate asset_class on scenario-adapter units** - `7d763470` (feat, TDD RED→GREEN in one commit)

_Note: RED was verified failing for the right reason before GREEN in both tasks (Task 1: `blendPeriodsPerYear is not a function`; Task 2: `expected undefined to be 'crypto'`), then test + impl committed together per task._

## Files Created/Modified
- `src/lib/closed-sets.ts` - Added `blendPeriodsPerYear` in the "Asset-class annualization (#597)" section; JSDoc states the blend rationale and the 252 empty/unknown default. Only import remains zod (module-header contract intact).
- `src/lib/closed-sets.test.ts` - Import + six-case behavior pin for the locked blend rule.
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` - `asset_class: "crypto"` on the per-key literal; widened the shared metadata-lookup `Pick` (3 params + JSDoc) to include `asset_class`; `buildAddedUnits` unit + default-meta carry `asset_class` from the lookup / `null`.
- `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` - Four new pins (AC1–AC4): per-key 'crypto', added-from-lookup, absent→null, merge (per-key crypto + added lookup/null with weight-normalization byte-identical).

## Decisions Made
None beyond the plan — the blend rule and threading mechanism were LOCKED in 84-CONTEXT.md and followed exactly.

## Deviations from Plan

None - plan executed exactly as written. Only the four `files_modified` files were touched.

**Note on concurrent working-tree state:** during execution, files belonging to sibling plans (`scenario-benchmark.ts/.test.ts`, `portfolio-stats.ts`, `scenario-factsheet-payload.test.ts`) appeared as modified/committed in the shared branch by a parallel executor running plan 84-02. These are OUT OF SCOPE for 84-01; they were never staged, reverted, or otherwise touched by this plan. All per-task commits used explicit `git add <file>` of only the four plan files, so no cross-plan contamination occurred.

## Issues Encountered
None. Both TDD cycles went RED (for the correct reason) → GREEN cleanly.

## Verification

- `npx vitest run src/lib/closed-sets.test.ts "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts" --no-file-parallelism` → **2 files, 42 tests passed**
- `npx tsc --noEmit` → **clean**
- `npx eslint` on all four plan files → **clean (exit 0)**
- Acceptance greps: `blendPeriodsPerYear` export count = 1; closed-sets.ts imports = zod only; `asset_class: "crypto"` count = 1; widened `Pick` count = 3.
- `git status` after commits shows no 84-01 file uncommitted; only unrelated concurrent-agent files remain in the tree (untouched).

## Threat Model
- **T-84-01 (Tampering, blendPeriodsPerYear closed set) — mitigated:** exact-match `'crypto'` only, no case/alias widening; pinned by the `'CRYPTO'→252` test. No new trust boundary introduced (pure in-process math/type change).

## Next Phase Readiness
- Wave-2/3 call sites (`computeScenario` at ScenarioComposer / scenario-compare / share-resolve / queries / scenario.ts; `buildBlendPanels`; `sampleBasisRatios`; scenario-factsheet-payload; allocator reference panels) can now derive `blendPeriodsPerYear` over the active adapter units' `asset_class` and pass it to the engine's inert `periodsPerYear` param.
- No blockers. Default 252 stays byte-identical for any pure-tradfi / unknown blend, so wave-2 threading is safe to regression-pin against today's numbers.

## Self-Check: PASSED

All four plan files present; SUMMARY present; both task commits (`b1647a1e`, `7d763470`) found in git log.

---
*Phase: 84-blend-allocation-asset-class-annualization*
*Completed: 2026-07-10*
