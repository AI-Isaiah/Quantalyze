---
status: resolved
trigger: "PR #913 (169.1 ZOOMKPIS) changes the factsheet v2 Returns Correlations matrix for the e2e seeded strategy; svg-chart-parity goldens fail on the branch and pass byte-identically on main"
created: 2026-10-01
updated: 2026-10-01
---

# Debug: zoomkpis-corr-matrix-moved

## Symptoms

DATA_START
- **Expected:** Phase 169.1 (zoom-window KPI strip and metrics rail) leaves the full-history "Returns Correlations" matrix unchanged. D-27 (basis-context.tsx) says correlations stay the active view's BY REFERENCE; a window never re-derives them.
- **Actual:** e2e/svg-chart-parity.spec.ts fails on the branch: `correlations-matrix-desktop.png` 772x300 -> 772x301, 5583 px (3%) different (tolerance 2%); `full-page-ultrawide-2560.png` 9058 -> 9083 px tall.
- **Measured (orchestrator, 2026-10-01):**
  - workflow_dispatch `bake_svg_goldens` on main, run 36892795002 at 3b29af9cc: correlations-matrix-desktop and full-page-ultrawide-2560 come out BYTE-IDENTICAL to the committed goldens (sha bf69ea3f…, fbc34b50…).
  - the same bake on the branch, run 36889724126 at cd4b44c6a (~30 min earlier, same shared TEST DB, fixed seed anchor 2026-04-15, days:252): both differ. Artifact `svg-chart-goldens-baked` of that run holds the branch PNGs.
  - Cell values main -> branch. UNCHANGED: BTC-ETH 0.88, strategy-BTC -0.02, strategy-ETH -0.03, strategy-SPX -0.10. MOVED (every pair involving a traditional benchmark): BTC-SPX 0.50->0.51, ETH-SPX 0.50->0.53, BTC-Gold 0.15->0.21, ETH-Gold 0.13->0.22, SPX-Gold 0.23->0.28, BTC-IEF -0.00->-0.06, ETH-IEF 0.04->-0.05, SPX-IEF 0.13->0.10, Gold-IEF 0.10->0.17, strategy-Gold -0.02->-0.03, strategy-IEF -0.01->-0.03.
- **Timeline:** first seen in branch CI runs on 2026-10-01; main (which the branch has merged, merge 3fcaac926) is clean, so the cause is the branch's own commits.
- **Reproduction:** seeded e2e only (needs TEST Supabase). The matrix is built in src/lib/factsheet/build-payload.ts (~line 398: `alignComparators(dates, args.benchmarkPrices)`, `pairedCorr`); benchmark-vs-benchmark cells depend only on the bundle's `dates` axis and the benchmark price inputs, so the branch must change one of those for this strategy.
- **Already ruled out by the orchestrator:** build-payload.ts's diff does not touch `dates` or alignment directly; queries.ts discovery-variant removal is the intended refactor b39ce2f86.
- **Leads:** composite-read-path.ts (+367), fetch-and-build-payload.ts (readCashConventions / cashConventions), page.tsx (cache key v10 -> v11, FactsheetDegradedBuildError), dayBasis / calendarDense plumbing, how benchmarkPrices reach buildFactsheetPayload on the public route vs before.
DATA_END

## Constraints

- Branch feat/169.1-zoomkpis. Local unpushed commit e12270802 (snapshot re-bake) must be kept.
- Do NOT push. The orchestrator pushes once.
- Run vitest under Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH node node_modules/vitest/vitest.mjs run …`) — CI's pin.
- Decide: regression -> fix it at the root, with a test that fails before the fix; intended consequence of a recorded 169.1 decision (cite the D-number from .planning/phases/169.1-*/169.1-CONTEXT.md) -> report that, and the orchestrator re-bakes the goldens from run 36889724126 naming the mechanism.

## Current Focus

hypothesis: CONFIRMED — the cell values were moved by Phase 169.5 (D-54/D-58 paired-interval correlations, already on main at f1ca32b56), not by 169.1. The committed golden predates 169.5. Main's bake left it byte-identical only because Playwright 1.61 `--update-snapshots` defaults to mode "changed" (rewrite only a FAILING snapshot) and main's render sits inside maxDiffPixelRatio 0.02 at the same size. On the branch the element is 1px taller (300 -> 301, the D-27 range eyebrow shifts the page layout by +25px), a size mismatch always fails, so the bake rewrote the image and exposed the 169.5 values.
bug_class: Bohrbug (deterministic; reproduced in-process)
next_action: none — no code change; orchestrator re-bakes goldens from run 36889724126 naming the mechanism

## Evidence

- timestamp: 2026-10-01
  checked: git diff 3b29af9cc..HEAD over src (non-test), build-payload.ts matrix block, align/benchmarks fixtures, fetch-and-build-payload resolve
  found: the matrix block (alignComparators + pairedCorr, build-payload.ts ~398-437) is unchanged; no fixture, align.ts, benchmarks.ts or portfolio-math-utils change; dates = normalizeDailyReturns(resolveDailyReturnSeries(...)) unchanged; DistributionPanels reads useBasisSeriesView (not the window view)
  implication: static reading finds no path by which branch code changes SPX/Gold/IEF cells; need a dynamic reproduction

- timestamp: 2026-10-01
  checked: in-process repro (tsx, Node 22) — seed series exactly as e2e/helpers/seed-test-project.ts seedStrategyWithHistory({days:252, anchor 2026-04-15}) -> resolveDailyReturnSeries(null, returns_series) -> buildFactsheetPayload, correlationMatrix printed, run on three trees
  found: |
    branch HEAD e12270802 : SPX-BTC 0.512, SPX-ETH 0.527, Gold-BTC 0.209, Gold-ETH 0.222, SPX-Gold 0.280, IEF-BTC -0.064, IEF-ETH -0.048, SPX-IEF 0.102, Gold-IEF 0.168, strat-Gold -0.025, strat-IEF -0.032  (= the branch PNG)
    main 3b29af9cc        : IDENTICAL to the branch, every cell, 3 decimals
    f1ca32b56^ (pre-169.5): 0.498, 0.496, 0.147, 0.133, 0.225, -0.000, 0.036, 0.130, 0.105, -0.024, -0.005  (= the committed golden / main PNG)
  implication: main's own code already computes the branch's values; the golden values are the pre-169.5 computation. 169.1 does not change any matrix cell.

- timestamp: 2026-10-01
  checked: golden history and Playwright snapshot-update semantics
  found: correlations-matrix-desktop golden last written by 3357a2eb5 (Phase 169 #904, 2026-09-30 00:22); Phase 169.5 BENCHCOMPARE f1ca32b56 landed after it (2026-09-30 14:23). node_modules/playwright/lib/program.js:208 — `-u, --update-snapshots [mode]` choices all|changed|missing|none, preset "changed" (bare flag rewrites only snapshots that fail). Spec uses maxDiffPixelRatio 0.02 (panels) / 0.05 (full page). A dimension mismatch fails regardless of ratio.
  implication: main's bake renders the 169.5 values but stays within 2% at 772x300, so the file is not rewritten — "byte-identical on main" proves the comparison passed, not that main renders the golden's numbers. The branch's 772x301 is a size mismatch, so it fails and is rewritten with the current (169.5) values.

- timestamp: 2026-10-01
  checked: 169.5-CONTEXT D-54 / D-58 pairing rule
  found: a pairing interval needs a benchmark close at BOTH strategy dates k-1 and k (and, per D-64, every own-calendar date inside it), so a weekday comparator's (SPX, GLD, IEF) Monday-vs-7-day-strategy interval leaves the pairing
  implication: explains the cell pattern exactly — every pair with a traditional leg moves, crypto-only pairs (BTC-ETH, strat-BTC, strat-ETH) do not; strat-SPX moved -0.098 -> -0.102, which rounds to -0.10 both ways

- timestamp: 2026-10-01
  checked: shasum + pixel size of every PNG in the branch bake artifact (run 36889724126) vs committed goldens at branch HEAD and the main bake; ci.yml bake step
  found: |
    the branch bake rewrote EXACTLY four files, every one a height change only:
      correlations-matrix-desktop 772x300 -> 772x301
      histogram-desktop           772x176 -> 772x177
      full-page-desktop           1280x8416 -> 1280x8440 (+24)
      full-page-ultrawide-2560    2560x9058 -> 2560x9083 (+25)
    every other branch PNG is byte-identical to its committed golden. The ci.yml bake runs `npx playwright test e2e/svg-chart-parity.spec.ts --update-snapshots --timeout 60000` (bare flag => preset "changed").
    correlation-strip-desktop in the branch bake is byte-identical to the golden and READS the pre-169.5 values (Gold -0.02, IEF -0.01) although branch and main code compute strat-IEF -0.032 (=> -0.03): a stale golden kept because it passed within 2%.
  implication: proves the retention mechanism directly. Only size changes force a rewrite; the size changes are the D-27 eyebrow layout shift (panels below it land on a fractional y and round 1px taller). Value staleness vs 169.5 is present on main and in still-passing goldens too.

## Eliminated

- hypothesis: 169.1 changes the bundle's `dates` axis or the benchmark inputs reaching alignComparators
  evidence: main and branch build identical matrices from the identical seed input (repro above); no fixture/align/benchmarks/normalize change in the diff
  timestamp: 2026-10-01

## Resolution

root_cause: Not a 169.1 regression. The matrix values were changed by Phase 169.5 BENCHCOMPARE (169.5-CONTEXT D-54 as amended by D-58/D-64: correlations computed only over intervals paired for both legs, so weekday comparators drop their weekend-spanning intervals), merged to main at f1ca32b56 AFTER the golden was last baked (3357a2eb5). Main's goldens stayed stale silently because Playwright's bare `--update-snapshots` rewrites only failing snapshots and main's render is within maxDiffPixelRatio 0.02 at the same 772x300 size. On the branch, 169.1 D-27's range eyebrow ("Full history: <start> – <end>", FactsheetView RangeEyebrow + strip margin mt-6 -> mt-2) grows the page by 25px (9058 -> 9083), which shifts the matrix to a fractional y offset and rounds its screenshot box to 772x301; a size mismatch always fails, so the image is rewritten and shows the 169.5 numbers. (Measured: all four rewritten files differ only in height, +1px panels and +24/+25px full pages; the sub-pixel rounding step itself is inferred, not measured in a browser.)
fix: none in code. Re-bake the four files the branch bake rewrote (correlations-matrix-desktop, histogram-desktop, full-page-desktop, full-page-ultrawide-2560) from run 36889724126, naming two mechanisms in the commit: (1) values = 169.5 D-54/D-58 paired correlations, stale in the golden since f1ca32b56; (2) +1px / +25px = 169.1 D-27 range eyebrow layout.
verification: in-process repro on 3 trees (branch, main, pre-169.5) — branch == main cell-for-cell; pre-169.5 == golden cell-for-cell
files_changed: []
decision_ids: 169.1 D-27 (layout/size); 169.5 D-54, D-58, D-64 (values)
side_finding: the svg-chart-parity goldens on main are stale against 169.5 and nothing caught it — a bare `--update-snapshots` bake in mode "changed" keeps any within-tolerance golden, so a bake run cannot prove freshness. Still stale after the re-bake (they pass within tolerance so "changed" mode keeps them): at least correlation-strip-desktop (reads strat-IEF -0.01, code computes -0.03); likely the -320 / -2560 correlation panels too. Consider `--update-snapshots=all` for the bake job.
