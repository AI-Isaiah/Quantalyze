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
 * SFH-170-02: the element is not cut off by an ancestor that clips overflow.
 * `boundingBox()` reports the element's own rect, so `assertInsideViewport`
 * cannot see a button whose right half an `overflow-hidden` row hides, and
 * `assertNotCovered` only probes the centre.
 *
 * Walks the containing-block chain the way reflow.ts does (an absolute box
 * jumps to its offsetParent, so a clipping wrapper it escapes is skipped;
 * a fixed box stops the walk). Each ancestor whose `overflow-x` or
 * `overflow-y` is not `visible` clips on that axis at its padding box. A
 * scroller counts: run this after scrolling the element into view, and a
 * scroller that still cuts it means it does not fit. Fails when the visible
 * part is smaller than the element by more than 1 px on either axis.
 */
export async function assertNotClippedByAncestors(
  locator: Locator,
  label: string,
): Promise<void> {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  const clip = await locator.first().evaluate((el, slop) => {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let right = r.right;
    let top = r.top;
    let bottom = r.bottom;
    let clipper = "";
    let box: Element = el;
    while (getComputedStyle(box).position !== "fixed") {
      const next: Element | null =
        getComputedStyle(box).position === "absolute"
          ? (box as HTMLElement).offsetParent
          : box.parentElement;
      if (!next || next === document.documentElement) break;
      const cs = getComputedStyle(next);
      const a = next.getBoundingClientRect();
      const before = `${left},${right},${top},${bottom}`;
      if (cs.overflowX !== "visible") {
        const padLeft = a.left + next.clientLeft;
        left = Math.max(left, padLeft);
        right = Math.min(right, padLeft + next.clientWidth);
      }
      if (cs.overflowY !== "visible") {
        const padTop = a.top + next.clientTop;
        top = Math.max(top, padTop);
        bottom = Math.min(bottom, padTop + next.clientHeight);
      }
      if (!clipper && before !== `${left},${right},${top},${bottom}`) {
        const cls =
          typeof (next as HTMLElement).className === "string"
            ? String((next as HTMLElement).className)
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .join(".")
            : "";
        clipper = `${next.tagName}${next.id ? `#${next.id}` : ""}${cls ? `.${cls}` : ""} (overflow ${cs.overflowX}/${cs.overflowY})`;
      }
      box = next;
    }
    const visibleW = Math.max(0, right - left);
    const visibleH = Math.max(0, bottom - top);
    return {
      clipped: visibleW < r.width - slop || visibleH < r.height - slop,
      clipper,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      visible: { x: left, y: top, width: visibleW, height: visibleH },
    };
  }, SLOP_PX);
  expect(
    clip.clipped,
    `${label}: clipped by ancestor ${clip.clipper || "<none>"}; element rect ${fmt(clip.rect)}, visible part ${fmt(clip.visible)}`,
  ).toBe(false);
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

/**
 * Phase 170.2 SC-6, second half (UI-SPEC P-1..P-4, X-1): where the Discovery
 * table pins its name column, the pinned stack never covers a metric.
 *
 * For each scrollLeft in [0, 60, 150, 300, max] and each body cell of each
 * metric column, the visible interval is `[max(cell.left, stackRight,
 * region.left), min(cell.right, region.right)]`, with `stackRight` the pinned
 * name header's right edge. An interval narrower than 4 px is scrolled out or
 * fully under the stack and is not probed; any other must hit the cell (or a
 * descendant) at its centre, or the covering element is named with the column,
 * the row and the scroll position.
 *
 * Non-vacuity (W-02): a region with no row, a metric header that is missing,
 * or a (column, row) pair that never had a probeable interval at ANY scroll
 * position throws, so an empty or fully-hidden table cannot pass as "nothing
 * was covered". Every problem is collected and thrown together, so one RED run
 * names every contract that fails.
 */
export async function assertPinnedStackDoesNotCover(
  page: Page,
  region: Locator,
  label: string,
  opts: { metrics: string[]; pinnedLabel?: string },
): Promise<{ probes: number; stops: number[] }> {
  const count = await region.count();
  if (count === 0) {
    throw new Error(
      `${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`,
    );
  }
  const result = await region.first().evaluate(
    (el, args) => {
      const region = el as HTMLElement;
      const main = document.getElementById("main-content");
      const heads = Array.from(region.querySelectorAll<HTMLElement>("thead th"));
      const idx = (text: string) =>
        heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(text));
      const pinnedIdx = idx(args.pinnedLabel);
      const metricCols = args.metrics.map((m) => ({ label: m, i: idx(m) }));
      const rows = Array.from(
        region.querySelectorAll<HTMLElement>("tbody tr"),
      ).filter((r) => r.querySelector("td"));
      const problems: string[] = [];
      if (pinnedIdx < 0 || metricCols.some((m) => m.i < 0)) {
        return {
          problems: [
            `header lookup failed pinned=${pinnedIdx} metrics=${JSON.stringify(metricCols)}`,
          ],
          probes: 0,
          stops: [] as number[],
        };
      }
      if (rows.length === 0) {
        return {
          problems: ["no body row to probe (W-02)"],
          probes: 0,
          stops: [] as number[],
        };
      }
      const cell = (r: HTMLElement, i: number) =>
        r.querySelectorAll<HTMLElement>(":scope > td")[i];
      const name = (t: Element | null) => {
        if (!t) return "<null>";
        const cls =
          typeof (t as HTMLElement).className === "string"
            ? String((t as HTMLElement).className)
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .join(".")
            : "";
        return `${t.tagName}${cls ? `.${cls}` : ""} "${(t.textContent ?? "").trim().slice(0, 24)}"`;
      };
      const maxLeft = region.scrollWidth - region.clientWidth;
      const stops = Array.from(new Set([0, 60, 150, 300, maxLeft]))
        .filter((s) => s >= 0 && s <= maxLeft)
        .sort((a, b) => a - b);
      const probed = new Set<string>();
      let probes = 0;
      for (const left of stops) {
        region.scrollLeft = left;
        const rr = region.getBoundingClientRect();
        const regionLeft = rr.left + region.clientLeft;
        const regionRight = regionLeft + region.clientWidth;
        const stackRight = heads[pinnedIdx].getBoundingClientRect().right;
        for (const m of metricCols) {
          rows.forEach((row, ri) => {
            const c = cell(row, m.i);
            // Bring the row to mid-viewport vertically so a sticky bar or the
            // fold cannot hide it. Only main's scrollTop moves: scrolling the
            // cell into view would change the region's scrollLeft.
            const r0 = c.getBoundingClientRect();
            if (main) {
              main.scrollTop += r0.top + r0.height / 2 - window.innerHeight / 2;
            }
            const b = c.getBoundingClientRect();
            const l = Math.max(b.left, stackRight, regionLeft);
            const r = Math.min(b.right, regionRight);
            if (r - l < 4) return;
            probes += 1;
            probed.add(`${m.label}|${ri}`);
            const hit = document.elementFromPoint(
              (l + r) / 2,
              b.top + b.height / 2,
            );
            if (!(hit && (hit === c || c.contains(hit)))) {
              problems.push(
                `${m.label} row ${ri + 1} is covered at scrollLeft ${left} by ${name(hit)} (visible ${l.toFixed(1)}..${r.toFixed(1)}, stack right ${stackRight.toFixed(1)})`,
              );
            }
          });
        }
      }
      for (const m of metricCols) {
        rows.forEach((_, ri) => {
          if (!probed.has(`${m.label}|${ri}`)) {
            problems.push(
              `${m.label} row ${ri + 1} never had a visible interval of 4 px or more at scrollLeft ${stops.join("/")} — the probe did not run (W-02)`,
            );
          }
        });
      }
      region.scrollLeft = 0;
      return { problems, probes, stops };
    },
    { metrics: opts.metrics, pinnedLabel: opts.pinnedLabel ?? "Strategy" },
  );
  void page;
  if (result.problems.length) {
    throw new Error(`${label}: ${result.problems.join("; ")}`);
  }
  return { probes: result.probes, stops: result.stops };
}
