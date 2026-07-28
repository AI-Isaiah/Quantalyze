# Phase 125: WORKER — dedicated backfill worker + retention hygiene - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss skipped)

<domain>
## Phase Boundary

A derived-equity backfill can NEVER wedge live analytics — it runs bounded,
batched, off-hours, on its OWN worker — and the test-DB `compute_jobs`
pollution flake is killed at its root.

This phase **deploys and proves live** the worker-isolation split whose
building blocks already landed as v1.12 groundwork (123-01 `asyncio.wait_for`
crawl bounds, 123-02 kind-filtered claim RPC `20260719073701`, and the
`WORKER_CLAIM_ROLE` scope guard). It does NOT re-implement those. It ADDS:
retention hygiene (orphaned `running` job purge), the off-hours cron reschedule
runbook, and the end-to-end proof that a slow backfill cannot block the live
loop. Scope is worker deployment topology, retention, and CI-flake removal —
no user-facing surface.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure
infrastructure phase (worker deployment, retention scheduling, CI-flake
removal). Use the ROADMAP success criteria (WORKER-01..04), the v1.12
groundwork already in `analytics-service/main_worker.py`, and existing
Railway/Supabase conventions to guide decisions. Fail-loud is mandatory (match
the existing `_validate_claim_role` LOUD ValueError pattern).

Founder-run LIVE ops are modeled as `human_needed` verification legs — code +
tests land without them; a skipped op is NEVER claimed done:
- **WORKER-03 cron reschedule** — `cron.schedule('derive-allocator-key-dailies',
  '30 5 * * *')` is a founder LIVE SQL op with a written runbook step, NOT a
  migration (auto-apply + a skipped worker deploy would re-wedge prod).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (v1.12 groundwork — deploy/prove, don't rebuild)
- `analytics-service/main_worker.py` — `WORKER_CLAIM_ROLE` + `_validate_claim_role()`
  (loud ValueError on invalid role), `BACKFILL_KINDS = {derive_broker_dailies,
  derive_allocator_equity}`, role-aware claim scope (FLIPRETRY-02), per-crawl
  `asyncio.wait_for` bounds, per-kind stale watchdog, `LAST_TICK_AT`/healthz.
- `analytics-service/main_worker_healthz.py` — healthz liveness endpoint.
- `supabase/migrations/20260719073701_claim_kind_filter.sql` — kind-filtered
  claim RPC (prod-applied); the interactive worker excludes BACKFILL_KINDS, the
  dedicated worker claims ONLY them.
- `analytics-service/routers/cron.py` — cron fan-out (`derive_broker_dailies`
  → follow-on `derive_allocator_equity`); `derive-allocator-key-dailies` schedule.

### Established Patterns
- Worker deploy on Railway (`analytics-service/railway.toml`, `Dockerfile`);
  Railway silently SKIPS deploys on red main CI — verify commitHash + `/health`.
- Retention/reap patterns: check existing stale-`running` handling in
  `services/job_worker` + the per-kind watchdog before adding a purge.
- Supabase migrations under `supabase/migrations/**` auto-apply to PROD on
  merge to main; env split prod=khslejtfbuezsmvmtsdn / test=qmnijlgmdhviwzwfyzlc.
- Concurrent-CI `python` fence-test flake is re-polluted daily by the
  `derive-allocator-key-dailies` cron running against the WORKERLESS test project
  — retention purge (test nightly + prod safety sweep) is the root-cause fix.

### Integration Points
- New dedicated backfill worker service on Railway (separate from the sequential
  interactive worker) claiming via `WORKER_CLAIM_ROLE`.
- Retention purge job (test nightly + prod safety sweep) for orphaned `running`
  `compute_jobs`.
- Runbook doc for the founder LIVE cron reschedule SQL op.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP success
criteria WORKER-01..04 and the v1.12 groundwork.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase, scope stayed within worker/retention/CI-flake.

</deferred>
