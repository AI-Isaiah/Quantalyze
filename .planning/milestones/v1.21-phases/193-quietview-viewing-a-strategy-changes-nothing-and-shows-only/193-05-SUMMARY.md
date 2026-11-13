---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
plan: 05
subsystem: ui
tags: [factsheet, range, trust-02, trust-03, d-03, d-04, accessibility, focus]
status: complete

requires: []
provides:
  - "RangeEyebrow carries a one-click 'Reset to full history' (data-testid range-reset-strip / range-reset-rail) while a range is selected, on the KPI strip and at the top of the metrics rail"
  - "The MetricsColumn peer gate mounts PeerPercentilePanel only for the scenario blend"
affects: [193-06 deletions, phase 195 TRIM (FactsheetView.tsx was not touched)]

actuals:
  tokens: 6400
  tasks: 2
  commits: 2
plan_head_before: 35fefaa37465c65a1464548a8f24a224e9fb6141
plan_head_after: e4b6a188ce220c55635cdfe6b43a14e2c95929eb

tech-stack:
  added: []
  patterns: ["a control that unmounts on its own click hands focus to a tabIndex=-1 sibling label before it disappears (WCAG 2.4.3)"]

key-files:
  created: []
  modified:
    - "src/app/factsheet/[id]/v2/MetricsColumn.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx"
    - "src/app/factsheet/[id]/v2/MetricsColumn.window.test.tsx"

key-decisions:
  - "Label wording kept byte-identical (Selected range / Full history); no second 'Showing' line (UI-SPEC A-1)"
  - "The reset lives in the shared RangeEyebrow so the strip, the rail and the scenario composer cannot drift; FactsheetView.tsx needs no edit (UI-SPEC A-7)"
  - "No analytics event on the new control (UI-SPEC A-6); the ControlBar Reset view keeps its own event and behaviour"

requirements-completed: [TRUST-02, TRUST-03]

duration: 12min
completed: 2026-11-07
---

# Phase 193 Plan 05: RangeEyebrow reset to full history Summary

A narrowed range now names its dates and offers a one-click way back to the full history on both the KPI strip and the metrics rail, using the ControlBar recipe, and the metrics rail no longer mounts the demo-cohort peer panel.

## What was built

- `RangeEyebrow` (`MetricsColumn.tsx`): a wrapping `flex flex-wrap items-center gap-x-3 gap-y-1` row (the `className` prop, e.g. the strip's `mt-6`, moved onto it), the existing label `<p>` (text unchanged, now `ref` + `tabIndex={-1}`), and, only when `scope.kind === "selected"`, a `<button type="button">` with the ControlBar `Reset view` class string byte for byte plus `factsheet-v2-no-print`. Its click calls `resetXRange()` and then `labelRef.current?.focus()`, because the button unmounts as soon as the range is full.
- Peer gate (D-04): `PeerPercentilePanel` mounts only for `scenarioMode && ingestSource === "csv" && scenarioPeer != null`; the api disjunct and its comment are gone.

## Task commits

1. Task 1 (tracer, strip): `7ef8a385e` feat(193-05): a narrowed range offers Reset to full history beside its label (D-03)
2. Task 2 (rail + peer gate): `e4b6a188c` feat(193-05): the rail's reset and the peer gate without its api arm (D-03, D-04)

## RED first

- Task 1, strip (`FactsheetView.window-kpis.test.tsx -t "RangeEyebrow reset"`, HEAD bytes): 4 failed, 2 passed, 16 skipped. Failing: selected range shows the control on both surfaces; one click resets and focuses the label; the className sits on a wrapping row; one index short and the 5-sample minimum show the reset.
- Task 2, rail (`MetricsColumn.window.test.tsx`, pre-fix `MetricsColumn.tsx`): 1 failed, 10 passed. Failing: "the rail's Reset to full history returns the full history and keeps focus on the label (D-03)".

## HEAD-green pins (named, as the plan requires)

- `at full history no reset control renders on either surface (D-03)`
- `a range equal to the full history shows no reset (D-03)`

Both pass at HEAD because HEAD renders no reset button at all; their assertions are absences. They are shown able to fail by the always-render mutant below.

## Neuter and mutant runs

- Neuter (pre-fix `MetricsColumn.tsx` copied in, `window-kpis` + `MetricsColumn.window`): 5 failed, 28 passed. The 5 are every D-03 case except the two pins (4 strip cases + the rail case); the two pins pass under the pre-fix bytes, as at HEAD. Restored from the `.post` backup, `cmp` identical.
- Always-render mutant (copy of `.post` with `{scope.kind === "selected" && (` replaced by `{true && (`; `diff` against `.post` shows exactly one changed line): `window-kpis` 3 failed, 19 passed. Failing: both pins (`at full history no reset control renders…`, `a range equal to the full history shows no reset…`) and the click case (the control stays mounted after the reset). Restored from `.post`, `cmp` identical; both files rerun green (33 passed).

Scratch backups under `<session scratchpad>/193/qv05/`.

## Verification (real counts)

- `window-kpis` + `MetricsColumn.window` + `FactsheetBody.degenerate` + `FactsheetBody.scenario-mode` + `strategy-v2-type-scale` + `display-sign-single-source`: 6 files, 83 passed, 0 failed, 0 skipped.
- Whole `src/app/factsheet/[id]/v2` directory + `src/lib/factsheet/audit-c20.test.ts` + `src/app/(dashboard)/allocations`: 265 files, 4141 passed, 0 failed, 0 skipped.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: 0 errors, 2 warnings (not introduced here: `nativeUnitReason` unused in `MetricsColumn.tsx` is present in the pre-edit file). All repo check scripts OK.
- `FactsheetView.tsx` unchanged by this plan (`git diff` empty).

## Deviations from Plan

None - plan executed exactly as written. One note: the Task 1 `<automated>` verify chain is relative-pathed and ran as written; the Task 2 tail (`cmp` against `.post`) was run with `QV_SP` pointed at the orchestrator's scratchpad directory instead of the plan's `/tmp` default.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file access or schema change. T-193-12 (label and reset from the same RangeScope) and T-193-13 (peer gate api arm removed) are mitigated as planned.

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, `FactsheetView.window-kpis.test.tsx`, `MetricsColumn.window.test.tsx`: present.
- Commits `7ef8a385e` and `e4b6a188c` are ancestors of HEAD; `git rev-list --count` over the ledger base gives 2.
- STATE.md and ROADMAP.md not modified or staged by this plan.
