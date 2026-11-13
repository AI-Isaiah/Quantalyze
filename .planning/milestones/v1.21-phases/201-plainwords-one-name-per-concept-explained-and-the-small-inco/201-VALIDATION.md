---
phase: "201"
slug: "plainwords-one-name-per-concept-explained-and-the-small-inconsistencies-fixed"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-11"
---

# Phase 201 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `201-RESEARCH.md` §Validation Architecture; the per-requirement test map lives there and is not restated.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + @testing-library/react (jsdom) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched test files>` |
| **Full suite command** | `npm test`; `npm run typecheck`; `npm run lint` |
| **Estimated runtime** | quick ~30 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the touched test files plus `npx eslint <touched files>`.
- **After every plan wave:** `npm run typecheck`, the wave's directories in vitest, plus the always-run regression guards listed in `201-RESEARCH.md` (figure-gate census, public-truth census/copy, FactsheetBody census, frozen-spine guards, degrade-warnings).
- **Before `/gsd-verify-work`:** full suite, `npm run lint`, `node scripts/verify-plan-anchors.mjs <each PLAN.md>` green.
- **.planning-reading tests:** `src/__tests__/check-planning-hygiene.test.ts`, `src/__tests__/verify-plan-anchors.test.ts`, `src/__tests__/contracts/ci-docs-path-filter.contract.test.ts`, `src/__tests__/critical-regressions.test.ts`.

---

## Per-Task Verification Map

Filled by the planner per task (`<automated>` + `<fails_when>`); see `201-RESEARCH.md` "Phase Requirements → Test Map" for the requirement-level map.

---

## Wave 0 Requirements

- [ ] `node_modules` present in the phase worktree (`npm ci` once; per-plan worktrees symlink it).
- [ ] `src/lib/glossary.test.ts`, `src/components/ui/Term.test.tsx`
- [ ] copy-census scanner + test with planted red and green fixtures, and `src/__tests__/copy-census.test.ts` (PENDING + count-pinned EXCEPTIONS)
- [ ] `src/components/strategy/StrategyFilters.test.tsx`
- [ ] `CompareTable` arm in `src/__tests__/figure-parity-pages.test.tsx`
- [ ] `MetricsColumn` numerals test
- [ ] `src/app/(marketing)/legal/disclaimer/page.test.tsx`

---

## RED proofs (required)

Each new user-facing gate is neutered, seen RED with the named failure, restored from a byte backup (`cp` + `cmp`, never git checkout/restore/stash), and seen GREEN: retired word back in one string; one `Term` wrapper removed; `redactedName` / name resolver reverted for a discovery-visible strategy, and a non-visible strategy given its real name; egress link pointed away from `/security#egress-ips` or the `#egress-ips` none-yet statement removed (F-12, 2026-11-11; was "egress link restored" under D-13); a bare `toLocaleDateString()` added; `+` back on CompareTable volatility; hard-coded old numeral list; disclaimer space removed; Escape handler removed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tooltips read well and sit correctly on real pages | CLAR-03 | Visual placement, no Playwright locally | Production UAT after deploy: hover and Tab through factsheet Detailed metrics, KPI strip, compare |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
