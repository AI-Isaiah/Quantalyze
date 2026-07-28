# Phase 47: Hand-Rolled SVG Charts (touch + legibility + portrait) - Research

**Researched:** 2026-06-27
**Domain:** Hand-rolled SVG chart components (React 19 / Next 16) — touch interaction, WCAG legibility, portrait density, frozen-math byte-identity
**Confidence:** HIGH (all enumeration, dimensions, font-sizes, hover-inventory, test-wiring verified against the live tree; no net-new libraries; the unknowns the orchestrator named are now resolved with file:line evidence)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Touch Interaction (CHART-01a)**
- **Parity-only tap-reveal**: add tap-to-reveal/pin ONLY where a desktop hover exists today (SC#1 = "a tap reveals the value that hover gives on desktop"). Charts with no desktop hover (e.g. `Sparkline`, `ReturnQuantiles`) get legibility (CHART-02) + portrait (CHART-03) only — do NOT invent a new interaction surface for them.
- **Per-chart-type tap target**: heatmap = cell, box-plot = period column, histogram = bar — each showing the SAME value the desktop tooltip shows (not a literal crosshair line on non-line charts).
- **Thin shared tap-pin gesture hook** extracted from `TimeSeriesChart`'s tap-vs-drag / pin-toggle detection so the SVG charts don't each reimplement it (DRY). **Do NOT refactor `TimeSeriesChart` itself** — its chart-parity test must stay green.
- **Dismissal matches `TimeSeriesChart`**: re-tap toggles the pin off, tap moves the pin, the pin survives `pointerleave`, no auto-dismiss timer.

**Area 2 — Legibility at 320px (CHART-02)**
- **Default technique = reduced tick density + larger viewBox font** (CSS-first, no overlay machinery). Use HTML-overlay real-px labels ONLY where the viewBox downscale still wins.
- **Legible floor**: effective rendered axis text ≥ ~12px (body-small) at 320px; verified by a portrait snapshot in the chart-parity suite.
- **Tick-reduction trigger = breakpoint-driven via `useBreakpoint`** (mobile → fewer ticks), consistent with the Phase-44 primitive; avoid per-chart `ResizeObserver` unless a chart already measures.
- **Data untouched**: ticks/labels only — never downsample data points (banned anti-feature; frozen-math guard).

**Area 3 — Portrait Tuning of Dense Panels (CHART-03)**
- **Trigger = width breakpoint (`useBreakpoint` mobile)**, NOT an `orientation` media query — a narrow desktop window also gets the tuned layout.
- **Taller aspect on mobile = pass a taller viewBox to `ResponsiveChartFrame` at the mobile breakpoint; the desktop viewBox stays byte-identical** (parity).
- **Correlation heatmap at 320px = keep ALL cells (no row/col drop)**; reduce/rotate label density and use the existing scroll region.
- **7-panel factsheet stacking = already banked in Phase-46 CSS** — Phase 47 only tunes each chart's internal density/aspect, no layout redo.

**Area 4 — Verification & Frozen-Math Guards**
- **Chart-parity = author a FRESH focused Phase-47 SVG parity/portrait spec** (CORRECTED at UI-research time — Rule 7). `e2e/strategy-v2-chart-parity.spec.ts` is dead (`test.skip(true,…)`, no baselined goldens, Recharts/canvas assertions). Author a fresh spec: REAL desktop byte-identity goldens for the in-scope hand-rolled SVG charts AND 320px portrait snapshots (±2% per-panel tolerance pattern). Leave the dead Recharts spec to Phase 48. FLOW-01 dual-wire the new spec.
- **Proof of "no recompute" = existing desktop parity snapshots + SCENARIO-05 (`phase-31-frozen-spine-guards.test.ts`) + BODY-02 staying GREEN and un-weakened**. No novel AST/grep no-recompute guard.
- **Target-size = extend the Phase-44 target-size gate** to assert chart tap-pin hit areas ≥44px on a representative authed factsheet route at 320px; FLOW-01 dual-wire.
- **Snapshot routes = factsheet v2 route + the allocations scenario route** (MonteCarloBandChart); seeded.

### Claude's Discretion
- The exact full enumeration of the hand-rolled SVG chart set (this research resolves it below), the precise per-chart tap-target geometry, the exact tick counts / font sizes per breakpoint, and which panels need HTML-overlay labels vs font-bump — all at executor discretion within the decisions above and the locked success criteria.

### Deferred Ideas (OUT OF SCOPE)
- Recharts charts + the 2277-LOC `EquityChart` touch parity — Phase 48 (CHART-01b), including BOTH `DrawdownChart` files (Recharts, mis-listed in the roadmap SC#1 example).
- App-wide axe at mobile viewport + the `@lhci/cli` mobile performance budget — Phase 48 (A11Y-01/03).
- A novel static no-recompute AST/grep guard — not adopted; existing parity + frozen-spine guards cover it.
- Native-app touch gestures (swipe between tabs, pull-to-refresh) — v2 (MOBL-01).
- `EquityCurve` (`lightweight-charts` canvas), HTML/div `MonthlyHeatmap` / `WorstDrawdowns` — not SVG, out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHART-01a | Every hand-rolled SVG chart is touch-inspectable — a tap reveals (and pins) the value hover gives on desktop, propagating the `TimeSeriesChart` tap-pins-crosshair recipe to the SVG charts via `ResponsiveChartFrame`. | Hover Inventory (corrected) names the EXACT 3 charts that have a desktop value-reveal today (DailyReturnsHeatmap, DailyHeatmap, StreakDistributionPanel `<title>`) + MasterBrush scrub. The shared-hook shape (`useTapPin`) is specified from `TimeSeriesChart.tsx:44–379`. Parity-gate column is binding: no-hover → no new interaction. |
| CHART-02 | Chart text is legible at 320px (WCAG 1.4.4) — fixes the viewBox-downscale trap where axis text shrinks to ~4–5px. | Per-panel downscale math computed below (VB_W × declared fontSize → effective px at 320px). 6 of the in-scope SVG charts fall below the 12px floor; the per-breakpoint font-bump + tick-reduction fix is specified. The `strategy-v2-type-scale` lint does NOT block SVG `fontSize` bumps (verified — it matches Tailwind className strings only). |
| CHART-03 | Charts render portrait-tuned (reduced density, taller aspect) with frozen math byte-identical — SCENARIO-05 + BODY-02 stay green. | Portrait strategy = mobile-only taller viewBox via `ResponsiveChartFrame` height; desktop dims unchanged → desktop goldens byte-identical. Correlation matrix (CorrelationsMatrixPanel) keep-all-cells-in-scroll-region approach specified. No-recompute rule traced to `resolveSeries` / precomputed prop arrays. |
</phase_requirements>

## Summary

Phase 47 is a **presentation-only retrofit over 17 genuinely hand-rolled `<svg>` chart panels** (across 11 files), bringing them to touch + 320px-legibility + portrait parity with the reference `TimeSeriesChart`, while the frozen `scenario.ts`/`compute.ts` math stays byte-identical. No new libraries — the installed stack (`ResponsiveChartFrame`, `useBreakpoint`, `chart-tokens.ts`, Playwright, Vitest) is sufficient, and a net-new charting library is an explicit anti-feature (REQUIREMENTS.md). The work decomposes cleanly along the three sub-requirements, and the in-scope file set is now fully enumerated and verified (all `recharts=0`, raw `<svg>`, RCF=0).

The single most important research finding is a **correction to the UI-SPEC's "desktop hover today?" table**. Grepping the live source shows the real desktop-hover inventory is narrower than the UI-SPEC asserts: only **DailyReturnsHeatmap** (JS `onPointerMove`→floating tooltip), **DailyHeatmap** (`<title>` + canvas), and **StreakDistributionPanel** (per-bar native `<title>`) reveal a value on hover; **MasterBrush** has pointer handlers but they are a *brush/scrub* drag, not a value tooltip; and **HistogramChart has NO per-bar hover** (only wheel-zoom + double-click — the UI-SPEC's "yes (1 marker)" is empirically false). Per the binding parity-only rule (no desktop hover → no new interaction), the tap-pin work is therefore far smaller than the UI-SPEC implies: roughly 3–4 charts get tap-reveal, the rest get legibility + portrait only.

The legibility math is concrete and load-bearing: the factsheet panels declare SVG `fontSize` of 8–12 against viewBox widths of 440–1100; at a 320px CSS viewport these downscale to ~3–7px effective (the WCAG 1.4.4 trap). The fix — mobile-breakpoint font-bump + tick-reduction via `useBreakpoint` — is unblocked because the `strategy-v2-type-scale` lint matches only Tailwind className strings (`text-[11px]`, `text-sm`), not SVG `fontSize={N}` numeric props, and does not even cover the `factsheet/[id]/v2/` panel files.

**Primary recommendation:** Build ONE `useTapPin` hook (extracted from `TimeSeriesChart`'s tap-detection core, NOT its pan/zoom), apply it to ONLY the 3–4 charts with a real desktop value-reveal; apply a `useBreakpoint`-driven mobile font-bump + tick-reduction + taller-viewBox to all 17 panels via `ResponsiveChartFrame`; author a FRESH seeded Playwright spec capturing desktop byte-identity goldens (no-recompute proof) + 320px portrait snapshots, FLOW-01 dual-wired into the MA-8 list; extend the Phase-44 target-size gate to assert ≥44px tap hit-rects on `/strategy/[id]/v2`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tap-to-reveal/pin gesture | Browser / Client | — | Pointer events fire only in the browser; `"use client"` components. The hook owns slop/time tap-detection + pin state. |
| Breakpoint-driven tick/font/viewBox selection | Browser / Client | Frontend Server (SSR) | `useBreakpoint` is SSR-safe two-pass (server snapshot `desktop`); desktop render is server-emitted, mobile tuning applies post-hydration. |
| Chart value/series/domain data | API / Backend (precomputed payload) | Browser (render-only) | Charts read from the precomputed factsheet payload / props — NEVER recompute. This is the frozen-math boundary (SCENARIO-05 / BODY-02). |
| Legibility floor verification | CI (Playwright) | — | 320px portrait snapshots + extended target-size gate run in the seeded MA-8 CI job. |
| Desktop byte-identity (no-recompute proof) | CI (Playwright + Vitest) | — | Fresh desktop goldens + SCENARIO-05/BODY-02/compute.ts parity + chart-parity all stay green. |

## Standard Stack

No net-new packages. Phase 47 uses only what is already installed and the existing primitives.

### Core (existing, reused)
| Asset | Version / Path | Purpose | Why Standard |
|-------|----------------|---------|--------------|
| `ResponsiveChartFrame` | `src/components/ResponsiveChartFrame.tsx` (60 LOC) | Wrap each SVG root; emits `viewBox` + `preserveAspectRatio="xMidYMid meet"` + `block w-full` + responsive style. Pass taller `height` at mobile. | Phase-44 primitive, extracted verbatim from `TimeSeriesChart`. [VERIFIED: read file] |
| `useBreakpoint` | `src/hooks/useBreakpoint.ts` (32 LOC) | SSR-safe `"mobile"\|"tablet"\|"desktop"` (max-width:639 → mobile). Single source of tick-reduction + portrait-viewBox trigger. | Phase-44 primitive; server snapshot `desktop` (no hydration mismatch). [VERIFIED: read file] |
| `useMediaQuery` | `src/hooks/useMediaQuery.ts` | `useSyncExternalStore`-based; `useBreakpoint` wraps it. SSR snapshot `false`. | Already used; no React-compiler setState-in-effect smell. [VERIFIED: read file] |
| `chart-tokens.ts` | `src/components/charts/chart-tokens.ts` | All hex literals (`CHART_ACCENT #1B6B5A`, `CHART_AXIS_TICK #64748B`, baked heatmap ramp). Any SVG hex must come from here or `var(--color-*)`. | DESIGN.md token SoT; `CHART_TICK_STYLE.fontSize = 12`. [VERIFIED: read file] |
| `@playwright/test` | `^1.59.1` | Per-panel screenshot goldens (`toHaveScreenshot`, `maxDiffPixelRatio`) + portrait snapshots. | Already the e2e harness; `e2e/reflow-sweep-authed.spec.ts` is the seeded-route template. [VERIFIED: package.json] |
| `vitest` + `@vitest/coverage-v8` | `^4.1.2` / `^4.1.5` | Unit + branch coverage for new `useBreakpoint` conditionals. | Coverage ratchet (lines 82 / stmts 80 / fns 74 / branches 72). [VERIFIED: package.json + vitest.config.ts] |

### Supporting (existing)
| Asset | Path | Purpose | When to Use |
|-------|------|---------|-------------|
| `assertTargetSizes` | `e2e/helpers/reflow.ts` | 44px hit-rect measurement at 320px (scoped selector). | Extend (add a chart-tap-rect selector on `/strategy/[id]/v2`) — do NOT lower `MIN_TARGET_PX=44`. [VERIFIED: read file] |
| `seedStrategyWithHistory` | `e2e/helpers/seed-test-project.ts` | Seeds a strategy + N days history; the factsheet panel route reads it. | The fresh chart-parity spec seeds via this (the proven seeded route for the panels). [VERIFIED: used by strategy-v2-axe/keyboard specs] |
| `seedTestAllocator` | `e2e/helpers/seed-test-project.ts` | Seeds an allocator (role=allocator). **NOTE: 0 synced positions** → `/allocations` shows honest-empty. | MonteCarloBandChart needs a scenario with strategies; a bare allocator will NOT render it (see Pitfall 4). [VERIFIED: reflow-sweep-authed comment] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared `useTapPin` hook | Per-chart inline tap handlers | Violates the locked DRY decision; 4× the regression surface. Hook is correct. |
| `useBreakpoint` for tick reduction | Per-chart `ResizeObserver` | Locked decision: use `useBreakpoint` UNLESS a chart already measures. Only `HeatmapPanels.DailyReturnsHeatmap` already measures (canvas `scale` state) — it MAY keep its measure. [VERIFIED: HeatmapPanels.tsx:262] |
| Fresh Phase-47 spec | Revive `strategy-v2-chart-parity.spec.ts` | The dead spec targets `/strategy/[id]/v2` with Recharts/canvas assertions + double `test.skip(true)` + no goldens dir. Reviving it costs more than a fresh focused spec. Fresh spec is correct (Area-4 CORRECTION). [VERIFIED: read spec header + skip] |

**Installation:** None. `npm install` adds nothing this phase. A new charting library / UI kit / CSS framework is an explicit out-of-scope anti-feature (REQUIREMENTS.md "Out of Scope").

## Package Legitimacy Audit

> Not applicable — Phase 47 installs ZERO external packages. It is a presentation-layer retrofit over existing components using only already-installed dependencies (`next ^16.2.3`, `react 19.2.4`, `@playwright/test ^1.59.1`, `vitest ^4.1.2`). No registry interaction, no slopcheck required. A net-new dependency would be a scope violation (REQUIREMENTS.md anti-feature). [VERIFIED: package.json read]

## In-Scope Chart Enumeration (the resolved "16")

> **This is Focus Area 1 — the binding per-chart task list.** Verified against the live tree: every file below is `recharts=0`, `lightweight-charts=0`, raw `<svg>`, currently RCF=0 / useBreakpoint=0. The roadmap's loose "16" counts multiple exported chart panels per file; the true count is **17 chart panels across 11 files** (some panels in these files are HTML tables, NOT svg — flagged below and OUT of svg scope).

### Factsheet v2 panel files (mount via `FactsheetView.tsx` on `/strategy/[id]/v2?strategy_v2=on` — the proven seeded route) [VERIFIED: FactsheetView.tsx imports L10–49]

| # | Chart panel | File:export | SVG? | viewBox W×H | Declared SVG fontSize | Desktop value-reveal today? | Phase-47 treatment |
|---|-------------|-------------|------|-------------|----------------------|----------------------------|--------------------|
| 1 | StreakDistributionPanel | `AnalyticalPanels.tsx:19` | ✅ svg (2 side-by-side histograms) | 440×200 | **9** | **YES** — per-bar native `<title>` (L99) shows on hover | tap-reveal (promote `<title>` to tappable pin) + legibility + portrait |
| 2 | CalmarByYearPanel | `AnalyticalPanels.tsx:156` | ❌ HTML `<table>` (L168) | — | text-[11px] | n/a | OUT of svg scope (HTML table; reflow already Phase-46) |
| 3 | BootstrapCIPanel | `AnalyticalPanels.tsx:213` | ✅ svg (CI box-strip, 340×36) | 340×36 | 9 (text-[10px] wrapper) | NO | legibility + portrait only |
| 4 | EndOfYearBarsPanel | `DistributionPanels.tsx:26` | ✅ svg (bar chart) | 880×var (PAD+rows×ROW_H) | 10–12 | NO | legibility + portrait only |
| 5 | QuantileBoxPlotPanel | `DistributionPanels.tsx:192` | ✅ svg (box plot) | 880×130 | 9–11 | NO | legibility + portrait only |
| 6 | CorrelationStripPanel | `DistributionPanels.tsx:318` | ✅ svg (in `overflow-x-auto`) | 880×var | 10–11 | NO | legibility + portrait only |
| 7 | CorrelationsMatrixPanel | `DistributionPanels.tsx:423` | ✅ svg (the DENSE heatmap, in `overflow-x-auto`) | 880×var | 10–11 | NO (cells static) | **the keep-all-cells correlation heatmap (CHART-03)** + legibility |
| 8 | MonthlyReturnsHeatmap | `HeatmapPanels.tsx:35` | ❌ HTML `<table>` (L57) | — | 8–9 (table cells) | n/a (CSS hover) | OUT of svg scope (HTML table) |
| 9 | DailyReturnsHeatmap | `HeatmapPanels.tsx:149` | ✅ svg + **canvas overlay** | `w×h` (measured, `scale` state) | **8–9** | **YES** — `onPointerMove`→`hovered` state→floating tooltip div (L334–433) | tap-reveal (cell) + legibility + portrait. Already measures (canvas) → MAY keep its ResizeObserver-equivalent |
| 10 | SignaturesSection | `SignaturePanels.tsx:36` | ✅ svg | 880×230 | 10 | NO | legibility + portrait only |
| 11 | CrossSignaturesSection | `CrossSignaturePanels.tsx:30` | ✅ svg | 880×200 | 10 | NO | legibility + portrait only |
| 12 | HistogramChart | `HistogramChart.tsx:34` | ✅ svg | 880×200 | 10 | **NO** (wheel-zoom + dbl-click only; NO per-bar value reveal) — **UI-SPEC "yes (1 marker)" is WRONG** | legibility + portrait only (re-confirm at plan time) |
| 13 | MasterBrush | `MasterBrush.tsx:36` | ✅ svg | 1100×60 | 9 | partial — pointer handlers are **brush/scrub drag**, not a value tooltip | scrub already works; legibility + portrait. Tap-reveal only if a value-at-x reveal is judged in-parity (executor call) |

### Standalone `src/components/charts/` (mount elsewhere)

| # | Chart | File:export | SVG? | viewBox W×H | fontSize | Desktop hover? | Mounts on | Treatment |
|---|-------|-------------|------|-------------|----------|----------------|-----------|-----------|
| 14 | DailyHeatmap | `DailyHeatmap.tsx` | ✅ svg + **canvas** (hybrid) | `width×height` (computed; 365 cols) | **12** | **YES** — per-cell `<title>` (L195) | `ReturnsDistributionPanel.tsx` (factsheet) + tearsheet | tap-reveal (promote `<title>`) + portrait. Already measures (canvas). fontSize=12 already at floor [VERIFIED] |
| 15 | ReturnQuantiles | `ReturnQuantiles.tsx` (101 LOC) | ✅ svg (box plot, NOT yet on RCF — raw `<svg viewBox className="w-full">`) | 600×200 | **10–11** | NO | `ReturnsDistributionPanel.tsx` + tearsheet | legibility + portrait only. Wrap in RCF. |
| 16 | Sparkline | `Sparkline.tsx` (74 LOC) | ✅ svg (raw `<svg width height>`, NOT on RCF) | 120×32 (props, tiny) | none (no text) | NO | `StrategyTable` / `StrategyGrid` (discovery list rows) | legibility n/a (no text); portrait n/a (tiny inline). Likely NO-OP — confirm at plan time |

### Allocations

| # | Chart | File:export | SVG? | viewBox W×H | fontSize | Desktop hover? | Mounts on | Treatment |
|---|-------|-------------|------|-------------|----------|----------------|-----------|-----------|
| 17 | MonteCarloBandChart | `(dashboard)/allocations/components/MonteCarloBandChart.tsx` (132 LOC) | ✅ svg (fan/band, `role="img"` NOT interactive) | 600×240 | **12** | NO (deliberately non-interactive `role=img`) | `ScenarioComposer.tsx` (Scenario tab, needs ≥2 strategies) | legibility (already 12) + portrait only. **No tap-reveal** (it's `role=img` by design — adding interaction would re-introduce the empty-focus-stop regression DESIGN.md pins against) |

**Net touch-tap work (after the corrected hover gate):** StreakDistributionPanel (#1), DailyReturnsHeatmap (#9), DailyHeatmap (#14), and conditionally MasterBrush (#13). That is **3 firm + 1 conditional**, not the ~6 the UI-SPEC's table implies. **Legibility + portrait work touches ~13–15 svg panels.** Two "panels" listed in the files (CalmarByYearPanel #2, MonthlyReturnsHeatmap #8) are HTML tables — out of svg scope.

## Architecture Patterns

### System Architecture Diagram (data + interaction flow)

```
                  PRECOMPUTED FACTSHEET PAYLOAD (frozen engine output)
                  scenario.ts / compute.ts  ── FROZEN, byte-identical ──┐
                                                                         │ (read-only)
   ┌──────────────────────────── render path ────────────────────────── ▼ ───────────┐
   │                                                                                   │
   │  FactsheetView.tsx ──mounts──► [13 factsheet svg panels]                          │
   │  ReturnsDistributionPanel ──► DailyHeatmap, ReturnQuantiles                       │
   │  StrategyTable/Grid ──► Sparkline                                                 │
   │  ScenarioComposer ──► MonteCarloBandChart                                         │
   │            each panel reads its series/domain from the payload (NEVER recomputes) │
   └──────────────────────────────────┬────────────────────────────────────────────-─┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
   ResponsiveChartFrame        useBreakpoint()            useTapPin()  (NEW, shared)
   (wrap each <svg>)           "mobile"|"tablet"|         tap-detect (slop+time)
   viewBox + preserveAR        "desktop"                  → selectedIdx + pin toggle
            │                          │                          │
   ┌────────┴────────┐        ┌────────┴────────┐       ┌─────────┴──────────┐
   │ desktop: dims    │        │ mobile: fewer    │       │ pointerdown→up      │
   │ BYTE-IDENTICAL   │        │ ticks + bigger   │       │ slop≤8px & <350ms   │
   │ (goldens unchg)  │        │ fontSize +       │       │ →tap; re-tap toggle │
   │                  │        │ taller height    │       │ survives leave      │
   └──────────────────┘        └──────────────────┘       └─────────────────────┘
            │                          │                          │
            ▼                          ▼                          ▼
   POINTER input ──► tap target hit-rect ≥44px (pointer-coarse) ──► value reveal
                     (only on the 3-4 charts with a desktop value-reveal)

   VERIFICATION (CI, seeded MA-8 job):
     desktop goldens (byte-identical)  ── no-recompute proof
     320px portrait snapshots          ── CHART-02 legibility floor
     extended target-size gate (≥44px) ── CHART-01a hit-rect
     SCENARIO-05 + BODY-02 + compute.ts parity (Vitest) ── frozen math
```

### Recommended Structure (new files only)
```
src/hooks/
└── useTapPin.ts          # NEW — shared tap-vs-drag + pin-toggle gesture (extracted core)
src/hooks/
└── useTapPin.test.ts     # NEW — branch coverage for the hook conditionals (ratchet)
e2e/
└── svg-chart-parity.spec.ts   # NEW — desktop goldens + 320px portrait snapshots (FLOW-01 wired)
e2e/__snapshots__/
└── svg-chart-parity.spec.ts/  # NEW — baked goldens (committed; THIS is the no-recompute proof)
# EDITS (in place):
#   src/app/factsheet/[id]/v2/{Analytical,CrossSignature,Distribution,Heatmap,Signature}Panels.tsx
#   src/app/factsheet/[id]/v2/{HistogramChart,MasterBrush}.tsx
#   src/components/charts/{DailyHeatmap,ReturnQuantiles,Sparkline}.tsx
#   src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx
#   e2e/target-size.spec.ts  (add chart-tap-rect assertion on /strategy/[id]/v2)
#   .github/workflows/ci.yml (add new spec to MA-8 list — FLOW-01 place 1)
# DO NOT TOUCH:
#   src/app/factsheet/[id]/v2/TimeSeriesChart.tsx (reference; parity must stay green)
#   src/lib/scenario.ts, src/lib/compute.ts (frozen engine)
```

### Pattern 1: The shared `useTapPin` hook (extracted from TimeSeriesChart)

**What:** A thin hook that owns ONLY the tap-vs-drag detection + pin state, NOT the pan/zoom machinery (which is line-chart-specific). The consuming chart provides a `pointerToIndex(clientX, clientY, rect)` mapping callback; the hook returns `{ selectedIdx, pinned, onPointerDown, onPointerMove, onPointerUp, svgRef }` (or equivalent handler set). The chart renders its own value-reveal (cell highlight / bar tooltip / pinned marker) from `selectedIdx`.

**When to use:** ONLY on the 3–4 charts with a real desktop value-reveal (StreakDistributionPanel, DailyReturnsHeatmap, DailyHeatmap, conditional MasterBrush).

**What `TimeSeriesChart` does that the hook must generalize (the EXACT mechanics to copy):** [VERIFIED: TimeSeriesChart.tsx:44–379]
- State: `crossIdx: number|null` (the selected index), `pinned: boolean`. `[L44, L48]`
- Refs: `tapInfoRef = {x, y, t, type}` recorded on pointerdown; `movedRef` flipped once moved >8px. `[L51–52, L316–317]`
- **Tap-slop:** `dx*dx + dy*dy > 64` (8px) flips `movedRef = true` in `onPointerMove`. `[L226–229]`
- **Tap-time:** `Date.now() - ti.t > 350` → NOT a tap (it's a drag/hold). `[L359]`
- **Touch-only gate:** `if (!ti || ti.type !== "touch" || movedRef.current) return;` — the pin logic only fires for `pointerType === "touch"` (mouse keeps hover). `[L358]`
- **Re-tap toggle:** `if (pinned && crossIdx != null && Math.abs(idx - crossIdx) < 3) { setPinned(false); setCrossIdx(null); } else { setCrossIdx(idx); setPinned(true); }` `[L372–378]`
- **pointerleave survival:** `onPointerLeave = () => { if (!pinned) setCrossIdx(null); }` — pinned survives. `[L299–303]`
- **No auto-dismiss timer** (none exists). `[verified: no setTimeout in the gesture]`
- **Pointer capture:** `e.currentTarget.setPointerCapture(e.pointerId)` on down, released on up. `[L318, L347]` (MasterBrush does the same `[L106, L174]`.)

**The generalization:** `TimeSeriesChart`'s `pixelToIdx(clientX, rect)` `[L208–217]` maps pixel→fractional x-index against the line chart's plot. The hook abstracts this as a caller-supplied callback. For a heatmap the callback returns a cell index/coord; for a histogram a bar index; for the box-strip a period column. The value-lookup (what the tooltip *shows*) stays in the chart (it reads the precomputed prop array at `selectedIdx`).

**Example (the verbatim source to generalize):**
```tsx
// Source: src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:345-379 (tap-to-pin core)
const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
  // ... (release any active pan/zoom capture — NOT part of the hook) ...
  const ti = tapInfoRef.current;
  tapInfoRef.current = null;
  if (!ti || ti.type !== "touch" || movedRef.current) return;   // touch-only, not-a-drag
  if (Date.now() - ti.t > 350) return;                          // < 350ms = tap
  const svg = svgRef.current; if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const idxF = pixelToIdx(e.clientX, rect);                     // ← caller-supplied mapping
  if (idxF == null) { setPinned(false); setCrossIdx(null); return; }
  const idx = Math.max(0, Math.min(n - 1, Math.round(idxF)));
  if (pinned && crossIdx != null && Math.abs(idx - crossIdx) < 3) {
    setPinned(false); setCrossIdx(null);                        // re-tap → un-pin
  } else {
    setCrossIdx(idx); setPinned(true);                          // tap → move/pin
  }
}, [pixelToIdx, n, pinned, crossIdx]);
```

### Pattern 2: Breakpoint-driven legibility + portrait via `ResponsiveChartFrame`

**What:** At the mobile breakpoint, choose a smaller tick count + larger SVG `fontSize` + a taller viewBox `height`; at desktop, return the EXACT current values so goldens stay byte-identical.

**Example:**
```tsx
// Source: pattern derived from ResponsiveChartFrame.tsx + useBreakpoint.ts (verified primitives)
const bp = useBreakpoint();                       // "mobile" | "tablet" | "desktop"
const isMobile = bp === "mobile";
const VB_H = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;   // taller on mobile (portrait)
const tickFont = isMobile ? 14 : 10;                  // bump so effective px clears ~12 floor
const tickCount = isMobile ? 4 : 8;                   // fewer ticks at 320px
return (
  <ResponsiveChartFrame width={VB_W} height={VB_H} role="img" aria-label={...}>
    {/* axis <text fontSize={tickFont} ...> — desktop fontSize/height UNCHANGED → golden-identical */}
  </ResponsiveChartFrame>
);
```
**Critical:** the desktop branch MUST return today's exact `VB_W`, `VB_H`, `fontSize`, tick count, so the desktop golden does not change. The server snapshot is `desktop` so SSR HTML is unchanged.

### Anti-Patterns to Avoid
- **Putting tap-reveal on no-hover charts** (HistogramChart, ReturnQuantiles, Sparkline, MonteCarloBandChart) — violates the parity-only rule and invents UI. The corrected hover inventory is the binding gate.
- **Making MonteCarloBandChart interactive** — it is `role="img"` by design; adding `tabIndex` re-introduces the empty-focus-stop bug DESIGN.md pins against (the Recharts `accessibilityLayer` regression, 2026-04-30). [VERIFIED: MonteCarloBandChart.tsx:18–20 + DESIGN.md L236]
- **Changing desktop viewBox/fontSize** — breaks the desktop golden (the no-recompute proof). Mobile-only branch.
- **Recomputing a series/domain in the chart** — frozen-math violation; SCENARIO-05/BODY-02 catch a *value* change, parity goldens catch a *pixel* change.
- **`opacity` on baked heatmap cells** — alpha-blends fg+text, collapses contrast (the 138-violation regression, PR #108). Use the baked ramp hex directly. [VERIFIED: chart-tokens.ts L28–52]
- **Lowering `MIN_TARGET_PX=44`** to make the target-size gate green — scope the selector instead. [VERIFIED: reflow.ts L24–27]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| viewBox + preserveAspectRatio + aspect-ratio CSS | Per-chart inline `<svg>` recipe | `ResponsiveChartFrame` | Already the Phase-44 primitive; several panels already inline the EXACT style object (`AnalyticalPanels.tsx:312`, `HistogramChart.tsx:240`) — replace with the component for one SoT. |
| Tap-vs-drag + pin-toggle detection | Per-chart pointer handlers | `useTapPin` (extract once) | Locked DRY decision; `TimeSeriesChart` already encodes the exact slop/time/toggle/leave semantics — copy the core, don't re-derive. |
| Breakpoint detection | `window.matchMedia` per chart / `useState`+`resize` | `useBreakpoint` | SSR-safe two-pass; per-chart matchMedia risks hydration mismatch. |
| Color hex | Fresh literal hex in svg | `chart-tokens.ts` / `var(--color-*)` | Token SoT; bare `var(--positive)` resolves to currentColor under Tailwind v4 (silent-drift bug, DESIGN.md 2026-05-06). |
| 320px overflow / 44px measurement | New geometry probe | `assertNoReflow` / `assertTargetSizes` (`e2e/helpers/reflow.ts`) | Route-agnostic, fail-loud-on-blank helpers already exist. |
| Seeding a strategy with history | New fixture | `seedStrategyWithHistory` | The proven seed for the panel route. |

**Key insight:** This phase is almost entirely *wiring existing primitives across charts* — the only genuinely new artifact is the `useTapPin` hook and the fresh parity spec. Resist building anything beyond those two.

## Runtime State Inventory

> Phase 47 is a pure presentation-layer code change — no rename, no migration, no datastore touch. This section is included for completeness; every category is verified empty.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — charts read the precomputed factsheet/scenario payload; this phase writes nothing. Verified: no DB/SQL/migration in scope (REQUIREMENTS.md: "additive presentation; no migration"). | none |
| Live service config | None — no n8n/Datadog/Tailscale/external config touched. | none |
| OS-registered state | None — no Task Scheduler / pm2 / launchd / systemd. | none |
| Secrets/env vars | None new. CI reuses existing `TEST_SUPABASE_*` + `E2E_TEST_DB_CONFIGURED` for the seeded spec; no new secret. [VERIFIED: ci.yml L1273–1290] | none |
| Build artifacts | None — no package rename, no egg-info/binary. New committed Playwright goldens under `e2e/__snapshots__/svg-chart-parity.spec.ts/` are a deliberate artifact, not stale state. | commit goldens once baselined |

## Common Pitfalls

### Pitfall 1: Trusting the UI-SPEC's "desktop hover today?" column
**What goes wrong:** The UI-SPEC table marks HistogramChart, AnalyticalPanels, MasterBrush as "yes (1 marker)" hover. Building tap-reveal on all of them invents UI on charts that have NO desktop value-reveal, violating the parity-only rule and inflating scope/regression.
**Why it happens:** The UI-SPEC inferred hover from "has pointer handlers" — but MasterBrush's handlers are brush/scrub *drag*, and HistogramChart's are wheel-zoom; neither reveals a value.
**How to avoid:** Use the corrected Hover Inventory above (grep-verified). Binding gate: a chart earns tap-reveal ONLY if it has a JS `hovered`/`<title>` value reveal today. Firm set: StreakDistributionPanel (`<title>`), DailyReturnsHeatmap (JS tooltip), DailyHeatmap (`<title>`). MasterBrush = executor judgment (scrub value-at-x).
**Warning signs:** A plan task adding tap-reveal to HistogramChart/ReturnQuantiles/Sparkline/MonteCarloBandChart.

### Pitfall 2: Breaking the desktop golden (the no-recompute proof)
**What goes wrong:** Bumping `fontSize` or `VB_H` unconditionally (not mobile-gated) changes the desktop render → the new desktop golden differs → either the spec is red, or someone blanket-updates the golden and silently loses the no-recompute proof.
**Why it happens:** Forgetting that `useBreakpoint`'s server snapshot is `desktop`, so SSR + the desktop branch must be byte-identical to today.
**How to avoid:** Gate EVERY tuning change behind `bp === "mobile"`; desktop branch returns today's exact constants. Bake the desktop golden from `main`-equivalent output FIRST, then add mobile tuning, then add the 320px portrait golden. Never `--update-snapshots` the desktop golden after a tuning change.
**Warning signs:** A desktop golden diff in the parity spec PR; a tick-count/font change with no `isMobile` guard.

### Pitfall 3: The `strategy-v2-type-scale` lint mis-read as blocking font bumps
**What goes wrong:** Executor assumes bumping SVG `fontSize={9}`→`{14}` trips the DESIGN-02 4-size/2-weight lint and avoids the legibility fix.
**Why it happens:** The lint is named "type-scale" and is grep-based.
**How to avoid:** [VERIFIED] The lint (`tests/visual/strategy-v2-type-scale.test.ts`) matches ONLY Tailwind className strings (`/\btext-\[11px\]/`, `/\btext-sm\b/`, etc.) — NOT SVG `fontSize={N}` numeric props. Its scope is `src/components/strategy-v2/**` + 6 named `src/components/charts/` files; it does NOT cover `src/app/factsheet/[id]/v2/*` at all. **DailyHeatmap.tsx IS in the lint's 6-file list** — keep its className strings within the allowed set (its SVG `fontSize` numeric props are unaffected).
**Warning signs:** A plan that routes the legibility fix through HTML overlays solely to dodge a lint that doesn't apply.

### Pitfall 4: MonteCarloBandChart not rendering on the seeded route
**What goes wrong:** The fresh parity spec seeds an allocator and navigates to `/allocations?tab=scenario` expecting MonteCarloBandChart, but `seedTestAllocator` produces 0 synced positions → AllocationDashboardV2 shows the honest-empty EmptyState, AND the ScenarioComposer needs ≥2 strategies to render the Monte Carlo fan. The golden is captured against an empty page.
**Why it happens:** [VERIFIED: reflow-sweep-authed.spec.ts L17–18, L136–151] A freshly-seeded allocator has a verified profile but no positions.
**How to avoid:** Either (a) snapshot MonteCarloBandChart in a Vitest component test with synthetic `MonteCarloBandPoint[]` props (it is props-only, `role="img"`, 132 LOC — easy to mount in isolation), OR (b) extend the seed to add a scenario with ≥2 strategies. Option (a) is lower-risk and still proves the legibility/portrait change; the desktop byte-identity is provable via a unit snapshot of the rendered SVG. Recommend (a) for MonteCarloBandChart, Playwright goldens for the factsheet panels (which DO render on the seeded `/strategy/[id]/v2`).
**Warning signs:** A blank/EmptyState golden for the Monte Carlo panel; a flaky scenario-tab snapshot.

### Pitfall 5: FLOW-01 — the new spec never running in CI
**What goes wrong:** The fresh `svg-chart-parity.spec.ts` exists with a `HAS_SEED_ENV` self-skip but is NOT added to `ci.yml`'s MA-8 list → it silently never runs (the twice-burned trap).
**Why it happens:** Two required wiring places: the spec's own env-skip const AND the `npx playwright test … \` list at `ci.yml:1252–1264`.
**How to avoid:** [VERIFIED: ci.yml L1252–1264] Add `e2e/svg-chart-parity.spec.ts \` to the MA-8 list. Prove it executed (passed, not skipped) in a real CI run with `vars.E2E_TEST_DB_CONFIGURED == 'true'`. The extended target-size assertion is in the already-wired `e2e/target-size.spec.ts` (UNSEEDED list, `ci.yml:1059`) IF it stays on a public route — but a chart-tap-rect on `/strategy/[id]/v2` is SEEDED, so a chart-specific target-size case may need to move to / be added to the MA-8 list. Decide route at plan time.
**Warning signs:** CI green but the new spec shows "skipped"; a target-size chart assertion on a route that 404s unauthenticated.

### Pitfall 6: Coverage ratchet regression from new conditionals
**What goes wrong:** Each `isMobile ? a : b` branch + each new `useTapPin` conditional adds branches; without unit tests they drop branch coverage below 72.
**Why it happens:** New viewport conditionals are inherently branchy.
**How to avoid:** Unit-test `useTapPin` (slop, time, touch-only, re-tap toggle, pointerleave-survival — each is a branch) and at least one mobile/desktop render of each tuned chart (or test the tuning helper purely). [VERIFIED: thresholds lines 82/stmts 80/fns 74/branches 72; measured actual 2026-06-20 was 85.2/83.3/77.4/75.5, ~3pt headroom]. Run `npm run test:coverage` and confirm exit 0; never lower a threshold.
**Warning signs:** `frontend-coverage` CI job red; branch coverage near 72.

## Code Examples

### Mobile-gated tuning that keeps desktop byte-identical
```tsx
// Source: synthesis of ResponsiveChartFrame.tsx (verified) + useBreakpoint.ts (verified)
// DESKTOP branch returns TODAY'S exact constants → golden unchanged.
const VB_W = 880;                 // unchanged at all breakpoints (width fixed)
const VB_H_DESKTOP = 200;         // today's value
const VB_H_MOBILE = 280;          // taller portrait aspect
const bp = useBreakpoint();
const isMobile = bp === "mobile";
const vbH = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;
const tickFont = isMobile ? 14 : 10;   // desktop 10 = today's literal
const ticks = isMobile ? mkTicks(4) : mkTicks(8);  // desktop 8 = today's count
```

### Per-chart pointer→index mapping the hook consumes (heatmap example)
```tsx
// Source: generalization of TimeSeriesChart.tsx:208-217 pixelToIdx + HeatmapPanels.tsx:334-361
function pointerToCell(clientX: number, clientY: number, rect: DOMRect): number | null {
  const vbX = ((clientX - rect.left) / rect.width) * VB_W;   // pixel → viewBox
  const vbY = ((clientY - rect.top) / rect.height) * VB_H;
  const col = Math.floor((vbX - LEFT_GUTTER) / CELL_W);
  const row = Math.floor((vbY - TOP_GUTTER) / CELL_H);
  // ... bounds-check, map to flat index; value read from precomputed prop array ...
  return inBounds ? row * COLS + col : null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-chart inline `<svg viewBox>` recipe | `ResponsiveChartFrame` wrapper | Phase 44 | Wrap all 17; SoT for responsive svg. Several panels already inline the exact style object → swap to the component. |
| `window.innerWidth`/resize state | `useBreakpoint` (`useSyncExternalStore`, SSR-safe) | Phase 44 | No hydration mismatch; server snapshot `desktop`. |
| Recharts `accessibilityLayer={true}` empty focus stops | opt-out everywhere; charts are `role=img` with text alt | DESIGN.md 2026-04-30 | Do NOT add `tabIndex` to non-interactive charts (MonteCarloBandChart). |
| 11px axis ticks | 12px Geist-Mono tabular-nums `#64748B` (4.85:1 AA) | DESIGN.md 2026-04-29 | 12px is the caption-tier floor; the legibility fix raises *effective* px to ≥~12 at 320px. |

**Deprecated/outdated:**
- `e2e/strategy-v2-chart-parity.spec.ts`: dead (`test.skip(true)` ×2, no goldens, Recharts/canvas assertions, wrong route). Leave to Phase 48 — author a fresh spec. [VERIFIED: read header + skip]

## Viewbox-Downscale Legibility Math (Focus Area 3)

> Effective rendered px at a 320px CSS viewport ≈ `declaredFontSize × (320 / VB_W)` for a full-width chart (the SVG scales the whole viewBox to fit the container; at 320px and `preserveAspectRatio meet`, the scale factor is ~`containerCSSpx / VB_W`). Container ≈ 320 minus page padding (~16–32px each side); use ~288px effective container as a realistic floor. Floor = ~12px.

| Chart | VB_W | declared fontSize | scale @288px (288/VB_W) | **effective px** | Below ~12 floor? | Fix |
|-------|------|-------------------|--------------------------|------------------|------------------|-----|
| StreakDistributionPanel | 440 | 9 | 0.65 | **~5.9** | **YES** | mobile fontSize≈18 (→~12 eff) + fewer x-ticks |
| BootstrapCIPanel | 340 | 9 | 0.85 | **~7.6** | **YES** | mobile fontSize≈14–16 |
| EndOfYearBarsPanel | 880 | 10–12 | 0.33 | **~3.3–4.0** | **YES (worst)** | mobile fontSize≈30+ unrealistic in-svg → **HTML overlay labels** likely needed, OR drastically fewer ticks + taller mobile viewBox to raise scale |
| QuantileBoxPlotPanel | 880 | 9–11 | 0.33 | **~3.0–3.6** | **YES** | as above |
| CorrelationStripPanel | 880 | 10–11 | 0.33 | **~3.3–3.6** | **YES** | already in `overflow-x-auto` → keep scroll, larger fontSize, fewer labels |
| CorrelationsMatrixPanel | 880 | 10–11 | 0.33 | **~3.3–3.6** | **YES** | scroll region (exists) + rotate/reduce labels, keep ALL cells (CHART-03) |
| DailyReturnsHeatmap | measured (canvas `scale`) | 8–9 | n/a (CSS-px scaled) | depends on `scale` state | likely YES | canvas already measures; bump label fontSize at mobile |
| SignaturesSection | 880 | 10 | 0.33 | **~3.3** | **YES** | mobile fontSize bump + fewer ticks + taller viewBox |
| CrossSignaturesSection | 880 | 10 | 0.33 | **~3.3** | **YES** | as above |
| HistogramChart | 880 | 10 | 0.33 | **~3.3** | **YES** | as above (legibility only — no tap) |
| MasterBrush | 1100 | 9 | 0.26 | **~2.4 (worst)** | **YES** | tiny strip; bump fontSize, minimal labels |
| ReturnQuantiles | 600 | 10–11 | 0.48 | **~4.8–5.3** | **YES** | wrap in RCF + mobile fontSize bump |
| DailyHeatmap | computed (365 cols) | 12 | very small (wide) | scrolls / canvas | already 12; **scroll region** likely the real fix | keep horizontal scroll; labels at mobile fontSize |
| MonteCarloBandChart | 600 | 12 | 0.48 | **~5.8** | **YES** | mobile fontSize≈18–20 (legibility only — `role=img`) |
| Sparkline | 120 | none (no text) | — | n/a | NO (no text) | likely NO-OP |

**Key insight:** the wide `VB_W=880/1100` panels are the worst offenders (effective ~3px). For those, a pure in-svg fontSize bump to clear 12px effective would require `fontSize ≈ 36` (visually absurd). The realistic fixes are: (1) a **much taller mobile viewBox** (raises the effective scale because `preserveAspectRatio meet` fits the larger of the two ratios — actually width-bound here, so this helps height labels only), (2) **drastically fewer ticks** so each label has room and can be larger, and (3) **HTML-overlay real-px labels** (the locked fallback) for the densest wide panels (EndOfYearBars, the two correlation panels). Executor discretion per the locked decision; the table above flags exactly which panels likely need the overlay vs a font-bump.

## Portrait Strategy (Focus Area 4)

- **Trigger:** `useBreakpoint() === "mobile"` (NOT `orientation`). [locked]
- **Mechanism:** pass a taller `height` to `ResponsiveChartFrame` at mobile; desktop `height` unchanged → desktop golden byte-identical. [locked]
- **Per-panel:** the 880-wide panels (Signatures, CrossSignatures, Histogram, EndOfYearBars, QuantileBoxPlot) get a taller mobile viewBox (e.g. 200→280) paired with fewer ticks + larger fontSize so the chart body and labels both breathe at 320px.
- **Correlation heatmap (CorrelationsMatrixPanel #7):** [locked] keep ALL cells (no row/col drop — a financial no-invented-data invariant). It already renders inside `overflow-x-auto` (`DistributionPanels.tsx:427`). At 320px: keep the scroll region, rotate/reduce the axis labels, bump cell-label fontSize. Do NOT drop strategies from the matrix. CorrelationStripPanel (#6) similarly already has a scroll region.
- **DailyHeatmap (#14):** 365-column calendar — already wide + canvas-measured; the real mobile fix is the horizontal scroll region (exists) + larger labels, not a taller viewBox.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The effective-px downscale formula `fontSize × (containerCSSpx / VB_W)` is the correct model for which panels fall below the legibility floor. | Legibility Math | LOW — the ratio is exact for `preserveAspectRatio meet` width-bound charts; the 288px container is a conservative estimate (real padding may differ ±16px), shifting effective px by <10%. The qualitative "below floor / not" conclusions are robust. |
| A2 | MonteCarloBandChart is best snapshotted as a Vitest component test (synthetic props) rather than via the seeded scenario route. | Pitfall 4 | LOW — verified the seed has 0 positions; option (b) (extend seed) is a documented fallback if a Playwright golden is preferred. |
| A3 | Bumping SVG `fontSize` to clear the floor on the 880-wide panels will require HTML-overlay labels for the densest (EndOfYearBars, correlation panels) rather than an in-svg bump. | Legibility Math | LOW — math shows in-svg bump would need fontSize~36; the locked decision already provides the HTML-overlay fallback. Executor confirms per panel. |
| A4 | The extended target-size chart-tap-rect assertion will run on the SEEDED `/strategy/[id]/v2` route (not a public route), so it belongs in the MA-8 list. | Pitfall 5 / Validation | MEDIUM — depends on whether a public factsheet route (`/browse/[slug]/[strategyId]`) renders a tap-target chart at 320px reliably. If a public route works, the assertion could stay UNSEEDED. Plan-time decision. |

## Open Questions (RESOLVED)

> Resolved at plan time (Phase-47 plans 02/03/04). Recorded here for the formal research-resolution gate.

1. **Does MasterBrush get tap-reveal? — RESOLVED: NO.**
   - It has 5 pointer handlers but they are brush/scrub *drag* (`onPointerDown`→`dragRef`), not a value tooltip; there is NO desktop value-tooltip (it's a range selector).
   - By the binding parity-only gate, no desktop value-reveal ⇒ no tap-reveal. MasterBrush gets **legibility + portrait only** (Plan 02 Task 3 confirms; Plan 03 excludes it).

2. **Sparkline — any work at all? — RESOLVED: NO-OP.**
   - 120×32 inline, no text, no hover, decorative in discovery list rows. No legibility/portrait concern.
   - Plan 04 Task 1 dispositions it as an explicit NO-OP (documented so the chart count reconciles without a phantom task).

3. **Which densest panels need HTML overlay vs in-svg font bump? — RESOLVED: executor discretion (locked).**
   - CONTEXT.md designates this as Claude's Discretion. The Legibility Math table flags the 880-wide candidates that can't clear ~12px effective via in-svg fontSize alone.
   - Plan 02 bakes the desktop golden first, then iterates the mobile branch against the 320px portrait snapshot until the floor is met.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + npm | build/test | ✓ | (repo standard) | — |
| `@playwright/test` | chart goldens + portrait + target-size | ✓ | ^1.59.1 | — |
| Chromium (Playwright) | screenshot goldens | ✓ (installed in CI seeded job) | — | — |
| `vitest` + coverage-v8 | unit + branch coverage | ✓ | ^4.1.2 / ^4.1.5 | — |
| Seeded test Supabase (`E2E_TEST_DB_CONFIGURED`) | seeded MA-8 job (factsheet panel route) | ✓ in CI (repo var) | — | spec self-skips locally without env (FLOW-01 place 2) |
| Next.js docs | AGENTS.md mandate before Next-specific code | ✓ `node_modules/next/dist/docs/` | next ^16.2.3 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Seeded Supabase env is absent locally → the new seeded spec self-skips locally (intended); it runs for real in CI when `E2E_TEST_DB_CONFIGURED == 'true'`.

## Validation Architecture

> `workflow.nyquist_validation: true` (verified in `.planning/config.json`) — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Unit framework | Vitest `^4.1.2` (+ `@vitest/coverage-v8 ^4.1.5`) |
| E2E framework | `@playwright/test ^1.59.1` |
| Coverage config | `vitest.config.ts` (thresholds lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run command | `npx vitest run src/hooks/useTapPin.test.ts` (per-task) |
| Full unit + coverage | `npm run test:coverage` (gate; exit 0 required) |
| E2E seeded run | `npx playwright test e2e/svg-chart-parity.spec.ts` (CI MA-8, seeded) |
| E2E target-size | `npx playwright test e2e/target-size.spec.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHART-01a | Tap reveals + pins the desktop-hover value (touch); re-tap un-pins; survives pointerleave; no auto-dismiss | unit | `npx vitest run src/hooks/useTapPin.test.ts` | ❌ Wave 0 |
| CHART-01a | Tap hit-rect ≥44px at 320px on a chart with tap-reveal (authed `/strategy/[id]/v2`) | e2e | `npx playwright test e2e/target-size.spec.ts` (extend) | ⚠️ extend existing |
| CHART-02 | Axis/label text effective ≥~12px at 320px (legibility floor) | e2e snapshot | `npx playwright test e2e/svg-chart-parity.spec.ts` (320px portrait golden) | ❌ Wave 0 |
| CHART-03 | Desktop render byte-identical (no recompute); mobile taller-aspect portrait | e2e snapshot | `npx playwright test e2e/svg-chart-parity.spec.ts` (desktop golden unchanged) | ❌ Wave 0 |
| CHART-03 | Frozen engine zero-diff | unit | `npx vitest run src/__tests__/phase-31-frozen-spine-guards.test.ts` | ✅ (SCENARIO-05; keep green) |
| CHART-03 | Factsheet byte-identity (scenario tab mounts real FactsheetBody) | unit | BODY-02 guard (existing) | ✅ keep green |
| CHART-03 | compute.ts parity | unit | existing compute parity tests | ✅ keep green |
| all | Coverage ratchet held | unit | `npm run test:coverage` | ✅ (frontend-coverage CI job) |

### Sampling Rate
- **Per task commit:** `npx vitest run <the touched chart's test + useTapPin.test.ts>` (quick, <30s).
- **Per wave merge:** `npm run test:coverage` (full unit + ratchet) + `npx playwright test e2e/svg-chart-parity.spec.ts e2e/target-size.spec.ts` (seeded).
- **Phase gate:** full vitest green + coverage ≥ thresholds + the fresh seeded spec PASSED (not skipped) in a real CI run (FLOW-01 proof) + SCENARIO-05/BODY-02/compute.ts parity green + desktop goldens UNCHANGED.

### Wave 0 Gaps
- [ ] `src/hooks/useTapPin.ts` + `src/hooks/useTapPin.test.ts` — covers CHART-01a tap/pin/toggle/leave branches (ratchet).
- [ ] `e2e/svg-chart-parity.spec.ts` — desktop goldens (no-recompute, CHART-03) + 320px portrait goldens (CHART-02). FLOW-01: add `HAS_SEED_ENV` const + add to `ci.yml:1252` MA-8 list.
- [ ] `e2e/__snapshots__/svg-chart-parity.spec.ts/` — baked goldens (commit once baselined). **Bake desktop goldens BEFORE adding mobile tuning** (Pitfall 2).
- [ ] Extend `e2e/target-size.spec.ts` — chart-tap-rect ≥44px on the tap-reveal charts at 320px (route decision: seeded `/strategy/[id]/v2` → MA-8, or public factsheet route → unseeded).
- [ ] Unit render tests (mobile vs desktop branch) for each tuned chart, or a pure tuning-helper test, to hold branch coverage.

## Security Domain

> Phase 47 is a client-side presentation retrofit with NO new inputs, no auth surface, no crypto, no data writes, no API routes. Charts render read-only from an already-authorized precomputed payload.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | unchanged — charts mount inside already-authed routes |
| V3 Session Management | no | unchanged |
| V4 Access Control | no | RLS/route auth unchanged; this phase adds no data access |
| V5 Input Validation | no (effectively) | only synthetic pointer coordinates → clamped to chart bounds; no user-supplied data parsed |
| V6 Cryptography | no | none |

### Known Threat Patterns for {React 19 SVG charts}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SVG injection via unescaped data in `<text>` | Tampering / XSS | React auto-escapes `<text>{value}</text>`; never `dangerouslySetInnerHTML` for chart labels. No new risk (existing pattern). |
| Empty-focus-stop a11y trap on non-interactive chart | (a11y, not security) | Keep non-interactive charts `role="img"`; do NOT add `tabIndex` (DESIGN.md accessibilityLayer rule). |

**Net:** no new security surface. `security_enforcement` is satisfied by "no new inputs/auth/crypto/data-flow."

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` — tap/pin gesture core (L44–52, 208–217, 219–412), `setPointerCapture`. [reference for `useTapPin`]
- `src/components/ResponsiveChartFrame.tsx` (60 LOC) — viewBox/preserveAspectRatio/style recipe.
- `src/hooks/useBreakpoint.ts` + `src/hooks/useMediaQuery.ts` — SSR-safe breakpoint.
- All 11 in-scope chart files — viewBox dims, fontSize literals, hover/handler inventory (grep + read).
- `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` (L262, 334–433), `HistogramChart.tsx` (L132–209), `AnalyticalPanels.tsx` (L99, panel splits), `DistributionPanels.tsx` (panel splits + scroll regions), `MasterBrush.tsx` (L99–215), `DailyHeatmap.tsx` (L138–195), `ReturnQuantiles.tsx`, `Sparkline.tsx`, `MonteCarloBandChart.tsx`.
- `src/components/charts/chart-tokens.ts` — token SoT + baked ramp + `CHART_TICK_STYLE.fontSize=12`.
- `tests/visual/strategy-v2-type-scale.test.ts` — lint matches className strings only, not SVG fontSize.
- `e2e/strategy-v2-chart-parity.spec.ts` — dead spec (skip ×2, no goldens, wrong route) — confirms Area-4 correction.
- `e2e/helpers/reflow.ts`, `e2e/target-size.spec.ts`, `e2e/reflow-sweep-authed.spec.ts` — verification helpers + seeded-route template + 0-positions caveat.
- `.github/workflows/ci.yml` (L1059 unseeded list, L1252–1290 MA-8 seeded list) — FLOW-01 wiring.
- `src/__tests__/phase-31-frozen-spine-guards.test.ts` — SCENARIO-05 frozen-engine guard.
- `vitest.config.ts` — coverage thresholds; `.planning/config.json` — nyquist on; `package.json` — versions.
- `DESIGN.md` — 12px caption floor, accessibilityLayer rule, baked-ramp/opacity rule, 4-size/2-weight contract.
- `node_modules/next/dist/docs/` (present) — Next 16 docs available per AGENTS.md mandate.

### Secondary / Tertiary
- None required — every claim is verified against the live tree. No WebSearch was needed (no net-new libraries; the domain is the project's own code).

## Metadata

**Confidence breakdown:**
- In-scope enumeration: HIGH — every file grep-verified `recharts=0`, raw `<svg>`, RCF=0; panel exports enumerated; mount points traced.
- Hover inventory (the key correction): HIGH — grep of every handler/`<title>`/state per file; the UI-SPEC's HistogramChart/MasterBrush hover claims are empirically refuted with file:line.
- Legibility math: HIGH (formula) / MEDIUM (exact effective px depends on real container padding, ±~10%) — the below/above-floor conclusions are robust.
- Verification architecture: HIGH — FLOW-01 wiring, seeded-route template, 0-positions caveat, dead-spec status all verified.
- Coverage risk: HIGH — thresholds + measured headroom verified.

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (stable; in-tree code, no fast-moving external deps). Re-verify the chart file set if any panel is added/removed before planning.
