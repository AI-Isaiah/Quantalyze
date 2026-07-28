---
phase: 109-role-predicate-unification-page-guards
plan: 02
subsystem: auth
tags: [rbac, role, profiles, nav, sidebar, supabase, migration, sql-test]

# Dependency graph
requires:
  - phase: 109-01
    provides: requireRolePage three-branch page guard + ROLE-06 copy pin
provides:
  - Idempotent staff role='both' backfill migration (20260716120000) + RED-guarded empty-set SQL assertion
  - Pure-role nav derivation in Sidebar.tsx (|| isAdmin OR-in dropped from both buildNavSections and buildPrimaryMobileNav)
  - Flipped admin-sees-all nav test assertions to role-only (Sidebar.test.tsx + MobileNav.test.tsx)
affects: [110-CONTRIB, 116-ADDALLOC, page-guards, nav]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "profiles.role is the sole workspace persona predicate; is_admin is an ops-overlay gating ONLY the Admin section"
    - "Atomic GATE: a nav-predicate change that would lock users out ships in the SAME PR as the data backfill that preserves them, proven by a CI-enforced empty-set SQL assertion"

key-files:
  created:
    - supabase/migrations/20260716120000_backfill_staff_role_both.sql
    - supabase/tests/test_staff_role_both_backfill.sql
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/components/layout/MobileNav.test.tsx

key-decisions:
  - "Migration header describes the ACTUAL trigger mechanism (prevent_profile_role_change bypasses when current_user IN postgres/service_role/supabase_admin) rather than parroting the plan's 'SECURITY INVOKER' phrasing — the function is SECURITY DEFINER; the load-bearing fact is the privileged-session-role bypass, definitively verified at Task 3"
  - "MobileNav.tsx left untouched (delegates to buildPrimaryMobileNav); the isAdmin prop still plumbs through but is no longer read for workspace gating — harmless, and editing the call site was out of scope per plan"
  - "Kept the migration timestamp 20260716120000 (sorts after current latest 20260716090000 — no re-base needed)"

patterns-established:
  - "Bare-DO-block empty-set SQL assertion (BEGIN; DO $$ count→RAISE EXCEPTION $$; ROLLBACK) as the CI-enforced proof of an atomic-gate invariant"

requirements-completed: [ROLE-01, ROLE-02, ROLE-03, ROLE-05]

# Metrics
duration: ~20min
completed: 2026-07-16
---

# Phase 109 Plan 02: Role-Predicate Nav Unification — the Atomic GATE Summary

**Dropped `|| isAdmin` from both Sidebar nav derivations (pure-role workspace gating) atomically with an idempotent staff `role='both'` backfill migration + a RED-guarded empty-set SQL assertion; Task 3 (test-project MCP apply) is a BLOCKING checkpoint for the orchestrator.**

> STATUS: Tasks 1 & 2 COMPLETE and committed. Task 3 is `checkpoint:human-action` (BLOCKING) — the executor has NO Supabase MCP; the orchestrator/human must MCP-apply the migration to the test project. See `## CHECKPOINT` below.

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-16
- **Tasks:** 2 of 3 (Task 3 = orchestrator checkpoint)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Idempotent backfill migration `UPDATE profiles SET role='both' WHERE is_admin=true AND role<>'both'` with a multi-line WHY header covering the atomic-GATE rationale (threat T-109-06) and the A2 trigger-bypass note (T-109-07).
- RED-guarded empty-set assertion `test_staff_role_both_backfill.sql` (bare `BEGIN; DO $$…$$; ROLLBACK`, `RAISE EXCEPTION` on nonzero, no pgTAP `plan()`).
- Sidebar.tsx: `|| isAdmin` dropped from all three `buildNavSections` derivations AND both `buildPrimaryMobileNav` derivations; Admin-section gate (`...(isAdmin ? …)`) UNCHANGED; MobileNav.tsx untouched.
- Nav tests flipped to role-only reality across the WHOLE of both suites (51 tests green): bare `is_admin` → no workspace (Admin/Profile only); admin+allocator → no manager surface (ROLE-02); admin+manager → no allocator surface (ROLE-03); role='both' → both workspaces (ROLE-05).
- Whole-repo + e2e grep reconciled and recorded (see below).

## Task Commits

1. **Task 1: Backfill migration + RED-guarded empty-set SQL assertion** — `ec80b857` (feat)
2. **Task 2: Drop `|| isAdmin` from both nav derivations + flip admin-sees-all tests** — `c0dabdb4` (feat)
3. **Task 3: [BLOCKING] MCP-apply the backfill to the TEST project** — PENDING (orchestrator checkpoint; executor lacks Supabase MCP)

## Files Created/Modified
- `supabase/migrations/20260716120000_backfill_staff_role_both.sql` — idempotent staff `role='both'` backfill (created)
- `supabase/tests/test_staff_role_both_backfill.sql` — RED-guarded empty-set invariant assertion (created)
- `src/components/layout/Sidebar.tsx` — pure-role `showsAllocatorWorkspace`/`showsManagerWorkspace`/`showsDiscovery`; updated the stale "Admins see BOTH" comment blocks to the role-only derivation (modified)
- `src/components/layout/Sidebar.test.tsx` — flipped admin-view + Strategy-Sandbox + T-45-01 assertions to role-only; added admin+manager (ROLE-03) and role='both' (ROLE-05) cases (modified)
- `src/components/layout/MobileNav.test.tsx` — flipped the admin case (bare `is_admin` → only Profile); role='both' case now carries the exact-<=5-ordering pin (modified)

## Verification Evidence
- `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx --no-file-parallelism` → **2 files, 51 tests passed**.
- `src/components/layout/DashboardChrome.test.tsx` (renders Sidebar with `isAdmin`) → **20 tests passed** (asserts main labeling/full-bleed, not workspace nav — unaffected).
- OR-in grep gate: `grep -n "isAllocator || isAdmin\|isManager || isAdmin\|p.isAllocator || p.isAdmin\|p.isManager || p.isAdmin" src/components/layout/Sidebar.tsx` → **0 hits**.
- Admin-section gate intact: `grep -n "\.\.\.(isAdmin" src/components/layout/Sidebar.tsx` → line 135.
- `npx tsc --noEmit` → no errors in touched files; `eslint` on the three touched files → clean.

## Whole-repo admin-sees-all grep (LOAD-BEARING, recorded per T-109-15)
**Command:**
```
grep -rn "isAdmin" e2e/ src/ --include="*.ts" --include="*.tsx" | grep -iE "My Allocation|Strateg|Portfolio|Discovery|workspace|allocator|manager"
```
**Hit-list resolution:**
- `src/components/layout/Sidebar.test.tsx`, `MobileNav.test.tsx` — the flipped nav suites (THIS plan). ✅ reconciled to role-only.
- `src/components/layout/Sidebar.tsx` (L45 comment, L275 `buildNavSections(...isAdmin...)`) and `MobileNav.tsx` (L52 `buildPrimaryMobileNav({...isAdmin...})` pass-through) — `isAdmin` is still plumbed for the **Admin-section gate**; not a workspace assertion. ✅ correct/unchanged.
- **`e2e/full-flow.spec.ts` (L154-162 "admin dashboard loads")** — asserts `/admin` renders OR redirects; an admin ROUTE-access check, NOT an admin-sees-workspace-nav assertion. ✅ role-only reality unchanged (is_admin still gates admin routes).
- **`e2e/match-queue.spec.ts` (L74 comment + eval-route test)** — asserts the admin account reaches `/admin/match/eval`; an admin ROUTE-access check, NOT a workspace-nav assertion. ✅ unchanged.
- All `src/app/api/admin/**/route.ts(.test.ts)` and `src/app/(dashboard)/admin/**/page.tsx` hits — `isAdminUser(...)` ROUTE guards / redirects. ✅ correct/unchanged (is_admin remains the Admin-route predicate).

**Conclusion:** no stale admin-sees-all NAV workspace assertion survives repo-wide; the two named e2e specs were read and confirmed to be admin ROUTE-access assertions (correct post-Phase-109), not workspace-nav assertions.

## Decisions Made
- See `key-decisions` frontmatter (migration header mechanism accuracy; MobileNav.tsx left untouched; timestamp kept).

## Deviations from Plan
None — plan executed exactly as written for Tasks 1-2. (Task 3 is a plan-designated BLOCKING checkpoint, not a deviation.) The migration header was written to describe the trigger's actual `current_user` bypass mechanism rather than the plan's "SECURITY INVOKER" shorthand — this is documentation accuracy within the planned deliverable, not a behavioral deviation.

## Issues Encountered
None.

## CHECKPOINT — Task 3 (BLOCKING, orchestrator/human via Supabase MCP)

**Type:** human-action (executor has NO Supabase MCP)

The RED-guarded assertion `supabase/tests/test_staff_role_both_backfill.sql` FAILS in CI until the migration is applied to the live TEST project (types/tests derive from the live DB, not the migration file). Before merge, the orchestrator/human must:

1. **Apply** against project **`qmnijlgmdhviwzwfyzlc`** (TEST) via Supabase MCP `apply_migration`, name `backfill_staff_role_both`, with the SQL body of `supabase/migrations/20260716120000_backfill_staff_role_both.sql`.
2. **Correct the drift**: MCP `apply_migration` stamps `now()`, not the file timestamp — rename/insert the `supabase_migrations.schema_migrations` version row to **`20260716120000`** so CI migration ordering matches the file (established workaround).
3. **Verify the empty-set invariant (A2 check)**: run `SELECT count(*) FROM profiles WHERE is_admin = true AND role NOT IN ('both');` → **must return 0**. A nonzero result means `prevent_profile_role_change` blocked the UPDATE (falsifies assumption A2 / threat T-109-07) and requires a trigger-exemption revision.
4. **Confirm** no `prevent_profile_role_change` error was raised during apply.

**Resume signal:** "applied" once test-project apply + empty-set count 0 are confirmed, or describe the failure.

## Prod post-deploy reminder
Merging `supabase/migrations/**` to main AUTO-applies this migration to PROD. After deploy, re-run the same count query against **prod (`khslejtfbuezsmvmtsdn`)** and confirm **0**.

## Next Phase Readiness
- Nav predicate is pure-role; Admin section still `is_admin`-gated; atomic backfill staged with its CI-enforced empty-set proof.
- **Blocker to merge:** Task 3 test-project MCP apply must complete (else the RED-guarded SQL test fails CI).

## Self-Check: PASSED
- All created/modified files exist on disk (migration, SQL test, Sidebar.tsx, SUMMARY).
- Task commits verified in git log: `ec80b857` (Task 1), `c0dabdb4` (Task 2).
- On branch `gsd/v1.11-scenario-composer-v2` (correct milestone feature branch).

---
*Phase: 109-role-predicate-unification-page-guards*
*Completed (Tasks 1-2): 2026-07-16*
