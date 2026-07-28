---
phase: 14a
phase_name: "Single-Strategy v2 — Eager Panels + Identity"
status: draft
design_system: manual (no shadcn; project owns DESIGN.md tokens)
gathered: 2026-04-29
revised: 2026-04-29 (typography weights consolidated to exactly 2 — see §0 notes; error-boundary CTA copy revised to verb+noun)
sources:
  - REQUIREMENTS.md (KPI-01..05, KPI-22, KPI-23a, DESIGN-01..03, A11Y-01, CLEANUP-01)
  - 14A-CONTEXT.md (locked decisions on routing, flag, scope, placeholder UI, tokens, tests)
  - DESIGN.md (project identity contract — authoritative)
  - src/components/charts/chart-tokens.ts (existing token surface)
  - src/components/charts/{EquityCurve,DrawdownChart,WorstDrawdowns}.tsx (reusable assets)
  - src/lib/widget-state-flag.ts (flag pattern reference)
  - src/app/strategy/[id]/page.tsx (v1 public factsheet pattern to mirror)
  - src/app/globals.css (CSS-variable token home)
---

# UI-SPEC — Phase 14a: Single-Strategy v2 (Eager Panels + Identity)

> **Design contract for `/strategy/[id]/v2`** — what the planner schedules and the
> executor implements. DESIGN.md is the upstream authority; this spec resolves
> ambiguity for the 7-panel scrollable shell, three eager panel bodies (Overview /
> Headline+Equity / Drawdown), four lazy placeholders, and the identity baseline
> (`CHART_TICK_STYLE` token, WCAG-AA chart-axis test, `@nivo/boxplot` removal,
> UC#7 density-rule decision-log entry).

---

## 0. Resolved upstream

| Decision | Locked by | Value |
|---|---|---|
| Public route at `/strategy/[id]/v2` | 14A-CONTEXT.md | `src/app/strategy/[id]/v2/page.tsx`, mirrors v1 server-component pattern |
| Flag default = OFF in Phase 14a | 14A-CONTEXT.md | `strategy.ui_v2` localStorage key; URL override `?strategy_v2=on\|off` |
| Eager scope = panels 1–3 only | 14A-CONTEXT.md / KPI-22 | Panel 2 segmented: Cum + Underwater bodies eager; Rolling Sharpe + Log Returns disabled |
| Panels 4–7 = placeholder cards w/ "Loading…" | 14A-CONTEXT.md | IntersectionObserver-mounted; `data-panel-status="placeholder"` |
| BTC overlay default-ON | KPI-04 / DIFF-03 | Cumulative + Underwater both render BTC overlay by default |
| Token home = `chart-tokens.ts` | 14A-CONTEXT.md | Add `CHART_TICK_STYLE`; reuse existing `CHART_AXIS_TICK = #64748B` |
| Test paths = `tests/a11y/`, `tests/visual/`, `tests/e2e/` | 14A-CONTEXT.md | Top-level dirs (deviation from co-located convention; documented) |
| Lazy hook abstraction = `useLazyPanelMetrics` | 14A-CONTEXT.md | Lives at `src/hooks/useLazyPanelMetrics.ts` |
| `@nivo/boxplot` cleanup | CLEANUP-01 | Uninstall; `ReturnQuantiles.tsx` is hand-rolled SVG |
| DESIGN.md decisions log entry | DESIGN-03 | UC#7 7-panel density-rule deviation, stamped at phase ship |

### Notes (revision 2026-04-29 — checker re-spin, iteration 2)

- **Typography scale consolidated to exactly 4 sizes (12 / 16 / 18 / 32).** Prior
  draft declared 6 sizes (11, 12, 13, 16, 18, 32) which exceeds the 4-size
  ceiling. Path-A consolidation applied: chart axis ticks moved 11px → 12px (the
  DESIGN.md "Caption" tier — 12px Geist Mono `tabular-nums` at `#64748B` is well
  within WCAG AA on `#FFFFFF`); panel sub-headings (H3) moved 13px → 12px and
  differentiate via `uppercase tracking-wider` transform (NOT weight) instead
  of size. The wider DESIGN.md scale (which includes 11px/13px/14px/24px tiers
  used elsewhere in the project) remains the project superset; the v2 single-
  strategy contract is a deliberate 4-size subset (12 / 16 / 18 / 32).
  DESIGN.md decisions-log entry §12 records this.
- **Typography weights consolidated to exactly 2 (400 regular / 600 semibold).**
  Iteration 1 carried a third weight (500 medium) for H3 sub-headings; the
  2-weight rule is non-negotiable per the design-quality contract. H3 sub-
  headings now render as `font-normal uppercase tracking-wider` (weight 400 +
  uppercase + wider tracking) — the transform plus letterspacing carry
  sufficient heading separation without a third weight. The fallback path
  noted in iteration 1 IS now the contract.
- **Primary visual anchor (Dimension 2 FLAG resolution).** See §4 — the 6-cell
  KPI strip in Panel 2 is the first data element to draw the eye; the 32px
  Instrument Serif H1 above it is intentionally secondary in visual weight.
- **Segmented control labels are view-selector descriptors, not action CTAs**
  (Dimension 1 FLAG resolution). `Cumulative` / `Underwater` / `Rolling Sharpe`
  / `Log returns` are intentional single-word view-selector descriptors
  matching QuantStats / FactSet conventions for chart view toggles. Industry-
  standard for this surface; locked in CONTEXT.md.
- **Error-boundary CTA copy revised** (Dimension 1 FLAG resolution, iteration
  2): primary action `Try again` → `Reload strategy` (verb + noun). See §5.5
  and §7.

---

## 1. Spacing

The project uses DESIGN.md's 4px base ladder (`2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`).
Phase 14a inherits this verbatim — no new spacing tokens introduced.

| Use | Value | Token / class |
|---|---|---|
| Panel inner gap (heading → body) | 16px | `gap-4` / `mb-4` |
| Card padding (panel body, default) | 24px | `p-6` |
| Card padding (compact, e.g. KPI strip cell) | 16px | `p-4` |
| Gap between top-level panels (vertical scroll) | 32px | `space-y-8` on shell wrapper |
| Gap between cells inside a panel grid | 12px | `gap-3` |
| Page horizontal padding (≥1100px container) | 24px | `px-6` |
| Outer page max width | 1200px | custom `max-w-[1200px]` (wider than v1's 1100px to fit 6-cell strip) |
| Panel min-height (placeholder) | 240px | `min-h-[240px]` — preserves layout shape on lazy mount |
| Section gap above per-panel partial-data banner | 8px | `mb-2` between heading and "Awaiting more data…" copy |

**Exception:** none. The `--space-grid-gap: 10px` Bridge/WidgetGrid token is NOT
used on `/strategy/[id]/v2` — that token is reserved for the allocator dashboard
4-col grid. Panel 14a layouts use the standard 4px ladder.

---

## 2. Typography

Inherit a **4-size subset** of DESIGN.md (12 / 16 / 18 / 32) with the standard
**2-weight rule (400 regular / 600 semibold)**. The wider DESIGN.md scale
(which also includes 10–11px micro, 13px small, 14px body, 24px H2) remains
the project superset; this phase deliberately restricts itself to a tight
4-size / 2-weight contract for the single-strategy v2 surface.

### Sizes (in scope for this phase)

| Size | Family / weight | Use |
|---|---|---|
| **32px** | Instrument Serif (regular 400) | Strategy name (page H1). Reuse v1 pattern at `src/app/strategy/[id]/page.tsx:121` |
| **18px** | Geist Mono semibold (600) tabular-nums | KPI metric values (Panel 2 6-cell strip; Panel 1 cell values). `font-metric` utility class already shipped |
| **16px** | DM Sans semibold (600) | Panel heading (H2) above each `<section data-panel>` |
| **12px** | DM Sans / Geist Mono regular (400) — see column | Everything else (caption tier): cell labels, sub-headings, table cells, axis ticks, tooltip body, banner copy, disabled-button labels |

### 12px tier — differentiated by family + transform (NOT size, NOT weight)

| Use | Family / weight / transform |
|---|---|
| Body label / cell label ("Awaiting more data" copy, `Supported exchanges`, etc.) | DM Sans regular (400), `text-text-muted` (`#718096`) |
| Panel sub-heading (H3, e.g. "Equity vs BTC", "Worst 5 Drawdowns") | DM Sans regular (400) `uppercase tracking-wider`, `text-text-secondary` (`#4A5568`) |
| Disabled segmented-button label ("Available in Phase 14b") | DM Sans regular (400), `text-text-muted opacity-60` |
| Worst 5 table cell (Peak / Trough / Recovery / Depth / Days) | Geist Mono regular (400) tabular-nums, `text-text-primary` |
| Tooltip body | Geist Mono regular (400) tabular-nums (reuses `CHART_TOOLTIP_STYLE`) |
| **Chart axis tick** | **Geist Mono regular (400) tabular-nums** — `CHART_TICK_STYLE` (NEW token) |

H3 sub-headings (`Equity vs BTC`, `Worst 5 Drawdowns`) read as headings not
body because of the `uppercase tracking-wider` transform — the size matches
the body tier deliberately and the weight matches body too, so the type
system stays at exactly 4 sizes and exactly 2 weights. Letterspacing +
uppercase carry the heading distinction.

### Weights (exactly 2 — non-negotiable)

| Weight | Use |
|---|---|
| **400 (regular)** | Body, labels, axis ticks, tooltip values, table cells, **H3 sub-headings (paired with `uppercase tracking-wider`)**, disabled button labels, page H1 (Instrument Serif renders at 400 — its serif character is the gravitas, not the weight) |
| **600 (semibold)** | Panel H2 (16px DM Sans), KPI metric values (18px Geist Mono) |

No third weight permitted. `font-medium` (500), `font-light` (300), and
`font-bold` (700) MUST NOT appear inside `src/components/strategy-v2/**/*.tsx`.
Allowed Tailwind weight classes: `font-normal` (400) and `font-semibold`
(600) only. Grep enforced — see §9.

### Line heights

| Use | Value |
|---|---|
| Body (default) | 1.5 |
| Panel headings (H2, 16px) | 1.25 |
| Page H1 (32px Instrument Serif) | 1.1 |
| KPI metric values (18px) | 1.1 (tight, single-line) |
| Chart tooltip | 1.4 |

### `CHART_TICK_STYLE` token (NEW — DESIGN-02 mitigation, Pitfall 14)

Add to `src/components/charts/chart-tokens.ts`:

```ts
/**
 * Recharts <text> SVG elements don't inherit font-variant-numeric from a
 * parent CSS class. Spread this object directly on <XAxis tick={...}> /
 * <YAxis tick={...}> so chart axis ticks render in tabular-nums.
 *
 * Pitfall 14 mitigation. Centralized fix for DESIGN-02. fontSize: 12 matches
 * the v2 caption tier (DESIGN.md 12px caption) — well within WCAG AA at
 * #64748B on #FFFFFF.
 */
export const CHART_TICK_STYLE = {
  fontFamily: CHART_FONT_MONO,
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  fill: CHART_AXIS_TICK,
} as const;
```

Every Recharts `<XAxis>` and `<YAxis>` rendered inside `/strategy/[id]/v2`
panels MUST spread this token — `tick={CHART_TICK_STYLE}` — replacing today's
verbose `tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily:
CHART_FONT_MONO }}` shape used at `DrawdownChart.tsx:27,34`. The grep pattern
`tick=\{\{` against v2 panel files MUST return zero matches at PR review.

The 11px → 12px move is intentional: it consolidates the v2 type scale to the
4-size contract (12 / 16 / 18 / 32) and uses the DESIGN.md "Caption" tier.
Recharts SVG text at 12px renders crisper at typical zoom levels and remains
unambiguously WCAG-AA compliant at `#64748B` on `#FFFFFF` (4.85:1).

---

## 3. Color

Inherit the **60 / 30 / 10 contract** from DESIGN.md. No new color tokens.

### 60% — page surface

| Token | Hex | Use in 14a |
|---|---|---|
| `--color-page` | `#F8F9FA` | `/strategy/[id]/v2` page background |

### 30% — secondary surfaces

| Token | Hex | Use in 14a |
|---|---|---|
| `--color-surface` | `#FFFFFF` | Every panel card, every chart container |
| `--color-surface-subtle` | `#FBFCFD` | (Reserved) — not used in 14a |
| `--color-border` | `#E2E8F0` | Card borders (1px), gridlines, table-row separators |
| `--color-track` | `#F1F5F9` | Chart vertical/horizontal gridlines (lightweight-charts only — Recharts uses `CHART_BORDER`) |

### 10% — accent + semantic

Accent is **reserved for**:

| Element | Color |
|---|---|
| Equity-curve strategy series stroke (Panel 2) | `CHART_ACCENT` (`#1B6B5A`) |
| Drawdown area stroke + gradient (Panel 2 Underwater + Panel 3 full) | `CHART_ACCENT` |
| Active segmented-button background (Panel 2 control) | `CHART_ACCENT` text on `bg-card` border-bottom |
| Panel heading underline (if any) | NONE — no decorative underlines per DESIGN.md |
| Verified badge on H1 | `CHART_ACCENT` (reuse `<VerifiedBadge />`) |
| Focus ring on segmented buttons | `--color-border-focus` (`#1B6B5A`) |

**Forbidden as accent:** any hex other than `#1B6B5A` for strategy series. Bright
teal `#0D9488` (currently in `EquityCurve.tsx:39,45`) MUST be replaced as part
of DESIGN-01 audit during this phase — the chart already imports
`chart-tokens.ts` neighbors and should use `CHART_ACCENT`.

### Second semantic — destructive / loss

| Element | Color |
|---|---|
| Drawdown depth cell text (Worst 5 table) | `--color-negative` (`#DC2626`) |
| Negative KPI strip cells (Cum Return, CAGR when < 0) | `--color-negative` |
| Negative Worst-Drawdown depth | `--color-negative` |

### Benchmark stroke (BTC overlay)

| Element | Color |
|---|---|
| BTC overlay line stroke (Panel 2 Cumulative + Underwater) | `CHART_TEXT_MUTED` (`#94A3B8`) |
| BTC overlay legend swatch | `CHART_TEXT_MUTED` |

**A11Y-01 forbidden-as-text contract:** `#94A3B8` and `#718096` MUST NEVER
appear as `fill` on a chart axis label, axis tick, or legend text. Enforced by
`tests/a11y/chart-contrast.test.ts` — grep over v2 panel imports + assertion
`getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5`.

### Positive (gain) — used in:

`--color-positive` (`#16A34A`) — KPI strip when Cum Return / CAGR / Sharpe / Sortino > 0.

### Disabled state (segmented-button placeholder buttons)

| Element | Color |
|---|---|
| Disabled button label | `--color-text-muted` (`#718096`) at `opacity-60` |
| Disabled button border | `--color-border` |
| Disabled button bg | `--color-surface` |
| Disabled cursor | `cursor-not-allowed` |
| `aria-disabled` | `"true"` |
| Title attribute (tooltip) | `"Available in Phase 14b"` |

---

## 4. Layout — 7-panel scrollable shell

**Primary visual anchor:** the 6-cell KPI strip (Panel 2) is the first data
element to draw the eye, providing immediate Cum / CAGR / Sharpe / Sortino /
Max DD / Vol read; the 32px Instrument Serif H1 above it provides brand-
identity gravity but is intentionally secondary in visual weight. Panels 1
(Overview cells) and 3 (Drawdown chart) form the secondary scan path; panels
4–7 placeholders are layout-shape-only until 14b lands.

### Top-level structure

```
<main class="min-h-screen bg-page">
  <div class="mx-auto max-w-[1200px] px-6 py-12">
    <header>...page H1 + verified badge + start_date...</header>

    <section data-panel="overview"          aria-label="Overview">             <!-- Panel 1 — eager body -->
    <section data-panel="headline-equity"   aria-label="Headline metrics & equity vs BTC">  <!-- Panel 2 — eager body -->
    <section data-panel="drawdown"          aria-label="Drawdown analysis">    <!-- Panel 3 — eager body -->
    <section data-panel="returns-distribution" aria-label="Returns distribution" data-panel-status="placeholder">  <!-- Panel 4 -->
    <section data-panel="rolling"           aria-label="Rolling metrics" data-panel-status="placeholder">  <!-- Panel 5 -->
    <section data-panel="trades"            aria-label="Trades & positions" data-panel-status="placeholder">  <!-- Panel 6 -->
    <section data-panel="exposure"          aria-label="Exposure & benchmark greeks" data-panel-status="placeholder">  <!-- Panel 7 -->
  </div>
</main>
```

**Hard count:** exactly 7 `<section data-panel>` direct children. Asserted by
`tests/visual/strategy-v2-panel-count.test.ts`.

### Panel container (white card, applies to ALL 7 panels)

| Attribute | Value |
|---|---|
| Background | `bg-card` (white `#FFFFFF`) |
| Border | `border border-border` (1px `#E2E8F0`) |
| Border radius | `rounded-lg` (8px) |
| Shadow | `shadow-[0_1px_3px_rgba(0,0,0,0.04)]` (DESIGN.md card spec) |
| Padding | `p-6` (24px) |
| Min-height (placeholder panels) | `min-h-[240px]` |
| Top margin between panels | `mt-8` (32px) |

### Panel 1 — Overview cards row (eager)

6 cells in a horizontal grid, falling to 3×2 below 980px:

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ Exchanges│   Types  │ Subtypes │  Markets │ Leverage │  Avg DTO │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

Each cell: 12px label (DM Sans regular, `text-text-muted` `#718096`) + 18px
value (Geist Mono semibold tabular-nums, `text-text-primary` `#1A1A2E`). Grid
gap = 12px (`gap-3`). No internal borders between cells (DESIGN.md "data
density > card density" — single-panel multi-cell, not 6 stacked cards).

Empty cell content: render `—` (em-dash, `text-text-muted`). Asserted by
KPI-23a partial-data spec on the 7-day fixture.

### Panel 2 — Headline metrics + Equity vs BTC (eager)

Two stacked sub-regions inside one card:

```
Top sub-region (6-cell KPI strip, full width):
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│  Cum Ret │   CAGR   │  Sharpe  │ Sortino  │  Max DD  │   Vol    │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

Hairline divider (border-t border-border, 1px) — no internal card borders

Bottom sub-region (segmented control + chart):
┌─────────────────────────────────────────────────────────────────┐
│ ┌─Cumulative ▾─┐ ┌─Underwater─┐ ┌─Rolling Sharpe (off)─┐ ┌─Log Returns (off)─┐  │
│ ☑ BTC Benchmark                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  EquityCurve OR DrawdownChart (sibling-mounted, hidden)    │ │
│ │  height = 350px (matches existing EquityCurve default)     │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

H3 sub-heading above the chart ("Equity vs BTC") uses
`text-xs font-normal uppercase tracking-wider text-text-secondary` (12px
DM Sans regular uppercase with wider tracking) — see §2.

**Segmented control specifics:**

| Button | State | Behavior |
|---|---|---|
| `Cumulative ▾` | active by default; ▾ glyph indicates default selection | Renders `<EquityCurve>` with BTC overlay default-ON |
| `Underwater` | enabled | Renders `<DrawdownChart>` with BTC underwater overlay (dashed muted line) |
| `Rolling Sharpe` | DISABLED in 14a | `aria-disabled="true"`, `cursor-not-allowed`, `title="Available in Phase 14b"` |
| `Log Returns` | DISABLED in 14a | Same as above |

Active button styling: `bg-card border border-accent text-accent` (1px accent
border on active; muted border on inactive). Disabled buttons: see §3 Disabled
state. Buttons are `<button type="button">` with `aria-pressed` for the active
control, NOT a radio group (allows 14b to add Mark/Taker tabs without
restructure).

Panel 2 BTC-overlay checkbox: render exactly once above the chart (NOT inside
each chart's per-component header). This is a v2-level affordance; the
per-component checkbox in `EquityCurve.tsx:104-115` MUST be hidden when
mounted inside Panel 2 (introduce a `hideBenchmarkToggle` prop on
`EquityCurve` if needed; planner's discretion). The Panel-2-level checkbox
default-ON wires through to whichever sub-chart is currently visible.

### Panel 3 — Drawdown (eager)

```
┌─────────────────────────────────────────────────────────────────┐
│  H3: "Drawdown"                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │   <DrawdownChart>  (full-width, height=250)              │ │
│  └───────────────────────────────────────────────────────────┘ │
│  Hairline divider (border-t border-border, 16px above & below)  │
│  H3: "Worst 5 Drawdowns"                                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │   <WorstDrawdowns>  (existing table, no changes)         │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Both H3 sub-headings ("Drawdown", "Worst 5 Drawdowns") use
`text-xs font-normal uppercase tracking-wider text-text-secondary` per §2.

`<DrawdownChart>` and `<WorstDrawdowns>` are reused as-is. No v2 fork.

### Panels 4–7 — Placeholder cards (lazy-mounted)

Each placeholder panel renders:

```
┌─────────────────────────────────────────────────────────────────┐
│  H2: "<Panel name>"          (DM Sans 16px semibold)            │
│                                                                 │
│  (vertically centered)                                          │
│  "Loading…"                  (DM Sans 12px text-text-muted)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Panel names (verbatim): "Returns distribution", "Rolling metrics", "Trades &
positions", "Exposure & benchmark greeks". Min-height 240px (`min-h-[240px]`)
preserves layout shape so 14b body landing causes no scroll-jump.

`data-panel-status="placeholder"` attribute MUST be present on the `<section>`
so Phase 14b's body landing is a single text-replacement operation. Phase 14b
flips this to `data-panel-status="ready"` once each panel's body mounts.

### Per-panel partial-data state (KPI-23a, panels 1–3)

When the `getStrategyDetailV2` response signals insufficient history (history
< X days where X is panel-specific), render the panel container exactly as
above but **replace the body with a centered banner**:

```
┌─────────────────────────────────────────────────────────────────┐
│  H2: "<Panel name>"                                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ⓘ Awaiting more data (need ≥X days)                    │    │
│  │   This panel will activate after X days of trading      │    │
│  │   history are available.                                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

| Panel | Threshold (X) | Banner copy (suffix only — header is shared) |
|---|---|---|
| Panel 1 (Overview) | 1 day | "Awaiting more data (need ≥1 day of trading history)." |
| Panel 2 KPI strip | 30 days | "Awaiting more data (need ≥30 days for stable Sharpe/Sortino estimates)." |
| Panel 2 Equity chart | 7 days | "Awaiting more data (need ≥7 days of equity history)." |
| Panel 3 Drawdown | 30 days | "Awaiting more data (need ≥30 days to detect meaningful drawdowns)." |
| Panel 3 Worst 5 table | 30 days | Reuse existing `WorstDrawdowns` empty-state copy ("No meaningful drawdowns — largest < 0.5%."). |

Banner styling:

| Element | Value |
|---|---|
| Container | `bg-surface-subtle border border-border rounded-md p-4 text-center` |
| Icon | `<InfoIcon />` (existing lucide-react) at 16px, `text-text-muted` |
| Heading line | DM Sans 12px regular (400) `uppercase tracking-wider`, `text-text-secondary` |
| Body line | DM Sans 12px regular (400), `text-text-muted`, `mt-1` |
| Container max-width | 480px, horizontally centered inside the panel card |

**Layout invariant:** the banner replaces ONLY the body region; the panel
heading + outer card remain unchanged. Panel 1 with 1 day of history still
shows the 6-card row (with `—` for empty cells); Panel 2 with 30 days but no
benchmark renders the strategy series solo with a "BTC overlay unavailable"
sub-line under the checkbox.

---

## 5. Interaction contracts

### 5.1 `strategy.ui_v2` flag

Mirror `widget-state-flag.ts`'s 3-tier precedence (URL > localStorage >
SSR-safe default). Phase 14a default = OFF.

| Tier | Trigger | Result |
|---|---|---|
| URL override | `?strategy_v2=on` or `?strategy_v2=true` or `?strategy_v2=v2` | Force ON |
| URL override | `?strategy_v2=off` or `?strategy_v2=false` | Force OFF |
| localStorage | `strategy.ui_v2 = "true"` | ON |
| Default | (no localStorage, no URL) | OFF |

When OFF: navigating to `/strategy/[id]/v2` directly still renders the v2
page (the route exists). The flag governs only whether `/strategy/[id]` (v1)
auto-redirects to `/strategy/[id]/v2`. In 14a, v1 NEVER auto-redirects. In
14b, the flag flips default-ON and v1 redirects when ON.

Flag reader lives at `src/lib/strategy-ui-v2-flag.ts` (new file mirroring
`widget-state-flag.ts`).

### 5.2 Panel 2 segmented control

| Action | Behavior |
|---|---|
| Click Cumulative | Set `aria-pressed="true"` on Cumulative button; mount `<EquityCurve>`; unmount `<DrawdownChart>` |
| Click Underwater | Set `aria-pressed="true"` on Underwater button; mount `<DrawdownChart>` (with BTC underwater overlay); unmount `<EquityCurve>` |
| Click Rolling Sharpe | NO-OP (button has `aria-disabled="true"` + `pointer-events: none` is acceptable; OR the click handler short-circuits) |
| Click Log Returns | NO-OP same as above |
| Toggle BTC checkbox (Panel 2 level) | Re-render whichever chart is currently mounted with `benchmarkSeries={null}` (off) or the benchmark series (on) |
| Keyboard: Tab | Visit Cumulative → Underwater → (skip disabled) → BTC checkbox |
| Keyboard: Enter on focused button | Triggers click handler |
| Keyboard: Space on focused checkbox | Toggles BTC overlay |

Phase 14a does NOT need full keyboard navigation across the entire 7-panel
scroll (that's A11Y-03 in 14b) — but the segmented control + BTC checkbox
inside Panel 2 MUST be keyboard-operable.

### 5.3 IntersectionObserver scaffold for Panels 4–7

`useLazyPanelMetrics(panelId, options)` hook signature:

```ts
useLazyPanelMetrics(panelId: 'panel4'|'panel5'|'panel6'|'panel7', opts?: {
  rootMargin?: string;  // default "200px" (pre-mount before user reaches panel)
  fetchOnIntersect?: boolean;  // 14a = false (placeholder-only); 14b = true
}): { data: LazyMetricsPayload | null, status: 'idle'|'loading'|'error'|'ready' }
```

In 14a, `fetchOnIntersect` defaults to `false` — the hook only manages the
intersection lifecycle and emits `status='ready'` immediately on first
intersection so the placeholder card transitions from `data-panel-status="placeholder"`
to `data-panel-status="placeholder-mounted"` (a no-op visually but proves the
scaffold works). Phase 14b flips `fetchOnIntersect=true` to wire real fetches.

### 5.4 Loading states

Panels 1–3 have no loading state — server component fetches `getStrategyDetailV2`
synchronously before render. Panels 4–7 placeholders show "Loading…" copy
verbatim. There is NO progressive skeleton or shimmer in 14a (DESIGN.md
"Minimal-functional only" motion rule).

### 5.5 Error states

| Error | Behavior |
|---|---|
| `getStrategyDetailV2` returns null (strategy not found) | `notFound()` (Next.js 16 server-component) — same as v1 |
| `getStrategyDetailV2` throws (DB error) | Bubble to `error.tsx` boundary at `src/app/strategy/[id]/v2/error.tsx` (NEW) — heading "We couldn't load this strategy", body "Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.", primary CTA "Reload strategy" (calls `reset()`), secondary CTA "Open v1 factsheet" (link to `/strategy/[id]`). See §7 for verbatim copy. |
| `metrics_json` partial (some keys missing) | Each panel renders its partial-data banner per §4 (NOT a global error) |
| Lazy fetch error (14b consumer; placeholder-only in 14a) | Phase 14a: N/A (no fetch fires) |

### 5.6 Empty states

| Surface | Empty copy |
|---|---|
| Panel 1 missing field | `—` (em-dash) in the cell value position |
| Panel 2 KPI cell missing | `—` (em-dash) |
| Worst 5 table empty | "No meaningful drawdowns — largest < 0.5%." (existing copy in `WorstDrawdowns.tsx:91`) |
| BTC benchmark series unavailable | Hide BTC checkbox + render strategy series solo |

---

## 6. Component inventory

### Reused (zero changes in 14a)

| Component | Path | Used in |
|---|---|---|
| `<EquityCurve>` | `src/components/charts/EquityCurve.tsx` | Panel 2 Cumulative |
| `<DrawdownChart>` | `src/components/charts/DrawdownChart.tsx` | Panel 2 Underwater + Panel 3 |
| `<WorstDrawdowns>` | `src/components/charts/WorstDrawdowns.tsx` | Panel 3 |
| `<VerifiedBadge>` | `src/components/ui/VerifiedBadge.tsx` | Page header |
| `<Disclaimer>` | `src/components/ui/Disclaimer.tsx` | Footer |

**Note for planner:** `EquityCurve.tsx:39,45,87` currently hardcodes
`"#0D9488"` (bright teal). DESIGN-01 audit during this phase MUST replace
those with `CHART_ACCENT` from `chart-tokens.ts`. This is a 1-line edit per
hardcoded hex; do NOT fork the component. `EquityCurve` may also gain an
optional `hideBenchmarkToggle?: boolean` prop so Panel 2 can suppress the
internal checkbox in favor of its own panel-level checkbox (planner's
discretion — alternative is to render checkbox once and pass-through state).

### New components (Phase 14a creates)

| Component | Path | Role |
|---|---|---|
| `<StrategyV2Shell>` | `src/components/strategy-v2/StrategyV2Shell.tsx` | Server component: 7 `<section data-panel>` containers + verticals; receives `getStrategyDetailV2` payload |
| `<OverviewPanel>` | `src/components/strategy-v2/OverviewPanel.tsx` | Server component: Panel 1 6-cell grid |
| `<HeadlineMetricsPanel>` | `src/components/strategy-v2/HeadlineMetricsPanel.tsx` | Client component: KPI strip + segmented control + chart |
| `<DrawdownPanel>` | `src/components/strategy-v2/DrawdownPanel.tsx` | Client component (DrawdownChart is `"use client"`): full-width chart + Worst 5 table |
| `<LazyPanelPlaceholder>` | `src/components/strategy-v2/LazyPanelPlaceholder.tsx` | Client component: white card + "Loading…" copy + IntersectionObserver hook |
| `<PartialDataBanner>` | `src/components/strategy-v2/PartialDataBanner.tsx` | Server component: shared banner for KPI-23a copy across panels 1–3 |
| `<SegmentedControl>` | `src/components/strategy-v2/SegmentedControl.tsx` | Client component: button-group with disabled-state support; v2-internal (NOT shared with v0.15.x scenario tabs which use a different pattern) |

Planner's discretion on file naming — keep them under
`src/components/strategy-v2/` to mirror the existing `src/components/strategy/`
namespace.

### Tailwind class-naming contract (typography)

All v2 panel components MUST use only the 4-size / 2-weight scale. Forbidden
Tailwind classes inside `src/components/strategy-v2/**/*.tsx`:

#### Forbidden size classes

| Forbidden | Use instead |
|---|---|
| `text-[11px]` | `text-xs` (12px) — for axis ticks, use `CHART_TICK_STYLE` token, never an inline className |
| `text-[13px]` | `text-xs` (12px); add `font-normal uppercase tracking-wider` for sub-headings |
| `text-[14px]` / `text-sm` | Avoid in v2 — use `text-xs` (12px) for body, `text-base` (16px) for H2 |
| `text-[20px]` / `text-[24px]` / `text-xl` / `text-2xl` | Not in 14a contract |

Allowed size classes: `text-xs` (12px), `text-base` (16px), `text-lg` (18px),
`text-[32px]` (page H1 only, Instrument Serif).

#### Forbidden weight classes (NEW — 2-weight rule enforcement)

| Forbidden | Use instead |
|---|---|
| `font-light` (300) | `font-normal` (400) |
| `font-medium` (500) | `font-normal` (400) — pair with `uppercase tracking-wider` for heading distinction |
| `font-bold` (700) | `font-semibold` (600) |

Allowed weight classes: `font-normal` (400) and `font-semibold` (600) only.
All forbidden classes are grep enforced — see §9.

### Hooks (new)

| Hook | Path | Role |
|---|---|---|
| `useLazyPanelMetrics` | `src/hooks/useLazyPanelMetrics.ts` | IntersectionObserver wrapper; placeholder-only in 14a (no fetch); 14b adds real fetch wiring |
| `useStrategyUiV2Flag` | `src/lib/strategy-ui-v2-flag.ts` (function, not React hook — server-safe reader mirroring `widget-state-flag.ts`) | URL > localStorage > SSR default OFF |

### Tokens (new)

| Token | File | Value |
|---|---|---|
| `CHART_TICK_STYLE` | `src/components/charts/chart-tokens.ts` | See §2 (12px Geist Mono tabular-nums) |

### Backend lib

| Function | File | Role |
|---|---|---|
| `getStrategyDetailV2(strategyId)` | `src/lib/queries.ts` (extend existing file) | Reads scalars from `metrics_json -> 'key'` paths for Panels 1–3; emits `{ strategy, panel1, panel2Headline, panel2Equity, panel3, lazyKeys }` |
| `fetchStrategyLazyMetrics` | `src/lib/queries.ts` (already shipped Plan 12-08) | Reused in 14b; not invoked in 14a |

---

## 7. Copywriting

All visible copy. Verbatim — executor MUST NOT paraphrase.

### Page chrome

| Element | Copy |
|---|---|
| `<title>` (metadata) | `{strategy.name} — v2 | Quantalyze` |
| H1 | `{strategy.name}` |
| H1 sub (start_date) | `Live since {strategy.start_date}` (only when start_date present) |
| Footer disclaimer | (reuse existing `<Disclaimer variant="strategy" />`) |

### Panel headings (H2 — exact text)

| Panel | Heading |
|---|---|
| Panel 1 | `Overview` |
| Panel 2 | `Headline metrics` (the equity chart sits below; H3 "Equity vs BTC" sits above the chart) |
| Panel 3 | `Drawdown` (with H3 `Worst 5 Drawdowns` for the table sub-region) |
| Panel 4 placeholder | `Returns distribution` |
| Panel 5 placeholder | `Rolling metrics` |
| Panel 6 placeholder | `Trades & positions` |
| Panel 7 placeholder | `Exposure & benchmark greeks` |

### Panel 1 — Overview cell labels (DM Sans 12px text-text-muted)

| Cell | Label |
|---|---|
| 1 | `Supported exchanges` |
| 2 | `Types` |
| 3 | `Subtypes` |
| 4 | `Markets` |
| 5 | `Leverage` |
| 6 | `Avg DTO` |

### Panel 2 — KPI strip cell labels

| Cell | Label |
|---|---|
| 1 | `Cum return` |
| 2 | `CAGR` |
| 3 | `Sharpe` |
| 4 | `Sortino` |
| 5 | `Max DD` |
| 6 | `Vol` |

### Panel 2 — Segmented control button labels

| Button | Label |
|---|---|
| Cumulative (active default) | `Cumulative` |
| Underwater | `Underwater` |
| Rolling Sharpe (disabled) | `Rolling Sharpe` |
| Log Returns (disabled) | `Log returns` |

Disabled-button tooltip (`title` attr): `Available in Phase 14b`

These labels are **view-selector descriptors**, not action CTAs — single-word
labels are intentional and match QuantStats / FactSet conventions for chart
view toggles. Verb + noun "action CTA" copywriting rules do not apply to a
view-toggle segmented control.

### Panel 2 — BTC checkbox

| Element | Copy |
|---|---|
| Label | `BTC benchmark` |
| Default state | Checked (DIFF-03) |
| Unavailable state (no benchmark series) | Hide checkbox; render solo strategy series |

### Panel 3 — Worst 5 table headers

(Reuse existing `WorstDrawdowns.tsx` headers verbatim: `Peak / Trough / Recovery / Depth / Days`)

### Placeholder copy (panels 4–7)

| Element | Copy |
|---|---|
| Body line | `Loading…` (Unicode horizontal ellipsis U+2026, NOT three periods) |
| `aria-live` region | `polite` |

### Partial-data banner copy (panels 1–3, KPI-23a)

| Panel | Banner heading | Banner body |
|---|---|---|
| Panel 1 | `Awaiting more data` | `This strategy needs at least 1 day of trading history to populate Overview.` |
| Panel 2 (KPI strip) | `Awaiting more data` | `This strategy needs at least 30 days of trading history for stable Sharpe and Sortino estimates.` |
| Panel 2 (Equity chart) | `Awaiting more data` | `This strategy needs at least 7 days of equity history.` |
| Panel 3 (Drawdown chart) | `Awaiting more data` | `This strategy needs at least 30 days of trading history to detect meaningful drawdowns.` |
| Panel 3 (Worst 5 table) | (reuse existing) | `No meaningful drawdowns — largest < 0.5%.` |

### Error boundary (`src/app/strategy/[id]/v2/error.tsx`)

| Element | Copy |
|---|---|
| Heading | `We couldn't load this strategy` |
| Body | `Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.` |
| Primary CTA | `Reload strategy` (button — calls `reset()`) |
| Secondary CTA | `Open v1 factsheet` (link to `/strategy/[id]`) |

The primary CTA "Reload strategy" is a verb + noun pair (`Reload` action,
`strategy` direct object) — meets the action-CTA copywriting rule. The
secondary CTA "Open v1 factsheet" likewise pairs verb + noun.

### Destructive actions

**None in Phase 14a.** No delete buttons, no irreversible state changes, no
confirmations needed. Read-only public surface.

---

## 8. Accessibility contract

### A11Y-01 — chart-axis contrast (in scope for this phase)

| Rule | Enforcement |
|---|---|
| `CHART_AXIS_TICK = #64748B` is the ONLY axis-text color | Spread `CHART_TICK_STYLE` on every `<XAxis tick={...}>` / `<YAxis tick={...}>` in `/strategy/[id]/v2` panels |
| `#94A3B8` and `#718096` MUST NOT appear as `fill` on axis text / legend text | `tests/a11y/chart-contrast.test.ts` — Vitest + JSDOM render of v2 page; query for `<text>` SVG nodes; assert `fill` is `#64748B` or unset |
| `getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5` | Same test; uses `polished` or hand-rolled WCAG 2.0 luminance calc |

### A11Y-02 + A11Y-03 — out of scope for 14a

axe-core CI integration tests + full keyboard navigation across 7 panels land
in Phase 14b. Phase 14a verifies only the segmented control + BTC checkbox are
keyboard-operable (manual sanity check at PR review; no automated test).

### Semantic HTML

| Element | Tag |
|---|---|
| Top-level page wrapper | `<main>` |
| Each of 7 panels | `<section data-panel>` with `aria-label` per §4 |
| Panel 1 cards row | `<dl>` with `<dt>` (label) + `<dd>` (value) pairs (semantically a description list) |
| KPI strip | Same — `<dl>` with 6 pairs |
| Panel 2 chart container | `<figure>` with `<figcaption>` for "Equity vs BTC" sub-heading |
| Worst 5 table | `<table>` (existing) |
| Segmented control | `<div role="group" aria-label="Equity chart view">` containing `<button>` elements with `aria-pressed` |
| Disabled buttons | `<button aria-disabled="true">` (NOT `disabled` — keeps focusable for screen-reader announcement of "Available in Phase 14b") |
| Placeholder live region | `<div aria-live="polite">Loading…</div>` |

### Focus order (Panel 2 inner)

1. Cumulative button
2. Underwater button
3. (skip disabled Rolling Sharpe — `aria-disabled="true"` is announced but does not receive focus on Tab; some screen-reader users may discover it via arrow-key inside the role="group", which is fine)
4. (skip disabled Log returns)
5. BTC benchmark checkbox

### Color-blindness

Strategy series (`#1B6B5A`) vs benchmark (`#94A3B8`) is differentiated by
luminance + dash pattern in DESIGN.md spec. Panel 14a charts MUST render
benchmark with a `strokeDasharray` (dashed) line OR a 1px stroke vs strategy's
2px stroke (whichever the underlying chart library supports without a custom
fork). `EquityCurve.tsx:90` already uses a 1px BTC line vs 2px strategy —
this is the reference behavior; preserve it.

---

## 9. Test contract

### Vitest (top-level `tests/` dirs — explicit deviation from co-located convention)

| Test | Path | Asserts |
|---|---|---|
| Chart-axis contrast | `tests/a11y/chart-contrast.test.ts` | (a) `getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5`; (b) grep over `src/components/strategy-v2/**/*.tsx` finds zero `fill: "#94A3B8"` or `fill: "#718096"`; (c) JSDOM render of v2 page asserts every `<text>` node's `fill` attribute is `#64748B` or empty |
| Panel count | `tests/visual/strategy-v2-panel-count.test.ts` | JSDOM render with mocked `getStrategyDetailV2`; `screen.getAllByRole('region').length === 7` AND `document.querySelectorAll('section[data-panel]').length === 7` |
| Tabular-nums spread | `tests/visual/strategy-v2-tabular-nums.test.ts` | (NEW — recommended) Grep over `src/components/strategy-v2/**/*.tsx` finds zero `tick={{ ` literal-object spreads on `<XAxis>` / `<YAxis>` (forces `CHART_TICK_STYLE` token usage) |
| Type-scale lint | `tests/visual/strategy-v2-type-scale.test.ts` | (NEW) Grep over `src/components/strategy-v2/**/*.tsx` finds: (a) **size**: zero `text-\[11px\]`, zero `text-\[13px\]`, zero `text-\[14px\]`, zero `text-sm`, zero `text-xl`, zero `text-2xl`; (b) **weight**: zero `font-medium`, zero `font-light`, zero `font-bold`. Asserts the 4-size / 2-weight contract (sizes 12 / 16 / 18 / 32; weights 400 / 600 only) |

### Playwright (top-level `tests/e2e/`)

| Spec | Path | Asserts |
|---|---|---|
| Partial-data history bands | `tests/e2e/strategy-v2-partial-data.spec.ts` | 4 fixtures (7-day / 30-day / 90-day / 365-day); each asserts (a) all 7 `<section data-panel>` present, (b) panels 1–3 show either full body or partial-data banner copy verbatim, (c) no panel has `display: none`, (d) no panel crashes (no `data-error` attribute) |

### Co-located component tests (Vitest)

| Test | Asserts |
|---|---|
| `src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` | Segmented control: clicking Cumulative shows `<EquityCurve>`; clicking Underwater shows `<DrawdownChart>`; disabled buttons have `aria-disabled="true"` and no-op on click; BTC checkbox toggles correctly |
| `src/components/strategy-v2/LazyPanelPlaceholder.test.tsx` | Renders with `data-panel-status="placeholder"`; "Loading…" copy verbatim; min-height preserves layout |
| `src/components/strategy-v2/SegmentedControl.test.tsx` | Disabled button dispatches no click event; tooltip `title="Available in Phase 14b"` present |
| `src/lib/strategy-ui-v2-flag.test.ts` | Mirror `widget-state-flag.test.ts` — URL > localStorage > SSR default OFF; covers all 6 truthy/falsy URL override variants |

### CLEANUP-01 verification

Manual at PR review: `git diff package.json` shows `@nivo/boxplot` removed;
`npm run build` size delta logged in PR description.

### Build gate

`npm run build` exits 0 (Next.js 16 production build, no broken imports, no
type errors).

### Browser support

Identical to v0.16.0.0 baseline (latest 2 versions of Chrome / Safari / Firefox
/ Edge). No IE; no mobile Safari smoke test in 14a (mobile-responsive polish
deferred per PROJECT.md institutional-product constraint).

---

## 10. Identity audit checklist (DESIGN-01 enforcement)

Every chart rendered inside `/strategy/[id]/v2` panels 1–3 MUST satisfy
ALL boxes (added to PR template per DESIGN-03):

- [ ] White card surface (`bg-card`)
- [ ] Strategy series uses `CHART_ACCENT` (`#1B6B5A`) — NOT `#0D9488` (current bright teal in `EquityCurve.tsx`)
- [ ] Benchmark stroke uses `CHART_TEXT_MUTED` (`#94A3B8`), 1px width, dashed or 1px-vs-2px differentiation
- [ ] Positive cells (KPI strip) use `--color-positive` (`#16A34A`); negative cells use `--color-negative` (`#DC2626`)
- [ ] Gridlines (Recharts) use `CHART_BORDER` (`#E2E8F0`); lightweight-charts uses `--color-track` (`#F1F5F9`) per existing `EquityCurve.tsx:34-35`
- [ ] No Plotly chrome (no modebar, no toolbar, no Plotly attribution)
- [ ] Axis ticks use `CHART_TICK_STYLE` token (Geist Mono **12px** tabular-nums `#64748B` — DM Sans is wrong here; 11px is wrong here per the v2 4-size contract)
- [ ] No decorative animation; chart enter via Recharts default fade only (≤250ms)

---

## 11. Bundle hygiene (CLEANUP-01)

| Action | Verification |
|---|---|
| `npm uninstall @nivo/boxplot` | `package.json` diff shows removal; no `@nivo/boxplot` in `package-lock.json` |
| `ReturnQuantiles.tsx` audit | `grep -r "@nivo/boxplot" src/` returns zero matches; component continues rendering as hand-rolled SVG |
| Bundle size delta | Manual: `npm run build` before/after; ~80KB gzipped saved on the route bundle that pulls in chart components (logged in PR description) |

---

## 12. DESIGN.md decisions log entry (DESIGN-03)

At Phase 14a ship time, append to `DESIGN.md` decisions log table:

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-29 (or ship date) | UC#7 — accept 7-panel single-strategy density-rule deviation | Quantstats parity requires 7 distinct analytical panels (Overview / Headline+Equity / Drawdown / Returns Distribution / Rolling / Trades / Exposure) on `/strategy/[id]/v2`. The "data density > card density" rule is preserved within each panel (multi-cell strips, shared-axis charts, no card-on-card nesting), but the 7-panel scrollable shell exceeds the "3+ cards in a row → make it one panel" guideline at the page level. Accepted as a deliberate institutional-factsheet density choice; reference: FactSet quarterly factsheet pages where 8+ panels per page is standard. Single-page scroll; no tabs; IntersectionObserver-deferred mount on panels 4–7 keeps TTI under budget. |
| 2026-04-29 (or ship date) | v2 single-strategy 4-size / 2-weight type contract | The v2 surface restricts itself to a tight 4-size / 2-weight subset of DESIGN.md's typography scale. Sizes: page H1 = 32px Instrument Serif; panel H2 = 16px DM Sans semibold; KPI metric values = 18px Geist Mono semibold tabular-nums; everything else (cell labels, sub-headings via `uppercase tracking-wider`, axis ticks via `CHART_TICK_STYLE`, table cells, tooltips, banner copy, disabled labels) = 12px caption tier. Weights: exactly 2 — 400 regular and 600 semibold. Sub-headings differentiate via `uppercase tracking-wider` transform, not a third weight. Chart axis ticks consolidated 11px → 12px (Geist Mono tabular-nums at `#64748B` on `#FFFFFF` = 4.85:1, well within WCAG AA). The wider DESIGN.md scale (10–11px micro, 13px small, 14px body, 24px H2, 500 medium weight) remains the project superset; this contract is v2-specific and grep-enforced via `tests/visual/strategy-v2-type-scale.test.ts`. |

---

## 13. Out of scope (deferred to Phase 14b — do NOT spec here)

- Panel 4 Returns Distribution body (MonthlyHeatmap / DailyHeatmap / ReturnHistogram / ReturnQuantiles / YearlyReturns)
- Panel 5 Rolling bodies (Sharpe / Vol / Sortino / Greeks)
- Panel 6 Trades & Positions body (Trade Main / Position Main / R:R / SQN / Volume / Trade Mix)
- Panel 7 Exposure body (Exposure series / Turnover series / Correlation with BTC / Benchmark Greeks)
- DailyHeatmap SVG/Canvas fallback (Pitfall 4)
- Trade Mix maker/taker close-out (KPI-17, gated on Phase 12 audit)
- axe-core CI integration on full route (A11Y-02)
- Full keyboard navigation across 7 panels (A11Y-03)
- Automated chart-snapshot parity Playwright pixel-diff
- `/discovery/[slug]/[strategyId]` nested integration
- Mobile-responsive polish
- v1 → v2 cutover (flag flip to default-ON)

---

## 14. Acceptance gates (this phase)

The phase ships when:

1. `npm run build` exits 0; no TypeScript errors; no broken imports.
2. `tests/a11y/chart-contrast.test.ts` passes.
3. `tests/visual/strategy-v2-panel-count.test.ts` passes (exactly 7 `<section data-panel>`).
4. `tests/visual/strategy-v2-type-scale.test.ts` passes (zero forbidden size classes; zero `font-medium` / `font-light` / `font-bold`).
5. `tests/e2e/strategy-v2-partial-data.spec.ts` passes on all 4 history fixtures.
6. Co-located component tests for the 5 new strategy-v2 components pass.
7. `getStrategyDetailV2` JSON path-extraction reads p95 < 50ms (METRICS-15 SC#3b inheritance).
8. `package.json` no longer contains `@nivo/boxplot`; bundle size delta logged in PR description.
9. `DESIGN.md` decisions log carries both the UC#7 entry AND the v2 4-size / 2-weight type-contract entry.
10. `.github/PULL_REQUEST_TEMPLATE.md` (or `strategy-v2.md`) carries the §10 per-chart identity checklist.
11. Visual review: a fresh allocator opens `/strategy/[id]/v2` against a 365-day fixture and confirms all 3 eager panels render in DESIGN.md identity (white card, accent #1B6B5A series, BTC overlay #94A3B8 default-ON, axis ticks Geist Mono **12px** tabular-nums #64748B). Panels 4–7 show "Loading…" placeholders.

---

*Phase 14a UI-SPEC — drafted 2026-04-29 by gsd-ui-researcher. Status: draft (checker upgrades to approved). Revised 2026-04-29 (iteration 1: typography sizes consolidated to 4; primary visual anchor sentence added to §4; segmented-control copywriting justification added to §0 + §7). Revised 2026-04-29 (iteration 2: typography weights consolidated to exactly 2 — H3 sub-headings now `font-normal uppercase tracking-wider`; error-boundary primary CTA copy revised `Try again` → `Reload strategy`; §6 forbidden-class table extended; §9 type-scale grep test extended).*
