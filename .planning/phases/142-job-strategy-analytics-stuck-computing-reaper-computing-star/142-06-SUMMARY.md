---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
plan: 06
subsystem: frontend-types
tags: [job-01, strategy-analytics, row-type, blast-radius, reaper]
requires:
  - "nothing — wave 1, depends_on: []"
provides:
  - "StrategyAnalytics.computing_started_at: string | null — the frontend-visible half of the JOB-01 contract, available to every TS consumer of the row type"
  - "EMPTY_ANALYTICS carrying computing_started_at: null"
affects:
  - "142-03 (Python/TS writer stamping) — its src/app/api/keys/sync/route.ts payload compiles against this field"
  - "142-05 (SQL gate + migration) — the DDL this type line documents"
  - "any future StrategyAnalytics fixture — the required field forces conscious propagation"
tech-stack:
  added: []
  patterns:
    - "required T | null over optional T? on row types — optional is a silent-omission hole, not an escape from a compile blast radius"
    - "the tsc error list IS the census: let the compiler enumerate the propagation sites rather than grepping for them"
key-files:
  created: []
  modified:
    - src/lib/types.ts
    - src/lib/utils.ts
    - src/__tests__/analytics-format.test.ts
    - src/__tests__/phase-52-container-tabular-nums.test.tsx
    - src/components/charts/WorstDrawdowns.test.tsx
    - src/components/strategy/CompareTable.test.tsx
    - src/components/strategy/discovery-selectors.contract.test.tsx
    - src/components/strategy/StrategyGrid.test.tsx
    - src/components/strategy/StrategyTable.test.tsx
decisions:
  - "Field is string | null, never optional — T-142-19 mitigated, grep -cF 'computing_started_at?' returns 0"
  - "Base-literal insertion fixes BOTH the TS2741 and the TS2322 sites; no Partial-overlay type was weakened"
  - "database.types.ts left untouched — its pre-existing drift is a TODOS.md item owned by 142-03 Task 2"
metrics:
  duration: ~12 min
  tasks: 1
  files: 9 modified
  completed: 2026-08-02
---

# Phase 142 Plan 06: StrategyAnalytics `computing_started_at` Row Type Summary

`StrategyAnalytics` now carries `computing_started_at: string | null` with the reaper-cron
semantics in a comment, and the required field is propagated through its full compile blast
radius — `EMPTY_ANALYTICS` plus seven test fixtures — with typecheck green and zero behavior
change.

## What Was Built

**Task 1 — the type line and its 9-file blast radius** (commit `d96ac02f`)

- `src/lib/types.ts:292-296` — `computing_started_at: string | null;` inserted directly after
  `computed_at: string;` inside `StrategyAnalytics`, carrying the JOB-01 comment: NULL means
  "not currently computing"; the stamp is writer-set in the same statement that sets
  `computation_status='computing'` and cleared on every exit; the pg_cron reaper
  `reap_strategy_analytics_stuck_computing` (migration `20260802120000`) keys on this field and
  never on `computed_at`.
- `src/lib/utils.ts:182` — `EMPTY_ANALYTICS` gains `computing_started_at: null`. This exhaustive
  literal is exactly why the field could not land type-only.
- Seven test fixtures each gain the identical `computing_started_at: null,` key in their **base**
  object literal, beside `computed_at`.

The propagation was compiler-driven, not grepped: the two source edits were applied first, then
`npx tsc --noEmit` was run and every reported site fixed.

## Blast Radius vs. the Pinned Census (BLOCKER-2 acceptance)

The plan pinned a checker-measured census of 8 erroring files + `types.ts`. **The measurement
reproduced exactly — zero drift.** After the `types.ts` + `utils.ts` edits, `npx tsc --noEmit`
reported errors in precisely the 7 pinned test files and nothing else:

| File | Error class observed |
|------|---------------------|
| `src/__tests__/analytics-format.test.ts` | TS2741 (full literal missing the property) |
| `src/__tests__/phase-52-container-tabular-nums.test.tsx` | TS2322 (`string \| null \| undefined` from the `Partial` overlay) |
| `src/components/charts/WorstDrawdowns.test.tsx` | TS2322 |
| `src/components/strategy/CompareTable.test.tsx` | TS2322 |
| `src/components/strategy/discovery-selectors.contract.test.tsx` | TS2741 |
| `src/components/strategy/StrategyGrid.test.tsx` | TS2322 |
| `src/components/strategy/StrategyTable.test.tsx` | TS2322 |

The TS2322 shape is worth recording: those fixtures build `{ ...base, ...overrides }` where
`overrides: Partial<StrategyAnalytics>`. With the key absent from the base literal, only the
`Partial` contributes it, so it stays optional and carries `undefined`. Adding it to the base
literal makes TypeScript union the two contributions to `string | null` — so the base-literal
insertion is the correct fix for both error classes, and no type was widened to achieve it.

**Final `git diff --name-only | sort` equals the 9-file frontmatter list exactly.** No 10th file
appeared, so no conscious `files_modified` extension was needed and none was made.

## No Escape Hatches Used

Explicitly confirmed, since the threat model turns on it:

- `grep -cF "computing_started_at?" src/lib/types.ts` → **0**. The field is `T | null`, never
  optional (T-142-19 mitigated).
- `grep -n "computing_started_at: string | null" src/lib/types.ts` → **exactly 1 hit**, line 296,
  inside `StrategyAnalytics`, directly after `computed_at`.
- `src/lib/database.types.ts` is **untouched** — `git diff HEAD~1 HEAD -- src/lib/database.types.ts`
  is empty. Its known 2-column drift stays a TODOS.md item owned by plan 142-03 Task 2.
- No `undefined` was added to any union, no cast was introduced, no `Partial` overlay was
  weakened, and no production component or route file was modified.
- Zero packages installed (T-142-SC).

## Verification

| Gate | Result |
|------|--------|
| `npm run typecheck` | **exit 0** |
| `npx vitest run` (the 7 pinned suites, `--no-file-parallelism`) | **7 files / 74 tests passed** |
| `npm run lint` (incl. `check-admin-route-manifest` + `check-route-contract`) | **0 errors**; manifests OK (20 admin routes, 56 page routes) |
| `git diff --stat` | 9 files, **13 insertions, 0 deletions** |
| `grep -c "computing_started_at: null"` across the 8 literal sites | 1 each |

The single lint **warning** (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps`) is
pre-existing in a file this plan never touched — out of scope per the scope boundary, not
fixed, and not newly introduced.

Every hunk is a type line or a fixture literal key: the diff is purely additive with zero
deletions, which is the mechanical proof of "zero behavior changes". The 7 fixture suites pass
with their behavior unmodified.

## Deviations from Plan

None — plan executed exactly as written. No deviation rules were triggered.

The one *pre-approved* deviation the plan itself documented (9 files in a single task, against
the ≤5-file split signal) was honored as specified rather than "fixed": the edit set is atomic,
and any partition would have left `npm run typecheck` RED between task commits.

## Known Stubs

None. No placeholder values, no hardcoded empties, no unwired data sources — this plan adds a
type field and its literal propagation only.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or trust-boundary schema change
was introduced; the DDL itself belongs to plan 142-05.

## Notes for Downstream Plans

- The field is now **required**, so any new `StrategyAnalytics` object literal anywhere in the
  repo will fail to compile until it supplies `computing_started_at`. That is the intended
  forcing function — resolve it by supplying the value, never by making the field optional.
- Plan 142-03's `src/app/api/keys/sync/route.ts:532` failed-placeholder payload (ledger row
  SC-5c) compiles against this field; it did **not** appear in this plan's error census because
  that payload is not a full `StrategyAnalytics` literal today.

## Self-Check: PASSED

- All 9 modified files verified present on disk and in the commit's file list.
- Commit `d96ac02f` verified present via `git log --oneline --all`.
- Post-commit deletion check clean (`git diff --diff-filter=D HEAD~1 HEAD` empty).
- `git status --short` clean — no untracked leftovers.
