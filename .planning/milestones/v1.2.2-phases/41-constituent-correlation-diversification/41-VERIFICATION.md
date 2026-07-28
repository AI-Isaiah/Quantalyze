---
phase: 41-constituent-correlation-diversification
verified: 2026-06-26T12:45:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
gaps: []
human_verification:
  - test: "Open /allocations in a logged-in session, build a 3-strategy blend with two highly-correlated legs. Verify the Diversification CollapsibleSection renders: cluster-reordered heatmap, amber too-similar badge, DR and ENB headline, descending PCR list. Adjust per-strategy leverage; confirm DR does not change under uniform leverage."
    expected: "DR reads the same value before and after setting all leverage sliders to 2×. Badge appears. PCR list re-sorts when one leg is levered 3× vs the others."
    why_human: "Visual feel, color readability, live leverage slider interaction, and authenticated composer require a real browser session — not reproducible in jsdom."
---

# Phase 41: Constituent Correlation & Diversification — Verification Report

**Phase Goal:** A constituent-correlation diversification view — pairwise correlation between the strategies/API-key-strategies that make up the blend, with too-similar flags, a diversification headline, per-constituent risk contribution, and cluster reorder — so the allocator spots redundancy while composing.
**Verified:** 2026-06-26T12:45:00Z
**Status:** passed (pending one authed visual canary)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Panel shows pairwise correlation from engine `correlation_matrix` with de-aliased labels (not UUIDs) | VERIFIED | `reorderedMatrix` memo at ScenarioComposer.tsx:1593-1607 reads engine `scenarioMetrics.correlation_matrix` read-only; passed to `<CorrelationHeatmap strategyNames={strategyNames}/>` at :2459-2460; `strategyNames` is the existing de-aliased id→name memo (:1531). CORR-01 composer test (100/100 green) asserts de-aliased axis labels. |
| 2 | Pairs ≥0.85 are flagged; DR + ENB headline summarizes the blend | VERIFIED | `tooSimilarPairs` at diversification.ts:429-445 (threshold=0.85 constant); badge rendered only when `length > 0` at ScenarioComposer.tsx:2441-2451 with pair/pairs pluralization. DR rendered at :2477-2485; ENB with disclosed `ENB = 1 / Σ PCRᵢ²` formula at :2496. CORR-02 tests (too-similar badge present/absent; DR/ENB headline) all green. |
| 3 | Sub-floor-overlap cells render "—"; 0/1-constituent blend shows honest empty state | VERIFIED | n<10 gate: `computeDiversification` returns all-null when `input.n < MIN_USABLE` (diversification.ts:474-478); `reorderedMatrix` passes engine null through so heatmap's own reason-routed empty fires. 0/1-constituent: `clusterOrderIds.length < 2` at ScenarioComposer.tsx:2430 routes to `EmptyStateCard` "Add a second strategy to see diversification". CORR-03 tests (single-constituent + n<10 paths) green. |
| 4 | Per-constituent PCR is shown; matrix reordered by hierarchical clustering | VERIFIED | PCR list at ScenarioComposer.tsx:2538-2590: `<ul role="list">` of `role="listitem"` rows sorted descending by PCR, de-aliased via `strategyNames`, signed % text. Cluster reorder: `clusterOrder()` at diversification.ts:378-423 (average-linkage on ½(1−ρ)); `reorderedMatrix` rebuilds Record in `clusterOrderIds` insertion order before heatmap. CORR-05 and CORR-06 tests green. |

**Score: 4/4 truths verified**

---

### CR-01 Fix Verification (Critical — DR Leverage Invariance)

**Status: CONFIRMED FIXED**

The CR-01 bug (un-levered numerator / levered denominator → DR halved under uniform 2× leverage) is fully resolved in commit `4bcedb12`.

Evidence chain:

1. `applyLeverage()` function at diversification.ts:181-193 scales each constituent's return series by Lᵢ before covariance/σ computation.
2. `computeDiversification` orchestrator at diversification.ts:484-499 calls `applyLeverage(input.returnsById, input.ids, input.leverage)` BEFORE `covarianceMatrix` and `constituentVols`, producing `leveredReturns` and `leveredVols`. Un-levered `vols` computed separately for display-only.
3. `diversificationRatio()` receives `leveredVols` (at :499), matching the levered σ_p denominator — both sides of the ratio now describe the same levered portfolio.
4. `leverage: deAliased.state.leverage` threaded from composer into `computeDiversification` at ScenarioComposer.tsx:1577.
5. Test "is LEVERAGE-INVARIANT under UNIFORM leverage (CR-01 fix; restores 41-01-PLAN.md:152)" at diversification.test.ts:298-368 passes: `drPlain ≈ 1.662551`; `levResult.diversificationRatio ≈ drPlain` to 9dp. DR≥1 asserted.
6. Panel subtitle "Correlation does not shift with per-strategy leverage" (ScenarioComposer.tsx:2427) is now mathematically accurate.

The previous executor had inverted this test to bless the bug. The fix restores the plan/research-mandated invariance. 32/32 diversification unit tests pass.

---

### WR-01 through WR-04 Fix Verification

| Item | Status | Evidence |
|------|--------|----------|
| WR-01: PCR on levered basis (non-uniform L) | VERIFIED | `covarianceMatrix(leveredReturns, ...)` at diversification.ts:489 uses levered series; test "shifts the risk driver under NON-UNIFORM leverage" at :370-413 confirms C's PCR rises under 3× and list re-sorts. |
| WR-02: PCR bar clamped to [0,100]% + overflow-hidden | VERIFIED | `Math.min(100, Math.abs(pcr) * 100)` at ScenarioComposer.tsx:2550-2553; `overflow-hidden` on track div at :2572. WR-02 composer test passes. |
| WR-03: Negative-PCR hedge leg gets "risk-reducing" tag + teal mini-bar | VERIFIED | `isHedge = pcr < 0` guard at :2547; `<span data-testid="pcr-risk-reducing-tag">risk-reducing</span>` at :2564-2570; bar uses `bg-positive` at :2577. WR-03 composer test passes. |
| WR-04: Staggered-inception consistency pin | VERIFIED | Test "rebuilt ρ == engine correlation_matrix to 3dp on a STAGGERED-inception blend (WR-04)" at diversification.test.ts:240-268 runs `computeScenario` with `startDates: { B: "2024-01-05" }`, asserts rebuilt ρ ≡ engine matrix to 3dp. Passes. |

---

### IN-01 and IN-02 Fix Verification

| Item | Status | Evidence |
|------|--------|----------|
| IN-01: ENB<1 disclosure surfaced | VERIFIED | `diversification.effectiveNumberOfBets < 1` guard at ScenarioComposer.tsx:2514; renders `data-testid="enb-below-one-disclosure"` span "Below 1 — a hedge offsets risk". Two composer tests (present + absent cases) pass. |
| IN-02: DEFAULT_INCLUDE_FROM single-sourced | VERIFIED | `export const DEFAULT_INCLUDE_FROM = "2022-01-01"` at scenario.ts:56; imported in diversification.ts:37 (`import { DEFAULT_INCLUDE_FROM, ... } from "@/lib/scenario"`). No duplicated literal in diversification.ts. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/diversification.ts` | Pure-TS math library (alignConstituentReturns, computeDiversification, etc.) | VERIFIED | 516 lines, 9 exports + 2 constants + 3 interfaces + `applyLeverage` (CR-01 fix). Imports `DEFAULT_INCLUDE_FROM` from scenario.ts (IN-02). No population std bleed (grep confirmed). |
| `src/lib/diversification.test.ts` | Golden tests including consistency pin, leverage-invariance pin, WR-04 staggered pin | VERIFIED | 32/32 tests pass. Named tests for CR-01 invariance, WR-01 non-uniform PCR, WR-04 staggered pin all present and green. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Diversification CollapsibleSection with all CORR-01..06 elements | VERIFIED | `diversification` memo at :1550-1584; `reorderedMatrix` at :1593-1607; Diversification `CollapsibleSection` at :2424-2593 with empty state, too-similar badge, heatmap, DR/ENB headline, PCR list. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | Render/wiring tests for all CORR requirements + WR/IN fixes | VERIFIED | 100/100 tests pass; 14 CORR/WR/IN named tests confirmed in verbose output. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `deAliased.state.leverage` | `computeDiversification` | `leverage:` field in memo | WIRED | ScenarioComposer.tsx:1577 |
| `alignConstituentReturns` | `computeDiversification` | `returnsById:` | WIRED | ScenarioComposer.tsx:1551-1570 |
| `clusterOrderIds` | `reorderedMatrix` | insertion-order rebuild | WIRED | ScenarioComposer.tsx:1593-1606 |
| `reorderedMatrix` | `<CorrelationHeatmap>` | `correlationMatrix` prop | WIRED | ScenarioComposer.tsx:2459 |
| `diversification.pcr` | PCR list (`<ul role="list">`) | `.sort(...).map(...)` | WIRED | ScenarioComposer.tsx:2538-2589 |
| `tooSimilarPairs` | amber badge | conditional render | WIRED | ScenarioComposer.tsx:2441-2451 |
| `DEFAULT_INCLUDE_FROM` | `diversification.ts` re-alignment | named import from scenario.ts | WIRED | diversification.ts:37; scenario.ts:56 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| Diversification CollapsibleSection | `diversification` memo | `computeDiversification(alignConstituentReturns(...))` consuming engine `correlation_matrix` + `portfolio_daily_returns` | Yes — real engine output, no static returns | FLOWING |
| `reorderedMatrix` | engine `correlation_matrix` in `clusterOrderIds` order | engine `scenarioMetrics.correlation_matrix` (never recomputed) | Yes | FLOWING |
| PCR list | `diversification.pcr` | Euler decomposition of levered covariance | Yes — levered series, SAMPLE cov | FLOWING |

---

### Honesty Invariant Checks

| Invariant | Status | Evidence |
|-----------|--------|---------|
| SAMPLE convention end-to-end (no population bleed) | VERIFIED | `stdDev(x, true)` at diversification.ts:254; no `stdDev(*false*)`/`pstdev` call in file (grep clean) |
| No NaN/Inf escapes | VERIFIED | `portVar > 1e-15` guard at :339; `sigmaP > 0` at :293; `denom > 0` at :361; `Number.isFinite` checks throughout; "never emits NaN/Inf" orchestrator test passes |
| Signed PCR sums to 1 (not clamped) | VERIFIED | PCR hedge test at test:450-462: `pcr.D ≈ -0.891892`, `pcr.A + pcr.D ≈ 1`; "sums to 1 (±1e-9)" orchestrator test passes |
| 0/1-constituent honest empty state | VERIFIED | `clusterOrderIds.length < 2 → EmptyStateCard`; CORR-03 single-constituent test passes |
| n<10 honest empty (no DR/ENB headline) | VERIFIED | `input.n < MIN_USABLE → all-null`; CORR-03 n<10 test passes; no "add a second strategy" shown (heatmap's own empty fires) |
| FactsheetBody literal absent from ScenarioComposer.tsx | VERIFIED | `grep -c "FactsheetBody" ScenarioComposer.tsx` = 0 |
| storageKey absent on diversification CollapsibleSection | VERIFIED | No `storageKey` on `id="factsheet-diversification"` (only on `composer-collapse:controls`); confirmed by grep |
| ρ consistency pin (rebuilt ρ ≡ engine matrix to 3dp) | VERIFIED | Test passes for both unstaggered and WR-04 staggered-inception paths (32/32) |
| DR ≥ 1 (Choueifaty bound) at any leverage | VERIFIED | Tested at uniform L=2 (:347-349) and non-uniform L (1.5/0.5/4) (:416-436); both pass |
| CorrelationHeatmap unchanged | VERIFIED | SUMMARY confirms `git diff --name-only` on Plan 02 commit: only ScenarioComposer.tsx + .test.tsx modified; CorrelationHeatmap.test.tsx still 20/20 green |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 32 diversification unit tests (math lib) | `npx vitest run src/lib/diversification.test.ts --no-file-parallelism` | 32/32 passed | PASS |
| 100 ScenarioComposer tests (wiring + render) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` | 100/100 passed | PASS |
| TypeScript compilation clean | `npx tsc --noEmit` | 0 errors | PASS |
| CR-01 leverage-invariance pin | Named test "is LEVERAGE-INVARIANT under UNIFORM leverage" | drPlain ≈ levDR to 9dp; DR ≥ 1 | PASS |
| WR-04 staggered consistency pin | Named test "rebuilt ρ == engine correlation_matrix to 3dp on a STAGGERED-inception blend" | Passes with B staggered from 2024-01-05 | PASS |

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|---------|
| CORR-01 | Constituent correlation matrix from engine, factsheet-shaped layout | SATISFIED | Heatmap consuming read-only engine matrix; CollapsibleSection wrapper |
| CORR-02 | ρ≥0.85 flagged; DR + ENB headline | SATISFIED | tooSimilarPairs threshold=0.85; DR/ENB headline with formula |
| CORR-03 | Sub-floor cells "—"; 0/1-constituent honest empty | SATISFIED | n<10 → all-null → heatmap empty; 0/1 → EmptyStateCard |
| CORR-04 | De-aliased labels (not UUIDs) | SATISFIED | strategyNames memo passed to heatmap + PCR list |
| CORR-05 | Per-constituent PCR shown | SATISFIED | Descending `<ul>` list with signed %, de-aliased names |
| CORR-06 | Hierarchical cluster reorder | SATISFIED | average-linkage clusterOrder(); reorderedMatrix pre-pass |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

No TBD/FIXME/XXX debt markers. No placeholder returns. No NaN/Inf paths. No hardcoded empty arrays flowing to render. The PCR bar's decorative 0-width for exact-zero edge cases is intentional design (a PCR of exactly 0 is an empty bar correctly showing zero risk contribution).

---

### Human Verification Required

### 1. Authed Composer Visual Canary

**Test:** Log in to /allocations, build a blend of 3 strategies where 2 are highly correlated (e.g., two BTC-correlated strategies). Open the Diversification CollapsibleSection.
**Expected:** Cluster-reordered heatmap shows correlated pair adjacent; amber badge appears ("1 pair above the 0.85 similarity threshold"); DR > 1; ENB < 3; PCR list descending with signed %. Adjust uniform leverage on all legs — DR value does not change.
**Why human:** Color palette readability, interactive leverage slider behavior, authenticated data, real engine matrix on live strategies — none reachable in jsdom.

*This is a non-blocking canary. All math invariants are unit-tested and the authed visual pathway reuses the CI-verified CorrelationHeatmap (20/20 contrast tests).*

---

### Gaps Summary

No gaps. All 4 roadmap success criteria are VERIFIED against the actual codebase. The CR-01 critical fix (DR leverage invariance) is confirmed shipped in commit `4bcedb12` with the restored invariance test, WR-01..04 and IN-01/IN-02 are all verified in code and test. The single human-verification item is a post-deploy authed visual canary — it is non-blocking because the math is fully unit-testable and was verified, the visual layer reuses the CI-audited CorrelationHeatmap, and no rendered-feel dependency exists for the 4 roadmap success criteria.

---

## Verdict

Phase 41 goal is achieved. The `src/lib/diversification.ts` library is a complete, pure-TS SAMPLE-convention implementation (align, cov, DR, PCR, ENB, cluster order, too-similar) pinned by 32 golden tests including the consistency pin, the WR-04 staggered-inception pin, and the restored CR-01 leverage-invariance pin. The CR-01 critical defect (DR halving under uniform leverage) is conclusively fixed via `applyLeverage` computing both sides of the ratio on the levered basis, with `deAliased.state.leverage` threaded from the composer. All 4 roadmap success criteria are verified by direct code inspection and 100/100 composer tests. The one outstanding item — an authed visual canary in a live browser — is correctly classified as non-blocking: the diversification math is exhaustively unit-tested, the heatmap renderer is unchanged from its own CI-audited state, and the panel wiring is proven by jsdom render tests.

---

_Verified: 2026-06-26T12:45:00Z_
_Verifier: Claude (gsd-verifier)_
