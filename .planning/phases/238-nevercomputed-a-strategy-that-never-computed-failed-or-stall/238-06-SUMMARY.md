---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 06
subsystem: ui
tags: [factsheet, computed_at, null-dash, types, FACT-03]
status: complete
requires: [238-04]
provides:
  - "src/lib/factsheet/never-computed-stamp.ts: NEVER_COMPUTED_STAMP and isNeverComputedStamp, the only source file holding the epoch literal"
  - "Factsheet Terms 'Factsheet computed' and the footer stamp read the null dash for a never-computed row, never 1970"
  - "StrategyAnalytics.computed_at: string | null; strategy_analytics Row string | null, Insert/Update optional string | null; AdminTabs row type nullable"
affects: [238-07, 238-08, 238-09]
key-files:
  created:
    - src/lib/factsheet/never-computed-stamp.ts
    - src/lib/factsheet/never-computed-stamp.test.ts
    - src/app/factsheet/[id]/v2/never-computed-date.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MandatePanels.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/types.ts
    - src/lib/database.types.ts
    - src/components/admin/AdminTabs.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
key-decisions:
  - "The payload keeps computedAt: string. The epoch is recognised through one shared helper, so the payload type, its builders, the census fixtures and the factsheet-v2-payload cache key (now v29) are untouched and not bumped"
  - "SyncPreviewStep reads a loose Record<string, unknown> row, so a cast cannot simply be dropped: the date is narrowed with typeof === string, which keeps NULL as null and leaves no cast"
requirements-completed: [FACT-03]
completed: 2026-11-26
commits: 2
plan_head_before: b456966a9
plan_head_after: 1ad2b6564c11ae01a0fdb7d85bf85aed7e647971
actuals:
  tokens: 4100
  tasks: 2
  commits: 2
---

# Phase 238 Plan 06: never-computed date render arms and the computed_at type flip Summary

A never-computed factsheet now shows the DESIGN.md null dash where it used to print `Jan 1, 1970`, and `StrategyAnalytics.computed_at` is typed `string | null` with a clean typecheck.

## What shipped

**Task 1 (c10f9e633, tracer).** `never-computed-stamp.ts` is pure and import-free. `fetch-and-build-payload.ts` writes `NEVER_COMPUTED_STAMP` for a NULL date. `FactsheetView.tsx` lost its local `EPOCH_SENTINEL`: `FreshnessChip` tests `isNeverComputedStamp` (its `Computed · not yet` / `N/A` arm and copy are unchanged, per the plan's flagged assumption), and the footer stamp passes null to `formatDay` for the sentinel, ending `· —`. `MandatePanels.tsx` does the same for the Terms `Factsheet computed` cell, which keeps its classes. `never-computed-date.test.tsx` renders `TermsPanel` and the whole `FactsheetView` over census payload A with the sentinel and with a real date.

**Task 2 (1ad2b6564).** `types.ts`, the `strategy_analytics` block of `database.types.ts`, `AdminTabs.tsx`'s row type, and `SyncPreviewStep.tsx`.

## Reader NULL arms (for 238-08's census)

| File | NULL arm |
|---|---|
| `src/lib/types.ts` | `StrategyAnalytics.computed_at: string \| null`, docblock says NULL is never computed and never fresh |
| `src/lib/database.types.ts` | `strategy_analytics` `Row` `string \| null`, `Insert` and `Update` `?: string \| null` (lines 2887, 2925, 2963) |
| `src/components/admin/AdminTabs.tsx` | local row type `computed_at: string \| null`; `computeRecency`/`everComputed` already answers the null dash |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` | `computedAt` is `typeof row.computed_at === "string" ? row.computed_at : null`, no cast |

`tsc --noEmit -p tsconfig.json` after the flip named exactly one error, the `SyncPreviewStep.tsx` cast site. It names no reader outside `files_modified`, so the cap of 8 was never in play. Already-NULL-safe by inspection, unchanged: `computeFreshness(null)` returns `stale` (`src/lib/freshness.ts`), `freshnessScore(null)` returns 0 (`src/lib/health-score.ts`).

Hand-patched generated types: the three `database.types.ts` lines are a hand patch, because PROD auto-applies on merge and this worktree's lane does not carry 238-05's migration until replay. 238-09 regenerates against the local-stack lane after the replay and must find no diff in these hunks.

## Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0 before the flip and after it.
- `npx eslint` over the nine touched or created source and test files: clean. The repo-level lint scripts (`check-planning-hygiene` and the rest) are run at the end, see below.
- Vitest, `--maxWorkers=2`: `never-computed-stamp.test.ts` plus `never-computed-date.test.tsx` 5 tests; `src/lib/factsheet/never-computed-stamp.test.ts`, `audit-c20.test.ts` and all of `src/app/factsheet/[id]/v2`: 135 files, 2013 tests passed; `freshness`, `health-score`, `AdminTabs` and `SyncPreviewStep*`: 16 files, 339 tests passed.
- Acceptance greps: the epoch literal appears in no non-test source file other than `never-computed-stamp.ts`; `grep -rEn "computed_at!\.|computed_at as string" src` prints one hit, `recommendations/page.tsx:207`, a match batch (another table), as the plan allows; `database.types.ts` strategy_analytics block holds 3 nullable `computed_at` lines.

## PROOF-01

**Neuter N** (byte backup of `MandatePanels.tsx` in the scratchpad, `cmp` equal before the neuter): restored `const computed = formatDay(payload.computedAt);` in `TermsPanel`. Expected RED observed, verbatim from vitest:

```
× Terms `Factsheet computed` reads the null dash for the sentinel, and the document has no 1970
Expected: "—"
Received: "Jan 1, 1970"
Tests  1 failed | 2 passed (3)
```

Restored with `cp` from the backup; `cmp` exit 0; GREEN, 3 of 3. The footer arm of the same test file fails the same way if its `isNeverComputedStamp` guard is removed (same file, same helper); it was not separately neutered, which the plan does not require.

## Deviations from Plan

None. Rule 1 to 3 triggers: none. The plan says to drop the `SyncPreviewStep` cast; because the row is typed `Record<string, unknown>`, a bare `?? null` does not compile (`{} | null`), so a `typeof` narrowing replaced the cast. This is the plan's intent (type tells the truth, no cast), not a deviation of outcome. Readers changed beyond `files_modified`: none.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or trust boundary.

## Notes for the next plans

- `FreshnessChip` still shows `Computed · not yet` / `N/A` for a never-computed row (Phase 237's seam, recorded as a flagged assumption). It is not the Numbers Contract dash.
- The pre-existing `EPOCH_SENTINEL` literal in `src/lib/factsheet/audit-c20.test.ts` is a test-local copy used to document the 1970 behaviour; it is test code and was left alone.
