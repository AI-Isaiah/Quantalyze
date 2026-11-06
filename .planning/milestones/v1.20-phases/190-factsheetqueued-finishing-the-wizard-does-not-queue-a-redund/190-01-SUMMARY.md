---
phase: 190-factsheetqueued
plan: 01
subsystem: analytics-status
tags: [measurement, prod-read-only, compute_jobs, strategy_analytics, evidence-rule, vitest-baseline]

requires:
  - phase: 164.6.6.3.4-statusbridge
    provides: the status bridge (sync_strategy_analytics_status) whose branch (a) and (b) writers are verified here, not changed
  - phase: 166.5-computedatstamp
    provides: computed_at is stamped by the runner's success write only, which makes it the date of the last good compute
provides:
  - SC-1 recorded before any code change (finalize-sourced re-runs on PROD, 2026-11-03)
  - D-02 reach measured (27 of 27 terminal-success PROD rows carry all three stored-result evidence checks)
  - six code verdicts (A1, A2, MARKER, COMPOSITE, CREATE-WITH-KEY, SNAPSHOT), none FAILS
  - pre-change test baseline for the 17 test files phase 190 touches (852 tests, all green)
  - read-only SQL files plan 08 re-runs for the after-deploy reading
affects: [190-02, 190-03, 190-04, 190-05, 190-06, 190-07, 190-08, 190-09]

actuals:
  tokens: 9000
  tasks: 3
  commits: 1
plan_head_before: 2f15517fdafe0c7dce3fd055c13927a80fe2f95b
plan_head_after: c5c2bdf6c0c7eae502ec1a15b02bdc9e237c15a9

tech-stack:
  added: []
  patterns:
    - "counts-only read-only PROD measurement files with a blank first line, one SELECT, no id column"

key-files:
  created:
    - .planning/phases/190-factsheetqueued-finishing-the-wizard-does-not-queue-a-redund/190-MEASUREMENT.sql
    - .planning/phases/190-factsheetqueued-finishing-the-wizard-does-not-queue-a-redund/190-MEASUREMENT-evidence.sql
  modified: []

key-decisions:
  - "No code verdict failed, so plans 02 to 09 proceed; nothing was carried forward as a stop."
  - "SC-1 premise holds on PROD: every finalize-sourced sync_trades job in the window came after a finished computation."

requirements-completed: [SC-1]

duration: ~20min
completed: 2026-11-03
status: complete
---

# Phase 190 Plan 01: Pre-change measurement and code-premise checks Summary

**The wizard's legacy finalize arm queued 4 redundant `sync_trades` runs in the last 30 days on PROD (4 strategies, all after a finished computation, all private), the stored-result evidence holds on 27 of 27 terminal-success rows, and all six code premises that plans 02 to 09 build on hold.**

## SC-1 (before any code change)

- **Run time (UTC):** 2026-11-03T18:51:45Z
- **Database check:** the marker query ran first and alone, and the marker named PRODUCTION. Nothing was written to any database. `supabase db push` was never run. Both measurement files are single SELECTs.
- **Query body:** `190-MEASUREMENT.sql` in this phase directory. Plan 08 re-runs the same body with a deploy-time bound added to the `fin` CTE.

| kind | finalize_jobs | strategies | after first compute done (jobs) | strategies after first compute done | private strategies after first compute done | oldest | newest |
|------|---------------|------------|--------------------------------|------------------------------------|---------------------------------------------|--------|--------|
| sync_trades | 4 | 4 | 4 | 4 | 4 | 2026-10-04 | 2026-11-02 |
| stitch_composite | 0 | 0 | 0 | 0 | 0 | none | none |

The `stitch_composite` row is the empty group: the query returned no row for that kind.

**Limit of the count.** 4 of 4 finalize jobs sit inside the 30-day `done`-job retention window. The retention cron deletes `done` jobs older than 30 days and `failed_*` jobs after 90 days, so this is a count of about the last 30 days, not of all history. Older redundant runs cannot be seen.

**Comparison with the RESEARCH reading (2026-11-03, earlier the same day):** 4 `sync_trades` jobs on 4 strategies, all 4 after a finished computation, all private, 0 `stitch_composite`. The new reading matches it on every column, including the oldest and newest dates. The SC-1 premise (finalize queues a redundant re-run) holds; it is not vacuous.

## D-02 reach (evidence coverage)

Run at the same time and under the same marker check, with `190-MEASUREMENT-evidence.sql`:

| column | count |
|--------|-------|
| rows_total | 45 |
| rows_terminal_success | 27 |
| ts_with_series | 27 |
| ts_with_finite_headline | 27 |
| ts_with_marker | 27 |
| ts_all_three | 27 |
| published_ts | 3 |
| published_ts_all_three | 3 |
| rows_pending_or_computing | 0 |
| pending_or_computing_all_three | 0 |

Reading: every terminal-success row on PROD (27 of 27, and 3 of 3 published) carries the stored series, a finite stored headline and the success-written flags marker, so the evidence rule in plan 03 would admit all of them while a re-run is in flight. The other 18 rows are neither terminal success nor pending or computing (that is, failed rows).

Limit: `rows_pending_or_computing` is 0 at the time of the run, so the last pair of columns is vacuous. The measurement says nothing about how an in-flight row looks. The code reading (A1 below) shows why it matters: the derive hop replaces `data_quality_flags` and drops the success marker minutes before the compute hop finishes, which is the case plan 09's `last_success_snapshot` covers.

## Pre-change test baseline

`npm ci` ran in this worktree from the committed lockfile (`package.json` and `package-lock.json` unchanged by it). `scripts/verify-plan-anchors.mjs` on this plan exited 0 (5 claims checked). All 17 files are green at HEAD `2f15517fd`: 852 tests passed, 0 failed, 0 skipped.

| file | passed | failed | skipped |
|------|--------|--------|---------|
| src/app/api/strategies/finalize-wizard/route.test.ts | 160 | 0 | 0 |
| src/lib/strategyGate.test.ts | 53 | 0 | 0 |
| src/lib/closed-sets.test.ts | 42 | 0 | 0 |
| src/lib/compute-state.test.ts | 81 | 0 | 0 |
| src/lib/status-surface-copy.test.ts | 83 | 0 | 0 |
| src/lib/factsheet/fetch-and-build-payload.test.ts | 104 | 0 | 0 |
| src/lib/factsheet/composite-read-path.test.ts | 118 | 0 | 0 |
| src/lib/factsheet/build-payload.test.ts | 29 | 0 | 0 |
| src/lib/factsheet/v2-joint.test.ts | 24 | 0 | 0 |
| src/lib/queries.stale-analytics-detail.test.ts | 14 | 0 | 0 |
| src/components/strategy/StrategyTable.stale-analytics.test.tsx | 16 | 0 | 0 |
| src/app/api/admin/strategy-review/route.test.ts | 50 | 0 | 0 |
| src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx | 6 | 0 | 0 |
| src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx | 15 | 0 | 0 |
| src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx | 47 | 0 | 0 |
| src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx | 6 | 0 | 0 |
| src/app/factsheet-share/[token]/page.cache-isolation.test.tsx | 4 | 0 | 0 |

No file is red at HEAD, so any later failure in these files belongs to phase 190.

## Code verdicts

All eight grounded counts in the Task 3 verify step matched their HEAD baselines (1, 1, 0, 1, 0, 1, 1, 1). Searches were by symbol; line numbers are not relied on.

- **A1 (write order): VERDICT: HOLDS.** (a) `run_csv_strategy_analytics` in `analytics-service/services/analytics_runner.py` runs `await db_execute(_persist_cash_series)` and only then `await db_execute(_mark_complete)`. (b) `run_derive_broker_dailies_job` in `services/job_worker.py` persists the mark-to-market, cash and smoothed series with `persist_basis_series`, then runs `_prestamp_dq_flags`, which upserts the payload `_prestamp_payload` (`data_quality_flags` replaced by `_prestamp_flags`, a dict starting `{"csv_source": True}`, plus `metrics_json_by_basis` and `series_completeness`). All of that is in the derive hop, before the compute hop is enqueued, so it lands minutes before the compute hop's success write. It writes no `computed_at` and no status. (c) `run_stitch_composite_job` upserts `csv_daily_returns` (step "7. PERSIST"), then persists the basis series, then does one `strategy_analytics` upsert of `headline_payload` (headline, by-basis and `merged_flags`) last. Consequence, as designed in: during `computing` a viewer can see a new MTM or smoothed series and new by-basis object beside the previous run's headline, and the prestamp has dropped the success marker. Plan 09 carries `last_success_snapshot` across the prestamp, plan 03 reads through it, and plan 05 pairs the inner gates with the derive's own by-basis, series and `mtm_gated_reason`.
- **A2 (failure writers never store data): VERDICT: HOLDS.** Every writer of `computation_status = "failed"` to `strategy_analytics`, with the keys it writes:
  - `analytics_runner.py`: `_mark_failed` (insufficient history), `_mark_truncated`, `_mark_config_failed`, `_mark_unrecoverable` and its reissue write. Keys: strategy_id, computation_status, computation_warned, computing_started_at, computation_error, computation_error_source, computation_error_job_id, data_quality_flags. The first three write `data_quality_flags` as `{"csv_source": True}` (marker dropped). The unrecoverable pair writes `prior_flags`, the row's previous flags with `csv_source` set (the previous marker is carried). `_guard_failure_payload_inplace` only restores a protected refresh's prior status and warned flag and pops `data_quality_flags`. `_restore_publish_state_on_abort` writes status, warned, started_at and error provenance only. `_mark_computing` writes only the status and `computing_started_at`.
  - `job_worker.py`: the sync_trades enqueue-failed stamp (`_mark_analytics_failed`; keys status, warned, started_at, error; no flags), the derive failed arm (`_derive_failed_payload`: error keys, `data_quality_flags` `{"csv_source": True}`, and `metrics_json_by_basis` set to NULL), the derive error-only arm (`_upsert_error_only`: error keys only, no status) and the composite arms (`_composite_failed_payload`, `_composite_error_only_payload`: error keys plus `data_quality_flags` = `merged_flags`, a copy of the row's existing flags, so the previous marker is carried).
  - TypeScript: `compositeMemberCount` failed stamp and the unified-arm composite refusal in `finalize-wizard/route.ts`, the csv-finalize placeholder, and `stampCompositeFailedUnlessComplete` in `keys/sync/route.ts`. Keys: status, warned, started_at, error, and `data_quality_flags` of `{csv_source, membership_unknown}`, `{csv_source, composite}` or `{csv_source}`. (`portfolios/[id]/page.tsx` builds a read-side object with a failed status; it writes nothing.)
  - SQL: latest `sync_strategy_analytics_status` (migration `20261023120000`), branch (b), `INSERT ... ON CONFLICT DO UPDATE`: computation_status, computation_error, the two provenance columns, computation_warned and computing_started_at. Reaper and other SQL touch status only through this function; the other SQL `UPDATE strategy_analytics` statements in the baseline write `series_provenance`, `metrics_json` key removal, or the composite-member invalidation to `pending`.
  - None writes `daily_returns`, `returns_series` or any of cumulative_return, volatility, max_drawdown, cagr, sharpe, sortino, calmar. The only data-adjacent writes are `metrics_json_by_basis` (NULLed by the derive failed arm, set by the prestamp) and `data_quality_flags`.
  - OQ-4 behaviour under plan 03's rule: failure arms that replace flags with `{"csv_source": True}` (insufficient history, truncated, config failed, derive failed, the keys/sync, csv-finalize and finalize-wizard stamps) drop the marker, so a failed-then-retry row fails the marker check unless a bound snapshot rescues it. Arms that carry the previous flags (the runner's unrecoverable pair, the composite arms, error-only arms) keep a previous success's marker, and the data columns were never touched, so such a row can still pass all three checks.
- **MARKER (only terminal-success writers stamp `cumulative_method`): VERDICT: HOLDS.** In Python it is set in `data_quality_flags` in exactly two places: `data_quality_flags["cumulative_method"] = _cumulative_method` in `run_csv_strategy_analytics` (unconditional, outside the warned loops) and `merged_flags["cumulative_method"] = cumulative_method` in `run_stitch_composite_job`. `services/basis_series.py` puts the key only in the `conventions` echo of the series payload, not in flags. `grep -c cumulative_method supabase/schema/baseline.sql` prints 0; the one migration that mentions it concerns the `returns_denominator_config` column. In TypeScript every hit reads it (`curveMethodFromFlags`, `resolve-series.ts`, the `queries.ts` alias); none writes it into `data_quality_flags`. A failure arm that carries `prior_flags` or `merged_flags` carries an old marker forward without stamping a new one (see A2).
- **COMPOSITE: VERDICT: HOLDS.** The composite's terminal-success write is `headline_payload.update(cash_metrics_json)` followed by the one `strategy_analytics` upsert in `run_stitch_composite_job`. `cash_metrics_json` is `dict(_cash_basis_result.metrics_json)`, the output of `derive_basis_series` over `compute_all_metrics`, whose result dict carries `returns_series` and `cumulative_return`. So a composite stores a non-empty `returns_series` and a headline, and can pass the stored-series check. (The CSV path's `daily_returns` is not written by these two; the PROD count shows 27 of 27 pass on the either-or series check.)
- **CREATE-WITH-KEY: VERDICT: HOLDS.** `grep -c enqueue_compute_job src/app/api/strategies/create-with-key/route.ts` prints 0. The route queues no compute job.
- **SNAPSHOT: VERDICT: HOLDS.** (a) The only writes of `computed_at` to `strategy_analytics` are `_mark_complete` in `run_csv_strategy_analytics` and the composite `headline_payload`, both `"computed_at": "now"`. The three other `"computed_at"` keys in `job_worker.py` write to `allocator_equity_derived` (the refused-derive key capture, the nav-mark refusal record and the key-inputs record). No TypeScript writer sets it (every hit is a type or a read). No SQL function sets it: the bridge body is asserted by its own migration check not to name `computed_at`, and the trigger `strategy_analytics_hold_computed_at_until_success` only restores the old value when the new status is failed or computing. A first-ever INSERT still takes the column default (`now()`), which concerns a row with no prior success and so no snapshot. (b) The runner's success rebuild starts from `{"csv_source": True}` and copies only named keys from `existing_flags` (guard flags, `mtm_gated_reason`, `native_unit`, the NAV-mark keys, `small_base_measured`, the flow-timing keys), with no spread or update of the whole dict, so a nested `last_success_snapshot` can never reach a success write. (c) No Python or TypeScript reader iterates every key of `data_quality_flags`: searches for `Object.keys/entries/values`, `for ... in`, `.items()` and spreads over the stored flags found only computation-local dicts and named-key sets (for example `member_warn_flags`, built from named guard keys). A SQL search for `jsonb_each` or `jsonb_object_keys` over the flags found none. So neither a nested object nor a null-valued `last_success_snapshot` can be read as a flag. The composite stitch's `merged_flags = dict(existing_flags)` does carry unknown keys forward; this is harmless because the stitch also writes the top-level marker, which plan 03's reader prefers. This verdict is a code and grep reading, so it is only as strong as the searches.

## Deviations from Plan

None - plan executed exactly as written.

Task 1 and the SUMMARY carry no tracked code file by design. The SQL body for `190-MEASUREMENT.sql` is the RESEARCH query with the planned `private_strategies_after_first_compute_done` column added, and the `classified` CTE aliased `c`.

## Auth gates

None.

## Known Stubs

None (no application code changed).

## Threat Flags

None. The tracked SQL files and this SUMMARY contain counts, kinds, dates and statuses only; no strategy id, key id, email, project ref, marker text or home path.

## Commits

- `c5c2bdf6c` docs(190-01): add read-only PROD measurement SQL for SC-1 and stored-result evidence coverage

The SUMMARY commit follows this one.
