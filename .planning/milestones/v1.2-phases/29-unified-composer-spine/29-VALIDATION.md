---
phase: 29
slug: unified-composer-spine
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed spec>` |
| **Full suite command** | `npm test` (+ supabase sql tests for RLS gates) |
| **Estimated runtime** | ~varies (full suite is sharded in CI) |

---

## Sampling Rate

- **After every task commit:** Run the changed-file vitest spec
- **After every plan wave:** Run the full vitest suite
- **Before `/gsd:verify-work`:** Full suite green + `git diff` empty on `src/lib/scenario.ts` and `supabase/migrations/`
- **Max feedback latency:** keep per-spec under ~30s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 29-01-00 | 01 | 1 | UNIFY-04 | scaffold | `npx vitest run "src/app/api/strategies/[id]/returns/route.test.ts"` (RED) | ⬜ pending |
| 29-01-01 | 01 | 1 | UNIFY-04 | unit | `npx vitest run "src/app/api/strategies/[id]/returns/route.test.ts"` | ⬜ pending |
| 29-02-01 | 02 | 1 | UNIFY-03 | unit | `npx vitest run src/app/api/strategies/browse/route.test.ts` | ⬜ pending |
| 29-02-02 | 02 | 1 | UNIFY-03 | unit (leak, non-vacuous) | `npx vitest run src/app/api/strategies/browse/route.test.ts` | ⬜ pending |
| 29-03-01 | 03 | 1 | UNIFY-03 | unit | `npx vitest run "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx"` | ⬜ pending |
| 29-03-02 | 03 | 1 | UNIFY-05 | unit | `npx vitest run "src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx"` | ⬜ pending |
| 29-04-01 | 04 | 2 | UNIFY-01, UNIFY-02 | unit | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ⬜ pending |
| 29-04-02 | 04 | 2 | UNIFY-04 | unit (behavior) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ⬜ pending |
| 29-04-03 | 04 | 2 | UNIFY-05 | unit (codec trichotomy) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"` | ⬜ pending |
| 29-05-01 | 05 | 3 | UNIFY-01..05 | guard (non-vacuous) | `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts` | ⬜ pending |
| 29-05-02 | 05 | 3 | UNIFY-01..05 | consolidation | `npm test` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing vitest + supabase sql infrastructure covers all phase requirements; the planner adds specs per task. No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (planner fills any authed browser-only canaries) | | | |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
