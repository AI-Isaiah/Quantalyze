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
 * Reflow gate (WCAG 1.4.10): asserts the document does not overflow
 * horizontally — `scrollWidth - clientWidth <= 1px` — at the page's CURRENT
 * viewport. Set the viewport (e.g. 320px) in the spec before calling.
 *
 * Anchors on `anchorSelector` (a visible content element) first so a
 * blank/404 page fails loud. On overflow, walks `body *` to name the first
 * element whose right edge extends past `clientWidth`, producing a debuggable
 * CI breadcrumb (`offender=TAG#id`).
 *
 * Route-agnostic: works against any route + any visible anchor, so phases
 * 45-48 can reuse it app-wide.
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
      // clientWidth (not innerWidth) per SC#1 — excludes the scrollbar gutter.
      const slop = doc.scrollWidth - doc.clientWidth;
      if (slop <= 1) return { ok: true as const };
      // Walk the DOM for the first element overflowing the client edge — a
      // useful failure breadcrumb so a CI failure is debuggable without a
      // local repro (mirrors demo-public.spec.ts).
      let offender: string | null = null;
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>("body *"),
      )) {
        if (el.getBoundingClientRect().right > doc.clientWidth + 1) {
          const idPart = el.id ? `#${el.id}` : "";
          const classPart =
            typeof el.className === "string" && el.className
              ? `.${el.className.split(" ").filter(Boolean).slice(0, 2).join(".")}`
              : "";
          offender = `${el.tagName}${idPart}${classPart}`;
          break;
        }
      }
      return {
        ok: false as const,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        offender,
      };
    });
    if (!o.ok) {
      throw new Error(
        `reflow: scrollWidth=${o.scrollWidth} clientWidth=${o.clientWidth} ` +
          `offender=${o.offender ?? "<unknown>"}`,
      );
    }
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
