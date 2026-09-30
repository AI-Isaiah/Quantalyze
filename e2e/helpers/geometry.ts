import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Phase 170 T0 — geometry probes the reflow helper does not cover.
 *
 * "Not covered" and "inside the viewport" need a real layout box. jsdom has
 * none, so these live in the seeded e2e spec, not in vitest. A locator that
 * resolves to zero elements fails here: an empty page must not pass as
 * "nothing overflowed" (W-02).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SLOP_PX = 1;

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function fmt(r: Rect | null): string {
  if (!r) return "<none>";
  return `{x:${r.x.toFixed(1)},y:${r.y.toFixed(1)},w:${r.width.toFixed(1)},h:${r.height.toFixed(1)}}`;
}

async function requireBox(locator: Locator, label: string): Promise<Rect> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  const box = await locator.first().boundingBox();
  if (!box || (box.width === 0 && box.height === 0)) {
    throw new Error(`${label}: element has no layout box (${fmt(box)})`);
  }
  return box;
}

/** The element's border box lies fully inside the current viewport. */
export async function assertInsideViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  const box = await requireBox(locator, label);
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error(`${label}: page has no viewport`);
  }
  const inside =
    box.x >= -SLOP_PX &&
    box.y >= -SLOP_PX &&
    box.x + box.width <= viewport.width + SLOP_PX &&
    box.y + box.height <= viewport.height + SLOP_PX;
  expect(
    inside,
    `${label}: box ${fmt(box)} is outside viewport ${viewport.width}x${viewport.height}`,
  ).toBe(true);
}

/**
 * elementFromPoint at the element's centre returns the element itself or a
 * descendant. A covering sibling (sticky header, floating chip, bottom nav)
 * fails this. No in-repo precedent — PATTERNS "No Analog Found".
 */
export async function assertNotCovered(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  const hit = await locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const target = document.elementFromPoint(cx, cy);
    const name = target
      ? `${target.tagName}${target.id ? `#${target.id}` : ""}${
          typeof (target as HTMLElement).className === "string" &&
          (target as HTMLElement).className
            ? `.${String((target as HTMLElement).className)
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .join(".")}`
            : ""
        }`
      : "<null>";
    return {
      covered: !(target && (target === el || el.contains(target))),
      hit: name,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  });
  expect(
    hit.covered,
    `${label}: centre is covered by ${hit.hit}; element rect ${fmt(hit.rect)}`,
  ).toBe(false);
}

/** The element scrolls inside itself (scrollWidth exceeds clientWidth). */
export async function assertScrollsInside(
  locator: Locator,
  label: string,
): Promise<void> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  const sizes = await locator.first().evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    sizes.scrollWidth > sizes.clientWidth + SLOP_PX,
    `${label}: does not scroll inside itself (scrollWidth=${sizes.scrollWidth} clientWidth=${sizes.clientWidth})`,
  ).toBe(true);
}

/**
 * GC-01 (2026-09-30): a tab strip stays on ONE line and scrolls inside itself
 * only when its children do not fit. It never wraps onto a second line, and it
 * never overflows without being a scroller (that content would be cut off or
 * would widen the page).
 *
 * Why not `assertScrollsInside`: an unconditional "must scroll" is wrong for a
 * strip whose tabs fit. CI run 36764778803 failed V640 on
 * `scrollWidth=264 clientWidth=264`, a strip that fit and was correct. That
 * helper stays for N-SCN, where a real scroll is the contract.
 *
 * Wrap test: on one flex line every child's box crosses the line's centre, so
 * no child starts at or below another child's bottom. A child on a second line
 * does. This is robust to children of different heights under `items-center`
 * (an Allocations tab carrying a count badge can be taller than its peers).
 *
 * Returns whether the strip scrolls, so the caller can log it per viewport.
 */
export async function assertFitsOrScrollsInside(
  locator: Locator,
  label: string,
): Promise<{ scrolls: boolean }> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  const m = await locator.first().evaluate((el) => {
    const boxes = Array.from(el.children)
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
      children: boxes.length,
      maxTop: boxes.length ? Math.max(...boxes.map((r) => r.top)) : 0,
      minBottom: boxes.length ? Math.min(...boxes.map((r) => r.bottom)) : 0,
    };
  });
  if (m.children === 0) {
    throw new Error(
      `${label}: strip has no laid-out child — an empty strip must not pass (W-02)`,
    );
  }
  if (m.children > 1 && m.maxTop >= m.minBottom - SLOP_PX) {
    throw new Error(
      `${label}: wraps onto more than one line (a child starts at y=${m.maxTop.toFixed(1)}, at or below another child's bottom y=${m.minBottom.toFixed(1)}) — GC-01 says never wrap`,
    );
  }
  const overflows = m.scrollWidth > m.clientWidth + SLOP_PX;
  if (overflows && m.overflowX !== "auto" && m.overflowX !== "scroll") {
    throw new Error(
      `${label}: overflows but does not scroll inside itself (scrollWidth=${m.scrollWidth} clientWidth=${m.clientWidth} overflow-x=${m.overflowX})`,
    );
  }
  return { scrolls: overflows };
}

/**
 * Every descendant element and text node lies inside the container, 1 px
 * slop. Text nodes are measured with a Range — a wrapped word that paints
 * past the box is the defect a child-element walk misses.
 */
export async function assertChildrenInside(
  page: Page,
  containerLocator: Locator,
  label: string,
): Promise<void> {
  const count = await containerLocator.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  void page;
  const spill = await containerLocator.first().evaluate((container) => {
    const c = container.getBoundingClientRect();
    const slop = 1;
    const contains = (r: DOMRect) =>
      r.width === 0 && r.height === 0
        ? true
        : r.left >= c.left - slop &&
          r.top >= c.top - slop &&
          r.right <= c.right + slop &&
          r.bottom <= c.bottom + slop;
    const fmtR = (r: { x: number; y: number; width: number; height: number }) =>
      `{x:${r.x.toFixed(1)},y:${r.y.toFixed(1)},w:${r.width.toFixed(1)},h:${r.height.toFixed(1)}}`;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    let node: Node | null = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const r = (node as Element).getBoundingClientRect();
        if (!contains(r)) {
          const el = node as HTMLElement;
          return {
            kind: el.tagName,
            text: (el.textContent ?? "").trim().slice(0, 40),
            child: fmtR(r),
            container: fmtR(c),
          };
        }
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (text.trim().length > 0) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (!contains(r)) {
            return {
              kind: "TEXT",
              text: text.trim().slice(0, 40),
              child: fmtR(r),
              container: fmtR(c),
            };
          }
        }
      }
      node = walker.nextNode();
    }
    return null;
  });
  expect(
    spill,
    spill
      ? `${label}: ${spill.kind} "${spill.text}" rect ${spill.child} lies outside container ${spill.container}`
      : `${label}: a child rect lies outside the container`,
  ).toBeNull();
}
