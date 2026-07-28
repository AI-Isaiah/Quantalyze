---
phase: 109
slug: role-predicate-unification-page-guards
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-16
---

# Phase 109 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated by the planner from RESEARCH.md's Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS/nav/guard) + pgTAP-style `supabase/tests/test_*.sql` (backfill assertion) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/components/layout src/lib/api --no-file-parallelism` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~60–120 seconds (TS); SQL assertion runs in CI against test project |

---

## Sampling Rate

- **After every task commit:** Run the quick vitest command for the touched area
- **After every plan wave:** Run the full suite
- **Before `/gsd:verify-work`:** Full suite green + SQL empty-set assertion applied to test project
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

> Planner fills concrete task IDs. Skeleton mapped from success criteria:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 109-01/T1 | 109-01 | 1 | ROLE-04 | T-109-01..05 | wrong-role → redirect to the visitor's OWN role home; DB-error/missing-profile → throw+Sentry, NO redirect; unknown role → /pending-approval terminal; full role×is_admin matrix | unit (TDD) | `npx vitest run src/lib/auth/requireRolePage.test.ts --no-file-parallelism` | ❌ W0 (created by task) | ⬜ pending |
| 109-01/T2 | 109-01 | 1 | ROLE-06 | — | denied-action 403 copy names the required role, no impossible retry | unit | `npx vitest run src/lib/api/withAllocatorAuth.test.ts --no-file-parallelism` | ✅ | ⬜ pending |
| 109-02/T1 | 109-02 | 1 | ROLE-05 | T-109-06,07 | `is_admin=true AND role NOT IN ('both')` = ∅ (RED-guarded) | sql | CI supabase test job (`test_staff_role_both_backfill.sql`) | ❌ W0 (created by task) | ⬜ pending |
| 109-02/T2 | 109-02 | 1 | ROLE-01,02,03,05 | T-109-08 | manager sees no allocator/Discovery nav; allocator sees no sell-side nav; `is_admin`-only adds Admin; `both` sees both | unit | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx --no-file-parallelism` | ✅ (flip assertions) | ⬜ pending |
| 109-02/T3 | 109-02 | 1 | ROLE-05 | T-109-07 | migration applied to test project; empty-set count 0 (A2 check) | manual/MCP checkpoint | test-project SQL count query (executor lacks Supabase MCP) | — | ⬜ pending |
| 109-03/T1 | 109-03 | 2 | ROLE-04 | T-109-10,12 | 4 allocator FLAT pages + discovery/layout guarded, guard outside try/catch | grep gate + tsc | grep 5-file gate + `npx tsc --noEmit` | ✅ (pages exist) | ⬜ pending |
| 109-03/T2 | 109-03 | 2 | ROLE-04 | T-109-12,14 | NEW strategies/layout.tsx + portfolios/layout.tsx (segment layouts) guard ALL nested manager routes (index + new + new/wizard + [id]/edit + [id] + [id]/manage + [id]/documents) — closes the nested-route bypass | grep gate + tsc | 2-layout grep + `npx tsc --noEmit` | ❌ (2 new layouts) | ⬜ pending |
| 109-03/T3 | 109-03 | 2 | ROLE-04 | T-109-11,13 | full page.tsx coverage audit (incl. nested) = exactly 7 guard sites; proxy hop single-hop loop-free | grep gate + unit | 7-site grep + targeted vitest + `npm run lint` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New `requireRolePage` guard unit test file — stubs for ROLE-04 (wrong-role redirect, DB-error no-redirect, missing-profile) — mirror `withAllocatorAuth` test shape
- [ ] `supabase/tests/test_*.sql` empty-set assertion for the atomic backfill (ROLE-05 GATE)
- [ ] Framework already present (vitest + supabase SQL tests) — no install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live redirect-loop-free across the full `role × is_admin` matrix on prod, INCLUDING a nested manager route | ROLE-04 | Full SSR redirect chain (incl. segment-layout coverage of nested routes) best confirmed against a live deploy with each role account | After deploy: log in as manager, allocator, both, and `is_admin`+manager; direct-URL a cross-role route incl. a NESTED one (e.g. `/portfolios/<id>/manage` and `/strategies/new/wizard` as an allocator); confirm single-hop redirect to role home, no loop, no 403/half-render |

*Automated unit tests cover the guard branches; the end-to-end redirect chain is the manual confirm.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (guard test + SQL assertion)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
