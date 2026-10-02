---
phase: 52-per-surface-application-allocator-journey
reviewed: 2026-06-29T00:00:00Z
depth: standard
files_reviewed: 47
files_reviewed_list:
  - src/app/(dashboard)/allocations/error.tsx
  - src/app/(dashboard)/allocations/loading.tsx
  - src/app/(dashboard)/allocations/page.tsx
  - src/app/(dashboard)/allocations/error.test.tsx
  - src/app/(dashboard)/allocations/loading.test.tsx
  - src/app/(dashboard)/compare/error.tsx
  - src/app/(dashboard)/compare/loading.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/compare/error.test.tsx
  - src/app/(dashboard)/compare/loading.test.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
  - src/app/(dashboard)/discovery/[slug]/page.tsx
  - src/app/strategy/[id]/error.tsx
  - src/app/strategy/[id]/loading.tsx
  - src/app/strategy/[id]/page.tsx
  - src/app/strategy/[id]/error.test.tsx
  - src/app/strategy/[id]/loading.test.tsx
  - src/components/layout/DashboardChrome.tsx
  - src/components/layout/DashboardChrome.test.tsx
  - src/components/strategy/CompareTable.tsx
  - src/components/strategy/CompareTable.test.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/app/(dashboard)/allocations/components/AlertBanner.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.test.tsx
  - src/app/(dashboard)/allocations/components/MonteCarloSection.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/SavedScenariosList.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/StressVarSection.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/error.tsx
  - src/app/factsheet/[id]/v2/not-found.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.tsx
  - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
  - src/app/factsheet/[id]/v2/ComparatorPicker.tsx
  - src/app/factsheet/[id]/v2/DistributionPanels.tsx
  - src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx
  - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
  - src/app/factsheet/[id]/v2/SignaturePanels.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/__tests__/phase-52-container-tabular-nums.test.tsx
  - src/__tests__/phase-52-frozen-spine-guards.test.ts
  - e2e/reflow-sweep-authed.spec.ts
  - eslint.config.mjs
findings:
  critical: 3
  warning: 4
  info: 1
  total: 8
status: issues_found
---

# Phase 52: Code Review Report

**Reviewed:** 2026-06-29T00:00:00Z
**Depth:** standard
**Files Reviewed:** 47
**Status:** issues_found

## Summary

Phase 52 applies the Frontend Excellence bar to 7 allocator surfaces: fluid-fill ultra-wide (`max-w-[1920px]` via DashboardChrome wide-variant), CSS `@container` migration, wrap-by-default truncation with `title=` on tables, new route-level `loading.tsx`/`error.tsx`, and raw-px to fluid-token migration.

The `@container` implementation is correct (bare `@container`, not `@container-size`; `tabular-nums` preserved on all numeric cells). The frozen-spine guard (BP-01) is well-constructed. The ASVS V7 digest-only invariant is maintained in the rendered HTML across all four `error.tsx` files — `console.error(error)` is developer-only exposure. The reflow e2e sweep correctly anchors on route-specific visible content nodes.

Three blockers were found: the allocations KPI strip has documented NaN leakage from un-guarded formatters, the `StrategySortableHeader` in HoldingsTable regresses the WCAG-AA `aria-sort` floor (in contrast to the correctly-implemented `SortableHeader` in the same file), and the `ResetConfirmationModal` in ScenarioComposer has no focus trap, violating WCAG 2.1.2.

---

## Critical Issues

### CR-01: NaN display in allocations KPI strip (`formatPercent` / `formatCurrency`)

**File:** `src/app/(dashboard)/allocations/components/KpiStrip.test.tsx:1` (documented as M-0085); root cause in the `formatPercent`/`formatCurrency` helpers in `src/lib/utils.ts`

**Issue:** `KpiStrip.test.tsx` explicitly documents (M-0085) that `formatPercent(NaN)` returns `"NaN%"` and `formatCurrency(NaN)` returns `"$NaN"`. The tests assert `queryByText(/NaN/) === null` as the desired honesty floor but acknowledge the formatters themselves are broken. When the server payload carries a NaN value (e.g., `ytd_twr: NaN` from a null-returning SQL computation), the KPI strip renders `"NaN%"` to the user. This is a user-visible data corruption bug that Phase 52 introduces no fix for despite the honesty floor being a stated invariant. The `FactsheetView.kpistrip.test.tsx` Phase 52 test (test 3) asserts `container.innerHTML` does NOT contain "NaN" — if the container-level test passes while the formatter-level test documents the leak, the container test must be relying on the server payload never sending NaN in test fixtures, which is a fixture-trust gap rather than a code-level guard.

**Fix:** Add NaN/Infinity guards to both formatters in `src/lib/utils.ts`:
```typescript
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // ... existing implementation
}
```

---

### CR-02: `StrategySortableHeader` missing `aria-sort` — WCAG 1.3.1 regression

**File:** `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:321-349`

**Issue:** The file contains two sort-header implementations. `SortableHeader` (lines 832-868, used in `DesignHoldingsTable`) correctly sets `aria-sort={sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}` on its `<th>`. `StrategySortableHeader` (lines 321-349, used in `StrategyRowsTable`) renders a `<th>` with a sort indicator icon but NO `aria-sort` attribute at all. Screen readers cannot announce sort direction for the strategy rows table. Phase 52's stated invariant is "WCAG-AA floor must not regress."

**Fix:** Add `aria-sort` to the `<th>` in `StrategySortableHeader`, matching the pattern already used by `SortableHeader` in the same file:
```typescript
<th
  scope="col"
  aria-sort={sort.key === col.key
    ? (sort.dir === "asc" ? "ascending" : "descending")
    : "none"}
  onClick={() => handleSort(col.key)}
  className={...}
>
```

---

### CR-03: `ResetConfirmationModal` has no focus trap — WCAG 2.1.2 violation

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3362-3422`

**Issue:** `ResetConfirmationModal` renders a `role="dialog" aria-modal="true"` overlay via a fixed-position div (lines 3367-3421). It has no focus trap: no `onKeyDown` for Tab/Shift-Tab containment, no `autoFocus` on the first interactive element (the Cancel button), and no focus-return-on-close. When the modal opens, keyboard focus stays at the triggering element behind the overlay. A keyboard user pressing Tab will cycle through all focusable elements on the underlying page, not just the two buttons inside the dialog. WCAG 2.1.2 (No Keyboard Trap) requires that focus be constrained within a modal dialog. Phase 52 targets WCAG-AA and the `BridgeDrawer`/`StrategyBrowseDrawer` components in the same file presumably implement focus traps — the `ResetConfirmationModal` is inconsistent with that pattern and with the stated a11y invariant. Note: `autoFocus` IS present on the "Keep my draft" button in the fingerprint mismatch banner (line 2333), showing the team knows the idiom — the modal is the gap.

**Fix:** Add a focus trap to `ResetConfirmationModal`. The minimal fix is:
1. `autoFocus` on the Cancel button (first interactive element, safer default for a destructive confirm pattern).
2. A `useEffect` that returns focus to the triggering element on unmount.
3. An `onKeyDown` that contains Tab/Shift-Tab within the two buttons.

Alternatively, refactor to use the existing drawer/dialog primitive (if `BridgeDrawer` already encapsulates a trap) rather than a bespoke fixed-div.

```typescript
// Minimal: in ResetConfirmationModal, add autoFocus to Cancel
<button
  type="button"
  autoFocus          // <-- add this
  onClick={onCancel}
  ...
>
  Cancel
</button>
```
A full focus trap also requires Tab key containment — see `FocusTrap` utilities or the WAI-ARIA dialog pattern.

---

## Warnings

### WR-01: Double `getPublicStrategyDetail` DB call per page load

**File:** `src/app/strategy/[id]/page.tsx:23` and `src/app/strategy/[id]/page.tsx:81`

**Issue:** Both `generateMetadata` (line 23) and the page component function (line 81) independently call `getPublicStrategyDetail(id)`. Supabase client calls are NOT deduplicated by Next.js Request Memoization — only native `fetch()` is memoized. This results in two Supabase round-trips per page render, doubling DB load for every strategy page visit.

**Fix:** Wrap the fetch in `React.cache()` so both callers within the same request share one result:
```typescript
import { cache } from "react";

const getStrategyDetail = cache((id: string) => getPublicStrategyDetail(id));

export async function generateMetadata({ params }) {
  const { id } = await params;
  const strategy = await getStrategyDetail(id);
  // ...
}

export default async function StrategyPage({ params }) {
  const { id } = await params;
  const strategy = await getStrategyDetail(id);
  // ...
}
```

---

### WR-02: Dead condition `res.status !== 204` in AlertBanner error handler

**File:** `src/app/(dashboard)/allocations/components/AlertBanner.tsx:82`

**Issue:** The condition `if (!res.ok && res.status !== 204)` is logically dead. `!res.ok` is true only for non-2xx HTTP responses. `204 No Content` is a 2xx status (`res.ok` would be `true`), so `res.status !== 204` can never be `false` in this branch. The condition misleads readers into thinking a 204 response is a possible error case, when it cannot reach this branch.

**Fix:** Simplify to:
```typescript
if (!res.ok) {
  setError(`Failed to dismiss: ${res.status}`);
}
```

---

### WR-03: Hardcoded `md:left-[260px]` layout coupling in discovery CTA bar

**File:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:146`

**Issue:** The fixed bottom CTA bar uses `md:left-[260px]` to offset for the sidebar width. This hardcodes the sidebar width (260px) as a raw pixel value in a page component, creating a layout coupling anti-pattern. Phase 52 explicitly migrates away from raw-px values. If the sidebar width ever changes, this offset must be manually updated everywhere it appears. `DashboardChrome.tsx` itself also uses `md:ml-[260px]` on the `<main>` element (line 159) — the same value is now duplicated across components.

**Fix:** Extract the sidebar width to a CSS custom property (e.g., `--sidebar-width: 260px`) defined once in the layout or global CSS, then reference it via `left-[var(--sidebar-width)]` in both places. Alternatively, use a shared Tailwind config value.

---

### WR-04: Bare `<div />` Suspense fallback provides no loading signal

**File:** `src/app/(dashboard)/allocations/page.tsx:64`

**Issue:** `<Suspense fallback={<div />}>` wraps an async subtree with an invisible, empty fallback. While `loading.tsx` provides a route-level skeleton, this internal Suspense boundary — which wraps a distinct async data-fetching component — silently shows nothing while resolving. If the wrapped async component takes time, users see a content flash from empty → populated with no intermediate skeleton. This is especially visible on slower connections.

**Fix:** Replace with a minimal skeleton that matches the wrapped component's shape, or at minimum a `role="status"` placeholder consistent with the `loading.tsx` pattern already established:
```tsx
<Suspense fallback={
  <div role="status" aria-label="Loading..." className="animate-pulse h-24 rounded-lg bg-surface-subtle" />
}>
```

---

## Info

### IN-01: `RequestIntroButton` rendered at two DOM positions

**File:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:123` and `:151`

**Issue:** `RequestIntroButton` is rendered twice — once inline (line 123, in the content flow) and once in the fixed bottom CTA bar (line 151). This is almost certainly intentional (desktop inline + mobile/sticky CTA) but creates two interactive elements with the same label and action. Screen reader users navigating by buttons will encounter two identical "Request introduction" buttons without context about their positional difference.

**Fix:** If both renders are intentional, distinguish them with `aria-label` (e.g., `aria-label="Request introduction (sticky CTA)"` on the fixed version) so screen readers can differentiate.

---

_Reviewed: 2026-06-29T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
