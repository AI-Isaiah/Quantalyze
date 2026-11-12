---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 38
subsystem: ui
tags: [plainwords, dates, formatDay, strategy-wizard, gap-closure, f-11, d-11, clar-06]
requires: ["201-24"]
provides:
  - "a CSV track record's date range reads `Jan 2, 2025 – Jan 2, 2026` on the Preview, Submit and Review steps alike"
  - "the composite success paragraph, the attribution window column and every coverage bar's accessible name print through formatDay"
  - "a verified key's collapsed summary reads `Jan 1, 2024 – live` or `Aug 3, 2025 – Sep 30, 2025`"
  - "a render test for the CSV Preview pill, which had none"
affects: []
tech-stack:
  added: []
  patterns: ["wrap formatDay at the print position only; the open end ('live') is decided outside the helper call"]
key-files:
  created:
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.date-range.test.tsx
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/ReviewStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx
    - src/app/(dashboard)/allocations/components/CoverageTimeline.tsx
    - src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx
    - e2e/csv-upload-flow.spec.ts
decisions:
  - "The CSV Preview pill prints through formatDay under F-11, superseding QA ISSUE-014 for the pill only; the sample-row cells keep the file's own ISO form (D-11 exemption) and formatPreviewCell is unchanged."
  - "The open-window word 'live' is decided outside the formatDay call at both sites (windowText tier 2 and the key summary), because formatDay(null) prints an em dash."
status: complete
plan_head_before: 95bf90ac7f0a1a7e3dabee322bf42a45678f2d15
plan_head_after: cc53207cfb62dc6db17ca3f3f77dd45a841f92c5
commits: 4
actuals:
  tokens: 30000
  tasks: 3
  commits: 4
---

# Phase 201 Plan 38: strategy-wizard date gap (SC-3, F-11) Summary

Every date the strategy wizard prints or announces in copy now goes through `formatDay` in the UI-SPEC range form (`Jan 2, 2025 – Jan 2, 2026`). The open end still reads "live". Inputs, payloads and the gantt geometry stay ISO.

## What changed

- **Task 1 (tracer), `22e42aa69`:** `ReviewStep`, `CsvPreviewStep` and `CsvSubmitStep` print both ends of the CSV range through `formatDay`, joined by a spaced en dash (the arrow is gone). `ReviewStep.test.tsx` and `CsvSubmitStep.test.tsx` carry the helper's literal form plus a negative ISO assertion. The new `CsvPreviewStep.date-range.test.tsx` pins the pill and also pins that the sample-row table keeps the ISO cells. The e2e step-7 literal is now `Jan 5, 2026 – Jan 9, 2026`. The `formatPreviewCell` docblock keeps the ISSUE-014 lineage and records the F-11 split.
- **Task 2, `02a48dc56` and `962f34415`:** `SyncPreviewStep` prints `rangeClause` and `windowText` (tier 1, and tier 2 with "live" outside the call) through `formatDay`, and the window `<td>` carries `whitespace-nowrap`. `CoverageTimeline` prints each bar's accessible name through `formatDay` (`Key A: covers Jan 1, 2025 – Jan 7, 2025, in blend`); the union endpoint labels stay ISO (D-21). New arms: success paragraph (it had no test) and the tier-3 em dash. The second commit moves the "live" decision into a named `declaredEnd` const and splits the bar label across two lines, so the plan's line-count acceptance greps read as written.
- **Task 3, `cc53207cf`:** the `key-N-summary` window span prints the start through `formatDay` and the end through it only when the window is closed. Summary arms re-pinned with negative ISO assertions, and the editing `<input type="date">` value is pinned to stay `2024-01-01`.

## Verification (real output)

| Command | Result |
|---|---|
| `node scripts/verify-plan-anchors.mjs <plan>` | exit 0, 8 claims, no stale claims |
| Task 1 vitest (ReviewStep, CsvPreviewStep*, CsvSubmitStep*) | 5 files, 54 passed, 0 failed |
| Task 2 vitest (SyncPreviewStep*, CoverageTimeline, ScenarioComposer) | 15 files, 706 passed, 0 failed |
| Task 3 vitest (MultiKeyConnectStep*, SyncPreviewStep.composite.render, ReviewStep, copy-census) | 6 files, 184 passed, 0 failed |
| `npx eslint` on the six source files | exit 0, clean |
| `npm run typecheck` | exit 0 |
| Plan acceptance greps | `csv.dateRange[..]}` 0, `preview.date_range[..]}` 0 in both CSV files, old e2e arrow literal 0 and new literal 1, SyncPreviewStep raw `${...}` prints 0, `covers ${first}` 0, `formatDay(` lines in CoverageTimeline 2, `{p.windowStart} – {p.stillLive` 0, `formatDay(p.window` lines 2 |

Initial RED against HEAD (before any source edit): Task 1 3 failed, Task 2 7 failed, Task 3 2 failed, each failing on the missing helper form.

`gc-201-38-neuter: gate=ReviewStep.test.tsx site=ReviewStep.tsx result=red restored=identical`
`  RED line: Unable to find an element with the text: Jan 2, 2025 – Jan 2, 2026 (first end printed raw again); cp -p restore, cmp exit 0, 11/11 green`
`gc-201-38-neuter: gate=SyncPreviewStep.composite.render.test.tsx site=SyncPreviewStep.tsx result=red restored=identical`
`  RED line: Unable to find an element with the text: Aug 3, 2025 – live and Aug 3, 2025 – Sep 30, 2025 (tier-2 start printed raw); cmp exit 0`
`gc-201-38-neuter: gate=CoverageTimeline.test.tsx + SyncPreviewStep.composite.render.test.tsx site=CoverageTimeline.tsx result=red restored=identical`
`  RED line: the CoverageTimeline aria-label arm and Unable to find an accessible element with the role "img" and name "Key A: covers Jan 1, 2025 – Jan 7, 2025, in blend"; cmp exit 0`
`gc-201-38-neuter: gate=MultiKeyConnectStep.test.tsx site=MultiKeyConnectStep.tsx result=red restored=identical`
`  RED line: both summary arms (verified-summary POST arm, rehydrate arm) failed with the raw start printed; cmp exit 0`
`gc-201-38-neuter: gate=live-arms (T-201-54) site=MultiKeyConnectStep.tsx + SyncPreviewStep.tsx result=red restored=identical`
`  RED line: with "live" replaced by formatDay of the end (em dash), the open-window arms in the key summary and the window column failed (3 tests); cmp exit 0 on both files`
`gc-201-38-gates: vitest=green eslint=clean tsc=clean`

`csv-preview-split:` The CSV Preview step's "Date range" pill now reads `Apr 3, 2025 – May 6, 2026` (formatDay), reversing QA ISSUE-014's "pill is ISO" choice for the pill. The sample-row table beside it still prints the file's own ISO cells (`2025-04-03`), a D-11 exemption. `formatPreviewCell` and `CsvPreviewStep.test.ts` are unchanged. The orchestrator may want to surface this to the founder.

## Deviations from Plan

None to the plan's behavior. Notes:

- **[Scope, own test]** Global negative-ISO assertions (`queryByText(/\d{4}-\d{2}-\d{2}/)`) in the composite window-column arms matched the gantt's union endpoint labels, which are D-21 exempt and stay ISO. I scoped each negative assertion to the window cell. This was found during Task 2 while writing tests, not a source change.
- **[Acceptance form]** The plan's grep-count acceptance criteria count lines, so the "live" decision in `windowText` became a named `declaredEnd` const and the bar label template was split over two lines. Behavior is identical (second Task 2 commit `962f34415`).
- The tier-3 em dash arm uses a member fixture with an empty `window_start`, the falsy state `member?.windowStart` guards.

## reported-not-edited

None. No phase-200 file was touched (`ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `AllocatorExchangeManager.tsx`, the shared Modal, `e2e/manager-keys.spec.ts`, `ci.yml`).

## Notes

- Playwright was not run locally (as planned); the one e2e literal edit is proven by grep and runs in CI.
- Other `YYYY-MM-DD → YYYY-MM-DD` strings that remain under `src/` are test comments, gap-list test titles in `chart-gaps.test.tsx` (not this plan's files) and the exempt fixtures.

## Known Stubs

None.

## Threat Flags

None. T-201-54 is mitigated and neutered RED (the "live" arms); T-201-55 holds (`firstDay`, `lastDay`, `activeWindow`, `pctOf` and the payload fields are untouched; composite render and ScenarioComposer suites green).

## Self-Check: PASSED

All four commits (`22e42aa69`, `02a48dc56`, `962f34415`, `cc53207cf`) are ancestors of HEAD, `CsvPreviewStep.date-range.test.tsx` is tracked, and the worktree was clean before this SUMMARY.
