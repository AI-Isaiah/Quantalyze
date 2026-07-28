---
phase: 26
slug: stress-testing-var
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 26 is pure
> client-side TS math + one presentational section + a mount edit — the honesty/correctness
> threat class IS the test matrix. Every requirement maps to a fast, falsifiable unit/component
> test (< 2s each). There is no framework install (Vitest + RTL already configured) and no
> manual-only verification.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (TS) + `@testing-library/react` (component) |
| **Config file** | `vitest.config.ts` (coverage gate: lines 82 / statements 80 / functions 74 / branches 72 — CLAUDE.md, blocking CI) |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-stress.test.ts" "src/app/(dashboard)/allocations/components/StressVarSection.test.tsx"` |
| **Full suite command** | `npm run test` (and `npm run test:coverage` for the blocking gate) |
| **Estimated runtime** | ~3 seconds (the two new files); full suite per repo |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (the two new test files).
- **After every plan wave:** Run `npm run test` (full suite).
- **Before `/gsd:verify-work`:** Full suite green + coverage gate held.
- **Max feedback latency:** < 5 seconds for the per-task quick run.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | STRESS-01 / STRESS-02 | T-26-01..06 | Pure null-safe lib; wrap-not-fork; β via computeScenarioBenchmark; no re-applied leverage; two distinct Ns | unit | `npx tsc --noEmit \| grep scenario-stress` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | STRESS-02 | T-26-01,04 | Golden VaR(95%)=-0.060, CVaR=-0.070; CVaR≤VaR; not-parametric negative control | unit | `npx vitest run scenario-stress.test.ts -t "golden VaR"` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | STRESS-01 | T-26-05 | Near-market-neutral book ⇒ \|impact\| < ε, NOT ≈\|shock\| | unit | `... -t "near-market-neutral"` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | STRESS-01 | T-26-03 | β-shock inner-joins (divergent non-overlap value does not move impact) | unit | `... -t "intersection not union"` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | STRESS-02 | T-26-02 | 2× uniform leverage ⇒ ~2× VaR/CVaR (toBeCloseTo 2×,8); Sharpe unchanged | unit | `... -t "leverage scales VaR not Sharpe"` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | STRESS-02 | T-26-02 | 2× leverage ⇒ max-drawdown MORE severe monotonically (not exactly 2×) | unit | `... -t "leverage drawdown monotone"` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | STRESS-02 | T-26-01,06 | Degeneracy matrix: empty/constant/constant-BTC ⇒ every field null, never 0 | unit | `... -t "degenerate null"` | ❌ W0 | ⬜ pending |
| 26-02-01 | 02 | 2 | STRESS-01 / STRESS-02 | T-26-07..11 | Props-only section; 4-state #509 guard order; SegmentedControl shock; em-dash; monochrome; imported floor SoT (no literal 60) | component | `npx tsc --noEmit \| grep StressVarSection` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 2 | STRESS-02 | T-26-10 | ok state renders full methodology line (method · N · 95% · not a forecast) — never bare VaR | component | `npx vitest run StressVarSection.test.tsx -t "ok state"` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 2 | STRESS-01 | T-26-05 | Shock preset selection recomputes the projected impact | component | `... -t "shock interaction"` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 2 | STRESS-02 | T-26-11 | Scenario-side empty names scenario cause; BTC-unavailable names BTC cause (#509) | component | `... -t "empty"` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 2 | STRESS-02 | T-26-09 | Below-floor ⇒ SampleFloorEmptyState; gate flips at SAMPLE_FLOOR_OVERLAPPING_DAYS | component | `... -t "below-floor" ; ... -t "uses floor SoT"` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 2 | STRESS-02 | T-26-07 | A null estimate renders "—", explicitly NOT "0.00" | component | `... -t "em-dash discipline"` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 2 | STRESS-02 | T-26-08 | VaR/CVaR loss cells carry NO red/text-negative/#DC2626 | component | `... -t "monochrome losses"` | ❌ W0 | ⬜ pending |
| 26-02-03 | 02 | 2 | STRESS-01 / STRESS-02 | T-26-12 | Mount-only edit; own-book composer ONLY (sandbox untouched); full suite green | integration | `npm run test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` — STRESS-01 (β-shock, near-market-neutral, intersection) + STRESS-02 (golden VaR/CVaR, leverage scaling, degeneracy null matrix). Built in Plan 26-01 Task 2.
- [ ] `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` — the 4-state matrix, em-dash discipline, monochrome-not-red losses, disclosure-line presence, floor-SoT gating. Built in Plan 26-02 Task 2.
- [ ] Framework install: **none** — Vitest + `@testing-library/react` already configured (`vitest.config.ts`).
- [ ] Shared fixtures: **none** — build inline (the existing `scenario-benchmark.test.ts` `days(n)` / `ScenarioBenchmarkSection.test.tsx` `buildDates` helper style).

The two test files are created within the SAME plan/wave as the code they test (lib + lib-test in 26-01; section + section-test in 26-02), so there is no cross-wave Wave-0 gap — each plan's Task 2 is its own test scaffold.

---

## Manual-Only Verifications

*None.* All phase behaviors have automated verification — the phase is pure math + a presentational section, both fully unit/component-testable without a live environment, a browser, or external credentials. (The `human_verify_mode` is not end-of-phase for this phase; the honesty contract is enforced entirely by the falsifiable test matrix above.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (each plan's Task 2 creates its own test file in-wave)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has an automated verify)
- [x] Wave 0 covers all MISSING references (both test files are MISSING and are created by the plans themselves)
- [x] No watch-mode flags (`vitest run`, never `vitest --watch`)
- [x] Feedback latency < 5s for the per-task quick run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-22
