import { describe, it, expect } from "vitest";
import { computeTabStripScroll } from "./AllocationsTabs";

/**
 * NAV-02 (Phase 45) — pure horizontal-scroll math for the <sm tab strip.
 *
 * These pin the two things the effect's runtime can't easily assert in jsdom
 * (no layout engine), and that a regression would silently break:
 *
 *   1. The correction is HORIZONTAL-ONLY. The return value only ever carries a
 *      `left` target — there is no vertical axis here at all. This is the guard
 *      against the original `scrollIntoView({ block: "nearest" })` bug, which
 *      moved the nearest vertical scroll container and yanked the page back up
 *      after the user had scrolled down (defeating changeTab's `scroll:false`).
 *   2. The reduced-motion contract (WCAG): a reduce user gets an INSTANT scroll
 *      (`behavior:"auto"`), never an animated/forced one. A change that animated
 *      regardless of the preference must fail here.
 */
describe("computeTabStripScroll — horizontal-only NAV-02 strip math", () => {
  it("returns null (no scroll) when the tab is already fully in view", () => {
    // tab [20,120] sits inside the window [0,300] → already visible.
    expect(
      computeTabStripScroll({
        elLeft: 20,
        elWidth: 100,
        viewLeft: 0,
        viewWidth: 300,
        prefersReducedMotion: false,
      }),
    ).toBeNull();
  });

  it("scrolls left to the tab's left edge when it is clipped off the left", () => {
    // window starts at 200; tab [50,150] is entirely left of it → scroll to 50.
    expect(
      computeTabStripScroll({
        elLeft: 50,
        elWidth: 100,
        viewLeft: 200,
        viewWidth: 300,
        prefersReducedMotion: false,
      }),
    ).toEqual({ left: 50, behavior: "smooth" });
  });

  it("scrolls so the tab's right edge aligns to the window when clipped off the right", () => {
    // window [0,300]; tab right edge = 360 > 300 → scroll left = 360 - 300 = 60.
    expect(
      computeTabStripScroll({
        elLeft: 300,
        elWidth: 60,
        viewLeft: 0,
        viewWidth: 300,
        prefersReducedMotion: false,
      }),
    ).toEqual({ left: 60, behavior: "smooth" });
  });

  it("uses an INSTANT scroll (behavior:auto) for prefers-reduced-motion (WCAG)", () => {
    const reduced = computeTabStripScroll({
      elLeft: 50,
      elWidth: 100,
      viewLeft: 200,
      viewWidth: 300,
      prefersReducedMotion: true,
    });
    expect(reduced).toEqual({ left: 50, behavior: "auto" });
    // ...and SMOOTH for the same geometry when motion is allowed — proving the
    // branch is driven by the preference, not the geometry.
    const motion = computeTabStripScroll({
      elLeft: 50,
      elWidth: 100,
      viewLeft: 200,
      viewWidth: 300,
      prefersReducedMotion: false,
    });
    expect(motion?.behavior).toBe("smooth");
  });

  it("never emits a vertical axis — the result carries only a horizontal `left`", () => {
    const target = computeTabStripScroll({
      elLeft: 300,
      elWidth: 60,
      viewLeft: 0,
      viewWidth: 300,
      prefersReducedMotion: false,
    });
    expect(target).not.toBeNull();
    expect(Object.keys(target!).sort()).toEqual(["behavior", "left"]);
  });
});
