# Phase 123: FLIPRETRY — derived-allocator-equity FLIP retry (root-caused) - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning
**Mode:** Autonomous (prod-critical worker refactor; the v1.11 rollback root cause is the spec)

<domain>
## Phase Boundary

Retry the v1.11-close FLIP (derived allocator-equity curve replaces the legacy basis) that was
ROLLED BACK after it wedged the sequential prod worker on a slow live exchange crawl — this time
ROOT-CAUSED so it can never wedge again, and gated on ground-truth before any curve shows.

In scope (FLIPRETRY-01..04):
- **01:** Each derived-equity exchange crawl bounded by a hard `asyncio.wait_for` per-crawl timeout,
  so a slow/hanging crawl (deribit native ledger ~inception; bybit 19k rows) can NEVER block the
  worker event loop. The crawls live in `equity_reconstruction.py` `run_reconstruct_allocator_history_job`
  (:2070, full backfill) + `run_refresh_allocator_equity_daily_job` (:2367, daily delta).
- **02:** The key-mode derived-equity BACKFILL runs BATCHED / off-hours on its OWN worker (NEVER the
  sequential prod worker's dispatch loop), re-scheduled via `cron.schedule('derive-allocator-key-dailies','30 5 * * *')`.
- **03 ⚠️:** After backfill, the derived curve passes `E2_GROUND_TRUTH_*` anchor-consistency
  validation (`scripts/e2_allocator_ground_truth.py`) BEFORE it is ever shown; the data-driven flip
  `extractTrustworthyDerivedCurve` (`src/lib/queries.ts:2379`) → `equityCurveSource` shows "derived"
  ONLY when trustworthy, ELSE "legacy". (Live E2 run + prod backfill enqueue = FOUNDER-gated.)
- **04:** Worker health/liveness preserved throughout backfill (healthz never stale past the
  restart threshold — `main_worker.py` watchdog); the enqueue is SAFE TO RE-RUN + a documented
  ROLLBACK (delete jobs + empty `allocator_equity_derived` + unschedule cron — the exact recovery
  that was executed at v1.11 close).
- ⭐ ALSO owns the phase-120 F5 fold: the sFOX active-account transactions crawl deterministically
  times out on the sequential worker (1 req/10s × >30 pages > 300s). FLIPRETRY-02's batched-worker +
  the FLIPRETRY-01 hard-timeout pattern is the home for that crawl too (or at minimum the same
  timeout-bound + batched-enqueue discipline applied to the sFOX reconstruction crawl).

Out of scope: the sFOX spine (118–122, code-complete); the deribit `correction` classification (124).
</domain>

<decisions>
## Implementation Decisions

### The v1.11 rollback root cause IS the spec (from STATE carry-forward)
- What happened: `phase35_backfill_enqueue` (24 keys) wedged the SEQUENTIAL prod worker — a slow/
  hanging live exchange crawl blocked the event loop on an `await` → healthz stale 12 min, the 90s
  auto-restart didn't fire. Recovery: deleted flip jobs, emptied `allocator_equity_derived` (0 curves
  ever shown), unscheduled `derive-allocator-key-dailies` cron. Derived path DORMANT on legacy.
- So the fix is THREE-fold and ALL must land: (01) the crawl can't hang the loop (hard wait_for);
  (02) the backfill runs off the sequential worker's loop (own batched worker / off-hours cron);
  (04) health is preserved + the enqueue is re-runnable with the documented rollback.

### FLIPRETRY-01 — hard per-crawl timeout
- Wrap EACH exchange crawl inside `run_reconstruct_allocator_history_job` + `run_refresh_allocator_equity_daily_job`
  in `asyncio.wait_for(<crawl>, timeout=<bound>)`. TimeoutError → a TRANSIENT/retryable disposition
  that fails the JOB cleanly (terminal or bounded-retry), NEVER an unbounded await. The per-kind
  handler timeout already exists (`job_worker.py:292` refresh=3min) — but that's the WATCHDOG (reclaims
  a stuck ROW); it does NOT unblock the event loop mid-await. The wait_for is the event-loop guard.
- Mirror the sFOX FLIPRETRY-01 pattern already applied in phase 120 (the sfox crawl wait_for).

### FLIPRETRY-02 — batched, off the sequential worker
- The backfill (the mass re-derive across keys) must NOT run inline on the sequential prod worker.
  Options (research picks): a dedicated batched worker process / a separate queue / off-hours cron
  that processes a bounded batch per tick so no single tick blocks. Re-schedule the cron
  `derive-allocator-key-dailies` at `'30 5 * * *'` (off-hours).
- ⚠️ The cron was UNSCHEDULED at v1.11 recovery — re-scheduling it is part of this phase, but ONLY
  once 01/02/04 make it safe.

### FLIPRETRY-03 — ground-truth gate before the flip (founder-gated live leg)
- The flip is DATA-DRIVEN (no feature flag): `extractTrustworthyDerivedCurve` returns a derived curve
  ONLY when trustworthy; else legacy. "Trustworthy" must incorporate the `E2_GROUND_TRUTH_*`
  anchor-consistency validation (`e2_allocator_ground_truth.py`). The committed harness + a
  fixture/anchor test carry CI; the LIVE E2 run (needs `E2_GROUND_TRUTH_*` env — a read-only key in
  Railway) + the prod backfill enqueue are FOUNDER-gated (human_needed), never faked.

### FLIPRETRY-04 — health + re-runnable + rollback
- healthz must never go stale past the restart threshold during backfill (the wait_for + batched
  worker guarantee this — prove it). The enqueue is idempotent/safe-to-re-run. Document the ROLLBACK
  explicitly (delete jobs + `TRUNCATE/DELETE allocator_equity_derived` + unschedule the cron) —
  the same recovery executed at v1.11 close.

### ⚠️ SCOPE CORRECTION (research 2026-07-19 — verified source; supersedes the CONTEXT-named path)
- The load-bearing crawls are in `run_derive_broker_dailies_job` (job_worker.py), NOT the
  equity_reconstruction path: `build_deribit_native_ledger` (:2319, UNWRAPPED) + the ccxt
  `fetch_ccxt_transfers` branch (:2880, UNWRAPPED). The sFOX branch (:2662) is ALREADY
  `asyncio.wait_for(300s)` (phase 120) → mirror it exactly, `TimeoutError → error_kind="transient"`.
  The `derive-allocator-key-dailies` cron (migration 20260717233529 STEP 5) fans out
  `derive_broker_dailies`, so this IS the flip's crawl path. Wrap BOTH unwrapped sites.
- **KEY INSIGHT (why wait_for alone is insufficient):** the worker is a SINGLE event loop;
  `dispatch_tick` claims a BATCH of 5 and runs them SEQUENTIALLY (`for job in jobs: await dispatch`),
  refreshing healthz `LAST_TICK_AT` only ONCE per tick at claim (STALE_THRESHOLD=90s). Even with each
  crawl bounded at 300s, 5 sequential bounded crawls = 25 min → healthz stale. AND `wait_for` cannot
  cancel a NON-YIELDING await. So FLIPRETRY-02's DEDICATED batched worker (claiming ONLY the backfill
  kinds via a kind-filtered claim) is the STRUCTURAL fix that keeps the PROD worker's healthz fresh —
  wait_for(01) bounds each crawl; the dedicated worker(02) isolates the blast radius. BOTH required.
- FLIPRETRY-03 needs NO new TS: `extractTrustworthyDerivedCurve` already gates on the persisted
  `is_trustworthy` flag written by `compose_allocator_equity`; `e2_allocator_ground_truth.py` is the
  founder-gated INDEPENDENT (P115) confirmation that the flag is EARNED. The gate = ensure
  `is_trustworthy` is only set when the E2 anchor-consistency passes.
- The sFOX-F5 crawl rides the FLIPRETRY-02 dedicated worker FOR FREE (same `derive_broker_dailies` kind).

### Claude's Discretion
- The exact wait_for bound per crawl (mirror sfox 300s); the dedicated-worker claim mechanism
  (kind-EXCLUDE on the prod claim RPC + a kind-INCLUDE claim for the backfill worker vs a separate queue).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/equity_reconstruction.py` — `run_reconstruct_allocator_history_job` (:2070),
  `run_refresh_allocator_equity_daily_job` (:2367), `_allocator_key_preflight`. The crawls to wrap.
- `analytics-service/services/allocator_equity_compose.py` — the compose path.
- `src/lib/queries.ts:2379` `extractTrustworthyDerivedCurve` → `equityCurveSource` (:2515) — the flip.
- `analytics-service/scripts/e2_allocator_ground_truth.py` + `tests/test_e2_ground_truth_harness.py` — the E2 harness.
- `analytics-service/main_worker.py` — the watchdog/healthz (per-kind timeout table :112; the liveness loop).
- `analytics-service/services/job_worker.py:292` — per-kind handler timeouts; :6637 dispatch.
- The sFOX FLIPRETRY-01 wait_for pattern (phase 120, job_worker.py sfox branch) — mirror it.

### Established Patterns
- The wait_for-per-crawl guard vs the watchdog-reclaims-row — two different mechanisms (event-loop vs row).
- Cron via `cron.schedule` (pg_cron / Supabase); Railway worker one-offs via `railway ssh`.
- Money-math: P115 (E2 anchor oracle must be independent); fail-loud; no invented data.

### Integration Points
- `extractTrustworthyDerivedCurve` is the SINGLE display flip — derived-if-trustworthy-ELSE-legacy
  keeps prod safe pre-backfill (a dormant derived path renders legacy today).
- The cron re-schedule + the prod backfill enqueue are the founder-gated go-live ops.
</code_context>

<specifics>
## Specific Ideas

- The v1.11 recovery is the rollback runbook — reuse it verbatim as the FLIPRETRY-04 documented rollback.
- `allocator_equity_derived` is currently EMPTY (emptied at recovery) — the backfill repopulates it;
  0 curves have ever been shown, so the flip is safe until the ground-truth gate passes.

</specifics>

<deferred>
## Deferred Ideas

- The LIVE E2_GROUND_TRUTH run + the prod backfill enqueue + the cron re-schedule (founder ops).
- The deribit `correction` classification (124).
</deferred>
