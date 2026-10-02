---
phase: 40
slug: mount-the-real-factsheet-body
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom) + @testing-library/react |
| **Config file** | `vitest.config.ts` (thresholds lines 82 / fns 74 / branches 72 / stmts 80) |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/widgets/performance/" "src/app/factsheet/[id]/v2/" --no-file-parallelism` |
| **Full suite command** | `npm run test:coverage` (blocking CI gate) |
| **Estimated runtime** | quick ~15s · full ~minutes |

---

## Sampling Rate

- **Per task commit:** quick command on the two touched dirs (`--no-file-parallelism` to avoid the documented local contention flake).
- **Per wave merge:** full suite + coverage ratchet.
- **Before verify:** full suite green + coverage ratchet green + `tsc --noEmit`. (Composer-axe e2e is Phase 43, not a Phase-40 gate.)

---

## Per-Task Verification Map

| Task | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File | Status |
|------|------|-------------|-----------------|-----------|-------------------|------|--------|
| mount body | 1 | BODY-01 | render real FactsheetBody under one persist=false provider | unit | quick on `scenario-shared-window.test.tsx` | ✅ UPDATE | ⬜ |
| scenarioMode | 1 | BODY-02 | default ≡ scenarioMode=false; true suppresses Share+Compare | unit | `FactsheetBody.scenario-mode.test.tsx` | ❌ W0 | ⬜ |
| degenerate render | 1 | BODY-03 | body renders across safe-empty/single/sub-N/healthy/non-finite, no NaN/Infinity in SVG | unit | `FactsheetBody.degenerate.test.tsx` | ❌ W0 | ⬜ |
| api panels absent | 1 | BODY-04 | allocator/signatures/peer absent on csv blend | unit | inside degenerate test + `audit-c20.test.ts` | ✅ partial | ⬜ |
| byte-identity | 1 | BODY-02 (route) | real v2 route + Overview EquityChartWidget unchanged | unit | existing `EquityChart*.test.tsx` stay green (negative confirmation) | ✅ exists | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx` — BODY-03 (+ BODY-04 render-absence). Needs the localStorage + sentry stub block (copy `scenario-shared-window.test.tsx:24-43`).
- [ ] `src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx` — BODY-02 (prop equivalence + Share/Compare suppression). Same stub block.
- [ ] Update `scenario-shared-window.test.tsx` (relax `===2` SVG count; re-point `equity-chart-scenario-overlay` testid to `topSlot`).
- [ ] Verify `EquityChart.scenario.test.tsx` PARITY-03 selectors still resolve.
- No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual parity feel of the mounted body | BODY-01 | Requires authed live composer (Chromium); CI axe/render proves structure | Phase 43 composer-axe e2e + a post-deploy authed canary cover this; not a Phase-40 unit gate. |

---

## Key Landmine (from RESEARCH)

`ScenarioComposer.test.tsx:3377-3393` is a static source guard that FAILS if `ScenarioComposer.tsx` contains the literal `FactsheetBody`. The mount MUST live in `ScenarioFactsheetChart.tsx` (which `ScenarioComposer.test.tsx` mocks). Never inline the body in the composer.
