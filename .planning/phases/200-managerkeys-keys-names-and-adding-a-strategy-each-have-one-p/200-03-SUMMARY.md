---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 03
subsystem: strategy-edit
tags: [rename, public-name-preview, d-09, d-10, d-11]
requires: []
provides:
  - publicNamePreview (src/lib/strategy-display.ts)
  - StrategyNameBlock (edit-page rename place)
  - RenameStrategyDialog publicNote prop
affects:
  - src/app/factsheet/[id]/v2/page.tsx (title name)
tech-stack:
  added: []
  patterns: [one helper shared by the public surface and the preview of it]
key-files:
  created:
    - src/components/strategy/StrategyNameBlock.tsx
    - src/components/strategy/StrategyNameBlock.test.tsx
  modified:
    - src/lib/strategy-display.ts
    - src/lib/strategy-display.test.ts
    - src/app/(dashboard)/strategies/[id]/edit/page.tsx
    - src/app/(dashboard)/strategies/[id]/edit/page.test.tsx
    - src/components/strategy/RenameStrategyDialog.tsx
    - src/components/strategy/RenameStrategyDialog.test.tsx
    - src/app/factsheet/[id]/v2/page.tsx
decisions:
  - "Rename control gated by an includes check over [private, draft]; any other status is read-only with the D-10 sentence."
  - "The dialog hint is the host's publicNote only; with no note it shows no hint rather than a claim it cannot back."
requirements: [ROUTE-10, LEAN-04]
status: complete
plan_head_before: c83dc7a2d0fa9324146a77e9a23053b82666e18b
plan_head_after: c24944fa4d233fe2797f1cdbe048187d6ce51db1
commits: 2
actuals:
  tokens: 21000
  tasks: 2
  commits: 2
---

# Phase 200 Plan 03: One rename place with a public-name preview Summary

The strategy edit page now has a name block that renames through the existing `PATCH /api/strategies/[id]/name` dialog only while a strategy is private or a draft, shows the name read-only with the D-10 reason otherwise, and states what the public sees via `publicNamePreview`, the same helper the factsheet page title now calls.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | Edit page name block with the public-name preview | 5118aecfa |
| 2 | Dialog hint and factsheet title read the same helper | c24944fa4 |

## What changed

- `publicNamePreview(strategy)` returns `{ factsheet, discovery }`: `factsheet = name ?? codename ?? displayStrategyName(strategy)` (the factsheet title chain), `discovery = displayStrategyName(strategy)`.
- `StrategyNameBlock` (client) renders the name, `Rename…` only for `private`/`draft`, the D-10 sentence otherwise, and two preview lines worded by status (published: public factsheet / discovery shows other signed-in viewers; otherwise: shared factsheet link / discovery once published). It is mounted above `StrategyForm` with the preview computed server-side.
- `RenameStrategyDialog` takes an optional `publicNote` used as the field hint; the hard-coded "Only you see this name. Public surfaces keep showing the codename." is gone. The block passes the preview's factsheet line.
- `factsheet/[id]/v2/page.tsx`: the `generateMetadata` name now comes from `publicNamePreview(...).factsheet` (miss still gives `Strategy`). The H1 payload and `displayStrategyName` disclosure are untouched.
- The empty/whitespace-name case already existed in `RenameStrategyDialog.test.tsx` (`empty after trim`, no fetch, CTA clickable) and stays green.

## RED evidence

All neuters applied to the working file after a byte backup in `/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/b1f09c72-b6ca-45a1-8fe3-842b3f8b655b/scratchpad/p200-bak/03/`, restored with `cp`, then `cmp` exit 0 and the test re-run GREEN.

- gc-200-03-neuter: status gate. `StrategyNameBlock.tsx`, `const canRename = RENAMEABLE_STATUSES.includes(status)` replaced with `const canRename = true`. RED: 3 failed (published, pending_review, archived): `expected document not to contain element, found <button`. Restored, cmp=0, 9/9 green.
- gc-200-03-neuter: page preview. `edit/page.tsx`, `preview={publicNamePreview(strategy)}` replaced with `{ factsheet: strategy.name, discovery: strategy.name }`. RED: 2 failed, `-"discovery": "Orion"` / `+"discovery": "Helios alpha sleeve"` and `Strategy #13f7b07f` vs `Alpha Centauri`. Restored, cmp=0, 23/23 green.
- gc-200-03-neuter: retired hint. `RenameStrategyDialog.tsx`, `hint={publicNote}` replaced with `hint={publicNote ?? "<old codename sentence>"}`. RED: `D-11: the retired codename sentence is nowhere in the render` failed, `expected 'Rename strategyNameOnly you see this …' not to contain 'Only you see this name. Public surfac…'`. Restored, cmp=0.
- gc-200-03-neuter: title through the helper. `factsheet/[id]/v2/page.tsx`, `.factsheet` replaced with `.discovery` in the title. RED (existing `page.metadata.test.tsx`): `expected 'Strategy #s1 factsheet' to be 'Alpha factsheet'`. Restored, cmp=0.
- gc-200-03-neuter: preview hint hand-off. `StrategyNameBlock.tsx`, deleted the `publicNote={factsheetLine}` line. RED: `expected [ <p …(1)></p> ] to have a length of 2 but got 1`. Restored, cmp=0.
- `publicNamePreview` unit cases were first run before the helper existed: 4 failed, then 12/12 green once it was added.

## Gates

- `npx tsc --noEmit -p .`: pass
- vitest (13 files, 568 tests, all passed): `strategy-display.test.ts`, `StrategyNameBlock.test.tsx`, `edit/page.test.tsx`, `RenameStrategyDialog.test.tsx`, `visibility.test.ts`, `wizardErrors.roster-render.test.tsx`, `wizardErrors.test.ts`, `dialog-envelope.invariant.test.ts`, name `route.test.ts`, factsheet v2 `page.metadata.test.tsx`, `page.public-cache-key.test.tsx`, `FactsheetView.owner-notice.test.tsx`, `focus-ring-clipproof.test.tsx`
- eslint on every changed file: pass
- Acceptance: `grep -a -c 'export function publicNamePreview' src/lib/strategy-display.ts` = 1; `<StrategyNameBlock` in the edit page = 1; the codename-sentence grep over non-test `src` prints nothing; `publicNamePreview(` in the factsheet page = 2 (comment and call).

## Deviations from Plan

- The block does not call `router.refresh()` itself: `RenameStrategyDialog` already refreshes on a successful save and exposes no `onRenamed` prop, so a second refresh would be redundant.
- `edit/page.test.tsx` mocks `StrategyNameBlock` and asserts its props (the page-level contract), the same pattern it uses for `ApiKeyManager`, rather than rendering the real block, because its `next/navigation` mock has no `useRouter`.
- The "no codename claim" render assertion for the dialog lives in `RenameStrategyDialog.test.tsx` (Task 2), not in `StrategyNameBlock.test.tsx` for Task 1, because it can only pass once the dialog hint changes; the block test keeps one dialog-hand-off case added in Task 2.

## Known limits (recorded, not fixed)

- The two other `RenameStrategyDialog` mounts (`StrategiesSection`, `FactsheetView`) pass no `publicNote`, so their dialog now shows no hint. Plan 04 removes those mounts.
- An owner can still write `name` or `api_key_id` through raw PostgREST; closing that needs a migration (out of scope, per the plan).
- Edge ROUTE-10 encoding: length is still measured as the name route measures it (trimmed JS string length against `MAGNITUDE_CAPS.MAX_NAME_CHARS`); not edited here.

## Known Stubs

None.

## Threat Flags

None. No package installed, no new endpoint, no schema change.

## Self-Check: PASSED

- Files exist: StrategyNameBlock.tsx, StrategyNameBlock.test.tsx, this SUMMARY.
- Commits 5118aecfa and c24944fa4 are ancestors of HEAD.
- STATE.md and ROADMAP.md untouched.
