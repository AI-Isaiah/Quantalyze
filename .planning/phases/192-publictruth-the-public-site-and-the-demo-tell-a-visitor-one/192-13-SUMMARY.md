---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 13
subsystem: ui
tags: [demo-retirement, dead-code, display-sign-census, vitest]

requires:
  - phase: 192-publictruth
    provides: "Plan 192-11 deleted the /demo page, leaving its portfolio components and readers without a production importer"
provides:
  - "Five demo-only portfolio components and two demo-only readers deleted with their tests (14 files)"
  - "Display-sign census, signed-zero file, census-misses file and node-env list moved in the same commits"
affects: [192-10 coverage run, Phase 195 TRIM]

actuals:
  tokens: 120000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Importer check before each deletion; anti-vacuity census shown RED on a re-added missing row, restored from a byte backup"

key-files:
  created: []
  modified:
    - src/__tests__/display-sign-single-source.test.ts
    - src/__tests__/display-sign-census-misses.test.tsx
    - src/components/portfolio/portfolio.signed-zero.test.tsx
    - vitest.node-env.ts
  deleted:
    - src/components/portfolio/EditorialHero.tsx
    - src/components/portfolio/EditorialHero.test.tsx
    - src/components/portfolio/WinnersLosersStrip.tsx
    - src/components/portfolio/WinnersLosersStrip.test.tsx
    - src/lib/winners-losers.ts
    - src/lib/winners-losers.test.ts
    - src/components/portfolio/WhatWedDoCard.tsx
    - src/components/portfolio/WhatWedDoCard.test.tsx
    - src/components/portfolio/CounterfactualStrip.tsx
    - src/components/portfolio/CounterfactualStrip.test.tsx
    - src/components/portfolio/NextFiveMillionCard.tsx
    - src/components/portfolio/NextFiveMillionCard.test.tsx
    - src/lib/demo-recommendations.ts
    - src/lib/demo-recommendations.test.ts

key-decisions:
  - "Followed D-11: the retirement removes the demo's components and data readers; every deletion was importer-checked first"
  - "Shared components (InsightStrip, MorningBriefing, the rest of src/components/portfolio) untouched"

requirements-completed: [ROUTE-03]

plan_head_before: d66c5117edf2ed11109ffc28970ba56b6ba5fd16
plan_head_after: ea3472b411267a88b617591e3f5cd82be79956d1

coverage:
  - id: D1
    description: "EditorialHero, WinnersLosersStrip, WhatWedDoCard, CounterfactualStrip, NextFiveMillionCard, winners-losers.ts and demo-recommendations.ts are gone, each after an importer check with no hit outside the deleted set"
    requirement: ROUTE-03
    verification:
      - kind: other
        ref: "git grep -q -a -E 'EditorialHero|WinnersLosersStrip|winners-losers|WhatWedDoCard|CounterfactualStrip|NextFiveMillionCard|demo-recommendations' (src e2e scripts vitest.node-env.ts) exits 1"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit exits 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The display-sign single-source census moved with the deletions and still bites on a missing listed file"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "src/__tests__/display-sign-single-source.test.ts#scans a real population, and every census file is in it (RED with a re-added EditorialHero row, GREEN after byte restore)"
        status: pass
    human_judgment: false
  - id: D3
    description: "src/components/portfolio and both sign censuses pass after the deletions"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "npx vitest run src/components/portfolio src/__tests__/display-sign-single-source.test.ts src/__tests__/display-sign-census-misses.test.tsx (20 files, 308 tests)"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 13: Demo-only portfolio components and readers Summary

**Deleted the five portfolio components and two readers that only the retired /demo page used (14 files, 1913 lines), moved every display-sign census, signed-zero describe and the node-env list in the same commits, and showed the single-source census still fails on a missing listed file.**

## Performance

- **Duration:** about 4 min
- **Started:** 2026-11-07T01:59:56Z
- **Completed:** 2026-11-07T02:03:22Z (before SUMMARY write)
- **Tasks:** 3
- **Files modified:** 4 edited, 14 deleted

## Accomplishments

- EditorialHero, WinnersLosersStrip (with `src/lib/winners-losers.ts`), WhatWedDoCard, CounterfactualStrip, NextFiveMillionCard and `src/lib/demo-recommendations.ts` removed with their tests.
- Display-sign census: the `EditorialHero.tsx`, `WhatWedDoCard.tsx` and `WinnersLosersStrip.tsx` rows removed from `CENSUS_FILES`, and the path-keyed `EditorialHero.tsx` R8 allowlist entry removed.
- Signed-zero file: the EditorialHero, WinnersLosersStrip and WhatWedDoCard describes, imports, the `attrRow` helper, the demo section banner and the now-unused `OptimizerSuggestionRow` and `AttributionRow` type imports removed. Every other describe is byte-identical.
- Census-misses file: the WhatWedDoCard describe, import, the `suggestion` builder and the `OptimizerSuggestionRow` type import removed.
- `vitest.node-env.ts`: the `src/lib/winners-losers.test.ts` entry removed.

## Importer checks (recorded per the plan)

Task 1: `git grep -n -E "portfolio/EditorialHero|from \"\./EditorialHero\"" -- src e2e scripts` hit only:
- `src/__tests__/display-sign-single-source.test.ts:154` (CENSUS_FILES row) and `:1027` (allowlist entry)
- `src/components/portfolio/EditorialHero.test.tsx:3` (its own test)
- `src/components/portfolio/portfolio.signed-zero.test.tsx:24`

Task 2: `git grep -n -a -E "WinnersLosersStrip|winners-losers|WhatWedDoCard" -- src e2e scripts vitest.node-env.ts`, excluding the six files being deleted, hit only `display-sign-census-misses.test.tsx` (import `:11`, describe `:219` and its uses), `display-sign-single-source.test.ts:152-153`, `portfolio.signed-zero.test.tsx` and `vitest.node-env.ts:311`. A wider check for `computeWinnersLosers` across the repo, excluding `.planning`, `CHANGELOG.md` and the deleted files, found only old design docs under `docs/superpowers/plans/` (prose), which are history and left alone.

Task 3: `git grep -n -a -E "CounterfactualStrip|NextFiveMillionCard|demo-recommendations|resolveDemoRecommendations|fetchCandidatesForBatch" -- src e2e scripts`: every hit was in the six files of the task. No other production importer, no census.

## RED proof (T-192-30)

With EditorialHero deleted and its row removed, the census was GREEN (26 tests). The row was then re-added to `CENSUS_FILES` in the working copy and the file re-run. It went RED:

```
× scans a real population, and every census file is in it (an empty scan would pass vacuously)
AssertionError: census files missing from the scan:
src/components/portfolio/EditorialHero.tsx: expected [ Array(1) ] to deeply equal []
```

The byte backup was copied back (`cmp` silent) and the census was GREEN again (26 tests).

## Task Commits

1. **Task 1: EditorialHero and its census rows** - `439e2a4f6` (refactor)
2. **Task 2: WinnersLosersStrip, its reader, WhatWedDoCard** - `d54cbe50f` (refactor)
3. **Task 3: CounterfactualStrip, NextFiveMillionCard, demo-recommendations** - `ea3472b41` (refactor)

## Gates (real numbers, run in the worktree)

- `npx vitest run src/__tests__/display-sign-single-source.test.ts src/components/portfolio/portfolio.signed-zero.test.tsx`: 2 files, 54 tests passed (after Task 1).
- `npx vitest run` on the three census or signed-zero files: 3 files, 70 tests passed (after Task 2).
- `npx vitest run src/components/portfolio src/__tests__/display-sign-single-source.test.ts src/__tests__/display-sign-census-misses.test.tsx`: 20 files, 308 tests passed (after Task 3).
- `npx tsc --noEmit`: exit 0 after each task.
- `npx eslint` on the two edited test files and on `src/components/portfolio`: exit 0, no warnings.
- `npm run lint`: 0 errors, 2 warnings, both in `src/app/factsheet/[id]/v2/MetricsColumn.tsx` and `src/lib/factsheet/composite-read-path.ts` (unused imports in files this plan did not touch, in the Phase 193 fence). All check-* sub-scripts OK.
- Acceptance greps: `git grep -q ...` for the demo names exits 1 (no match); `grep -c winners-losers vitest.node-env.ts` prints 0; `ls src/components/portfolio | grep -c -E '^(EditorialHero|...)\.'` prints 0.
- `npx vitest run src/lib` plus the census (294 files): 293 passed, 1 failed. The failure is `src/lib/factsheet/compute.conventions.test.ts` (2 FROZEN snapshot mismatches, fixtures B and C). That file is in `src/lib/factsheet`, which this plan does not touch (`git diff --stat d66c5117e..HEAD -- src/lib/factsheet` is empty), and it imports none of the deleted modules. I did not establish whether it is red on the base commit; I could not check the base without touching another checkout. It is reported here and not fixed, per the scope boundary and the Phase 193 fence.
- Not run: the full `npm run test:coverage` (plan 192-10 owns it); Playwright and any seeded-env gate.

## Left in place and unsure (carried from the plan)

- `MorningBriefing`'s `dek` variant and `src/lib/warmup-analytics.ts` (see the plan's decision notes). Not touched.
- Comment-only /demo mentions in shared files. Not touched.

## Decisions Made

None beyond the plan. One small deviation noted below.

## Deviations from Plan

**1. [Rule 1 - stale comment] Census-misses section banner reworded**
- **Found during:** Task 2
- **Issue:** The banner read "Portfolio: the optimizer score and the Bridge composite score", but the optimizer-score describe was deleted, so it would have described code that no longer exists.
- **Fix:** Reworded to "Portfolio: the Bridge composite score". Comment only.
- **Files modified:** `src/__tests__/display-sign-census-misses.test.tsx`
- **Committed in:** `d54cbe50f`

**Total deviations:** 1 (comment-only). **Impact:** none on behaviour.

## Issues Encountered

A first attempt to reword the signed-zero type import with BSD `sed` failed on the `#` delimiter; it was redone with a script and verified by eslint (exit 0). The one pre-existing-looking failure in `compute.conventions.test.ts` is described under Gates.

## Threat Flags

None. This plan only deletes code and edits tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 192-10 owns the full-suite coverage run; thresholds in `vitest.config.ts` were not edited.

## Self-Check: PASSED

- All 14 deleted files are absent; the 4 edited files exist.
- Commits `439e2a4f6`, `d54cbe50f` and `ea3472b41` are ancestors of HEAD.
- `git rev-list --count` from the plan base to HEAD was 3, matching `commits: 3`.

---
*Phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one*
*Completed: 2026-11-07*
