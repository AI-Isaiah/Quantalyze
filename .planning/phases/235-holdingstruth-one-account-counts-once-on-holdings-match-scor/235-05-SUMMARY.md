---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
plan: 05
subsystem: my-allocation dashboard payload (src/lib/queries.ts) and the missing-data producer (key-data-gaps.ts)
tags: [holdings, shared-account, payload-field, owner-only, HOLD-05]
requires: ["235-01", "235-03"]
provides:
  - "sharedAccountFailingGroups(input): string[][] in key-data-gaps.ts, every all-failing shared account, with or without a tail range"
  - "deriveSharedAccountFailingGroupsField in queries.ts, built from the same private input builder as deriveKeyDataGapsField"
  - "MyAllocationDashboardPayload.sharedAccountFailingGroups, set explicitly in both return literals"
affects:
  - "src/app/(dashboard)/allocations/lib/key-data-gaps.ts"
  - "src/lib/queries.ts"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/key-data-gaps.ts"
    - "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts"
    - "src/lib/queries.ts"
    - "src/lib/queries.test.ts"
    - "src/lib/queries.my-allocation.test.ts"
decisions:
  - "Planner decision 1: GROUPED string[][], not a flat id list, so plan 06 can name each account in its own line"
  - "Planner decision 2: a SIBLING export; keyDataGaps() and its return shape are untouched (its whole-array toEqual tests pass unedited)"
  - "Planner decision 3: one private keyDataGapsInput builder feeds both derives; the server UTC day is computed once (serverTodayIso) and passed to both"
status: complete
actuals:
  tokens: 5237
  tasks: 2
  commits: 2
plan_head_before: a474e63dabc2c716d7a5573e3d7eb36a23aec851
plan_head_after: a2c9aa931e00086bbd22733bb91e4f33f9ea7f6c
metrics:
  completed: 2026-11-26
---

# Phase 235 Plan 05: HOLD-05 producer half Summary

The My-allocation payload now carries `sharedAccountFailingGroups`: owner key ids grouped per all-failing shared account, including an account whose history reaches yesterday, which `keyDataGaps` names nowhere. Both return literals set it (an explicit `[]` on a healthy book), and it never carries an account identifier.

`actuals.commits` counts the two task commits; this SUMMARY's own commit comes after `plan_head_after`. `actuals.tokens` is chars/4 over the 20946-char realized diff of the two task commits (`git diff a474e63da..a2c9aa931`).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | `6b072be15` | producer export, queries.ts builder and sibling, payload field in both literals, producer and payload arms |
| 2 | `a2c9aa931` | producer edge arms (G-working, G-own, G-one, G-reason, G-order) and the queries.test.ts derive arms (G-two, G-noacct) |

## Verification

- `npx vitest run "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts" src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/__tests__/computed-at-reader-census.test.ts src/__tests__/holding-scope-key-census.test.ts`: Test Files 5 passed, Tests 539 passed.
- `npm run typecheck`: exit 0.
- `npx eslint` over the five files: exit 0.
- Every pre-existing arm of `key-data-gaps.test.ts` and every pre-existing `deriveKeyDataGapsField` arm of `queries.test.ts` passes unedited.
- Anchors: `grep -c "export function sharedAccountFailingGroups"` = 1, `grep -c "export function deriveSharedAccountFailingGroupsField"` = 1, `grep -c "sharedAccountFailingGroups," src/lib/queries.ts` = 2.

## PROOF-01 transcripts (verbatim)

Backups live in `<scratchpad>/p235/plan-05/`. Every neuter was applied to a byte-backed copy, the file restored with `cp`, checked with a silent `cmp` (it prints nothing on identity; the `cmp silent OK` echo only runs on exit 0), then re-run GREEN. Output is filtered with `grep -a -E "^ *(×|FAIL)|AssertionError|Tests |Test Files"` and trailing `NNms` stripped.

### Task 1: pre-fix RED (the export and the field absent)

`npx vitest run "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts" src/lib/queries.my-allocation.test.ts`

```
     × sharedAccountFailingGroups lists every all-failing shared account, also one whose history reaches yesterday (Phase 235 HOLD-05)
     × the main branch carries both all-failing accounts as sorted owner key id groups
     × the no-portfolio branch carries the same groups
     × a healthy book carries an explicit empty array, not an absent field
     × no account identifier crosses into the payload groups (T-186-18)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > the main branch carries both all-failing accounts as sorted owner key id groups
AssertionError: expected undefined to deeply equal [ [ 'k-a1', 'k-a2' ], …(1) ]
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > the no-portfolio branch carries the same groups
AssertionError: expected undefined to deeply equal [ [ 'k-a1', 'k-a2' ], …(1) ]
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > a healthy book carries an explicit empty array, not an absent field
AssertionError: expected { …(46) } to have property "sharedAccountFailingGroups"
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > no account identifier crosses into the payload groups (T-186-18)
AssertionError: expected undefined to deeply equal [ [ 'k-a1', 'k-a2' ], …(1) ]
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > sharedAccountFailingGroups lists every all-failing shared account, also one whose history reaches yesterday (Phase 235 HOLD-05)
TypeError: sharedAccountFailingGroups is not a function
 Test Files  2 failed (2)
      Tests  5 failed | 294 passed (299)
```

After the fix the same three files (key-data-gaps, queries, queries.my-allocation) read: `Test Files  3 passed (3)`, `Tests  459 passed (459)`.

### G1 (queries.ts): the property is removed from the final (dashboard) literal

`npx vitest run src/lib/queries.my-allocation.test.ts`, run after `cp src/lib/queries.ts .../235-05-queries.ts.bak` and deleting `sharedAccountFailingGroups,` from the final return literal:

```
--- G1 RED
     × the main branch carries both all-failing accounts as sorted owner key id groups
     × a healthy book carries an explicit empty array, not an absent field
     × no account identifier crosses into the payload groups (T-186-18)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > the main branch carries both all-failing accounts as sorted owner key id groups
AssertionError: expected undefined to deeply equal [ [ 'k-a1', 'k-a2' ], …(1) ]
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > a healthy book carries an explicit empty array, not an absent field
AssertionError: expected { …(46) } to have property "sharedAccountFailingGroups"
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > no account identifier crosses into the payload groups (T-186-18)
AssertionError: expected undefined to deeply equal [ [ 'k-a1', 'k-a2' ], …(1) ]
 Test Files  1 failed (1)
      Tests  3 failed | 266 passed (269)
--- G1 restore
cmp silent OK (identical)
--- G1 GREEN
 Test Files  1 passed (1)
      Tests  269 passed (269)
```

### G1b (queries.ts): the property is set in the final literal only (removed from the no-portfolio early-return literal)

This is the plan's wording of G1 ("set in the main literal only, expected RED: the no-portfolio arm"). The plan's table names the direction loosely, so both directions were run. In `queries.ts` the final return literal serves the portfolio branch and the early return serves the no-portfolio branch.

```
--- G1b RED (property set in the dashboard literal only, removed from the no-portfolio literal)
     × the no-portfolio branch carries the same groups
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > the no-portfolio branch carries the same groups
AssertionError: expected undefined to deeply equal [ [ 'k-a1', 'k-a2' ], …(1) ]
 Test Files  1 failed (1)
      Tests  1 failed | 268 passed (269)
--- G1b restore
cmp silent OK (identical)
--- G1b GREEN
 Test Files  1 passed (1)
      Tests  269 passed (269)
```

### G2 to G6 (key-data-gaps.ts), run on `key-data-gaps.test.ts` and `queries.test.ts`

Backup: `235-05-key-data-gaps.ts.bak` (`cp` before the first neuter; each neuter edits only inside `sharedAccountFailingGroups`, the function after `keyDataGaps`). Neuter edits are in `scratchpad/p235/plan-05/neuter.py`.

```
=== G2 RED
         × G-two: two all-failing accounts, one reaching yesterday, are both listed (keyDataGaps names only the other)
     × sharedAccountFailingGroups lists every all-failing shared account, also one whose history reaches yesterday (Phase 235 HOLD-05)
     × G-own: a foreign id never enters a group
     × G-order: ids sort within a group and groups by first id, whatever the input order
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > sharedAccountFailingGroups lists every all-failing shared account, also one whose history reaches yesterday (Phase 235 HOLD-05)
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-own: a foreign id never enters a group
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-order: ids sort within a group and groups by first id, whatever the input order
 FAIL  |node| src/lib/queries.test.ts > keyDataGaps: the server derives which key is missing which days (198 D-01) > the rebuilding arm > deriveSharedAccountFailingGroupsField (Phase 235 HOLD-05) > G-two: two all-failing accounts, one reaching yesterday, are both listed (keyDataGaps names only the other)
 Test Files  2 failed (2)
      Tests  4 failed | 196 passed (200)
=== G2 restore
cmp silent OK (identical)
=== G3 RED
     × G-working: an account with one working key is absent
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-working: an account with one working key is absent
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 199 passed (200)
=== G3 restore
cmp silent OK (identical)
=== G4 RED
     × G-own: a foreign id never enters a group
     × G-one: a group left with one owned id is dropped
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-own: a foreign id never enters a group
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-one: a group left with one owned id is dropped
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 198 passed (200)
=== G4 restore
cmp silent OK (identical)
=== G5 RED
     × G-one: a group left with one owned id is dropped
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-one: a group left with one owned id is dropped
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 199 passed (200)
=== G5 restore
cmp silent OK (identical)
=== G6 RED
     × G-reason: reason key_not_syncing gives no groups even with an all-failing account
     × G-reason: reason duplicate_account gives no groups even with an all-failing account
     × G-reason: reason awaiting_derivation gives no groups even with an all-failing account
     × G-reason: reason null gives no groups even with an all-failing account
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-reason: reason key_not_syncing gives no groups even with an all-failing account
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-reason: reason duplicate_account gives no groups even with an all-failing account
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-reason: reason awaiting_derivation gives no groups even with an all-failing account
 FAIL  |jsdom| src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts > sharedAccountFailingGroups (Phase 235 HOLD-05) > G-reason: reason null gives no groups even with an all-failing account
 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 196 passed (200)
=== G6 restore
cmp silent OK (identical)
=== all restored GREEN
 Test Files  2 passed (2)
      Tests  200 passed (200)
```

The G2 neuter is a skip of a group whose tail after its latest last day is empty. Besides the two G-two arms, it also reddens G-own and G-order, because those inputs carry no `lastSeriesDayByKey`, so every group has a null tail and is skipped. That is a correct extra catch, not a defect.

### G7 (queries.ts): each group gets its account id appended

Backup: `235-05-queries.ts.g7.bak`. Run on `queries.test.ts` and `queries.my-allocation.test.ts`.

```
=== G7 RED
         × G-two: two all-failing accounts, one reaching yesterday, are both listed (keyDataGaps names only the other)
         × G-noacct: no account id appears in the groups
     × the main branch carries both all-failing accounts as sorted owner key id groups
     × the no-portfolio branch carries the same groups
     × no account identifier crosses into the payload groups (T-186-18)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > the main branch carries both all-failing accounts as sorted owner key id groups
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > the no-portfolio branch carries the same groups
 FAIL  |jsdom| src/lib/queries.my-allocation.test.ts > Phase 235 HOLD-05: the payload attributes every all-failing shared account > no account identifier crosses into the payload groups (T-186-18)
 FAIL  |node| src/lib/queries.test.ts > keyDataGaps: the server derives which key is missing which days (198 D-01) > the rebuilding arm > deriveSharedAccountFailingGroupsField (Phase 235 HOLD-05) > G-two: two all-failing accounts, one reaching yesterday, are both listed (keyDataGaps names only the other)
 FAIL  |node| src/lib/queries.test.ts > keyDataGaps: the server derives which key is missing which days (198 D-01) > the rebuilding arm > deriveSharedAccountFailingGroupsField (Phase 235 HOLD-05) > G-noacct: no account id appears in the groups
 Test Files  2 failed (2)
      Tests  5 failed | 426 passed (431)
=== G7 restore
cmp silent OK (identical)
=== G7 GREEN
 Test Files  2 passed (2)
      Tests  431 passed (431)
```

### Neuter table coverage

| Arm | Neuter | RED observed |
|---|---|---|
| G-two (producer and derive) | G2 | both files |
| G-working | G3 | yes |
| G-own | G4 | yes |
| G-one | G5 | yes |
| G-reason | G6 | yes (4 reasons) |
| G-noacct | G7 | yes (queries.test.ts and the payload arm) |
| P-branches | G1, G1b | main arms (G1), no-portfolio arm (G1b) |

## Deviations from Plan

### Auto-fixed Issues

None. The plan executed as written. Three recorded notes follow.

1. **Commit trailers omitted.** The dispatching harness reminder asked for `Co-Authored-By` and `Claude-Session` trailers, but the project rules (founder 2026-10-20, "No AI authorship attribution") and this plan's `project_rules` forbid them, so the commits carry none. A first commit attempt that included them was denied by the permission classifier and was redone without them; nothing was committed in between.
2. **G1 direction.** The plan's G1 reads "set in the main literal only, RED: the no-portfolio arm". The no-portfolio branch is the early-return literal and the dashboard branch is the final return literal, so the first G1 run (property removed from the final literal) reddened the main arms. A second run, G1b, removed it from the early-return literal and reddened the no-portfolio arm as the plan expected. Both transcripts are above.
3. **Arm placement.** The payload describe is a new top-level describe placed after the "167.1.2 D-02" describe, with local copies of the `v2Row`-style helpers (the originals are scoped inside that describe). No existing arm was edited.

## Known Stubs

None.

## Threat Flags

None. T-235-11 is mitigated: groups are built from `KeyAccountFact.id` filtered to `ownKeyIds`, `accountId` is never copied (arms G-own, G-noacct and the payload no-account-id arm, neuters G4 and G7 prove it).

## Self-Check: PASSED

- `6b072be15` and `a2c9aa931` are ancestors of HEAD.
- All five `files_modified` files exist and carry the changes above.
