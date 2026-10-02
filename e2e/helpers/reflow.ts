import { expect, type Page } from "@playwright/test";

/**
 * Phase 44-04 / A11Y-02 — reusable reflow + target-size DOM-measurement
 * helpers (WCAG 1.4.10 Reflow + 2.5.8 Target Size).
 *
 * Formalizes the inline reflow walk at e2e/demo-public.spec.ts:309-349 into
 * a shared, route-agnostic helper so phases 45-48 reuse it app-wide instead
 * of re-deriving the geometry probe. Both functions take an `anchorSelector`
 * and assert it VISIBLE before measuring — a blank/404 page (or a page that
 * never hydrated against an unseeded DB) fails LOUD rather than passing
 * vacuously against nothing (the discovery-axe.spec.ts Grok W-02 lesson:
 * "running against a 404 / empty page silently passes against a route the
 * gate never actually exercised").
 *
 * SC#1 hardening over the demo-public precedent:
 *   - measures `documentElement.clientWidth` (NOT `window.innerWidth`) so the
 *     scrollbar gutter is excluded from the comparison;
 *   - uses a `<= 1` px slop (sub-pixel rounding on font hinting is not a real
 *     horizontal-overflow regression);
 *   - anchors on a visible content element before any measurement.
 */

// WCAG 2.5.8 Level AA minimum target size. Do NOT lower this bar to force a
// gate green — scope the selector to a clean region instead (see
// e2e/target-size.spec.ts) and defer app-wide enforcement to phases 46/48.
const MIN_TARGET_PX = 44;

// Default interactive surface for the target-size gate. Callers may pass a
// narrower, scoped selector (e.g. a footer nav) when a route has not yet been
// brought up to the 44px bar app-wide.
const DEFAULT_INTERACTIVE_SELECTOR = "a, button, [role=button], input, select";

/**
 * Reflow gate (WCAG 1.4.10): asserts neither scroller overflows horizontally
 * — `scrollWidth - clientWidth <= 1px` on both `documentElement` and
 * `#main-content` — at the page's CURRENT viewport. Set the viewport in the
 * spec before calling.
 *
 * Both scrollers, not an opt-in. Every `(dashboard)` page scrolls inside
 * `<main id="main-content" class="… overflow-y-auto">`, so a document-only
 * measure is vacuous there: the document stays at slop 0 while main overflows
 * (phase 170 RESEARCH §Structural Finding). An opt-in flag would recreate
 * that blindness, so main is always measured when it is present (slop 0 when
 * it is absent, which keeps the pre-existing document gate).
 *
 * A contained scroller is not a page overflow. The offender walk skips an
 * element whose CONTAINING-BLOCK chain, below the overflowing scroller,
 * reaches a box whose computed `overflow-x` is `auto`, `scroll`, `hidden` or
 * `clip` and whose own right edge is within that scroller's bounds — the
 * content is clipped inside a bounded region.
 *
 * The climb follows containing blocks, not DOM ancestry, because overflow
 * only clips boxes whose containing-block chain passes through it. An
 * in-flow box climbs `parentElement` (so an unpositioned overflow-x auto
 * scroller still contains its in-flow content). A `position: absolute` box
 * jumps to its `offsetParent`: every ancestor in between cannot clip it. CI
 * run `36764778803` printed `offender=<unknown>` on every composed-scenario
 * row because an sr-only `<label>` with no positioned ancestor escaped both a
 * `ResponsiveTable` scroller and `#main-content` onto the document, while a
 * DOM-ancestry climb called it contained by `#main-content`. A
 * `position: fixed` box is never named: it adds nothing to the document's
 * scrollWidth (bottom nav, Tweaks panel). Known limit: containing blocks
 * created by `transform`, `filter` or `contain` are not modelled, since
 * `offsetParent` ignores them.
 *
 * Anchors on `anchorSelector` (a visible content element) first so a
 * blank/404 page fails loud. On overflow, walks `body *` against the
 * overflowing scroller's client box (main's right edge when main overflowed,
 * else `doc.clientWidth`) and names the first offender as
 * `TAG#id.class1.class2`. The Node log line appends ` also=<b2>,<b3>` when
 * further offenders exist; the thrown message names the first only.
 *
 * Route-agnostic: works against any route + any visible anchor.
 */
export async function assertNoReflow(
  page: Page,
  anchorSelector: string,
): Promise<void> {
  // Fail loud on empty/404/unhydrated — never measure against nothing.
  await expect(
    page.locator(anchorSelector).first(),
    `reflow anchor "${anchorSelector}" not visible — blank/404/unhydrated page would otherwise false-green`,
  ).toBeVisible({ timeout: 10_000 });

  // Best-effort settle so the measurement doesn't race a font swap / async
  // image. Swallowed: the toPass loop below retries and surfaces real
  // overflow even if networkidle never quiesces (analytics keepalive).
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});

  // toPass retries so a transient mid-measure layout shift doesn't flake.
  await expect(async () => {
    const o = await page.evaluate(() => {
      const doc = document.documentElement;
      const main = document.getElementById("main-content");
      // clientWidth (not innerWidth) per SC#1 — excludes the scrollbar gutter.
      const docSlop = doc.scrollWidth - doc.clientWidth;
      const mainSlop = main ? main.scrollWidth - main.clientWidth : 0;
      const mainOverflowed = mainSlop > 1;
      const docOverflowed = docSlop > 1;
      // Offenders are measured against the overflowing scroller's client
      // box. Main wins when both overflow: that is the dashboard scroller.
      const boundRight = mainOverflowed
        ? main!.getBoundingClientRect().right
        : doc.clientWidth;
      const scroller: HTMLElement = mainOverflowed && main ? main : doc;
      const offenders: string[] = [];
      if (mainOverflowed || docOverflowed) {
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>("body *"),
        )) {
          if (el.getBoundingClientRect().right <= boundRight + 1) continue;
          // A fixed box adds nothing to the document's scrollWidth; naming
          // it would misattribute the overflow.
          if (getComputedStyle(el).position === "fixed") continue;
          // Clipped inside a bounded overflow region: climb the
          // containing-block chain (offsetParent for an absolute box,
          // parentElement otherwise) below the scroller, looking for a
          // clipping box whose own right edge stays inside the scroller.
          let contained = false;
          let box: HTMLElement = el;
          for (;;) {
            const next: HTMLElement | null =
              getComputedStyle(box).position === "absolute"
                ? (box.offsetParent as HTMLElement | null)
                : box.parentElement;
            if (
              !next ||
              next === scroller ||
              next === document.body ||
              next === doc
            )
              break;
            const ox = getComputedStyle(next).overflowX;
            if (
              (ox === "auto" ||
                ox === "scroll" ||
                ox === "hidden" ||
                ox === "clip") &&
              next.getBoundingClientRect().right <= boundRight + 1
            ) {
              contained = true;
              break;
            }
            box = next;
          }
          if (contained) continue;
          const idPart = el.id ? `#${el.id}` : "";
          const classPart =
            typeof el.className === "string" && el.className
              ? `.${el.className.split(" ").filter(Boolean).slice(0, 2).join(".")}`
              : "";
          offenders.push(`${el.tagName}${idPart}${classPart}`);
          if (offenders.length === 3) break;
        }
      }
      const offender = offenders[0] ?? null;
      const also = offenders.slice(1);
      return { mainSlop, docSlop, offender, also };
    });
    const viewport = page.viewportSize();
    if (o.mainSlop > 1 || o.docSlop > 1) {
      // Node stdout, not the browser console: plan 170-11 greps the job log.
      console.log(
        `LAYOUT-NARROW-OFFENDER viewport=${viewport?.width ?? "?"} main=${o.mainSlop} doc=${o.docSlop} offender=${o.offender ?? "<unknown>"}` +
          (o.also.length ? ` also=${o.also.join(",")}` : ""),
      );
      const scroller = o.mainSlop > 1 ? "main" : "doc";
      throw new Error(
        `reflow: main=${o.mainSlop} doc=${o.docSlop} scroller=${scroller} ` +
          `offender=${o.offender ?? "<unknown>"}`,
      );
    }
    console.log(
      `LAYOUT-NARROW-CLEAN viewport=${viewport?.width ?? "?"} main=${o.mainSlop} doc=${o.docSlop}`,
    );
    // Window >= the networkidle settle above so a late-appearing wide element
    // on a slow/analytics-heavy route (phases 46-48) is still caught by a
    // re-measure rather than missed by an early pass or flaking red.
  }).toPass({ timeout: 10_000, intervals: [200, 500, 1000, 2000] });
}

/**
 * Target-size gate (WCAG 2.5.8): asserts every visible interactive element
 * matched by `interactiveSelector` measures at least 44x44 CSS px.
 *
 * Anchors on `anchorSelector` (visible) first, then requires at least one
 * element be measured — so an empty page / wrong selector cannot pass with
 * zero elements measured (the false-green guard).
 *
 * Pass a SCOPED `interactiveSelector` when a route is not yet 44px-clean
 * app-wide (e.g. `footer nav[aria-label="Legal"] a`) and document the scope
 * in the calling spec. The 44px bar itself is never lowered here.
 */
export async function assertTargetSizes(
  page: Page,
  anchorSelector: string,
  interactiveSelector: string = DEFAULT_INTERACTIVE_SELECTOR,
): Promise<void> {
  // Fail loud on empty/404/unhydrated — never measure against nothing.
  await expect(
    page.locator(anchorSelector).first(),
    `target-size anchor "${anchorSelector}" not visible — blank/404/unhydrated page would otherwise false-green`,
  ).toBeVisible({ timeout: 10_000 });

  const result = await page.evaluate(
    ({ sel, min }) => {
      const violations: string[] = [];
      const els = Array.from(
        document.querySelectorAll<HTMLElement>(sel),
      );
      let measured = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // hidden — skip
        measured += 1;
        if (r.width < min || r.height < min) {
          const label =
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().slice(0, 24) ??
            "";
          violations.push(
            `${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)} "${label}"`,
          );
        }
      }
      return { measured, violations };
    },
    { sel: interactiveSelector, min: MIN_TARGET_PX },
  );

  // An empty page / wrong selector cannot pass with zero elements measured.
  expect(
    result.measured,
    `no interactive elements measured for "${interactiveSelector}" — anchor/empty-page/selector bug (false-green guard)`,
  ).toBeGreaterThan(0);
  expect(
    result.violations,
    `interactive targets below ${MIN_TARGET_PX}px (WCAG 2.5.8)`,
  ).toEqual([]);
}
