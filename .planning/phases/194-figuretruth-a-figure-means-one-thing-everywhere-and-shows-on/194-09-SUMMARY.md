---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 09
subsystem: prod-recompute
tags: [trust-04, d-02, d-03, d-14, d-15, d-17, prod-write, product-path]

requires:
  - phase: 194-08
    provides: the cross-page parity the after-reading checks on PROD
  - phase: 194-23
    provides: the producer's 365-day rolling window (volatility_1y, sharpe_1y, sortino_1y)
provides:
  - "194-RECOMPUTE.md: rc-before complete=27 lacking=27, rc-after complete=27 lacking=0, defs=0 obs=0 roll1y=0 after, 11 rc-metric lines all pages=agree"
affects: [194-VERIFICATION]

actuals:
  tasks: 3
  commits: 1

commits: 1
---

# Phase 194 Plan 09: PROD recompute Summary

PROD's 27 complete analytics rows now store the D-02/D-03 figures, D-15's observation count and D-14's 365-day rolling window. They were recomputed through `enqueue_compute_job` after the Phase 194 deploy was confirmed by Railway and by `/health`.

## What ran

- **Task 1 (decision):** founder answer `recompute` ("Recompute after deploy", 2026-11-07).
- **Task 2 (orchestrator, PROD):** these preconditions held first: merge `959ef982` on main, main CI green apart from the counted-as-green stale-baseline note, the Railway API deploy SUCCESS after a founder redeploy (Railway first skipped it), the backfill worker on the same sha, and `/health` `git_sha` equal to the merge. The marker query ran first and alone and named PRODUCTION. Then one `enqueue_compute_job` statement wrote 27 jobs: 25 `compute_analytics_from_csv` and 2 `stitch_composite`. Each kind is the one the row's last done recompute used. All 27 reached `done` in about 39 minutes, 8 of them on a second attempt after a `worker_stalled` reclaim, and none failed.
- **Task 3 (fallback booking):** not run, because the answer was `recompute`.

## Result

- `rc-lacking-keys`: before `defs=27 obs=27 roll1y=27`, after `defs=0 obs=0 roll1y=0`. Complete rows stayed 27, and every row's `computed_at` is after the enqueue.
- D-17: no complete row stores an annualised KPI without a stored series.
- S1: the stored 6 Month, 3 Month, VaR 95% and CVaR 95% each equal the factsheet engine's definition, recomputed independently in SQL from the stored series. These were the four figures that differed in SC-1. S1 spans 257 days, so `sharpe_1y` holds 0 points (`s1-span-ge-365=no`).

## Deviations

- **API-keyed rows were enqueued at once instead of after one sync tick.** Their tick is daily and enqueues the same `compute_analytics_from_csv` kind, so waiting would only have delayed the same product path by a day. This is recorded in `194-RECOMPUTE.md`.
- **The after-reading is a store reading, not a browser reading.** The 11 scalar metrics are settled from the store, and the factsheet engine's definitions were recomputed from the series. The three page-only SC-1 rows (tearsheet AUM label, book equity, book exposure) and the on-page check stay with VERIFICATION's browser UAT item.

## Self-Check: PASSED

The plan's automated verify exits 0 on `194-RECOMPUTE.md`. The file contains no uuid and no home path.
