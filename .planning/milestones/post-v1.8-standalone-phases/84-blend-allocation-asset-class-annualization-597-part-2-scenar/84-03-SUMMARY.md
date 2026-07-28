---
phase: 84-blend-allocation-asset-class-annualization
plan: 03
subsystem: analytics
tags: [annualization, asset-class, blend, sharpe, allocator, factsheet, closed-sets, "#597"]

# Dependency graph
requires:
  - phase: 84-01
    provides: "src/lib/closed-sets.ts — blendPeriodsPerYear(legs) + annualizationPeriods(assetClass)"
  - phase: 84-02
    provides: "src/lib/portfolio-stats.ts — computeAlphaBeta(returns, benchmark, periodsPerYear = 252)"
provides:
  - "Live-baseline (queries.ts liveBaselineMetricsFromPerKeyDailies) Sharpe annualizes on the blend rule → √365 for the all-crypto per-key book"
  - "MyAllocationDashboardPayload strategies[].strategy.asset_class SSR channel (the wave-3 composer blend-basis lookup source)"
  - "Allocator portfolio factsheet (buildAllocatorPortfolioFactsheetPayload) risk metrics ride √365; CAGR calendar-invariant"
  - "AlphaBetaDecomposition live-book alpha annualizes ×365"
  - "buildAllocatorMetrics(rets, mmRets, periodsPerYear = 252) — reference panels follow the leg-decided split (60/40 √252 byte-identical, BTC-legged √365)"
affects: [84-04-scenario-composer, 84-06-cagr-calendar-clock, wave-3-composer-lookup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Actual-allocation KPI surfaces derive their annualization basis from the closed-set registry (blendPeriodsPerYear / annualizationPeriods) rather than a hardcoded 252"
    - "Frequency clock (√periodsPerYear) threads through risk metrics; CAGR stays on the calendar clock (days/365.25) and is proven basis-invariant"

key-files:
  created:
    - "src/lib/factsheet/allocator.test.ts"
  modified:
    - "src/lib/queries.ts"
    - "src/lib/queries.my-allocation.test.ts"
    - "src/lib/factsheet/allocator-portfolio-payload.ts"
    - "src/lib/factsheet/allocator-portfolio-payload.test.ts"
    - "src/lib/factsheet/allocator.ts"
    - "src/lib/factsheet/build-payload.ts"
    - "src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx"

key-decisions:
  - "Live per-key book: every leg carries asset_class 'crypto' (id === api_key_id, every SUPPORTED_EXCHANGE is a crypto venue) → blendPeriodsPerYear → √365"
  - "60/40 reference panel call left TEXTUALLY UNCHANGED (default 252) — the locked byte-identity case; BTC-legged panels pass annualizationPeriods('crypto')"
  - "CAGR never threaded/pinned — it is the calendar clock, and 84-06 reworks liveBaseline's CAGR span this same phase"

patterns-established:
  - "Basis moves ONLY the frequency-annualized risk metric (Sharpe/vol/alpha); twr/maxDd/avgRho/cum_ret/corr/tails pinned byte-invariant across bases"
  - "365 basis is expressed via annualizationPeriods('crypto') for greppability, never a bare 365 literal"

requirements-completed: [BLEND-02]

# Metrics
duration: ~35min
completed: 2026-07-10
---

# Phase 84 Plan 03: Actual-allocation asset-class annualization Summary

**The live allocation/portfolio KPI surfaces (per-key live-baseline Sharpe, allocator portfolio factsheet, attribution alpha, and the BTC-legged reference panels) now annualize on √365 via the closed-set registry, while the 60/40 pure-tradfi panel stays byte-identical at √252 and the asset_class SSR channel opens for the wave-3 composer.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T01:31Z
- **Completed:** 2026-07-10T01:43Z
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 8 (1 created)

## Accomplishments
- `liveBaselineMetricsFromPerKeyDailies` threads `blendPeriodsPerYear(strategies)` into `computeScenario`; per-key units carry `asset_class "crypto"` → the actual-allocation baseline Sharpe rides √365, with twr/maxDd/avgRho/equity proven basis-invariant.
- `MyAllocationDashboardPayload.strategies[].strategy.asset_class` added to the type AND the `getMyAllocationDashboard` SSR select — the channel the wave-3 composer's `addedStrategyMetadataLookup` blend-basis derivation consumes.
- Allocator portfolio factsheet + attribution alpha ride the crypto basis via the registry; CAGR proven byte-identical (calendar clock).
- `buildAllocatorMetrics` parameterized (`periodsPerYear = 252`); reference panels follow the leg-decided ruling — 60/40 unchanged √252, all-weather + BTC/ETH √365.

## Task Commits

Each task committed atomically (TDD: failing test confirmed RED, then implementation):

1. **Task 1: queries.ts — asset_class payload channel + live-baseline blend basis** — `496e3ae4` (feat)
2. **Task 2: Attribution widget + allocator portfolio factsheet basis** — `17e662f1` (feat)
3. **Task 3: allocator.ts reference panels — per-blend basis** — `febee7f8` (feat)

## Files Created/Modified
- `src/lib/queries.ts` — payload type + SSR select widened with `asset_class`; per-key units carry `asset_class "crypto"`; live-baseline `computeScenario` gets `blendPeriodsPerYear(strategies)`.
- `src/lib/queries.my-allocation.test.ts` — added the BLEND-02 pin (Sharpe moved to 365 via engine-exact reference; twr/maxDd/avgRho invariant).
- `src/lib/factsheet/allocator-portfolio-payload.ts` — `assetClass: "crypto"` on the portfolio metadata literal.
- `src/lib/factsheet/allocator-portfolio-payload.test.ts` — pins risk metrics on 365 basis, CAGR byte-identical.
- `src/lib/factsheet/allocator.ts` — `buildAllocatorMetrics(rets, mmRets, periodsPerYear = 252)`; both `Math.sqrt(252)` → `Math.sqrt(periodsPerYear)`.
- `src/lib/factsheet/build-payload.ts` — reference panels: 60/40 unchanged; multi_asset + crypto_book pass `annualizationPeriods("crypto")`.
- `src/lib/factsheet/allocator.test.ts` (new) — default-identity deep-equal, √365 vol scaling, basis-invariance.
- `src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx` — `computeAlphaBeta(…, annualizationPeriods("crypto"))`.

## Decisions Made
- Sharpe scaling is NOT an exact ULP identity where the engine annualizes mean-return and vol on slightly different clocks (scenario.ts): the load-bearing pin is the engine-exact `=== cm365.sharpe`, with the √(365/252) magnitude asserted at precision 3. In compute.ts (allocator portfolio) the scaling is pure `s×√N`, so precision 6 holds.
- The allocator.ts sleeve grid-scan test uses a deliberately sub-target (low-vol) fixture so the grid argmin is scale-stable — letting the test pin `sleeve_pct` identical and `blend_vol` scaling honestly, without a general invariance claim (the plan flags sleeve_pct as legitimately shift-prone near target).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Test placement] Extended existing queries test file instead of adding a new one**
- **Found during:** Task 1
- **Issue:** files_modified lists `queries.ts` only; the plan action permitted adding/extending a test and flagging a new file as a deviation.
- **Fix:** Extended the existing dedicated helper test file `src/lib/queries.my-allocation.test.ts` (which already tests `liveBaselineMetricsFromPerKeyDailies`) rather than creating a new file — smaller surface, no new fixture scaffolding. It is the `head -1` match of the plan's verify grep.
- **Files modified:** src/lib/queries.my-allocation.test.ts
- **Verification:** `npx vitest run src/lib/queries.my-allocation.test.ts` → 60 passed.
- **Committed in:** 496e3ae4 (Task 1 commit)

---

**Total deviations:** 1 (test placement — a file outside files_modified, explicitly anticipated by the plan's Task 1 action text).
**Impact on plan:** None on scope or behavior. All three tasks implemented exactly as specified.

## Issues Encountered
- **Transient whole-project tsc failures from the parallel 84-04 executor.** `npx tsc --noEmit` intermittently reported errors in `scenario-compare.test.ts` / `scenario-compare.ts` (undefined `RATIO`, a Pick type missing `asset_class`) — the sibling wave-2 executor (plan 84-04) editing OTHER files on this shared branch, caught mid-write. These are out of my scope (not in my files_modified); each cleared once 84-04 finished the edit. My files are tsc-clean and eslint-clean in isolation. I never staged or touched any 84-04 file.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Wave 3 (composer lookup):** the `strategies[].strategy.asset_class` SSR channel is live and typed — the composer's `addedStrategyMetadataLookup` can now derive the blend basis from real classification data.
- **84-06 (CAGR calendar clock):** liveBaseline flows through `computeScenario`; I deliberately did NOT pin `cagr` in any test, so 84-06's CAGR span conversion will not go RED against this plan's pins.
- **Verification:** `npx vitest run src/lib/factsheet/allocator.test.ts src/lib/factsheet/allocator-portfolio-payload.test.ts` → 16 passed; `src/lib/queries.my-allocation.test.ts` → 60 passed; `npx tsc --noEmit` clean; eslint clean on all 8 changed files.

## Self-Check: PASSED

- Created files verified on disk: `src/lib/factsheet/allocator.test.ts`, `84-03-SUMMARY.md`.
- Commits verified in git log: `496e3ae4`, `17e662f1`, `febee7f8`.
- Shared-ledger note: STATE.md / ROADMAP.md not mutated by this executor — a parallel wave-2 executor (84-04) is live on the same branch; the orchestrator reconciles wave-level state to avoid a double advance-plan race.

---
*Phase: 84-blend-allocation-asset-class-annualization*
*Completed: 2026-07-10*
