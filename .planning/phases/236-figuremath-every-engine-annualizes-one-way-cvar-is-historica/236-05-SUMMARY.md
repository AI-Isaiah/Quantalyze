---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 05
subsystem: ts-engines-sample-sd
tags: [annualization, ddof, sample-sd, census, moved-pins, factsheet, rolling, compare]
requires: [236-01, 236-02, 236-10]
provides:
  - "every TS annualized dispersion on SD_DDOF: compute() ann_vol and Sharpe, the OG card Sharpe, the 126/30-row and 365-day rolling windows, tracking error and information ratio, the bootstrap Sharpe band, the compare adapter vol and Sharpe"
  - "the three engines already on the sample sd (sample-basis-ratios, portfolio-stats, scenario-benchmark) read it by name"
  - "TS annualization census NOT_YET_MIGRATED = [] (empty)"
affects: [236-09, 236-11]
key-files:
  modified:
    - src/lib/factsheet/compute.ts
    - src/lib/factsheet/og-metrics.ts
    - src/lib/factsheet/rolling.ts
    - src/lib/factsheet/joint.ts
    - src/lib/factsheet/bootstrap.ts
    - src/app/(dashboard)/compare/lib/holding-compare-adapter.ts
    - src/lib/sample-basis-ratios.ts
    - src/lib/portfolio-stats.ts
    - src/app/(dashboard)/allocations/lib/scenario-benchmark.ts
    - src/lib/scenario-blend-adapter.ts
    - src/__tests__/annualization-census.test.ts
decisions:
  - "skew and kurtosis in compute() stay population moments on dispersion(rets, 0), classified 'moment' in the census: they are not annualized, so F-5's annualization rule does not reach them"
  - "the two sd === 0 degeneracy checks in joint.ts stay on ddof 0 and stay classified 'degeneracy' (ddof-invariant)"
  - "scenario-blend-adapter.ts (comment-only edit, outside the plan's file list) and scenario-blend-adapter.test.ts: the 108 'population std is canonical' user decision is superseded by F-5; the adapter derives from rolling.ts, so it moved with it (see Conflict surfaced)"
  - "the build-payload byte snapshot was produced by a one-shot vitest -u into a scratch backup, restored, then APPLIED only after a repo-free script verified every moved number (same method as plan 10); no -u remains in the tree"
metrics:
  duration: "about 2h"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 86600
  tasks: 3
  commits: 3
plan_head_before: d46e6eb99e56f1a5888e7175932492222dc84c77
plan_head_after: 7300603843a2bab239f973e989dce00048317a26
---

# Phase 236 Plan 05: TS engines on the sample sd Summary

Every TS annualized dispersion now divides by n - 1 through the named `SD_DDOF`, so the factsheet headline, its bootstrap band, the rolling charts, tracking error / information ratio, the OG card and the compare surface agree with the stored engine; the TS census migration list is empty.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 005623d0d | `compute()` basis sd and Sharpe, og-metrics Sharpe on `SD_DDOF`; skew/kurtosis stay population moments; moved pins; census `compute.ts` and `og-metrics.ts` leave NOT_YET_MIGRATED |
| 2 | c92df6051 | rolling (row windows and the 365-day window), joint TE/IR, bootstrap Sharpe, compare adapter vol/Sharpe on `SD_DDOF`; moved pins and the byte snapshot; four census files leave NOT_YET_MIGRATED |
| 3 | 730060384 | sample-basis-ratios, portfolio-stats, scenario-benchmark read `SD_DDOF` (values unchanged); NOT_YET_MIGRATED ends empty |

## RED at HEAD (before each engine edit)

- Task 1: 4 new cases failed: compute() `ann_vol`, compute() `sharpe`, the skew/kurtosis case's `ann_vol` line, and og-metrics (`expected 5.291502622129183 to be close to 5.264978632435274`; the card read the population figure). Skew and kurtosis assertions in the same case passed at HEAD (they are unchanged by design).
- Task 2: 9 new cases failed across `rolling.test.ts` (3), `joint.test.ts` (2), `bootstrap.conventions.test.ts` (1), `holding-compare-adapter.test.ts` (3), e.g. `expected 0.2865745976181419 to be close to 0.29022537661405357` and `expected 7.937253933193773 to be close to 7.52994023880668`.
- Task 3: removing the three files from NOT_YET_MIGRATED first: `src/lib/sample-basis-ratios.ts: token ddof1 recorded 0, measured 1`, `src/lib/portfolio-stats.ts: token disp1 ...`, `scenario-benchmark.ts: token ddof1 ...`, plus the positive arm.

## Moved pins: old -> new -> why

Every new expected value comes from an inline oracle or an exact identity written outside the engines; none was read off engine output, and no `-u` run is left in the tree.

| Pin | Old | New | Why (independent derivation) |
|---|---|---|---|
| `compute.conventions` frozen A `ann_vol` / `sharpe` | 0.13018299107383202 / 3.190590934087568 | 0.13240850255903883 / 3.1369637377129056 | standalone script (repo-free) rebuilds the 30 returns from `baseReturn`, takes sum of squares over n - 1 = 29, `ann_vol = sd * sqrt(365)`, `sharpe = mean * 365 / (sd * sqrt(365))`. The same script's population values equal the old frozen lines to the last digit (validates the oracle). Hand-edited, header note added |
| same, B | 0.11757149566205052 / 2.3721427668612827 | 0.11958141041182332 / 2.332271981600751 | same script |
| same, C | 0.13434996646165637 / 2.3065394136537356 | 0.13664671345549362 / 2.2677712842892355 | same script |
| `build-payload.benchmark-opt` dropped-close BTC `ann_vol` (n = 95) | 0.3388644459328932 | 0.34066214791624716 | old value was hand-typed from a scratch script outside the project; sample = population x sqrt(95/94) exactly |
| same, D-58 missing-day `ann_vol` (n = 96) | 0.33742174194520497 | 0.3391929968552185 | x sqrt(96/95) |
| same, SPX 252 `ann_vol` / `sharpe` / "must not be" 365 reading (n = 70) | 0.27231658986911744 / 0.7385171259946766 / 0.32773306663876967 | 0.27428280016705486 / 0.7332230281604359 / 0.330099401098633 | x sqrt(70/69), Sharpe x sqrt(69/70) |
| same, BTC-on-weekday 252 `ann_vol` / `sharpe` / 365 reading (n = 70) | 0.35486893203639935 / -1.9919576662855796 / 0.42708482581620255 | 0.3574311958666103 / -1.9776782157545196 / 0.430168510813199 | same identity |
| `scenario-factsheet-payload.test` PAYLOAD-03 `ann_vol` | 0.0075 x sqrt(252) (population) | 0.0075 x sqrt(30/29) x sqrt(252), 9 dp | 15 x 0.01 and 15 x -0.005: every deviation exactly 0.0075, sum of squares 30 x 0.0075^2 over n - 1 = 29. Test renamed (sample-sd, population-sd bleed fails) |
| `TimeSeriesChart.coverage-gap` SPX rolling vol [36] and [29] (n = 22 each) | 0.36895410296812775, 0.37097644493599624 | 0.3776365638909319, 0.3797064968869725 | x sqrt(22/21). n checked two ways: the 22 weekdays of the window, and `n = r^2 / (r^2 - 1)` of engine/old ratio = 22.0 exactly |
| same, BTC crypto rolling vol [36] (n = 30) | 0.36029285397447514 | 0.36645215234321044 | x sqrt(30/29) |
| same, BTC weekday-strategy rolling vol [39] (n = 30) | 0.4820765121931783 | 0.49031773330651024 | x sqrt(30/29) |
| `holding-compare-adapter.test` multi-day-gap `vol` | 1.9104973 (= 0.1 x sqrt(365)) | 0.1 x sqrt(2) x sqrt(365) = 2.7018512 | returns +0.1, -0.1: sum of squares 2 x 0.1^2 over n - 1 = 1; Sharpe 0 unchanged |
| same, derivative crypto-clock `vol` | sd x sqrt(365), sd = (0.1 + 1/11)/2 | same sd x sqrt(30/29) x sqrt(365) | 15 returns each of +0.1 and -1/11, every deviation equals sd, n = 30 |
| `return-stats.sites` (factsheet) T13 and T14 | `stdDev(NOISY_A, false)` | inline `sampleSd` (sum of squares over n - 1, summed left to right) | bitwise "own arithmetic order" pins kept bitwise; the oracle no longer imports a production helper |
| same, T15 (bootstrap Sharpe point) | population sd | `sampleSd` | same |
| `src/lib/return-stats.sites.test` T1 `analyzePriceSeries` vol | `/ n` | `/ (n - 1)` | the adapter's vol is the sample figure |
| `return-stats.sites-joint.test` `referenceJoint` tracking error, `windowStats` sd | `/ n` | `/ (n - 1)` | beta and correlation ratios still cancel ddof and stay on n |
| `scenario-blend-adapter.test` SC-4 pins at w = 63, 126, 252 | even A, odd A x sqrt(1 - 1/w^2) (population) | even A x sqrt(w/(w-1)), odd A x sqrt((w+1)/w) | alternating +-A: even window mean 0, sum of squares w A^2; odd window sum of squares w A^2 - A^2/w, so sigma^2 = A^2 (w+1)/w. The old assertion "sample-std bleed fails" became "population-std bleed fails" |
| same, BLEND-01 365 basis | A x sqrt(365) | A x sqrt(126/125) x sqrt(365) | w = 126 even window |
| `__snapshots__/build-payload.test.ts.snap` (3 snapshots, 12-sig-fig strings) | population-sd rolling, summaries, style drift, bootstrap band | 768 numbers moved | produced by one `-u` run into a scratch copy, the repo file restored (`cmp OK`), then every moved path verified by `scratchpad/f236/p05/snapverify.mjs`, which imports nothing from the repo: rolling vol x sqrt(30/29), rolling Sharpe x sqrt(29/30); strategy and BTC summaries n = 62, SPX n = 43, style-drift halves n = 31; the Sharpe band (point, lo, hi, hist ends) x sqrt(61/62); `volMatched` rebuilt from the comparator's own covered returns (recovered from its cumulative index) x scale = strategy vol / comparator vol, matching both old (validates the reconstruction) and new at 1e-9. `checked 768 moved numbers, 0 bad`. Composite arm: only the comparator vols move (its strategy vol is the stored 0.42 cash overlay), so `volMatchedLabel` BTC 0.90 -> 0.89 and SPX 1.17 -> 1.16 follow |

New cases (not moved pins): compute() sample ann_vol and Sharpe on [+0.02, -0.01] x 50, the skew/kurtosis population-moment case on a skewed series, og-metrics equal to compute(), rolling 126-row and 30-row points, row window equals calendar window on the same 126 returns, joint TE/IR, bootstrap point equals compute(), compare adapter vol/Sharpe equal compute() on the same series.

## Conflict surfaced (Rule 7)

`scenario-blend-adapter.ts` / its test recorded a 108-CONTEXT USER DECISION: "population std is canonical (backbone)". Phase 236 F-5 ("365, ddof 1 everywhere", TS moves to match Python) supersedes it, and the plan explicitly moves the 126/30-row `rolling.ts` windows that the adapter derives from. I moved the pins and rewrote the adapter's docstring to say the convention stays unified, now on the sample sd, and that 108's choice is superseded by F-5 rather than forked from. Flag for the ship PR: the Scenario planner's rolling vol/Sharpe hover values shift by roughly sqrt(w/(w-1)) (about 0.4% at w = 126).

## compute.conventions B/C skew (deferred-items.md, from 236-01)

Decision recorded: not re-pinned. Under Node 22.22.1 (the `.nvmrc` Node CI runs) all 23 `compute.conventions` tests pass. Under Node 25.8.1 B and C fail only on the last-ulp `skew` (`-0.11360716852722537` vs `...538`, `0.036844507138639` vs `0.036844507138638946`); this plan's moved `ann_vol` and `sharpe` lines pass on both Node builds. It is a local Node-build effect that CI does not reproduce.

## PROOF-01 (byte backups in the scratchpad, restored with cp, verified with cmp)

(T1) Neuter in `src/lib/factsheet/compute.ts`: `sharpeRatio(basisReturns, { periodsPerYear, ddof: SD_DDOF, rf })` -> `ddof: 0`.
- `npx vitest run src/lib/factsheet/compute.metrics.test.ts src/lib/factsheet/og-metrics.test.ts src/__tests__/annualization-census.test.ts` RED, `Tests  4 failed | 80 passed (84)`: `× sharpe = mean x N / (sample sd x sqrt(N)): 0.005 / (0.015 x sqrt(100/99)) x sqrt(252)` (`AssertionError: expected 5.264978632435276 to be close to 5.291502622129183`), `× Sharpe is the SAMPLE-sd one (F-5, 236-05) ...` (og card, `expected 5.291502622129183 to be close to 5.264978632435274`), `× per-file token counts equal the recorded counts` with `src/lib/factsheet/compute.ts: token ddof0 recorded 0, measured 1`, `× negative arm: a migrated engine has no 365.25, ddof-0 or bare ddof-1 literal` with `src/lib/factsheet/compute.ts: literal ddof0 x1`.
- `cp` restore, `cmp OK (T1)`, GREEN: `Tests  46 passed (46)` (compute.metrics + census).

(T2) Neuter in `src/lib/factsheet/rolling.ts`: the sed matched BOTH Sharpe call sites (the row-window `rollingSharpe` and the calendar-window `sharpeOut`), each `{ periodsPerYear, ddof: SD_DDOF }` -> `ddof: 0`.
- `npx vitest run src/__tests__/annualization-census.test.ts src/lib/factsheet/rolling.test.ts src/lib/factsheet/return-stats.sites-joint.test.ts` RED, `4 failed`: `× the 30-row Sharpe point is mean x N / (sample sd x sqrt(N))`, `× per-file token counts equal the recorded counts` with `src/lib/factsheet/rolling.ts: token ddof0 recorded 0, measured 2`, `× negative arm ...` with `src/lib/factsheet/rolling.ts: literal ddof0 x2`, `× T17 rollingBeta and rollingSharpe on a noisy series are bitwise today's arithmetic` (`expected 1.1742594692535762 to be 1.1545226103288901`).
- `cp` restore, `cmp OK (T2)`, GREEN: `Test Files  3 passed (3)`, `Tests  106 passed (106)`.

(T3) Neuter in `src/lib/sample-basis-ratios.ts`: `{ periodsPerYear, ddof: SD_DDOF }` -> `{ periodsPerYear, ddof: 1 }`.
- `npx vitest run src/__tests__/annualization-census.test.ts` RED, `Tests  3 failed | 6 passed (9)`: `src/lib/sample-basis-ratios.ts: token ddof1 recorded 0, measured 1`, `src/lib/sample-basis-ratios.ts: literal ddof1 x1`, `src/lib/sample-basis-ratios.ts: never uses SD_DDOF`.
- `cp` restore, `cmp OK (T3)`, GREEN: `Tests  9 passed (9)`.

## Verification

- Census: `NOT_YET_MIGRATED` is `[]`; 9/9 census tests GREEN. Acceptance greps: `grep -a -c "ddof: 0" src/lib/factsheet/compute.ts` = 0 (HEAD 1); `SD_DDOF` count in `rolling.ts` = 5 (HEAD 0), `sample-basis-ratios.ts` = 2 (HEAD 0).
- Task 1 scope (`src/lib`, factsheet v2, widgets/performance, census) after the Task 1 edits: 9 failures, all cross-engine tests that needed the Task 2 engines (Deviation 3); GREEN at Task 2.
- Task 2 scope (`src/lib`, factsheet v2, `src/app/(dashboard)`, census, phase-52 frozen-spine guards): `Test Files  709 passed`, `Tests  15059 passed | 23 skipped`, with 3 failures that were all 5000 ms timeouts of tree-scanning tests under load (`return-stats.single-source` x2, `seam-venue-vocabulary.invariant`); each passes alone (`61 passed`).
- Whole repo, Node 22, `npx vitest run`: `Test Files  1264 passed | 20 skipped`, `Tests  27409 passed | 306 skipped`, 2 load-only failures (`display-sign-single-source` R2 timeout at 5000 ms; `ci-apt-bounded` R4 SIGKILL at the 55 s spawn timeout), both pass alone (`94 passed`).
- `npx tsc --noEmit -p tsconfig.json`: clean.

## Deviations from Plan

**1. [Rule 1 - stale comment] `scenario-blend-adapter.ts` docstring (outside the plan's file list)**
- **Found during:** Task 2, moving the SC-4 pins.
- **Issue:** the adapter's docstring and a type comment said "POPULATION std is canonical (backbone)", false once `rolling.ts` moved.
- **Fix:** comment-only rewrite stating the sample-sd backbone and the supersession of 108's choice by F-5. No code or token change.
- **Commit:** c92df6051.

**2. [Pins outside the listed test files, as the plan asks to be listed]** `compute.conventions.test.ts` (frozen A/B/C, a second reviewed one-time exception noted in its header, hand-edited), `build-payload.benchmark-opt.test.ts`, `scenario-factsheet-payload.test.ts`, `TimeSeriesChart.coverage-gap.test.tsx`, `scenario-blend-adapter.test.ts`, `return-stats.sites.test.ts` (both copies), `return-stats.sites-joint.test.ts`, `holding-compare-adapter.test.ts`, and `__snapshots__/build-payload.test.ts.snap`.

**3. [Tracer ordering] Task 1's commit leaves cross-engine agreement tests red by construction.** The plan splits the headline (Task 1) from its band, rolling windows and compare surface (Task 2). After the Task 1 commit alone, 9 tests that compare compute() with the bootstrap or rolling output (`build-payload.headline-agreement` x4, `build-payload.rolling-basis` x2, the three `build-payload` byte snapshots) were red; none was a value pin of Task 1's files, and all are GREEN at Task 2's commit with no edit to the agreement tests themselves (only the byte snapshot moved).

**4. [Rule 2-style hygiene] The T13/T14/T15 oracles in `factsheet/return-stats.sites.test.ts` imported `stdDev` and `mean` from `portfolio-math-utils`; the moved oracles are now inline.** `stdDev` stays imported only until T15 moved in Task 2 (the import is gone at HEAD).

**Out-of-scope, not fixed:** `compute()`'s downside deviation (`ddDev`, the Sortino denominator) divides the sum of squared losses by `basisN`, and `bootstrap.ts` / `rolling.ts` carry the same Sortino shape. It is a downside-RMS convention, not a standard deviation, outside F-5's ddof rule and outside the plan's write scope.

## Side effect to clear (not committed)

The whole-repo `npx vitest run` rewrote `analytics-service/tests/fixtures/constit_parity_golden.json` (the `_readme` string loses plan 236-02's note; `scripts/capture-constit-parity-golden.ts` is the writer; no figure changed). I did not stage it. `git checkout --` on it was denied by the permission layer, so it is left as an uncommitted working-tree change for the orchestrator to restore.

## Known Stubs

None.

## Threat Flags

None. T-236-11 (headline vs band or rolling chart on different ddof) is closed by the empty NOT_YET_MIGRATED list plus the census negative and positive arms; T-236-12 (re-pinning from engine output) is closed by the table above.

## Self-Check: PASSED

- Commits 005623d0d, c92df6051, 730060384 are ancestors of HEAD; `commits: 3` measured from the ledger (`d46e6eb99..HEAD`).
- Files created or modified exist; `NOT_YET_MIGRATED = []`.
