---
phase: 38
slug: composer-factsheet-parity-blank-mode-fix
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-25
---

# Phase 38 — Validation Strategy

> Per-phase validation contract. The dominant risk is the EquityChart/DrawdownChart
> test blast radius against a BLOCKING coverage CI gate — budget for it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + jsdom (@testing-library/react), @vitest/coverage-v8 |
| **Config file** | `vitest.config.ts` (coverage ratchet: lines 82 / statements 80 / functions 74 / branches 72 — BLOCKING in CI `frontend-coverage`) |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/widgets/performance/"` |
| **Full suite command** | `npm test` (and `npm run test:coverage` for the CI gate) |
| **Estimated runtime** | perf dir ~seconds; full suite minutes |

---

## ⚠️ Load-bearing scope boundary (the planner MUST honor)

`src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` is ALSO the Overview
`EquityChartWidget` (used by `AllocationDashboardV2`, the Overview tab — OUT of scope). The
factsheet engine swap MUST be scoped to the **composer call sites only**
(`ScenarioComposer.tsx:2228/:2259`) — e.g. a new adapter component or a prop-gated render
path — so the Overview widget + its 328-line header test stay on the legacy render. A
naive in-place re-back of `EquityChart.tsx` regresses the Overview (out of scope).

## Seam (planner guidance — aligns with the governing principle)

Synthesize a minimal scenario-scoped `FactsheetPayload` and mount the REAL `TimeSeriesChart`
+ `MasterBrush` under ONE `FactsheetProvider` (the Q4 shared-window mechanism). This keeps the
factsheet files BYTE-IDENTICAL (the factsheet is the truth — do not edit it; its tests cannot
break by construction). Suppress the provider's URL + localStorage persistence for the composer
mount (else it rewrites the dashboard URL on every pan). Scenario blend → strategy line
(accent teal); benchmark → comparator (muted slate).

---

## Per-Task Verification Map

| Behavior | Requirement | Test Type | Automated Command | File | Status |
|----------|-------------|-----------|-------------------|------|--------|
| `buildScenarioFactsheetPayload` adapter maps scenario blend + benchmark → a valid minimal FactsheetPayload | PARITY-01 | unit (pure) | `npx vitest run ".../performance/scenario-factsheet-payload.test.ts"` | NEW (Wave 0) | ⬜ |
| Composer equity renders via TimeSeriesChart (interaction affordances present: tabIndex=0 + role + aria keyboard hint; MasterBrush present) | PARITY-01 | unit (render) | `npx vitest run ".../performance/EquityChart.scenario.test.tsx"` | rewrite | ⬜ |
| Shared brush-zoom window: equity + drawdown under one provider share xRange | PARITY-01 (Q4) | unit (interaction) | `npx vitest run ".../performance/scenario-shared-window.test.tsx"` | NEW (Wave 0) | ⬜ |
| Scenario = accent-teal strategy line; benchmark = muted comparator | PARITY-01 | unit (render/color) | same scenario suite | update | ⬜ |
| Width: ScenarioComposer.tsx:1810/:1860 + AllocationsTabs.tsx:127 = max-w-[1440px]; AllocationDashboardV2.tsx:157 stays 1100 | PARITY-02 | source assertion | `npx vitest run ".../composer-width.test.tsx"` | NEW (Wave 0) | ⬜ |
| Empty baseline + scenario → scenario overlay renders, NO synthetic baseline, PROJECTED pill present, "warming up" copy absent | PARITY-03 | unit (render) | scenario suite blank-slate case | ADD | ⬜ |
| DrawdownChart blank-slate guard unchanged + drawdown parity + shared window | PARITY-03 / Q4 | unit | `npx vitest run ".../performance/DrawdownChart.scenario.test.tsx"` | keep/extend | ⬜ |
| Factsheet TimeSeriesChart/MasterBrush/context tests stay GREEN (reuse, not fork) | guard | unit | `npx vitest run "src/app/factsheet/"` | must not regress | ⬜ |
| a11y/visual chart contracts stay green | guard | unit | `npx vitest run "tests/visual/chart-accessibility-layer.test.ts"` | must not regress | ⬜ |
| Net coverage does NOT regress below ratchet | gate | coverage | `npm run test:coverage` | gate | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Coverage gate (BLOCKING)

Re-backing the composer charts DELETES covered code (the legacy projection memo path) on the
composer path and ADDS new adapter code. Net coverage must not drop below the ratchet. Offset
by covering the new pure `buildScenarioFactsheetPayload` adapter thoroughly (cheap, high-value).
Decide & document whether deleted-projection tests are removed or repurposed.

---

## Wave 0 Requirements

- [ ] `.../performance/scenario-factsheet-payload.test.ts` — the new adapter (pure fn).
- [ ] `.../performance/scenario-shared-window.test.tsx` — Q4 shared xRange.
- [ ] `.../composer-width.test.tsx` (or extend a source-assertion test) — PARITY-02 (3 literals=1440; out-of-scope stays 1100).
- [ ] Blank-slate case in `EquityChart.scenario.test.tsx` — PARITY-03.

*No framework install needed — Vitest + RTL already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wheel-zoom / drag-pan / brush / keyboard nav feel identical to the factsheet on the live composer | PARITY-01 | Real pointer/wheel/keyboard gestures + visual feel are not fully assertable in jsdom (no layout/wheel deltas); authed SSR composer needs a logged-in browser | After deploy: open the Scenario tab on a book allocator, confirm wheel-zoom, drag-pan, brush-drag, and arrow-key window nav behave exactly as on a factsheet chart, and equity+drawdown share one window. |

---

## Validation Sign-Off

- [x] Every requirement has an automated verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Coverage ratchet is the phase gate
- [x] `nyquist_compliant: true`

**Approval:** approved 2026-06-25
