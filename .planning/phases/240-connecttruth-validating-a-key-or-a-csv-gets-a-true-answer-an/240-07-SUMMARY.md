---
phase: 240-connecttruth-validating-a-key-or-a-csv-gets-a-true-answer-an
plan: 07
subsystem: api
tags: [rate-limiting, upstash, csv, vitest, cross-language-gate]

requires:
  - phase: 240-04
    provides: _PROCESS_KEY_CSV_LIMIT = "60/minute" in analytics-service/routers/process_key.py
provides:
  - csvFinalizeLimiter (20 per 60 s), csv-finalize's own edge limiter instance
  - the csvValidateLimiter docblock citing the real upstream cap (_PROCESS_KEY_CSV_LIMIT)
  - tests/lib/csv-limit-agreement.test.ts, the edge/upstream CSV agreement gate
affects: [ship of phase 240 (TODOS entry "csv-validate: 12x over the shared /process-key tenant tier + stale docblock citation" is deleted there)]

plan_head_before: 3e0bd6dd1b0cd1aefa5451d48659dfcd944134f0
plan_head_after: 477febd980d3c3f87dbeb22dd10cd339d18fc339
actuals:
  tokens: 3740
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "a cross-language gate reads both source files as text, parses each number with a regex that must match, compares to hand-typed literals and asserts the relation; zero module mocks"

key-files:
  created:
    - tests/lib/csv-limit-agreement.test.ts
  modified:
    - src/lib/ratelimit.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/app/api/strategies/csv-finalize/route.test.ts
    - src/__tests__/csv-finalize-after-failloud.test.ts
    - src/__tests__/csv-finalize-c14-regression.test.ts
    - src/__tests__/csv-finalize-concurrent-never-classified.test.ts
    - src/__tests__/csv-finalize-cross-submission-merge.test.ts
    - src/__tests__/csv-validate-route.test.ts
    - tests/integration/process-key-thin-adapters.test.ts

key-decisions:
  - "csv-finalize keeps 20 per 60 s on its own instance: the throttle sentence 'Wait a minute and try again' stays true for both routes, and the checkLimit position after validation (B15) is unchanged"
  - "The 3x edge-to-upstream relation (20 x 3 = 60) is the founder-accepted derivation and is described in the docblock as a reading of the window algorithm, not an airtight bound"

requirements-completed: [RLIM-02]

coverage:
  - id: D1
    description: "csv-finalize spends csvFinalizeLimiter (identity) under strategies-csv-finalize:<user id>, never csvValidateLimiter"
    requirement: RLIM-02
    verification:
      - kind: unit
        ref: "src/app/api/strategies/csv-finalize/route.test.ts#[240-07 / RLIM-02] csv-finalize spends its OWN limiter, never csvValidateLimiter, under its own identifier"
        status: pass
    human_judgment: false
  - id: D2
    description: "Edge CSV limits (20 per 60 s, both routes) and the upstream csv tier (60/minute) agree, with upstream at least 3x the edge cap"
    requirement: RLIM-02
    verification:
      - kind: unit
        ref: "tests/lib/csv-limit-agreement.test.ts#the relation"
        status: pass
    human_judgment: false
  - id: D3
    description: "The csvValidateLimiter docblock cites _PROCESS_KEY_CSV_LIMIT and carries neither the stale upstream-cap sentence nor the shared-bucket claim"
    requirement: RLIM-02
    verification:
      - kind: unit
        ref: "tests/lib/csv-limit-agreement.test.ts#the docblock above csvValidateLimiter cites the real upstream cap and neither stale claim"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-24
status: complete
---

# Phase 240 Plan 07: Separate CSV edge limiters and the edge/upstream agreement gate Summary

**csv-finalize now throttles on its own `csvFinalizeLimiter` (20 per 60 s, identifier and position unchanged), the `csvValidateLimiter` docblock cites the real upstream cap `_PROCESS_KEY_CSV_LIMIT` (60/minute), and a zero-mock cross-language test goes red if the edge or upstream CSV number is retuned alone.**

## Accomplishments

- `src/lib/ratelimit.ts`: new `csvFinalizeLimiter = makeLimiter(20, "60 s")` with its own docblock (spends no upstream `/process-key` token; the 60 s window is kept so the throttle sentence stays true). `csvValidateLimiter`'s value, and `publicIpLimiter`, are untouched.
- The `csvValidateLimiter` docblock keeps the iteration rationale, replaces the stale "upstream Python service has its own 30/hour cap" sentence with the real cap, drops the claim that validate and finalize ride one bucket, cites the agreement test as the gate, and does not call the 3x sizing airtight. Cited by symbol, no line numbers.
- `csv-finalize/route.ts` imports and passes `csvFinalizeLimiter`; identifier `strategies-csv-finalize:<user id>` and the post-validation position are unchanged.
- `route.test.ts` uses two distinct sentinel objects and asserts, by identity (`toBe`), that `checkLimit` is called exactly once with the finalize sentinel, not the validate sentinel, and the finalize identifier.
- `tests/lib/csv-limit-agreement.test.ts`: five tests. Both edge limiters are 20 per 60 s, `_PROCESS_KEY_CSV_LIMIT` is 60/minute (hand-typed literals), the relation (60 s windows, minute unit, upstream >= 3 x edge) and the docblock content rules. Each parse asserts a match before comparing.

## Task Commits

1. **Task 1 (tracer): csv-finalize throttles on its own edge limiter** - `3eaa4fcfc`
2. **Task 2: pin the edge and upstream CSV limits to each other** - `477febd98`

## Verification

- Plan verification set (the ten test files named in the plan, plus the two extra mock-factory files below, plus all of `src/app/api/strategies`): 25 files, 1060 tests passed after Task 1; Task 2's file adds 5 more, all green.
- Wider sweep: every vitest file that mentions `csvValidateLimiter` or `csv-finalize` (41 files, plus the new agreement test): 40 files passed, 1873 tests passed, 4 skipped (pre-existing skips). A whole-repo `vitest run` was started but hit its 580 s timeout before printing a summary, so it is not claimed.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0 (4 pre-existing unused-variable warnings in `composite-read-path.ts` and `queries.stale-analytics-detail.test.ts`, files this plan does not touch).
- Acceptance greps: `csvFinalizeLimiter` export line 1; `csvValidateLimiter` in the finalize route 0; `csvFinalizeLimiter` in the finalize route 2; `csvValidateLimiter` value line 1; `publicIpLimiter` line 1; "30/hour cap" 0; "rides the same dedicated bucket" 0; `_PROCESS_KEY_CSV_LIMIT` in ratelimit.ts 1; the test file present.
- `git status --porcelain -- supabase/migrations` printed nothing. STATE.md and ROADMAP.md untouched.

## PROOF-01 (four neuters, each on a byte backup restored with cp)

Every block is the verbatim output. The split neuter edited the real route after `cp` to a backup; the three agreement neuters did the same for `ratelimit.ts` and `process_key.py`. Each restore was `cp` back followed by `cmp` (exit 0), then GREEN.

### 1. Split (route points `checkLimit` back at `csvValidateLimiter`)

```
=== PROOF-01 split: neuter (route points checkLimit back at csvValidateLimiter) ===
6:import { csvValidateLimiter, csvFinalizeLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
2517:    csvValidateLimiter,
       × [240-07 / RLIM-02] csv-finalize spends its OWN limiter, never csvValidateLimiter, under its own identifier 11ms
 FAIL  |node| src/app/api/strategies/csv-finalize/route.test.ts > POST /api/strategies/csv-finalize — CONTRIB-02 private-by-default contribution > [140.4-13 / SEAMRIM-05] the limiter deny arm > [240-07 / RLIM-02] csv-finalize spends its OWN limiter, never csvValidateLimiter, under its own identifier
AssertionError: expected { sentinel: 'csvValidateLimiter' } to be { sentinel: 'csvFinalizeLimiter' } // Object.is equality
      Tests  1 failed | 20 passed (21)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

### 2. Agreement, edge side (`csvValidateLimiter = makeLimiter(30, "60 s")`)

```
=== PROOF-01 agreement (edge side): neuter (csvValidateLimiter = makeLimiter(30, "60 s")) ===
210:export const csvValidateLimiter = makeLimiter(30, "60 s");
     × csvValidateLimiter is 20 per 60 s at the edge 8ms
     × the relation: both edge windows are 60 s, upstream is per minute, and upstream carries at least 3x the edge cap 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| tests/lib/csv-limit-agreement.test.ts > RLIM-02 edge and upstream CSV limits agree across languages > csvValidateLimiter is 20 per 60 s at the edge
 FAIL  |jsdom| tests/lib/csv-limit-agreement.test.ts > RLIM-02 edge and upstream CSV limits agree across languages > the relation: both edge windows are 60 s, upstream is per minute, and upstream carries at least 3x the edge cap
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### 3. Agreement, upstream side (`_PROCESS_KEY_CSV_LIMIT = "20/minute"`)

```
=== PROOF-01 agreement (upstream side): neuter (_PROCESS_KEY_CSV_LIMIT = 20/minute) ===
139:_PROCESS_KEY_CSV_LIMIT = "20/minute"
     × _PROCESS_KEY_CSV_LIMIT is 60/minute upstream 9ms
     × the relation: both edge windows are 60 s, upstream is per minute, and upstream carries at least 3x the edge cap 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| tests/lib/csv-limit-agreement.test.ts > RLIM-02 edge and upstream CSV limits agree across languages > _PROCESS_KEY_CSV_LIMIT is 60/minute upstream
 FAIL  |jsdom| tests/lib/csv-limit-agreement.test.ts > RLIM-02 edge and upstream CSV limits agree across languages > the relation: both edge windows are 60 s, upstream is per minute, and upstream carries at least 3x the edge cap
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### 4. Docblock (the old upstream-cap sentence restored above `csvValidateLimiter`)

```
=== PROOF-01 docblock: neuter (the old upstream-cap sentence restored above csvValidateLimiter) ===
210:// The upstream Python service has its own 30/hour cap (the CSV router's limiter).
     × the docblock above csvValidateLimiter cites the real upstream cap and neither stale claim 8ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| tests/lib/csv-limit-agreement.test.ts > RLIM-02 edge and upstream CSV limits agree across languages > the docblock above csvValidateLimiter cites the real upstream cap and neither stale claim
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
cmp exit=0
=== GREEN ===
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Task 2 was also RED first on the docblock arm alone (the other four tests passed, as the edge and upstream numbers were already correct): `AssertionError: expected '// 20/minute per authenticated user —…' to contain '_PROCESS_KEY_CSV_LIMIT'`, `Tests  1 failed | 4 passed (5)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two more closed `vi.mock("@/lib/ratelimit")` factories load the csv-finalize route**
- **Found during:** Task 1, first run of the plan's verification set (22 failures in `csv-validate-route.test.ts`: `No "csvFinalizeLimiter" export is defined on the mock`)
- **Issue:** The plan counted five mock factories. `src/__tests__/csv-validate-route.test.ts` (which also imports the csv-finalize route) and `tests/integration/process-key-thin-adapters.test.ts` (which imports it dynamically in two tests) each carry a closed factory that lists `csvValidateLimiter`.
- **Fix:** added `csvFinalizeLimiter: {}` (and `csvFinalizeLimiter: null` in the thin-adapters factory, which uses `null` placeholders) beside `csvValidateLimiter`. One line each.
- **Files modified:** `src/__tests__/csv-validate-route.test.ts`, `tests/integration/process-key-thin-adapters.test.ts`
- **Commit:** `3eaa4fcfc`

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** none on scope; two extra one-line test-fixture edits, both required for the route import to resolve.

## Known limits and flagged assumptions (recorded, not fixed)

- The 3x relation is a reading of Upstash's documented window algorithm, not an Upstash run (RESEARCH A2). The agreement test pins the numbers to each other; it does not prove the algorithm's bound.
- `routers/csv.py`'s own `/csv/validate` 30/hour limit is real, has no TS caller and was not touched.
- The agreement test reads source text with regexes, so a refactor that stops spelling the limiter as a `makeLimiter(N, "S s")` literal goes red by design (the match assertion), not silently green.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change (T-240-24 and T-240-25 are mitigated as planned).

## Self-Check: PASSED

- Created file present: `tests/lib/csv-limit-agreement.test.ts`.
- Task commits are ancestors of HEAD: `3eaa4fcfc`, `477febd98`.
- `git rev-list --count 3e0bd6dd1b0cd1aefa5451d48659dfcd944134f0..HEAD` printed 2 before this SUMMARY commit.
- STATE.md and ROADMAP.md untouched.
