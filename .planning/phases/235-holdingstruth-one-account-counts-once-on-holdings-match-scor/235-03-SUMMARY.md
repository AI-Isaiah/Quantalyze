---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
plan: 03
subsystem: my-allocation dashboard payload (src/lib/queries.ts)
tags: [holdings, native-unpriced, sentry, payload-flag, HOLD-04]
requires: ["235-01"]
provides:
  - "MyAllocationDashboardPayload.holdingsUnpricedCheckFailed, set explicitly in both return literals"
  - "a throttled Sentry warning (reason holdings_marker_read_failed) for a failed native-unpriced marker read"
affects: [src/lib/queries.ts, src/lib/queries.my-allocation.test.ts]
tech-stack:
  added: []
  patterns: ["marker-only failure injection key in the fake supabase chain", "reuse of the derived-row 6 h per-instance capture window"]
key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
decisions:
  - "Planner decision 1 (founder-overridable): the capture carries all three tags, op + reason (file convention) and area (CONTEXT's tag)"
  - "Planner decision 2 (founder-overridable): the capture reuses shouldCaptureDerivedRowRejection's 6 h per-instance window; console line and flag stay on every load"
  - "Planner decision 3: the flag is a const set explicitly in both literals, optional on the type for legacy fixtures"
status: complete
actuals:
  tokens: 3650
  tasks: 2
  commits: 2
plan_head_before: 46af71f19082dbe2624bd3fe9066e6370f027b6c
plan_head_after: 872d43bc297a7c8460fce35419c70a60f94eed48
metrics:
  completed: 2026-11-26
---

# Phase 235 Plan 03: HOLD-04 server half Summary

`getMyAllocationDashboard` now carries `fetchLatestHoldingsPerKey`'s `markerReadError` as `holdingsUnpricedCheckFailed` (true or an explicit false, on both return branches), keeps every Holdings row when the marker read fails, and fires one throttled Sentry warning per allocator per 6 h window per instance.

`actuals.commits` counts the two task commits; this SUMMARY's own commit comes after `plan_head_after`. `actuals.tokens` is chars/4 over the 14611-char realized diff of the two task commits (`git diff 46af71f19..872d43bc2`).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 25fa4f266 | the payload flag on both branches, the marker-only failure injection key, arms H1 to H4 |
| 2 | 872d43bc2 | the console line and the throttled, scheduled capture, arms S1 to S4 |

## What was built

- `src/lib/queries.ts`: `holdingsUnpricedCheckFailed?: boolean` on `MyAllocationDashboardPayload`; `const holdingsUnpricedCheckFailed = phase07HoldingsRes.markerReadError !== null;` after the `assertOk` block; the property in both return literals after `keyDataGaps,`; `"holdings_marker_read_failed"` added to `shouldCaptureDerivedRowRejection`'s union (docblock line added); when the flag is true, an unconditional `console.error` and a capture behind that guard, scheduled with `scheduleDerivedRowCapture`: `Error("getMyAllocationDashboard: native-unpriced marker read failed")`, `tags { op, reason, area }`, `extra { userId, supabase_err }`, `level: "warning"`. `derivePhase07Fields` and the reader are untouched.
- `src/lib/queries.my-allocation.test.ts`: injection key `"allocator_equity_derived:native_unpriced"` at both injection points (matches only an `.eq("kind", "native_unpriced:...")` read on `allocator_equity_derived`), one new describe appended at the end of the file (arms H1 to H4, S1 to S4). No existing arm was edited.

## Planner decisions (reversible, founder may override at review)

1. **Tags.** Two conventions exist (the dashboard's captures use `op` + `reason`; the scenario commit route uses `area` + `gate`). The capture carries `op`, `reason` and `area: "my-allocation-dashboard"`. `area` is undotted so a registry-id scan cannot read it as an id.
2. **Throttle.** The existing 6 h per-instance window is reused. The Overview's 30 s `router.refresh()` poll would otherwise send about 120 events an hour per open tab. The `console.error` line and the flag are on every failed load; nothing is suppressed client-side.
3. **Flag shape.** One const, set explicitly in both literals, optional on the type.

## Flagged assumption (a) to (d), checked against the code

- (a) one failed key sets the flag for the whole payload: the reader returns the first failed key's message (`readings.find(...)`), the dashboard compares it to `null`. Arms pin the single-key case only.
- (b) several failed keys: still one flag, one capture within the window (the reader returns one message; the window is per (allocator, reason)). Not pinned by an arm.
- (c) a book with no keys reads no marker, so `markerReadError` is null and the flag is false. Not pinned by an arm.
- (d) keys with zero holdings rows: the marker read still runs per key in the reader, so the flag and capture can fire without rows. Not pinned by an arm.
The verifier should confirm (b) to (d) against the code; they are read-through claims, not tested edges.

## PROOF-01 transcripts (verbatim)

Backups are in `<scratchpad>/p235/plan-03/`. No `git checkout`, `git restore` or `git stash` was used.

### Pre-fix RED, Task 1 (harness and arms H1 to H4 present, `holdingsUnpricedCheckFailed` not yet implemented)

`npx vitest run src/lib/queries.my-allocation.test.ts -t "Phase 235 HOLD-04"` (H4 is green pre-fix by design: rows were already kept, so H4 is a regression guard against N4, not a RED-before-fix arm):

```
     × H1: a marker-only failure sets holdingsUnpricedCheckFailed true on the main branch 185ms
     × H2: a marker-only failure sets holdingsUnpricedCheckFailed true on the no-portfolio branch 1ms
     × H3: a healthy read sets the flag to an explicit false (main branch) 1ms
     × H3: a healthy read sets the flag to an explicit false (no-portfolio branch) 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected undefined to be true // Object.is equality
AssertionError: expected undefined to be true // Object.is equality
AssertionError: expected undefined to be false // Object.is equality
      Tests  4 failed | 1 passed | 256 skipped (261)
```

### Pre-fix RED, Task 2 (arms S1 to S4 present, capture not yet implemented)

`npx vitest run src/lib/queries.my-allocation.test.ts` (S3 is green pre-fix by design: a healthy read has no capture, so S3 is pinned by N7):

```
     × S1: a failed marker read fires one warning capture with the exact message, tags and extra 3ms
     × S2: a second failed load in the window sends no second capture, keeps the flag, and logs both loads 1ms
     × S4: the capture's extra holds no key id 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected [] to have a length of 1 but got +0
AssertionError: expected [] to have a length of 1 but got +0
AssertionError: expected [] to have a length of 1 but got +0
 Test Files  1 failed (1)
      Tests  3 failed | 262 passed (265)
```

### N1 (const is `false`) expected RED H1, H2

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N1.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N1 applied
     × H1: a marker-only failure sets holdingsUnpricedCheckFailed true on the main branch 3ms
     × H2: a marker-only failure sets holdingsUnpricedCheckFailed true on the no-portfolio branch 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  2 failed | 259 passed (261)
$ cp <scratchpad>/p235/plan-03/235-03-N1.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N1.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  261 passed (261)
```

### N2 (const is `true`) expected RED H3

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N2.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N2 applied
     × H3: a healthy read sets the flag to an explicit false (main branch) 3ms
     × H3: a healthy read sets the flag to an explicit false (no-portfolio branch) 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  2 failed | 259 passed (261)
$ cp <scratchpad>/p235/plan-03/235-03-N2.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N2.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  261 passed (261)
```

### N3 (property set in the main literal only) expected RED H2

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N3.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N3 applied
     × H2: a marker-only failure sets holdingsUnpricedCheckFailed true on the no-portfolio branch 2ms
     × H3: a healthy read sets the flag to an explicit false (no-portfolio branch) 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  2 failed | 259 passed (261)
$ cp <scratchpad>/p235/plan-03/235-03-N3.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N3.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  261 passed (261)
```

### N4 (holdings rows emptied when `markerReadError` is non-null) expected RED H4

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N4.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N4 applied
     × H4: the marker failure keeps the rows and the AUM of the healthy book, and the equity-curve read stays healthy 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  1 failed | 260 passed (261)
$ cp <scratchpad>/p235/plan-03/235-03-N4.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N4.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  261 passed (261)
```

### N5 (capture removed) expected RED S1

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N5.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N5 applied
     × S1: a failed marker read fires one warning capture with the exact message, tags and extra 3ms
     × S2: a second failed load in the window sends no second capture, keeps the flag, and logs both loads 1ms
     × S4: the capture's extra holds no key id 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  3 failed | 262 passed (265)
$ cp <scratchpad>/p235/plan-03/235-03-N5.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N5.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  265 passed (265)
```

### N6 (throttle guard dropped) expected RED S2

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N6.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N6 applied
     × S2: a second failed load in the window sends no second capture, keeps the flag, and logs both loads 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  1 failed | 264 passed (265)
$ cp <scratchpad>/p235/plan-03/235-03-N6.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N6.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  265 passed (265)
```

### N7 (capture and log run whatever the flag) expected RED S3

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N7.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N7 applied
     × a failed read gives no tinyBaseDays (fail closed), warns once, and leaves the options caveat's own fail-open value 1ms
     × the key_inputs read fails (KL-4): the baseline is the field-less run, no payload key, and the warn and Sentry capture fire once 1ms
     × S3: a healthy read sends no marker-read capture 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  3 failed | 262 passed (265)
$ cp <scratchpad>/p235/plan-03/235-03-N7.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N7.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  265 passed (265)
```

### N8 (the owner's key ids added to `extra`) expected RED S4

```
$ cp src/lib/queries.ts <scratchpad>/p235/plan-03/235-03-N8.bak
$ npx vitest run src/lib/queries.my-allocation.test.ts   # N8 applied
     × S1: a failed marker read fires one warning capture with the exact message, tags and extra 4ms
     × S4: the capture's extra holds no key id 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  2 failed | 263 passed (265)
$ cp <scratchpad>/p235/plan-03/235-03-N8.bak src/lib/queries.ts
$ cmp <scratchpad>/p235/plan-03/235-03-N8.bak src/lib/queries.ts   # silent = byte-equal
(cmp silent, exit 0)
$ npx vitest run src/lib/queries.my-allocation.test.ts   # restored
 Test Files  1 passed (1)
      Tests  265 passed (265)
```

### Wave checks (after the final restore)

```
$ npx vitest run src/lib/queries.my-allocation.test.ts src/__tests__/computed-at-reader-census.test.ts src/__tests__/holding-scope-key-census.test.ts
 Test Files  3 passed (3)
      Tests  335 passed (335)
$ npx eslint src/lib/queries.ts src/lib/queries.my-allocation.test.ts
eslint exit=0
$ npm run typecheck

> quantalyze@0.133.93.2 typecheck
> tsc --noEmit

typecheck exit=
```

`npm run typecheck` printed no error lines and exited 0 (re-run on its own after fixing two implicit-any parameters in the new arms, found by the first typecheck run).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two implicit-any parameters in arm S2**
- **Found during:** Task 2 wave checks (`npm run typecheck`, TS7006 at two `.filter((c) => ...)` callbacks)
- **Fix:** typed the callback parameters `unknown[]`
- **Files modified:** src/lib/queries.my-allocation.test.ts
- **Commit:** 872d43bc2 (fixed before the Task 2 commit, so the commit is typecheck-clean)

### Observations on the neuter table (not plan deviations)

- N3 reddens H2 and also H3 (no-portfolio branch): an absent field fails `toBe(false)` too. Strictly more than the table's "H2".
- N5 reddens S1, S2 and S4 (all three need a capture), not only S1.
- N7 reddens S3 and two pre-existing `tinyBaseDays` / `key_inputs` arms that assert capture counts. Those arms are green again after the restore and were not edited.
- H4 and S3 are green on pre-fix code: both assert a property that already held (rows kept, no capture on a healthy read). Their RED is the named neuter (N4, N7), as the plan's table intends.

**2. [Plan acceptance literal, not behavior] `grep -c "phase07HoldingsRes.markerReadError" src/lib/queries.ts` is 3, the criterion says `== 1`.** The criterion was written for Task 1 alone. Task 2's console line and `extra.supabase_err` (both required by the plan's own Task 2 action) read the same field, so three lines match. No behavior differs; a reader wanting the literal `== 1` can hoist the field into a local const, which would be a pure refactor.

None other. The plan's allowed-scope held: only the two named files changed, no STATE.md or ROADMAP.md edit, no push.

## Known Stubs

None.

## Threat Flags

None. The new Sentry capture is the plan's own T-235-06 surface; `extra` carries only `userId` and the supabase message (arm S4 and N8).

## Self-Check: PASSED

- `src/lib/queries.ts` and `src/lib/queries.my-allocation.test.ts` modified: FOUND
- commit 25fa4f266: FOUND (ancestor of HEAD)
- commit 872d43bc2: FOUND (ancestor of HEAD)
- acceptance greps: `holdingsUnpricedCheckFailed` 5 in queries.ts (>=4); `"holdings_marker_read_failed"` 3 (>=3); `area: "my-allocation-dashboard"` 1; the capture message string 1; `grep -c "phase07HoldingsRes.markerReadError"` is **3**, not the plan's `== 1` (see Deviations)
