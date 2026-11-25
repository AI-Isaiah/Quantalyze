---
phase: 239-surfacecache-the-composer-range-and-the-discovery-ranking-re
plan: 01
subsystem: ui
tags: [react, factsheet, range, vitest]
requires: []
provides:
  - "range-dates.ts: StoredRange (manual member), resolveStoredRange, lowerBound, upperBound, basisAxisDates"
  - "FactsheetProvider holds the user's range as ISO dates; useXRange resolves them on the active basis axis each render"
  - "ActiveBasisContext exported from factsheet-context.tsx; BasisProvider publishes the basis through it"
affects: [239-02]
actuals:
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "Range held as dates, resolved per render on the active axis (binary search over ISO days)"
key-files:
  created:
    - src/app/factsheet/[id]/v2/range-dates.ts
    - src/app/factsheet/[id]/v2/range-dates.test.ts
    - src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/factsheet-context.tsx
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx
key-decisions:
  - "useXRange computes its hooks after the existing throw; react-hooks lint accepted it, so no nullable-store restructure was needed"
  - "setXRange's useCallback deps keep the three payload terms verbatim and add axis and setStored (lint and the React Compiler accepted them)"
requirements-completed: [CACHE-02]
coverage:
  - id: D1
    description: "A manual range keeps its exact dates when the series grows at the front or the back (cash axis)"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#a range the user set keeps its DATES when the series grows at the FRONT"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#a range the user set keeps its DATES when the series grows at the back, and reset returns to the CURRENT full range"
        status: pass
    human_judgment: false
  - id: D2
    description: "The range resolves on the active basis axis; an MTM manual range keeps its MTM dates on front growth"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx#an MTM manual range keeps its MTM dates when the MTM axis grows at the front"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx#basisAxisDates equals the basis view's dates"
        status: pass
    human_judgment: false
  - id: D3
    description: "Resolver contract: strict off-axis rule, gappy lookups, round trip, no widening, null/empty fallbacks"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/range-dates.test.ts"
        status: pass
    human_judgment: false
duration: 35min
completed: 2026-11-24
status: complete
---

# Phase 239 Plan 01: the factsheet range is held as dates Summary

**A range the user sets by pan, zoom, brush or keyboard now keeps its exact start and end dates when the series grows at either end: `FactsheetProvider` stores two ISO days and `useXRange` resolves them by binary search on the active basis axis every render.**

## Performance

- **Duration:** about 35 min
- **Tasks:** 2
- **Files:** 3 created, 3 modified

## Accomplishments

- `range-dates.ts` (pure): `StoredRange` (manual member only; plan 02 adds the preset member), `lowerBound`, `upperBound`, `resolveStoredRange` with the strict off-axis rule, and `basisAxisDates`, which mirrors Layer 1 of `useBasisSeriesView`.
- `factsheet-context.tsx`: `userRange` holds `StoredRange | null`. The provider passes a raw store (stored range, setter, eager `resetXRange`, payload, cash-sized `fullRange`) through `XRangeContext`. `useXRange` reads it and the new `ActiveBasisContext` (null means cash), memoises the axis and the resolved range, and builds `setXRange` over the axis. The three-term clamp and `MIN_VISIBLE_SAMPLES` widening moved into it verbatim, comments included. The provider-level `maxIdx` and `xRange` derivation is gone. The persistence block, the codec and every other context are untouched.
- `basis-context.tsx`: `BasisProvider` wraps its children in `ActiveBasisContext.Provider value={basis}`. It reads no payload, adds no effect and still renders no DOM element.
- Provider test: `payloadSpanning(n, startISO)` (with `payloadOfLength` delegating to it), `DatesProbe`, the back-growth test re-pinned to assert dates as well as indices, and the new front-growth arm. The shrunk-axis and unset-range test bodies are byte-unchanged (the uncommitted diff removed no line inside them).

## Task Commits

1. **Task 1: dates store, active-basis bridge, resolver, provider arms**: `0bbcf9d53` (feat)
2. **Task 2: resolver and bridge pins, nine neuters, consumer sweep**: `d00c1c544` (test)

## PROOF-01 evidence (verbatim; paths rewritten to repo-relative or `$SCRATCH/...`)

Each neuter used `$SCRATCH/neuter.sh`. It copies the source file to `$SCRATCH/bak/<name>.orig`, applies the neuter, runs RED, copies the backup back, runs `cmp` (exit printed), then runs GREEN. A `git diff --quiet HEAD` check afterwards confirmed every production file matched HEAD. No git checkout, restore or stash was used.

### Front-growth arm on pre-fix code (Task 1 RED, before any production change)

```
     × a range the user set keeps its DATES when the series grows at the FRONT 98ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a range the user set keeps its DATES when the series grows at the FRONT
AssertionError: expected '2023-12-12..2024-01-11' to be '2024-01-11..2024-02-10' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed | 15 skipped (19)
```

### Front-growth arm after the fix (Task 1 GREEN)

```
 ✓ |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > an unset range follows the axis when the payload grows from 3 to 120 dates 195ms
 ✓ |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a range the user set keeps its DATES when the series grows at the back, and reset returns to the CURRENT full range 141ms
 ✓ |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a range the user set keeps its DATES when the series grows at the FRONT 129ms
 ✓ |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a range the user set that points past the end of a SHRUNK axis falls back to the current full range 105ms
 Test Files  1 passed (1)
      Tests  4 passed | 15 skipped (19)
```

### Neuter: strict

```
### NEUTER strict (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × end one day after the last axis day gives fullRange 8ms
     × start one day before the first axis day gives fullRange 1ms
     × a range the user set that points past the end of a SHRUNK axis falls back to the current full range 153ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a range the user set that points past the end of a SHRUNK axis falls back to the current full range
AssertionError: expected '10-19' to be '0-19' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — strict off-axis rule > end one day after the last axis day gives fullRange
AssertionError: expected [ 4, 19 ] to be [ +0, 19 ] // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — strict off-axis rule > start one day before the first axis day gives fullRange
AssertionError: expected [ +0, 9 ] to be [ +0, 19 ] // Object.is equality
 Test Files  2 failed (2)
      Tests  3 failed | 1 passed | 24 skipped (28)
cmp exit: 0
--- GREEN
 Test Files  2 passed (2)
      Tests  4 passed | 24 skipped (28)
```

### Neuter: roundtrip

```
### NEUTER roundtrip (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × dates between axis points 11ms
     × gappy round trip keeps the indices 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — lookups on a gappy axis > dates between axis points
AssertionError: expected [ 5, 10 ] to deeply equal [ 5, 9 ]
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — lookups on a gappy axis > gappy round trip keeps the indices
AssertionError: expected [ +0, 5 ] to deeply equal [ +0, 4 ]
 Test Files  1 failed (1)
      Tests  2 failed | 7 skipped (9)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  2 passed | 7 skipped (9)
```

### Neuter: bridge

```
### NEUTER bridge (src/app/factsheet/[id]/v2/basis-context.tsx)
--- RED
     × an MTM manual range keeps its MTM dates when the MTM axis grows at the front 76ms
     × widened clamp: an MTM index past the cash length is REACHABLE (neuter clamp → RED) 1066ms
     × SMTM-01 widened clamp: a SMOOTHED index past the cash length is REACHABLE (neuter the third max() term → RED) 1039ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/MasterBrush.basis.test.tsx > [F2] MasterBrush follows the active basis > widened clamp: an MTM index past the cash length is REACHABLE (neuter clamp → RED)
AssertionError: expected 'Apr 10, 2031' to be 'May 30, 2031' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/MasterBrush.basis.test.tsx > [F2] MasterBrush follows the active basis > SMTM-01 widened clamp: a SMOOTHED index past the cash length is REACHABLE (neuter the third max() term → RED)
AssertionError: expected 'Apr 9, 2032' to be 'May 29, 2032' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx > an MTM manual range keeps its MTM dates when the MTM axis grows at the front > an MTM manual range keeps its MTM dates when the MTM axis grows at the front
AssertionError: expected '2030-12-12..2031-01-11' to be '2031-01-11..2031-02-10' // Object.is equality
 Test Files  2 failed (2)
      Tests  3 failed | 7 passed (10)
cmp exit: 0
--- GREEN
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

### Neuter: drift

```
### NEUTER drift (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × basisAxisDates equals the basis view's dates (smoothed with bundle) 1036ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx > basisAxisDates equals the basis view's dates > basisAxisDates equals the basis view's dates (smoothed with bundle)
AssertionError: expected 'smoothed_mtm:differ:2032-01-01' to be 'smoothed_mtm:same:2032-01-01' // Object.is equality
 Test Files  1 failed | 1 skipped (2)
      Tests  1 failed | 3 passed | 10 skipped (14)
cmp exit: 0
--- GREEN
 Test Files  1 passed | 1 skipped (2)
      Tests  4 passed | 10 skipped (14)
```

### Neuter: fallback

```
### NEUTER fallback (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × basisAxisDates picks the active basis axis 11ms
     × basisAxisDates equals the basis view's dates (cash) 1078ms
     × basisAxisDates equals the basis view's dates (MTM without bundle) 1037ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx > basisAxisDates equals the basis view's dates > basisAxisDates equals the basis view's dates (cash)
AssertionError: expected 'cash_settlement:differ:2020-01-01' to be 'cash_settlement:same:2020-01-01' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/basis-context.active-axis.test.tsx > basisAxisDates equals the basis view's dates > basisAxisDates equals the basis view's dates (MTM without bundle)
AssertionError: expected 'mark_to_market:differ:2020-01-01' to be 'mark_to_market:same:2020-01-01' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > basisAxisDates > basisAxisDates picks the active basis axis
AssertionError: expected [ '2031-01-01', '2031-01-02', …(13) ] to be [ '2020-01-01', '2020-01-02', …(8) ] // Object.is equality
 Test Files  2 failed (2)
      Tests  3 failed | 2 passed | 9 skipped (14)
cmp exit: 0
--- GREEN
 Test Files  2 passed (2)
      Tests  5 passed | 9 skipped (14)
```

### Neuter: startlookup

```
### NEUTER startlookup (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × dates between axis points 11ms
     × gappy round trip keeps the indices 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — lookups on a gappy axis > dates between axis points
AssertionError: expected [ 4, 9 ] to deeply equal [ 5, 9 ]
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — lookups on a gappy axis > gappy round trip keeps the indices
AssertionError: expected [ -1, 4 ] to deeply equal [ +0, 4 ]
 Test Files  1 failed (1)
      Tests  2 failed | 7 skipped (9)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  2 passed | 7 skipped (9)
```

### Neuter: widening

```
### NEUTER widening (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × no widening at resolve 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — lookups on a gappy axis > no widening at resolve
AssertionError: expected [ 5, 9 ] to deeply equal [ 5, 7 ]
 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

### Neuter: reffallback

```
### NEUTER reffallback (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × null stored or an empty axis gives fullRange 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — nothing to resolve > null stored or an empty axis gives fullRange
AssertionError: expected [ +0, +0 ] to be [ +0, 9 ] // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

### Neuter: inverted

```
### NEUTER inverted (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × an inverted range gives fullRange 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — lookups on a gappy axis > an inverted range gives fullRange
AssertionError: expected [ 5, 4 ] to be [ +0, 29 ] // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

Notes on the neuters:
- **strict** removed the manual branch's off-axis guard. **roundtrip** dropped the `- 1` from the end index. **bridge** removed the `ActiveBasisContext.Provider` wrapper in `basis-context.tsx`. **drift** made the smoothed arm of `basisAxisDates` return `payload.dates`. **fallback** returned the MTM bundle dates whenever that bundle exists and `[]` when the selected bundle is absent. **startlookup** subtracted one from the start index. **widening** widened any resolved range narrower than five points. **reffallback** returned a new `[0, 0]` for null or empty input. **inverted** dropped the start-after-end check.
- The bridge neuter turned two `MasterBrush.basis.test.tsx` widened-clamp arms RED as well ("widened clamp: an MTM index past the cash length is REACHABLE" and "SMTM-01 widened clamp: a SMOOTHED index past the cash length is REACHABLE"). Without the bridge, the stored dates are looked up on the cash axis, so an MTM index past the cash length cannot be stored. With the bridge they are GREEN, with no change to that test file.

## Verification

- Task 1 verify (`factsheet-context.provider`, `MasterBrush.basis`, every `basis-context*` file): 14 files, 121 tests passed.
- New files plus the provider: 3 files, 33 tests passed.
- Consumer sweep (every test file naming `xRange|setXRange|useXRange`, every `basis-context*` file, the composer `widgets/performance` directory): 54 files, 925 tests passed. No fixture edit was needed.
- Guards (`trim-removed-surfaces`, `phase-52-frozen-spine-guards`, `seam-log-coverage`, `critical-regressions`, every `src/lib/*invariant*` test, the `.planning`-reading tests): 31 files, 1144 passed, 1 failed in the combined run: `accounttruth-census.test.ts` "(e) the untrustworthy reason…", which runs SQL on a throwaway local PostgreSQL cluster. Run alone straight after, it passed (54/54). It shares no code with this plan; it is a load-sensitive flake.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 4 pre-existing warnings in files this plan does not touch, and every lint-chain check OK.

## Deviations from Plan

None. The plan was executed as written.

**Total deviations:** 0.

## Issues Encountered

- `accounttruth-census.test.ts` failed once under the parallel guard run and passed alone (see Verification). Not caused by this plan.

## Next Phase Readiness

Ready for 239-02: it adds the preset member of `StoredRange`, `subtractMonths` and `setPresetRange`.
