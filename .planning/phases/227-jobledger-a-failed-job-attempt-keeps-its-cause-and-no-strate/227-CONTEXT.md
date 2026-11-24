# Phase 227: JOBLEDGER — a failed job attempt keeps its cause, and no strategy is stranded by a dropped, reset or reclaimed job - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Seam S3 (the compute-job lifecycle) stops hiding failures. Six requirements: MT5D-01 (per-attempt failure record), HEAL-01 (dropped first `sync_trades` enqueue after finalize-wizard), HEAL-02 (a `derive_allocator_equity` job behind slow batch-mates is never reset and run twice), HEAL-03 (readmit ceiling emits a readable signal), HEAL-04 (reclaim keeps its curated error sentence and the strategy's analytics status follows), HEAL-05 (daily positions poll covers private strategies; the `poll_positions` enqueue stays live). Migrations re-base on the latest bodies at HEAD: the claim pair in `20260927120000_claim_pair_pre_rank_exclusion.sql` (every self-verify clause kept and carried forward), `reclaim_stuck_compute_jobs`, the sweep command in `20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql`, and `enqueue_poll_positions_for_all_strategies`. Raising retries or a watchdog threshold is not a close. Out of scope: anything 231 DEAD-02 owns beyond re-basing on these bodies.

</domain>

<decisions>
## Implementation Decisions

### HEAL-03 readmit ceiling signal (founder ruling 2026-11-23)
- Both: a durable row that outlives the job rows' retention, plus a page through the existing `ops_alert` channel (`analytics-service/services/ops_alert.py`, `page`). The ceiling is enforced in the pg_cron SQL sweep, so the SQL writes the durable row and a Python reader pages from it (planner sizes the reader; it must never raise, per the `ops_alert` contract). — **Reversibility:** one-way — a new persisted table or audit row class, plus a new `ops_alert` source/event that `src/lib/ops-alert-contract.ts` must mirror (parity test).

### HEAL-01 dropped first sync_trades enqueue (founder ruling 2026-11-23)
- Auto re-enqueue by a sweep of its own (not a second predicate on `reconcile_dropped_enqueue_sweep`): key present, the strategy never synced and no job ever, and a grace period longer than 1 hour. A named state shows only if that retry also fails. A healthy new strategy must not be caught. The named state's user-visible wording is decided at plan time. — **Reversibility:** costly — a new pg_cron job and a new strategy-visible state that the UI and status readers depend on.

### MT5D-01 per-attempt failure record (founder ruling 2026-11-23)
- New append-only table, one row per failed attempt: job id, attempt number, cause class (a real error vs a stall reset vs a watchdog reset), error text. Written before the M-1137 `last_error` clear on re-claim, which stays and stays pinned. Survives job-row pruning, because 230 MT5NIGHTLY reads real nights of these records. — **Reversibility:** one-way — persisted schema written by the claim/reclaim RPCs and read by Phase 230.

### Claude's Discretion
- HEAL-02 lease or heartbeat design (research first), HEAL-04 reclaim provenance mechanics, HEAL-05 cohort widening shape, the exact table and column names, test lanes and arm layout are the researcher's and planner's call, within PROOF-01 (RED-UNDER twins, RED-UNDER-SETUP listing, neuter/RED/byte-restore/GREEN recorded verbatim).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/ops_alert.py` `page`: the one ops-alert channel (log, deduplicated Sentry capture, best-effort founder email via `/api/cron/ops-alert`); never raises. Its source/event/cause sets are mirrored in `src/lib/ops-alert-contract.ts`.
- `audit_log` table exists; `compute_job_dedup_events` is a precedent for an append-only job-side event table.

### Established Patterns
- Migrations self-verify and RAISE EXCEPTION on failure (fail loud, never a silent skip); pg_cron presence is asserted.
- Before CREATE OR REPLACE, re-base on the latest definition across all migrations.
- New data-reading DO-block guards are refused by `scripts/lint-migration-data-dependence.mjs`.

### Integration Points
- Claim pair and `reclaim_stuck_compute_jobs` RPCs (attempt record write point); `reconcile_dropped_enqueue_sweep` (ceiling signal); `enqueue_poll_positions_for_all_strategies` (HEAL-05); `analytics-service/services/job_worker.py` (failure paths).

</code_context>

<specifics>
## Specific Ideas

- The durable signal and the attempt record must outlive the job rows' 90-day retention.
- This deploy starts the clock for 230 MT5NIGHTLY.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
