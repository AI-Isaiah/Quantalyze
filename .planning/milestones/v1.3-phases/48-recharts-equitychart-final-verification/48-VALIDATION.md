---
phase: 48
slug: recharts-equitychart-final-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-28
---

# Phase 48 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit/component) + Playwright (e2e) + `@lhci/cli` (perf budget, net-new) |
| **Config file** | `vitest.config.ts` (coverage ratchet lines 82 / stmts 80 / fns 74 / branches 72); `playwright.config.ts` (Desktop Chrome, CI workers=1, retries=2); `lighthouserc.json` (Wave 0 installs) |
| **Quick run command** | `npx vitest run <file>` (unit) · `npx playwright test <spec> --project=chromium` (e2e) |
| **Full suite command** | `npm run test` (vitest) · `npm run test:coverage` (coverage gate) · seeded MA-8 `npx playwright test` list (CI) · `npx lhci autorun` |
| **Estimated runtime** | unit ~60s · seeded e2e ~minutes (CI) · lhci ~1-2min/route |

---

## Sampling Rate

- **After every task commit:** Run the touched spec/test — `npx vitest run <file>` or `npx playwright test <spec> --project=chromium`
- **After every plan wave:** Run `npm run test` + the seeded MA-8 Playwright list + `npm run test:coverage`
- **Before `/gsd:verify-work`:** Full Vitest suite green + coverage ≥ thresholds + seeded MA-8 list green in a REAL CI run (FLOW-01 proof) + new `lighthouse-mobile` job green + all frozen-math/byte-identity/parity guards green
- **Max feedback latency:** ~60s (unit); CI for the seeded/lhci layers

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| CHART-01b | `TouchTooltip` injects `trigger="click"` on mobile, `"hover"` on desktop; spreads `formatter`/`contentStyle` | unit/component | `npx vitest run src/components/charts/TouchTooltip.test.tsx` | ❌ W0 | ⬜ pending |
| CHART-01b | Each chart-family desktop render byte-identical (trigger defaults hover) | component snapshot | `npx vitest run <chart>.test.tsx` (extend existing per-chart) | ⚠️ extend | ⬜ pending |
| CHART-01b | `OutcomesWidget` sparkline unchanged (parity-only — no `trigger`, no `<Tooltip>`) | component | existing OutcomesWidget test | ⚠️ verify | ⬜ pending |
| CHART-01b | EquityChart `pointerToIndex` maps px→nearestIndex identically to `handleMove` | unit | EquityChart touch-path test (extract `pointerToIndex` pure-fn or mount+synthetic pointer) | ❌ W0 | ⬜ pending |
| CHART-01b | EquityChart desktop mouse path byte-identical (`hoverIdx` via `onMouseMove`) | component | existing EquityChart test | ⚠️ verify | ⬜ pending |
| CHART-01b | EquityChart tap-pin hit area ≥44px under `pointer-coarse` @ 320px on /allocations | e2e (seeded, coarse) | `npx playwright test e2e/target-size.spec.ts` (extended) | ⚠️ extend | ⬜ pending |
| A11Y-01 | Zero WCAG-AA violations across all primary routes × {Desktop, mobile 375} | e2e (seeded+unseeded) | `npx playwright test e2e/axe-app-wide.spec.ts` | ❌ W0 | ⬜ pending |
| A11Y-01 | Embedded factsheet → serious+critical=0 (NO rule disabled; composer-axe L208-212 precedent) | e2e | within axe-app-wide | ❌ W0 | ⬜ pending |
| A11Y-01 | 320px reflow blocking app-wide | e2e | `npx playwright test e2e/reflow-sweep.spec.ts e2e/reflow-sweep-authed.spec.ts` | ✅ verify | ⬜ pending |
| A11Y-01 | zoom-meta grep blocking | unit | `npx vitest run tests/visual/viewport-zoom-meta.test.ts` | ✅ verify | ⬜ pending |
| A11Y-01 | mobile keyboard/focus blocking | e2e | `npx playwright test e2e/mobile-drawer-keyboard.spec.ts e2e/strategy-v2-keyboard.spec.ts` | ✅ verify | ⬜ pending |
| A11Y-03 | Mobile perf score ≥ seeded floor on public routes | CI (lhci) | `npx lhci autorun` (lighthouserc.json) | ❌ W0 | ⬜ pending |
| A11Y-03 | No ResizeObserver-loop console error + stable memory on rotate | e2e | folded into existing mobile e2e (`page.on("console")`/`pageerror`) | ❌ W0 | ⬜ pending |
| guard | scenario.ts zero-diff (SCENARIO-05) | unit (git-diff) | `npx vitest run src/__tests__/phase-31-frozen-spine-guards.test.ts` | ✅ stay green | ⬜ pending |
| guard | accessibilityLayer={false} grep (whole codebase) | unit | `npx vitest run tests/visual/chart-accessibility-layer.test.ts` | ✅ stay green | ⬜ pending |
| guard | svg-chart-parity goldens (Phase-47 carryover, self-skips) | e2e | `npx playwright test e2e/svg-chart-parity.spec.ts` | ✅ no false-green | ⬜ pending |
| guard | coverage ratchet held (never lowered) | unit (coverage) | `npm run test:coverage` | ✅ ≥ thresholds | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install --save-dev @lhci/cli@0.15.1` — the single allowed net-new dep (A11Y-03 cannot ship without it)
- [ ] `src/components/charts/TouchTooltip.test.tsx` — CHART-01b trigger gating (mobile→click, desktop→hover, props spread); mock `useBreakpoint`
- [ ] EquityChart touch-path test — CHART-01b `pointerToIndex`/tap-pin parity with `hoverIdx`
- [ ] `e2e/axe-app-wide.spec.ts` — A11Y-01 route × viewport matrix (+ `HAS_SEED_ENV` const; + ci.yml dual-wire BOTH lists)
- [ ] `lighthouserc.json` + `lighthouse-mobile` CI job — A11Y-03 (seed thresholds from baseline; mobile preset; public routes)
- [ ] Rotate-stability assertion folded into an existing mobile e2e — A11Y-03 SC#4

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device authed tap-to-pin walkthrough across authed surfaces | CHART-01b / SC#5 | Headless browser cannot hydrate authed pages (documented limitation) | Run the `48-HUMAN-UAT.md` real-device checklist on a phone against prod/preview after deploy |
| Tooltip tap-to-pin "feels right" on a real touchscreen (no accidental drag-dismiss) | CHART-01b | Touch-feel is subjective; coarse-pointer emulation proves geometry not feel | Tap each chart family on a real phone; confirm pin shows + survives, re-tap dismisses |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (TouchTooltip test, EquityChart touch test, axe-app-wide, lighthouserc, rotate-stability, @lhci/cli install)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (unit layer)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner wires Wave 0)

**Approval:** pending
