---
phase: 100-optimizer-favorites-notes-kpi
plan: 01
subsystem: notes
tags: [notes, rls, migration, allocations, pi-04]
requires:
  - user_notes table (migrations 037 + 071 multiscope)
  - /api/notes route + checkScopeOwnership + useNoteAutoSave/NoteRender/NoteSaveStatus
provides:
  - user_notes scope_kind='dashboard' (additive CHECK)
  - checkScopeOwnership dashboard arm + route allow-list + resolveEntityId mapping
  - DashboardNoteCard (always-editable autosave card for /allocations)
affects:
  - src/app/api/notes/route.ts (new scope, audit entity_id mapping)
  - src/lib/audit.ts (new user_note.dashboard.update action)
tech-stack:
  added: []
  patterns:
    - reuse-only notes stack (zero new endpoints)
    - additive migration (DROP+re-ADD CHECK, no CREATE TABLE)
    - always-editable autosave card (no edit-mode toggle)
key-files:
  created:
    - supabase/migrations/20260715090000_user_notes_dashboard_scope.sql
    - supabase/tests/test_user_notes_dashboard_scope.sql
    - src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx
    - src/app/(dashboard)/allocations/components/DashboardNoteCard.test.tsx
  modified:
    - src/lib/notes/ownership.ts
    - src/app/api/notes/route.ts
    - src/lib/audit.ts
    - src/components/notes/useNoteAutoSave.ts
decisions:
  - "dashboard audit entity_id = caller userId (scope_ref 'allocations' is neither a UUID nor per-user — would be a cross-user key against the UUID-typed audit_log.entity_id)"
  - "reuse existing user_notes table via additive scope_kind CHECK; no new table (locked decision)"
metrics:
  tasks: 2
  files_created: 4
  files_modified: 4
  commits: 2
  completed: 2026-07-12
---

# Phase 100 Plan 01: Dashboard Notes Scope + DashboardNoteCard Summary

PI-04 storage arm + widget: one additive `dashboard` scope_kind on the existing `user_notes` table plus an always-editable `DashboardNoteCard` that reuses the entire shipped notes stack (`useNoteAutoSave`/`NoteRender`/`NoteSaveStatus`/`/api/notes`) with zero new endpoints.

## What was built

**Task 1 — dashboard scope (migration + ownership/route arms + CI-authoritative RLS test)** — commit `d45ff646`
- `supabase/migrations/20260715090000_user_notes_dashboard_scope.sql`: additive `DROP CONSTRAINT IF EXISTS` + `ADD` of `user_notes_scope_kind_check` extending the allowed set from four values to five (`'portfolio','holding','bridge_outcome','strategy','dashboard'`), re-based on the latest constraint def (migration `20260421060316`, the only other def — grep-confirmed). Existing rows untouched, no data migration, no `CREATE TABLE`. Refreshed the `scope_kind`/`scope_ref` column comments. Self-verifying `DO $$` block asserts the constraint exists and includes `dashboard`. Timestamp `20260715090000` > latest `20260714090000`.
- `src/lib/notes/ownership.ts`: extended `ScopeKind` union with `"dashboard"`; added a `case "dashboard"` arm — valid iff `scope_ref === "allocations"`, else the same `{ok:false}` shape the other arms return. RLS `user_id = auth.uid()` carries the real owner gate.
- `src/app/api/notes/route.ts`: added `"dashboard"` to `ALLOWED_KINDS`; changed `resolveEntityId` to return `userId` for `dashboard` (`scope_kind === "holding" || scope_kind === "dashboard"`). Updated the doc-comment to note both holding AND dashboard have no aggregate UUID row → caller's user_id. Updated the top-of-file scope_kinds doc line.
- `src/lib/audit.ts`: added the `user_note.dashboard.update` action to the action union and its `"user_note"` entity_type mapping (required — the route emits `user_note.${scope_kind}.update`).
- `supabase/tests/test_user_notes_dashboard_scope.sql`: CI-authoritative RLS proof modeled on the existing `test_*.sql` harness (plain PL/pgSQL `DO $$`, no pgTAP). Asserts: CHECK accepts `dashboard` / rejects `bogus`; user A reads its own note; user B reads 0 of A's; B's UPDATE of A's note affects 0 rows; B cannot forge a row with A's user_id; A's note is unmutated.

**Task 2 — DashboardNoteCard + render/autosave test** — commit `51fa2d3e`
- `src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx`: always-editable card (no edit-mode toggle) cloned structurally from `StrategyNoteCard`. Props `{ initialContent, initialLastSavedAt }` (no id — scope fixed). `useNoteAutoSave("dashboard", "allocations", …)`. "Notes" (`text-h3 font-semibold`) heading with right-aligned `NoteSaveStatus`; `"Private — visible only to you."` sub-caption (`text-caption text-text-muted`); textarea with the honest UI-SPEC placeholder; below-fold `NoteRender` preview only when content is non-empty. Card chrome uses tokens `rounded-lg border border-border bg-surface p-6` (border-border = #E2E8F0, radius-lg = 8px, p-6 = 24px) and `focus:border-focus` — no raw hex/`text-[Npx]`.
- `src/app/(dashboard)/allocations/components/DashboardNoteCard.test.tsx`: RED→GREEN. Asserts heading + sub-caption + save status; honest-empty placeholder with no preview; preview renders for non-empty content while textarea stays editable; and exactly ONE PATCH `/api/notes` with body `{scope_kind:'dashboard', scope_ref:'allocations', content}` (verbatim).
- `src/components/notes/useNoteAutoSave.ts`: extended the hook's local `ScopeKind` union with `"dashboard"` (blocking type fix — the hook keeps a private copy of the union).

## Verification evidence

- **Task 1 automated**: `ls` + `grep` gates all pass (migration has `'dashboard'`, `case "dashboard"` in ownership, `"dashboard"` in route, no `CREATE TABLE`). `npx tsc --noEmit` clean.
- **Task 2 RED→GREEN**: `DashboardNoteCard.test.tsx` failed with module-not-found before the component (RED), then `Tests 4 passed (4)` after (GREEN).
- **tsc**: `npx tsc --noEmit` clean (0 errors).
- **lint**: `npm run lint` → 0 errors (1 pre-existing `react-hooks/exhaustive-deps` warning in `EquityChart.tsx`, unrelated — out of scope).
- **Regression**: existing `src/app/api/notes/route.test.ts`, `src/__tests__/audit-fanout-integration.test.ts`, `src/lib/notes/*`, and `src/components/notes/useNoteAutoSave.test.ts` all pass (55 tests total across the touched surface).

## SQL RLS test status (CI-gated)

`TEST_SUPABASE_DB_URL` is NOT set in this environment, so `test_user_notes_dashboard_scope.sql` was NOT executed locally — no RED/GREEN is claimed for it. It is the CI-authoritative gate (the `sql-tests` job runs it against the test project under `psql -v ON_ERROR_STOP=1`; the vitest live-DB notes tests SKIP in CI). The migration must be applied to the test project (MCP catch-up) before that job can pass.

## Migration discipline (before merge)

The migration `20260715090000` AUTO-APPLIES to prod on merge. It is additive and idempotent (DROP CONSTRAINT IF EXISTS + ADD, guarded self-verify). Per standing invariants, **migration-reviewer + rls-policy-auditor + test-project MCP catch-up must run before merge** so the CI `sql-tests` job resolves against a caught-up test project.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended the audit action union with `user_note.dashboard.update`**
- **Found during:** Task 1 (tsc failed at route.ts:263 — the audit `action` union in `src/lib/audit.ts` did not include the new scope's action).
- **Fix:** Added `"user_note.dashboard.update"` to the action union and its `"user_note"` entity_type mapping, mirroring the other four `user_note.*` scopes.
- **Files modified:** src/lib/audit.ts
- **Commit:** d45ff646

**2. [Rule 3 - Blocking] Extended `useNoteAutoSave`'s local `ScopeKind` union**
- **Found during:** Task 2 (tsc failed at DashboardNoteCard.tsx:31 — the hook keeps a private `ScopeKind` type separate from the server-only `ownership.ts` union).
- **Fix:** Added `"dashboard"` to the hook's local union.
- **Files modified:** src/components/notes/useNoteAutoSave.ts
- **Commit:** 51fa2d3e

Both were unavoidable type-plumbing consequences of adding the scope, not scope creep — the plan already prescribed the ownership/route/migration changes; these two unions are the remaining type declarations the same value flows through.

## database.types.ts

Not regenerated/committed: there is no local type-gen npm script, and a CHECK-constraint change does not alter generated types (the plan directs committing only if it diffs — a no-op here).

## Known Stubs

None. The card is fully wired to the live `/api/notes` PATCH via `useNoteAutoSave`; page mounting happens in plan 100-04 (out of this plan's scope).

## Threat Flags

None beyond the plan's `<threat_model>`. T-100-01 (IDOR) is mitigated by RLS + the dashboard ownership arm + the CI SQL proof; T-100-02 (DoS) is covered unchanged by the pre-existing request/content caps + `notesUpsertLimiter`; T-100-03 (migration auto-apply) is additive-only with the reviewer/auditor/catch-up gate flagged above.

## Self-Check: PASSED

All 4 created files exist on disk; both commits (d45ff646, 51fa2d3e) present in git log.
