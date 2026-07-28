---
phase: 40-mount-the-real-factsheet-body
plan: 02
subsystem: factsheet-v2 / scenario-parity
tags: [BODY-01, BODY-03, BODY-04, factsheet-mount, parity-by-construction, static-guard]
requires:
  - "scenarioMode?: boolean on FactsheetBodyOptions (Plan 40-01)"
  - FactsheetBody (exported mountable subtree, FactsheetView.tsx)
  - buildScenarioFactsheetPayload (Phase-39 complete csv adapter)
provides:
  - "The Scenario tab renders the REAL FactsheetBody (full panel set) on the blend"
  - "BODY-03 degenerate render matrix (safe-empty / sub-N / healthy / non-finite, no throw, no NaN/Infinity)"
  - "BODY-04 render-absence pin (allocator / signatures / peer absent on the csv blend)"
affects:
  - "Phase 41 (constituent-correlation panel mounts into this same body)"
  - "Phase 42 (MetricsColumn scenarioPeer carve-out via the threaded seam)"
  - "Phase 43 (permanent byte-identity + axe + toggle GATE)"
tech-stack:
  added: []
  patterns:
    - "mount the real component fed a synthesized payload — parity-by-construction"
    - "topSlot for a provider-descendant control (PeriodControl resolves useXRange)"
    - "render-absence assertion (getElementById null) for by-construction gating"
    - "selector re-point by SVG accessible name (aria-label^=Cumulative Returns:)"
key-files:
  created:
    - src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx
  modified:
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
    - src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx
decisions:
  - "Mount lives EXCLUSIVELY in ScenarioFactsheetChart.tsx; ScenarioComposer.tsx stays FactsheetBody-free (static-guard landmine)"
  - "SCENARIO_*_CONFIG exports kept (locked decision #9) — newly unmounted, not deleted"
  - "No panel guard added — RESEARCH audited all ~24 panels; none needed (Rule 2/3)"
  - "BODY-04 peer-absence asserts on the panel header 'Peer Percentile', not the footer's 'Demo cohort' boilerplate"
metrics:
  duration: ~25m
  completed: 2026-06-26
  tasks: 3
  files: 4
---

# Phase 40 Plan 02: Mount the real factsheet body Summary

Replaced the Phase-38 two-chart subset inside `ScenarioFactsheetChart.tsx`
(MasterBrush + `SCENARIO_EQUITY_CONFIG` + `SCENARIO_DRAWDOWN_CONFIG`) with the
REAL `<FactsheetBody scenarioMode hideHeader hideAllocatorSection
hideFooter={false} topSlot={<PeriodControl/>}>`, inside the SAME existing
`<FactsheetProvider persist={false}>`. The Scenario tab now renders every
factsheet panel on the synthesized blend — parity-by-construction (BODY-01). Two
NET-NEW + two updated tests prove the body survives every degenerate blend with
no NaN/Infinity (BODY-03), the api-only panels stay absent on the csv blend
(BODY-04), and the shared-window proof + blank-slate honesty intent are preserved
through the mount swap. The static-guard landmine (`ScenarioComposer.tsx` must
contain `FactsheetBody` zero times) stays green.

## What Was Built

### Task 1 — Mount the real FactsheetBody (commit `d1e2af18`)
- `ScenarioFactsheetChart.tsx`: imported `FactsheetBody` from
  `@/app/factsheet/[id]/v2/FactsheetView`; replaced the PeriodControl-wrapper +
  MasterBrush + the two `<TimeSeriesChart config={SCENARIO_*}>` blocks with a
  single `<FactsheetBody payload={synthPayload} scenarioMode hideHeader
  hideAllocatorSection hideFooter={false} topSlot={…}>` inside the SAME
  `persist={false}` provider (no second provider added — GUARD-04 class).
- `PeriodControl` moved into `topSlot` (renders inside the `<article>` under the
  provider, so `useXRange()` resolves). The `data-testid="equity-chart-scenario-overlay"`
  hook relocated onto the topSlot wrapper. The `aria-selected={false}` per-tab
  a11y attribute is kept.
- Dropped the now-unused `TimeSeriesChart` / `MasterBrush` / `SCENARIO_*_CONFIG`
  imports from this file (eslint clean). The `SCENARIO_*_CONFIG` exports in
  `scenario-factsheet-payload.ts` are KEPT (locked decision #9 — newly unmounted,
  not deleted; their Phase-39 tests stay green).
- `ScenarioComposer.tsx` untouched — `FactsheetBody` literal count stays 0.

### Task 2 — BODY-03/04 degenerate render test (commit `e481716c`)
- New `FactsheetBody.degenerate.test.tsx` mounts the real `FactsheetBody` under a
  real `FactsheetProvider persist={false}` with the composer-mount props across
  four blends built by `buildScenarioFactsheetPayload`: safe-empty
  (`portfolioDaily=[]`), single/sub-N (~30 pts, 10 ≤ n < 252), healthy (~300 pts),
  and non-finite (a 120-pt series with one `NaN` — the adapter's degenerate gate
  collapses it to safe-empty BEFORE `compute()`).
- Per blend: asserts the render does NOT throw, and `container.innerHTML` contains
  neither `"NaN"` nor `"Infinity"` (the StreakHist `barW=Infinity` tripwire +
  format-drift guard).
- BODY-04 render-absence (healthy + safe-empty): `getElementById("factsheet-allocator")`
  null, `getElementById("factsheet-signatures")` null, no "Peer Percentile" panel,
  and `payload.ingestSource === "csv"` as the by-construction pin.
- Mandatory localStorage + sentry stub block copied verbatim from
  `scenario-shared-window.test.tsx`.
- 10/10 green. No panel file touched (RESEARCH audited all ~24 panels; none needs
  a guard).

### Task 3 — Update the two affected existing tests (commit `6825f7f3`)
- `scenario-shared-window.test.tsx`: relaxed the Phase-38 exactly-two-SVGs
  assertions (`.toBe(2)`) to `>= 1` (the full body renders many chart SVGs);
  re-pointed the keyboard-nav window-drive to the body's FIRST equity chart svg
  (the overlay testid now wraps PeriodControl). The shared-window proof (brush
  label narrows/widens) is intact; the 3M/ALL SegmentedControl test stays green
  (PeriodControl is still a `role="tablist"` named "Period" in topSlot).
- `EquityChart.scenario.test.tsx` PARITY-03: re-pointed the equity-panel selector
  from `[data-testid=equity-chart-scenario-overlay] svg…` to the body's cumulative
  chart svg by accessible name (`svg[aria-label^="Cumulative Returns:"]`). Kept the
  honesty intent: ≥1 drawn `<path d>`, exactly ONE strategy line (no fabricated
  baseline, T-38-05-01), no "Equity data warming up" copy. The legacy
  `EquityChart` describes (lines 66/280/395) and the legacy-guard describe (592)
  are untouched — the diff is scoped strictly inside the PARITY-03 composer-path
  describe (499-557).

## Verification

- Static-guard landmine: `grep -v '^\s*//' ScenarioComposer.tsx | grep -c FactsheetBody`
  returns **0**.
- `FactsheetBody.degenerate.test.tsx` — 10/10 green (4 no-throw + 4 no-NaN/Infinity
  + 2 BODY-04 render-absence).
- `scenario-shared-window.test.tsx` (3) + `EquityChart.scenario.test.tsx` (20) —
  all 23 green with the re-pointed selectors.
- Touched-dir regression (`widgets/performance/` + `factsheet/[id]/v2/`) — 19
  files / 190 tests green (includes the ScenarioComposer static-guard family, the
  BODY-02 byte-identity call-site tests, and the legacy EquityChart/DrawdownChart
  paths — byte-identity preserved).
- `npx tsc --noEmit` — clean (full project, exit 0).
- `npx eslint` on all four touched files — 0 errors.
- `npm run test:coverage` — full suite **548 files / 6665 tests passed** (19/284
  skipped), exit 0. Ratchet cleared all four thresholds: statements 81.57 (≥80),
  branches 74.37 (≥72), functions 77.28 (≥74), lines 83.74 (≥82). The new
  `scenarioMode={true}` render + the Plan-40-01 `scenarioMode={false}` render
  exercise both ControlBar branches, so no ratchet regression (RESEARCH Pitfall 6).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BODY-04 peer-absence assertion matched footer boilerplate, not the panel**
- **Found during:** Task 2
- **Issue:** The first draft of the BODY-04 render-absence test asserted
  `container.textContent` did not match `/Demo cohort/i` as a peer-panel proxy.
  This turned RED because the (now-shown) `FactsheetFooter` disclaimer contains the
  static prose "Demo cohorts and demo portfolios are flagged inline" — a phrase
  unrelated to the api-gated `PeerPercentilePanel`, which `hideFooter={false}`
  surfaces.
- **Fix:** Dropped the over-broad `/Demo cohort/i` match; kept the precise
  `/Peer Percentile/i` panel-header assertion (the distinguishing signal that
  appears only in the api-gated panel and never on a csv blend — verified against
  the serialized csv DOM). The assertion remains meaningful (would fail if the
  panel ever rendered on csv) per Rule 9.
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx`
- **Commit:** `e481716c`

## Known Stubs

None new. The `MetricsColumn` `scenarioMode` seam threaded in Plan 40-01 stays
intentionally inert (the documented Phase-42 PEER-01 consumer); this plan only
consumes the prop at the mount (`scenarioMode={true}`), it does not add a new stub.

## Threat Flags

None. This plan adds no fetch / input / auth / DB / secret / persistence-write
surface — a pure client-render reuse change. The threat register's mitigations are
all satisfied: T-40-03 (no new `<main>`/region/tablist landmark — the body root is
`<article id="factsheet-main">`; PeriodControl tablist is a distinct-named sibling),
T-40-04 (single existing `persist={false}` provider — no second provider, no new
storageKey, asserted by the unchanged FactsheetProvider JSX count), T-40-05 (the
static-guard landmine grep returns 0).

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx (modified)
- FOUND: src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx (created)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx (modified)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx (modified)
- FOUND commit: d1e2af18 (Task 1 — feat: mount)
- FOUND commit: e481716c (Task 2 — test: BODY-03/04)
- FOUND commit: 6825f7f3 (Task 3 — test: updated mount-shape)
- Static-guard re-check: `grep -v '^\s*//' ScenarioComposer.tsx | grep -c FactsheetBody` = 0

---

## Follow-up: code-review fix WR-01 / IN-01 / IN-02 (commit 38e36ae2, 2026-06-26)

Applied the Phase-40 code-review (`40-REVIEW.md`) findings. TEST-ONLY change — no
production component touched; the heatmaps' existing empty guards already hold, so
no real guard was needed.

**WR-01 (warning) — degenerate test silently skipped the dynamic heatmaps.**
`FactsheetBody.degenerate.test.tsx` read `container.innerHTML` synchronously, so the
two `next/dynamic({ssr:false})` panels (`MonthlyReturnsHeatmap` /
`DailyReturnsHeatmap`) only mounted their `PanelSkeleton` — the REAL heatmap
components (which DO render on the csv blend, unlike the api-gated
Signatures/Allocator) were never exercised by any test, while the docstring claimed
"all ~24 panels" coverage.

Fix: each BODY-03 case is now `async`. A `beforeAll` pre-imports `./HeatmapPanels`
for a deterministic dynamic-loader settle (the empty blend resolves the components
to `null`, leaving no DOM marker to wait on — `vi.mock`-spy attempts were rejected
as the MEMORY-flagged `importOriginal` cross-suite flake). The test then `await
waitFor`s until `#factsheet-heatmaps` holds **zero** `.animate-pulse` skeletons —
proving both dynamic imports resolved and the real component functions RAN. On
populated blends it additionally asserts the real `Monthly Returns` /
`Daily Returns Calendar` headings, then re-asserts no `NaN`/`Infinity` over the
now-resolved heatmap DOM.

**Heatmaps render empty SAFELY: YES.** Verified empirically (throwaway probe) across
all four blends:
- safe-empty (`[]`) + non-finite (NaN→collapsed): `monthlyReturns=[]` /
  `dailyHeatmap=[]` → both components hit their `length===0` early-return and render
  null. No throw, no `NaN`/`Infinity`.
- sub-N (~30 pts) + healthy (~300 pts): the real headings render; the
  `DailyReturnsHeatmap` canvas path runs (jsdom logs a benign "getContext not
  implemented" — the component's `if (!ctx) return;` guard handles it). No throw,
  no `NaN`/`Infinity`.

No production guard was missing — the existing `HeatmapPanels.tsx:40` /
`HeatmapPanels.tsx:160` `length===0` guards are sufficient; this fix proves the path
rather than adds code.

**IN-01 (info) — double-render folded.** The per-blend no-throw and no-NaN cases are
now a single `it()` that renders ONCE (one mounted tree, two asserted properties).
BODY-03 case count: 8 → 4; file total 10 → 6 tests.

**IN-02 (info) — brittle line-number reference fixed.** `ScenarioFactsheetChart.tsx`
doc comment replaced the hard-coded `ScenarioComposer.test.tsx:3377` pointer with
the stable static-guard test name (`… static guard, T-30-05`).

Gates: `npx vitest run FactsheetBody.degenerate.test.tsx` green (6/6);
`npm run test:coverage` green (548 files / 6661 tests passed, 0 failed; thresholds
met — lines 84.32 / statements 82.18 / functions 77.78 / branches 74.63);
`npx tsc --noEmit` clean; eslint clean. Committed source/test only (`38e36ae2`),
no `.planning/`.
