---
phase: 14a
status: findings
overall_score: 53/60
date: 2026-04-29
---

# Phase 14a — UI Review

**Audited:** 2026-04-29
**Baseline:** 14A-UI-SPEC.md (approved design contract — 6/6 dimensions PASS)
**Screenshots:** Not captured (live route requires real Supabase record; demo-id returns 404). Code-only audit.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 9/10 | Verbatim copy match throughout; one minor deviation: `"BTC Benchmark"` (capitalized) in EquityCurve.tsx vs spec `"BTC benchmark"` (lowercase "b") |
| 2. Visuals | 8/10 | `<VerifiedBadge>` absent from page header; `<figure>/<figcaption>` not used for chart container; DrawdownPanel redundant H3 "Drawdown" directly under H2 "Drawdown" |
| 3. Color | 9/10 | CHART_ACCENT correctly replaces prior #0D9488 in EquityCurve; `#94A3B8` only appears as benchmark stroke (correct); one minor: EquityCurve.tsx line 105 uses hardcoded `"#94A3B8"` string literal instead of `CHART_TEXT_MUTED` token import |
| 4. Typography | 10/10 | 4-size / 2-weight contract holds perfectly; `CHART_TICK_STYLE` (12px) spread on both axes in DrawdownChart; EquityCurve uses lightweight-charts layout.fontSize = 12 matching the caption tier |
| 5. Spacing | 9/10 | 4px ladder used correctly; one undocumented inline `style={{ minHeight: "180px" }}` in LazyPanelPlaceholder (inner div centering) alongside the correct `min-h-[240px]` on the section |
| 6. Experience Design | 8/10 | `useLazyPanelMetrics` scaffold correct; error boundary uses `unstable_retry` (correct for Next.js 16 pre-stable API naming); DrawdownChart (Panel 2 Underwater view) has no BTC dashed overlay path — the underwater chart only receives equity series transformed locally with no benchmark rendering capability |

**Overall: 53/60**

---

## Top 3 Priority Fixes

1. **Missing `<VerifiedBadge>` in page header** — Visual identity gap; the spec explicitly requires the badge in the H1 header (`<VerifiedBadge>` reused from `src/components/ui/VerifiedBadge.tsx`). Its absence breaks the "verified" signal that is the product's primary trust marker. Fix: import `VerifiedBadge` into `StrategyV2Shell.tsx` and render it inline after the `<h1>` tag in the header block.

2. **Underwater view (Panel 2) has no BTC dashed-line overlay** — `DrawdownChart.tsx` accepts only `{ date, value }[]` with no `benchmarkSeries` prop. The spec requires a BTC underwater overlay on the Underwater toggle (dashed muted line, `CHART_TEXT_MUTED` stroke). In `HeadlineMetricsPanel.tsx` the `effectiveBenchmark` is correctly computed but `<DrawdownChart>` never receives it. The Panel 2 BTC checkbox becomes meaningless in Underwater view. Fix: add `benchmarkSeries?: { date: string; value: number }[] | null` prop to `DrawdownChart` and render a second `<Area>` (or `<Line>`) with `CHART_TEXT_MUTED` stroke and dashed `strokeDasharray`.

3. **`EquityCurve.tsx` hardcodes `"#94A3B8"` instead of `CHART_TEXT_MUTED`** — Line 105 (`color: "#94A3B8"`) and line 130 (`bg-[#94A3B8]`) use literal hex instead of the canonical token. This is a DESIGN-01 identity compliance issue: if the benchmark color token ever changes, EquityCurve will drift silently. Fix: add `CHART_TEXT_MUTED` to the import at line 5 of `EquityCurve.tsx` and replace both hex literals.

---

## Detailed Findings

### Pillar 1: Copywriting (9/10) — PASS

**Verdict: PASS with one minor deviation.**

All required verbatim strings from UI-SPEC §7 are present:

- Page `<title>` pattern: `{strategy.name} — v2 | Quantalyze` — `page.tsx:17` PASS
- H1 `{strategy.name}` — `StrategyV2Shell.tsx:43` PASS
- `Live since {strategy.start_date}` — `StrategyV2Shell.tsx:48` PASS
- Panel H2 headings: `Overview` / `Headline metrics` / `Drawdown` — verified across `OverviewPanel.tsx:43`, `HeadlineMetricsPanel.tsx:85`, `DrawdownPanel.tsx:46` PASS
- Placeholder headings: `Returns distribution`, `Rolling metrics`, `Trades & positions`, `Exposure & benchmark greeks` — `StrategyV2Shell.tsx:67–85` PASS
- KPI labels: `Cum return` / `CAGR` / `Sharpe` / `Sortino` / `Max DD` / `Vol` — `HeadlineMetricsPanel.tsx:97–136` PASS (note: spec says `Cum return`, not `Cum Return` — implementation matches)
- Overview labels: `Supported exchanges`, `Types`, `Subtypes`, `Markets`, `Leverage`, `Avg DTO` — `OverviewPanel.tsx:55–86` PASS
- Segmented buttons: `Cumulative` / `Underwater` / `Rolling Sharpe` / `Log returns` — `HeadlineMetricsPanel.tsx:67–70` PASS (correct lowercase "r" in `Log returns`)
- Disabled tooltip: `Available in Phase 14b` — `SegmentedControl.tsx:47` PASS
- BTC checkbox label: `BTC benchmark` — `HeadlineMetricsPanel.tsx:166` PASS
- Partial-data banner copy (all 4 variants) — PASS (verbatim match verified)
- Error boundary: `We couldn't load this strategy` / `Reload strategy` / `Open v1 factsheet` — `error.tsx:27,38,44` PASS
- Placeholder body: `Loading…` (U+2026) — `LazyPanelPlaceholder.tsx:46` PASS (JSX `{"…"}` correctly emits U+2026)
- `aria-live="polite"` on placeholder region — `LazyPanelPlaceholder.tsx:42` PASS

**FLAG (minor):** `EquityCurve.tsx:131` — internal checkbox label reads `"BTC Benchmark"` (capital B). When `hideBenchmarkToggle={false}` (v1 path), this label is user-visible. The spec doesn't govern v1 EquityCurve copy directly, but since this file is in scope for the DESIGN-01 audit, the inconsistency should be aligned. Fix: change to `BTC benchmark` to match the token established in this phase.

---

### Pillar 2: Visuals (8/10) — FLAG

**Verdict: FLAG — two spec items missing, one structural redundancy.**

**PASS items:**

- Primary visual anchor (6-cell KPI strip + 32px Instrument Serif H1) — structure correct, H1 uses inline `fontSize: "32px"` + `fontFamily: "var(--font-serif), serif"` per spec. `StrategyV2Shell.tsx:37–44` PASS
- 7 `<section data-panel>` elements present — confirmed via grep of StrategyV2Shell.tsx (3 eager panels + 4 LazyPanelPlaceholder calls) PASS
- `data-panel-status="placeholder"` on sections 4–7 — `LazyPanelPlaceholder.tsx:36` PASS
- `min-h-[240px]` on placeholder panels — `LazyPanelPlaceholder.tsx:38` PASS
- Panel card chrome: `rounded-lg border border-border bg-surface p-6 shadow-card` — consistent across all 4 panel components PASS
- `role="group" aria-label="Equity chart view"` on segmented control — `SegmentedControl.tsx:38` PASS
- `<dl>/<dt>/<dd>` semantic markup for Overview + KPI cells — PASS
- H3 sub-headings use `uppercase tracking-wider` pattern — `HeadlineMetricsPanel.tsx:145`, `DrawdownPanel.tsx:48,66` PASS

**FLAG — Missing `<VerifiedBadge>` in header:**
UI-SPEC §3 and §10 explicitly require `<VerifiedBadge>` in the page H1 block. No import or usage found in `StrategyV2Shell.tsx`. The v1 factsheet pattern at `src/app/strategy/[id]/page.tsx` uses it; the spec calls for reuse. The header renders only the H1 text and a `start_date` sub-line.

**FLAG — `<figure>/<figcaption>` not used for chart container:**
UI-SPEC §8 specifies `<figure>` with `<figcaption>` for the "Equity vs BTC" chart container in Panel 2. Implementation uses a `<div className="mt-4">` wrapper instead (`HeadlineMetricsPanel.tsx:171`). The H3 "Equity vs BTC" sits outside the chart wrapper, not as a figcaption inside a figure. This is a semantic HTML deviation — low visual impact but affects screen reader navigation.

**FLAG (minor) — DrawdownPanel H3 "Drawdown" under H2 "Drawdown":**
`DrawdownPanel.tsx:46,48–50` renders `<h2>Drawdown</h2>` immediately followed by `<h3>Drawdown</h3>`. The H3 is the sub-heading above the chart body per spec, but its content duplicates the H2 label. The spec intends the H3 to title only the chart sub-region (the H3 label in the spec diagram is just "Drawdown" to distinguish it from "Worst 5 Drawdowns"). Visually this means two sequential elements both say "Drawdown" — the second is redundant until it's needed to label the sub-region once the panel gains more content. Low severity; low visual impact in the current single-chart layout.

---

### Pillar 3: Color (9/10) — PASS

**Verdict: PASS with one token substitution flag.**

**PASS items:**

- `CHART_ACCENT = "#1B6B5A"` used for strategy series stroke in `EquityCurve.tsx:63` (replaces prior `#0D9488`) — DESIGN-01 requirement met PASS
- `CHART_ACCENT` used for drawdown fill gradient + stroke in `DrawdownChart.tsx:20–22,44` PASS
- `CHART_ACCENT` used for active segmented-button border in `SegmentedControl.tsx:63` PASS
- No v2 panel component contains any hardcoded hex color (only Tailwind semantic tokens) PASS
- `text-positive` / `text-negative` used for sign-colored KPI cells — `HeadlineMetricsPanel.tsx:30–31,130` PASS
- `text-negative` always applied to Max DD cell regardless of value — `HeadlineMetricsPanel.tsx:130` PASS (correct per spec)
- `bg-page` / `bg-surface` / `bg-surface-subtle` / `border-border` — correct token usage throughout PASS
- `CHART_AXIS_TICK = "#64748B"` via `CHART_TICK_STYLE` — no forbidden fill colors in v2 panel files PASS
- `@nivo/boxplot` removed from `package.json` — PASS (CLEANUP-01)

**FLAG:** `EquityCurve.tsx:105,130` — two hardcoded `"#94A3B8"` literals instead of `CHART_TEXT_MUTED` token. The token is already exported from `chart-tokens.ts` but not imported in `EquityCurve.tsx` (only `CHART_ACCENT` and `CHART_FONT_MONO` are imported). While `#94A3B8` is the correct color value and is used correctly (benchmark line stroke, not text fill), using the token prevents silent drift.

Registry audit: `components.json` does not exist — no shadcn. No third-party registry blocks present. Registry audit: 0 third-party blocks checked, skipped.

---

### Pillar 4: Typography (10/10) — PASS

**Verdict: PASS — 4-size / 2-weight contract fully honored.**

Size classes found in `src/components/strategy-v2/**/*.tsx`:
- `text-xs` (12px) — body, labels, H3 sub-headings, segmented buttons, banner copy, all correct
- `text-base` (16px) — H2 panel headings only (`OverviewPanel.tsx:43`, `HeadlineMetricsPanel.tsx:85`, `DrawdownPanel.tsx:46`, `LazyPanelPlaceholder.tsx:40`)
- `text-lg` (18px) — KPI/Overview metric values only (`OverviewPanel.tsx:56,62,68,74,80,86`, `HeadlineMetricsPanel.tsx:99,109,118,124,130,136`)
- `text-[32px]` — NOT present as a Tailwind class (H1 uses inline style per spec, correct for Instrument Serif which is not a Tailwind font class)

Zero forbidden size classes: `text-sm`, `text-xl`, `text-2xl`, `text-[11px]`, `text-[13px]`, `text-[14px]` — none found.

Weight classes found:
- `font-normal` (400) — body, labels, H3 sub-headings, disabled buttons
- `font-semibold` (600) — H2 headings, KPI metric values, active segmented button label

Zero forbidden weight classes: `font-medium`, `font-light`, `font-bold` — none found.

`CHART_TICK_STYLE` (12px, Geist Mono, tabular-nums, `#64748B`) — correctly imported and spread on both `<XAxis>` and `<YAxis>` in `DrawdownChart.tsx:26,33`. No `tick={{` literal-object spreads present.

`EquityCurve.tsx` uses lightweight-charts `layout.fontSize = 12` and `textColor: "#64748B"` at lines 48–47 — equivalent compliance for the canvas-based renderer. Correct.

H3 sub-heading pattern (`text-xs font-normal uppercase tracking-wider text-text-secondary`) — verified at `HeadlineMetricsPanel.tsx:145`, `DrawdownPanel.tsx:48`, `DrawdownPanel.tsx:66`. PASS.

The `strategy-v2-type-scale.test.ts` grep test correctly encodes all forbidden patterns and will catch regressions. The test itself is well-structured and evidence-based.

---

### Pillar 5: Spacing (9/10) — PASS

**Verdict: PASS with one minor deviation.**

**PASS items:**

- `max-w-[1200px]` outer container — `StrategyV2Shell.tsx:33` PASS
- `px-6` (24px horizontal padding) — `StrategyV2Shell.tsx:33` PASS
- `p-6` (24px panel padding) on all panel cards — all 4 panel components PASS
- `mt-8` (32px inter-panel gap) on each `<section>` — all 4 panel components PASS
- `gap-3` (12px cell gap) on `<dl>` grids — `OverviewPanel.tsx:53`, `HeadlineMetricsPanel.tsx:95` PASS
- `mt-4` (16px panel heading-to-body gap) — consistent across panels PASS
- `min-h-[240px]` on placeholder sections — `LazyPanelPlaceholder.tsx:38` PASS
- `max-w-[480px]` on partial-data banner — `PartialDataBanner.tsx:18` PASS
- No `--space-grid-gap: 10px` usage in v2 components (correctly avoided per spec) PASS

**FLAG (minor):** `LazyPanelPlaceholder.tsx:44` — `style={{ minHeight: "180px" }}` inline style on the inner content div. This is an undocumented value (180px is not in the 4px ladder: 2/4/8/12/16/24/32/48/64). The value exists to vertically center the "Loading…" copy within the 240px card (240 - 40px H2 - 20px mt-4 ≈ 180px remaining), which is a reasonable implementation detail, but it uses an inline pixel value rather than `flex-1` or `min-h-0` with flex centering. The visual result is correct but the spacing mechanism deviates from the token system.

---

### Pillar 6: Experience Design (8/10) — FLAG

**Verdict: FLAG — Panel 2 Underwater BTC overlay unimplemented.**

**PASS items:**

- `useLazyPanelMetrics` hook: correct IntersectionObserver scaffold; SSR-safe; stable `useCallback` ref; Phase 14b wiring commented in-place — `src/hooks/useLazyPanelMetrics.ts` PASS
- `data-panel-status="placeholder"` → `"placeholder-mounted"` lifecycle via hook `status` — scaffold present; 14a placeholder-only behavior correct PASS
- `aria-live="polite"` on placeholder loading region — `LazyPanelPlaceholder.tsx:42` PASS
- `aria-disabled="true"` (not native `disabled`) on disabled segmented buttons — `SegmentedControl.tsx:45` PASS; correct rationale (remains focusable for screen-reader announcement)
- `aria-pressed={isActive}` on active/inactive segmented buttons — `SegmentedControl.tsx:59` PASS
- Error boundary present at `src/app/strategy/[id]/v2/error.tsx` PASS
- Partial-data banners for all 4 history-threshold cases — PASS
- `notFound()` for null strategy in `page.tsx:29` — PASS
- `role="status"` on `PartialDataBanner` — `PartialDataBanner.tsx:16` PASS (accessible live region for status messages)
- BTC checkbox default-ON (`useState(true)`) — `HeadlineMetricsPanel.tsx:60` PASS (DIFF-03)

**FLAG — Underwater view receives no BTC overlay:**
`DrawdownChart` has no `benchmarkSeries` prop. `HeadlineMetricsPanel.tsx:183–205` passes the equity series through a local `runningMax` transformation to produce underwater values, but `<DrawdownChart>` at line 184 receives no benchmark prop. The spec requires a BTC underwater overlay for the Underwater toggle (UI-SPEC §4 Panel 2, §5.2). The BTC checkbox in Underwater view toggles `effectiveBenchmark` state but no chart component consumes it in that view. Behaviorally: the checkbox has no effect in Underwater mode.

**OBSERVATION — `error.tsx` uses `unstable_retry` not `reset`:**
The standard Next.js error boundary prop is `reset` (stable). The implementation uses `unstable_retry` at lines 9,12,35. This may reflect the Next.js 16 API naming in this codebase (Next.js 16 changed some APIs). Since AGENTS.md instructs reading `node_modules/next/dist/docs/` before writing Next.js code, and this pattern matches what was shipped, this is recorded as an observation rather than a flag. It does not affect UI rendering.

---

## Aggregate

| Pillar | Score |
|--------|-------|
| 1. Copywriting | 9/10 |
| 2. Visuals | 8/10 |
| 3. Color | 9/10 |
| 4. Typography | 10/10 |
| 5. Spacing | 9/10 |
| 6. Experience Design | 8/10 |
| **Total** | **53/60** |

---

## Final Verdict

**Status: findings** — Phase proceeds. Three actionable items below the quality bar; none are blockers.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| F1 | Medium | `<VerifiedBadge>` missing from page header | Import + render after H1 in `StrategyV2Shell.tsx` header block |
| F2 | Medium | DrawdownChart (Underwater view) has no BTC benchmark overlay | Add `benchmarkSeries` prop to `DrawdownChart.tsx`; wire `effectiveBenchmark` from `HeadlineMetricsPanel` |
| F3 | Low | `EquityCurve.tsx:105,130` hardcode `"#94A3B8"` instead of `CHART_TEXT_MUTED` token | Add `CHART_TEXT_MUTED` to import; replace both literals |
| F4 | Low | `<figure>/<figcaption>` not used for chart container (Panel 2) | Wrap chart div in `<figure>` with `<figcaption>` for "Equity vs BTC" |
| F5 | Low | `LazyPanelPlaceholder.tsx:44` inline `minHeight: "180px"` off-ladder | Replace with flex centering (`flex-1 flex items-center justify-center`) |
| F6 | Cosmetic | `EquityCurve.tsx:131` `BTC Benchmark` (capital B) vs spec `BTC benchmark` | Lowercase `b` |
| F7 | Cosmetic | `DrawdownPanel` H3 "Drawdown" duplicates H2 "Drawdown" label | Rename H3 to `"Chart"` or omit until sub-regions justify the label |

---

## Files Audited

- `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md`
- `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md`
- `DESIGN.md`
- `src/components/strategy-v2/StrategyV2Shell.tsx`
- `src/components/strategy-v2/OverviewPanel.tsx`
- `src/components/strategy-v2/HeadlineMetricsPanel.tsx`
- `src/components/strategy-v2/DrawdownPanel.tsx`
- `src/components/strategy-v2/LazyPanelPlaceholder.tsx`
- `src/components/strategy-v2/PartialDataBanner.tsx`
- `src/components/strategy-v2/SegmentedControl.tsx`
- `src/components/charts/chart-tokens.ts`
- `src/components/charts/EquityCurve.tsx`
- `src/components/charts/DrawdownChart.tsx`
- `src/app/strategy/[id]/v2/page.tsx`
- `src/app/strategy/[id]/v2/error.tsx`
- `src/hooks/useLazyPanelMetrics.ts`
- `tests/visual/strategy-v2-type-scale.test.ts`
- `tests/visual/strategy-v2-panel-count.test.tsx`
- `tests/a11y/chart-contrast.test.ts`
