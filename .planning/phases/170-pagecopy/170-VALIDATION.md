---
phase: "170"
slug: "pagecopy"
status: validated
nyquist_compliant: true
wave_0_complete: false
created: "2026-09-27"
validated: "2026-09-27"
---

# Phase 170 — Validation Strategy

> Per-phase validation contract. Filled from 170-RESEARCH.md Validation Architecture and the 14 plans' `<automated>` commands. Regenerated 2026-09-27 after the plan-checker found the seeded template.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (jsdom) + Playwright 1.61.1 (chromium) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run <touched file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~170 seconds for a touched-file vitest run; seeded Playwright is CI-only |

---

## Sampling Rate

- **After every task commit:** the touched component's vitest file
- **After every plan wave:** `npm test` and `npx tsc --noEmit -p .`
- **Before `/gsd-verify-work`:** full vitest green, and the CI `e2e-seeded` layout-narrow rows green and bound to the head SHA
- **Max feedback latency:** 170 seconds for the per-task command

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 170-01-01 | 01 | 1 | T0 | T-170-01 | helper throws on a main overflow; no bypass flag | e2e self-test | `CI=1 npx playwright test e2e/reflow.spec.ts -g "helper self-test"` | Wave 0 | pending |
| 170-01-02 | 01 | 1 | T0 | T-170-02 | sweep viewports are 390/640/960 | e2e | `npx playwright test e2e/reflow-sweep-authed.spec.ts --list` | exists | pending |
| 170-02-01 | 02 | 1 | SC2-NOSCROLL | T-170-04 | seeded spec is wired in the spec and in ci.yml | static | `grep -c layout-narrow .github/workflows/ci.yml` | Wave 0 | pending |
| 170-02-02 | 02 | 1 | SC2-(a) | T-170-05 | geometry assertions exist at three viewports | static | `grep -c V390 e2e/layout-narrow.spec.ts` | Wave 0 | pending |
| 170-03-01 | 03 | 2 | SC2-(a) | T-170-06 | tab strip scrolls inside itself | vitest | `npx vitest run src/app/(dashboard)/allocations/AllocationsTabs.test.tsx` | exists | pending |
| 170-04-01 | 04 | 2 | (d)(f)(g) | T-170-08 | footer commit is one control inside a region | vitest | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx` | exists | pending |
| 170-05-01 | 05 | 2 | SC1-PRIVLINK | T-170-12 | private-link control is secondary and wraps | vitest | `npx vitest run src/app/(dashboard)/strategies/page.share-affordance.test.tsx` | exists | pending |
| 170-06-01 | 06 | 2 | SC2-MATCH | T-170-16 | viewport is not an authorization boundary | vitest | `npx vitest run src/components/admin/AllocatorMatchQueue` | extend | pending |
| 170-07-01 | 07 | 2 | SC2-HEADER | T-170-20 | signed-in header shows Go to app | vitest | `npx vitest run src/app/(marketing)` | extend | pending |
| 170-08-01 | 08 | 3 | SC2-PROFILE | T-170-22 | profile tabs scroll; Disconnect inside viewport | vitest | `npx vitest run src/components/ui/Tabs.test.tsx` | exists | pending |
| 170-09-01 | 09 | 3 | SC1-LAYERS | T-170-24 | blend window is one panel; cards default unchanged | vitest | `npx vitest run src/components/kpi/KpiPanel.test.tsx` | exists | pending |
| 170-10-01 | 10 | 3 | CHIP | T-170-14 | four chip sites at least 4.5:1; revert fails the gate | vitest | `npx vitest run tests/a11y/chip-contrast.test.ts` | Wave 0 | pending |
| 170-11-01 | 11 | 4 | (j) | T-170-30 | no factsheet edit until 169-04/05/10 are ancestors of HEAD | gate | plan 11 Task 1 gate command | n/a | pending |
| 170-11-02 | 11 | 4 | (j) | T-170-28 | KPI grid is 2 / 3 / full | vitest | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx` | exists | pending |
| 170-12-01 | 12 | 4 | SC1-LAYERS | T-170-33 | ControlBar voice change waits on the same 169 gate | gate | plan 12 Task 1 gate command | n/a | pending |
| 170-12-02 | 12 | 4 | SC1-PRIVLINK | T-170-31 | ControlBar actions are text-caption | vitest | `npx vitest run tests/visual/strategy-v2-type-scale.test.ts` | exists | pending |
| 170-13-01 | 13 | 5 | SC2-(c)(e) | T-170-35 | a wrap happens only when the census names the file | record | census bound to a SHA in 170-11-SUMMARY.md | n/a | pending |
| 170-13-02 | 13 | 5 | R169-(a) | T-170-34 | ended record reads Final month; current month stays Month-to-date | vitest | `npx vitest run src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx` | Wave 0 | pending |
| 170-14-01 | 14 | 6 | SC3 | T-170-37 | post-deploy pass bound to the deploy SHA | manual | `test -f .planning/phases/170-pagecopy/170-UAT.md` | n/a | pending |

*Status: pending until the owning plan runs. Wave 0 files are created by plans 01, 02, 10, and 13.*

---

## Wave 0 Requirements

- [ ] `e2e/helpers/reflow.ts` — measure `#main-content`; emit `LAYOUT-NARROW-OFFENDER` / `LAYOUT-NARROW-CLEAN` (plan 01)
- [ ] `e2e/layout-narrow.spec.ts` — 390/640/960 geometry rows, wired in ci.yml (plan 02)
- [ ] `tests/a11y/chip-contrast.test.ts` — four sites, tokens read from source (plan 10)
- [ ] `src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx` — both clock branches, after 169 (plan 13)

Existing vitest and Playwright infrastructure covers every other phase requirement.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No page scroll and no clipped primary action after deploy | SC3 | A deployed host in a logged-in browser is the criterion the roadmap names | Plan 14: open each SC3 route at 390x844, 640x400, 960x540; record scrollWidth minus clientWidth |
| Founder answers on deletion and the venue-label site | C1, FC-2 | The founder owns both; the plan must not guess | Plan 14 Task 2 |

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify or a named Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency target is the per-task vitest run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-27
