---
phase: 44-foundation-primitives-verification-gates
plan: 02
subsystem: ui
tags: [react, svg, responsive, forwardRef, charts, accessibility, a11y, vitest, parity]

# Dependency graph
requires:
  - phase: 44-foundation-primitives-verification-gates (plan 01)
    provides: ResponsiveTable presentational primitive + co-located vitest convention this plan mirrors
provides:
  - "ResponsiveChartFrame — reusable forwardRef <svg> frame emitting the verbatim responsive recipe (viewBox, preserveAspectRatio='xMidYMid meet', leading 'block w-full', aspect-ratio/maxHeight/width/height style)"
  - "Structural byte-identity unit test pinning the exact attribute strings + the ref/prop passthrough contract"
  - "TimeSeriesChart adopting the frame with byte-identical rendered SVG (parity-by-construction)"
affects: [phase-47-svg-charts-touch, phase-48-recharts-app-wide-axe, charts, responsive-frame, factsheet-v2]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — pure in-repo extraction
  patterns:
    - "Responsive SVG recipe lives in ONE place (ResponsiveChartFrame) so phases 47/48 wrap 16+ charts off a single source instead of re-deriving viewBox/aspect-ratio per chart"
    - "Byte-identity guarded by a falsifiable structural unit test (string-equal on the exact attribute strings), NOT by the dead e2e/strategy-v2-chart-parity.spec.ts"
    - "forwardRef<SVGSVGElement, Props> + .displayName matching the codebase ui/Input.tsx convention; explicit `block w-full ${className}` concat (NOT cn/tailwind-merge) to preserve verbatim class order"

key-files:
  created:
    - src/components/ResponsiveChartFrame.tsx
    - src/components/ResponsiveChartFrame.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx

key-decisions:
  - "Used explicit string concatenation (`block w-full ${className ?? ''}`.trim()) instead of the repo's cn()/tailwind-merge helper — cn could dedupe/reorder classes and break the byte-identity invariant + the literal `block w-full` acceptance check"
  - "Passed NO style prop from TimeSeriesChart to the frame — the original svg's style had ONLY the four responsive keys the frame already supplies; caller style spreads last so future callers can add keys without losing the responsive ones"
  - "Placed the adoption-parity (full-className-reconstitution) assertion in ResponsiveChartFrame.test.tsx (frame-level, cheap, equally falsifiable) per RESEARCH Open Question 2 — avoids heavy FactsheetProvider mocking to RTL-render the whole chart"

patterns-established:
  - "ResponsiveChartFrame: the canonical responsive SVG wrapper for phases 47/48"
  - "Structural attribute-string unit test as the byte-identity regression guard for presentation-only extractions near the FROZEN-MATH boundary"

requirements-completed: [A11Y-02]

# Metrics
duration: ~10min
completed: 2026-06-27
---

# Phase 44 Plan 02: ResponsiveChartFrame Extraction Summary

**Extracted TimeSeriesChart's responsive SVG recipe into a reusable `ResponsiveChartFrame` (forwardRef <svg> emitting verbatim viewBox / preserveAspectRatio='xMidYMid meet' / 'block w-full' / aspect-ratio style), then refactored TimeSeriesChart to render through it with byte-identical output — guarded by a falsifiable structural unit test, not the dead e2e parity spec.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-27T13:53:00Z
- **Completed:** 2026-06-27T13:56:30Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `ResponsiveChartFrame` emits the verbatim responsive recipe (viewBox, `preserveAspectRatio="xMidYMid meet"`, leading `block w-full`, `aspectRatio`/`maxHeight`/`width`/`height` style) and forwards `ref` + every caller prop via `...rest`.
- A structural unit test pins the EXACT attribute strings (string-equality, so a silent drift fails CI loud) and proves the ref + handler/aria/role/tabIndex/focusable passthrough contract — plus an adoption-parity assertion that the produced full className equals TimeSeriesChart's verbatim original.
- `TimeSeriesChart` now renders through the frame; the rendered SVG DOM is byte-identical (parity-by-construction). `git diff` is the import + the svg→frame swap ONLY — `VB_W=880`, `height=config.height??280`, and all children/chart-math unchanged.
- 100% statements / 100% branches coverage on the new component; the branch ratchet (72) holds. tsc + eslint clean on touched files; chart-accessibility-layer recharts contract stays green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ResponsiveChartFrame + structural unit test** - `46fe7967` (feat)
2. **Task 2: Adopt the frame in TimeSeriesChart (byte-identical) + assert parity** - `0821e824` (refactor)

_Note: the adoption-parity assertion ships in the Task 1 test file (committed in `46fe7967`); Task 2's only source change is the TimeSeriesChart svg→frame swap._

## Files Created/Modified
- `src/components/ResponsiveChartFrame.tsx` - Reusable `forwardRef<SVGSVGElement>` frame supplying the verbatim responsive SVG recipe; `block w-full` + `preserveAspectRatio="xMidYMid meet"` kept literal; caller className/style appended after the responsive core; all other props (`...rest`) forwarded.
- `src/components/ResponsiveChartFrame.test.tsx` - Structural byte-identity guard: exact viewBox `0 0 880 280`, exact `preserveAspectRatio`, `block w-full` className core, responsive style keys, ref-resolves-to-svg, full prop passthrough, no-reorder className, style-merge-without-drop, and the adoption-parity full-className reconstitution.
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` - Top-level `<svg ref={svgRef}>` replaced by `<ResponsiveChartFrame ref={svgRef} width={VB_W} height={height} ...>`; chart-specific className tail + ref/aria/role/tabIndex/focusable + all 7 pointer/wheel/key handlers forwarded verbatim; no style prop (frame supplies the responsive style).

## Decisions Made
- **Verbatim string concat over `cn()`/tailwind-merge:** the frame uses `` `block w-full ${className ?? ""}`.trim() `` rather than the repo's `cn` helper. `cn` (clsx + tailwind-merge) can dedupe/reorder utility classes, which would silently break the byte-identity invariant and the literal-`block w-full` acceptance check. Explicit concatenation guarantees the exact original class order.
- **No style prop forwarded from TimeSeriesChart:** the original `<svg>` style at line 580 contained exactly the four responsive keys (`aspectRatio`, `maxHeight`, `width`, `height`) the frame already supplies; passing nothing reconstitutes the identical merged style. Caller `style` spreads last in the frame so future callers can add keys without losing the responsive ones.
- **Frame-level adoption-parity assertion (not full-chart RTL):** per RESEARCH Open Question 2, asserting the frame's className output equals the verbatim original is cheaper than RTL-rendering TimeSeriesChart through FactsheetProvider and equally falsifiable against a class-order drift.

## Deviations from Plan

None - plan executed exactly as written. The frame and adoption were implemented to the verbatim recipe; both tasks' acceptance criteria were met without auto-fixes.

## Issues Encountered
None. The extraction was presentation-only and the byte-identity surface (viewBox/preserveAspectRatio/className/style/handlers/a11y) mapped 1:1 to the frame's contract on the first pass. The pre-existing jsdom `getContext()` canvas warnings during the factsheet-v2 suite are unrelated (PNG export path) and not failures.

## Critical Invariant Verification (FROZEN-OUTPUT byte-identity)
- `git diff src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` = import line + svg→frame opening/closing tag swap ONLY (14 insertions / 12 deletions, all within the one `<svg>` element). No constant, height, children, series, metric, or domain change.
- The frame reconstitutes the exact original attributes: `viewBox="0 0 880 280"`, `preserveAspectRatio="xMidYMid meet"`, full className `block w-full cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`, style `{ aspectRatio: "880 / 280", maxHeight: 280, width: "100%", height: "auto" }`.
- Export helpers (`serializedSvg`/`downloadPng`) read `viewBox` off `svgRef.current` at runtime — the frame renders a real `<svg>` carrying the verbatim viewBox, so export behavior is unchanged.
- The dead `e2e/strategy-v2-chart-parity.spec.ts` (`test.skip(true)`, wrong route/stack) is NOT relied upon; the new structural unit test is the guard.

## Verification Results
- `npx vitest run src/components/ResponsiveChartFrame.test.tsx` → 6 passed (incl. adoption-parity).
- `npx vitest run tests/visual/chart-accessibility-layer.test.ts` → 2 passed (recharts a11y contract unchanged).
- `npx vitest run "src/app/factsheet/[id]/v2/"` + frame + a11y → 12 files / 74 tests passed.
- `npx tsc --noEmit -p tsconfig.json` → clean (frame's prop types accept svgRef + all handlers).
- `npx eslint` on both touched source files → clean.
- Coverage on ResponsiveChartFrame.tsx → 100% statements, 100% branches (ratchet 72 holds).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `ResponsiveChartFrame` is ready for phases 47 (touch the 16+ bespoke SVG charts) and 48 (Recharts app-wide axe). The recipe now lives in one place; new chart wrappers import `@/components/ResponsiveChartFrame` instead of re-deriving the viewBox/aspect-ratio math.
- No blockers. The byte-identity guard means a future drift in the shared recipe fails the structural unit test before it can land.

## Self-Check: PASSED
- FOUND: src/components/ResponsiveChartFrame.tsx
- FOUND: src/components/ResponsiveChartFrame.test.tsx
- FOUND: .planning/phases/44-foundation-primitives-verification-gates/44-02-SUMMARY.md
- FOUND commit: 46fe7967 (Task 1 — feat)
- FOUND commit: 0821e824 (Task 2 — refactor)

---
*Phase: 44-foundation-primitives-verification-gates*
*Completed: 2026-06-27*
