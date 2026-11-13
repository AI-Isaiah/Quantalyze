---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 07
subsystem: ui
tags: [strategy-table, owner-list, furniture, goldens, tdd]
requires: ["199-02"]
provides:
  - "StrategyTable allocatorFurniture prop; optional managerRows entry fields (editHref, actions, note)"
  - "StrategyTable.owner-list.test.tsx and three owner-list goldens (strategy-table-owner-list-mounts.json)"
affects: [199-09, 199-10]
tech-stack:
  added: []
  patterns: ["furniture decided by server-built props, not by a mode flag", "one simulateImpact node placed by the Actions cell"]
key-files:
  created:
    - src/components/strategy/StrategyTable.owner-list.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-owner-list-mounts.json
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
key-decisions:
  - "managerRows stays the owner-list switch (Status and Created columns, no in-name badge, note row, showExamples); allocatorFurniture re-enables tag, Mark/Change mark, Rename and Simulate Impact inside it"
  - "Mark and Rename are gated on allocatorFurniture in owner-list mode too, so a manager-only list shows no allocator control even when the mount passes the callbacks (T-199-11)"
  - "Simulate Impact is built once (simulateImpact) with the published guard directly before the mount; both the owner-list cell and the public inline mount place that node"
status: complete
metrics:
  duration: ~35m
  completed: 2026-11-10
actuals:
  tokens: 26000
  tasks: 2
  commits: 2
plan_head_before: 1060e1f20c106eefa3babaa2d288c19ee1a12a49
plan_head_after: 9de5889d60990441030a6eb0bf44a9bad0f3b679
---

# Phase 199 Plan 07: Owner-list table furniture Summary

One owner-list table row now carries manager furniture, allocator furniture or both: `allocatorFurniture` gates the allocator controls, and the managerRows entry's `editHref`, `actions` and `note` are each optional, so the server decides the furniture per row.

## Commits

- b0444949c: Task 1 (tracer), `allocatorFurniture` prop, optional entry fields, one flex-nowrap Actions cell (Edit, actions, Mark/Change mark, Rename, Simulate Impact), private `rowChipStatus` deleted and imported from `src/lib/strategy-health.ts`, tracer test file
- 9de5889d6: Task 2, three owner-list goldens (manager only, allocator only, both) in a new fixture, pinned from `StrategyTable.default-mounts.test.tsx` by added lines only

BASE (plan start) = 1060e1f20c106eefa3babaa2d288c19ee1a12a49.

## What changed in the table

- `managerRows` entry type: `{ editHref?: string; actions?: ReactNode; note?: ReactNode }` (was editHref and actions required).
- New optional prop `allocatorFurniture` (default false). In owner-list mode it re-enables `OwnershipTag`, Mark ownership or Change mark, Rename (private and draft only, the D-17 server gate) and Simulate Impact (published only). Without `managerRows` it changes nothing.
- The Actions cell, owner-list mode: Edit (when the entry has `editHref`), the entry's `actions`, `ownerRowActions`, then `simulateImpact`, all inside the existing `flex flex-nowrap ... whitespace-nowrap` container.
- Public mounts (no `managerRows`): the cell renders `ownerRowActions` then `simulateImpact` inline as before; `mr-3` on the owner-actions span is kept there and dropped in owner-list mode (the flex gap spaces the controls).
- Parity pins kept: the literal `const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;` is untouched, and `s.status === "published"` sits directly before the first `<SimulateImpactButton` (pin 7 passes).
- `rowChipStatus` has one home: `grep -a -c "function rowChipStatus" src/components/strategy/StrategyTable.tsx` prints 0, and the table imports it from `@/lib/strategy-health` (199-02).

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 6 claims, exit 0
- Task 1 RED seen first: 4 of 6 owner-list tests failed (no Edit-less entry support, no `allocatorFurniture`), then GREEN.
- `npx vitest run src/components/strategy src/__tests__/phase-149-my-strategies-parity.test.ts`: 61 files, 1187 tests passed (the three public goldens in `StrategyTable.default-mounts.test.tsx` are among them and unchanged)
- `npx tsc --noEmit -p .`: exit 0, no output
- `npx eslint` on `StrategyTable.tsx`, `StrategyTable.owner-list.test.tsx`, `StrategyTable.default-mounts.test.tsx`: exit 0, no output
- `git diff 1060e1f20..HEAD -- src/components/strategy/StrategyTable.default-mounts.test.tsx`: 87 insertions, 0 deletions (no existing pinned line removed); the existing fixture `strategy-table-default-mounts.json` is not touched.
- Acceptance greps: `allocatorFurniture` count in the table = 7 (needs at least 2).

gc-199-07-neuter: the old either-or restored (`ownerRowActions` rendered only when the entry has no `editHref`) on a `cp` byte backup: RED, 2 failed in `StrategyTable.owner-list.test.tsx` (published row `Edit, actions, Change mark…, simulate`, draft row `Edit, actions, Mark ownership…, Rename…`); restored, `cmp` identical.
gc-199-07-neuter: the allocator gate dropped (`const allocatorControls = true`) on the same backup: RED, 2 failed (this file's `manager only` case and `StrategyTable.manager-rows.test.tsx`'s `renders no Simulate Impact, Mark ownership or Rename`); restored, `cmp` identical.
gc-199-07-neuter: the either-or again, run against the goldens: RED, 5 failed (the 2 role tests plus manager only, allocator only and both goldens; the crude edit also added a stray JSX text node, so the manager-only and allocator-only goldens failed for that reason as well as the union one); restored, `cmp` identical, backups deleted.
gc-199-07-gates: vitest=green tsc=clean

SQL checks: none apply (TS-only plan); nothing left to CI beyond the normal frontend gates.

## Deviations from Plan

**1. [Clarification] The plan's tracer behaviour line lists Rename in a published row's Actions cell; no such row exists.** The table gates Rename to private and draft rows (D-17, mirroring the server's UPDATE filter) and Simulate Impact to published rows, so the two never share a row. I kept both gates, which is what the plan's own `ownerRowActions` text and the prior phase require. The tests pin the order per row kind instead: published `Edit, actions, Change mark…, Simulate Impact`; draft and private `Edit, actions, Mark ownership…, Rename…`. The relative order Mark, Rename, Simulate holds wherever they coexist.

**2. [Rule 3 - Blocking] New fixture file not named in files_modified.** The plan lists three goldens "in `StrategyTable.default-mounts.test.tsx`" but the whole-markup strings live in a JSON fixture (the file's own header forbids regenerating it and says it is edited only by hand-classified hunks). To add goldens "without editing the existing ones" I created `src/components/strategy/__fixtures__/strategy-table-owner-list-mounts.json` and added a new `describe` block to the test. The goldens were generated once by a scratch run (outside the repo), reviewed at the Actions-cell level for each mode (manager only: Edit and slot on three rows, no tag, no Simulate, no note; allocator only: tag once, Change mark and Simulate on the published row, Mark and Rename on the others, three notes, no Edit; both: the union on every row, one note), then written to the fixture. The test has no write or update path.

**3. [Rule 2 - Correctness, T-199-11] Mark and Rename are also gated on `allocatorFurniture` in owner-list mode.** The plan's mitigation says allocator controls must not appear on a manager-only list; at HEAD they were suppressed by the either-or cell, which this plan removes. Gating `ownerRowActions` on `!managerRows || allocatorFurniture` keeps that guarantee even when a mount passes `onMarkOwnership` or `onRename`. Pinned by the manager-only test and golden.

**4. [Refactor within the task] `simulateImpact` is built once.** Instead of two `<SimulateImpactButton` mounts (owner-list cell and public inline), one `simulateImpact` node carries the published guard directly before the mount (pin 7) and both places render it. Public mount output is unchanged (the three public goldens pass).

## Known Stubs

None.

## Threat Flags

None. The only new surface is a boolean prop on a client component; T-199-11 is mitigated and tested (manager-only and allocator-only cases).

## Self-Check: PASSED

- `src/components/strategy/StrategyTable.owner-list.test.tsx`: found
- `src/components/strategy/__fixtures__/strategy-table-owner-list-mounts.json`: found
- b0444949c and 9de5889d6: ancestors of HEAD
