---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 02
subsystem: percentile-ranking / csv-finalize clock-safety guard
status: complete
tags: [D-12, D-18, D-19, TODOS-0f, byte-pin, percentile, csv-finalize]
requires: []
provides:
  - "byte pins on the percentile KPI projection (queries.ts) and on the csv-finalize clock-safety guard select"
  - "PERCENTILE_ANALYTICS_COLUMNS and CLOCK_SAFETY_KPI_COLUMNS derived from PERCENTILE_METRICS"
  - "CommaSpaceJoined<T> type in percentile-core.ts"
affects: [src/lib/queries.ts, src/app/api/strategies/csv-finalize/route.ts, src/lib/closed-sets.ts, src/lib/percentile-core.ts]
tech-stack:
  added: []
  patterns:
    - "pin FIRST on the old literal, observe RED on a separator mutation, then derive"
    - "type-level join of a const tuple so postgrest-js keeps parsing a derived select string"
key-files:
  created:
    - src/lib/queries.percentile-columns.test.ts
  modified:
    - src/lib/queries.ts
    - src/lib/percentile-core.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/lib/closed-sets.ts
    - src/__tests__/csv-finalize-cross-submission-merge.test.ts
decisions:
  - "The derived queries.ts projection is narrowed with a new type CommaSpaceJoined<typeof PERCENTILE_METRICS> (percentile-core.ts) instead of the repo's older `join(', ') as \"<literal>\"` idiom (API_KEY_USER_COLUMNS in constants.ts), because a hand-written literal type would be a fifth copy of the seven names"
  - "The route's guard select needs no cast: the guard's helper takes an untyped SupabaseClient, so its select string is not parsed at the type level"
metrics:
  duration: "about 35 min"
  completed: 2026-09-24
actuals:
  tokens: 4437
  tasks: 2
  commits: 2
plan_head_before: 73cbf2995da56879f4c242347c9a9c05d910118a
---

# Phase 166 Plan 02: KPI column lists derived from PERCENTILE_METRICS Summary

The two hand-kept KPI column lists (`PERCENTILE_ANALYTICS_COLUMNS` in queries.ts, and `CLOCK_SAFETY_KPI_COLUMNS` plus the guard's select in the csv-finalize route) are now derived from `PERCENTILE_METRICS`. Two byte pins, both written by hand and both seen to fail, prove the strings sent to PostgREST did not change by one byte (Phase 159 D-03).

## Tasks

| Task | Name | Commit | Files |
|---|---|---|---|
| 1 (tracer) | Pin the queries.ts KPI projection, then derive it | `1e998899e` | queries.percentile-columns.test.ts (new), queries.ts, percentile-core.ts |
| 2 | Pin the csv-finalize guard select, then derive it, and correct the mirror prose | `da13b3cd6` | csv-finalize-cross-submission-merge.test.ts, route.ts, closed-sets.ts |

## Observed pin lines (GREEN, then RED, then GREEN)

**Pin 1: `src/lib/queries.percentile-columns.test.ts`** (Tests A, B and C; Test D is how the file is built: the expected string is a hand-written literal and is never recomputed)
- GREEN on the UNCHANGED literal: `Tests  3 passed (3)`
- RED with the literal's first `, ` changed to `,` (`"cagr,sharpe, ..."`): `Tests  3 failed (3)`. The failing tests were getPercentiles() without a category, getPercentiles(slug) and getOwnRowPercentiles(), each with an Expected/Received diff.
- queries.ts was restored from the byte backup `<scratchpad>/166-02-queries.ts.bak` with `cp`, and `cmp` reported the files identical. Re-run: `Tests  3 passed (3)`.
- GREEN after the derivation, run with the existing oracle `queries.percentiles.test.ts`: `Test Files  2 passed (2)` / `Tests  13 passed (13)`.

**Pin 2: Test E, the BYTE PIN test in `src/__tests__/csv-finalize-cross-submission-merge.test.ts`** (Test F: the literal is written by hand)
- GREEN on the UNCHANGED route literal: `Tests  59 passed (59)`
- RED with the guard literal's first `, ` changed to `,`: `Tests  1 failed | 58 passed (59)` (`× BYTE PIN (Phase 159 D-03, Phase 166 D-18): ...`)
- The route was restored from `<scratchpad>/166-02-route.ts.bak` with `cp`, and `cmp` reported the files identical. Re-run: `Tests  59 passed (59)`.
- GREEN after the derivation: `Tests  59 passed (59)`
- Extra drill, beyond the plan: the DERIVED `PERCENTILE_METRICS.join(", ")` in the route was changed to `join(",")`. Result: `Tests  1 failed | 58 passed (59)`. The route was restored from `<scratchpad>/166-02-route-derived.ts.bak`, `cmp` reported identical, and the re-run gave `Tests  59 passed (59)`. So the pin bites on the derived form as well as on the old literal.

**Test C (getOwnRowPercentiles) was pinned.** The Supabase mock that serves getPercentiles also serves it (same `from().select().eq()` thenable chain), and an empty `ownRows` still reaches the select before the `< 5` population floor returns null.

## Final verification

- `vitest run csv-finalize src/lib/queries.percentile-columns.test.ts src/lib/percentile-core`: `Test Files  7 passed (7)` / `Tests  152 passed (152)`, exit 0
- `vitest run src/lib/queries src/app/(dashboard)/strategies` (wider projection regression check after Task 1): `Test Files  54 passed (54)` / `Tests  987 passed (987)`
- `tsc --noEmit -p .`: exit 0, no `error TS` lines
- `eslint` on route.ts, closed-sets.ts, queries.ts, percentile-core.ts and both test files: exit 0
- Acceptance greps:
  - `PERCENTILE_METRICS.join(", ")` in queries.ts: 1
  - `from "@/lib/percentile-core"` in route.ts: 1
  - `CLOCK_SAFETY_KPI_COLUMNS = PERCENTILE_METRICS`: 1
  - `PERCENTILE_GATE_COLUMN` in route.ts: 2
  - the pinned 8-column literal in the route test: 1
  - `member-for-member` in route.ts and queries.ts: 0 each
  - `mirrored member-for-` and `falsify three comments` in closed-sets.ts: 0 each. Both were confirmed to be 1 before the edit.
- The `node_modules` symlink (D-19) was removed before each commit, and `git show --name-only` shows no `node_modules` path in either commit.

## Prose sites rewritten

1. queries.ts: the `PERCENTILE_ANALYTICS_COLUMNS` "BYTE-FROZEN" docblock now says the list is derived from `PERCENTILE_METRICS` and is enforced by the byte pin test. The "mirrors it member-for-member in its prose" sentence is gone. The gate column still rides alongside and is never appended.
2. route.ts: the `CLOCK_SAFETY_KPI_COLUMNS` docblock now says the list is derived from the same array queries.ts uses, and that percentile-core has no imports. The "duplicated rather than imported" reason is removed.
3. route.ts: the guard's inline "⛔ The column set MIRRORS" comment now names `CLOCK_SAFETY_KPI_COLUMNS` / `PERCENTILE_METRICS`. The "`computation_status` JOINS THE PROJECTION, and it is NOT a member of `CLOCK_SAFETY_KPI_COLUMNS`" reasoning is unchanged.
4. closed-sets.ts: the RANK-01 comment above `PERCENTILE_GATE_COLUMN` now says the gate column stays a separate constant because every member of the KPI array is ranked as a KPI. The lists are derived and pinned.
5. csv-finalize-cross-submission-merge.test.ts: the clock-safety section header cited `queries.ts:126-127`, a line number that is now stale. It now cites `PERCENTILE_METRICS` by symbol.

## Out of scope (recorded, not touched)

`get_verified_cohort_rank` (the SQL RPC) keeps its own KPI list in SQL (see the 159 D-03 "parity-by-construction" prose). TypeScript cannot derive a SQL list, so it is outside D-12's scope (research Q7).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `PERCENTILE_METRICS.join(", ")` broke postgrest-js type parsing in queries.ts**
- **Found during:** Task 1, step 5 (tsc)
- **Issue:** `Array.prototype.join` returns plain `string`. postgrest-js parses the select string at the type level, so both getPercentiles and getOwnRowPercentiles typed their rows as `ParserError<...>`: 4 × TS2352/TS2339 in queries.ts. The research recommendation (`PERCENTILE_METRICS.join(", ")` alone) did not account for this.
- **Fix:** added `export type CommaSpaceJoined<T>` to `src/lib/percentile-core.ts`. It is a recursive template-literal type that computes the joined literal from the tuple itself, and percentile-core still has no imports. queries.ts casts the join to `CommaSpaceJoined<typeof PERCENTILE_METRICS>`, and the `analyticsColumns` composition in getPercentiles gained `as const` so it keeps its literal type. I chose this over the older `join(", ") as "<literal>"` idiom in constants.ts because that idiom would restate the seven names by hand, which is the copy D-12 removes. The runtime bytes are still pinned by the tests, not by the type.
- **Files modified:** src/lib/percentile-core.ts. It is **outside the plan's `files_modified`**, and the change is type-only. 166-01 touches only Python, so the plans stay file-disjoint.
- **Commit:** `1e998899e`

**2. [Rule 1 - stale citation] line-number citation in the route test header** (prose site 5 above). Fixed in `da13b3cd6`.

No other deviations. Nothing was exported from route.ts, no floor or coverage threshold moved, and no Python, database or remote was touched.

## Known Stubs

None.

## Threat Flags

None. The only new import into route.ts is percentile-core, which has no imports (T-166-05, accepted in the plan). No new endpoints or trust-boundary surface.

## Self-Check: PASSED

- FOUND: src/lib/queries.percentile-columns.test.ts
- FOUND: commit 1e998899e
- FOUND: commit da13b3cd6
