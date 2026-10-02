---
phase: 14b
status: findings
overall_score: 52/60
date: 2026-04-29
---

# Phase 14b — UI Review

**Audited:** 2026-04-29
**Baseline:** 14B-UI-SPEC.md (inherits 14A-UI-SPEC verbatim; approved design contract)
**Screenshots:** Not captured — dev server detected at localhost:3000 but Playwright-MCP not available in session; code-only audit conducted.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 9/10 | Panel H2/H3 headings, Trade Mix labels, and partial-data banner copy land verbatim; minor: `Trades & positions` H2 rendered as HTML entity `Trades &amp; positions` (safe in HTML but should be verified in visual output) |
| 2. Visuals | 9/10 | 7-section structure preserved; all four lazy panels wired in Shell; DailyHeatmap dual renderer ships; Trade Mix bar layout correct; minor: BenchmarkGreeksTable lacks the `p-3` per-cell padding specified in §1 |
| 3. Color | 7/10 | New components clean; DESIGN-01 fixes mostly land (ReturnQuantiles, MonthlyHeatmap, YearlyReturns, ReturnHistogram all fixed) — but three violations remain: (1) `MonthlyHeatmap` zero-value cell renders `color: "#94A3B8"` as CSS `color` on text content — this is the forbidden-as-text case; (2) `DailyHeatmap` SVG month-axis labels use `fontSize={10}` with `fill={CHART_TEXT_MUTED}`; (3) `RollingMetrics` (existing, reused) uses inline `fontSize: 10` on its ReferenceLine label |
| 4. Typography | 7/10 | 4-size / 2-weight contract clean in all new Phase 14b components; three violations in REUSED components: `RollingMetrics.tsx` axis ticks at `fontSize: 11` (not 12, and inline not `CHART_TICK_STYLE`); `DailyHeatmap` SVG month labels at `fontSize={10}`; `RollingMetrics` ReferenceLine label at `fontSize: 10` — all in pre-existing code incorporated into the 14b surface |
| 5. Spacing | 10/10 | All panel chrome values match spec: `p-6` panel padding, `mt-8` inter-panel gaps, `space-y-6` Panel 4/5/7 sub-sections, `space-y-4` Panel 6 metric rows, `mt-8 border-t` Trade Mix break, `gap-3` intra-cell; no arbitrary spacing values found |
| 6. Experience Design | 10/10 | All four loading states use `aria-live="polite"`; all panel sections carry `tabIndex={-1}` + `aria-label`; `dl/dt/dd` semantic pairs in MetricCell and HeadlineMetricsPanel KPI strip; empty states (`—` em-dash) consistent; error states route through `PartialDataBanner`; flag flip correctly defaults ON with SSR-safe two-pass; `@axe-core/playwright` CI added; keyboard nav spec added |

**Overall: 52/60**

---

## Top 3 Priority Fixes

1. **`MonthlyHeatmap.tsx:28` — `color: "#94A3B8"` applied as CSS `color` on zero-value cell text** — Violates the A11Y-01 forbidden-as-text rule (14A-UI-SPEC §3, inherited verbatim). `#94A3B8` is `CHART_TEXT_MUTED` which MUST NEVER appear as a text fill. Zero-value cells would render numeric text in a color that fails WCAG AA on white. Fix: change the zero branch to `color: CHART_AXIS_TICK` (`#64748B`) which is the approved caption-tier text color at 4.85:1 contrast — the same value `CHART_TICK_STYLE` uses. `MonthlyHeatmap.tsx` line 28: `if (value === 0) return { backgroundColor: "#FFFFFF", opacity: 1.0, color: "#64748B" };`

2. **`RollingMetrics.tsx:68,75` — axis ticks still use `tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}` (inline object, size 11)** — This existing component is now surface-area for Phase 14b (Panel 5 Rolling Sharpe and Panel 2 Rolling Sharpe view both render it). The 4-size type contract mandates 12px as the minimum; 11px breaks the contract and inline tick objects bypass `CHART_TICK_STYLE`. Fix: replace lines 68 and 75 with `tick={CHART_TICK_STYLE}`. Also line 92: `fontSize: 10` on the ReferenceLine `avg` label should move to 12.

3. **`DailyHeatmap.tsx:146` — SVG month-axis labels use `fontSize={10}`** — Phase 14b introduces this new component and it immediately breaks the 4-size contract (minimum tier is 12px). The SVG `<text>` at line 146 uses `fontSize={10}` for month labels ("Jan", "Feb" etc.). Fix: change to `fontSize={12}` to match `CHART_TICK_STYLE`. Note the year-label at line 162 already uses `fontSize={12}` correctly — the month label is the only outlier.

---

## Detailed Findings

### Pillar 1: Copywriting (9/10)

**PASS** on all spec-mandated copy items.

Panel H2 headings — verified verbatim:
- `Returns distribution` — `ReturnsDistributionPanel.tsx:80`
- `Rolling metrics` — `RollingMetricsPanel.tsx:129`
- `Trades & positions` — `TradeAndPositionPanel.tsx:99` (HTML entity `&amp;` is correct for JSX; renders correctly in browser)
- `Exposure & benchmark greeks` — `ExposureAndGreeksPanel.tsx:90`

Panel H3 sub-headings — verified verbatim (all 14 headings from 14B-UI-SPEC §2 confirmed):
- Panel 4: `Monthly heatmap` / `Daily heatmap` / `Return histogram` / `Return quantiles` / `Yearly returns` — `ReturnsDistributionPanel.tsx:107,115,123,134,142`
- Panel 5: `Rolling Sharpe` / `Rolling volatility` / `Rolling Sortino` / `Rolling alpha & beta` — `RollingMetricsPanel.tsx:169,180,188,196` (note spec says "Rolling alpha & beta" — code matches exactly)
- Panel 6: `Trade summary` / `Position summary` / `Risk-reward profile` / `Volume metrics` / `Trade mix` — `TradeAndPositionPanel.tsx:135,147,166,196` + `TradeMixSubPanel.tsx:61`
- Panel 7: `Net & gross exposure` / `Turnover` / `Correlation with BTC` / `Benchmark greeks` — `ExposureAndGreeksPanel.tsx:117,125,133,139`

Trade Mix labels — `Long entries` / `Short entries` confirmed verbatim (`TradeMixSubPanel.tsx:70,76`). Count suffix `(N fills)` present.

Partial-data banner copy — `Awaiting more data` heading consistent across all 4 panels. Per-panel body copy is specific and informative (e.g. "at least 30 days" / "at least 90 days"). The loading state uses `Loading…` (typographic ellipsis) — correct.

BenchmarkGreeksTable labels: `alpha` / `beta` / `IR` / `Treynor` — case matches spec (lowercase Greek, uppercase acronym, title-case proper noun). `BenchmarkGreeksTable.tsx:32-35`.

**Minor flag:** `MetricCell` labels in Panel 6 use sentence-case ("Total trades", "Win rate", "Avg duration") per the spec's "title-case OPTIONAL" note. This is within discretion and consistent.

---

### Pillar 2: Visuals (9/10)

**PASS** on structure and primary anchor.

7-panel count: All 7 panels wired in `StrategyV2Shell.tsx`. The four Phase 14a `LazyPanelPlaceholder` slots have been replaced with the real `ReturnsDistributionPanel`, `RollingMetricsPanel`, `TradeAndPositionPanel`, `ExposureAndGreeksPanel` — `StrategyV2Shell.tsx:91-117`.

DailyHeatmap dual renderer: Threshold at `SVG_THRESHOLD_CELLS = 365` (`DailyHeatmap.tsx:30`). SVG branch for `data.length <= 365`, Canvas branch for `> 365`. Canvas has an offscreen `<table aria-label="Daily returns table">` for screen-reader access. `React.memo` on both branches and the outer `DailyHeatmapInner`. Performance marks `panel-4-mount-start` / `panel-4-mount-end` present.

Trade Mix bar layout: 2-bucket horizontal bars with percentage label (18px Geist Mono semibold) + raw count (12px muted) outside the bar, label column (12px muted) to the left. `TradeMixSubPanel.tsx:99-120`. Bar height `h-6` (24px) matches spec.

NetGrossExposureChart: Gross as `Area` with `fillOpacity={0.2}`, Net as solid `Line` — `NetGrossExposureChart.tsx:72-88`. Zero reference line in dashed `CHART_TEXT_MUTED`. height=240 as spec.

TurnoverChart: height=200, single `Line` at `CHART_ACCENT 1.5px` — `TurnoverChart.tsx:35-60`.

**FLAG:** `BenchmarkGreeksTable.tsx:31` uses `grid grid-cols-4 gap-3` but has NO `p-3` per-cell padding. The spec at §1 states "BenchmarkGreeksTable cell padding: 12px — `p-3` per cell". The `MetricCell` primitive itself uses `space-y-1` inside a `dl` but no explicit `p-3` wrapper. This leaves the Greeks strip visually tighter than specified.

---

### Pillar 3: Color (7/10)

**PASS** on accent reservation and new components. Three violations in the inherited/reused component surface that is now part of the 14b render path.

New components clean:
- `NetGrossExposureChart` / `TurnoverChart` / `RollingVolatilityChart` / `RollingSortinoChart` / `RollingAlphaBetaChart`: all use `CHART_ACCENT` for strategy series, `CHART_TEXT_MUTED` for reference lines/benchmark strokes. No hardcoded hex.
- `DailyHeatmap` cell fills use `CHART_POSITIVE` / `CHART_NEGATIVE` / `CHART_NEUTRAL` tokens correctly.
- `ReturnQuantiles.tsx` DESIGN-01 fix confirmed: `CHART_ACCENT` replaces legacy `#0D9488` on box/median strokes. Whisker strokes remain `#94A3B8` (stroke-only, not text — acceptable per spec).
- `MonthlyHeatmap.tsx` DESIGN-01 fix confirmed: `bg-emerald-*` replaced with `#16A34A` for positive cells.
- `ReturnHistogram.tsx` DESIGN-01 fix confirmed: `#16A34A` / `#DC2626` for bar cells at line 90. However the fix uses inline hex rather than importing `CHART_POSITIVE` / `CHART_NEGATIVE` tokens — functionally correct but not tokenized.

**FLAG 1 (Priority 1):** `MonthlyHeatmap.tsx:28` — zero-value cells return `color: "#94A3B8"`. This `color` property is applied as CSS `color` (inline style) on a `<div>` that renders numeric text. `#94A3B8` (`CHART_TEXT_MUTED`) is the A11Y-01 forbidden-as-text value. Contrast ratio of `#94A3B8` on `#FFFFFF` is approximately 2.5:1 — fails WCAG AA (minimum 4.5:1 for small text). This is the exact violation A11Y-01 was designed to prevent.

**FLAG 2 (Typography overlap):** `DailyHeatmap.tsx:146` — SVG month-axis `<text>` elements use `fill={CHART_TEXT_MUTED}` (#94A3B8) at `fontSize={10}`. The forbidden-as-text rule applies to "fill on chart axis text or legend text." This is precisely that case. Fix: switch to `fill={CHART_AXIS_TICK}` (`#64748B`, 4.85:1) AND update size to 12.

**FLAG 3 (minor):** `ReturnHistogram.tsx:90` uses inline hex `"#16A34A"` / `"#DC2626"` instead of importing `CHART_POSITIVE` / `CHART_NEGATIVE`. Functionally equivalent but breaks single-source-of-truth principle. Low priority.

`chart-tokens.ts` is clean: `CHART_POSITIVE` (#16A34A) and `CHART_NEGATIVE` (#DC2626) added in Phase 14b (post-IN-02). `CHART_NEUTRAL` (#FFFFFF) present. No banned colors.

---

### Pillar 4: Typography (7/10)

**PASS** on all new Phase 14b components. Violations exist in two reused components now part of the 14b surface.

New components — type contract clean:
- All four panel wrappers: H2 uses `text-base font-semibold` (16px/600). H3 uses `text-xs font-normal uppercase tracking-wider` (12px/400). No `font-medium`, `font-bold`, `text-sm`, `text-xl`, `text-2xl` found in any production source file.
- `MetricCell.tsx`: `text-xs font-normal` (label, 12px/400) + `text-lg font-semibold tabular-nums` (value, 18px/600) with `fontFamily: var(--font-mono)` inline. Correct.
- `TradeMixSubPanel.tsx`: bar percentage uses `text-lg font-semibold tabular-nums` (18px/600). Label and count use `text-xs font-normal` (12px/400). Correct.
- `BenchmarkGreeksTable.tsx` → delegates to `MetricCell` — inherits correct treatment.

**FLAG 1 (Priority 2):** `RollingMetrics.tsx:68,75` — XAxis and YAxis use inline tick objects `{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }`. Size 11 violates the 4-size floor (minimum 12). This component is reused in Panel 5 (Rolling Sharpe sub-chart in `RollingMetricsPanel.tsx:173`) AND in Panel 2 (`HeadlineMetricsPanel.tsx:291`). The `tests/visual/strategy-v2-tabular-nums.test.ts` grep coverage is not specified to explicitly catch `RollingMetrics.tsx` at this path since it is under `src/components/charts/` (the test glob likely covers it but the inline object bypasses `CHART_TICK_STYLE`).

**FLAG 2 (Priority 3):** `DailyHeatmap.tsx:146` — SVG `<text>` month labels use `fontSize={10}`. The 4-size contract minimum is 12px. Year labels at line 162 correctly use `fontSize={12}`. The inconsistency within the same component suggests the month labels were overlooked during the CHART_TICK_STYLE migration.

**FLAG 3:** `RollingMetrics.tsx:92` — ReferenceLine `label` uses `fontSize: 10`. Same violation, same file.

Font weight enforcement: no `font-medium` found anywhere in Phase 14b production source. Two weights only (400 via `font-normal`, 600 via `font-semibold`) confirmed clean.

Instrument Serif H1: delivered via inline `style={{ fontFamily: "var(--font-serif)", fontSize: "32px", fontWeight: 400 }}` in `StrategyV2Shell.tsx:63-68`. Correct.

---

### Pillar 5: Spacing (10/10)

**PASS** — all spacing values match the 14B-UI-SPEC §1 table exactly.

Panel chrome (all 4 lazy panels):
- `mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card` — confirmed on all four panel section elements.

Panel 4 inner layout (`ReturnsDistributionPanel.tsx`):
- `space-y-6` on the sub-section wrapper (24px between sub-charts) — line 106. Correct.
- `mb-4` on each H3 sub-heading (16px heading→chart gap) — line 158. Correct.

Panel 5 inner layout (`RollingMetricsPanel.tsx`):
- `space-y-6` on sub-chart stack — line 154. Correct.
- `mb-4` on the SegmentedControl wrapper before first sub-chart — line 155. Correct.

Panel 6 inner layout (`TradeAndPositionPanel.tsx`):
- `space-y-4` on the row stack (16px between metric rows) — line 133. Correct (spec says `space-y-4`).
- Section component uses `border-t border-border pt-4` with `mb-4` on H3 — lines 219-220. Correct.
- Trade Mix sub-panel: `mt-8 border-t border-border pt-6` on the container — `TradeMixSubPanel.tsx:59`. The spec says `mt-8 border-t border-border pt-6` exactly. Correct.

Panel 7 inner layout (`ExposureAndGreeksPanel.tsx`):
- `space-y-6` on sub-component wrapper (24px) — line 116. Correct.

Cell gap: `gap-3` (12px) confirmed in `TradeAndPositionPanel.tsx:237` (Grid component) and `BenchmarkGreeksTable.tsx:31`.

No arbitrary spacing values (`[Npx]` or `[Nrem]`) found outside the spec-sanctioned `min-h-[240px]` and `max-w-[1200px]`.

**Note:** `BenchmarkGreeksTable.tsx` is missing the `p-3` per-cell padding (logged under Pillar 2), but the grid gap itself is correct.

---

### Pillar 6: Experience Design (10/10)

**PASS** — state coverage complete, semantic structure correct, flag flip correct.

Loading states:
- `ReturnsDistributionPanel`, `RollingMetricsPanel`, `ExposureAndGreeksPanel` all render `aria-live="polite"` loading divs on `status === 'idle' || status === 'loading'`.
- `TradeAndPositionPanel` uses `fetchOnIntersect: false` (no lazy fetch, no loading state needed — correct per Grok B-04 decision).

Error states:
- All three lazy-fetch panels render `PartialDataBanner heading="Couldn't load this section"` with retry instructions on `status === 'error'`. Consistent and specific.

Empty / partial-data states:
- Panel-level gates: 30-day threshold for Panels 4, 7; 90-day threshold for Panel 5 minimum window. Correct.
- Sub-section gates: DailyHeatmap (empty data), YearlyReturns (< 365 days), Rolling Sharpe (key absent vs history gated — distinguished correctly at `RollingMetricsPanel.tsx:104-106`), NetGrossExposureChart (empty series), TurnoverChart (empty series). All present.
- Trade & Position: no-trades state renders `PartialDataBanner` (`TradeAndPositionPanel.tsx:102-109`).

Semantic HTML:
- All panel section elements: `<section id="panel-X" tabIndex={-1} data-panel="X" data-panel-status="..." aria-label="...">` — correct for keyboard nav spec.
- `MetricCell` uses `<dl>/<dt>/<dd>` — `MetricCell.tsx:21-32`.
- `HeadlineMetricsPanel` KPI strip uses `<dl>` with `<dt>/<dd>` pairs — `HeadlineMetricsPanel.tsx:178`.

Flag flip: `strategy-ui-v2-flag.ts` correctly returns `false` on SSR (`typeof window === 'undefined'`), defaults to `true` on browser when no localStorage override, preserves `"false"` opt-out. Two-pass mount pattern documented. Flag flip is the correct final-commit pattern per UI-SPEC §11.

axe-core CI: `e2e/strategy-v2-axe.spec.ts` and `e2e/discovery-axe.spec.ts` confirmed present. `e2e/strategy-v2-keyboard.spec.ts` confirmed present.

Panel 5 window toggle: reuses `<SegmentedControl>` from Phase 14a with `ariaLabel="Rolling window"` — `RollingMetricsPanel.tsx:157-165`. Three options (`3M` / `6M` / `12M`), default `6M`. Correct.

Panel 2 unlock: `HeadlineMetricsPanel.tsx` all four segmented control buttons are enabled. Rolling Sharpe and Log Returns views are wired and render without the Phase 14a "Available in Phase 14b" tooltip. Confirmed.

---

## Registry Safety

No `components.json` detected. Registry audit skipped — project does not use shadcn. The single new devDependency `@axe-core/playwright` is an npm package (not a shadcn registry block), is listed in `14B-CONTEXT.md` as the approved axe-core integration, and is not on the banned-packages list in `CLAUDE.md`.

---

## Files Audited

**New Phase 14b panel wrappers:**
- `src/components/strategy-v2/ReturnsDistributionPanel.tsx`
- `src/components/strategy-v2/RollingMetricsPanel.tsx`
- `src/components/strategy-v2/TradeAndPositionPanel.tsx`
- `src/components/strategy-v2/ExposureAndGreeksPanel.tsx`
- `src/components/strategy-v2/TradeMixSubPanel.tsx`
- `src/components/strategy-v2/MetricCell.tsx`
- `src/components/strategy-v2/BenchmarkGreeksTable.tsx`

**New chart components:**
- `src/components/charts/DailyHeatmap.tsx`
- `src/components/charts/NetGrossExposureChart.tsx`
- `src/components/charts/TurnoverChart.tsx`
- `src/components/charts/RollingVolatilityChart.tsx`
- `src/components/charts/RollingSortinoChart.tsx`
- `src/components/charts/RollingAlphaBetaChart.tsx`

**Modified / wired Phase 14a components:**
- `src/components/strategy-v2/StrategyV2Shell.tsx`
- `src/components/strategy-v2/HeadlineMetricsPanel.tsx`
- `src/components/charts/chart-tokens.ts`

**Reused components with DESIGN-01 fixes:**
- `src/components/charts/MonthlyHeatmap.tsx`
- `src/components/charts/ReturnHistogram.tsx`
- `src/components/charts/ReturnQuantiles.tsx`
- `src/components/charts/YearlyReturns.tsx`
- `src/components/charts/RollingMetrics.tsx` (existing — violations noted)

**Infrastructure:**
- `src/lib/strategy-ui-v2-flag.ts`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `e2e/strategy-v2-axe.spec.ts`
- `e2e/discovery-axe.spec.ts`
- `e2e/strategy-v2-keyboard.spec.ts`

---

## Aggregate

| Pillar | Score |
|--------|-------|
| 1. Copywriting | 9/10 |
| 2. Visuals | 9/10 |
| 3. Color | 7/10 |
| 4. Typography | 7/10 |
| 5. Spacing | 10/10 |
| 6. Experience Design | 10/10 |
| **Total** | **52/60** |

---

## Final Verdict

**FINDINGS — mergeable with fixes.** The Phase 14b implementation is substantially complete and well-executed. New components (all four lazy panel wrappers, DailyHeatmap dual renderer, NetGrossExposureChart, TurnoverChart, rolling sub-charts, MetricCell, BenchmarkGreeksTable, TradeMixSubPanel) are clean against the 4-size/2-weight contract and all color rules. State coverage, semantic HTML, and accessibility plumbing are thorough.

The three deductions cluster in two files — `RollingMetrics.tsx` (existing, now prominent in the 14b surface) and `DailyHeatmap.tsx` (new) — and represent concrete, small fixes (change `fontSize: 11` → `tick={CHART_TICK_STYLE}`, change `fontSize={10}` → `fontSize={12}`, fix one color value). The `MonthlyHeatmap` zero-value text color is an A11Y-01 issue that should be treated as a block before the `strategy.ui_v2` default-ON flag ships to all users.

**Recommended before merging:** Fix the three Priority items above. The BenchmarkGreeksTable `p-3` gap is a minor spacing polish item and can follow in a subsequent pass.
