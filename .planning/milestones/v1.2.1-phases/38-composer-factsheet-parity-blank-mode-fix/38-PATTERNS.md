# Phase 38: Composer factsheet parity + blank-mode fix - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 6 (1 new, 5 modified)
**Analogs found:** 5 / 6 with strong in-repo analogs; 1 (the persistence-suppression seam) has **NO clean analog** — flagged as a planning risk below.

> ⭐ This phase is a **render-swap with zero new packages and a frozen data engine.** The governing
> principle ("the factsheet is the truth — reuse the SAME `TimeSeriesChart`/`MasterBrush` assets,
> not lookalikes") means almost every pattern below is "copy the factsheet's own wiring verbatim."
> The single genuinely-new file is the `buildScenarioFactsheetPayload` pure adapter; everything
> else mirrors an existing analog.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `…/widgets/performance/scenario-factsheet-payload.ts` **(NEW)** | utility (pure adapter) | transform | `src/lib/scenario-blend-panels.ts` | role + flow match (pure date-keyed→derived-series adapter) |
| `…/widgets/performance/scenario-factsheet-payload.test.ts` **(NEW)** | test | transform | `src/lib/scenario-blend-panels.test.ts` | exact (pure-fn unit test) |
| `…/widgets/performance/EquityChart.tsx` **(MODIFY)** | component (chart adapter) | transform / event-driven | `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`PerformanceCharts`) | exact (the provider→chart mount template) |
| `…/widgets/performance/DrawdownChart.tsx` **(MODIFY)** | component (chart) | transform / event-driven | `chart-configs.ts#underwaterAcc` + `TimeSeriesChart.tsx` | role match (moving OFF Recharts → factsheet engine) |
| `…/components/ScenarioComposer.tsx` **(MODIFY)** | component (call site + width) | config | self (existing call sites :2228/:2259, literals :1810/:1860) | exact (in-place edit) |
| `…/AllocationsTabs.tsx` **(MODIFY)** | config (width literal) | config | self (:127 skeleton) | exact |

**Roles/flows in plain terms:**
- The bulk of PARITY-01 is one **pure transform** (`buildScenarioFactsheetPayload`) + **one mount** that copies `FactsheetView`'s `<FactsheetProvider><MasterBrush/><TimeSeriesChart/>` wiring.
- PARITY-02 is **3 one-literal config edits** (no logic).
- PARITY-03 is **one guard edit** mirroring `DrawdownChart.tsx:147` — but see the architectural note: under a full engine swap the legacy guard at `EquityChart.tsx:675` may disappear entirely, so PARITY-03 must be satisfied in **whatever the final render path is**.

---

## Pattern Assignments

### `scenario-factsheet-payload.ts` (NEW — utility, transform)

**Analog:** `src/lib/scenario-blend-panels.ts` (the Phase-30 pure adapter that already bridges the frozen engine's date-keyed `{date,value}[]` into the derived series the factsheet graphs consume).

**Why this analog:** Same job class — a **pure, zero-dependency, no-DOM/no-fetch/no-time** adapter that takes the composer's date-keyed series and emits the shape a factsheet chart expects. Copy its module-doc + LOCKED-convention header style, its degenerate-input collapse rule, and its `DailyPoint` import convention.

**Module header + purity contract to copy** (`scenario-blend-panels.ts:1-37`):
```typescript
// Pure TS, zero dependencies, no fetch / DOM / time. Consumes the frozen
// engine's UNROUNDED `portfolio_daily_returns` ({ date, value }[] …) and derives: …
// Convention pins (LOCKED — see scenario-blend-panels.test.ts): …
//   - Degenerate input (length < window, fewer than MIN_USABLE points, or any
//     non-finite value present) collapses EVERY series to [] / {}.
import type { DailyPoint } from "@/lib/portfolio-math-utils";
```

**The target shape this adapter must emit** is `FactsheetPayload` (`src/lib/factsheet/types.ts:330-449`). Minimum fields `TimeSeriesChart`/`MasterBrush` actually read (everything else gets safe defaults):
| Field | Source | Used by |
|-------|--------|---------|
| `dates: string[]` | canonical union/scenario date axis | x-model (index = position in `dates`) — `TimeSeriesChart`, `MasterBrush`, `setXRange` clamp |
| `strategyEquity: number[]` | `scenarioWealthSeries` (toWealth, index-aligned) | strategy line (`resolveSeries` stratField) **and** `MasterBrush.tsx:49` sparkline |
| `strategyDrawdowns: number[]` | `deriveSnapshotDrawdowns` over scenario | `underwaterAcc` drawdown config (DrawdownChart re-back) |
| `strategyName: string` | "Scenario" (legend label) | `resolveSeries` name |
| `comparators.{btc,spx,none}.cumulative: number[]\|null` | benchmark (`btcWealth`, index-aligned) | comparator line (`resolveSeries` comparatorField:"cumulative") |
| `activeComparator: "btc"\|"spx"\|"none"` | "btc" when benchmark present else "none" | `useActiveComparator` |
| `strategyMetrics: ComputeSummary` | zeroed default (no KpiStrip mounted in composer) | not read by the two charts; needed for type completeness |
| `rollingWindow`/`rollingBetaWindow` | `{enough:false}` default | only read by rolling configs (NOT used here) |
| `strategyWorst10: []`, `strategyReturns: []` | empty defaults | not used by cumulative/underwater configs |

**Benchmark index-alignment pattern to reproduce** (copy from `EquityChart.tsx:586-596` — the existing date→value map the engine swap must preserve):
```typescript
// EquityChart.tsx:593-595 — map benchmark date→value, re-emit aligned to the
// canonical dates[] axis. Missing day → null (TimeSeriesChart.buildPath skips null).
const m = new Map<string, number>();
for (const p of anchored) m.set(p.date, p.value);
return canonicalDates.map((d) => m.get(d) ?? null);
```

**Color/width contract the payload + config must produce** (do NOT hand-roll strokes — `resolveSeries` colors them; `chart-configs.ts:255-284`):
```
strategy line  (scenario blend): color "var(--color-accent)",     width 1.6, opacity 1.0   ← stratField "strategyEquity"
comparator     (benchmark):      color "var(--color-text-muted)", width 1.3, opacity 0.85  ← comparatorField "cumulative"
drawdown line  (underwater):     color "var(--color-negative)",   width 1.0, fill:true     ← stratField "strategyDrawdowns"
```

**Equity + drawdown ChartConfig objects to mount** (mirror `chart-configs.ts` `cumulative` :82-95 and `underwaterAcc` :206-218):
```typescript
const equityCfg: ChartConfig = {
  key: "scenario-equity", title: "Cumulative Returns", valueFormat: "growth",
  scalable: true, defaultScale: "log", baseline: 1,
  stratField: "strategyEquity", comparatorField: "cumulative", rebaseOnZoom: true,
};
const drawdownCfg: ChartConfig = {
  key: "scenario-underwater", title: "Underwater Chart for Accumulated Capital",
  valueFormat: "percent", scalable: false, defaultScale: "linear", baseline: 0,
  height: 160, stratField: "strategyDrawdowns", comparatorField: null, fill: true,
};
```

---

### `scenario-factsheet-payload.test.ts` (NEW — test, transform)

**Analog:** `src/lib/scenario-blend-panels.test.ts` (a LOCKED-convention pure-fn test the adapter's header references by name).

**Pattern to copy:** assert the LOCKED conventions (index-alignment correctness, benchmark missing-day → `null`, degenerate-input collapse, dates axis is canonical). Pure-function tests are high-value coverage that **offsets the projection-memo deletions** (coverage is a blocking CI gate — CLAUDE.md). No render, no DOM — like the analog.

---

### `EquityChart.tsx` (MODIFY — component, the provider→chart mount)

**Analog:** `src/app/factsheet/[id]/v2/FactsheetView.tsx`, specifically `PerformanceCharts` (:303-370) mounted under `FactsheetProvider` (:78-84) — **this is the exact wiring the composer mount must mirror.**

**Provider-wrapping mount pattern to copy** (`FactsheetView.tsx:78-84` + the `MasterBrush`/`TimeSeriesChart` placement at :195 + :351-355):
```tsx
// FactsheetView.tsx:78-84 — provider wraps everything; payload is the only prop.
<FactsheetProvider payload={synthPayload}>
  <MasterBrush />                         {/* draws payload.strategyEquity = scenario */}
  <TimeSeriesChart config={equityCfg} />  {/* scenario (strat) + benchmark (comparator) */}
  <TimeSeriesChart config={drawdownCfg} />{/* Q4: SAME provider ⇒ shared xRange */}
</FactsheetProvider>
```

**`TimeSeriesChart` is context-bound — takes ONLY `config`** (`TimeSeriesChart.tsx:31-35`); it reads everything else from context. This is why the synth payload + provider are mandatory:
```typescript
function TimeSeriesChartInner({ config }: { config: ChartConfig }) {
  const payload = usePayload();                  // throws outside <FactsheetProvider>
  const { xRange, setXRange, resetXRange } = useXRange();
  const { block: cmp, key: cmpKey } = useActiveComparator();
  const series = useMemo(() => resolveSeries(config, payload, cmp, xRange[0]), [config, payload, cmp, xRange]);
}
```

**Q4 shared brush-zoom window** — the entire mechanism is "mount both charts under ONE provider." `useXRange()` returns the single `xRangeValue` (`factsheet-context.tsx:328-331`); pan/zoom on either chart calls the shared `setXRange` and both repaint. **Do NOT lift a parallel range.**

**PARITY-03 blank-slate** — under a full engine swap, the blank-slate path becomes "the synth payload's `strategyEquity` = the scenario wealth (present even with empty live baseline), and there is no live baseline to merge." The legacy guard at `EquityChart.tsx:675` may disappear. If any guard remains, mirror `DrawdownChart.tsx:147` exactly:
```typescript
// WRONG (current EquityChart.tsx:675): bails before scenario is considered
if (equityDailyPoints.length === 0 || composite.length === 0) return null;
// RIGHT (DrawdownChart.tsx:147 pattern): only empty when NEITHER source exists
if (liveDrawdownData.length === 0 && !hasScenario) { /* empty state */ }
//   hasScenario already exists at EquityChart.tsx:507: !!scenarioSeries && scenarioSeries.length > 0
```

**Keep the public Props surface intact** (`EquityChart.tsx:467` `export function EquityChart` + the `EquityChartWidget` default export at :2256-2258). The composer adapter must NOT break `EquityChartWidgetInner` (:1890) — that wrapper feeds the **dashboard Overview**, which is OUT of scope (see Critical Scope Boundary below). Scope the engine swap to the composer mount; do not re-back the Overview widget.

**Keep the 3M/6M/12M/ALL SegmentedControl (Q3):** translate a period click into `setXRange([startIdx,endIdx])` on the shared context (clamping is already handled by `setXRange` at `factsheet-context.tsx:194-205`), replacing the legacy `sliceByPeriod` path. The factsheet has no period buttons — the composer keeps its own and wires them to `setXRange`.

---

### `DrawdownChart.tsx` (MODIFY — component, Recharts → factsheet engine)

**Analog:** `chart-configs.ts#underwaterAcc` (:206-218) rendered through `TimeSeriesChart` — the factsheet's OWN drawdown rendering. The governing principle forbids leaving it on Recharts (and Q4's shared window is impossible while it stays on Recharts — Recharts has no `XRangeContext` binding).

**Currently Recharts** (`DrawdownChart.tsx:9-16` imports `Area, AreaChart, ResponsiveContainer, …`); re-back by feeding the scenario drawdown series into `strategyDrawdowns` on the synth payload + the `underwaterAcc`-style config.

**Preserve the `hasScenario` guard verbatim** (`DrawdownChart.tsx:147` — this is the PARITY-03 reference pattern, must stay green):
```typescript
if (liveDrawdownData.length === 0 && !hasScenario) { /* "No drawdown data available" */ }
```

**Preserve the live-baseline-when-scenario color contract** (`DrawdownChart.tsx:161-163`):
```typescript
const liveStroke = hasScenario ? "var(--color-chart-benchmark)" : CHART_NEGATIVE; // muted when scenario present
const scenarioStroke = "var(--color-chart-strategy)";
```

**Reuse `deriveSnapshotDrawdowns`** (`DrawdownChart.tsx:61` re-export) for the scenario drawdown derivation — identical peak-anchoring; do NOT hand-roll a new peak loop.

**Keep the vestigial `WidgetProps` surface** (`data`/`timeframe`/`width`/`height`) for call-site compatibility (`ScenarioComposer.tsx:2259-2266` passes `data={{}} timeframe="ALL" width={6} height={4}`); the new render reads the synth payload, not `data`.

---

### `ScenarioComposer.tsx` (MODIFY — call sites + width literals)

**Analog:** self (the existing call sites + width literals).

**Width (PARITY-02) — 2 literal edits, no logic:**
```
ScenarioComposer.tsx:1810  className="mx-auto max-w-[1100px] py-12"            → max-w-[1440px]
ScenarioComposer.tsx:1860  className="mx-auto flex max-w-[1100px] flex-col"    → max-w-[1440px]
```
These two are the **binding** constraint (Pitfall 5: `AllocationsTabs.tsx:127` is the loading skeleton; the live `panel-scenario` tabpanel at `AllocationsTabs.tsx:721-739` imposes NO `max-w` of its own — verified).

**Chart call sites** (`ScenarioComposer.tsx:2228` EquityChart, `:2259` DrawdownChart) — the props plumbed today (`equityDailyPoints={baselineEquityDailyPoints}`, `scenarioSeries={scenarioWealthSeries}`, `benchmark={btcWealth}`, `scenarioDailyPoints={scenarioDailyPointsForDrawdown}`) feed the new synth-payload builder. The "PROJECTED — hypothetical" pill (`ScenarioComposer.tsx:1874`) and BTC-benchmark toggle (:2239-2252) stay; do not remove or weaken the honesty pill in blank mode.

---

### `AllocationsTabs.tsx` (MODIFY — width literal)

**Analog:** self (:127).

**Width (PARITY-02) — 1 literal edit:**
```
AllocationsTabs.tsx:127  <div className="mx-auto max-w-[1100px] py-6">  → max-w-[1440px]
```
This is the **loading skeleton** (Pitfall 5) — change it to keep skeleton↔loaded width consistent (no flash-narrow), but the binding constraint is the two `ScenarioComposer` literals above.

---

## Shared Patterns

### Provider-bound charts (the central architectural pattern)
**Source:** `src/app/factsheet/[id]/v2/factsheet-context.tsx` + `FactsheetView.tsx:78-84`
**Apply to:** EquityChart + DrawdownChart composer mount.
`TimeSeriesChart`/`MasterBrush` read all data from React context via `usePayload`/`useXRange`/`useActiveComparator`/`useRegimes` and **throw outside a `<FactsheetProvider>`** (`factsheet-context.tsx:362-364`). Mounting both charts under ONE provider IS the Q4 shared-window mechanism. There is no prop path into these charts — the synth `FactsheetPayload` is the only injection point.

### Series resolution / color mapping
**Source:** `src/app/factsheet/[id]/v2/chart-configs.ts:231-288` (`resolveSeries`)
**Apply to:** both chart configs.
Single-sources the scenario→strategy (accent) / benchmark→comparator (muted) color + width contract. Never inline `stroke=` per series; drive it through `ChartConfig`.

### Index-aligned vs date-keyed bridge
**Source:** `EquityChart.tsx:586-596` (existing benchmark date→value map)
**Apply to:** `buildScenarioFactsheetPayload`.
`TimeSeriesChart` is index-based (`xRange=[startIdx,endIdx]` into `dates`; every series is `values[i]` aligned to `dates[i]`). The composer's series are date-keyed. The adapter must establish ONE canonical `dates[]` axis and project scenario wealth + benchmark onto index-aligned arrays over it (missing day → `null`, dropped by `buildPath`).

### RETURN→WEALTH conversion
**Source:** `toWealth` from `@/lib/scenario` (re-exported `EquityChart.tsx:10`)
**Apply to:** scenario series feeding `strategyEquity`.
Already applied at `ScenarioComposer.tsx:1565`; the branded `WealthPoint` type prevents raw-return misuse. Feed `strategyEquity` with `baseline:1` + `rebaseOnZoom:true` so growth-format reading matches the composer's "+X%" semantics (Pitfall 4).

### Drawdown derivation
**Source:** `deriveSnapshotDrawdowns` (`DrawdownChart.tsx:61`)
**Apply to:** scenario `strategyDrawdowns`. Identical peak-anchoring; reuse, don't re-derive.

### Pure-adapter test convention
**Source:** `src/lib/scenario-blend-panels.test.ts`
**Apply to:** the new `scenario-factsheet-payload.test.ts`. LOCKED-convention assertions, pure-fn, high coverage value.

---

## No Analog Found — PLANNING RISK

| Concern | Why no clean analog | Planner must resolve |
|---------|---------------------|----------------------|
| **Mount `FactsheetProvider` WITHOUT its URL/localStorage persistence** | `FactsheetProvider` (`factsheet-context.tsx:174-358`) has **no `persist`/`disable` flag**. Its URL-write effect (`:293-323`, `window.history.replaceState`) and its `localStorage` round-trip (`:237-246`, key `factsheet-v2:${strategyId}` via `useCrossTabStorage`) **always run**. There is NO existing "provider with persistence suppressed" pattern in the codebase to copy. Mounted naively in the composer, every scenario pan rewrites the allocator's dashboard URL (`?range=…`) and writes a `factsheet-v2:` localStorage blob from the allocations tab. | **This is the #1 correctness risk after test blast radius.** Two seams (both non-trivial), neither has a drop-in analog: (a) **synthesize payload + suppress effects** — pass a scenario-scoped `strategyId` and find a way to gate the two write effects off (no current flag — may force a small additive `persist={false}` prop on `FactsheetProvider`, which touches the "untouched factsheet" file); or (b) **decouple `TimeSeriesChart` from context** — supply a composer-owned `XRangeContext.Provider` with no persistence effects (cleanest for persistence, but edits the factsheet truth file and risks its tests). Research recommends **synthesize (seam 1)** to keep factsheet files byte-identical, but explicitly flags that the persistence-suppression sub-problem may still require a minimal additive prop. **Decide this explicitly before locking the adapter shape.** |

**Secondary (lower-risk) gaps flagged by research, no clean analog but minor:**
- `TimeSeriesChart`'s `ExportMenu` emits `factsheet_v2_chart_export` PostHog events (`factsheet-analytics.ts:23`); reusing it from the composer fires factsheet-named analytics from the allocations tab. Planner decides accept vs no-op. Low risk.
- `MasterBrush` uses viewBox/CSS-responsive width (`preserveAspectRatio`) vs the legacy `EquityChart`'s `ResizeObserver`-measured width (Pitfall 3) — the swap changes the width model from JS-measured to CSS-driven; verify it fills `max-w-[1440px]`. No analog needed, just verification.

---

## Test Pattern Map (blast radius — coverage is a BLOCKING gate)

| Test file | Analog/pattern | Action |
|-----------|----------------|--------|
| `EquityChart.scenario.test.tsx` (410) | self (`makeWealthSeries` helper :27-37, `data-testid="equity-chart-scenario-overlay"` :54) | rewrite render assertions to the `TimeSeriesChart`-backed path; ADD blank-slate case (empty baseline + scenario ⇒ overlay renders, no synthetic baseline, PROJECTED pill, "Equity data warming up" ABSENT) |
| `scenario-factsheet-payload.test.ts` (NEW) | `scenario-blend-panels.test.ts` | new pure-fn coverage to offset deleted projection memo |
| `scenario-shared-window.test.tsx` (NEW) | provider-mount render test | Q4: pan/zoom on equity updates drawdown window (one provider) |
| `composer-width.test.tsx` (NEW or extend) | source-assertion test | 3 literals = `1440`; `AllocationDashboardV2.tsx:157` stays `1100` |
| `DrawdownChart.scenario.test.tsx` (409) | self | Recharts-DOM assertions invalidated by the engine swap; behavioral (scenario renders, blank-slate guard :147) stay valid — keep `hasScenario` regression green |
| `EquityChart.test.tsx` (1021) | self | largest rewrite (legacy SVG projection assertions) — **only if** the composer swap touches the shared render path; verify the Overview `EquityChartWidget` (328-line header test) stays on the legacy render |
| factsheet suites (`factsheet-context.provider.test.tsx`, etc.) | — | MUST stay green; under seam 1 they cannot break (no factsheet file changes); under seam 2 they are the canary |

---

## ⚠️ Critical Scope Boundary (planner must honor)

`EquityChart.tsx` is BOTH the named export `EquityChart` (:467, used by the composer) AND the default-export `EquityChartWidget` (:2256-2258, `EquityChartWidgetInner` :1890, used by the **dashboard Overview** `AllocationDashboardV2` — OUT of scope). **Scope the engine swap to the composer call sites** (`ScenarioComposer.tsx:2228/:2259`) — a new adapter component or a prop-gated render path — so the Overview widget and its 328-line header test stay on the legacy render. Confirm this boundary before writing plan tasks.

---

## Metadata

**Analog search scope:**
- `src/app/factsheet/[id]/v2/` (FactsheetView, TimeSeriesChart, MasterBrush, factsheet-context, chart-configs, factsheet-analytics)
- `src/lib/factsheet/types.ts` (FactsheetPayload / FactsheetCommon / ComparatorBlock shape)
- `src/app/(dashboard)/allocations/widgets/performance/` (EquityChart, DrawdownChart + test suites)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (call sites + width)
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (skeleton + tabpanel) + `AllocationDashboardV2.tsx` (out-of-scope literal)
- `src/lib/scenario-blend-panels.{ts,test.ts}` (pure-adapter analog)

**Files scanned:** ~12 source + 10 test files (enumerated above)
**Pattern extraction date:** 2026-06-25
