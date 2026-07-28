# Phase 52 — Deferred Items

## 52-02 — Surface-wide raw-px grep is unsatisfiable as written (scope decision)

**Discovered:** 52-02 execution (Task 3), 2026-06-29.

**Conflict:** Task 3's verify command + AC #4 demand the WHOLE `allocations/`
tree be raw-px-zero:

```
grep -rn "text-\[[0-9]*px\]" "src/app/(dashboard)/allocations/" | grep -v "\.test\." == 0
```

But the plan's own `<interfaces>` block (line 99) and `files_modified`
frontmatter name a NARROW migration set — exactly 7 component files
(AlertBanner, ScenarioComposer:2779-only, HoldingsTable, StressVarSection,
MonteCarloSection, OpenPositionsTable, KpiStrip). The surface-wide grep spans
**107** sites across **~30** files. Two halves of the verify are mutually
exclusive:

- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` is a
  **FROZEN ISLAND** (in the 52-01 `FROZEN_ISLANDS` list) with 4 raw-px sites.
  Editing it turns the 52-frozen-spine guard RED — and that guard is Task 3's
  OTHER verify. So the grep-zero half and the guard-green half cannot both pass.
- 16 further orphan files carry raw px and are **not** in any 52-plan's
  `files_modified` (52-03 owns compare/, 52-04 discovery/, 52-05 strategy/[id]/,
  52-06 factsheet/v2/ — none claim allocations/widgets/ or the page-level tabs).

**Resolution (auto-selected, recommended option):** Scope the px migration to the
7 named files (the planner's clear intent). The named files are now raw-px-zero.
The surface-wide grep is treated as the named-files scope. This is consistent
with the plan objective: the `no-raw-font-px=error` ratchet for this glob lands
in **52-07** (single owner of `eslint.config.mjs`), so today the orphans are
lint **warnings** (0 errors) and do NOT block CI.

**Action required before 52-07 flips the glob to `error`:** 52-07's glob MUST
either (a) exclude the frozen `widgets/performance/EquityChart.tsx` (it can never
be migrated) and the orphan files below, or (b) a follow-up plan must own and
migrate the orphans first. Otherwise 52-07's `error` ratchet goes red on land.

### Orphan files with raw `text-[Npx]` (NOT migrated by 52-02; 65 sites)

- `widgets/performance/EquityChart.tsx` — **FROZEN ISLAND, never migrate** (4)
- `widgets/performance/ScenarioFactsheetChart.tsx`
- `widgets/outcomes/OutcomesWidget.tsx`
- `widgets/risk/CorrelationMatrix.tsx`
- `widgets/risk/TailRisk.tsx`
- `widgets/risk/VarExpectedShortfall.tsx`
- `AllocationDashboardV2.tsx`
- `AllocationsTabs.tsx`
- `MandateTabPanel.tsx`
- `ScenarioFlaggedHoldingsList.tsx`
- `components/BridgeWidget.tsx`
- `components/HoldingDetail.tsx`
- `components/ScenarioBenchmarkSection.tsx`
- `components/ScenarioCompareTable.tsx`
- `components/ScenarioFooter.tsx`
- `components/StrategyBrowseDrawer.tsx`
- `components/WeightOptimizerSection.tsx`
- `components/ScenarioComposer.tsx` — 17 sites OTHER than :2779 (plan restricted
  this file to the :2779 clip-fix ONLY; do not touch math-adjacent spans).

## 52-03 — Chrome `max-w-7xl` caps the page-level `max-w-[1920px]` fluid-fill

**Discovered:** 52-03 execution (Task 1), 2026-06-29.

**Observation:** `DashboardChrome.tsx` wraps every non-full-bleed dashboard route
(including `/compare`) in `<main … className="mx-auto max-w-7xl px-4 py-6 …">`
(`max-w-7xl` = 1280px, line 156). Plan 52-03 raised the compare PAGE content to
`mx-auto max-w-[1920px]` (per the plan's `<interfaces>` directive), but that cap
is currently dominated by the chrome's 1280px parent cap — so compare does not
visibly fluid-fill to 1920px until the chrome cap is raised.

**Why not fixed here:** `DashboardChrome.tsx` is a SHARED file outside 52-03's
`files_modified` (52-03 owns `compare/**` + `CompareTable.tsx` only). Raising the
chrome cap affects the whole allocator journey (allocations 52-02, discovery
52-04, compare 52-03) and would collide with the parallel surface plans. The
page-level `max-w-[1920px]` is correct and forward-compatible: when the chrome
cap is raised (the consolidated owner of `DashboardChrome.tsx`), compare
immediately fluid-fills with no further compare-side change. No overflow at
320/2560 either way (`mx-auto max-w-*` never overflows). The page-level cap
satisfies 52-03's AC + must-have truth at the page layer.

**Action required (consolidated wave / shell owner):** decide whether to raise
`DashboardChrome.tsx`'s `max-w-7xl` content cap to `max-w-[1920px]` for the
data-surface routes so the per-page caps take visible effect. This is a
single-owner decision on the shared chrome file (do NOT split it across the
parallel surface plans).

**RESOLVED (52-07, 2026-06-29):** Shell-owner decision taken — `DashboardChrome.tsx`
now adds an `isWide` allow-list (`/allocations`, `/compare`, `/discovery/*`,
regex `^\/(allocations|compare|discovery)(\/|$)`) mirroring the existing
`isFullBleed` pattern. When `isWide`, the standard shell's content container
uses `max-w-[1920px]`; all other dashboard routes (incl. the Phase-53 surfaces
portfolios/security/admin/wizard) keep `max-w-7xl`. The page-level
`max-w-[1920px]` set by 52-02/03/04 now fluid-fills as intended. Commit
`feat(52): DashboardChrome wide-variant` (7c39c9fb); test asserts both branches.

## 52-07 — Phase 52 orphan raw-px debt (deferred to Phase 53/54)

**Discovered/consolidated:** 52-07 execution (the eslint ratchet), 2026-06-29.

**User decision applied:** "Per-file ratchet + log debt." The planner under-scoped
the px migration, so the `allocations/**` and `factsheet/[id]/v2/**` trees are NOT
fully clean. 52-07 therefore did NOT flip those whole globs to `no-raw-font-px=error`
— it flipped only the grep-proven-clean (zero `text-[Npx]`) surface globs
(`compare/**`, `discovery/**`, `strategy/[id]/**`), the clean component files
(`CompareTable.tsx`, `StrategyGrid.tsx`), and the specific allocations/factsheet
files that grep-proved clean. The ORPHAN files below still carry raw `text-[Npx]`
and remain at the repo-wide `no-raw-font-px: warn` (0 lint errors, non-blocking).
They are Phase-53/54 migration debt (or permanently exempt where noted).

### Allocations orphan files (18 — still at `warn`, NOT migrated by 52-02)

- `widgets/performance/EquityChart.tsx` — **FROZEN ISLAND, NEVER migrate** (4 sites;
  in the 52-01 `FROZEN_ISLANDS` list — editing it reds the frozen-spine guard).
- `widgets/performance/ScenarioFactsheetChart.tsx`
- `widgets/outcomes/OutcomesWidget.tsx`
- `widgets/risk/CorrelationMatrix.tsx`
- `widgets/risk/TailRisk.tsx`
- `widgets/risk/VarExpectedShortfall.tsx`
- `AllocationDashboardV2.tsx`
- `AllocationsTabs.tsx`
- `MandateTabPanel.tsx`
- `ScenarioFlaggedHoldingsList.tsx`
- `components/BridgeWidget.tsx`
- `components/HoldingDetail.tsx`
- `components/ScenarioBenchmarkSection.tsx`
- `components/ScenarioCompareTable.tsx`
- `components/ScenarioFooter.tsx`
- `components/StrategyBrowseDrawer.tsx`
- `components/WeightOptimizerSection.tsx`
- `components/ScenarioComposer.tsx` — 18 sites OTHER than the :2779 clip-fix the
  52-02 plan restricted this file to; do not touch the math-adjacent spans here.

(The clean allocations files — page/loading/error, the tab panels, KpiStrip,
AlertBanner, HoldingsTable, StressVarSection, MonteCarloSection,
OpenPositionsTable, EmptyState, ScenarioStub, AllocationContext — ARE now at
`error` via per-file globs in 52-07.)

### Factsheet v2 orphan files (7 — still at `warn`, NOT migrated by 52-06)

- `TimeSeriesChart.tsx` — **chart-internal SVG, keep EXEMPT** (coordinate math).
- `HistogramChart.tsx` — **chart-internal SVG, keep EXEMPT**.
- `MasterBrush.tsx` — **chart-internal SVG, keep EXEMPT**.
- `MetricsColumn.tsx`
- `MandatePanels.tsx`
- `StressWindowsPanel.tsx`
- `page.tsx`

(The clean factsheet files — FactsheetView, Analytical/BatchD/CrossSignature/
Distribution/Heatmap/Signature panels, ComparatorPicker, LazyMount,
factsheet-context, loading/error/not-found — ARE now at `error` in 52-07.)

**Note on the chart-internal files:** TimeSeriesChart/HistogramChart/MasterBrush
pin raw px for SVG coordinate/axis math the same way `src/components/charts/**`
is `off` by glob. They should stay exempt (warn, or moved under a chart-glob `off`
if a later phase consolidates them), NOT force-migrated. The frozen EquityChart is
permanently never-migrate. Everything else above is genuine Phase-53/54 token-spine
migration debt.

## 52 code-review dispositions (2026-06-29)

REVIEW.md found 3 CRITICAL + 4 WARNING + 1 INFO. Dispositions:

**Fixed now (commit f9f74beb):**
- CR-02 (HoldingsTable StrategySortableHeader missing `aria-sort`) — fixed, matches sibling SortableHeader. WCAG 1.3.1.
- CR-03 (ScenarioComposer ResetConfirmationModal focus) — MINIMAL fix: `autoFocus` Cancel + Escape-to-close. Full focus-trap (use the Phase-50 `Modal` primitive) + focus-return-on-close DEFERRED to Phase 54 a11y audit (composer-island sensitivity; pre-existing, not a phase-52 regression).
- WR-01 (strategy/[id]/page.tsx double `getPublicStrategyDetail`) — wrapped in `React.cache` (request memoization).

**False positive (no action):**
- CR-01 (formatPercent/formatCurrency leak "NaN%"/"$NaN") — STALE. `src/lib/utils.ts` lines 8/28/33 ALREADY guard `!Number.isFinite() → "—"`. The reviewer trusted a stale "fix in follow-up" comment in KpiStrip.test.tsx; the test itself asserts "NaN" never renders and passes. (Optional tidy: refresh the stale M-0085 comments — trivial, not done.)

**Deferred to Phase 54 (pre-existing, minor, NOT phase-52 regressions):**
- WR-02 (AlertBanner `res.status !== 204` dead guard) — harmless dead condition.
- WR-03 (discovery [strategyId] `md:left-[260px]` hardcoded sidebar width) — established codebase pattern (DashboardChrome also hardcodes 260px); not phase-52-introduced.
- WR-04 (allocations/page.tsx inner `<Suspense fallback={<div/>}>` invisible) — route-level loading.tsx now covers initial load; inner streamed boundary skeleton is a polish item.
- IN-01 (discovery [strategyId] two `RequestIntroButton` without distinguishing aria-label) — minor a11y polish.
