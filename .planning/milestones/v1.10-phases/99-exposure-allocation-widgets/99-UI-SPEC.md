---
phase: 99
slug: exposure-allocation-widgets
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-12
---

# Phase 99 — UI Design Contract: Exposure & Allocation Widgets (PI-01/02/03)

> Design contract for the three Portfolio-Intelligence widgets rendered on the
> Phase-98 read layer (`src/lib/portfolio-exposure.ts`). Decisions below were
> DELEGATED to the Fable UI researcher (99-CONTEXT.md) and are stated with
> rationale. Consumers: gsd-planner (tasks), gsd-executor (visual source of
> truth), gsd-ui-checker / design-review (validation).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (no `components.json`; established in-house system — DESIGN.md + Tailwind v4 `@theme` tokens in `src/app/globals.css`) |
| shadcn gate | **Not applicable — do NOT initialize shadcn.** The project has a mature bespoke design system (DESIGN.md, Card primitive, `chart-tokens.ts`, drift-gated type spine). Introducing shadcn would violate DESIGN.md conformance and Rule 11. |
| Component library | In-house: `src/components/ui/Card.tsx`, `src/components/ui/Skeleton.tsx`, recharts (charts), `TouchTooltip` |
| Icon library | none needed for this phase (no icons in these widgets; identity carried by type + color per Trust-Tier precedent) |
| Fonts | DM Sans (body/labels), Geist Mono `font-metric` tabular-nums (ALL numbers), Instrument Serif (not used here — no page titles in scope) |

**DESIGN.md conformance:** full, with ONE documented geometric adaptation of
the gap-seam convention (§ Gap Rendering below) — flagged for design-review.
No new colors, no new type sizes, no raw `text-[Npx]` (lint is repo-wide
`error`; numeric `fontSize` inside recharts/SVG props follows the existing
chart idiom, e.g. `AttributionBar.tsx:26`).

---

## Data Contract (LOCKED — design binds to these exactly)

| Widget | Read (server-only) | Shape |
|--------|--------------------|-------|
| PI-01 Exposure by Asset Class | `getLatestExposureSnapshot(userId)` | `ExposureSnapshot \| null` — slices at (holdingType, venue, symbol, side) grain, `totalGrossUsd`, `totalNetUsd`, `asof` |
| PI-02 Net Exposure Over Time | `getNetExposureSeries(userId)` | `{ points: {asof, netUsd, grossUsd}[], gaps: AsofGap[] }` (interior calendar holes marked) |
| PI-03 Allocation Over Time | `getAllocationSeries(userId)` | `{ points: {asof, venues:{venue,valueUsd,weight}[]}[], gaps: AsofGap[] }` (zero-gross asofs skipped + marked, **including boundary spans** per F-2) |

**Data flow / auth (locked, rls-auditor carry-forward):**
- `src/app/(dashboard)/allocations/page.tsx` (Server Component, already derives
  `user.id` from `supabase.auth.getUser()` and redirects unauthenticated) calls
  the three reads in `Promise.all` **alongside** `getMyAllocationDashboard`,
  and passes a serializable `exposure: { snapshot, netSeries, allocationSeries }`
  prop down through `AllocationsTabs {...props}` → `HoldingsTabPanel`
  (`AllocationsTabs.tsx:789` spreads the whole prop object).
- **Do NOT fold the reads into `getMyAllocationDashboard`** — that payload has a
  client refresh/poll path; the exposure reads are daily-grain (a 730-day paged
  scan) and must run once per page load, not per poll.
- Widgets are `"use client"` components consuming plain JSON props. They never
  import a Supabase client, never re-query `allocator_holdings`.
- **Errors are not empty states.** The read layer throws on PostgREST errors; a
  throw propagates to the existing `allocations/error.tsx` boundary. A widget
  MUST NOT catch a read error and render the honest-empty copy (the read
  module's own contract: an error and `[]` are distinct states).

---

## Placement & Responsive Layout

**Mount point: `HoldingsTabPanel`** (`src/app/(dashboard)/allocations/HoldingsTabPanel.tsx`)
— a new **"Exposure"** section inserted between Section 1 (Strategies,
~line 136) and Section 2 (Exchange Positions, ~line 139).

Rationale (delegated decision):
1. **Data-density story:** the charts summarize exactly the raw positions the
   Exchange Positions tables beneath them display — summary above, ground
   truth below is the FactSet/Bloomberg reading order DESIGN.md names as
   reference. The demo beat is: Overview (equity + KPIs) → Holdings (exposure
   intelligence over live positions).
2. **Blast radius:** the Overview tab body is `FactsheetBody`-driven
   (`AllocationDashboardV2.tsx:140-148`), a renderer SHARED with the public
   factsheet route (second-consumer risk, cf. v1.9 discovery-detail lesson).
   Holdings is dashboard-only.
3. **Bundle:** `HoldingsTabPanel` is already `next/dynamic` with `ssr: false`
   (`AllocationsTabs.tsx:89-93`), so recharts and the three widgets stay out of
   the Overview/first-paint bundle with zero extra wiring.

Section anatomy (matches the existing Section-2 heading idiom at
`HoldingsTabPanel.tsx:141`):

```
<section aria-label="Exposure">
  <h3 class="text-sm font-semibold uppercase tracking-wider text-text-primary">Exposure</h3>
  <div class="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">   ← RiskTabPanel grid idiom (RiskTabPanel.tsx:34)
    [PI-01 ExposureByClass]   [PI-02 NetExposureChart]
    [PI-03 AllocationOverTime  — lg:col-span-2]
  </div>
</section>
```

- **≥1024px (lg):** PI-01 and PI-02 side-by-side; PI-03 full-width beneath
  (a stacked area needs the width). Unequal card heights in a 2-col grid are
  the accepted Risk-tab pattern.
- **<1024px:** single column, order PI-01 → PI-02 → PI-03.
- Each widget renders inside the `Card` primitive (`src/components/ui/Card.tsx`,
  `padding="sm"` → 16px): white surface, 1px `#E2E8F0` border, shadow-card.
- Card header row per widget: title in `text-small font-semibold text-text-primary`
  + right-aligned as-of stamp `text-caption font-metric text-text-muted`
  ("as of 2026-07-11"). PI-02/PI-03 stamp = last point's asof; PI-01 = `snapshot.asof`.
- Charts size via `ResponsiveContainer width="100%"` (H-0076 convention);
  fixed heights: PI-02 = 240px (parity with `NetGrossExposureChart`), PI-03 = 260px.

**Loading/skeleton:** data arrives as RSC props, so there is no per-widget
fetch state. Tab activation is covered by the existing `TabBodyFallback`
dynamic() fallback; route-level `loading.tsx` covers first paint. No new
skeletons. (If the planner later moves the reads behind Suspense, fallback =
`Skeleton` blocks at the exact final heights to prevent CLS.)

---

## Widget 1 — PI-01 Exposure by Asset Class

**Component:** NEW — `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx`
(the path TODOS.md Widget 28 originally reserved).

**Chart type: segmented horizontal composition bar + KPI strip + drilldown
table. NOT a donut, NOT a treemap.** Rationale:
- The primary class dimension has exactly TWO values (`spot`/`derivative`,
  D-P1). A donut over a 2-value dimension is weak, and a single-class book
  renders a misleading full circle. A treemap over ≤2 classes × a few venues
  is decoration (DESIGN.md: minimal decoration, data does the work).
- `CompositionDonut.tsx` (`src/components/portfolio/CompositionDonut.tsx`) is
  strategy-weight-specific (TWR/Sharpe columns, Total-AUM center label) —
  wrong semantics to adapt; its **donut+table anatomy** is however the reuse
  precedent for "chart + dense table" and its table idiom is reused below.
- `AttributionBar.tsx` renders signed ± contribution bars (different semantic;
  rejected).

Anatomy, top to bottom:

1. **KPI strip** — 4 cells in one row (`grid grid-cols-2 sm:grid-cols-4 gap-4`):
   `GROSS` / `NET` / `LONG` / `SHORT`. Labels: `text-micro uppercase
   tracking-wider text-text-muted`. Values: `text-h3 font-semibold font-metric
   text-text-primary`, `formatCurrency`. NET shows the sign in the number and a
   `text-caption text-text-muted` sub-caption "net long" / "net short" / "flat".
   **No red/green on direction** — long/short is not P&L; semantic colors stay
   reserved (DESIGN.md: negative = losses/permanent failure only).
   LONG = Σ `signedValueUsd > 0` slices; SHORT = Σ |short slices| (derivable
   from the slices — no invented data).
2. **Composition bar** — one horizontal bar, `h-3 rounded-sm`, on a
   `bg-track` (#F1F5F9) rail; segments sized by share of `totalGrossUsd`:
   spot = `#1B6B5A` (CHART_ACCENT), derivative = `#0F172A` (dark navy — the
   sidebar neutral, non-semantic, distinguishable from teal by hue AND
   lightness). 1px white seam between segments. Plain CSS flex divs — no
   recharts needed.
3. **Legend row** beneath the bar — one entry per class, ALWAYS BOTH classes:
   `▪ Spot · $1.24M (62.0%)` / `▪ Derivatives · $760K (38.0%)` — swatch
   `w-2.5 h-2.5 rounded-sm` + `text-small` name + `font-metric` value.
   **Single-class book:** the bar renders one full-width segment; the absent
   class stays in the legend as `▪ Derivatives · —` in `text-text-muted`, so
   "100% spot" reads as a deliberate, labeled fact — no radial geometry, no
   misleading full circle, and the absent class is explicitly declared rather
   than silently dropped.
4. **Drilldown table** — the per-symbol/venue grain (slices sorted by
   `valueUsd` desc). Table idiom copied from `CompositionDonut.tsx:71-99`
   (`text-small`, caption uppercase header row with bottom border, hairline
   `border-border/50` rows, hover `bg-page/50`, numerics right-aligned
   `font-metric`). Columns: **Venue / Symbol / Type / Side / Gross / Net**.
   Type cell = "Spot"/"Deriv" with the class swatch dot; Side = plain
   lowercase `text-caption text-text-secondary` ("long"/"short"/"flat");
   Net = `signedValueUsd` via `formatCurrency` (minus sign carries direction).
   \>12 rows → `max-h-64 overflow-y-auto` scroll region (keep the header
   sticky is NOT required; simple scroll).

**Empty state (`snapshot === null` — zero holdings OR >730d stale, W4):**
the section-level empty card idiom (`AttributionBar.tsx:12-16`):
`rounded-lg border border-border bg-surface px-4 py-8 text-center`.
Copy (verbatim, two lines):
- `text-small text-text-muted`: **"No position snapshot yet."**
- `text-caption text-text-muted`: **"Exposure appears after your first exchange sync. Snapshots older than 24 months are not shown."**
No CTA — the dashboard-level `EmptyState.tsx` owns the Connect-Exchange CTA
(zero-holdings allocators never reach this tab body); the second line makes
the W4 stale-beyond-cap case honest instead of invisible.

**A11y:** the bar container gets `role="img"` +
`aria-label="Gross exposure split: Spot {x}%, Derivatives {y}%"` (the
CoverageTimeline precedent — aria-label on a role-less div is ignored by AT).
The table is a real `<table>`. Class identity is carried by label + position,
not color alone (WCAG 1.4.1).

---

## Widget 2 — PI-02 Net Exposure Over Time

**Component:** NEW — `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx`
(the path TODOS.md Widget 29 reserved).

**Chart type: recharts `ComposedChart` — gross as filled Area + net as Line,
BOTH shown.** Net alone would hide a hedged book (D-P2's whole point: long 300
+ short 100 = net 200 / gross 400 — the gross band IS the leverage/hedging
story, and it is the demo moment). Adapted from the existing
`NetGrossExposureChart` recipe (`src/components/charts/NetGrossExposureChart.tsx`)
— **recipe reuse, not import**, because: (a) it takes dimensionless ratios with
a % axis, ours is USD; (b) it has no gap support; (c) `src/components/charts/**`
is the design-lint-exempt frozen glob (`eslint.config.mjs` off-glob) — NEW code
must not land there or it dodges the repo-wide `no-raw-font-px` gate.

Visual contract (all tokens from `src/components/charts/chart-tokens.ts`):
- **Gross:** `<Area type="monotone" dataKey="grossUsd" fill={CHART_ACCENT}
  fillOpacity={0.2} stroke="none" />` (NetGrossExposureChart parity).
- **Net:** `<Line type="monotone" dataKey="netUsd" stroke={CHART_ACCENT}
  strokeWidth={1.5} dot={false} />`.
- **Zero line:** `<ReferenceLine y={0} stroke={CHART_TEXT_MUTED}
  strokeDasharray={CHART_REFERENCE_DASH} />` — net long vs net short at a glance.
- **X-axis:** `type="number"`, epoch-ms from `asof` (UTC), calendar-linear —
  see Gap Rendering for why. Ticks `CHART_TICK_STYLE`, `tickLine={false}`,
  `axisLine={{ stroke: CHART_BORDER }}`, formatter `MM-DD` (`d.slice(5)`
  equivalent on the formatted date) with year shown when the window spans years.
  Domain = `[min(firstPoint, firstGap.start), max(lastPoint, lastGap.end)]`.
- **Y-axis:** compact USD (`$1.2M`, `$450K`), `CHART_TICK_STYLE`, no axis line.
- **Tooltip:** `TouchTooltip` + `CHART_TOOLTIP_STYLE`; rows "Net $X" / "Gross $Y",
  label = full `asof` date.
- **Legend:** two inline chips above the chart (swatch + "Net" / "Gross",
  `text-caption text-text-secondary`) — NOT recharts `<Legend>` (keeps the
  card header single-row per the EquityChartWidget header pattern).
- `accessibilityLayer={false}` (2026-04-30 codebase-wide decision);
  wrapper `role="img" aria-label="Net and gross exposure over time in US dollars"`.
- Height 240, `ResponsiveContainer width="100%"`.

**Honest-zero vs gap:** `getNetExposureSeries` emits real `{net: 0, gross: 0}`
points for observed zero-gross days — these render as genuine points at 0 (a
flat book is a fact, not a gap). Only the returned `gaps` spans render as gaps.

**Empty state (`points.length === 0`):** same empty-card idiom. Copy:
- **"No exposure history yet."**
- caption: **"The series builds as daily position snapshots accrue."**

---

## Widget 3 — PI-03 Allocation Over Time

**Component:** NEW — `src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx`
(the path TODOS.md Widget 18 reserved).

**Chart type: stacked area (recharts, `stackId`), y-axis 0–100%. NOT a
streamgraph** — a streamgraph's wiggle baseline is decorative and destroys
value readability (DESIGN.md: no decorative elements; the numbers speak).
Weights already sum to 1 per point (gross denominators, D-P3), so the stack
totals a flat 100% ceiling by construction.

- **Series:** one `<Area>` per venue, `stackId="alloc"`, `type="monotone"`,
  `fillOpacity={0.85}`, `stroke="#FFFFFF"` `strokeWidth={1}` (white hairline
  seams between bands, mirroring CompositionDonut's slice seams).
- **Venue order & color:** venues sorted by mean weight desc; largest at the
  BOTTOM of the stack (stable reading base). Colors: `STRATEGY_PALETTE[i]`
  (`src/lib/utils.ts:120` — the design-system-approved categorical palette,
  no purples). Venue→color assignment fixed by that sorted order.
- **Data pivot:** rows `{asofMs, [venue]: weight}`; a venue absent at an asof
  gets weight **0** — this is the TRUE weight (that day's gross sits entirely
  at other venues), not invented data.
- **Legend:** chips above the chart — swatch + venue name, `text-caption`,
  wrap with `gap-x-4 gap-y-1`.
- **X/Y axes:** X identical to PI-02 (numeric epoch-ms, calendar-linear,
  domain spans gap edges). Y: `0–1` domain, formatter `${(v*100).toFixed(0)}%`,
  `CHART_TICK_STYLE`.
- **Tooltip:** `TouchTooltip`; per-venue rows sorted by weight desc:
  `"Binance — 42.3% ($1.24M)"` (weight 1dp + gross USD from `valueUsd`).
- `accessibilityLayer={false}`; wrapper `role="img"
  aria-label="Per-venue allocation weights over time"`.
- Height 260, `lg:col-span-2` full width.
- **Single-venue book:** one 100% band + its legend chip — honest, no special
  casing.

**Gap spans (F-2 boundary + interior):** identical treatment to PI-02 (below).
Because `computeCoverageGaps` marks skipped zero-gross asofs at the series
BOUNDARY too, the x-domain MUST be
`[min(firstPoint, firstGap.start), max(lastPoint, lastGap.end)]` so a
leading/trailing gap band renders as a visible marked span at the edge instead
of being clipped out — this is the whole point of F-2. Executor test intent:
a fixture whose FIRST asof is zero-gross must render a hatched band before the
first stacked point.

**Empty state (`points.length === 0`):** empty-card idiom. Copy:
- **"No allocation history yet."**
- caption: **"Per-venue weights build as daily position snapshots accrue."**

---

## Gap Rendering (PI-02 + PI-03 — shared contract)

Locked invariant: gaps are MARKED, never zero-filled, never bridged.

**Mechanism (both charts):**
1. **Break the line/stack:** inject ONE null-valued sentinel row per gap span
   (x = mid-gap epoch-ms, all series values `null`) into the chart data;
   every `<Area>`/`<Line>` sets `connectNulls={false}` → recharts visibly
   breaks the path across the gap. The line NEVER draws through a gap.
2. **Mark the span:** a `<ReferenceArea x1={gapStartMs - 12h} x2={gapEndMs + 12h}>`
   per gap (the ±12h half-day pad gives a 1-day gap a visible width at daily
   grain), filled with the factsheet hatch texture: an SVG `<pattern>` in
   `<defs>` (rendered as a child inside the chart) — `patternUnits=
   "userSpaceOnUse" width=6 height=6 patternTransform="rotate(45)"`, line
   stroke `var(--color-text-muted)` `strokeOpacity 0.15` `strokeWidth 3` —
   byte-matching the factsheet seam pattern (`TimeSeriesChart.tsx:299-310`).
   Unique pattern id per widget instance to avoid `<defs>` collisions.
3. **Label:** centered above the band, `"{days}d — no data"` — verbatim the
   factsheet label copy — `fontSize 10, fontFamily var(--font-mono),
   fill var(--color-text-muted)`; rendered only when `gap.days >= 5`
   (deterministic, testable; below that the band would clip the label at
   daily grain). EVERY band carries an SVG `<title>`:
   `"No data {start} → {end} ({days} days)"` regardless of size.

**Documented adaptation of the factsheet convention (flag for design-review):**
the factsheet renders gaps as zero-width hatched SEAMS because its x-axis is
index-based — gap days are absent from the axis, so a gap has no width there
(`TimeSeriesChart.tsx:285-289`). These widgets use a calendar-linear numeric
x-axis, where a gap HAS true temporal width; the honest equivalent is a
proportional hatched band. Texture, color, opacity, and label copy are
identical to the factsheet seam — the convention's geometry adapts to the axis
model, its language does not. (An index-based axis was rejected: it would
compress a 90-day outage to the same width as a 1-day hole — visually
understating missing coverage, the opposite of "honest".)

---

## Reuse vs Build — summary

| Widget | Decision | Cited files |
|--------|----------|-------------|
| PI-01 | **Build new** `widgets/positions/ExposureByClass.tsx`; reuse the CompositionDonut TABLE idiom + Card/formatCurrency/font-metric | `src/components/portfolio/CompositionDonut.tsx` (donut rejected: 2-value class dim, single-class full-circle hazard; table idiom reused), `src/components/portfolio/AttributionBar.tsx` (empty-card idiom reused; bars rejected) |
| PI-02 | **Build new** `widgets/positions/NetExposureChart.tsx` adapting the NetGrossExposureChart recipe (Area+Line+zero-refline) with USD axis + gap contract | `src/components/charts/NetGrossExposureChart.tsx` (recipe), `src/components/charts/chart-tokens.ts`, `src/components/charts/TouchTooltip.tsx` |
| PI-03 | **Build new** `widgets/allocation/AllocationOverTime.tsx` (no existing stacked-area exists) | `src/lib/utils.ts:120` STRATEGY_PALETTE, chart-tokens, TouchTooltip |
| Rejected reuse | `AllocationTimeline.tsx` (event LIST of deposits/withdrawals — different data entirely); `CorrelationHeatmap`, `BenchmarkComparison`, `InsightStrip` (unrelated semantics); factsheet `TimeSeriesChart` (FROZEN island — any byte edit reds the frozen-spine guard; convention mirrored, code untouched) | `src/components/portfolio/AllocationTimeline.tsx`, `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` |

New widgets live under `src/app/(dashboard)/allocations/widgets/` (positions/,
allocation/) matching the retired Widget-18/28/29 paths. They are mounted by
DIRECT import from `HoldingsTabPanel` (the EquityChart/Overview precedent) —
NOT added to the `WIDGET_COMPONENTS` barrel, whose scope is B7b-locked to
RiskTabPanel consumers (`widgets/index.ts:8-11`).

---

## Spacing Scale (project ladder — DESIGN.md, unchanged)

| Token | Value | Usage here |
|-------|-------|-----------|
| 1 | 4px | swatch↔label gaps |
| 2 | 8px | KPI cell internal stack |
| 3 | 12px | heading → grid (`mt-3`) |
| 4 | 16px | Card `padding="sm"`, grid `gap-4` |
| 6 | 24px | section gap above/below the Exposure section |

Exceptions: none. (`--space-grid-gap` 10px is NOT used — that token is
WidgetGrid/Bridge-scoped; this section uses the standard `gap-4` Risk-tab grid.)

---

## Typography (named tiers only — no raw px classes)

| Role | Tier | Weight |
|------|------|--------|
| Section heading | `text-sm` + `font-semibold uppercase tracking-wider` (matches HoldingsTabPanel:141 idiom verbatim) | 600 |
| Widget title | `text-small` | 600 |
| KPI values | `text-h3` + `font-metric` (Geist Mono tabular-nums) | 600 |
| KPI labels | `text-micro uppercase tracking-wider` | 400 |
| Table cells / legend | `text-small`; numerics `font-metric` | 400 |
| Captions / as-of stamps | `text-caption`, muted | 400 |
| Chart ticks/tooltips | `CHART_TICK_STYLE` / `CHART_TOOLTIP_STYLE` (12px Geist Mono #64748B — the blessed chart-tick contract) | 400 |
| In-SVG gap label | numeric `fontSize 10` mono muted (factsheet-seam parity; SVG prop, not a class — lint-clean) | 400 |

Two weights total (400/600), per the v2 type-contract precedent.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant | #FFFFFF surface on #F8F9FA page | Cards, chart canvas |
| Secondary | #E2E8F0 border, #F1F5F9 track | Hairlines, bar rail |
| Accent | #1B6B5A | Spot segment, gross area fill (0.2), net line — the "verified data" identity |
| Categorical (PI-01 class 2) | #0F172A | Derivative segment (neutral navy, non-semantic) |
| Categorical (PI-03 venues) | `STRATEGY_PALETTE` in order | Venue bands + legend swatches |
| Muted | #64748B / #94A3B8 | Ticks, gap labels/hatch, zero-refline |

Accent reserved for: spot segment, net/gross series, nothing else in this
phase. **Explicitly forbidden:** red/green on long/short direction (semantic
colors stay reserved: green=gains, red=losses/permanent failure); warning
amber (nothing here is a recoverable-transient state).

---

## Copywriting Contract (verbatim strings)

| Element | Copy |
|---------|------|
| Section heading | `Exposure` |
| PI-01 title | `Exposure by asset class` |
| PI-02 title | `Net exposure over time` |
| PI-03 title | `Allocation over time` |
| As-of stamp | `as of {YYYY-MM-DD}` |
| PI-01 empty | `No position snapshot yet.` / `Exposure appears after your first exchange sync. Snapshots older than 24 months are not shown.` |
| PI-02 empty | `No exposure history yet.` / `The series builds as daily position snapshots accrue.` |
| PI-03 empty | `No allocation history yet.` / `Per-venue weights build as daily position snapshots accrue.` |
| Gap label | `{days}d — no data` (≥5-day gaps) |
| Gap `<title>` | `No data {start} → {end} ({days} days)` |
| Absent class legend | `Derivatives · —` (or `Spot · —`) |
| Net direction caption | `net long` / `net short` / `flat` |
| Errors | none rendered by widgets — read errors propagate to `allocations/error.tsx` (ErrorEnvelope). Never render empty-state copy on an error. |
| Destructive actions | none in this phase |

---

## Verification intents for the planner (test contract, not tasks)

1. Gap honesty (PI-02/PI-03): fixture with an interior gap → line/stack path
   breaks (`connectNulls={false}` + null sentinel present), hatched band
   rendered, NO point inside the span, never a zero-filled bridge.
2. F-2 boundary gap (PI-03): fixture whose first asof is zero-gross → a marked
   band renders BEFORE the first point (x-domain includes the gap edge).
3. Honest empty: `null` snapshot / empty points → exact copy above; a thrown
   read error must NOT produce that copy (error boundary path).
4. Single-class (PI-01): full-width single segment + absent-class `· —` legend row.
5. Hedged book (PI-01/PI-02): long 300 + short 100 fixture → NET 200 / GROSS
   400 rendered (D-P2 signed math surfaces visually).
6. No `createAdminClient` / no direct `allocator_holdings` query import in any
   widget or in the new page.tsx wiring (grep gate).
7. Carry-forward (99-CONTEXT): >1000-row live-allocator render check pins the
   Phase-98 pagination fix end-to-end.
8. `accessibilityLayer={false}` on every new recharts chart (pinned pattern,
   `tests/visual/chart-accessibility-layer.test.ts` will catch regressions).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none — shadcn not used | not applicable |
| third-party | none | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
