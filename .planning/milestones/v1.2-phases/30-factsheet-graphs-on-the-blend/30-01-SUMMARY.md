---
phase: 30-factsheet-graphs-on-the-blend
plan: 01
subsystem: scenario-composer-analytics
tags: [adapter, pure-ts, convention-pins, tdd, blend-graphs]
requires:
  - "src/lib/portfolio-math-utils.ts (mean, stdDev sample-std, DailyPoint)"
  - "src/lib/portfolio-stats.ts (computeRollingMetric — parity target)"
  - "src/lib/scenario.ts portfolio_daily_returns (frozen engine output — read only)"
provides:
  - "buildBlendPanels(portfolioDaily, window) → BlendPanelSeries — single source of truth for every blend-graph series"
  - "BlendPanelSeries interface (histogramSeries, quantiles, rollingSharpe, rollingVol, rollingSortino, usableN)"
affects:
  - "Plan 30-02 (mounts the panels in ScenarioComposer) consumes this adapter"
tech-stack:
  added: []
  patterns:
    - "Mirror portfolio-stats.ts sample-std × √252 (NOT factsheet/rolling.ts population std)"
    - "Histogram cumulative-wealth cumprod(1+r) input contract for ReturnHistogram"
    - "Engine-mirror Sortino: downside RMS ÷ TOTAL window n, 252-annualized"
    - "Degenerate guard FIRST → []/{} on length<window / <10 usable / any non-finite"
key-files:
  created:
    - "src/lib/scenario-blend-panels.ts"
    - "src/lib/scenario-blend-panels.test.ts"
  modified: []
decisions:
  - "Reuse mean/stdDev from portfolio-math-utils so vol/Sharpe parity vs computeRollingMetric is exact, not re-derived"
  - "Key the single blend Sharpe series sharpe_365d so RollingMetrics.STROKE_BY_KEY resolves CHART_ACCENT (A3, zero-touch on the leaf)"
  - "Single honest All quantile period (A2 minimal honest read)"
  - "Reconciled the Sortino-pin fixture to a 10-pt window to respect the LOCKED MIN_USABLE=10 floor (the contract wins over the scaffolded fixture)"
metrics:
  duration: "~5 min"
  completed: "2026-06-23"
  tasks: 2
  files: 2
---

# Phase 30 Plan 01: Blend-Graph Adapter Summary

**One-liner:** Pure-TS `buildBlendPanels` adapter deriving the blend's histogram (cumulative-wealth), quantiles, and rolling Sharpe/vol/Sortino from the frozen engine's unrounded `portfolio_daily_returns` — numerically pinned to `portfolio-stats.ts` sample-std × √252 with non-vacuous RED-first convention tests so any annualization/cumulative/std-basis drift fails CI loudly.

## What Was Built

The single genuinely-new file of Phase 30 and its convention-pin test, built test-first (RED → GREEN):

- **`src/lib/scenario-blend-panels.ts`** — `buildBlendPanels(portfolioDaily, window): BlendPanelSeries`. Pure TS, zero dependencies, no fetch/DOM/time.
  - `rollingVol` / `rollingSharpe` MIRROR `computeRollingMetric` arithmetic exactly (slice → `mean` → `stdDev(slice, true)` sample-std → × √252; sharpe = `s>0 ? (m*√252)/s : 0`), reusing the SAME `mean`/`stdDev` from `portfolio-math-utils` so parity is exact, not re-derived.
  - `rollingSortino` mirrors the frozen engine (`scenario.ts:354-361`): `downSq = Σ(x<0 ? x*x : 0)`, `dd = √(downSq / window) × √252` (÷ TOTAL window n, NOT down-day count), numerator `mean × 252`, 0 when no downside.
  - `histogramSeries` is `cumprod(1+r)` wealth (~1.0) off the UNROUNDED input — never raw daily, never the rounded `equity_curve`. `ReturnHistogram` re-derives daily internally as `v/cumulative[i]-1`.
  - `quantiles` = single honest `All` key, 5-number positional `[q0,q25,q50,q75,q100]` via linear-interp percentile.
  - Degenerate guard FIRST: `length < window` OR `< MIN_USABLE (10)` usable OR any non-finite value present → every series `[]`/`{}`, with `usableN` = count of finite points.
  - `rollingSharpe` keyed `sharpe_365d` so `RollingMetrics.STROKE_BY_KEY` resolves `CHART_ACCENT` (zero-touch on the leaf).

- **`src/lib/scenario-blend-panels.test.ts`** — 7 non-vacuous convention pins:
  1. sample-std parity: `rollingVol` === `computeRollingMetric(…, "volatility")` point-for-point (`toBeCloseTo(_, 8)`) — fails if population std is used.
  2. sharpe convention: `rollingSharpe.sharpe_365d` === `computeRollingMetric(…, "sharpe")`.
  3. sortino ÷ n: hand-checked 10-pt window asserts ÷ total-window-n (and explicitly NOT ÷ down-day count).
  4. 252-only: constant-return vol anchor (= 0) + `fs.readFileSync` source assertion that the live module body contains no `√365`/`*365`/`√250`/`Math.sqrt(365|250)`.
  5. histogram cumulative: `histogramSeries` starts ≈ `1 + r[0]` and round-trips through the leaf's `v/cumulative[i]-1` back to the ORIGINAL daily returns — fails if raw daily is passed.
  6. quantiles monotonic: each record value non-decreasing.
  7. degenerate → []/{}: positive control (healthy 252-pt → non-empty) + negative controls (`<window`, `<10`, NaN-injected, Infinity-injected → every series empty).

## Verification

| Gate | Command | Result |
|------|---------|--------|
| RED (Task 1) | `npx vitest run src/lib/scenario-blend-panels.test.ts` | Failed: `Failed to resolve import "./scenario-blend-panels"` (adapter not yet implemented) |
| GREEN (Task 2) | `npx vitest run src/lib/scenario-blend-panels.test.ts` | 7 passed (7) |
| Typecheck | `npx tsc --noEmit` (filtered to adapter) | No errors in scenario-blend-panels.{ts,test.ts} |
| Pure-TS | grep no real `fetch(`/`Date.now(`/`document.`/`window.` calls | PASS (only the word "fetch" in a JSDoc comment) |
| No annualization drift | `grep -vE '^\s*(//\|\*)' … \| grep -cE '365\|250'` | 1 match = `sharpe_365d` accent KEY (required string literal, not a √365/*365 factor); zero `√365`/`*365`/`√250` |
| Frozen engine untouched | `git diff --stat HEAD -- src/lib/scenario.ts src/lib/scenario.test.ts` | Empty (zero diff — LOCKED) |
| Imports reuse | `grep 'from "@/lib/portfolio-math-utils"'` | `mean`, `stdDev`, `DailyPoint` reused (parity guarantee) |

## TDD Gate Compliance

- `test(30-01)` commit `45005c7f` (RED) precedes `feat(30-01)` commit `1c8e660c` (GREEN). RED failed for the right reason (module-not-found), not a passing-by-accident test. No REFACTOR commit was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 7 — Surfaced conflict] Sortino-pin fixture reconciled to the LOCKED MIN_USABLE=10 floor**
- **Found during:** Task 2 (GREEN). The Task-1 scaffolded Sortino test used a 5-point window to be hand-checkable, but the LOCKED degenerate pin (`< 10 usable points → []`) correctly collapses a 5-point input to empty, so `rollingSortino.length` was 0, not 1.
- **Resolution:** The LOCKED adapter contract wins over the scaffolded fixture (CLAUDE.md Rule 7 / Rule 11). Widened the fixture to a deterministic 10-point window (3 down days), still hand-computing against ÷ total-window-n and asserting it is NOT the ÷ down-day-count value — the pin remains non-vacuous.
- **Files modified:** `src/lib/scenario-blend-panels.test.ts`
- **Commit:** `1c8e660c`

**2. [Rule 1 — Self-caught by the test] Removed forbidden `365`/`250` literals from the adapter's own JSDoc**
- **Found during:** Task 2 (GREEN). The 252-only source-read test (a deliberately strict, non-vacuous pin reading the live module body via `fs`) matched `√365` / `√250` because my own JSDoc comment literally said "No √365 / √250 anywhere".
- **Resolution:** The test is correct — it caught a real forbidden literal in the module text. Reworded the comments to "252-trading-day annualization ONLY — no calendar-day or alternate basis" so the live source carries zero `√365`/`√250` strings. Root-cause fix (Rule 6), not a test relaxation.
- **Files modified:** `src/lib/scenario-blend-panels.ts`
- **Commit:** `1c8e660c`

No architectural deviations (Rule 4). No auth gates. No new dependencies. No threat-surface additions (T-30-01/02/03 mitigations are all encoded as the convention-pin tests; T-30-SC n/a — zero installs).

## Known Stubs

None — the adapter is a complete, fully-wired pure function. (Note: `sharpe_365d` as the single Sharpe key is an intentional accent-resolution contract per A3, not a stub.)

## Self-Check: PASSED

- `src/lib/scenario-blend-panels.ts` — FOUND
- `src/lib/scenario-blend-panels.test.ts` — FOUND
- Commit `45005c7f` (RED) — FOUND in git log
- Commit `1c8e660c` (GREEN) — FOUND in git log
