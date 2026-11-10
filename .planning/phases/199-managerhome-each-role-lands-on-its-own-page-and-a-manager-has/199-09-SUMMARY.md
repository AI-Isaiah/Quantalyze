---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 09
subsystem: ui
tags: [next-layout, role-furniture, strategies-index, client-host, vitest, structural-test]
requires:
  - phase: 199-04
    provides: "strategies/new and strategies/[id] guard layouts, so the index can widen alone"
  - phase: 199-07
    provides: "StrategyTable allocatorFurniture prop and per-row managerRows"
provides:
  - "/strategies admits allocator, manager and both; furniture decided per role on the server"
  - "strategies/StrategiesSection.tsx: the one client host mounting StrategyTable for every role (moved from my-strategies/MyStrategiesSection.tsx)"
  - "StrategiesSection origin prop (R-04): required, set by each page"
  - "guard-coverage negative arm: strategies/layout.tsx and the index page call no requireRolePage"
affects: [199-10, 199-11, 199-13, 199-17]
actuals:
  tokens: 15243
  tasks: 2
  commits: 3
plan_head_before: 65cf394c42466c383817a8e63ee28a1efd3e99c6
plan_head_after: a19a8c2c6ec75f3ad6040924698cbd897cb32948
status: complete
tech-stack:
  added: []
  patterns:
    - "Role read inline on the page with requireRolePage's error discipline (throw, never guess) plus deny-by-default redirect"
    - "Two-lock furniture: the section withholds Mark/Rename callbacks AND the table gates on allocatorFurniture"
    - "Required origin prop instead of a hard-coded factsheet origin in a shared client host"
key-files:
  created:
    - src/app/(dashboard)/strategies/page.merged.test.tsx
    - src/app/(dashboard)/strategies/StrategiesSection.test.tsx
    - src/app/(dashboard)/strategies/StrategiesSection.tsx
  modified:
    - src/app/(dashboard)/strategies/layout.tsx
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/my-strategies/page.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
    - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
    - src/app/(dashboard)/strategies/page.table.test.tsx
    - src/app/(dashboard)/strategies/page.wizard-draft-banner.test.tsx
    - src/app/(dashboard)/strategies/page.wizard-submitted.test.tsx
    - src/app/(dashboard)/requireRolePage-wiring.test.tsx
    - src/__tests__/strategies-guard-coverage.test.ts
    - src/__tests__/phase-149-my-strategies-parity.test.ts
    - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx
  deleted:
    - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
key-decisions:
  - "D-01: only the index widens; StrategiesLayout keeps force-dynamic and the session check and calls no requireRolePage; the sub-routes stay manager-only through 199-04's layouts"
  - "D-02: the page reads profiles.role (error throws, missing row throws, unknown role redirects via roleSurfaceHome); isManager = manager|both, isAllocator = allocator|both"
  - "R-04: StrategiesSection takes a required origin prop and derives its prefs-scope categorySlug from origin.key, so both pages keep the exact scope key they had"
requirements-completed: [LEAN-01]
coverage:
  - id: D1
    description: "An allocator opens /strategies and sees only their own rows with the ownership tag and Simulate; no Edit, share control, StrategyActions, New Strategy or PendingIntros, and no contact_requests read"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#an allocator opens the page"
        status: pass
    human_judgment: false
  - id: D2
    description: "A manager gets New Strategy, Edit, the share control, row actions and PendingIntros and no allocator furniture; role both gets the union on one row per strategy"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#a manager gets New Strategy"
        status: pass
    human_judgment: false
  - id: D3
    description: "A profiles read error or missing row throws and never defaults a role; an unknown role is sent to /pending-approval with no list read"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#role read discipline"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mark and Rename callbacks reach the table only under allocatorFurniture; every role's row links read ?from=strategies on the merged page"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/StrategiesSection.test.tsx"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#R-04"
        status: pass
    human_judgment: false
  - id: D5
    description: "The index and its parent layout call no requireRolePage; every sub-route is still guarded by its own layout"
    requirement: LEAN-01
    verification:
      - kind: unit
        ref: "src/__tests__/strategies-guard-coverage.test.ts"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/requireRolePage-wiring.test.tsx#strategies/layout is a negative case"
        status: pass
    human_judgment: false
---

# Phase 199 Plan 09: Strategies index admits every owner Summary

`/strategies` now opens for allocators, managers and `both` and shows each role its own furniture (the page reads `profiles.role` and builds manager-only controls server-side), with one client host, `StrategiesSection`, mounting the table for every role and a required `origin` prop that keeps the merged page's row links at `?from=strategies`.

## Accomplishments

- Task 1 (tracer): RED committed first (8 failing cases across the merged, guard-coverage and wiring suites), then GREEN. `strategies/layout.tsx` is reduced to force-dynamic plus the session check and its docblock names the two 199-04 guard layouts. The page reads `profiles.role` with `requireRolePage`'s discipline (DB error logged, captured, thrown; missing row thrown; unknown role denied by default through `roleSurfaceHome`), derives `isManager` / `isAllocator`, builds `editHref` and `actions` only when `isManager` (note always), runs the intro read and renders PendingIntros and New Strategy only when `isManager`, and passes `allocatorFurniture={isAllocator}`.
- Task 2: `git mv` of `MyStrategiesSection` to `strategies/StrategiesSection` (export renamed). New props: required `origin` (R-04), `managerRows`, `allocatorFurniture`, `initialSort`; `placeholderKeys`, `portfolioId`, `percentiles` became optional so the merged page can mount it before 199-10 supplies the allocator reads. Mark/Rename callbacks are minted only when `allocatorFurniture` is on. The merged page mounts the section with `origin={{ key: "strategies" }}`; `/my-strategies` mounts it with its own origin and `allocatorFurniture`. Parity pin 10 now names the section as the one widening consumer and keeps the page's list-read regex (plus a check that the page mounts the section and no longer passes the widening prop itself).
- `categorySlug` is derived from `origin.key` rather than hard-coded, so the merged page keeps `"strategies"` and the old page keeps `"my-strategies"` exactly as before.

## Task Commits

1. RED: `9780fc801` test(199-09): failing tests for the widened strategies index
2. Task 1 GREEN: `ace9334b0` feat(199-09): the strategies index admits every owner, with furniture by role
3. Task 2: `a19a8c2c6` feat(199-09): one client host mounts the strategies table for every role

## Neuter evidence

gc-199-09-neuter: Task 1 - `editHref` built for every row regardless of role in strategies/page.tsx (byte backup, restored, `cmp` identical). RED: the allocator case failed (`an allocator opens the page ...`, an Edit link rendered); 1 failed / 6 passed. Restored and GREEN.

gc-199-09-neuter: Task 2 (a) - Mark/Rename callbacks passed for every role. Run exactly as the plan words it (callbacks only), the suite stayed GREEN (9 passed): the table's own `allocatorFurniture` gate is a second lock and hides the controls, so a page-level case cannot see the first lock alone. Recorded honestly, then the neuter was widened to defeat BOTH locks (callbacks for every role and `allocatorFurniture` forwarded as true): RED, 3 failed (`StrategiesSection.test.tsx` callbacks case, the manager furniture case, the Mark/Rename case). Restored, `cmp` identical, GREEN. The new `StrategiesSection.test.tsx` exists so the first lock is pinned by itself (see Deviations).

gc-199-09-neuter: Task 2 (b) - merged page passed the my-strategies origin. RED: `R-04: every role's row links read /factsheet/{id}?from=strategies` and page.table.test's `links every status's name to /factsheet/<id>` both failed (2 failed / 18 passed). Restored, `cmp` identical, GREEN.

## Verification

All commands run from the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: 8 claims checked, OK (exit 0).
- `npx vitest run "src/app/(dashboard)/strategies" "src/app/(dashboard)/my-strategies" src/__tests__/phase-149-my-strategies-parity.test.ts "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx" src/components/strategy src/__tests__/strategies-guard-coverage.test.ts "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/components/layout/DashboardChrome.test.tsx`: 116 files, 2225 tests, all passed, none skipped.
- `npx tsc --noEmit -p .`: exit 0, no output.
- Lint: scoped `npx eslint` over the touched directories and files: no output (clean). `npm run lint`'s four script checks (`check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain`): exit 0 each. The full `eslint --cache ... src/` was NOT run, to avoid writing its cache into the shared node_modules symlink; CI runs it.
- Acceptance: `requireRolePage(` in strategies/layout.tsx = 0; `from("profiles")` in strategies/page.tsx = 1; old section file absent and new present; `<StrategiesSection` in page = 1; `key: "my-strategies"` in the section = 0; `origin={{ key: "strategies" }}` in the page = 1 and `origin={{ key: "my-strategies" }}` in my-strategies/page = 1.
- BASE = `65cf394c42466c383817a8e63ee28a1efd3e99c6`. `git diff --exit-code "$BASE"..HEAD -G'from=strategies' -- "src/app/(dashboard)/strategies/page.table.test.tsx"` exit status 0 (the `?from=strategies` assertion is unedited; the file's only changes are the `profiles` branch and the `useRouter` stub).

gc-199-09-gates: vitest=green tsc=clean lint=clean (scoped eslint + the four npm-run-lint scripts; full cached eslint left to CI)

## Left to CI

- No SQL touched, no migration, no local Supabase stack booted (disk rule). The sql-tests / local-stack jobs are unaffected by this plan.
- The full `npm run lint` eslint pass over `src/`.
- E2E (`e2e/*`) was not run; `e2e/my-strategies.spec.ts` keeps `?from=my-strategies` until plan 199-17 retargets it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Five page suites needed a `useRouter` stub**
- **Found during:** Task 2 (first full run after mounting the section).
- **Issue:** The plan says each page test changes only by one `profiles` branch. But once the page renders `StrategiesSection` (a client component calling `useRouter`), the five suites' `next/navigation` mocks (which define only `redirect`) throw `No "useRouter" export is defined on the mock`; ~40 cases failed.
- **Fix:** One line per suite, `useRouter: () => ({ refresh: () => {} })`, with a comment. No assertion edited.
- **Files modified:** page.key-pill, page.share-affordance, page.table, page.wizard-draft-banner, page.wizard-submitted test files.
- **Commit:** `a19a8c2c6`

**2. [Rule 2 - Missing critical] New `StrategiesSection.test.tsx`**
- **Found during:** Task 2, neuter (a).
- **Issue:** The plan's neuter (a) (callbacks passed for every role) does not go RED at page level because the table's own `allocatorFurniture` gate hides the controls. Without a test the section's lock was unpinned, and the neuter evidence the plan asks for could not be produced.
- **Fix:** A small suite replacing StrategyTable with a prop probe: callbacks absent unless `allocatorFurniture`, origin forwarded and `categorySlug` taken from it, `visibility`/`managerRows`/`initialSort` forwarded. File is outside the plan's `files_modified`.
- **Commit:** `a19a8c2c6`

**3. [Rule 3 - Blocking] `placeholderKeys`, `portfolioId`, `percentiles` made optional on the section**
- The merged page has no allocator reads until 199-10; defaults are `[]`, `null`, `null`. `/my-strategies` still passes all three.

### Plan wording adjustments (no behavior change)

- The `PageHeader` mock in the new merged suite renders `actions` (the other suites drop it) because "no New Strategy for an allocator" lives in that slot.
- The wiring test's `SURFACES` lost its `strategies/layout` entry and gained a negative-case block (renders children, calls no guard, no redirect; signed-out still goes to `/login?redirect=/strategies`).

## Known Stubs

None.

## Notes for downstream plans

- The empty-list state in `strategies/page.tsx` still shows "Create your first strategy" (a /strategies/new link) to every role, so an allocator with zero strategies sees a CTA the manager guard would bounce. Plan 199-10 owns the empty states; I left it untouched.
- Stale prose naming `MyStrategiesSection` remains in `src/components/strategy/StrategyTable.tsx` (a comment) and `src/lib/wizardErrors.ts` (comments); both files are outside this plan's list and nothing reads them. Worth a sweep in 199-13 when /my-strategies is retired.
- `liveShareIds` (the strategy_shares read) still runs for allocators although only manager actions use it; harmless, 199-10 may want to gate it.

## Threat Flags

None. The widened index reads only the viewer's own rows (`.eq("user_id", user.id)` pinned by parity pin 10 and asserted per role in the merged test), manager furniture is built only when `isManager` (T-199-14), a role read error throws (T-199-15), sub-routes keep their own guards (T-199-29), and the origin is a required prop (T-199-33).

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/strategies/StrategiesSection.tsx, StrategiesSection.test.tsx, page.merged.test.tsx; my-strategies/MyStrategiesSection.tsx absent (deleted as declared).
- FOUND commits: 9780fc801, ace9334b0, a19a8c2c6 (ancestors of HEAD).
