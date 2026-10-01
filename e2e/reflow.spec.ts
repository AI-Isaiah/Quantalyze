import { expect, test } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";
import {
  assertFitsOrScrollsInside,
  assertNotClippedByAncestors,
} from "./helpers/geometry";

/**
 * Phase 44-04 / A11Y-02 — Reflow gate (WCAG 1.4.10) at the 390px floor.
 *
 * Asserts the public `/security` route does not overflow horizontally
 * (`scrollWidth - clientWidth <= 1px`) at 390px, anchored on the visible
 * "Security practices" H1 so a blank/404 / unhydrated page fails LOUD
 * instead of false-greening (see assertNoReflow).
 *
 * Founder decision 2026-09-27: 390px (iPhone 12) is the narrowest supported
 * width; 320px and 400% zoom are deliberately not required. The corrected
 * helper measures `#main-content`, so a 320px run would demand 320-only
 * fixes nobody asked for.
 *
 * UNSEEDED spec — runs against the placeholder-env build on a public route,
 * with NO `HAS_SEED_ENV` / `test.skip(!process.env.TEST_SUPABASE_*)` guard.
 * It is wired into the UNSEEDED Playwright list in .github/workflows/ci.yml
 * (the `auth.spec.ts e2e/smoke.spec.ts ...` line), modeled on
 * demo-public.spec.ts. FLOW-01 (gate added but never runs, burned twice):
 * the ci.yml list entry is place 1; the absence of any env self-skip is
 * place 2 — together they guarantee the gate actually executes in CI.
 *
 * Reusable beyond /security: assertNoReflow takes any route + visible anchor,
 * so phases 45-48 reuse it app-wide.
 */

test.describe("reflow gate (WCAG 1.4.10) @ 390px", () => {
  test("/security does not overflow horizontally at 390px", async ({
    page,
  }) => {
    // Founder decision 2026-09-27: 390px floor, not 320px.
    await page.setViewportSize({ width: 390, height: 800 });
    const res = await page.goto("/security");
    // Sanity: the route resolved (the visible-anchor check in assertNoReflow
    // is the real fail-loud guard, this just surfaces an outright 5xx early).
    if (res) {
      // status() is null only for about:blank-style navigations; on a real
      // goto it is the HTTP status. A 4xx/5xx here means the anchor check
      // below will fail loud anyway, but assert early for a clearer message.
      const status = res.status();
      if (status >= 400) {
        throw new Error(`/security returned HTTP ${status} — cannot run reflow gate`);
      }
    }
    // Anchor on the visible level-1 "Security practices" heading. <main> wraps
    // the single <h1> (src/app/security/page.tsx), so `main h1` resolves it
    // unambiguously; the helper asserts it visible before measuring.
    await assertNoReflow(page, "main h1");
  });
});

/**
 * Phase 170 T0 — server-free self-test of assertNoReflow. Inline HTML only
 * (page.setContent, no navigation, no seed) so the gate's two directions are
 * proven in Chromium without a server: a wide flex child inside a fake
 * #main-content must throw even when documentElement does not overflow, and
 * content clipped inside a bounded overflow-x auto region must not.
 */
const FIXTURE_SHELL = `<!DOCTYPE html>
<html style="height:100%">
  <head><meta charset="utf-8"></head>
  <body style="height:100%;margin:0">
    <div class="shell" style="display:flex;height:100%">
      <main id="main-content" style="flex:1 1 0%;overflow-y:auto;min-width:0">
        <h1 id="fixture-anchor">Fixture</h1>
        PLACEHOLDER
      </main>
    </div>
  </body>
</html>`;

const WIDE_ROW =
  '<div style="display:flex;flex-wrap:nowrap"><div style="flex:0 0 800px;width:800px;height:40px">wide</div></div>';

test.describe("assertNoReflow helper self-test (Phase 170 T0)", () => {
  test.describe.configure({ timeout: 30_000 });

  test("red fixture: wide flex child inside #main-content rejects with main= and an offender", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(FIXTURE_SHELL.replace("PLACEHOLDER", WIDE_ROW));
    await expect(assertNoReflow(page, "#fixture-anchor")).rejects.toThrow(
      /main=\d+[\s\S]*offender=\S+/,
    );
  });

  test("green fixture: 800px content inside a bounded overflow-x auto region resolves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    // A contained scroller is not a page overflow. The 800px row sticks out
    // of a max-width:100% overflow-x:auto box, and that box's right edge
    // stays inside main, so neither scroller overflows and the helper
    // resolves. The row is clipped, not a page offender.
    const contained =
      '<div style="max-width:100%;overflow-x:auto">' + WIDE_ROW + "</div>";
    await page.setContent(FIXTURE_SHELL.replace("PLACEHOLDER", contained));
    await assertNoReflow(page, "#fixture-anchor");
  });

  test("document fixture: body-level 800px element with no #main-content rejects with doc=", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0">
    <h1 id="fixture-anchor">Fixture</h1>
    <div style="width:800px;height:40px">wide</div>
  </body>
</html>`);
    await expect(assertNoReflow(page, "#fixture-anchor")).rejects.toThrow(
      /doc=/,
    );
  });

  test("escapee fixture: an absolutely positioned label escaping both scrollers onto the document is named", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    // Mirrors CI run 36764778803's composed-scenario rows: an sr-only
    // <label> (position absolute, no positioned ancestor) at the right end
    // of a wide list inside an UNPOSITIONED overflow-x auto scroller. Its
    // containing block is the initial one, so neither the scroller nor
    // #main-content clips it and it lands on the document. main=0, doc>1.
    await page.setContent(
      FIXTURE_SHELL.replace("PLACEHOLDER", escapeeFixture(false)),
    );
    await expect(assertNoReflow(page, "#fixture-anchor")).rejects.toThrow(
      /main=0 doc=\d+[\s\S]*offender=LABEL#escapee/,
    );
  });

  test("contained escapee fixture: the same label inside a position:relative scroller resolves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    // position:relative makes the scroller the label's containing block, so
    // the scroller clips it and the document does not overflow. This is the
    // mechanism plan 170-16 applies to ResponsiveTable. It also proves the
    // fixed decoy at left:400px adds nothing to the document's scrollWidth.
    await page.setContent(
      FIXTURE_SHELL.replace("PLACEHOLDER", escapeeFixture(true)),
    );
    await assertNoReflow(page, "#fixture-anchor");
  });
});

/**
 * Markup for the two escapee fixtures. Inline sr-only styles (no Tailwind).
 *
 * `#fixed-decoy` sits past the 390px viewport but is position:fixed, so it
 * adds nothing to the document's scrollWidth and must never be named (a real
 * page's bottom nav or Tweaks panel). It comes EARLIER in DOM order than the
 * escapee, so a walker that names fixed boxes names it first. Its wrapper is
 * an unclipped position:absolute box with no positioned ancestor: a
 * containing-block climb from the decoy passes through the wrapper to body
 * and never reaches #main-content's overflow-x, so dropping the fixed-box
 * skip is observable (the decoy gets named). The wrapper itself is zero-size
 * at x=0 and is never a candidate.
 */
function escapeeFixture(positionedScroller: boolean): string {
  const srOnly =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
    "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0";
  const item = (i: number, extra = "") =>
    `<li style="flex:0 0 200px;width:200px;height:40px">row ${i}${extra}</li>`;
  const scrollerStyle =
    "max-width:100%;overflow-x:auto" +
    (positionedScroller ? ";position:relative" : "");
  return (
    '<div style="position:absolute">' +
    '<div id="fixed-decoy" style="position:fixed;left:400px;top:0;width:40px;height:40px">decoy</div>' +
    "</div>" +
    `<div style="${scrollerStyle}">` +
    '<ul style="display:flex;width:max-content;margin:0;padding:0;list-style:none">' +
    item(1) +
    item(2) +
    item(3) +
    item(4, `<label id="escapee" style="${srOnly}">Weight</label>`) +
    "</ul></div>"
  );
}

/**
 * Phase 170 GC-01 — server-free self-test of assertFitsOrScrollsInside. A tab
 * strip may fit or scroll inside itself on one line; it may not wrap onto a
 * second line or overflow without being a scroller. Each outcome is proven in
 * Chromium against inline markup at 390 px. The strip is capped at
 * max-width:100% so the eight-child case genuinely exceeds its box.
 */
function stripFixture(style: string, children: number, childWidth: number): string {
  const kids = Array.from(
    { length: children },
    (_, i) =>
      `<button style="flex:0 0 ${childWidth}px;width:${childWidth}px;height:32px">tab ${i}</button>`,
  ).join("");
  return FIXTURE_SHELL.replace(
    "PLACEHOLDER",
    `<div id="strip" role="tablist" style="max-width:100%;${style}">${kids}</div>`,
  );
}

test.describe("geometry helper self-test (Phase 170 GC-01)", () => {
  test.describe.configure({ timeout: 30_000 });

  test("fits fixture: three short tabs on one line resolve with scrolls=false", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(
      stripFixture("display:flex;flex-wrap:nowrap;overflow-x:auto", 3, 60),
    );
    const r = await assertFitsOrScrollsInside(page.locator("#strip"), "fits");
    expect(r.scrolls).toBe(false);
  });

  test("scrolls fixture: eight 120px tabs in a nowrap auto scroller resolve with scrolls=true", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(
      stripFixture("display:flex;flex-wrap:nowrap;overflow-x:auto", 8, 120),
    );
    const r = await assertFitsOrScrollsInside(page.locator("#strip"), "scrolls");
    expect(r.scrolls).toBe(true);
  });

  test("wraps fixture: a flex-wrap strip whose tabs fall onto two lines rejects", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(stripFixture("display:flex;flex-wrap:wrap", 8, 120));
    await expect(
      assertFitsOrScrollsInside(page.locator("#strip"), "wraps"),
    ).rejects.toThrow(/wraps onto more than one line/);
  });

  test("overflows fixture: a nowrap strip with visible overflow wider than its box rejects", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    // overflow-y stays visible too: either axis set to auto would make
    // overflow-x compute to auto, and the strip would be a scroller.
    await page.setContent(
      stripFixture("display:flex;flex-wrap:nowrap;overflow:visible", 8, 120),
    );
    await expect(
      assertFitsOrScrollsInside(page.locator("#strip"), "overflows"),
    ).rejects.toThrow(/does not scroll inside itself/);
  });
});

/**
 * SFH-170-02 — server-free self-test of assertNotClippedByAncestors. A 200 px
 * overflow:hidden row stands in for the AllocatorExchangeManager key list
 * wrapper. A button pushed half past its edge must reject; one that fits must
 * resolve; and an absolute button whose containing block lies OUTSIDE the
 * clipping wrapper is not clipped by it, so it must resolve too (guards the
 * containing-block walk against a false positive in the seeded SC2-PROFILE row).
 */
function clipFixture(inner: string): string {
  return FIXTURE_SHELL.replace(
    "PLACEHOLDER",
    `<div style="width:200px;height:60px;overflow:hidden">${inner}</div>`,
  );
}

test.describe("geometry helper self-test (SFH-170-02 ancestor clip)", () => {
  test.describe.configure({ timeout: 30_000 });

  test("half-clipped fixture: a button pushed past an overflow:hidden row's edge rejects", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(
      clipFixture(
        '<button id="target" style="display:block;margin-left:150px;width:100px;height:32px">Disconnect</button>',
      ),
    );
    await expect(
      assertNotClippedByAncestors(page.locator("#target"), "half-clipped"),
    ).rejects.toThrow(/clipped by ancestor DIV \(overflow hidden\/hidden\)/);
  });

  test("visible fixture: a button fully inside the overflow:hidden row resolves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(
      clipFixture(
        '<button id="target" style="display:block;margin-left:50px;width:100px;height:32px">Disconnect</button>',
      ),
    );
    await assertNotClippedByAncestors(page.locator("#target"), "visible");
  });

  test("escapee fixture: an absolute button whose containing block is outside the clipping row resolves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(
      FIXTURE_SHELL.replace(
        "PLACEHOLDER",
        '<div style="position:relative;width:360px;height:120px">' +
          '<div style="width:200px;height:60px;overflow:hidden">' +
          '<button id="target" style="position:absolute;left:150px;top:0;width:100px;height:32px">Disconnect</button>' +
          "</div></div>",
      ),
    );
    await assertNotClippedByAncestors(page.locator("#target"), "escapee");
  });
});
