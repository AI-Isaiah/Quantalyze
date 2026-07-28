---
phase: 66
slug: carry-forward-burn-down
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 66 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + supabase/tests SQL where applicable |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched-file>.test.ts --no-file-parallelism` |
| **Full suite command** | `npm test` (vitest run, --no-file-parallelism locally) + `npm run lint` + `npx tsc --noEmit` |
| **Estimated runtime** | quick ~10-30s per file; full suite ~several minutes |

---

## Sampling Rate

- **After every task commit:** Run the touched-file vitest command
- **After every plan wave:** Run the full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 66-01/T1 | 66-01 | 1 | CF-01 | T-66-04 | Book-only draft still 409s via surviving `addedStrategies.length === 0` disjunct after isBookOnlyDraft deletion | unit | `npx vitest run src/app/api/allocator/scenario/share/route.test.ts "src/app/(dashboard)/allocations/lib/scenario-state.test.ts" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 66-01/T2 | 66-01 | 1 | CF-02 | T-66-01 | 65 and 1000 ids accepted, 1001 rejected; per-id + body-byte DoS guards intact; no clamp | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-state.test.ts" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 66-01/T3 | 66-01 | 1 | CF-02 | T-66-01 | Over-cap 400 renders honest ceiling copy (names 1000), never generic connection copy; 500 keeps generic (T_SAVE9) | unit/RTL | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 66-02/T1 | 66-02 | 1 | CF-03 | T-66-02 | Discriminator flags downgraded row only (incl. vs blank-save [] shape); re-derive stamps gate-correct ids; genuine rows byte-identical | SQL fixture (CI sql-tests) | `test -f supabase/tests/test_scenario_downgrade_sweep.sql` (fixture runs in CI sql-tests vs persistent test project) | ❌ Wave 0 — Task 1 creates it | ⬜ pending |
| 66-02/T2 | 66-02 | 1 | CF-03 | T-66-02 | Prod: 0 rows match `schema_version >= 4 AND NOT (draft ? 'memberKeyIds')` after sweep (or 0 found — evidence-recorded) | manual (Supabase MCP, prod) | see Manual-Only table | n/a | ⬜ pending |
| 66-02/T3 | 66-02 | 1 | CF-05 | T-66-03 | Prod: 0 rows match `email LIKE 'phase10-rpc-%@test.local'` after exact-pattern SELECT-before-DELETE | manual (Supabase MCP, prod) | see Manual-Only table | n/a | ⬜ pending |
| 66-03/T1 | 66-03 | 2 | CF-04 | T-66-06 | `grep -rni holdingReturnsByScopeRef src/` empty (case-insensitive — catches `reconstructHoldingReturnsByScopeRef`); zero holdingsSummary production lines changed (RISK-1) | tsc + unit | `npx tsc --noEmit && npx vitest run src/lib/queries.my-allocation.test.ts "src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts" "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx" --no-file-parallelism` | ✅ retire/repoint dead-field assertions | ⬜ pending |
| 66-03/T2 | 66-03 | 2 | CF-04 | T-66-06 | Full suite green; coverage ratchet holds (82/80/74/72) | full suite + coverage | `npm run test:coverage` | ✅ | ⬜ pending |
| 66-04/T1 | 66-04 | 3 | CF-05 | T-66-09 | Per-key gantt row renders dataSourceLabel-friendly text, raw UUID absent (text/title/aria) | RTL | `npx vitest run "src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` | ✅ extend (existing 197-line phase-58 COVERAGE-01 suite, PR #566) | ⬜ pending |
| 66-04/T2 | 66-04 | 3 | CF-05 | T-66-08 | ScenarioComparePanel mount payload compile-checked, `as unknown as` gone | tsc + unit | `npx tsc --noEmit && npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx" --no-file-parallelism` | ✅ | ⬜ pending |
| 66-05/T1 | 66-05 | 3 | CF-06 | — | Badge shows `99+` for count>99, exact count otherwise, on nav + sidebar; for-quants-lead diff is comment-only | unit/RTL | `npx vitest run src/components/layout/MobileNav.test.tsx src/components/layout/Sidebar.test.tsx --no-file-parallelism` | ✅ extend | ⬜ pending |
| 66-05/T2 | 66-05 | 3 | CF-06 | T-66-10 | TODOS.md: no landed-item refs, no `~~` graveyard; every survivor evidenced in SUMMARY table | grep gate | `bash -c 'grep -v "^#" TODOS.md \| grep -c "isBookOnlyDraft\\|holdingReturnsByScopeRef" \| awk "{exit (\$1==0)?0:1}" && ! grep -q "~~" TODOS.md'` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_scenario_downgrade_sweep.sql` — created by plan 66-02 Task 1 BEFORE any prod contact (Tasks 2/3 are gated behind it)

All other requirements extend existing test files — no new framework install.

> Rev 1 correction: `src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx` was wrongly listed here as absent. It EXISTS (197 lines — phase-58 COVERAGE-01/WCAG/timezone regression tests, PR #566); plan 66-04 Task 1 EXTENDS it, never overwrites.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| F-4 sweep against prod (plan 66-02 Task 2) | CF-03 | Prod data op via Supabase MCP (khslejtfbuezsmvmtsdn); executor subagents have no Supabase MCP | Post-condition: `SELECT count(*) FROM scenarios WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds')` = 0; SANITY + DETECT + before/after evidence in 66-02-SUMMARY |
| phase10-rpc row DELETE (plan 66-02 Task 3) | CF-05 | Same MCP constraint | Post-condition: `SELECT count(*) FROM auth.users WHERE email LIKE 'phase10-rpc-%@test.local'` = 0; before/after SELECTs + resolved count (6-vs-2) in 66-02-SUMMARY |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (66-02 T2/T3 carry `MISSING —` markers naming the prod post-condition queries; they are the phase's two sanctioned manual-only ops)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the SQL fixture is created in-plan before dependent verification; CoverageTimeline.test.tsx already exists and is extended, not created)
- [x] No watch-mode flags
- [x] Feedback latency < 300s (targeted vitest runs per task; full suite per wave)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner 2026-07-04 (plans 66-01..66-05); revision 1 2026-07-04 — Wave 0 CoverageTimeline accounting corrected
