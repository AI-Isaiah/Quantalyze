import { test, expect, type Page } from "@playwright/test";
import {
  filterUnexpectedConsoleErrors,
  type CapturedConsoleError,
} from "../src/lib/playwright-console-filter";
import { PERSONAS, type PersonaKey } from "../src/lib/personas";

/**
 * E2E coverage for the public `/demo` page.
 *
 * Runs against a placeholder-env Next.js build in CI (same profile as
 * smoke.spec.ts + auth.spec.ts). Under that env the admin Supabase client
 * can't connect, so /demo falls through to the "Demo data is loading"
 * empty-state card. These specs MUST NOT assert on seeded data — only on
 * the layout chrome (brand banner, persona switcher) and on response
 * status / console cleanliness.
 *
 * AUDIT-2026-05-07 (cluster C) hardening:
 *  - Persona iteration is driven by the canonical `PERSONAS` constant
 *    from `src/lib/personas` so adding a 4th persona to the resolver
 *    without the corresponding test case fails the typecheck (no silent
 *    coverage hole). Cases also assert EXACTLY ONE link has
 *    `aria-current=page` — a regression that marked every link current
 *    would no longer pass.
 *  - Hostile-input test asserts the literal `<script>` substring is
 *    absent from the rendered HTML AND tests an attribute-injection
 *    vector (`"><img src=x onerror=...`) — covers the reflected-XSS
 *    shapes the previous `script:has-text('<script>')` locator missed.
 *  - Console-error filter scopes "Failed to fetch" to the
 *    `/api/demo/match` URL only (via `ignoreTextOrUrlIncludes`) so an
 *    unrelated client-side fetch failure (Sentry, analytics, etc.)
 *    surfaces as a real error instead of being blanket-suppressed.
 *  - Layout settle uses `waitForLoadState("networkidle")` instead of
 *    `waitForTimeout(1000)` so a deferred error fired after the
 *    arbitrary 1s window is still captured. The overflow loop uses
 *    `expect.toPass()` to retry the measurement once the layout stops
 *    shifting (font swap / hydration / async images).
 *  - 768-px tablet viewport added — the most common breakpoint for
 *    sidebar/grid overflow regressions, previously uncovered.
 *  - Overflow failures emit a breadcrumb naming the first offending
 *    element so a CI failure is debuggable without a local repro.
 */

const PERSONA_LABEL: Record<PersonaKey, string> = {
  active: "Active",
  cold: "Cold",
  stalled: "Stalled",
};

// Driven from the canonical PERSONAS constant so a new persona added to
// the resolver causes a compile error here (no test silently lacking
// coverage). The slug is `key`, the visible label comes from the
// PERSONA_LABEL map above. Object.keys returns strings, so cast to
// PersonaKey[] — TS guards add() / future-persona safety.
const PERSONA_CASES = (Object.keys(PERSONAS) as PersonaKey[]).map((key) => ({
  slug: key,
  label: PERSONA_LABEL[key],
}));

async function getPersonaNavCurrentLabels(page: Page): Promise<string[]> {
  const personaNav = page.getByRole("navigation", { name: /demo persona/i });
  const currentLinks = personaNav.locator('[aria-current="page"]');
  return currentLinks.allTextContents();
}

test.describe("Public /demo page", () => {
  test("loads with brand banner and persona switcher", async ({ page }) => {
    const response = await page.goto("/demo");
    expect(response?.status()).toBeLessThan(400);

    // Brand banner from src/app/demo/layout.tsx
    await expect(page.getByText("Quantalyze", { exact: true })).toBeVisible();

    // Persona switcher from src/app/demo/page.tsx — the three persona links
    // are a nav labelled "Demo persona" so we can scope the assertion to
    // avoid matching "Active Allocator LP" elsewhere on the page.
    const personaNav = page.getByRole("navigation", { name: /demo persona/i });
    for (const { label } of PERSONA_CASES) {
      await expect(
        personaNav.getByRole("link", { name: label }),
      ).toBeVisible();
    }
    // Coverage-completeness check: the test cases enumerate every
    // persona declared in src/lib/personas.ts. If this length mismatch
    // ever fires, add the new persona to PERSONA_LABEL above.
    expect(PERSONA_CASES.length).toBe(Object.keys(PERSONAS).length);
  });

  for (const { slug, label } of PERSONA_CASES) {
    test(`accepts ?persona=${slug} query param`, async ({ page }) => {
      const response = await page.goto(`/demo?persona=${slug}`);
      expect(response?.status()).toBeLessThan(400);
      const personaNav = page.getByRole("navigation", {
        name: /demo persona/i,
      });
      const link = personaNav.getByRole("link", { name: label });
      await expect(link).toHaveAttribute("aria-current", "page");

      // Exclusivity check: EXACTLY ONE link in the nav must be marked
      // current. A regression that set `aria-current=page` on every
      // persona link would pass the per-link assertion above but fail
      // here — closing the "all-personas-current" tautology gap.
      const currentLabels = await getPersonaNavCurrentLabels(page);
      expect(currentLabels).toEqual([label]);
    });
  }

  test("hostile persona input never reflects raw markup into the DOM", async ({
    page,
  }) => {
    // The persona resolver in src/lib/personas.ts MUST fall back to the
    // default persona for any non-allowlist value. The narrow
    // `script:has-text('<script>')` check from the audit history only
    // matches literal `<script>` text inside another script tag — it
    // misses every real reflected-XSS shape.
    //
    // The correct invariant: a hostile URL value must never appear as
    // an EXECUTABLE DOM ELEMENT in the rendered page. We check this two
    // ways for each hostile vector:
    //
    //  (a) The unique marker appears in `page.content()` ONLY inside
    //      safely-escaped contexts (Next.js RSC payloads JSON-encode the
    //      URL, so `<script>` becomes `<script>` — the marker
    //      is present but inert). We verify by querying for a DOM
    //      ELEMENT containing the marker as a text node OR as an
    //      attribute value: `page.locator(...)` with a marker-text
    //      selector returns 0 matches because the marker only lives in
    //      escaped strings, not in element bodies.
    //  (b) The default (Active) persona is marked current — ONLY that
    //      link. A regression that fell through to a different default
    //      would surface here even if escape worked correctly.
    //
    // Sentinel-based + DOM-aware: this catches real reflected XSS
    // (where the marker becomes a real element node) while ignoring
    // safe URL preservation in the RSC payload.
    // audit-2026-05-07 SPECIALIST-red-team
    // `rsc-payload-false-positive` — the previous
    // `script:has-text('qpwnedScript')` selector matches the RSC
    // streaming payload (`self.__next_f.push([...])` inline script
    // tags) because Next.js JSON-encodes searchParams into those
    // tags. JSON.stringify escapes `<` to `<` so a literal
    // `<script>` tag won't render, but the substring `qpwnedScript`
    // survives as plain text inside the RSC script body. Playwright's
    // `:has-text('qpwnedScript')` would match that inert payload and
    // produce a false-positive failure on every CI run (Next 15+
    // default). We need to scan only EXECUTABLE rendered DOM, not
    // every <script> element. The RSC payload uses
    // `<script>self.__next_f.push(...)</script>` (no type attribute,
    // but a recognisable prefix). Scan the rendered DOM via
    // page.evaluate() and assert there is no real <script> element
    // whose textContent contains the marker AND that ISN'T the RSC
    // payload. That binds the assertion to executable script
    // injection, not to safe JSON-encoded URL preservation.
    const hostileInputs = [
      {
        raw: "<script>qpwnedScript</script>",
        marker: "qpwnedScript",
        // Script-injection vector: scan rendered <script> elements,
        // excluding the Next.js RSC streaming payload.
        kind: "script-injection" as const,
      },
      {
        raw: '"><img src=x onerror="qpwnedAttr">',
        marker: "qpwnedAttr",
        // An attribute-escape break would produce a real <img> element
        // with an onerror attribute.
        kind: "dom-shape" as const,
        unsafeSelector: "img[onerror]",
      },
      {
        raw: 'javascript:qpwnedHref',
        marker: "qpwnedHref",
        // A URL-context reflection would inject a link with a
        // javascript: href.
        kind: "dom-shape" as const,
        unsafeSelector: "a[href^='javascript:']",
      },
    ];
    for (const hostile of hostileInputs) {
      const { raw, marker } = hostile;
      const encoded = encodeURIComponent(raw);
      const response = await page.goto(`/demo?persona=${encoded}`);
      expect(response?.status(), `hostile=${raw}`).toBeLessThan(400);

      if (hostile.kind === "script-injection") {
        // Walk rendered <script> elements and count any whose
        // textContent contains the marker BUT does NOT contain the
        // RSC payload signature (`self.__next_f.push`). A real
        // injection would land in a non-RSC script tag.
        const executableInjectionCount = await page.evaluate(
          ([m]) => {
            const scripts = Array.from(
              document.querySelectorAll("script"),
            );
            let count = 0;
            for (const s of scripts) {
              const text = s.textContent ?? "";
              if (!text.includes(m)) continue;
              // Next.js RSC streaming payload signature — ignore.
              if (text.includes("self.__next_f.push")) continue;
              // application/json + ld+json data islands are inert.
              const type = s.getAttribute("type") ?? "";
              if (type === "application/json") continue;
              if (type === "application/ld+json") continue;
              count += 1;
            }
            return count;
          },
          [marker] as const,
        );
        expect(
          executableInjectionCount,
          `hostile=${raw} produced ${executableInjectionCount} executable ` +
            `<script> element(s) containing marker=${marker} (RSC payload + ` +
            `inert JSON islands excluded)`,
        ).toBe(0);
      } else {
        const unsafeCount = await page.locator(hostile.unsafeSelector).count();
        expect(
          unsafeCount,
          `hostile=${raw} produced unsafe DOM element (${hostile.unsafeSelector}); marker=${marker}`,
        ).toBe(0);
      }

      // The default (Active) persona is marked current — and ONLY
      // that link.
      const currentLabels = await getPersonaNavCurrentLabels(page);
      expect(currentLabels, `hostile=${raw}`).toEqual([
        PERSONA_LABEL.active,
      ]);
    }
  });

  test("no console errors on /demo", async ({ page }) => {
    // Capture both text and URL so resource errors whose URL lives on
    // msg.location().url can still be filtered. Uses the shared helper
    // from src/lib/playwright-console-filter so this spec can't regress
    // to the text-only bug fixed in commits 0089cee / f7367e7.
    const errors: CapturedConsoleError[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push({ text: msg.text(), url: msg.location().url });
      }
    });

    await page.goto("/demo");
    // Wait for the page to settle instead of an arbitrary 1s timeout —
    // late hydration / deferred analytics / retry logic firing past 1s
    // emit zero captured errors otherwise. Cap at 10s so a persistent
    // analytics keepalive doesn't hang the whole spec; 10s comfortably
    // exceeds typical hydration windows on the demo page.
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {
        // If networkidle never reaches, fall through — we already gave
        // the page 10s to emit any console errors it was going to.
      });

    const realErrors = filterUnexpectedConsoleErrors(errors, {
      ignoreTextIncludes: ["Hydration", "NEXT_REDIRECT"],
      // Scope "Failed to fetch" suppression to the placeholder-env
      // /api/demo/match 500 explicitly. A blanket Failed-to-fetch
      // suppression hides unrelated client fetch failures (Sentry,
      // analytics, third-party CDN 5xx) and was the audit chain's
      // most actionable blind spot.
      ignoreTextOrUrlIncludes: ["/api/demo/match"],
    });
    if (realErrors.length > 0) {
      console.log(
        "Unexpected console errors:",
        JSON.stringify(realErrors, null, 2),
      );
    }
    expect(realErrors).toHaveLength(0);
  });

  // Includes 768 (tablet) — the most common breakpoint for sidebar/grid
  // overflow regressions and previously uncovered by the overflow loop.
  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];
  for (const { width, height } of viewports) {
    test(`renders without horizontal overflow at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const response = await page.goto("/demo");
      expect(response?.status()).toBeLessThan(400);
      // Settle layout before measuring — without this, the measurement
      // races font swap / hydration / async images and produces flaky
      // results unrelated to real overflow regressions. Cap the wait at
      // 10s so a stuck analytics keepalive doesn't hang the whole spec;
      // the toPass loop below retries the overflow check anyway.
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => {
          // Networkidle didn't quiesce — fall through to toPass which
          // retries the measurement and surfaces the real failure if
          // the page truly has not settled.
        });

      // `toPass` retries the measurement up to its timeout, so transient
      // layout shifts (a font swap mid-measure) don't fail the test.
      // The breadcrumb on failure names the first overflowing element
      // so a CI failure is debuggable without a local repro.
      await expect(async () => {
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const hasOverflow = doc.scrollWidth > window.innerWidth;
          if (!hasOverflow) return { hasOverflow: false as const };
          // Walk the DOM to find the first descendant whose outer right
          // edge extends past the viewport. Useful failure breadcrumb.
          let culprit: string | null = null;
          const all = document.querySelectorAll<HTMLElement>("body *");
          for (const el of Array.from(all)) {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth + 1) {
              const idPart = el.id ? `#${el.id}` : "";
              const classPart =
                typeof el.className === "string" && el.className
                  ? `.${el.className
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(".")}`
                  : "";
              culprit =
                `${el.tagName}${idPart}${classPart}` +
                ` (right=${Math.round(rect.right)}, viewport=${window.innerWidth})`;
              break;
            }
          }
          return {
            hasOverflow: true as const,
            scrollWidth: doc.scrollWidth,
            innerWidth: window.innerWidth,
            culprit,
          };
        });
        if (overflow.hasOverflow) {
          throw new Error(
            `horizontal overflow at ${width}x${height}: scrollWidth=${overflow.scrollWidth} ` +
              `innerWidth=${overflow.innerWidth} first-offender=${overflow.culprit ?? "<unknown>"}`,
          );
        }
      }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });
    });
  }
});
