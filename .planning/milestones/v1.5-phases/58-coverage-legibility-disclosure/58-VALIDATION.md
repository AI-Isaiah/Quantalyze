---
phase: 58
slug: coverage-legibility-disclosure
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-01
---

# Phase 58 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (component/unit) + Playwright (axe e2e) |
| **Config file** | `vitest.config.ts` + `playwright.config.ts` |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/components/"` |
| **Full suite command** | `npm run test` (frontend) / `npm run test:coverage` (blocking ratchet) |
| **Estimated runtime** | ~seconds (vitest); e2e/axe separate |

---

## Sampling Rate

- **After every task commit:** the touched component's colocated test + `ScenarioComposer.test.tsx`
- **After every plan wave:** `npm run test` (full frontend suite — frozen-spine + BLEND-07 + parity guards must stay green)
- **Before `/gsd:verify-work`:** `npm run test:coverage` (blocking ratchet green) + `npx playwright test e2e/composer-axe.spec.ts` green
- **Max feedback latency:** < 60 seconds (unit); e2e/axe at wave boundaries

---

## Per-Task Verification Map

*(Every requirement observable mapped to its test seam. Presentation-only phase; the load-bearing
correctness oracle throughout is the REAL `computeScenario.member_count` — the header/chips/gantt
membership must equal it, enforced by the `:1813` dev desync guard + the composer integration tests.)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 58-01 T1 | 01 | 1 | COVERAGE-03 | T-58-01 | Header reads engine `member_count`/`effective_*`; never re-derives divisor | unit component | `npx vitest run "src/app/(dashboard)/allocations/components/BlendHeader.test.tsx"` | ❌ W0 | ⬜ pending |
| 58-01 T2 | 01 | 1 | COVERAGE-02 (in-blend/manual) | T-58-02 | 3-state chip; state from props, not local `covers()`; text carries meaning | unit component | `npx vitest run "src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx"` | ❌ W0 | ⬜ pending |
| 58-01 T3 | 01 | 1 | COVERAGE-02, COVERAGE-03 | T-58-01, T-58-03 | Header N === REAL engine member_count as window moves; storage prefix purge-registered | integration + purge | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" "src/components/auth/SignOutButton.test.tsx"` | ✅ (extend) | ⬜ pending |
| 58-02 T1 | 02 | 2 | COVERAGE-02 (auto-excluded), COVERAGE-04 | T-58-04, T-58-05 | Amber chip + include button; include reuses `applyWindow`+`intersectionOf`; never mutates `selected` | (covered by T2) | — | — | ⬜ pending |
| 58-02 T2 | 02 | 2 | COVERAGE-04 | T-58-04, T-58-05, T-58-06 | Include label shows cost; click raises REAL engine member_count (B becomes member); manual-off not reselected | integration (composer) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ✅ (extend) | ⬜ pending |
| 58-03 T1 | 03 | 3 | COVERAGE-01 | T-58-10 | Bar-per-row; accent/muted/amber encoding; `utcEpoch` scale (no `new Date`); aria-label per bar; collapsed default | unit component | `npx vitest run "src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx"` | ❌ W0 | ⬜ pending |
| 58-03 T2 | 03 | 3 | POLISH-03 | T-58-07, T-58-08 | Note shown iff intersection truncates union AND not dismissed; SSR-safe (no flash); dismiss persists via `useCrossTabStorage`; escape hatch calls `applyWindow(fullRange)`; role=status | unit component + hydrate | `npx vitest run "src/app/(dashboard)/allocations/components/DefaultChangeNote.test.tsx"` | ❌ W0 | ⬜ pending |
| 58-03 T3 | 03 | 3 | COVERAGE-01, POLISH-03 | T-58-09 | Both wired from existing memos (no re-derive); composer-axe anchors extended (no new spec/ci.yml) | integration (composer) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ✅ (extend) | ⬜ pending |
| ALL | 01–03 | gate | COVERAGE-01…04, POLISH-03 | all | Zero serious/critical WCAG-AA violations on the composed `/allocations?tab=scenario` `<main>` (chips, gantt, note, header) | e2e axe | `npx playwright test e2e/composer-axe.spec.ts` | ✅ (extend anchors) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Coverage ratchet (lines 82 / statements 80 / functions 74 / branches 72) is a BLOCKING CI gate —
new child components MUST ship with colocated tests. These test files are created alongside their
components (TDD, `tdd="true"`) in the SAME task, so there is no separate Wave-0 pass, but each is
tracked as a MISSING-until-created seam:

- [ ] `BlendHeader.test.tsx` — COVERAGE-03 (4 degrade branches: N=0 / N=1 / normal / truncated) — created in 58-01 T1
- [ ] `CoverageStateChip.test.tsx` — COVERAGE-02 (3 states × token classes × label) — created in 58-01 T2
- [ ] `CoverageTimeline.test.tsx` — COVERAGE-01 (bar encoding, window band, aria-label, collapsed default, no-new-Date) — created in 58-03 T1
- [ ] `DefaultChangeNote.test.tsx` — POLISH-03 (shown/hidden/dismissed/escape-hatch/role=status) — created in 58-03 T2
- [ ] Extend `ScenarioComposer.test.tsx` Phase-57 window block with COVERAGE-03 (58-01 T3) + COVERAGE-04 (58-02 T2) integration assertions (reuse the picker-capture + REAL-computeScenario rig at :185/:5138) — NO new spec, NO new HAS_SEED_ENV const, NO ci.yml entry
- [ ] Extend `e2e/composer-axe.spec.ts` composed-surface anchors to gate on the new blend-header + gantt (58-03 T3) — spec already CI-wired (FLOW-01 does not apply)
- [ ] Register the POLISH-03 localStorage prefix in `storage-namespaces.ts` + add the `KNOWN_APP_KEYS` entry in `SignOutButton.test.tsx` (58-01 T3)

*Framework install: none — Vitest + Playwright + coverage-v8 already present.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual mini-gantt bar proportions / window band overlay alignment | COVERAGE-01 | Pixel layout best confirmed visually | Open /allocations scenario composer, expand "Coverage timeline", confirm bars + shaded window band align with the axis endpoints |
| Blend header as the primary visual anchor (hierarchy) | COVERAGE-03 | Visual weight/priority is a design judgement | Confirm the header reads first, above the window control; timeline/chips subordinate |

*Most phase behaviors have automated verification (DOM/copy/aria assertions + axe).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are covered by a sibling task's automated verify (58-02 T1 by T2)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task's touched code is exercised by a vitest run in the same wave)
- [x] Wave 0 covers all MISSING references (4 new colocated tests + 2 extended integration seams + storage purge coverage)
- [x] No watch-mode flags (all commands are `vitest run` / `playwright test`, non-interactive)
- [x] Feedback latency < 60s (unit component tests)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned
