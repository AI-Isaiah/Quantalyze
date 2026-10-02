# Phase 38: Composer factsheet parity + blank-mode fix - Research

**Researched:** 2026-06-25
**Domain:** Frontend chart-engine reuse (React/TypeScript SVG charts) — re-backing two composer charts with the factsheet's interactive chart engine, sharing one brush-zoom window, plus a blank-slate render-guard fix and a max-width relaxation.
**Confidence:** HIGH (every claim grounded in the actual repo files — no external packages, no network deps)

<user_constraints>
## User Constraints (from CONTEXT.md)

### ⭐ Governing Principle (overrides all discretion)
The factsheet is the source of truth. A scenario blend is "just another strategy," so the composer's equity + drawdown charts must look **exactly the same** and reuse the **same factsheet assets** (`TimeSeriesChart` + `MasterBrush`) — not lookalikes, not reimplementations. Bias every discretionary call toward "do exactly what the factsheet does, reuse its component."

### Locked Decisions
- **Q1 — Full engine reuse.** Replace the composer `EquityChart`'s custom SVG projection with the factsheet `TimeSeriesChart` + `MasterBrush` as the rendering engine. `EquityChart` becomes a thin adapter that feeds the factsheet chart.
- **Q2 — Preserve scenario overlay + benchmark** by mapping `scenarioSeries` + benchmark onto `TimeSeriesChart`'s comparator/multi-series API. The "PROJECTED — hypothetical" framing + anchoring/tooltip semantics must survive.
- **Q3 — Keep the 3M/6M/12M/ALL SegmentedControl** driving the window, `MasterBrush` refining within it (matches the factsheet's own period + brush coexistence).
- **Q4 — Equity + Drawdown BOTH** get factsheet parity, **sharing one brush-zoom window** (one `XRangeContext` provider wrapping both panels — do NOT lift a parallel range).
- **PARITY-02 — width:** relax `max-w-[1100px]` → literal `max-w-[1440px]` at `ScenarioComposer.tsx:1810` + `:1860` AND `AllocationsTabs.tsx:127`. Whole composer body widens; other tabs/pages stay `1100`.
- **PARITY-03 — blank-slate guard:** mirror `DrawdownChart`'s `hasScenario` guard so an empty baseline still renders the scenario overlay. Scenario-only, no synthetic baseline, "PROJECTED — hypothetical" intact.
- **Frozen `scenario.ts` engine + data path unchanged** — this is a RENDER swap only.

### Claude's Discretion
- Exact adapter seam (wrap `TimeSeriesChart` directly vs a shared composer-side wrapper). Prefer the smallest diff using the SAME `TimeSeriesChart`/`MasterBrush` instances.
- How scenario overlay + benchmark map onto `TimeSeriesChart`'s comparator model (read the factsheet's own usage, mirror it).
- How equity + drawdown share the brush-zoom window (reuse the factsheet's `XRangeContext` mechanism, not a parallel range).
- Whether DrawdownChart reuses a factsheet drawdown rendering or shares `TimeSeriesChart` — follow whatever the factsheet does for its drawdown panel (the factsheet renders drawdown as a `TimeSeriesChart` config: `underwaterAcc`).

### Deferred Ideas (OUT OF SCOPE)
- Changing the factsheet itself (it is the source of truth — untouched, its tests stay green).
- Any data/engine change (render-only phase).
- Other `max-w-[1100px]` pages: `AllocationDashboardV2.tsx:157`, `demo/layout.tsx`, `security/page.tsx`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARITY-01 | Composer equity (and drawdown) chart reuses factsheet `TimeSeriesChart` + `MasterBrush` so wheel-zoom, drag-pan, brush, keyboard nav work as on the factsheet. | Full prop/data-shape contract documented below (§Standard Stack, §Architecture Patterns, §The Coupling Problem). The blocking issue: both components are hard-coupled to `FactsheetProvider` context + the `FactsheetPayload` data shape — the adapter seam must bridge this. |
| PARITY-02 | Composer max width `max-w-[1100px]` → `max-w-[1440px]`. | Exactly 3 in-scope literal sites confirmed by grep; one subtlety: `AllocationsTabs.tsx:127` is the dynamic-import **loading skeleton**, not the binding live wrapper (§Pitfall 5). |
| PARITY-03 | Blank-slate (empty baseline) equity-projection renders the scenario overlay. | Root cause confirmed: `ScenarioComposer.tsx:527-529` feeds `baselineEquityDailyPoints = []` in blank mode → `EquityChart` projection guard `EquityChart.tsx:675` bails before `hasScenario`. Fix mirrors `DrawdownChart.tsx:147`. (§Architecture Patterns Pattern 3.) |
</phase_requirements>

## Summary

This is a **frontend render-swap phase with no external dependencies** — no packages to install, no registries, no network calls. All four "source-of-truth" assets (`TimeSeriesChart`, `MasterBrush`, `factsheet-context`/`XRangeContext`, `chart-configs`) and the two composer charts (`EquityChart`, `DrawdownChart`) already exist in-repo. The research effort went entirely into reading those files to map the exact prop/data-shape contract and surface the central architectural obstacle.

**The central finding (and the crux of this phase):** `TimeSeriesChart` and `MasterBrush` are **not standalone components**. They take almost no props (`TimeSeriesChart` takes only `config: ChartConfig`; `MasterBrush` takes none) and instead read everything from React context via `usePayload()`, `useXRange()`, `useActiveComparator()`, `useRegimes()`. Their series data is resolved by `resolveSeries(config, payload, comparator, xStart)` which keys into a heavyweight, server-computed `FactsheetPayload` shape (`payload.strategyEquity`, `payload[cfg.stratField]`, `comparator[cfg.comparatorField]`, all **index-aligned to `payload.dates`**). The composer has none of this — it has date-keyed `WealthPoint[]`/`DailyPoint[]` series and a calendar-time x-scale. **You cannot "drop `TimeSeriesChart` into the composer" without first giving it a `FactsheetProvider` and a `FactsheetPayload`-shaped object.** Honoring the governing principle ("reuse the SAME asset, not a lookalike") therefore forces one of two seams, both non-trivial — documented in detail below.

**Primary recommendation:** Adapter seam = wrap the composer charts in a **scenario-scoped `FactsheetProvider`** fed a **synthesized minimal `FactsheetPayload`** (or a decoupled provider), so the real `TimeSeriesChart` + `MasterBrush` instances render scenario series through `resolveSeries`. The scenario blend maps to the strategy line (`stratField` slot, accent teal), the benchmark maps to the comparator series (muted slate). Mount equity + drawdown configs inside ONE provider so they share `xRange` (Q4). This is a meaningful build (synthesizing a `FactsheetPayload`, or carving a context-free variant), and its **largest risk is the EquityChart test blast radius (~2,600 lines across 9 suites)** — see §Validation Architecture. PARITY-02 and PARITY-03 are small, surgical, and low-risk by comparison.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Interactive chart rendering (wheel/pan/brush/keyboard) | Browser / Client (`"use client"`) | — | All chart components are client components; SVG + pointer/wheel/keyboard handlers + `ResizeObserver`. No SSR rendering of the interactive surface. |
| Shared brush-zoom window state | Browser / Client (React context) | — | `XRangeContext` in `factsheet-context.tsx` holds `xRange`/`setXRange`/`resetXRange`; every chart + brush subscribe. This is the Q4 shared-window mechanism. |
| Scenario series computation | Frozen engine `@/lib/scenario` (pure) | — | `computeScenario().equity_curve` is the data source — OUT OF SCOPE, untouched. The composer already converts it via `toWealth()`. |
| Series resolution / color mapping | Browser / Client (`resolveSeries`) | — | `chart-configs.ts#resolveSeries` maps `ChartConfig` + payload → `ResolvedSeries[]` (name/values/color/width). The scenario→strategy and benchmark→comparator color contract flows through here. |
| Width / layout container | Browser / Client (Tailwind utility classes) | — | Pure CSS `max-w-[…]` literals; no JS. |
| View-state persistence (URL + localStorage) | Browser / Client (`FactsheetProvider` effects) | — | The factsheet provider persists `range`/`cmp`/toggles to URL + localStorage keyed `factsheet-v2:${strategyId}`. **This is factsheet-specific behavior that must NOT leak into the composer** (§Pitfall 1). |

## Standard Stack

No packages to install. This phase composes existing in-repo modules only.

### Core (existing modules — reuse verbatim where the governing principle demands)
| Module | Path | Purpose | Why Standard |
|--------|------|---------|--------------|
| `TimeSeriesChart` | `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | The canonical interactive chart engine (index-based hand-SVG; wheel/pan/Y-pull/X-pull/keyboard/crosshair/export). | The factsheet "truth" — governing principle mandates reuse. `[CITED: TimeSeriesChart.tsx:31]` takes only `config: ChartConfig`; reads data from context. |
| `MasterBrush` | `src/app/factsheet/[id]/v2/MasterBrush.tsx` | 60px sparkline timeline-overview brush (pan/resize/re-anchor/double-click-reset). | Takes **no props** `[CITED: MasterBrush.tsx:36]`; reads `usePayload()`+`useXRange()`. Bidirectional with charts via context. |
| `FactsheetProvider` / `XRangeContext` / `useXRange` | `src/app/factsheet/[id]/v2/factsheet-context.tsx` | The single shared visible-window state. Mount both charts under ONE provider ⇒ they share one `xRange` (Q4). | `[CITED: factsheet-context.tsx:174,328-331,368]`. Split-context architecture: `Payload`/`XRange`/`Comparator`/`Toggles`/`Regimes`/`Display`. |
| `resolveSeries` / `ChartConfig` / `ResolvedSeries` | `src/app/factsheet/[id]/v2/chart-configs.ts` | Series/comparator data model the scenario + benchmark map onto. | `[CITED: chart-configs.ts:231-288]`. Resolves `payload[cfg.stratField]` + `comparator[cfg.comparatorField]` → `ResolvedSeries[]`. |
| `EquityChart` (composer) | `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` | The chart to re-back. ~2,265 lines; date-keyed `DailyPoint[]`/`WealthPoint[]`, calendar-time x-scale, `firstPositive` anchoring, period slicing, `ResizeObserver`. | The PARITY-01/03 target. Public props are a wide surface that ScenarioComposer + 9 test suites depend on (§Compatibility Risk). |
| `DrawdownChart` (composer) | `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` | The drawdown panel to re-back. **Currently Recharts** (`<AreaChart>`), NOT hand-SVG. | Already holds the correct `hasScenario` guard PARITY-03 mirrors `[CITED: DrawdownChart.tsx:147]`. Re-backing onto `TimeSeriesChart` means moving OFF Recharts. |
| `toWealth` / `WealthPoint` | `@/lib/scenario` (re-exported from `EquityChart.tsx:149`) | Branded RETURN→WEALTH conversion. | `[CITED: EquityChart.tsx:10,149]`. Lives in the pure `@/lib/scenario` module (RSC-safe); the composer already calls it at `ScenarioComposer.tsx:1565-1574`. |

### Supporting (data the composer already has)
| Symbol | Path | Purpose |
|--------|------|---------|
| `scenarioWealthSeries: WealthPoint[]` | `ScenarioComposer.tsx:1565` | Scenario equity in WEALTH form (start ~1.0). Feeds `EquityChart.scenarioSeries` today. |
| `scenarioDailyPointsForDrawdown: DailyPoint[]` | `ScenarioComposer.tsx:1627` | Scenario equity × AUM (USD), feeds `DrawdownChart.scenarioDailyPoints`. |
| `baselineEquityDailyPoints: DailyPoint[]` | `ScenarioComposer.tsx:527-529` | `[]` in blank mode — the PARITY-03 trigger. |
| `btcWealth: DailyPoint[] \| undefined` | `ScenarioComposer.tsx:1020` | Benchmark overlay (cumulative wealth form). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Synthesize a `FactsheetPayload` + reuse `TimeSeriesChart` verbatim | Refactor `TimeSeriesChart` to accept props (decouple from context) | Decoupling edits the factsheet "truth" file — risks its tests (the factsheet contract tests must stay green) and arguably violates "untouched factsheet." Synthesizing a payload keeps the factsheet files literally byte-identical. **Recommend synthesize**, unless the planner finds the payload too lossy. |
| Reuse `TimeSeriesChart` for drawdown via the `underwaterAcc` config | Keep `DrawdownChart` on Recharts, only re-skin | Keeping Recharts violates the governing principle (the factsheet renders drawdown through `TimeSeriesChart` config `underwaterAcc` with `fill:true`, `stratField:"strategyDrawdowns"` `[CITED: chart-configs.ts:206-218]`). Q4 (shared window) is also impossible if drawdown stays on Recharts (Recharts has no `XRangeContext` binding). **Recommend move drawdown onto `TimeSeriesChart`.** |

**Installation:** None. `npm install` adds nothing for this phase.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** external packages. It composes existing first-party modules only. No npm/PyPI/crates additions. slopcheck/registry verification skipped because there are no candidate packages.

| Package | Disposition |
|---------|-------------|
| (none) | No external packages introduced this phase. |

## The Coupling Problem (the crux — read this first)

`TimeSeriesChart` and `MasterBrush` are **context-bound, not prop-driven**:

```typescript
// TimeSeriesChart.tsx:31-35 — takes ONLY config; reads the rest from context
function TimeSeriesChartInner({ config }: { config: ChartConfig }) {
  const payload = usePayload();                       // FactsheetPayload — throws outside provider
  const { xRange, setXRange, resetXRange } = useXRange();
  const regimes = useRegimes();
  const { block: cmp, key: cmpKey } = useActiveComparator();
  ...
  const series = useMemo(() => resolveSeries(config, payload, cmp, xRange[0]), ...); // line 71
```

```typescript
// MasterBrush.tsx:36-38 — takes NO props
export function MasterBrush() {
  const payload = usePayload();
  const { xRange, setXRange, resetXRange } = useXRange();
  ...
  const eq = payload.strategyEquity;   // line 49 — the brush sparkline IS the strategy equity
```

`resolveSeries` keys into the payload by config field name, **index-aligned to `payload.dates`**:

```typescript
// chart-configs.ts:255-266
if (cfg.stratField) {
  const raw = payload[cfg.stratField] as ReadonlyArray<number | null>;  // e.g. strategyEquity
  out.push({ name: ..., values: rebase(raw), color: "var(--color-accent)", width: 1.6, ... });
}
```

**Consequence:** to render the scenario through the REAL `TimeSeriesChart`/`MasterBrush`, you must mount them inside a `FactsheetProvider` whose `payload` has at minimum:
`dates: string[]`, `strategyEquity: number[]`, `strategyName: string`, `strategyDrawdowns: number[]`, a `comparators: { btc, spx, none }` map with the benchmark series in one block, `activeComparator`, `strategyMetrics`, `rollingWindow`/`rollingBetaWindow`, `strategyWorst10`, plus ~30 other `FactsheetCommon` fields `[CITED: types.ts:330-399]`. The chart engine is **index-based** (`xRange` is `[startIdx, endIdx]` into `dates`) while the composer chart is **calendar-time/date-keyed** — so the scenario `WealthPoint[]`/`DailyPoint[]` must be transformed into parallel index-aligned arrays over a single `dates[]` axis before the factsheet engine can consume them.

The two viable seams:

1. **Synthesize a minimal `FactsheetPayload`** (RECOMMENDED). A composer-side builder takes `scenarioWealthSeries` (+ optional baseline + benchmark) and emits a payload object: `dates` = the union/scenario date axis; `strategyEquity` = scenario wealth values index-aligned; benchmark → `comparators.btc.cumulative` (or a synthetic comparator block); unused fields filled with safe defaults (`strategyMetrics` can be a zeroed `ComputeSummary`; rolling arrays can be all-`null`; `strategyWorst10: []`). Then render a scoped `<FactsheetProvider payload={synthPayload}><MasterBrush/><TimeSeriesChart config={equityCfg}/><TimeSeriesChart config={ddCfg}/></FactsheetProvider>`. **Pro:** factsheet files untouched (byte-identical); their tests cannot break. **Con:** building a faithful payload + an index-aligned date axis is the bulk of the work; benchmark date-alignment needs care.

2. **Decouple `TimeSeriesChart` from context** (alternative). Add an optional prop path so the chart accepts `series: ResolvedSeries[]` + an external `xRange` controller instead of reading context. **Pro:** no payload synthesis. **Con:** edits the factsheet truth file — risks the factsheet's own tests and arguably violates "factsheet untouched." If chosen, the factsheet's existing usage must be preserved exactly (context path remains the default).

Either way, **the brush sparkline (`MasterBrush.tsx:49`, `payload.strategyEquity`) will draw the SCENARIO equity** under seam 1 — which is correct (the scenario blend IS the strategy). Under seam 2 the brush would need the scenario series passed similarly.

## Architecture Patterns

### System Architecture Diagram

```
ScenarioComposer (existing data, UNCHANGED engine)
   │  scenarioWealthSeries: WealthPoint[]   (toWealth, ScenarioComposer.tsx:1565)
   │  baselineEquityDailyPoints: DailyPoint[] ([] in blank mode, :527)
   │  btcWealth: DailyPoint[] (benchmark, :1020)
   ▼
┌──────────────────────────────────────────────────────────────┐
│ NEW composer-side adapter: buildScenarioFactsheetPayload(...)  │  ← the bulk of PARITY-01
│   • unify a single dates[] axis                                │
│   • strategyEquity[] = scenario wealth (index-aligned)         │
│   • strategyDrawdowns[] = derived (or fed to ddCfg)            │
│   • comparators.btc.cumulative = benchmark (index-aligned)     │
│   • safe-default the ~30 other FactsheetPayload fields         │
└──────────────────────────────────────────────────────────────┘
   ▼  payload (synthetic, scenario-scoped)
┌──────────────────────────────────────────────────────────────┐
│ <FactsheetProvider payload={synthPayload}>   ← ONE provider    │
│     (Q4: equity + drawdown share this xRange)                  │
│   ├─ <MasterBrush/>            reads payload.strategyEquity     │
│   ├─ <TimeSeriesChart config={equityCfg}/>  scenario+benchmark │
│   └─ <TimeSeriesChart config={drawdownCfg}/> (underwaterAcc)   │
│   provider-side: SUPPRESS the factsheet URL/localStorage       │
│   persistence (see Pitfall 1) — scenario must not write        │
│   factsheet-v2:${id} or ?range= to the URL                     │
└──────────────────────────────────────────────────────────────┘
   ▼
EquityChart (composer) becomes a THIN ADAPTER: it owns the
  "PROJECTED — hypothetical" pill, the 3M/6M/12M/ALL SegmentedControl
  (Q3), the Live/Scenario/Both visibility toggle (if kept), and
  forwards its scenario/benchmark props into the synth payload +
  provider above, rather than running its own SVG projection memo.
```

### Recommended Project Structure
```
src/app/(dashboard)/allocations/
├── components/
│   └── ScenarioComposer.tsx        # width literals :1810/:1860; call sites :2228/:2259
└── widgets/performance/
    ├── EquityChart.tsx             # ← thin adapter (or a new adapter sibling); keep public props
    ├── DrawdownChart.tsx           # ← re-backed onto TimeSeriesChart (off Recharts) for Q4
    └── scenario-factsheet-payload.ts   # NEW: buildScenarioFactsheetPayload() + tests
src/app/factsheet/[id]/v2/          # UNTOUCHED (the truth) — reuse exports only
```

### Pattern 1: Map scenario + benchmark onto the factsheet series model (Q2)
**What:** A blended strategy is "just another strategy," so the scenario maps to the **strategy line** (accent teal) and the benchmark maps to the **comparator** (muted slate) — exactly how `resolveSeries` colors them.
**When:** Building the synthetic payload's chart config + comparator block.
```typescript
// chart-configs.ts:255-284 — the color/width contract you must reproduce:
//   strategy line:  color "var(--color-accent)",      width 1.6, opacity 1.0   ← scenario blend
//   comparator:     color "var(--color-text-muted)",  width 1.3, opacity 0.85  ← benchmark
// Equity chart config (mirror chart-configs.ts cumulative entry):
const equityCfg: ChartConfig = {
  key: "scenario-equity", title: "...", valueFormat: "growth",
  scalable: true, defaultScale: "log", baseline: 1,
  stratField: "strategyEquity",        // ← scenario wealth resolves here
  comparatorField: "cumulative",       // ← benchmark resolves from comparators[active].cumulative
  rebaseOnZoom: true,
};
```

### Pattern 2: One provider for the shared brush-zoom window (Q4)
**What:** Mount equity + drawdown `TimeSeriesChart` instances (and the `MasterBrush`) inside ONE `FactsheetProvider`. They all call `useXRange()`; a pan/zoom on either updates the shared `xRange` and both repaint. Do NOT lift a parallel range.
**When:** Composing the two panels.
```typescript
// factsheet-context.tsx:328-331 — the shared value object both charts read:
const xRangeValue = useMemo(() => ({ xRange, setXRange, resetXRange }), [xRange, setXRange, resetXRange]);
// Mounting both <TimeSeriesChart> under the SAME <FactsheetProvider> is the entire Q4 mechanism.
```

### Pattern 3: PARITY-03 blank-slate guard (mirror DrawdownChart)
**What:** The composer drawdown already renders scenario-only on an empty baseline; equity must match.
**Root cause (confirmed):**
```typescript
// ScenarioComposer.tsx:527-529 — blank mode feeds an empty baseline:
const baselineEquityDailyPoints = useMemo(() => (isBlankMode ? [] : equityDailyPoints), ...);
// EquityChart.tsx:675 — guard bails on empty baseline BEFORE considering scenario:
if (equityDailyPoints.length === 0 || composite.length === 0) return null;   // ← the bug
// vs DrawdownChart.tsx:147 — the correct pattern:
if (liveDrawdownData.length === 0 && !hasScenario) { /* empty state */ }
```
**The fix contract:** only short-circuit when there is **neither** a live baseline **nor** a scenario. `hasScenario` already exists at `EquityChart.tsx:507` (`!!scenarioSeries && scenarioSeries.length > 0`). When `hasScenario`, the chart must proceed and render the scenario overlay only (no synthetic baseline). **Note the architectural interaction:** if EquityChart is re-backed onto `TimeSeriesChart` (PARITY-01), the *legacy* line-675 guard may disappear entirely — the blank-slate path then becomes "the synth payload's `strategyEquity` = the scenario wealth, and there is no live baseline to merge." The planner must ensure PARITY-03 is satisfied **in whatever the new render path is**, not just patch the old guard. If PARITY-01 and PARITY-03 land in separate plans, sequence PARITY-03's test against the FINAL render path.

### Pattern 4: Keep the SegmentedControl driving the window (Q3)
The composer's 3M/6M/12M/ALL control stays. In the factsheet engine, "period" = setting `xRange` to `[startIdx, endIdx]` for the chosen window; `MasterBrush` refines within it via the same `setXRange`. So the adapter translates a period click into `setXRange(...)` on the shared context rather than the legacy `sliceByPeriod` path. (The factsheet itself has no 3M/6M buttons — it uses the brush + URL `range`; the composer keeps its buttons and wires them to `setXRange`, which is the smallest faithful mapping.)

### Anti-Patterns to Avoid
- **Reimplementing the factsheet chart in the composer** (a lookalike). The governing principle forbids it — reuse the actual `TimeSeriesChart`/`MasterBrush` instances.
- **Two separate `xRange` states for equity vs drawdown.** Violates Q4. One provider, one window.
- **Letting the factsheet provider's URL/localStorage persistence run inside the composer** (§Pitfall 1).
- **Leaving DrawdownChart on Recharts** while equity moves to `TimeSeriesChart` — breaks both the governing principle and Q4 (no shared window).
- **Synthetic baseline in blank mode.** PARITY-03 is honest: scenario-only, no fabricated flat line.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive zoom/pan/brush/keyboard | A new pan/zoom handler | The existing `TimeSeriesChart` + `MasterBrush` | Governing principle + they already handle pointer-capture, non-passive wheel `preventDefault`, Y/X gutter pull, tap-to-pin, keyboard nav, export. `[CITED: TimeSeriesChart.tsx:218-470]` |
| Shared window state | A lifted `useState<[number,number]>` | `XRangeContext`/`useXRange` | The factsheet's own mechanism; reusing it IS the Q4 requirement. `[CITED: factsheet-context.tsx:368]` |
| Series color/width mapping | Inline `stroke=` per series | `resolveSeries` via `ChartConfig` | Single-sources the scenario→strategy / benchmark→comparator color contract. `[CITED: chart-configs.ts:231-288]` |
| RETURN→WEALTH conversion | Manual `+1` cumulation | `toWealth()` from `@/lib/scenario` | Branded type prevents raw-return misuse; already used at `ScenarioComposer.tsx:1565`. |
| Drawdown derivation | New peak-anchoring loop | `deriveSnapshotDrawdowns` (`DrawdownChart.tsx:61`) or the factsheet `strategyDrawdowns` array | Already the canonical helper; reuse keeps peak-anchoring identical. |

**Key insight:** Almost nothing should be NEW here except (a) the `buildScenarioFactsheetPayload` adapter that bridges the composer's date-keyed data to the factsheet's index-aligned payload, and (b) the thin wiring that mounts the factsheet components under a scoped provider. The interaction logic, color contract, and persistence are all already solved in the factsheet code.

## Common Pitfalls

### Pitfall 1: Factsheet provider's URL/localStorage persistence leaking into the composer
**What goes wrong:** `FactsheetProvider` writes `?range=…&cmp=…&cb=…` to the URL via `history.replaceState` and persists to `localStorage` key `factsheet-v2:${strategyId}` `[CITED: factsheet-context.tsx:237-323]`. Mounted naively in the composer, it would rewrite the allocator's dashboard URL and write a factsheet-scoped localStorage blob on every scenario pan.
**Why:** The provider was built for a factsheet page where URL/storage round-trip is desired (link-sharing). The composer is a tab in the dashboard — it must not.
**How to avoid:** Either (a) pass a synthetic `strategyId` that is clearly scenario-scoped AND gate the write effects off, or (b) since the persistence is baked into `FactsheetProvider`, prefer a **provider variant or a flag** that disables the URL/localStorage effects for the composer mount. If seam 2 (decouple `TimeSeriesChart`) is chosen, the composer can supply its own `XRangeContext.Provider` without the persistence effects at all — cleanest. **The planner must decide this explicitly**; it is the single biggest correctness risk after the test blast radius.
**Warning signs:** Scenario pan changes the dashboard URL; a `factsheet-v2:` key appears in localStorage from the allocations tab.

### Pitfall 2: Index-aligned vs date-keyed data mismatch
**What goes wrong:** `TimeSeriesChart` is index-based — `xRange = [startIdx, endIdx]` into `payload.dates`, and every series is `values[i]` aligned to `dates[i]` `[CITED: TimeSeriesChart.tsx:140-148, chart-configs.ts:255-284]`. The composer's scenario/benchmark are date-keyed `{date,value}[]` of potentially different lengths/date sets.
**Why:** Two different chart engines with two different x-models.
**How to avoid:** The `buildScenarioFactsheetPayload` adapter must establish ONE canonical `dates[]` axis and project scenario wealth + benchmark onto index-aligned arrays over it (benchmark missing-days → `null`, which `buildPath` skips, `TimeSeriesChart.tsx:1151`). Mirror the existing benchmark date→value map alignment already done at `EquityChart.tsx:593-595`.
**Warning signs:** Benchmark line shifted vs scenario; tooltip date doesn't match the point.

### Pitfall 3: `ResizeObserver`/width measurement differences across engines
**What goes wrong:** Legacy `EquityChart` measures container width via `ResizeObserver` and renders a fixed-pixel `<svg width={width} height={height}>` `[CITED: EquityChart.tsx:483,518-528,1410-1411]`. `TimeSeriesChart` instead uses a fixed viewBox (`880×height`) with `preserveAspectRatio="xMidYMid meet"` + CSS `aspectRatio` and `width:100%` `[CITED: TimeSeriesChart.tsx:564-580]`. Swapping engines changes the width model from JS-measured to CSS-driven.
**Why:** The factsheet chart is viewBox/CSS-responsive; the composer chart is JS-measured.
**How to avoid:** Once re-backed, the composer chart inherits the CSS-responsive model — verify it fills the new `max-w-[1440px]` container correctly. In **jsdom tests**, `ResizeObserver` is undefined (legacy chart falls back to 960, `EquityChart.tsx:519`); the viewBox/CSS model needs no `ResizeObserver`, which is actually simpler to test, but existing tests that asserted a `width={...}` attribute or the 960 fallback will break.
**Warning signs:** Chart letterboxes or doesn't track container width at 1440; width-assertion tests fail.

### Pitfall 4: `toWealth`/anchor semantics must survive the swap
**What goes wrong:** Legacy EquityChart re-anchors everything via `anchorFromFirstPositive` (first positive value → base 1.0) AND a second period-relative re-anchor at the visible window start `[CITED: EquityChart.tsx:267-285, 705-723]`. `TimeSeriesChart` instead uses `rebaseOnZoom` (divide by `series[xStart]` when zoomed) `[CITED: chart-configs.ts:242-252]`. These are different anchoring models.
**Why:** Two engines anchor differently; the "+X% since period start" reading must stay correct.
**How to avoid:** The scenario wealth is already `toWealth`-normalized to start ~1.0 (`ScenarioComposer.tsx:1565-1574`). Feed it to `strategyEquity` with `baseline:1` + `rebaseOnZoom:true` so the factsheet engine's growth-format reading matches the composer's "+X%" semantics. Verify the benchmark anchors to the same base (factsheet does this via the comparator's own `cumulative` series + `rebaseOnZoom`).
**Warning signs:** Scenario line starts at a value other than +0% at window start; benchmark and scenario don't share a common 0% origin.

### Pitfall 5: `AllocationsTabs.tsx:127` is the loading skeleton, not the binding wrapper
**What goes wrong:** The UI-SPEC calls `AllocationsTabs.tsx:127`'s `max-w-[1100px]` "the binding outer constraint." It is actually the `max-w-[1100px]` on the **dynamic-import loading skeleton** for `ScenarioComposer` `[CITED: AllocationsTabs.tsx:119-127]`, shown only while the chunk loads. The live tabpanel (`AllocationsTabs.tsx:681-717` region) does not appear to impose its own `max-w`; the rendered width is bound by `ScenarioComposer.tsx:1810/:1860`.
**Why:** Easy to assume :127 gates the live composer; it gates the skeleton.
**How to avoid:** Still change :127 → `max-w-[1440px]` (keeps skeleton ↔ loaded width consistent, no flash-narrow), but understand the *binding* constraint is the two `ScenarioComposer` literals. Verify in a quick render that the live composer actually widens (don't rely on the skeleton change alone). Confirm no parent tabpanel wrapper re-imposes 1100.
**Warning signs:** Composer still renders at 1100 after the change; only the brief loading flash widened.

### Pitfall 6: SSR / "use client" boundary
**What goes wrong:** `ScenarioComposer` is dynamically imported with `ssr:false` `[CITED: AllocationsTabs.tsx:119-125]`; all chart files are `"use client"`. `toWealth` was deliberately moved to `@/lib/scenario` because a client-module export called during server render throws (`EquityChart.tsx:5-10`).
**Why:** The codebase has been bitten by RSC boundary errors before (see MEMORY: scenario-share #513 — a `"use client"` widget called on the server 500'd in real runtime despite green vitest+build).
**How to avoid:** Keep all new adapter code client-side; do not import the factsheet components or the payload builder into any server component. The factsheet components import `posthog-js` lazily via `factsheet-analytics.ts` (`"use client"`, `[CITED: factsheet-analytics.ts:1`]) — client-safe, but confirms these must stay on the client. Note `trackFactsheetEvent` fires factsheet-named PostHog events (`factsheet_v2_chart_export`, etc.) — reusing `TimeSeriesChart`'s export menu will emit factsheet analytics events from the composer; the planner should decide whether that's acceptable or needs a no-op.
**Warning signs:** A 500 only in real runtime (not in vitest/build) — the classic RSC-boundary signature.

### Pitfall 7: Test blast radius (the dominant schedule/quality risk)
See §Validation Architecture. ~2,600 lines of EquityChart/DrawdownChart tests assert the *current* SVG/Recharts render paths (specific `<path>` shapes, `width=` attributes, `data-testid="equity-chart-scenario-overlay"`, tooltip DOM, narrow-range badge, stale dimmer). Re-backing the render path invalidates many render-shape assertions while leaving the behavioral contract (scenario renders, benchmark renders, blank-slate renders) valid. Plan to **rewrite assertions against the new path**, not delete coverage (coverage is a blocking CI gate).

## Runtime State Inventory

> Not a rename/refactor/migration of stored data — this is a render swap. The categories below are answered for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** No DB/datastore keys change. The frozen `scenario.ts` engine + data path are explicitly unchanged. | None — verified by CONTEXT.md (render-only) + no data-layer files in scope. |
| Live service config | **None.** No external service config. | None. |
| OS-registered state | **None.** | None. |
| Secrets/env vars | **None.** No new env vars. `factsheet-analytics` reuses existing PostHog init (no new key). | None. |
| Build artifacts | **None.** Pure TS/TSX edits; no package/build-output rename. | None. |
| **localStorage / URL view-state (the ONE caveat)** | `FactsheetProvider` persists to `localStorage` key `factsheet-v2:${strategyId}` + URL `?range=…` `[CITED: factsheet-context.tsx:237-323]`. If reused naively in the composer this becomes *new* runtime write behavior on the dashboard. | **Suppress** these writes for the composer mount (Pitfall 1). Not pre-existing state to migrate — state to *prevent creating*. |

## Code Examples

### The benchmark date-alignment pattern to reproduce in the payload builder
```typescript
// EquityChart.tsx:586-596 — map benchmark date→value, re-emit aligned to the visible composite dates.
// The synth payload builder must do the equivalent to index-align the benchmark onto the
// canonical dates[] axis (missing day → null → dropped by TimeSeriesChart's buildPath).
const m = new Map<string, number>();
for (const p of anchored) m.set(p.date, p.value);
return visible.map((p) => m.get(p.date) ?? null);
```

### The exact PARITY-03 guard relationship (the two patterns side by side)
```typescript
// WRONG (current EquityChart.tsx:675): bails before scenario is considered
if (equityDailyPoints.length === 0 || composite.length === 0) return null;
// RIGHT (DrawdownChart.tsx:147 pattern to mirror): only empty when NEITHER source exists
if (liveDrawdownData.length === 0 && !hasScenario) { /* empty state */ }
//   hasScenario already exists at EquityChart.tsx:507
```

### The factsheet drawdown config (what "do what the factsheet does for drawdown" means)
```typescript
// chart-configs.ts:206-218 — the factsheet renders drawdown as a TimeSeriesChart config,
// NOT Recharts. Re-back DrawdownChart by feeding an equivalent config + the scenario
// drawdown series into strategyDrawdowns on the synth payload.
{ key: "underwaterAcc", title: "Underwater Chart for Accumulated Capital",
  valueFormat: "percent", scalable: false, defaultScale: "linear", baseline: 0,
  height: 160, stratField: "strategyDrawdowns", comparatorField: null, fill: true }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Composer charts = bespoke hand-SVG (`EquityChart`) + Recharts (`DrawdownChart`) | Composer charts render through the factsheet `TimeSeriesChart`/`MasterBrush` engine | This phase (38) | Visual + interaction parity; one shared brush-zoom window. |
| Composer used factsheet *chart-token identity* (Phase 30: `--color-chart-strategy`/`--color-chart-benchmark`) | Composer uses factsheet *component* identity (token-parity → component-parity) | Phase 30 → 38 | The convergence completes. |

**Deprecated/outdated after this phase:**
- The legacy `EquityChart` projection memo (the ~400-line SVG path/tick/hover machinery, `EquityChart.tsx:670-1146`) — superseded by `TimeSeriesChart` if the engine swap is full. Keep only what the thin adapter still needs (the PROJECTED pill, the SegmentedControl, the visibility toggle).
- `DrawdownChart`'s Recharts `<AreaChart>` path — superseded by a `TimeSeriesChart` drawdown config.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A minimal synthesized `FactsheetPayload` (with safe-default rolling/metrics/worst10 fields) renders the equity+drawdown configs correctly without `PerformanceCharts`-style relabeling. | The Coupling Problem; Pattern 1 | If `TimeSeriesChart` reads a field we defaulted wrongly (e.g. `config.warmup` vs `payload.rollingWindow`), a panel could mis-render. **Planner: validate the minimal payload against `TimeSeriesChart`'s actual reads before locking the adapter shape.** Mitigated by only using the `cumulative`/`underwaterAcc`-style configs (no rolling/warmup fields). |
| A2 | The factsheet provider's URL/localStorage persistence can be disabled for the composer mount without forking `FactsheetProvider`. | Pitfall 1 | If it can't be cleanly gated, the planner may need a small `FactsheetProvider` prop (e.g. `persist={false}`) — which touches a factsheet file. That is a scope/`untouched-factsheet` tension to resolve at planning. |
| A3 | The live Scenario tabpanel imposes no `max-w` beyond `ScenarioComposer.tsx:1810/:1860` (so :127 is skeleton-only). | Pitfall 5 | If a parent wrapper does impose 1100, the width fix is incomplete. Cheap to verify with a render. |
| A4 | Reusing `TimeSeriesChart`'s `ExportMenu` emitting `factsheet_v2_chart_export` PostHog events from the composer is acceptable. | Pitfall 6 | Minor analytics-hygiene concern; if not acceptable, the export menu needs a config flag or the composer suppresses it. Low risk. |
| A5 | 3M/6M/12M/ALL maps cleanly to `setXRange([startIdx,endIdx])` over the scenario date axis. | Pattern 4 | Edge cases when the scenario history is shorter than 12M (index clamping). The factsheet's `setXRange` already clamps to `MIN_VISIBLE_SAMPLES` (`factsheet-context.tsx:194-205`), so this is low risk. |

## Open Questions

1. **Synthesize payload vs decouple the chart — which seam?**
   - What we know: Both work; synthesize keeps factsheet files byte-identical (tests safe); decouple avoids payload-building but edits the truth file.
   - Recommendation: **Synthesize** (seam 1) to honor "factsheet untouched," UNLESS the payload proves too lossy for the configs — in which case a minimal, additive, default-off `persist`/`series` prop on the factsheet side is the fallback. Decide in `discuss-phase`/planning.
2. **Where does the brush sparkline data come from in blank mode?**
   - What we know: `MasterBrush` draws `payload.strategyEquity` (`MasterBrush.tsx:49`). Under seam 1 that's the scenario wealth — correct, and present even in blank mode (scenario exists). So the brush renders even with an empty live baseline. Good — aligns with PARITY-03.
   - What's unclear: nothing blocking; just confirm the brush isn't empty when only a scenario exists.
3. **Is DrawdownChart's `width`/`height`/`timeframe`/`data` WidgetProps surface still needed** after re-backing (`ScenarioComposer.tsx:2259-2266` passes `data={{}} timeframe="ALL" width={6} height={4}`)?
   - Recommendation: keep the prop signature for call-site compatibility but it becomes vestigial; the new render reads the synth payload, not `data`.

## Environment Availability

> SKIPPED — no external tools, services, runtimes, or CLIs. Pure in-repo TypeScript/React edits. The only "dependency" is the existing test runner (Vitest + jsdom), already present and configured (`vitest.config.ts`).

## Validation Architecture

> nyquist_validation is enabled (config: `workflow.nyquist_validation: true`). This section is the dominant risk surface for the phase.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom (`@testing-library/react`), `@vitest/coverage-v8` |
| Config file | `vitest.config.ts` (`environment: "jsdom"`, coverage thresholds lines 82 / statements 80 / functions 74 / branches 72) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/widgets/performance/` |
| Full suite command | `npm run test` (and `npm run test:coverage` for the CI gate) |

### Coverage gate (BLOCKING — per CLAUDE.md)
Coverage is a **blocking CI gate** (`frontend-coverage` job). Re-backing EquityChart/DrawdownChart **deletes large swaths of currently-covered code** (the projection memo, Recharts path). Two failure modes: (a) deleted code that was covered → ratio shifts; (b) new adapter code uncovered → ratio drops. **Net coverage must not regress below the ratchet.** Plan to add tests for the new `buildScenarioFactsheetPayload` adapter (pure function — easy, high-value coverage) to offset.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PARITY-01 | Composer equity renders through `TimeSeriesChart` (interaction affordances present: SVG `tabIndex=0` + `role="img"` + `aria-describedby` keyboard hint; `MasterBrush` "Master timeline brush" present). | unit (render) | `npx vitest run …/EquityChart.scenario.test.tsx` | ✅ rewrite assertions |
| PARITY-01 | Shared brush-zoom window: pan/zoom on equity updates drawdown's window (one provider). | unit (interaction) | new test under `…/performance/` | ❌ Wave 0 (`scenario-shared-window.test.tsx`) |
| PARITY-01 | Scenario blend = accent-teal strategy line; benchmark = muted comparator (via `resolveSeries`). | unit (render/color) | `…/EquityChart.scenario.test.tsx` | ✅ update |
| PARITY-02 | `ScenarioComposer.tsx:1810/:1860` + `AllocationsTabs.tsx:127` = `max-w-[1440px]`; `AllocationDashboardV2.tsx:157` stays `max-w-[1100px]`. | unit (static/source assertion) | new width test | ❌ Wave 0 (`composer-width.test.tsx`) |
| PARITY-03 | Empty baseline + scenario ⇒ scenario overlay renders; NO synthetic baseline; "PROJECTED — hypothetical" pill present; "Equity data warming up" copy absent. | unit (render) | `…/EquityChart.scenario.test.tsx` + new blank-slate case | ⚠️ partial — ADD blank-slate case |
| PARITY-03 | DrawdownChart blank-slate parity unchanged (regression guard at `DrawdownChart.tsx:147`). | unit | `…/DrawdownChart.scenario.test.tsx` | ✅ keep green |
| (guard) | Factsheet `TimeSeriesChart`/`MasterBrush`/context tests stay green (reuse, not fork). | unit | `npx vitest run src/app/factsheet/` | ✅ must not regress |
| (guard) | Visual/token + a11y contracts stay green. | unit | `npx vitest run tests/visual/chart-accessibility-layer.test.ts` | ✅ must not regress |

### Test-suite blast radius (enumerated — the planner must budget for this)
**Composer charts (will need assertion rewrites — render path changes):**
- `EquityChart.test.tsx` (1,021 lines) — asserts the legacy SVG projection (paths, y-ticks, x-ticks, hover, narrow-range badge, stale dimmer, width fallback). Largest rewrite.
- `EquityChart.scenario.test.tsx` (410) — scenario overlay (`data-testid="equity-chart-scenario-overlay"`, visibility toggle). Core PARITY-01/03 suite.
- `EquityChart.boundary.test.tsx` (52), `EquityChart.tweaks.test.tsx` (165), `EquityChart.v2.test.tsx` (79), `EquityChartWidget.header.test.tsx` (328), `equity-curve.equitydailypoints.test.tsx` — header/widget/boundary paths; the `EquityChartWidget` wrapper (dashboard Overview, NOT composer) must stay green since the dashboard Overview still uses the legacy render unless that path also changes (it does NOT — Overview is out of scope). **⚠️ Verify the engine swap is scoped to the composer mount and does not regress the dashboard `EquityChartWidget`.**
- `DrawdownChart.test.tsx` (84), `DrawdownChart.scenario.test.tsx` (409), `DrawdownChart.boundary.test.tsx` (60) — Recharts→`TimeSeriesChart` change invalidates Recharts-DOM assertions; behavioral assertions (scenario renders, blank-slate) stay valid.
- `ScenarioComposer.test.tsx`, `ScenarioComposer.save.test.tsx`, `AllocationsTabs.scenario-state-preservation.test.tsx`, `AllocationDashboardV2.{staleness,baseline-unknown}.test.tsx` — integration; may assert child chart presence. Re-check after the swap.

**Factsheet suites (must stay GREEN, untouched):** `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx`, `ComparatorPicker.test.tsx`, `factsheet-context.codec.test.ts`, plus `tests/visual/chart-accessibility-layer.test.ts`. Under seam 1 (synthesize payload) these cannot break because no factsheet file changes; under seam 2 (decouple) they are the canary.

### ⚠️ Critical scope question for the planner
**Is the dashboard Overview `EquityChartWidget` in scope, or only the Scenario-tab composer chart?** CONTEXT/UI-SPEC target the **composer** (Scenario tab). The same `EquityChart.tsx` file is ALSO the default export wrapped as `EquityChartWidget`, used by `AllocationDashboardV2` (Overview tab — out of scope). If `EquityChart` is re-backed in place, the Overview widget changes too. **Recommend:** scope the engine swap to the composer call sites (`ScenarioComposer.tsx:2228/:2259`) — e.g. a new adapter component or a prop-gated render path — so the Overview `EquityChartWidget` and its 328-line header test stay on the legacy render. Confirm this boundary before planning tasks.

### Sampling Rate
- **Per task commit:** `npx vitest run` on the touched chart file(s) + the adapter test (`< 30s`).
- **Per wave merge:** full `…/widgets/performance/` + `…/components/` + `src/app/factsheet/` suites.
- **Phase gate:** `npm run test:coverage` green (coverage ratchet held) + factsheet suites green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `…/widgets/performance/scenario-factsheet-payload.test.ts` — covers the new `buildScenarioFactsheetPayload` adapter (pure function; high-value coverage to offset deletions). Required by PARITY-01.
- [ ] `…/widgets/performance/scenario-shared-window.test.tsx` — covers Q4 (one provider ⇒ equity+drawdown share `xRange`).
- [ ] `…/composer-width.test.tsx` (or extend an existing source-assertion test) — covers PARITY-02 (the 3 literals = 1440; the out-of-scope literal stays 1100).
- [ ] Blank-slate render case in `EquityChart.scenario.test.tsx` — empty baseline + scenario ⇒ scenario renders, no synthetic baseline, PROJECTED pill present (PARITY-03).
- [ ] Decide & document: are deleted-projection-memo tests removed or repurposed (coverage impact)?

## Security Domain

> `security_enforcement` not explicitly disabled. This phase is a **client-side render swap with no auth, no input handling beyond pointer/keyboard chart gestures, no network, no data persistence change, no new packages**. The standard ASVS categories largely do not apply.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched. |
| V3 Session Management | no | No session handling. |
| V4 Access Control | no | The Scenario tab's existing access control is unchanged. |
| V5 Input Validation | minimal | Only chart-gesture inputs (wheel/pointer/keyboard) — already clamped in the reused factsheet code (`MIN_VISIBLE`, range clamps). No user-supplied strings rendered unsanitized; series values are numeric and `Number.isFinite`-gated throughout. |
| V6 Cryptography | no | None. |

### Known Threat Patterns for {React client charts}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via chart labels/tooltips | Tampering | Series names/values are numeric or trusted strategy/benchmark names rendered as SVG `<text>` content (React-escaped). No `dangerouslySetInnerHTML` in any chart file. Verified by inspection. |
| localStorage poisoning (factsheet view-state codec) | Tampering | Already hardened in `factsheet-context.tsx` (`stripPoisonKeys`, per-field validation, fail-loud). **But the composer must SUPPRESS this persistence entirely** (Pitfall 1) — so the composer introduces no new localStorage attack surface. |
| URL `?range=` rewrite from a dashboard tab | Tampering (UX) | Suppress the factsheet provider's `history.replaceState` for the composer mount (Pitfall 1). |

## Sources

### Primary (HIGH confidence — read in this session)
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` — full props/API, context reads, interaction handlers, viewBox/CSS responsive model, export menu/analytics.
- `src/app/factsheet/[id]/v2/MasterBrush.tsx` — no-prop, context-bound; draws `payload.strategyEquity`.
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` — `XRangeContext`/`useXRange`, `FactsheetProvider`, URL+localStorage persistence, `setXRange` clamping.
- `src/app/factsheet/[id]/v2/chart-configs.ts` — `ChartConfig`, `resolveSeries`, color/width contract, `cumulative`/`underwaterAcc` configs, `rebaseOnZoom`.
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — provider wiring, `PerformanceCharts` config specialization, `MasterBrush` placement, `max-w-[1440px]` shell.
- `src/lib/factsheet/types.ts` — `FactsheetPayload`/`FactsheetCommon`/`ComparatorBlock` field inventory (the synth-payload shape).
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (full 2,265 lines) — public Props, `hasScenario` (:507), projection guard (:675), `firstPositive` anchor, benchmark alignment (:586-596), scenario overlay render (:1529-1548), `ResizeObserver` width, `EquityChartWidget` default export.
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` — Recharts render, `hasScenario` guard (:147), `deriveSnapshotDrawdowns`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — call sites (:2228/:2259), `scenarioWealthSeries` (:1565), `scenarioDailyPointsForDrawdown` (:1627), `baselineEquityDailyPoints` blank-mode (:527-529), width literals (:1810/:1860).
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — :127 skeleton width, dynamic `ssr:false` import, tabpanel structure.
- `vitest.config.ts` + `CLAUDE.md` — coverage gate / blocking CI.
- `grep` of all `max-w-[1100px]`/`[1440px]` sites + all EquityChart/DrawdownChart test files (blast-radius enumeration).

### Secondary / Tertiary
- None needed — no external/library research required (no packages, frozen engine, in-repo only).

## Metadata

**Confidence breakdown:**
- Standard stack / data-shape contract: HIGH — read every relevant file end-to-end; the coupling and prop contracts are directly cited.
- Architecture (seam choice): HIGH on the *constraint* (context-coupling is a fact), MEDIUM on the *recommended seam* (synthesize-payload is sound but the planner should validate the minimal payload against `TimeSeriesChart`'s reads — A1).
- Pitfalls: HIGH — each grounded in a specific cited line.
- Test blast radius: HIGH — enumerated by file + line count.

**Note on Next.js skill injections:** The harness auto-suggested `next-cache-components` and `react-best-practices` skills on file reads. **Neither applies** — every component here is `"use client"` (no `use cache`, no async `params`/`searchParams`, no Server Components, no data fetching). The `react-best-practices` memoization guidance is already exhaustively applied in the existing code (the files are dense with `useMemo`/`useCallback`/`React.memo` and documented rationale). No action from those injections.

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 (stable — all in-repo; only invalidated if the factsheet chart engine or the composer charts are refactored before planning).
