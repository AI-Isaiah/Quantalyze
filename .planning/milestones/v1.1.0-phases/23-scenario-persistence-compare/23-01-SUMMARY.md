---
phase: 23-scenario-persistence-compare
plan: 01
subsystem: database
tags: [postgres, rls, supabase, migration, scenarios, jsonb, typescript, tdd]

# Dependency graph
requires:
  - phase: 21-surfacing-correlation-honest-projection
    provides: ScenarioDraft shape + scenario surfaces this persists
provides:
  - scenarios table (per-allocator durable ScenarioDraft store) with owner RLS
  - scenarios_owner FOR ALL policy (USING + WITH CHECK allocator_id = auth.uid())
  - (allocator_id, updated_at DESC) list-ordering index
  - schema_version column present from the first migration (forward-compat for 26/27/28)
  - two-tenant content RLS test asserting cross-tenant isolation by row id
  - hand-patched scenarios Row/Insert/Update/Relationships in database.types.ts (expectTypeOf-pinned)
affects: [23-02 save/update/list routes, 23-03 reopen+hydrate, 23-04 compare, 24 benchmark, 25 sharing, 26 stress, 27 monte-carlo, 28 optimizer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner RLS by mirroring api_keys_owner (FOR ALL, USING + WITH CHECK on the owner column)"
    - "RLS honesty test: assert cross-tenant CONTENT by specific row id, never policy presence"
    - "Hand-patched generated types with a tripwire comment + expectTypeOf drift pins"

key-files:
  created:
    - supabase/migrations/20260621120000_scenarios_table_and_rls.sql
    - supabase/migrations/down/20260621120000-rollback.sql
    - supabase/tests/test_scenarios_rls.sql
  modified:
    - src/lib/database.types.ts
    - src/lib/database.types.test.ts

key-decisions:
  - "name carries no uniqueness constraint (allocators save same-titled variants; a UNIQUE would be a 23505 timebomb)"
  - "No set_updated_at() trigger fn (would trip dump-sql-functions snapshot gate); UPDATE route touches updated_at = now() instead"
  - "RLS test asserts the negative write path via ROW_COUNT = 0 (FOR-ALL owner filters B's row from A's view) rather than a 42501 raise"

patterns-established:
  - "scenarios_owner: owner-only FOR ALL policy keyed on allocator_id = auth.uid() (profiles.id IS the auth uid)"
  - "Two-tenant RLS content test: forge request.jwt.claims sub + SET LOCAL ROLE authenticated, assert by captured row id"

requirements-completed: [PERSIST-01]

# Metrics
duration: 7min
completed: 2026-06-21
---

# Phase 23 Plan 01: Scenario Persistence Foundation Summary

**`scenarios` table with allocator-owned RLS, a two-tenant cross-content isolation test (asserted by row id), and a hand-patched `database.types.ts` block — the durable ScenarioDraft spine every later Phase 23+ plan builds on.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-21T20:27:55Z
- **Completed:** 2026-06-21T20:34:45Z
- **Tasks:** 3 (Task 3 was TDD: RED → GREEN)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- Forward-timestamped `scenarios` migration: table + `scenarios_owner` RLS (FOR ALL, USING + WITH CHECK on `allocator_id = auth.uid()`) + name CHECK (`length(btrim) 1..120`) + `(allocator_id, updated_at DESC)` list index + matching `DROP TABLE … CASCADE` rollback.
- `schema_version int not null` present from this first migration so Phases 26/27/28 can add forward-compatible fields without a column migration.
- Two-tenant `test_scenarios_rls.sql`: seeds `auth.users → profiles → scenarios` for tenants A and B, captures each row id, and asserts cross-tenant content isolation by id (A sees `scen_a_id`, A cannot see `scen_b_id` — `CROSS-TENANT LEAK`), the negative write path (A's UPDATE/DELETE of B's row affects 0 rows; B unchanged by id), and the positive own-row path.
- Hand-patched `scenarios` Row/Insert/Update/Relationships into `database.types.ts` mirroring the `for_quants_leads` quad, with a new HAND-PATCHED tripwire comment, `expectTypeOf`-pinned in `database.types.test.ts`; the `[#14]` critical-regressions guard stays green (GENERATED-FILE header + `migration 115` notify_* tripwire preserved).

## Task Commits

Each task was committed atomically:

1. **Task 1: scenarios migration + rollback** - `d31b91ee` (feat)
2. **Task 2: two-tenant content RLS test** - `0066d729` (test)
3. **Task 3: hand-patch database.types.ts + expectTypeOf pins** - `73d004e2` (test, RED) → `48b12210` (feat, GREEN)

## Files Created/Modified
- `supabase/migrations/20260621120000_scenarios_table_and_rls.sql` - scenarios table + `scenarios_owner` RLS + name CHECK + list index
- `supabase/migrations/down/20260621120000-rollback.sql` - `DROP TABLE scenarios CASCADE`
- `supabase/tests/test_scenarios_rls.sql` - two-tenant cross-content RLS assertions by row id (read + negative write + positive own-row)
- `src/lib/database.types.ts` - hand-added `scenarios` Row/Insert/Update/Relationships block + tripwire comment
- `src/lib/database.types.test.ts` - `expectTypeOf` drift pins for the scenarios columns

## Decisions Made
- **No name uniqueness** — allocators routinely save same-titled variants; a UNIQUE on `name` would be a 23505 timebomb on the save path (CONTEXT line 29).
- **No `set_updated_at()` trigger** — a tracked function would trip the `dump-sql-functions.ts --check` snapshot gate; the UPDATE route (Plan 02) will touch `updated_at = now()` in its payload instead. A plain table + policy + index defines no tracked function.
- **Negative write path asserted by `ROW_COUNT`** — because `scenarios_owner` is `FOR ALL` (not deny-INSERT like `funding_fees`), A's UPDATE/DELETE of B's row is filtered to 0 rows rather than raising 42501. The test asserts `GET DIAGNOSTICS affected = 0` then verifies B's row unchanged by id under service role.
- **Relationships FK shape** — modeled the `allocator_id` FK on both `profiles` and `public_profiles` (referencedColumns `["id"]`), mirroring the `for_quants_leads_processed_by_fkey` analog.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Update `draft` pin over-stripped `null` via `NonNullable`**
- **Found during:** Task 3 (GREEN — typecheck gate)
- **Issue:** The test pinned `NonNullable<Update["draft"]>` to `Json`, but `Json` is itself nullable (`… | null`); `NonNullable` strips both `undefined` and `null`, so the type no longer equaled `Json` and `tsc` failed with `TS2344`.
- **Fix:** Introduced a local `Defined<T> = Exclude<T, undefined>` helper that strips only the optionality (`undefined`) and keeps `null`, plus an explicit `toMatchTypeOf` optionality assertion. Same correction applied to the Update block's `name`/`schema_version`/`updated_at` pins.
- **Files modified:** src/lib/database.types.test.ts
- **Verification:** `npm run typecheck` clean; `npx vitest run` 127/127 pass.
- **Committed in:** `48b12210` (GREEN commit)

**2. [Rule 3 - Blocking] Reworded header comments tripping verification greps**
- **Found during:** Task 1 (rollback grep gate) and Task 2 (meta-command preflight grep)
- **Issue:** The plan's automated verify gates use loose substring greps. My SQL header comment "NO UNIQUE constraint on name" matched the negative `UNIQUE.*name` gate, and the RLS-test header literally listing `\!`/`\copy`/`\o` matched the meta-command gate — both false positives on documentation text, not on actual SQL.
- **Fix:** Reworded the migration comment ("the name column carries no uniqueness constraint") and the test header ("no psql backslash meta-commands") so neither documentation line trips a verification grep; the actual SQL bodies were always correct. Verified clean against the EXACT CI preflight regexes in `.github/workflows/ci.yml:686-701`, not just the looser local pattern. Also normalized the rollback to the literal `DROP TABLE scenarios CASCADE` form the plan's gate + acceptance criteria require.
- **Files modified:** supabase/migrations/20260621120000_scenarios_table_and_rls.sql, supabase/migrations/down/20260621120000-rollback.sql, supabase/tests/test_scenarios_rls.sql
- **Verification:** All Task 1/2 plan gates pass; CI preflight patterns return 0 matches.
- **Committed in:** `d31b91ee` (Task 1), `0066d729` (Task 2)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes were necessary for the gates to pass and reflect documentation/test-helper corrections, not schema changes. The scenarios table contract, RLS policy, and types match the plan exactly. No scope creep.

## Issues Encountered
- Vitest runs `expectTypeOf` bodies but erases type assertions at runtime, so `npx vitest run` passed even in the RED state. The genuine RED/GREEN signal for type pins is `npm run typecheck` (TS2339 in RED → clean in GREEN). Used the type-checker as the binding TDD gate.

## TDD Gate Compliance
Task 3 followed RED → GREEN: `test(...)` RED commit `73d004e2` (typecheck failing with TS2339 "Property 'scenarios' does not exist") precedes the `feat(...)` GREEN commit `48b12210` (hand-patch lands, typecheck clean). No REFACTOR commit needed — the hand-patch is the minimal implementation.

## Known Stubs
None. The migration, RLS test, and types are complete and verified; no placeholder/TODO patterns introduced. (The save/update/list ROUTES that consume this table are Plan 23-02, not this plan's scope.)

## User Setup Required
None — no external service configuration. The migration applies at /land-and-deploy (anon NO-EXEC verified); it was NOT pushed to prod from this plan (no `supabase db push`).

## Next Phase Readiness
- The `scenarios` persistence spine is ready: Plan 23-02 (save/update/list/delete routes) can build single-row `supabase.from("scenarios")` writes under the owner RLS, sourcing `allocator_id` from `withAllocatorAuth` (never the body).
- `database.types.ts` exposes `scenarios` Row/Insert/Update so route + test code typechecks immediately.
- The RLS content test will run green in the `sql-tests` CI job once the migration is applied to the test project.
- **Land-time verify (manual, not autonomous):** after the migration applies, confirm an anon query of `scenarios` is denied / returns 0 rows.

## Self-Check: PASSED

- Files present: all 5 code/test files + SUMMARY verified on disk.
- Commits present: `d31b91ee` (Task 1 feat), `0066d729` (Task 2 test), `73d004e2` (Task 3 RED test), `48b12210` (Task 3 GREEN feat) — all on `feat/v1.1.0-scenario-persistence`.
- Gates green: `npx vitest run` 127/127 pass; `npm run typecheck` clean; all Task 1/2 grep gates pass; CI sql-tests meta-command preflight returns 0 matches.
- TDD: RED `test` commit precedes GREEN `feat` commit for Task 3.

---
*Phase: 23-scenario-persistence-compare*
*Completed: 2026-06-21*
