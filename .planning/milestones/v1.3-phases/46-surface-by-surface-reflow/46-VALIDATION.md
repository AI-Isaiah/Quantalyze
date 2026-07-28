---
phase: 46
slug: surface-by-surface-reflow
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-27
---

# Phase 46 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 46-RESEARCH.md §Validation Architecture. The planner fills the Per-Task Verification Map (Dimension 8); a later /gsd:validate-phase pass may audit coverage.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit/component) + Playwright 1.59 (e2e reflow/target-size gates) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command** | `npm run test` (vitest run) |
| **Full suite command** | `npm run test:coverage` (ratchet gate) + `npx playwright test e2e/reflow.spec.ts e2e/reflow-sweep.spec.ts e2e/target-size.spec.ts` |
| **Estimated runtime** | ~70s vitest; e2e per-spec ~2-3 min in CI |

---

## Sampling Rate

- **After every task commit:** Run the touched files' vitest specs (`npx vitest run <file> --reporter=dot`) + the fast unseeded reflow probe (`npx playwright test e2e/reflow.spec.ts`).
- **After every plan wave:** Run `npm run test` (full vitest) + the affected reflow e2e at 320px.
- **Before verify:** `npm run test:coverage` MUST be green (the ratchet is a hard gate — deleting `DesktopGate.test.tsx` + adding guard tests shifts the denominator, so the net must be MEASURED, not assumed) AND `npx tsc --noEmit` clean AND the parametrized reflow sweep green (public unseeded locally; authed seeded in CI).
- **Max feedback latency:** ~90s (vitest); e2e proven in CI (FLOW-01).

---

## Per-Task Verification Map

> Filled by the planner (Dimension 8). Each table-wrap / wizard / sweep task maps to an observable signal below. No task introduces a new data flow (all CSS-first / test-only), so "Secure Behavior" is the verify-no-regress on the wizard auth gate where applicable.

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 46-01-T1 | 46-01 | 1 | TABLE-01 | N/A (CSS scroll wrapper) | unit (render) | `npx vitest run src/app/(dashboard)/allocations/components/HoldingsTable --reporter=dot` | ⬜ pending |
| 46-01-T2 | 46-01 | 1 | TABLE-01 (SC#2) | N/A | unit (render guard, falsifiable) | `npx vitest run src/app/(dashboard)/allocations/components/HoldingsTable.all-columns.test.tsx --reporter=dot` | ⬜ pending |
| 46-02-T1 | 46-02 | 1 | TABLE-01 | N/A (preserve inline hex) | unit (render) | `npx vitest run ScenarioCompareTable CorrelationMatrix ComputeJobsTable --reporter=dot` | ⬜ pending |
| 46-02-T2 | 46-02 | 1 | TABLE-01 (SC#2) | N/A | unit (render guard, falsifiable) | `npx vitest run ScenarioCompareTable.all-columns CorrelationMatrix.all-columns --reporter=dot` | ⬜ pending |
| 46-03-T1 | 46-03 | 1 | WIZARD-01 (SC#3) | PRESERVE `supabase.auth.getUser → redirect /login` (T-46-03-EoP) | unit + e2e | `npx tsc --noEmit && npx vitest run src/app/(dashboard)/strategies/new/wizard --reporter=dot` | ⬜ pending |
| 46-03-T2 | 46-03 | 1 | WIZARD-01 (SC#3) | N/A (layout-only; no new matchMedia) | unit | `npx vitest run src/app/(dashboard)/strategies/new/wizard --reporter=dot` | ⬜ pending |
| 46-03-T3 | 46-03 | 1 | WIZARD-01 (SC#5) | N/A | coverage (checkpoint) | `npm run test:coverage` (all 4 ratchet metrics measured) | ⬜ pending |
| 46-04-T1 | 46-04 | 2 | REFLOW-03 | N/A | unit (verify fluid) | `npx tsc --noEmit && npx vitest run EmptyStateCard Skeleton --reporter=dot` | ⬜ pending |
| 46-04-T2 | 46-04 | 2 | REFLOW-01/02 | N/A | e2e (public sweep, unseeded) | `npx playwright test e2e/reflow-sweep.spec.ts --reporter=line` | ⬜ pending |
| 46-04-T3 | 46-04 | 2 | REFLOW-01/03 | N/A (uses CI-gated test seed) | e2e (authed sweep + degenerate route, seeded) | `npx playwright test e2e/reflow-sweep-authed.spec.ts` (skips w/o seed; CI proves) | ⬜ pending |
| 46-04-T4 | 46-04 | 2 | REFLOW-01/02/03 (FLOW-01) | N/A | checkpoint (CI proven-execution + coverage) | inspect CI run: both sweeps PASSED-not-skipped + `npm run test:coverage` | ⬜ pending |

---

## Validation Architecture (from RESEARCH.md — observable signals per SC)

- **SC#1 (every route reflows at 320px / 400%)** → parametrized Playwright `assertNoReflow` over a curated authed+public route list (46-04 T2/T3); `scrollWidth <= clientWidth + 1px` anchored on a visible content element (no false-green on blank/login).
- **SC#2 (no dropped material columns)** → render-test guards on the 4 highest-stakes tables (46-01 T2 holdings legacy-7/design-9; 46-02 T2 ScenarioCompareTable/CorrelationMatrix) asserting the FULL material `<th>` set is present (anchored on the CODE constants `TOTAL_COLUMNS=7` legacy / `DESIGN_TOTAL_COLUMNS=9` design — NOT the UI-SPEC's inverted "NEW/legacy" names); falsifiable (fails on a deleted column, then restored).
- **SC#3 (wizard usable on phone)** → wizard renders `children` at all widths (DesktopGate narrow branch deleted, 46-03 T1); `<Suspense key={source}>` boundary + server auth gate preserved; wizard route in the authed sweep at 320px (46-04 T3).
- **SC#4 (honest states unbroken)** → the authed sweep includes ≥1 degenerate-state route (EmptyStateCard heading or `data-testid="correlation-matrix"` empty branch) at 320px (46-04 T3); honest-state components verified fluid (46-04 T1).
- **SC#5 (no new hydration warning + coverage holds)** → `npm run test:coverage` net measured ≥ ratchet (46-03 T3 + 46-04 T4 checkpoints); no console hydration warning on retrofitted routes (the de-block removes a viewport branch, so SSR/client markup converges; `wizard-hydration-probe.spec.ts` stays green).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device 400% pinch-zoom feel | REFLOW-02 | No CI harness for real-device gesture zoom | Deferred to phase 48 real-device authed sign-off |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Coverage ratchet net measured (not assumed) after DesktopGate.test deletion (46-03 T3 + 46-04 T4 checkpoints)
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set after planner filled the map

**Approval:** pending
