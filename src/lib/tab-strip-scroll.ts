/**
 * NAV-02 (Phase 45) — pure horizontal-scroll math for the <sm tab strip.
 *
 * Given the active tab's content-box left/width and the strip's visible window
 * (scrollLeft + clientWidth), return the strip scrollLeft target that brings the
 * tab fully into view, plus the motion to use, or `null` when it is already
 * visible (the no-op case). This deliberately models ONLY the horizontal axis:
 * the prior `scrollIntoView({ block: "nearest" })` also moved the nearest
 * VERTICAL scroll container, which yanked the page back up to the strip after a
 * user had scrolled down — defeating `changeTab`'s intentional
 * `router.replace(..., { scroll: false })`. Keeping the math pure here makes the
 * reduced-motion branch (WCAG — never animate a forced scroll for reduce users)
 * and the already-visible no-op directly unit-testable without a layout engine.
 */
export function computeTabStripScroll(args: {
  elLeft: number;
  elWidth: number;
  viewLeft: number;
  viewWidth: number;
  prefersReducedMotion: boolean;
}): { left: number; behavior: ScrollBehavior } | null {
  const { elLeft, elWidth, viewLeft, viewWidth, prefersReducedMotion } = args;
  const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";
  if (elLeft < viewLeft) return { left: elLeft, behavior };
  const elRight = elLeft + elWidth;
  if (elRight > viewLeft + viewWidth) return { left: elRight - viewWidth, behavior };
  return null; // already in view — no scroll, and never any vertical movement
}
