---
phase: 125-worker-dedicated-backfill-worker-retention-hygiene
plan: 04
subsystem: infra-runbook
status: complete
autonomous: false
requirements: [WORKER-01, WORKER-03]
tags: [runbook, railway, worker-topology, pg_cron, go-live, human_needed]
completed: 2026-07-19
requires:
  - "123-02 WORKER_CLAIM_ROLE + kind-filtered claim RPC (landed, prod-applied)"
  - "125-01 retention_compute_jobs_orphaned_running purge migration (landed)"
  - "125-03 purge migration MCP-applied to TEST + one-time cleanup (done)"
provides:
  - "Founder-executable runbook: dashboard env contract, Step 0 topology-confirm, Phase-125 retention/ordering additions"
affects:
  - "docs/runbooks/flipretry-derived-equity-go-live.md"
tech-stack:
  added: []
  patterns: ["dashboard env contract (not committed railway.worker.toml)", "distinct Railway service per role (not replicas)"]
key-files:
  created: []
  modified:
    - "docs/runbooks/flipretry-derived-equity-go-live.md"
decisions:
  - "The interactive/backfill split is a documented DASHBOARD ENV CONTRACT, not a committed railway.worker.toml — a second toml cannot bind itself to a Railway service; committed config is a one-file follow-up if the founder prefers it."
  - "WORKER-01 cutover leg: executable-now by the founder, recorded OPEN (not run in this session — LIVE prod op, no repo mechanism executes it)."
  - "WORKER-03 reschedule leg: OPEN, gated on runbook Step 6 preconditions (Steps 1-5 green = pilot/E2/backfill, Phase 127/129 territory) — EXPECTED to remain human_needed-OPEN at phase close (123-03 precedent)."
metrics:
  duration: "~15 min"
  tasks_completed: 1
  tasks_open_human_needed: 1
  files_modified: 1
  commits: 1
---

# Phase 125 Plan 04: Dedicated backfill worker cutover + cron-reschedule runbook Summary

Extended the FLIPRETRY go-live runbook in place with the Phase-125 dedicated-worker
env contract, a Step 0 topology-confirm gate, and the retention/ordering additions —
modeling WORKER-01 (Railway two-service cutover) and WORKER-03 (LIVE cron reschedule)
as founder LIVE legs, both recorded OPEN with evidence and never claimed done.

## Resolved runbook path

The runbook exists at the expected path — **`docs/runbooks/flipretry-derived-equity-go-live.md`**
(no search fallback needed). Extended IN PLACE; Steps 1–8 remain in original order
(new content is a Step 0 precondition item, a Step 1 env-contract block, and a new
"Phase 125 retention hygiene" subsection between Step 5 and Step 6).

## Task 1 — Runbook extended (auto) ✅ — commit `1f50b60b`

Surgical additions only (`1 file changed, 28 insertions(+), 2 deletions(-)`; the 2
deletions are the terse original Step 1 opening + env bullet, replaced by the env-contract
table — both inside Step 1, NOT Step 6):

1. **Preconditions (Step 0) — topology-confirm item + env-contract decision.**
   Founder confirms on the Railway dashboard whether the API + durable worker run as
   ONE combined service or TWO in `quantalyze-analytics` / `production`, and names the
   exact service that takes `WORKER_CLAIM_ROLE=interactive` (RESEARCH Open Q1/A2 — the
   CLI shows one linked service; the split may be dashboard-only). Records the decision:
   the split is a documented DASHBOARD ENV CONTRACT, not a committed
   `analytics-service/railway.worker.toml` (a second toml can't bind itself to a service);
   the committed-config alternative is a one-file follow-up if the founder prefers it.

2. **Step 1 — explicit backfill-service env contract block.** A table pinning: same
   repo/image; **CMD override `python -m main_worker`**; `WORKER_CLAIM_ROLE=backfill`;
   `SUPABASE_SERVICE_KEY` (**NOT** `SUPABASE_SERVICE_ROLE_KEY`); the same DB/exchange env
   the prod worker carries; optional `WORKER_HEARTBEAT_INTERVAL_S` validated in `(0, 90)`;
   healthz on `PORT` (default 8080). Plus the **Railway REPLICAS cannot carry distinct
   roles** fact (a distinct SERVICE is required — RESEARCH Pitfall 5) and the fail-loud
   guarantees: a typo'd role raises a LOUD `ValueError` at startup (`_validate_claim_role`),
   and a backfill worker on a legacy 2-arg claim REFUSES rather than claiming out-of-role
   (`claim_rpc_fallback_backfill_refused`, safety net since `20260719073701` is prod-applied).

3. **New "Phase 125 retention hygiene" subsection (between Step 5 and Step 6).** Names
   `retention_compute_jobs_orphaned_running` (pg_cron `15 4 * * *` / 04:15 UTC, before the
   05:30 UTC derive cron; DELETE `running` older than `interval '2 hours'`), records it as
   a MIGRATION (`20260719120000`) safe on both projects (2h ≈ 3× the 40-min max watchdog),
   MCP-applied to TEST `qmnijlgmdhviwzwfyzlc` first per plan 125-03, auto-applies to prod at
   merge (founder watches); the one-time TEST cleanup (`DELETE ... running AND created_at <
   now() - interval '1 hour'`); and the explicit founder op ordering — **purge migration
   merges → cutover Steps 1–2 → pilot/E2/full backfill (Steps 3–5) → Step 6 cron reschedule
   LAST**. It contrasts in one line WHY the purge is a migration but the reschedule is not
   (the purge has no worker-readiness dependency; the reschedule re-wedges prod if the worker
   deploy is skipped).

**Verification (automated grep gate — PASS):** `WORKER_CLAIM_ROLE=backfill`,
`WORKER_CLAIM_ROLE=interactive`, `replicas` (i), `retention_compute_jobs_orphaned_running`,
`SUPABASE_SERVICE_KEY`, `NOT a migration` (i), `python -m main_worker` all present.

**Step 6 byte-unchanged:** `git diff` shows ZERO deletions in Step 6 (all changes are pure
additions surrounding it); the two deletions are both inside Step 1. `git diff --name-only`
shows ONLY `docs/runbooks/flipretry-derived-equity-go-live.md`. WORKER-03's
not-a-migration invariant is preserved verbatim.

## Task 2 — Founder LIVE ops checkpoint (autonomous disposition) — recorded per-leg

This plan is `autonomous: false`; Task 2 is a blocking human-verify for founder LIVE
Railway/SQL ops. Neither leg can be executed from the repo (they are runtime state), and
per the critical-notes constraint they must NOT be run here. Autonomous-mode disposition
(founder standing directive: take decisions, keep gates + fail-loud, don't stall the
campaign; 123-03 + 125-03 precedent): record both legs transparently as `human_needed`,
carry them forward, claim nothing done.

### WORKER-01 — dedicated-worker cutover leg: **OPEN (executable now)**
- **State:** OPEN. The runbook (Steps 0–2, as extended) makes the cutover founder-executable
  end-to-end: Step 0 topology-confirm → Step 1 stand up the second `backfill` service
  (healthz 200, role logs, claims nothing while no backfill jobs exist) → Step 2 flip the
  existing worker to `interactive` and redeploy (verify commitHash + `/health`; Railway skips
  deploys on red main CI). Abort path: `WORKER_CLAIM_ROLE=all` on the existing worker restores
  single-worker behavior.
- **Evidence required to close:** founder reply "cutover done" with both services' healthz 200,
  interactive logs showing `p_kind_exclude=BACKFILL_KINDS`, backfill logs showing
  `p_kind_include=BACKFILL_KINDS`.
- **NOT claimed done** — no LIVE Railway op was taken in this session.

### WORKER-03 — cron reschedule leg: **OPEN (gated, expected)**
- **State:** OPEN and gated on runbook Step 6 preconditions (Steps 1–5 green — pilot / LIVE E2
  exit 0 / full backfill, i.e. Phase 127/129 gates). `cron.schedule('derive-allocator-key-dailies',
  '30 5 * * *')` remains a founder LIVE SQL op, NEVER a migration.
- **Evidence required to close:** founder reply "cutover done + rescheduled" with the
  `SELECT jobname, schedule, active FROM cron.job WHERE jobname='derive-allocator-key-dailies';`
  output showing `30 5 * * *`.
- **EXPECTED to remain OPEN at phase close** (123-03 precedent) — its preconditions are
  downstream-phase territory. NOT claimed done.

## Deviations from Plan

None — plan executed exactly as written. Task 1 additions match the plan's three-part action;
Task 2 recorded both LIVE legs OPEN with evidence per the plan's per-leg acceptance criteria.

## No prod ops taken

Zero LIVE Railway or SQL ops were executed in this session. The founder legs are modeled in
the runbook and surfaced for action; neither is silently claimed done.

## Self-Check: PASSED
- FOUND: `docs/runbooks/flipretry-derived-equity-go-live.md` (modified, grep gate PASS)
- FOUND: commit `1f50b60b` (`docs(125-04): extend go-live runbook ...`)
- `git diff --name-only` scoped to the runbook only; Step 6 byte-unchanged (zero deletions).
