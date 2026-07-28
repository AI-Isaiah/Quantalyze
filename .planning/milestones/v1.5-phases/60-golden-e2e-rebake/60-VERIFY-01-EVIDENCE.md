# VERIFY-01 evidence — golden & e2e disposition after the v1.5 math change

Date: 2026-07-02 · Anchored to: BLEND-07 numpy artifact (Phase 55) + PARITY-01
re-verify (Phase 56), both green on main @ c6cb4cae.

## Claim: no golden baseline renders the blend series → nothing to re-bake

| Baseline | What it renders | Blend exposure |
|---|---|---|
| `e2e/svg-chart-parity.spec.ts` (30 PNGs, WR-02 gate) | single-strategy factsheet panels on `/factsheet/[id]/v2` (StreakDistribution, BootstrapCI, EndOfYearBars, QuantileBoxPlot, CorrelationStrip/Matrix, Histogram, MasterBrush, DailyReturnsHeatmap) | none — no scenario blend on this route |
| `e2e/demo-screenshot.spec.ts` (375/768/1280 PNGs) | marketing `/demo` pages | none |
| `e2e/strategy-v2-chart-parity.spec.ts` | `/strategy/[id]/v2` panels (Vitest-covered siblings) | none |

## Proof the safety net never went red (so a bake could not mask anything)

- e2e job PASS on PR #565 (phases 55-57), PR #566 (phases 58-59, after the
  ced581e0 anchor fix — a NEW anchor's seed gap, not a golden diff), and the
  main merge CI run 28590250701 (2026-07-02, success).
- `git log --stat 221a6daa^..c6cb4cae -- 'e2e/*-snapshots'` → empty: zero
  snapshot updates across all of v1.5. No `--update-snapshots` was ever run.
- The absent-window engine path is byte-compatible by construction (Phase 55
  lock), so windowless surfaces (factsheet, demo, strategy pages) render
  pre-v1.5-identical output — consistent with the green goldens.

## The net v1.5 actually weakened, restored by this phase

ced581e0 made the Phase-58 composer-axe anchors conditional because the seeded
composer state was deterministically degenerate: `seedStrategyWithHistory`
never wrote `strategy_analytics.daily_returns`, which is exactly what the
composer's lazy `GET /api/strategies/[id]/returns` serves → empty series → no
coverage span → `windowBounds` null → the whole Phase-58 surface never mounts.

Restoration (this phase): opt-in `withDailyReturns` seed option (golden
fixtures byte-untouched), composer-axe seeds with it, anchors (d)/(e) promoted
back to UNCONDITIONAL + a new pin that the coverage-window value is a real
derived ISO range. Proof gate: the seeded e2e job must PASS (not skip) on the
phase PR.

## Deferred (new net, not restoration)

A scenario-blend screenshot golden (pixel coverage for future blend-math
changes) — no baseline exists today; adding one is NEW coverage and belongs to
a future milestone decision, not VERIFY-01.
