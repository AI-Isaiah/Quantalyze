---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 04
subsystem: ui
tags: [discovery, compare, keyboard, focus, figure-parity, volatility]
requires: []
provides:
  - "Escape closes the All Filters panel, discards the draft and returns focus to the opener"
  - "CompareTable Volatility row prints unsigned, held by an exact-text parity arm"
affects: [201-16, 201-24]
tech-stack:
  added: []
  patterns:
    - "CustomizeDrawer Escape idiom (skip defaultPrevented, preventDefault, close) reused without the modal machinery"
key-files:
  created:
    - src/components/strategy/StrategyFilters.test.tsx
  modified:
    - src/components/strategy/StrategyFilters.tsx
    - src/components/strategy/CompareTable.tsx
    - src/components/strategy/CompareTable.test.tsx
    - src/__tests__/figure-parity-pages.test.tsx
decisions:
  - "Focus restore lives in a shared closeFilters used by Escape, Close and the backdrop; Apply filters and Clear filters keep their direct close, so they are unchanged (plan: Apply and Reset unchanged)."
metrics:
  tasks: 2
  commits: 3
  files: 5
status: complete
commits: 3
plan_head_before: 8dbc36a02d92b8659c4807bd21ec248246a96756
plan_head_after: 09cd7c466da1e4621713e7afc5a108c789b0ea4e
actuals:
  tokens: 9000
  tasks: 2
  commits: 3
requirements-completed: [CLAR-06]
---

# Phase 201 Plan 04: Escape on All Filters and unsigned CompareTable volatility Summary

Escape now closes the discovery All Filters panel (discarding the unapplied draft, refocusing the opener), and CompareTable prints volatility unsigned (`23.46%`) with a per-fixture exact-text parity arm.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | Escape closes All Filters, discards draft, returns focus (D-12) | 2236805d2, c65997a13 (mock typing fix for tsc) |
| 2 | CompareTable volatility unsigned plus parity arm (D-15, D-25) | 09cd7c466 |

## What changed

- `StrategyFilters`: `closeFilters` (closes and refocuses the element captured in `openFilters`), an effect gated on `filtersOpen` registering a document `keydown` listener (Escape only, skips `defaultPrevented`, claims the event), `data-testid="filters-backdrop"` on the backdrop. No dialog role, trap, scroll lock or initial focus move (A-9); the test file pins that too. "All Filters" casing kept (A-10).
- `CompareTable`: `percentUnsigned` member in the `MetricRow` format union, handled in `formatValue` via `formatPercent(value, 2, { signed: false })`; the Volatility row uses it. No other row changed.
- Tests: new `StrategyFilters.test.tsx` (9 arms); a CompareTable arm in `figure-parity-pages.test.tsx` inside the per-fixture block (both fixtures); one arm in `CompareTable.test.tsx` (volatility unsigned, CAGR still `+10.00%`).

## Test-honesty notes

- jsdom does not move focus on a synthetic click and does not flush React state for a bare `document.dispatchEvent`. Without correction, the focus-return arms and the pre-handled-Escape arm passed with the code absent. The focus arms now focus the Close button first (what a browser does), and the pre-handled arm dispatches inside `act()`. Both were found by the neuter runs below, not by inspection.
- The parity arm reads the `span.font-metric` figure, not the whole cell, because the cell also carries the qualitative chip ("Moderate").

## Neuter proofs (RED named, restored from byte backup, cmp exit 0)

gc-201-04-neuter: gate=StrategyFilters.test.tsx Escape arm (listener registration removed) result=red restored=identical
  - command: `npx vitest run src/components/strategy/StrategyFilters.test.tsx`; failing: "Escape closes the open panel", "Escape discards the unapplied draft...", "focus returns... after Escape" (3 failed / 6 passed)

gc-201-04-neuter: gate=StrategyFilters.test.tsx pre-handled arm (defaultPrevented check deleted) result=red restored=identical
  - failing: "an Escape a nested control already handled (defaultPrevented) leaves it open" (1 failed / 8 passed). First attempt stayed green because the dispatch was outside `act()`; fixed, then RED.

gc-201-04-neuter: gate=StrategyFilters.test.tsx focus-return arms (restore on close removed) result=red restored=identical
  - failing: "after Escape", "after the Close button", "after a backdrop click" (3 failed / 6 passed)

gc-201-04-neuter: gate=StrategyFilters.test.tsx draft-discard arm (Escape applies the draft) result=red restored=identical
  - failing: "Escape discards the unapplied draft: nothing is applied and reopening shows the applied values" (1 failed / 8 passed)

gc-201-04-neuter: gate=figure-parity-pages.test.tsx CompareTable arm (Volatility row pointed back at signed `percent`) result=red restored=identical
  - command: `npx vitest run src/__tests__/figure-parity-pages.test.tsx src/components/strategy/CompareTable.test.tsx`; failing, per fixture ("typical stored row" and "13-digit cumulative return"): `AssertionError: Volatility: expected '+23.46%' to be '23.46%'`; the CompareTable.test arm failed the same way.

Initial RED before implementation: StrategyFilters 5 failed / 4 passed (the 4 passing were the no-op-at-HEAD arms: other key, Apply, A-9 no-addition, pre-handled); CompareTable parity arm failed `expected '+23.46%' to be '23.46%'`.

gc-201-04-gates: vitest=green eslint=clean tsc=clean
  - vitest: StrategyFilters, StrategyTable, CustomizeDrawer (100 passed); CompareTable, figure-parity-pages, figure-gate-census, StrategyFilters (102 passed). `figure-gate-census` rows for `StrategyFilters.tsx` and `CustomizeDrawer.tsx` stay valid (no figure word removed).
  - eslint on the five touched files: clean. `npm run typecheck`: clean (after typing the apply mock).

## Acceptance

- `grep -a -c defaultPrevented StrategyFilters.tsx` = 1; `grep -a -c 'role="dialog"' StrategyFilters.tsx` = 0; `percentUnsigned` appears 3 times in `CompareTable.tsx`; `CompareTable` appears in `figure-parity-pages.test.tsx`.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 9 claims.

## Deviations from Plan

**1. [Rule 1 - Bug] Tests that could not fail.** The first draft of the focus-return and pre-handled-Escape arms passed with the implementation removed (jsdom focus and act semantics, above). Strengthened before the neuter proofs counted. Files: `StrategyFilters.test.tsx`.

**2. [Rule 3 - Blocking] Typecheck error in my own new test** (`vi.fn()` union lost `.mock`). Fixed in commit c65997a13 by typing the mock `vi.fn<(f: AdvancedFilters) => void>()`.

Otherwise the plan ran as written. `CompareTable.test.tsx` had no volatility expectation carrying a plus sign, so nothing needed updating there; I added one arm instead.

## Known limits

- Apply filters and Clear filters close the panel without restoring focus (unchanged per the plan); focus drops to the body there as before.

## Known Stubs

None.

## Threat Flags

None. T-201-06 mitigated by the exact-text parity arm, proven RED.

## Self-Check: PASSED

- FOUND: `src/components/strategy/StrategyFilters.test.tsx`
- Commits 2236805d2, c65997a13, 09cd7c466 are ancestors of HEAD on `wt/201-p04`.
- STATE.md and ROADMAP.md untouched.
