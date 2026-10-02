# Project Research Summary

**Project:** Quantalyze
**Domain:** Mobile/responsive + WCAG-AA retrofit of a desktop-first dense financial dashboard (Next.js 16 App Router)
**Researched:** 2026-06-27
**Confidence:** HIGH

## Executive Summary

v1.3 "Mobile & Adaptive UI" is a **retrofit / gap-closing milestone, not a greenfield mobile build.** The codebase already contains the three hardest primitives: a complete mobile navigation shell (`MobileTopBar` + `MobileSidebarDrawer` + `MobileNav`, wired in `DashboardChrome.tsx`), a gold-standard responsive + touch SVG chart (`TimeSeriesChart.tsx` + `MasterBrush.tsx` — viewBox + `preserveAspectRatio` + `onPointer` touch-pin already working), and an SSR-safe breakpoint hook (`useMediaQuery.ts` via `useSyncExternalStore` with a `false` server snapshot). The dependency footprint for the entire milestone is effectively **zero** — one devDependency (`@lhci/cli`) + one pinned GitHub Action cover the only genuinely new capability (a mobile perf budget). Everything else is installed and merely needs wiring.

The dominant risks are **regressions, not missing features.** The milestone sits one layer above a frozen math engine (`scenario.ts`/`compute.ts`, SCENARIO-05 zero-diff + the factsheet byte-identity guard BODY-02). Chart rework that reaches one layer too deep is the highest-cost failure mode. The second risk is **axe false-confidence**: axe finds ~57% of WCAG issues and structurally cannot test Reflow (1.4.10), Resize Text (1.4.4), Target Size (2.5.8), or focus-trap correctness — the four things v1.3 is most about. Bespoke gates must sit *beside* app-wide axe, never instead of it.

The recommended approach is a **CSS-first escalation ladder** (Tailwind utilities + container queries for ~80% of the work; the shared two-pass `useBreakpoint` hook only when the mobile/desktop React trees differ; ResizeObserver only for Canvas) with the **verification gates built FIRST** so every later surface is continuously checked at 320px / 400% zoom as it lands.

## Key Findings

### Recommended Stack

The stack for v1.3 *is the existing stack.* All responsive primitives are already installed and verified in `node_modules` / source. The entire dependency delta is the mobile-perf-budget tool. Detail in `STACK.md`.

**Core technologies (all already present except where noted):**
- **Tailwind v4.2.2** — responsive layout; ships CSS container queries as a *core* feature (`@container` + `--container-*` tokens, no plugin). The default tool for component-local reflow.
- **`@axe-core/playwright` 4.11.2 + Playwright 1.59.1** — a11y + viewport/zoom e2e; already gating 5 routes, extend app-wide + add mobile-viewport projects.
- **`useMediaQuery.ts` (existing, `useSyncExternalStore`)** — SSR-safe breakpoint source; wrap as `useBreakpoint`.
- **`@lhci/cli@^0.15.0` (devDep, NET-NEW)** + `treosh/lighthouse-ci-action@v12` — mobile perf budget. Pin to 0.15.x / Lighthouse 12.6.x (LH 13 needs Node 22.19+; repo engines `>=20`).

**Hard do-NOT-add:** any charting library; any UI component kit; `react-responsive`/`use-media` (hydration mismatch); `@tailwindcss/container-queries` plugin (v3-only, redundant in v4); `maximumScale`/`userScalable:false` in any viewport export (WCAG 1.4.4 fail, invisible to axe).

### Expected Features

Framed as gaps-to-close against existing infra. Detail in `FEATURES.md`. The honesty invariant reshapes the standard "mobile playbook" into anti-features — this is the catalog's central framing.

**Must have (table stakes):**
- Role-aware mobile bottom nav — `MobileNav.TABS` is a role-blind 3-item stub omitting the allocator's primary workspace (data-wiring only; drawer already receives props).
- Scrollable `AllocationsTabs` strip at `<sm` (preserve the JOURNEY-03 `role=tab` fix).
- `ResponsiveTable` + honest reshape of every data table — `HoldingsTable` overflows at 320px; **reshape (scroll/stack/labeled-summary), never drop material columns** (no-invented-data).
- All surfaces reflow at 320px / 400% zoom; zoom never blocked.
- Charts touch-inspectable on a phone — propagate the `TimeSeriesChart` tap-pins-crosshair recipe to the 16 hand-rolled SVG + ~19–23 Recharts charts.
- Chart text legible at 320px — viewBox downscaling renders axis text ~4–5px (passes axe AND the reflow gate, fails 1.4.4); reduce tick density / bump font / HTML-overlay labels.
- 44px touch targets app-wide (axe does NOT test this — bespoke Playwright gate required).
- Mobile drawer focus management (prefer `inert`; generalize the factsheet skip-link to the app shell).
- Wizard de-blocked — `DesktopGate.tsx` hard-blocks <640px; drop the blocking branch, keep the `isNarrow===null` two-pass hydration-safe pattern.
- App-wide axe extension + 9-state completeness (honest degenerate states survive reflow).

**Should have (differentiators):**
- Container-query component-local reflow (the factsheet panel inside the 1440-capped composer, where media queries read the wide viewport and over-render).
- Portrait-tuned chart layouts (lower tick density, taller aspect).
- Mobile performance budget as a CI gate (`@lhci/cli` on public routes).
- Sparkline fluid-width (cheapest win: `width=120` → `width="100%"`, already viewBox-scaled).

**Defer (v2+):** native-app gestures; dark mode (DESIGN.md explicitly "not planned"); offline/PWA.

**Anti-features (encode as DO-NOT in requirements):**
- `hidden md:table-cell` on material columns — no-invented-data violation (mobile user sees a smaller truth).
- `maximum-scale=1` / `user-scalable=no` — WCAG 1.4.4 fail, axe-invisible.
- Downsampling chart points "for mobile perf" — changes displayed data, regresses SCENARIO-05 / BODY-02.
- `useMediaQuery`/`innerWidth` branch in render — hydration mismatch + layout-shift flash.
- "Fixing" the `max-w-[1440px]` composer cap — it's a `max-width` cap with `mx-auto`, already fluid, PINNED by `composer-width.test.tsx` (PARITY-02); removing it breaks parity for zero reflow benefit.
- Rewriting `EquityChart` to viewBox — 2200 LOC, live-book Overview chart, already ResizeObserver-responsive; a rewrite is a huge regression surface for a chart that already scales.

### Architecture Approach

A four-layer escalation ladder, each layer used only when the previous cannot express the intent. The frozen math/render seam is the load-bearing boundary. Detail in `ARCHITECTURE.md`.

**Major components:**
1. **LAYER 0 — Frozen math** (`scenario.ts`/`compute.ts`) — never touched in v1.3. Charts consume `number[]`/`ComputedMetrics` as props; v1.3 edits only SVG attrs, CSS classes, event handlers.
2. **LAYER 1 — CSS-first** (Tailwind variants + container queries) — default for ~80% of work, no hydration risk.
3. **LAYER 2 — `useBreakpoint` hook** (thin wrapper over existing `useMediaQuery`, SSR snapshot `'desktop'`) — only when mobile/desktop trees are structurally different React.
4. **LAYER 3 — `ResizeObserver`** — only for Canvas charts needing a pixel dimension.

**New primitives to build once (highest-leverage decision):** `useBreakpoint.ts`; `ResponsiveTable.tsx` (`overflow-x-auto` + sr-only scroll hint + optional card transform); `ResponsiveChartFrame.tsx` (extract the viewBox+aspectRatio+`w-full` wrapper from `TimeSeriesChart.tsx`). NOTE: `react-grid-layout` is confirmed **absent** (stale comments in `globals.css`); do not reintroduce.

### Critical Pitfalls

Top 5 by expected damage (full Pitfall→Phase map in `PITFALLS.md`):

1. **Regressing frozen math during chart rework** — downsampling points "for perf" changes displayed data, trips SCENARIO-05 / BODY-02. Seam test: if a change affects a number the payload builders emit, it crossed the boundary. Never weaken guards.
2. **axe false-confidence** — "app-wide axe green" ≠ responsive/accessible; axe cannot test Reflow/Resize/Target-Size/focus-traps. The likeliest "looks done but isn't." Pair axe with bespoke gates.
3. **Tables drop material columns** — `hidden md:table-cell` on a financial dashboard is a no-invented-data violation. Reshape, never drop; guard with an all-columns-present test.
4. **SSR/hydration mismatch from a viewport branch** — reading `window.innerWidth` in render. CSS-first default; JS branching only through the one shared two-pass `useBreakpoint` (`DesktopGate.tsx isNarrow===null` is the canonical in-repo reference).
5. **Coverage-ratchet + guard regression from large churn** — branch coverage drops fast when viewport conditionals lack tests (ratchet lines 82 / stmts 80 / fns 74 / branches 72, blocking CI). Never lower a ratchet or blanket-update snapshots. New e2e gates must be wired into BOTH `HAS_SEED_ENV` AND `ci.yml` (the FLOW-01 lesson — burned the project twice).

## Implications for Roadmap

All four research files converge on the same dependency-ordered sequence: **5 phases (44–48)**, continuing numbering from 43.

### Phase 44: Foundation Primitives + Verification Gates
**Rationale:** Build the reflow gate FIRST so phases 45–48 are continuously verified at 320px/400% as they land (mirrors how the v1.2 JOURNEY-03 gate caught 3 real bugs only once it actually ran in CI). The three primitives turn each later surface edit into "wrap + apply classes" instead of re-deriving the recipe 40×.
**Delivers:** `useBreakpoint.ts`; `ResponsiveTable.tsx`; `ResponsiveChartFrame.tsx` (extracted from `TimeSeriesChart`); explicit zoom-enabled `viewport` export in `layout.tsx`; CI zoom-meta grep guard (fails on `maximumScale`/`userScalable:false`); Playwright mobile-portrait/tablet/reflow-320 projects; 320px `scrollWidth <= clientWidth` reflow spec; 44px target-size measurement; app-wide axe route list.
**Avoids:** axe false-confidence; SSR/hydration mismatch (canonicalizes the one hook).

### Phase 45: Navigation Shell Completion
**Rationale:** The shell frames every authed surface; fixing it first means Phase 46 work is tested inside real mobile chrome. Role-aware nav is the cheapest table-stakes win.
**Delivers:** Role-aware `MobileNav.TABS` (allocator gets `/allocations`, Bridge, Risk); scrollable `AllocationsTabs` at `<sm` (JOURNEY-03 preserved); `MobileSidebarDrawer` focus-trap hardened (prefer `inert`); app-wide skip-link; mobile-drawer keyboard e2e.

### Phase 46: Surface-by-Surface Reflow (CSS-first, no charts)
**Rationale:** CSS layout work has zero risk of crossing the frozen math boundary; every route goes straight through the Phase 44 gate.
**Delivers:** All authed + public routes pass the 320px reflow gate; `ResponsiveTable` applied to `HoldingsTable`/`ScenarioCompareTable`/`CorrelationMatrix`/admin tables (every material column retained); wizard de-blocked; 9-state loading/empty/error verified app-wide; `Sparkline` fluid-width.
**Avoids:** tables dropping material columns (honesty); zoom-block anti-feature.

### Phase 47: Hand-Rolled SVG Charts (16 files)
**Rationale:** SVG charts have simpler internal structure than Recharts/EquityChart; adding pointer events to an already-viewBox-responsive chart is the cleaner learning pass before the most complex family. Portrait tuning lands here.
**Delivers:** `onPointer*` + `pointer-coarse:` 44px targets on all 16 SVG charts via `ResponsiveChartFrame`; tap-pins-crosshair propagated; small-viewport legibility fix (tick density / font / HTML-overlay labels); portrait-tuned 7-panel factsheet + correlation heatmaps; portrait snapshot in the chart-parity suite; SCENARIO-05 + BODY-02 green throughout.
**Avoids:** frozen-math regression (guards as trip-wires); 1.4.4 legibility trap.

### Phase 48: Recharts + EquityChart + Final Verification
**Rationale:** Most-touched (23 files + 2200-LOC `EquityChart`), touch-weakest, highest regression risk — comes last so the touch pattern is proven and the Recharts per-family decision is informed by SVG experience. Final verification makes "v1.3 done" falsifiable.
**Delivers:** Recharts tap-to-show tooltip + KPI-cell fallback; `EquityChart` pointer handlers tuned for touch (NOT rewritten); final app-wide axe at Desktop + mobile viewport; all bespoke gates (reflow/target-size/zoom-meta/keyboard) as blocking CI checks; `@lhci/cli` mobile-perf job; real-device authed walkthrough sign-off; coverage ratchet verified (never lowered); all new gates confirmed CI-wired (FLOW-01).

### Phase Ordering Rationale
- Primitives + gates before surfaces — regressions surface immediately, not at the end.
- Nav before surfaces — the shell frames every authed surface.
- CSS surfaces before charts — charts are the only category where the frozen boundary is nearby and gestures are non-trivial.
- SVG charts before Recharts — simpler structure, proven pattern before the most-complex family.
- `EquityChart` last — 2200 LOC, live-book Overview, already ResizeObserver-responsive; touching it last limits regression surface.

### Research Flags
**Standard patterns (skip research-phase):**
- Phase 44 — all tools installed; Playwright multi-project config established; two-pass hook in-repo.
- Phase 45 — role prop flow wired; focus-trap contract in `MobileSidebarDrawer.tsx`; skip-link in `FactsheetView.tsx`.
- Phase 46 — Tailwind responsive variants established; wizard two-pass pattern in `DesktopGate.tsx`.

**Implementation-time caution (careful execution, not pre-research):**
- Phase 47 — primary risk is accidentally crossing into `compute.ts`; keep SCENARIO-05 / BODY-02 as trip-wires.
- Phase 48 — Recharts touch behavior is MEDIUM confidence (verify per chart type during implementation); `EquityChart` risk is size/coupling, not knowledge gaps.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every tool verified by reading `package.json`, `node_modules/*/package.json`, and source |
| Features | HIGH | Every gap maps to a specific file/line read in the live repo |
| Architecture | HIGH | Layer stack grounded in real reads; `react-grid-layout` confirmed absent; `max-w-[1440px]` confirmed a cap not a floor |
| Pitfalls | HIGH | Each maps to a real guard, a real past incident (G11.C.2 focus leak), or a documented constraint |

**Overall confidence:** HIGH

### Gaps to Address
- **Recharts touch behavior per chart type** — verify during Phase 48 per-chart, not as pre-work.
- **Container-query adoption scope** — decide in Phase 48 after Phase 46 surfaces remaining reflow issues (adopt `@container` where media queries demonstrably fail, not pre-emptively).
- **Real-device authed walkthrough** — must be a human on a real phone (headless can't hydrate authed pages); schedule as the Phase 48 sign-off gate.
- **Mobile perf budget thresholds** (`budget.json`) — start with Lighthouse mobile preset defaults, ratchet tighter after a throttled-CPU walkthrough reveals actual numbers.

## Sources

### Primary (HIGH confidence)
- Live repo reads — `package.json`, `node_modules/tailwindcss/theme.css`, `node_modules/next/dist/docs/.../generate-viewport.md`, and the actual component/chart/test source files.
- WCAG 1.4.10 Reflow, 1.4.4 Resize Text, 2.5.8 Target Size (Deque University).

### Secondary (MEDIUM confidence)
- Deque axe-core coverage (~57% of WCAG auto-detectable); Lighthouse CI (treosh action, googlechrome/lighthouse-ci).

---
*Research completed: 2026-06-27*
*Ready for roadmap: yes*
