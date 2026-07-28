---
phase: 26-stress-testing-var
verified: 2026-06-22T14:35:00Z
status: passed
score: 13/13
overrides_applied: 0
re_verification: false
---

# Phase 26: Stress Testing & VaR — Verification Report

**Phase Goal:** An allocator can apply a parameterized, β-propagated market shock and see a properly disclosed downside risk measure.
**Verified:** 2026-06-22T14:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All three ROADMAP success criteria verified against actual codebase and passing test suite.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Near-market-neutral strategy (β≈0) shows near-zero projected hit, not the full shock; shock assumptions disclosed | VERIFIED | `computeScenarioStress` computes `projectedImpact = beta * shock`; "near-market-neutral" test asserts `Math.abs(projectedImpact) < 1e-9` and `< 0.3 * 0.01`; β-shock caption (single-factor BTC, linear β propagation) renders in ok-state |
| SC-2 | Historical VaR + CVaR/ES shown with method, window, confidence level, and N disclosed inline — never a bare VaR | VERIFIED | `methodologyLine(varN)` + `VAR_CONFIDENCE_LABEL` produces the full disclosure string; ok-state test asserts the complete `"Historical realized · {N} overlapping days … 95% confidence."` string; `VAR_CONFIDENCE` locked constant (no drift between computed quantile and label) |
| SC-3 | Downside metrics scale with leverage (VaR/ES not scale-invariant); below Phase-22 floor renders honest empty state | VERIFIED | "leverage scales VaR not Sharpe" test asserts `var2x ≈ 2*var1x` + Sharpe unchanged; `evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS)` gates the section; "uses floor SoT" test proves gate flips at the imported constant, not a literal 60 |

**Score:** 3/3 ROADMAP success criteria verified

---

### Plan 26-01 Must-Have Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T-01 | `computeScenarioStress` returns historical VaR(95%) = floor-quantile (-0.060 for 20-value oracle series) | VERIFIED | "golden VaR" test: `expect(r.var).toBeCloseTo(-0.06, 10)` passes; `SORTED.toContain(r.var)` proves it is an exact order statistic |
| T-02 | CVaR(95%) = mean of tail at/beyond VaR (-0.070); CVaR <= VaR always | VERIFIED | "golden CVaR" test: `toBeCloseTo(-0.07, 10)` + `toBeLessThanOrEqual(r.var!)` passes |
| T-03 | Near-market-neutral book (cov≈0) yields projectedImpact≈0, NOT the full shock | VERIFIED | "near-market-neutral" test: period-4-vs-period-2 orthogonal construction, `Math.abs(projectedImpact) < 1e-9`; "face-value bug" assertion proves the control is falsifiable both directions |
| T-04 | projectedImpact = β_portfolio · shock, β from computeScenarioBenchmark over BTC inner-join (intersection, not union) | VERIFIED | "beta-propagated impact": port=2×btc, β=2, impact=-0.60; "intersection not union": poison values on non-overlapping dates do not move impact; `betaN=4` for 4-date overlap |
| T-05 | 2× uniform leverage ⇒ ~2× VaR/CVaR; Sharpe unchanged | VERIFIED | "leverage scales VaR not Sharpe": `toBeCloseTo(2*r1.var!, 8)` + Sharpe invariant inline assertion |
| T-06 | All fields null on degenerate input (empty, constant series, constant BTC, below-overlap) — never a fabricated 0 | VERIFIED | Degeneracy describe block: 5 distinct `it` cases; all assert `.toBeNull()` never `toBe(0)`. NaN/Infinity direct injection also null (WR-01 regression tests present and passing) |
| T-07 | VaR window N and β-shock window N tracked as two distinct fields | VERIFIED | `ScenarioStress` interface exports `varN` and `betaN` as separate fields; intersection-not-union test asserts `betaN=4` independently of `varN=8` |

**Score:** 7/7 plan 26-01 truths verified

---

### Plan 26-02 Must-Have Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| T-08 | Own-book ScenarioComposer renders a "Stress & VaR" section after ScenarioBenchmarkSection with BTC shock preset (−10/−20/−30%, −30% default) and projected portfolio impact (STRESS-01) | VERIFIED | `ScenarioComposer.tsx:1593` mounts `<StressVarSection>` after `:1576` `<ScenarioBenchmarkSection>` and before `:1602` Pairwise correlation; `SegmentedControl` with `-0.30` default wired |
| T-09 | Section shows historical VaR(95%) + CVaR/ES with inline disclosure (method · N · 95% · not a forecast) — never bare | VERIFIED | Full disclosure string in `StressVarSection.tsx:224`; ok-state test asserts complete string including N and "95% confidence." |
| T-10 | Below Phase-22 floor → SampleFloorEmptyState; floor is imported SAMPLE_FLOOR_OVERLAPPING_DAYS, never literal 60 | VERIFIED | `evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS)` at line 165; `grep` on non-comment code shows no literal 60; "uses floor SoT" test passes |
| T-11 | Guard order fixed (#509): scenario-side absence → BTC unavailable → floor fail → ok; each heading matches body | VERIFIED | Guards at lines 145, 154, 165 in order; "scenario-side empty" test asserts BTC copy ABSENT; "BTC-unavailable empty" test asserts scenario copy ABSENT |
| T-12 | Values through formatPercent/formatNumber → "—" on null; losses MONOCHROME (text-text-secondary, Geist Mono), never red | VERIFIED | `grep "#DC2626|text-negative|text-red|text-destructive"` returns 0 matches; "monochrome losses" test passes; "em-dash discipline" test asserts "—" not "0.00" |
| T-13 | Two-N disclosure: VaR/CVaR caption names varN; β-shock caption names betaN; two captions when they differ | VERIFIED | `twoNs = result.varN !== result.betaN` branch renders separate captions; "two-N disclosure" test passes; WR-03 fix conditions β caption on `impactShown` |

**Score:** 6/6 plan 26-02 truths verified

**Overall score: 13/13 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/lib/scenario-stress.ts` | Pure null-safe lib exporting `computeScenarioStress` + `ScenarioStress`; min 60 lines | VERIFIED | 170 lines; exports `computeScenarioStress`, `ScenarioStress`, `VAR_CONFIDENCE`, `VAR_CONFIDENCE_LABEL` |
| `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` | Golden oracle + invariant + degeneracy matrix; min 120 lines | VERIFIED | 402 lines; 15 tests passing (expanded from plan's 9 by WR-01/WR-02 regression tests) |
| `src/app/(dashboard)/allocations/components/StressVarSection.tsx` | Props-only presentational section; min 90 lines | VERIFIED | 251 lines; "use client", exports `StressVarSection` |
| `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` | State matrix + honesty suite; min 110 lines | VERIFIED | 453 lines; 12 tests passing |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Mounts `<StressVarSection>` as sibling Card after ScenarioBenchmarkSection | VERIFIED | Mount at line 1593 (after :1576 benchmark, before :1602 pairwise) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scenario-stress.ts` | `portfolio-stats.ts` (`computeVaR`, `computeExpectedShortfall`) | wrap-not-fork; null-on-degenerate before calling | WIRED | Lines 47, 167-168; both called inside `computeVarPath` after empty/finite/constant checks |
| `scenario-stress.ts` | `scenario-benchmark.ts` (`computeScenarioBenchmark`, `innerJoinByDate`) | β source for shock; intersection N for betaN | WIRED | Lines 49, 120-121; `innerJoinByDate` for `betaN`, `computeScenarioBenchmark` for `beta` |
| `StressVarSection.tsx` | `scenario-stress.ts` (`computeScenarioStress`) | section's only math source | WIRED | Lines 14, 139; `useMemo` over `computeScenarioStress(portfolioDaily, btcDaily, { shock })` |
| `StressVarSection.tsx` | `sample-floor.ts` (`evaluateSampleFloor`, `SAMPLE_FLOOR_OVERLAPPING_DAYS`) | floor gate — imported SoT constant | WIRED | Lines 7-9, 165; no re-declared literal 60 |
| `ScenarioComposer.tsx` | `StressVarSection.tsx` | mount as sibling Card after ScenarioBenchmarkSection | WIRED | Import at line 94; mount at lines 1593-1601; all 5 props from existing scope |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `StressVarSection.tsx` | `result` (ScenarioStress) | `computeScenarioStress(portfolioDaily, btcDaily, { shock })` via `useMemo` | Yes — `portfolioDaily` is `scenarioMetrics.portfolio_daily_returns ?? []` from live composer state; `btcDaily` from `btcAvailable`/`btcDaily` composer state | FLOWING |
| `ScenarioComposer.tsx` mount | `portfolioDaily` prop | `scenarioMetrics.portfolio_daily_returns ?? []` (line :1594) | Yes — `scenarioMetrics` is computed from real scenario data | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Lib test suite (15 tests) | `npx vitest run scenario-stress.test.ts` | 15 passed / 0 failed | PASS |
| Section test suite (12 tests) | `npx vitest run StressVarSection.test.tsx` | 12 passed / 0 failed | PASS |
| Full project suite | `npx vitest run` | 6445 passed / 284 skipped / 0 failed | PASS |
| TypeCheck | `npx tsc --noEmit` | 0 errors referencing phase 26 files | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no migration probes; this phase is pure client-side TS math + React component. Verification boundary is the unit/component test suite (confirmed above).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| STRESS-01 | 26-01, 26-02 | Parameterized β-propagated BTC shock; near-market-neutral shows near-zero hit | SATISFIED | `computeScenarioStress` β-shock path + "near-market-neutral" test + `StressVarSection` SegmentedControl shock affordance + composer mount |
| STRESS-02 | 26-01, 26-02 | Historical VaR + CVaR/ES with method/window/confidence/N disclosed; scales with leverage; honest empty state below floor | SATISFIED | Golden oracle tests + leverage-scales tests + floor-gate test + full disclosure caption via `methodologyLine(varN) + VAR_CONFIDENCE_LABEL` |

Both requirements marked `Complete` in `REQUIREMENTS.md` (lines 113-114). No orphaned requirements found.

---

### Anti-Patterns Found

No unresolved debt markers (TBD/FIXME/XXX) in any phase 26 file. The REVIEW.md identified 3 warnings (WR-01, WR-02, WR-03); all three were fixed and have passing regression tests:

| Warning | Fix Applied | Regression Test | Status |
|---------|-------------|-----------------|--------|
| WR-01: NaN defeats relative-scale guard, reaching `computeVaR` with corrupted sort | `!values.every(Number.isFinite)` check before the guard (scenario-stress.ts:150) | "degenerate null — NaN injected" + "Infinity injected" tests (scenario-stress.test.ts:313, 336) | FIXED + PINNED |
| WR-02: `confidence` opt could desync rendered "95%" label from actual quantile | Removed `confidence` from opts entirely; locked as `VAR_CONFIDENCE = 0.95` constant exported alongside `VAR_CONFIDENCE_LABEL` | "VAR_CONFIDENCE_LABEL derived from VAR_CONFIDENCE" + "computed VaR is quantile at VAR_CONFIDENCE" tests | FIXED + PINNED |
| WR-03: β caption rendered affirmatively against a "—" projected impact | `impactShown = result.projectedImpact !== null`; β caption gated on `impactShown` (StressVarSection.tsx:186, 232); replaced with "BTC overlap too short" copy when suppressed | "β caption matches data (#509, WR-03)" + "β caption present when impact IS shown" tests | FIXED + PINNED |

Info-only findings (IN-01 double `innerJoinByDate` call, IN-02 shared `NULL_VAR` reference, IN-03 leading "+" on non-negative VaR): no action required per reviewer assessment; none are blockers.

---

### Human Verification Required

None. This phase is pure client-side TypeScript math plus one presentational React section with no server surface, no migration, no live-DB gate, and no external service integration. The honesty/correctness invariants are fully machine-verifiable via the unit and component test suite. The visual appearance of the section is covered by component tests (guard-state routing, em-dash, monochrome, disclosure string) and the UI-SPEC was reviewed and locked at plan time.

The `build_context_you_must_honor` note confirms: "the verification boundary is the unit/component test suite + the rendered section (covered by component tests)."

---

### Gaps Summary

No gaps. All 13 must-have truths verified, all 5 required artifacts substantive and wired, all 5 key links wired, both requirements satisfied, 3 review warnings fixed with regression tests, 0 debt markers, 6445/6445 tests passing.

---

_Verified: 2026-06-22T14:35:00Z_
_Verifier: Claude (gsd-verifier)_
