# Phase 194 plan 09: PROD recompute record

Founder clearance (Task 1): "Recompute after deploy", 2026-11-07, recorded in `194-VERIFICATION.md`.

Preconditions (Task 2), all read before the write:
- Code PR #1219 merged to main as `959ef982006753cfac7b2c59597ddde1432c574d`; main CI green apart from the `sql-gate-lint` stale-baseline drift note (counted as green); Supabase Migrate succeeded.
- Railway `quantalyze-analytics` (production) skipped the merge's deploy at first; the founder redeployed it, and the deployment of `959ef982` reached SUCCESS at 2026-11-08T12:51:43Z. The `quantalyze-analytics-backfill` worker had deployed `959ef982` at 12:14:34Z.
- Analytics `/health` (read-only GET): `git_sha` = `959ef982006753cfac7b2c59597ddde1432c574d`, `config_ok` true.

Channel: the Supabase MCP, one statement per call. The marker query ran first and alone, before the
before-count and again before the write; both times it named PRODUCTION. No hand UPDATE, INSERT or
DELETE: the only write was `enqueue_compute_job`. Public repo: counts and relations only.

## Write

One statement at 2026-11-08T13:00:36Z called `public.enqueue_compute_job(strategy_id, kind)` (no
metadata, no idempotency key) for each complete row lacking any of the three facts. The kind is the one
the row's own last done recompute used, per the `[164.6.6.3.3-WAVE5-RECOMPUTE]` precedent:
`compute_analytics_from_csv` for 25 rows (9 CSV-sourced, 16 API-keyed) and `stitch_composite` for the
2 composites. 27 jobs enqueued, 27 job ids returned.

Deviation, recorded: the plan says to wait one sync tick for API-keyed rows and enqueue only if still
lacking. The keyed rows' tick is daily (their last ran at 00:10Z to 05:25Z, before the deploy), and the
tick itself enqueues `compute_analytics_from_csv`, the same kind enqueued here. Enqueueing it now runs
the same product path a day earlier, so the wait was not taken.

Jobs: all 27 reached `done` by 13:39:54Z (17 on attempt 1, 8 on attempt 2 after a `worker_stalled`
reclaim while a composite ran, 2 composites on attempt 1). None failed. Every complete row's
`computed_at` is after the enqueue, and the complete-row count stayed 27.

## Lines

marker: PRODUCTION
rc-decision: recompute
rc-deploy: sha=959ef982006753cfac7b2c59597ddde1432c574d health=match
rc-before: complete=27 lacking=27
rc-after: complete=27 lacking=0
rc-lacking-keys: when=before defs=27 obs=27 roll1y=27
rc-lacking-keys: when=after defs=0 obs=0 roll1y=0
rc-d17: kpi-without-series=0
rc-roll1y: s1-span-ge-365=no sharpe_1y-points=0
rc-source: mcp (stored values, and the factsheet engine's definitions recomputed in SQL from S1's stored series)
rc-metric: 6 Month pages=agree cause=stored 6 Month equals the calendar 182-day window recomputed from the series (15.45 both)
rc-metric: 3 Month pages=agree cause=stored 3 Month equals the calendar 91-day window recomputed from the series (21.39 both)
rc-metric: VaR 95% pages=agree cause=stored VaR equals the historical floor-index quantile recomputed from the series (-0.86 both)
rc-metric: CVaR 95% pages=agree cause=stored CVaR equals the mean of the floor(0.05n) smallest returns (-2.03 both)
rc-metric: CAGR pages=agree cause=one stored value; factsheet overlays it at full history
rc-metric: Sharpe pages=agree cause=one stored value; factsheet overlays it at full history
rc-metric: Sortino pages=agree cause=one stored value; factsheet overlays it at full history
rc-metric: Calmar pages=agree cause=one stored value; factsheet overlays it at full history
rc-metric: Volatility pages=agree cause=one stored value; factsheet overlays it at full history
rc-metric: Return % pages=agree cause=stored cumulative return equals the series' compounded return (16.48 both)
rc-metric: Max DD pages=agree cause=one stored value; factsheet overlays it at full history

## Reading

Before the recompute, none of PROD's 27 complete `strategy_analytics` rows carried any of the three
Phase 194 facts (defs, obs and roll1y were all 27). After it, every complete row carries
`figure_defs_version = 2`, `record_observations` and all three 1y rolling keys, and no row stores an
annualised KPI without a stored series (D-17). For S1 (chosen by the plan-01 rule, never named), the four
figures that differed in the SC-1 reading now match the factsheet engine's own definitions when those
are recomputed independently in SQL from S1's stored series: 6 Month on the 182-day calendar window,
3 Month on the 91-day window, VaR 95% as the historical floor-index quantile, and CVaR 95% as the mean of
the floor(0.05n) smallest returns. The list and tearsheet print the stored value and the factsheet prints
its engine's value, so all four now read one number. S1's other headline scalars moved by one day of
data since the SC-1 reading (258 observations over 257 days) and still come from one stored value on
every page. S1 spans under 365 days, so its stored `sharpe_1y` holds 0 points, as D-14 expects. The
14-row reading of SC-1 also had three page-only rows (tearsheet AUM label, book equity, book exposure
labels). The store cannot settle those, so they are not restated here. They stay with the signed-in
browser UAT, which is VERIFICATION's remaining human item, together with a browser check that each page
prints the values above.
