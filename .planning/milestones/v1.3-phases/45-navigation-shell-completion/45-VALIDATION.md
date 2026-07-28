---
phase: 45
slug: navigation-shell-completion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-27
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit) + Playwright (e2e, incl. new seeded drawer-keyboard spec) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command** | `npx vitest run <touched test file>` |
| **Full suite command** | `npm run test:coverage` (ratchet: lines 82 / stmts 80 / fns 74 / branches 72) |
| **Estimated runtime** | unit ~5–30s/file; seeded e2e needs the seeded test DB + dev server |

## Sampling Rate
- After every task commit: the touched unit test (`npx vitest run <file>`).
- After every wave: `npm run test:coverage`.
- Before verify: full suite green + ratchet held; the new drawer-keyboard e2e proven to run in CI.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| (planner fills) | | | NAV-01/02/03 | unit/e2e | | ⬜ pending |

## Wave 0 Requirements
- Existing infra covers it (vitest + Playwright configured; Phase 44 reflow/target-size helpers reused).

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| New seeded drawer-keyboard e2e ACTUALLY runs in CI (FLOW-01) | NAV-03 | A seeded spec not wired into BOTH the HAS_SEED_ENV guard AND ci.yml MA-8 list silently never runs | After CI, confirm the spec name appears `passed` (not skipped) in the seed-gated e2e job log |
| Real-device authed nav walkthrough | NAV-01/02/03 | Headless can't hydrate authed pages | A human taps the bottom nav + drawer + tab strip on a real phone |

## Validation Sign-Off
- [ ] All tasks have `<automated>` verify or Wave 0 deps
- [ ] No 3 consecutive tasks without automated verify
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set when execution closes

**Approval:** pending
