---
phase: 14b
plan: 07
subsystem: test-infrastructure
tags: [test-suite, axe-core, keyboard-nav, chart-parity, playwright, skip-links, a11y]
requires:
  - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-06-SUMMARY.md
provides:
  - "@axe-core/playwright devDependency"
  - "skip-link mechanism on /strategy/[id]/v2 (7 links)"
  - "id+tabIndex={-1} on all 7 panel <section> elements"
  - "real seedStrategyWithHistory(opts: { days, name? }) helper"
  - "e2e/helpers/axe.ts shared AxeBuilder factory"
  - "4 new Playwright specs (axe x2, keyboard, chart-parity)"
  - "extended e2e/strategy-v2-partial-data.spec.ts to cover panels 4-7"
  - "extended chart-contrast + type-scale Vitest lint to 6 new chart files"
affects:
  - src/app/strategy/[id]/v2/page.tsx
  - src/app/globals.css
  - src/components/strategy-v2/{Overview,HeadlineMetrics,Drawdown,ReturnsDistribution,RollingMetrics,TradeAndPosition,ExposureAndGreeks}Panel.tsx
  - e2e/helpers/seed-test-project.ts
  - e2e/strategy-v2-partial-data.spec.ts
  - tests/a11y/chart-contrast.test.ts
  - tests/visual/strategy-v2-type-scale.test.ts
tech-stack:
  added:
    - "@axe-core/playwright ^4.11.2 (devDependency)"
  patterns:
    - "Skip-link mechanism (visually hidden, visible-on-focus) — UI-SPEC §7.2"
    - "Authored-but-skipped Playwright specs (env-var gate; mirrors Phase 14a partial-data pattern)"
    - "Grok W-02 mitigations: DISCOVERY_SLUG env-var gate + scrollIntoViewIfNeeded() pre-assertion"
    - "Shared AxeBuilder factory across axe specs (single rule-set source)"
key-files:
  created:
    - e2e/helpers/axe.ts
    - e2e/strategy-v2-axe.spec.ts
    - e2e/discovery-axe.spec.ts
    - e2e/strategy-v2-keyboard.spec.ts
    - e2e/strategy-v2-chart-parity.spec.ts
  modified:
    - package.json
    - package-lock.json
    - src/app/globals.css
    - "src/app/strategy/[id]/v2/page.tsx"
    - src/components/strategy-v2/OverviewPanel.tsx
    - src/components/strategy-v2/HeadlineMetricsPanel.tsx
    - src/components/strategy-v2/DrawdownPanel.tsx
    - src/components/strategy-v2/ReturnsDistributionPanel.tsx
    - src/components/strategy-v2/RollingMetricsPanel.tsx
    - src/components/strategy-v2/TradeAndPositionPanel.tsx
    - src/components/strategy-v2/ExposureAndGreeksPanel.tsx
    - e2e/helpers/seed-test-project.ts
    - e2e/strategy-v2-partial-data.spec.ts
    - tests/a11y/chart-contrast.test.ts
    - tests/visual/strategy-v2-type-scale.test.ts
decisions:
  - "Skip-links live in route page.tsx (Server Component) outside StrategyV2Shell so they appear at top of tab order per UI-SPEC §7.2 — skip-links are static <a> tags with no client-side state."
  - "id='panel-{key}' + tabIndex={-1} added at the panel-component level (each component already renders its own <section>) — minimizes Shell-level coupling, keeps each panel responsible for its own DOM identity."
  - "Phase 14b chart files explicitly listed in lint extensions (not glob-extended to src/components/charts/**) to avoid regressing legacy v1 components that legitimately use #94A3B8 as a benchmark stroke."
  - "seedStrategyWithHistory mirrors seedBridgeCandidate idiom — separate owner profile so the strategy is 'external' w.r.t. any test allocator. No 'slug' column inserted (verified via migration 001:47-67 — column does not exist on strategies)."
  - "Grok W-02 (revised post-Grok): discovery-axe.spec.ts gates on DISCOVERY_SLUG with HAS_SEED_ENV→'crypto-sma' fallback + sanity h1/h2 visibility check before the axe scan. Eliminates false-greens on 404/empty pages."
  - "Grok W-02 (revised post-Grok): strategy-v2-keyboard.spec.ts calls section.scrollIntoViewIfNeeded() before each panel-section assertion AND re-scrolls before each Tab press in the focus-order loop. Lazy panels (4-7) wouldn't otherwise mount their interactive children, silently skipping coverage."
metrics:
  duration_minutes: 9
  completed_date: "2026-04-29"
  task_count: 3
  file_count: 16
---

# Phase 14b Plan 07: Test Infrastructure Summary

axe-core CI gating + keyboard navigation contract + chart-snapshot parity diff + skip-link mechanism shipped to gate the v0.17.0.0 milestone before Plan 14b-08 flips the default flag. 4 new Playwright specs (authored-but-skipped on env vars), 1 shared AxeBuilder helper, 1 real seed helper, 7-link skip-nav + 7 panel-section ids + lint extension to 6 new chart files. Grok W-02 mitigations (DISCOVERY_SLUG env-var gate + explicit scrollIntoViewIfNeeded pre-assertion) folded in.

## Scope

Plan 14b-07 wave-4 part 1: ships the test infrastructure that gates the v0.17.0.0 milestone before the final flag-flip in Plan 14b-08.

- `@axe-core/playwright ^4.11.2` added as devDependency.
- 7-link skip-nav rendered at the top of `/strategy/[id]/v2` (UI-SPEC §7.2 verbatim labels).
- `id="panel-{key}"` + `tabIndex={-1}` added to all 7 panel `<section>` elements so skip-link targets are programmatically focusable but not in the natural tab order.
- 4 new Playwright specs:
  - `e2e/strategy-v2-axe.spec.ts` — zero axe violations on `/strategy/{id}/v2` after all 7 panels reach `data-panel-status="ready"`.
  - `e2e/discovery-axe.spec.ts` — zero violations on `/discovery/{slug}` (Grok W-02: env-var gated on `DISCOVERY_SLUG`; sanity h1/h2 check before scan).
  - `e2e/strategy-v2-keyboard.spec.ts` — focus order matches UI-SPEC §7.3 verbatim (Grok W-02: explicit `scrollIntoViewIfNeeded()` before each panel assertion AND before each Tab press).
  - `e2e/strategy-v2-chart-parity.spec.ts` — 7 per-panel screenshots ±2% + 1 full-page ±5% + 4 structural assertions per UI-SPEC §8.5 + DailyHeatmap perf budget < 300ms per §8.6.
- `e2e/helpers/axe.ts` shared AxeBuilder factory (wcag2a + wcag2aa + best-practice).
- Real `seedStrategyWithHistory(opts: { days; name? }): Promise<string>` helper in `e2e/helpers/seed-test-project.ts` — replaces the placeholder that lived inline in the partial-data spec at Phase 14a.
- `e2e/strategy-v2-partial-data.spec.ts` extended to cover panels 4-7 partial-data banners (KPI-23b matrix; 7d/30d/90d/365d × Panels 4-7 = 12 cells).
- `tests/a11y/chart-contrast.test.ts` + `tests/visual/strategy-v2-type-scale.test.ts` extended to scan 6 NEW chart files (DailyHeatmap, NetGrossExposureChart, TurnoverChart, RollingVolatility/Sortino/AlphaBetaChart) per UI-SPEC §12.2.

## What's New

### `@axe-core/playwright` ^4.11.2

Single new devDependency. Resolves under `node_modules/`; no transitive package conflicts.

### Skip-link mechanism (UI-SPEC §7.2)

Skip-links rendered in `src/app/strategy/[id]/v2/page.tsx` (Server Component, outside `<StrategyV2Shell>`). 7 links target the matching `id="panel-{key}"` on each panel section:

| # | href | Label |
|---|------|-------|
| 1 | `#panel-overview` | Skip to Overview |
| 2 | `#panel-headline-equity` | Skip to Headline metrics |
| 3 | `#panel-drawdown` | Skip to Drawdown |
| 4 | `#panel-returns-distribution` | Skip to Returns distribution |
| 5 | `#panel-rolling` | Skip to Rolling metrics |
| 6 | `#panel-trades` | Skip to Trades & positions |
| 7 | `#panel-exposure` | Skip to Exposure & greeks |

`.strategy-v2-skip-link` CSS in `src/app/globals.css` keeps each link visually hidden via `position: absolute; left: -9999px` until it receives keyboard focus, at which point it un-hides itself at `position: fixed; top: 8px; left: 8px; z-index: 100`.

### Panel section `id` + `tabIndex={-1}` additions

7 single-line additions across the 7 panel components — the skip-link target is programmatically focusable via `id="panel-{key}"` and `tabIndex={-1}` removes the section from the natural tab order. No behavior change for existing tests; 89 strategy-v2 component tests pass unchanged after the additions.

### `seedStrategyWithHistory` helper (real implementation)

Phase 14a authored a throwing placeholder inline in the partial-data spec; Plan 14b-07 ships the real helper at `e2e/helpers/seed-test-project.ts`. Mirrors the `seedBridgeCandidate` idiom (separate owner profile) and produces:

- One `auth.users` row (owner) + matching `profiles` upsert.
- One `strategies` row with `status='published'`, `benchmark='BTC'`, `start_date` set to `now() - days * 86400000`.
- One `strategy_analytics` row with `computation_status='complete'`, deterministic `returns_series`, `monthly_returns` (when `days >= 30`), `rolling_metrics.sharpe_90d` (when `days >= 90`), `trade_metrics` JSONB blob with all 33 frozen TradeMetrics keys (when `days >= 30`), `metrics_json.benchmark_returns` (when `days >= 30`).

NOTE — there is no `slug` column on the production strategies schema (verified via migration 001:47-67). The plan's draft helper had it; removed in implementation.

Heavy series (sibling-table contract per migration 087: `daily_returns_grid`, `exposure_series`, `turnover_series`, `rolling_*_series`, `log_returns_series`) are NOT seeded here. Lazy panels 4-7 fall through to their empty-payload sub-banners gracefully — that's the partial-data path the spec asserts.

### 4 new Playwright specs

| Spec | Asserts | Skip gate |
|------|---------|-----------|
| `e2e/strategy-v2-axe.spec.ts` | Zero axe violations (wcag2a + wcag2aa + best-practice) on `/strategy/{id}/v2` after all 7 panels ready | `!HAS_SEED_ENV` (TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY) |
| `e2e/discovery-axe.spec.ts` | Zero violations on `/discovery/{slug}` after sanity h1/h2 visibility check | `!SLUG` where `SLUG = DISCOVERY_SLUG \|\| (HAS_SEED_ENV ? "crypto-sma" : "")` (Grok W-02) |
| `e2e/strategy-v2-keyboard.spec.ts` | Tab order matches UI-SPEC §7.3 verbatim (15 expected focus stops: 7 skip-links → Panel 2 (5 elements) → Panel 5 (3 buttons)) | `!HAS_SEED_ENV` |
| `e2e/strategy-v2-chart-parity.spec.ts` | 7 per-panel `toHaveScreenshot` ±2% + 1 full-page ±5% + ≥1 strategy stroke #1B6B5A + ≤1 BTC stroke #94A3B8 + tabular-nums on tick text + DailyHeatmap perf < 300ms | `!HAS_SEED_ENV` |

All 4 specs enumerate via `npx playwright test --list`; goldens captured on first local run via `--update-snapshots`. None block CI on absence of seed env vars.

### Grok W-02 mitigations (revised 2026-04-29)

**discovery-axe env-var gate.** Without it, running on an unseeded test DB silently passes axe against a 404 / empty `<main>` — false-green. The gate falls back to `crypto-sma` (canonical seeded discovery slug per `e2e/discovery-sparkline-regression.spec.ts` precedent) when `HAS_SEED_ENV=true` and no explicit `DISCOVERY_SLUG` is provided. A second-layer sanity check inside the test waits for an `h1, h2` to be visible before scanning.

**Keyboard-spec scrollIntoViewIfNeeded() pre-assertion.** Lazy panels (4-7) only mount when their `<section>` intersects the viewport. Without the scroll, the test would silently skip the lazy panels' interactive children (Panel 5's window toggle in particular). The fix calls `section.scrollIntoViewIfNeeded()` before each panel-section assertion at warmup AND immediately before each Tab press in the focus-order loop (since Panel 5's lazy mount can shift layout enough to push later panels back out of viewport).

### Partial-data spec extension (KPI-23b)

`e2e/strategy-v2-partial-data.spec.ts` now imports the real `seedStrategyWithHistory` helper and asserts the panels 4-7 partial-data banner copy verbatim:

| Band | Panel 4 (≥30d) | Panel 5 (≥90d) | Panel 6 (trades) | Panel 7 (≥30d) |
|------|---------------|---------------|------------------|---------------|
| 7d | banner visible | banner visible | banner visible | banner visible |
| 30d | full | banner visible | full | full |
| 90d | full | full | full | full |
| 365d | full | full | full | full |

Panel-count invariant (`section[data-panel]` count === 7) re-asserted after panels 4-7 scroll into view.

### Vitest lint extension (UI-SPEC §12.2)

`tests/a11y/chart-contrast.test.ts` + `tests/visual/strategy-v2-type-scale.test.ts` extended with a `PHASE_14B_CHART_FILES` constant listing the 6 new charts (DailyHeatmap, NetGrossExposureChart, TurnoverChart, RollingVolatility/Sortino/AlphaBetaChart). Tests gain 3 new cases (1 chart-contrast + 2 type-scale forbidden-class checks). All 7 tests pass; 89 strategy-v2 component tests still pass.

Listed explicitly rather than blanket-globbing `src/components/charts/**` to avoid regressing legacy v1 chart components that legitimately use `#94A3B8` as a benchmark stroke (the forbidden pattern is text-FILL on text/legend nodes, not stroke).

## Verification

| Check | Result |
|------|--------|
| `npm run build` | exits 0 (compiled successfully in 4.5s) |
| `grep -c "@axe-core/playwright" package.json` | 1 |
| `npx playwright test --list` enumerates 4 new specs | 4 spec entries |
| 7 panel ids present in src/components/strategy-v2/ | 7 |
| 7 tabIndex={-1} additions | 7 |
| `grep -c "strategy-v2-skip-link" src/app/globals.css` | 2 (default + :focus rules) |
| `grep -c "strategy-v2-skip-nav" src/app/strategy/[id]/v2/page.tsx` | 1 |
| `npx vitest run tests/` | 10/10 pass (3 new lint cases) |
| `npx vitest run src/components/strategy-v2/` | 89/89 pass |
| `grep -c "DISCOVERY_SLUG" e2e/discovery-axe.spec.ts` (W-02 ≥2) | 6 |
| `grep -c "scrollIntoViewIfNeeded" e2e/strategy-v2-keyboard.spec.ts` (W-02 ≥2) | 4 |
| Forbidden classes in 14b strategy-v2 + chart files | 0 |
| Forbidden text-fill (`#94A3B8` / `#718096`) in 14b files | 0 |
| `npm run lint` | 0 errors, 19 pre-existing warnings (all unrelated to this plan) |

## Deviations from Plan

### Rule 1 - Bug — `seedStrategyWithHistory` schema correction

- **Found during:** Task 1 — pre-write schema verification of migration 001
- **Issue:** Plan's draft helper inserted `slug: 'phase-14b-...-${Date.now()}'` into `strategies` — the column does not exist on the production strategies table (verified via migration 001:47-67). Insert would have failed at runtime when the spec ran with `HAS_SEED_ENV=true`.
- **Fix:** Removed `slug` from the insert payload. All other text-array columns default to `'{}'` and DECIMAL fields are nullable, so the minimal payload (user_id, name, status, benchmark, start_date, supported_exchanges, strategy_types, subtypes, markets) is sufficient.
- **Files modified:** `e2e/helpers/seed-test-project.ts`
- **Commit:** `ceca676`

### Rule 2 - Critical functionality — discovery-axe sanity heading check

- **Found during:** Task 2
- **Issue:** Per Grok W-02 the env-var gate alone isn't sufficient — even when `DISCOVERY_SLUG` is set, the spec could silently pass against an empty grid if the slug points at a page with no strategies. axe scanning an empty `<main>` finds zero violations.
- **Fix:** Added a second-layer sanity check: `await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 5_000 })` before the axe scan. If the page renders neither an h1 nor h2, the assertion fails loudly.
- **Files modified:** `e2e/discovery-axe.spec.ts`
- **Commit:** `f0c3ec7`

### Rule 2 - Critical functionality — eager-vs-lazy data-panel-status branch

- **Found during:** Task 2
- **Issue:** Plan's draft axe + chart-parity specs unconditionally awaited `data-panel-status="ready"` on every panel. Eager panels (Overview, Headline metrics, Drawdown) don't carry the `data-panel-status` attribute at all — the assertion would have timed out indefinitely on those 3 panels.
- **Fix:** Added a runtime check `const hasStatus = await section.evaluate((el) => el.hasAttribute("data-panel-status"))` and only await `[data-panel-status="ready"]` when the attribute exists. Eager panels still get a `toBeVisible()` check so the panel-mount path is asserted.
- **Files modified:** `e2e/strategy-v2-axe.spec.ts`, `e2e/strategy-v2-keyboard.spec.ts`, `e2e/strategy-v2-chart-parity.spec.ts`
- **Commit:** `f0c3ec7`

### Rule 3 - Blocking — keyboard-spec aria-label/labels fallback

- **Found during:** Task 2
- **Issue:** The plan's draft `focused = el.textContent ?? aria-label ?? ""` fallback broke for the BTC benchmark `<input type="checkbox">` — checkboxes have neither textContent nor aria-label; the focusable element's accessible name comes from the surrounding `<label>`.
- **Fix:** Extended the focused-element accessor to also probe `(el as HTMLInputElement).labels?.[0]?.textContent` so the "BTC benchmark" assertion lands.
- **Files modified:** `e2e/strategy-v2-keyboard.spec.ts`
- **Commit:** `f0c3ec7`

## Authentication Gates

None encountered. All work executed without checkpoints; no auth gates needed.

## Goldens & Commit Policy

The 4 new Playwright specs are authored-but-skipped under the env-var gate (`HAS_SEED_ENV` / `DISCOVERY_SLUG`). Goldens for `e2e/strategy-v2-chart-parity.spec.ts` will be captured on first local run via `npx playwright test e2e/strategy-v2-chart-parity.spec.ts --update-snapshots` once the seed env vars are wired. Until then no `.png` goldens are committed.

Per UI-SPEC §8.7 — goldens regenerated only when an INTENTIONAL identity / layout change is made. PR description must call out which goldens were updated and why.

## Threat Flags

None. The changes add only:

1. Static skip-link `<a>` tags inside a Server Component (no client-side state, no auth surface).
2. CSS rules under a scoped class name (.strategy-v2-skip-link).
3. JSX-level `id` and `tabIndex={-1}` props on existing `<section>` elements.
4. New devDependency under `node_modules/`.
5. Test-only files under `e2e/` and `tests/`.

The `seedStrategyWithHistory` helper uses the `getAdmin()` service-role client that already exists in `e2e/helpers/seed-test-project.ts`; the existing `assertNotProductionSupabaseUrl` defense-in-depth check (Phase 11 WR-05) gates that client.

## Self-Check: PASSED

| Artifact | Status |
|----------|--------|
| Task 1 commit `ceca676` | FOUND |
| Task 2 commit `f0c3ec7` | FOUND |
| Task 3 commit `028bd91` | FOUND |
| `e2e/helpers/axe.ts` | FOUND |
| `e2e/strategy-v2-axe.spec.ts` | FOUND |
| `e2e/discovery-axe.spec.ts` | FOUND |
| `e2e/strategy-v2-keyboard.spec.ts` | FOUND |
| `e2e/strategy-v2-chart-parity.spec.ts` | FOUND |
| `seedStrategyWithHistory` exported | FOUND (4 hits) |
| skip-link CSS in globals.css | FOUND (2 rules) |
| skip-nav in page.tsx | FOUND |
| 7 panel ids | FOUND |
| 7 tabIndex={-1} additions | FOUND |
| `@axe-core/playwright` in package.json | FOUND |
