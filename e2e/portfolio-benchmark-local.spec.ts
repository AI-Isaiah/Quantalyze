/**
 * Phase 166.4.1 D-07 / D-04 — five-size walk of `/portfolios/[id]` on the
 * runner-private local-stack lane, against a portfolio whose analytics were
 * computed by the REAL Python `_compute_portfolio_analytics`.
 *
 * LOCAL-ONLY and deliberately absent from every CI list (the seeded MA-8 list in
 * `ci.yml`, and so `e2e-seeded-hydration-guard.test.ts`'s census). It needs a
 * Python compute and a seeded BTC `benchmark_prices` cache on the lane, neither
 * of which a CI job provides. The conditional `test.skip` below is what keeps it
 * inert without the handoff; a skipped run is a FAILED check, never a pass.
 *
 * Why the credentials are the guard: the handoff carries an allocator that
 * exists only on the lane. A dev server pointed at any other database cannot
 * log it in, so `loginAs` fails loudly instead of the spec measuring a stranger.
 *
 * How to run (lane up via `scripts/local-stack/run.sh up`; nothing on port 3000;
 * the lane variables mapped as `ci.yml`'s seeded lane maps them, so the dev
 * server Playwright starts inherits them):
 *   1. `tsx scripts/seed-portfolio-benchmark-local.ts --out <scratch>/h.json`
 *   2. compute once in-process, write `storedBenchmarkTwr` into the handoff
 *   3. PORTFOLIO_BENCHMARK_LOCAL_CHECK=<scratch>/h.json \
 *      PORTFOLIO_BENCHMARK_LOCAL_EXPECT=values \
 *      PORTFOLIO_BENCHMARK_LOCAL_SHOTS=<scratch>/shots \
 *      npx playwright test e2e/portfolio-benchmark-local.spec.ts --reporter=list
 *   4. recompute with the benchmark fetch reported stale, then rerun with
 *      PORTFOLIO_BENCHMARK_LOCAL_EXPECT=note
 *
 * What each mode proves, at desktop 1280x800, 390x844, desktop 200% zoom
 * (640x400, the repo's V640 convention) and 375 / 360 wide (164.6.6.2 D-26):
 *   - `values`: the "vs BTC" card prints the BTC TWR the row stores and shows no
 *     status line.
 *   - `note`: the card prints the named stale note as a status line, and the BTC
 *     TWR, Alpha and Correlation figures each read the em-dash, never 0.
 *   - both: neither `documentElement` nor `#main-content` overflows horizontally.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./helpers/hydration-guard";
import { assertNoReflow } from "./helpers/reflow";
import { loginAs } from "./helpers/login";
import { formatPercent } from "../src/lib/utils";

const CHECK = process.env.PORTFOLIO_BENCHMARK_LOCAL_CHECK;

test.skip(
  !CHECK,
  "PORTFOLIO_BENCHMARK_LOCAL_CHECK is not set: this spec needs the handoff JSON the local seed writes (Phase 166.4.1 D-07)",
);

interface Handoff {
  portfolioId: string;
  email: string;
  password: string;
  storedBenchmarkTwr?: number;
}

const handoff: Handoff | null = CHECK
  ? (JSON.parse(readFileSync(CHECK, "utf8")) as Handoff)
  : null;
const MODE = process.env.PORTFOLIO_BENCHMARK_LOCAL_EXPECT;
const SHOTS = process.env.PORTFOLIO_BENCHMARK_LOCAL_SHOTS;

if (CHECK) {
  if (MODE !== "values" && MODE !== "note") {
    throw new Error(
      "PORTFOLIO_BENCHMARK_LOCAL_EXPECT must be 'values' or 'note'",
    );
  }
  if (!SHOTS) {
    throw new Error(
      "PORTFOLIO_BENCHMARK_LOCAL_SHOTS must name a scratch directory outside the repo",
    );
  }
  if (MODE === "values" && typeof handoff?.storedBenchmarkTwr !== "number") {
    throw new Error(
      "mode 'values' needs storedBenchmarkTwr in the handoff (written by the compute readback)",
    );
  }
}

const STALE_NOTE = "benchmark unavailable: stale";
const EM_DASH = "—";

const SIZES = [
  { name: "desktop 1280x800", width: 1280, height: 800 },
  { name: "phone 390x844", width: 390, height: 844 },
  { name: "desktop 200% zoom (V640)", width: 640, height: 400 },
  { name: "phone 375x812", width: 375, height: 812 },
  { name: "phone 360x800", width: 360, height: 800 },
] as const;

for (const size of SIZES) {
  test(`/portfolios/[id] ${MODE ?? "unset"} at ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await loginAs(page, handoff!.email, handoff!.password);
    await page.goto(`/portfolios/${handoff!.portfolioId}`);

    const heading = 'h3:has-text("vs BTC")';
    await assertNoReflow(page, heading);

    // The card the heading sits in: h3 -> header row -> Card.
    const card = page.locator(heading).locator("xpath=../..");
    // A figure is the value paragraph that follows its label paragraph.
    const figure = (label: string) =>
      card
        .locator("p", { hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::p[1]");

    await card.scrollIntoViewIfNeeded();
    const tag = `${MODE}-${size.width}x${size.height}`;
    await page.screenshot({ path: join(SHOTS!, `${tag}-page.png`), fullPage: true });
    await card.screenshot({ path: join(SHOTS!, `${tag}-card.png`) });

    if (MODE === "values") {
      await expect(figure("BTC TWR")).toHaveText(
        formatPercent(handoff!.storedBenchmarkTwr),
      );
      await expect(page.getByRole("status")).toHaveCount(0);
    } else {
      await expect(page.getByRole("status")).toHaveText(STALE_NOTE);
      await expect(figure("BTC TWR")).toHaveText(EM_DASH);
      await expect(figure("Alpha")).toHaveText(EM_DASH);
      await expect(figure("Correlation")).toHaveText(EM_DASH);
    }
  });
}
