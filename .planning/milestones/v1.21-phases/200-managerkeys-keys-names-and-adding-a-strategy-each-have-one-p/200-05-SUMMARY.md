---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 05
subsystem: ui
tags: [strategies, wizard, nav, labels, LEAN-04]
requires: []
provides:
  - "one Add a strategy header control on /strategies, linking straight to /strategies/new/wizard"
  - "one sentence-case label (Add a strategy) on every add-a-strategy control"
affects: [strategies-page, sidebar, mobile-nav]
key-files:
  modified:
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/StrategiesEmptyState.tsx
    - src/components/layout/Sidebar.tsx
    - src/app/(dashboard)/strategies/page.merged.test.tsx
    - src/app/(dashboard)/strategies/page.wizard-draft-banner.test.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/components/layout/MobileNav.test.tsx
    - src/components/layout/DashboardChrome.test.tsx
decisions:
  - "D-12 taken as written: header Link to /strategies/new/wizard, empty-state create button removed, Resume/Revise links kept"
  - "D-13 / RESEARCH A5 recommended default: sentence case Add a strategy everywhere (DESIGN.md Voice wins over the older title-case label)"
status: complete
commits: 2
plan_head_before: c83dc7a2d0fa9324146a77e9a23053b82666e18b
plan_head_after: 6198a6ff8
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
requirements-completed: [LEAN-04]
---

# Phase 200 Plan 05: One entry point and one label for adding a strategy Summary

A manager now has exactly one control that starts a new strategy (the `/strategies` header `Add a strategy`, straight to `/strategies/new/wizard`), and every add-a-strategy control in the app reads the same sentence-case label.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 0628574ac | Header link `/strategies/new` -> `/strategies/new/wizard`, label `Add a strategy`; the manager empty state's `Create your first strategy` button and Link removed, replaced by `No strategies yet. Use Add a strategy above to start one.`; `degrade` id `strategies.empty` and the `Resume your draft` / `Resume draft` / `Revise & resubmit` links kept |
| 2 | 6198a6ff8 | `Add a strategy` in the allocator `StrategiesEmptyState` button and both `Sidebar.tsx` `label:` entries (desktop workspace item and the mobile filler); `add-strategy` action key and overlay wiring untouched; label assertions updated in `Sidebar`, `MobileNav` (including the anchored regexp) and `DashboardChrome` tests |

## Tests

New or rewritten in `page.merged.test.tsx` (1 new test, 5 assertions rewritten, 1 helper):
- helper `addStrategyControls()` counts links named `Add a strategy` plus buttons not nested in an anchor (the house style is a Link wrapping a Button, which is one control);
- manager populated, role both, and the union-row test: exactly one control, href `/strategies/new/wizard`;
- manager and both with nothing: exactly one control, no `Create your first strategy`, empty text points at the header control;
- NEW: manager with nothing but a draft: one header control, `Resume draft` still links to the wizard;
- allocator only: `Add a strategy` is a BUTTON and the title-case label is absent; allocator populated list shows zero such controls.

`page.wizard-draft-banner.test.tsx`: the no-draft case now asserts the pointing sentence and the absence of the old button. `page.key-pill.test.tsx` needed no edit (its only old-label assertion is a `not.toContain`, still true).

## RED evidence

gc-200-05-neuter: `src/app/(dashboard)/strategies/page.tsx` | backup `200-05-page.tsx.bak` | put the empty-state `<Link href="/strategies/new/wizard"><Button>Add a strategy</Button></Link>` back in the no-draft manager branch | `AssertionError: manager: exactly one control: expected [ <a>, <a> ] to have a length of 1 but got 2` (test `manager and both with nothing`) | restored with `cp`, `cmp` exit 0, test GREEN.

gc-200-05-neuter: `src/components/layout/Sidebar.tsx` and `StrategiesEmptyState.tsx` | backups `200-05-Sidebar.tsx.bak`, `200-05-EmptyState.tsx.bak` | restored the title-case `Add a Strategy` label in both `Sidebar.tsx` entries and the empty-state button | 13 tests failed across Sidebar/MobileNav/DashboardChrome/page.merged, e.g. `Unable to find an element with the text: Add a strategy` and `Unable to find an accessible element with the role "button" and name "Add a strategy"` | restored with `cp`, `cmp` exit 0 on both, GREEN.

(One earlier neuter attempt was discarded: the first helper counted a Button nested in a Link as a second control and also failed on the correct code. The helper was fixed to count the anchor-wrapped button once, and the RED proof was redone on the fixed helper; the evidence above is from that run.) `git diff --stat` after each restore showed no leftover neutering.

## Gates

- `npx tsc --noEmit -p .`: clean (no output)
- `npx vitest run src/components/layout "src/app/(dashboard)/strategies" src/__tests__/degrade-warning-scan.test.ts`: 58 files, 1203/1203 passed
- `npx eslint` on every changed source and test file: 0 problems
- Acceptance greps: `href="/strategies/new"` in non-comment `page.tsx` lines = 0; whole-src bare `/strategies/new` non-test source = 1 (the route-contract manifest redirect entry); `Create your first strategy` = 0 and `New Strategy` = 0 in non-comment `page.tsx`; title-case `Add a Strategy` in non-test, non-comment source = none; `grep -a -c 'Add a strategy' Sidebar.tsx` = 2
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 4 claims

## Deviations from Plan

None - plan executed exactly as written. Notes: `page.key-pill.test.tsx` was listed in files_modified but needed no change. Comments that still read `Add a Strategy` in `Sidebar.tsx`, `MobileNav.tsx`, `DashboardChrome.tsx`, `MobileSidebarDrawer.tsx` were left (the plan's gate excludes comments, and the plan scopes edits to rendered labels). `page.merged.test.tsx` carries one `queryByText("Add a Strategy")` toBeNull assertion on purpose: it pins that the title-case label is gone.

## Known Stubs

None.

## Threat Flags

None. The header link still renders only for `isManager`; the wizard route guard is unchanged (T-200-10 accepted); no package installed (T-200-SC).

## Self-Check: PASSED

- 0628574ac and 6198a6ff8 present on branch p200-plan-05.
- All modified files exist; STATE.md and ROADMAP.md untouched.
