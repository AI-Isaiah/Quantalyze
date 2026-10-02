---
phase: 117-uifix-tooltip-portal-overflow-polish
plan: 01
subsystem: ui
tags: [react, createPortal, tooltip, accessibility, positioning, react-dom]

# Dependency graph
requires:
  - phase: 110-contrib
    provides: ContributionWizardOverlay — the canonical SSR-safe createPortal-to-body shell + open-keyed listener discipline
  - phase: 115-e2
    provides: ScenarioCommitDrawer — inline createPortal expression shape + z-[200] overlay stacking precedent
provides:
  - Portaled fixed-position Tooltip that renders outside any overflow/scroll clip
  - Horizontal viewport clamp keeping edge-adjacent tooltips on-screen
  - Genuine above-default / flip-below vertical placement (replacing docstring fiction)
  - z-[210] stacking so a tooltip clears an open z-[200] Dialog/drawer overlay
  - RED-first regression suite pinning portal-escape, edge clamp, Dialog z-clear, listener cleanup, aria wiring
affects: [117-uifix (remaining UIFIX-02/03 plans), any future consumer of the ui Tooltip inside overflow/Dialog contexts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSR-safe createPortal(bubble, document.body) gated on open flag + typeof document guard (no separate mounted flag)"
    - "react-compiler-safe callback ref (never a returned RefObject) + getBoundingClientRect → position:fixed coords"
    - "reposition listeners registered in a useEffect keyed on the open flag, torn down symmetrically on close AND unmount"

key-files:
  created: []
  modified:
    - src/components/ui/Tooltip.tsx
    - src/components/ui/Tooltip.test.tsx

key-decisions:
  - "z-[210] (not z-50) so a body-portaled tooltip clears the z-[200] body-portaled Dialog/drawer overlays it can appear within"
  - "Horizontal clamp (a degenerate flip for a fixed-width bubble) instead of a mirrored flip — either satisfies the on-screen invariant with a smaller diff"
  - "Default placement anchors the bubble's BOTTOM edge (bottom: innerHeight - rect.top + gap) so the common above case needs no measured bubble height; flip-below uses a conservative 80px height estimate for the room-above test only"
  - "SSR gate is the open-state gate + typeof document guard (the exact in-repo precedent), not a new mounted flag"

patterns-established:
  - "ui Tooltip is now the third createPortal site; it mirrors ContributionWizardOverlay/ScenarioCommitDrawer exactly — no positioning library, no react-dom/client"

requirements-completed: [UIFIX-01]

# Metrics
duration: 6min
completed: 2026-07-18
---

# Phase 117 Plan 01: UIFIX-01 Tooltip Portal Summary

**Converted the in-flow absolute Tooltip to an SSR-safe `createPortal(bubble, document.body)` render with `position: fixed` coordinates, a horizontal viewport clamp, a genuinely-implemented above/below flip, and z-[210] Dialog/drawer clearance — while keeping the a11y wiring, hover+focus semantics, 150ms enter delay, and hardened timer lifecycle byte-identical.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-18T11:08Z
- **Completed:** 2026-07-18T11:13Z
- **Tasks:** 3 (2 with commits, 1 verification-only)
- **Files modified:** 2

## Accomplishments
- Tooltip bubble now portals to `document.body`, so a trigger inside a KPI strip / table / any `overflow-*` ancestor renders its full bubble outside the clip.
- Edge-adjacent tooltips stay fully on-screen via a horizontal clamp (`0 <= left AND left + 224 <= innerWidth`).
- A tooltip triggered inside an open z-[200] Dialog/drawer now renders ABOVE it (z-[210]), not behind — the load-bearing stacking trap.
- The stale "flips below" docstring claim is now real code (unconditional `bottom-full` replaced by a room-above test that flips to `top: rect.bottom + gap`).
- Scroll (capture) + resize reposition listeners are added on open and removed symmetrically on close AND unmount (no leaks).
- The M-0898/M-0899/L-0044 timer-lifecycle hardening, `role="tooltip"`, `aria-describedby`, hover+focus, 150ms delay, and DESIGN.md token/inline-style block are all preserved byte-for-byte.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED-first regression tests** - `cad16b11` (test) — 5 new tests, each RED by assertion on the unfixed tree; 3 pre-existing timer tests still green.
2. **Task 2: Portal + fixed positioning + clamp + vertical flip** - `645efd6b` (feat) — all 8 tests green; tsc + lint clean; grep gates green; package.json diff empty.
3. **Task 3: Consumer regression sweep** - no commit (verification-only) — the sole ui-Tooltip consumer (`SimulateImpactButton`) has no tree-relative bubble assertions; nothing to re-point.

**Plan metadata:** (final docs commit)

## Files Created/Modified
- `src/components/ui/Tooltip.tsx` - Portaled, fixed-position bubble; callback-ref rect measurement; open-keyed reposition-listener effect; z-[210]; real vertical flip + horizontal clamp. Timer discipline / a11y / hover+focus / inline style block unchanged.
- `src/components/ui/Tooltip.test.tsx` - Appended `describe("UIFIX-01: portaled positioning")` with 5 tests (portal escape, horizontal clamp numeric invariant, Dialog z-[210] clearance, scroll/resize listener add-on-open + remove-on-close-and-unmount with same handler refs, aria wiring through the portal). The 3 existing timer-lifecycle tests are byte-untouched.

## Decisions Made
- **z-[210]** chosen as the single non-mechanical decision: body-portaled overlays are z-[200] (ContributionWizardOverlay/ScenarioCommitDrawer), so the tooltip must clear that as a sibling in the body stacking context.
- **Clamp over mirrored flip** for the fixed-width (224px / w-56) bubble — smaller correct diff, same on-screen guarantee.
- **Bottom-edge anchor for the default (above) case** avoids needing the measured bubble height; the flip-below decision uses a conservative height estimate (80px) only for the room-above test.

## Deviations from Plan

None - plan executed exactly as written. Task 3 correctly resolved to a no-op commit (verification-only) because no consumer test asserted the bubble as a subtree descendant.

## Issues Encountered
None. The RED gate behaved exactly as designed: on the unfixed tree the bubble is a wrapper descendant with `z-50`/absolute positioning and no window listeners, so every new test failed by assertion (not crash/import error); after the Task-2 rewrite all 8 pass.

## Known Stubs
None.

## User Setup Required
None - no external service configuration required. Pure client-side presentational change; no network, storage, or input-parsing surface touched (threat register T-117-01 / T-117-SC both `accept`).

## Next Phase Readiness
- UIFIX-01 complete and fully test-pinned. The remaining Phase-117 UIFIX work (UIFIX-02 focus-ring non-clipping under `overflow-x-auto`; UIFIX-03 factsheet CUM RETURN no-truncation) is independent and unblocked.
- Recommend a browser `/qa` pass on a dev server to visually confirm the portal placement across an overflow container, a viewport edge, and an open drawer (unit tests cover the invariants but not the rendered pixels).

## Self-Check: PASSED

- FOUND: src/components/ui/Tooltip.tsx
- FOUND: src/components/ui/Tooltip.test.tsx
- FOUND: .planning/phases/117-uifix-tooltip-portal-overflow-polish/117-01-SUMMARY.md
- FOUND commit: cad16b11 (test)
- FOUND commit: 645efd6b (feat)

---
*Phase: 117-uifix-tooltip-portal-overflow-polish*
*Completed: 2026-07-18*
