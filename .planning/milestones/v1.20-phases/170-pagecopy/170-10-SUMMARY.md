---
phase: 170-pagecopy
plan: 10
subsystem: ui
tags: [strategy-table, sticky, contrast, a11y, nowrap]

requires:
  - phase: 170-05
    provides: NowrapWords, the per-word whitespace-nowrap name rule
provides:
  - isolated StrategyTable sticky header and a filter bar that clears the mobile top bar
  - whole-word strategy names and wrapping nowrap tags in the table
  - AA grey data-state chips at four sites, gated by a token-reading contrast test
affects: [170-14, strategy-table, chip-contrast]

actuals:
  tokens: 6780
  tasks: 2
  commits: 4

plan_head_before: 7f9376471787a99f4c98876f94bc4f17a17e435d
plan_head_after: 85c46849c7c9a2f9778feb5832c788b1db72c605

tech-stack:
  added: []
  patterns:
    - "StrategyTable stacking stays local via isolate on data-strategy-table"
    - "Table names reuse NowrapWords; tags wrap with whitespace-nowrap badges"
    - "Grey data-state chips are text-text-secondary on bg-track, read by tests/a11y/chip-contrast.test.ts"

key-files:
  created:
    - tests/a11y/chip-contrast.test.ts
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyFilters.tsx
    - src/app/(dashboard)/allocations/components/CoverageStateChip.tsx

key-decisions:
  - "isolate on the table wrapper; sticky th z-index classes unchanged"
  - "Filter bar is top-12 md:top-0. The filters drawer header keeps its bare top-0."
  - "Four chip sites change only the text class. globals.css is unchanged."
  - "SC2-NOSCROLL stays open because plans 170-11 and 170-13 also declare it."

patterns-established:
  - "Name queries on StrategyTable use getByRole('link', { name }) after NowrapWords"
  - "Chip contrast reads globals.css tokens and the source class pairs, and self-checks muted-on-track below 4.5"

requirements-completed: ["(k)", "(l)", "CHIP"]

coverage:
  - id: D1
    description: "The data-strategy-table wrapper carries isolate, so the sticky header z-index stays local. The StrategyFilters bar is top-12 md:top-0 and has no bare top-0."
    requirement: "(k)"
    verification:
      - kind: unit
        ref: "src/components/strategy/StrategyTable.test.tsx#isolates the table so its sticky header z-index stays local"
        status: pass
      - kind: unit
        ref: "src/components/strategy/StrategyTable.test.tsx#sticks the filter bar under the 48px mobile top bar, and at the top from md"
        status: pass
    human_judgment: false
  - id: D2
    description: "The name link's textContent equals the strategy name and each word is a whitespace-nowrap span. The tag row is flex flex-wrap gap-1 and each tag badge is whitespace-nowrap."
    requirement: "(l)"
    verification:
      - kind: unit
        ref: "src/components/strategy/StrategyTable.test.tsx#keeps the name link's text equal to the name, each word nowrap"
        status: pass
      - kind: unit
        ref: "src/components/strategy/StrategyTable.test.tsx#wraps the tag row and keeps each tag badge on one line"
        status: pass
    human_judgment: false
  - id: D3
    description: "The four grey data-state chip sites use text-text-secondary on bg-track. The contrast test reads the tokens and the source pairs and fails if a site returns to the muted class."
    requirement: CHIP
    verification:
      - kind: unit
        ref: "tests/a11y/chip-contrast.test.ts#reads two secondary-on-track pairs per chip file, each at least 4.5:1"
        status: pass
      - kind: unit
        ref: "tests/a11y/chip-contrast.test.ts#still distinguishes muted-on-track, which stays below 4.5:1"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx#manually-excluded"
        status: pass
      - kind: unit
        ref: "src/components/strategy/StrategyTable.pending-chip.test.tsx#shows 'No data' for a NEVER-ENQUEUED row PAST the 16h window"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 10: Strategy table header, names, and chip contrast Summary

**The strategy table keeps its sticky header inside its own stacking context, names and tags stay whole, and the four grey chips clear AA**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-27T23:13:12Z
- **Completed:** 2026-09-27T23:26:18Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `data-strategy-table` carries `isolate`. The sticky `th` z-20 and z-30 classes are unchanged, so that stacking context stays inside the table.
- The filter bar is `top-12 md:top-0`, under the 48 px mobile top bar and at the top from `md`.
- Table names render `NowrapWords`. The tag row is `flex flex-wrap gap-1` and each tag badge is `whitespace-nowrap`.
- The four grey chip sites are `text-text-secondary` on `bg-track`. `tests/a11y/chip-contrast.test.ts` reads the tokens and the source pairs.

## Task Commits

Each task was committed atomically:

1. **Task 1: isolate the sticky header, wrap tags, keep names whole, clear the mobile top bar** - `930caa7f4` (test), `fbbd612b1` (feat)
2. **Task 2: grey data-state chips reach AA, with a token-reading contrast gate** - `9891bc690` (test), `85c46849c` (feat)

## Files Created/Modified

- `src/components/strategy/StrategyTable.tsx` - isolate, NowrapWords name, wrapping tags, secondary chip text
- `src/components/strategy/StrategyFilters.tsx` - sticky bar `top-12 md:top-0`
- `src/components/strategy/StrategyTable.test.tsx` - N-TABLE cases and the AD-13 link queries
- `src/components/strategy/StrategyTable.visibility.test.tsx` - name queries moved to the link role
- `src/components/strategy/SyncBadge.staler-of-two.test.tsx` - table row helper moved to the link role
- `src/components/strategy/StrategyTable.pending-chip.test.tsx` - chip text pin is secondary; bg-track stays
- `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` - excluded and no-series text class
- `src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx` - the same two pins
- `tests/a11y/chip-contrast.test.ts` - token and source-pair contrast gate

## Decisions Made

- `isolate` is the stacking fix. The sticky header classes were not retuned.
- Only the filter bar's `top-0` moved. The drawer's `sticky top-0` header is a different element and stays.
- Chip text moves to `text-text-secondary`. `--color-text-muted` and `--color-track` are unchanged. `DATA_STATE_CHIP` is unchanged.
- `(k)`, `(l)` and `CHIP` have no later plan. `SC2-NOSCROLL` stays open because plans 170-11 and 170-13 also declare it. `REQUIREMENTS.md` has no checkbox for any of these ids.

## Migrated name assertions (AD-13, 2026-09-28)

`getByText` / `queryByText` on a strategy name no longer matches once the link's children are spans. Each of these now uses `getByRole("link", { name })` or `queryByRole("link", { name })`:

- `StrategyTable.test.tsx` Case 5: Alpha Stellar, Beta Voyager, Gamma Pioneer (absent on the empty watchlist)
- `StrategyTable.test.tsx` Case 6: Alpha Stellar, Beta Voyager present; Gamma Pioneer absent
- `StrategyTable.test.tsx` Case 8: Alpha Stellar, Beta Voyager, Gamma Pioneer
- `StrategyTable.test.tsx` hide-examples: Example Demo Strategy absent, then present; Alpha Stellar present
- `StrategyTable.test.tsx` sticky identity cell: the Alpha Stellar link
- `StrategyTable.test.tsx` projected KPI row: Alpha Stellar
- `StrategyTable.test.tsx` 3M filter: Alias Only Row and Blob Only Row, both the keep arm and the drop arm
- `StrategyTable.visibility.test.tsx`: Private Nebula, Draft Quasar, Published Pulsar on the owner arm; the two non-published names absent and Published Pulsar present on the default recipe; Published Pulsar on the public own-capital mount and on the unmarked owner mount
- `SyncBadge.staler-of-two.test.tsx` `tableRowFor`: Phoenix Protocol Fixture and Healthy Control Fixture

`StrategyTable.stale-analytics.test.tsx` and `StrategyTable.pending-chip.test.tsx` find rows by `textContent`, not `getByText(name)`, so they were not migrated. The Private and Draft status badges in the pending-chip file are still `getByText` of the badge label.

## RED and neuter

Task 1, at HEAD before the markup change. `npx vitest run src/components/strategy/StrategyTable.test.tsx -t "N-TABLE sticky header and whole words"` — 4 failed, 35 skipped:

- isolate: expected the wrapper class list to include `isolate`
- name: expected `[]` to equal the three nowrap word spans for "Alpha Long-Short Beta" (textContent already equalled the name)
- tags: expected `['flex', 'gap-1']` to contain `flex-wrap`
- filter bar: expected the sticky bar tokens to include `top-12` (they were `sticky top-0 z-10 …`)

Task 1 neuter: `isolate` removed from the wrapper. The isolate case went RED (`expected [ 'relative', 'border', … ] to include 'isolate'`). The class was restored. `grep -c isolate` is 1.

Task 2, at HEAD before the class swap. `tests/a11y/chip-contrast.test.ts`: the pair case failed on `CoverageStateChip.tsx` (`expected [ 'muted', 'muted' ] to deeply equal [ 'secondary', 'secondary' ]`). The muted-on-track self-check passed.

Task 2 neuter: the first StrategyTable `text-text-secondary bg-track` was put back to `text-text-muted bg-track`. The pair case went RED naming `src/components/strategy/StrategyTable.tsx` (`expected [ 'muted', 'secondary' ]`). The site was restored. Both files have 2 `text-text-secondary bg-track` pairs. `git diff origin/main -- src/app/globals.css` is empty.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The sync-badge table helper still looked up names with getByText**

- **Found during:** Task 1, the directory verify
- **Issue:** `SyncBadge.staler-of-two.test.tsx` `tableRowFor` uses `getByText(name)` on "Phoenix Protocol Fixture" and "Healthy Control Fixture". The plan's files list did not name that file. After NowrapWords the helper threw, so `src/components/strategy/` was red.
- **Fix:** The helper now uses `getByRole("link", { name })`, with the same AD-13 comment.
- **Files modified:** `src/components/strategy/SyncBadge.staler-of-two.test.tsx`
- **Verification:** `npx vitest run src/components/strategy/` — 33 files, 640 tests, exit 0, before the chip edit; 35 files, 649 tests, exit 0, after it.
- **Committed in:** `fbbd612b1` (Task 1 feat)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The directory verify could not go green without it. No production behavior beyond the planned name-span change.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- Tracer re-run after Task 1: `npx vitest run src/components/strategy/` — 33 files, 640 tests, exit 0.
- Task 2: `npx vitest run tests/a11y/chip-contrast.test.ts "src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx" src/components/strategy/StrategyTable.pending-chip.test.tsx` — 3 files, 29 tests, exit 0.
- Plan-level: `npx vitest run src/components/strategy/ tests/a11y/chip-contrast.test.ts "src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx"` — 35 files, 649 tests, exit 0.
- `npx tsc --noEmit -p .` — exit 0.
- `npx eslint` on the nine edited files — exit 0.
- Acceptance: `isolate` 1, `top-12 md:top-0` 1, `NowrapWords` 2, `text-text-secondary bg-track` 2 in each chip file, globals.css diff against origin/main empty.

## Not verified in a browser

No dev server and no seeded browser pass. Not confirmed: `elementFromPoint` on the Sort selects after scroll at V390, V640 and V960, or a green 164.9.4 axe `color-contrast` check. CI `e2e-seeded` `layout-narrow` row "/my-strategies — N-TABLE" and the axe color-contrast check were not run locally.

## Next Phase Readiness

Ready for 170-11. The table header can no longer paint over the filter bar, and the four grey chips are gated at the token. `SC2-NOSCROLL` stays open for plans 170-11 and 170-13. The viewport hit-test and the seeded axe proof remain for CI and plan 170-14.

## Self-Check: PASSED

- FOUND `tests/a11y/chip-contrast.test.ts`
- FOUND `src/components/strategy/StrategyTable.tsx` (`isolate`, `NowrapWords`)
- FOUND commits `930caa7f4`, `fbbd612b1`, `9891bc690`, `85c46849c`
---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
