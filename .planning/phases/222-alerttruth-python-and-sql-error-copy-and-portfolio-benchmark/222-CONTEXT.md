# Phase 222: ALERTTRUTH - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Every Python and SQL error sentence a user can read names the real cause and offers only a channel that exists (the contact form, never "contact support"). A portfolio whose benchmark sources all failed says the benchmark has no price source, not "stale". `run_sync_trades_job` no longer leaves a strategy reading `complete` with no analytics after its follow-on analytics enqueue fails. Owns TODOS `[212-CONTACT-SUPPORT-SURVIVORS]`, `[166.4.1-BENCHMARK-OUTAGE-LABEL]`, `[SYNCTRADES-ENQUEUE-DONE]` (REQUIREMENTS ERRC-01, ERRC-02, ERRC-03). Success criteria: ROADMAP `### Phase 222`, SC 1-6 (PROOF-01 applies to every gate).

</domain>

<decisions>
## Implementation Decisions

### ERRC-03: failed follow-on enqueue in run_sync_trades_job (founder ruling 2026-11-25, option a)
- Return FAILED only when nothing is published to lose: the strategy has no `strategy_analytics` row at `complete` or `complete_with_warnings`. A live published strategy keeps its publish state and the next cron tick retries (the handler keeps returning DONE there). — **Reversibility:** costly — it changes the outcome the bridge `sync_strategy_analytics_status` sees on a live path for every live-API strategy.
- `EXPECTED_INERT_SITES` in `tests/test_computation_error_provenance_census.py` stays as it is (the payload stays unstamped).
- The 161.1 F1 remedy is NOT copied as-is (TODOS entry caution: `sync_trades` is not in the bridge's `is_protected` kind list, so an unconditional FAILED lands on loud branch (b)).
- Gate: a test drives the failed enqueue through the bridge and asserts the stored status and error for both cases (nothing published -> failed with the curated sentence; published -> publish state preserved), RED before the fix.

### ERRC-02: total benchmark source failure (founder ruling 2026-11-25)
- New constant `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"` in `analytics-service/routers/portfolio.py`, written on the `(None, True)` exit of `get_benchmark_returns` (no price source and no recent cached day), distinct from `BENCHMARK_NOTE_STALE`.
- The page renders it in the muted treatment, not amber. A test drives both exits and tells them apart.

### ERRC-01: "contact support" copy (founder ruling 2026-11-25: plan stands)
- Replace "contact support" with "use the contact form" (the Phase 164.6.6.3.5 wording) in every `computation_error_copy` arm (by migration) and in the five Python strings: `services/exchange.py` VALIDATION_UNEXPECTED, `services/csv_validator.py`, `services/job_worker.py` (two), `routers/portfolio.py` `_fail_vr`. — **Reversibility:** one-way — the SQL arms change by migration that auto-applies to PROD.
- The SQL ELSE arm becomes byte-equal to csv-finalize's `ENQUEUE_LOST_RACE_USER_COPY` ("Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists."); `csv-finalize/route.test.ts` reads the SQL arm instead of the hand-typed oracle.
- Permanent arm: "Analytics could not complete for this strategy, and retrying alone will not resolve it. Use the contact form if you need this strategy computed."
- `job_worker.py` "or contact support to raise the limit" becomes "use the contact form to ask for a higher limit".
- Every census the migration moves (schema snapshot `supabase/schema/functions/computation_error_copy.sql`, mutation floors, pins, parity SQL tests) moves in the same PR; migration-reviewer and rls-policy-auditor clean before merge.

### Write scope (symbol-limited; 232 OKXTRADES and 240 CONNECTTRUTH have merged)
- `job_worker.py`: only the enqueue-failure block at the tail of `run_sync_trades_job` and the two copy strings. Not the Phase-1 store, the phase2 flag block, cursor read or `advance_fetched_cursor`.
- `csv_validator.py`: only the one copy string. `routers/portfolio.py`: the benchmark note block in `_compute_portfolio_analytics`, the constants, and `_fail_vr` copy.

### Migration lane
- The migration PR queues behind 225's PR-3. Stop before opening the PR and before any push.

### Claude's Discretion
- How the "nothing published" check is read (one select on `strategy_analytics.computation_status` before the mark), test file layout, and frontend file holding the muted rule.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `get_benchmark_returns` (`services/benchmark.py`) already distinguishes the `(None, True)` exit.
- `BENCHMARK_NOTE_*` constants at `routers/portfolio.py:110-112`; note written at ~1047, `stale` flag at ~1077/1101.
- `_mark_analytics_failed` in `run_sync_trades_job` (~line 2954) already writes the failed row.

### Established Patterns
- SQL copy parity tests strip comments from `pg_get_functiondef` (`test_compute_jobs_error_kind_copy_parity.sql`); the stripper canary token must stay.
- Before CREATE OR REPLACE, re-base on the latest definition across all migrations.

### Integration Points
- Bridge `supabase/schema/functions/sync_strategy_analytics_status.sql` (branches b, b-prime, c; `is_protected`).
- `main_worker.py` maps DONE -> `mark_compute_job_done`, FAILED -> `mark_compute_job_failed`.
- Frontend benchmark note consumers: `src/lib/portfolio-analytics-adapter.ts`, ScenarioComposer, factsheet PDF routes.

</code_context>

<specifics>
## Specific Ideas

Wording is fixed by the founder rulings above; use it verbatim.

</specifics>

<deferred>
## Deferred Ideas

- The four 232 OKXTRADES leftovers in `run_sync_trades_job` (first-sync timeout losing daily P&L / Phase-1 store order; Phase-1 store under refusal flags; `daily_pnl_*` flags never cleared; drained flags never reaching `data_quality_flags`) are out of 222's goal. Founder 2026-11-25: booked as ONE new v1.22 phase, Depends on 222.

</deferred>
