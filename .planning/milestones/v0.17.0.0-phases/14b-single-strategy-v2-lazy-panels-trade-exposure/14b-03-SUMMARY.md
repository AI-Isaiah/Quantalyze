---
phase: 14b-single-strategy-v2-lazy-panels-trade-exposure
plan: 03
subsystem: ui
tags: [strategy-v2, panel-5, rolling-metrics, segmented-control, recharts, partial-data, sharpe-mapping, grok-b-01]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    provides: "metrics.py persists rolling Sharpe at {30, 90, 365}-day windows ONLY (NOT 180d); analytics-service/services/metrics.py:145-147"
  - phase: 12-backend-metric-contracts
    provides: "Migration 087 sibling-table emits rolling_sortino_{3m,6m,12m}, rolling_volatility_{3m,6m,12m}, rolling_alpha, rolling_beta via fetch_strategy_lazy_metrics(strategy_id, 'rolling') RPC"
  - phase: 14a-single-strategy-v2-eager-panels-identity
    provides: "useLazyPanelMetrics hook (panel5 lazy id), SegmentedControl, PartialDataBanner, chart-tokens (CHART_ACCENT/CHART_TEXT_MUTED/CHART_REFERENCE_DASH/CHART_TICK_STYLE/CHART_TOOLTIP_STYLE), v2 panel chrome (mt-8 / rounded-lg / border-border / bg-surface / p-6 / shadow-card / min-h-[240px])"
  - phase: 14b-01
    provides: "useLazyPanelMetrics fetchOnIntersect=true path activated against the panel5 RPC kind"
provides:
  - "RollingVolatilityChart — single CHART_ACCENT line, percent Y-axis, role=img/aria-label='Rolling volatility'"
  - "RollingSortinoChart — single CHART_ACCENT line, ratio Y-axis (no %), role=img/aria-label='Rolling Sortino'"
  - "RollingAlphaBetaChart — dual lines (alpha solid CHART_ACCENT, beta dashed CHART_TEXT_MUTED+CHART_REFERENCE_DASH), Recharts Legend, merge-by-date, single-line fallback when only one series populated"
  - "RollingMetricsPanel (Panel 5) — wrapper owning shared 3M/6M/12M window state, lazy-fetches panel5 payload, mounts 4 sub-charts (Sharpe via existing RollingMetrics, Vol/Sortino/AlphaBeta via 14b-03 wrappers), per-window partial-data sub-banners, panel-level <90d gate"
  - "SHARPE_KEY_BY_WINDOW mapping (Grok B-01): 3M→sharpe_90d (fb sharpe_30d), 6M→sharpe_90d (fb sharpe_365d), 12M→sharpe_365d (fb sharpe_90d) — closes the silent-empty-render path on the 6M default-active button"
affects: [14b-06-shell-wiring, 14b-07-axe-core-ci, 14b-08-chart-snapshot-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sub-chart wrapper pattern with role=img + aria-label (axe-core svg-img-alt mitigation)"
    - "Per-window partial-data sub-banners — em-dash + ≥-unicode copy template `Awaiting more data — need ≥{N} days for {W} rolling window.`"
    - "SHARPE_KEY_BY_WINDOW — primary + fallback table with explicit closest-available approximation when the conceptual window is not a persisted backend key"

key-files:
  created:
    - "src/components/charts/RollingVolatilityChart.tsx"
    - "src/components/charts/RollingVolatilityChart.test.tsx"
    - "src/components/charts/RollingSortinoChart.tsx"
    - "src/components/charts/RollingSortinoChart.test.tsx"
    - "src/components/charts/RollingAlphaBetaChart.tsx"
    - "src/components/charts/RollingAlphaBetaChart.test.tsx"
    - "src/components/strategy-v2/RollingMetricsPanel.tsx"
    - "src/components/strategy-v2/RollingMetricsPanel.test.tsx"
  modified: []

key-decisions:
  - "SHARPE_KEY_BY_WINDOW table (Grok B-01): 6M maps to sharpe_90d as the closest-available persisted window (not the conceptual 180d which Phase 12 metrics.py does NOT ship). Fallback chain ensures the Rolling Sharpe sub-section never silently empties when ANY of the 3 known persisted keys is populated."
  - "Rolling Alpha & Beta is NOT window-segmented (matches the lazy-payload shape from migration 087: rolling_alpha and rolling_beta arrive as single arrays, not per-window). The shared window toggle drives Sharpe/Volatility/Sortino only; alpha/beta render unconditionally when status='ready'."
  - "Per-window sub-banner copy uses verbatim em-dash + ≥-unicode template `Awaiting more data — need ≥{N} days for {W} rolling window.` for KPI-23b parity with 14a banner copy."
  - "Test stack — switched from @testing-library/user-event to fireEvent (Rule 3 deviation: package not in tree). fireEvent.click works for the segmented-control aria-pressed buttons since SegmentedControl uses native <button>."

patterns-established:
  - "3 chart wrappers (Vol/Sortino/AlphaBeta) follow the identical 50-line skeleton from RollingMetrics.tsx — useMemo merge for multi-series, ResponsiveContainer height=250, CHART_TICK_STYLE on both axes, role=img + aria-label outer wrapper. Future Panel 7 charts (NetGrossExposure, Turnover) reuse this skeleton."
  - "RollingMetricsPanel SubChartSection sub-component: { title, gated, gatedBody, children } — gates render between a sub-banner and the chart body. Reusable across panels 4–7 for per-section partial-data."

requirements-completed: [KPI-08, KPI-09, KPI-10, KPI-11, KPI-23b]

# Metrics
duration: ~12min
completed: 2026-04-29
---

# Phase 14b-03: Rolling Metrics Panel + 3M/6M/12M Window Toggle Summary

**Panel 5 wrapper plus 3 new rolling sub-charts (Volatility, Sortino, Alpha+Beta), shared SegmentedControl driving 4 sub-charts (default 6M), and Grok B-01 SHARPE_KEY_BY_WINDOW mapping that prevents the 6M default-active button from silently emptying against a non-persisted backend key.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-29T13:13Z
- **Completed:** 2026-04-29T13:25:16Z
- **Tasks:** 2
- **Files created:** 8
- **Files modified:** 0

## Accomplishments

- 3 new rolling-chart components shipped (Volatility / Sortino / Alpha+Beta) — uniform 50-line skeleton, role=img+aria-label, CHART_TICK_STYLE on both axes, single CHART_ACCENT line for the unitless metrics, dual-line CHART_ACCENT+CHART_TEXT_MUTED-with-CHART_REFERENCE_DASH for alpha/beta with single-line graceful fallback
- RollingMetricsPanel (Panel 5) wrapper with 14a chrome, lazy-fetches panel5 payload via useLazyPanelMetrics<Panel5LazyPayload>('panel5', { fetchOnIntersect: true, strategyId }), mounts SegmentedControl driving 4 stacked sub-charts
- Per-window partial-data sub-banners (KPI-23b for Panel 5): panel-level <90d banner replaces all sub-charts; per-window <{180,365}d sub-banner replaces just that section's chart body
- Grok B-01 SHARPE_KEY_BY_WINDOW mapping ships intact — 3M→sharpe_90d (fb sharpe_30d), 6M→sharpe_90d (closest-available; fb sharpe_365d), 12M→sharpe_365d (fb sharpe_90d). Verified against analytics-service/services/metrics.py:145-147 which persists exactly {sharpe_30d, sharpe_90d, sharpe_365d}.
- 38 new tests passing (21 chart + 17 panel); 487/487 component sweep zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: 3 new rolling chart components (Vol / Sortino / Alpha+Beta)** — `c899239` (feat) — TDD RED→GREEN; 21 tests
2. **Task 2: RollingMetricsPanel wrapper + Grok B-01 SHARPE_KEY_BY_WINDOW** — `bbcd842` (feat) — TDD RED→GREEN; 17 tests

## Files Created/Modified

- `src/components/charts/RollingVolatilityChart.tsx` — Single-line Recharts wrapper consuming `{ date, value }[]`; CHART_ACCENT stroke, percent Y-axis formatter; returns null on empty
- `src/components/charts/RollingVolatilityChart.test.tsx` — 6 tests (Line stroke/width, axis tick style, percent formatter, ResponsiveContainer height, role=img wrapper, no inline tick literal)
- `src/components/charts/RollingSortinoChart.tsx` — Identical skeleton to Volatility; ratio Y-axis formatter (`v.toFixed(2)`)
- `src/components/charts/RollingSortinoChart.test.tsx` — 6 tests mirroring Volatility
- `src/components/charts/RollingAlphaBetaChart.tsx` — Two-line wrapper merging alpha+beta by date; alpha solid CHART_ACCENT 1.5px, beta dashed CHART_TEXT_MUTED 1px + CHART_REFERENCE_DASH; renders only the populated series when one is empty
- `src/components/charts/RollingAlphaBetaChart.test.tsx` — 9 tests (dual stroke contract, Legend, both-empty→null, single-array fallback, role=img wrapper, no inline ticks)
- `src/components/strategy-v2/RollingMetricsPanel.tsx` — Panel 5 wrapper. Owns activeWindow (default 6M), lazy-fetches via useLazyPanelMetrics, gates panel-level <90d, gates per-window sub-banners, maps Sharpe to closest-available persisted key via pickSharpeForWindow + SHARPE_KEY_BY_WINDOW
- `src/components/strategy-v2/RollingMetricsPanel.test.tsx` — 17 tests covering chrome, lifecycle (idle/loading/ready/error), default 6M active, click-12M data swap, Sharpe key mapping for 3 windows, sparse fallback chain, both-keys-absent gating, sub-banner copy at 120d/200d/100d boundaries, H3 ordering+class set, no inline ticks, no v2 type-token violators, alpha/beta wired to lazy payload arrays directly

## Decisions Made

- **Grok B-01 mitigation locked in code (Decision):** `SHARPE_KEY_BY_WINDOW` table maps `6M → sharpe_90d` as the closest-available persisted window. Documented inline at the constant declaration with explicit rationale: Phase 12 metrics.py persists only {sharpe_30d, sharpe_90d, sharpe_365d} per analytics-service/services/metrics.py:145-147. The 180d window is a v0.17.1+ backend item if/when prioritized; UI-SPEC §3.2 locks the user-facing toggle copy to 3M/6M/12M.
- **Alpha/beta NOT window-segmented (Decision):** The lazy-payload shape from migration 087 emits `rolling_alpha` and `rolling_beta` as single arrays (not per-window). The shared window toggle drives Sharpe/Vol/Sortino only; the alpha+beta sub-chart consumes the lazy payload arrays directly and is unaffected by toggle changes. Explicit `gated={false}` documented on the SubChartSection.
- **Test stack — fireEvent over user-event (Decision):** Rule 3 deviation. The repo does not have @testing-library/user-event installed (verified via package.json grep). The plan's recommended `userEvent.setup().click(...)` was swapped to `fireEvent.click(...)` from `@testing-library/react` (already imported). Both produce equivalent DOM events for the SegmentedControl's native <button> elements; the test assertions are unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @testing-library/user-event not installed**
- **Found during:** Task 2 (test runner)
- **Issue:** Plan's Task 2 action specified `userEvent.setup().click(button)` for the segmented-control click test. The package is not in the repo's `package.json` (verified via grep). Vite import-analysis blocks the module resolution.
- **Fix:** Swapped to `fireEvent.click(button)` imported from `@testing-library/react` (already imported in 30+ existing test files in the repo, e.g. `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx`). fireEvent dispatches a synthetic `click` event on the native `<button>` which triggers the React onClick handler identically. Removed the user-event import; updated 4 click sites + dropped 4 `async`/`await` markers since fireEvent is synchronous.
- **Files modified:** `src/components/strategy-v2/RollingMetricsPanel.test.tsx`
- **Verification:** All 17 tests pass; segmented-control click assertions verified (Test 4: window swap, Test 5: Sharpe key mapping across all 3 windows, Test 6: fallback chain, Test 9: 12M sub-banner gate).
- **Committed in:** `bbcd842` (Task 2 commit)

**2. [Rule 1 - Bug] Panel source contained `sharpe_180d` literal in two doc-comments**
- **Found during:** Task 2 (Test 14 grep guard)
- **Issue:** The panel's docstrings explicitly named the non-persisted `sharpe_180d` key when explaining what is NOT shipped by the backend. The plan's verification gate is `grep -rn "sharpe_180d" src/components/strategy-v2/ src/components/charts/` MUST return 0 — strict zero across panel + chart trees. Even commentary mentioning the forbidden literal trips the guard.
- **Fix:** Rephrased the two doc-comments at `RollingMetricsPanel.tsx:28` and `RollingMetricsPanel.tsx:210` to avoid the literal token. Also rewrote `Test 14` in the test file to construct the forbidden literal at runtime via `["sharpe", "180d"].join("_")` so the test assertion still meaningfully checks for absence without trip-wiring the panel-tree grep.
- **Files modified:** `src/components/strategy-v2/RollingMetricsPanel.tsx`, `src/components/strategy-v2/RollingMetricsPanel.test.tsx`
- **Verification:** `grep -rn "sharpe_180d" src/components/strategy-v2/ src/components/charts/` returns no matches. 17/17 tests pass including Test 14 fallback-literal construction.
- **Committed in:** `bbcd842` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 bug)
**Impact on plan:** Both auto-fixes were execution-environment realities the plan author could not have known about (user-event presence, grep-guard strictness). No scope creep — the swapped test mechanism produces identical assertions, the doc-comment rephrasing preserves the original technical narrative.

## Issues Encountered

None — both deviations were caught immediately by the test runner / grep guard and fixed inline within the same task commit.

## Self-Check: PASSED

All claimed artefacts exist on disk and are committed:
- `src/components/charts/RollingVolatilityChart.tsx` — FOUND (committed at `c899239`)
- `src/components/charts/RollingVolatilityChart.test.tsx` — FOUND (committed at `c899239`)
- `src/components/charts/RollingSortinoChart.tsx` — FOUND (committed at `c899239`)
- `src/components/charts/RollingSortinoChart.test.tsx` — FOUND (committed at `c899239`)
- `src/components/charts/RollingAlphaBetaChart.tsx` — FOUND (committed at `c899239`)
- `src/components/charts/RollingAlphaBetaChart.test.tsx` — FOUND (committed at `c899239`)
- `src/components/strategy-v2/RollingMetricsPanel.tsx` — FOUND (committed at `bbcd842`)
- `src/components/strategy-v2/RollingMetricsPanel.test.tsx` — FOUND (committed at `bbcd842`)
- Commits: `c899239` and `bbcd842` both present in `git log --oneline -3`

Verification commands executed:
- `npm test -- src/components/charts/Rolling src/components/strategy-v2/RollingMetricsPanel.test.tsx --run` → 5 files, 45 tests, all green
- `npm test -- src/components --run` → 55 files, 487 tests, all green (zero regressions across 14a)
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0
- `grep -rn "sharpe_180d" src/components/strategy-v2/ src/components/charts/` → zero matches
- `grep -rn "RollingVolatilityChart\|RollingSortinoChart\|RollingAlphaBetaChart\|RollingMetricsPanel" src/components/strategy-v2/StrategyV2Shell.tsx` → zero matches (NOT yet wired — that's 14b-06, per plan)

## Next Phase Readiness

- Panel 5 wrapper + 3 new rolling sub-charts are complete and ready for `StrategyV2Shell` mount in plan **14b-06**.
- 14b-06 will need to:
  1. Replace the existing Panel 5 `<LazyPanelPlaceholder />` slot with `<RollingMetricsPanel strategyId={...} history_days={...} rolling_metrics={analytics.rolling_metrics ?? null} sharpe={analytics.sharpe} />`
  2. Wire the eager `analytics.rolling_metrics` and `analytics.sharpe` props from `getStrategyDetailV2` (already shipped Phase 14a — Pitfall 8 honored: null pass-through preserved)
  3. The lazy `panel5` payload (rolling_volatility_*/rolling_sortino_*/rolling_alpha/rolling_beta) is fetched internally by the panel via `useLazyPanelMetrics`; no shell-side wiring needed.

- Panel 5 portion of KPI-23b is fulfilled. The remaining KPI-23b panels (4 already complete from 14b-02; 6 + 7 land in 14b-04 / 14b-05).

- **No blockers** for downstream plans 14b-04 (Panel 6 Trade & Position) or 14b-05 (Panel 7 Exposure & Greeks). Both are independent of Panel 5.

---
*Phase: 14b-single-strategy-v2-lazy-panels-trade-exposure*
*Completed: 2026-04-29*
