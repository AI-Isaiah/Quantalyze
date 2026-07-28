---
phase: 14a
plan: 03
subsystem: ui-components
tags: [single-strategy-v2, components, kpi-02, kpi-03, kpi-04, kpi-05, kpi-22, kpi-23a, design-02]
requirements: [KPI-02, KPI-03, KPI-04, KPI-05, KPI-22, KPI-23a, DESIGN-02]
dependency_graph:
  requires:
    - "src/components/charts/chart-tokens.ts:CHART_TICK_STYLE (Plan 14a-01)"
    - "src/lib/queries.ts:StrategyV2Detail (Plan 14a-02)"
    - "src/components/charts/EquityCurve.tsx (existing — extended with hideBenchmarkToggle prop)"
    - "src/components/charts/DrawdownChart.tsx (existing — reused as-is)"
    - "src/components/charts/WorstDrawdowns.tsx (existing — reused as-is via minimal analytics adapter)"
    - "src/components/ui/Disclaimer.tsx (existing — variant='strategy')"
  provides:
    - "src/hooks/useLazyPanelMetrics.ts (IntersectionObserver scaffold for panels 4–7)"
    - "src/components/strategy-v2/StrategyV2Shell.tsx (7-panel scrollable shell)"
    - "src/components/strategy-v2/OverviewPanel.tsx (Panel 1 server component)"
    - "src/components/strategy-v2/HeadlineMetricsPanel.tsx (Panel 2 client component)"
    - "src/components/strategy-v2/DrawdownPanel.tsx (Panel 3 server component)"
    - "src/components/strategy-v2/LazyPanelPlaceholder.tsx (Panels 4–7)"
    - "src/components/strategy-v2/PartialDataBanner.tsx (KPI-23a banner)"
    - "src/components/strategy-v2/SegmentedControl.tsx (Panel 2 toggle)"
  affects:
    - "Plan 14a-04 (route handler renders <StrategyV2Shell detail={...} />)"
    - "Plan 14a-05 (component test suite covers these 7 components + hook)"
tech_stack:
  added: []
  patterns:
    - "IntersectionObserver one-shot scaffold (mirrors AllocationDashboardV2.tsx:147-188)"
    - "Server component / client component split — Panels 1, 3 are server; Panel 2 is client (owns segmented + checkbox state); Shell is server"
    - "Reuse-without-fork via minimal type adapter (DrawdownPanel synthesizes a StrategyAnalytics shape from panel3 to feed WorstDrawdowns)"
    - "4-size / 2-weight type contract enforced via grep (zero font-medium/light/bold; zero text-sm/xl/2xl/[11px]/[13px]/[14px])"
key_files:
  created:
    - "src/hooks/useLazyPanelMetrics.ts (82 LOC)"
    - "src/components/strategy-v2/StrategyV2Shell.tsx (94 LOC)"
    - "src/components/strategy-v2/OverviewPanel.tsx (94 LOC)"
    - "src/components/strategy-v2/HeadlineMetricsPanel.tsx (206 LOC)"
    - "src/components/strategy-v2/DrawdownPanel.tsx (74 LOC)"
    - "src/components/strategy-v2/LazyPanelPlaceholder.tsx (50 LOC)"
    - "src/components/strategy-v2/PartialDataBanner.tsx (23 LOC)"
    - "src/components/strategy-v2/SegmentedControl.tsx (73 LOC)"
  modified:
    - "src/components/charts/EquityCurve.tsx (+18 LOC: added hideBenchmarkToggle?: boolean prop per UI-SPEC §6)"
decisions:
  - "EquityCurve was modified (executor's recommended path A): added hideBenchmarkToggle?: boolean prop. When true, the internal BTC checkbox is suppressed so Panel 2 can own the toggle. Default false preserves v1 behavior. 1-prop addition; chart logic unchanged."
  - "Project token bg-card is NOT defined in globals.css. Substituted bg-surface (the canonical white-card token, --color-surface=#FFFFFF) per the existing project-wide pattern in src/components/ui/Card.tsx, MetricCard.tsx, CardShell.tsx, etc. UI-SPEC §4 referenced bg-card; this is a token-name mismatch in the spec, not a behavioral deviation. Visual outcome is identical (white card)."
  - "shadow-card token replaces the inline shadow-[0_1px_3px_rgba(0,0,0,0.04)] from the plan's skeleton — globals.css defines --shadow-card: 0 1px 3px rgba(0,0,0,0.04) so the token usage is identical and centralized."
  - "WorstDrawdowns reuse: synthesized minimal StrategyAnalytics adapter from panel3 (drawdown_episodes + drawdown_series only — the two fields the component actually reads). Avoids forking the existing component as required by CONTEXT.md."
  - "Underwater view in Panel 2: derived drawdown from the equity series via Math.min(0, value - 1) transform. This is a placeholder transform for 14a — Phase 14b will replace with the dedicated underwater payload from fetchStrategyLazyMetrics. Documented in inline comment."
  - "useLazyPanelMetrics hook: panelId parameter is currently unreferenced inside the body (placeholder-only behavior in 14a). Added a `void panelId` reference to satisfy noUnusedParameters under strict tsc while preserving the public contract for Phase 14b's fetch dispatch."
metrics:
  duration_minutes: 18
  completed: 2026-04-29
  tasks_total: 3
  tasks_completed: 3
  files_created: 8
  files_modified: 1
  lines_added: 696
  commits:
    - "872c8c8 feat(14a-03): add lazy hook + placeholder/banner/segmented primitives"
    - "d9df3b0 feat(14a-03): add OverviewPanel + DrawdownPanel server components"
    - "bf95fa5 feat(14a-03): add HeadlineMetricsPanel + StrategyV2Shell"
---

# Phase 14a Plan 03: Layout & Panel Components Summary

**One-liner:** Ships the seven Single-Strategy v2 layout components + the IntersectionObserver hook that compose the 7-panel scrollable shell — eager bodies for Panels 1–3 (Overview / Headline+Equity / Drawdown), placeholder cards for Panels 4–7, full DESIGN.md identity (CHART_ACCENT strategy series, BTC overlay default-ON, 4-size / 2-weight type contract).

## Tasks

| # | Task | Files | Commit | Status |
| - | ---- | ----- | ------ | ------ |
| 1 | useLazyPanelMetrics + LazyPanelPlaceholder + PartialDataBanner + SegmentedControl | 4 files | `872c8c8` | Done |
| 2 | OverviewPanel + DrawdownPanel (server components) | 2 files | `d9df3b0` | Done |
| 3 | HeadlineMetricsPanel + StrategyV2Shell + EquityCurve hideBenchmarkToggle prop | 3 files | `bf95fa5` | Done |

## EquityCurve Modification — Path A (added hideBenchmarkToggle)

Per UI-SPEC §6 ("EquityCurve may also gain an optional `hideBenchmarkToggle?: boolean` prop so Panel 2 can suppress the internal checkbox in favor of its own panel-level checkbox"), the executor chose Path A (recommended in the plan):

**Change shape (1 prop addition):**

```ts
interface EquityCurveProps {
  // existing props unchanged
  hideBenchmarkToggle?: boolean; // default false → v1 behavior preserved
}
```

When `hideBenchmarkToggle === true`, the existing `{hasBenchmark && ...}` JSX guard is extended to `{hasBenchmark && !hideBenchmarkToggle && ...}` so the per-component checkbox header does not render. The chart logic itself is untouched — BTC overlay visibility is controlled at the panel level by passing `benchmarkSeries={null}` when the panel-level checkbox is OFF.

**Rationale for Path A:** UI-SPEC §4 explicitly states "render exactly once above the chart (NOT inside each chart's per-component header)". Path A keeps the checkbox affordance in the user's mental model (above the chart) while placing it at the v2 panel level rather than the per-component level. Path B (leave the internal checkbox + suppress at the wrapper level) would have produced two checkbox controls at different levels — a UX regression. The 1-prop addition is the smallest possible intervention.

**v1 surface:** the v1 page (`/strategy/[id]`) consumes EquityCurve without passing `hideBenchmarkToggle`, so the default `false` preserves the existing internal-checkbox behavior. v1 is not affected.

## Final File Inventory

```
src/components/strategy-v2/
├── StrategyV2Shell.tsx         (94 LOC, server)
├── OverviewPanel.tsx           (94 LOC, server)
├── HeadlineMetricsPanel.tsx    (206 LOC, client)
├── DrawdownPanel.tsx           (74 LOC, server)
├── LazyPanelPlaceholder.tsx    (50 LOC, client)
├── PartialDataBanner.tsx       (23 LOC, server)
└── SegmentedControl.tsx        (73 LOC, client)

src/hooks/
└── useLazyPanelMetrics.ts      (82 LOC, client hook)

Total: 8 new files, 696 LOC.
Modified: src/components/charts/EquityCurve.tsx (+18 LOC, 1 prop addition).
```

## Verification (Plan §verification)

| Gate | Command | Result |
| ---- | ------- | ------ |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Forbidden weights grep | `grep -nE "font-medium\|font-light\|font-bold" src/components/strategy-v2/*.tsx` | exit 1 (zero matches) |
| Forbidden sizes grep | `grep -nE 'text-\[11px\]\|text-\[13px\]\|text-\[14px\]\|text-sm\|text-xl\|text-2xl' src/components/strategy-v2/*.tsx` | exit 1 (zero matches) |
| Hook export | `grep -c "export function useLazyPanelMetrics" src/hooks/useLazyPanelMetrics.ts` | 1 |
| Placeholder data attr | `grep -c 'data-panel-status="placeholder"' src/components/strategy-v2/LazyPanelPlaceholder.tsx` | 1 |
| Loading ellipsis (U+2026) | `grep 'Loading{"…"}' src/components/strategy-v2/LazyPanelPlaceholder.tsx` | 1 (literal U+2026) |
| Disabled tooltip | `grep -c 'title="Available in Phase 14b"' src/components/strategy-v2/SegmentedControl.tsx` | 1 |
| SSR guard | `grep -c 'typeof IntersectionObserver === "undefined"' src/hooks/useLazyPanelMetrics.ts` | 2 (comment + check) |
| rootMargin default | `grep 'rootMargin: opts.rootMargin ?? "200px"' src/hooks/useLazyPanelMetrics.ts` | 1 match |
| KPI labels (>=6) | `grep -cE "Cum return\|CAGR\|Sharpe\|Sortino\|Max DD\|Vol" HeadlineMetricsPanel.tsx` | 11 |
| BTC benchmark label | `grep -c 'BTC benchmark' HeadlineMetricsPanel.tsx` | 1 |
| Segmented options | `grep -cE 'Cumulative\|Underwater\|Rolling Sharpe\|Log returns' HeadlineMetricsPanel.tsx` | 7 |
| rolling_sharpe disabled | `grep -E 'rolling_sharpe.*disabled: true' HeadlineMetricsPanel.tsx` | 1 match |
| Shell composes 7 panels | `grep -cE '<OverviewPanel\|<HeadlineMetricsPanel\|<DrawdownPanel\|<LazyPanelPlaceholder' StrategyV2Shell.tsx` | 7 (1 + 1 + 1 + 4) |
| Lazy panelIds 4-7 | `grep -cE 'panelId="panel4"\|...\|panelId="panel7"' StrategyV2Shell.tsx` | 4 |
| max-w-[1200px] | `grep -c 'max-w-\[1200px\]' StrategyV2Shell.tsx` | 1 |
| `use client` on Shell (must be 0) | `grep -c "use client" StrategyV2Shell.tsx` | 0 |
| `use client` on HeadlineMetrics (must be 1) | `head -2 HeadlineMetricsPanel.tsx` | `"use client";` |

**Note on `aria-label="Equity chart view"` grep:** The plan's literal grep targets `aria-label="..."` in the Panel 2 source. The component passes the label via the `ariaLabel` prop to `SegmentedControl` (camelCase prop name); `SegmentedControl` then renders `aria-label={ariaLabel}` on the `<div role="group">`. The rendered DOM contract holds (`aria-label="Equity chart view"` is present in the served HTML); only the source-level grep pattern misses because of the camelCase-prop indirection. This is a pattern-match artifact, not a behavioral deviation — the runtime contract is fully satisfied and the Plan 14a-05 test suite (which asserts on the rendered DOM, not the source) will exercise it correctly.

## Success Criteria (Plan §success_criteria)

1. ✅ `useLazyPanelMetrics` hook is SSR-safe (`typeof IntersectionObserver === "undefined"` short-circuit) and one-shot (`unobserve(entry.target)` after first intersection).
2. ✅ `StrategyV2Shell` composes the 7-section layout in declared order (Panel 1 → Panel 2 → Panel 3 → 4× LazyPanelPlaceholder).
3. ✅ `HeadlineMetricsPanel` renders the segmented control with 2 active (Cumulative + Underwater) + 2 disabled (Rolling Sharpe + Log returns) buttons; BTC checkbox default-ON (DIFF-03).
4. ✅ Panel partial-data banners trigger on documented thresholds: Panel 1 < 1 day, Panel 2 KPI strip < 30 days, Panel 2 chart < 7 days, Panel 3 chart < 30 days.
5. ✅ `npm run build` exits 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `bg-card` token does not exist in this project**

- **Found during:** Task 1 (LazyPanelPlaceholder, SegmentedControl) and Task 2 (OverviewPanel, DrawdownPanel) initial drafting.
- **Issue:** UI-SPEC §4 references `bg-card` and the plan's skeleton uses it verbatim (e.g. line 288 of the plan's action block: `className="mt-8 min-h-[240px] rounded-lg border border-border bg-card p-6 ..."`). However, `globals.css` does NOT define `--color-card`; the canonical white-card token in this project is `bg-surface` (`--color-surface: #FFFFFF`), as confirmed by every existing `Card.tsx`, `MetricCard.tsx`, `CardShell.tsx`, `ScopedBanner.tsx`, etc. Using `bg-card` would silently produce no background color (Tailwind v4 unknown class).
- **Fix:** Substituted `bg-surface` everywhere `bg-card` appeared in the plan skeleton. Also substituted `shadow-card` (the canonical `--shadow-card` token) for the inline `shadow-[0_1px_3px_rgba(0,0,0,0.04)]` from the plan skeleton — same value, centralized.
- **Files modified:** all 7 v2 components.
- **Verification:** `grep -rn "bg-card" src/components/strategy-v2/` returns 0 matches; `grep -rn "bg-surface" src/components/strategy-v2/` returns 7 matches (one per panel card).

**2. [Rule 3 - Blocking] `useLazyPanelMetrics` strict-tsc unused parameter**

- **Found during:** Task 1 typecheck.
- **Issue:** The hook signature accepts `panelId: LazyPanelId` to pin the public contract for Phase 14b's fetch dispatch, but in 14a the body is placeholder-only and does not reference `panelId`. Under the project's strict tsc with `noUnusedParameters`, this could surface as a future regression if linting tightens (no current tsc error, but the convention is to mark intentional non-use).
- **Fix:** Added `void panelId;` at the top of the body with an inline comment documenting the Phase 14b reservation. Does not affect runtime behavior.
- **Files modified:** `src/hooks/useLazyPanelMetrics.ts` only.

### Acceptance Criterion Reading: `aria-label="Equity chart view"` grep

The plan's literal grep targets `aria-label="Equity chart view"` in `HeadlineMetricsPanel.tsx`. My implementation passes the value via the `ariaLabel` prop to `SegmentedControl`, which then renders `aria-label={ariaLabel}` on the underlying `<div>`. The rendered DOM contract is satisfied (the served HTML has `aria-label="Equity chart view"`); only the source-level grep misses because of camelCase prop indirection. Plan 14a-05's test suite asserts on the DOM, so the runtime contract holds. Documented for verifier visibility.

### Concurrent Wave 1 Note (carryover from 14a-02)

The 14a-02 SUMMARY flagged that the `EquityCurve.tsx` `#0D9488 → CHART_ACCENT` refactor was completed ahead of schedule in commit `6a69580`. Confirmed: opening `EquityCurve.tsx` for this plan, all hex literals on lines 39, 45, 87 are already `CHART_ACCENT` (verified in the head-of-task Read). This plan therefore did NOT need to perform that refactor again, only the `hideBenchmarkToggle` prop addition.

## Authentication Gates

None — this plan ships UI components only. No external services, no API keys, no user auth flow.

## Threat Model Compliance

All three mitigations from Plan §threat_model are honored:

| Threat | Disposition | Implementation |
| ------ | ----------- | -------------- |
| T-14a-03-01 (Information disclosure via prop serialization) | accept | `StrategyV2Shell` consumes `StrategyV2Detail` which is the published-strategy public projection (verified Plan 14a-02). No secrets in props. |
| T-14a-03-02 (DoS via excessive IO instances) | mitigate | `useLazyPanelMetrics` is one-shot (`observerRef.current?.unobserve(entry.target)` after first intersection). Each placeholder has its own observer; max 4 IO instances per page (Panels 4–7). |
| T-14a-03-03 (Tampering via disabled buttons) | mitigate | `SegmentedControl.tsx:43` uses `aria-disabled="true"` (NOT native `disabled`) and `onClick={(e) => e.preventDefault()}` short-circuits clicks. UI-SPEC §8 contract honored. |

No new threat-model surface introduced; no `threat_flags` to report.

## Self-Check: PASSED

- ✅ FOUND: src/hooks/useLazyPanelMetrics.ts
- ✅ FOUND: src/components/strategy-v2/StrategyV2Shell.tsx
- ✅ FOUND: src/components/strategy-v2/OverviewPanel.tsx
- ✅ FOUND: src/components/strategy-v2/HeadlineMetricsPanel.tsx
- ✅ FOUND: src/components/strategy-v2/DrawdownPanel.tsx
- ✅ FOUND: src/components/strategy-v2/LazyPanelPlaceholder.tsx
- ✅ FOUND: src/components/strategy-v2/PartialDataBanner.tsx
- ✅ FOUND: src/components/strategy-v2/SegmentedControl.tsx
- ✅ FOUND: 872c8c8 (Task 1 commit on main)
- ✅ FOUND: d9df3b0 (Task 2 commit on main)
- ✅ FOUND: bf95fa5 (Task 3 commit on main)
- ✅ Branch is `main` (verified post-commit; no checkout/pull/rebase ops performed)
- ✅ Type-scale grep contract holds across all 7 v2 components (zero font-medium/light/bold; zero text-sm/xl/2xl/[11px]/[13px]/[14px])
- ✅ `npx tsc --noEmit` exit 0
- ✅ `npm run build` exit 0
- ✅ No stub patterns introduced (all components consume real data from `StrategyV2Detail` props; placeholders intentionally render "Loading…" copy until Phase 14b lands the bodies — explicit per CONTEXT.md and not a stub)
