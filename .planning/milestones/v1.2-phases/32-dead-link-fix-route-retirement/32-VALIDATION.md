---
phase: 32
slug: dead-link-fix-route-retirement
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Generated from 32-RESEARCH.md §Validation Architecture; per-task commands mirror each PLAN's `<verify>` block.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.5 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~64 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted `npx vitest run <file>` + `npx tsc --noEmit`
- **After every plan wave:** Run `npx vitest run` (full suite)
- **Before `/gsd:verify-work`:** Full suite green + `npx knip` clean
- **Max feedback latency:** ~64 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 32-01-01 | 01 | 1 | FLOW-01 | T-32-01 | `?portfolio=` matched only against RLS-scoped owned-portfolio fetch; unowned id is a no-op | unit (TDD/Wave 0) | `npx vitest run src/components/portfolio/AddToPortfolio.test.tsx` | ❌ W0 (created RED) | ⬜ pending |
| 32-01-02 | 01 | 1 | FLOW-01 | T-32-01 | 2 portfolio links carry `?portfolio=`; 28 intentional landings untouched | source/integration | `npx tsc --noEmit && <discovery/crypto-sma non-test non-portfolio= count == 29>` | ✅ | ⬜ pending |
| 32-02-01 | 02 | 1 | FLOW-02 | T-32-03 | `/scenarios` 307 redirect; admin-client RLS-bypass read ELIMINATED | unit | `npx vitest run "src/app/(dashboard)/scenarios/page.test.ts" && test ! -f .../page.role-gate.test.ts` | ✅ | ⬜ pending |
| 32-02-02 | 02 | 1 | FLOW-02 | T-32-05 | composer self-loop removed; ScenarioBuilder retired with IMPACT-02 parity preserved | unit | `npx vitest run ".../ScenarioComposer.test.tsx" && test ! -f .../ScenarioBuilder.tsx` | ✅ | ⬜ pending |
| 32-03-01 | 03 | 2 | FLOW-03 | T-32-06 | single allocator nav entry; managers' `/portfolios` not orphaned | unit | `npx vitest run src/components/layout/Sidebar.test.tsx && grep -c '"/scenarios"' Sidebar.tsx == 0` | ✅ | ⬜ pending |
| 32-03-02 | 03 | 2 | FLOW-02, FLOW-03 | — | retirement invariants pinned (engine zero-diff + redirect + no nav/self-loop + `?portfolio=`); knip clean | guard | `npx vitest run src/__tests__/phase-32-frozen-spine-guards.test.ts && npx knip` | ❌ (created in this task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/components/portfolio/AddToPortfolio.test.tsx` — created RED in 32-01 Task 1 (TDD) before the pre-select wiring, then driven GREEN.

*All other tasks extend existing vitest infrastructure (no new framework install).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `/scenarios` → composer 307 in a real browser | FLOW-02 | jsdom cannot exercise the Next.js server redirect end-to-end | Post-ship `/qa`: navigate to `/scenarios`, confirm landing on `/allocations?tab=scenario` |
| New-allocator single-nav-entry journey | FLOW-03 | Visual/nav rendering | Post-ship `/qa`: confirm sidebar shows one allocator entry → blank-slate composer |
| Attach-back one-gesture UX from a portfolio | FLOW-01 | Real click-through of discovery → AddToPortfolio pre-select | Post-ship `/qa`: from a portfolio's "+ Add Strategy", add a strategy, confirm it attaches to that portfolio |

*Automated coverage proves the wiring (param read, insert path, redirect target, nav absence) in jsdom; the manual items confirm live UX post-deploy.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (6/6)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (AddToPortfolio.test.tsx)
- [x] No watch-mode flags
- [x] Feedback latency < 64s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-23
