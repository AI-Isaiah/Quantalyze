---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 01
subsystem: testing
tags: [census, playwright, jsdom, factsheet, vitest]
status: complete

requires:
  - phase: 194
    provides: the figure-gate notes and the factsheet markup the counting rules read
provides:
  - countFactsheetCensus, a self-contained DOM counter for the SC-5 census
  - a Playwright driver (before / after / print / share / self-test) with an id-free output guard
  - censusPayloadA/B/C fixture builders
  - 196-CENSUS.md, the before counts and the rules the after-run reuses
affects: [196-10, 196-11, 196-14, 196-21]

actuals:
  tokens: 13000
  tasks: 2
  commits: 4
plan_head_before: 49566dbc00a314300b862d8b1d4b44120c4ed3d7
plan_head_after: f21e017ee484db2e6dbc64927c86fd173182bf92

tech-stack:
  added: []
  patterns:
    - "A page.evaluate-able function is self-contained; its tables are mirrored as exported data and a test drives every entry through the function"
    - "A __name shim is defined in the page before evaluating a tsx-compiled function (tsx compiles with keepNames)"

key-files:
  created:
    - scripts/factsheet-census/count.ts
    - scripts/factsheet-census/count.test.tsx
    - scripts/factsheet-census/run.ts
    - src/app/factsheet/[id]/v2/test-fixtures/census-payloads.ts
    - .planning/phases/196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it/196-CENSUS.md
  modified: []

key-decisions:
  - "Anonymous census, article scope: no credential is entered, and the only allocator-only element in the article is the AUM chip"
  - "Visibility is part of the count: sr-only, hidden, display none, data-census-skip and closed details contents are not counted, so the print pass and the Advanced-closed pass use the same rule"
  - "CensusCounts carries warningKinds so the record names each small-sample instance, not just the total"

requirements-completed: [LEAN-05]
---

# Phase 196 Plan 01: Factsheet census Summary

A re-runnable census (`countFactsheetCensus`, a Playwright driver and three fixture payloads) counts the factsheet inside `article#factsheet-main`, and `196-CENSUS.md` records the before state of the published strategies, measured on the production site before any 196 layout change.

## Accomplishments

- **Counting rules as code.** `scripts/factsheet-census/count.ts` counts sections, charts (MasterBrush apart), repeated metric labels (normalised, with a written alias map), small-sample warnings by kind, visible chart hints and "— on request" rows. The function is self-contained so `page.evaluate` can ship it; `CENSUS_ALIASES` and `CENSUS_ALIAS_PREFIXES` are exported as the record and a test drives every entry through the function so the two copies cannot drift.
- **Proven against real markup.** `count.test.tsx` has 16 synthetic red/green cases and 3 cases that render the real `FactsheetBody` over `censusPayloadA/B/C` (waiting for the dynamically imported heatmaps) with positive controls: charts >= 8, sections >= 6, labels contain sharpe / max drawdown / start date, "sharpe" repeated, seven "— on request" rows.
- **Driver.** `run.ts` has `--mode before|after`, `--print`, `--share` and `--self-test`. Ids and the share link enter only through the environment, the printed table carries a profile letter and the page's H1, and the output is checked against every env id and any UUID-shaped string before it is written (exit 2, nothing on stdout). Error messages are scrubbed too, since Playwright quotes the URL.
- **Before census recorded.** `196-CENSUS.md` holds the method, definitions, alias map, small-sample note family with every instance found, the before table and an empty After section with the UI-SPEC targets and the after-run command shape.

Production, anonymous, as loaded (counts by `countFactsheetCensus`):

| Profile | Display name | sections | charts | brush | repeated | small-sample | hints | on request |
|---------|--------------|----------|--------|-------|----------|--------------|-------|------------|
| A | no published strategy matches profile A on 2026-11-09 | | | | | | | |
| B | Momentum Sphinx | 12 | 38 | 1 | 20 | 7 | 1 | 7 |
| C | Fibonacci Ghost | 12 | 31 | 1 | 19 | 6 | 1 | 7 |
| B (second, supplementary) | Phoenix Protocol | 12 | 38 | 1 | 20 | 6 | 1 | 7 |

Profile A has no match: all three public strategies are API-verified with records of 0.21, 0.52 and 0.70 years, so none has a record of a year or more. Nothing was substituted. The fixture A render (jsdom, `censusPayloadA()`) stands in for A's before state: 12 sections, 22 charts, 22 repeated metrics, 4 small-sample warnings (rolling-subtitle x4), 1 hint, 7 "— on request" rows. jsdom does not mount the signatures section, so jsdom charts count lower than a browser's; compare like with like.

## Verification

- `npx vitest run scripts/factsheet-census/count.test.tsx`: 19 passed.
- `npx tsx scripts/factsheet-census/run.ts --self-test`: `census self-test OK` (a static article in real Chromium: one closed section, one chart, "Sharpe" repeated, one visible hint, with an sr-only hint, a `display: none` hint and a hint under a closed details correctly not counted; plus the id-guard cases).
- `npx tsc --noEmit` and `npx eslint scripts/factsheet-census src/app/factsheet/[id]/v2/test-fixtures`: clean.
- 196-CENSUS.md gates: `^## After` present (1); UUID-shaped grep 0 (both patterns); `\$[0-9]` 0; no id-bearing URL.
- Id-free guard: `grep -a -E -c` for a UUID shape returns 0 in `run.ts` and `count.ts`.

## Neuter evidence (RED once, restore, GREEN)

Gate: the Row/Kpm label selector in `count.ts`.

1. `cp -p count.ts` to a backup, then changed `table.text-fixed-12 > tbody > tr > td:first-child` to `table.matches-nothing > tbody > tr > td:first-child`.
2. `npx vitest run scripts/factsheet-census/count.test.tsx`: 8 tests RED, including the real-markup positive control, which failed with `AssertionError: the strip and the rail both print Sharpe: expected [] to include 'sharpe'` (and the synthetic cases such as `the same label twice is one repeated metric`: `expected [] to deeply equal [ 'sharpe' ]`).
3. Restored with `cp -p` from the backup; `cmp` exited 0 (printed `CMP_OK`); the test file is 19 passed again.

Id guard, end to end (RED once): ran `--share` with a share URL whose fragment was the display name of the page, so the output necessarily contained a known secret. Result: exit 2, empty stdout, stderr `census: refusing to print, the output contains an id-shaped string`. The self-test also asserts the guard predicate fires and stays quiet on synthetic cases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Error-path id scrubbing and a `warningKinds` field**
- **Found during:** Task 1 and Task 2.
- **Issue:** Playwright error messages quote the navigated URL, which carries a strategy id, and the plan's prohibition (no id in any tracked file or output) would have been breached by a failing run. The plan also asks for "every instance found" of the small-sample family, which a bare total cannot name.
- **Fix:** `run.ts` scrubs env ids and UUID-shaped strings from error output; `CensusCounts` gained `warningKinds` (`kind xN`), printed per row.
- **Files modified:** `scripts/factsheet-census/run.ts`, `count.ts`, `count.test.tsx`.
- **Commits:** a93a2fae7, 2e938f44d, d9b1a8b90.

**2. [Plan premise, not a code deviation] Profile A has no production match; profile B has two**
- Recorded as the plan's A2 allows: A is a stated no-match line, B uses Momentum Sphinx, and Phoenix Protocol is added as a clearly labelled supplementary row. The CENSUS file's A before state also carries the fixture render.

**3. [Rule 3] Production browse redirects**
- `/browse` answers 307 to the one populated category page, which answers 200. The precondition was read as met.

Otherwise the plan was executed as written.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the driver reads public pages anonymously.

## Notes for later plans

- Plan 10 must put `data-census-section` on the equity figure, the Main metrics panel and the Advanced row (`count.ts` counts them), keep `#factsheet-advanced` a `<details>`, and use the id `factsheet-chart-hint` for the one hint. Any viewer bar, visitor header or sign-up line that lands inside the article must carry `data-census-skip`.
- The label selector reads `table.text-fixed-12` rows and `dl > dt`. If plan 10 restyles the `Row`/`Kpm` table, change the selector and keep the positive control green.
- Not measured: the print pass and the share-link pass (they need the after layout and a share token; the commands are in 196-CENSUS.md). No PROD database was touched at any point.

## Self-Check: PASSED

- Created files found: `scripts/factsheet-census/count.ts`, `count.test.tsx`, `run.ts`, `src/app/factsheet/[id]/v2/test-fixtures/census-payloads.ts`, `196-CENSUS.md`.
- Commits found as ancestors of HEAD: a93a2fae7, 2e938f44d, d9b1a8b90, f21e017ee.
