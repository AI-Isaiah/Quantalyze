---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 04
subsystem: auth
tags: [next-layout, role-guard, requireRolePage, vitest, structural-test]
requires: []
provides:
  - "strategies/new/layout.tsx: manager guard for /strategies/new and /strategies/new/wizard"
  - "strategies/[id]/layout.tsx: manager guard for /strategies/[id]/edit"
  - "strategies-guard-coverage.test.ts: every non-index strategies page sits under its own manager guard"
affects: [199-09]
actuals:
  tokens: 3900
  tasks: 2
  commits: 3
plan_head_before: 1157767ef061176922916f1da92f3276a9083efd
plan_head_after: 9ab88122a897c106a2446f49dd3285f1df4ea3b2
status: complete
tech-stack:
  added: []
  patterns:
    - "Segment guard layout per sub-route group so one route (the index) can widen alone"
    - "Wiring test mock that switches between spy-and-halt and the real guard (harness.real)"
key-files:
  created:
    - src/app/(dashboard)/strategies/new/layout.tsx
    - src/app/(dashboard)/strategies/[id]/layout.tsx
    - src/__tests__/strategies-guard-coverage.test.ts
  modified:
    - src/app/(dashboard)/requireRolePage-wiring.test.tsx
key-decisions:
  - "D-01: sub-routes carry their own manager guard; parent StrategiesLayout left byte-unchanged until 199-09"
  - "CD-10: /strategies/new/wizard stays manager-guarded; the Phase 110 allocator exception is an overlay"
requirements-completed: [LEAN-01]
coverage:
  - id: D1
    description: "/strategies/new and /strategies/new/wizard are guarded by their own segment layout (allocator bounced to /allocations, manager and both render, read error throws)"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/requireRolePage-wiring.test.tsx#strategies/new/layout"
        status: pass
    human_judgment: false
  - id: D2
    description: "/strategies/[id]/edit is guarded by its own segment layout, same four outcomes"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/requireRolePage-wiring.test.tsx#strategies/[id]/layout"
        status: pass
    human_judgment: false
  - id: D3
    description: "A structural test fails naming the page when any non-index strategies page has no layout of its own calling requireRolePage with manager"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/__tests__/strategies-guard-coverage.test.ts"
        status: pass
    human_judgment: false
---

# Phase 199 Plan 04: Strategies sub-route guard layouts Summary

Two segment layouts (`strategies/new`, `strategies/[id]`) now each carry a top-level `requireRolePage(supabase, user, "manager")`, so plan 199-09 can widen the `/strategies` index alone, backed by a wiring test with real-guard outcome cases and a structural test that fails when a sub-route loses its own guard.

## Accomplishments

- Task 1 (tracer): the new layouts mirror `StrategiesLayout` (force-dynamic, signed-out redirect, guard outside any try/catch). The wiring test gained two `SURFACES` entries (`need='manager'`) plus a real-guard outcome block run against both layouts: allocator gets `NEXT_REDIRECT:/allocations`, manager and `both` render children, a profile read error throws and never redirects. RED was observed first (module absent, suite fails to import), committed, then GREEN.
- Task 2: `strategies-guard-coverage.test.ts` walks `strategies/**/page.tsx`, takes every page other than the index, finds its nearest layout below `strategies/` (the parent excluded) and requires a comment-stripped `requireRolePage(supabase, user, "manager")`. The walk is pinned to at least three non-index pages and to finding the index.
- `strategies/layout.tsx` is byte-unchanged (acceptance: 1 `requireRolePage(` call remains), so no commit between plans admits an allocator to a manager route.

## Task Commits

1. RED: `f0c56c19c` test(199-04): wiring and outcome surfaces for the strategies sub-route guards (RED)
2. GREEN: `10f10b835` feat(199-04): own manager guard layouts for strategies/new and strategies/[id]
3. Task 2: `9ab88122a` test(199-04): structural gate - every non-index strategies page has its own manager guard layout

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: 8 claims checked, OK.
- `npx vitest run src/__tests__/strategies-guard-coverage.test.ts "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/lib/auth/requireRolePage.test.ts`: 3 files, 43 tests passed, 0 failed, 0 skipped.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: 0 errors; 4 pre-existing warnings in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`). The route-contract, admin-manifest, planning-hygiene and canonical-domain steps all OK.
- Acceptance greps: `requireRolePage(supabase, user, "manager")` count 1 in each new layout; `requireRolePage(` count 1 in `strategies/layout.tsx`; `strategies-guard-coverage.test.ts` exists.

gc-199-04-neuter: removed the `requireRolePage` call from `strategies/new/layout.tsx` on a byte copy; wiring test went RED (3 failures: `need` pin for strategies/new/layout, allocator bounce, read-error throws); file restored and `cmp` identical.
gc-199-04-neuter: commented out the `requireRolePage` call (text kept inside a comment) in `strategies/new/layout.tsx` on a byte copy; `strategies-guard-coverage.test.ts` went RED naming `new/page.tsx` and `new/wizard/page.tsx` ("new/layout.tsx must call requireRolePage(supabase, user, "manager") outside comments"); file restored and `cmp` identical.
gc-199-04-gates: vitest=green tsc=clean lint=clean

Backups lived only under the scratchpad `backups-199-04/` directory and were deleted.

## Deviations from Plan

None - plan executed exactly as written. One interpretation note: the plan's "allocator gets NEXT_REDIRECT, both renders, read error throws" cases need the real guard while the existing file mocks it, so the file's `requireRolePage` mock now delegates to the real implementation when `harness.real` is set. All pre-existing cases run in spy mode, unchanged.

## Left to CI

No SQL or local-stack checks were involved in this plan; nothing was left to the sql-tests or local-stack lanes. The full vitest suite and CI aggregator run in CI; only the targeted files above were run here.

## Known Stubs

None.

## Threat Flags

None. T-199-12 (elevation of privilege on /strategies/new/** and /strategies/[id]/**) is mitigated by the segment guards, wiring and outcome tests, and the structural test, each with neuter evidence. The parent guard stays until 199-09; API routes keep their own auth.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/strategies/new/layout.tsx
- FOUND: src/app/(dashboard)/strategies/[id]/layout.tsx
- FOUND: src/__tests__/strategies-guard-coverage.test.ts
- FOUND commits: f0c56c19c, 10f10b835, 9ab88122a
