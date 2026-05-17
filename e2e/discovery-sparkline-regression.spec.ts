/**
 * Phase 13 / Plan 13-04 / DISCO-04 — sparkline single-accent regression gate.
 *
 * DESIGN.md DIFF-05 locks the rule: a sparkline trace is rendered with a
 * SINGLE color across all points. The color is driven by the FINAL value
 * of `sparkline_returns` (positive → accent, negative → negative-red,
 * zero/empty → benchmark-grey). This spec is the structural defense
 * against the historical regression where the sparkline was split per-point
 * by sign — producing a green-then-red trace that contradicts the
 * single-accent rule.
 *
 * Login fixture: env-driven, mirrors discovery-prefs-isolation.spec.ts.
 *   - Preferred: `E2E_USER_A_EMAIL` + `E2E_USER_A_PASSWORD` (a real
 *     allocator with seed data visible on /discovery/crypto-sma).
 *   - Fallback: `seedTestAllocator()` when TEST_SUPABASE_URL +
 *     TEST_SUPABASE_SERVICE_ROLE_KEY are wired.
 *   - When neither is wired the spec is `test.skip`'d.
 *
 * audit-2026-05-07 cluster J — REWRITTEN to remove the hardcoded
 * credentials documented in FIX-LIST C-0304, C-0305, H-1042, H-1043
 * (security violation + opaque CI failures), and to tighten the
 * silent-pass `toBeLessThanOrEqual(1)` / missing positive-color
 * assertion documented in H-1041 + M-0866. M-0867 typed page.evaluate
 * shapes are also introduced.
 *
 * RATIONALE for the drawdown assertion (third test): all 8 seed
 * STRATEGY_PROFILES have positive annualizedReturn, so the returns
 * sparkline never naturally renders the negative branch on seed data.
 * The drawdown sparkline ALWAYS renders negative by definition. Asserting
 * that drawdown SVGs use the negative color proves the negative-color
 * render path is functional in the live page even when seed data trends
 * positive. The component-level tests in StrategyTable.test.tsx +
 * sparkline-color.test.ts cover the returns-sparkline negative-fixture
 * branch via synthetic data.
 */

import { test, expect } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";
import { cleanupTestAllocator } from "./helpers/cleanup-test-project";
import { loginAs } from "./helpers/login";

/** M-0867: typed page.evaluate return contracts (browser/node boundary). */
interface SparklineStrokeProbe {
  /** Array (per SVG) of distinct stroke colors after lowercasing. */
  distinctPerSvg: string[][];
}
interface SparklineStrokeSizeProbe {
  /** Array (per SVG) of stroke-set size (case-sensitive). */
  sizePerSvg: number[];
}
interface DrawdownStrokeProbe {
  /** Per-row last-SVG stroke value (null if absent). */
  strokes: (string | null)[];
}

/**
 * audit-2026-05-07 maintainability finding
 * (duplicate-evaluate-stroke-extraction): single source of truth for the
 * sparkline-SVG selector used inside page.evaluate. Previously copy-pasted
 * across two evaluate blocks where a selector edit in one and not the
 * other would silently desynchronise the assertions.
 */
const SPARKLINE_SVG_SELECTOR =
  "table svg:has(path[stroke]), [data-testid='strategy-grid'] svg:has(path[stroke])";

const HAS_E2E_USER_ENV =
  !!process.env.E2E_USER_A_EMAIL && !!process.env.E2E_USER_A_PASSWORD;

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = HAS_E2E_USER_ENV || HAS_SEED_ENV;

test.describe("Discovery sparkline single-accent rule (DESIGN.md DIFF-05)", () => {
  test.skip(
    !SHOULD_RUN,
    "discovery sparkline regression spec: neither E2E_USER_A_* nor " +
      "TEST_SUPABASE_* env wired — set E2E_USER_A_EMAIL + " +
      "E2E_USER_A_PASSWORD (real allocator) OR TEST_SUPABASE_URL + " +
      "TEST_SUPABASE_SERVICE_ROLE_KEY (seed helper). " +
      "audit-2026-05-07 cluster J / FIX-LIST C-0305/H-1042 — hardcoded " +
      "credentials removed.",
  );

  let seededUserId: string | undefined;

  test.beforeEach(async ({ page }) => {
    let email: string;
    let password: string;
    if (HAS_E2E_USER_ENV) {
      // Env-gate proved this branch — assertions safe.
      email = process.env.E2E_USER_A_EMAIL as string;
      password = process.env.E2E_USER_A_PASSWORD as string;
    } else {
      const seed = await seedTestAllocator();
      seededUserId = seed.userId;
      email = seed.email;
      password = seed.password;
    }
    await loginAs(page, email, password);
    await page.goto("/discovery/crypto-sma");
    await page.waitForSelector("table tbody tr", { timeout: 15000 });

    // Red-team RT-J02 (CRITICAL): the 'No strategies match your filters.'
    // empty-state row in StrategyTable.tsx:493-499 is ALSO a `tr` inside
    // tbody, so `waitForSelector('table tbody tr')` above succeeds even
    // when the test DB has no seed data. Without this guard the three
    // negative-property tests would either pass vacuously OR fail with
    // confusing "expected >0 to be >0" diagnostics 15s later. Symmetric
    // with discovery-hide-examples-default.spec.ts:144-153 — both specs
    // share the same external `npm run seed:demo` dependency and must
    // surface it identically.
    const rowsText = await page
      .locator("table tbody tr")
      .allTextContents();
    const hasEmptyStateRow = rowsText.some((t) =>
      /no strategies/i.test(t),
    );
    expect(
      hasEmptyStateRow,
      "discovery table must not render the 'no strategies' empty state " +
        "before the sparkline assertions run — this indicates the test " +
        "DB lacks the demo seed data (run `npm run seed:demo` against " +
        "TEST_SUPABASE_URL before re-running)",
    ).toBe(false);
  });

  test.afterEach(async () => {
    if (seededUserId) {
      await cleanupTestAllocator(seededUserId);
      seededUserId = undefined;
    }
  });

  test("no sparkline SVG on /discovery/crypto-sma mixes positive (#15803D) and negative (#DC2626) strokes", async ({
    page,
  }) => {
    const probe = await page.evaluate<SparklineStrokeProbe, string>(
      (selector) => {
        // Red-team RT-J01: scope to SVGs that actually have a stroked path.
        // The row-level checkbox icon (StrategyTable.tsx line 434) renders
        // an `<svg>` with `fill="currentColor"` and NO stroked path — it
        // matches a bare `table svg` selector but contributes a stroke set
        // of size 0, which silently passes the "no green+red" disjunction
        // AND breaks the `size===1` tightening in the next test. Restricting
        // to `svg:has(path[stroke])` selects ONLY actual sparkline SVGs.
        const svgs = Array.from(
          document.querySelectorAll(selector),
        ) as SVGElement[];
        const distinctPerSvg = svgs.map((svg) => {
          const strokes = new Set(
            Array.from(svg.querySelectorAll("path[stroke]"))
              .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
              .filter((s) => s && s !== "none")
              .map((s) => s.toLowerCase()),
          );
          return [...strokes];
        });
        return { distinctPerSvg };
      },
      SPARKLINE_SVG_SELECTOR,
    );

    expect(probe.distinctPerSvg.length).toBeGreaterThan(0);

    for (const strokes of probe.distinctPerSvg) {
      // Forbidden: any single SVG mixing the positive-text color (#15803D
      // post-2026-04-30, #16A34A pre-shift) and negative (#DC2626) on the
      // same trace. The accent #1B6B5A is the canonical positive stroke;
      // the positive-text color would only appear on sparklines if someone
      // reintroduced split-color. Either being on the same path as #DC2626
      // is a failure. Both old + new green hex are matched so this guard
      // survives in-flight migrations.
      const hasGreen = strokes.some((s) =>
        /#15803d|#16a34a|var\(--color-positive\)/i.test(s),
      );
      const hasRed = strokes.some((s) =>
        /#dc2626|var\(--color-negative\)/i.test(s),
      );
      expect(hasGreen && hasRed).toBe(false);
    }
  });

  test("each sparkline SVG owns exactly one stroke color (single-trace rule)", async ({
    page,
  }) => {
    const probe = await page.evaluate<SparklineStrokeSizeProbe, string>(
      (selector) => {
        // Red-team RT-J01: same selector scoping as the previous test —
        // exclude icon SVGs that have no stroked path. Otherwise the
        // `toBe(1)` tightening would fail on the row-level checkbox SVG.
        const svgs = Array.from(
          document.querySelectorAll(selector),
        ) as SVGElement[];
        const sizePerSvg = svgs.map((svg) => {
          const strokes = new Set(
            Array.from(svg.querySelectorAll("path[stroke]"))
              .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
              .filter((s) => s && s !== "none"),
          );
          return strokes.size;
        });
        return { sizePerSvg };
      },
      SPARKLINE_SVG_SELECTOR,
    );

    // H-1041 fix: explicit length floor — `size===0` (zero-stroke render
    // bug) used to silently pass with `toBeLessThanOrEqual(1)` on an
    // empty array. The Set.size of an empty set is 0 ≤ 1, and an empty
    // distinctPerSvg loop body never executed. Now we require at least
    // one SVG AND each must have exactly one stroke color.
    expect(
      probe.sizePerSvg.length,
      "at least one sparkline SVG must render on /discovery/crypto-sma " +
        "(rendering bug if zero)",
    ).toBeGreaterThan(0);
    for (const size of probe.sizePerSvg) {
      // Each sparkline is one stroked path → exactly one stroke color.
      // The endpoint circle uses fill (not stroke). Drawdown SVGs may
      // have a fill path AND a stroke path — but the stroke set still
      // collapses to one color. `toBe(1)` not `toBeLessThanOrEqual(1)`:
      // size===0 means the sparkline failed to render at all, which is
      // a regression we must surface, not swallow.
      expect(
        size,
        "each sparkline SVG must have exactly one stroke color",
      ).toBe(1);
    }
  });

  test("at least one returns sparkline is rendered with the accent color (positive contract)", async ({
    page,
  }) => {
    // M-0866 fix: the prior pair of tests only proved NEGATIVE properties
    // ("no mix" / "single color"). Both pass vacuously if the sparkline
    // is painted with a wrong-but-single color (e.g., #16A34A or
    // transparent). Add a POSITIVE contract: at least one returns
    // sparkline on /discovery/crypto-sma must be stroked with the
    // accent color (var(--color-accent), the canonical positive stroke
    // per src/lib/sparkline-color.ts:20). Seed data has positive
    // annualizedReturn for all 8 STRATEGY_PROFILES, so the accent
    // branch MUST be exercised in the live DOM.
    //
    // audit-2026-05-07 testing finding M-discovery-sparkline:231 —
    // bind to the explicit `data-testid='sparkline-returns'` attribute
    // (added to the returns Sparkline at StrategyTable.tsx:471) rather
    // than "every non-last SVG per row". The old loop would silently
    // include any future row-level icon SVG (favorites star, sync
    // indicator, etc.) and could pass on a non-sparkline element. The
    // testid binds the assertion to the column the WHY actually cares
    // about and survives column reordering.
    // Red-team RT-J03: scope the testid selector to the discovery table.
    // The bare `svg[data-testid="sparkline-returns"]` selector would match
    // ANY sibling component on /discovery/* that reuses the same testid
    // (recently-viewed, compare drawer, selected-portfolio preview — all
    // realistic future surfaces). Symmetric with the drawdown probe below
    // which uses `table tbody tr` scoping. Matches the existing
    // SPARKLINE_SVG_SELECTOR pattern (`table svg:has(path[stroke])`).
    const probe = await page.evaluate<DrawdownStrokeProbe>(() => {
      const sparklines = Array.from(
        document.querySelectorAll('table svg[data-testid="sparkline-returns"]'),
      ) as SVGElement[];
      const strokes: (string | null)[] = sparklines.map((svg) => {
        const path = svg.querySelector(
          "path[stroke]",
        ) as SVGPathElement | null;
        return path?.getAttribute("stroke") ?? null;
      });
      return { strokes };
    });

    const accentStrokes = probe.strokes.filter(
      (s): s is string =>
        s !== null && /^var\(--color-accent\)$|^#1b6b5a$/i.test(s.trim()),
    );
    expect(
      accentStrokes.length,
      "at least one returns sparkline on /discovery/crypto-sma must be " +
        "stroked with the accent color — seed data has positive returns " +
        "so the accent branch must be exercised in the live DOM " +
        "(positive contract, not a 'no green+red' negative-only proof)",
    ).toBeGreaterThan(0);
  });

  test("drawdown sparkline path uses the negative color (#DC2626 / var(--color-negative)) — proves the negative-color render path is exercised on live data", async ({
    page,
  }) => {
    // The drawdown sparkline is the LAST sparkline cell per row in the
    // table (Sparkline at StrategyTable.tsx:464 with color="var(--color-negative)").
    // Locate it via td order: drawdown is the second-to-last <td> per row,
    // which means the LAST <svg> per row.
    const probe = await page.evaluate<DrawdownStrokeProbe>(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      const strokes = rows
        .map((row) => {
          const svgs = row.querySelectorAll("svg");
          const lastSvg = svgs[svgs.length - 1] as SVGElement | undefined;
          if (!lastSvg) return null;
          const path = lastSvg.querySelector(
            "path[stroke]",
          ) as SVGPathElement | null;
          return path?.getAttribute("stroke") ?? null;
        })
        .filter((s): s is string => s !== null);
      return { strokes };
    });

    expect(probe.strokes.length).toBeGreaterThan(0);
    for (const stroke of probe.strokes) {
      // Accept either the literal #DC2626 hex OR the CSS-var form
      // var(--color-negative). The Sparkline component passes `color`
      // straight through to the SVG stroke attribute, so the CSS-var
      // form is what the live DOM shows.
      expect(
        /(^#dc2626$)|(^var\(--color-negative\)$)/i.test(stroke.trim()),
      ).toBe(true);
    }
  });
});
