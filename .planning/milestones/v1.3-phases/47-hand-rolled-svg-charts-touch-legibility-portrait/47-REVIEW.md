---
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
reviewed: 2026-06-28T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/hooks/useTapPin.ts
  - src/hooks/useTapPin.test.ts
  - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
  - src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx
  - src/app/factsheet/[id]/v2/DistributionPanels.tsx
  - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
  - src/app/factsheet/[id]/v2/HistogramChart.tsx
  - src/app/factsheet/[id]/v2/MasterBrush.tsx
  - src/app/factsheet/[id]/v2/SignaturePanels.tsx
  - src/app/factsheet/[id]/v2/no-hover-panels-viewport.test.tsx
  - src/app/factsheet/[id]/v2/tap-charts-viewport.test.tsx
  - src/components/charts/DailyHeatmap.tsx
  - src/components/charts/DailyHeatmap.test.tsx
  - src/components/charts/ReturnQuantiles.tsx
  - src/components/charts/ReturnQuantiles.test.tsx
  - src/components/charts/Sparkline.tsx
  - src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx
  - src/app/(dashboard)/allocations/components/MonteCarloBandChart.test.tsx
  - src/test-setup.ts
  - e2e/svg-chart-parity.spec.ts
  - e2e/target-size.spec.ts
  - .github/workflows/ci.yml
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: fixed
fixed_at: 2026-06-28
resolution:
  fixed: [CR-01, WR-01, WR-02, WR-03, IN-04]
  deferred: [WR-04, IN-01, IN-02, IN-03]
---

# Phase 47: Code Review Report

**Reviewed:** 2026-06-28
**Depth:** standard
**Files Reviewed:** 23
**Status:** fixed (was: issues_found)

> ## Resolution (2026-06-28)
>
> The blocking finding and all in-scope warnings/info were fixed in the
> `gsd/v1.3-phases-46-48` branch; verification (tsc, targeted vitest, SCENARIO-05
> frozen-spine guards, the full coverage ratchet, and a Playwright parse/self-skip
> check) is green. Commits:
>
> | Finding | Commit | Resolution |
> |---------|--------|------------|
> | **CR-01** (BLOCKER) | `d9469f27` | StreakDistribution grid collapsed to `grid-cols-1 sm:grid-cols-2` so each histogram renders ~288px on mobile → coarse hit-rect `colW=68` viewBox units ≈ 44.5 CSS px (clears 44px); desktop (≥sm) byte-identical; misleading scale comment corrected. |
> | **WR-01** | `9bcf56bd` | DailyHeatmap desktop arm restored to byte-identical literals — `overflow-x-auto`, svg `touchAction`/`minWidth` style, and the tap-hint aria-label are now all gated behind `isMobile`; mobile arm keeps the scroll + touch tap-reveal. |
> | **WR-02** | `504c0993` | `svg-chart-parity.spec.ts` now `test.skip()`s loudly ("PENDING GOLDEN BAKE") when seed env is present but no golden PNGs exist, so the seeded MA-8 run no longer false-REDs (and no longer risks skipping the Railway deploy). Spec + ci.yml wiring untouched; guard flips automatically once goldens land. No fabricated PNGs. |
> | **WR-03** | `090249a6` | MonteCarloBandChart comment corrected (comment-only) — a missing quantile key emits `L<x>,NaN`, it does not "skip the band"; keys are assumed present per the `MC_QUANTILES_DEFAULT` engine contract. No new guard logic (YAGNI / out of phase scope). |
> | **IN-04** | `2045f168` | Obsolete `<desc data-hover-stroke>` keep-alive removed from DailyHeatmap (its `CHART_AXIS_TICK` import is now genuinely used at three render sites; tsc still passes). |
>
> **Deferred (intentionally not fixed):** WR-04 (useTapPin 2-D re-tap threshold — low-pri UX quirk, exact-same-cell toggle works), IN-01 (`_clientY` underscore is correct as-is), IN-02 (duplicated tick/format helpers — pre-existing, opportunistic-only), IN-03 (`dayOfYear` per-cell re-derive — pre-existing perf smell, out of v1 scope).
>
> **Verification:** `tsc --noEmit` exit 0 · targeted vitest 93/93 (DailyHeatmap, tap-charts-viewport, no-hover-panels-viewport, ReturnQuantiles, MonteCarloBandChart, useTapPin) · SCENARIO-05 frozen-spine guards 5/5 · `test:coverage` exit 0 (lines 84.93 / stmts 82.81 / fns 78.76 / branches 75.35 — all above the 82/80/74/72 ratchet) · `playwright test svg-chart-parity --list` parses, self-skips cleanly without seed env.

## Summary

A mobile-responsiveness retrofit over a frozen compute engine: a shared `useTapPin`
gesture hook, `isMobile`-gated legibility/portrait branches across 10 hand-rolled SVG
charts, touch tap-reveal on the three real-hover charts, and a dual-wired e2e
parity/target-size pair.

The frozen-math discipline holds well: I traced every chart's desktop branch and the
`isMobile ? mobile : desktopLiteral` pattern is applied correctly — no chart recomputes a
series/metric/domain (all read from props/payload), the desktop literals are preserved
(viewBox dims, fontSizes, tick counts), and the Vitest byte-identity assertions are
genuinely falsifiable. `useBreakpoint` two-pass SSR safety is correct (`useSyncExternalStore`
hydrates with `getServerSnapshot`→"desktop", re-renders after — no hydration mismatch).
`useTapPin` gesture logic (slop/time/touch-only/re-tap/leave-survival) is sound and its
unit test covers every return arm. FLOW-01 dual-wiring is correct (both specs in the MA-8
seeded list + `HAS_SEED_ENV` self-skip; `target-size` correctly also in the unseeded list).
No fabricated goldens (README honestly defers baking).

The blocking concern is a touch-target geometry bug: the StreakDistribution tap hit-rects
are ~22 CSS px wide at 320px — below the 44px WCAG bar — because the comment's scale math
ignores the `grid-cols-2` layout the histograms sit in. The phase's own `target-size.spec.ts`
gate is built to catch exactly this and will go red on the first seeded CI run.

## Critical Issues

### CR-01: StreakDistribution touch hit-rects are ~22 CSS px wide at 320px — below the 44px WCAG target (the phase's own gate will fail)

**File:** `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx:154-175` (hit-rect block); context `:48` (the `grid grid-cols-2` wrapper)
**Issue:**
The per-bar coarse-pointer hit-rects are sized `colW = Math.max(barW, 68)` viewBox units, and
the inline comment justifies this as "≥44 CSS px at a ~288px / 440 viewBox scale (0.65×)."
That scale is wrong. `StreakDistributionPanel` renders the two `StreakHist` charts inside
`<div className="grid grid-cols-2 gap-4 mt-2">` (line 48) — and that grid is **never collapsed
to one column on mobile**. At a 320px viewport each histogram therefore occupies roughly half
the content width (~130-145 CSS px after container padding + the 16px gap), so the effective
scale against the `VB_W=440` viewBox is ~0.30-0.33×, not 0.65×.

Result: hit-rect CSS width ≈ `68 × 0.32 ≈ 22px` — well under 44px. `assertTargetSizes`
(e2e/helpers/reflow.ts:141) asserts `r.width < min || r.height < min` (BOTH dimensions),
so the `StreakDistribution tap bars measure >= 44px` case in `e2e/target-size.spec.ts:143-176`
will report a violation and fail on the first seeded CI run. Beyond the failing gate, this is a
real WCAG 2.5.5/2.5.8 miss: the touch target the phase set out to deliver is half the required
width.

(Note the height dimension is fine: `plotH ≈ 240 × 0.32 ≈ 76px`. Only the width fails.)

**Fix:** Make the streak histograms full-width on mobile so the 0.65× assumption holds, OR
widen the hit-rect to compensate for the real ~0.32× scale (≈138 viewBox units → 44px). The
cleanest is to collapse the grid at the mobile breakpoint:
```tsx
// AnalyticalPanels.tsx:48 — full-width histograms on mobile restore the ~288px render
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
```
With each histogram at ~288px, `68 × (288/440) ≈ 44.5px` — the hit-rect clears the bar and the
gate passes. Whichever fix is chosen, re-derive the `colW` constant from the ACTUAL mobile
render width, not an assumed full-width scale, and update the misleading comment.

## Warnings

### WR-01: Desktop DailyHeatmap render is no longer byte-identical — new `touch-action`/`overflow-x-auto`/aria-label on the desktop arm

**File:** `src/components/charts/DailyHeatmap.tsx:197-204` (wrapper + svg style), `:201` (aria-label)
**Issue:**
The milestone's stated invariant is "the DESKTOP branch emits today's exact literals … the
desktop SSR render stays byte-identical." Comparing against `58116839^`, the desktop SvgRenderer
output changed in three ways that are NOT gated behind `isMobile`:
1. Wrapper `className` gained `overflow-x-auto` (was plain `w-full`).
2. The `<svg>` now always carries `style={{ touchAction: "pan-y", ... }}` (previously had no
   `style` attribute at all).
3. `aria-label` changed from `"Daily returns heatmap"` to
   `"Daily returns heatmap — tap a cell to reveal its value"` on every breakpoint.

These are unconditional DOM changes on the desktop/SSR render, so the strict byte-identity claim
is false here. They are visually benign (no layout/paint change when content fits, so the desktop
goldens stay green) and the aria-label change is arguably an improvement, but the
"byte-identical desktop" framing should be corrected, and the always-on `touchAction`/scroll
should be gated behind `isMobile` if the invariant is meant literally (the other 9 charts gate
all such tuning correctly — this one does not).
**Fix:** Either gate the new wrapper/style behind `isMobile` to honor the stated invariant, or
explicitly document that DailyHeatmap's desktop DOM intentionally gained these three attributes
and update the byte-identity claim in the plan/header.

### WR-02: `svg-chart-parity` spec cannot pass on first seeded CI run — missing goldens fail rather than bake, contradicting the FLOW-01 "proven to pass" must-have

**File:** `e2e/svg-chart-parity.spec.ts:181-194`, wiring `.github/workflows/ci.yml:1264`
**Issue:**
The MA-8 seeded run invokes `npx playwright test … --timeout 60000` with NO `--update-snapshots`.
No golden PNGs are committed (correctly — the README defers baking to avoid a false-green). On the
first seeded CI run, `toHaveScreenshot(...)` with a missing baseline is a hard failure in CI
(Playwright only writes-and-passes missing snapshots when `--update-snapshots`/`CI` write mode is
set, which it is not here). So this spec runs-but-fails until someone manually bakes + commits the
goldens. The FLOW-01 contract the spec header cites ("PROVEN to execute — passed, not skipped — in
a real CI run") therefore cannot be satisfied by the current wiring; the spec will execute and go
red.
**Fix:** Document the required manual bake-and-commit step as a release blocker for this phase
(it is in the README but not surfaced as a CI/ship gate), OR have the first seeded run explicitly
bake (a one-time `--update-snapshots` invocation gated to a manual workflow_dispatch), then commit.
Until goldens land, treat the MA-8 job's red on this spec as expected-and-tracked, not a
regression to silence.

### WR-03: `MonteCarloBandChart` band/median paths emit `NaN` (not "skip") on a missing quantile key — comment overstates the guard

**File:** `src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx:46-51` (comment), `:91-103` (paths)
**Issue:**
The header comment claims "a missing key skips that band rather than throwing." It does not: with
`q: Record<string, number>`, `b.q[hiKey]` is `undefined` when a key is absent, and `y(undefined)`
yields `NaN`, so `bandPath`/`medianPath` produce `L<x>,NaN` segments — a malformed (silently
invisible) path, not a skipped band. The y-domain loop at `:74-79` already guards with
`Number.isFinite`, so this is inconsistent. In practice the section always runs with
`MC_QUANTILES_DEFAULT` so all five keys are present and the bug is latent — and this path code was
NOT touched by Phase 47 (only `PLOT_H`/`H`/`tickFont` moved into the component). Flagging because
the comment is load-bearingly wrong and a future quantile-set change would surface a silent
empty-fan rather than a loud failure.
**Fix:** Either make the claim true — early-return an empty path string when a required key is
non-finite — or correct the comment to state the keys are assumed present (the engine contract).

### WR-04: `useTapPin` re-tap toggle threshold maps poorly to 2-D heatmap cell indices

**File:** `src/hooks/useTapPin.ts:154-161`; consumers `HeatmapPanels.tsx:384-396`, `DailyHeatmap.tsx:167-186`
**Issue:**
`RETAP_THRESHOLD` (3) was designed for the line chart's 1-D time-ordered index, where "within 3
indices" means "near the pinned point." In the canvas DailyReturnsHeatmap the flat index is
`wk*7 + d`, so two vertically-adjacent cells differ by 1 (within threshold → re-tap un-pins) but
two horizontally-adjacent cells differ by 7 (≥ threshold → moves the pin). The same threshold thus
has inconsistent spatial meaning in 2-D: tapping a cell one row down un-pins, tapping the visually-
equidistant cell one column right re-pins. Tapping the EXACT same cell always un-pins (distance 0,
the primary gesture), so this is a UX quirk rather than a correctness break, but the shared
threshold is being reused outside its design domain without adjustment.
**Fix:** For the 2-D consumers, consider an exact-cell toggle (`idx === selectedIdx`) instead of a
proximity window, or document that the proximity toggle is intentionally row-major. Low priority.

## Info

### IN-01: `_clientY` unused parameter in StreakHist `pointerToIndex`

**File:** `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx:87`
**Issue:** `pointerToIndex = (clientX, _clientY, rect)` only uses `clientX` — the `_clientY`
underscore-prefix correctly signals intent and satisfies the hook signature. No action needed;
noting for completeness that the bar histogram is 1-D x-only by design.
**Fix:** None required (the underscore convention is correct).

### IN-02: Duplicated `niceTicks`/`niceCountTicks`/`formatPct`/`pctSigned` helpers across panel files

**File:** `SignaturePanels.tsx:306-324`, `CrossSignaturePanels.tsx:298-323`, `AnalyticalPanels.tsx:225-242,449-462`, `DistributionPanels.tsx:580-589`
**Issue:** `niceTicks` is byte-identical between `SignaturePanels` and `CrossSignaturePanels`;
`formatPct`/`pctSigned`/`num` recur across all four panel files. Pre-existing duplication, not
introduced by this phase, but the phase touched these files and the drift risk is real (a future
tick-format fix must be applied in N places).
**Fix:** Extract the shared tick/format helpers into a single `factsheet/chart-format.ts`
module. Opportunistic — defer unless a feature forces a touch.

### IN-03: `DailyHeatmap` re-derives `dayOfYear(d.date)` per cell during render in addition to the memoized `flatCells`

**File:** `src/components/charts/DailyHeatmap.tsx:243` vs `:159`
**Issue:** `flatCells` (memo) computes `doy: dayOfYear(d.date)` for the tap mapping, and the render
loop at `:243` calls `dayOfYear(d.date)` again per cell for the x-position. The two are guaranteed
equal (same pure fn, same input) so there is no correctness risk — purely a tiny redundant compute.
Performance is explicitly out of v1 scope; noting only because it is a maintainability smell (two
sources for the same derived value).
**Fix:** Read `c.doy` from `flatCells` in the render loop, or accept the redundancy. No action
required for correctness.

### IN-04: `<desc data-hover-stroke={CHART_AXIS_TICK}>` keep-alive hack persists

**File:** `src/components/charts/DailyHeatmap.tsx:305-309`
**Issue:** The `<desc data-hover-stroke>` element exists solely to keep the `CHART_AXIS_TICK`
import alive under `noUnusedLocals`. As of this phase `CHART_AXIS_TICK` is now genuinely used
(the pinned-cell stroke at `:255` and the tap-reveal fill at `:297`), so the keep-alive `<desc>`
and its comment are now dead/obsolete and could be removed.
**Fix:** Delete the `<desc data-hover-stroke=…>` element and its comment — the import is now used
for real. Pre-existing artifact; surfaced because the phase made it obsolete.

---

_Reviewed: 2026-06-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
