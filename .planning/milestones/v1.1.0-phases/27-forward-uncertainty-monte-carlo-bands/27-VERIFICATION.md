---
status: passed
phase: 27
verified: 2026-06-22
---

# Phase 27 Verification — Forward Uncertainty (Monte-Carlo Bands)

Goal-backward check against SIM-01's three success criteria. Built directly (not
via gsd-executor subagents) by the autonomous run; fresh-Claude red-team applied
(critical findings fixed). 35 phase tests + 1167-test regression suite green;
tsc + lint clean; production build emits the worker chunk (exit 0).

## Success criteria

1. **Block bootstrap, joint across strategies, no Normal tail** — ✅
   `runMonteCarlo` block-bootstraps the engine's `portfolio_daily_returns` (each
   day is the joint realization → contemporaneous cross-strategy correlation
   intrinsic; contiguous circular blocks → autocorrelation). Pure resampling, no
   parametric/Normal fit. Pinned: determinism (seeded mulberry32), monotone
   quantiles, empirical asymmetry (a symmetric Normal shortcut fails the margin
   assertion), leverage-widening.

2. **Honest to sample size + disclosure** — ✅
   Linear-in-horizon parameter-uncertainty drift (`s·δ`, the SE of the s-day
   cumulative mean `s·σ/√n`) makes a shorter history produce a visibly wider band
   (pinned both directions: short>long, drift-on>drift-off) AND is bounded —
   calibration test pins the magnitude ≈ `H·σ/√n` (not the exp(H·δ) explosion the
   red-team caught). The section discloses method + path count + block length +
   overlapping-N + "not a Normal model · not a forecast", plus an explicit
   short-history note below ~1.5× the floor.

3. **Floor-gated + off the main thread** — ✅
   Below `SAMPLE_FLOOR_OVERLAPPING_DAYS` (the Phase-22 SoT, no literal 60) → honest
   empty state, never a fabricated band (pinned, incl. no-usable-n on empty /
   non-finite). The sim runs in a Web Worker (`montecarlo.worker.ts` via the
   `runMonteCarloOffThread` seam); the section debounces, tears the worker down on
   unmount/superseded input, ignores stale late results, and routes a worker
   failure / construction throw / watchdog timeout to an honest error state (no
   permanent spinner). `worker-src 'self' blob:` added to the CSP defensively.

## Human-needed (live browser, not CI)

- Visual confirmation of the band fan rendering + the "Simulating…" → bands
  transition in a real authed browser, and that the worker loads under the prod
  CSP. Covered by the post-deploy canary / `/qa` (headless can't hydrate authed
  pages — `reference_browse_no_hydrate_authed`). The data-layer + state-routing
  halves are fully unit-pinned.
