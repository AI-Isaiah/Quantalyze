---
phase: 14b
phase_name: "Single-Strategy v2 — Lazy Panels + Trade & Exposure"
status: draft
design_system: manual (no shadcn; project owns DESIGN.md tokens)
gathered: 2026-04-29
inherits_from: ".planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md"
sources:
  - REQUIREMENTS.md (KPI-06..21 + KPI-23b + A11Y-02 + A11Y-03 — 19 REQs)
  - 14B-CONTEXT.md (locked decisions on lazy lifecycle, Trade Mix scope, axe-core integration, keyboard nav, parity diff)
  - 14A-UI-SPEC.md (IDENTITY BASELINE — Pillars 1–6 inherited verbatim)
  - 14A-CONTEXT.md (Phase 14a locked decisions still in force)
  - DESIGN.md (project identity contract — authoritative)
  - src/components/charts/chart-tokens.ts (CHART_TICK_STYLE shipped Phase 14a)
  - src/components/charts/{MonthlyHeatmap,ReturnHistogram,ReturnQuantiles,YearlyReturns,RollingMetrics,CorrelationWithBenchmark}.tsx (reusable assets)
  - src/components/strategy-v2/{StrategyV2Shell,LazyPanelPlaceholder,PartialDataBanner,SegmentedControl}.tsx (Phase 14a — extended/replaced)
  - src/hooks/useLazyPanelMetrics.ts (Phase 14a — fetchOnIntersect flips ON in 14b)
---

# UI-SPEC — Phase 14b: Single-Strategy v2 (Lazy Panels + Trade & Exposure)

> **Design contract for `/strategy/[id]/v2` Panels 4–7 + a11y + parity tests.**
> This phase delivers BODIES for the four lazy-mounted panels (Returns
> Distribution / Rolling / Trade & Position / Exposure & Greeks), wires the
> `useLazyPanelMetrics` hook to real fetches, ships the DailyHeatmap dual
> SVG/Canvas renderer (Pitfall 4), adds axe-core CI on the full route + full
> keyboard navigation across all 7 panels, automates chart-snapshot parity
> diff (Playwright `toHaveScreenshot` ±2%), and flips `strategy.ui_v2`
> default OFF → ON in the final commit.
>
> **IDENTITY INHERITANCE.** This UI-SPEC inherits the entire Phase 14a
> identity baseline VERBATIM. Every spacing token, every typography size /
> weight, every color rule, every copywriting convention from 14A-UI-SPEC §1
> through §10 is in force here without restatement. See §0 below for the
> inheritance contract; §1 is left intentionally blank because the Phase 14a
> Pillars 1–6 are the design system. This document only documents Phase 14b
> ADDITIONS — sub-component layouts inside panels 4–7, the DailyHeatmap
> threshold, lifecycle copy, axe-core test contract, keyboard focus order,
> and parity tolerance.

---

## 0. Inheritance contract

**Phase 14a UI-SPEC is the binding identity baseline for this phase.** The
sections below MUST be applied to every Panel 4–7 component without
re-derivation:

| Inherited from 14A-UI-SPEC | What Phase 14b consumes verbatim |
|---|---|
| §1 Spacing | 4px ladder (`2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`); `p-6` panel padding; `mt-8` (32px) inter-panel gap; `gap-3` (12px) intra-panel cell gap; `min-h-[240px]` panel-shape preservation. NO new spacing tokens. |
| §2 Typography | 4-size scale (12 / 16 / 18 / 32) and 2-weight rule (400 / 600). Forbidden: `font-medium` / `font-light` / `font-bold` / `text-[11px]` / `text-[13px]` / `text-[14px]` / `text-sm` / `text-xl` / `text-2xl`. H3 sub-headings use `text-xs font-normal uppercase tracking-wider text-text-secondary`. Chart axis ticks ALWAYS use `CHART_TICK_STYLE` (Geist Mono 12px tabular-nums #64748B). |
| §3 Color | 60% page (`bg-page` `#F8F9FA`) / 30% surface (`bg-surface` `#FFFFFF`, `border-border` `#E2E8F0`) / 10% accent (`CHART_ACCENT` `#1B6B5A` strategy series only). Benchmark stroke = `CHART_TEXT_MUTED` `#94A3B8` (1px dashed). Negative = `--color-negative` `#DC2626`; Positive = `--color-positive` `#16A34A`. **A11Y-01 forbidden-as-text rule still binding:** `#94A3B8` and `#718096` MUST NEVER appear as `fill` on chart axis text or legend text — `tests/a11y/chart-contrast.test.ts` extended in 14b to cover the 4 new panels. |
| §4 Layout — panel chrome | Every Panel 4–7 card uses `bg-surface` + `border border-border` + `rounded-lg` + `shadow-card` (DESIGN.md card spec) + `p-6` padding + `mt-8` top margin + `min-h-[240px]` floor. The 7-panel `<section data-panel>` hard count is unchanged — 14b replaces panel bodies inside the existing shell. |
| §5 Interaction contracts | `useLazyPanelMetrics` hook contract is locked; 14b only flips `fetchOnIntersect=true`. `<SegmentedControl>` API (Phase 14a) is reused for Panel 5's window toggle; no new component. Empty state = em-dash (`—`); error states route through `src/app/strategy/[id]/v2/error.tsx` (shipped 14a). |
| §6 Component inventory — Phase 14a New | `<StrategyV2Shell>`, `<OverviewPanel>`, `<HeadlineMetricsPanel>`, `<DrawdownPanel>`, `<LazyPanelPlaceholder>`, `<PartialDataBanner>`, `<SegmentedControl>`, `<useLazyPanelMetrics>`. All reused; 14b extends `<StrategyV2Shell>` to mount Panel 4–7 bodies in place of the four `<LazyPanelPlaceholder>` slots. |
| §7 Copywriting — Phase 14a verbatim | Panel-3 copy + Worst-5 empty state + error.tsx copy + segmented control labels for Cumulative/Underwater/Rolling Sharpe/Log Returns. Phase 14b **un-disables** Rolling Sharpe and Log Returns (those bodies now ship — see §3.2 below). |
| §8 Accessibility (A11Y-01) | Chart-axis contrast test extended to 4 new panels. A11Y-02 + A11Y-03 land HERE in 14b — see §6 + §7. |
| §9 Test contract — Phase 14a tests | `tests/a11y/chart-contrast.test.ts`, `tests/visual/strategy-v2-panel-count.test.ts`, `tests/visual/strategy-v2-type-scale.test.ts`, `tests/visual/strategy-v2-tabular-nums.test.ts`, `tests/e2e/strategy-v2-partial-data.spec.ts` — all in force; the type-scale and partial-data specs EXTEND in 14b to cover the new Panel 4–7 components and the 4 history bands × 4 new panels matrix. |
| §10 Identity audit checklist | The 8-box DESIGN-01 checklist (added to PR template in Phase 14a) applies to every chart in panels 4–7 verbatim. |
| §12 DESIGN.md decisions log | UC#7 entry + v2 4-size/2-weight entry stamped Phase 14a; no new DESIGN.md decisions in 14b. |

**Net new identity surface in Phase 14b:** zero. Every visual token, every
type rule, every color rule is identical to 14A. All NEW work in 14b is
sub-component layout WITHIN inherited panel chrome + accessibility
verification + parity testing.

### Notes on top of 14A

- The Phase 14a UI-SPEC's `<SegmentedControl>` contract is reused twice in 14b:
  once for Panel 5's 3M/6M/12M window toggle (panel-level, drives 4 sub-charts),
  and once for the unlock of the Cumulative/Underwater/Rolling Sharpe/Log
  Returns segmented control on Panel 2 (where Rolling Sharpe + Log Returns
  flip from `disabled` to `enabled` because Phase 12 METRICS-03 shipped the
  rolling-greeks series and METRICS-12 shipped the log-returns series — see
  §3.2 below).
- The error-boundary copy is unchanged. `Reload strategy` / `Open v1
  factsheet` continue to be the verb-noun CTAs.
- The `strategy.ui_v2` flag default flips OFF → ON in the final commit of
  14b (after axe-core green + chart-snapshot goldens committed + keyboard
  nav green). See §11.

---

## 1. Spacing — inherited from 14A §1

(See 14A-UI-SPEC §1.) No new tokens. No exceptions.

The following Phase 14b-specific spacing applications use only the inherited
ladder:

| Use | Value | Class |
|---|---|---|
| Panel 4 sub-section spacing (between MonthlyHeatmap / DailyHeatmap / ReturnHistogram / ReturnQuantiles / YearlyReturns) | 24px | `space-y-6` on Panel 4 inner wrapper |
| Panel 4 H3 sub-heading → sub-chart gap | 16px | `mb-4` on the H3 |
| Panel 5 segmented control → first sub-chart gap | 16px | `mb-4` on the panel-level toggle |
| Panel 5 inter-sub-chart gap (Sharpe / Vol / Sortino / α-β stacked) | 24px | `space-y-6` |
| Panel 6 row-to-row gap (Trade Main / Position Main / R-R / Volume rows) | 16px | `space-y-4` (rows are tighter than panels because they are co-located metric strips) |
| Panel 6 row → Trade Mix sub-panel gap | 32px | `mt-8` on the Trade Mix sub-panel (sub-panel is a logical break, not a row) |
| Panel 7 sub-component gap (NetGross / Turnover / Correlation / Greeks) | 24px | `space-y-6` |
| Panel 7 BenchmarkGreeksTable cell padding | 12px | `p-3` per cell (reuses DESIGN.md table-cell density) |

---

## 2. Typography — inherited from 14A §2

(See 14A-UI-SPEC §2.) Sizes 12/16/18/32; weights 400/600; H3 sub-headings
via `text-xs font-normal uppercase tracking-wider`. NO `font-medium`.

Phase 14b H3 sub-heading roster (verbatim copy in §10 below):

- Panel 4: `Monthly heatmap` / `Daily heatmap` / `Return histogram` / `Return quantiles` / `Yearly returns`
- Panel 5: `Rolling Sharpe` / `Rolling volatility` / `Rolling Sortino` / `Rolling alpha & beta`
- Panel 6: `Trade summary` / `Position summary` / `Risk-reward profile` / `Volume metrics` (row-level H3); `Trade mix` (sub-panel H3)
- Panel 7: `Net & gross exposure` / `Turnover` / `Correlation with BTC` / `Benchmark greeks`

All H3s use the inherited 12px DM Sans regular (400) `uppercase
tracking-wider` `text-text-secondary` (`#4A5568`) treatment.

KPI metric values inside Panel 6 rows + Panel 7 Greeks table use the
inherited 18px Geist Mono semibold (600) tabular-nums treatment per 14A §2.
Cell labels (e.g. "Total trades", "Wins", "alpha") use inherited 12px DM
Sans regular `text-text-muted`.

---

## 3. Panel layouts (Phase 14b additions)

This is the section the executor reads while building. All layouts inherit
the 14A panel chrome (white card, `border-border`, `rounded-lg`, `p-6`,
`mt-8` top margin) verbatim — only the BODY is specified here.

### 3.1 Panel 4 — Returns distribution (KPI-06 / KPI-07)

5 sub-components stacked vertically inside a single panel card:

```
┌─────────────────────────────────────────────────────────────────────┐
│  H2: Returns distribution                                          │
│                                                                    │
│  H3: Monthly heatmap                                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <MonthlyHeatmap data={panel4.monthly_returns_grid} />       │ │
│  │  (existing src/components/charts/MonthlyHeatmap.tsx, reused) │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Daily heatmap                                                 │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <DailyHeatmap data={panel4.daily_returns_grid} />           │ │
│  │  (NEW src/components/charts/DailyHeatmap.tsx — see §3.5)     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Return histogram                                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <ReturnHistogram returns={panel4.returns_series}            │ │
│  │      benchmarkReturns={panel4.benchmark_returns} />          │ │
│  │  (existing — verify benchmarkReturns prop at plan-time;      │ │
│  │   if missing, plan a 1-line additive prop, no fork)          │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Return quantiles                                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <ReturnQuantiles data={panel4.return_quantiles} />          │ │
│  │  (existing hand-rolled SVG, reused as-is — no boxplot lib)   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Yearly returns                                                │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <YearlyReturns monthlyReturns={panel4.monthly_returns_grid}/│ │
│  │  (existing, reused as-is)                                    │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Wrapper component:** `<ReturnsDistributionPanel>` at
`src/components/strategy-v2/ReturnsDistributionPanel.tsx`. Client component
(`"use client"` — wraps `useLazyPanelMetrics` for the lifecycle). Receives
`{ strategyId: string, history_days: number | null }` and the lazy-fetched
payload `{ monthly_returns_grid, daily_returns_grid, returns_series,
benchmark_returns, return_quantiles }` once `status === 'ready'`.

**Identity audit reminders for Panel 4:**
- `ReturnHistogram.tsx` currently hardcodes `#059669` and `#DC2626` for bar
  cells (line 56). Phase 14b plan-time decision: REPLACE `#059669` with
  `--color-positive` (`#16A34A`) per DESIGN.md identity. Same 1-line edit
  pattern as `EquityCurve.tsx` Phase 14a accent fix (DESIGN-01).
- `ReturnHistogram` X/Y axis `tick=` props are inline objects today (lines
  39-49). Plan-time: replace `tick={{ fontSize: 10/11, fill: "#64748B" }}`
  with `tick={CHART_TICK_STYLE}` to honor 14A type contract. Asserted by
  the inherited `tests/visual/strategy-v2-tabular-nums.test.ts`.
- `YearlyReturns.tsx` axis ticks currently use 11px / 12px inline objects
  (lines 23-34). Same `CHART_TICK_STYLE` swap.
- `ReturnQuantiles.tsx` uses literal `#0D9488` (lines 61, 64, 68) — that is
  the bright teal from the 14A DESIGN-01 audit list. Replace with
  `CHART_ACCENT` (`#1B6B5A`). Also uses literal `#94A3B8` for whisker
  strokes (lines 52-54) — whiskers are STROKES (not text), so this stays
  per 14A §3 ("Forbidden-as-text" rule applies only to fill on text/legend
  nodes). Verify by grep.
- `MonthlyHeatmap.tsx` cell colors currently use Tailwind `bg-emerald-*` /
  `bg-red-*` neighbors (lines 11-18). DESIGN.md identity says positive =
  `#16A34A`, negative = `#DC2626`. The `bg-emerald-600` ≈ `#059669` is
  near-but-not-identical. Phase 14b plan-time decision: REPLACE the
  Tailwind palette with explicit hex via inline `style={{ backgroundColor }}`
  OR introduce a 3-step color-scale helper that maps |val| → opacity over
  `#16A34A` / `#DC2626`. Planner's discretion; documented as a DESIGN-01
  audit item.

### 3.2 Panel 5 — Rolling metrics (KPI-08 / KPI-09 / KPI-10 / KPI-11)

Single shared 3M / 6M / 12M window toggle drives all 4 sub-charts:

```
┌─────────────────────────────────────────────────────────────────────┐
│  H2: Rolling metrics                                                │
│                                                                    │
│  ┌─3M─┐ ┌─6M ▾─┐ ┌─12M─┐    (segmented control, 6M default-active)  │
│                                                                    │
│  H3: Rolling Sharpe                                                │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <RollingSharpeChart data={panel5.rolling_sharpe[window]}    │ │
│  │      benchmarkData={panel5.btc_rolling_sharpe?.[window]} />  │ │
│  │  (existing src/components/charts/RollingMetrics.tsx adapted) │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Rolling volatility                                            │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <RollingVolatilityChart data={panel5.rolling_volatility[w]}/│ │
│  │  (NEW wrapper — uses Recharts Line with CHART_ACCENT)        │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Rolling Sortino                                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <RollingSortinoChart data={panel5.rolling_sortino[w]} />    │ │
│  │  (NEW wrapper — single line, CHART_ACCENT)                   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Rolling alpha & beta                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <RollingAlphaBetaChart                                      │ │
│  │      alpha={panel5.rolling_alpha[w]}                         │ │
│  │      beta={panel5.rolling_beta[w]} />                        │ │
│  │  (NEW wrapper — 2 lines: alpha=CHART_ACCENT, beta=muted +    │ │
│  │   strokeDasharray=CHART_REFERENCE_DASH; legend at top)       │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Wrapper component:** `<RollingMetricsPanel>` at
`src/components/strategy-v2/RollingMetricsPanel.tsx`. Owns the `window`
state (`90 | 180 | 365` — corresponding to 3M / 6M / 12M labels);
default = `180` (6M). Threads `window` as a prop into all 4 sub-charts.

**Window toggle:** REUSE the Phase 14a `<SegmentedControl>` component
verbatim. Three buttons (`3M` / `6M` / `12M`); none are disabled (all 3
windows shipped Phase 12 METRICS-02 / METRICS-03). Active button styling
is the inherited 14A spec.

**Panel 2 segmented control unlock (DOWNSTREAM CHANGE):** Phase 14a left
`Rolling Sharpe` and `Log returns` buttons in Panel 2 in the disabled
state. Phase 14b ENABLES both:
- `Rolling Sharpe` → mounts `<RollingMetrics>` reusing the existing
  component with `data={panel5.rolling_sharpe.window_180}` (or whatever
  the Panel 2 segmented control resolves to — Panel 2 keeps a fixed
  90-day window for the Rolling Sharpe view to mirror v1).
- `Log returns` → mounts a NEW thin wrapper that re-renders the
  `<EquityCurve>` (or a sibling component) with the log-returns series
  from `panel2Equity.log_returns_series` (Phase 12 METRICS-12).
- Disabled-state styling is REMOVED for both buttons; tooltip
  `Available in Phase 14b` is REMOVED. Buttons receive the same
  active/inactive treatment as Cumulative/Underwater per 14A §5.2.
- Update `<HeadlineMetricsPanel>` to wire the 2 newly enabled buttons
  through to their respective renderers.

### 3.3 Panel 6 — Trade & position (KPI-12 through KPI-17)

4 metric rows + 1 sub-panel for Trade Mix:

```
┌─────────────────────────────────────────────────────────────────────┐
│  H2: Trades & positions                                             │
│                                                                    │
│  H3: Trade summary                                                 │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┐                       │
│  │ Total│ Long │ Short│ Wins │Losses│ Win% │   (6 metric cells)    │
│  └──────┴──────┴──────┴──────┴──────┴──────┘                       │
│                                                                    │
│  H3: Position summary                                              │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┐                       │
│  │ Open │Closed│ Long │ Short│ Win% │AvgDur│   (6 metric cells)    │
│  └──────┴──────┴──────┴──────┴──────┴──────┘                       │
│                                                                    │
│  H3: Risk-reward profile                                           │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐                │
│  │ R:R  │WR:R  │ PF   │PayOff│ LngPF│ShtPF │ Exp  │ (7 cells)      │
│  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘                │
│  ┌─────────┐                                                       │
│  │  SQN    │ (1 cell, full-row width OR right-aligned mini-strip)  │
│  └─────────┘                                                       │
│                                                                    │
│  H3: Volume metrics                                                │
│  ┌────────────┬────────────┬────────────┬────────────┐             │
│  │ Gross vol  │Mean trade $│Daily turn  │Mthly turn  │             │
│  └────────────┴────────────┴────────────┴────────────┘             │
│                                                                    │
│  H3: Trade mix          (sub-panel, mt-8 break)                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  Long entries:  ████████████████ 64%   (1,247 fills)        │ │
│  │  Short entries: ██████████ 36%         (701 fills)          │ │
│  │  (2-bucket only — maker/taker descoped to v0.17.1)          │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Wrapper component:** `<TradeAndPositionPanel>` at
`src/components/strategy-v2/TradeAndPositionPanel.tsx`. Receives the
lazy-fetched payload `{ trade_metrics, position_metrics, volume_metrics,
trade_mix }`. Trade Mix sub-panel is `<TradeMixSubPanel>` at
`src/components/strategy-v2/TradeMixSubPanel.tsx`.

**Metric cell pattern (rows of 4-7 cells):**
- Cell label: 12px DM Sans regular `text-text-muted` (`#718096`) —
  uppercase tracking-wider OPTIONAL but recommended for visual rhythm
  with H3s. Planner's discretion.
- Cell value: 18px Geist Mono semibold tabular-nums `text-text-primary`
  (`#1A1A2E`).
- Missing value: render `—` (em-dash) — same Phase 14a empty-state rule.
- Negative value (e.g. negative R:R, negative SQN): cell value rendered
  in `--color-negative` (`#DC2626`). Positive values that cross a
  meaningful threshold (PF > 1, SQN > 1.7) MAY use `--color-positive` —
  planner's discretion. Default is `text-text-primary` (no color
  encoding) to keep the strip restrained.
- Cell layout: `grid grid-cols-{N} gap-3` (12px gap) — N = number of
  cells in the row. No internal borders between cells (DESIGN.md "data
  density > card density" — single-panel multi-cell, not stacked cards).
  Border BETWEEN H3 sub-rows uses `border-t border-border` hairline +
  `pt-4 mt-4` rhythm.
- All cells are wrapped in a `<dl>` with `<dt>` (label) + `<dd>` (value)
  pairs per A11Y semantic-HTML rule (14A §8).

**SQN placement decision:** 1 cell labeled `SQN`. Planner's discretion
whether it sits as a 7th cell on the Risk-Reward row (mathematically
related) or as a standalone right-aligned mini-strip below the RR row.
Recommendation: 7th cell on the RR row for layout economy.

**Trade Mix sub-panel (`<TradeMixSubPanel>`):**

| Element | Spec |
|---|---|
| Container | `mt-8 border-t border-border pt-6` (visual break from row strips above) |
| H3 | `Trade mix` (uppercase tracking-wider 12px) |
| Bucket bar | 2 horizontal bars stacked: Long entries / Short entries |
| Bar fill color | Long = `CHART_ACCENT` (`#1B6B5A`); Short = `CHART_TEXT_MUTED` (`#94A3B8`). Both 1px stroke, no inner border. |
| Bar label (left) | 12px DM Sans regular `text-text-muted` — `Long entries` / `Short entries` |
| Bar value (right) | 18px Geist Mono semibold tabular-nums — `64%` (1,247 fills) — bucket percentage + raw count in parens at 12px regular muted. |
| Bar height | 24px (`h-6`) — taller than typical progress bar so the percentage label sits comfortably inside or beside. |
| Empty state | Render heading + "Trade mix unavailable for this strategy." in 12px regular muted, mirror partial-data banner pattern. |
| 4-bucket maker/taker mode | NOT shipped in 14b. The `<TradeMixSubPanel>` component MUST be authored with a feature flag prop `mode: '2-bucket' | '4-bucket'` defaulting to `'2-bucket'`. The 4-bucket variant is documented but not implemented. v0.17.1 flips the prop. |

**Trade Mix copy:** `Long entries` / `Short entries` (verbatim — title-case
nouns matching the Phase 14a sentence-case copy convention). Maker/taker
labels deferred.

### 3.4 Panel 7 — Exposure & benchmark greeks (KPI-18 / KPI-19 / KPI-20 / KPI-21)

4 sub-components stacked:

```
┌─────────────────────────────────────────────────────────────────────┐
│  H2: Exposure & benchmark greeks                                    │
│                                                                    │
│  H3: Net & gross exposure                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <NetGrossExposureChart                                      │ │
│  │      data={panel7.exposure_series} /> (NEW)                  │ │
│  │  (Recharts area chart; gross=CHART_ACCENT @opacity=0.2 fill, │ │
│  │   net=CHART_ACCENT solid line; height=240)                   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Turnover                                                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <TurnoverChart data={panel7.turnover_series} /> (NEW)       │ │
│  │  (Recharts line; CHART_ACCENT 1.5px; height=200)             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Correlation with BTC                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  <CorrelationWithBenchmark analytics={panel7.analytics} />   │ │
│  │  (existing — reused as-is; verify CHART_TICK_STYLE swap)     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  H3: Benchmark greeks                                              │
│  ┌──────┬──────┬──────┬──────┐                                     │
│  │alpha │ beta │  IR  │treyn │   (4 metric cells, full-width)     │
│  └──────┴──────┴──────┴──────┘                                     │
│  (<BenchmarkGreeksTable> — NEW; layout discretion: 4-cell strip    │
│   horizontal OR 2x2 grid. Same metric-cell pattern as Panel 6.)    │
└─────────────────────────────────────────────────────────────────────┘
```

**Wrapper component:** `<ExposureAndGreeksPanel>` at
`src/components/strategy-v2/ExposureAndGreeksPanel.tsx`. Receives the
lazy-fetched payload `{ exposure_series, turnover_series, analytics,
benchmark_greeks: { alpha, beta, ir, treynor } }`.

**`<NetGrossExposureChart>`** (NEW):
- File: `src/components/charts/NetGrossExposureChart.tsx`
- Recharts `<ComposedChart>` (or `<AreaChart>` + `<LineChart>` overlay)
- Two series: gross (filled area, `CHART_ACCENT` fill at 0.2 opacity, no
  stroke) + net (solid line, `CHART_ACCENT` 1.5px stroke)
- X axis: date, `CHART_TICK_STYLE` spread, monthly tick interval
- Y axis: USD or % of NAV (per `compute_exposure_metrics()` schema —
  planner verifies at plan-time), `CHART_TICK_STYLE`, axis label suffix
  `%` or `$M` per resolved unit.
- Reference line at `0` (`CHART_TEXT_MUTED` + `CHART_REFERENCE_DASH`)
  to anchor net = 0 for net-zero / market-neutral strategies.
- Height: 240px.
- Tooltip: spreads `CHART_TOOLTIP_STYLE`; renders `gross` and `net` lines
  with formatted values.
- Legend: "Gross" / "Net" — DM Sans 12px regular, swatch + label.

**`<TurnoverChart>`** (NEW):
- File: `src/components/charts/TurnoverChart.tsx`
- Recharts `<LineChart>`, single line `CHART_ACCENT` 1.5px stroke
- X axis: date, `CHART_TICK_STYLE` spread, monthly tick interval
- Y axis: % of NAV, `CHART_TICK_STYLE`, formatter `(v) => v.toFixed(1) + '%'`
- Height: 200px.
- No legend (single series).
- Tooltip: spreads `CHART_TOOLTIP_STYLE`.
- Empty state: render H3 + "Turnover unavailable for this strategy." in
  12px regular muted, centered at 200px height.

**`<BenchmarkGreeksTable>`** (NEW):
- File: `src/components/strategy-v2/BenchmarkGreeksTable.tsx`
- 4 cells: `alpha` / `beta` / `IR` / `Treynor`
- Layout: `grid grid-cols-4 gap-3` (default — horizontal 4-cell strip,
  same pattern as Panel 1 Overview). Planner may switch to `grid-cols-2
  grid-rows-2` if the page rhythm calls for vertical pairing — discretion.
- Cell label: 12px DM Sans regular `text-text-muted` — `alpha` / `beta`
  / `IR` / `Treynor`.
- Cell value: 18px Geist Mono semibold tabular-nums.
- Negative alpha / beta < 0: rendered in `--color-negative`.
- Missing value: em-dash.
- All cells wrapped in `<dl>` / `<dt>` / `<dd>` per A11Y semantic-HTML
  rule.

### 3.5 DailyHeatmap — SVG/Canvas dual renderer (KPI-07 / Pitfall 4)

NEW component: `src/components/charts/DailyHeatmap.tsx`.

**Threshold rule:**

```ts
const SVG_THRESHOLD_CELLS = 365;
function DailyHeatmap({ data }: { data: { date: string; value: number }[] }) {
  if (data.length <= SVG_THRESHOLD_CELLS) return <SvgRenderer data={data} />;
  return <CanvasRenderer data={data} />;
}
```

**SVG renderer (≤365 cells):**
- Single `<svg>` element
- Cell layout: 12 columns (months) × N rows (years), one `<rect>` per cell
- Cell width: ~24px, height: ~16px (configurable; planner's discretion to
  fit panel width)
- Cell fill: 9-step diverging color scale anchored at 0:
  - >+0.10 → `#16A34A` (positive saturated)
  - +0.05 to +0.10 → `#16A34A` @ opacity 0.7
  - +0.02 to +0.05 → `#16A34A` @ opacity 0.4
  - 0 to +0.02 → `#16A34A` @ opacity 0.15
  - 0 → `#FFFFFF` (or `bg-surface-subtle`)
  - -0.02 to 0 → `#DC2626` @ opacity 0.15
  - -0.05 to -0.02 → `#DC2626` @ opacity 0.4
  - -0.10 to -0.05 → `#DC2626` @ opacity 0.7
  - <-0.10 → `#DC2626` (negative saturated)
- Cell stroke: `CHART_BORDER` (`#E2E8F0`) 1px (gridlines)
- Hover state: cell border darkens to `CHART_AXIS_TICK` (`#64748B`); SVG
  `<title>` carries `${date}: ${(value*100).toFixed(2)}%` for native
  tooltip and screen-reader narration.
- Y-axis label (year): 12px Geist Mono regular `text-text-muted`,
  vertical align middle.
- X-axis label (month): 12px DM Sans regular `text-text-muted`, top of grid.

**Canvas renderer (>365 cells):**
- Single `<canvas>` element with `useEffect` imperative paint
- NO per-cell DOM elements (avoids 5y × 365 = ~1825-element render)
- `useEffect` runs ONLY when `status === 'ready'` (i.e. on first
  intersection, since the panel mounts via `useLazyPanelMetrics`)
- Single full-redraw `ctx.fillRect` per cell; no incremental drawing
- `requestAnimationFrame` is OPTIONAL — single-paint is acceptable since
  `useLazyPanelMetrics` already defers paint past initial scroll
- Tooltip: implement via `<canvas>` `onMouseMove` handler that maps pixel
  coords → cell index → date/value, OR overlay an absolutely-positioned
  invisible `<div>` grid that catches hover. Planner's discretion. Touch
  not in scope (mobile deferred).
- Performance budget: **< 300ms first paint on 5y fixture (1825 cells)**
  measured via `performance.measure('panel-4-paint',
  'panel-4-mount-start', 'panel-4-mount-end')`. Asserted by
  `tests/e2e/strategy-v2-chart-parity.spec.ts` (DailyHeatmap section).
- Accessibility: Canvas is opaque to screen readers — provide an offscreen
  `<table>` mirror with month rows and year cells, `aria-hidden="false"`
  on the table, `role="presentation"` on the canvas. Table cell content =
  `${date}: ${(value*100).toFixed(2)}%`.

**Layout footprint:** `min-height: 280px` for ≤365 cells; `min-height:
360px` for >365 cells (more rows). Container takes `width: 100%` of the
parent panel card.

---

## 4. Lazy mount lifecycle

### 4.1 `useLazyPanelMetrics` hook contract (extended)

Phase 14a authored the hook with `fetchOnIntersect: false` (placeholder
lifecycle only). **Phase 14b extends the hook to fetch real data when
`fetchOnIntersect: true`** — single-line conceptual change in the
`useEffect` IntersectionObserver callback per the inline comment in
`src/hooks/useLazyPanelMetrics.ts:73-78`.

Updated hook contract:

```ts
useLazyPanelMetrics<T>(panelId: 'panel4'|'panel5'|'panel6'|'panel7', opts?: {
  rootMargin?: string;       // default "200px"
  fetchOnIntersect?: boolean; // 14b: TRUE for Panel 4-7 bodies
  strategyId: string;        // 14b: REQUIRED when fetchOnIntersect=true
}): {
  ref: (node: HTMLElement | null) => void;
  data: T | null;
  status: 'idle' | 'loading' | 'error' | 'ready';
}
```

Lifecycle:

| status | Trigger | DOM attribute | Body content |
|---|---|---|---|
| `idle` | Initial mount, panel below fold | `data-panel-status="placeholder"` | (panel chrome only — H2 heading + 240px min-height) |
| `loading` | First intersection, fetch fired | `data-panel-status="loading"` | H2 heading + centered "Loading…" copy (12px regular muted) — IDENTICAL to 14a placeholder body, so transition is visually atomic |
| `ready` | Fetch resolved successfully | `data-panel-status="ready"` | Panel body (sub-charts) — see §3.1–3.4 |
| `error` | Fetch rejected | `data-panel-status="error"` | H2 heading + error banner (see §4.2) |

The `data-panel-status` lifecycle is asserted by:
- `tests/e2e/strategy-v2-keyboard.spec.ts` waits for all 7 panels to
  reach `data-panel-status="ready"` before asserting tab order.
- `tests/e2e/strategy-v2-chart-parity.spec.ts` waits for `ready` before
  taking screenshots.
- `tests/e2e/strategy-v2-axe.spec.ts` waits for `ready` before running
  axe-core scan (otherwise the placeholder loading state blocks accurate
  a11y assertion).

### 4.2 Lifecycle copy (verbatim)

| State | Copy | Class |
|---|---|---|
| `idle` (placeholder, panel below fold) | (panel chrome only — heading + min-height; no copy) | n/a |
| `loading` | `Loading…` (Unicode U+2026 horizontal ellipsis, NOT three periods) | `text-xs font-normal text-text-muted aria-live="polite"` |
| `ready` | (panel body) | per §3 |
| `error` (panel-level fetch error) | Heading: `Couldn't load this section` (12px regular text-text-secondary uppercase tracking-wider). Body: `Refresh the page to retry. The other panels still work.` (12px regular text-text-muted). | `<PartialDataBanner heading={…} body={…} />` reused — Phase 14a component handles the visual treatment |

The `error` state is per-panel; it does NOT bubble to the route-level
`error.tsx` boundary (which is reserved for `getStrategyDetailV2` failure,
i.e. the eager panels 1–3 fetch path). Lazy fetch errors degrade
gracefully — the user can still scroll back up and use eager panels.

### 4.3 Partial-data state for Panels 4–7 (KPI-23b)

Per-panel partial-data thresholds (rendered via the inherited
`<PartialDataBanner>` from Phase 14a):

| Panel | Threshold | Banner heading | Banner body |
|---|---|---|---|
| Panel 4 (Returns distribution) | 30 days | `Awaiting more data` | `This strategy needs at least 30 days of trading history to populate Returns distribution.` |
| Panel 4 — DailyHeatmap sub-section ONLY | 30 days | (sub-banner, optional) | `Daily heatmap activates after 30 days of trading history.` |
| Panel 4 — YearlyReturns sub-section ONLY | 365 days | (sub-banner, optional) | `Yearly returns activates after 1 year of trading history.` |
| Panel 5 (Rolling) | 90 days | `Awaiting more data` | `This strategy needs at least 90 days of trading history for rolling 3M metrics.` |
| Panel 5 — 6M window button | 180 days | (button stays enabled but renders empty chart with sub-banner) | `Awaiting more data — need ≥180 days for 6M rolling window.` |
| Panel 5 — 12M window button | 365 days | (same) | `Awaiting more data — need ≥365 days for 12M rolling window.` |
| Panel 6 (Trades & positions) | 1 day | `Awaiting more data` | `This strategy hasn't logged any trades yet.` (when `trade_metrics.total === 0`) |
| Panel 6 — Trade Mix sub-panel | 1 trade | (sub-banner inside sub-panel) | `Trade mix unavailable for this strategy.` |
| Panel 7 (Exposure & greeks) | 30 days | `Awaiting more data` | `This strategy needs at least 30 days of trading history to compute exposure and benchmark greeks.` |
| Panel 7 — Correlation with BTC sub-section | 90 days | (sub-banner — reuses existing `CorrelationWithBenchmark` empty state copy) | `Insufficient data — 90 days needed, {N} days so far.` |

**Layout invariant:** the panel's outer card chrome + H2 heading + H3
sub-headings remain visible. The banner replaces ONLY the sub-chart body
region. If the entire panel is below threshold, a single panel-level
banner replaces all sub-section bodies.

**PR template extension:** the existing `.github/PULL_REQUEST_TEMPLATE.md`
(shipped Phase 14a with the partial-data matrix scaffold for Panels 1–3)
extends in 14b to a 4-history-band × 7-panel grid. Each cell:
"banner copy" / "full render" / "—". This is the Pitfall 17 mitigation.

---

## 5. Color — inherited from 14A §3

(See 14A-UI-SPEC §3.) No new tokens. Phase 14b NEW chart-color
applications all use the inherited token surface:

| Element | Token | Rule |
|---|---|---|
| All strategy series strokes (Rolling Sharpe, Rolling Vol, Rolling Sortino, Rolling alpha, Net exposure, Gross exposure fill, Turnover, Correlation w/ BTC) | `CHART_ACCENT` (`#1B6B5A`) | A11Y-01 — never as text |
| Beta line (Panel 5 Rolling alpha & beta) | `CHART_TEXT_MUTED` (`#94A3B8`) + `strokeDasharray={CHART_REFERENCE_DASH}` | Differentiated by dash + 1px width vs alpha's 1.5px |
| BTC benchmark series on Rolling Sharpe (Panel 5) | `CHART_TEXT_MUTED` 1px dashed | Same as Phase 14a Panel 2 BTC overlay |
| Histogram bars (positive bins) | `--color-positive` (`#16A34A`) | Replace the `#059669` currently in `ReturnHistogram.tsx:56` (DESIGN-01 audit) |
| Histogram bars (negative bins) | `--color-negative` (`#DC2626`) | Already correct |
| YearlyReturns bars (positive years) | `--color-positive` (`#16A34A`) | Replace `#059669` in `YearlyReturns.tsx:40` |
| YearlyReturns bars (negative years) | `--color-negative` (`#DC2626`) | Already correct |
| MonthlyHeatmap cells (positive) | `--color-positive` opacity scale | Replace `bg-emerald-*` Tailwind palette with explicit hex (DESIGN-01 audit) |
| MonthlyHeatmap cells (negative) | `--color-negative` opacity scale | Replace `bg-red-*` Tailwind palette |
| ReturnQuantiles box fill | `CHART_ACCENT` (`#1B6B5A`) opacity 0.15 | Replace `#0D9488` |
| ReturnQuantiles box stroke + median line | `CHART_ACCENT` | Replace `#0D9488` |
| ReturnQuantiles whisker stroke | `CHART_TEXT_MUTED` (`#94A3B8`) | Already correct (whisker is stroke, not text — A11Y-01 forbidden-as-text rule does NOT apply) |
| DailyHeatmap cell scale | 9-step diverging anchored at 0 — see §3.5 | Uses `--color-positive` / `--color-negative` |
| Trade Mix Long bar | `CHART_ACCENT` | |
| Trade Mix Short bar | `CHART_TEXT_MUTED` (this is a stroke / fill on a graphical element, NOT text — A11Y-01 forbidden-as-text rule does NOT apply) | |
| Panel 6 cell value (negative R:R, negative alpha, etc.) | `--color-negative` | Same KPI-strip rule from 14A §3 |
| Panel 7 alpha < 0 / beta < 0 | `--color-negative` | Same |

---

## 6. Accessibility — A11Y-02 axe-core integration

### 6.1 Scope

`@axe-core/playwright` runs against TWO routes on every PR:

| Route | Spec | Coverage |
|---|---|---|
| `/discovery/[slug]` | `e2e/discovery-axe.spec.ts` | Phase 13 surface (full page) |
| `/strategy/[id]/v2` | `e2e/strategy-v2-axe.spec.ts` | All 7 panels mounted (waits for `data-panel-status="ready"` on panels 1–7 before scan) |

### 6.2 Test runner contract

```ts
// e2e/strategy-v2-axe.spec.ts (illustrative shape)
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('strategy v2 page has zero axe violations', async ({ page }) => {
  await page.goto('/strategy/{golden-fixture-id}/v2?strategy_v2=on');
  // Wait for all 7 panels to reach ready state (eager 1-3 are immediate;
  // lazy 4-7 mount on intersection — scroll to force them).
  for (const panelId of ['overview','headline-equity','drawdown',
       'returns-distribution','rolling','trades','exposure']) {
    await page.locator(`[data-panel="${panelId}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(
      `[data-panel="${panelId}"][data-panel-status="ready"]`
    )).toBeVisible({ timeout: 5000 });
  }
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

### 6.3 Threshold

**Zero violations** on `wcag2a`, `wcag2aa`, and `best-practice` rule sets.
Violations BLOCK PR merge (no opt-out, no exception list).

### 6.4 Helper module decision

`e2e/strategy-v2-axe.spec.ts` and `e2e/discovery-axe.spec.ts` MAY share a
helper at `e2e/helpers/axe.ts` (DRY) OR duplicate the boilerplate
(per-spec clarity). Planner's discretion.

### 6.5 New devDependency

`@axe-core/playwright` added to `devDependencies` in `package.json`. NO
other new dependencies introduced in 14b (all chart libs already in tree).

### 6.6 What axe-core specifically catches in this surface

| Phase 14b component | Axe rule potentially triggered | Mitigation |
|---|---|---|
| `<DailyHeatmap>` Canvas renderer | `image-alt` (Canvas with no accessible name) | `<canvas role="presentation">` + offscreen `<table>` mirror with `aria-hidden="false"` (per §3.5) |
| `<NetGrossExposureChart>` Recharts SVG | `svg-img-alt` | `<svg role="img" aria-label="Net and gross exposure over time">` wrapper |
| `<TurnoverChart>` Recharts SVG | Same | Same — `<svg role="img" aria-label="Daily turnover as percent of NAV">` |
| `<TradeMixSubPanel>` percentage bars | `color-contrast` (text on `CHART_ACCENT` background) | Render percentage label OUTSIDE the bar (right-aligned next to it), not inside. Or ensure white text on `#1B6B5A` passes 4.5:1 (it does — 6.6:1) |
| Panel 5 segmented control | `aria-pressed`, `button-name` | Inherited from `<SegmentedControl>` Phase 14a contract |
| Panel 6 / Panel 7 `<dl>` lists | `definition-list` | `<dl>` must contain only `<dt>` / `<dd>` pairs at the top level — verify per A11Y semantic-HTML rule (14A §8) |

---

## 7. Accessibility — A11Y-03 keyboard navigation

### 7.1 Verification mechanism

`e2e/strategy-v2-keyboard.spec.ts` (Playwright). Asserts focus order via
sequential `keyboard.press('Tab')` calls + `expect(page.locator(':focus'))`
checks.

### 7.2 Skip link (NEW — Pitfall mitigation for 7-panel scroll)

Phase 14b adds a skip-link mechanism so keyboard users can jump between
panels without tabbing through every interactive element in each panel:

```html
<a href="#panel-overview" class="skip-link">Skip to Overview</a>
<a href="#panel-headline-equity" class="skip-link">Skip to Headline metrics</a>
<a href="#panel-drawdown" class="skip-link">Skip to Drawdown</a>
<a href="#panel-returns-distribution" class="skip-link">Skip to Returns distribution</a>
<a href="#panel-rolling" class="skip-link">Skip to Rolling metrics</a>
<a href="#panel-trades" class="skip-link">Skip to Trades & positions</a>
<a href="#panel-exposure" class="skip-link">Skip to Exposure & greeks</a>
```

Skip-link styling:
- Default state: visually hidden via `position: absolute; left: -9999px` OR
  `sr-only` Tailwind utility
- Focused state: `position: fixed; top: 8px; left: 8px; z-index: 100;
  background: bg-surface; border: 1px solid border-accent;
  padding: 8px 12px; font: text-xs font-normal; color: text-accent;`
- Visible only on tab-focus (NOT on click)

Every `<section data-panel>` gets `id="panel-{key}"` AND `tabIndex={-1}` so
the skip-link target is programmatically focusable but not in the natural
tab order (avoids forcing tab through the section element itself).

### 7.3 Focus order (verbatim, asserted)

```
1.  Skip-link "Skip to Overview"
2.  Skip-link "Skip to Headline metrics"
3.  Skip-link "Skip to Drawdown"
4.  Skip-link "Skip to Returns distribution"
5.  Skip-link "Skip to Rolling metrics"
6.  Skip-link "Skip to Trades & positions"
7.  Skip-link "Skip to Exposure & greeks"
8.  (Panel 1 Overview — read-only, no interactive elements)
9.  Panel 2 — Cumulative button (segmented control)
10. Panel 2 — Underwater button
11. Panel 2 — Rolling Sharpe button (NEWLY ENABLED in 14b)
12. Panel 2 — Log returns button (NEWLY ENABLED in 14b)
13. Panel 2 — BTC benchmark checkbox
14. (Panel 3 Drawdown — read-only)
15. (Panel 4 Returns distribution — read-only)
16. Panel 5 — 3M button (window toggle)
17. Panel 5 — 6M button (default-active)
18. Panel 5 — 12M button
19. (Panel 6 Trades & positions — read-only)
20. (Panel 7 Exposure & greeks — read-only)
```

Disabled buttons (`aria-disabled="true"`) MAY still receive focus per 14A
§8 (allows screen readers to announce the disabled state). For Phase 14b,
the Phase 14a-disabled buttons are now ENABLED, so this concern is moot
inside the Panel 2 segmented control — but if any new disabled buttons
appear in 14b code, the inherited Phase 14a SegmentedControl behavior
(focusable + `aria-disabled`) holds.

### 7.4 Keyboard interaction contracts

| Action | Behavior |
|---|---|
| Tab | Move forward through the focus order above |
| Shift-Tab | Move backward |
| Enter on focused button | Trigger click handler (segmented control re-render) |
| Space on focused button | Same as Enter (button semantics) |
| Space on focused checkbox | Toggle BTC overlay (Panel 2) |
| Arrow keys inside `role="group"` segmented controls | OPTIONAL — Phase 14b ships Tab navigation only; arrow-key navigation inside segmented controls is NOT required for A11Y-03 |
| Click skip-link | Scroll target panel into view + focus the panel section element |

### 7.5 Focus indicator

Reuse `--color-border-focus` (`#1B6B5A`) from DESIGN.md. All focusable
elements show a 2px outline at `--color-border-focus` (Tailwind `ring-2
ring-accent` or equivalent). Skip-links also use this focus ring when
visible.

### 7.6 Documentation

Append a new `docs/A11Y.md` (or extend if the file exists) with:
- The full focus order table from §7.3
- The skip-link mechanism description from §7.2
- A "verifying manually" section: "Tab from the page H1; press Tab N
  times; expected element at each step is documented above."

---

## 8. Chart-snapshot parity diff (Phase 14b SC#1)

### 8.1 Mechanism

**Playwright `toHaveScreenshot()` with pixel-diff tolerance.** Goldens
stored at `e2e/__snapshots__/strategy-v2/`.

Spec: `e2e/strategy-v2-chart-parity.spec.ts`.

### 8.2 Fixture

A fixed 252-day golden fixture: `analytics-service/tests/fixtures/golden_252d`
(already used by Phase 12 METRICS-13 cross-runtime parity tests). The
v0.17 golden allocator/strategy seed loads this fixture into a known
strategy ID, and the parity spec opens that strategy at
`/strategy/{golden-fixture-id}/v2`.

### 8.3 Goldens captured

7 per-panel screenshots + 1 full-page screenshot:

| Golden file | Captures |
|---|---|
| `panel-1-overview.png` | Just the `<section data-panel="overview">` element |
| `panel-2-headline-equity.png` | Just `<section data-panel="headline-equity">` (with default Cumulative tab + BTC overlay ON) |
| `panel-3-drawdown.png` | Just `<section data-panel="drawdown">` |
| `panel-4-returns-distribution.png` | Just `<section data-panel="returns-distribution">` (after `data-panel-status="ready"`) |
| `panel-5-rolling.png` | Just `<section data-panel="rolling">` (default 6M window) |
| `panel-6-trades.png` | Just `<section data-panel="trades">` |
| `panel-7-exposure.png` | Just `<section data-panel="exposure">` |
| `full-page.png` | Full scrollable page (all 7 panels rendered) |

### 8.4 Tolerance

| Scope | Tolerance | Rationale |
|---|---|---|
| Per-panel screenshot | **±2% pixel-diff** | Anti-aliasing + sub-pixel rendering slack |
| Full-page screenshot | **±5% pixel-diff** | Larger surface, more cumulative anti-aliasing |

Playwright `toHaveScreenshot` config:
```ts
await expect(panel).toHaveScreenshot('panel-4-returns-distribution.png', {
  maxDiffPixelRatio: 0.02, // 2%
  threshold: 0.2,           // per-pixel sensitivity
});
```

### 8.5 Structural assertions (in addition to pixel diff)

The same spec asserts:

```ts
// Each chart has exactly 1 strategy series stroke
await expect(panel.locator('path[stroke="#1B6B5A"]')).toHaveCount(1);
// ≤1 BTC benchmark stroke (where applicable)
await expect(panel.locator('path[stroke="#94A3B8"]')).toHaveCount({ /* 0 or 1 */ });
// CHART_TICK_STYLE applied — every <text> font-variant-numeric == tabular-nums
const ticks = await panel.locator('.recharts-cartesian-axis-tick text').all();
for (const tick of ticks) {
  await expect(tick).toHaveCSS('font-variant-numeric', 'tabular-nums');
}
```

These structural checks catch identity drift even when pixel diff
passes (e.g. someone uses a similar-but-not-identical green that pixel-
diff misses but the explicit hex assertion catches).

### 8.6 Performance assertion (DailyHeatmap budget)

Same spec asserts:

```ts
await page.evaluate(() => {
  performance.mark('panel-4-mount-end');
  const entry = performance.measure(
    'panel-4-paint',
    'panel-4-mount-start',  // emitted by ReturnsDistributionPanel useEffect
    'panel-4-mount-end'
  );
  return entry.duration;
});
expect(duration).toBeLessThan(300); // <300ms first paint on 5y fixture
```

The `performance.mark('panel-4-mount-start')` is emitted inside
`<ReturnsDistributionPanel>` on first mount; `panel-4-mount-end` is
emitted once `<DailyHeatmap>` finishes its initial paint (Canvas branch)
or first render commit (SVG branch).

### 8.7 Golden refresh policy

Goldens regenerated only when an INTENTIONAL identity / layout change is
made. Regeneration command documented in `e2e/strategy-v2-chart-parity.spec.ts`
header comment: `npx playwright test e2e/strategy-v2-chart-parity.spec.ts --update-snapshots`.
PR description must call out which goldens were updated and why.

---

## 9. Component inventory (Phase 14b additions)

### 9.1 New components

| Component | Path | Role |
|---|---|---|
| `<ReturnsDistributionPanel>` | `src/components/strategy-v2/ReturnsDistributionPanel.tsx` | Client component; wraps `useLazyPanelMetrics`; mounts MonthlyHeatmap / DailyHeatmap / ReturnHistogram / ReturnQuantiles / YearlyReturns inside the inherited panel chrome |
| `<RollingMetricsPanel>` | `src/components/strategy-v2/RollingMetricsPanel.tsx` | Client component; owns `window` state (90/180/365); reuses `<SegmentedControl>` for the toggle; mounts 4 rolling sub-charts |
| `<RollingVolatilityChart>` | `src/components/charts/RollingVolatilityChart.tsx` | NEW — Recharts line, single series, `CHART_ACCENT`. Or: planner may inline this inside `<RollingMetricsPanel>` if the chart is trivial — discretion. |
| `<RollingSortinoChart>` | `src/components/charts/RollingSortinoChart.tsx` | NEW — same pattern as RollingVolatility |
| `<RollingAlphaBetaChart>` | `src/components/charts/RollingAlphaBetaChart.tsx` | NEW — Recharts line, 2 series (alpha=accent solid, beta=muted dashed), legend on top |
| `<TradeAndPositionPanel>` | `src/components/strategy-v2/TradeAndPositionPanel.tsx` | Client component; wraps lazy hook; mounts 4 metric rows + Trade Mix sub-panel |
| `<TradeMixSubPanel>` | `src/components/strategy-v2/TradeMixSubPanel.tsx` | Sub-panel inside TradeAndPositionPanel; 2-bucket only (mode prop reserved for v0.17.1 4-bucket flip) |
| `<ExposureAndGreeksPanel>` | `src/components/strategy-v2/ExposureAndGreeksPanel.tsx` | Client component; wraps lazy hook; mounts NetGross + Turnover + Correlation + Greeks |
| `<NetGrossExposureChart>` | `src/components/charts/NetGrossExposureChart.tsx` | NEW — Recharts ComposedChart with gross fill area + net line |
| `<TurnoverChart>` | `src/components/charts/TurnoverChart.tsx` | NEW — Recharts line, single series |
| `<BenchmarkGreeksTable>` | `src/components/strategy-v2/BenchmarkGreeksTable.tsx` | NEW — 4-cell strip OR 2x2 grid; alpha/beta/IR/Treynor; same metric-cell pattern as Panel 6 |
| `<DailyHeatmap>` | `src/components/charts/DailyHeatmap.tsx` | NEW — SVG renderer (≤365 cells) + Canvas renderer (>365 cells); 9-step diverging color scale |
| `<MetricCell>` | `src/components/strategy-v2/MetricCell.tsx` (OPTIONAL) | Planner's discretion. Shared primitive for the 12px label + 18px value pattern used in Panel 6 metric strips and Panel 7 Greeks table. Avoids duplication. If planner inlines, document the pattern in the wrapper component. |

### 9.2 Reused (no changes — Phase 14a or earlier)

| Component | Used in |
|---|---|
| `<MonthlyHeatmap>` | Panel 4 |
| `<ReturnHistogram>` | Panel 4 (verify benchmarkReturns prop; minor color audit) |
| `<ReturnQuantiles>` | Panel 4 (color audit) |
| `<YearlyReturns>` | Panel 4 (minor color + tick audit) |
| `<RollingMetrics>` | Panel 5 Rolling Sharpe wrapper (verify window prop) |
| `<CorrelationWithBenchmark>` | Panel 7 |
| `<SegmentedControl>` | Panel 5 window toggle (NEW use); Panel 2 segmented control (un-disable Rolling Sharpe + Log returns) |
| `<PartialDataBanner>` | Panel 4-7 partial-data banners |
| `<LazyPanelPlaceholder>` | REMOVED — replaced by the 4 new panel body components inside `<StrategyV2Shell>` |
| `<StrategyV2Shell>` | EXTENDED — replace 4 `<LazyPanelPlaceholder>` slots with the 4 new panel body components |
| `useLazyPanelMetrics` | EXTENDED — `fetchOnIntersect=true` branch wired |

### 9.3 Forbidden patterns (inherited from 14A §6)

All Phase 14b components MUST honor the inherited 4-size/2-weight Tailwind
class contract. Forbidden classes asserted by
`tests/visual/strategy-v2-type-scale.test.ts` (extended in 14b to cover
new files):

- Sizes: `text-[11px]`, `text-[13px]`, `text-[14px]`, `text-sm`, `text-xl`, `text-2xl`
- Weights: `font-medium`, `font-light`, `font-bold`
- Recharts: `tick={{ ... }}` literal-object spread (must use `CHART_TICK_STYLE`)
- Hardcoded hex outside `chart-tokens.ts` (planner verifies — `tests/a11y/chart-contrast.test.ts` extension catches `fill="#94A3B8"` and `fill="#718096"` on text nodes)

---

## 10. Copywriting (Phase 14b additions, verbatim)

All other copy inherited from 14A-UI-SPEC §7. Phase 14b additions:

### 10.1 H3 sub-headings (inherit `text-xs font-normal uppercase tracking-wider text-text-secondary` style)

| Panel | H3 copy |
|---|---|
| Panel 4 | `Monthly heatmap` / `Daily heatmap` / `Return histogram` / `Return quantiles` / `Yearly returns` |
| Panel 5 | `Rolling Sharpe` / `Rolling volatility` / `Rolling Sortino` / `Rolling alpha & beta` |
| Panel 6 | `Trade summary` / `Position summary` / `Risk-reward profile` / `Volume metrics` / `Trade mix` |
| Panel 7 | `Net & gross exposure` / `Turnover` / `Correlation with BTC` / `Benchmark greeks` |

### 10.2 Panel 5 — window toggle button labels

| Button | Label |
|---|---|
| 3M | `3M` |
| 6M (active default) | `6M` |
| 12M | `12M` |

### 10.3 Panel 6 — metric cell labels

**Trade summary row:** `Total trades` / `Long` / `Short` / `Wins` / `Losses` / `Win rate`

**Position summary row:** `Open` / `Closed` / `Long` / `Short` / `Win rate` / `Avg duration`

**Risk-reward row:** `R:R` / `Weighted R:R` / `Profit factor` / `Payoff ratio` / `Long PF` / `Short PF` / `Expectancy` (and `SQN` if 7th cell on row).

**Volume row:** `Gross volume` / `Mean trade size` / `Daily turnover` / `Monthly turnover`

**Trade Mix sub-panel labels:** `Long entries` / `Short entries`

### 10.4 Panel 7 — Benchmark greeks cell labels

`alpha` / `beta` / `IR` / `Treynor`

(Lowercase — these are statistical-finance term conventions, NOT
sentence-case noun labels. Greek-letter convention.)

### 10.5 Skip-link copy (verbatim)

| Skip-link | Label |
|---|---|
| 1 | `Skip to Overview` |
| 2 | `Skip to Headline metrics` |
| 3 | `Skip to Drawdown` |
| 4 | `Skip to Returns distribution` |
| 5 | `Skip to Rolling metrics` |
| 6 | `Skip to Trades & positions` |
| 7 | `Skip to Exposure & greeks` |

(Verb-noun CTA convention: `Skip to {destination}` — destination is the
panel name, matching the H2 heading verbatim.)

### 10.6 Lazy lifecycle copy (per-state)

| State | Copy |
|---|---|
| `loading` | `Loading…` (Unicode U+2026) |
| `error` heading | `Couldn't load this section` |
| `error` body | `Refresh the page to retry. The other panels still work.` |

### 10.7 Partial-data banners (per panel × per threshold)

See §4.3 table for the full grid.

### 10.8 Destructive actions

**None in Phase 14b.** Read-only public surface; no delete buttons, no
confirmations.

---

## 11. Flag flip — `strategy.ui_v2` default OFF → ON

**Final commit of Phase 14b** flips the flag default. Single-line change
in `src/lib/strategy-ui-v2-flag.ts`:

```diff
- const DEFAULT_FLAG_VALUE = false;
+ const DEFAULT_FLAG_VALUE = true;
```

Pre-flip gating (all MUST be true before the flip lands):
- [ ] axe-core specs green on `/discovery/[slug]` AND `/strategy/[id]/v2` (zero violations)
- [ ] Keyboard nav spec green (`e2e/strategy-v2-keyboard.spec.ts`)
- [ ] Chart-snapshot parity goldens committed AND spec green (`e2e/strategy-v2-chart-parity.spec.ts`)
- [ ] Partial-data spec extended to cover 4 history bands × 4 new panels (KPI-23b matrix)
- [ ] All inherited Phase 14a tests still green (chart-contrast, panel-count, type-scale, tabular-nums)
- [ ] `npm run build` exits 0
- [ ] DESIGN-01 chart audit complete on Panel 4 components (`#0D9488` → `#1B6B5A`; `#059669` → `#16A34A`; emerald/red Tailwind palette → `#16A34A` / `#DC2626` opacity scale)

When flipped: visiting `/strategy/[id]` (v1) AUTO-REDIRECTS to
`/strategy/[id]/v2` for users without an explicit OFF override. URL
override `?strategy_v2=off` still forces v1 for any user.

---

## 12. Test contract (Phase 14b additions)

### 12.1 New top-level Vitest tests

| Test | Path | Asserts |
|---|---|---|
| (none) | (extends inherited tests below) | — |

### 12.2 Extended top-level Vitest tests (inherited from 14A)

| Test | Extension |
|---|---|
| `tests/a11y/chart-contrast.test.ts` | Glob extends to `src/components/strategy-v2/{ReturnsDistributionPanel,RollingMetricsPanel,TradeAndPositionPanel,ExposureAndGreeksPanel,TradeMixSubPanel,BenchmarkGreeksTable}.tsx` + `src/components/charts/{DailyHeatmap,NetGrossExposureChart,TurnoverChart,RollingVolatilityChart,RollingSortinoChart,RollingAlphaBetaChart}.tsx`. Asserts: zero `fill="#94A3B8"` / `fill="#718096"` on text/legend nodes; every `<text>` `fill` is `#64748B` or unset. |
| `tests/visual/strategy-v2-panel-count.test.ts` | (No extension — still asserts exactly 7 `<section data-panel>`. Phase 14b doesn't add panels.) |
| `tests/visual/strategy-v2-type-scale.test.ts` | Glob extends to all new strategy-v2 files. Forbidden-class set unchanged. |
| `tests/visual/strategy-v2-tabular-nums.test.ts` | Glob extends to all new strategy-v2 + chart files. Asserts zero `tick={{` literal-object spread. |
| `tests/e2e/strategy-v2-partial-data.spec.ts` | Spec extended: per fixture (7d/30d/90d/365d), assert all 7 panels render either full body OR partial-data banner verbatim. 4 fixtures × 7 panels = 28 cells in the test matrix. |

### 12.3 New Playwright specs

| Spec | Path | Asserts |
|---|---|---|
| Discovery axe | `e2e/discovery-axe.spec.ts` | Zero axe violations (`wcag2a` + `wcag2aa` + `best-practice`) on `/discovery/[slug]` |
| Strategy v2 axe | `e2e/strategy-v2-axe.spec.ts` | Zero axe violations on `/strategy/{golden-id}/v2` after all 7 panels reach `data-panel-status="ready"` |
| Keyboard nav | `e2e/strategy-v2-keyboard.spec.ts` | Tab traversal hits skip-links 1-7 → Panel 2 controls (5 elements) → Panel 5 controls (3 elements) in the order documented in §7.3 |
| Chart-snapshot parity | `e2e/strategy-v2-chart-parity.spec.ts` | 7 per-panel screenshots match goldens at ±2%; 1 full-page screenshot at ±5%; structural assertions per §8.5; performance budget per §8.6 |

### 12.4 Co-located Vitest tests (new components)

| Test | Asserts |
|---|---|
| `src/components/strategy-v2/ReturnsDistributionPanel.test.tsx` | Renders 5 sub-charts when `status === 'ready'`; renders partial-data banner when `history_days < 30`; H3 sub-headings present in correct order |
| `src/components/strategy-v2/RollingMetricsPanel.test.tsx` | Window toggle 3M/6M/12M switches `window` prop; 4 sub-charts re-render when window changes; default window is `180` (6M); disabled-window banners on threshold violations |
| `src/components/strategy-v2/TradeAndPositionPanel.test.tsx` | Renders 4 metric rows + Trade Mix sub-panel; metric values use 18px Geist Mono semibold; em-dash on null values; negative values get `--color-negative` |
| `src/components/strategy-v2/TradeMixSubPanel.test.tsx` | 2-bucket mode renders Long/Short bars; mode prop default = `2-bucket`; empty state when `total === 0` |
| `src/components/strategy-v2/ExposureAndGreeksPanel.test.tsx` | Renders 4 sub-components; partial-data banner on threshold violation |
| `src/components/strategy-v2/BenchmarkGreeksTable.test.tsx` | 4 cells with correct labels (`alpha`/`beta`/`IR`/`Treynor`); negative values get `--color-negative`; em-dash on null |
| `src/components/charts/DailyHeatmap.test.tsx` | SVG branch when `data.length <= 365`; Canvas branch when `> 365`; offscreen `<table>` mirror present in Canvas branch; 9-step color scale renders correct hex per cell value |
| `src/components/charts/NetGrossExposureChart.test.tsx` | Two series rendered (gross fill + net line); reference line at 0; CHART_TICK_STYLE on axes |
| `src/components/charts/TurnoverChart.test.tsx` | Single line series; CHART_ACCENT stroke; CHART_TICK_STYLE on axes |
| `src/components/charts/RollingVolatilityChart.test.tsx` | Single line CHART_ACCENT; window prop drives data slice |
| `src/components/charts/RollingSortinoChart.test.tsx` | Same as Volatility |
| `src/components/charts/RollingAlphaBetaChart.test.tsx` | Two lines (alpha solid CHART_ACCENT; beta dashed muted); legend present |

### 12.5 Build gate

`npm run build` exits 0. No TypeScript errors. No broken imports. New
devDependency `@axe-core/playwright` resolves.

---

## 13. Identity audit checklist (extends 14A §10)

The 8-box DESIGN-01 checklist from PR template (shipped Phase 14a)
applies to every chart in Panels 4–7. Phase 14b adds explicit per-chart
audit items:

- [ ] Panel 4 `<MonthlyHeatmap>` cells use `#16A34A` / `#DC2626` opacity scale (NOT `bg-emerald-*` / `bg-red-*` Tailwind palette)
- [ ] Panel 4 `<ReturnHistogram>` positive bars use `#16A34A` (replaces `#059669`)
- [ ] Panel 4 `<ReturnHistogram>` axes use `CHART_TICK_STYLE`
- [ ] Panel 4 `<ReturnQuantiles>` box stroke + median use `#1B6B5A` (replaces `#0D9488`)
- [ ] Panel 4 `<YearlyReturns>` positive bars use `#16A34A`; axes use `CHART_TICK_STYLE`
- [ ] Panel 4 `<DailyHeatmap>` 9-step diverging scale anchored at 0 (no asymmetric scaling)
- [ ] Panel 4 `<DailyHeatmap>` Canvas branch performance budget < 300ms on 5y fixture
- [ ] Panel 5 all 4 sub-charts use `CHART_ACCENT` for primary series
- [ ] Panel 5 `<RollingAlphaBetaChart>` beta uses `CHART_TEXT_MUTED` + `strokeDasharray={CHART_REFERENCE_DASH}`
- [ ] Panel 6 metric values use 18px Geist Mono semibold tabular-nums
- [ ] Panel 6 `<TradeMixSubPanel>` Long bar = `CHART_ACCENT`; Short bar = `CHART_TEXT_MUTED`
- [ ] Panel 6 percentage labels rendered OUTSIDE bars (axe-core color-contrast pass)
- [ ] Panel 7 `<NetGrossExposureChart>` gross fill at opacity 0.2; net solid line; reference line at 0
- [ ] Panel 7 `<TurnoverChart>` single CHART_ACCENT line
- [ ] Panel 7 `<BenchmarkGreeksTable>` 4 cells with correct labels; negative values use `--color-negative`
- [ ] Every Recharts `<XAxis>` and `<YAxis>` in new components spreads `CHART_TICK_STYLE`
- [ ] No new chart introduces a hardcoded hex outside `chart-tokens.ts`
- [ ] Skip-links visible only on tab-focus (not on click)
- [ ] axe-core green on `/strategy/{golden-id}/v2` after all 7 panels ready

---

## 14. Acceptance gates (this phase)

The phase ships when:

1. `npm run build` exits 0; no TypeScript errors; no broken imports.
2. All inherited Phase 14a tests pass (chart-contrast / panel-count / type-scale / tabular-nums / partial-data).
3. `tests/e2e/strategy-v2-axe.spec.ts` passes (zero violations on full route).
4. `tests/e2e/discovery-axe.spec.ts` passes (zero violations on Discovery v2).
5. `tests/e2e/strategy-v2-keyboard.spec.ts` passes (tab traversal in documented order, skip-links work).
6. `tests/e2e/strategy-v2-chart-parity.spec.ts` passes (7 panel goldens at ±2%; full-page golden at ±5%; structural assertions; <300ms DailyHeatmap budget).
7. `tests/e2e/strategy-v2-partial-data.spec.ts` extended spec passes on all 4 history fixtures × all 7 panels.
8. Co-located Vitest tests for the 12 new components (§12.4) pass.
9. `useLazyPanelMetrics` hook fetches real data on intersection (`fetchOnIntersect=true` branch wired).
10. `<TradeMixSubPanel>` ships 2-bucket only; 4-bucket maker/taker is feature-flagged but NOT implemented.
11. `.github/PULL_REQUEST_TEMPLATE.md` partial-data matrix extended to 4 history bands × 7 panels.
12. `@axe-core/playwright` added to `devDependencies`.
13. `strategy.ui_v2` default flipped OFF → ON in the final commit (after 1-12 green).
14. Visual review: a fresh allocator opens `/strategy/[id]/v2` against a 365-day fixture and confirms all 7 panels render in DESIGN.md identity (white card, `#1B6B5A` accent series, BTC overlay `#94A3B8` default-ON, axis ticks Geist Mono 12px tabular-nums `#64748B`); panels 4–7 mount lazily on scroll; Panel 5 window toggle switches all 4 rolling sub-charts; Trade Mix renders 2-bucket Long/Short; DailyHeatmap renders SVG (≤365 cells) or Canvas (>365 cells) per threshold.

---

## 15. Out of scope (deferred to v0.17.1 or beyond)

(Mirror of 14B-CONTEXT.md `<deferred>` block, included here for the
checker's convenience.)

- Trade Mix 4-bucket maker/taker (KPI-17 partial) — descoped to v0.17.1 per Phase 12 audit lock (`TRADE_MIX_HAS_MAKER_TAKER=false`)
- Multi-benchmark ETH/SOL correlation matrix — Sprint 13+
- Panel 4 sub-component visual polish (ReturnHistogram benchmark overlay variant, ReturnQuantiles styling refinement) — Sprint 13+
- `/discovery/[slug]/[strategyId]` nested route — punted (handled by Phase 14a deferred list)
- Mobile-responsive polish — desktop-only acceptable per PROJECT.md
- Universal `getStrategyDetailV2` adoption (v1 → v2 cutover removing `/strategy/[id]/page.tsx` v1 path) — Sprint 13 item; happens AFTER 14b ships and the flag flips
- PDF tear-sheet auto-generation — Sprint 13+
- Manager Workspace — v0.18.0.0 milestone

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (DESIGN.md tokens; no shadcn) |
| Preset | not applicable |
| Component library | none (project-owned components only) |
| Icon library | lucide-react (existing) |
| Font | Instrument Serif (display) / DM Sans (body) / Geist Mono (data) |

---

## Spacing Scale

Inherited from 14A-UI-SPEC §1 (DESIGN.md 4px ladder). No new tokens.

| Token | Value | Usage |
|-------|-------|-------|
| 1 | 4px | Inline gaps |
| 2 | 8px | Compact spacing |
| 3 | 12px | Intra-panel cell gap |
| 4 | 16px | Default element spacing |
| 6 | 24px | Card padding (`p-6`); inter-sub-component gap (`space-y-6`) |
| 8 | 32px | Inter-panel gap (`mt-8`); Trade Mix sub-panel break |
| 12 | 48px | (Reserved — not used in 14b) |
| 16 | 64px | (Reserved — not used in 14b) |

Exceptions: none.

---

## Typography

Inherited from 14A-UI-SPEC §2. 4-size / 2-weight contract.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body / labels / sub-headings / axis ticks / table cells | 12px | 400 (regular) | 1.5 (body) / 1.25 (sub-heading) |
| Panel H2 | 16px | 600 (semibold) | 1.25 |
| KPI metric values | 18px | 600 (semibold) tabular-nums | 1.1 |
| Page H1 (Instrument Serif) | 32px | 400 (regular) | 1.1 |

Forbidden: `font-medium` / `font-light` / `font-bold` / `text-[11px]` /
`text-[13px]` / `text-[14px]` / `text-sm` / `text-xl` / `text-2xl`.

---

## Color

Inherited from 14A-UI-SPEC §3. 60/30/10 split.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#F8F9FA` | Page background (`bg-page`) |
| Secondary (30%) | `#FFFFFF` / `#E2E8F0` | Card surfaces (`bg-surface`); borders (`border-border`) |
| Accent (10%) | `#1B6B5A` (`CHART_ACCENT`) | Strategy series strokes; segmented active border; Trade Mix Long bar; verified badge |
| Destructive / negative | `#DC2626` | Negative values; loss bars; negative greeks |
| Positive | `#16A34A` | Positive bars; positive KPI cells |
| Benchmark | `#94A3B8` (`CHART_TEXT_MUTED`) | BTC overlay strokes (1px dashed); Trade Mix Short bar; beta line (dashed) |
| Axis text | `#64748B` (`CHART_AXIS_TICK`) | All chart axis ticks via `CHART_TICK_STYLE` token |

Accent reserved for: strategy series strokes (Equity, Rolling Sharpe / Vol
/ Sortino / Alpha, Net + Gross Exposure, Turnover, Correlation w/ BTC,
Histogram positive bars, ReturnQuantiles box, DailyHeatmap positive cells,
Trade Mix Long bar), segmented-button active border, focus ring, verified
badge. NEVER as background of large surfaces. NEVER as text fill on chart
axis / legend.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA (error boundary, inherited from 14A) | `Reload strategy` (verb + noun) |
| Secondary CTA (error boundary, inherited from 14A) | `Open v1 factsheet` (verb + noun) |
| Skip-links (Phase 14b NEW) | `Skip to {Panel name}` × 7 |
| Loading state | `Loading…` (Unicode U+2026) |
| Empty state (cell) | `—` (em-dash) |
| Empty state (Worst 5 table, inherited from 14A) | `No meaningful drawdowns — largest < 0.5%.` |
| Partial-data banner heading | `Awaiting more data` |
| Partial-data banner body (per panel) | `This strategy needs at least {N} days of trading history to populate {Panel name}.` |
| Panel error heading | `Couldn't load this section` |
| Panel error body | `Refresh the page to retry. The other panels still work.` |
| Destructive confirmation | None — no destructive actions in 14b |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| (none — manual design system) | (n/a) | not applicable |
| (no third-party shadcn registries) | (n/a) | not applicable |

No registry vetting required. The single new dependency (`@axe-core/playwright`)
is an npm dev-dependency, not a shadcn registry block — it is governed by
the project's banned-packages list (CLAUDE.md). `@axe-core/playwright` is
an Anthropic-trusted accessibility tooling package and is NOT on the
banned list.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS (verb-noun CTAs verified; sentence-case copy verified; lazy-state copy + skip-link copy verbatim)
- [ ] Dimension 2 Visuals: PASS (panel chrome inherited; sub-component layouts documented; primary visual anchor still the Panel 2 6-cell KPI strip per 14A)
- [ ] Dimension 3 Color: PASS (60/30/10 inherited; A11Y-01 forbidden-as-text rule extended to 4 new panels; DESIGN-01 audit list complete)
- [ ] Dimension 4 Typography: PASS (4-size/2-weight contract inherited; CHART_TICK_STYLE on every new chart axis; H3 sub-heading roster documented)
- [ ] Dimension 5 Spacing: PASS (4px ladder inherited; phase-specific applications all use existing tokens)
- [ ] Dimension 6 Registry Safety: PASS (no registry; no third-party blocks; new dep is npm-only and trusted)

**Approval:** pending (gsd-ui-checker upgrades to approved).

---

*Phase 14b UI-SPEC — drafted 2026-04-29 by gsd-ui-researcher. Status:
draft (checker upgrades to approved). Inherits Phase 14a UI-SPEC §1-10
verbatim; documents only Phase 14b-specific additions: Panel 4-7
sub-component layouts, DailyHeatmap dual renderer, lazy lifecycle copy,
axe-core CI contract, keyboard nav focus order with skip-links, chart-
snapshot parity tolerance ±2% per panel / ±5% full page, 12 new
components, 4 new Playwright specs, flag flip OFF→ON in final commit.*
