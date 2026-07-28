---
phase: 07-demo-mode-purge
plan: 05
subsystem: nextjs-client-empty-state + staleness-gate
tags: [nextjs, react, empty-state, warning-banner, staleness, overlay, purge-04]

# Dependency graph
requires:
  - phase: 07-demo-mode-purge
    plan: 03
    provides: "allKeysStale, hasSyncing, lastSyncAt, holdingsSummary on MyAllocationDashboardPayload; KpiStrip warm-up `—` already lands when allKeysStale=true"
  - phase: 07-demo-mode-purge
    plan: 04
    provides: "AllocationsTabs + ScenarioStub + STRATEGY_COMPOSITE_WIDGETS f2 widget-gating + equityDailyPoints forwarding to EquityCurve/DrawdownChart"
provides:
  - "EmptyState client component — two-branch render (InfoBanner for first-sync, centred Card for zero+idle) with /profile?tab=exchanges CTA"
  - "AllocationDashboard zero+idle short-circuit — returns full-replacement EmptyState + D-09 Notices card, skipping KPI + charts + widgets entirely"
  - "AllocationDashboard zero+syncing render — InfoBanner at top + D-09 Notices card below grid; falls through to normal render with 07-04 f2 widget-gating"
  - "AllocationDashboard data+stale render — WarningBanner above KPI strip + chart overlay (40% page-color dimmer with 'Data may be stale' label) + KPI `—` via 07-03 path"
  - "formatHoursAgo pure local helper — clamp-at-zero hours-ago arithmetic from ISO string; used by the D-10 WarningBanner copy"
affects: [08-connection-management, 09-bridge-live-holdings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-branch empty-state component — single prop (`hasSyncing`) drives a boolean switch between InfoBanner + centred-Card paths. Reusable for any surface that differentiates 'no data yet' vs 'data still loading'."
    - "Protective-triple staleness gate — WarningBanner + chart overlay + KPI `—` all trigger on the same `allKeysStale` signal; if any one fails the other two still communicate staleness (threat T-07-30 mitigation)."
    - "Chart-only overlay in renderWidget — conditional `<div className='absolute inset-0 bg-page/40 …'>` sibling inside the widget wrapper, gated by `widgetId === 'equity-curve' || widgetId === 'drawdown-chart'` AND `allKeysStale`. Chart internals untouched."
    - "Short-circuit early-return replace-entire-surface pattern — `holdingsEmpty && !hasSyncing` returns before the full render path ever runs, so the 07-04 widget-gating + renderWidget are skipped entirely for zero+idle allocators."

key-files:
  created:
    - "src/app/(dashboard)/allocations/EmptyState.tsx (57 lines — two-branch component, copy verbatim from 07-UI-SPEC.md §Copywriting)"
    - "src/app/(dashboard)/allocations/EmptyState.test.tsx (98 lines, 4 TDD Red gate tests — zero+idle CTA, first-sync banner, D-07 minimalism, route invariance)"
  modified:
    - "src/app/(dashboard)/allocations/AllocationDashboard.tsx (+91 lines: formatHoursAgo helper; holdingsSummary/hasSyncing/lastSyncAt destructure with defaults; zeroHoldingsNoticesCard JSX; zero+idle early-return; zero+syncing InfoBanner mount; stale WarningBanner above KPI strip; stale chart overlay in renderWidget; zero+syncing Notices card below grid; Link/Card/WarningBanner/EmptyState imports)"
    - "src/app/(dashboard)/allocations/AllocationDashboard.widget-gating.test.tsx (+11 lines: MOCK_HOLDINGS fixture so basePayload no longer triggers the new 07-05 zero+idle early-return — the widget-gating path is the thing this test exercises; 07-05 branch coverage lives in EmptyState.test.tsx)"

key-decisions:
  - "The zero+idle branch short-circuits via an early-return at the top of the main render (before the JSX fragment). Rationale: returning <><EmptyState/> + Notices</> via conditional rendering inside the main fragment would still pay the cost of running the 07-04 visibleConfig useMemo, the KpiStrip/InsightStrip render, and the DashboardGrid layout computation. The early-return gives one headline + one CTA + one Notices card with zero wasted work."
  - "Default values for the new destructured props (`holdingsSummary = []`, `hasSyncing = false`, `lastSyncAt = null`). Phase 5/9 call sites (like the regression-001 test reading source statically and the widget-gating test feeding a custom payload) stay source-compatible, but the widget-gating test needed a MOCK_HOLDINGS fixture update because its explicit `holdingsSummary: []` would trigger the new 07-05 early return."
  - "The stale chart overlay is rendered INSIDE the renderWidget dispatcher (conditionally, gated on `allKeysStale && (widgetId === 'equity-curve' || widgetId === 'drawdown-chart')`), not around the DashboardGrid wrapper. Rationale: the chart tiles live inside react-grid-layout's absolute-positioned host — wrapping the grid with an overlay would either dim non-chart widgets too or require a two-phase render. Per-widget overlay keeps the semantics precise: only equity/drawdown get dimmed, everything else stays legible."
  - "formatHoursAgo is defined at module scope (not as a hook or imported helper). Pure function, no dependencies, used exactly once. Module scope is correct; zero ceremony; easy to move to src/lib/utils.ts if a second caller emerges."

patterns-established:
  - "Short-circuit replace-entire-surface pattern for zero-data states — return a new minimal JSX tree BEFORE the normal render path's expensive hooks/compute run. Applies to any dashboard where the zero-data branch has fundamentally different structure (not just hidden widgets)."
  - "Per-widget overlay in renderWidget — condition overlay inclusion at the dispatcher level, keyed on widgetId + a data-predicate (here allKeysStale). Future staleness-adjacent signals (venue-specific cap, backfill-in-progress) can use the same pattern."

requirements-completed: [PURGE-04]

# Metrics
duration: ~20min
completed: 2026-04-20
---

# Phase 07 Plan 05: Empty-state + Stale-data + Notices Summary

**Ships the user-visible empty-state loop and staleness protection for the /allocations Performance tab. Brand-new allocators see one centred CTA; allocators syncing their first positions see an inline reassurance banner; allocators whose keys have gone stale see a WarningBanner + chart dimmer + KPI `—` protective triple. Every "Connect Exchange" CTA routes to `/profile?tab=exchanges` per the Phase 06 IA.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both completed)
- **Files created:** 2 (EmptyState.tsx + EmptyState.test.tsx)
- **Files modified:** 2 (AllocationDashboard.tsx + AllocationDashboard.widget-gating.test.tsx)

## Render Matrix (AllocationDashboard branches)

| holdingsSummary.length | hasSyncing | allKeysStale | Render path |
|------------------------|------------|--------------|-------------|
| 0 | true  | any   | Normal render + InfoBanner at top + D-09 Notices card below grid. 07-04 f2 widget-gating hides the 18 strategy-composite widgets; KPI + EquityCurve + DrawdownChart + InsightStrip render `—` via 07-03 warm-up. |
| 0 | false | any   | **Early return**: `<main>` containing `<EmptyState hasSyncing={false} />` + D-09 Notices card. KPI strip + charts + holdings table + widget grid replaced entirely. |
| >0 | any  | true  | Normal render + WarningBanner above KPI strip + chart stale overlay (equity-curve + drawdown-chart get the 40% page-color dimmer via renderWidget). KPI numerics render `—` via the 07-03 path when allKeysStale=true. |
| >0 | any  | false | Normal render unchanged. 07-04 f2 widget-gating applies when strategies=[]. |

## EmptyState Component Branches

| `hasSyncing` | Rendered JSX | Copy |
|--------------|--------------|------|
| `true`  | `<InfoBanner>...</InfoBanner>` | "Syncing your first positions — this usually takes under a minute." (em-dash U+2014) |
| `false` | `<Card className="text-center py-12">` with Instrument Serif h2 + DM Sans p + Link wrapped in primary-button classes | Heading: "No positions to analyze yet." · Body: "Connect a read-only exchange API key to see your real holdings and performance." · CTA: "Connect Exchange →" → `/profile?tab=exchanges` |

**D-07 minimalism enforced:** the zero+idle branch rendered DOM contains exactly ONE `<a>` element. No `<img>`, `<svg>`, `<ol>`, `<ul>`. Test 3 pins this invariant.

## Stale Chart Overlay (D-10)

**Location:** inside `renderWidget` in `AllocationDashboard.tsx`, conditionally mounted as a sibling div INSIDE the widget-wrapper `<div data-widget-id={widgetId} className="relative h-full w-full">`.

**Gate:** `allKeysStale && (widgetId === "equity-curve" || widgetId === "drawdown-chart")`.

**Classes + structure:**
```tsx
{showStaleOverlay && (
  <div
    aria-hidden="true"
    className="absolute inset-0 bg-page/40 flex items-center justify-center pointer-events-none"
  >
    <span className="text-sm text-text-secondary font-medium">
      Data may be stale
    </span>
  </div>
)}
```

Design rationale:
- `bg-page/40` = Tailwind utility for 40% opacity of `--color-page` (#F8F9FA) per UI-SPEC.md §Stale-data chart overlay.
- `pointer-events-none` so the underlying chart tooltips still work while the overlay is visible — the overlay is a visual warning, not a block.
- `aria-hidden="true"` keeps it out of screen-reader announcements (the banner above already carries the stale message for assistive tech).
- No chart-widget internals modified — overlay is purely a wrapper-level addition.

## D-09 Notices Landing Point

A single `zeroHoldingsNoticesCard` JSX constant is declared once and mounted in two places:
1. Inside the zero+idle early-return (as the second child after `<EmptyState hasSyncing={false} />`).
2. Below `<DashboardGrid>` in the normal render, gated on `holdingsEmpty && hasSyncing`.

The card uses the existing `Card` primitive (no custom variant), an `<h3>` with `text-base font-semibold text-text-primary mb-2`, a body `<p>` with `text-sm text-text-secondary`, and a secondary link styled `text-sm text-accent underline-offset-4 hover:underline`. Copy verbatim from 07-UI-SPEC.md §Copywriting.

## TDD Red Gate Test Pass Counts

| File | `it(...)` blocks | State |
|------|------------------|-------|
| `EmptyState.test.tsx` | 4 | GREEN (4/4 pass) — zero+idle render + CTA href; first-sync InfoBanner copy; D-07 minimalism DOM assertion; route invariance across both branches |

Red→Green trace:
1. Authored `EmptyState.test.tsx` first importing `./EmptyState` — `vitest run` RED (module resolution failure).
2. Authored `EmptyState.tsx` (57 lines) — `vitest run` GREEN (4/4 pass).
3. Committed both together as `5576c25 feat(07-05): EmptyState component + TDD Red gate (PURGE-04)`.

## Full-Suite Vitest Pass Count

```
Test Files  144 passed | 3 skipped | 1 failed (148)
Tests       1425 passed | 65 skipped | 1 failed (1491)
```

Allocations cohort: **18 files / 163 tests / 0 failures** (up from 17 / 159 in 07-04 by +1 file / +4 tests from EmptyState.test.tsx).

The 1 failing test file is the pre-existing `src/__tests__/gdpr-export-coverage-hook.test.ts` (`allocator_equity_snapshots` missing from `USER_EXPORT_TABLES` — inherited from 07-01 migration 070; documented in `.planning/phases/07-demo-mode-purge/deferred-items.md`). Out of this plan's scope boundary.

## f2 Widget-Gating Intact (Verification)

```
$ grep -c "STRATEGY_COMPOSITE_WIDGETS" src/app/\(dashboard\)/allocations/AllocationDashboard.tsx
3
```

Set definition (line 165) + module-level comment (line 148) + visibleConfig useMemo filter (line 604). No logic change in this plan — the gating survives; this plan composes with it rather than replacing it.

Test coverage: `AllocationDashboard.widget-gating.test.tsx` all 4 tests remain GREEN after the MOCK_HOLDINGS fixture update.

## Build Smoke

```
$ npm run build 2>&1 | grep -iE "error|warning|allocations|suspense|useSearch"
├ ƒ /allocations
```

Zero errors, zero warnings. `/allocations` listed as dynamic. Exit 0.

## Decisions Made

### Short-circuit early-return for zero+idle

The naive approach (render everything, conditionally hide it) would still pay the cost of running `useDashboardConfig`, `computeScenario`, `buildDateMapCache`, and the IntersectionObserver wiring for allocators who never needed any of it. The early-return gives the zero+idle branch a minimal component tree — one `<main>`, one EmptyState, one Notices card — and skips all the dashboard grid hooks' side effects (session_start usage event, widget_viewed observer setup, MutationObserver wiring). Cleaner, faster, correct.

### Per-widget overlay (not grid-wrapper)

Rendering the overlay around `<DashboardGrid>` would dim non-chart widgets too (positions-table, outcomes-timeline, etc. that are still accurate at stale data). Rendering it around the whole `<main>` would dim the KPI strip and the WarningBanner itself. The precise mitigation — dim only the charts because they visually imply a continuous-data story that stale data violates — requires per-widget placement. `renderWidget` is the dispatcher through which every chart renders; it's the natural place.

### formatHoursAgo at module scope

Pure, synchronous, no dependencies. Could live in `src/lib/utils.ts` but it has exactly one caller and the arithmetic is two lines. Kept co-located; promotion to `utils.ts` is trivial if a second caller emerges later (e.g. in a Phase 08 freshness chip).

### Default prop values for Phase 5/9 compatibility

`holdingsSummary = []`, `hasSyncing = false`, `lastSyncAt = null` defaults keep Phase 5/9 call sites and the regression-001 test source-compatible (those tests read source statically and never instantiate the component). The widget-gating test (07-04) DID pass explicit payloads with `holdingsSummary: []`, which now triggers the zero+idle early-return — fixed by adding a MOCK_HOLDINGS fixture (Rule 3 deviation below). Per-file fix scoped to the one test that was actually affected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] widget-gating test fixture update**
- **Found during:** Task 2 (AllocationDashboard wiring).
- **Issue:** The 07-04 `AllocationDashboard.widget-gating.test.tsx` basePayload fed `holdingsSummary: []` + `hasSyncing: false` to exercise the widget grid. With the new 07-05 zero+idle early-return, that payload now triggers the EmptyState replacement path — breaking all 4 widget-gating tests (they expect `tile-equity-curve` etc. in the DOM).
- **Fix:** Added a `MOCK_HOLDINGS` fixture (one BTC spot row on Binance) and set `basePayload.holdingsSummary = MOCK_HOLDINGS`. The widget-gating code path is now actually exercised; the 07-05 branch is covered separately in `EmptyState.test.tsx`. No 07-05-specific test coverage lost; the 07-04 tests stay faithful to their f2 intent.
- **Files modified:** `src/app/(dashboard)/allocations/AllocationDashboard.widget-gating.test.tsx`
- **Committed in:** `d3cec41` (Task 2).

**Total deviations:** 1 (blocking, auto-fixed in its owning task commit).

## Threat Surface Handled

| Threat ID | Status | Code-level mitigation |
|-----------|--------|-----------------------|
| T-07-30 (Stale data shown as fresh) | mitigated | Protective triple: WarningBanner above strip (added here) + chart overlay via renderWidget (added here) + KPI numerics `—` (landed in 07-03). If any one of the three visually fails, the other two still communicate staleness. |
| T-07-31 (Empty-state reveals allocator has no holdings) | accept | Only the authenticated allocator sees their own `/allocations` — RLS-bound from 07-01. Surface only reveals info to its owner. |
| T-07-32 (hasSyncing client-side override) | accept | React state derived from server payload on each render (page.tsx is `export const dynamic = 'force-dynamic'`); client tampering affects only the user's own view. Server-side `allocator_holdings` count is the source of truth for admin/reporting surfaces. |

No new threat surface introduced. Routing CTA is an unauthenticated client-side navigation (`/profile?tab=exchanges`); the destination route's own auth gate handles identity enforcement.

## Issues Encountered

- **None at the implementation level** beyond the one Rule 3 deviation documented above. Typecheck clean (`npx tsc --noEmit`), build exits 0, full Vitest suite GREEN on everything this plan touches, no Phase 5/9 or Phase 07-01..07-04 regressions.

## User Setup Required

None. All changes are client-side Next.js components; no new env vars, no new migrations, no new worker config.

## Next Phase Readiness

- **Phase 08 (Connection Management and Notes):** Unblocked. The Connect-Exchange CTA already routes to `/profile?tab=exchanges`; Phase 08 can add notes / health UI at that route without refactoring the `/allocations` empty-state flow.
- **Phase 09 (Bridge Live):** Unchanged contract. When Bridge lands, `strategies.length > 0` allocators with non-empty holdings enter the data+fresh render path unchanged; the zero-holdings branch never fires for a Bridge-active allocator.
- **Phase 10 (Scenario Builder):** Unchanged. Scenario tab stub (from 07-04) is independent of the empty-state flow.
- **Phase 11 (Onboarding):** The D-13 empty-state arrival surface is now complete — a brand-new allocator completing OnboardingWizard lands on `/allocations`, sees the EmptyState + D-09 Notices card, and has a clear single-click path to their first API key connection.

### Deferred Items

- Pre-existing `gdpr-export-coverage-hook` failure (allocator_equity_snapshots missing from USER_EXPORT_TABLES) — inherited from 07-01 migration 070. Already in `.planning/phases/07-demo-mode-purge/deferred-items.md`; unchanged by this plan.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/EmptyState.tsx (57 lines, two-branch component)
- FOUND: src/app/(dashboard)/allocations/EmptyState.test.tsx (98 lines, 4 tests GREEN)
- FOUND: src/app/(dashboard)/allocations/AllocationDashboard.tsx (imports EmptyState, Card, WarningBanner, Link; holdingsEmpty check; zeroHoldingsNoticesCard; early-return; stale overlay in renderWidget; WarningBanner + InfoBanner mounts in normal render)
- FOUND: src/app/(dashboard)/allocations/AllocationDashboard.widget-gating.test.tsx (MOCK_HOLDINGS fixture, all 4 tests GREEN)
- FOUND grep: "No positions to analyze yet." in EmptyState.tsx (exactly once)
- FOUND grep: "Syncing your first positions" in EmptyState.tsx
- FOUND grep: "/profile?tab=exchanges" in EmptyState.tsx (exactly once) + AllocationDashboard.tsx (twice — stale banner Link + Notices card Link)
- FOUND grep: "What we noticed" in AllocationDashboard.tsx (D-09)
- FOUND grep: "Connect an exchange to surface insights about your positions." in AllocationDashboard.tsx
- FOUND grep: "Data may be stale" in AllocationDashboard.tsx (3 hits — WarningBanner copy, overlay label, comment mentions)
- FOUND grep: `STRATEGY_COMPOSITE_WIDGETS` count = 3 in AllocationDashboard.tsx (definition + comment + useMemo filter — f2 intact)
- FOUND: no `/connections` references anywhere in plan-touched files
- FOUND: no `"/exchanges"` references anywhere in plan-touched files (Phase 06 IA preserved)
- FOUND commit: 5576c25 (feat — Task 1 EmptyState + TDD Red gate)
- FOUND commit: d3cec41 (feat — Task 2 AllocationDashboard branch wiring)

---
*Phase: 07-demo-mode-purge*
*Completed: 2026-04-20*
