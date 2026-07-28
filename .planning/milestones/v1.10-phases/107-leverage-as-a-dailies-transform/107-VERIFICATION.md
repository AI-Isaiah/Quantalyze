---
phase: 107-leverage-as-a-dailies-transform
verified: 2026-07-15T17:30:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification_discharged: "2026-07-15 authed prod QA (quantalyze.xyz, Phoenix-OKX factsheet): leverage L=1→2 re-derived the WHOLE factsheet on-device — charts rescaled (+400%→+1900% axis), rail re-derived, Sharpe 2.49→2.49 & Sortino 4.18→4.18 INVARIANT, Ann Vol 36.3%→72.5% & α +89.1%→+178.2% (~2×), the exact honest what-if caption rendered, NO MODELED eyebrow (correctly deleted), RESET 1× appeared. Input accepted immediately with no visible freeze/skeleton flash — the useDeferredValue debounce mechanism confirmed working on-device. Note: exercised via a single-step L change (not a rapid 0→10 drag stress), but the debounce contract held. Optional/low-priority perf-feel item — DISCHARGED."
---

# Phase 107: Leverage as a dailies transform — Verification Report

**Phase Goal:** Leverage becomes a PREPARATION transform (levered basis) — apply `r→L·r` to the dailies, re-run the shared `deriveSeriesBundle` so the ENTIRE factsheet re-derives levered (charts + rail + α→L·α, β→L·β render honestly). DELETES `useLeveragedMetrics`/`useModeledLeverage` re-scale + disclosure (~780 LOC); keeps the slider state. Precedent: `scenario.ts:427`.
**Verified:** 2026-07-15T17:30:00Z
**Status:** passed (all correctness criteria VERIFIED; the optional perf-feel item DISCHARGED live on prod 2026-07-15 — see `human_verification_discharged`)
**Re-verification:** No — initial verification; human item discharged via authed prod QA 2026-07-15

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | At L≠1, `r→L·r` applied to DAILIES + shared `deriveSeriesBundle` re-runs → whole factsheet re-derives (charts + rail), not just 7 KpiStrip scalars | ✓ VERIFIED | `basis-context.tsx:200-268`: leverage layer scales `base.strategyReturns.map((r,i)=>({date,value:L*r}))` then calls the exported `deriveSeriesBundle`, returning the full bundle spread `{...base,...lb}`. Leverage is composed INTO the ONE shared `useBasisSeriesView`, which is read by every chart/panel/rail consumer (TimeSeriesChart, HistogramChart, Heatmap/Distribution/Analytical/BatchD/StressWindows panels, MasterBrush, MetricsColumn rail, KpiStrip) — 20 files grep-confirmed. Tests B/C/E in `basis-context.leverage.test.tsx` green (60 component tests pass). |
| SC-2 | α→L·α, β→L·β render honestly (no MODELED blanking of α/IR) | ✓ VERIFIED | `joint.test.ts:82` "LEV-BB leverage scaling" describe: β×L, α×L, corr-invariant to 10dp (only strategy leg levered; bench re-aligned un-levered inside `deriveSeriesBundle`). `FactsheetView.leverage.test.tsx:369-394`: α/IR cells show real values at L=2, never "—" for a leverage reason. `MODELED`/eyebrow grep count = 0 in FactsheetView. |
| SC-3 | `useLeveragedMetrics`/`useModeledLeverage` + CAVEAT/MODELED/BASE·1× disclosure DELETED; slider STATE kept; LEV-02 untouched | ✓ VERIFIED | SC-3 source-scan gate green (`leverage-backbone-gates.test.ts`, string-concat tokens, comment-stripped). `leverage-context.tsx` is 54 lines, provider/state only (`LeverageProvider`/`useLeverage`/`LeverageContext` kept). `scenario.ts` byte-untouched (`git diff --exit-code` clean vs base b196de6c). Only grep hit for forbidden symbols is a prose comment line (stripped by the gate). |
| SC-4 | At L=1 factsheet byte-identical (by-reference short-circuit), proven by golden | ✓ VERIFIED | `basis-context.tsx:209` `if (L === 1) return base;` precedes every `deriveSeriesBundle` call (explicit first guard, load-bearing keystone). `build-payload.test.ts.snap` byte-unchanged vs base. `build-payload.test.ts` + Test A (ref-identity + 2→1 round-trip) green. |
| SC-5 | One preparation transform; no second leverage compute path remains (grep-gate) | ✓ VERIFIED | SC-5 gate green: recursive `src/` walk (ex-`scenario.ts`), comment-stripped, asserts no `compute(<series>.map(...))` shape survives + a liveness fixture pins the regex against the retired line so a typo can't pass silently. The old `compute(payload.strategyReturns.map(r => appliedLeverage * r), …)` path is deleted with the two hooks. |

**Score:** 5/5 truths verified

### Code-Review Fix Verification (WR-01, WR-02)

| Fix | Status | Evidence |
|-----|--------|----------|
| WR-01 — unified `useAppliedLeverage` caption-honesty | ✓ VERIFIED | `basis-context.tsx:286-289` `useAppliedLeverage()` reads leverage through the SAME `useDeferredValue` debounce as the view. `leverageApplies`/`leverageEligibleFor` (`:301-321`) are the single source of truth. KpiStrip (`FactsheetView.tsx:765-767`) gates `m` and the caption (`:852`) on `leverageApplies(payload, basis, appliedLeverage)` using the deferred value — caption/gate/numbers cannot drift (the immediate-vs-deferred divergence is now structurally impossible). ControlBar uses `leverageEligibleFor` (`:1149`). |
| WR-02 — Sharpe/Sortino pin at the L=1↔L≠1 boundary | ✓ VERIFIED | `basis-context.tsx:234-263`: on MTM books the two leverage-invariant scalars (sharpe, sortino) are re-pinned to the persisted authoritative values; homogeneous scalars (cum_ret/cagr/ann_vol/max_dd) stay levered; Calmar deliberately NOT pinned (genuinely leverage-variant off the geometric equity — reviewer's calmar suggestion correctly declined). Pinned by `FactsheetView.leverage.test.tsx:403-430` (Sharpe/Sortino stay = persisted at L=2, Ann. Vol still scales). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/factsheet/build-payload.ts` | exported `deriveSeriesBundle` | ✓ VERIFIED | `export function deriveSeriesBundle` count = 1; diff vs base is a single `export` keyword. |
| `src/app/factsheet/[id]/v2/basis-context.tsx` | leverage layer + short-circuit + WR-01/WR-02 + deferred read | ✓ VERIFIED | Layer 2 composed in place; 4 guards; `useDeferredValue` at :171; `useAppliedLeverage`/`leverageApplies`/`leverageEligibleFor` exported. |
| `src/app/factsheet/[id]/v2/leverage-context.tsx` | provider/state only | ✓ VERIFIED | 54 lines; derived hooks deleted; no basis-context import (cycle dissolved). |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | KpiStrip on levered view; disclosure deleted; reworded copy | ✓ VERIFIED | `useAppliedLeverage`+`leverageApplies` wired; caption verbatim; MODELED/BASE·1× count = 0; `What-if projection at` count = 1. |
| `src/lib/factsheet/joint.test.ts` | SC-2 L-scaling case | ✓ VERIFIED | LEV-BB describe present, green. |
| `src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts` | SC-3 + SC-5 gates | ✓ VERIFIED | 95 lines; recursive scan + liveness fixture; green. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `basis-context.tsx` | `build-payload.ts` | `deriveSeriesBundle` import + call on levered dailies | ✓ WIRED |
| `basis-context.tsx` | `leverage-context.tsx` | `useContext(LeverageContext)` graceful read + deferred | ✓ WIRED |
| `FactsheetView.tsx` (KpiStrip) | `basis-context.tsx` | `useAppliedLeverage` + `leverageApplies` + `view.strategyMetrics` | ✓ WIRED |
| `FactsheetView.tsx` (ControlBar) | `basis-context.tsx` | `leverageEligibleFor` | ✓ WIRED |
| chart/panel/rail consumers (12+) | `basis-context.tsx` | `useBasisSeriesView` (leverage composed in) | ✓ WIRED (20 files grep-confirmed) |

### Byte-Untouched Surface (against phase base b196de6c)

| File | Status |
|------|--------|
| `src/lib/scenario.ts` (LEV-02) | ✓ UNCHANGED |
| `src/lib/leverage.ts` | ✓ UNCHANGED |
| `src/lib/factsheet/joint.ts` | ✓ UNCHANGED |
| `src/lib/factsheet/__snapshots__/build-payload.test.ts.snap` (SC-4 golden) | ✓ UNCHANGED |

### Behavioral Spot-Checks (test suites run in this verifier's own process)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SC-3/SC-5 gates + SC-2 joint + hook-view + leverage-context | `vitest run leverage-backbone-gates joint basis-context.leverage leverage-context` | 4 files / 22 tests passed | ✓ PASS |
| SC-1/SC-4 component + basis suites + snapshot | `vitest run FactsheetView.leverage FactsheetBody.basis build-payload basis-context` | 4 files / 60 tests passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LEV-BB | 107-01/02/03 | Leverage as a dailies-level preparation transform feeding the ONE backbone; whole factsheet re-derives; deletes re-scale + disclosure | ✓ SATISFIED | All five SCs VERIFIED above; `REQUIREMENTS.md:40` marks LEV-BB `[x]`. |

### Anti-Patterns Found

None. No TBD/FIXME/XXX markers introduced; no stubs (the hook re-derives real bundles; L=1 and all four guards return the fully-populated base by reference). LOC delta over the five core files: 323 insertions / 473 deletions (net −150), consistent with the ~780 raw disclosure/hook apparatus removed.

### Human Verification — DISCHARGED 2026-07-15 (authed prod QA)

**1. Slider re-derive interactive feel (optional, low priority) — ✅ DISCHARGED**

- **Verified live** on quantalyze.xyz (Phoenix-OKX factsheet, authed): leverage L=1→2 re-derived the whole factsheet with immediate input and no visible freeze/skeleton flash; charts rescaled, rail re-derived, Sharpe/Sortino invariant, vol/α ~2×, honest what-if caption present, MODELED eyebrow correctly absent, RESET 1× appeared. The `useDeferredValue` debounce works on-device.
- Note: exercised via a single-step L change, not a rapid 0→10 drag stress-test; the debounce contract held on the change tested. Optional/low-priority — does not block the phase goal (which was already met in code).

### Gaps Summary

No gaps. All five roadmap success criteria are TRUE in code, verified against the actual source (not SUMMARY claims) and confirmed by 82 targeted tests run in this verifier's own process. Both code-review warnings (WR-01 caption-honesty, WR-02 Sharpe/Sortino pin) are fixed and test-pinned. The LEV-02 surface, `leverage.ts`, `joint.ts`, and the SC-4 golden snapshot are all byte-untouched. The only outstanding item is an optional, measurement-resolved interactive-perf feel-check that cannot be verified programmatically.

---

_Verified: 2026-07-15T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
