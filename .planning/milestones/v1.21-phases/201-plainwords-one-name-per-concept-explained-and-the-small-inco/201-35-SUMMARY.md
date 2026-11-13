---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 35
subsystem: public-date-format
tags: [plainwords, dates, formatDay, factsheet, terms-panel, legal, security, f-11, d-11, clar-06, gap-closure]
requires: ["201-24"]
provides:
  - "Factsheet and tear sheet Terms panel prints Live since, the observation-window clause, Observation start, Observation end and Factsheet computed through formatDay"
  - "Factsheet footer stamp prints its day through formatDay (QSF, id, Nov 11, 2026 form)"
  - "Retired report page, the three legal pages and the security page print their dates through formatDay with the ISO day as the literal argument"
affects: [201-40]
key-files:
  modified:
    - src/app/factsheet/[id]/v2/MandatePanels.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.tearsheet-homes.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.usd-terms.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
    - src/app/portfolio-pdf/[id]/page.tsx
    - src/app/portfolio-pdf/[id]/page.test.tsx
    - src/app/(marketing)/legal/disclaimer/page.tsx
    - src/app/(marketing)/legal/disclaimer/page.test.tsx
    - src/app/(marketing)/legal/privacy/page.tsx
    - src/app/(marketing)/legal/terms/page.tsx
    - src/__tests__/public-truth-copy.test.tsx
    - src/app/(marketing)/security/page.tsx
    - src/app/(marketing)/security/page.test.tsx
decisions:
  - "The Terms panel's local YYYY-MM-DD formatter and the footer's dotted-day helper are deleted, not wrapped: one date helper (F-11)."
  - "recordStart, declaredStart, obsStart and hasBacktestGap stay on ISO values; only the printed text moved to formatDay."
  - "The security page keeps the ISO day as the literal formatDay argument inside the 120-character window after the Last reviewed marker, so security-packet-date-drift.test.ts passes unchanged."
metrics:
  tasks: 2
  completed: 2026-11-11
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: 95bf90ac7f0a1a7e3dabee322bf42a45678f2d15
plan_head_after: 726abe4521f5e43b321246e151375c8d132c4d67
---

# Phase 201 Plan 35: Public-surface dates through formatDay Summary

The public factsheet and tear sheet Terms panel, the factsheet footer stamp, the retired allocation-report page, the three legal pages and the security page now print every date through `formatDay` ("Jun 1, 2024"), closing the public-surface half of the SC-3 date gap (CLAR-06, F-11, D-11).

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | Terms panel and footer stamp through formatDay | 61e204700 | MandatePanels.tsx, FactsheetView.tsx, three factsheet test files |
| 2 | Retired report, legal and security pages through formatDay | 726abe452 | five page files, four test files |

## What changed

- `MandatePanels.tsx`: `formatDay` imported from `@/lib/utils`; Live since, the observation-window-starts clause, Observation start, Observation end and Factsheet computed print through it. The local `iso` formatter is deleted. The comment added says "the one date helper (F-11)".
- `FactsheetView.tsx`: the footer stamp prints `formatDay(payload.computedAt)`; the private dotted-day helper is deleted.
- `portfolio-pdf/[id]/page.tsx`, `legal/disclaimer`, `legal/privacy`, `legal/terms`, `security` pages: `formatDay("<ISO day>")` with the page's existing ISO day as the literal. Day values unchanged.
- Tests re-pinned to the helper's form (`Jun 1, 2024`, `Jan 1, 2023`, `Dec 25, 2022`, `Jan 1, 2024`, `Aug 8, 2024`, `Retired Nov 7, 2026`, `Last updated: Apr 7, 2026`, `Last reviewed: Nov 7, 2026.`), each with a negative assertion that the element or page text carries no YYYY-MM-DD (or dotted) day. The MTM arm still asserts the window differs from the cash window (169 WR-03). The Terms arm in public-truth-copy keeps its original intent: the captured day is not the HEAD date, now stated as `Apr 7, 2026`. The security page had no date pin; a new arm was added.

## Behaviour change

An unparseable date in the Terms panel or footer stamp now prints an em dash instead of echoing the raw input. That is `formatDay`'s contract under D-11.

## Verification

Tests were first changed and seen RED against HEAD source (Task 1: 9 failed arms across the three factsheet files; Task 2: 4 failed arms, one per test file), then GREEN after the source change.

- Task 1 verify (`FactsheetBody.tearsheet-homes`, `FactsheetView.usd-terms`, `MetricsColumn.record-length`, `MetricsColumn.parts`, `tearsheet/`, `copy-census`): Test Files 9 passed (9), Tests 162 passed (162).
- Task 2 verify (portfolio-pdf page, public-truth-copy, disclaimer page, security page, security-packet-date-drift, copy-census): Test Files 6 passed (6), Tests 108 passed (108); eslint on the seven source files exit 0; `npm run typecheck` exit 0.
- Task 1 acceptance: `[{ (]iso(` in MandatePanels.tsx = 0; `formatDay(` in MandatePanels.tsx = 5; `isoToYmd` in FactsheetView.tsx = 0; `formatDay(` in FactsheetView.tsx = 1.
- Task 2 acceptance: for each of the five page files the `(Retired|Last updated:|Last reviewed:) 20YY-MM-DD` grep prints 0 and `formatDay(` prints 1.

## Neuter evidence

Each neuter was on a byte backup (`cp -p` to the scratchpad), restored with `cp -p`, `cmp` exit 0, GREEN re-run.

- gc-201-35-neuter: gate=FactsheetBody.tearsheet-homes.test.tsx site=src/app/factsheet/[id]/v2/MandatePanels.tsx result=red restored=identical
  - RED line: `AssertionError: expected '2024-06-01' to contain 'Jun 1, 2024'` (the Live since arm), 1 failed | 29 passed; after restore 30 passed.
- gc-201-35-neuter: gate=FactsheetBody.tearsheet-homes.test.tsx site=src/app/factsheet/[id]/v2/FactsheetView.tsx result=red restored=identical
  - RED line: `AssertionError: expected 'Returns computed from the strategy's…' to contain 'QSF · CENSUS-F · May 12, 2026'` (the footer arm), 1 failed | 29 passed; after restore 30 passed.
- gc-201-35-neuter: gate=portfolio-pdf/[id]/page.test.tsx site=src/app/portfolio-pdf/[id]/page.tsx result=red restored=identical
  - RED line: `TestingLibraryElementError: Unable to find an element with the text: Retired Nov 7, 2026.` (the retirement date arm), 1 failed | 6 passed; after restore 7 passed.

gc-201-35-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

None - plan executed exactly as written.

## reported-not-edited

None. No phase-200 file (ApiKeyManager.tsx, ConfirmKeyChangeDialog.tsx, AllocatorExchangeManager.tsx, the shared Modal, the e2e specs, ci.yml) was touched.

## Known Stubs

None.

## Threat Flags

None. Display formatting only; T-201-49 mitigated (formatDay reads UTC fields, re-pinned arms assert exact days from literal fixtures); T-201-50 mitigated (ISO day kept in source within the packet drift test's window, test passes unchanged).

## Self-Check: PASSED

- 61e204700 and 726abe452 are ancestors of HEAD; the 14 files listed above exist and were committed; no unexpected deletions.
