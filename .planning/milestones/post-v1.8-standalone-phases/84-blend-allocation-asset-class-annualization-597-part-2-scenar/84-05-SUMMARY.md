---
phase: 84-blend-allocation-asset-class-annualization
plan: 05
subsystem: analytics
tags: [blend-annualization, asset-class, scenario-composer, periodsPerYear, blendPeriodsPerYear, peer-rank, lazy-returns-route]

# Dependency graph
requires:
  - phase: 84-01
    provides: "blendPeriodsPerYear(legs) helper; scenario-adapter Pick widened with asset_class (per-key units tagged 'crypto', added legs carry meta.asset_class)"
  - phase: 84-02
    provides: "ScenarioFactsheetChart + ScenarioBenchmarkSection optional periodsPerYear prop (default 252)"
  - phase: 84-03
    provides: "MyAllocationDashboardPayload strategies[].strategy.asset_class SSR channel"
provides:
  - "One derived blend basis (blendPeriodsPerYear over SELECTED engine-set legs) threaded to the FIVE composer KPI consumers: computeScenario, buildBlendPanels, own-book sampleBasisRatios leg, ScenarioFactsheetChart, ScenarioBenchmarkSection"
  - "asset_class on GET /api/strategies/[id]/returns (published-only) so drawer-added non-book legs get an honest class"
  - "Peer-rank raw-value fence (no √(252/365) rescale — #597 rejection encoded + grep-gated)"
affects: [blend-annualization, scenario-composer, peer-rank]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Caller-side blend basis: blendPeriodsPerYear over SELECTED legs only, passed as the engine's 4th periodsPerYear arg + into props-only hosts"
    - "Lazy metadata channel completion: a drawer-added non-book strategy's asset_class arrives via the widened lazy returns route (addedAssetClassById), purged on remove exactly like addedReturnsById"
    - "Peer-rank stays on RAW annualized engine output at the blend basis — NO frequency rescale (grep-gated to 0)"
    - "Engine-call spy extended to forward + capture the 4th periodsPerYear arg and per-leg asset_class (the harness for composer-level basis pins)"

key-files:
  created: []
  modified:
    - "src/app/api/strategies/[id]/returns/route.ts"
    - "src/app/api/strategies/[id]/returns/route.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Blend basis derived over SELECTED legs only (engineState.selected filter) — a toggled-off crypto leg cannot flip a tradfi blend to 365"
  - "addedStrategyMetadataLookup now emits an entry for EVERY added leg (book OR drawer), not just book strategies — book payload asset_class wins, else the lazily-fetched value, else null; disclosure_tier/cagr/sharpe stay byte-identical to the prior adapter default for non-book legs"
  - "Peer-rank body left textually untouched; only a raw-value contract comment added above peerSharpe. The peer-rank reads scenarioMetrics.* verbatim (now at the blend basis) with ZERO rescale — annualized Sharpe frequency-invariance means a √(252/365) correction would double-penalize 24/7 crypto sleeves ~17% (#597 rejection)"
  - "Own-book delta book leg annualized at the SAME blendBasis as the blend leg → the signed delta stays like-for-like in basis at 365 as well as 252"
  - "Task 3(a) 365 parity in scenario-sample-ratios.test.ts was already satisfied by prior-wave #597 crypto-basis cases (engine≡replica parity at 365) — no redundant test added (Rule 3 surgical)"

patterns-established:
  - "cagr excluded from every basis assertion (84-06 moves scenario.ts CAGR to the calendar clock this phase) — the composer pins assert sharpe/vol field-wise, never cagr"
  - "Composer-level basis pins observe the threaded periodsPerYear at the computeScenario call site via the engine-call spy, plus a non-vacuous end-to-end check (engine Sharpe == sampleBasisRatios at the same basis, and != the other basis)"

requirements-completed: [BLEND-01]

# Metrics
duration: ~35min
completed: 2026-07-10
---

# Phase 84 Plan 05: Scenario-composer blend-basis threading + lazy-route metadata Summary

**The primary composer surface now derives ONE blend basis (blendPeriodsPerYear over the selected engine-set legs — √365 if any is crypto, else √252) and threads it through all five KPI consumers, while the peer-rank stays on the engine's RAW annualized values with a grep-enforced no-rescale fence; drawer-added non-book strategies get their asset_class from the widened published-only lazy returns route.**

## Performance
- **Duration:** ~35 min
- **Completed:** 2026-07-10
- **Tasks:** 3 (all TDD — failing test written first, RED confirmed, then implementation)
- **Files modified:** 4 (2 source + 2 test)

## Accomplishments
- **Task 1 — metadata channel:** `GET /api/strategies/[id]/returns` probe widened to `.select("id, asset_class")`; `ReturnsResponse` carries `asset_class: string | null` (published-only, 404 existence-oracle + error redaction untouched). The composer gained `addedAssetClassById` state (written by `fetchAddedReturns` from the widened body, purged in `handleRemoveAdded`), and `addedStrategyMetadataLookup` now resolves an honest `asset_class` for every added leg — book (SSR payload, 84-03) or drawer (lazy fetch). The two adapter-call `Pick` casts widened to include `asset_class`.
- **Task 2 — five-point threading + peer fence:** a `blendBasis` `useMemo` (`blendPeriodsPerYear` over the SELECTED legs) threads into `computeScenario`, `buildBlendPanels`, the own-book `sampleBasisRatios` leg, and `periodsPerYear={blendBasis}` on both `ScenarioFactsheetChart` and `ScenarioBenchmarkSection`. The peer-rank body is byte-unchanged; one raw-value contract comment added above `peerSharpe`.
- **Task 3 — regression pins:** composer-level pins prove ≥1-crypto-leg → 365 (engine Sharpe matches `sampleBasisRatios` at 365, differs from 252) and all-unknown added-only → 252 byte-identity; the 365 sample↔engine parity is already CI-enforced by the prior-wave #597 cases. Added a route-level pin (R4c) that the widened probe forwards `asset_class`.

## Task Commits
1. **Task 1: lazy route widening + composer metadata lookup** — `22bce3c2` (feat, TDD)
2. **Task 2 + 3: blend basis memo + five-point threading + regression pins** — `6b6a4c3a` (feat, TDD)
3. **Route-level asset_class forwarding pin (R4c)** — `97283971` (test)

_Tasks 2 and 3 were combined into one green commit: the composer threading and the DSRC-03 oracle fix + the new blend pins are interleaved in the single ScenarioComposer.test.tsx, which `git add <file>` cannot cleanly split; committing composer.tsx alone would have left a transiently-red commit. See Deviation 2._

## Files Created/Modified
- `src/app/api/strategies/[id]/returns/route.ts` — probe `.select("id, asset_class")`; `ReturnsResponse.asset_class`; forward `strat.asset_class ?? null` on the 200 body (public classification comment; 404 oracle + redaction untouched).
- `src/app/api/strategies/[id]/returns/route.test.ts` — probe mock carries `asset_class`; new R4c pins the value forwards ('crypto' → value, null → null) via the same published-gated `select("id, asset_class")`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `blendPeriodsPerYear` import; `addedAssetClassById` state + write + purge; `addedStrategyMetadataLookup` emits an entry for every added leg with `asset_class`; two widened `Pick` casts; `blendBasis` memo; threading at all five consumption points; peer-rank raw-value fence comment.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — engine-call spy forwards + captures the 4th `periodsPerYear` arg and per-leg `asset_class`; `latestAssetClassLookup` / `latestPeriodsPerYear` / `lastKpiScenarioMetrics` readers; T_C_ASSETCLASS (+ purge) Task-1 pins; the DSRC-03 recompute oracle mirrors the composer's derived basis instead of hardcoding 252; the BLEND-01 365/252 composer pins.

## Decisions Made
- **Selected-only basis:** `blendBasis = blendPeriodsPerYear(engineSet.strategies.filter(s => engineState.selected[s.id]))` — an unselected crypto leg does not flip a tradfi blend.
- **Metadata lookup for every added leg:** the prior `if (found)` guard emitted entries only for book strategies, so a non-book leg's lazily-fetched `asset_class` could never reach the basis. The lookup now always emits an entry (`found?.strategy.* ?? …`), keeping disclosure_tier/cagr/sharpe byte-identical to the adapter's prior default-meta for non-book legs while letting `asset_class` flow.
- **Peer-rank raw, no rescale:** `peerSharpe/peerSortino/peerMaxDD` remain `scenarioMetrics.*` verbatim (raw engine output at the blend basis). NO √(252/365) or (365/252) factor exists anywhere — grep-gated to 0. This is the ONE change #597 explicitly rejected (it double-penalizes 24/7 crypto sleeves ~17%).
- **cagr never asserted:** 84-06 converts scenario.ts's CAGR to the calendar clock this same phase; the new composer pins assert sharpe/vol field-wise and never touch cagr.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test correctness] DSRC-03 recompute oracle re-based onto the composer's derived blend basis (was hardcoded 252)**
- **Found during:** Task 2 (full composer suite after threading)
- **Issue:** The two Phase-37 DSRC-03 honesty oracles call `independentRecompute()`, which ran the REAL engine at the DEFAULT 252 while the composer now correctly threads 365 (per-key legs are `asset_class:'crypto'`). The oracle expected the √252 Sharpe (−0.745 / 50.883); the composer produced the √365 value (−0.897 / 61.238) → two reds.
- **Fix:** `independentRecompute` now derives `blendPeriodsPerYear` over the included legs — exactly mirroring the composer — and passes it as the 4th `computeScenario` arg. Root-cause (Rule 6): the oracle must mirror the composer's basis, not hardcode a stale default.
- **Files modified:** `ScenarioComposer.test.tsx` (oracle only)
- **Verification:** all 183 composer + sample-ratios tests green.
- **Committed in:** `6b6a4c3a`

**2. [Rule 3 - Commit granularity] Tasks 2 and 3 committed together (green) rather than as two commits**
- **Found during:** commit staging
- **Issue:** Task 2's threading (ScenarioComposer.tsx) breaks the DSRC-03 oracle, whose fix and the new Task-3 blend pins both live in the single ScenarioComposer.test.tsx. `git add <file>` stages the whole file — committing composer.tsx alone would leave a transiently-red commit (against the green-per-task principle), and `git add -p`/stash are unavailable/prohibited here.
- **Fix:** One atomic green commit for the threading + oracle fix + regression pins. No scope change; every acceptance criterion for both tasks is met in that commit.
- **Committed in:** `6b6a4c3a`

**3. [Rule 3 - Surgical / no redundancy] Task 3(a) 365 parity NOT re-added — already CI-enforced**
- **Found during:** Task 3 (reading scenario-sample-ratios.test.ts)
- **Issue:** The plan lists scenario-sample-ratios.test.ts in files_modified for a 365 parity case. That file already contains the exact guarantee (a prior #597 wave added `singleStrategyScenario(dates, 365)` vs `sampleBasisRatios(RETS, 365)` byte-equality + a non-vacuous 365≠252 assertion) — 12 passing tests.
- **Fix:** Left the file untouched (adding a duplicate would violate simplicity/surgical rules); documented that the acceptance ("a case invoking both functions at 365 and passes") is met by the existing coverage.
- **Files modified:** none
- **Verification:** `scenario-sample-ratios.test.ts` → 12 passed.

**4. [Rule 9 - Tests verify intent] Added route-level R4c pin for the asset_class forwarding**
- **Found during:** Task 1 verification
- **Issue:** The route body's `asset_class` was compile-pinned (ReturnsResponse) but no runtime test proved the VALUE flows from the DB probe row (the composer test mocks the route entirely).
- **Fix:** Extended the route mock to carry `asset_class` and added R4c asserting the 200 body forwards it ('crypto' → value, null → null) via the same published-gated `select("id, asset_class")`.
- **Files modified:** `route.test.ts`
- **Committed in:** `97283971`

---
**Total deviations:** 4 (1 oracle re-base, 1 commit-granularity, 1 no-redundancy, 1 test-hardening). No scope creep; the security contract is fully preserved (published-only probe, 404 oracle, error redaction untouched).

## Verification Evidence

```
# Plan verification block (all three files)
npx vitest run src/lib/scenario-sample-ratios.test.ts \
  "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" \
  "src/app/api/strategies/[id]/returns/route.test.ts" --no-file-parallelism
  Test Files  3 passed (3)   Tests  195 passed (195)

npx tsc --noEmit            -> clean (0 errors)
npm run lint                -> 0 errors (1 pre-existing warning in EquityChart.tsx, not a touched file)

# PEER-RANK NO-RESCALE GATE (the load-bearing constraint)
grep -c "252 / 365\|365 / 252" ScenarioComposer.tsx                       -> 0
git diff HEAD~2 -- ScenarioComposer.tsx | grep -E "^[-+].*peer(Sharpe|Sortino|MaxDD) =" -> (empty; peer lines textually unchanged)

# Task acceptance greps
grep -c '"id, asset_class"' route.ts                                       -> 1
grep -c "addedAssetClassById" ScenarioComposer.tsx                         -> 3 (>=3)
grep -c "blendBasis" ScenarioComposer.tsx                                  -> 13 (>=6)
grep -c "computeScenario(engineSet.strategies, engineState, dateMapCache, blendBasis)" -> 1
grep -c "sampleBasisRatios(bookReturns, blendBasis)" ScenarioComposer.tsx  -> 1
grep -c "buildBlendPanels(portfolioDaily, rollingWindow, blendBasis)"      -> 1
grep -c "periodsPerYear={blendBasis}" ScenarioComposer.tsx                 -> 2
```

## Threat Flags
None beyond the plan's threat model. T-84-05a (returns-route widening) accepted as designed: `asset_class` is public factsheet classification, sourced from the SAME published-only probe, with the 404 existence-oracle and error redaction untouched (pinned by R4c + the unchanged R3/R6/R8 route tests). T-84-05b (peer-rank basis) mitigated: raw-value fence + no-rescale grep gate (0) + textually-unchanged peer body.

## Next Phase Readiness
- The composer — the primary blend surface of the phase — rides one derived basis across KPIs, panels, own-book delta, factsheet preview, and benchmark; peer-rank proven raw.
- 84-06 (parallel, same phase) converts scenario.ts's CAGR to the calendar clock; every new pin here strips/omits cagr, so they stay green when that lands.

## Self-Check: PASSED
- All 4 modified files present on disk (2 source + 2 test).
- All three task commits present in git history: `22bce3c2`, `6b6a4c3a`, `97283971`.
- SUMMARY created at the plan's `<output>` path.
- No-rescale grep gate = 0; 195/195 tests green; tsc + lint clean.

---
*Phase: 84-blend-allocation-asset-class-annualization*
*Completed: 2026-07-10*
