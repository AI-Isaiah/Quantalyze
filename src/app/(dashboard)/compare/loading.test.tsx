/**
 * Phase 52 / Plan 52-03 / Task 2 — compare route loading.tsx contract.
 *
 * The route-level loading skeleton renders while the compare server component
 * awaits auth + the published-strategy / holding fetches. These tests pin the
 * STATE-01 contract: it smoke-renders (RSC, no client-only deps) and exposes
 * the sr-only `role="status"` liveness hint for assistive tech.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import CompareLoading from "./loading";

describe("compare/loading.tsx — STATE-01 route skeleton", () => {
  it("smoke-renders without throwing", () => {
    const { container } = render(<CompareLoading />);
    expect(container.firstChild).not.toBeNull();
  });

  it("exposes the sr-only role=status liveness hint", () => {
    render(<CompareLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeDefined();
    expect(status.textContent).toMatch(/Loading comparison/i);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.className).toContain("sr-only");
  });

  // ⭐ Re-cut 2026-08-09 (founder decision, Option B). This row used to assert
  // `toContain("max-w-[1920px]")` — a LITERAL, which broke the moment the
  // measure changed even though the property it cared about still held. The
  // invariant was never the number: it is that the skeleton occupies the SAME
  // envelope as the page it stands in for, so content does not jump when the
  // real page swaps in. `/compare` is a dense-table surface and is now fully
  // fluid, so the skeleton must impose no px ceiling either.
  it("imposes no px measure of its own — it must not be narrower than the page it stands in for", () => {
    const { container } = render(<CompareLoading />);
    const pxCaps = container.innerHTML.match(/max-w-\[\d+px\]/g) ?? [];
    expect(pxCaps).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 153 review — THE ORACLE ABOVE IS BLIND, AND THAT IS WHY THIS BLOCK EXISTS.
//
// `max-w-\[\d+px\]` is the only narrowing this file could see, so it shipped
// green for the entire span while the skeleton's root carried `px-6 py-6` and
// `compare/page.tsx` carried nothing. Padding narrows the content box exactly
// as a measure does — the skeleton sat 24px in from the content it stands in
// for and the page jumped OUTWARD on arrival, which is the one thing
// `loading.tsx`'s own docblock claims it prevents. A test that cannot fail when
// the behaviour it names changes is not a guard, and re-cutting the literal
// (2026-08-09) fixed the brittleness without fixing the blindness.
//
// ⭐ THE ASSERTION IS DIFFERENTIAL, NOT A HARDCODED "no padding". It reads
// `page.tsx` and compares the two boxes, so the row still holds if the page's
// own inset ever legitimately changes — it would then demand the skeleton
// change WITH it, which is the actual invariant ("the skeleton occupies the
// same envelope as the page it stands in for"). Pinning `[]` on the skeleton
// alone would re-create the same one-sided guard one property over.
//
// ⚠️ BOTH SIDES RENDER INSIDE `DashboardChrome`. `loading.tsx` is a Suspense
// fallback for the PAGE SEGMENT only — `(dashboard)/layout.tsx` stays mounted
// around it (Next.js `loading.js` convention: "shared layouts remain
// interactive while new route segments load") — so the shell's
// `px-4 py-6 md:px-8 md:py-8` applies to the skeleton and the page alike, and
// neither may add a second inset on top of it. Same "the shell is the SOLE
// owner" rule DESIGN.md states for width, applied to the inset.
// ═══════════════════════════════════════════════════════════════════════════
describe("[153 review] the skeleton's box matches the page's box", () => {
  const PAGE = "src/app/(dashboard)/compare/page.tsx";
  const CHROME = "src/components/layout/DashboardChrome.tsx";

  /**
   * Utilities that MOVE OR SHRINK THE CONTENT BOX: padding, margin (incl.
   * negative), and any max-width. Deliberately NOT `space-*` / `gap-*` (those
   * separate siblings inside the box without insetting it) and not `w-*`.
   * Responsive/state variants are stripped first so `md:px-8` counts.
   */
  const BOX_INSET =
    /^-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|max-w)-/;

  function boxInsets(className: string): string[] {
    return className
      .split(/\s+/)
      .filter(Boolean)
      .filter((cls) => BOX_INSET.test(cls.split(":").pop()!));
  }

  /**
   * The chain of pure WRAPPER elements around the skeleton's content: the root,
   * plus any element that exists solely to wrap everything below it. The walk
   * stops the moment an element branches — at that point its children are
   * content, not chrome, and their own padding (table-cell `px-4`, the header
   * `mb-4`) is internal layout that no page-box rule governs.
   */
  function contentWrappers(container: HTMLElement): Element[] {
    const wrappers: Element[] = [];
    let el: Element | null = container.firstElementChild;
    while (el) {
      wrappers.push(el);
      el = el.children.length === 1 ? el.firstElementChild : null;
    }
    return wrappers;
  }

  it("the detector actually sees padding (it is itself guarded)", () => {
    // ⛔ THE POINT OF THIS ROW. The oracle this block replaces was structurally
    // incapable of seeing the defect it was supposed to catch, so the detector
    // is asserted against the exact class string that shipped broken before it
    // is trusted to report `[]` on anything.
    expect(boxInsets("px-6 py-6 animate-pulse")).toEqual(["px-6", "py-6"]);
    expect(boxInsets("mx-auto max-w-[1920px] px-4 py-6 md:px-8 md:py-8")).toEqual(
      ["mx-auto", "max-w-[1920px]", "px-4", "py-6", "md:px-8", "md:py-8"],
    );
    expect(boxInsets("-mx-4 mb-8")).toEqual(["-mx-4", "mb-8"]);
    // …and does not fire on gaps between siblings, which inset nothing.
    expect(boxInsets("space-y-8 gap-4 flex w-full animate-pulse")).toEqual([]);
  });

  it("⭐ the skeleton's wrappers carry the SAME box inset as the page's", () => {
    const pageSrc = readFileSync(join(process.cwd(), PAGE), "utf8");
    // The page's real render block. Anti-vacuity: if a refactor moves the
    // content out of the final `return (`, this slice would silently go empty
    // and the comparison would pass against nothing.
    const pageRender = pageSrc.slice(pageSrc.lastIndexOf("return ("));
    expect(
      pageRender,
      "compare/page.tsx's final return no longer renders CompareTable — this " +
        "slice is not reading the page's content block any more",
    ).toContain("<CompareTable");

    const pageInsets = [...pageRender.matchAll(/className="([^"]*)"/g)].flatMap(
      (m) => boxInsets(m[1]!),
    );

    const { container } = render(<CompareLoading />);
    const wrappers = contentWrappers(container);
    expect(wrappers.length).toBeGreaterThan(0);
    const skeletonInsets = wrappers.flatMap((el) => boxInsets(el.className));

    expect(
      skeletonInsets,
      `The skeleton's wrappers inset the content by ${JSON.stringify(
        skeletonInsets,
      )} while compare/page.tsx insets by ${JSON.stringify(pageInsets)}. ` +
        `The two must agree or /compare jumps when the real page swaps in.`,
    ).toEqual(pageInsets);
  });

  it("CONTROL — the shell is the one supplying the inset, so 'neither adds one' is not 'nobody does'", () => {
    // Without this, both sides could drop to zero padding because the SHELL
    // dropped its own, and the row above would still pass while /compare
    // rendered flush against the viewport edge. It names the real owner.
    const chromeSrc = readFileSync(join(process.cwd(), CHROME), "utf8");
    expect(
      chromeSrc,
      "DashboardChrome no longer supplies the content inset — /compare's " +
        "page and skeleton both rely on it and neither carries padding of " +
        "its own",
    ).toContain("px-4 py-6 md:px-8 md:py-8");
  });
});
