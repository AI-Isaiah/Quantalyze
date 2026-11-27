---
phase: 244-accessguards-an-owner-read-without-its-key-id-fails-to-compi
plan: 01
subsystem: frontend-types
tags: [typescript, compile-guard, api_key_id, DBACC-04, PROOF-01]
requires: []
provides:
  - "Strategy.api_key_id required (string | null)"
  - "PublicStrategy and PublicRankedStrategyRow key-free types"
  - "src/__tests__/api-key-id-compile-guard.test.ts (ARM-1..4, ARM-OWNER, ARM-OWNER-READ)"
affects:
  - src/lib/types.ts
  - src/lib/queries.ts
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
tech-stack:
  added: []
  patterns: ["@ts-expect-error arms in a never-invoked function, gated by tsc --noEmit"]
key-files:
  created:
    - src/__tests__/api-key-id-compile-guard.test.ts
  modified:
    - src/lib/types.ts
    - src/lib/queries.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
decisions:
  - "Consumers (StrategyTable, StrategyGrid) relax their LOCAL row type instead of casting a public row to Strategy"
metrics:
  duration: "about 20 minutes"
  completed: 2026-11-27
status: complete
commits: 2
plan_head_before: 6e5f1840f053d2f43c21f8f807eaea3afe6af171
plan_head_after: 279636ca05d61032c10adfa8cf043a83331a1c04
actuals:
  tokens: 2500
  tasks: 3
  commits: 2
verified_at_sha: 279636ca05d61032c10adfa8cf043a83331a1c04
drift_subjects:
  - src/lib/types.ts
  - src/lib/queries.ts
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/__tests__/api-key-id-compile-guard.test.ts
---

# Phase 244 Plan 01: DBACC-04 compile guard Summary

`Strategy.api_key_id` is now required, the two `STRATEGY_PUBLIC_COLUMNS` readers return key-free types, and a type-level test proves that assigning a key-free row to `Strategy` does not compile.

`commits: 2` is measured from the plan ledger to `plan_head_after` (the two task commits). The SUMMARY's own docs commit comes after that and is not counted. Task 3 changes no tracked file, since `types.ts` is byte-restored.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `ceae777db` | required field, `PublicStrategy`, `getFactsheetDetail` retyped, guard test with ARM-1..3 and ARM-OWNER |
| 2 | `279636ca0` | `PublicRankedStrategyRow`, `getStrategiesByCategory` retyped, `StrategyTable` and `StrategyGrid` local row type relaxed, ARM-4 and ARM-OWNER-READ added |
| 3 | none | PROOF-01 only; `src/lib/types.ts` restored byte-identical |

## Results

- `npx tsc --noEmit --incremental false`: exit 0, 0 `error TS` lines after Task 1, after Task 2, and after the PROOF-01 restore.
- `npx eslint` on the five files: exit 0.
- `npx vitest run src/__tests__/api-key-id-compile-guard.test.ts`: 1 passed.
- Task 2 touched-surface sweep (`src/lib/queries`, `src/lib/anon-strategies`, `src/components/strategy`, `src/app/browse`, discovery, strategies, `src/app/factsheet`, `src/app/api/factsheet`, `seam-citations.invariant`, the guard test): 300 of 301 files passed, 5457 tests passed, 14 skipped, 1 failed. The failure was `src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx`, test "a summary with p3y / p5y ABSENT ...". The failure message was cut off in the captured output, so the cause is not confirmed. Re-run alone it passes 16/16. I read it as a load-related flake in a 300 s parallel run. That is a judgement, not a measurement; the file does not touch any of the changed types at runtime.
- `grep -cE 'as (unknown as )?Strategy\b' src/lib/queries.ts` prints 3, same as HEAD (no cast added).
- The two category pages and `StrategyTable.stale-analytics.test.tsx` are unchanged (`git diff --quiet` against the base exits 0), so no consumer edit was needed beyond the two components.
- Assumption A4 (RESEARCH): the `ARM-OWNER-READ` arm on a `getMyStrategies` row compiles at green with no fallback to `RankedStrategyRow["api_key_id"]`.

## PROOF-01 (neuter, RED, byte restore, GREEN)

1. Backup: `cp src/lib/types.ts $SCRATCH/244/types.ts.bak`, `cmp` clean.
2. Neuter: in `Strategy`, `api_key_id: string | null;` became `api_key_id?: string | null;` (one-line diff, nothing else).
3. RED, `npx tsc --noEmit --incremental false` output verbatim:

```
src/__tests__/api-key-id-compile-guard.test.ts(45,3): error TS2578: Unused '@ts-expect-error' directive.
src/__tests__/api-key-id-compile-guard.test.ts(48,3): error TS2578: Unused '@ts-expect-error' directive.
src/__tests__/api-key-id-compile-guard.test.ts(53,3): error TS2578: Unused '@ts-expect-error' directive.
src/__tests__/api-key-id-compile-guard.test.ts(58,9): error TS2322: Type 'string | null | undefined' is not assignable to type 'string | null'.
  Type 'undefined' is not assignable to type 'string | null'.
src/__tests__/api-key-id-compile-guard.test.ts(61,9): error TS2322: Type 'string | null | undefined' is not assignable to type 'string | null'.
  Type 'undefined' is not assignable to type 'string | null'.
```

   5 `error TS` lines. The first is TS2578 at line 45, and `sed -n 45p` of the test file gives the ARM-1 directive:
   `  // @ts-expect-error - ARM-1: a public projection is not an owner row`.
   Line 48 is ARM-2, line 53 is ARM-4, lines 58 and 61 are ARM-OWNER and ARM-OWNER-READ. ARM-3 does not flip, as the plan predicted (`Omit` removes the key regardless; it guards `PublicStrategy` itself).
4. Restore: `cp $SCRATCH/244/types.ts.bak src/lib/types.ts && cmp ...` printed `cmp=0`. `git status --porcelain -- src/lib/types.ts` printed nothing (no change beyond the committed state).
5. GREEN: `npx tsc --noEmit --incremental false` printed `tsc_exit=0` and 0 `error TS` lines.

## Deviations from Plan

None. The plan executed as written, with no consumer edits beyond the two planned components.

Note on task split: the Task 1 test file was committed with ARM-1..3 and ARM-OWNER only. ARM-4 and ARM-OWNER-READ depend on the Task 2 retype, so they were added in Task 2 to keep each commit green.

## Known limits

The guard protects code that takes `Strategy`. It does not make an owner read that lost `api_key_id` fail to compile, because every owner read is typed by a cast or an explicit generic over an unchecked select string. A structurally typed helper that declares the key optional (the owner list page's `shapeOf` in `src/app/(dashboard)/strategies/page.tsx`) is invisible to it. The test header says so. `src/lib/anon-strategies-projection.test.ts` covers the PUBLIC readers' projections only, NOT owner selects (corrected in review round 1, WR-01). Owner selects are pinned by the source scan `src/__tests__/api-key-id-owner-read-pin.test.ts` (added in fix round 1).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface.

## Closes

TODOS id `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`: the ship deletes it and names it in the CHANGELOG.

## Self-Check: PASSED

- `src/__tests__/api-key-id-compile-guard.test.ts` exists; `ceae777db` and `279636ca0` are ancestors of HEAD.
- No file deletions in either commit.
