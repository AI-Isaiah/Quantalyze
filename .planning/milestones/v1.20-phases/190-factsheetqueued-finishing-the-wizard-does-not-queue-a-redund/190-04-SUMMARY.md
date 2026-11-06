---
phase: 190-factsheetqueued
plan: 04
subsystem: factsheet
tags: [factsheet, updating-line, copy, ui-spec, d-03, d-06, fq190-updating]

requires:
  - phase: 190-03
    provides: FactsheetCommon.analyticsUpdating, set true by the resolve stage on a recompute over a stored result
provides:
  - ANALYTICS_UPDATING_LINE in status-surface-copy.ts, the single source of the updating copy, pinned verbatim
  - the factsheet-analytics-updating line in FactsheetHeader, rendered from payload.analyticsUpdating === true
  - FactsheetView.updating-line.test.tsx, UI-SPEC test contract items 1 to 5
affects: [190-08]

tech-stack:
  added: []
  patterns:
    - "a header sentence owned by the wrapper, never by FreshnessChip, so the chip/recency pair and F-4 stay intact"

key-files:
  created:
    - src/app/factsheet/[id]/v2/FactsheetView.updating-line.test.tsx
  modified:
    - src/lib/status-surface-copy.ts
    - src/lib/status-surface-copy.test.ts
    - src/app/factsheet/[id]/v2/FactsheetView.tsx

key-decisions:
  - "Copy is D-06 verbatim: Updating with the latest data. These figures are from the last completed computation. (85 chars, ASCII, no ellipsis, no time claim)."
  - "The line renders from the payload alone, so every lane (public, owner, share link, discovery detail) shows it identically."

requirements-completed: [SC-3, SC-6]

duration: ~15min
completed: 2026-11-03
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: 5e86c55dba334f520303a49bf9df76ea76bb0e17
plan_head_after: 2b74638e026b2c8a6f0cb611c2e7929654cc2e4e
---

# Phase 190 Plan 04: The factsheet updating line Summary

**One quiet muted caption in the factsheet header, after the recency line, rendered exactly while a re-run runs over stored figures, with the founder's D-06 wording pinned character for character.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Copy constant `ANALYTICS_UPDATING_LINE` and its verbatim pin | b99ddc17d |
| 2 | Render the line in FactsheetHeader; UI-SPEC test contract 1 to 5; can-fail proof | 2b74638e0 |

## What was built

- `ANALYTICS_UPDATING_LINE` (status-surface-copy.ts), with a JSDoc naming D-03, D-06 and FQ190-UPDATING and the reasons: "latest" not "new", no ellipsis, no date.
- Pin `FQ190-UPDATING` in status-surface-copy.test.ts against a literal typed in the test: exact text, length 85, trailing full stop, no U+2026, ASCII only, none of computing / pending / job / queue / minute / %.
- In `FactsheetHeader`, a plain `<p data-testid="factsheet-analytics-updating" className="mt-1 text-caption text-text-muted">` directly after `SeriesRecencyLine` and before `TradeFetchLine`, gated on `payload.analyticsUpdating === true`. No ARIA, no width cap, no truncation, no icon.
- Tests: 1 exact copy + class, 2 absent on false, 3 placement (after recency / before trade-fetch; directly after the chip when the series is empty), 4 F-1 and F-4 hold with the flag on, 5 no role / aria-live / aria-label and exactly one text-carrying node.

## Verification

- `vitest run` updating-line + recency-line + status-surface-copy: 3 files, 95 tests passed. `tests/a11y/design-token-drift.test.ts` passed (exists).
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 5 claims, exit 0.
- `npm run typecheck`: clean. `eslint` on the four touched files: 0 errors, 0 warnings. `npm run lint`: 0 errors; 2 warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, not touched by this plan (pre-existing from earlier phase 190 work on the base).

### Can-fail proof

RED for Task 1: before the export existed, `FQ190-UPDATING` failed (1 failed, 83 passed). RED for Task 2: with the component untouched, tests 1, 3, 5 failed (2 passed: 2 and 4, which only passed vacuously; test 4 was then tightened to assert the line is present).
Neutered run: byte-backed FactsheetView.tsx to the scratchpad, changed the render condition to `false && payload.analyticsUpdating === true && (`, reran: tests 1, 3, 4, 5 failed (4 failed, 1 passed; test 2, absence, passes by construction). Restored with `cp`; `cmp` printed nothing (identical); rerun: 5 passed.

### 390 px overflow check

No dev server was started (disk nearly full, no `next build`). Recorded as: measured in plan 08 SC-5 on PROD. The line uses the same classes as the sibling sentences (no max-w, truncate or whitespace-nowrap) so it wraps in the header's right column.

## Deviations from Plan

None - plan executed as written. One small addition: test 4 asserts the updating line is present, so it cannot pass vacuously in RED.

## Known pre-existing failure (not this plan)

`src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (last float digit of `skew` under local Node 25) were not run here; noted per the brief.

## Known Stubs

None.

## Threat Flags

None. T-190-09 mitigated: the line renders only from `payload.analyticsUpdating`, never client state; tests 1 and 2 pin presence and absence and demonstrably fail when neutered.

## Self-Check: PASSED

Files exist (constant, test, component edit); commits b99ddc17d and 2b74638e0 are ancestors of HEAD on feat/190-p04.
