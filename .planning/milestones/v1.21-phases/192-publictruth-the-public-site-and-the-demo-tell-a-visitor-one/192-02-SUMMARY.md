---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 02
subsystem: ui
tags: [demo, editorial-hero, d-08, null-removal, display-sign]
requires: []
provides:
  - "EditorialHero drops a null cell, label and all (D-08); plan 192-05 can pass null for an uncomputable /demo figure"
affects: [src/app/(marketing)/demo/page.tsx]
tech-stack:
  added: []
  patterns: ["conditional cell render instead of a dash placeholder"]
key-files:
  created: []
  modified:
    - src/components/portfolio/EditorialHero.tsx
    - src/components/portfolio/EditorialHero.test.tsx
    - src/components/portfolio/portfolio.signed-zero.test.tsx
key-decisions:
  - "MetricCell.value narrows to number; the muted-dash branch of metricValueClass is deleted as unreachable"
  - "No census edit: the R8 pin for EditorialHero.tsx and the R6 pin for the demo page did not move"
requirements-completed: [ROUTE-03]
status: complete
commits: 3
plan_head_before: b4cea75f389c8e58ac5604f850ebecebfa5555ae
plan_head_after: 1595f45cfee21af71093c56688276e8ea783c63f
actuals:
  tokens: 2500
  tasks: 2
  commits: 3
duration: 5 min
completed: 2026-11-06
---

# Phase 192 Plan 02: EditorialHero removes a null cell Summary

The /demo verdict block now renders a hero cell only for a non-null value, so an uncomputable figure disappears together with its label instead of printing a dash under the headline (D-08).

## What changed

- `EditorialHero.tsx`: each of the four `MetricCell`s is wrapped in `numbers.x != null &&`. `MetricCellProps.value` is now `number`. The null branch of `metricValueClass` (`text-text-muted`) was unreachable and is deleted. `hasAnyNumber`, the `grid-cols-2` class string, `formatSignedPercent` and `drawdownTone` are untouched. The docblock carries one new sentence stating the contract.
- `EditorialHero.test.tsx`: the "shows '—' for individual missing values" case is replaced by "removes a null cell, label and all (192 D-08)": no "BTC TWR", no "BTC drawdown", no "—", and exactly 2 dt and 2 dd.
- `portfolio.signed-zero.test.tsx`: "a missing drawdown stays muted" is replaced by "a missing drawdown cell is not rendered (192)": no dash, no "BTC drawdown" label, and "-3.42%" still carries `text-negative`.

## TDD record (Task 1, type tracer)

- **RED** (`9f19d1787`): the new case failed against HEAD's component on the planned assertion. Failing assertion: `expect(screen.queryByText("BTC TWR")).toBeNull()` at `EditorialHero.test.tsx:70`, received `<dt class="text-micro uppercase ...">BTC TWR</dt>`. 1 failed, 6 passed. Semantic assessment: the target test ran and failed on the planned behaviour (the label is still rendered), not on a syntax, import or fixture fault.
- **GREEN** (`593035010`): 7 of 7 passed.
- **RED-then-restore proof** (byte backups in the scratchpad, no git checkout/restore/stash): HEAD's component copied back, the case went RED naming `BTC TWR`; the new component copied back, 7 of 7 GREEN; `cmp` confirmed byte-equal restore.
- Task 2's case was proven the same way: against HEAD's component `a missing drawdown cell is not rendered (192)` failed (1 failed, 32 passed in that file), then the component was restored byte-equal.
- Tracer gate: `<verify>` is automated-only, so it was re-run end-to-end (passed) before the expansion task.
- Task 2 is the plan's expansion task, `type="auto"`. Its edit, not a new RED, is what moved the other hero pin.

## Census

`npx vitest run src/__tests__/display-sign-single-source.test.ts src/__tests__/display-sign-census-misses.test.tsx` passes with no edit. **No census edit needed:** the two drawdown `negative` flags in `EditorialHero.tsx` still exist, so the R8 count did not move, and the R6 pin for the demo page is not touched by this plan. `display-sign-census-misses.test.tsx` does not reference EditorialHero (confirmed by grep).

## Gates (run from the worktree root)

| Gate | Result |
|------|--------|
| `npx vitest run src/components/portfolio src/__tests__/display-sign-single-source.test.ts src/__tests__/display-sign-census-misses.test.tsx` | 25 files passed, 356 tests passed |
| `npx vitest run src/components/portfolio/EditorialHero.test.tsx` | 7 of 7 passed, includes "removes a null cell, label and all" |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src/components/portfolio/EditorialHero.tsx` | exit 0 |
| `npm run lint` | exit 0, 0 errors, 2 warnings, both pre-existing in unrelated files (`MetricsColumn.tsx`, `composite-read-path.ts`) |
| `node scripts/verify-plan-anchors.mjs <plan>` | OK, 4 claims checked |
| `grep -c "!= null &&" EditorialHero.tsx` | 4 (baseline 0) |

## Deviations from Plan

None - plan executed exactly as written.

Note on commit granularity: the GREEN commit (`593035010`) leaves `portfolio.signed-zero.test.tsx` red until the Task 2 commit (`1595f45cf`), because the plan splits the component change and the pin updates across two tasks. All three commits are on the plan branch together; no push happened between them.

## Known Stubs

None.

## Threat Flags

None. No new network, auth or schema surface. T-192-03 (Repudiation) is mitigated: a null figure renders nothing, pinned by the "removes a null cell" test.

## Self-Check: PASSED

- FOUND: src/components/portfolio/EditorialHero.tsx, EditorialHero.test.tsx, portfolio.signed-zero.test.tsx
- FOUND commits: 9f19d1787, 593035010, 1595f45cf (all ancestors of HEAD)
- STATE.md and ROADMAP.md not modified (orchestrator owns them)
