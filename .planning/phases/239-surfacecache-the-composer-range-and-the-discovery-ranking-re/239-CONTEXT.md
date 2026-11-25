# Phase 239: SURFACECACHE — the composer range and the Discovery ranking reflect the current truth - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

From ROADMAP.md `### Phase 239` (binding): the composer stores its selected range as dates, so a 12M preset always ends on the latest day and keeps the same dates when the series grows at the front (CACHE-02, `201.1-COMPOSER-RANGE-AS-DATES`). CACHE-04 (`164.6.6.2.1-DISCOVERY-RANKING-HONESTY`) is **re-scoped by founder ruling on 2026-11-24** (see below): a BTC-unit strategy and a USD strategy are ranked together as pure performance, with no BTC price conversion; the "in BTC" chip stays.

TODOS entries this phase closes: `201.1-COMPOSER-RANGE-AS-DATES` (CACHE-02) and `164.6.6.2.1-DISCOVERY-RANKING-HONESTY` (CACHE-04, closed by founder ruling). Both are deleted in the ship PR and named in its CHANGELOG entry.

Out of scope: any Discovery copy change; any USD conversion of a native-unit strategy at list time; persisting the range anywhere (Phase 193 D-02 keeps `range` out of `factsheetViewStateCodec`, and that stays). Phase 238 (parallel) owns the `computed_at` reader census in `StrategyTable.tsx` and `queries.ts`; this phase writes only the symbols named below. No migration.

</domain>

<decisions>
## Implementation Decisions

### CACHE-04: BTC-unit and USD returns are ranked together as pure performance (founder ruling, 2026-11-24)
- Q1 (how a BTC-unit strategy ranks beside USD strategies), founder answer verbatim: "That is correct, As BTC Strategies usually just have a different collateral."
- Q2 (percentiles), founder answer verbatim: "This is correct. Inportantly, When comparinh BTC to USaf Strategies. Dont include BTC Price conversion. Just compare pure Performance"
- Reading (coordinator's, confirmed): a BTC-unit strategy's returns are its pure performance on a different collateral. Today's behaviour is correct. Discovery's sort, its `#n` ordinals (`rankOrdinals`) and the percentile cohort (`getPercentiles`, `getOwnRowPercentiles`) keep comparing BTC-unit and USD returns side by side, in one population, with no BTC price conversion and no separate group.
- This overturns the CACHE-04 premise ("never ranks a BTC-unit return beside USD returns as if the two were comparable") and the TODOS gate ("its USD series, or a separate unit bucket … ⛔ Not a close: the chip alone"). CACHE-04 now reads: ranked together as pure performance, by founder ruling; the "in BTC" chip (`ReturnsUnitChip variant="compact"` in `StrategyTable.tsx`) stays.
- No copy changes. Q3 (copy for a separate group) is moot.
- A pin test is added only if it encodes the intended behaviour: no BTC price conversion happens when the Discovery list is built (a native-unit row's return reaches the sort and the percentile cohort unconverted, beside USD rows). It must be able to fail (PROOF-01): neuter by injecting a conversion or a unit partition into a byte copy, see RED, restore with `cp` and `cmp`, see GREEN.

### CACHE-02: presets roll, a manual range keeps its dates (founder ruling, 2026-11-24)
- Q4 (what a preset does when a new latest day arrives), founder answer verbatim: "Presets roll, manual stays (Recommended)". A 3M/6M/12M preset stays relative and always ends on the latest day; a range the user sets by pan, brush, zoom or keyboard keeps its exact start and end dates when the series grows at either end.
- Q5 (what 12M covers), founder answer verbatim: "12 calendar months (Recommended)". It applies to 3M and 6M too: the preset spans latest date minus N calendar months to the latest date, replacing `PERIOD_TRADING_DAYS` (63/126/252 axis points) in `ScenarioFactsheetChart.tsx` `PeriodControl`.

### Claude's Discretion (reversible, decided by the phase agent)
- The range is held as `[startISO, endISO]` dates (or a preset intent for a rolling preset) in `FactsheetProvider` (`src/app/factsheet/[id]/v2/factsheet-context.tsx`, `userRange`) and resolved to axis indices against the active axis each render: start → first index on or after the start date, end → last index on or before the end date. If the stored dates fall off the axis, fall back to the full range, as the shrunk-axis case does today.
- The change is made in the shared provider, so the real factsheet's pan, zoom and brush also keep their dates on growth. No composer-only fork.
- The existing clamps in `setXRange` (three-axis max, `MIN_VISIBLE_SAMPLES`) and the basis-change reset in `FactsheetView` are kept.
- `factsheet-context.provider.test.tsx` "a range the user set is kept when the series grows" (grows at the back, asserts indices) is re-pinned to mean the same dates are kept (founder 2026-11-13 in the TODOS entry), and a new test grows the series at the FRONT and asserts both the manual range's dates and a 12M preset still ending on the latest day (SC-1).
- PROD trigger reading for CACHE-04, taken read-only 2026-11-24 via MCP (marker named PRODUCTION): 2 published strategies, 0 of them native-unit.

</decisions>

<code_context>
## Existing Code Insights

- `src/app/factsheet/[id]/v2/factsheet-context.tsx`: `userRange` (axis indices), `xRange` derivation (`userRange[1] <= maxIdx ? userRange : fullRange`), `setXRange` clamps, `resetXRange`.
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx`: `PeriodControl`, `PERIOD_TRADING_DAYS`.
- Consumers of the provider range: `FactsheetView`, `TimeSeriesChart` (pan/zoom/brush/keyboard), `MasterBrush`, `HistogramChart`, `MetricsColumn`, `basis-context`.
- Tests: `factsheet-context.provider.test.tsx` (growth test, shrunk-axis fallback test), `ScenarioFactsheetChart.opening-range.test.tsx`.
- Discovery: `src/lib/queries.ts` (`native_unit` projection, `shapedNativeUnit`, `getPercentiles`, `getOwnRowPercentiles`), `StrategyTable.tsx` (`result.sort` partitions, `rankOrdinals`, `ReturnsUnitChip`).

</code_context>

<specifics>
## Specific Ideas

- SC-3 PROOF-01 for every gate: RED on pre-fix code or a neutered byte copy with the named arm first, restored by `cp` + `cmp`, GREEN, recorded verbatim in the plan SUMMARY.
- Read DESIGN.md before any UI change; this phase plans none beyond what the preset spans.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
</content>
</invoke>
