---
phase: 239-surfacecache-the-composer-range-and-the-discovery-ranking-re
plan: 03
subsystem: testing
tags: [discovery, ranking, percentiles, vitest]
requires: []
provides:
  - "queries.native-unit-ranking.test.ts: shape arm and cohort arm of the CACHE-04 pin"
  - "StrategyTable.native-unit-ranking.test.tsx: order, #n and chip arms of the CACHE-04 pin"
affects: [238]
actuals:
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - src/lib/queries.native-unit-ranking.test.ts
    - src/components/strategy/StrategyTable.native-unit-ranking.test.tsx
  modified: []
key-decisions:
  - "No production code changed: the founder ruled today's behaviour correct, so the plan only pins it"
  - "The copied table fixture sets computed_at to yesterday so a Phase 238 change to the computed_at sort key or partition cannot reorder the rows"
requirements-completed: [CACHE-04]
coverage:
  - id: D1
    description: "A native-unit row's figures leave list shaping unconverted, and it is scored in the same percentile population as USD rows"
    requirement: CACHE-04
    verification:
      - kind: unit
        ref: "src/lib/queries.native-unit-ranking.test.ts#a native-unit row's figures reach the list unconverted"
        status: pass
      - kind: unit
        ref: "src/lib/queries.native-unit-ranking.test.ts#a BTC row is scored in the same population as the USD rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "Discovery orders a BTC-unit row among USD rows by raw CAGR, numbers it #n, and keeps its in BTC chip"
    requirement: CACHE-04
    verification:
      - kind: unit
        ref: "src/components/strategy/StrategyTable.native-unit-ranking.test.tsx"
        status: pass
    human_judgment: false
duration: 20min
completed: 2026-11-24
status: complete
---

# Phase 239 Plan 03: CACHE-04 ranked together as pure performance Summary

**The founder's 2026-11-24 ruling (BTC-unit and USD strategies ranked together as pure performance, with no BTC price conversion, and the in BTC chip kept) is now pinned as behaviour by five arms in two new test files, each shown able to fail. No production code changed.**

## Performance

- **Duration:** about 20 min
- **Tasks:** 2
- **Files:** 2 created, 0 modified

## Accomplishments

- `src/lib/queries.native-unit-ranking.test.ts`: the shape arm (`shapeRowAnalytics` keeps a BTC row's cagr 0.9 and cumulative_return 3.2 and its `native_unit` "BTC"; a USD row keeps its figures and gets a null unit) and the cohort arm (`getPercentiles` over five USD rows and one BTC row returns all six ids, and the BTC row scores 100 on both cagr and cumulative_return).
- `src/components/strategy/StrategyTable.native-unit-ranking.test.tsx`: "one BTC row and one USD row rank together by raw CAGR" (descending puts BTC first as #1, ascending puts USD first), "a BTC row between two USD rows is #2", and "the BTC row keeps its in BTC chip" (exactly one `data-returns-unit="BTC"` element in the BTC name cell, none in the USD one).
- `src/lib/queries.ts` and `src/components/strategy/StrategyTable.tsx` are untouched. After every neuter, `git status --porcelain` and `git diff --quiet HEAD` on both files reported no change.

## Task Commits

1. **Task 1: shape and cohort arms**: `91f3ed1b5` (test)
2. **Task 2: table order, #n and chip arms**: `d3f57a3d7` (test)

## PROOF-01 evidence (verbatim; paths rewritten to repo-relative or `$SCRATCH/...`)

The behaviour exists today, so RED comes only from a neutered byte copy. Each neuter used `$SCRATCH/neuter.sh`, which copies the source file to `$SCRATCH/bak/<name>.orig`, applies the neuter, runs RED, copies the backup back, runs `cmp` (exit printed), then runs GREEN. No neuter was committed, and no git checkout, restore or stash was used.

- **q-convert**: in `shapeStoredAnalytics`, right after `out` is built, halve `out.cagr` when `native_unit` is set.
- **q-partition**: in `getPercentiles`'s loop, right after the rankable-row skip, skip a row whose embedded analytics carries `native_unit` in the top-level alias or in `data_quality_flags`.
- **t-sort**: as the first statement of the `result.sort((a, b) => {` comparator, put a native-unit row after a USD row whenever exactly one of the two has a parsed unit.
- **t-chip**: pass `null` as the `ReturnsUnitChip` `unit` prop.

### Neuter: q-convert

```
### NEUTER q-convert (src/lib/queries.ts)
--- RED
     × a native-unit row's figures reach the list unconverted 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.native-unit-ranking.test.ts > Discovery list shaping — no BTC price conversion (CACHE-04) > a native-unit row's figures reach the list unconverted
AssertionError: expected 0.45 to be 0.9 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 1 skipped (2)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 1 skipped (2)
```

### Neuter: q-partition

```
### NEUTER q-partition (src/lib/queries.ts)
--- RED
     × a BTC row is scored in the same population as the USD rows 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.native-unit-ranking.test.ts > Discovery percentiles — one population (CACHE-04) > a BTC row is scored in the same population as the USD rows
AssertionError: expected [ 'usd-1', 'usd-2', 'usd-3', …(2) ] to deeply equal [ 'btc-1', 'usd-1', 'usd-2', …(3) ]
 Test Files  1 failed (1)
      Tests  1 failed | 1 skipped (2)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 1 skipped (2)
```

### Neuter: t-sort

```
### NEUTER t-sort (src/components/strategy/StrategyTable.tsx)
--- RED
     × one BTC row and one USD row rank together by raw CAGR 166ms
     × a BTC row between two USD rows is #2 54ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/components/strategy/StrategyTable.native-unit-ranking.test.tsx > StrategyTable — a BTC-unit row ranks beside USD rows by raw CAGR (CACHE-04) > one BTC row and one USD row rank together by raw CAGR
AssertionError: expected '#1Usd AnchorLong-OnlyBinanceTrack rec…' to contain 'Btc Collateral'
 FAIL  |jsdom| src/components/strategy/StrategyTable.native-unit-ranking.test.tsx > StrategyTable — a BTC-unit row ranks beside USD rows by raw CAGR (CACHE-04) > a BTC row between two USD rows is #2
AssertionError: expected '#2Usd BottomLong-OnlyBinanceTrack rec…' to contain 'Btc Collateral'
 Test Files  1 failed (1)
      Tests  2 failed | 1 skipped (3)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  2 passed | 1 skipped (3)
```

### Neuter: t-chip

```
### NEUTER t-chip (src/components/strategy/StrategyTable.tsx)
--- RED
     × the BTC row keeps its in BTC chip 182ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/components/strategy/StrategyTable.native-unit-ranking.test.tsx > StrategyTable — a BTC-unit row ranks beside USD rows by raw CAGR (CACHE-04) > the BTC row keeps its in BTC chip
AssertionError: expected  to have a length of 1 but got +0
 Test Files  1 failed (1)
      Tests  1 failed | 2 skipped (3)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 2 skipped (3)
```

After all four restores: `git status --porcelain -- src/lib/queries.ts src/components/strategy/StrategyTable.tsx` printed nothing, and `git diff --quiet HEAD -- src/lib/queries.ts src/components/strategy/StrategyTable.tsx` exited 0.

## Verification

- `queries.native-unit-ranking`, `queries.percentiles` and `queries.percentile-columns`: 3 files, 27 tests passed.
- `StrategyTable.native-unit-ranking`, `StrategyTable` and `queries.native-unit-ranking`: 3 files, 74 tests passed.
- `seam-log-coverage`, `critical-regressions`, every `src/lib/*invariant*` test and the `.planning`-reading tests: 30 files, 1105 tests passed.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 4 pre-existing warnings in files this plan does not touch, and every lint-chain check OK.

## Deviations from Plan

None. The plan was executed as written.

**Total deviations:** 0.

## Issues Encountered

None.

## Next Phase Readiness

Wave 1 is complete. If Phase 238 merges first and changes the Discovery sort partitions, re-run the table arm after rebasing.
