# Phase 47: Hand-Rolled SVG Charts (touch + legibility + portrait) - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all 4 areas accepted as recommended

<domain>
## Phase Boundary

Bring the genuinely hand-rolled `<svg>` charts to touch + legibility + portrait parity with the
reference `TimeSeriesChart` — the cleaner learning pass before the most-complex Recharts/EquityChart
family (Phase 48) — while the frozen math stays byte-identical (the highest-cost regression in the
milestone). Three concrete jobs: (1) propagate the `TimeSeriesChart` tap-pins-crosshair recipe to the
SVG charts via `ResponsiveChartFrame` so a tap reveals/pins the value hover gives on desktop, with
`pointer-coarse:` ≥44px hit targets; (2) fix the viewBox-downscale legibility trap at 320px (axis text
shrinking to ~4–5px); (3) portrait-tune the densest panels. Requirements: CHART-01a, CHART-02, CHART-03.

**Scope reconciliation (roadmap example-list inaccuracy — surfaced at discuss, Rule 7):**
The roadmap SC#1 example list names `DrawdownChart` as a hand-rolled SVG chart, but BOTH
`DrawdownChart` files (`src/components/charts/DrawdownChart.tsx` and
`src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx`) import Recharts → they are
**Phase 48 / CHART-01b**, not Phase 47. The 2277-LOC allocations `EquityChart` is also **explicitly
Phase 48** (and `EquityCurve` uses the `lightweight-charts` canvas lib; `MonthlyHeatmap` /
`WorstDrawdowns` are HTML/div, not SVG). **Binding Phase-47 scope = the genuinely hand-rolled `<svg>`
chart components only.** These cluster in:
- `src/app/factsheet/[id]/v2/` panel files — `AnalyticalPanels`, `CrossSignaturePanels`,
  `DistributionPanels`, `HeatmapPanels`, `SignaturePanels`, `HistogramChart`, `MasterBrush` (each draws
  raw `<svg>`, RCF=0 today). `TimeSeriesChart` is the REFERENCE (already on `ResponsiveChartFrame`,
  RCF=4) — do NOT refactor it.
- `src/components/charts/` — `DailyHeatmap` (svg+canvas hybrid), `ReturnQuantiles` (box plot),
  `Sparkline`.
- `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx` (band chart, 132 LOC).

The exact "16" enumeration is a plan-phase research detail (panels group multiple chart panels per file);
the plan-phase researcher should enumerate the full set against the live tree.

**Out of scope:** Recharts charts + `EquityChart` touch parity (Phase 48 / CHART-01b); app-wide axe at
mobile viewport + mobile perf budget (Phase 48 / A11Y-01/03); panel-grid stacking (banked in Phase-46
CSS). Never touch `scenario.ts` / `compute.ts` math; never downsample chart data points.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Touch Interaction (CHART-01a)
- **Parity-only tap-reveal**: add tap-to-reveal/pin ONLY where a desktop hover exists today
  (SC#1 = "a tap reveals the value that hover gives on desktop"). Charts with no desktop hover
  (e.g. `Sparkline`, `ReturnQuantiles`) get legibility (CHART-02) + portrait (CHART-03) only —
  do NOT invent a new interaction surface for them.
- **Per-chart-type tap target**: heatmap = cell, box-plot = period column, histogram = bar — each
  showing the SAME value the desktop tooltip shows (not a literal crosshair line on non-line charts).
- **Thin shared tap-pin gesture hook** extracted from `TimeSeriesChart`'s tap-vs-drag / pin-toggle
  detection so the SVG charts don't each reimplement it (DRY). **Do NOT refactor `TimeSeriesChart`
  itself** — its chart-parity test must stay green.
- **Dismissal matches `TimeSeriesChart`**: re-tap toggles the pin off, tap moves the pin, the pin
  survives `pointerleave`, no auto-dismiss timer.

### Area 2 — Legibility at 320px (CHART-02)
- **Default technique = reduced tick density + larger viewBox font** (CSS-first, no overlay machinery).
  Use HTML-overlay real-px labels ONLY where the viewBox downscale still wins.
- **Legible floor**: effective rendered axis text ≥ ~12px (body-small) at 320px; verified by a portrait
  snapshot in the chart-parity suite.
- **Tick-reduction trigger = breakpoint-driven via `useBreakpoint`** (mobile → fewer ticks), consistent
  with the Phase-44 primitive; avoid per-chart `ResizeObserver` unless a chart already measures.
- **Data untouched**: ticks/labels only — never downsample data points (banned anti-feature; frozen-math
  guard).

### Area 3 — Portrait Tuning of Dense Panels (CHART-03)
- **Trigger = width breakpoint (`useBreakpoint` mobile)**, NOT an `orientation` media query — a narrow
  desktop window also gets the tuned layout (matches the milestone's width-based approach).
- **Taller aspect on mobile = pass a taller viewBox to `ResponsiveChartFrame` at the mobile breakpoint;
  the desktop viewBox stays byte-identical** (parity).
- **Correlation heatmap at 320px = keep ALL cells (no row/col drop)**; reduce/rotate label density and
  use the existing scroll region.
- **7-panel factsheet stacking = already banked in Phase-46 CSS** — Phase 47 only tunes each chart's
  internal density/aspect, no layout redo.

### Area 4 — Verification & Frozen-Math Guards
- **Chart-parity = author a FRESH focused Phase-47 SVG parity/portrait spec** (CORRECTED at UI-research
  time — Rule 7). The user accepted "extend `e2e/strategy-v2-chart-parity.spec.ts`", but that premise is
  empirically false: that spec is `test.skip(...)` (lines 47/55), has **NO baselined golden snapshot
  directory**, and its structural assertions were authored against wrong Recharts/`lightweight-charts`-
  canvas assumptions (PR #108 note in its header) — it can never go green against the SVG charts in
  scope. The user's actual INTENT (prove no-recompute via desktop-byte-identical snapshots + portrait
  coverage) is served by a fresh spec: capture REAL desktop byte-identity goldens for the in-scope
  hand-rolled SVG charts AND add 320px portrait snapshots (±2% per-panel tolerance pattern). Leave the
  dead Recharts spec to Phase 48. FLOW-01 dual-wire the new spec.
- **Proof of "no recompute" = rely on the existing desktop parity snapshots + SCENARIO-05
  (`phase-31-frozen-spine-guards.test.ts`) + BODY-02 staying GREEN and un-weakened** — any value change
  fails them. No novel AST/grep no-recompute guard (parity snapshots already catch a value change).
- **Target-size = extend the Phase-44 target-size gate** to assert chart tap-pin hit areas ≥44px on a
  representative authed factsheet route at 320px; FLOW-01 dual-wire (HAS_SEED_ENV + ci.yml).
- **Snapshot routes = factsheet v2 route** (7-panel + most SVG charts) **+ the allocations scenario
  route** (MonteCarloBandChart); seeded.

### Claude's Discretion
- The exact full enumeration of the hand-rolled SVG chart set (plan-phase research), the precise
  per-chart tap-target geometry, the exact tick counts / font sizes per breakpoint, and which panels need
  HTML-overlay labels vs font-bump — all at executor discretion within the decisions above and the locked
  success criteria.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (1313 LOC) — the REFERENCE responsive+touch SVG chart.
  Tap-pins-crosshair recipe: tap detection at ~L45–48 / L315–379 (≤8px move + <350ms = tap → pin;
  re-tap within 10px toggles off; survives pointerleave); `crossIdx` + `useDeferredValue` tooltip;
  already wrapped in `ResponsiveChartFrame` (RCF=4). Guarded by `e2e/strategy-v2-chart-parity.spec.ts`
  — must NOT break.
- `src/components/ResponsiveChartFrame.tsx` (60 LOC) — Phase-44 primitive. Props: `width`, `height`
  (viewBox dims), `className`, `style`, `children`. Emits `viewBox="0 0 W H"` +
  `preserveAspectRatio="xMidYMid meet"` + `block w-full` + `aspectRatio`/`maxHeight`/`width:100%`/
  `height:auto`. Wrap each SVG chart in this; pass a taller `height` at mobile for portrait tuning.
- `src/hooks/useBreakpoint.ts` (32 LOC) — SSR-safe two-pass; returns `"mobile" | "tablet" | "desktop"`
  (`max-width:639px` → mobile, `max-width:1023px` → tablet, server snapshot `"desktop"`). Drives tick
  reduction + portrait viewBox selection.
- Hand-rolled SVG charts to enhance: factsheet v2 `AnalyticalPanels`/`CrossSignaturePanels`/
  `DistributionPanels`/`HeatmapPanels`/`SignaturePanels`/`HistogramChart`/`MasterBrush`;
  `src/components/charts/{DailyHeatmap,ReturnQuantiles,Sparkline}.tsx`; allocations `MonteCarloBandChart`.
- Phase-44 gates: `e2e/target-size.spec.ts` (44px, unseeded public), `e2e/reflow-sweep.spec.ts`
  (unseeded) + `e2e/reflow-sweep-authed.spec.ts` (seeded, HAS_SEED_ENV), all in `e2e/helpers/`.

### Established Patterns
- Charts receive a PRECOMPUTED payload and render — `TimeSeriesChart` calls the pure `resolveSeries(cfg,
  payload, cmp, xStart)` (slices/rebases from precomputed payload fields, no metric re-derivation);
  the standalone SVG charts take precomputed prop arrays. The phase rule: read every value from the
  existing payload, NEVER recompute a series/metric/domain.
- `e2e/strategy-v2-chart-parity.spec.ts`: per-panel screenshots (±2%), full-page (±5%), structural SVG
  path assertions (accent `#1B6B5A`, benchmark `#94A3B8`), tabular-nums axis ticks, DailyHeatmap <300ms
  paint budget.
- `src/__tests__/phase-31-frozen-spine-guards.test.ts`: SCENARIO-05 (`scenario.ts` zero-diff) +
  HIDE-DON'T-UNMOUNT. BODY-02 byte-identity is parity-by-construction (scenario tab mounts the REAL
  `FactsheetBody`, not a mock).
- FLOW-01 dual-wiring: every new/extended e2e gate must be in BOTH the spec's `HAS_SEED_ENV` const AND
  `.github/workflows/ci.yml` (seeded MA-8 list when seeded; unseeded MA-1 list otherwise) — or it
  silently never runs (burned twice in prior milestones).
- Coverage ratchet (vitest.config.ts): lines 82 / stmts 80 / fns 74 / branches 72 — new viewport
  conditionals need branch coverage; never lower a threshold or blanket-update a snapshot to go green.

### Integration Points
- `src/app/factsheet/[id]/v2/` (panel files), `src/components/charts/`,
  `src/app/(dashboard)/allocations/components/` (MonteCarloBandChart).
- A new thin shared tap-pin gesture hook under `src/hooks/` (extracted from TimeSeriesChart's logic;
  TimeSeriesChart itself NOT refactored).
- `e2e/strategy-v2-chart-parity.spec.ts` + `e2e/target-size.spec.ts` + `e2e/helpers/` + `ci.yml`.

</code_context>

<specifics>
## Specific Ideas

- The chart-parity DESKTOP snapshots are the falsifiable proof of "no recompute" — they must stay
  byte-identical; the NEW work is additive 320px portrait snapshots. These live in a FRESH Phase-47 SVG
  parity spec (the existing `strategy-v2-chart-parity.spec.ts` is skipped + never-baselined + wrong-
  assertion; do NOT resurrect it here). A red parity/SCENARIO-05/BODY-02 guard is information, never an
  obstacle to weaken (equal weight to prior milestones' IMPACT-02/BODY-02).
- Mirror the Phase-44/JOURNEY-03 lesson: a gate only earns trust once it actually RUNS in CI — prove the
  extended target-size + portrait-snapshot specs execute in a real CI run (FLOW-01 dual-wired), not just
  that they exist.
- Reuse `ResponsiveChartFrame` + `useBreakpoint` everywhere; do not reinvent per-chart sizing/breakpoint
  logic.

</specifics>

<deferred>
## Deferred Ideas

- Recharts charts + the 2277-LOC `EquityChart` touch parity — Phase 48 (CHART-01b), including
  `DrawdownChart` (Recharts, mis-listed in the roadmap SC#1 example).
- App-wide axe at mobile viewport + the `@lhci/cli` mobile performance budget — Phase 48 (A11Y-01/03).
- A novel static no-recompute AST/grep guard — not adopted; existing parity + frozen-spine guards cover
  it. Revisit only if a recompute slips past the snapshots.
- Native-app touch gestures (swipe between tabs, pull-to-refresh) — v2 (MOBL-01).

</deferred>
