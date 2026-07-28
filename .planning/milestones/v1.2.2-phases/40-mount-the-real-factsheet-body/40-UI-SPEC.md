---
phase: 40
slug: mount-the-real-factsheet-body
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-26
---

# Phase 40 — UI Design Contract: Mount the Real Factsheet Body

> Visual and interaction contract for Phase 40. This is a REUSE / CONFORMANCE
> contract — not a redesign. The factsheet body (`FactsheetBody`) is mounted
> byte-identically inside the existing composer chrome. The spec captures the
> composer-mount layout, the `scenarioMode` interaction delta, the degenerate
> state matrix, and the accessibility boundary contract.

---

## Design System

| Property         | Value                                              |
|------------------|----------------------------------------------------|
| Tool             | none (custom token system via `globals.css` `@theme inline`) |
| Preset           | not applicable                                     |
| Component library | Factsheet component family (`src/app/factsheet/[id]/v2/`) — reused unchanged |
| Icon library     | none (all indicators use color + text, no icon library) |
| Font             | Instrument Serif (display) · DM Sans (body/labels) · Geist Mono (numbers/mono) — from DESIGN.md |

Source: DESIGN.md §Typography, §Component Patterns.

---

## Spacing Scale

Declared values — from DESIGN.md §Spacing (base unit 4px):

| Token | Value  | Usage in Phase 40                                      |
|-------|--------|--------------------------------------------------------|
| xs    | 4px    | Icon gaps, badge inline padding                        |
| sm    | 8px    | Compact element spacing, PeriodControl button gaps     |
| md    | 16px   | Default element spacing, card padding (sm screens)     |
| lg    | 24px   | Section padding, `mt-6` mount gap above `FactsheetBody` |
| xl    | 32px   | Layout gaps between composer chrome and body           |
| 2xl   | 48px   | Major section breaks within the factsheet body         |
| 3xl   | 64px   | Page-level spacing (footer top margin `mt-16` = 64px)  |

Exceptions:
- `--space-grid-gap: 10px` — designer-bundle-origin token used inside
  `WidgetGrid` / `BridgeWidget`; does NOT apply to the factsheet or composer
  mount site.
- The factsheet `<article>` uses `px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-12`
  — these are the factsheet's own responsive spacing and are preserved unchanged.
  Do not alter them at the mount site.

Source: DESIGN.md §Spacing, `FactsheetView.tsx:184`.

---

## Typography

All typography is inherited unchanged from the existing `FactsheetBody` and
DESIGN.md. No new type tokens are introduced in Phase 40.

| Role             | Size         | Weight        | Font               | Usage in Phase 40                |
|------------------|--------------|---------------|--------------------|----------------------------------|
| Display / H1     | 28–44px (responsive) | 400 regular | Instrument Serif | Strategy name in `FactsheetHeader` — SUPPRESSED via `hideHeader={true}`; not rendered in composer mount |
| Panel H2 / eyebrow | 12px uppercase tracking-[0.18em] | 600 semibold | Geist Mono | Section eyebrows (`SectionNav` labels, `KpiStrip` labels, `ControlBar` buttons, `FactsheetFooter` stamp) |
| KPI values       | 15–22px (responsive) | 400 regular | Geist Mono tabular-nums | `KpiStrip` metric values |
| Body / caption   | 12px         | 400 regular   | DM Sans            | Panel bodies, captions, disclaimer in `FactsheetFooter` |
| Small / muted    | 10–11px uppercase | 400 regular | DM Sans / Geist Mono | Labels, badges, timestamps, `ControlBar` button copy |
| Warning caveat   | 10px         | 400 regular   | Geist Mono         | `KpiStrip` low-N warning bar (`n < 252` threshold) |

Source: DESIGN.md §Typography, 40-CONTEXT.md §Decisions, `FactsheetView.tsx:419–676`.

---

## Color

All color tokens are inherited from `globals.css` `@theme inline` and consumed
via `var(--color-*)` inside `FactsheetBody`. No new color tokens are introduced.

| Role               | Value     | Usage in Phase 40                                                  |
|--------------------|-----------|--------------------------------------------------------------------|
| Dominant (60%)     | #F8F9FA   | Page background (`--color-page`) — applied by `FactsheetBody` article shell |
| Secondary (30%)    | #FFFFFF   | Card / surface background (`--color-surface`) — `KpiStrip`, panels, `ControlBar` |
| Accent (10%)       | #1B6B5A   | Active `SectionNav` anchor underline, `ComparatorPicker` active state, `ControlBar` focus rings, `DisplayMenu` active badge, `FreshnessChip` fresh dot |
| Positive           | #15803D   | KPI positive tone (gains, CAGR+, Sharpe+), `FreshnessChip` fresh state |
| Negative           | #DC2626   | KPI negative tone (losses, max-DD tint), `FreshnessChip` old state |
| Warning            | #B45309   | `KpiStrip` low-N caveat text, `FreshnessChip` stale state, `CapacityChip` utilization >70% |
| Border             | #E2E8F0   | Panel dividers, `KpiStrip` cell borders, `ControlBar` bottom border |
| Text primary       | #1A1A2E   | KPI values (neutral), heading text                                  |
| Text secondary     | #4A5568   | `PeriodControl` button text (uses `text-text-secondary` — correct token outside factsheet palette scope, per `ScenarioFactsheetChart.tsx:134`) |
| Text muted         | #64748B   | Labels, captions, timestamps, `SectionNav` inactive links, `FactsheetFooter` disclaimer |
| Chart strategy     | #1B6B5A   | Scenario equity curve (accent line)                                 |
| Chart benchmark    | #94A3B8   | BTC benchmark overlay line                                          |
| Surface subtle     | #FBFCFD   | `ControlBar` button backgrounds, `SectionNav` hover, `NotEnoughDataPanel` |

Accent reserved for: active `SectionNav` underline, `ControlBar` / `DisplayMenu`
focus-visible outlines, `DisplayMenu` active-count badge fill, comparator picker
active state, `FreshnessChip` fresh indicator dot.

Source: DESIGN.md §Color, `FactsheetView.tsx` (all `var(--color-*)` usages),
`ScenarioFactsheetChart.tsx:134`.

---

## Mount Layout Contract

### Composer chrome (unchanged from Phase 38)

The composer chrome wraps the body and is NOT part of `FactsheetBody`. These
elements stay in `ScenarioComposer.tsx` above and around the mount:

1. "PROJECTED — hypothetical" framing pill / honesty label (IMPACT-01 from
   v1.1.0) — stays in composer chrome, not pushed into the body.
2. `BTC Benchmark` toggle checkbox + benchmark swatch line — stays in composer
   chrome below the mount.
3. "Illustrative shape only — no live capital connected" `aria-live="polite"` div
   — stays in composer chrome for `scenarioAum <= 0` case.

### FactsheetBody mount (Phase 40 change)

`ScenarioFactsheetChart` is extended to render `<FactsheetBody>` in place of the
Phase-38 two-chart render (`MasterBrush` + `SCENARIO_EQUITY_CONFIG` +
`SCENARIO_DRAWDOWN_CONFIG`). The mount is inside the SAME `<FactsheetProvider
persist={false}>` that already exists in `ScenarioFactsheetChart`.

Props contract:

```
<FactsheetBody
  payload={synthPayload}         // full Phase-39 FactsheetCsvPayload
  hideHeader={true}              // composer owns the title
  hideFooter={false}             // SHOW the footer — user override; FactsheetFooter renders
  hideAllocatorSection={true}    // belt-and-suspenders; never renders for csv anyway
  scenarioMode={true}            // gates ControlBar suppression (see below)
  topSlot={<PeriodControl axisLength={synthPayload.dates.length} />}
/>
```

`topSlot` renders the existing `PeriodControl` (3M/6M/12M/ALL
`SegmentedControl`) from `ScenarioFactsheetChart` above the `KpiStrip`.
It lives inside the provider and drives the shared `XRangeContext`. The
composer's PeriodControl REPLACES the free-floating control that was above the
Phase-38 charts — it moves into `topSlot` so it coexists with the body's
`MasterBrush` and `ControlBar` via the one shared `XRangeContext`.

### Factsheet body section layout (unchanged from `FactsheetBody`)

Render order (top to bottom):

1. ~~`FactsheetHeader`~~ — suppressed (`hideHeader={true}`)
2. `topSlot` (`PeriodControl` 3M/6M/12M/ALL)
3. `KpiStrip` — 7 cells (no comparator) or 9 cells (with comparator); low-N
   warning bar when `n < 252`
4. `SectionNav` — sticky TOC anchor links; suppresses "Signatures" and
   "Allocator" anchors by construction (`ingestSource="csv"`)
5. `ControlBar` — `DisplayMenu` + "Reset view" + ~~"Copy share link"~~ +
   ~~"Compare strategies"~~ + `ComparatorPicker` (see scenarioMode below)
6. `MasterBrush` — scenario equity sparkline + draggable window
7. 2-column layout (`1fr 380px` on lg+):
   - Left column: `PerformanceCharts` → Distribution → Heatmaps (lazy) → Stress
     Windows → ~~Signatures~~ (absent: csv) → Streaks
   - Right column: `MetricsColumn`
8. ~~`AllocatorSection`~~ — absent by construction (`hideAllocatorSection={true}`
   AND `ingestSource="csv"`)
9. `FactsheetFooter` — disclaimer + QSF stamp (`hideFooter={false}`, rendered)

Source: `FactsheetView.tsx:156-287`, 40-CONTEXT.md §Body composition.

---

## scenarioMode Visual Effect (Phase 40 Scope)

`scenarioMode={true}` threads from `FactsheetBody` into `ControlBar` only. In
Phase 40 it gates exactly two suppressions:

| Element              | scenarioMode=false (real factsheet) | scenarioMode=true (composer) |
|----------------------|--------------------------------------|------------------------------|
| "Copy share link" button | Visible                          | HIDDEN — a hypothetical blend is not a shareable real strategy |
| "Compare strategies" `<a>` | Visible (unless share mode)    | HIDDEN — a hypothetical blend is not a comparable real strategy |
| "Display" menu       | Visible                              | Visible (unchanged)          |
| "Reset view" button  | Visible                              | Visible (unchanged)          |
| `ComparatorPicker`   | Visible                              | Visible (unchanged)          |

No new visible panel, no new chrome element. The only visual difference is two
fewer items in the `ControlBar` row.

The `MetricsColumn` receives the `scenarioMode` thread as a seam for Phase 42's
peer carve-out. In Phase 40 it produces NO visible change in `MetricsColumn` —
pass the prop through but make no conditional renders on it there yet.

Source: 40-CONTEXT.md §scenarioMode additive prop.

---

## Degenerate / Blank State Matrix

### No-blend / empty-payload (blank-slate overlay)

When no blend exists (zero strategies composed), the Phase-38 blank-slate overlay
is preserved. This overlay renders ABOVE the `ScenarioFactsheetChart` wrapper
in `ScenarioComposer.tsx`. The `FactsheetBody` itself receives Phase-39's
safe-empty payload (empty arrays, zeroed scalars) and renders without crashing —
but the overlay visually covers it.

Expected visual: the existing blank-slate overlay copy and styling (unchanged
from Phase 38). The body underneath must not throw a React error even when
empty arrays flow through every panel.

### Healthy blend (normal case)

All 7 panels render: `PerformanceCharts`, `Distribution`, `Heatmaps`,
`StressWindows`, `Streaks`, `MetricsColumn`. `KpiStrip` shows real computed
metrics. `MasterBrush` shows the equity curve. `SectionNav` shows 6 anchors
(Performance / Distribution / Heatmaps / Stress / Streaks / Metrics — no
Signatures, no Allocator for csv).

### Single-strategy blend

Renders identically to the healthy case. `KpiStrip` may show low-N caveat bar
if `n < 252`. Rolling metric panels suppress via the existing `!roll.enough`
gate in `PerformanceCharts` and show `NotEnoughDataPanel` copy:

> "Rolling Metrics — Not enough data: Strategy history is too short to compute
> even a 30-day rolling volatility / Sharpe / Sortino..."

### Sub-N-overlap blend

`strategyMetrics.n` is set to the TRUE overlapping-observation count
(PAYLOAD-04). If `n < 252`, the `KpiStrip` warning bar renders:

> "⚠ Only {n} observation{s} — annualized metrics (CAGR, Sharpe, Sortino,
> Calmar, Ann. Vol) may not be statistically significant."

Panels with insufficient data show `NotEnoughDataPanel` inline (not a full
overlay). No panel crashes or shows NaN/Inf.

### Non-finite blend

PAYLOAD-05 guarantees no NaN/Inf reaches panels. Panels that receive safe-empty
values (e.g. empty `monthlyReturns`) render their existing empty panel state —
blank chart area, axis ticks at zero — not a crash or a fabricated metric.
`KpiStrip` formats non-finite values as "—" via the `pct`/`num` formatters
(existing behavior).

### MonthlyReturnsHeatmap / DailyReturnsHeatmap lazy panels

Both are `next/dynamic` with `ssr: false`. They show the `PanelSkeleton`
(animated pulse placeholder, `border border-border bg-surface-subtle`) while
the JS chunk loads, then render their contents once the intersection threshold
fires. For degenerate blends with empty `monthlyReturns` / `dailyReturns`,
the heatmap components render their own empty state (blank grid) — they must
not throw.

Source: 40-CONTEXT.md §Degenerate states, REQUIREMENTS.md BODY-03,
`FactsheetView.tsx:36-61`, `PerformanceCharts()` function.

---

## Accessibility Contract

### WCAG-AA bar

All rendered elements must meet WCAG 2.1 AA. The permanent axe gate (GUARD-03)
is Phase 43; this spec states the contract that Phase 40 must satisfy so Phase 43
has no regressions to fix.

### Landmark / duplicate-landmark guard

The `FactsheetBody` article root is `<article id="factsheet-main" tabIndex={-1}>`.
This is NOT `role="main"`. The allocations dashboard page already has a `<main>`
element in the chrome; mounting `FactsheetBody` inside the composer tab panel
must NOT introduce a second `<main>`. This is the v1.2 JOURNEY-03 class of
landmark bug — it was fixed at root by wrapping in `<div role="region">` instead
of `<main>`. The mount must verify no `<main>` is added.

### No duplicate tablist

The composer's tab bar (the "Scenario" / "Overview" / etc. top-level tabs) is a
`role="tablist"`. The `PeriodControl` is a `role="tablist"` with
`aria-label="Period"`. These must remain siblings or descendants — not nested —
so keyboard navigation is unambiguous. The existing `ScenarioFactsheetChart`
layout places `PeriodControl` inside the `topSlot` above `KpiStrip`, which is
inside the `<article>` body, outside any tab role — acceptable.

Each `PeriodControl` `<button role="tab">` must carry `aria-selected={false}`
(no period is persisted as active — the existing implementation at
`ScenarioFactsheetChart.tsx:125` is correct and must not be removed).

### SectionNav

`<nav aria-label="Factsheet sections">` with anchor `<a>` links. Active anchor
carries `aria-current="location"`. Tab-key navigation must reach each anchor.
The existing `focus-visible:outline-2 focus-visible:outline-offset-1
focus-visible:outline-accent` pattern (accent `#1B6B5A` focus ring) is the focus
indicator and must be preserved.

### ControlBar

`DisplayMenu` uses `<details>` / `<summary>` — keyboard accessible by default
(`Enter` / `Space` opens). Each `DisplayItem` is a `<button aria-pressed={bool}>`.
"Reset view" and (on the real factsheet) "Copy share link" / "Compare strategies"
are `<button type="button">`. In `scenarioMode`, the two suppressed items simply
do not render — no `aria-hidden`, no `disabled` — absence is the correct
treatment for non-applicable actions.

### KpiStrip

`<section>` with no `aria-label` (the strip is visually self-labeling). The
capacity-utilization bar carries `aria-label="Capacity utilization N%"`. Low-N
warning text is visible prose — no need for `aria-live` (it does not change
after mount).

### LazyMount panels

`PanelSkeleton` carries `aria-hidden` (existing implementation). This is correct:
a visual pulse placeholder conveys no semantic information.

### Footer

`<footer>` with disclaimer prose and stamp. This `<footer>` is scoped to the
`<article>`, not the page, so it does not conflict with the page's own footer
landmark.

Source: DESIGN.md §9-State Matrix A11y minimums, MEMORY.md JOURNEY-03 bug class,
`FactsheetView.tsx:53-59` (`PanelSkeleton aria-hidden`), `ScenarioFactsheetChart.tsx:125`
(`aria-selected={false}`).

---

## Byte-Identity Boundary

The following files must not change behavior when `scenarioMode={false}` (the
default):

- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — only additive props added
  (`scenarioMode?: boolean`)
- `src/app/factsheet/[id]/v2/` directory (all panel, context, chart files) —
  unchanged beyond threading `scenarioMode` into `ControlBar` and as a seam into
  `MetricsColumn`
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx`
  — the seam that changes (Phase 40 extends it from two charts to full body)
- Overview `EquityChartWidget` — untouched; no diff

A test (BODY-02) asserts `FactsheetBody` with default props renders identically
to `FactsheetBody scenarioMode={false}`.

The `git diff` for Phase 40 touches no `factsheet/[id]/v2/*` file beyond:
1. `FactsheetBodyOptions` interface — add `scenarioMode?: boolean`
2. `FactsheetBody` — thread `scenarioMode` to `ControlBar` + `MetricsColumn`
3. `ControlBar` — conditional hide of "Copy share link" and "Compare strategies"
   when `scenarioMode={true}`
4. `MetricsColumn` — accept `scenarioMode` prop (no conditional render yet)

Source: REQUIREMENTS.md BODY-02, 40-CONTEXT.md §Byte-identity.

---

## Copywriting Contract

| Element                    | Copy                                                                 |
|----------------------------|----------------------------------------------------------------------|
| Period control label       | "3M" / "6M" / "12M" / "ALL" — unchanged from Phase 38              |
| "PROJECTED — hypothetical" framing | Unchanged from Phase 38 (composer chrome, not body)        |
| "BTC Benchmark" toggle     | Unchanged from Phase 38 (composer chrome, not body)                  |
| Low-N KPI caveat           | "⚠ Only {n} observation{s} — annualized metrics (CAGR, Sharpe, Sortino, Calmar, Ann. Vol) may not be statistically significant." — from `FactsheetBody` `KpiStrip` (unchanged) |
| Rolling not-enough-data    | "Rolling Metrics — Not enough data: Strategy history is too short to compute even a 30-day rolling volatility / Sharpe / Sortino. Rolling charts will appear once the strategy has at least ~35 observations." — from `NotEnoughDataPanel` (unchanged) |
| Footer disclaimer          | "Returns computed from the strategy's daily series. Benchmarks are daily closes (forward-filled to the strategy's observation dates). Risk-free rate set to 0%. Past performance is not indicative of future results. Demo cohorts and demo portfolios are flagged inline; production replaces them with platform data." — from `FactsheetFooter` (unchanged) |
| Footer stamp               | "QSF · {strategyId[0..8].toUpperCase()} · {YYYY.MM.DD}" — from `FactsheetFooter` (unchanged) |
| Empty state (blank-slate overlay) | Unchanged from Phase 38 (composer chrome)                    |
| Illustrative-shape caveat  | "Illustrative shape only — no live capital connected" — unchanged from Phase 38 (composer chrome, `scenarioAum <= 0`) |

No new copy is introduced in Phase 40. All copy is inherited from the existing
`FactsheetBody` or the Phase-38 composer chrome.

---

## Registry Safety

| Registry        | Blocks Used           | Safety Gate     |
|-----------------|-----------------------|-----------------|
| shadcn official | none (not initialized) | not required   |
| third-party     | none                   | not applicable  |

No third-party component registry blocks are used. This phase is pure reuse of
the existing in-repo `FactsheetBody` component family.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

## Summary

Phase 40 is a reuse-and-mount operation, not a redesign. The visual contract is:
mount the existing `FactsheetBody` byte-identically inside the allocations
composer's `<FactsheetProvider persist={false}>`, feeding it the Phase-39
complete payload, with `hideHeader={true}` (composer owns the title),
`hideFooter={false}` (show the real factsheet footer and disclaimer),
`hideAllocatorSection={true}` (csv construction suppresses it anyway), and
`scenarioMode={true}` (which suppresses only the "Copy share link" and "Compare
strategies" ControlBar actions — a hypothetical blend cannot be shared or
compared as a real strategy). The composer's PeriodControl moves into `topSlot`
to coexist with the body's MasterBrush and ControlBar via the single shared
`XRangeContext`. Degenerate blends (empty, single-strategy, sub-N, non-finite)
collapse to existing safe-empty panel states rather than crashing. Accessibility
must not introduce duplicate `<main>` landmarks or nested tablists. Every color,
type, and spacing value conforms to DESIGN.md via the existing `var(--color-*)`
token system already used by `FactsheetBody`.
