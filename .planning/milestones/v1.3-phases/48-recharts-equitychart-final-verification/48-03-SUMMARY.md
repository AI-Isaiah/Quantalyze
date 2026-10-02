---
phase: 48-recharts-equitychart-final-verification
plan: 03
subsystem: ui
tags: [react, recharts, useTapPin, touch, equitychart, svg, a11y, chart-01b]

# Dependency graph
requires:
  - phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
    provides: useTapPin tap-vs-drag + pin-toggle gesture core (pointerToIndex callback API)
  - phase: 48-01
    provides: EquityChart.touch.test.tsx Wave-0 it.todo scaffold + breakpoint-gated trigger shim groundwork
provides:
  - EquityChart touch tap-to-pin via additive useTapPin wiring onto the existing <svg>
  - epochIndexFromPx — one shared pure px->index helper consumed by BOTH handleMove (desktop) and pointerToIndex (touch)
  - Filled EquityChart.touch.test.tsx parity proof (no it.todo left)
affects: [48-04, 48-05, "v1.3 milestone real-device UAT", "CHART-01b verification"]

# Tech tracking
tech-stack:
  added: []   # useTapPin already shipped in Phase 47; no new dependency
  patterns:
    - "Shared pure px->index helper makes desktop/touch parity structural (one impl, not a copy)"
    - "Additive useTapPin onto an existing hand-rolled <svg> (SVGSVGElement types line up — no cast, unlike the HeatmapPanels div case)"
    - "reveal = hoverIdx ?? tap.selectedIdx precedence (pinned-then-hovered, mirrors HeatmapPanels)"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx

key-decisions:
  - "epochIndexFromPx returns null for n===0 (off-grid signal for useTapPin), 0 for n===1, else clamp+epoch+nearestIndex — a verbatim transcription of the original handleMove chain"
  - "Task 3 legibility floor: NO code change — the SVG has no viewBox (user units = CSS px = 12px) and ResizeObserver floors logical width at 400px, so the ~12px floor is met by construction"
  - "touchAction: pan-y added to the <svg> style (touch-only CSS; desktop mouse path unaffected) for reliable tap detection"

patterns-established:
  - "Pattern: parity-by-construction — both pointer paths route through ONE exported pure helper so they cannot drift; the unit test asserts the helper == an independent handleMove oracle"
  - "Pattern: additive touch path on a frozen hand-rolled chart — keep mouse handlers byte-identical, add ref+onPointer*, drive the reveal from a nullish-coalesce, never touch the projection memo / ResizeObserver"

requirements-completed: [CHART-01b]

# Metrics
duration: 13min
completed: 2026-06-28
---

# Phase 48 Plan 03: EquityChart Touch Tap-to-Pin (additive useTapPin) Summary

**Wired CHART-01b touch parity into the 2277-LOC hand-rolled EquityChart by integrating the Phase-47 `useTapPin` hook additively onto its existing `<svg>` — a tap pins exactly what desktop hover reveals because `pointerToIndex` and `handleMove` route through ONE shared pure helper (`epochIndexFromPx`); the desktop mouse path and the ResizeObserver/projection-memo regions are untouched.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-28T09:56:49Z
- **Completed:** 2026-06-28T10:09:34Z
- **Tasks:** 3 (Task 3 = verify-only, no code change)
- **Files modified:** 2

## Accomplishments

- **Parity-by-construction:** extracted `epochIndexFromPx(px, geom)` as an exported pure helper (the verbatim `n===0 → null`, `n===1 → 0`, else `clamp + epoch + nearestIndex` chain) and refactored `handleMove` to call it — so the desktop hover path and the touch tap path compute the index from a single implementation. They cannot drift.
- **Additive touch path:** `useTapPin({ count: n, pointerToIndex })` wired onto the SAME `<svg>` via `ref={tap.setChartEl}` + `onPointer{Down,Move,Up,Leave}`. The desktop `onMouseMove={handleMove}` / `onMouseLeave={() => setHoverIdx(null)}` handlers are byte-identical. Pin dismissal (re-tap toggles off, tap moves the pin, pin survives pointerleave, no auto-timer) is owned entirely by the hook.
- **Pinned reveal:** the crosshair + dot SVG block and the tooltip popover are now gated on `reveal = hoverIdx ?? tap.selectedIdx`, reading the SAME precomputed values either way (no recompute).
- **≥44px coarse hit floor:** `pointer-coarse:min-h-[44px]` on the interactive wrapper (WCAG 2.5.5); coarse-only, so the desktop pointer-fine layout is untouched.
- **Filled the parity test:** `EquityChart.touch.test.tsx` now has 5 real assertions (helper==handleMove sweep across the window, `n===0`→null, `n===1`→0, left/right clamp, rect.left subtraction) — no `it.todo` left.
- **Legibility floor verified (Task 3, no change):** the floor is met by construction (see Decisions); no tick-density reduction needed, no data downsampled.

## Task Commits

1. **Task 1: Extract epochIndexFromPx + prove px->nearestIndex parity (RED→GREEN)** — `48c83b87` (test)
   - RED: 5 failing tests (helper missing). GREEN: added the helper, exported `nearestIndex`, refactored `handleMove`, all green.
2. **Task 2: Wire useTapPin additively + pinned reveal + 44px coarse floor** — `01703bdd` (feat)
3. **Task 3: Verify small-width legibility floor + coverage ratchet** — NO code change (legibility floor already met; documented here). Coverage gate run, all thresholds held.

_Plan docs (.planning/) are gitignored (commit_docs:false) — not committed._

## Files Created/Modified

- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` — exported `nearestIndex`; added `epochIndexFromPx` pure helper + `EpochIndexGeom` interface; refactored `handleMove` to route through the helper; added `useTapPin` call + `reveal` precedence; added `ref`/`onPointer*`/`touchAction:pan-y` to the `<svg>` and `pointer-coarse:min-h-[44px]` to the wrapper; drove both reveal blocks from `reveal`.
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx` — replaced the Wave-0 `it.todo` scaffold with 5 real parity/edge-arm assertions importing the extracted `epochIndexFromPx` + `nearestIndex`.

## Decisions Made

- **`epochIndexFromPx` returns `null` for `n===0`** (not a phantom index 0) so the touch adapter feeds `useTapPin` a real "off-grid → un-pin" signal, while `handleMove` early-returns on `null` to preserve its old `if (n===0) return` no-op. `n===1 → 0` and the else branch are the original chain verbatim.
- **Task 3 — legibility floor met by construction, NO code change.** The EquityChart `<svg>` has **no `viewBox`** (verified via grep) and sets literal pixel `width`/`height` attributes, so SVG user units equal CSS pixels: every axis/tick `<text fontSize={12}>` renders at a true 12 CSS px and is NOT downscaled. The ResizeObserver floors the logical width at `Math.max(400, …)`, so the chart never compresses its coordinate space below the design width at a 320px viewport. The ≈12px floor is therefore already cleared — which is precisely why the contract forbids touching the measured-width path. The "intervene only if breached" branch was not taken; no tick-density reduction, no data downsampling.
- **`touchAction: "pan-y"` on the `<svg>` style** (mirrors the HeatmapPanels analog) so a vertical scroll still works while a horizontal tap is captured as a tap, not stolen by the browser as a pan. This is a touch-only CSS hint with zero effect on the desktop mouse render/behavior.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed; Task 3 correctly resolved to "verify-only, no change" per its "intervene only if breached" contract.

## Issues Encountered

- A pre-existing `tsc` error surfaced during the Task 2 full-typecheck sweep in **`src/components/charts/TouchTooltip.test.tsx:90`** (a sibling **plan 48-02** file, a Recharts `Formatter` type-narrowing nit). Verified pre-existing at HEAD (`48c83b87`) WITHOUT any 48-03 working-tree changes by stashing only the two 48-03 files and re-running `tsc`. **Out of scope** for 48-03 (which modifies only EquityChart.tsx + EquityChart.touch.test.tsx, both tsc-clean). Logged in `.planning/phases/48-.../deferred-items.md` for its owning plan; NOT fixed here (SCOPE BOUNDARY rule).

## Verification Results

- `EquityChart.touch.test.tsx` — 5/5 green (parity proof).
- Full EquityChart suite green (desktop byte-identical): `.test` + `.v2` + `.boundary` + `.tweaks` + `.scenario` + `.touch` + `WidgetWidget.header` = **89/89**.
- Frozen-spine guard (`phase-31-frozen-spine-guards`) — green (5/5).
- `chart-accessibility-layer` grep guard — green.
- `git diff` confirms ResizeObserver block (L517-528) + projection useMemo dep array + the desktop mouse handlers UNCHANGED.
- **Coverage ratchet held (`npm run test:coverage` exit 0), actuals:**

  | Metric | Threshold | Actual |
  |--------|-----------|--------|
  | Lines | 82 | **85.05** |
  | Statements | 80 | **82.93** |
  | Functions | 74 | **78.81** |
  | Branches | 72 | **75.45** |

  EquityChart.tsx file-level: 85.5 stmts / 80.1 branches / 86.58 fns / 87.05 lines — the new touch conditionals (`epochIndexFromPx` arms) are directly unit-covered. No threshold lowered, no snapshot blanket-updated.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- EquityChart touch parity is wired; CHART-01b's hand-rolled-chart half is complete. The full real-device tap-to-pin walkthrough on EquityChart lands in the **48-05 / 48-HUMAN-UAT.md** real-device authed sign-off (headless cannot hydrate the authed /allocations EquityChart).
- The `e2e/target-size.spec.ts` EquityChart tap-rect ≥44px @ 320px case (the e2e proof of the `pointer-coarse:min-h-[44px]` floor added here) is authored in a later 48 plan and runs seeded in CI.
- No blockers introduced. The pre-existing 48-02 `TouchTooltip.test.tsx` tsc nit (deferred-items.md) should be cleared by its owning plan before the phase lands if a separate `tsc` job gates branch protection.

## Self-Check: PASSED

- FOUND: 48-03-SUMMARY.md
- FOUND: src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
- FOUND: src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx
- FOUND commit: 48c83b87 (Task 1, test)
- FOUND commit: 01703bdd (Task 2, feat)
- `it.todo` count in touch test: 0 (scaffold fully satisfied)

---
*Phase: 48-recharts-equitychart-final-verification*
*Completed: 2026-06-28*
