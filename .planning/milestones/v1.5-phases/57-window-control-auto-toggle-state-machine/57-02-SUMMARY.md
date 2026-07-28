---
phase: 57-window-control-auto-toggle-state-machine
plan: 02
subsystem: allocations-scenario-tab
tags: [react, coverage-window, scenario-blend, ephemeral-state, custom-range-picker, polish-01]

# Dependency graph
requires:
  - phase: 57-01
    provides: "unionOf / outlierIdsFor window helpers (Full range preset target + empty-intersection outlier source)"
  - phase: 55-coverage-window-compute-core
    provides: "computeScenario optional state.window honouring + scenario-window primitives (coverageSpanOf, defaultWindowFor, covers, intersectionOf)"
provides:
  - "ScenarioComposer passes an EXPLICIT state.window to computeScenario POST-collapse — the scenario tab's coverage-window blend is now user-visible (first phase to pass a window)"
  - "ephemeral winStart/winEnd composer state (default = intersection via defaultWindowFor), seeded once via windowTouchedRef (never re-snaps a user narrow)"
  - "CustomRangePicker window control (reused verbatim) + two preset buttons (Common period = intersection, Full range = union)"
  - "POLISH-01 separation guard proving the coverage window is distinct from rollingWindow, the factsheet brush-zoom, and per-strategy startDates"
affects: [57-03, ScenarioComposer, coverageEligible-derivation, auto-excluded-group, empty-intersection-banner]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Post-collapse window injection — the collapse reconstructs ScenarioState and drops state.window, so the window is injected onto deAliased.state immediately before computeScenario (the smaller, lower-risk of the two hazard fixes)"
    - "One-time lazy default seed via a windowTouchedRef flag — defaultWindowFor is the INITIAL seed + preset target only, never a controlled value (Pitfall 3: never re-snap a user narrow)"
    - "Span derivation from the POST-collapse strategy set (deAliased.strategies) so the UI's window derivation and the engine's membership run on the SAME set (Pitfall 2: no pre/post-collapse desync)"
    - "Engine-arg recorder test seam — @/lib/scenario stays REAL (member_count oracle) but computeScenario is wrapped to capture the exact state arg (proves the no-window-key union path + startDates stability)"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx — winStart/winEnd + windowTouchedRef + pickerOpen state; selectedSpans/windowBounds/commonPeriodWindow/fullRangeWindow memos; seed effect; post-collapse window injection at the scenarioMetrics memo; CustomRangePicker window control + 2 preset buttons"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx — capturing CustomRangePicker mock + computeScenario engine-arg recorder; 4 window (WINDOW-01/hazard) + 5 preset (WINDOW-04/05) + 4 POLISH-01 guard tests"

key-decisions:
  - "Injected the window POST-collapse onto deAliased.state (not extended collapseAliasedHoldingStrategies) — 1-line seam, no touch to the de-alias contract or its tests (RESEARCH A2/Pitfall 1)."
  - "Coverage spans derived from deAliased.strategies (the exact set computeScenario blends) not the pre-collapse adapter set — keeps the UI window and the engine membership on one set."
  - "Window state is composer-local useState (ephemeral) — NOT in useScenarioState/ScenarioDraft; SCENARIO_SCHEMA_VERSION unchanged (grep-verified 15 hits, still v2). Persistence is Phase 59."
  - "Included the CustomRangePicker MOUNT in the Task-1 commit (not deferred to Task 2) because the mandatory member_count-changes proof needs a window-change affordance; Task 2 added the two presets on top."
  - "Picker mount bounds: min = union earliest first, max = max(union latest last, today) — a still-running strategy can always be windowed to the present. Local-midnight Dates ONLY at the picker boundary via dateday helpers."

patterns-established:
  - "Post-collapse window injection as the canonical seam for any per-render engine-state field the collapse drops"
  - "windowTouchedRef one-time-seed guard as the anti-re-snap pattern for a default-derived-but-user-editable value"

requirements-completed: [WINDOW-01, WINDOW-04, WINDOW-05, POLISH-01]

# Metrics
duration: 21min
completed: 2026-07-01
---

# Phase 57 Plan 02: Coverage-window control + post-collapse engine injection Summary

**The scenario tab now passes an EXPLICIT `state.window` to `computeScenario` — injected POST-collapse onto `deAliased.state` to defeat the `collapseAliasedHoldingStrategies` window-drop hazard — defaulting to the intersection window (seeded once), steered by a reused `CustomRangePicker` plus "Common period (all in)" / "Full range (some drop out)" presets, with a POLISH-01 guard proving the coverage window stays a distinct axis from the rolling window, the factsheet brush-zoom, and per-strategy startDates.**

## Performance
- **Duration:** ~21 min
- **Started:** 2026-07-01T16:16:03Z
- **Completed:** 2026-07-01T16:37:22Z
- **Tasks:** 3 (Tasks 1-2 TDD RED→GREEN; Task 3 test-only guard)
- **Files modified:** 2

## Accomplishments
- **Task 1 (WINDOW-01, the hazard fix):** added ephemeral `winStart`/`winEnd` composer `useState` (NOT in `ScenarioDraft`), seeded ONCE from `defaultWindowFor(selectedSpans)` via a `windowTouchedRef` guard (never re-snaps a user narrow — Pitfall 3), and injected the window onto `deAliased.state` **after** the collapse, immediately before `computeScenario` (Pitfall 1: the collapse silently drops `state.window`). The MANDATORY proof passes: `scenarioMetrics.member_count` goes 2→1 when the window widens past the short-span strategy's last day and 1→2 when it narrows back. A companion test asserts the union path is preserved (no `window` key) on an empty intersection.
- **Task 2 (WINDOW-04/05):** mounted the reused `CustomRangePicker` (verbatim, no fork) as the window control with union min/max bounds + intersection `initialRange`, and added two labeled preset buttons — "Common period (all in)" → `defaultWindowFor` (intersection, all in) and "Full range (some drop out)" → `unionOf` (union, non-covering members auto-drop via the engine's `covers` gate). "Common period" is `disabled` + `aria-disabled` with an explainer on an empty intersection; "Full range" stays enabled. DESIGN.md-conformant (Secondary/border buttons, 6px `rounded-md`, `text-fixed-*` tokens — no raw px, 150ms hover + `motion-reduce:transition-none`), every control accessibly labeled.
- **Task 3 (POLISH-01, LOCKED):** a 4-test guard proving the coverage window is a distinct axis — (a) a rolling-window (3M/6M/12M) change leaves `state.window` and the readout unchanged; (b) `ScenarioFactsheetChart` receives no coverage-window / `persist` prop (runtime + source guard) and the brush stays `persist={false}`; (c) a coverage-window change leaves `rollingWindow` state and per-strategy `startDates` untouched.

## Task Commits
1. **Task 1: window state + post-collapse injection (WINDOW-01, hazard fix)** — `4dcc92c9` (feat)
2. **Task 2: Common period / Full range presets (WINDOW-04/05)** — `d051dbe1` (feat)
3. **Task 3: POLISH-01 separation guard** — `22866ae4` (test)

_`.planning/` is gitignored — this SUMMARY is local tracking only; only `src/` files were committed._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — added window imports (`scenario-window` helpers + `dateday` + `CustomRangePicker`); `winStart`/`winEnd`/`windowTouchedRef`/`pickerOpen` state near `rollingWindow` (:698); `selectedSpans`, `windowBounds`, `commonPeriodWindow`, `fullRangeWindow`, `coverageWindow` memos + the one-time seed `useEffect` + `applyWindow` callback around the `scenarioMetrics` memo; the post-collapse window injection inside `scenarioMetrics`; the window-control block (label + readout + 2 presets + Set-window trigger + picker mount) above the KpiStrip.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — a capturing `CustomRangePicker` mock (records `onApply` + min/max/initialRange) and a `@/lib/scenario` engine-arg recorder (keeps `computeScenario` REAL, captures the state arg); three new describe blocks: window/hazard (4), presets (5), POLISH-01 guard (4).

## Decisions Made
- **Post-collapse injection over extending the collapse** (RESEARCH A2): the 1-line `engineState = coverageWindow ? { ...deAliased.state, window } : deAliased.state` reaches the engine without touching the frozen-ish de-alias contract or its tests. Own-book callers stay on the union-when-absent path (window key omitted when `coverageWindow === null`).
- **Spans from the post-collapse set** (`deAliased.strategies`): the UI's window derivation and the engine's membership run on the identical strategy set, so the auto-excluded group (Plan 03) and the engine divisor can never disagree (Pitfall 2).
- **Ephemeral state, no schema bump:** window state is composer-local `useState`; `SCENARIO_SCHEMA_VERSION` is grep-confirmed unchanged (15 hits, still v2). Persistence is Phase 59.
- **Picker mount lives in Task 1:** the mandatory member_count-change proof requires a window-change affordance, so the `CustomRangePicker` mount + trigger shipped with Task 1; Task 2 layered the two presets on top.

## Deviations from Plan

None — plan executed as written. The one judgment call within the plan's own latitude: the `CustomRangePicker` mount was placed in the Task-1 commit (rather than deferred entirely to Task 2) so Task 1's mandatory `member_count`-changes assertion has a real window-change affordance to drive; Task 2 added only the two preset buttons on top. This is inside the plan's task boundaries (Task 1 owns "the window state + injection"; the picker is the sole window-set affordance), not a scope deviation. No Rule 1-4 deviations were invoked (no bugs, missing functionality, blockers, or architectural changes).

## Threat Model Coverage
- **T-57-03 (window silently not reaching the engine):** MITIGATED — post-collapse injection onto `deAliased.state` + the mandatory `member_count`-changes assertion (2→1 widen / 1→2 narrow) is the exact tell the RESEARCH names.
- **T-57-04 (malformed date input):** MITIGATED — `CustomRangePicker` reused verbatim; its `dateday.parseIsoDay` strict parse + min/max clamp are unchanged (no new input surface).
- **T-57-05 (coverage window leaking into the view brush-zoom):** MITIGATED — the POLISH-01 guard asserts the brush stays `persist={false}` and receives no coverage-window prop; rollingWindow/startDates untouched.
- **T-57-SC (package installs):** N/A — zero new dependencies (pure internal wiring).

## Issues Encountered
- **Rolling-window enabled-state confound (test-only):** narrowing the coverage window past the rolling floor drops the overlapping-day count, which correctly DISABLES the rolling option (loses `aria-pressed`). This is a downstream effect of fewer overlapping days, NOT a `rollingWindow`-state mutation. Resolved by using a 130-day fixture and a narrow that keeps ≥126 overlapping days so the 6M option's enabled state is not a confound — the assertion then cleanly proves the `rollingWindow` STATE is untouched.
- **`require("@/lib/scenario")` doesn't intercept the composer's bound import (RED iteration):** the composer binds `computeScenario` at import, so a runtime `vi.spyOn` on the module can't observe its calls. Switched to a top-level `vi.mock("@/lib/scenario", …)` that keeps `computeScenario` REAL but wraps it to record the `state` arg — the member_count oracle stays intact while the no-window-key assertion reads the exact arg.

## User Setup Required
None — pure client-side React wiring, zero new dependencies, no service/env config.

## Next Phase Readiness
- Plan 03 consumes exactly what this plan provides: `winStart`/`winEnd` + the `selectedSpans`/`coverageWindow` derivation are in place, so 57-03 can add the `coverageEligible` memo (the auto-excluded group), the auto-toggle animation, and the WINDOW-06 empty-intersection banner (using 57-01's `outlierIdsFor`) without re-deriving any interval math or re-wiring the engine call.
- The engine now receives an explicit window whenever a non-empty intersection exists; the union-when-absent path is preserved for empty intersections (WINDOW-06 banner, Plan 03).

## Verification
- `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` — 116 passed (incl. the member_count-changes hazard proof, preset tests, POLISH-01 guard).
- `npx vitest run src/lib/scenario-window.test.ts src/lib/scenario.test.ts src/lib/scenario-dealias.test.ts` — 97 passed (downstream engine/library suites unaffected).
- `npx tsc --noEmit` — clean (exit 0).
- `npm run test:coverage` — exit 0; 7284 passed / 288 skipped; coverage above all gates (lines 85.33 ≥ 82, stmts 83.2 ≥ 80, fns 79.55 ≥ 74, branches 76.08 ≥ 72).
- `npx eslint` on both modified files — clean (0 errors, 0 warnings), no raw-font-px introduced.

## TDD Gate Compliance
Tasks 1 and 2 are `tdd="true"` (task-level). RED was verified before GREEN for each:
- **Task 1 RED:** the MANDATORY member_count test failed (`pickerOnApply` null — no window control) before the state + injection + picker mount were added; GREEN after.
- **Task 2 RED:** the 5 preset tests failed (`getByRole("button", { name: /Common period/ })` not found + the `isoDayFromDate` import) before the preset buttons were added; GREEN after.
- No unexpected-pass-in-RED occurred. Task 3 is a pure guard test (no production code beyond Tasks 1-2), so no RED/GREEN cycle applies.

## Self-Check: PASSED
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND (contains `...deAliased.state` post-collapse injection at :1651; `defaultWindowFor`/`unionOf` usage; `CustomRangePicker` reuse — no new picker file)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — FOUND (window + preset + POLISH-01 describe blocks)
- Commit `4dcc92c9` (Task 1) — FOUND
- Commit `d051dbe1` (Task 2) — FOUND
- Commit `22866ae4` (Task 3) — FOUND
- `SCENARIO_SCHEMA_VERSION`/`schema_version` in `scenario-state.ts` — grep-verified unchanged (15 hits; still v2; no bump)

---
*Phase: 57-window-control-auto-toggle-state-machine*
*Completed: 2026-07-01*
