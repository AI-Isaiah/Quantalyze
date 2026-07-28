---
phase: 14a
fixed_at: 2026-04-29T11:08:41Z
review_path: .planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 14a: Code Review Fix Report

**Fixed at:** 2026-04-29T11:08:41Z
**Source review:** .planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (MD-01 through MD-05 + LW-04 escalated)
- Fixed: 6
- Skipped: 0

---

## Fixed Issues

### MD-01: Incorrect underwater transform in Panel 2

**Files modified:** `src/components/strategy-v2/HeadlineMetricsPanel.tsx`
**Commit:** `923d390`
**Applied fix:** Replaced `Math.min(0, d.value - 1)` with correct running-max drawdown formula. The map now accumulates `runningMax` via `arr.slice(0, i+1).reduce(max)` and emits `d.value / runningMax - 1`. For a strategy peaking at 1.42 and pulling back to 1.25, this correctly yields ~−12% instead of the prior 0%.

---

### MD-02: `getStrategyDetailV2` not wrapped in `React.cache()`

**Files modified:** `src/lib/queries.ts`
**Commit:** `4198934`
**Applied fix:** Changed `export async function getStrategyDetailV2(...)` to `export const getStrategyDetailV2 = cache(async function getStrategyDetailV2(...) { ... });`. `cache` was already imported from `"react"` at line 1. Matches the pattern used by `getRealPortfolio` and `getMyAllocationDashboard`. Eliminates the double Supabase round-trip per page load.

---

### MD-03: `EquityCurve` `fontSize: 11` not updated to 12

**Files modified:** `src/components/charts/EquityCurve.tsx`
**Commit:** `8950007`
**Applied fix:** Changed `fontSize: 11` to `fontSize: 12` in the lightweight-charts `layout` config (line 48). Added inline comment referencing CHART_TICK_STYLE 12px contract and UI-SPEC §2.

---

### MD-04: `DrawdownChart` XAxis/YAxis tick props are inline objects

**Files modified:** `src/components/charts/DrawdownChart.tsx`
**Commit:** `b1ed2f8`
**Applied fix:** Replaced both `tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}` literals on XAxis (line 27) and YAxis (line 34) with `tick={CHART_TICK_STYLE}`. Updated imports to remove now-unused `CHART_AXIS_TICK` and `CHART_FONT_MONO`, adding `CHART_TICK_STYLE` instead. Pitfall 14 compliance: `tick=\{\{` grep now returns zero matches in this file.

---

### MD-05: Unstable `ref` callback in `useLazyPanelMetrics`

**Files modified:** `src/hooks/useLazyPanelMetrics.ts`
**Commit:** `2357a47`
**Applied fix:** Added `useCallback` to the import list and wrapped the `ref` callback with `useCallback(..., [])`. Added explanatory comment noting that `opts.rootMargin` is intentionally excluded from the dependency array (opts is not stable; dynamic rootMargin callers should extract it to a separate stable param). Added `eslint-disable-next-line react-hooks/exhaustive-deps` directive to document the intentional omission.

---

### LW-04: `PartialDataBanner` missing `role="status"`

**Files modified:** `src/components/strategy-v2/PartialDataBanner.tsx`
**Commit:** `0c694ed`
**Applied fix:** Added `role="status"` attribute to the banner root `<div>`. Screen readers will now announce the banner when it appears after a client-side state change (e.g., flag reader hydration-swap). Single attribute addition, no structural changes.

---

## Skipped Issues

None — all findings were fixed.

---

## Deferred Issues (out of scope per fix_context)

- **LW-01** (DrawdownPanel "use client" cosmetic) — deferred; works correctly.
- **LW-02** (toLocaleString locale risk in OverviewPanel) — deferred; cross-cuts beyond 14a scope.
- **LW-03** (Sentry TODO comment in error.tsx) — deferred; project-wide pattern decision.

---

## Final Summary Table

| Finding | File | Status | Commit |
|---------|------|--------|--------|
| MD-01 | HeadlineMetricsPanel.tsx:196-202 | fixed | `923d390` |
| MD-02 | queries.ts:347 | fixed | `4198934` |
| MD-03 | EquityCurve.tsx:48 | fixed | `8950007` |
| MD-04 | DrawdownChart.tsx:26,33 | fixed | `b1ed2f8` |
| MD-05 | useLazyPanelMetrics.ts:58 | fixed | `2357a47` |
| LW-04 | PartialDataBanner.tsx:16 | fixed | `0c694ed` |

## Verify Cycle Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS — zero errors |
| `npm run build` | PASS — compiled successfully, 73 pages generated |
| `npm test -- --run` | PASS — 2398 tests passed, 0 failures (242 files) |

## Verdict

**All 6 in-scope findings fixed. Zero regressions.** Phase 14a is clean on all Pitfall 14 acceptance gates: `tick=\{\{` grep returns zero matches in v2 panel files, `EquityCurve` fontSize matches 12px contract, `getStrategyDetailV2` is cache-deduplicated, Underwater chart math is correct, and the IntersectionObserver ref is stable for Phase 14b wiring.

---

_Fixed: 2026-04-29T11:08:41Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

---

## UI Review Fix Pass

**Fixed at:** 2026-04-29T13:19:00Z
**Source review:** .planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-UI-REVIEW.md
**Scope:** F1 (Medium), F2 (Medium), F3 (Low) — F4/F5/F6/F7 deferred per fix_context

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

### F1: Missing VerifiedBadge in StrategyV2Shell header

**File modified:** `src/components/strategy-v2/StrategyV2Shell.tsx`
**Commit:** `33d157b`
**Applied fix:** Added `import { VerifiedBadge } from "@/components/ui/VerifiedBadge"`. Wrapped the `<h1>` in a `<div className="flex items-center gap-3">` and placed `<VerifiedBadge />` inline after it — identical structure to the v1 factsheet pattern at `src/app/strategy/[id]/page.tsx:120–125`. Rendered unconditionally (Strategy type has no `is_verified` field; v1 also renders unconditionally). Visual identity trust signal restored.

### F2: DrawdownChart (Underwater view) has no BTC benchmark overlay

**Files modified:** `src/components/charts/DrawdownChart.tsx`, `src/components/strategy-v2/HeadlineMetricsPanel.tsx`
**Commit:** `b2cc89b`
**Applied fix:**
- `DrawdownChart.tsx`: Added optional `benchmarkSeries?: { date: string; value: number }[] | null` prop. Added `mergeWithBenchmark()` helper that computes running-max drawdown for the BTC series and aligns it to the strategy data by date via a Map. Imports `Line` from recharts plus `CHART_TEXT_MUTED` and `CHART_REFERENCE_DASH` from chart-tokens. When `benchmarkSeries` is present, conditionally renders a `<Line dataKey="benchmarkDrawdown" stroke={CHART_TEXT_MUTED} strokeDasharray={CHART_REFERENCE_DASH} dot={false}>` inside the AreaChart. Tooltip formatter distinguishes "BTC" vs "Drawdown" labels by dataKey name.
- `HeadlineMetricsPanel.tsx`: Added `benchmarkSeries={effectiveBenchmark}` prop to the `<DrawdownChart>` call in the Underwater branch. `effectiveBenchmark` is already computed (null when checkbox is off or no data), so the BTC checkbox now correctly controls the underwater overlay.

### F3: EquityCurve hardcodes "#94A3B8" instead of CHART_TEXT_MUTED token

**File modified:** `src/components/charts/EquityCurve.tsx`
**Commit:** `8f2515d`
**Applied fix:** Added `CHART_TEXT_MUTED` to the import from `./chart-tokens`. Replaced `color: "#94A3B8"` (line 105) with `color: CHART_TEXT_MUTED` in the LineSeries config. Replaced `bg-[#94A3B8]` (line 130 Tailwind class, not resolvable from a token) with an inline `style={{ backgroundColor: CHART_TEXT_MUTED }}` on the swatch `<span>`. Both occurrences now reference the canonical token; silent drift on color changes is eliminated.

### Skipped Findings

None — all 3 in-scope findings were fixed.

### Deferred (out of scope per fix_context)

| Finding | Severity | Reason |
|---------|----------|--------|
| F4 — figure/figcaption restructuring | Low | Cosmetic semantic HTML; no visual impact |
| F5 — LazyPanelPlaceholder minHeight off-ladder | Low | Low visual impact; implementation detail |
| F6 — "BTC Benchmark" capital B | Cosmetic | v1 path only; no v2 copy contract violation |
| F7 — DrawdownPanel H3 "Drawdown" duplicates H2 | Cosmetic | Deferred until panel gains sub-regions |

### Verify Cycle Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS — zero errors |
| `npm run build` | PASS — compiled successfully, `/strategy/[id]/v2` route included |
| `npm test -- --run` | PASS — 2398 tests passed, 0 failures (242 files) |

---

_Fixed: 2026-04-29T13:19:00Z_
_Fixer: Claude (gsd-code-fixer)_
_UI Review Pass: iteration 1_
