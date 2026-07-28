---
phase: 47
slug: hand-rolled-svg-charts-touch-legibility-portrait
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-27
---

# Phase 47 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/component) + Playwright (e2e: parity/portrait, target-size, reflow) |
| **Config file** | `vitest.config.ts` + `playwright.config.ts` |
| **Quick run command** | `npx vitest run <changed test files>` |
| **Full suite command** | `npm run test` (vitest) + `npx playwright test <phase-47 specs>` |
| **Estimated runtime** | ~varies (vitest fast; e2e seeded slower) |

---

## Sampling Rate

- **After every task commit:** Run the changed-file vitest set
- **After every plan wave:** Run the full vitest suite + the phase-47 Playwright specs
- **Before `/gsd:verify-work`:** Full suite must be green; SCENARIO-05 + BODY-02 + chart-parity un-weakened
- **Max feedback latency:** keep unit feedback under ~60s

---

## Per-Task Verification Map

*Populated by the planner / nyquist auditor from the PLAN.md tasks. Each task maps to a
requirement (CHART-01a / CHART-02 / CHART-03) and an automated command.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-T1 | 02 | 1 | CHART-02/03 | T-47-02-INTEG | desktop byte-identity (no recompute) | unit (tsc) | `npx tsc --noEmit` (0 in DistributionPanels) | ⬜ | ⬜ pending |
| 02-T2 | 02 | 1 | CHART-02/03 | T-47-02-INTEG | desktop byte-identity (no recompute) | unit (grep+tsc) | grep useBreakpoint/RCF + `npx tsc --noEmit` | ⬜ | ⬜ pending |
| 02-T3 | 02 | 1 | CHART-02/03 | T-47-02-INTEG | brush intact, no tap-reveal | unit (grep+tsc) | grep useBreakpoint/RCF, !useTapPin + `npx tsc --noEmit` | ⬜ | ⬜ pending |
| 02-T4 | 02 | 1 | CHART-02/03 | T-47-02-INTEG | both isMobile branches covered in-wave + desktop viewBox byte-identity | component | `npx vitest run src/app/factsheet/[id]/v2/no-hover-panels-viewport.test.tsx` | ⬜ | ⬜ pending |
| 03-T1 | 03 | 2 | CHART-01a/02/03 | T-47-03-INTEG/OOB | tap-pin parity, ≥44px, desktop hover preserved | unit (grep+tsc) | grep useTapPin/RCF/useBreakpoint/`<title>` + `npx tsc --noEmit` | ⬜ | ⬜ pending |
| 03-T2 | 03 | 2 | CHART-01a/02/03 | T-47-03-INTEG/OOB | tap-pin parity, ≥44px, onPointerMove preserved | unit (grep+tsc) | grep useTapPin/useBreakpoint/onPointerMove + `npx tsc --noEmit` | ⬜ | ⬜ pending |
| 03-T3 | 03 | 2 | CHART-01a/02/03 | T-47-03-INTEG | tap-pin parity + isMobile branch + no fill-opacity/cell-drop | component | `npx vitest run src/components/charts/DailyHeatmap.test.tsx` + `tests/visual/strategy-v2-type-scale.test.ts` | ✅ (extended) | ⬜ pending |
| 03-T4 | 03 | 2 | CHART-02/03 | T-47-03-INTEG | both isMobile branches covered in-wave + StreakDistribution tap path + desktop viewBox byte-identity | component | `npx vitest run src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx` | ⬜ | ⬜ pending |
| 04-T1 | 04 | 1 | CHART-02/03 | T-47-04-INTEG | RCF wrap + both isMobile branches + desktop byte-identity; Sparkline NO-OP | component | `npx vitest run src/components/charts/ReturnQuantiles.test.tsx` | ✅ (extended) | ⬜ pending |
| 04-T2 | 04 | 1 | CHART-02/03 | T-47-04-INTEG/A11Y | role=img preserved + both isMobile branches + falsifiable desktop fontSize=12 | component | `npx vitest run src/app/(dashboard)/allocations/components/MonteCarloBandChart.test.tsx` | ⬜ | ⬜ pending |
| 05-T1 | 05 | 3 | CHART-02/03 | T-47-05-INTEG | desktop goldens + 320px portrait snapshots | e2e (seeded) | `npx playwright test e2e/svg-chart-parity.spec.ts` | ⬜ W0 | ⬜ pending |
| 05-T2 | 05 | 3 | CHART-01a | T-47-05-INTEG | ≥44px chart tap-rects at 320px | e2e (seeded) | `npx playwright test e2e/target-size.spec.ts` | ⬜ W0 | ⬜ pending |
| 05-T3 | 05 | 3 | CHART-01a/02/03 | T-47-05-FALSEGREEN/RATCHET | FLOW-01 wired + coverage ratchet held + SCENARIO-05 green | unit+ci | `npm run test:coverage` + `npx vitest run src/__tests__/phase-31-frozen-spine-guards.test.ts` | ⬜ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Fresh Phase-47 SVG parity/portrait Playwright spec (desktop byte-identity goldens + 320px portrait snapshots) — do NOT reuse the dead `e2e/strategy-v2-chart-parity.spec.ts` *(Plan 05 Task 1)*
- [ ] Extend `e2e/target-size.spec.ts` to assert chart tap-pin hit areas ≥44px *(Plan 05 Task 2)*
- [x] Unit/component tests for new `useBreakpoint`-driven viewport conditionals (hold the coverage ratchet branches) — **NOW MAPPED TO TASKS (revision 2026-06-27): Plan 02 Task 4 (`no-hover-panels-viewport.test.tsx`, Wave 1) covers the 5 no-hover panels in both isMobile branches; Plan 03 Task 4 (`tap-charts-viewport.test.tsx`, Wave 2) + extended Plan 03 Task 3 (`DailyHeatmap.test.tsx`) cover the 3 tap charts; Plan 04 Task 1 (extended `ReturnQuantiles.test.tsx`, Wave 1) + Plan 04 Task 2 (`MonteCarloBandChart.test.tsx`, Wave 1) cover the standalone charts. Each tuned chart is rendered with isMobile=true AND isMobile=false (mock `useBreakpoint`) so both branches are exercised in the SAME wave they are introduced — NOT deferred to the Plan 05 ratchet gate. Sparkline is a NO-OP (no new branch). Zero net-new npm deps (vitest + @testing-library/react only).**
- [ ] MonteCarloBandChart Vitest component snapshot (seeded scenario route yields 0 positions → won't render in e2e) *(Plan 04 Task 2 — also renders both isMobile branches)*

*Existing frozen guards reused (no Wave 0 work): `src/__tests__/phase-31-frozen-spine-guards.test.ts` (SCENARIO-05), BODY-02 byte-identity, compute.ts parity.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device touch tap-pin feel on a phone | CHART-01a | Headless can't fully replicate touch ergonomics; final acceptance is the Phase-48 real-device authed sign-off | Tap a chart on a real phone; value pins, re-tap toggles off |

*Automated coverage proves the contract (≥44px target-size gate, portrait snapshot legibility, parity byte-identity, in-wave viewport-branch coverage); the manual check is ergonomic confirmation, deferred to the Phase-48 device sign-off.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — branch-coverage viewport tests now mapped to in-wave tasks (Plan 02 T4 / Plan 03 T3+T4 / Plan 04 T1+T2)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
