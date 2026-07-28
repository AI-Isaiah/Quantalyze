---
phase: 40-mount-the-real-factsheet-body
reviewed: 2026-06-26T08:49:10Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 40: Code Review Report

**Reviewed:** 2026-06-26T08:49:10Z
**Depth:** deep
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 40 mounts the real `FactsheetBody` on the Scenario composer tab, replacing
the Phase-38 two-chart subset. The change is well-scoped and the byte-identity
contract holds: the additive `scenarioMode?: boolean` prop defaults to `false`,
and every production call site (`page.tsx` → `FactsheetView`, the Discovery
detail page, and the Overview `AllocationDashboardV2`) passes **no**
`scenarioMode`, so they are provably byte-identical. The only call site passing
`scenarioMode` (true) is `ScenarioFactsheetChart.tsx`. All 36 affected tests pass.

I verified each of the seven concerns in the brief. Six are **clean**
(byte-identity, single-provider mount, static-guard absence, a11y landmarks,
test-update integrity, conventions). The one real defect is a **false-confidence
gap in the BODY-03 degenerate test**: it claims to be "the only render-level
coverage of the real body subtree" and to exercise "all ~24 panels," but the two
`MonthlyReturnsHeatmap` / `DailyReturnsHeatmap` panels — which DO render on the
csv blend — are behind `next/dynamic({ ssr:false })` and the test reads
`innerHTML` synchronously without `await`/`waitFor`, so only their `PanelSkeleton`
renders. The real heatmap components are never mounted by the degenerate matrix.
This does not crash production (the heatmaps have empty guards), but the test's
safety claim is overstated, and the heatmap empty-render path is unproven by any
test in the suite. Classified WARNING, not BLOCKER, because (a) the panels carry
their own `length === 0` guards and (b) the api-gated LazyMount panels are
double-excluded on csv so no genuinely-unsafe panel is hidden.

### Concern-by-concern verdict

1. **Byte-identity (BODY-02):** CLEAN. Default `false`; only `ControlBar`'s
   `{!scenarioMode && …}` branches are gated, behaviorally identical at false.
   BODY-02 test proves `default === scenarioMode={false}` innerHTML. All
   production call sites pass no `scenarioMode`. `void scenarioMode;` in
   MetricsColumn is a pure no-op with no side effect / no hook-dep change.
2. **The mount (BODY-01):** CLEAN. ONE `FactsheetProvider` (persist={false});
   `PeriodControl` lives in `topSlot` (a provider descendant inside the
   `<article>`), so `useXRange` resolves. `hideHeader`/`hideAllocatorSection`
   true, `hideFooter` false, `scenarioMode` true. No double-provider, no missing
   key, no stale memo. The shared-window (Q4) and period-control (Q3) behaviors
   survive — proven by the passing scenario-shared-window test.
3. **Static-guard landmine:** CLEAN. `ScenarioComposer.tsx` is NOT in the diff
   and contains `FactsheetBody` zero times. The static source guard
   (`ScenarioComposer.test.tsx:3377`) is genuine and non-vacuous (reads real
   source off disk, positive control on `buildBlendPanels`, asserts no
   `FactsheetBody|MetricsColumn|buildAllocatorPortfolioFactsheetPayload` and no
   `ingestSource: "api"` literal).
4. **Degenerate rendering (BODY-03):** WARNING — see WR-01. Real body (not a
   mock), no-throw + no-NaN/Infinity asserted. Heatmap panels silently skipped.
5. **a11y:** CLEAN. The body root is `<article id="factsheet-main">`, NOT a
   `<main>` — no duplicate main landmark (DashboardChrome owns the one
   `<main aria-label="Dashboard content">`). The body `<footer>` is nested inside
   `<article>`, so per ARIA-in-HTML it does NOT map to a page `contentinfo`
   landmark (and DashboardChrome renders no footer anyway; `LegalFooter` is
   only on for-quants/security/browse/legal). No nested tablists: the topSlot
   `PeriodControl` tablist and the per-chart `TimeSeriesChart` "Y-axis scale"
   tablists are DOM siblings, never ancestor/descendant. The `composer-axe.spec.ts`
   e2e scans `/allocations?tab=scenario` in composed mode and covers this mount.
6. **Test-update integrity (Rule 9):** CLEAN. The `===2 → >=1` relaxation in
   scenario-shared-window is legitimate (the full body genuinely renders many
   chart SVGs, so the exact-2 count is obsolete); the load-bearing shared-window
   proof is unchanged (drives `setXRange` from a chart's keyboard nav, asserts
   the brush label moved + the SegmentedControl narrows/resets). EquityChart.scenario
   re-selects the equity panel by accessible name (`aria-label^="Cumulative
   Returns:"`) and preserves the honesty assertion (exactly one drawn `<path>` =
   scenario, no fabricated baseline). BODY-04 asserts the right signal (peer panel
   header `/Peer Percentile/i`, with an explicit comment NOT to match the footer
   "Demo cohorts" prose).
7. **Conventions:** CLEAN. Surgical, additive, no dead code (deprecated props
   were already deprecated pre-Phase-40), comments explain intent.

## Warnings

### WR-01: BODY-03 degenerate test silently skips the heatmap panels (next/dynamic + no await) — overstated coverage claim

**File:** `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx:98-131`
(and the docstring at lines 9-41)

**Issue:**
The degenerate test's docstring asserts it is "the only render-level coverage of
the real body subtree" and that "every panel either early-returns on its empty
array or formats non-finite to '—' — no panel needs a new guard; RESEARCH audited
all ~24 panels." But two of the panels that **do** render on the csv blend —
`MonthlyReturnsHeatmap` and `DailyReturnsHeatmap` — are wrapped in
`next/dynamic(..., { ssr:false, loading: () => <PanelSkeleton/> })`
(`FactsheetView.tsx:36-43`). `next/dynamic` is **not** mocked in `vitest.config.ts`
or `src/test-setup.ts`, so it uses the real async-import implementation. The test
calls `render()` and reads `container.innerHTML` **synchronously** — there is no
`await`, `waitFor`, or `findBy` anywhere in the file. Therefore the heatmap
dynamic components render only their `PanelSkeleton` (aria-hidden pulse div) on
first paint; the real heatmap components (`<h3>Monthly Returns</h3>` /
`<h3>Daily Returns Calendar</h3>` + their SVG/canvas grids) **never mount** during
the assertion.

Empirically confirmed:
- `IntersectionObserverStub` (`src/test-setup.ts:44-57`) is installed, so `IntersectionObserver`
  is *defined* but its `observe()` is a no-op that never fires `isIntersecting`.
  This means the LazyMount-gated panels (`SignaturesSection`,
  `CrossSignaturesSection`, `AllocatorSection`) never mount either — but those are
  all api-gated (`ingestSource === "api"`, `FactsheetView.tsx:249, 283`), so on the
  csv blend they are double-excluded and the gap is harmless there.
- The heatmaps are NOT api-gated and NOT behind LazyMount — they render on csv,
  but only as skeletons in this test.
- No other test in the suite renders the real heatmap panels: the `AllocationDashboardV2`
  tests MOCK `FactsheetBody`; `scenario-mode`/`shared-window`/`EquityChart.scenario`
  don't assert heatmap content; there is no `HeatmapPanels` direct test.

Net effect: the heatmap empty-data render path is the one part of the body that
is genuinely **unproven** by any test, while the docstring implies it is covered.
The panels do carry empty guards (`HeatmapPanels.tsx:40 if (rows.length === 0)
return null`, `:160 if (years.length === 0) return null`), so this is very likely
safe in production — but the test gives false confidence, which is exactly the
LazyMount/dynamic landmine the review brief flagged (here it is `next/dynamic`
rather than LazyMount).

This is also a Rule-9 issue: the test's stated intent ("all ~24 panels mount
without throwing on degenerate data") is not what it actually verifies for the two
dynamic panels.

**Fix:** Make the degenerate matrix actually await the dynamic panels, so the real
heatmap components mount and their empty-render path is exercised. Convert the
no-throw cases to async and flush the dynamic imports before asserting:

```ts
import { render, waitFor } from "@testing-library/react";

it(`mounts the real body without throwing on the ${blend.name} blend`, async () => {
  const { container } = renderBlend(blend.portfolioDaily);
  // Flush next/dynamic(ssr:false) imports so the REAL MonthlyReturnsHeatmap /
  // DailyReturnsHeatmap mount (not just PanelSkeleton). Without this the two
  // dynamic panels are never exercised on the csv blend.
  await waitFor(() => {
    expect(container.textContent ?? "").toContain("Monthly Returns");
    expect(container.textContent ?? "").toContain("Daily Returns Calendar");
  });
  const html = container.innerHTML;
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("Infinity");
});
```

If awaiting the dynamic import proves impractical in jsdom, the alternative is to
narrow the docstring's claim (drop "all ~24 panels" / "the only render-level
coverage") and add a small direct test that renders `MonthlyReturnsHeatmap` /
`DailyReturnsHeatmap` against the empty payload — so the heatmap empty path has
*some* explicit, awaited coverage rather than a silently-skipped skeleton.

## Info

### IN-01: BODY-03 no-throw assertion double-renders each blend (minor test cost / mismatch)

**File:** `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx:114-132`

**Issue:** The `not.toThrow()` case calls `renderBlend()` inside the matcher
(line 119), and the separate NaN/Infinity case calls `renderBlend()` again
(line 123). Each blend is rendered twice across the two `it()`s. This is harmless
but means the no-throw and no-NaN assertions run against two independent renders
of the same input rather than one shared render. Combined with WR-01, a future
reader may assume both assertions cover the same mounted tree (they don't — and
neither covers the dynamic heatmaps). Low priority; only worth noting because the
test is the sole safety net for the body subtree.

**Fix:** Optionally fold both assertions into one `it()` per blend that renders
once, asserts no-throw via the render itself, then asserts the innerHTML is clean
— reducing render count and making "one mounted tree, two properties" explicit.

### IN-02: ScenarioFactsheetChart comment references a brittle absolute test line number

**File:** `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx:48-49`

**Issue:** The doc comment hard-codes "static source guard at
ScenarioComposer.test.tsx:3377". I verified the guard does live at line 3377
today, but a hard-coded line number drifts the moment the test file is edited
above that point, leaving a misleading pointer. The guard is better identified by
its `it(...)` title ("no factsheet import on the blend path … static guard,
T-30-05").

**Fix:** Reference the test by name/ID rather than line number:

```
 * ScenarioComposer.test.tsx mocks); `ScenarioComposer.tsx` must contain the
 * literal `FactsheetBody` ZERO times (static source guard: the
 * "no factsheet import on the blend path … (static guard, T-30-05)" test).
```

---

_Reviewed: 2026-06-26T08:49:10Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
