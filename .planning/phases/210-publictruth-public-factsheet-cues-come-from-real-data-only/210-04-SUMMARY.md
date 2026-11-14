---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
plan: 04
subsystem: factsheet
tags: [factsheet, dead-code, census, d-11, d-12]
requires: [210-02]
provides:
  - peer-cohort.ts and allocator.ts (seeded demo cohort and demo blend math) and their unit tests are deleted (D-11)
  - the D-17 site census and retired table lose the allocator.ts row without gaining an exclusion (D-12)
affects: [factsheet, publictruth]
key-files:
  deleted:
    - src/lib/factsheet/peer-cohort.ts
    - src/lib/factsheet/peer-cohort.test.ts
    - src/lib/factsheet/allocator.ts
    - src/lib/factsheet/allocator.test.ts
  modified:
    - src/lib/return-stats.single-source.test.ts
    - src/lib/factsheet/return-stats.sites.test.ts
    - src/lib/factsheet/return-stats.sites-joint.test.ts
    - vitest.node-env.ts
    - tools/eslint-plugin-quantalyze/rules/no-rem-less-clamp.mjs
    - docs/architecture/adr-0025-scenario-peer-carveout.md
decisions:
  - "BASE_EXPECTED in return-stats.single-source.test.ts is untouched and still carries 'src/lib/factsheet/allocator.ts P2' (it pins a historical merge-base tree, RESEARCH Pitfall 7)"
  - "The single-source import-rule test title and docblock said '16 Tier-2 site files'; changed to 15 so the title stays true after the row was dropped (census not loosened)"
metrics:
  completed: 2026-11-14
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: 83d4cf8aaf58893d1adcbad16d006b7768a1505f
plan_head_after: c4cf9bfcfb4ac390dc673fc58758a30c4eaf5f15
commits: 2
---

# Phase 210 Plan 04: delete the dead demo producers Summary

The seeded demo cohort (`computePeerPercentile`) and the demo blend math (`buildAllocatorMetrics`, `alignBlend`, `comparatorLeg`, `blend`) are deleted with their unit tests, and every census that named them lost its row or case; none gained an exclusion, skip or allowlist. `PeerPercentilePayload` and the SPX/ETH/GLD/IEF series are untouched.

## Commits

- `0a78d785f` refactor(210-04): four files `git rm`ed; `allocator.ts` row out of `TIER2_SITES` and `RETIRED` (RETIRED 28 to 27); producer imports and cases dropped from `return-stats.sites.test.ts` (the `peer percentile` describe and the producer `it` in HI-02, describe retitled `HI-02 compute and bootstrapCI: ...`) and `return-stats.sites-joint.test.ts` (the T20 describe, docblock now T16/T17/T19); `allocator.test.ts` entry removed from `vitest.node-env.ts` (Task 1, tracer).
- `c4cf9bfcf` docs(210-04): `no-rem-less-clamp.mjs` header names only `scenario-montecarlo.ts`; a dated 2026-11-14 note in ADR-0025 (Task 2).

## RED proof (Task 1 step 2: files deleted, census not yet edited)

```
FAIL return-stats.sites-joint.test.ts: Failed to resolve import "./allocator" ... Does the file exist?
FAIL return-stats.sites.test.ts: Failed to resolve import "./peer-cohort" ... Does the file exist?
FAIL single-source > import rule: D-17 import rule:
  src/lib/factsheet/allocator.ts: missing (a renamed site must be re-listed, not dropped)
FAIL single-source > retired table: D-20 B1 retired table:
  src/lib/factsheet/allocator.ts: missing (the retired rows would pass vacuously)
Test Files 3 failed (3); Tests 2 failed | 32 passed
```

After the edits: 3 files passed, 158 tests passed.

## Verification

- `git grep -n -a -F -e './peer-cohort"' -e './allocator"' -e 'factsheet/peer-cohort"' -e 'factsheet/allocator"' -- src` prints nothing; the four files are gone.
- `npx tsc --noEmit` clean; `npm run lint` 0 errors (4 pre-existing warnings, none in touched files; hygiene and manifest checks OK).
- `npx vitest run src/lib/factsheet src/lib/return-stats.single-source.test.ts`: 1623 passed, 2 failed (see Deferred Issues).
- The plan's final `npm test` (full suite) was not run here; CI runs it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale count in the import-rule test title and docblock**
- **Found during:** Task 1 step 3
- **Issue:** the title `each of the 16 Tier-2 site files` would be false with 15 entries.
- **Fix:** 16 to 15 in the title and docblock line. No census row or rule changed.
- **Files modified:** src/lib/return-stats.single-source.test.ts
- **Commit:** 0a78d785f

## Deferred Issues

`src/lib/factsheet/compute.conventions.test.ts` fixtures B and C fail a FROZEN snapshot on the last digit of `skew` (`-0.11360716852722537` vs `-0.11360716852722538`; `0.036844507138639` vs `0.036844507138638946`). Out of scope: that test imports only `./compute`, and `compute.ts` and `return-stats.ts` are unchanged on this branch relative to main, so the plan's deletion cannot cause it. Looks like a platform floating-point difference; not investigated further, and not re-measured on a clean main checkout. Needs a look before the phase's CI run.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Deleted files absent, both commits present in HEAD ancestry (`0a78d785f`, `c4cf9bfcf`).
