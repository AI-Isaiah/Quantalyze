---
phase: "195"
slug: "trim-leftover-and-duplicate-surfaces-are-gone"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-07"
---

# Phase 195 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom + node projects via `vitest.node-env.ts`); Playwright e2e runs in CI only |
| **Config file** | `vitest.config.ts`, `vitest.node-env.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run <targeted files>` plus `npx tsc --noEmit` |
| **Full suite command** | `npx vitest run` (2 known pre-existing failures in `compute.conventions.test.ts`), `npm run lint`, `npx tsc --noEmit` |
| **Estimated runtime** | ~30 seconds targeted; several minutes full suite |

`next build` fails locally on the symlinked `node_modules` and is NOT a gate.

---

## Sampling Rate

- **After every task commit:** the targeted vitest files for that task plus `npx tsc --noEmit`
- **After every plan wave:** `npm run lint` and `npx vitest run src/__tests__ src/lib "src/app/(dashboard)"`
- **Before `/gsd-verify-work`:** full `npx vitest run` (only the 2 known failures allowed), `npm run lint`, `npx tsc --noEmit`, then the D-10 neuter → RED → restore-from-byte-backup proofs
- **Max feedback latency:** 120 seconds per targeted run

---

## Per-Task Verification Map

Filled by the planner per task (each task's `<automated>` verify). Requirement-level map from RESEARCH.md § Validation Architecture:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| LEAN-03 | `/portfolios*`, `/decks`, `/api/portfolio-pdf` redirect; manifest valid | lint + unit | `npm run check:route-contract`; `npx vitest run src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.ts` | ❌ W0 | ⬜ pending |
| LEAN-03 | retired report page renders for any id, no session, reads nothing | unit | `npx vitest run "src/app/portfolio-pdf/[id]/page.test.tsx"` | ❌ W0 | ⬜ pending |
| LEAN-03 | no link to removed routes; Decks absent from nav | unit | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx` | ✅ edit | ⬜ pending |
| LEAN-03 | OWN-03 invariant intact after writer removal | unit | `npx vitest run src/__tests__/phase-150-capital-ownership-invariant.test.ts src/__tests__/phase-32-frozen-spine-guards.test.ts` | ✅ edit | ⬜ pending |
| LEAN-07 | Tweaks panel gone | unit | `npx vitest run "src/app/(dashboard)/allocations"` | ✅ edit | ⬜ pending |
| LEAN-07 | dark-mode option gone | unit | `npx vitest run "src/app/factsheet/[id]/v2"` | ✅ edit | ⬜ pending |
| LEAN-07 | density toggle gone | unit | `npx vitest run src/components/strategy` | ✅ edit | ⬜ pending |
| LEAN-07 | `/browse` single-category redirect | unit | `npx vitest run src/app/browse` | ❌ W0 | ⬜ pending |
| LEAN-07 | one disclaimer per page | unit | `npx vitest run src/components/ui/Disclaimer.test.tsx src/__tests__/dashboard-disclaimer-once.test.ts src/app/browse` | ✅ edit | ⬜ pending |
| census | Python TS-write census | pytest | `cd analytics-service && python -m pytest tests/test_computing_started_at_stamp.py -q` | ✅ edit | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/trim-removed-surfaces.test.ts` — D-10 guard
- [ ] `src/app/portfolio-pdf/[id]/page.test.tsx` — retired page
- [ ] `src/app/browse/page.test.tsx` — 0 / 1 / 2+ populated categories, failed read
- [ ] `Disclaimer.test.tsx` case for the combined variant
- [ ] email href assertion (`src/lib/email.ts` portfolio-alert link → `/allocations`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Runtime redirects and retired page in a real browser | LEAN-03 | Playwright runs in CI only | `e2e/route-redirects.spec.ts` and the public sweeps, read from the CI run bound to the head SHA |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
