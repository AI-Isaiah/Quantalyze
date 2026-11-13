---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
plan: 02
subsystem: ui
tags: [react, factsheet, wheel, zoom, trust, vitest]

requires:
  - phase: 193-quietview
    provides: "D-01 founder override (Ctrl+wheel zoom) recorded in 193-CONTEXT.md"
provides:
  - "isZoomWheel(e): the single Ctrl/Cmd predicate for chart wheel zoom"
  - "TimeSeriesChart and HistogramChart: a plain wheel changes nothing and is not default-prevented; Ctrl/Cmd + wheel zooms"
  - "New chart-help sentence, histogram hint, wrapping histogram legend row"
  - "ROADMAP Phase 193 SC-1 AMENDED line recording D-01"
affects: [193-03, 193-05, factsheet charts]

actuals:
  tokens: 2800
  tasks: 3
  commits: 3
plan_head_before: 08907d6e86a141ba657b834129c99adfbf623476
plan_head_after: 778ffd542b173334e499b04dcf9ccd79fe6a7f44

tech-stack:
  added: []
  patterns:
    - "One predicate (isZoomWheel) gating both the React onWheel and the native non-passive wheel listener"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/wheel-zoom.ts"
  modified:
    - "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx"
    - "src/app/factsheet/[id]/v2/HistogramChart.tsx"
    - "src/app/factsheet/[id]/v2/TimeSeriesChart.window-gesture.test.tsx"
    - "src/app/factsheet/[id]/v2/charts.signed-zero.test.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx"
    - ".planning/ROADMAP.md"

key-decisions:
  - "Gate both layers (React onWheel and the native non-passive listener) on one predicate, so a plain wheel neither narrows the range nor traps the page scroll"
  - "The histogram follows the same rule as the time-series charts (D-01 consistency reading)"

patterns-established:
  - "Wheel-gate tests capture the fireEvent.wheel return value: false means a listener called preventDefault"

requirements-completed: [TRUST-02]

duration: 5min
completed: 2026-11-07
status: complete

coverage:
  - id: D1
    description: "A plain wheel over a time-series chart leaves the range and the windowed view unchanged, starts no settle timer and is not default-prevented; Ctrl and Cmd + wheel zoom and are default-prevented"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/TimeSeriesChart.window-gesture.test.tsx#a plain wheel leaves the range alone and does not block the page scroll; Ctrl and Cmd still zoom (D-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The histogram follows the same rule; its hint reads 'Ctrl/Cmd + wheel to zoom · double-click to reset' and its legend row wraps"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/charts.signed-zero.test.tsx#a plain wheel leaves the histogram zoom alone and does not block the page scroll; the hint names Ctrl/Cmd (D-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "In a real browser a plain wheel scrolls the page and leaves the strip byte-identical; the histogram hint wraps and is not clipped at 390 px"
    requirement: "TRUST-02"
    verification: []
    human_judgment: true
    rationale: "jsdom cannot prove a native wheel scrolls the page (UI-SPEC E3 backstop); the plan carries it as a human-check"
  - id: D4
    description: "D-01 recorded in the ROADMAP Phase 193 section as a dated AMENDED line under SC-1"
    verification:
      - kind: other
        ref: "npx tsx scripts/check-planning-hygiene.ts (exit 0) and the plan Task 3 awk/grep verify"
        status: pass
    human_judgment: false
---

# Phase 193 Plan 02: QUIETVIEW wheel gate Summary

**A plain mouse wheel over a factsheet time-series chart or histogram now scrolls the page and changes nothing; Ctrl/Cmd + wheel zooms, enforced in both the React handler and the native non-passive listener by one `isZoomWheel` predicate.**

## Performance

- **Duration:** about 5 min
- **Started:** 2026-11-07T03:07:10Z
- **Completed:** 2026-11-07T03:11:29Z (SUMMARY committed after)
- **Tasks:** 3
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- `wheel-zoom.ts` exports `isZoomWheel`, the only place the Ctrl/Cmd condition is written.
- `TimeSeriesChart`: `onWheel` returns on a plain wheel before any work (no range change, no hold, no settle timer); the native listener cancels only a Ctrl/Cmd wheel, so the page scrolls over the chart. The `chart-help-*` sentence now reads `Hold Control or Command and turn the mouse wheel to zoom toward the cursor; the wheel alone scrolls the page.`
- `HistogramChart`: same two-layer gate; hint `Ctrl/Cmd + wheel to zoom · double-click to reset`; legend row `flex flex-wrap gap-3 gap-y-1 text-[11px]` so the longer hint wraps rather than clips.
- Four pre-existing plain-wheel test calls repointed to `ctrlKey: true` (the positive arms); two new D-01 cases added.
- ROADMAP Phase 193 SC-1 carries the dated AMENDED line (exactly one added line, `git diff --numstat` read `1 0`); hygiene script exits 0.

## Task Commits

1. **Task 1: Tracer, time-series chart (RED first)** - `2a18f8e86` (feat)
2. **Task 2: Histogram, hint/legend, repointed tests, neuter** - `53d0142a5` (feat)
3. **Task 3: ROADMAP D-01 AMENDED line** - `778ffd542` (docs)

**Plan metadata:** the SUMMARY commit that follows this file (docs).

## RED-first and neuter runs

- **Task 1 RED** (new case added, `ctrlKey: true` already on the two old wheel calls, no source change):
  `1 failed | 8 passed`. Failing assertion: `AssertionError: a plain wheel is not default-prevented: expected false to be true`. (Vitest stops at the first failing assertion, so the later `live()` equality was not reached in that run; the React-layer neuter below shows it fails independently.) GREEN after the fix: `9 passed`.
- **Task 2 RED** (histogram case added, no source change): `1 failed | 24 passed`, same first assertion `a plain wheel is not default-prevented: expected false to be true`. GREEN after the fix.
- **Neuter, both charts** (pre-fix bytes copied in from `quietview-193/*.pre`): `charts.signed-zero.test.tsx` and `TimeSeriesChart.window-gesture.test.tsx` gave `2 failed | 32 passed`; both D-01 cases failed on `a plain wheel is not default-prevented`. Restored from the `.post` copies; `cmp` byte-equal for both charts; rerun of the three wheel test files: `3 passed (3)`, `234 passed (234)`.
- **Per-layer neuter (extra, time-series chart):** React gate removed alone fails on `a plain wheel leaves the live range: expected [ 105, 193 ] to deeply equal [ 100, 199 ]`; native gate removed alone fails on `a plain wheel is not default-prevented`. Each layer's guard is independently able to fail. Restored from `.post`, `cmp` equal.

Scratch copies live outside the repo (the session scratchpad under `193/quietview-193/`).

## Final gates

- `npx vitest run` on the three wheel files: 3 files, 234 tests passed, 0 failed, 0 skipped.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: 0 errors, 2 warnings, both unused-variable warnings in files this plan did not touch (`MetricsColumn.tsx`, `src/lib/factsheet/composite-read-path.ts`; pre-existing, out of scope). The planning-hygiene, route and domain checks that follow ESLint in the script all printed OK.
- Plan-level checks: `isZoomWheel(` appears twice in each chart (React gate and native handler); the unconditional native cancel is gone from both.

## Decisions Made

None beyond the plan: D-01 was decided by the founder in CONTEXT; the histogram consistency reading and the predicate placement were specified by the plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None. The change removes a default-prevent on plain wheel events and adds no endpoint, auth path or schema.

## Human check still open (backstop, not executable here)

Open a factsheet in a desktop browser. A plain wheel over the Cumulative chart and over the Distribution of Daily Returns histogram should scroll the page and leave the strip's range label and every KPI value unchanged; Ctrl or Cmd + wheel should zoom, and the time-series label should switch to "Selected range". At 390 px the histogram hint should wrap under the legend names. This was not run (jsdom cannot prove a native wheel scrolls the page); it is the plan's declared `backstop` verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wheel part of SC-1 is done. Plans 193-03 (range persistence) and 193-05 (range label and reset) are independent of this one. STATE.md and the ROADMAP `Plans:` list were not touched, per the orchestrator's instruction.

## Self-Check: PASSED

- FOUND: `src/app/factsheet/[id]/v2/wheel-zoom.ts`
- FOUND commits: `2a18f8e86`, `53d0142a5`, `778ffd542` (ancestors of HEAD)

---
*Phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only*
*Completed: 2026-11-07*
