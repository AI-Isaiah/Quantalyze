---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 04
subsystem: strategy-ui
tags: [rename, d-09, route-10, lean-04, factsheet, strategies-list]
requires: [200-03, 200-05, 200-12]
provides:
  - "Rename… exists only on the edit page (StrategyNameBlock); the factsheet header and the strategies list carry none"
affects:
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/app/(dashboard)/strategies/StrategiesSection.tsx
key-files:
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.returns-unit.test.tsx
    - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.visibility.test.tsx
    - src/components/strategy/StrategyTable.owner-list.test.tsx
    - src/components/strategy/StrategyTable.manager-rows.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-default-mounts.json
    - src/components/strategy/__fixtures__/strategy-table-owner-list-mounts.json
    - src/app/(dashboard)/strategies/StrategiesSection.tsx
    - src/app/(dashboard)/strategies/StrategiesSection.test.tsx
    - src/app/(dashboard)/strategies/page.merged.test.tsx
decisions:
  - "D-09 taken as written: Rename removed, not turned into a link."
  - "No other behaviour read renameTarget; ownerShare already has its own input (the owner lane), so nothing needed a new input."
  - "Task 3 committed before Task 2 so every commit typechecks."
status: complete
requirements: [ROUTE-10, LEAN-04]
plan_head_before: 95af12c315c19875cc9c774e3894f1effd878a6e
plan_head_after: 669eabfeb39dd42a4ef0e54a9492e52480fc6902
commits: 3
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
---

# Phase 200 Plan 04: Rename leaves the factsheet and the strategies list Summary

The factsheet header, the shared strategy table and the strategies section no longer offer `Rename…`, so `StrategyNameBlock` on the edit page (plan 03) is the only non-test mount of `RenameStrategyDialog`.

## Tasks and commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 6821f21c0 | `FactsheetView`: removed the `Rename…` button, the `RenameStrategyDialog` import and mount, `renameOpen` state, and `renameTarget` through `FactsheetView`, `FactsheetShell`, `FactsheetBody`, `FactsheetHeader` and `OwnerLaneProps`; `v2/page.tsx` no longer builds it |
| 3 | 18d9e0e08 | `StrategiesSection`: rename state, `onRename` pass-through and dialog mount removed |
| 2 | 669eabfeb | `StrategyTable`: `onRename`, `isRenameable` and the button removed; both mount goldens hand-edited |

## What I found about `renameTarget` (D-09, T-200-11)

Only comments read `renameTarget` besides the rename button and dialog. The owner-share gate (`ownerShare`, SHARE-04) is keyed on `lane === "owner"` in `page.tsx` and its own `ownerShare` prop; it never read `renameTarget`. So nothing needed a replacement input, and the owner-notice and share-affordance tests stayed green with no change to ownership gating. Comments that said "the same free gate `renameTarget` rides" now point at the owner lane directly. Behaviour change worth stating: an owner-lane masthead with no `returnsUnit` now renders the bare `<h1>` (it used to render the flex wrapper only to hold the Rename button); with a unit it renders the same wrapper as before.

`display-sign-single-source.test.ts` needed no change: its `FactsheetView.tsx` pins (R5 3, R6 4) did not move.

## Tests

No test was added as a new file; existing tests were rewritten to assert absence.

- `FactsheetView.owner-notice.test.tsx`: Rename tests replaced by `an owner sees NO Rename… on the factsheet and no rename dialog is mounted` (1 rewritten, 1 trimmed).
- `focus-ring-clipproof.test.tsx`: the Rename ring describe replaced by an owner-masthead absence test (1 rewritten).
- `FactsheetView.returns-unit.test.tsx`: owner-arm ordering test now H1 then chip, no Rename (1 rewritten).
- `page.owner-lane.test.tsx`: cases 12, 13, 15, 16 assert no `renameTarget` prop on any lane (4 touched).
- `StrategyTable.visibility.test.tsx`: unmarked-private case asserts no Rename; D-17 case replaced by `D-09 - no row of any status renders Rename…` (private, draft, published, with a stale `onRename` passed through an untyped spread); ring test now covers the Mark action only (3 touched, 1 new).
- `StrategyTable.owner-list.test.tsx`: draft and note-only orders no longer end in Rename; `renderList` passes a stale `onRename` through an untyped spread (3 touched).
- `StrategyTable.manager-rows.test.tsx`: the non-managerRows non-vacuity render passes a stale `onRename` and asserts no Rename (1 touched, outside the plan's file list, see Deviations).
- `StrategyTable.default-mounts.test.tsx`: four `onRename` props removed (outside the plan's file list).
- `StrategiesSection.test.tsx` and `page.merged.test.tsx`: no `onRename` handed to the table in any role; no role sees `Rename…` on the list; Change mark assertions kept.

## RED evidence

Backups are byte copies in `<scratchpad>/p200-bak/04/` (`200-04-FactsheetView.tsx.bak`, `200-04-v2-page.tsx.bak`, `200-04-StrategyTable.tsx.bak`, `200-04-StrategiesSection.tsx.bak`). Each restore was `cp` then `cmp` exit 0; final `git status` shows only intended changes.

- gc-200-04-neuter: `FactsheetView.tsx` and `v2/page.tsx` | inserted a bare `<button>Rename…</button>` in the masthead and re-threaded `renameTarget` from the page | 7 failed: `AssertionError: the factsheet must not offer Rename…: expected <button type="button"></button> to be undefined` (owner-notice), `the owner masthead must not offer Rename…` (focus-ring), `expected 'Unpublished — only you can see thisTh…' not to contain 'Rename'` (returns-unit owner lane), `expected { payload: ..., ...(6) } to not have property "renameTarget"` (owner-lane cases 12, 15, 16), plus the public-masthead zero-node case | restored, `cmp` 0 on both, 100/100 then 120 files / 1645 tests GREEN.
- gc-200-04-neuter: `StrategyTable.tsx` | replaced with `git show HEAD:` (the pre-removal table, read-only) | 3 failed: `owner-list ... a draft row reads Edit, actions, Mark ownership and no Rename ...: expected [ 'Mark ownership…', 'Rename…' ] to deeply equal [ 'Mark ownership…' ]`, the note-only owner-list case, and `D-09 - no row of any status renders Rename…: expected <button type="button" …(1)></button> to be null`; a second run: `manager-rows ... renders no Simulate Impact, Mark ownership or Rename` RED | restored, `cmp` 0, 17 files / 320 tests GREEN.
- gc-200-04-neuter: `StrategiesSection.tsx` | replaced with `git show HEAD:` | `AssertionError: expected { strategies: [], …(12) } to not have property "onRename"` | restored, `cmp` 0.
- gc-200-04-neuter: `StrategiesSection.tsx` plus `StrategyTable.tsx` both at HEAD | the merged list shows Rename again | `AssertionError: allocator: no Rename on the list: expected <button type="button" …(1)></button> to be null` (`page.merged.test.tsx`) | both restored, `cmp` 0 on each, strategies dir plus components/strategy: 112 files / 2246 tests GREEN.

## Gates

- `npx tsc --noEmit -p .`: pass (no output).
- `npx eslint` over every changed source and test file: pass, 0 problems (one unused `fireEvent` import I created was removed).
- vitest: v2 directory 120 files / 1645 tests; `src/app/(dashboard)/strategies/` plus `src/components/strategy/` 112 files / 2246 tests; neighbours (`phase-149-my-strategies-parity`, `phase-150-capital-ownership-invariant`, `trim-removed-surfaces`, `phase-52-container-tabular-nums`, `degrade-warning-scan`, `figure-gate-census`, `my-strategies-retired`, `one-strategy-page-links`, `display-sign-single-source`) 9 files all green. `RenameStrategyDialog.test.tsx` green.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 7 claims.
- Single-mount check: `grep -a -rlF '<RenameStrategyDialog' src | grep -av '\.test\.'` prints only `src/components/strategy/StrategyNameBlock.tsx`.
- Acceptance greps (comment-stripped): `RenameStrategyDialog` in `FactsheetView.tsx` 0, `renameTarget` in `v2/page.tsx` 0, `onRename` in `StrategyTable.tsx` 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tests outside `files_modified` read the removed prop**
- **Found during:** Task 1 and Task 2 grep for `renameTarget` / `onRename`.
- **Issue:** `FactsheetView.returns-unit.test.tsx`, `page.owner-lane.test.tsx`, `StrategyTable.manager-rows.test.tsx` and `StrategyTable.default-mounts.test.tsx` passed or asserted the removed props; they would fail typecheck or assert the removed control.
- **Fix:** updated them as listed under Tests. The two mount goldens were edited by hand (only the Rename button elements removed: 3 hunks in the default-mounts fixture, 4 in the owner-list fixture); the goldens match the table's real output, which is the confirmation.
- **Commits:** 6821f21c0, 669eabfeb.

**2. [Ordering] Task 3 committed before Task 2**
- `StrategiesSection` must stop passing `onRename` before the table drops the prop, or the intermediate commit fails `tsc`. No content change to either task.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; the change only removes UI.

## Self-Check: PASSED

Commits 6821f21c0, 18d9e0e08 and 669eabfeb are ancestors of HEAD; every file listed under key-files exists; the single-mount check passes; STATE.md and ROADMAP.md are untouched.
