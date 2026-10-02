---
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
verified: 2026-06-28T00:31:14Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Bake svg-chart-parity.spec.ts goldens in seeded CI environment"
    expected: "npx playwright test e2e/svg-chart-parity.spec.ts --update-snapshots runs against a seeded project (TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY set), produces PNG snapshots at e2e/__snapshots__/svg-chart-parity.spec.ts/, and subsequent CI runs pass the pixel-diff gate (maxDiffPixelRatio 0.02 desktop / 0.04 portrait)"
    why_human: "Seed environment variables are absent locally. The spec self-skips when seed env is absent (WR-02 guard at line ~30). Golden bake requires seeded CI access."
  - test: "Real-device touch sign-off on all three tap-reveal charts"
    expected: "On an iOS or Android phone at 320px width: tapping a data point on StreakDistributionPanel / BootstrapCIPanel (AnalyticalPanels), the DailyReturnsHeatmap row cells (HeatmapPanels), and a DailyHeatmap column band reveals the pinned value label; a re-tap on the same point unpins; a swipe-drag does NOT pin."
    why_human: "Pointer-coarse CSS and pointer event logic is verified by unit tests (useTapPin 15/15 pass, tap-charts-viewport 24/24 pass) but real-device ergonomics — finger fat-finger accuracy, scroll vs tap disambiguation on iOS Safari, visual pin label clarity — require a physical device."
---

# Phase 47: Hand-Rolled SVG Charts — Touch + Legibility + Portrait Verification Report

**Phase Goal:** Bring the genuinely hand-rolled SVG charts to touch + legibility + portrait parity with the reference TimeSeriesChart — while the frozen math stays byte-identical. Three jobs: (1) tap-pins-crosshair recipe propagated to the SVG charts via ResponsiveChartFrame (parity-only: only where desktop hover exists); (2) fix the 320px viewBox-downscale legibility trap; (3) portrait-tune the densest panels.
**Verified:** 2026-06-28T00:31:14Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `useTapPin` hook exists, exports correct constants and API, and is consumed by exactly the 3 real-hover charts (StreakDistributionPanel, HeatmapPanels, DailyHeatmap) — NOT added to no-hover charts | VERIFIED | `src/hooks/useTapPin.ts` 181 lines; exports `useTapPin`, `TAP_SLOP_SQ=64`, `TAP_MAX_MS=350`, `RETAP_THRESHOLD=3`; 15/15 unit tests pass; 3 hover charts confirmed via grep; 5 no-hover charts confirmed clean via grep |
| 2 | All in-scope SVG panels gained isMobile-gated font/tick/dimension tuning via `useBreakpoint` + `ResponsiveChartFrame` wrapping; StreakDistribution hit-rects are ≥44px at 320px (CR-01 fix); correlation matrix keeps ALL cells at 320px | VERIFIED | All 5 no-hover panels confirmed: `useBreakpoint` 2–5 occurrences each, `ResponsiveChartFrame` 3–9 occurrences each; 31/31 no-hover-panels-viewport tests pass (both mobile + desktop branches); grid-cols-1 sm:grid-cols-2 fix confirmed at `AnalyticalPanels.tsx:51`; CorrelationsMatrix same-cell-count test passes |
| 3 | Desktop branch emits today's exact literals (byte-identical); `TimeSeriesChart.tsx` untouched in Phase 47; SCENARIO-05 frozen-spine guard passes; coverage ratchet holds (lines ≥82, stmts ≥80, fns ≥74, branches ≥72) | VERIFIED | `git log` confirms `TimeSeriesChart.tsx` last touched in Phase 44; SCENARIO-05 5/5 pass; coverage exit 0: lines 84.93 / stmts 82.81 / fns 78.76 / branches 75.35 (all above thresholds); `DailyHeatmap.tsx` desktop byte-identity confirmed via isMobile gate at lines 202–206; `MonteCarloBandChart.test.tsx` desktop `fontSize=12` byte-identity snapshot test at line 74 |

**Score:** 3/3 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/hooks/useTapPin.ts` | Tap-gesture hook, min 40 lines, exports 3 constants + function | VERIFIED | 181 lines; `"use client"` directive; exports `useTapPin`, `TAP_SLOP_SQ`, `TAP_MAX_MS`, `RETAP_THRESHOLD`; `setPointerCapture` used; 0 occurrences of wheel/pan/zoom |
| `src/hooks/useTapPin.test.ts` | 15-test suite, jsdom pragma, renderHook | VERIFIED | 262 lines; `/** @vitest-environment jsdom */`; imports `renderHook` from `@testing-library/react`; exactly 15 `it()` blocks; 15/15 pass |
| `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` | useTapPin consumed; ≥44px hit-rects; useBreakpoint + RCF | VERIFIED | `useTapPin` present; `pointer-coarse:block` hidden hit-rects; 68 viewBox units → ~44.5 CSS px at 320px; `useBreakpoint` + `ResponsiveChartFrame` present |
| `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` | useTapPin consumed; ≥44px hit targets | VERIFIED | `useTapPin` present; `col style={{ width: 44 }}`; `pointer-coarse:min-h-[44px]` |
| `src/components/charts/DailyHeatmap.tsx` | useTapPin consumed; isMobile-gated wrapper/style/aria-label; ≥44px band rects | VERIFIED | `useTapPin` present; isMobile gate confirmed at lines 202–206 (WR-01 fix); `bandH = Math.max(SVG_CELL_H, 44)` at line 287; `hidden pointer-coarse:block` at line 292 |
| `src/app/factsheet/[id]/v2/DistributionPanels.tsx` | useBreakpoint + ResponsiveChartFrame; no useTapPin | VERIFIED | `useBreakpoint=5`, `ResponsiveChartFrame=9`; no useTapPin |
| `src/app/factsheet/[id]/v2/SignaturePanels.tsx` | useBreakpoint + ResponsiveChartFrame; no useTapPin | VERIFIED | `useBreakpoint=2`, `ResponsiveChartFrame=3`; no useTapPin |
| `src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx` | useBreakpoint + ResponsiveChartFrame; no useTapPin | VERIFIED | `useBreakpoint=2`, `ResponsiveChartFrame=3`; no useTapPin |
| `src/app/factsheet/[id]/v2/HistogramChart.tsx` | useBreakpoint + ResponsiveChartFrame; NO useTapPin | VERIFIED | `useBreakpoint=2`, `ResponsiveChartFrame=3`; no useTapPin |
| `src/app/factsheet/[id]/v2/MasterBrush.tsx` | useBreakpoint + ResponsiveChartFrame; NO useTapPin | VERIFIED | `useBreakpoint=2`, `ResponsiveChartFrame=4`; no useTapPin |
| `src/app/factsheet/[id]/v2/no-hover-panels-viewport.test.tsx` | Both isMobile branches; both viewBox and cell-count assertions | VERIFIED | 54 references to mobile/desktop/isMobile; 31 `it()` blocks; 31/31 pass |
| `src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx` | Both isMobile branches; tap simulation; desktop byte-identity | VERIFIED | 29 references to mobile/desktop/isMobile; 24 `it()` blocks; 24/24 pass |
| `src/components/charts/ReturnQuantiles.tsx` | ResponsiveChartFrame wrapping; no useTapPin | VERIFIED | 4 occurrences `ResponsiveChartFrame`; no useTapPin |
| `src/components/charts/ReturnQuantiles.test.tsx` | Both mobile/desktop viewBox branches | VERIFIED | File exists |
| `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx` | useBreakpoint; role="img" preserved; NO tabIndex on element | VERIFIED | `useBreakpoint=2`; `role="img"=3`; tabIndex count=2 but both are in comment text at lines 20 and 65, not JSX attributes |
| `src/app/(dashboard)/allocations/components/MonteCarloBandChart.test.tsx` | Desktop fontSize=12 byte-identity snapshot | VERIFIED | Line 74: "Phase 47 DESKTOP: role=img + NO tabIndex, paths render, viewBox 0 0 600 240 + tick fontSize=12 (byte-identity)"; 5/5 pass |
| `src/components/charts/Sparkline.tsx` | NO-OP comment; no RCF/useBreakpoint added | VERIFIED | Comment at line: "Phase 47: legibility/portrait N/A — 120×32 decorative inline sparkline, no text/axis/labels and no hover (RESEARCH Open Question 2, resolved NO-OP)" |
| `e2e/svg-chart-parity.spec.ts` | HAS_SEED_ENV; seedStrategyWithHistory; maxDiffPixelRatio; self-skip on missing goldens | VERIFIED | File exists; 14 occurrences of HAS_SEED_ENV/seedStrategyWithHistory/maxDiffPixelRatio/PENDING GOLDEN BAKE |
| `e2e/__snapshots__/svg-chart-parity.spec.ts/README.md` | Bake instructions; no PNG files yet | VERIFIED | File exists; no PNG snapshots committed (deliberate deferral) |
| `e2e/target-size.spec.ts` | Extended with seeded chart tap-rect case; pointer-coarse emulation | VERIFIED | 30 occurrences of pointer-coarse/chart tap/44/min-touch |
| `.github/workflows/ci.yml` | svg-chart-parity.spec.ts in MA-8 seeded list (FLOW-01 dual-wiring) | VERIFIED | `e2e/svg-chart-parity.spec.ts \` confirmed at line in MA-8 seeded Playwright list |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `AnalyticalPanels.tsx` | `useTapPin` | import + destructure in StreakDistributionPanel and BootstrapCIPanel | WIRED | grep confirmed; tap-charts-viewport test exercises the wiring |
| `HeatmapPanels.tsx` | `useTapPin` | import + destructure in DailyReturnsHeatmapPanel | WIRED | grep confirmed; tap-charts-viewport test exercises the wiring |
| `DailyHeatmap.tsx` | `useTapPin` | import + destructure; `svgRef`, `onPointerDown/Move/Up/Leave` spread onto SVG | WIRED | grep confirmed; isMobile gate for wrapper/style confirmed (WR-01 fix) |
| `svg-chart-parity.spec.ts` | MA-8 seeded CI list | `.github/workflows/ci.yml` line reference | WIRED | Confirmed in ci.yml FLOW-01 dual-wiring |
| `strategy-v2-chart-parity.spec.ts` | MA-8 seeded CI list | Intentionally retained; self-skips via `test.skip(true)` | WIRED (intentional) | ci.yml comment at line 1270: "intentionally LEFT in place (it self-skips via test.skip(true); Phase-48 concern) — do NOT remove it." This is NOT a resurrection; the spec already existed and is self-skipping. Plan 05 requirement was "dead strategy-v2-chart-parity.spec.ts NOT resurrected" — it was already in ci.yml pre-Phase-47 and the Phase 47 executor correctly left it in place without modifying it. |

---

### Data-Flow Trace (Level 4)

No dynamic server-side data flows introduced. All phase-47 changes are presentation-layer (SVG rendering, gesture handling, viewport tuning). The frozen math (scenario.ts / compute.ts) is unmodified — verified by SCENARIO-05 5/5 pass. Desktop arm byte-identity pattern ensures existing data flow is unchanged at non-mobile breakpoints.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SCENARIO-05 frozen-spine guard (CHART-03) | `npx vitest run src/__tests__/phase-31-frozen-spine-guards.test.ts` | 5/5 tests pass, exit 0 | PASS |
| useTapPin unit tests (CHART-01a) | `npx vitest run src/hooks/useTapPin.test.ts` | 15/15 tests pass, exit 0 | PASS |
| Phase 47 viewport tests (CHART-02/03) | `npx vitest run no-hover-panels-viewport.test.tsx tap-charts-viewport.test.tsx ReturnQuantiles.test.tsx MonteCarloBandChart.test.tsx` | 54/54 tests pass, exit 0 | PASS |
| Coverage ratchet (blocking CI gate) | `npm run test:coverage` | lines 84.93% / stmts 82.81% / fns 78.76% / branches 75.35% — all above thresholds (82/80/74/72), exit 0 | PASS |

---

### Probe Execution

No probe scripts declared for Phase 47. Step 7c: SKIPPED (no probe-*.sh discovered).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CHART-01a | 47-01-PLAN, 47-03-PLAN, 47-05-PLAN | Every hand-rolled SVG chart is touch-inspectable — tap reveals and pins the value that hover gives on desktop, via useTapPin propagated to the 3 hover charts | SATISFIED | `useTapPin` exists (181 lines, 15/15 unit tests); wired in AnalyticalPanels, HeatmapPanels, DailyHeatmap; NOT added to no-hover charts; e2e spec + target-size extension dual-wired in CI |
| CHART-02 | 47-02-PLAN, 47-03-PLAN, 47-04-PLAN | Chart text is legible at 320px — viewBox-downscale trap fixed via tick-density reduction, font bumps, portrait tuning | SATISFIED | All 5 no-hover panels: useBreakpoint + ResponsiveChartFrame confirmed; 31 viewport tests pass (mobile branch asserts reduced ticks / taller viewBox); CR-01 grid-cols-1 sm:grid-cols-2 fix at AnalyticalPanels.tsx:51; MonteCarloBandChart.test.tsx passes |
| CHART-03 | 47-02-PLAN, 47-03-PLAN, 47-04-PLAN | Charts render portrait-tuned with frozen math byte-identical — SCENARIO-05 zero-diff and byte-identity guard stay green | SATISFIED | SCENARIO-05 5/5 pass; TimeSeriesChart.tsx untouched (Phase 44 last-modified); DailyHeatmap isMobile gate (WR-01 fix) ensures desktop branch is byte-identical; MonteCarloBandChart desktop fontSize=12 literal test confirms no recompute |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/charts/DailyHeatmap.tsx` | 448 | `"placeholder"` in JSDoc comment | Info | Documents the empty-data render path (`data.length === 0 → renders an empty placeholder div`). Not a stub — it is describing existing behavior for the empty-data guard. The component renders real SVG for non-empty data. No impact. |
| `e2e/target-size.spec.ts` | 33 | `"placeholder-env build"` in comment | Info | Describes the unseeded environment the spec targets. This is documentation of the test's scope, not a code stub. |

No TBD, FIXME, or XXX markers found in any Phase 47 modified file.

---

### Human Verification Required

#### 1. Golden Bake for svg-chart-parity.spec.ts

**Test:** In a CI environment with `TEST_SUPABASE_URL` and `TEST_SUPABASE_SERVICE_ROLE_KEY` set and a seeded project containing strategy history, run:
```
npx playwright test e2e/svg-chart-parity.spec.ts --update-snapshots
```
Then commit the produced PNG files under `e2e/__snapshots__/svg-chart-parity.spec.ts/`.

**Expected:** The spec creates PNG goldens for (a) desktop factsheet panels and (b) 320px portrait views. Subsequent CI runs pass with `maxDiffPixelRatio: 0.02` (desktop) and `0.04` (portrait). The self-skip guard ("PENDING GOLDEN BAKE") is removed once PNGs are committed.

**Why human:** Requires the seeded CI environment. The spec correctly self-skips when `HAS_SEED_ENV` is false or when golden PNGs are absent (WR-02 guard). This is a deliberate deferral acknowledged in the Phase 47 CONTEXT.md and REVIEW.md.

#### 2. Real-Device Touch Sign-Off

**Test:** On a physical iOS or Android device at 320px viewport width, navigate to `/factsheet/[seeded-id]/v2`. Test each tap-reveal chart:
- **StreakDistributionPanel / BootstrapCIPanel** (AnalyticalPanels): Tap a histogram bar; confirm the value label appears pinned; re-tap to unpin; confirm a swipe-drag does NOT pin.
- **DailyReturnsHeatmap row cells** (HeatmapPanels): Tap a heatmap cell; confirm the row's date and return value appears; tap another cell to move the pin.
- **DailyHeatmap column bands** (DailyHeatmap): Tap a column band; confirm the day's returns are revealed; tap elsewhere to clear.

**Expected:** All 3 tap-reveal charts work ergonomically on touch. The ≥44px hit-rect targets (verified by unit tests + target-size.spec.ts) translate to comfortable tap zones on real hardware. No charts accidentally show the desktop hover path on touch (pointer-coarse gate isolates touch targets).

**Why human:** Pointer-event and pointer-coarse CSS logic is unit-tested and CI-gated, but physical ergonomics — fat-finger accuracy, scroll-vs-tap discrimination on iOS Safari momentum scrolling, visual label readability at actual device DPR — cannot be verified programmatically.

---

### Gaps Summary

No gaps. All 3 must-have truths are VERIFIED. Human verification items (golden bake + real-device touch sign-off) are the only outstanding items, both deliberate deferrals acknowledged in the phase design contracts (47-CONTEXT.md, 47-REVIEW.md).

The `strategy-v2-chart-parity.spec.ts` presence in ci.yml is intentional and documented (Phase-48 concern; self-skips). It was pre-existing and Phase 47 correctly left it in place, consistent with the plan's "NOT resurrected" wording (it was already there, never removed and re-added).

---

_Verified: 2026-06-28T00:31:14Z_
_Verifier: Claude (gsd-verifier)_
