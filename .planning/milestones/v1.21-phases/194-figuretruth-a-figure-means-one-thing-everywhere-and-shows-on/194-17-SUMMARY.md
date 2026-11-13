---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 17
subsystem: scenario-composer
tags: [trust-05, d-11, d-14, d-15, scenario, rolling, benchmark, own-book-delta]
requires: ["194-05", "194-12", "194-14", "194-16", "194-23"]
provides:
  - "ScenarioBenchmarkSection: TE / IR / Alpha gated on the blend's total record, one muted `scenario-benchmark-annualization-note`"
  - "ScenarioComposer: blend rolling panel verdict (`gateRollingWindow`), `blend-rolling-annualization-note`, the `365D` toggle option"
  - "deriveBlendPanels accepts `{ calendarDays }` and draws it through `rollingCalendarStats`"
  - "scenarioOwnBookDelta.span_days and .records ({ blend, book })"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx"
affects: ["194-16", "194.1 scenario-share"]
key-files:
  created:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
    - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/lib/scenario-blend-adapter.ts
    - src/lib/scenario-blend-adapter.test.ts
key-decisions:
  - "The 365D option is never disabled; a record too short for it shows the rolling-record body, the way an already-selected short row window does."
  - "The blend rolling verdict reads the composer's existing `blendRecord` (plan 05), so the strip, the peer rank, the rolling panel and the delta all judge one record."
  - "`rollingWindow` state is a row count or the string id `365D`, so the option cannot be read as a 63/126/252 row count; `WINDOW_LABEL` is untouched."
requirements-completed: [TRUST-05]
status: complete
commits: 3
plan_head_before: 91ffad9446edd88ae1ddd475d0788517599fe01c
plan_head_after: 0039dbfd2d5f37b8366c17fbb2e82e540ee561c2
actuals:
  tokens: 30000
  tasks: 3
  commits: 3
---

# Phase 194 Plan 17: Scenario composer D-11 / D-15 gate and D-14's 365D window Summary

The three Scenario surfaces census R3 names now follow one rule: the blend's TOTAL record withholds, the window only qualifies with one muted note. The blend rolling panel also offers D-14's 365-calendar-day window.

## What was built

- **Benchmark section (Task 1, tracer).** `ScenarioBenchmarkSection` builds the blend record from `portfolioDaily` (first and last date, finite-return count) and its `periodsPerYear` prop, and gates Tracking Error, Information Ratio and Alpha with `gateAnnualized(record, spanDays(first paired date, last paired date))`. Withheld prints `—` and the `widenedWithheldReason("overlap", record)` note; short keeps the values and prints `widenedShortNote("overlap", days)`; Beta is untouched. The 30-paired-day floor and the three empty states run first, unchanged.
- **Rolling panel (Task 2).** `deriveBlendPanels(portfolioDaily, window, ppy)` takes a row count (byte-unchanged path) or `{ calendarDays }`, which runs plan 23's `rollingCalendarStats` on the same dates and returns at the same basis. The composer computes `gateRollingWindow(blendRecord, dates, spec, enough)` once per render: withheld (cause `gate` or `record`) shows the existing `PartialDataBanner` with `widenedWithheldReason("rolling" | "rolling-record", blendRecord)`; short draws the charts under `blend-rolling-annualization-note`; the filled calendar window draws plain. The toggle gains one `365D` option after 3M/6M/12M.
- **Own-book delta (Task 3).** The memo adds `span_days = shorterSpan(blend overlap span, book span)` and `records: { blend: blendRecord, book: figureRecord(... blendBasis) }`, with `blendRecord` in its dependency list. Plan 16's panel reads both.

## Neuter, RED, restore (cp -p byte backups, cmp clean after each)

Task 1
1. Paired-span-only gate (withhold when the paired span is under 365): `AssertionError: expected '—' not to be '—'` in the 400-day-record / 100-day-pairing case and in the non-crypto 60-return case (2 failed | 11 passed). Note: the plan's literal reading, building the record from the paired dates, does not bite on the 100-day case (99 days clears the 90-day crypto bound the same way), so the neuter used is the superseded D-11 rule (a paired span under one year withholds), which is what the case guards against.
2. Record built with `periodsPerYear: 252` regardless of the prop: `AssertionError: expected '+32.30%' to be '—'` in the crypto 60-return case (1 failed | 12 passed).

Task 2
1. Any window under one year withheld: `AssertionError: expected false to be true` in the 126-window, 63-window and traditional-70-observation cases (3 failed | 5 passed).
2. 365D mapped to a 365-row window: `AssertionError: expected [ { date: '2024-12-30', …(1) }, …(35) ] to deeply equal [ { date: '2024-12-31', …(1) }, …(34) ]` in the calendar-series case (1 failed | 7 passed).

Task 3
1. Longer span instead of `shorterSpan`: `AssertionError: expected 399 to be 59`, `expected 299 to be 199`, `expected 399 to be 84` (3 failed | 10 passed).
2. `records` omitted: `AssertionError: expected null to be 'Changes in annualized figures appear …'` in the 60-day withheld case (the rail prints no note on an absent record), plus `TypeError` reads of the missing records in the other two (3 failed | 10 passed).

## Verification

- `vitest run` on ScenarioBenchmarkSection, scenario-benchmark, ScenarioComposer.d11, ScenarioComposer, added-metrics, save, scenario-blend-adapter: all green. `vitest run` over `src/app/(dashboard)/allocations`, `src/lib/scenario*`, scenario-share: 178 files, 3007 tests passed.
- `npm run typecheck` clean; `eslint` clean on every touched file; every acceptance literal present.
- The existing `ScenarioComposer.test.tsx` (463 tests) and every existing `scenario-blend-adapter.test.ts` case pass unchanged.

## Deviations from Plan

None that change behaviour. Two plan wordings read literally did not fit the code, both recorded:

- **[Plan wording] Task 1 neuter 1.** See above: the paired-span-only record gate does not bite; the superseded-rule neuter does.
- **[Plan wording] Task 2, traditional blend "with the 63 window".** A 60-observation blend leaves the 63 option disabled (`usableN < 63`), so it cannot be selected. The "no full window, cause `record`, never `gate`" case is pinned with the default 126 and with 365D, and a 70-observation traditional blend pins that the 63 window IS drawn (60 observations clear D-15) with its own-span note.

## Assumptions recorded

- A-194-17-01: the 365D option is never disabled (a short record is told why in the body rather than the control going inert).
- A-194-17-02: for the calendar window `enough` is the dates spanning 365 days; `gateRollingWindow` additionally checks `record.spanDays`, and the two agree on the blend because both read the same overlap dates.
- The Scenario histogram and quantiles ride the same `deriveBlendPanels` call, so selecting 365D no longer blanks them on a record shorter than the row window (the calendar path only guards non-finite data and the 10-point floor).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; the figures are display-gated from the dates each is computed over (T-194-33).

## Notes

- `scenario-share` mounts `ScenarioBenchmarkSection` and inherits the gate; that page is 194.1's and is not tested here.
- A shared scratchpad file named `bench.bak` existed from another session and was overwritten by this run's first backup before it was noticed; all later backups used a private `p17x/` subdirectory. Nothing in the repo is affected.

## Self-Check: PASSED

Commits 6487140b7, 46df4ab06, 0039dbfd2 verified ancestors of HEAD; `git rev-list --count` from the recorded base is 3; all five modified files and the one created file exist.
