# Phase 48: Recharts + EquityChart + Final Verification - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all 4 areas accepted as recommended

<domain>
## Phase Boundary

Close out the most-touched, touch-weakest, highest-regression-risk chart family — the **19 Recharts
charts** (all hover-`<Tooltip>` only today, all `accessibilityLayer={false}`) plus the **2277-LOC
hand-rolled-SVG live-book `EquityChart`** — by bringing them to touch parity WITHOUT a rewrite, then
make "v1.3 done" falsifiable with the combined app-wide gate matrix, a mobile performance budget, and a
real-device authed sign-off. Requirements: **CHART-01b, A11Y-01, A11Y-03**.

Three concrete jobs:
1. **CHART-01b touch parity** — every Recharts chart becomes tap-inspectable on a phone (explicit
   tap-to-show/tap-to-pin tooltip replacing hover-first), with the existing DESIGN.md KPI-cell value
   already serving as the fallback; `EquityChart`'s `onPointer`/`hoverIdx` handlers tuned for touch +
   small width WITHOUT rewriting the chart (its measured-width path holds).
2. **A11Y-01 app-wide axe** — extend the WCAG-AA axe gate from the current 5 routes to all primary
   routes, run at BOTH Desktop and a mobile viewport, FLOW-01 dual-wired; plus confirm the complete
   bespoke gate matrix (320px reflow, 44px target-size, zoom-meta grep, mobile keyboard/focus) runs
   app-wide as BLOCKING CI checks beside axe.
3. **A11Y-03 mobile perf budget** — `@lhci/cli` + a Lighthouse-mobile CI job gating public routes,
   thresholds seeded from a baseline and ratcheted; no ResizeObserver-loop error, stable memory on
   rotate. Then a human real-device authed sign-off, coverage ratchet verified held, all frozen-math /
   byte-identity / parity guards green un-weakened.

**Out of scope:** Rewriting `EquityChart` to the viewBox pattern (banned anti-feature — tune touch
handlers only). Downsampling chart points. Touching `scenario.ts` / `compute.ts` math (FROZEN engine).
New charting library or UI kit. Dark mode. The hand-rolled SVG charts (done in Phase 47). Authed-route
perf gating (headless can't auth; lhci gates PUBLIC routes only).

**Grounding facts (Explore + version check, 2026-06-28):**
- **19 Recharts components** (full inventory in plan-phase): allocator widgets
  (AlphaBetaDecomposition, OutcomesWidget [sparkline, no tooltip], TailRisk, performance/DrawdownChart,
  RiskDecomposition), `src/components/charts/*` (YearlyReturns, RollingSortinoChart, RollingMetrics,
  CorrelationWithBenchmark, DrawdownChart, TurnoverChart, RollingVolatilityChart, NetGrossExposureChart,
  ReturnHistogram, RollingAlphaBetaChart), CompareEquityOverlay, portfolio/{RiskAttribution,
  CompositionDonut, AttributionBar}. All hover-`<Tooltip>`, all `accessibilityLayer={false}`.
- **Recharts 3.8.1** — `<Tooltip>` supports the `trigger` prop (`"hover" | "click"`). `trigger="click"`
  = native tap-to-show/pin. **Plan-phase research MUST verify exact 3.8.1 tooltip wiring** (Recharts 3.x
  was a churny major; AGENTS.md "read the docs first").
- `EquityChart.tsx` at `src/app/(dashboard)/allocations/widgets/performance/` — hand-rolled SVG, 2277
  LOC. `hoverIdx` state (L502); `handleMove` O(log n) `nearestIndex` binary-search (L1142–1159);
  `onMouseMove`/`onMouseLeave` on the SVG (~L1428); ResizeObserver measured-width (L517–528, floor
  400px); projection `useMemo` keyed on data NOT hoverIdx (L652–670) — do not disturb.
- `useTapPin` hook (`src/hooks/useTapPin.ts`, Phase 47): `pointerToIndex(clientX, clientY, rect) =>
  number | null` callback API + `selectedIdx`/`pinned`/`setChartEl`/onPointer{Down,Move,Up,Leave}` —
  fits EquityChart's `nearestIndex` directly. Used today by factsheet HeatmapPanels/AnalyticalPanels.
- DESIGN.md 2026-04-30 decision: chart data already surfaced via KPI cells (the SC#1 "KPI-cell value
  fallback" already exists — rely on it, don't build new fallback UI). Pinned by
  `tests/visual/chart-accessibility-layer.test.ts` (whole-codebase grep).
- `@lhci/cli` **NOT present** anywhere — net-new (the one allowed new dep per REQUIREMENTS Out-of-Scope).

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Recharts Touch Interaction (CHART-01b)
- **Touch mechanism = native Recharts `<Tooltip trigger="click">` gated by `useBreakpoint`** (mobile →
  `click` = tap-to-show/pin; desktop → `hover`). No new gesture machinery; Recharts owns its own pointer
  layer so `useTapPin` is the wrong fit here (that's for the hand-rolled SVG charts + EquityChart).
- **Desktop byte-identical** — `trigger="hover"` on desktop keeps every Recharts chart's desktop render
  and behavior unchanged (parity).
- **DRY = one thin shared `TouchTooltip` wrapper** (executor may instead use a `useTooltipTrigger()`
  hook) that injects the breakpoint-gated `trigger` and spreads through each chart's existing
  `content`/`formatter`/props. Avoid 19× inline duplication.
- **Parity-only for tooltip-less charts** — charts with NO desktop hover today (e.g. OutcomesWidget
  sparkline) get NO invented tap-reveal (mirrors the Phase-47 "don't invent a new interaction surface"
  rule); their value is already in the adjacent KPI cell.
- **Keep `accessibilityLayer={false}`** — do not flip it (the 2026-04-30 codebase-wide opt-out is
  grep-pinned; flipping re-introduces empty keyboard tab-stops).

### Area 2 — EquityChart Touch Tuning (NO rewrite)
- **Integrate `useTapPin`** — wire its `pointerToIndex` to the existing `nearestIndex(visibleEpochs,
  targetEpoch)` binary-search so a tap pins the value the desktop hover shows. **Keep the desktop
  `onMouseMove`/`handleMove`/`hoverIdx` mouse path byte-identical** (additive pointer/touch path).
- **Do NOT touch the measured-width / ResizeObserver path** — SC#1 requires "its measured-width path
  holds at small widths"; only verify it holds, no width-logic refactor. Do not disturb the projection
  `useMemo` keying (must stay keyed on data, not hoverIdx).
- **Pin dismissal matches `TimeSeriesChart`** — re-tap toggles the pin off, a tap moves the pin, the pin
  survives `pointerleave`, no auto-dismiss timer.
- **Small-width legibility = minimal** — bump axis font / reduce tick density ONLY if the ~12px-at-320px
  legible floor is breached; never downsample data points.

### Area 3 — App-wide axe + bespoke gate matrix (A11Y-01)
- **Axe route coverage = all primary routes** — public: `/`, `/security`, `/for-quants`, `/browse`,
  `/demo`; authed: `/allocations`, strategy-v2, discovery, composer, wizard, factsheet. Exact route list
  enumerated at plan-phase against the live route tree (drop genuinely non-primary/utility routes with
  rationale).
- **Both viewports** — every axe check runs at Desktop AND a mobile viewport (375px), per SC#2.
- **Embedded-factsheet landmark exception = scoped `serious+critical` filter** (the same approach as
  composer-axe GUARD-03), NEVER a rule disable. Embedded factsheet legitimately nests landmarks.
- **Spec shape = one new parametrized `axe-app-wide.spec.ts`** driving a route × viewport matrix; leave
  the existing focused per-route axe specs in place. **FLOW-01 dual-wire** (add to BOTH the spec's
  `HAS_SEED_ENV` guard AND `.github/workflows/ci.yml` — seeded MA-8 list for authed routes, unseeded
  list for public). Prove it actually RUNS in CI (JOURNEY-03 / Phase-44 lesson).
- **Bespoke gate matrix app-wide** — confirm the 320px reflow, 44px target-size, zoom-meta grep, and
  mobile keyboard/focus gates run app-wide as BLOCKING CI checks beside axe, each confirmed CI-wired and
  actually executed (not merely present).

### Area 4 — Mobile perf budget (A11Y-03) + final sign-off
- **lhci = `@lhci/cli` + `lighthouserc.json`**, mobile form-factor, asserting on PUBLIC routes only
  (headless can't auth); a new `lighthouse-mobile` CI job (build → start → `lhci autorun` → assert).
- **Thresholds seeded from a baseline run**, floors set a few points UNDER measured actual (same
  ratchet philosophy as the vitest coverage gate), as `error`-level assertions; ratchet tighter over
  time. No hard 90+ on day one (flaky-red).
- **Rotate/resize stability** — assert no ResizeObserver-loop console error and stable memory on rotate
  (SC#4), folded into an existing mobile e2e rather than a new harness.
- **Real-device authed sign-off (SC#5) = a HUMAN-UAT real-device checklist** (`48-HUMAN-UAT.md`, like
  Phase 47's) covering the authed surfaces a headless browser can't hydrate; verification will end
  **`human_needed`**. Verify the coverage ratchet is held (never lowered) and all frozen-math /
  byte-identity / parity guards (SCENARIO-05 `phase-31-frozen-spine-guards`, BODY-02,
  chart-accessibility-layer grep, svg-chart-parity goldens) stay GREEN and un-weakened.

### Claude's Discretion
- Exact 19-chart enumeration + per-chart `TouchTooltip` wiring (plan-phase research).
- Exact Recharts 3.8.1 tooltip `trigger`/`defaultIndex` wiring (plan-phase research via context7 — the
  must-verify item).
- Exact primary-route list for the axe matrix and the precise mobile viewport (375 vs 360).
- Initial lhci threshold numbers (seeded from the baseline run).
- Whether `TouchTooltip` is a wrapper component or a `useTooltipTrigger()` hook.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/hooks/useTapPin.ts` — Phase-47 tap-vs-drag + pin-toggle gesture core; `pointerToIndex` callback
  API fits `EquityChart`'s `nearestIndex` binary-search. Tested (`useTapPin` unit tests, branch cov).
- `src/hooks/useBreakpoint.ts` — SSR-safe two-pass `"mobile" | "tablet" | "desktop"` (mobile =
  `max-width:639px`); drives the Recharts `trigger` selection.
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` — the 2277-LOC target;
  `hoverIdx` L502, `handleMove`/`nearestIndex` L1142–1159, SVG handlers ~L1428, ResizeObserver L517–528,
  projection `useMemo` L652–670.
- 19 Recharts charts (inventory above) — all use `<Tooltip>` + `accessibilityLayer={false}`.
- Existing CI gate specs: `e2e/strategy-v2-axe.spec.ts`, `e2e/wizard-axe.spec.ts`,
  `e2e/discovery-axe.spec.ts`, `e2e/admin-csv-status-axe.spec.ts`, `e2e/composer-axe.spec.ts` (axe, 5
  routes today); `e2e/reflow-sweep.spec.ts` + `e2e/reflow-sweep-authed.spec.ts` + `e2e/reflow.spec.ts`
  (320px reflow); `e2e/target-size.spec.ts` (44px); `e2e/mobile-drawer-keyboard.spec.ts` +
  `e2e/strategy-v2-keyboard.spec.ts` (keyboard/focus); `e2e/svg-chart-parity.spec.ts` (Phase-47 parity).

### Established Patterns
- **FLOW-01 dual-wiring** — every new/extended seeded e2e gate must be in BOTH the spec's
  `HAS_SEED_ENV` const AND `.github/workflows/ci.yml` (seeded MA-8 list / unseeded list) or it silently
  never runs. Burned ≥3× across prior milestones. The ci.yml note: "Adding/removing a seed-gated spec?
  Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant."
- **Seed gate** = `vars.E2E_TEST_DB_CONFIGURED == 'true'`; per-spec guard
  `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;`
- **Coverage ratchet** (vitest.config.ts): lines 82 / stmts 80 / fns 74 / branches 72 — new viewport
  conditionals (the `trigger` ternary, EquityChart touch path) need branch coverage; never lower a
  threshold or blanket-update a snapshot to pass.
- **Frozen-math / parity guards** (must stay green un-weakened): `phase-31-frozen-spine-guards.test.ts`
  (SCENARIO-05 zero-diff), BODY-02 factsheet byte-identity, `chart-accessibility-layer.test.ts`
  (codebase-wide `accessibilityLayer={false}` grep), `svg-chart-parity.spec.ts` goldens.
- **axe scoped-filter precedent** — composer-axe (GUARD-03) filters its composed scan to
  `serious+critical` for the legit embedded-factsheet landmark nesting, NOT a rule disable.

### Integration Points
- Recharts charts under `src/components/charts/`, `src/components/portfolio/`,
  `src/components/strategy/`, `src/app/(dashboard)/allocations/widgets/**`.
- New shared `TouchTooltip` (or `useTooltipTrigger`) under `src/components/charts/` or `src/hooks/`.
- `EquityChart.tsx` (touch-handler tuning only).
- New `e2e/axe-app-wide.spec.ts` + `lighthouserc.json` + `package.json` (`@lhci/cli` devDep) +
  `.github/workflows/ci.yml` (extend axe wiring + new `lighthouse-mobile` job).
- New `.planning/phases/48-.../48-HUMAN-UAT.md` (real-device authed checklist).

</code_context>

<specifics>
## Specific Ideas

- The Recharts touch path is the LAZY-correct rung: a feature the installed dependency already provides
  (`trigger="click"`) — do NOT build a parallel gesture layer for Recharts. Reserve `useTapPin` for the
  hand-rolled `EquityChart` only.
- Desktop parity is the falsifiable proof of "no rewrite/no recompute": Recharts desktop render stays
  `trigger="hover"` byte-identical; EquityChart's mouse path stays byte-identical; the existing parity +
  frozen-spine guards stay green. A red guard is information, never an obstacle to weaken.
- Mirror the Phase-44/JOURNEY-03 lesson: a gate earns trust only once it actually RUNS in CI — prove the
  new axe-app-wide + lighthouse-mobile jobs execute in a real CI run (FLOW-01 dual-wired), not just that
  they exist. The svg-chart-parity goldens still self-skip until baked in seeded CI (carryover ⛔).
- lhci gates PUBLIC routes only — the authed surfaces are covered by the human real-device sign-off
  (headless can't hydrate authed pages; documented limitation).

</specifics>

<deferred>
## Deferred Ideas

- Native-app touch gestures (swipe between tabs, pull-to-refresh) — v2 (MOBL-01).
- Offline / PWA support — v2 (MOBL-02).
- Authed-route Lighthouse perf gating — needs headless auth; covered by human sign-off this milestone.
- Ratcheting lhci thresholds tighter — future maintenance (seed lenient now, tighten over time).
- Baking the svg-chart-parity goldens into seeded CI — standing carryover from Phase 47 (the spec
  self-skips until goldens are committed in a seeded run).

</deferred>
