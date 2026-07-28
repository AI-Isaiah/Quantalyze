# Phase 40: Mount the real factsheet body - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

The /allocations Scenario composer renders the REAL `FactsheetBody`
(`src/app/factsheet/[id]/v2/FactsheetView.tsx:156-287` — already a mountable
export, NOT `FactsheetView` which self-wraps a `persist=true` provider) under the
existing `<FactsheetProvider persist={false}>`, fed the COMPLETE
`FactsheetCsvPayload` the Phase-39 adapter now produces, with an additive
`scenarioMode?: boolean` prop. The real `/factsheet/[id]/v2` route, the Discovery
detail page, and the Overview `EquityChartWidget` stay BYTE-IDENTICAL. Every panel
(incl. `next/dynamic` lazy-mounted) renders without crashing across degenerate
blends. The api-only synthetic panels stay absent by construction (ingestSource
"csv"). The `scenario.ts` engine stays FROZEN.

</domain>

<decisions>
## Implementation Decisions

### Body composition (what the composer mounts)
- **REPLACE** the Phase-38 two-chart render (`ScenarioFactsheetChart`'s
  MasterBrush + SCENARIO_EQUITY_CONFIG + SCENARIO_DRAWDOWN_CONFIG) with the real
  `<FactsheetBody>` — it already includes MasterBrush + equity + drawdown via
  `PerformanceCharts` (real `chart-configs.ts` configs). This is the "mount the
  complete factsheet" goal; the scenario-specific configs become unnecessary once
  the full body renders through the real configs.
- `hideHeader={true}` — the composer owns the title; a hypothetical blend has no
  trust tier / markets / AUM / freshness to show in `FactsheetHeader`.
- **`hideFooter={false}` — SHOW the footer** (disclaimer + page stamp), matching a
  real factsheet (USER OVERRIDE of the initial hide recommendation). If the page
  stamp is print-only it naturally won't show on screen; render `FactsheetFooter`
  in the composer mount.
- `hideAllocatorSection={true}` — defensive; it's api-gated anyway
  (`FactsheetView.tsx:275`, ingestSource "api"), so it never renders for the csv
  blend, but pass the flag for intent + belt-and-suspenders.

### scenarioMode additive prop
- Default `false` (BODY-02 locked); the composer passes `scenarioMode={true}`.
- In Phase 40 it gates: **suppress the ControlBar Share-link + Compare-strategies
  actions** (a hypothetical blend isn't a shareable/comparable real strategy);
  keep Display / Reset view / ComparatorPicker. It also **threads to
  `MetricsColumn` as the seam for Phase-42's peer carve-out** (no new visible
  panel in Phase 40).
- Thread surface: `FactsheetBody → ControlBar` (+ `MetricsColumn` seam) ONLY —
  minimal additive threading. Do not thread into KpiStrip/Header this phase.
- The "PROJECTED — hypothetical" framing stays in the **composer chrome** (v1.1.0
  IMPACT-01), NOT inside the body.

### Degenerate states, period control & byte-identity
- **Preserve the composer's Phase-38 PeriodControl** (3M/6M/12M/ALL
  SegmentedControl) above the body (or via the body's `topSlot`); it coexists with
  the body's MasterBrush + ControlBar (both drive the one shared `XRangeContext`).
- **Preserve the Phase-38 blank-slate overlay** for the no-blend / empty-payload
  case; the body renders Phase-39's safe-empty payload (empty arrays) without
  crashing.
- BODY-03 test matrix: **healthy / single-strategy / sub-N-overlap / non-finite**
  blends EACH render every panel — including the lazy heatmaps + (absent-for-csv)
  signature panels — without throwing.
- Byte-identity (BODY-02): a test asserts `FactsheetBody` with default props ≡
  `scenarioMode={false}`; `page.tsx` / the v2 route / the Overview
  `EquityChartWidget` are untouched (the diff touches no `factsheet/[id]/v2/*` file
  beyond the additive `scenarioMode?` + footer-already-existing options). The
  PERMANENT byte-identity gate is Phase 43 (GUARD-02).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FactsheetBody` (FactsheetView.tsx:135-287) — `{ payload } & FactsheetBodyOptions`
  where options = `hideHeader?`, `hideAllocatorSection?`, `hideFooter?`,
  `topSlot?: ReactNode`. Renders FactsheetHeader → topSlot → KpiStrip → SectionNav
  → ControlBar → [MasterBrush + Performance/Distribution/Heatmaps/Stress/Signatures
  /Streaks sections | MetricsColumn] → AllocatorSection → FactsheetFooter.
- `FactsheetProvider` (factsheet-context.tsx:174-196) — `persist?: boolean`
  (default true). `persist={false}` (Phase-38 commit 68bf5e0c) gates BOTH the URL
  ?range/?cmp/?dark write-back (lines 317-342) AND the hydration READ (line 282,
  the RT2 fix) — so the composer mount never bleeds cross-tab state.
- Consumer hooks: `usePayload`, `useXRange`, `useComparator`, `useToggles`,
  `useDisplay`, `useActiveComparator` (split contexts; xRange churn isolated).
- The mount site: `ScenarioComposer.tsx:2219-2263` (currently wraps
  `ScenarioFactsheetChart`'s two charts in `<FactsheetProvider … persist={false}>`).
- `LazyMount` (v2/LazyMount.tsx) — viewport-deferred mount, reserves minHeight;
  used for heatmaps, signatures, allocator section.

### Established Patterns
- ingestSource gating: api-only panels (`PeerPercentilePanel` BatchDPanels.tsx:84,
  `AllocatorSection` FactsheetView.tsx:275, `SignaturesSection`
  SignaturePanels.tsx:42, `CrossSignaturesSection` CrossSignaturePanels.tsx:37) all
  early-return / are conditionally rendered on `ingestSource === "api"`. The
  `FactsheetCsvPayload` type physically lacks those fields → compile-time absent.
- next/dynamic lazy panels: MonthlyReturnsHeatmap / DailyReturnsHeatmap
  (HeatmapPanels.tsx), SignaturesSection, CrossSignaturesSection, AllocatorSection.

### Integration Points
- The Phase-39 adapter `buildScenarioFactsheetPayload` (now single full-res returns
  axis) feeds this body. `ScenarioFactsheetChart.tsx` is the seam: extend its render
  from the two charts to `<FactsheetBody scenarioMode hideHeader hideAllocatorSection
  topSlot={<PeriodControl/>} />` inside the SAME provider.
- Phase 42 will consume the `scenarioMode` thread in `MetricsColumn` for the
  additive `scenarioPeer` carve-out.

</code_context>

<specifics>
## Specific Ideas

- North-star (REQUIREMENTS core value): take the existing factsheet wholesale and
  feed it the blend — the body stays byte-identical, only additive props change.
- BODY-01 explicitly: the REAL `FactsheetBody`, NOT a reimplementation, NOT
  `FactsheetView` (which self-wraps persist=true).

</specifics>

<deferred>
## Deferred Ideas

- The actual peer-percentile panel + `scenarioPeer` carve-out → Phase 42.
- Constituent-correlation diversification panel → Phase 41.
- The permanent byte-identity regression GATE + WCAG-AA axe + toggle fold →
  Phase 43 (GUARD-01..04).

</deferred>
