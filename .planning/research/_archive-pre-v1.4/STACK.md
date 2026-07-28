# Stack Research

**Domain:** App-wide responsive / mobile / WCAG-AA readiness for an existing desktop-first financial dashboard (Quantalyze v1.3 "Mobile & Adaptive UI")
**Researched:** 2026-06-27
**Confidence:** HIGH

## TL;DR — the headline finding

**This milestone needs almost zero new runtime dependencies.** The repo already
has every responsive primitive it needs, sometimes already wired:

- **Tailwind v4.2.2** (verified installed) ships **CSS container queries as a
  core feature** — `@container`, `container-type`, and `--container-*` size
  tokens are in `node_modules/tailwindcss/theme.css` with **no plugin** required.
- **ResizeObserver** is already used in production in 4 chart files, and
  `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` already contains a complete,
  DPR-aware **responsive Canvas + `viewBox`/`preserveAspectRatio` SVG-overlay**
  reference implementation (ResizeObserver → `contentRect.width` → canvas
  `width = cssW * dpr` + SVG overlay at `width:100%`). That is the exact pattern
  to generalize — it does not need to be invented.
- **`MobileNav.tsx` / `MobileTopBar.tsx` already exist** in `src/components/layout/`
  using the `md:hidden` Tailwind breakpoint pattern.
- The root layout (`src/app/layout.tsx`) **exports no `viewport`**, so Next.js 16
  injects the correct default (`width=device-width, initial-scale=1`) and
  **does not** add `user-scalable=no` — i.e. browser zoom is currently allowed,
  which is what WCAG 1.4.4 wants. Keep it that way; add a guard so nobody breaks it.

The new *capability* is therefore overwhelmingly **dev-tooling + a CI gate**, not
new app code dependencies. Only the testing/budget layer needs net-new packages.

## What the repo actually uses today (grounded, not assumed)

| Concern | What's actually in the repo | Implication for v1.3 |
|---------|------------------------------|----------------------|
| Styling system | **Tailwind v4.2.2**, CSS-first (`@import "tailwindcss"` + `@theme inline` in `globals.css`). **No `tailwind.config.*` file. Zero CSS modules.** All design tokens are `--color-*` / `--radius-*` / `--spacing-*` custom properties. | Responsive work = Tailwind responsive variants + **container queries**, edited in `globals.css`/JSX. No config file to add; no new styling tool. |
| Responsive primitives in use | `md:hidden` media-variant breakpoints (MobileNav). **`ResizeObserver`** in `EquityCurve.tsx`, `PortfolioEquityCurve.tsx`, `HeatmapPanels.tsx`, allocations `EquityChart.tsx`. **No `@container` anywhere yet.** | Container queries are an *upgrade path* for component-local responsiveness (a widget that must reflow by its own width, not the viewport — critical because the composer renders the factsheet inside a constrained column). |
| Charting (the prompt's premise is partly wrong — report honestly) | **Three** families, not "hand-rolled only": (1) **recharts 3.8.1** — 19 files, the allocations widgets + factsheet rolling/distribution panels, uses `ResponsiveContainer`; (2) **lightweight-charts 5.1.0** (Canvas) — `EquityCurve`, `PortfolioEquityCurve`, already ResizeObserver-width-driven; (3) **genuinely hand-rolled SVG/Canvas** — `Sparkline`, `DailyHeatmap`, `ReturnQuantiles`, `HeatmapPanels`. | Each family has a different responsive lever (see §"Responsive charting"). **No new charting library** for any of them. The frozen `scenario.ts`/`compute.ts` math is untouched — all three are presentation-only. |
| Layout locks | `max-w-[1440px]` hard-caps on `AllocationsTabs`, `ScenarioComposer` (2 sites), and the factsheet shell. ScenarioComposer is the "1440px-locked composer" from the brief. | These are `max-w-*` (caps, not fixed widths) so they already shrink below 1440 — the work is verifying child grids/charts reflow inside them at 320–768px, not removing a fixed width. |
| Viewport / zoom | Root `layout.tsx` exports only `metadata` (title/description). **No `viewport` export** → Next 16 default `width=device-width, initial-scale=1`, zoom allowed. | WCAG 1.4.4-safe today. Add an explicit `export const viewport` only to be canonical + add a grep guard against `userScalable:false` / `maximumScale:1`. |
| a11y test harness | **`@axe-core/playwright` 4.11.2** via `e2e/helpers/axe.ts` `buildAxe()` (`wcag2a + wcag2aa + best-practice`). Gates `/strategy/v2`, `/discovery`, wizard, csv-status, and `/allocations?tab=scenario`. Playwright **1.59.1**, single `chromium` `Desktop Chrome` project. | The harness exists and is the right one. v1.3 = **add Playwright viewport projects** + extend the axe spec list app-wide. No new a11y dependency. |
| Perf budget | **None.** No `@lhci/cli`, no lighthouse anywhere in `package.json` or `.github/workflows/`. | This is the one genuinely new tooling area. |

## Recommended Stack

### Core Technologies (already present — confirm + adopt, do NOT re-add)

| Technology | Version (installed) | Purpose | Why it's the answer here |
|------------|---------------------|---------|--------------------------|
| Tailwind CSS | **4.2.2** | Responsive layout + breakpoints + **container queries** | v4 made container queries a **first-class core feature** — `@container` variant, `container-type`, and `--container-{3xs…7xl}` tokens all ship in `theme.css`. No `@tailwindcss/container-queries` plugin (that was a v3 thing). Component-local reflow (a factsheet panel that adapts to its column width inside the 1440-capped composer, not the viewport) is exactly the container-query use case. |
| ResizeObserver (browser API) | native | JS-measured responsive width for Canvas/SVG charts | Already the established pattern in the repo (4 files). The **only** correct primitive for Canvas (`lightweight-charts`) and DPR-aware hand-rolled canvas, where CSS alone can't drive an intrinsic pixel buffer. `HeatmapPanels.tsx` is the in-repo template. |
| recharts | **3.8.1** | The 19 SVG chart sites | Already responsive via its `<ResponsiveContainer>`; v1.3 work is giving each `ResponsiveContainer` a sane mobile `aspect`/min-height and confirming axis-tick density at 320px. **Note the existing `accessibilityLayer={false}` opt-out convention** (DESIGN.md 2026-04-30) — preserve it on any new/edited chart. |
| Next.js `Viewport` export | Next **16.2.3** | Canonical viewport meta + zoom-allow guarantee | Next 16 already injects the WCAG-correct default. Add `export const viewport: Viewport = { width: "device-width", initialScale: 1 }` in `src/app/layout.tsx` to make it explicit and **deliberately omit `maximumScale`/`userScalable`** so zoom stays enabled (WCAG 1.4.4 / 1.4.10). Verified against `node_modules/next/dist/docs/.../generate-viewport.md`. |

### Supporting Libraries (net-new — the actual installs)

| Library | Version (pin) | Purpose | When to use |
|---------|---------------|---------|-------------|
| `@lhci/cli` | **0.15.x** (Lighthouse 12.6.x; needs Node ≥18, runs on the repo's Node ≥20) | Mobile performance budget + perf/a11y assertions in CI | The one new capability with no in-repo equivalent. Add a `lighthouserc.json` (mobile preset) + `budget.json` (resource-size budgets) and a new CI job that runs it against `next start` on the public routes. **Note: Lighthouse 13 requires Node 22.19+** — stay on LHCI 0.15 / Lighthouse 12.6 to match the repo's Node ≥20 engines. |
| `treosh/lighthouse-ci-action` | **`@v12`** (12.6.2, bundles Lighthouse 12.6) | GitHub Actions wrapper for the budget job | Cleanest way to slot LHCI into `ci.yml` as a non-blocking-then-blocking job, mirroring how `frontend-coverage` was ratcheted. A GitHub Action, not an npm dep — no `package.json` change. |

> That is the **entire** net-new dependency footprint for v1.3: `@lhci/cli`
> (devDependency) + one pinned GitHub Action. Everything else is already installed.

### Development Tools (extend what exists — no install)

| Tool | What to do | Notes |
|------|-----------|-------|
| Playwright **1.59.1** | Add **viewport projects** to `playwright.config.ts`: `mobile-portrait` (`devices['Pixel 7']` or a 360–390px viewport), `tablet`, and a **reflow project at 320px CSS width**. Keep the existing `chromium` `Desktop Chrome` project. | Playwright `devices` presets already imported in the config. Multi-project = the idiomatic way to run the same specs across viewports. No new package. |
| `@axe-core/playwright` **4.11.2** via `buildAxe()` | Extend the axe spec list from the current ~5 routes to **app-wide** (allocator dashboard tabs, Bridge, Risk, Single-Strategy, onboarding wizard, `/portfolios`, `/security`, admin, public/marketing). Reuse `buildAxe(page)` verbatim — it already carries `wcag2a+wcag2aa+best-practice`. | Two integration gotchas, both already solved in-repo and must be repeated: (1) **FLOW-01** — every new seed-gated spec must be added to BOTH the `HAS_SEED_ENV` skip-guard AND the `npx playwright test …` list in `ci.yml`, or it silently never runs (per project memory). (2) For surfaces that **embed** the factsheet (composer), filter to `impact === 'serious' \|\| 'critical'` like `composer-axe.spec.ts` does — embedded landmark nesting fires moderate page-level best-practice nits legitimately. |
| Zoom/reflow assertion | A Playwright reflow spec: set viewport to **320 CSS px** and assert `document.documentElement.scrollWidth <= clientWidth` (no horizontal scroll = WCAG 1.4.10); for 200%/400% "resize text", emulate via a 640px viewport at `deviceScaleFactor` or CSS zoom and assert no clipping. | No library — pure Playwright assertions. This is the "automated reflow check at 320px & 400% zoom" the milestone's verification line calls for. |

## Installation

```bash
# Net-new dev dependency (the ONLY package.json change for v1.3):
npm install -D @lhci/cli@^0.15.0

# Nothing else to install — already present and confirmed:
#   tailwindcss@4.2.2          (container queries are core, no plugin)
#   @axe-core/playwright@4.11.2
#   @playwright/test@1.59.1
#   recharts@3.8.1  lightweight-charts@5.1.0  next@16.2.3
```

```yaml
# .github/workflows/ci.yml — new perf-budget job (GitHub Action, no npm dep):
#   uses: treosh/lighthouse-ci-action@v12
#   with:
#     configPath: ./lighthouserc.json
#     budgetPath: ./budget.json
```

## Alternatives Considered

| Recommended | Alternative | When the alternative would win (and why it doesn't here) |
|-------------|-------------|----------------------------------------------------------|
| Tailwind v4 native container queries | `@tailwindcss/container-queries` plugin | Only needed on Tailwind **v3**. The repo is v4.2.2 where it's core — adding the plugin would be dead weight / version-conflict risk. |
| ResizeObserver + `viewBox`/`preserveAspectRatio` for hand-rolled charts | A charting library (visx, nivo, Recharts-everywhere, ECharts) | Would mean re-expressing the frozen-math hand-rolled SVG/Canvas charts in a new lib — net negative: more deps, new a11y surface, and it fights the locked `scenario.ts`/`compute.ts` parity invariant. The in-repo `HeatmapPanels` pattern already does this correctly. |
| recharts `ResponsiveContainer` (keep) | Rip out recharts for uniformity with hand-rolled charts | Pure code-motion with regression risk on 19 sites + the `accessibilityLayer` opt-out tests. Out of scope; v1.3 is presentation polish, not a charting rewrite. |
| `@lhci/cli` + `treosh/lighthouse-ci-action@v12` | `playwright-lighthouse` (run Lighthouse inside Playwright fixtures) | Viable and shares CI workers, but couples the perf budget to the e2e job's flakiness and seed env. A standalone LHCI job against `next start` on **public** routes is more stable, has first-class budget/assert config, and mirrors the repo's separate-gated-job convention (`frontend-coverage`). Use `playwright-lighthouse` only if you specifically need authed-route perf (headless can't hydrate authed pages anyway — known repo constraint). |
| Explicit `viewport` export, zoom left enabled | `userScalable:false` / `maximumScale:1` | Those break WCAG 1.4.4 (Resize Text). Never add them. The recommendation is the opposite: a CI grep guard that **fails** if they appear. |

## What NOT to Use (the hard "do NOT add" list)

| Avoid | Why | Use instead |
|-------|-----|-------------|
| Any CSS framework / utility kit (Bootstrap, Bulma, Open Props, vanilla-extract, styled-components, Emotion, CSS Modules) | **Tailwind v4.2.2 is already the system** (`@theme inline` tokens in `globals.css`, zero CSS modules). A second styling system would fork the design tokens and fight DESIGN.md. | Tailwind responsive variants + container queries + the existing `--color-*`/`--radius-*` tokens. |
| `@tailwindcss/container-queries` plugin | v3-era; container queries are **core in v4**. Adding it risks version conflict and is redundant. | The built-in `@container` variant + `--container-*` tokens. |
| Any new charting library (visx, nivo, ECharts, Chart.js, victory, react-vis, plotting libs) | Charts are **frozen-math, presentation-only this milestone**; three families already render correctly. A new lib adds deps, a new a11y surface, and threatens the locked `scenario.ts`/`compute.ts` parity (SCENARIO-05 zero-diff). | recharts `ResponsiveContainer` (keep), lightweight-charts ResizeObserver (keep), and the in-repo `HeatmapPanels` Canvas+SVG pattern for hand-rolled charts. |
| A UI component kit (shadcn/ui, MUI, Radix-as-design-system, Chakra, Mantine, Headless UI as a wholesale adoption) | DESIGN.md is a strict, opinionated industrial/utilitarian system (Instrument Serif / DM Sans / Geist Mono, #1B6B5A accent, FactSet/Bloomberg references, explicit anti-patterns incl. "bubbly uniform border-radius"). A component kit imposes its own visual language and would fight the token contract `tests/a11y/*-tokens.test.ts` pins. | The existing primitives (`Card`, `Button`, `ErrorEnvelope`, `TrustTierLabel`) + Tailwind. Pull a single **headless** unstyled primitive only if a specific a11y widget (e.g. an accessible mobile drawer/dialog) genuinely needs it, styled entirely from DESIGN.md tokens — and treat that as a scoped exception, not a kit adoption. |
| `react-responsive` / `react-device-detect` / `use-media` style JS breakpoint hooks | JS-measured viewport hooks cause **hydration mismatch + layout shift** on breakpoint-dependent SSR (the exact Next 16 pitfall this milestone must avoid). The repo already documents the SSR-two-pass workaround for flag-gated rendering. | CSS-first responsiveness (Tailwind variants + container queries) renders identically server/client. Use ResizeObserver **only** for Canvas/SVG intrinsic sizing (post-mount, no SSR branch), never to choose layout. |
| `maximumScale` / `userScalable:false` in any `viewport` export | WCAG 1.4.4 fail — blocks pinch/browser zoom that low-vision users rely on. | Leave Next's zoom-enabled default; add a grep CI guard against these tokens. |
| `@tailwindcss/typography` (`prose`) | Already deliberately avoided — `globals.css` hand-rolls `.prose-note` / `.legal-article` to dodge the dependency. Don't reverse that for mobile. | Continue the existing hand-rolled prose blocks. |
| Lighthouse 13 / `@lhci/cli` ≥ 0.16 (if it requires Node 22.19+) | Repo `engines.node` is `>=20`; Lighthouse 13 needs Node 22.19+. A version mismatch breaks the CI job. | Pin LHCI **0.15.x** / Lighthouse **12.6.x** / `treosh/lighthouse-ci-action@v12`. |
| Recharts `accessibilityLayer={true}` (the default) | Documented in DESIGN.md (2026-04-30): it adds an empty-name focusable `role="application"` SVG that breaks keyboard tab order; the codebase opts it **out** everywhere, pinned by `tests/visual/chart-accessibility-layer.test.ts`. | Keep `accessibilityLayer={false}` on every recharts chart, including new/edited ones. |

## Stack Patterns by Variant — which responsive lever for which surface

**If the surface is a CSS/flex/grid layout (page chrome, tabs, KPI strips, tables, cards):**
- Use **Tailwind responsive variants** (`sm: md: lg:`) — keyed to the **viewport**.
- Because it's CSS-only → identical SSR/CSR render → no hydration mismatch, no layout shift. This is the default and covers ~80% of the milestone.

**If a component must reflow by *its own* width, not the viewport (e.g. a factsheet panel inside the 1440-capped composer column, a widget that appears at different container widths on different routes):**
- Use **container queries** (`@container` + `cq` units), Tailwind v4 core.
- Because the composer constrains the factsheet to a narrow column at a wide viewport — a media query would read the wide viewport and over-render. Container queries read the actual parent box. This is the v1.3-specific upgrade the repo has not yet used.

**If the chart is `recharts` (19 sites):**
- Wrap/confirm `<ResponsiveContainer>` with a mobile-aware `aspect`/`minHeight`; verify axis-tick density + label rotation at 320–390px; keep `accessibilityLayer={false}`.
- Because recharts already measures its parent — the work is sizing hygiene, not new infrastructure.

**If the chart is `lightweight-charts` (EquityCurve / PortfolioEquityCurve):**
- It's **already** ResizeObserver-width-driven (`chart.applyOptions({ width: clientWidth })`). Verify the fixed `height` prop adapts on portrait (make it a function of width / breakpoint) and that crosshair/touch interactions work on touch.
- Because the width path is solved; only height + touch ergonomics remain.

**If the chart is genuinely hand-rolled SVG/Canvas (Sparkline, DailyHeatmap, ReturnQuantiles, HeatmapPanels):**
- Generalize the **`HeatmapPanels.tsx` pattern**: ResizeObserver on a wrapper → `contentRect.width` → DPR-aware canvas (`canvas.width = round(cssW * dpr)`, `canvas.style.width = cssW+"px"`) and/or an SVG with `viewBox` + `preserveAspectRatio="xMidYMid meet"` + `style={{width:"100%"}}`.
- `Sparkline` is the easy case (already `viewBox`-scaled; just stop hardcoding `width=120` where it lives in a fluid container — pass `width="100%"` via the SVG and keep the `viewBox` coordinate system).
- Because this pattern is proven in-repo and is the textbook responsive-SVG/Canvas approach — no library needed.

**If the surface renders differently across a breakpoint at SSR time (the hydration trap):**
- Render the **mobile/default** layout on the server, reveal desktop affordances via CSS (`hidden md:block`) — never branch layout on a JS-measured width during the first render.
- If a component truly must measure before choosing layout, use the repo's established **two-pass mount** (SSR returns the safe default, `useEffect` upgrades post-hydration) — the documented `strategy.ui_v2` / `widget-state-flag` pattern. Mirror it; don't invent a new one.

## Version Compatibility

| Package | Compatible with | Notes |
|---------|-----------------|-------|
| `tailwindcss@4.2.2` | Next 16.2.3 via `@tailwindcss/postcss@4` (already installed) | Container queries are core; **do not** add `@tailwindcss/container-queries`. |
| `@axe-core/playwright@4.11.2` | `@playwright/test@1.59.1` | Existing pairing; viewport projects don't change the axe integration. |
| `@lhci/cli@0.15.x` (Lighthouse 12.6.x) | Node `>=20` (repo `engines`) | **Avoid Lighthouse 13 / LHCI 0.16+** — needs Node 22.19+. Pin to 0.15 / `treosh/lighthouse-ci-action@v12`. |
| Next 16.2.3 `Viewport` export | React 19.2.4 | Server-Component-only export (per Next 16 docs); `layout.tsx` is already a Server Component. Leave zoom enabled. |

## Integration points (where each change actually lands)

1. `src/app/globals.css` — add `@container` / `container-type` where component-local reflow is needed; new responsive token rules stay token-driven (`var(--color-*)`).
2. `src/app/layout.tsx` — add explicit `export const viewport: Viewport` (zoom-enabled); a `<head>` change is **not** needed (Next injects the meta).
3. `playwright.config.ts` — add `mobile-portrait` / `tablet` / `reflow-320` projects alongside `chromium`.
4. `e2e/helpers/axe.ts` + new `*-axe.spec.ts` — reuse `buildAxe()`; widen route coverage; honor FLOW-01 (skip-guard **and** `ci.yml` list) and the serious+critical filter on factsheet-embedding surfaces.
5. `.github/workflows/ci.yml` — new `mobile-perf` job (`treosh/lighthouse-ci-action@v12`) + a grep guard against `userScalable:false`/`maximumScale`. Ratchet it like `frontend-coverage` (warn → block).
6. `lighthouserc.json` + `budget.json` — new root config files (mobile preset, resource-size budget).
7. Chart components — recharts: `ResponsiveContainer` sizing + keep `accessibilityLayer={false}`; lightweight-charts: adaptive height + touch; hand-rolled: generalize the `HeatmapPanels` ResizeObserver+`viewBox` pattern.

## Sources

- Repo inspection (HIGH) — `package.json`, `src/app/globals.css`, `playwright.config.ts`, `e2e/helpers/axe.ts`, `e2e/composer-axe.spec.ts`, `src/app/layout.tsx`, `src/components/charts/{Sparkline,EquityCurve}.tsx`, `src/app/factsheet/[id]/v2/HeatmapPanels.tsx`, `src/components/layout/MobileNav.tsx`, `next.config.ts`, `.github/workflows/ci.yml`, DESIGN.md, `.planning/PROJECT.md`. Installed versions read from `node_modules/*/package.json`.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` (HIGH) — Next 16 viewport defaults; `width`/`initialScale`/`maximumScale`/`userScalable` fields; Server-Component-only.
- `node_modules/tailwindcss/theme.css` (HIGH) — `--container-*` tokens confirm container queries are core in v4.2.2 (no plugin).
- https://github.com/treosh/lighthouse-ci-action (MEDIUM) — `@v12` = 12.6.2, bundles Lighthouse 12.6; `budget.json` / `lighthouserc.json` config shape.
- https://unlighthouse.dev/learn-lighthouse/lighthouse-ci , https://googlechrome.github.io/lighthouse-ci/ (MEDIUM) — LHCI 0.15.x = Lighthouse 12.6.1; Lighthouse 13 requires Node 22.19+.
- Project memory (HIGH, repo-specific) — FLOW-01 (seed-gated spec must be in skip-guard + `ci.yml`), composer-axe serious+critical filter, recharts `accessibilityLayer` opt-out, SSR two-pass mount pattern, "headless can't hydrate authed pages."

---
*Stack research for: app-wide responsive / mobile / WCAG-AA readiness (Quantalyze v1.3)*
*Researched: 2026-06-27*
