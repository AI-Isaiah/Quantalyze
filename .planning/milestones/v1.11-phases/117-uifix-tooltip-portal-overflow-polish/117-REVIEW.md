---
phase: 117-uifix-tooltip-portal-overflow-polish
reviewed: 2026-07-18T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/components/ui/Tooltip.tsx
  - src/components/ui/Tooltip.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
  - src/app/factsheet/[id]/v2/DistributionPanels.tsx
  - src/components/ResponsiveTable.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
  - src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: findings
---

# Phase 117: Code Review Report

**Reviewed:** 2026-07-18
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 117 is a set of mechanical UI-polish fixes: (01) portal the `ui/Tooltip`
bubble to `document.body` with `position: fixed`; (02) swap positive-offset
focus outlines for the clip-proof inset-ring idiom at six overflow sites; (03)
drop the CUM RETURN value truncation trio for `break-words` + `min-w-0`.

Overall the work is sound and the tests are genuinely RED-first (they assert
live rendered DOM / className tokens and would fail on the unfixed tree — not
tautological). No security surface is touched (pure presentational, no data
flow, no input parsing). **No blockers.**

The explicitly-requested `position:fixed`-inside-a-transformed-ancestor risk is
**handled correctly**: because the bubble is `createPortal`'d to `document.body`
it is never a descendant of the composer/drawer (which portal to body too and
may animate via transform), so no transformed ancestor becomes its containing
block. `getBoundingClientRect()` also returns correct viewport coordinates
regardless of ancestor transforms. The SSR gate (`open` starts false + `typeof
document` guard) produces no hydration mismatch, and the scroll/resize listener
effect tears down symmetrically with stable handler refs (no leak) — the test
suite pins reference equality on removal.

Two positioning-quality defects in the tooltip remain (below), plus minor info
items. The focus-ring and KPI changes are clean.

## Warnings

### WR-01: Tooltip mispaints for one frame on every open (`pos` is stale/null before the post-paint reposition)

**File:** `src/components/ui/Tooltip.tsx:96-126, 140-160`
**Issue:** `pos` starts `null` and is only assigned inside the reposition
`useEffect`, which is a *passive* effect that runs **after** the browser paints.
When the 150ms timer flips `open` true, the portal renders immediately with
`left/top/bottom` all `undefined` — React omits those style props, so the
`position: fixed` bubble paints with `auto` insets at its static in-flow
position (top-left of `document.body`) for one frame, then snaps to the computed
coordinates once the effect fires. On the first open this is a top-left flash;
on every subsequent open the first frame paints at the *previous* open's stale
coordinates. This is exactly the kind of placement glitch this phase set out to
remove, and it fires on every tooltip open.
**Fix:** either gate the portal on a computed position, or run the initial
measurement in a layout effect so it commits before paint:
```tsx
// Option A — don't paint until positioned:
{open && pos && typeof document !== "undefined" &&
  createPortal(/* ... */, document.body)}

// Option B — measure before paint (component is "use client", open starts
// false so no SSR portal render occurs):
useLayoutEffect(() => {
  if (!open) return;
  reposition();
  // ...add/remove listeners
}, [open, reposition]);
```

### WR-02: `ESTIMATED_BUBBLE_HEIGHT = 80` underestimates the documented 2-sentence content → above-placement can clip at the viewport top

**File:** `src/components/ui/Tooltip.tsx:48-51, 105-111`
**Issue:** The flip-to-below decision uses a fixed 80px height estimate, and the
default (above) placement anchors the bubble's **bottom** edge
(`bottom: innerHeight - rect.top + gap`) with **no top clamp**. The bubble's
documented content is a "2-sentence narrative" rendered at 13px inside a 224px
(`w-56`) box — that routinely wraps to 4-8 lines (~110-160px), well over 80px.
For a trigger whose `rect.top` is just above the flip threshold (≥ 96px, e.g. a
KPI-strip tooltip in the top quarter of the viewport), the bubble is placed
above and grows upward past `top: 0`, clipping the first line(s) at the viewport
edge. This partially re-introduces the clipping UIFIX-01 was meant to eliminate.
**Fix:** measure the real bubble height (attach a ref to the bubble and read
`offsetHeight` in the reposition/layout pass) to drive both the flip decision and
a top clamp, or at minimum clamp the above-case top to `≥ VIEWPORT_MARGIN` and
flip below when the measured height would overflow the top.

## Info

### IN-01: Scroll/resize reposition is unthrottled — `getBoundingClientRect` + `setState` on every event

**File:** `src/components/ui/Tooltip.tsx:117-126`
**Issue:** The `scroll` listener is registered with `capture: true`, so it fires
for *every* scroll in the document (any nested overflow container), and each
event synchronously calls `getBoundingClientRect()` (forced reflow) then
`setPos` (re-render). During momentum scrolling this can thrash. (Performance is
out of strict v1 review scope, but this was called out as a focus area.)
**Fix:** coalesce into an `requestAnimationFrame` tick — schedule at most one
reposition per frame and cancel the pending rAF in the effect cleanup.

### IN-02: `break-words` can split an extreme value mid-digit

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:892-903`
**Issue:** `break-words` (overflow-wrap: break-word) will break a long unspaced
number like `"+1234567.8%"` at an arbitrary character when it can't fit,
rendering e.g. `+123456` / `7.8%` across two lines. All digits remain visible
(strictly better than the ellipsis it replaces, and consistent with the
Numbers-Contract goal), but a number split mid-digit can momentarily misread.
This is an accepted tradeoff; noting it so it is a conscious choice, not a
surprise. No change required.

### IN-03: `leading-none` on a now-wrappable value yields cramped multi-line spacing

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:893`
**Issue:** The value `<p>` keeps `leading-none` (line-height: 1). That was
visually inert while the value could not wrap (single line), but now that
`break-words` permits wrapping, a wrapped extreme value renders with zero
inter-line leading — legible for digits (no descenders) but tight. Sibling
alignment and `text-h2` are correctly preserved (all cells share one className
from `items.map`, and every cell has `min-w-0`, so the grid tracks shrink
uniformly and stay aligned). No functional issue; consider `leading-tight` for
wrapped values if visual polish is wanted.

---

_Reviewed: 2026-07-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
