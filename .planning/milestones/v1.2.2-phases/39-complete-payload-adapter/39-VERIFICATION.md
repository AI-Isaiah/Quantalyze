---
phase: 39-complete-payload-adapter
verified: 2026-06-26T08:48:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 39: Complete Payload Adapter Verification Report

**Phase Goal:** `buildScenarioFactsheetPayload` produces a COMPLETE, valid `FactsheetPayload` from the blend's `portfolio_daily_returns` via the existing `compute.ts` helper family, on the population-std/252-vol/365.25-CAGR convention, with honest low-sample `n` and degenerate-collapse.

**Verified:** 2026-06-26T08:48:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `strategyMetrics` + every panel-array field populated from real `compute()`/helper output (no zeroed summary, no empty arrays) for a healthy blend | VERIFIED | `buildReturnsBody()` at scenario-factsheet-payload.ts:282–355 calls `compute(rets, datesR)` (line 324) then assembles all panel helpers; 21/21 adapter tests green incl. `panel arrays are populated` |
| 2 | Golden-parity fixture asserts blend metrics ≡ `compute.ts` within epsilon; sample-std/convention drift fails CI | VERIFIED | Test `ann_vol is the POPULATION-std value 0.0075·√252` (test.ts:229); field-by-field loop at test.ts:205–218; mutation-falsifiability proven in 39-02-SUMMARY (sample-std yields ~0.12110 vs population 0.11906 — RED at 6 decimals) |
| 3 | `strategyMetrics.n` = true overlapping-observation count; `n<252` caveats fire on short blend | VERIFIED | `compute()` sets `n = rets.length` (compute.ts contract); adapter test.ts:238–251 asserts `n===30` (caveat ON) and `n===252` (caveat OFF at exactly 252) — both pass |
| 4 | Empty / single-strategy / sub-floor-overlap / non-finite blends collapse to safe empty — no NaN/Inf, no fabricated zeros | VERIFIED | Returns-degenerate gate at scenario-factsheet-payload.ts:290–312 (textually BEFORE `compute()` at line 324); three degenerate test cases (empty, NaN return, single point) all pass; `strategyMetrics.n===0`, `cum_ret===0`, all panels `[]` confirmed |

**Score:** 4/4 truths verified

---

### Supplementary Honesty-Invariant Checks

Beyond the four roadmap must-haves, the plan specified additional correctness invariants. All verified:

| Invariant | Evidence |
|-----------|----------|
| `ingestSource === "csv"` | Hard-coded at scenario-factsheet-payload.ts:420; test `ingestSource csv, 4 synth panels absent` asserts `.toBe("csv")` — green |
| 4 synthesized api-only panels structurally absent (`in payload === false`) | Test.ts:299–306 loops `["peerPercentile","allocatorPortfolios","eventSignatures","benchEventSignatures"]`; passes — these fields are physically absent from the `FactsheetCsvPayload` type arm |
| `styleDrift: null` | scenario-factsheet-payload.ts:459; explicitly deferred to STYLE-V2-01 per REQUIREMENTS.md Out-of-Scope and 39-CONTEXT.md `<deferred>` — not a gap |
| `correlations: []`, `correlationMatrix: {labels:[],matrix:[]}` | scenario-factsheet-payload.ts:468–469; asserted by honesty-invariant test — green |
| Adapter feeds `compute(rets)` from `portfolio_daily_returns` (daily-RETURN form), NOT the wealth series | `portfolio_daily_returns` (returns form, `|v| < 0.5`) threaded at ScenarioComposer.tsx:2228; `ScenarioFactsheetChart` prop `portfolioDaily = []` default at chart.tsx:140; `buildReturnsBody` extracts `p.value` as `rets` before `compute()` — no wealth-series contamination |
| `strategyEquity`/`strategyDrawdowns` stay on the WEALTH series (Phase-38 pins intact) | scenario-factsheet-payload.ts:393–396 reads `scenario` (wealth) for both; test `strategyEquity/strategyDrawdowns still track the WEALTH series` at test.ts:369–381 — exact-equality pass |
| Population-std pin is mutation-falsifiable | 39-02-SUMMARY §Falsifiability Proof: temporarily scaled `ann_vol` by `√(n/(n-1))`; convention-drift test went RED (documented output: `expected 0.12109... to be close to 0.11905...`). Test encodes WHY per CLAUDE.md Rule 9 |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/factsheet/quantiles.ts` | Exported `quantileSummary` — single parity source | VERIFIED | File exists, exports `quantileSummary(rets): QuantilePayload`; 29 lines, verbatim algorithm from build-payload.ts |
| `src/lib/factsheet/quantiles.test.ts` | 4 unit pins (empty, single, median, order-independence) | VERIFIED | 4/4 tests green |
| `src/lib/factsheet/build-payload.ts` | Imports `quantileSummary` from `./quantiles`, no local copy | VERIFIED | `import { quantileSummary } from "./quantiles"` at line 22; `grep -c "function quantileSummary"` → 0 |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` | Complete `FactsheetCsvPayload` via `compute()`; ≥260 lines; `compute(` on populated path | VERIFIED | 473 lines; `compute(rets, datesR)` at line 324; all panel helpers called |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | `portfolioDaily` prop threaded to adapter | VERIFIED | `portfolioDaily?: DailyPoint[]` in props (line 77); passed into `buildScenarioFactsheetPayload` (line 150); in memo deps (line 154) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | `portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}` at chart mount | VERIFIED | Line 2228 — exact match |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts` | Golden-parity + convention-drift + n-boundary + ingestSource-absence tests | VERIFIED | 21 tests green; all described blocks present including `toBeCloseTo` assertions |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ScenarioComposer.tsx` | `ScenarioFactsheetChart portfolioDaily` prop | `scenarioMetrics.portfolio_daily_returns ?? []` | WIRED | Line 2228, exact guard matches plan contract |
| `ScenarioFactsheetChart.tsx` | `buildScenarioFactsheetPayload({..., portfolioDaily})` | Named destructure in `useMemo` | WIRED | Lines 148–154; `portfolioDaily` in dependency array |
| `scenario-factsheet-payload.ts` | `compute(rets, datesR)` | `buildReturnsBody` populated path | WIRED | Line 324; degenerate gate verified BEFORE (lines 290–312 → return at 295) |
| `scenario-factsheet-payload.ts` | `quantileSummary` | `import from @/lib/factsheet/quantiles` | WIRED | Line 54; used at line 354 on populated path |
| `build-payload.ts` | `quantileSummary` | `import from ./quantiles` | WIRED | Line 22; used at line 173 (existing call site unchanged) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `scenario-factsheet-payload.ts` | `strategyMetrics` | `compute(rets, datesR)` called on `portfolioDaily` (daily-RETURN form from engine) | Yes — `compute()` derives all scalars from real return series; field-by-field parity test confirms | FLOWING |
| `scenario-factsheet-payload.ts` | `calmarByYear`, `monthlyReturns`, `bootstrapCI` | `calmarByYear(rets, datesR)`, `monthlyReturnsMatrix(rets, datesR)`, `bootstrapCI(rets)` | Yes — panel tests assert `.length > 0` and deterministic bootstrap point | FLOWING |
| `ScenarioFactsheetChart.tsx` | `synthPayload` | `buildScenarioFactsheetPayload({portfolioDaily: <real engine returns>})` | Yes — `portfolioDaily` flows from `scenarioMetrics.portfolio_daily_returns` (live engine output, not hardcoded) | FLOWING |

---

### Behavioral Spot-Checks

Tests were run directly. No server required (pure TS, `useMemo`-internal, no fetch).

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 21 adapter tests (parity + degenerate + invariants) | `npx vitest run "…/scenario-factsheet-payload.test.ts"` | 21/21 passed | PASS |
| 4 quantiles unit tests | `npx vitest run "src/lib/factsheet/quantiles.test.ts"` | 4/4 passed | PASS |
| 89 ScenarioComposer tests (incl. portfolioDaily mock assertion) | `npx vitest run "…/ScenarioComposer.test.tsx"` | 89/89 passed | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PAYLOAD-01 | 39-02 | Full scalar metric set via `compute()`, no zeroed summary | SATISFIED | `buildReturnsBody` populated path; field-by-field test loop; `cum_ret` not 0 assertion |
| PAYLOAD-02 | 39-02 | Panel arrays populated from pure helpers | SATISFIED (note) | All panel helpers called (bootstrap, calmar, rolling, streaks, monthly, heatmap, quantiles, stress); `styleDrift: null` is the D-5 v2-deferral sanctioned in REQUIREMENTS.md Out-of-Scope, not a missing panel |
| PAYLOAD-03 | 39-02 | Population-std/252/365.25 convention; golden-parity fixture fails on drift | SATISFIED | `ann_vol` pin at `0.0075·√252`; mutation-verified; field-by-field loop at 1e-6 |
| PAYLOAD-04 | 39-02 | `strategyMetrics.n` = true overlap count; `n<252` caveat fires | SATISFIED | `compute()` sets `n = rets.length`; n-boundary test passes (30→caveat ON, 252→caveat OFF) |
| PAYLOAD-05 | 39-02 | Degenerate blends collapse to safe-empty, no NaN/Inf | SATISFIED | Returns-degenerate gate before `compute()`; three degenerate test cases all pass |

**Note on PAYLOAD-02 / `styleDrift`:** REQUIREMENTS.md lists `styleDrift` in PAYLOAD-02 but also explicitly registers `STYLE-V2-01` under Out-of-Scope / v2 deferred requirements. The 39-CONTEXT.md `<deferred>` block and D-5 in the PLAN+SUMMARY both record this as a deliberate Phase 39 decision with CONTEXT winning over PAYLOAD-02's mention (CLAUDE.md Rule 7). This is not a gap — it is a documented, requirements-consistent deferral.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scenario-factsheet-payload.ts` | 457–459 | `styleDrift: null` with `D-5` comment | INFO | Intentional v2 deferral; REQUIREMENTS.md Out-of-Scope confirms; not a stub |

No `TODO`, `FIXME`, `TBD`, or `XXX` markers found in any file modified by this phase. No empty implementations, no hardcoded empty arrays on the populated path.

---

### Human Verification Required

None. Phase 39 is pure-TS and unit-testable with no rendered surface (Phase 40 mounts the real `FactsheetBody`). All must-haves are machine-verifiable via the test suite.

---

## Gaps Summary

No gaps. All four roadmap success criteria are verified against the actual codebase:

1. Real `compute()` scalars and all panel arrays flow from `portfolio_daily_returns` on the healthy path.
2. Golden-parity fixture is present, mutation-falsifiable, and CI-enforced (full coverage gate passed: 546 files / 6651 tests, all ratchets cleared).
3. `n` is `rets.length` (true overlap count) with honest boundary behavior at 30 and 252.
4. Degenerate gate fires before `compute()`, collapsing to safe-empty with no NaN/Inf anywhere.

The `styleDrift: null` deviation from PAYLOAD-02's literal list is requirements-consistent (STYLE-V2-01 is explicitly Out-of-Scope for this milestone) and does not represent unmet functionality — it is the correct value for Phase 39.

---

_Verified: 2026-06-26T08:48:00Z_
_Verifier: Claude (gsd-verifier)_
