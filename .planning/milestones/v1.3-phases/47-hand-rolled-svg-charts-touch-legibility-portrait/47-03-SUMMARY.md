---
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
plan: 03
subsystem: ui
tags: [react, svg-charts, touch-gesture, useTapPin, useBreakpoint, ResponsiveChartFrame, pointer-events, heatmap, legibility, portrait, wcag-2.5.5, vitest]

# Dependency graph
requires:
  - phase: 47-01
    provides: "useTapPin shared tap-vs-drag + pin-toggle gesture hook ({ count, pointerToIndex } → { selectedIdx, pinned, svgRef, onPointer* })"
  - phase: 44 (primitives)
    provides: "ResponsiveChartFrame (viewBox/preserveAspectRatio recipe) + useBreakpoint (SSR-safe mobile/tablet/desktop)"
  - phase: 47-02
    provides: "the no-recompute desktop-literals contract + the global jsdom matchMedia stub in src/test-setup.ts + the both-branch viewport-test pattern"
provides:
  - "Touch tap-reveal/pin (CHART-01a) on the 3 firm desktop-value-reveal charts: StreakDistribution (AnalyticalPanels), DailyReturnsHeatmap (HeatmapPanels), DailyHeatmap (components/charts) — each tap reveals AND pins the SAME value the desktop hover/<title> shows, via the shared useTapPin hook with a per-chart pointerToIndex"
  - "320px legibility (CHART-02) + portrait (CHART-03) for those 3 charts + BootstrapCI (no-hover): mobile font bump + (StreakDist) fewer x-ticks + taller mobile viewBox / (DailyHeatmap) overflow-x-auto scroll region; desktop branch byte-identical"
  - "Pointer-coarse-ONLY ≥44px hit targets (WCAG 2.5.5): per-bar / per-row invisible interaction <rect>s (hidden pointer-coarse:block) + a pointer-coarse:min-h-[44px] calendar surface — visible cells/bars never resized, never on pointer-fine"
  - "tap-charts-viewport.test.tsx — Wave-2 both-branch component test holding the branch ratchet in-wave + a falsifiable desktop byte-identity (StreakDist viewBox pinned to 0 0 440 200) + a synthetic-touch-tap pinned-reveal assertion"
  - "Extended DailyHeatmap.test.tsx — SVG branch in BOTH isMobile arms + keep-all-cells + a synthetic-touch-tap pinned reveal == the <title> format"
affects:
  - "47-05 (Playwright desktop goldens + 320px portrait snapshots + extended target-size ≥44px gate): the desktop literals pinned in-wave here (StreakDist 0 0 440 200, BootstrapCI 0 0 340 36, DailyHeatmap 12px axis font + baked fills + <title> format) MUST stay byte-identical when goldens are baked; the ≥44px coarse hit-rects this plan adds are what the extended target-size gate measures"

# Tech tracking
tech-stack:
  added: []  # zero net-new npm deps (locked constraint)
  patterns:
    - "Consume useTapPin with a per-chart pointerToIndex: StreakDist maps clientX→bar; DailyReturnsHeatmap reuses the existing onPointerMove cell-lookup (flat wk*7+d); DailyHeatmap maps pointer→(rowIdx, doy)→nearest flat cell. The chart renders its OWN reveal from selectedIdx, reading the value from the precomputed payload (never recomputed)."
    - "Hook on a non-SVG interaction surface: DailyReturnsHeatmap's tap surface is the canvas wrapper <div>; a callback ref points the hook's svgRef at the div (the hook only calls getBoundingClientRect on it — div is runtime-safe) and the typed handlers are cast at the boundary. Composed handlers run BOTH the existing mouse onPointerMove AND the hook handler so desktop hover is preserved."
    - "Reveal = pinnedCell ?? hovered: the touch-pinned cell and the transient mouse-hover cell render through the SAME existing tooltip element with identical content/styling — no new accent surface."
    - "Pointer-coarse-only ≥44px hit layer: invisible interaction <rect>s with `hidden pointer-coarse:block` (StreakDist per-bar widened to ≥68 viewBox units; DailyHeatmap per-row ≥44 viewBox-unit band) so the desktop hover path stays byte-identical (the layer is display:none on pointer-fine) and the visible geometry is unchanged."

key-files:
  created:
    - src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
    - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
    - src/components/charts/DailyHeatmap.tsx
    - src/components/charts/DailyHeatmap.test.tsx

key-decisions:
  - "StreakDistribution pinned reveal = an in-svg <text> at the plot top showing the EXACT `Length …: … streak` copy the per-bar <title> shows (extracted into a shared streakLabel() so the <title> and the reveal can never drift). Kept the per-bar <title> (desktop mouse hover) untouched."
  - "DailyReturnsHeatmap renders a canvas + SVG-label overlay (not a ResponsiveChartFrame), so I did NOT RCF-wrap it — its responsive sizing is its own ResizeObserver `scale` (the locked exception). The tap reveal reuses the existing floating tooltip div (pinnedCell ?? hovered)."
  - "DailyHeatmap mobile legibility = the horizontal scroll region (overflow-x-auto + minWidth at mobile) + axis font 12→16, NOT a taller viewBox and NO row/col drop (RESEARCH: fontSize is already at the 12 floor; the wide 730px grid downscales labels, so scroll-not-shrink is the fix). The pinned cell additionally gets a stroke highlight (CHART_AXIS_TICK)."
  - "Extended DailyHeatmap.test.tsx with a vi.mock of useBreakpoint defaulting to 'desktop' in beforeEach so every pre-existing assertion (baked fills, <title>, canvas save/clear/restore ordering) keeps its desktop expectation; the 4 new tests drive both arms + the tap path."

patterns-established:
  - "Per-chart pointerToIndex + own-reveal: the 3 tap charts each supply a pointerToIndex mapping and render their own reveal from selectedIdx (heatmap cell / histogram bar), reusing the existing desktop value — the DRY consumption contract Plan 01's hook was built for."
  - "In-wave falsifiable desktop byte-identity: every new isMobile conditional has both arms exercised in the SAME wave + a desktop-literal assertion that FAILS on a literal mutation (proven by spot-mutation for both DailyHeatmap and the viewport test) — the in-wave half of the no-recompute proof (Plan 05 bakes the Playwright golden)."

requirements-completed: [CHART-01a, CHART-02, CHART-03]

# Metrics
duration: 32min
completed: 2026-06-27
---

# Phase 47 Plan 03: Tap-Reveal Charts (StreakDistribution / DailyReturnsHeatmap / DailyHeatmap) Summary

**Brought the THREE hand-rolled SVG charts with a real desktop value-reveal to touch tap-reveal/pin parity (CHART-01a) via the shared `useTapPin` hook — a tap reveals AND pins the SAME value the desktop hover/`<title>` shows, with pointer-coarse-only ≥44px hit targets — plus their 320px legibility (CHART-02) and portrait (CHART-03) tuning, while the desktop hover path and the desktop render stay byte-identical (every tuning gated behind `isMobile`; the hook fires only for `pointerType "touch"`), no value recomputed, and both viewport arms + the tap path covered in-wave so the BLOCKING branch ratchet (75.33% ≥ 72) holds.**

## Performance

- **Duration:** ~32 min
- **Completed:** 2026-06-27
- **Tasks:** 4
- **Files created:** 1 · **Files modified:** 4

## Accomplishments
- **StreakDistribution (AnalyticalPanels):** `StreakHist` consumes `useTapPin({ count: data.length, pointerToIndex })` (clientX→bar index). A tap reveals + pins the same `Length …: … streak` copy the per-bar `<title>` shows (shared `streakLabel()`). Mobile font 9→18 + fewer x-ticks + taller viewBox (200→280). Per-bar `pointer-coarse:`-only ≥44px interaction `<rect>` (column widened to ≥68 viewBox units). BootstrapCI (no hover) RCF-wrapped + taller mobile strip (36→56), legibility/portrait only.
- **DailyReturnsHeatmap (HeatmapPanels):** `YearCalendarCanvas` consumes `useTapPin`; `pointerToIndex` reuses the existing cell-lookup math (flat `wk*7+d` index, value from `year.cells`). The tap pins the same `{iso, v}` the desktop `onPointerMove` sets; the floating tooltip renders from `pinnedCell ?? hovered`. Desktop mouse hover preserved (composed handlers). Mobile overlay-label font 9/8 → 13/12; `pointer-coarse:min-h-[44px]` surface; kept its canvas `ResizeObserver` measure (locked exception).
- **DailyHeatmap (components/charts):** `SvgRenderer` consumes `useTapPin`; `pointerToIndex` maps pointer→(rowIdx, doy)→nearest flat cell; the pinned reveal reuses the `"{ISO}: {pct}%"` `<title>` format. Mobile legibility = `overflow-x-auto` scroll region + axis font 12→16 (NO taller viewBox, NO row/col drop). Per-row `pointer-coarse:`-only ≥44px hit band. No `fill-opacity` introduced; className strings unchanged → the type-scale lint stays green; canvas branch + its measure preserved.
- **Coverage held in-wave:** the extended `DailyHeatmap.test.tsx` (SVG branch in both arms + keep-all-cells + synthetic tap) and the new `tap-charts-viewport.test.tsx` (StreakDist + BootstrapCI + DailyReturnsHeatmap in both arms + synthetic StreakDist tap) exercise every new `isMobile`/tap branch. Full coverage: Statements 82.68 / **Branches 75.33 (≥72 BLOCKING)** / Functions 78.66 / Lines 84.85; full suite 6891 passed.
- **Frozen boundary untouched:** `TimeSeriesChart.tsx`, `scenario.ts`, `compute.ts` byte-identical; SCENARIO-05/BODY-02 green; only the 5 plan-named files changed; `npx tsc --noEmit` exit 0.

## Task Commits
1. **Task 1: AnalyticalPanels — StreakDistribution tap-reveal + BootstrapCI legibility/portrait** — `7082686b` (feat)
2. **Task 2: HeatmapPanels — DailyReturnsHeatmap cell tap-reveal + legibility/portrait** — `be7082c8` (feat)
3. **Task 3: DailyHeatmap — SVG-branch tap-reveal + mobile legibility (extend test)** — `f12197ee` (feat)
4. **Task 4: Wave-2 viewport-branch coverage test** — `8ecd1605` (test)

## Files Created/Modified
- `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` — StreakHist: RCF-wrap + useTapPin + mobile branch + coarse hit rects + pinned reveal; shared `streakLabel()`; BootHist RCF-wrap + taller mobile strip.
- `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` — YearCalendarCanvas: shared `cellAt()` lookup + useTapPin (flat index) + `pinnedCell` memo + composed mouse/touch handlers + `reveal = pinnedCell ?? hovered` + mobile overlay fonts + coarse min-h.
- `src/components/charts/DailyHeatmap.tsx` — SvgRenderer: `cellLabel()` + flat cell list + useTapPin (rowIdx/doy→nearest) + pinned reveal `<text>` + pinned-cell stroke + overflow-x-auto + mobile axis font + per-row coarse hit band.
- `src/components/charts/DailyHeatmap.test.tsx` — +4 Phase-47-03 tests (both arms, keep-all-cells, synthetic tap, no-default-reveal); vi.mock useBreakpoint defaulting desktop.
- `src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx` (NEW, 200 lines) — Wave-2 both-branch render (StreakDist + BootstrapCI + DailyReturnsHeatmap) + desktop byte-identity (0 0 440 200 / 0 0 340 36) + mobile-differs + synthetic StreakDist tap.

## Decisions Made
See `key-decisions` frontmatter. Headline: DailyReturnsHeatmap is NOT RCF-wrapped (its canvas `ResizeObserver` measure is the locked exception); its tap reveal reuses the existing floating tooltip via `pinnedCell ?? hovered`. DailyHeatmap's mobile fix is the scroll region (not a taller viewBox, no row/col drop). The ≥44px coarse hit targets are `hidden pointer-coarse:block` interaction layers so the desktop hover path is display:none on pointer-fine and byte-identical.

## Deviations from Plan

None — plan executed exactly as written.

The only non-mechanical choice was the heatmap `<div>` tap surface (the hook is typed for `SVGSVGElement` but DailyReturnsHeatmap's interaction element is the canvas wrapper `<div>`): I used a callback ref to point the hook's `svgRef` at the div (the hook only calls `getBoundingClientRect()` on it) and a single boundary cast for the handler types. This is the documented consumption of the Plan-01 hook on a 2D consumer (the hook was deliberately generalized to pass `clientY` for exactly this case), not a deviation.

## TDD Gate Compliance
Task 4 is `tdd="true"`. The plan type is `execute` (not a plan-level `tdd` gate), and the behavior under test (the panels' isMobile branches + tap path) was authored in Tasks 1–2 before the Task-4 test. The RED intent is satisfied by the **falsifiability proof**: mutating a desktop VB_H literal (`200→201` in AnalyticalPanels) made `tap-charts-viewport.test.tsx` FAIL (2 assertions), and the revert restored green — proving the byte-identity assertion can fail. The same spot-mutation proof was applied to the extended DailyHeatmap desktop-font assertion (`12→13` → FAIL → revert → green). Both reverts left the source byte-identical (verified: no `.bak` leftover; literals restored).

## Issues Encountered
- `act` is not exported from `vitest` (initial Task-3 test draft imported it). Switched to relying on `@testing-library/react`'s `fireEvent`, which wraps the dispatch in `act` internally — the tap-pin state flushes before the assertion. Resolved before the Task-3 commit.
- jsdom returns a 0-sized `getBoundingClientRect`, so the synthetic-tap tests stub the svg's rect to the viewBox dims so the pointer→viewBox→index math resolves to a real cell/bar. Standard jsdom pointer-geometry handling.

## User Setup Required
None — no external service configuration. Zero net-new npm dependencies (locked constraint).

## Next Phase Readiness
- **47-05** (Playwright desktop goldens + 320px portrait snapshots + extended ≥44px target-size gate): bake the desktop goldens from THIS state — the desktop literals pinned in-wave (StreakDist `0 0 440 200`, BootstrapCI `0 0 340 36`, DailyHeatmap 12px axis font + baked fills + `<title>` format) MUST stay byte-identical. Never `--update-snapshots` a desktop golden after tuning (Pitfall 2). The ≥44px `pointer-coarse:` hit-rects (StreakDist per-bar `hidden pointer-coarse:block`, DailyHeatmap per-row band, DailyReturnsHeatmap `pointer-coarse:min-h-[44px]`) are what the extended target-size gate measures at 320px on a tap-reveal chart.
- No blockers. Frozen-math boundary untouched (every value read from the precomputed payload; SCENARIO-05/BODY-02/compute.ts parity green).

## Known Stubs
None — all three charts read live values from the precomputed factsheet payload; no placeholder/empty data wired.

## Self-Check: PASSED

- FOUND: src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx
- FOUND: src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
- FOUND: src/app/factsheet/[id]/v2/HeatmapPanels.tsx
- FOUND: src/components/charts/DailyHeatmap.tsx
- FOUND: src/components/charts/DailyHeatmap.test.tsx
- FOUND: .planning/phases/47-hand-rolled-svg-charts-touch-legibility-portrait/47-03-SUMMARY.md
- FOUND commit: 7082686b (feat — StreakDistribution tap-reveal + BootstrapCI)
- FOUND commit: be7082c8 (feat — DailyReturnsHeatmap cell tap-reveal)
- FOUND commit: f12197ee (feat — DailyHeatmap SVG-branch tap-reveal + extend test)
- FOUND commit: 8ecd1605 (test — Wave-2 viewport-branch coverage)
- TimeSeriesChart.tsx / scenario.ts / compute.ts byte-identical (git diff exit 0)
- DailyHeatmap.test.tsx + type-scale lint + tap-charts-viewport + SCENARIO-05: 45/45 green
- Full coverage: Branches 75.33% ≥ 72 (BLOCKING ratchet held); 6891 tests passed

---
*Phase: 47-hand-rolled-svg-charts-touch-legibility-portrait*
*Completed: 2026-06-27*
