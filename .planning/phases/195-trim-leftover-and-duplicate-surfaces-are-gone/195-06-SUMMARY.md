---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 06
subsystem: ui
tags: [portfolios, orphan-deletion, vitest, display-sign-census, lean-03]

requires:
  - phase: 195-trim
    provides: "plan 02 deleted the /portfolios page tree that orphaned these components"
provides:
  - "14 /portfolios-only components and their 7 tests deleted from src/components/portfolio"
  - "display-sign census, signed-zero, census-misses and SyncBadge-mounts pins moved with them, floors unchanged"
affects: [195-07 guard test]

plan_head_before: 1fa05d85ee64c5a0488819a7997df1d5e003eb87
plan_head_after: c1f0d811e6237cac5b27033cb4d43fd295e7e343

actuals:
  tokens: 14000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Orphan deletion order: prove importers by grep, edit the surviving tests that import the orphan, git rm, then tsc"

key-files:
  created: []
  modified:
    - src/__tests__/display-sign-single-source.test.ts
    - src/__tests__/display-sign-census-misses.test.tsx
    - src/components/portfolio/portfolio.signed-zero.test.tsx
    - src/lib/queries.trade-venues.test.ts
  deleted:
    - "src/components/portfolio/{AlertsList,AllocationEventForm,AllocationTimeline,AttributionBar,BenchmarkComparison,CompositionDonut,CreatePortfolioForm,DocumentList,DocumentUpload,MorningBriefing,PortfolioEquityCurve,PortfolioKpiPanel,RemoveStrategyButton,RiskAttribution}.tsx"
    - "src/components/portfolio/{AllocationTimeline,BenchmarkComparison,CompositionDonut,CreatePortfolioForm,MorningBriefing,PortfolioKpiPanel,RiskAttribution}.test.tsx"

key-decisions:
  - "All 14 candidates were confirmed /portfolios-only at HEAD; none had a live non-test importer, so none was kept (A6)."
  - "phase-150-capital-ownership-invariant.test.ts left unchanged: RemoveStrategyButton appears only in a dated mutation-lineage docblock, in no writer, deleter or consumer list."

requirements-completed: [LEAN-03]

coverage:
  - id: D1
    description: "No component that only rendered a /portfolios page remains in src/components/portfolio; the seven components /allocations imports survive"
    requirement: LEAN-03
    verification:
      - kind: other
        ref: "git ls-files src/components/portfolio | grep -c <7 orphans> = 0; <7 shared> = 7; npx tsc --noEmit = 0"
        status: pass
      - kind: unit
        ref: "npx vitest run src/components/portfolio ... src/app/(dashboard)/allocations: 170 files, 2933 tests pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every census that listed a deleted component has its row removed in the same change; POPULATION_FLOOR unchanged and still cleared (population 177 against 150)"
    requirement: LEAN-03
    verification:
      - kind: unit
        ref: "src/__tests__/display-sign-single-source.test.ts (26 pass; neuter -> RED -> restore recorded below)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 06: Leftover and duplicate surfaces are gone, orphaned /portfolios components Summary

**The 14 components that only existed to render the retired `/portfolios` pages are deleted with their 7 tests, and the four test censuses that named them moved in the same change with every floor unchanged.**

## Performance

- **Duration:** about 14 min
- **Started:** 2026-11-07T12:19Z
- **Completed:** 2026-11-07T12:34Z
- **Tasks:** 2
- **Files changed:** 25 (21 deleted, 4 test files edited; 1 insertion, 2542 deletions over 2 commits)

## Accomplishments

- Importer proof at HEAD for every one of the 14 names, then `git rm` of the components and the 7 tests that belonged to them.
- `display-sign-single-source.test.ts`: 3 `CENSUS_FILES` entries (`BenchmarkComparison`, `AttributionBar`, `PortfolioEquityCurve`) and 7 exemption-map keys (`AlertsList`, `AllocationEventForm`, `CompositionDonut`, `CreatePortfolioForm`, `DocumentUpload`, `RemoveStrategyButton`, `RiskAttribution`) removed. `POPULATION_FLOOR` stays 150; population measured 191 before, 177 after.
- `portfolio.signed-zero.test.tsx` loses only the AttributionBar and PortfolioEquityCurve cases and imports; `display-sign-census-misses.test.tsx` loses only the RiskAttribution tooltip case and import (ReplacementCard cases kept).
- `queries.trade-venues.test.ts`: the SyncBadge MOUNTS pin drops `CompositionDonut`; title now says "two", comment dated.
- Data layer untouched: `git diff HEAD -- src/lib/queries.ts src/lib/portfolio-analytics-adapter.ts` is empty.

## Task Commits

1. **Task 1 (tracer): orphan set proven by import graph, deleted, display-sign census moved** - `a9261bf0c` (feat)
2. **Task 2: remaining census (SyncBadge mounts pin) moved** - `c1f0d811e` (test)

**Plan metadata:** the SUMMARY commit (docs) follows this file.

## Importer proof (HEAD, before deletion)

Command per name N, over `src e2e scripts`, excluding test paths: `grep -a -rln -E "portfolio/N\b|from \"\./N\"|from '\./N'"`.

| Name | Non-test importers |
|------|--------------------|
| AlertsList, AllocationEventForm, AttributionBar, BenchmarkComparison, CompositionDonut, CreatePortfolioForm, DocumentList, DocumentUpload, MorningBriefing, PortfolioEquityCurve, PortfolioKpiPanel, RemoveStrategyButton, RiskAttribution | none |
| AllocationTimeline | `src/lib/queries.ts`, four docblock lines only (`components/portfolio/AllocationTimeline.tsx:14` inside comments at lines 2502, 2556, 2869, 2902); no import |

Test-side importers (`(import|from)[^;]*components/portfolio/(<names>)|from "./(<names>)"`): the 7 orphan tests themselves, `portfolio.signed-zero.test.tsx`, `display-sign-census-misses.test.tsx`. Both surviving files were edited in Task 1. Repo-wide `git grep` outside `src`, `.planning`, `docs`, `CHANGELOG.md` found only a prose line in `TODOS.md` (a ledger entry about MorningBriefing's `dek` variant), left as is.

After deletion: `grep -a -rn -E 'from "@/components/portfolio/(<14 names>)"' src` prints nothing.

Word-only survivors, untouched (surgical): comments in `AllocationsTabs.tsx`, `AllocateDialog.tsx`, `ExposureByClass.tsx`, `KpiPanel.tsx` and its test, `MarkOwnershipDialog.tsx`, `StrategyTable.tsx`, `scenario.ts`, `scenario.test.ts`, `types.ts`, `queries.ts`, `src/test-setup.ts`, the allocation API route, the phase-150 docblock, and one fixture comment in `display-sign-single-source.test.ts` ("which is why RiskAttribution is a pinned entry") that now names a historical entry.

## Grep gates (HEAD baseline -> after)

| Gate | Before | After |
|------|--------|-------|
| 7 non-test orphans named in the plan (AlertsList ... RemoveStrategyButton) in `git ls-files` | 7 | 0 |
| 7 shared components (PortfolioOptimizer, ReplacementPanel, ReplacementCard, BridgeTrigger, CorrelationHeatmap, InsightStrip, PortfolioImpactPanel) | 7 | 7 |
| `PortfolioEquityCurve\|RemoveStrategyButton\|AlertsList` in display-sign-single-source | 3+ | 0 |
| `from "./(AttributionBar\|PortfolioEquityCurve)"` in signed-zero test | 2 | 0 |
| `RiskAttribution"` in census-misses test | 1 | 0 |
| display-sign population (non-test ts/tsx in SCAN_DIRS + SCAN_FILES) | 191 | 177 (floor 150) |

## Neuter -> RED -> restore proofs

| Guard | Neuter | RED observed | Restore |
|-------|--------|--------------|---------|
| display-sign `CENSUS_FILES` must-exist check | re-added `src/components/portfolio/RiskAttribution.tsx` to `CENSUS_FILES` | 1 failed: `census files missing from the scan: src/components/portfolio/RiskAttribution.tsx` | `cp -p` from byte backup, `cmp` equal, 26/26 green |
| display-sign R1 over the `src/components/portfolio` scan dir | temp file `ZNeuter.tsx` with a raw-sign plus ternary | 1 failed: `R1: no raw-sign '+' prefix` naming `ZNeuter.tsx:1`; file removed, 26/26 green | `rm`, `git status` clean of it |
| SyncBadge mounts pin in `queries.trade-venues.test.ts` | appended `// tradeVenues` to `StrategyHeader.tsx` | 1 failed: `StrategyHeader.tsx mounts SyncBadge and passes neither tradeVenues nor listedExchanges` | `cp -p`, `cmp` equal, 13/13 green |

## Gate results

- `npx tsc --noEmit`: exit 0 (run after Task 1's deletions, again at the end).
- `npm run lint`: 0 errors, 2 pre-existing warnings (unused vars in `MetricsColumn.tsx` and `composite-read-path.ts`); route contract OK (52 page routes), planning hygiene OK.
- Task 1 vitest (display-sign-single-source, signed-zero, census-misses): 3 files, 60 passed.
- Task 2 vitest (`src/components/portfolio`, census-misses, phase-150, trade-venues, `src/app/(dashboard)/allocations`): 170 files, 2933 passed.
- Wider sweep `src/__tests__ src/lib src/components src/app`: 1109 files passed, 22771 tests passed, 2 failed, both the known pre-existing `compute.conventions.test.ts` fixtures B and C (last-digit float).
- `next build` not run (not a local gate).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `queries.trade-venues.test.ts` edited before the Task 1 commit, committed in Task 2**
- **Found during:** Task 1 (deleting `CompositionDonut.tsx` makes this file's runtime `readFileSync` of it fail)
- **Issue:** the plan assigns this file to Task 2, but Task 1's deletion breaks it until it is edited.
- **Fix:** edited it in the working tree alongside Task 1 (so the working tree was never red when tested) and kept it as its own Task 2 commit, per the plan's commit split. The Task 1 commit alone, checked out in isolation, would fail that one test.
- **Files modified:** `src/lib/queries.trade-venues.test.ts`
- **Committed in:** `c1f0d811e`

**Total deviations:** 1 (blocking, ordering only). **Impact:** none on the end state.

### Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. Only deletions and test-census edits; no new surface.

## Issues Encountered

- None. T-195-11 mitigation held: importer check per name, tsc green, allocations vitest tree green (170 files), the seven shared components asserted present.

## Open items for the phase report

- API routes that served only the deleted pages (for example `src/app/api/portfolio-documents/route.ts`) were NOT deleted, per the plan's flagged assumption; no decision names them.
- `TODOS.md` carries a prose line about MorningBriefing's `dek` variant whose component is now deleted; left for the ledger owner.
- `phase-150-capital-ownership-invariant.test.ts` was not changed: its two `RemoveStrategyButton` mentions are mutation-lineage prose.

## Expected CI changes

- e2e: none expected (no spec names a deleted component; plan-time and HEAD greps over `e2e` found none).
- Screenshot goldens: none expected to change.

## Next Phase Readiness

- Plan 07's guard test can rely on `src/components/portfolio` holding only the seven shared components plus `portfolio.signed-zero.test.tsx` and their tests.

## Self-Check: PASSED

- Commits `a9261bf0c` and `c1f0d811e` are ancestors of HEAD; the two acceptance-criteria sets re-run green (see grep gates); `git diff --quiet HEAD -- src/lib/queries.ts src/lib/portfolio-analytics-adapter.ts` exits 0.

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*
