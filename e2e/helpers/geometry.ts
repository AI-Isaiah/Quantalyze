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
      // A table note row (170.7: one colSpan cell under a manager's strategy)
      // has no metric cell to probe; reading it by column index would throw.
      const rows = Array.from(
        region.querySelectorAll<HTMLElement>("tbody tr"),
      ).filter(
        (r) => r.dataset.testid !== "strategy-row-note" && r.querySelector("td"),
      );
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

/**
 * Phase 170.7 (MYSTRATTABLE) D-07 — the four relations 170.2 asserted only
 * inline in `/discovery — SC6-DISCOVERY` are exported here so the manager's
 * `/strategies` describes CALL them instead of copying them. The Discovery
 * describes call these same functions; their assertions, tolerances (1 px) and
 * failure strings are the ones 170.2 shipped, moved and not edited.
 *
 * Every helper skips the table's note rows (`tr[data-testid="strategy-row-note"]`):
 * a note row holds one `colSpan` cell, so reading it by column index would be
 * wrong. Discovery renders none, so skipping them changes nothing there.
 */

/**
 * Wait until the strategy table's column widths hold still. They keep moving
 * after first paint (measured by 170.2: the rank cell read 38.5 px and the
 * region scrolled 1338 px wide early, then 31.0 px and 1184 px, on the same
 * page; web fonts and the sparklines settle late). Waits until every header
 * width and the region's scrollWidth have held for 500 ms (cap 10 s), then two
 * more frames so the table's ResizeObserver has applied its pin offsets.
 */
export async function settleStrategyTableLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const snap = () => {
      const reg = document.querySelector<HTMLElement>('[role="region"][aria-label^="Strategies:"]');
      if (!reg) return "<no region>";
      const heads = Array.from(reg.querySelectorAll<HTMLElement>("thead th"));
      return `${reg.scrollWidth}|${heads.map((h) => h.getBoundingClientRect().width.toFixed(2)).join(",")}`;
    };
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    let last = snap();
    let stableSince = performance.now();
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      await frame();
      const now = snap();
      if (now !== last) {
        last = now;
        stableSince = performance.now();
      } else if (performance.now() - stableSince >= 500) {
        break;
      }
    }
    await frame();
    await frame();
  });
}

/**
 * Phase 170.6.1 D-09 (supersedes D-03, reverses 170.2 D-05 for this one column) —
 * below the table's `@3xl` container step the Strategy column is PINNED at the
 * left edge of the scroll region, so every row stays identifiable while the
 * table scrolls. This replaces 170.2's `assertColumnUnpinnedBelow3xl`, which
 * asserted the opposite relation (the column moves left with the row) and is
 * deleted, not kept beside it. After scrolling the region to its maximum the
 * pinned-column header and every body cell of that column must (1) still sit at
 * the region's left edge, within 1 px, (2) be the element at their own centre
 * point (nothing paints over them), and (3) have started to the right of that
 * edge at scrollLeft 0, so a column that never moved cannot pass vacuously. It
 * must also leave room for the rest: the column is at most `maxShare` (default
 * 0.7) of the region wide, since a pinned column as wide as the scroller hides
 * every column that scrolls under it, and a cell wider than the region is clamped
 * by its table and cannot stay at the left edge at all.
 *
 * `requireBelow3xl` false (Discovery, the default): a container at or above the
 * step is skipped, as 170.2 had it. True (the manager describes): that is a
 * failure, so a viewport that is not below the step cannot pass vacuously.
 * `minScrolled` (default 0): the region must really have scrolled this far,
 * else the check is vacuous.
 */
export async function assertColumnPinnedBelow3xl(
  region: Locator,
  label: string,
  opts: {
    pinnedLabel?: string;
    at3xl?: number;
    requireBelow3xl?: boolean;
    minScrolled?: number;
    maxShare?: number;
  } = {},
): Promise<{ container: number; scrolled: number; cells: number; pinnedWidth: number }> {
  if ((await region.count()) === 0) {
    throw new Error(`${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`);
  }
  const res = await region.first().evaluate(
    (el, args) => {
      const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
      const idx = (t: string) => heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(t));
      const colIdx = idx(args.pinnedLabel);
      const rows = Array.from(el.querySelectorAll<HTMLElement>("tbody tr")).filter(
        (r) => r.dataset.testid !== "strategy-row-note" && r.querySelector("td"),
      );
      const problems: string[] = [];
      const container = el.clientWidth;
      if (colIdx < 0) {
        return { problems: [`${args.pinnedLabel} header not found`], container, scrolled: 0, cells: 0, pinnedWidth: 0 };
      }
      if (rows.length === 0) {
        return { problems: ["no body row to measure (W-02)"], container, scrolled: 0, cells: 0, pinnedWidth: 0 };
      }
      const cells = [
        heads[colIdx],
        ...rows.map((r) => r.querySelectorAll<HTMLElement>(":scope > td")[colIdx]),
      ];
      const below = container < args.at3xl;
      const pinnedWidth = heads[colIdx].getBoundingClientRect().width;
      const main = document.getElementById("main-content");
      el.scrollLeft = 0;
      const regionLeft0 = el.getBoundingClientRect().left;
      const before = cells.map((c) => c.getBoundingClientRect().left - regionLeft0);
      el.scrollLeft = el.scrollWidth;
      const scrolled = el.scrollLeft;
      const regionLeft = el.getBoundingClientRect().left;
      if (args.requireBelow3xl && !below) {
        problems.push(`container ${container} px is not below the ${args.at3xl} px step`);
      }
      if (scrolled < args.minScrolled) {
        problems.push(`region only scrolled ${scrolled} px; the check would be vacuous`);
      }
      if (below) {
        // A pinned column wider than this share of the region leaves no room for
        // the columns that scroll under it (170.2 measured a pinned stack as wide
        // as the whole scroller); a cell wider than the region is also clamped by
        // its table and cannot stay at the left edge at all.
        if (pinnedWidth > args.maxShare * container)
          problems.push(
            `${args.pinnedLabel} column is ${pinnedWidth.toFixed(1)} px wide, over ${Math.round(args.maxShare * 100)}% of the ${container} px region: it would swallow the columns that scroll under it`,
          );
        cells.forEach((c, k) => {
          const what = k === 0 ? "header" : `cell ${k}`;
          // Bring the cell to mid-viewport vertically first, so the sticky
          // filter bar or the fold cannot be what covers it: this relation is
          // about the horizontal pin.
          if (main) {
            const r0 = c.getBoundingClientRect();
            main.scrollTop += r0.top + r0.height / 2 - window.innerHeight / 2;
          }
          const r = c.getBoundingClientRect();
          const offset = r.left - regionLeft;
          if (scrolled > 0 && before[k] <= 1)
            problems.push(
              `${args.pinnedLabel} ${what} already sat at the region edge at scrollLeft 0 (${before[k].toFixed(1)} px): nothing proves it is pinned`,
            );
          if (Math.abs(offset) > 1)
            problems.push(
              `${args.pinnedLabel} ${what} is not pinned: ${offset.toFixed(1)} px from the region's left edge after scrolling ${scrolled} px`,
            );
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !(hit === c || c.contains(hit)))
            problems.push(`${args.pinnedLabel} ${what} is covered at its centre point after scrolling`);
        });
      }
      el.scrollLeft = 0;
      return { problems, container, scrolled, cells: cells.length, pinnedWidth };
    },
    {
      pinnedLabel: opts.pinnedLabel ?? "Strategy",
      at3xl: opts.at3xl ?? 768,
      requireBelow3xl: opts.requireBelow3xl ?? false,
      minScrolled: opts.minScrolled ?? 0,
      maxShare: opts.maxShare ?? 0.7,
    },
  );
  if (res.problems.length) throw new Error(res.problems.join("; "));
  return { container: res.container, scrolled: res.scrolled, cells: res.cells, pinnedWidth: res.pinnedWidth };
}

/**
 * UI-SPEC X-1: at the maximum scroll the point 2 px inside the pinned header's
 * right edge hits that header or a descendant, never a later header cell
 * painting over it. Logs `<label> X-1 scrolled=… ok=… hit=…` (also on failure).
 *
 * The maximum scroll is where 170.2 probes, and it only ever has the LAST columns
 * under that point. `underEveryLaterHeader` (the manager page, whose Status and
 * Created headers sit right after Strategy) also probes, for every header after
 * the pinned one, the scroll position at which that header's centre is under the
 * point, so a header that ties the pinned one's z-index is caught while it is
 * actually passing beneath it. Off by default: Discovery's call is unchanged.
 */
export async function assertPinnedHeaderNotPaintedOver(
  region: Locator,
  label: string,
  opts: { pinnedLabel?: string; underEveryLaterHeader?: boolean } = {},
): Promise<{ scrolled: number; hit: string; probes: number }> {
  if ((await region.count()) === 0) {
    throw new Error(`${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`);
  }
  const pinnedLabel = opts.pinnedLabel ?? "Strategy";
  const res = await region.first().evaluate(
    (el, args) => {
      const main = document.getElementById("main-content");
      const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
      const pinnedIdx = heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(args.pinnedLabel));
      if (pinnedIdx < 0) return { error: `${args.pinnedLabel} header not found` };
      const th = heads[pinnedIdx];
      const max = el.scrollWidth;
      // [scroll position, which later header is meant to be under the point]
      const stops: [number, string][] = [[max, ""]];
      if (args.underEveryLaterHeader) {
        el.scrollLeft = 0;
        const pointX = th.getBoundingClientRect().right - 2;
        const maxLeft = el.scrollWidth - el.clientWidth;
        heads.slice(pinnedIdx + 1).forEach((h) => {
          const r = h.getBoundingClientRect();
          if (r.width === 0) return;
          const s = (r.left + r.right) / 2 - pointX;
          if (s >= 0 && s <= maxLeft) stops.push([s, (h.textContent ?? "").trim().slice(0, 12) || "?"]);
        });
      }
      const probes = stops.map(([left, under]) => {
        el.scrollLeft = left;
        const r0 = th.getBoundingClientRect();
        if (main) main.scrollTop += r0.top + r0.height / 2 - window.innerHeight / 2;
        const r = th.getBoundingClientRect();
        const hit = document.elementFromPoint(r.right - 2, r.top + r.height / 2);
        const cls =
          hit && typeof (hit as HTMLElement).className === "string"
            ? String((hit as HTMLElement).className).split(" ").filter(Boolean).slice(0, 2).join(".")
            : "";
        return {
          scrolled: el.scrollLeft,
          under,
          ok: !!hit && (hit === th || th.contains(hit)),
          hit: hit ? `${hit.tagName}.${cls} "${(hit.textContent ?? "").trim().slice(0, 20)}"` : "<null>",
          thRight: r.right,
        };
      });
      el.scrollLeft = 0;
      return { probes };
    },
    { pinnedLabel, underEveryLaterHeader: opts.underEveryLaterHeader ?? false },
  );
  if ("error" in res) throw new Error(String(res.error));
  for (const p of res.probes) {
    console.log(`${label} X-1 scrolled=${p.scrolled} ok=${p.ok} hit=${p.hit}${p.under ? ` (while "${p.under}" is under the edge)` : ""}`);
  }
  const bad = res.probes.find((p) => !p.ok);
  if (bad) {
    throw new Error(
      `at scrollLeft ${bad.scrolled} the point 2 px inside the ${pinnedLabel} header's right edge (${bad.thRight.toFixed(1)}) is covered by ${bad.hit}${bad.under ? ` while the "${bad.under}" header is under it` : ""}`,
    );
  }
  const last = res.probes[0];
  return { scrolled: last.scrolled, hit: last.hit, probes: res.probes.length };
}

/**
 * UI-SPEC P-2 and P-3, at scrollLeft 0 and at the maximum, on every body row:
 * each pinned body cell is as wide as its header cell and ends where it ends
 * (width and right edge within 1 px), and no descendant of the `overflowOf`
 * column's cell paints past that cell's right edge.
 *
 * `pinned` names the pinned columns: a header index, or a header-text prefix.
 * Discovery passes rank, star and Strategy; the manager page has no star.
 */
export async function assertPinnedCellsMatchHeaders(
  region: Locator,
  label: string,
  opts: {
    pinned: { header: number | string; name: string }[];
    overflowOf?: string;
  },
): Promise<{ rows: number; stops: string[] }> {
  if ((await region.count()) === 0) {
    throw new Error(`${label}: locator resolved to 0 elements — an empty page must not pass (W-02)`);
  }
  const res = await region.first().evaluate(
    (el, args) => {
      const problems: string[] = [];
      const heads = Array.from(el.querySelectorAll<HTMLElement>("thead th"));
      const idx = (t: string) => heads.findIndex((h) => (h.textContent ?? "").trim().startsWith(t));
      const cols = args.pinned.map((p) => ({
        i: typeof p.header === "number" ? p.header : idx(p.header),
        name: p.name,
      }));
      if (cols.some((c) => c.i < 0 || !heads[c.i])) {
        return { problems: [`header lookup failed ${JSON.stringify(cols)}`], rows: 0 };
      }
      const rows = Array.from(el.querySelectorAll<HTMLElement>("tbody tr")).filter(
        (r) => r.dataset.testid !== "strategy-row-note" && r.querySelector("td"),
      );
      if (rows.length === 0) return { problems: ["no body row to measure (W-02)"], rows: 0 };
      const tds = (r: HTMLElement) => Array.from(r.querySelectorAll<HTMLElement>(":scope > td"));
      const R = (n: Element) => n.getBoundingClientRect();
      const stops: [string, number][] = [["0", 0], ["max", el.scrollWidth]];
      for (const [tag, left] of stops) {
        el.scrollLeft = left;
        // P-2 and P-3 on every row
        rows.forEach((row, ri) => {
          const cells = tds(row);
          cols.forEach(({ i, name: n }) => {
            const th = R(heads[i]);
            const td = R(cells[i]);
            if (Math.abs(td.width - th.width) > 1)
              problems.push(`P-2 @${tag}: ${n} row ${ri + 1} td width ${td.width.toFixed(1)} != th width ${th.width.toFixed(1)}`);
            if (Math.abs(td.right - th.right) > 1)
              problems.push(`P-2 @${tag}: ${n} row ${ri + 1} td right ${td.right.toFixed(1)} != th right ${th.right.toFixed(1)}`);
          });
          const over = cols.find((c) => c.name === args.overflowOf);
          if (!over) return;
          const nameTd = cells[over.i];
          const nameRect = R(nameTd);
          const walker = document.createTreeWalker(nameTd, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          let node: Node | null = walker.nextNode();
          while (node) {
            let right = -Infinity;
            let what = "";
            if (node.nodeType === Node.ELEMENT_NODE) {
              const b = (node as Element).getBoundingClientRect();
              if (b.width > 0 || b.height > 0) {
                right = b.right;
                what = (node as Element).tagName;
              }
            } else if ((node.textContent ?? "").trim()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              right = range.getBoundingClientRect().right;
              what = "TEXT";
            }
            if (right > nameRect.right + 1)
              problems.push(`P-3 @${tag}: row ${ri + 1} ${what} paints to ${right.toFixed(1)}, past the pinned edge ${nameRect.right.toFixed(1)}`);
            node = walker.nextNode();
          }
        });
      }
      el.scrollLeft = 0;
      return { problems, rows: rows.length };
    },
    { pinned: opts.pinned, overflowOf: opts.overflowOf ?? "Strategy" },
  );
  if (res.problems.length) throw new Error(res.problems.join("; "));
  return { rows: res.rows, stops: ["0", "max"] };
}

/**
 * Phase 170.1.3 NARROWCHARTS — svg text geometry.
 *
 * `readSvgTextLayout` reads, in ONE page.evaluate, every svg under a root that
 * matches a selector, in DOM order, with each non-empty `<text>` it contains.
 * `assertSvgTextInsideSvg` turns that reading into the clip gate. Both are
 * measurement only: nothing here decides a rendered position (React #418 is
 * the app's concern, not this probe's).
 *
 * The bound a text is held to (per axis):
 *  - svg overflow NOT `visible` (the UA default for a non-root svg): the svg's
 *    own rect, within 0.5 px.
 *  - svg overflow `visible` (e.g. `className="overflow-visible"`): the padding
 *    box of the nearest ancestor that really cuts on that axis. Horizontally
 *    any non-`visible` overflow counts (a sideways scroller or a hidden box
 *    both mean the label is not wholly on screen at a fixed scroll position);
 *    vertically only `hidden` / `clip` count, because a vertical scroller
 *    reaches content below its fold by scrolling, so its padding box is not a
 *    bound. With no cutting ancestor the horizontal bound is the viewport
 *    width. The vertical axis is then unbounded: a page scrolls vertically, so
 *    a text below the fold is not clipped.
 */

export interface SvgTextEmitterDef {
  /** Stable key the reading and the MEASUREMENT note refer to. */
  key: string;
  /** `svg.matches(selector)`; may carry a descendant combinator. */
  selector: string;
  /** When set, the svg must also sit inside a `div` whose first child is an `h3` with exactly this text. */
  headingText?: string;
}

export interface SvgTextEntry {
  text: string;
  /** The `text-anchor` attribute, `start` (the SVG initial value) when absent. */
  anchor: string;
  /** The `x` attribute on the `<text>` itself (user units), null when absent. Deterministic, unlike `rect`, so it can be committed. */
  attrX: string | null;
  /** The `y` attribute on the `<text>` itself (user units), null when absent. */
  attrY: string | null;
  /** True when the text is a Recharts x-axis tick label. Recharts 3 draws those in a sibling `.recharts-xAxis-tick-labels` layer, not inside `.recharts-xAxis`. */
  inXAxis: boolean;
  /** Signed exceedance beyond the bound, positive = outside; null = that axis is unbounded. */
  exceed: {
    left: number | null;
    right: number | null;
    top: number | null;
    bottom: number | null;
  };
  /** Largest positive exceedance over the four sides (0 when inside), 2 dp. */
  overflowPx: number;
  /** The cutting ancestor that bounded the worst side, or null (own svg rect / viewport). */
  boundedBy: string | null;
  rect: { left: number; top: number; right: number; bottom: number };
}

export interface SvgTextLayout {
  index: number;
  label: string | null;
  emitter: string | null;
  width: number;
  rect: Rect;
  overflow: string;
  texts: SvgTextEntry[];
}

export async function readSvgTextLayout(
  page: Page,
  rootSelector: string,
  svgSelector = "svg",
  emitters: SvgTextEmitterDef[] = [],
): Promise<SvgTextLayout[]> {
  return page.evaluate(
    ({ rootSelector, svgSelector, emitters }) => {
      const roots = Array.from(document.querySelectorAll(rootSelector));
      const svgs: SVGSVGElement[] = [];
      for (const root of roots) {
        for (const s of Array.from(root.querySelectorAll<SVGSVGElement>(svgSelector))) {
          if (!svgs.includes(s)) svgs.push(s);
        }
      }
      const short = (el: Element): string => {
        const cls =
          typeof (el as HTMLElement).className === "string"
            ? String((el as HTMLElement).className).split(" ").filter(Boolean).slice(0, 2).join(".")
            : "";
        return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
      };
      const round = (n: number) => Math.round(n * 100) / 100;
      const out: unknown[] = [];
      let index = 0;
      for (const svg of svgs) {
        const sr = svg.getBoundingClientRect();
        if (sr.width === 0 || sr.height === 0) continue;
        const cs = getComputedStyle(svg);
        const texts: unknown[] = [];
        for (const t of Array.from(svg.querySelectorAll("text"))) {
          const raw = (t.textContent ?? "").trim();
          if (raw.length === 0) continue;
          const r = t.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          // Per-axis bound.
          let loX = sr.left;
          let hiX = sr.right;
          let loY: number | null = sr.top;
          let hiY: number | null = sr.bottom;
          let byX: string | null = null;
          let byY: string | null = null;
          if (cs.overflowX === "visible") {
            loX = 0;
            hiX = document.documentElement.clientWidth;
            let a = svg.parentElement;
            while (a && a !== document.documentElement) {
              const acs = getComputedStyle(a);
              if (acs.overflowX !== "visible") {
                const box = a.getBoundingClientRect();
                loX = box.left + a.clientLeft;
                hiX = loX + a.clientWidth;
                byX = short(a);
                break;
              }
              a = a.parentElement;
            }
          }
          if (cs.overflowY === "visible") {
            loY = null;
            hiY = null;
            let a = svg.parentElement;
            while (a && a !== document.documentElement) {
              const acs = getComputedStyle(a);
              if (acs.overflowY === "hidden" || acs.overflowY === "clip") {
                const box = a.getBoundingClientRect();
                loY = box.top + a.clientTop;
                hiY = loY + a.clientHeight;
                byY = short(a);
                break;
              }
              a = a.parentElement;
            }
          }
          const exceed = {
            left: round(loX - r.left),
            right: round(r.right - hiX),
            top: loY === null ? null : round(loY - r.top),
            bottom: hiY === null ? null : round(r.bottom - hiY),
          };
          const sides: [string, number | null, string | null][] = [
            ["left", exceed.left, byX],
            ["right", exceed.right, byX],
            ["top", exceed.top, byY],
            ["bottom", exceed.bottom, byY],
          ];
          let worst = 0;
          let boundedBy: string | null = null;
          for (const [, v, by] of sides) {
            if (v !== null && v > worst) {
              worst = v;
              boundedBy = by;
            }
          }
          texts.push({
            text: raw,
            anchor: t.getAttribute("text-anchor") ?? "start",
            attrX: t.getAttribute("x"),
            attrY: t.getAttribute("y"),
            inXAxis: t.closest(".recharts-xAxis-tick-labels, .recharts-xAxis") !== null,
            exceed,
            overflowPx: round(worst),
            boundedBy,
            rect: { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom) },
          });
        }
        if (texts.length === 0) continue;
        let emitter: string | null = null;
        for (const e of emitters) {
          if (!svg.matches(e.selector)) continue;
          if (e.headingText !== undefined) {
            let a: Element | null = svg.parentElement;
            let ok = false;
            while (a && a !== document.documentElement) {
              const first = a.firstElementChild;
              if (
                a.tagName === "DIV" &&
                first &&
                first.tagName === "H3" &&
                (first.textContent ?? "").trim() === e.headingText
              ) {
                ok = true;
                break;
              }
              a = a.parentElement;
            }
            if (!ok) continue;
          }
          emitter = e.key;
          break;
        }
        const own = svg.getAttribute("aria-label");
        const viaAncestor = svg.closest("[aria-label]")?.getAttribute("aria-label") ?? null;
        out.push({
          index: index++,
          label: own ?? viaAncestor,
          emitter,
          width: round(sr.width),
          rect: { x: round(sr.x), y: round(sr.y), width: round(sr.width), height: round(sr.height) },
          overflow: `${cs.overflowX}/${cs.overflowY}`,
          texts,
        });
      }
      return out;
    },
    { rootSelector, svgSelector, emitters },
  ) as Promise<SvgTextLayout[]>;
}

export interface RequiredEmitter {
  key: string;
  /** Minimum measured texts (default 1). */
  minTexts?: number;
  /** Minimum measured texts inside a Recharts x axis (default 0). */
  minXAxisTexts?: number;
}

/**
 * Fails with one `NARROWCHARTS-EMITTER-MISSING <label> <emitter>` line per
 * required emitter that contributed too few measured texts, so a collapsed
 * section or a moved selector can never read as a clean pass.
 */
export function assertEmittersMeasured(
  layouts: SvgTextLayout[],
  label: string,
  required: RequiredEmitter[],
): void {
  const missing: string[] = [];
  for (const req of required) {
    const mine = layouts.filter((l) => l.emitter === req.key);
    const texts = mine.reduce((n, l) => n + l.texts.length, 0);
    const xTexts = mine.reduce((n, l) => n + l.texts.filter((t) => t.inXAxis).length, 0);
    console.log(`NARROWCHARTS-EMITTER ${label} ${req.key} (texts=${texts}, xAxisTexts=${xTexts})`);
    if (texts < (req.minTexts ?? 1) || xTexts < (req.minXAxisTexts ?? 0)) {
      missing.push(
        `NARROWCHARTS-EMITTER-MISSING ${label} ${req.key} (texts=${texts}, xAxisTexts=${xTexts})`,
      );
    }
  }
  if (missing.length > 0) {
    for (const m of missing) console.log(m);
    throw new Error(missing.join("\n"));
  }
}

const CLIP_SLOP_PX = 0.5;

/**
 * Every non-empty `svg text` under `rootSelector` (limited to svgs matching
 * `svgSelector`) lies inside its bound within 0.5 px, per the rule in the
 * block comment above. Offenders are accumulated, printed one per line as
 * `NARROWCHARTS-CLIPPED <label> <svg aria-label or index> "<text>" <side> <px> [by <ancestor>]`,
 * and reported once at the end. A text that sits beyond an overflow-visible svg
 * but inside its cutting ancestor prints `NARROWCHARTS-OVERFLOW-VISIBLE-OK`.
 * Zero measured texts fails: an empty chart must not read as "nothing clipped".
 *
 * `label` is the "<surface> <viewport>" prefix of every printed line.
 */
export async function assertSvgTextInsideSvg(
  page: Page,
  rootSelector: string,
  label: string,
  svgSelector = "svg",
  options: { emitters?: SvgTextEmitterDef[]; required?: RequiredEmitter[] } = {},
): Promise<SvgTextLayout[]> {
  const layouts = await readSvgTextLayout(page, rootSelector, svgSelector, options.emitters ?? []);
  if (options.required) assertEmittersMeasured(layouts, label, options.required);
  const measured = layouts.reduce((n, l) => n + l.texts.length, 0);
  if (measured === 0) {
    throw new Error(
      `${label}: no svg text measured under ${rootSelector} / ${svgSelector} — an empty page must not pass (W-02)`,
    );
  }
  const offenders: string[] = [];
  for (const l of layouts) {
    const who = l.label ?? `svg#${l.index}`;
    const visible = l.overflow.startsWith("visible");
    for (const t of l.texts) {
      const sides: [string, number | null][] = [
        ["left", t.exceed.left],
        ["right", t.exceed.right],
        ["top", t.exceed.top],
        ["bottom", t.exceed.bottom],
      ];
      for (const [side, px] of sides) {
        if (px === null || px <= CLIP_SLOP_PX) continue;
        offenders.push(
          `NARROWCHARTS-CLIPPED ${label} ${who} "${t.text}" ${side} ${px}${t.boundedBy ? ` by ${t.boundedBy}` : ""}`,
        );
      }
      if (visible && t.overflowPx <= CLIP_SLOP_PX) {
        // Beyond the svg box but inside the cutting ancestor is not an offender.
        const beyondSvg =
          t.rect.left < l.rect.x - CLIP_SLOP_PX ||
          t.rect.right > l.rect.x + l.rect.width + CLIP_SLOP_PX ||
          t.rect.top < l.rect.y - CLIP_SLOP_PX ||
          t.rect.bottom > l.rect.y + l.rect.height + CLIP_SLOP_PX;
        if (beyondSvg) {
          console.log(`NARROWCHARTS-OVERFLOW-VISIBLE-OK ${label} ${who} "${t.text}"`);
        }
      }
    }
  }
  for (const o of offenders) console.log(o);
  console.log(`${label}: measured ${measured} svg text(s) in ${layouts.length} svg(s), ${offenders.length} clipped side(s)`);
  expect(
    offenders,
    `${label}: ${offenders.length} svg text side(s) clipped:\n${offenders.join("\n")}`,
  ).toEqual([]);
  return layouts;
}
