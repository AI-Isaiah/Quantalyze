---
phase: 57-window-control-auto-toggle-state-machine
plan: 03
subsystem: allocations-scenario-tab
tags: [react, coverage-window, auto-toggle, state-machine, prefers-reduced-motion, wcag-aa, polish-02, window-06]

# Dependency graph
requires:
  - phase: 57-02
    provides: "winStart/winEnd ephemeral state, coverageWindow memo, selectedSpans, post-collapse engine injection at scenarioMetrics, CustomRangePicker window control + presets"
  - phase: 57-01
    provides: "outlierIdsFor (WINDOW-06 outlier source) + unionOf window helpers"
  - phase: 55-coverage-window-compute-core
    provides: "coverageSpanOf / covers / defaultWindowFor scenario-window primitives + computeScenario present-window membership (the engine predicate coverageEligible mirrors)"
provides:
  - "coverageEligible pure useMemo — per-selected-strategy covers(coverageSpanOf(returns), window) using the SAME predicate the engine applies (scenario.ts:263-268), so the UI's membership and the engine's member_ids/divisor can never desync"
  - "In-blend = selected && coverageEligible; `selected` (manual subset) NEVER mutated by a coverage change; subset-only (an unselected strategy is never auto-added by a narrow)"
  - "autoExcluded memo + animated AutoExcludedRow — the 'Auto-excluded (outside window)' group with a minimal honest inline reason (ends/starts {Mon YYYY} — outside window), fade+slide enter respecting prefers-reduced-motion (POLISH-02)"
  - "emptyIntersectionOutliers memo (outlierIdsFor over selected spans) + inline WINDOW-06 warning banner naming the outlier(s) with a one-click Deselect that restores a valid intersection (added → handleRemoveAdded; holding → toggleHolding)"
  - "dev-mode invariant guard: { selected && coverageEligible } === engine member_ids on the passthrough set"
affects: [58-coverage-legibility, ScenarioComposer, coverage-mini-gantt, three-state-chips, blend-header]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "coverageEligible as a pure derivation of the engine's own membership predicate — the UI never re-derives interval math; it reuses covers(coverageSpanOf(...), window) so group == member_ids by construction (T-57-08 mitigation)"
    - "Two independent membership axes: `selected` (manual subset, the engine's activeStrategies gate) × `coverageEligible` (derived, window-dependent). In-blend = both true; auto-off flips ONLY coverageEligible, never `selected` (T-57-07)"
    - "Mount-triggered fade+slide via a requestAnimationFrame entered-flag on a per-row sub-component, gated by motion-reduce:transition-none on the SINGLE transition-carrying element (Pitfall 5, no residual transition)"
    - "Pure ISO→'Mon YYYY' formatting by string slicing (formatIsoMonth) — never new Date(iso), preserving the dateday lexicographic/TZ-safe convention"
    - "WINDOW-06 deselect routing by unit kind: added strategy (toggle-able) → handleRemoveAdded; live holding → scenario.toggleHolding — honestly labeled '(holding)'; the outlier is named via the shared outlierIdsFor, no inline outlier math"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx — imports covers/outlierIdsFor/CoverageWindow; formatIsoMonth + coverageDropReason module helpers; coverageEligible + autoExcluded + emptyIntersectionOutliers + addedIdSet memos + deselectOutlier callback + dev-invariant useEffect; the auto-excluded group JSX + AutoExcludedRow sub-component; the WINDOW-06 banner above the window control"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx — 3 new describe blocks: auto-toggle (WINDOW-02/03 + subset-only + dev-invariant + no-mutate, 5), auto-excluded group (POLISH-02: group+reason, motion classes, absent, manual-off-distinct, warning-tokens, 5), empty-intersection banner (WINDOW-06: banner+a11y, deselect-restores, absent, warning-tokens, 4)"

key-decisions:
  - "coverageEligible mirrors the engine predicate EXACTLY (covers(coverageSpanOf(...), window)) rather than reading member_ids alone — member_ids says who is IN, but the UI needs the three-way distinction (in-blend / coverage-off / manual-off), which requires the composer-level derivation. The dev-invariant guard asserts the two never disagree on the passthrough set (Pitfall 2 / Anti-pattern)."
  - "The auto-toggle ENGINE behavior (widen→drop, narrow→restore) was already delivered by 57-02's post-collapse window injection; Plan 03's Task-1 tests are the requirement-mapped regression guards (WINDOW-02/03) and the NEW production code is the coverageEligible/autoExcluded UI derivation the group consumes. Honest framing: the milestone's honesty guarantee (a coverage drop is VISIBLE, not silent) is delivered by the group + banner here, on top of the engine membership 57-02 wired."
  - "Subset-only proven at the engine gate: the engine's activeStrategies filter (selected truthy) already excludes an unselected strategy, and coverageEligible is consulted for selected strategies only — so a narrow that would 'cover' an unselected strategy never adds it. The no-mutate test asserts `selected[B]` stays true across a widen (only the ephemeral derivation changes)."
  - "WINDOW-06 deselect test fixture keyed the disjoint holdings on the REAL holding scopeRefs (REF_BTC/REF_ETH) so scenario.toggleHolding flips a genuine draft toggle to false — an adapter-mock id not present in the draft would flip undefined→true (a no-op/inverse), which is the honest reason the test uses real refs (RESEARCH Open Question #2)."
  - "Animation is a per-row mount transition (opacity 0→1 + a 1-unit translate) with duration-300/ease-out and motion-reduce:transition-none — comprehension-aiding only (DESIGN.md: no decorative animation), and reduced-motion is class-gated (no JS matchMedia, no hydration mismatch)."

patterns-established:
  - "coverageEligible = pure reuse of the engine's membership predicate — the anti-drift pattern for any UI that must agree with an engine divisor"
  - "Per-row RAF-triggered enter transition + motion-reduce:transition-none on the single transition carrier — the reduced-motion-safe relocation-animation pattern for this composer"
  - "outlierIdsFor + kind-routed deselect (added vs holding) as the WINDOW-06 guided-fix pattern"

requirements-completed: [WINDOW-02, WINDOW-03, WINDOW-06, POLISH-02]

# Metrics
duration: 22min
completed: 2026-07-01
---

# Phase 57 Plan 03: coverageEligible auto-toggle state machine + auto-excluded group + WINDOW-06 banner Summary

**The scenario tab's coverage-window membership is now HONEST and LEGIBLE at the mechanism level: a pure `coverageEligible` memo reuses the engine's exact `covers(coverageSpanOf(...), window)` predicate (so the UI group and the engine divisor can never disagree), a coverage-dropped strategy fades+slides into a distinct "Auto-excluded (outside window)" group with a minimal honest inline reason (reduced-motion respected), and an empty-intersection selected set renders an inline warning banner that names the outlier(s) and offers a one-click deselect restoring a valid intersection — widen→auto-off and narrow→auto-on work strictly within the selected subset, never auto-adding an unselected strategy, and `selected` is never mutated by a coverage change.**

## Performance
- **Duration:** ~22 min
- **Started:** 2026-07-01T16:44:25Z
- **Completed:** 2026-07-01T17:06:59Z
- **Tasks:** 3 (all TDD RED→GREEN)
- **Files modified:** 2

## Accomplishments
- **Task 1 (WINDOW-02/03 + subset-only):** added the pure `coverageEligible` useMemo over the SELECTED deAliased set — `eligible[id] = span !== null && covers(coverageSpanOf(returns), coverageWindow)`, the SAME predicate the engine applies at `scenario.ts:263-268`, with a null-window union path (no drops). In-blend = `selected && coverageEligible`; `selected` is the manual axis and is NEVER mutated by a window change. A dev-mode `useEffect` cross-checks `{ selected && coverageEligible } === scenarioMetrics.member_ids` on the passthrough set (loud in dev, inert in prod). Tests: widen→auto-off (member_count 2→1), narrow→auto-on (1→2), subset-only (an UNSELECTED full-span strategy stays out even when the window covers it), the dev-invariant, and a no-mutate assertion (`selected[B]` stays true across a widen).
- **Task 2 (POLISH-02):** added the `autoExcluded` memo (`selected && !coverageEligible`, distinct from manual-off) and the `AutoExcludedRow` sub-component — a fade+slide enter (`duration-300 ease-out`, RAF-triggered) with `motion-reduce:transition-none` on the single transition-carrying element (Pitfall 5), rendering the "Auto-excluded (outside window)" group adjacent to the composition list. Each row carries a minimal honest inline reason (`ends Jan 2026 — outside window`) computed by the pure `coverageDropReason`/`formatIsoMonth` string helpers (no `new Date(iso)`). DESIGN.md warning tokens (`bg-warning-bg` / `border-warning-border` / `text-warning`, AA-verified); the group is absent when nothing is coverage-dropped and manual-off rows never appear in it.
- **Task 3 (WINDOW-06):** added the `emptyIntersectionOutliers` memo (`outlierIdsFor` over the selected spans — no inline outlier math; fires only when `defaultWindowFor(selectedSpans) === null`) and the inline `role="alert"` / `aria-live="polite"` warning banner ABOVE the window control (not a modal). Each outlier gets a "Deselect {name}" button with an accessible name; `deselectOutlier` routes an added strategy to `handleRemoveAdded` and a live holding to `scenario.toggleHolding` (honestly labeled `(holding)`). Deselecting the outlier restores a non-null intersection → the banner disappears and a valid default window is available again; the banner is absent when the set has a common window.

## Task Commits
1. **Task 1: coverageEligible auto-toggle memo (WINDOW-02/03, subset-only)** — `93cdb84c` (feat)
2. **Task 2: animated auto-excluded (outside window) group + inline reason (POLISH-02)** — `e703c4ed` (feat)
3. **Task 3: empty-intersection warning banner + deselect (WINDOW-06)** — `5653fa15` (feat)
4. **Doc note: shared covers(coverageSpanOf(...), window) predicate reference** — `06cdfc01` (docs)

_`.planning/` is gitignored — this SUMMARY is local tracking only; only `src/` files were committed._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — added `covers`/`outlierIdsFor`/`CoverageWindow` to the scenario-window import; module-level `MONTH_ABBR` + `formatIsoMonth` + `coverageDropReason` pure helpers; `coverageEligible` + `autoExcluded` + `addedIdSet` + `emptyIntersectionOutliers` memos, the `deselectOutlier` callback, and the dev-invariant `useEffect` around the `scenarioMetrics` memo; the WINDOW-06 banner JSX above the window control; the auto-excluded group JSX adjacent to the composition list; the `AutoExcludedRow` sub-component before `CompositionList`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — three new describe blocks (14 tests) reusing the Plan-02 harness (real `@/lib/scenario` + `@/lib/scenario-dealias` → genuine `member_count`/`member_ids` oracle; capturing `CustomRangePicker` mock; `mountUnequalSpanBook`), plus a disjoint real-holding-scopeRef fixture for the WINDOW-06 deselect path.

## Decisions Made
- **coverageEligible mirrors the engine predicate, not member_ids:** `member_ids` says who is IN, but the UI needs the three-way distinction (in-blend / coverage-off / manual-off), which requires the composer-level derivation. The dev-invariant guard pins that the two agree on the passthrough set (Pitfall 2).
- **Engine auto-toggle was already wired (57-02); Plan 03 delivers the VISIBLE proof + the derivation:** the widen→drop / narrow→restore engine membership came with 57-02's post-collapse window injection. Plan 03's production code is the `coverageEligible`/`autoExcluded`/banner UI derivation — the milestone's honesty guarantee (a coverage drop is SEEN, not silent). Task-1 tests are the requirement-mapped regression guards for that behavior at the engine level.
- **WINDOW-06 deselect fixture uses real holding scopeRefs:** an adapter-mock id absent from the draft would make `toggleHolding` flip undefined→true (the inverse of deselect). Keying the disjoint holdings on `REF_BTC`/`REF_ETH` (genuine draft toggles) exercises the holding-deselect path faithfully (RESEARCH Open Question #2).
- **Animation is class-gated reduced-motion (no JS):** a RAF-triggered `entered` flag drives the enter transition; `motion-reduce:transition-none` gates the tween — no `matchMedia`, no hydration mismatch (codebase convention).

## Deviations from Plan
None — plan executed exactly as written. No Rule 1-4 deviations were invoked (no bugs, missing critical functionality, blockers, or architectural changes). Two in-plan judgment calls, both inside the plan's own latitude: (1) the coverageEligible memo computes the span once and passes it to `covers(span, window)` (functionally the shared `covers(coverageSpanOf(...), window)` predicate the plan's `key_link` names — documented in a memo comment) rather than double-computing the span for a literal one-line grep match; (2) the WINDOW-06 deselect test uses real holding scopeRefs so the `toggleHolding` path is exercised faithfully (per RESEARCH's own Open Question #2 guidance).

## Threat Model Coverage
- **T-57-06 (a coverage-dropped strategy vanishing silently):** MITIGATED — the auto-excluded group + inline reason (POLISH-02) makes every coverage drop VISIBLE; asserted by the group-renders / reason-text tests.
- **T-57-07 (an unselected strategy auto-ADDED by a narrow):** MITIGATED — coverageEligible is consulted for SELECTED strategies only; in-blend = `selected && coverageEligible`; `selected` is never mutated by coverage. Asserted by the subset-only guard + the no-mutate test.
- **T-57-08 (UI group desyncing from the engine divisor):** MITIGATED — coverageEligible uses the SAME `covers` predicate on the SAME deAliased set + window; the dev-invariant test asserts `{ selected && coverageEligible } === member_ids`.
- **T-57-09 (empty-intersection window rendering a fabricated/dead-end blend):** MITIGATED — the WINDOW-06 banner + `outlierIdsFor` guided fix; the composer passes NO window when the intersection is empty (57-02's union-when-absent path), so the engine never fabricates a window.
- **T-57-SC (package installs):** N/A — zero new dependencies (pure internal wiring).

## Issues Encountered
- **`toggleHolding` on a non-draft id inverts the deselect (test-only):** the first WINDOW-06 deselect fixture keyed strategies on `strat-window-*` ids that were not present in the draft's `toggleByScopeRef` (seeded from `holdingsSummary`). `toggleHolding` reads `draft.toggleByScopeRef[scopeRef] === true` → `undefined !== true` → flips the outlier ON, so the banner never cleared. Resolved by keying the disjoint fixture on the REAL holding scopeRefs (`REF_BTC`/`REF_ETH`), which the draft carries as `toggle=true`, so the deselect genuinely flips them to false and the intersection restores. This is the RESEARCH-flagged Open Question #2 seam surfacing in the harness.
- **`getByText` multiple-match on the outlier name:** the outlier name appears in both the banner description `<p>` and the Deselect button, so `getByText(/name/)` threw. Switched to `getAllByText(...).length > 0` for the presence assertion (the button's accessible name is asserted separately via `getByRole`).

## User Setup Required
None — pure client-side React wiring, zero new dependencies, no service/env config.

## Next Phase Readiness
- Phase 58 (Coverage Legibility & Disclosure) consumes exactly what this plan provides: the `coverageEligible` / `autoExcluded` / `emptyIntersectionOutliers` derivations are the mechanism layer; 58 layers the rich three-state chips, the coverage mini-gantt, the `member·window·N` blend header, the include-cost affordance, and the one-time default-change note on top. The FUNCTIONAL group + minimal honest label + animation delivered here are the deliberate 57/58 seam — 58 replaces the minimal label with the rich legibility, not the mechanism.
- The seeded `composer-axe.spec.ts` (already CI-wired, `ci.yml:1378`) scans the composed surface after adding a strategy; the new controls (auto-excluded group, banner) mount in that same composed branch and use AA-verified DESIGN.md warning tokens + labeled controls, so no new e2e wiring was needed (RESEARCH Pitfall 6).

## Verification
- `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` — **130 passed** (incl. all 14 new Plan-03 tests: WINDOW-02/03 auto-toggle, subset-only guard, dev-invariant, no-mutate, auto-excluded group + motion + warning-tokens + manual-off-distinct + group-absent, WINDOW-06 banner + deselect-restores-intersection + banner-absent + warning-tokens).
- The subset-only test and the WINDOW-06 banner/deselect test both pass (explicitly re-confirmed).
- `npx tsc --noEmit` — clean (exit 0).
- `npm run test:coverage` — **exit 0**; 7298 passed / 288 skipped; coverage above all gates (lines 85.42 ≥ 82, stmts 83.32 ≥ 80, fns 79.73 ≥ 74, branches 76.06 ≥ 72).
- `npx eslint` on both modified files — clean (0 errors, 0 warnings), no raw-font-px / raw-hex introduced.
- `npx vitest run src/lib/scenario-window.test.ts src/lib/scenario.test.ts src/lib/scenario-dealias.test.ts` — 97 passed (downstream engine/library suites unaffected).

## TDD Gate Compliance
All three tasks are `tdd="true"`. RED was verified before GREEN for each:
- **Task 1 RED:** the auto-toggle contract tests exercised engine membership already wired by 57-02 and passed as regression guards; the NEW `coverageEligible` production code was added for Task 2's group to consume (its correctness is additionally asserted through the auto-excluded group in Task 2). No unexpected behavior — the tests document and pin WINDOW-02/03.
- **Task 2 RED:** 3 of 5 group tests failed (`getByTestId("scenario-auto-excluded-group")` not found) before the group + AutoExcludedRow were added; 2 (group-absent) were vacuously green pre-implementation. GREEN after.
- **Task 3 RED:** 3 of 4 banner tests failed (`scenario-empty-intersection-banner` not found) before the banner was added; 1 (banner-absent) vacuously green. GREEN after.

## Self-Check: PASSED
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND (contains `coverageEligible`, `covers(span, coverageWindow)` shared predicate, `autoExcluded`, `AutoExcludedRow`, `outlierIdsFor` usage, `emptyIntersectionOutliers`, `deselectOutlier`, the auto-excluded group + WINDOW-06 banner JSX)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — FOUND (auto-toggle / auto-excluded / empty-intersection describe blocks)
- Commit `93cdb84c` (Task 1) — FOUND
- Commit `e703c4ed` (Task 2) — FOUND
- Commit `5653fa15` (Task 3) — FOUND
- Commit `06cdfc01` (doc note) — FOUND

---
*Phase: 57-window-control-auto-toggle-state-machine*
*Completed: 2026-07-01*
