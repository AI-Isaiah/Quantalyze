---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
plan: 04
subsystem: seam budgets / create-with-key
tags: [CONN-02, seam-budget, mt5-rotate]
requirements: [CONN-02]
status: complete
key-files:
  modified:
    - src/lib/resilient-fetch.ts
    - src/lib/seam-budgets.invariant.test.ts
commits: 2
plan_head_before: 078f1147b1c3b834a88254c630cce50423e49938
plan_head_after: f13c3d37c4704907beadbd6e94c5bf5be490c28d
commit-list: [b49826b53, f13c3d37c]
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
completed: 2026-11-26
---

# Phase 228 Plan 04: the census declares and pins the rotate leg

## What shipped

- `SEAM_ROUTE_BUDGETS["src/app/api/strategies/create-with-key/route.ts"]` declares `{ key: "keys-rotate-secret", calls: 1, branch: "mt5-rotate" }`, an exclusive branch beside `default-venue` and `serialized-venue`, with a comment that it is never summed with validate (RESEARCH Pitfall 1) and that the shared unlabelled `encrypt-key` leg over-states it. The `EXPECTED_ROUTE_BUDGETS` twin carries the identical row. `CONNECT_VENUE_ARMS` stays two rows; no `RouteBudgetKey` or `SEAM_BUDGETS` change.
- New pin `228 / O2: the mt5-rotate leg fits inside the browser deadline — failing, hand-typed`. Hand-derived 175 500 ms (120 000 rotate + 30 000 encrypt + 2 legs x 3 commands x 4 250), and the clauses: 175 500 <= `connectAbortDeadlineMsFor("mt5") - WAIT_ABORT_GRACE_MS`; `keys-rotate-secret.timeoutMs <= validate-key-serialized.timeoutMs`; equal retries. The four clauses use `expect.soft` so one budget move reports every broken clause by name.

## Verification

- Task 1: `seam-budgets.invariant.test.ts` + `seam-constants.pin.test.ts`: 182 passed (2 files).
- Task 2: `seam-budgets.invariant.test.ts` + `seam-citations.invariant.test.ts` + `seam-retry-registry.test.ts`: 190 passed (3 files); with `seam-constants.pin.test.ts` also: 285 passed (4 files).
- Nothing other than the twin needed an edit; the multi-branch roster test and SC-4f did not move (create-with-key was already multi-branch).

## Deviations from Plan

None - plan executed as written. Two observations:

- The O2 bound is tight, not loose: `connectAbortDeadlineMsFor("mt5")` is 190 500 and minus the 15 000 grace is exactly 175 500, so the rotate arm's declared worst case equals the bound and passes with 0 ms of slack. Any growth of the rotate leg breaks it, which is the intent.
- The neuter in PROOF-01 (b) additionally reddened PARITY-03, as expected, because the create-with-key worst branch grew past the browser deadline.

## PROOF-01 neuters (byte backup with cp, restore with cp, then cmp; never git checkout/restore/stash)

Backups under `scratchpad/p228b/ex04/`.

### (a) Task 1: drop `branch: "mt5-rotate"` (leg unlabelled and summed)

```
### RED
     × SC-4d / D-10 — every route row's CONTENTS match the hand-typed map 10ms
       × src/app/api/strategies/create-with-key/route.ts — failing state: request budget + store round trips < maxDuration x 1000 1ms
       × PARITY-03: the browser is the last party to give up — both connect routes, both venue arms, EVERY breaker state 1ms
AssertionError: "src/app/api/strategies/create-with-key/route.ts" [serialized-venue]'s FAILING worst case is now 308250ms; the hand-computed figure is 175500ms. ...: expected 308250 to be 175500
 Test Files  1 failed (1)
      Tests  3 failed | 84 passed (87)
cmp: identical (exit 0)
### GREEN
 Test Files  2 passed (2)
      Tests  182 passed (182)
```


### (b) Task 2: `SEAM_BUDGETS["keys-rotate-secret"].timeoutMs` 120_000 -> 150_000

```
### RED
     × 228 / O2: the mt5-rotate leg fits inside the browser deadline — failing, hand-typed 6ms
     × PARITY-03: the browser is the last party to give up — both connect routes, both venue arms, EVERY breaker state 1ms
AssertionError: create-with-key's MT5-ROTATE branch now costs 205500ms in the failing state; the hand-computed figure is 175 500ms (150 000 request + 25 500 store). ...: expected 205500 to be 175500
AssertionError: keys-rotate-secret's timeout (150000ms) must be at most validate-key-serialized's (120000ms): the browser deadline was derived from the serialized validate budget.: expected false to be true
AssertionError: The SERIALIZED client deadline no longer clears "src/app/api/strategies/create-with-key/route.ts"'s worst branch in its worst state (205500ms). ...: expected 190500 to be greater than 205500
 Test Files  1 failed (1)
      Tests  2 failed | 86 passed (88)
cmp: identical (exit 0)
### GREEN
 Test Files  4 passed (4)
      Tests  285 passed (285)
```

## Known Stubs

None.

## Threat Flags

None. T-228-18 (browser says "Nothing was saved" while the rotate leg can still write) is mitigated by the exclusive branch plus the O2 pin, proven able to fail by neuter (b).

## Self-Check: PASSED

- `grep -a -c 'branch: "mt5-rotate"'`: resilient-fetch.ts 1, seam-budgets.invariant.test.ts 1.
- `grep -a -c "228 / O2"` in the test file >= 1; `175_500` count >= 2.
- Commits b49826b53 and f13c3d37c are ancestors of HEAD.
