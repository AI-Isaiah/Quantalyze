---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
plan: 04
subsystem: ui
tags: [compare, route-05, combobox, add-strategy, remove-link, a11y]
requires:
  - phase: 197-01
    provides: "branch baseline (DISCOVERY_COLUMNS) the precondition checked"
provides:
  - "compare-href.ts: COMPARE_MAX_ITEMS (4) and compareHref(ids), shared by the page, the search and (plan 05) the discovery bar"
  - "CompareAddStrategy.tsx: the 'Add strategy' ARIA combobox over GET /api/strategies/browse"
  - "/compare states per the UI-SPEC table, no 'not available yet' copy, per-column Remove links via CompareTable removeHrefs"
affects: [197-05, 197-06]
tech-stack:
  added: []
  patterns: ["URLs built from resolved item ids only, path fixed in compareHref; page captions spaced with space-y so the loading.tsx box-inset pin holds"]
key-files:
  created:
    - src/lib/compare-href.ts
    - src/lib/compare-href.test.ts
    - "src/app/(dashboard)/compare/CompareAddStrategy.tsx"
    - "src/app/(dashboard)/compare/CompareAddStrategy.test.tsx"
  modified:
    - "src/app/(dashboard)/compare/page.tsx"
    - "src/app/(dashboard)/compare/page.test.tsx"
    - "src/app/(dashboard)/compare/page.strategy-only-charts.regression-1.test.tsx"
    - src/components/strategy/CompareTable.tsx
    - src/components/strategy/CompareTable.test.tsx
    - e2e/layout-narrow.spec.ts
key-decisions:
  - "Search and Remove URLs come from the page's RESOLVED ids (strategy ids and holding refs in display order), so an unresolved raw id is dropped and the cap counts what is on screen"
  - "No new API route: the search reuses /api/strategies/browse (allocator auth, rate limit, displayStrategyName); own non-published rows and compared ids are dropped client-side"
  - "Page captions use space-y wrappers, not mb- classes, because loading.test.tsx pins the page's final-return box insets against the skeleton"
requirements-completed: [ROUTE-05]
duration: ~45m
completed: 2026-11-08
status: complete
actuals:
  tokens: 10400
  tasks: 3
  commits: 3
commits: 3
plan_head_before: e0825d0c81e80c03aa0861fb6c31ac7444ac3845
plan_head_after: 5563264e6c53b846385e59962b5ab622fa2f4731
---

# Phase 197 Plan 04: Add and remove strategies on /compare Summary

`/compare` now adds strategies through a published-catalogue search (2-character, 250ms-debounced ARIA combobox) and removes them with a per-column Remove link, and no state says adding is unavailable.

## What was built

- **Task 1 (tracer), `5499e3b79`:** `compare-href.ts` (cap constant plus `compareHref`, path fixed, ids `encodeURIComponent`-ed, never slices), `CompareAddStrategy` happy path and privacy filter, page mount in the one-item state, parser cap now `COMPARE_MAX_ITEMS`.
- **Task 2, `ff3302301`:** every page state (0 ids, none resolvable, 1, 2-3, 4), removed copy gone from `src/` and `e2e/`, `CompareTable` `removeHrefs` prop (Remove link under the name, `aria-label` "Remove {name} from the comparison", absent prop renders the old header byte-for-byte, holding panels untouched), e2e one-item assertion updated.
- **Task 3, `5563264e6`:** 250ms debounce, one fetch per mount, at most 8 options, "Searching…" (role=status), no-match line, role=alert failure with "Try again", combobox ARIA attributes, Up/Down/Enter/Escape, field emptied and refocused after an add.

## Verification

- `npx vitest run "src/app/(dashboard)/compare" src/components/strategy/CompareTable.test.tsx src/lib/compare-href.test.ts`: 8 files, 281 tests pass.
- Also green: `phase-52-container-tabular-nums`, `figure-parity-pages`, `critical-regressions` (3 files, 213 tests).
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors (2 pre-existing unused-var warnings in untouched factsheet files), route-contract and planning-hygiene OK.
- Gate-can-fail check (byte backup, restored, `cmp` identical): with the own-non-published filter, the already-compared filter and the debounce neutered, 4 tests went RED (name-match fetch, draft privacy, compared-id exclusion, debounce); restored, 17/17 green.
- Acceptance greps: removed copy 0 hits in `src`/`e2e` for the plan's fragment; `slice(0, 4)` 0 in page.tsx; `title="Compare strategies"` 1; "Add another to compare." in e2e 1; `removeHrefs` in CompareTable 4.

## Deviations from Plan

**1. [Rule 3 - Blocking] Page captions use `space-y` wrappers, not margin classes.**
- **Found during:** Task 2. `loading.test.tsx` compares every box-inset class in the page's final `return (` with the skeleton's wrappers; my `mb-4`/`mb-6` captions made it RED.
- **Fix:** one-item caption plus search sit in a `space-y-4` div; the cap caption is the first child of the existing `space-y-8` stack. Visual spacing stays on the 4px ladder (16px caption-to-search, 32px cap caption to table instead of the 24px the UI-SPEC suggests for the search block; the search component itself keeps `mb-6`).
- **Commit:** `ff3302301`.

**2. [Process] RED proof for TDD tasks is by test-first plus a neuter run, not a recorded RED commit.** `tdd_mode` is false in config and the plan is `type: execute`. Task 1's component test was written first and failed on the missing module; `compare-href.ts` was written in the same step as its test, so its own RED was not observed separately.

**3. Task 3 test seam:** the fake-timer cases drive the field with `fireEvent`, because RTL's async wrapper waits on a real `setTimeout` that never fires under vitest fake timers (`userEvent` hung). Task 1's cases keep `userEvent` with real timers.

No Rule 4 items. No threat flags beyond the plan's register (T-197-10, -11 mitigated by the privacy filter test and the fixed-path `compareHref`).

## Known Stubs

None.

## Deferred / not done

- Keyboard-only walk on the real page (UI-SPEC backstop row) and the e2e run of the changed assertion were not run in a browser here; the unit suite covers the key handling and focus return.
- Per the plan, not changed: the search names other managers' rows by codename while discovery and `CompareTable` print raw `strategies.name` (RESEARCH OQ1, booked in plan 06); `CompareTable` still prints Volatility with a `+` (UI-SPEC A-3, Phase 201).

## Self-Check: PASSED

- Files exist: compare-href.ts, CompareAddStrategy.tsx (+ both tests), page.tsx, CompareTable.tsx.
- Commits `5499e3b79`, `ff3302301`, `5563264e6` are ancestors of HEAD.
