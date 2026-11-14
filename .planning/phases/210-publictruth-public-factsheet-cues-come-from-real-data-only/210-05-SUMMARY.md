---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
plan: 05
subsystem: factsheet
tags: [factsheet, sentry, provenance, cache-key, d-14, d-16, d-17, d-18, d-19, d-20]
requires: [210-02, 210-03]
provides:
  - readUnrecoveredGaps returns { gaps, malformed }; parseUnrecoveredGaps is a one-line wrapper over it (D-16)
  - fetchAndBuildPayload reports a malformed gap record to Sentry once with only the reason, and sets payload.unrecoveredGapsUnavailable (D-17)
  - the factsheet and tear-sheet header show the locked unavailable sentence instead of reading as gap-free (D-18)
  - the factsheet unstable_cache key is bumped once for the phase, v24 to v25 (D-14, D-20)
affects: [factsheet, publictruth]
key-files:
  modified:
    - src/lib/factsheet/trade-fetch-provenance.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/types.ts
    - "src/app/factsheet/[id]/trade-fetch-lines.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/page.tsx"
    - src/lib/factsheet/trade-fetch-provenance.test.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - "src/app/factsheet/[id]/v2/FactsheetView.unrecovered-gap.test.tsx"
    - "src/app/factsheet/[id]/tearsheet/page.trade-fetch.test.tsx"
    - "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"
    - "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"
decisions:
  - "The sentence is written exactly as locked by D-18 and the render test types it as a literal, not an import."
  - "unrecoveredGapsUnavailable is spread into the payload only when true, so every readable-record payload keeps its exact serialized shape and the build-payload snapshot did not move."
  - "The cache key is v25 here; the ship step re-picks the number against origin/main (parallel phases bump it too)."
metrics:
  completed: 2026-11-14
status: complete
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: b63831a0888f9adf7cb0de18792abdc25a290634
plan_head_after: c6500b62bd892aaab2da9ecb0541b9ff508569f0
commits: 3
---

# Phase 210 Plan 05: a malformed gap record is reported and disclosed Summary

A malformed `series_provenance.unrecovered_gaps` record no longer reads as "no gaps": the reader returns a verdict, the builder reports it to Sentry once per cache miss with only the short reason string, and the factsheet and tear sheet header say "Record of days without trade data unavailable. Some days may be missing from the record." The factsheet cache key moved once for the whole phase, `factsheet-v2-payload-v24` to `v25`.

## Commits

- `aa42ede90` feat(210-05) (Task 1, tracer): `readUnrecoveredGaps` with `malformedGaps(reason)` replacing `warnMalformed`, same guard chain, same six reasons, same sort; `parseUnrecoveredGaps` is the one-line wrapper (one parser body). `fetchAndBuildPayload` destructures `{ gaps, malformed }`, calls `captureToSentry` with tags `{ stage: "factsheet-unrecovered-gaps", reason: "unrecovered_gaps_malformed", strategy_id }` and `extra: { detail }`, and sets `unrecoveredGapsUnavailable: unrecoveredMalformed !== null` on `strategyArg` (the USD build reuses it and inherits the flag). `build-payload.ts` and `types.ts` gain the optional field, spread only when true. `UnrecoveredGapLines` takes `unavailable` and `FactsheetView` passes it.
- `64a13c548` test(210-05) (Task 2): reader, caller, render and tear-sheet cases for the absent, valid and malformed record.
- `c6500b62b` feat(210-05) (Task 3): one dated comment above the key, the key itself, two pin tests and the doc comment in `fetch-and-build-payload.ts`.

## RED proof

Step 1 (before any implementation), the two new tests:

```
x a malformed provenance names no gap, flags the payload and reports once with only the reason
  AssertionError: expected undefined to be true
x D-18: a malformed gap record shows exactly one muted unavailable sentence and no gap line
  AssertionError: expected [] to have a length of 1 but got +0
Tests 2 failed | 142 passed (144)
```

## Neuter proofs (D-19), each restored byte-identically

| Neuter | File | RED seen | shasum before = after restore |
|--------|------|----------|-------------------------------|
| (a) `malformedGaps` returns `malformed: null` | `trade-fetch-provenance.ts` | `Tests 11 failed`: the six-reason malformed table, one-bad-entry, hostile-getter, and both malformed fetch cases (`a malformed provenance names no gap, flags the payload...`, `T-210-11`) | `4476bf11af53...0c61a8` = `4476bf11af53...0c61a8` |
| (b) delete the gap `captureToSentry` call | `fetch-and-build-payload.ts` | `Tests 2 failed`: `a malformed provenance names no gap, flags the payload and reports once...` (call count), `T-210-11: the gap report carries the reason string only` | `291665635bed...d9b96` = `291665635bed...d9b96` |
| (c) delete the `if (unavailable)` early return | `trade-fetch-lines.tsx` | `Tests 3 failed`: `D-18: a malformed gap record shows exactly one muted unavailable sentence...`, `...muted-secondary, never a warning colour`, `...printView... exactly once` | `01f8316ab64b...109c` = `01f8316ab64b...109c` |

Backups were `cp` byte copies in the scratchpad; no `git checkout`, `restore` or `stash`. After each restore the named files were re-run GREEN (243 tests across the five Task 2 files).

## Verification

- `npx vitest run` over the four Task 1 files: 4 files, 240 tests pass; build-payload snapshot unchanged (`git diff --quiet` on the `.snap` exits 0).
- Task 2's five-file command: 5 files, 243 tests pass. Task 3's two pin tests: 20 tests pass.
- `git grep -a 'factsheet-v2-payload-v24' -- src` prints nothing; v25 appears in exactly the four files edited.
- `npx tsc --noEmit` exits 0; `npm run lint` 0 errors (4 pre-existing warnings), planning-hygiene rules OK.
- Full `npm test`: 1234 files pass, 1 fails. The only failure is `src/lib/factsheet/compute.conventions.test.ts` (fixture C skew last digit, platform float), the known pre-existing local-only failure; the file is identical to main and was not edited.

## Cache-key census (D-14)

`git grep -n -a 'unstable_cache(' -- src` non-test hits: `src/app/factsheet/[id]/v2/page.tsx` (bumped) and `src/app/api/keys/[id]/permissions/route.ts` (caches key permissions, not a factsheet payload). No other payload cache exists, so nothing else was bumped.

## Deviations from Plan

None. The plan executed as written. One tooling note, not a deviation: the first neuter-(a) attempt ran no tests because zsh does not word-split an unquoted `$T` in the helper function; it was redone with explicit file arguments, and the file was restored and shasum-checked before the redo.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. The only new outbound surface is the planned Sentry report (T-210-11), whose `extra` is pinned by a test to carry no offending date.

## Self-Check: PASSED

- FOUND: `aa42ede90`, `64a13c548`, `c6500b62b` (all ancestors of HEAD)
- FOUND: `readUnrecoveredGaps`, `GAPS_UNAVAILABLE_SENTENCE`, `unrecoveredGapsUnavailable`, `factsheet-v2-payload-v25` in the files above
