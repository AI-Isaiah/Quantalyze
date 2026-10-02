---
phase: 14b
plan: 07
type: execute
wave: 4
depends_on: [14b-06]
files_modified:
  - package.json
  - package-lock.json
  - e2e/helpers/axe.ts
  - e2e/strategy-v2-axe.spec.ts
  - e2e/discovery-axe.spec.ts
  - e2e/strategy-v2-keyboard.spec.ts
  - e2e/strategy-v2-chart-parity.spec.ts
  - e2e/strategy-v2-partial-data.spec.ts
  - e2e/helpers/seed-test-project.ts
  - tests/a11y/chart-contrast.test.ts
  - tests/visual/strategy-v2-type-scale.test.ts
  - src/app/strategy/[id]/v2/page.tsx
  - src/app/globals.css
  - src/components/strategy-v2/StrategyV2Shell.tsx
  - src/components/strategy-v2/OverviewPanel.tsx
  - src/components/strategy-v2/HeadlineMetricsPanel.tsx
  - src/components/strategy-v2/DrawdownPanel.tsx
  - src/components/strategy-v2/ReturnsDistributionPanel.tsx
  - src/components/strategy-v2/RollingMetricsPanel.tsx
  - src/components/strategy-v2/TradeAndPositionPanel.tsx
  - src/components/strategy-v2/ExposureAndGreeksPanel.tsx
autonomous: true
requirements: [A11Y-02, A11Y-03, KPI-23b]
requirements_addressed: [A11Y-02, A11Y-03, KPI-23b]
tags: [test-suite, axe-core, keyboard-nav, chart-parity, playwright, skip-links]
must_haves:
  truths:
    - "@axe-core/playwright is installed as a devDependency"
    - "e2e/strategy-v2-axe.spec.ts asserts zero axe violations on /strategy/{golden-id}/v2 across wcag2a/wcag2aa/best-practice rule sets after all 7 panels reach data-panel-status='ready'"
    - "e2e/discovery-axe.spec.ts asserts zero axe violations on /discovery/[slug] AND env-var-gates against DISCOVERY_SLUG (Grok W-02): false-greens on missing slug are eliminated"
    - "e2e/strategy-v2-keyboard.spec.ts asserts the documented focus order: 7 skip-links → Panel 2 (5 elements) → Panel 5 (3 buttons) per UI-SPEC §7.3, with explicit scrollIntoViewIfNeeded() before each panel-section assertion (Grok W-02)"
    - "Skip-link mechanism added to StrategyV2Shell — 7 hidden-by-default links visible on tab-focus"
    - "Each <section data-panel> carries id='panel-{key}' + tabIndex={-1} for skip-link target focus"
    - "e2e/strategy-v2-chart-parity.spec.ts asserts 7 per-panel screenshots match goldens at ±2% + 1 full-page at ±5% + structural assertions"
    - "DailyHeatmap performance budget asserted < 300ms via performance.measure()"
    - "e2e/strategy-v2-partial-data.spec.ts extended: history bands × 4 new panels matrix (panels 4-7)"
    - "tests/a11y/chart-contrast.test.ts glob extends to all new strategy-v2 + chart files"
    - "tests/visual/strategy-v2-type-scale.test.ts glob extends to all new strategy-v2 + chart files"
  artifacts:
    - path: "package.json"
      provides: "@axe-core/playwright in devDependencies"
    - path: "e2e/helpers/axe.ts"
      provides: "Shared AxeBuilder factory used by both axe specs"
    - path: "e2e/strategy-v2-axe.spec.ts"
      provides: "axe-core scan on full /strategy/{id}/v2 route"
    - path: "e2e/discovery-axe.spec.ts"
      provides: "axe-core scan on /discovery/[slug] — env-var-gated on DISCOVERY_SLUG (Grok W-02 fix)"
    - path: "e2e/strategy-v2-keyboard.spec.ts"
      provides: "Tab traversal assertion with scrollIntoViewIfNeeded() before each panel-section assertion (Grok W-02 fix)"
    - path: "e2e/strategy-v2-chart-parity.spec.ts"
      provides: "Pixel-diff + structural + perf assertions on 7 panels + full-page"
    - path: "src/app/strategy/[id]/v2/page.tsx"
      provides: "Skip-link mechanism prepended to StrategyV2Shell"
  key_links:
    - from: "e2e/strategy-v2-axe.spec.ts"
      to: "@axe-core/playwright"
      via: "AxeBuilder import"
    - from: "e2e/strategy-v2-keyboard.spec.ts"
      to: "src/components/strategy-v2/StrategyV2Shell.tsx (skip-links + section ids)"
      via: "DOM selectors"
---

<objective>
Wave-4 part 1: ship the test infrastructure that gates the v0.17.0.0 milestone before Plan 14b-08 flips the default flag. Adds:

- `@axe-core/playwright` devDependency.
- 4 new Playwright specs (`strategy-v2-axe`, `discovery-axe`, `strategy-v2-keyboard`, `strategy-v2-chart-parity`) — all authored as authored-but-skipped if seed-helper env vars are absent (mirrors Phase 14a-05 partial-data spec pattern).
- Skip-link mechanism inside `StrategyV2Shell` (and the route `page.tsx` because the skip-links must render OUTSIDE the panel section list per UI-SPEC §7.2 — they live at the route shell level).
- Existing partial-data spec extended to cover panels 4-7 history bands.
- Existing chart-contrast + type-scale Vitest tests glob-extended to cover all new 14b src files.
- Seed helper extension authored — a `seedStrategyWithHistory(opts: { days: number })` function in `e2e/helpers/seed-test-project.ts` that the Phase 14a partial-data spec stubs out today.

Purpose: A11Y-02 (axe-core CI on full route + Discovery), A11Y-03 (keyboard nav verified), KPI-23b panel 4-7 partial-data matrix, plus chart-snapshot parity baseline goldens.
Output: 1 npm install + 7 new/extended e2e specs + 1 helper file + skip-link DOM addition + 2 Vitest extensions. Goldens (.png) created on first local run via `--update-snapshots`; in CI they're committed as part of this plan's PR.

**Revision (2026-04-29 Grok W-02):**
- `discovery-axe.spec.ts` now env-var-gates on `DISCOVERY_SLUG` (or falls back to a documented default seeded slug). Tests skip if neither is set, eliminating false-green passes against an empty 404/empty page.
- `strategy-v2-keyboard.spec.ts` now calls `await section.scrollIntoViewIfNeeded()` BEFORE each panel-section keyboard assertion so lazy panels (4-7) actually mount and their interactive children join the tab order. Without this, the test silently skipped the lazy panels.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-CONTEXT.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@DESIGN.md
@e2e/strategy-v2-partial-data.spec.ts
@e2e/discovery-sparkline-regression.spec.ts
@e2e/helpers/seed-test-project.ts
@tests/a11y/chart-contrast.test.ts
@tests/visual/strategy-v2-type-scale.test.ts
@src/components/strategy-v2/StrategyV2Shell.tsx
@src/app/strategy/[id]/v2/page.tsx
@playwright.config.ts
@src/app/globals.css

<interfaces>
<!-- Pre-existing patterns the executor uses. -->

From Phase 14a-05 SUMMARY:
- Top-level `tests/a11y/` and `tests/visual/` dirs are wired into vitest.config.ts.
- IntersectionObserver stub is global in `src/test-setup.ts`.
- Phase 14a authored `e2e/strategy-v2-partial-data.spec.ts` as authored-but-skipped (env-var gate via `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`).
- The `seedStrategyWithHistory` helper currently throws — Plan 14b-07 extends it to actually seed strategies.

From `e2e/helpers/seed-test-project.ts` (existing — `seedTestAllocator` and `seedBridgeCandidate`):

```typescript
// Existing pattern — uses Supabase service-role key to create test rows.
// Returns IDs that tests can `await page.goto(...)` against.
export async function seedTestAllocator(opts?: ...): Promise<{ id: string; ... }>;
export async function seedBridgeCandidate(opts?: ...): Promise<{ strategyId: string; ... }>;
```

The new `seedStrategyWithHistory` follows the same pattern: insert a `strategies` row with `status='published'` plus a `strategy_analytics` row with synthetic returns_series of N days length plus minimal scalars to drive the eager panels. The Phase 14b-07 helper does NOT need to populate the sibling table (`strategy_analytics_series`) — the lazy hook will fall through to empty payloads + the panels will render their sub-section banners or empty fallbacks gracefully.

From `e2e/strategy-v2-partial-data.spec.ts:46-52` (existing skip pattern):

```typescript
test.describe("Phase 14a — partial-data history bands (KPI-23a)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "strategy-v2 partial-data: seed-helper env vars not wired ...",
  );
  // ...
});
```

Plan 14b-07 mirrors this pattern verbatim in all 4 new specs (axe / keyboard / parity / extended-partial-data). **Grok W-02**: discovery-axe.spec.ts ALSO gets a skip gate keyed on `DISCOVERY_SLUG` (or `HAS_SEED_ENV`) so it never silently passes on an empty discovery route.

From src/app/strategy/[id]/v2/page.tsx (Phase 14a-04 — current shape, 31 LOC):

```typescript
export default async function StrategyV2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) notFound();
  return <StrategyV2Shell detail={result} />;
}
```

The skip-links must render OUTSIDE the StrategyV2Shell so they appear at the very top of the route. Add them inside this `page.tsx` (Server Component is fine — they're static `<a>` tags). UI-SPEC §7.2 specifies the 7 skip-link labels verbatim.

`@axe-core/playwright` package documentation: AxeBuilder API reference. Per CLAUDE.md banned-packages list, this package is NOT on the list — it's the official Anthropic-trusted accessibility tool.

Per UI-SPEC §7.3 the focus order is:

```
1.  Skip-link "Skip to Overview"
2.  Skip-link "Skip to Headline metrics"
3.  Skip-link "Skip to Drawdown"
4.  Skip-link "Skip to Returns distribution"
5.  Skip-link "Skip to Rolling metrics"
6.  Skip-link "Skip to Trades & positions"
7.  Skip-link "Skip to Exposure & greeks"
8.  (Panel 1 Overview — read-only, no interactive elements)
9.  Panel 2 — Cumulative button
10. Panel 2 — Underwater button
11. Panel 2 — Rolling Sharpe button (NEWLY ENABLED)
12. Panel 2 — Log returns button (NEWLY ENABLED)
13. Panel 2 — BTC benchmark checkbox (only when in cumulative/underwater view)
14-15. (Panels 3 + 4 — read-only)
16. Panel 5 — 3M button
17. Panel 5 — 6M button
18. Panel 5 — 12M button
19-20. (Panels 6 + 7 — read-only)
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install @axe-core/playwright + add skip-link mechanism + extend partial-data spec helper</name>
  <files>package.json, package-lock.json, src/app/strategy/[id]/v2/page.tsx, src/components/strategy-v2/StrategyV2Shell.tsx, src/app/globals.css, e2e/helpers/seed-test-project.ts, e2e/strategy-v2-partial-data.spec.ts</files>
  <read_first>
    - package.json (devDependencies block — add @axe-core/playwright after the existing playwright entry)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §7.2 (full skip-link mechanism + styling spec)
    - src/app/strategy/[id]/v2/page.tsx (current 31-LOC shape)
    - src/components/strategy-v2/StrategyV2Shell.tsx (post 14b-06; add `id` + `tabIndex={-1}` to each section)
    - src/app/globals.css (verify `bg-surface`, `border-border`, `text-accent` classes exist; pick a CSS strategy for skip-link visible-on-focus state)
    - e2e/helpers/seed-test-project.ts (existing seed helpers — pattern reference)
    - e2e/strategy-v2-partial-data.spec.ts (Phase 14a — extend to cover panels 4-7)
  </read_first>
  <action>
    **A. Install @axe-core/playwright as a devDependency:**

    Run: `npm install --save-dev @axe-core/playwright`. This updates `package.json` and `package-lock.json`. Do NOT pin to an exact version unless project convention requires; the SemVer caret range is acceptable.

    **B. Add skip-link mechanism in src/app/strategy/[id]/v2/page.tsx:**

    Replace the current page.tsx body with:

    ```typescript
    import type { Metadata } from "next";
    import { notFound } from "next/navigation";
    import { getStrategyDetailV2 } from "@/lib/queries";
    import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";

    export async function generateMetadata({
      params,
    }: {
      params: Promise<{ id: string }>;
    }): Promise<Metadata> {
      const { id } = await params;
      const result = await getStrategyDetailV2(id);
      if (!result) {
        return { title: "Strategy Not Found | Quantalyze" };
      }
      return {
        title: `${result.strategy.name} — v2 | Quantalyze`,
        description: `${result.strategy.name} — Verified quantitative strategy on Quantalyze.`,
      };
    }

    const SKIP_LINKS: { href: string; label: string }[] = [
      { href: "#panel-overview", label: "Skip to Overview" },
      { href: "#panel-headline-equity", label: "Skip to Headline metrics" },
      { href: "#panel-drawdown", label: "Skip to Drawdown" },
      { href: "#panel-returns-distribution", label: "Skip to Returns distribution" },
      { href: "#panel-rolling", label: "Skip to Rolling metrics" },
      { href: "#panel-trades", label: "Skip to Trades & positions" },
      { href: "#panel-exposure", label: "Skip to Exposure & greeks" },
    ];

    export default async function StrategyV2Page({
      params,
    }: {
      params: Promise<{ id: string }>;
    }) {
      const { id } = await params;
      const result = await getStrategyDetailV2(id);
      if (!result) notFound();
      return (
        <>
          <nav aria-label="Page sections" className="strategy-v2-skip-nav">
            {SKIP_LINKS.map((sl) => (
              <a key={sl.href} href={sl.href} className="strategy-v2-skip-link">
                {sl.label}
              </a>
            ))}
          </nav>
          <StrategyV2Shell detail={result} />
        </>
      );
    }
    ```

    **C. Add skip-link CSS in src/app/globals.css:**

    Append to the existing `globals.css` (do NOT modify existing rules):

    ```css
    /* Phase 14b — skip-link mechanism for /strategy/[id]/v2 keyboard nav (A11Y-03) */
    .strategy-v2-skip-link {
      position: absolute;
      left: -9999px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    }
    .strategy-v2-skip-link:focus {
      position: fixed;
      top: 8px;
      left: 8px;
      z-index: 100;
      width: auto;
      height: auto;
      padding: 8px 12px;
      background: var(--color-surface);
      border: 1px solid var(--color-accent);
      color: var(--color-accent);
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 400;
      text-decoration: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      outline: 2px solid var(--color-accent);
      outline-offset: 1px;
    }
    ```

    Verify `--color-surface` and `--color-accent` exist in globals.css before this addition. If `--color-accent` is named differently (e.g. `--color-text-accent`), substitute the actual token name from the file.

    **D. Add panel section ids + tabIndex in src/components/strategy-v2/StrategyV2Shell.tsx:**

    Each panel section needs `id="panel-{key}"` + `tabIndex={-1}` so the skip-link target is programmatically focusable. The Wave-2 panel components already render `<section data-panel="...">`. Add the `id` and `tabIndex` props at the call site OR push these into each panel component's render — cleanest path is to add them at the panel-component level since each component already renders its own `<section>`. Do this for ALL 7 panels:

    Inside each of these components, add to the existing `<section ...>` JSX:
    - OverviewPanel.tsx: add `id="panel-overview" tabIndex={-1}` to its `<section data-panel="overview">`.
    - HeadlineMetricsPanel.tsx: add `id="panel-headline-equity" tabIndex={-1}`.
    - DrawdownPanel.tsx: add `id="panel-drawdown" tabIndex={-1}`.
    - ReturnsDistributionPanel.tsx: add `id="panel-returns-distribution" tabIndex={-1}`.
    - RollingMetricsPanel.tsx: add `id="panel-rolling" tabIndex={-1}`.
    - TradeAndPositionPanel.tsx: add `id="panel-trades" tabIndex={-1}`.
    - ExposureAndGreeksPanel.tsx: add `id="panel-exposure" tabIndex={-1}`.

    These are 7 single-line additions. No behavior change for existing tests.

    **E. Extend `seedStrategyWithHistory` helper in e2e/helpers/seed-test-project.ts:**

    Append the new helper:

    ```typescript
    /**
     * Phase 14b — Seeds a published strategy with N days of synthetic returns
     * for partial-data, axe, keyboard, and chart-parity Playwright specs.
     *
     * Inserts:
     *  - one row in `strategies` with status='published'
     *  - one row in `strategy_analytics` with `computation_status='complete'`,
     *    `returns_series` of length N, plus minimal scalars to drive eager
     *    panels 1-3.
     *
     * Returns the strategy id. The caller MUST run cleanup (delete by id) in
     * an afterEach if the test suite manages teardown — current pattern is
     * to leave seeded data around and rely on a separate cron / manual reset
     * (mirrors seedBridgeCandidate's behaviour).
     */
    export async function seedStrategyWithHistory(opts: {
      days: number;
      name?: string;
    }): Promise<string> {
      const supabaseUrl = process.env.TEST_SUPABASE_URL!;
      const supabaseKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(supabaseUrl, supabaseKey);

      const name = opts.name ?? `Phase 14b ${opts.days}d fixture`;
      const startDate = new Date(Date.now() - opts.days * 86_400_000)
        .toISOString().slice(0, 10);

      // 1. Insert strategy row
      const { data: strategy, error: sErr } = await sb
        .from("strategies")
        .insert({
          name, slug: `phase-14b-${opts.days}d-${Date.now()}`,
          status: "published",
          start_date: startDate,
          supported_exchanges: ["binance"],
          strategy_types: ["spot"],
          subtypes: [], markets: ["BTC"],
        })
        .select("id")
        .single();
      if (sErr || !strategy) throw new Error(`seedStrategyWithHistory failed: ${sErr?.message}`);

      // 2. Synthesize a deterministic returns_series of `days` length
      const series = Array.from({ length: opts.days }, (_, i) => ({
        date: new Date(Date.now() - (opts.days - i) * 86_400_000).toISOString().slice(0, 10),
        value: 1 + Math.sin(i / 30) * 0.05 * (i / opts.days), // small drift
      }));

      // 3. Insert strategy_analytics row with minimum keys
      const { error: aErr } = await sb.from("strategy_analytics").insert({
        strategy_id: strategy.id,
        computation_status: "complete",
        returns_series: series,
        cumulative_return: series[series.length - 1].value - 1,
        cagr: 0.12, sharpe: 1.4, sortino: 1.8,
        max_drawdown: -0.08, volatility: 0.18,
        rolling_metrics: opts.days >= 90 ? { sharpe_90d: series.slice(-90).map((p, i) => ({ date: p.date, value: 1.0 + i * 0.001 })) } : null,
        monthly_returns: opts.days >= 30 ? buildMonthlyReturns(series) : null,
        return_quantiles: null,
        trade_metrics: opts.days >= 30 ? {
          total_positions: 50, open_positions: 5, closed_positions: 45,
          win_rate: 0.6, avg_roi: 0.05, avg_duration_days: 3,
          long_count: 30, short_count: 20,
          best_trade_roi: 0.15, worst_trade_roi: -0.08,
          expectancy: 0.02, risk_reward_ratio: 1.5,
          weighted_risk_reward_ratio: 1.4,
          sqn: 1.6, profit_factor_long: 1.7, profit_factor_short: 1.3,
          gross_volume_usd: 1_000_000, mean_trade_size_usd: 20_000,
          daily_turnover_usd: 50_000, monthly_turnover_usd: 1_500_000,
          payoff_ratio: 1.4, profit_factor: 1.5,
          winners_count: 30, losers_count: 15,
          trade_mix: { long: { count: 30, total_notional: 600_000, avg_holding_period_hours: 72 },
                       short: { count: 20, total_notional: 400_000, avg_holding_period_hours: 48 } },
        } : null,
        metrics_json: {
          benchmark_returns: opts.days >= 30 ? series.map((p) => ({ date: p.date, value: p.value * 0.95 })) : null,
          alpha: 0.03, beta: 0.85, information_ratio: 0.7, treynor_ratio: 0.04,
        },
      });
      if (aErr) throw new Error(`seedStrategyWithHistory analytics failed: ${aErr.message}`);

      return strategy.id;
    }

    function buildMonthlyReturns(series: { date: string; value: number }[]): Record<string, Record<string, number>> {
      const out: Record<string, Record<string, number>> = {};
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      for (const p of series) {
        const yr = p.date.slice(0, 4);
        const mo = months[parseInt(p.date.slice(5, 7), 10) - 1];
        if (!out[yr]) out[yr] = {};
        if (!(mo in out[yr])) out[yr][mo] = 0;
        // Simple aggregation — last value of month wins (test fixture, not production accuracy)
        out[yr][mo] = (p.value - 1) / Math.max(1, series.indexOf(p));
      }
      return out;
    }
    ```

    Verify Supabase schema column names match before insert. If `strategies.subtypes` or `markets` is NOT NULL with no default, the insert will fail; fall back to JSON-typed empty arrays. Run `psql` schema check to confirm column names.

    **F. Extend `e2e/strategy-v2-partial-data.spec.ts` to cover panels 4-7:**

    Add these test cases to the existing test loop (lines 55-137 in current spec):

    ```typescript
    // Panel 4 banner — needs ≥30 days
    if (band.days < 30) {
      const returnsDist = page.locator('section[data-panel="returns-distribution"]');
      await returnsDist.scrollIntoViewIfNeeded();
      await expect(returnsDist.getByText(
        /at least 30 days of trading history to populate Returns distribution/,
      )).toBeVisible();
    }
    // Panel 5 banner — needs ≥90 days
    if (band.days < 90) {
      const rolling = page.locator('section[data-panel="rolling"]');
      await rolling.scrollIntoViewIfNeeded();
      await expect(rolling.getByText(
        /at least 90 days of trading history for rolling 3M metrics/,
      )).toBeVisible();
    }
    // Panel 6 banner — needs ≥1 trade. With our seed, all bands have 50
    // positions (>= 30d) so the 7-day band shows the banner because trade
    // metrics is null (seed makes trade_metrics null when days < 30).
    if (band.days < 30) {
      const trades = page.locator('section[data-panel="trades"]');
      await trades.scrollIntoViewIfNeeded();
      await expect(trades.getByText(
        /This strategy hasn't logged any trades yet/,
      )).toBeVisible();
    }
    // Panel 7 banner — needs ≥30 days
    if (band.days < 30) {
      const exposure = page.locator('section[data-panel="exposure"]');
      await exposure.scrollIntoViewIfNeeded();
      await expect(exposure.getByText(
        /at least 30 days of trading history to compute exposure and benchmark greeks/,
      )).toBeVisible();
    }
    // Panel-count invariant remains 7
    await expect(page.locator("section[data-panel]")).toHaveCount(7);
    ```

    Verify the panel-count assertion runs after panels 4-7 have been scrolled into view.
  </action>
  <verify>
    <automated>npm run build && grep -c "@axe-core/playwright" package.json</automated>
  </verify>
  <done>
    - `npm run build` exits 0.
    - `grep -c "@axe-core/playwright" package.json` returns ≥ 1.
    - `grep -c "strategy-v2-skip-link" src/app/globals.css` returns 1.
    - `grep -c "strategy-v2-skip-nav" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1.
    - `grep -rcE 'id="panel-(overview|headline-equity|drawdown|returns-distribution|rolling|trades|exposure)"' src/components/strategy-v2/` returns 7.
    - `grep -rcE 'tabIndex=\\{-1\\}' src/components/strategy-v2/` returns ≥ 7.
    - `grep -c "seedStrategyWithHistory" e2e/helpers/seed-test-project.ts` ≥ 1 (export added).
    - `npm run lint` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 2: Author 4 new Playwright specs (axe x2 with W-02 env-var gate, keyboard with W-02 scrollIntoView, chart-parity)</name>
  <files>e2e/helpers/axe.ts, e2e/strategy-v2-axe.spec.ts, e2e/discovery-axe.spec.ts, e2e/strategy-v2-keyboard.spec.ts, e2e/strategy-v2-chart-parity.spec.ts</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §6 (axe-core test contract)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §7 (keyboard nav + skip-link mechanism)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §8 (chart-parity tolerance + structural assertions + perf budget)
    - e2e/strategy-v2-partial-data.spec.ts (env-var skip pattern — replicate verbatim)
    - playwright.config.ts (verify testDir = './e2e')
  </read_first>
  <action>
    **A. Shared axe helper at `e2e/helpers/axe.ts`:**

    ```typescript
    import type { Page } from "@playwright/test";
    import AxeBuilder from "@axe-core/playwright";

    /**
     * Phase 14b — shared AxeBuilder factory. Configures the WCAG 2.0 A + AA +
     * best-practice rule set per UI-SPEC §6.3 (zero-violations threshold).
     */
    export function buildAxe(page: Page) {
      return new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "best-practice"]);
    }
    ```

    **B. e2e/strategy-v2-axe.spec.ts:**

    ```typescript
    import { test, expect } from "@playwright/test";
    import { buildAxe } from "./helpers/axe";
    import { seedStrategyWithHistory } from "./helpers/seed-test-project";

    const HAS_SEED_ENV =
      !!process.env.TEST_SUPABASE_URL &&
      !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

    test.describe("Phase 14b — strategy v2 axe (A11Y-02)", () => {
      test.skip(
        !HAS_SEED_ENV,
        "strategy-v2 axe: seed-helper env vars not wired (set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY)",
      );

      test("zero axe violations on /strategy/{id}/v2 with all 7 panels ready", async ({ page }) => {
        const strategyId = await seedStrategyWithHistory({ days: 365 });
        await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);

        // Wait for all 7 panels to reach data-panel-status="ready"
        const panelKeys = [
          "overview", "headline-equity", "drawdown",
          "returns-distribution", "rolling", "trades", "exposure",
        ];
        for (const key of panelKeys) {
          await page.locator(`section[data-panel="${key}"]`).scrollIntoViewIfNeeded();
          await expect(
            page.locator(`section[data-panel="${key}"][data-panel-status="ready"]`),
          ).toBeVisible({ timeout: 10_000 });
        }

        const results = await buildAxe(page).analyze();
        expect(results.violations).toEqual([]);
      });
    });
    ```

    **C. e2e/discovery-axe.spec.ts (Grok W-02 — env-var-gated):**

    ```typescript
    import { test, expect } from "@playwright/test";
    import { buildAxe } from "./helpers/axe";

    /**
     * Phase 14b — discovery axe (A11Y-02).
     *
     * Grok W-02 fix: gate this spec behind DISCOVERY_SLUG (or fall back to a
     * known seeded slug if HAS_SEED_ENV is true). Without the gate, running
     * against an unseeded test DB silently passes against a 404 / empty page,
     * giving a false-green on a route axe never actually scanned.
     *
     * To run locally: set DISCOVERY_SLUG=crypto-sma (or your seeded slug).
     * Or: set TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY (default seed).
     */
    const DISCOVERY_SLUG = process.env.DISCOVERY_SLUG ?? "";
    const HAS_SEED_ENV =
      !!process.env.TEST_SUPABASE_URL &&
      !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
    const SLUG = DISCOVERY_SLUG || (HAS_SEED_ENV ? "crypto-sma" : "");

    test.describe("Phase 14b — discovery axe (A11Y-02)", () => {
      test.skip(
        !SLUG,
        "discovery axe: set DISCOVERY_SLUG (or TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY for default seed) to run this spec. Skipping prevents false-green on empty/404 pages (Grok W-02).",
      );

      test(`zero axe violations on /discovery/${SLUG || "<slug>"}`, async ({ page }) => {
        await page.goto(`/discovery/${SLUG}`);
        await page.waitForLoadState("networkidle");

        // Sanity gate: ensure the discovery page actually rendered a strategy,
        // not a 404 / empty state. axe scanning an empty <main> finds zero
        // violations regardless — that's the false-green Grok W-02 flagged.
        const strategyHeading = page.locator("h1, [data-strategy-name]");
        await expect(strategyHeading).toBeVisible({ timeout: 5_000 });

        const results = await buildAxe(page).analyze();
        expect(results.violations).toEqual([]);
      });
    });
    ```

    Note: `crypto-sma` is the canonical seeded discovery slug per `e2e/discovery-sparkline-regression.spec.ts` precedent. The fallback rule keeps CI working when `HAS_SEED_ENV=true` AND no explicit `DISCOVERY_SLUG` is provided.

    **D. e2e/strategy-v2-keyboard.spec.ts (Grok W-02 — explicit scrollIntoView before each panel assertion):**

    ```typescript
    import { test, expect } from "@playwright/test";
    import { seedStrategyWithHistory } from "./helpers/seed-test-project";

    const HAS_SEED_ENV =
      !!process.env.TEST_SUPABASE_URL &&
      !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

    test.describe("Phase 14b — strategy v2 keyboard nav (A11Y-03)", () => {
      test.skip(
        !HAS_SEED_ENV,
        "strategy-v2 keyboard: seed-helper env vars not wired",
      );

      test("tab order matches UI-SPEC §7.3", async ({ page }) => {
        const strategyId = await seedStrategyWithHistory({ days: 365 });
        await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);

        // Grok W-02 fix: explicitly scroll each panel into view BEFORE asserting
        // tab order. Lazy panels (4-7) only mount when their <section> intersects
        // the viewport. Without scrollIntoViewIfNeeded the keyboard test would
        // silently skip the lazy panels' interactive children (Panel 5's window
        // toggle in particular).
        const panelKeys = [
          "overview","headline-equity","drawdown",
          "returns-distribution","rolling","trades","exposure",
        ];
        for (const key of panelKeys) {
          const section = page.locator(`section[data-panel="${key}"]`);
          await section.scrollIntoViewIfNeeded();
          await expect(
            page.locator(`section[data-panel="${key}"][data-panel-status="ready"]`),
          ).toBeVisible({ timeout: 10_000 });
        }
        // Scroll back to top so the first tab focuses skip-link 1
        await page.evaluate(() => window.scrollTo({ top: 0 }));

        const expected = [
          { label: "Skip to Overview", panel: null },
          { label: "Skip to Headline metrics", panel: null },
          { label: "Skip to Drawdown", panel: null },
          { label: "Skip to Returns distribution", panel: null },
          { label: "Skip to Rolling metrics", panel: null },
          { label: "Skip to Trades & positions", panel: null },
          { label: "Skip to Exposure & greeks", panel: null },
          // Then Panel 2 segmented controls (5 elements: 4 buttons + checkbox)
          { label: "Cumulative",     panel: "headline-equity" },
          { label: "Underwater",     panel: "headline-equity" },
          { label: "Rolling Sharpe", panel: "headline-equity" },
          { label: "Log returns",    panel: "headline-equity" },
          { label: "BTC benchmark",  panel: "headline-equity" },
          // Then Panel 5 window toggle (3 buttons)
          { label: "3M",  panel: "rolling" },
          { label: "6M",  panel: "rolling" },
          { label: "12M", panel: "rolling" },
        ];

        for (const { label, panel } of expected) {
          // Grok W-02: re-scroll the panel into view immediately before
          // pressing Tab. Sequential scrolling earlier in this test is not
          // sufficient because Panel 5's lazy mount can shift layout enough
          // to push later panels out of viewport again.
          if (panel) {
            await page.locator(`section[data-panel="${panel}"]`).scrollIntoViewIfNeeded();
          }
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => {
            const el = document.activeElement;
            return el ? (el.textContent?.trim() ?? el.getAttribute("aria-label") ?? "") : "";
          });
          // Tolerate leading/trailing whitespace and ensure label is contained
          expect(focused.includes(label)).toBe(true);
        }
      });
    });
    ```

    **E. e2e/strategy-v2-chart-parity.spec.ts:**

    ```typescript
    /**
     * Phase 14b — chart-snapshot parity diff (Phase 14b SC#1)
     *
     * Goldens stored at e2e/__snapshots__/strategy-v2/{panel}.png.
     * Refresh: `npx playwright test e2e/strategy-v2-chart-parity.spec.ts --update-snapshots`.
     */
    import { test, expect } from "@playwright/test";
    import { seedStrategyWithHistory } from "./helpers/seed-test-project";

    const HAS_SEED_ENV =
      !!process.env.TEST_SUPABASE_URL &&
      !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

    test.describe("Phase 14b — chart-snapshot parity (SC#1)", () => {
      test.skip(
        !HAS_SEED_ENV,
        "strategy-v2 chart parity: seed-helper env vars not wired",
      );

      test("7 per-panel screenshots match goldens at ±2%; full-page at ±5%", async ({ page }) => {
        const strategyId = await seedStrategyWithHistory({ days: 252 });
        await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);

        const panelKeys = [
          "overview", "headline-equity", "drawdown",
          "returns-distribution", "rolling", "trades", "exposure",
        ];
        for (const key of panelKeys) {
          await page.locator(`section[data-panel="${key}"]`).scrollIntoViewIfNeeded();
          await expect(
            page.locator(`section[data-panel="${key}"][data-panel-status="ready"]`),
          ).toBeVisible({ timeout: 10_000 });
        }

        // Per-panel goldens at ±2%
        for (const key of panelKeys) {
          const panel = page.locator(`section[data-panel="${key}"]`);
          await panel.scrollIntoViewIfNeeded();
          await expect(panel).toHaveScreenshot(`panel-${key}.png`, {
            maxDiffPixelRatio: 0.02,
            threshold: 0.2,
          });
        }

        // Full-page golden at ±5%
        await page.evaluate(() => window.scrollTo({ top: 0 }));
        await expect(page).toHaveScreenshot("full-page.png", {
          fullPage: true,
          maxDiffPixelRatio: 0.05,
          threshold: 0.2,
        });

        // Structural assertions per UI-SPEC §8.5
        // 1) Each chart has exactly 1 strategy series stroke (#1B6B5A)
        const equityStrokes = await page.locator('section[data-panel="headline-equity"] path[stroke="#1B6B5A"]').count();
        expect(equityStrokes).toBeGreaterThanOrEqual(1);

        // 2) ≤1 BTC benchmark stroke (#94A3B8) per equity panel
        const btcStrokes = await page.locator('section[data-panel="headline-equity"] path[stroke="#94A3B8"]').count();
        expect(btcStrokes).toBeLessThanOrEqual(1);

        // 3) CHART_TICK_STYLE applied — at least one Recharts axis tick has font-variant-numeric: tabular-nums
        const sampleTick = page.locator('.recharts-cartesian-axis-tick text').first();
        await expect(sampleTick).toHaveCSS("font-variant-numeric", /tabular-nums/);

        // 4) DailyHeatmap performance budget < 300ms
        const paintMs = await page.evaluate(() => {
          const entries = performance.getEntriesByName("panel-4-paint");
          return entries.length > 0 ? entries[0].duration : -1;
        });
        if (paintMs >= 0) {
          expect(paintMs).toBeLessThan(300);
        }
      });
    });
    ```

    Concrete value: The `--update-snapshots` step is run LOCALLY by the executor after authoring the spec (assuming TEST_SUPABASE_URL is set on the dev machine). The committed PR includes the generated `.png` files under `e2e/__snapshots__/strategy-v2/`. If running locally is impractical, mark the goldens as TODO in `e2e/__snapshots__/strategy-v2/.gitkeep` and let the next CI run capture them.

    All 4 specs share the env-var skip pattern. None block CI on the absence of `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`. **Grok W-02**: discovery-axe.spec.ts ALSO honors `DISCOVERY_SLUG` (with HAS_SEED_ENV fallback) so empty pages don't pass.
  </action>
  <verify>
    <automated>npx playwright test e2e/discovery-axe.spec.ts e2e/strategy-v2-axe.spec.ts e2e/strategy-v2-keyboard.spec.ts e2e/strategy-v2-chart-parity.spec.ts --list</automated>
  </verify>
  <done>
    - `npx playwright test --list` enumerates all 4 new specs.
    - `grep -c "@axe-core/playwright" e2e/helpers/axe.ts` returns 1.
    - `grep -c "buildAxe" e2e/{strategy-v2-axe,discovery-axe}.spec.ts` returns 2 (one per spec).
    - `grep -c "seedStrategyWithHistory" e2e/{strategy-v2-axe,strategy-v2-keyboard,strategy-v2-chart-parity}.spec.ts` returns 3.
    - `grep -c "Skip to Overview" e2e/strategy-v2-keyboard.spec.ts` returns 1.
    - `grep -c "panel-4-paint" e2e/strategy-v2-chart-parity.spec.ts` returns 1.
    - All 4 specs use `test.skip(...)` — `grep -c "test.skip" e2e/strategy-v2-{axe,keyboard,chart-parity}.spec.ts e2e/discovery-axe.spec.ts` returns 4.
    - **`grep -c "DISCOVERY_SLUG" e2e/discovery-axe.spec.ts` returns ≥ 2 (env-var read + skip-gate condition) — Grok W-02 fix.**
    - **`grep -c "scrollIntoViewIfNeeded" e2e/strategy-v2-keyboard.spec.ts` returns ≥ 2 (scroll before each panel-section keyboard assertion) — Grok W-02 fix.**
    - `npm run build` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 3: Extend tests/a11y + tests/visual globs to cover all new 14b files</name>
  <files>tests/a11y/chart-contrast.test.ts, tests/visual/strategy-v2-type-scale.test.ts</files>
  <read_first>
    - tests/a11y/chart-contrast.test.ts (Phase 14a-05 — current glob pattern)
    - tests/visual/strategy-v2-type-scale.test.ts (Phase 14a-05 — current glob pattern)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §12.2 (extension scope)
  </read_first>
  <action>
    Both Phase 14a tests scan files via a glob (typically `src/components/strategy-v2/**/*.tsx` and/or `src/components/charts/**/*.tsx`). Phase 14b adds new files in BOTH directories — verify the existing glob already catches them (it should). If the glob is hard-coded to specific filenames, extend it.

    **A. tests/a11y/chart-contrast.test.ts:**

    Open the file. Locate the `glob` or `readdir` call. Confirm it covers:
    - `src/components/strategy-v2/{ReturnsDistributionPanel,RollingMetricsPanel,TradeAndPositionPanel,ExposureAndGreeksPanel,TradeMixSubPanel,BenchmarkGreeksTable,MetricCell}.tsx`
    - `src/components/charts/{DailyHeatmap,NetGrossExposureChart,TurnoverChart,RollingVolatilityChart,RollingSortinoChart,RollingAlphaBetaChart}.tsx`

    If the glob is `src/components/{strategy-v2,charts}/**/*.tsx` — no edit needed; the new files are caught for free. If filenames are listed explicitly, append the new ones.

    **B. tests/visual/strategy-v2-type-scale.test.ts:**

    Same procedure. Forbidden-class regex set unchanged: `font-medium|font-light|font-bold|text-sm|text-xl|text-2xl|text-\\[11px\\]|text-\\[13px\\]|text-\\[14px\\]`.

    Run the tests after the extension to confirm 0 violations. If any new file emits a forbidden class, fix it BEFORE this plan's commit (do not silently ignore).
  </action>
  <verify>
    <automated>npm test -- tests/a11y/chart-contrast.test.ts tests/visual/strategy-v2-type-scale.test.ts --run</automated>
  </verify>
  <done>
    - Both tests pass after globs include the new files.
    - `grep -rE "font-medium|text-sm|text-xl|text-2xl" src/components/strategy-v2/{ReturnsDistributionPanel,RollingMetricsPanel,TradeAndPositionPanel,ExposureAndGreeksPanel,TradeMixSubPanel,BenchmarkGreeksTable,MetricCell}.tsx src/components/charts/{DailyHeatmap,NetGrossExposureChart,TurnoverChart,RollingVolatilityChart,RollingSortinoChart,RollingAlphaBetaChart}.tsx` returns 0.
    - `grep -rE 'fill="#94A3B8"' src/components/strategy-v2/ src/components/charts/ -l | xargs grep -l "<text"` returns 0 files (no text-fill regression).
  </done>
</task>

</tasks>

<verification>
- `npm run build` exits 0.
- `grep -c "@axe-core/playwright" package.json` ≥ 1.
- `npx playwright test --list | grep -E "(strategy-v2-axe|discovery-axe|strategy-v2-keyboard|strategy-v2-chart-parity)"` returns 4 spec entries.
- `grep -rE 'id="panel-(overview|headline-equity|drawdown|returns-distribution|rolling|trades|exposure)"' src/components/strategy-v2/` returns 7 hits.
- `grep -c "strategy-v2-skip-link" src/app/globals.css` returns 1.
- `npm test -- tests/a11y tests/visual --run` green.
- `npm test -- src/components --run` green (existing 14a + Wave-2 14b tests still pass after panel sections receive id + tabIndex).
- **Grok W-02 invariants: `grep -c "DISCOVERY_SLUG" e2e/discovery-axe.spec.ts` ≥ 2 AND `grep -c "scrollIntoViewIfNeeded" e2e/strategy-v2-keyboard.spec.ts` ≥ 2.**
</verification>

<success_criteria>
- A11Y-02: axe-core wired on `/strategy/[id]/v2` and `/discovery/[slug]` via Playwright. Both specs gated on env vars (discovery-axe gates on DISCOVERY_SLUG OR HAS_SEED_ENV per Grok W-02).
- A11Y-03: keyboard-nav spec asserts focus order matching UI-SPEC §7.3 with explicit scrollIntoViewIfNeeded() before each panel assertion (Grok W-02). Skip-link mechanism implemented + section ids + tabIndex.
- KPI-23b extension: partial-data spec covers panels 4-7 partial-data banners across 7d/30d/90d/365d history bands.
- Chart-parity baseline: 7 per-panel + 1 full-page screenshot goldens captured (or marked TODO via .gitkeep). Structural + perf assertions in spec.
- Wave-4 part 1 complete; Plan 14b-08 (flag flip) is unblocked and is the milestone-final commit.
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-07-SUMMARY.md` documenting:
- @axe-core/playwright version installed
- Skip-link DOM additions per panel
- 4 new spec inventories with their authored-but-skipped flags
- Glob extension or no-op decision for the Vitest tests
- Grok W-02 mitigations: DISCOVERY_SLUG env-var gate on discovery-axe + scrollIntoViewIfNeeded() pre-assertion in keyboard spec
- Any goldens captured + commit policy
</output>
