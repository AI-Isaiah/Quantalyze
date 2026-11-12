---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 34
subsystem: copy-census
tags: [plainwords, glossary, term, tooltip, copy-census, scenario, f-04, f-08, u-27, clar-03]
requires: ["201-11", "201-12", "201-14", "201-15", "201-27", "201-30", "201-33"]
provides:
  - "Form B (Tooltip, function children) on the mobile nav Scenario link, the My allocation Scenario tab, and the Scenario mode radio in the equity and drawdown charts"
  - "Form A (Term around the word Scenario) on the composer h2, the composer KPI eyebrow, the composer max-DD note, the stub h2 and the equity legend item"
  - "every copy-census ledger reads pending {}; one new exception (the compare table's accessible name)"
affects: [201-23]
key-files:
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/MobileNav.tsx
    - src/components/layout/MobileNav.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/ScenarioStub.tsx
    - src/app/(dashboard)/allocations/ScenarioStub.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx
    - src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.scenario.test.tsx
    - scripts/copy-census/ledgers/plan-11.ts
    - scripts/copy-census/ledgers/plan-14.ts
    - scripts/copy-census/ledgers/plan-15.ts
    - scripts/copy-census/ledgers/plan-27.ts
decisions:
  - "The equity overlay prints its label as a DOM legend item, so it gets Form A there (a `term?: TermKey` field on `OverlaySeries`, set to scenario on the Scenario overlay) and the config literal is covered by the census `term` marker. No plan-14 exception row was needed."
  - "The composer max-DD note (`Scenario max-DD at L× (computed for the whole scenario): X%`) is a census hit that starts with the form, so it gets Form A like the other composer labels, per the plan's worklist rule."
  - "Only the compare table's accessible name is a new ledger exception (plan-27, reason from the closed set); the composer fallback name and SCENARIO_NAME were not reported by the census, so they got no row."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 12400
  tasks: 3
  commits: 3
plan_head_before: f04e4793d14bff702eddc944bab19d9849b4dbd4
plan_head_after: eda295dd7defbcdb161582b95ca8cdbcc294bf97
---

# Phase 201 Plan 34: Every Scenario label explains itself Summary

Each "Scenario" label a user can focus or read as a heading now opens the `scenario` registry definition: Form B on the four controls (mobile nav link, My allocation tab, two chart mode radios), Form A on the static labels (composer h2, KPI eyebrow, max-DD note, stub h2, equity legend), and the copy census is back to zero pending in every ledger.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 74c62c834 | `term?: TermKey` on `NavItemBase` with `term: "scenario"` on the Scenario item. `MobileNav` wraps a term item in `Tooltip` (function children, `aria-describedby` on the link, wrapper `flex min-w-0 flex-1 [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1`). `AllocationsTabs` wraps the scenario tab through a `TAB_TERMS` map the same way and the strip-scroll effect now finds the strip with `closest('[role="tablist"]')`. plan-14 no longer pins `Sidebar.tsx`. |
| 2 | be2edbf03 | `Term k="scenario"` around only the word `Scenario` in the composer h2, the KPI eyebrow, the max-DD note and the stub h2. plan-11 and plan-15 lowered. |
| 3 | eda295dd7 | Form B on the Scenario radio in `EquityChart` and `DrawdownChart`; Form A on the equity legend item via `OverlaySeries.term`; plan-27 records `Scenario comparison` as its one exception; all four ledgers read `pending: {}`. |

## Verify commands (real output)

| Command | Result |
|---|---|
| `node scripts/verify-plan-anchors.mjs .planning/phases/201-.../201-34-PLAN.md` | `claims: 7 checked`, `OK: 1 plan file(s), no stale claims.`, exit 0 |
| Task 1 vitest (`src/components/layout/` + `AllocationsTabs.test.tsx` + `AllocationsTabs.tabstrip-scroll.test.ts` + `copy-census.test.ts`) | 9 files, 260/260 pass |
| The plan's literal Task 1 / Task 3 vitest filter (prefix `AllocationsTabs` matches all `AllocationsTabs.*` files) | **3 failed, 318 passed**: all 3 are red at the base (see Deferred Issues) |
| Task 2 vitest (`ScenarioComposer*`, `ScenarioStub.test.tsx`, `copy-census.test.ts`, `figure-gate-census.test.ts`) | only the 2 `ScenarioComposer.d11` failures, red at the base |
| Task 3 vitest (`widgets/performance/` etc., the plan's literal command) | 38 files: 36 pass, 2 fail; the only 3 failing tests are the base-red `AllocationsTabs.connect-key-predicate` x2 and `AllocationsTabs.onboarding` x1; `widgets/performance/` alone is 20 files, 239/239 pass |
| `npx eslint` on every touched source, test and ledger file | exit 0 |
| `npm run typecheck` | exit 0 |
| `npx tsx scripts/copy-census/run.ts --summary \| tail -1` | `total  live A=0 B=0 C=0` |
| `grep -a -L "pending: {}" scripts/copy-census/ledgers/plan-*.ts \| grep -a -c .` | `0` |
| `grep -a -c 'term: "scenario"' src/components/layout/Sidebar.tsx` | `1` |
| `grep -a -c termDefinition AllocationsTabs.tsx` | `2` |
| `grep -a -c 'Term k="scenario"' ScenarioComposer.tsx` / `ScenarioStub.tsx` | `3` / `1` |
| Whole-tree run `vitest run "src/app/(dashboard)/allocations" src/components src/__tests__` | 22 failed, 10948 passed. The same 22 fail on a `git archive` of the base `f04e4793d` (17 in `HoldingsTabPanel`, `AlphaBetaDecomposition.book-btc`, `StrategyTable.*`, plus the 5 named above); none touches a file this plan edited |

## Census summary (pasted)

```
plan-11  files=0  live A=0 B=0 C=0  pinned A=0 B=0 C=0
plan-14  files=0  live A=0 B=0 C=0  pinned A=0 B=0 C=0
plan-15  files=0  live A=0 B=0 C=0  pinned A=0 B=0 C=0
plan-27  files=0  live A=0 B=0 C=0  pinned A=0 B=0 C=0
total  live A=0 B=0 C=0
```

(plans 08-10, 12, 13, 16-22 are also `files=0`, all zero; `--summary | grep -a -c MISMATCH` is 0.)

## Gates seen able to fail

Each neuter was done on a `cp -p` byte backup in the scratchpad, restored with `cp -p`, and `cmp` exited 0 before the file went green again.

- `gc-201-34-neuter: gate=MobileNav.test.tsx (focus shows the scenario definition; the cell fills the bar) result=red restored=identical` (neuter: `if (!item.term) return link();` became `return link();`; RED lines: `Unable to find an accessible element with the role "tooltip"` and `expected [ 'fixed', 'bottom-0', ... ] to deeply equal ArrayContaining{...}`; 2 failed, 22 passed; restored, 24/24)
- `gc-201-34-neuter: gate=AllocationsTabs.test.tsx (the Scenario tab shows the scenario definition) result=red restored=identical` (extra, same task: `if (!term) return tabButton();` became `return tabButton();`; RED: `Unable to find an accessible element with the role "tooltip"`; 1 failed, 76 passed; restored, 77/77)
- `gc-201-34-neuter: gate=ScenarioComposer.test.tsx + copy-census.test.ts (the h2 Term, rule B on ScenarioComposer.tsx) result=red restored=identical` (neuter: unwrapped the h2 Term; RED: `AssertionError: expected null not to be null` and `registers every live hit in the ledger that owns its file, at the exact count` with `+ "unregistered: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx rule B: 1 live hit(s), none pinned in any ledger"`; 2 failed; restored, 502/502)
- `gc-201-34-neuter: gate=EquityChart.scenario.test.tsx (the Scenario radio shows the scenario definition) result=red restored=identical` (neuter: `if (m !== "scenario") return radio();` became `return radio();`; RED: `Unable to find an accessible element with the role "tooltip"`; 1 failed, 23 passed; restored, 24/24)
- `gc-201-34-gates: vitest=green on every touched file (22 failures elsewhere, all red at base f04e4793d, see Deferred Issues) eslint=clean tsc=clean`

Tests-first RED before each implementation: Task 1 nav arms 2 failed (focus bubble, cell fill); Task 1 tab arms 2 failed (bubble, data-term count); Task 2 six failed (stub Term, composer h2, eyebrow, three existing eyebrow tests that read `getByText("Scenario blend")`); Task 3 three failed (equity radio, equity legend, drawdown radio).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The tab-strip scroll effect assumed the tab's parent is the strip**
- **Found during:** Task 1
- **Issue:** `AllocationsTabs`'s NAV-02 effect read `el.parentElement` as the `role="tablist"` scroller. Wrapping the Scenario tab in the Form B Tooltip makes its parent an inner span, so the active-tab scroll-into-view would have computed against the wrong box.
- **Fix:** `el?.closest<HTMLElement>('[role="tablist"]')`; the comment above it was updated to match.
- **Files modified:** `AllocationsTabs.tsx`
- **Commit:** 74c62c834

**2. [Rule 1 - Bug] Existing tests encoded the pre-wrapper DOM**
- **Found during:** Tasks 1 and 2
- **Issue:** `[JOURNEY-03] the tablist's direct children are the role=tab buttons` required every tab to be a direct child of the tablist, which cannot hold for a Form B tab. Three composer tests (`getByText("Scenario blend")`) and three stub tests (`getByText(/Scenario builder coming soon/i)`) matched on the element's own text nodes; a Term span splits those, so the plan's "Term adds no text node" premise is true of `textContent` and false of `getByText`.
- **Fix:** JOURNEY-03 now pins the real contract (one tablist; every tab owned through spans that carry no role, no `aria-*`, no `tabindex`; the two term-less tabs stay direct children). The composer tests use a `scenarioBlendEyebrow()` helper that finds the Term and walks to the paragraph; the stub tests query the heading by role and name.
- **Files modified:** `AllocationsTabs.test.tsx`, `ScenarioComposer.test.tsx`, `ScenarioStub.test.tsx`
- **Commits:** 74c62c834, be2edbf03

**3. [Rule 2 - Missing critical functionality] The equity legend prints the overlay label as DOM text**
- **Found during:** Task 3
- **Issue:** The plan's branch: if the chart prints the overlay label as a DOM legend item, that text gets Form A. `LegendSwatch` does (`overlaySeries.map ... label={o.label}`), so a named exception would have been a false reason.
- **Fix:** optional `term?: TermKey` on `OverlaySeries`, `term: "scenario"` on the Scenario overlay, `LegendSwatch` renders `Term` when given one. The census `term` marker then covers the config literal, so plan-14 needs no exception. `HeaderLegendSwatch` was left alone: the widget header only receives the caller's overlays, never the Scenario overlay the chart appends.
- **Files modified:** `EquityChart.tsx`
- **Commit:** eda295dd7

### Not a deviation, but worth knowing

- The census reported a third composer site the UI-SPEC table does not list (`Scenario max-DD at`, added by plan 201-11). It was wrapped with Form A as the plan's worklist rule says. It is a `<p>` caption with a figure beside it, not a pure heading.
- The census did not report the composer fallback saved name or `SCENARIO_NAME`, so neither got an exception row.
- The plan said the worktree held an older plan copy; `diff` against the phase-worktree copy showed them identical.

## Deferred Issues

All 22 failing tests in the whole-tree run fail identically on a `git archive` of base `f04e4793d` (measured by running the same files there), so none comes from this plan. They sit in files this plan does not own, and the plan's literal verify filter `src/app/(dashboard)/allocations/AllocationsTabs` (a prefix) picks up three of them, so that command exits non-zero before and after this plan.

- `AllocationsTabs.onboarding.test.tsx` "BOTH OnboardingBanner and MandateQuickSetCard render above tabs": `getByText("Mandate quick-set")` no longer matches since `MandateQuickSetCard` wraps `Mandate` in a Term (plans 201-14/29). Same defect class as deviation 2.
- `AllocationsTabs.connect-key-predicate.test.tsx` `tab=scenario` Arm A and Arm B: 5000 ms timeouts waiting on the lazily loaded panel.
- `ScenarioComposer.d11.test.tsx` "a malformed first/last own-book date ...": `getByText("Max DD (blend vs book)")` no longer matches for the same Term reason.
- 17 more in `HoldingsTabPanel.key-read-notes`, `HoldingsTabPanel`, `AlphaBetaDecomposition.book-btc` and `StrategyTable.*`.

Recorded here, not fixed, per the scope boundary. They need an owner (the plans that added the Terms) before the phase verifier runs.

## reported-not-edited

None. No phase-200 file (`ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts`, `e2e/sync-analytics-flow.spec.ts`) needed a copy change.

## Known Stubs

None. No placeholder values, empty data sources or TODO text were added.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-201-47 (tablist accessibility) is mitigated as planned: `aria-describedby` sits on the tab itself, the wrapper spans are pinned role-less, attribute-less and tabindex-less in `AllocationsTabs.test.tsx`, and arrow keys are pinned across all three tabs. The seeded `e2e/composer-axe.spec.ts` gate runs in CI only; no Playwright ran locally. T-201-48: the one new exception row uses a closed-set reason and matches exactly one live hit.

## Self-Check: PASSED

- Commits `74c62c834`, `be2edbf03`, `eda295dd7` are ancestors of HEAD (`git merge-base --is-ancestor`).
- All 17 modified files exist in the worktree; `git status` is clean apart from this SUMMARY.
- The base archive in the scratchpad was only read.
