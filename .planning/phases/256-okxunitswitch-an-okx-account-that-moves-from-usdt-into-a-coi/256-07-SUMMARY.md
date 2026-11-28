---
phase: 256-okxunitswitch
plan: 07
subsystem: ui
tags: [factsheet, unit-switch, chart, svg, leverage]
requires:
  - phase: 256-okxunitswitch
    provides: "256-05: payload.unitSwitch and payload.unitSegments, unit-segments.ts parsers and copy templates (unitSwitchFigcaption, unitSwitchBaseOnlyFigcaption, unitSwitchLeverageReason)"
provides:
  - "chart-configs.ts: ChartConfig.unitSwitch (set on cumulative only), ResolvedSeries.unit / hoverFrom, resolveUnitSwitchChart"
  - "TimeSeriesChart.tsx: two native segments as two separate paths, the switch marker (test id unit-switch-marker), USD/BTC codes, figcaption (unit-switch-note), sr-only sentence, native hover readout"
  - "FactsheetView.tsx: UnitSwitchLeverageHold and the held-at-1x control treatment with the reason line"
affects: [256-08, 256-09, 256-10]
tech-stack:
  added: []
  patterns: ["each native segment is its own ResolvedSeries, so the break is structural (two path elements) rather than a drawn gap", "hold at the context (shadow LeverageContext) so every consumer reads 1 with no per-consumer wiring"]
key-files:
  created:
    - src/app/factsheet/[id]/v2/TimeSeriesChart.unit-switch.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.unit-switch-leverage.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/chart-configs.ts
    - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
key-decisions:
  - "The break is two series, not a seam: resolveUnitSwitchChart returns the USD segment and the coin segment as separate ResolvedSeries (both the one accent stroke), so the SVG has two path elements and no segment can join x(S) at the USD level to x(S) at 1.00. The comparator is cut at x(S) in the same function."
  - "Basis (UI-SPEC unresolved row, resolved here as the planner's assumption): the ccxt derive writes no metrics_json_by_basis, so a switched OKX strategy has the cash basis only. The chart draws native segments unless a mark-to-market or smoothed bundle is the one drawn (the same three-state rule the start-of-marks note uses); a selected basis whose bundle is absent falls back to cash and draws them."
  - "The native hover reading prints in the tooltip header, '{date} · {growth}× in {unit}', not as a row; the coin base vertex is drawn but not hoverable (ResolvedSeries.hoverFrom), so x(S) reads the USD point and carries one dot."
  - "A day absent from the headline axis gets no x of its own, but its native return is compounded into the next plotted point (UI-SPEC A.0)."
  - "Leverage is held at the context (UnitSwitchLeverageHold, LeverageContext shadowed at 1) and the input takes the D-16 disabled treatment; the reason line sits under it for a switched strategy and the USD-view reason is unchanged."
requirements-completed: [SC-3, SC-7]
status: complete
duration: 100min
completed: 2026-11-27
commits: 3
plan_head_before: 40e1d609ffd8649c39e0e56beb4c3f451a4b4c25
plan_head_after: cd0c009aabbe7393ae0e5c71df027973ecc75d2c
actuals:
  tokens: 13000
  tasks: 3
  commits: 3
---

# Phase 256 Plan 07: PRESENT-CHART Summary

**A switched strategy's Cumulative Returns chart is one chart with two native segments (each compounded in its own unit from 1.00, drawn as two separate paths), a marker and USD/BTC codes at the switch day, a printing figcaption, and the comparator stopped at the last USD day; leverage is held at 1x for it, so the converted BTC leg is never levered.**

## What was built

- `chart-configs.ts`: opt-in `unitSwitch` flag (set on `cumulative` only, the `segmentMarkers` idiom); `ResolvedSeries.unit` and `hoverFrom`; `resolveUnitSwitchChart(cfg, payload, comparator, xRange)`. It compounds each stored segment within its own unit onto the shared headline `dates` (a day the headline lacks is still compounded into the next plotted point), rebases a zoom window only on the side it starts in, puts the coin base vertex at 1.00 on the x of the last USD day, and cuts every comparator series after that day. It returns `null` (today's single series) when the config, either payload field or the strategy line is absent, or when nothing of either segment is in the window.
- `TimeSeriesChart.tsx`: uses that result as `series` unless a non-cash bundle is the one drawn. Two paths with the accent stroke; marker `<g pointerEvents="none" data-testid="unit-switch-marker">` behind the series (one solid secondary line, `<title>` = the switch sentence); `USD` end-anchored at x(S) - 4 and `BTC` start-anchored at x(S) + 4 on row `PAD.top + 37` in the marks-start label idiom (the coin code flips to end-anchored x(S) - 4 on row `PAD.top + 50` when `placeMarksStartLabel` says it would cross the right edge); a single code at `padLeft + 4` when the window is wholly on one side; `unit-switch-note` figcaption (`text-caption text-text-secondary`, from the plan 05 templates, with the comparator clause only when a comparator is drawn); an sr-only sentence before the plot; the headline gap seams that start after the last USD day are not drawn while the native segments are; the tooltip header reads `{date} · {growth}× in {unit}`.
- `FactsheetView.tsx`: `UnitSwitchLeverageHold` beside `UsdViewLeverageHold`, wrapping the body when `payload.unitSwitch` is set; the leverage input is `aria-disabled`, `readOnly`, shows 1, `opacity-60 cursor-not-allowed`, keeps its tab stop, has no `Reset 1×`, and the reason line (`factsheet-unit-switch-leverage-reason`) renders `unitSwitchLeverageReason`.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2/TimeSeriesChart.unit-switch.test.tsx" ...markers... ...marks-start...` (Task 1 verify): `Test Files  3 passed (3)`, `Tests  59 passed (59)`.
- `npx vitest run "src/app/factsheet/[id]/v2/"` (after the three code commits, before the formatter fix): `Test Files  137 passed (137)`, `Tests  2007 passed (2007)`. After the fix commit the touched files were re-run: `src/__tests__/display-sign-single-source.test.ts`, `charts.signed-zero`, `markers`, `marks-start` and the new file, `Test Files  5 passed (5)`, `Tests  111 passed (111)`; the leverage file, `Tests  5 passed (5)`.
- Pinning-test sweep: 16 files under `src/__tests__` and `src/lib` that name `TimeSeriesChart`, `chart-configs`, `FactsheetView.tsx` or the leverage hold: 15 passed; the 16th (`display-sign-single-source` R6) found a sixth `toFixed` in `TimeSeriesChart.tsx` against a pin of five. Fixed by routing the growth reading through `formatFixedSigned` (deviation 1), not by moving the pin; re-run green.
- `npm run typecheck` redirected to a file, run after the last commit: `EXIT=0`, 0 `error TS` lines.
- `npx eslint` on the five touched files: clean after the probe fix (deviation 2).
- Acceptance greps: `unit-switch-marker` in `TimeSeriesChart.tsx` 1; `unitSwitch` in `chart-configs.ts` at least 2; `UnitSwitchLeverageHold` in `FactsheetView.tsx` 3.
- Tracer gate: `type="tracer"` verify re-run end to end and green before any expansion work (the states were then already in the same pass; see deviation 3).

## PROOF-01 (each gate seen RED by assertion, restored by cp, cmp silent, GREEN)

Byte backup with `cp` to the scratchpad, neuter by an exact-string replace, run with `--testTimeout 120000`, restore with `cp`, `cmp` silent, rerun. `git status --short` printed nothing after the last restore. No git checkout, restore or stash.

Gate A, the two segments joined into one series in `TimeSeriesChart.tsx` (one path):

```
     × draws the USD and the coin segment as two separate accent paths that meet only in x 86ms
     × a window starting inside the USD segment rebases only the USD part; the coin part keeps its own base 20ms
     × a coin day reads '{date} · {growth}× in BTC' and a USD day '… in USD', each compounded in its own unit 33ms
     × draws the native coin path and compounds the unpriced day's native return into the next plotted point 18ms
AssertionError: expected 1 to be 2 // Object.is equality
AssertionError: expected 'Feb 25, 2026 · 1.07× in USD' to be 'Feb 25, 2026 · 1.07× in BTC' // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 18 passed (22)
cmp(chart): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

Gate B, the `UnitSwitchLeverageHold` wrapper removed in `FactsheetView.tsx` (re-run after the probe fix, so the RED is of the final test):

```
     × a consumer that sets leverage 3 still reads 1, and every KPI, chart and caption equals the 1x render byte for byte 403ms
AssertionError: the context a consumer reads is held at 1: expected 3 to be 1 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
cmp(view): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Gate C, the comparator allowed to run past x(S) (`chart-configs.ts`):

```
     × the comparator path ends at x(S) and the figcaption names the stop 23ms
AssertionError: expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
cmp(configs): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

Extra gates (not required by the plan; each arm was green on first run, so each was neutered to prove it can fail):

- D, an unpriced coin day's return dropped instead of compounded (`chart-configs.ts`):
  ```
       × draws the native coin path and compounds the unpriced day's native return into the next plotted point 32ms
  AssertionError: expected 'Feb 24, 2026 · 1.05× in BTC' to contain '1.10× in BTC'
   Test Files  1 failed (1)
        Tests  1 failed | 21 passed (22)
  cmp(configs): silent
  ```
- E, the coin-segment seam filter removed (`TimeSeriesChart.tsx`):
  ```
       × a headline gap run inside the coin segment draws no 'no data' seam; one inside the USD segment draws as today 23ms
  AssertionError: expected 'Arrow keys pan the timeline. Plus and…' not to contain 'no data'
   Test Files  1 failed (1)
        Tests  1 failed | 21 passed (22)
  cmp(chart): silent
  ```
- F, the overflow flip removed (`TimeSeriesChart.tsx`):
  ```
       × flips to end-anchored at x(S) - 4 on the PAD.top + 50 row when it would cross the right edge, and clips nothing 23ms
  AssertionError: expected 'start' to be 'end' // Object.is equality
   Test Files  1 failed (1)
        Tests  1 failed | 21 passed (22)
  cmp(chart): silent
  ```
  Restored copies were re-run green (22 passed) after D, E and F.

## Test map (UI-SPEC UI Considerations)

| Consideration | Test (TimeSeriesChart.unit-switch.test.tsx unless noted) |
|---|---|
| populated: two paths, no join, marker, labels | "draws the USD and the coin segment as two separate accent paths...", "draws one solid secondary marker line...", "labels USD left and BTC right..." |
| populated: figcaption, sr-only | "prints the figcaption ... and an sr-only sentence before the plot" |
| populated: label binding to the derived days | "a second fixture (another coin, other days) draws its own labels" (plus the plan 05 sentence fixtures) |
| partial: coin base only | "draws the USD path alone, no marker and no code..." |
| partial: window on one side | three arms (coin only, USD only, USD side with the coin base kept) |
| error: malformed or absent fields | "unitSwitch alone, unitSegments alone and neither render the same markup..." and "a coin segment of non-array returns draws the single series" |
| partial: coin day without a close | "draws the native coin path and compounds...", "a headline gap run inside the coin segment draws no seam..." |
| interaction: leverage | `FactsheetView.unit-switch-leverage.test.tsx`, five arms |
| interaction: basis | "draws the native segments on the cash basis, and today's single series when a non-cash bundle is the one drawn" |
| overflow | "flips to end-anchored at x(S) - 4 on the PAD.top + 50 row..." |
| hover on both segments, base vertex reads USD | the two "interaction: the hover reads each segment..." arms |
| comparator stop | "the comparator path ends at x(S) and the figcaption names the stop" |
| other curves unbroken | "Cumulative vs Benchmark is byte-identical to an unswitched payload" |
| visual backstop | not automated: routed to UAT (below) |

## Deviations from Plan

**1. [Rule 3 - blocking] One test pinned outside the plan's file list.** `src/__tests__/display-sign-single-source.test.ts` (R6) counts `toFixed` per file and found a sixth in `TimeSeriesChart.tsx` (pin: five). Fixed in the source (the growth multiple prints through `formatFixedSigned(v, { dp: 2, suffix: "×" })`, the one display formatter), so the pin and the test file are unchanged. Commit `cd0c009aa`.

**2. [Rule 1 - lint] The leverage test's probe reassigned a module variable during render** (`react-hooks/globals`). It records the value in an effect now. Gate B was re-run against the final test. Same commit.

**3. [Process] The tracer and the Task 2 states were committed together** (`1e35d0521`). The states reuse the one resolver and the one render path, and splitting the code would have meant committing a chart that the Task 2 tests would not hold. The tracer gate (re-run of the verify command) was green before Task 3 began. Task 3 is its own commit (`fdac0b4ee`).

**4. [Plan wording] Gate A neuters `TimeSeriesChart.tsx` as the plan says, but the two-path structure is made in `chart-configs.ts` (`resolveUnitSwitchChart`).** The neuter joins the two series in the chart's `series` memo, which is where the plan's "join the two paths into one" bites; gate C neuters `chart-configs.ts`.

**5. [UI-SPEC reading] Legend names and the hover readout.** The two native series carry the strategy name plus `in USD` / `in BTC` (the existing `unitTag`), so the legend does not show two identical buttons and the CSV export columns name their unit. The tooltip prints the native reading in its header (`{date} · {growth}× in {unit}`) rather than as rows, to match the UI-SPEC's single readout string; the comparator remains a row. This is copy the UI-SPEC does not list verbatim for the legend; flagged for the UI review.

**6. [Commit trailers] No Co-Authored-By or Claude-Session trailer on any commit**, per the founder's no-AI-attribution rule (the dispatch's project rules).

**7. [Environment] `node_modules` is a symlink to the main checkout's** (read-only use, allowed by the executor rules); it is untracked and not staged.

## Rule 7 flags (for cleanup, not done here)

- **DESIGN.md calls `TimeSeriesChart` a frozen island, and that is stale** (UI-SPEC Component Inventory: not in `FROZEN_ISLANDS` at HEAD, `src/__tests__/phase-52-frozen-spine-guards.test.ts`, which passes with this edit). The sentences: `DESIGN.md` lines 139 to 143 ("the frozen `EquityChart` and the three chart-internal factsheet SVGs ... because any byte edit reds the frozen-spine guard") and the 2026-06-30 table row at line 504 ("The four frozen chart islands ... `TimeSeriesChart`/`HistogramChart`/`MasterBrush`"). One more copy of the claim: the doc comment of `applyChartUnit` in `chart-configs.ts` ("`TimeSeriesChart` is a frozen island"); left as is (surgical change).
- **Date format conflict** (UI-SPEC named open conflict, plan 05): the figcaption, the marker `<title>` and the sr-only sentence print `Nov 14, 2026` via `formatCloseDay`, not the founder's yearless `14 Nov`. Not changed here.

## Known Stubs

None. The templates plan 05 shipped without a caller (`unitSwitchFigcaption`, `unitSwitchBaseOnlyFigcaption`, `unitSwitchLeverageReason`) now have one. The chip, list and OG templates stay for plan 08.

## Deferred Issues

- Export CSV for the cumulative chart now has two strategy columns, `{name} in USD` and `{name} in BTC`. On the day S the BTC column carries the coin base 1.00 (the drawn base vertex). It is labelled by unit, never summed or compared, but it is a figure on a USD day; not changed (`hoverFrom` governs hover only).
- When a zoom window shows only the coin segment, the comparator is cut and draws nothing, while the figcaption still says it "is shown to" the last USD day (true, and the clause is the only place the stop is named). No change made.
- The USD code, end-anchored at x(S) - 4, can reach into the left axis gutter when x(S) sits within about 30 units of the plot's left edge (a window that starts a day or two before the switch). UI-SPEC specifies the overflow rule for the coin code only; not extended.

## Visual backstop (routed to UAT)

UI-SPEC UI Considerations, "Visual: the break reads as a break at print and in an exported SVG": on the founder's strategy factsheet, on screen, in print preview and in an exported SVG, confirm no joining line, legible USD/BTC codes and the printed figcaption. Not automated.

## Threat Flags

None. T-256-20 mitigated (segments compounded only within their unit, no joining path; gate A and the vertex assertions); T-256-21 mitigated (leverage forced to 1x at the context; gate B); T-256-22 mitigated (unit codes are React text nodes from `payload.unitSwitch`, which the plan 05 parser validated against `RETURNS_UNIT_RE`). No new endpoint, auth path or schema surface.

## Self-Check: PASSED

- FOUND: TimeSeriesChart.unit-switch.test.tsx, FactsheetView.unit-switch-leverage.test.tsx
- FOUND commits 1e35d0521, fdac0b4ee and cd0c009aa (ancestors of HEAD)
- STATE.md and ROADMAP.md untouched.
