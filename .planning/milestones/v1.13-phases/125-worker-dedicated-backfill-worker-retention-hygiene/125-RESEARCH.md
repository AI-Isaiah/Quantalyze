# Phase 125: WORKER — dedicated backfill worker + retention hygiene - Research

**Researched:** 2026-07-19
**Domain:** Railway multi-service worker topology · Supabase pg_cron retention · asyncio worker isolation · CI-flake root-cause removal
**Confidence:** HIGH (all findings grounded in the actual repo — landed v1.12 code, the pg_cron migration, the flake root-cause memory, existing retention-cron house style, and live Railway topology)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **All implementation choices are at Claude's discretion** — pure infrastructure phase (worker deployment, retention scheduling, CI-flake removal). Use ROADMAP success criteria (WORKER-01..04), the v1.12 groundwork already in `analytics-service/main_worker.py`, and existing Railway/Supabase conventions.
- **Fail-loud is mandatory** — match the existing `_validate_claim_role` LOUD `ValueError` pattern.
- **WORKER-03 cron reschedule is a founder LIVE SQL op, NOT a migration.** `cron.schedule('derive-allocator-key-dailies', '30 5 * * *')` must be executed live with a written runbook step. Reason: a migration auto-applies to prod on merge; if the dedicated worker deploy is skipped (Railway silently skips on red main CI), the cron would enqueue backfill jobs nothing can claim → re-wedge prod. Modeled as a `human_needed` verification leg — code + tests land without it; a skipped op is NEVER claimed done.

### Claude's Discretion
- Everything else. This phase DEPLOYS/PROVES v1.12 groundwork; it does NOT re-implement it.

### Deferred Ideas (OUT OF SCOPE)
- None — infrastructure phase; scope stayed within worker deployment / retention / CI-flake.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WORKER-01 | Derived-equity backfill runs on its OWN dedicated worker, never the sequential prod worker's event loop (`WORKER_CLAIM_ROLE` + kind-filtered claim RPC `20260719073701`). | Both building blocks LANDED. This phase = deploy a SECOND Railway service running `python -m main_worker` with `WORKER_CLAIM_ROLE=backfill`, flip the existing worker to `WORKER_CLAIM_ROLE=interactive`. See Architecture Pattern 1 + Runtime State Inventory. |
| WORKER-02 🧱 | Every derived-equity crawl hard-bounded by `asyncio.wait_for` (landed v1.12 123-01), proven END-TO-END so a deliberately-hung crawl times out and the worker stays live; per-job `LAST_TICK_AT` refresh keeps healthz honest through long backfills. | Unit coverage exists in `test_main_worker.py` (heartbeat) + `job_worker.py` per-crawl `wait_for`. Gap = an END-TO-END proof that runs the real dispatch loop + heartbeat + healthz server together. See Pattern 2 + Validation Architecture. |
| WORKER-03 | Key-mode backfill runs batched/off-hours; cron re-scheduled `('derive-allocator-key-dailies','30 5 * * *')` as a founder LIVE op (NOT a migration). | Cron was UNSCHEDULED on prod during the v1.11 rollback. Re-scheduling is a founder LIVE SQL op gated on the dedicated worker being live. Runbook step required. See Pattern 4 + Pitfall 1. |
| WORKER-04 | Orphaned `running` compute_jobs purged on a retention schedule (test nightly + prod safety sweep), killing the recurring `python` fence-test CI flake at its root. | Root cause fully characterized (memory `project_shared_testdb_concurrent_ci_flake`). Fix = a new pg_cron retention purge of orphaned `running` rows, matching the `retention_compute_jobs_failed` house style. This one CAN be a migration (safe on both projects with a conservative window). See Pattern 3 + Pitfall 2. |
</phase_requirements>

## Summary

This is a pure infrastructure phase that DEPLOYS and PROVES the worker-isolation split whose building blocks already landed as v1.12 groundwork. Nothing in `main_worker.py`, the claim RPC, or the crawl bounds needs re-implementation — the phase's work is (a) Railway deployment topology to run a second dedicated backfill worker, (b) an end-to-end proof harness for the wait_for + healthz-during-backfill behavior, (c) a new pg_cron retention purge for orphaned `running` compute_jobs, and (d) a runbook for the founder LIVE cron reschedule.

The single most important structural fact: **the `WORKER_CLAIM_ROLE` default is `"all"`, which is byte-identical to today's prod behavior.** Merging code changes NchangesO prod behavior until the founder cuts over BOTH workers (sets `interactive` on the existing service and stands up a `backfill` service). This mirrors the `SFOX_ENABLED` structural-gate discipline. The kind-filtered claim RPC is already prod-applied. So the "deploy" is a Railway topology change + two env-var sets, not a code migration.

The CI-flake root cause is precisely known: the `derive-allocator-key-dailies` cron (jobid 9, `30 5 * * *`) is ACTIVE on the WORKERLESS test project and enqueues `derive_broker_dailies` jobs daily. CI `pytest` runs claim them to `running` and never finish → they accumulate (920 `running` + 834 `failed_final` found 2026-07-19). The claim RPC's partition-dedupe (`x.status IN ('running','done_pending_children')` NOT-EXISTS arms) then excludes a fence test's freshly-seeded row whenever a stale `running` row shares its partition → the claim returns 0 rows → `assert claimed is not None` fails probabilistically. The durable fix is a retention purge that DELETEs orphaned `running` rows (NOT a reset-to-pending — that just gets re-claimed to `running` by the next CI run; and NOT an unschedule of the cron — `test_derive_allocator_keys_fanout.sql` assertion 6 requires it to stay registered).

**Primary recommendation:** Land three things as code+tests+migration (all merge-safe, zero prod behavior change): (1) a Railway `railway.worker.toml` / documented second-service config + env-var contract for the `backfill`/`interactive` split; (2) an end-to-end worker proof test; (3) a migration adding a `retention_compute_jobs_orphaned_running` pg_cron job with a window safe on BOTH projects (running rows older than the max watchdog threshold + margin, e.g. `> interval '2 hours'`). Then model TWO founder LIVE ops as `human_needed` legs: the Railway two-worker cutover (WORKER-01 activation) and the cron reschedule (WORKER-03). The retention purge is the ONLY WORKER-04 mechanism that CAN safely be a migration.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Claim scope enforcement (which worker takes which kinds) | Database (SQL claim RPC) | Worker (env `WORKER_CLAIM_ROLE`) | The kind filter lives in `claim_compute_jobs_with_priority` (SQL, prod-applied); the worker only passes `p_kind_include`/`p_kind_exclude`. SQL owns the atomic FOR UPDATE SKIP LOCKED guarantee. |
| Worker isolation (backfill can't wedge live loop) | Railway (service topology) | Worker (role guard) | Structural isolation is a DEPLOYMENT fact — a second service/process. Code can't isolate itself within one event loop. |
| Crawl time-bound | Worker (`asyncio.wait_for` in `job_worker.py`) | — | Per-crawl wall-clock bound; already landed. |
| Healthz liveness through long backfill | Worker (`main_worker_healthz` + heartbeat task) | Railway (`restartPolicyType`) | The per-job/heartbeat `LAST_TICK_AT` refresh keeps the signal honest; Railway acts on the 503. |
| Orphaned-`running` retention purge | Database (pg_cron) | — | Runs where the rows live; matches existing retention-cron pattern. NO Python reaper — the test project has no worker to run one. |
| Watchdog reset (stalled running→pending) | Worker (`reset_stalled_compute_jobs` 60s loop) | — | Requeues live-worker stalls. Does NOT run on the workerless test project — which is exactly why a DB-side purge is needed there. |
| Cron scheduling of the key-mode fan-out | Database (pg_cron) | Founder (LIVE op) | Reschedule is prod-runtime state, gated on worker readiness → founder op, not migration. |

## Standard Stack

No new packages are installed this phase. It is Railway config + one SQL migration + one Python test, all against already-present dependencies.

### Core (already in the codebase — verified from repo)
| Component | Version | Purpose | Source |
|-----------|---------|---------|--------|
| Railway (Docker builder) | platform | Runs the worker container(s); CMD override `python -m main_worker` | `analytics-service/railway.toml`, `Dockerfile` [VERIFIED: repo] |
| Railway CLI | 4.36.1 | Deploy/redeploy/ssh; founder cutover | `railway --version` [VERIFIED: local] |
| Supabase Postgres + pg_cron | prod=`khslejtfbuezsmvmtsdn` test=`qmnijlgmdhviwzwfyzlc` | Job queue + retention crons; pg_cron confirmed active on test (jobid 9) | migration `20260717233529` + flake memory [VERIFIED: repo/memory] |
| Python | 3.12-slim | Worker runtime | `Dockerfile` `FROM python:3.12-slim` [VERIFIED: repo] |
| asyncio (stdlib) | 3.12 | Dispatch/watchdog/heartbeat loops, `wait_for` bounds, healthz server | `main_worker.py`, `main_worker_healthz.py`, `job_worker.py` [VERIFIED: repo] |
| supabase-py / PostgREST | (pinned in requirements.txt) | RPC calls (claim/mark/reset), `.rpc()` payloads | `main_worker.py` [VERIFIED: repo] |

### Supporting (patterns, not packages)
| Pattern | Where | When to Use |
|---------|-------|-------------|
| pg_cron `cron.schedule`/`cron.unschedule` idempotent re-apply | `20260515210200_retention_crons_high_hardening.sql` | Adding the orphaned-running purge cron |
| `retention_delete_guard` triggers (mig 121) | existing | Backstops any unbounded DELETE in a cron body — the new purge inherits this protection |
| Self-verifying terminal DO block | every migration in this repo | The new migration MUST end with an assertion DO block (house style) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Second Railway *service* | Second *replica* of the same service with a different CMD/env | Railway replicas share the service's env + start command — you cannot give one replica `role=backfill` and another `role=interactive`. A distinct service is required for the env/CMD split. **Recommend a distinct service.** |
| pg_cron DB-side purge | Python reaper loop in the worker | The TEST project has NO worker, so a Python reaper never runs there — the exact place the flake lives. pg_cron runs regardless. **Use pg_cron.** |
| DELETE orphaned running | Reset running→pending (watchdog-style) | Reset just gets re-claimed to `running` by the next CI run → flake persists. Only DELETE removes the partition-collision source. **Use DELETE.** |

**Installation:** None. No `npm`/`pip`/`cargo` install this phase.

## Package Legitimacy Audit

**N/A — this phase installs NO external packages.** Work is Railway configuration + one SQL migration + one Python test against already-vendored dependencies. slopcheck/registry verification not applicable.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────── Supabase Postgres ───────────────────────────┐
                    │                                                                          │
   pg_cron ─────────┼─▶ enqueue_derive_broker_dailies_for_allocator_keys()  (jobid: derive-   │
   'derive-         │       │  fans out 1 derive_broker_dailies / eligible api_key             │
    allocator-      │       ▼                                                                  │
    key-dailies'    │   compute_jobs  (status: pending → running → done/failed)                │
   '30 5 * * *'     │       ▲   ▲                                                              │
                    │       │   │  claim_compute_jobs_with_priority(                           │
                    │       │   │    p_kind_include / p_kind_exclude)   ◀── kind filter (LANDED)│
                    │       │   │                                                              │
   pg_cron ─────────┼─▶ retention_compute_jobs_orphaned_running  (NEW, this phase)             │
   NEW purge cron   │       │      DELETE running WHERE claimed_at < now()-'2h'                 │
                    │       │      (safe on prod: > max watchdog threshold; clears test flake)  │
                    └───────┼──────────────────────────────────────────────────────────────────┘
                            │
          ┌─────────────────┴───────────────────┐
          │                                      │
   ┌──────▼───────────┐              ┌───────────▼────────────┐
   │ INTERACTIVE       │              │ BACKFILL (NEW service) │
   │ worker (existing) │              │ python -m main_worker  │
   │ WORKER_CLAIM_ROLE │              │ WORKER_CLAIM_ROLE=      │
   │  = interactive    │              │   backfill             │
   │ EXCLUDES          │              │ CLAIMS ONLY            │
   │  BACKFILL_KINDS   │              │  BACKFILL_KINDS         │
   │ live loop stays   │              │ per-crawl wait_for +   │
   │ responsive        │              │ heartbeat → healthz OK │
   └──────┬────────────┘              └───────────┬────────────┘
          │ healthz :8080                         │ healthz :8080
          ▼                                        ▼
   Railway restartPolicy (ON_FAILURE, 3×) acts on a genuine 503 only
```

Data-flow trace (primary use case — the FLIP that this unblocks): the `derive-allocator-key-dailies` cron fans out `derive_broker_dailies` jobs → the **backfill** worker (and ONLY it) claims them via the include-filter → each exchange crawl is `wait_for`-bounded → the heartbeat keeps `LAST_TICK_AT` fresh so a legit 30-min backfill never false-stales healthz → a hung crawl times out (transient) and the worker stays live → the interactive worker, excluding those kinds, never touches the backfill and its live loop stays responsive.

### Recommended Project Structure (files touched/added)
```
analytics-service/
├── railway.toml                      # existing API/interactive service config
├── railway.worker.toml   (or docs)   # NEW: backfill-service config OR a documented
│                                      #      dashboard env contract (Railway supports
│                                      #      per-service config file path)
├── main_worker.py                    # LANDED — no change (role guard already present)
├── main_worker_healthz.py            # LANDED — no change
└── tests/
    └── test_worker_isolation_e2e.py  # NEW: end-to-end wait_for + healthz proof
supabase/
├── migrations/
│   └── 20260719XXXXXX_retention_orphaned_running_compute_jobs.sql   # NEW purge cron
└── tests/
    └── test_retention_orphaned_running.sql                          # NEW guard
docs/runbooks/
└── flipretry-derived-equity-go-live.md   # EXTEND with the two-worker cutover +
                                          # the founder LIVE cron-reschedule step
```

### Pattern 1: Dedicated backfill worker via a second Railway service (WORKER-01)
**What:** Run a SECOND Railway service from the SAME Docker image with CMD `python -m main_worker` and `WORKER_CLAIM_ROLE=backfill`; set the EXISTING worker to `WORKER_CLAIM_ROLE=interactive`.
**When to use:** This is the WORKER-01 activation. It is a founder LIVE op (env + service topology), modeled as `human_needed`.
**Key facts (from `main_worker.py`):**
- `WORKER_CLAIM_ROLE` defaults to `"all"` → byte-identical to today until BOTH roles are set. Merging code is safe.
- `_validate_claim_role()` raises a LOUD `ValueError` on any value outside `("all","interactive","backfill")` — a typo'd env fails the worker at startup, never silently mis-scopes. **Preserve/rely on this; do not add a silent default.**
- The Dockerfile already documents the CMD-override: `python -m main_worker` for a worker service; default `uvicorn main:app` for the API.
- Both workers run their own `main_worker_healthz` on `PORT` (default 8080). Railway health-checks each independently.

```bash
# Founder LIVE cutover (runbook step, human_needed):
# 1. Existing worker service:
railway variables --set WORKER_CLAIM_ROLE=interactive   # on the live worker service
# 2. NEW backfill service (same repo/image, CMD override python -m main_worker):
railway variables --set WORKER_CLAIM_ROLE=backfill       # on the new service
# 3. Verify BOTH healthz green + role in logs ("Worker starting as worker-…").
# 4. Confirm the interactive worker's logs show it EXCLUDING BACKFILL_KINDS.
```

**Fallback-path landmine (already handled in code, must be surfaced in the runbook):** if the kind-filter migration were ever absent, a `backfill` worker on the legacy 2-arg claim REFUSES to claim (logs `claim_rpc_fallback_backfill_refused`) rather than take interactive jobs out-of-role. Since `20260719073701` is prod-applied, this is a safety net, not an expected path.

### Pattern 2: End-to-end wait_for + healthz-during-backfill proof (WORKER-02)
**What:** A test that runs the REAL `dispatch_tick` (with its heartbeat task) against a dispatch that (a) hangs past its per-crawl `wait_for` and (b) runs long-but-alive, asserting healthz returns 200 throughout the long-but-alive case and the hung case times out to a transient outcome with the worker still live.
**When to use:** WORKER-02 asks for END-TO-END, not just the existing unit heartbeat test (`test_heartbeat_refreshes_last_tick_during_long_dispatch`).
**Existing coverage to build on (`test_main_worker.py`):** `test_heartbeat_refreshes_last_tick_during_long_dispatch`, `test_heartbeat_cancelled_after_dispatch_no_leak`, `test_empty_claim_still_bumps_healthz_last_tick`. The per-crawl `wait_for` lives in `job_worker.py` (`_BROKER_CRAWL_TIMEOUT_S`, `_SFOX_CRAWL_TIMEOUT_S`, `_DERIVE_OUTER_BUDGET_S=900`).
**Gap:** wire the healthz server + dispatch loop + a genuinely-hung crawl together so the proof exercises the full path, not mocked pieces.

### Pattern 3: Orphaned-`running` retention purge cron (WORKER-04)
**What:** A new pg_cron job `retention_compute_jobs_orphaned_running` that `DELETE`s `status='running'` rows whose `claimed_at` is older than a window safe on BOTH projects. Matches the `retention_compute_jobs_failed` house style (mig `20260515210200`).
**Window choice (critical):** The longest per-kind watchdog threshold is `process_key_long = 40 minutes` (`WATCHDOG_PER_KIND_OVERRIDES`). On PROD the interactive worker's watchdog resets stalled `running`→`pending` at each per-kind threshold, so a `running` row surviving well past 40 min is definitively orphaned (worker down). A window of `interval '2 hours'` is therefore safe on prod (never touches a legit in-flight job) AND clears the test-project pollution (CI-claimed running rows are hours removed from the 05:30 cron). This lets ONE migration serve both "test nightly" and "prod safety sweep" — it does NOT need to be a founder LIVE op (unlike WORKER-03).
**Why DELETE, not reset:** a reset-to-`pending` row gets re-claimed to `running` by the next CI run → the partition-collision flake persists. DELETE removes the collision source. (The memory's manual remedy used `interval '1 hour'`; 2h is the same fix with a prod safety margin.)
**Why NOT unschedule the derive cron:** `test_derive_allocator_keys_fanout.sql` assertion 6 REQUIRES `derive-allocator-key-dailies` to be registered at a safe hour (1-22). Unscheduling reddens the `sql-tests` gate.

### Pattern 4: Founder LIVE cron reschedule, NOT a migration (WORKER-03)
**What:** `cron.schedule('derive-allocator-key-dailies','30 5 * * *')` run as a founder LIVE SQL op AFTER the backfill worker is confirmed live.
**Why LIVE, not migration:** The v1.11 rollback UNSCHEDULED this cron on prod. Re-scheduling via a migration would auto-apply on merge; if Railway skips the worker deploy (red main CI), the cron would enqueue backfill jobs nothing claims → re-wedge. Gating the schedule behind confirmed worker-readiness requires a human step. Note the target schedule `30 5 * * *` already MATCHES what the `20260717233529` migration installed and what the test asserts — so this is a re-assertion on prod, not a schema change.

### Anti-Patterns to Avoid
- **Adding the cron reschedule to a migration** — auto-applies + skipped worker deploy = re-wedge (the whole reason WORKER-03 is a LIVE op).
- **A single combined worker with in-process kind prioritization** — does not isolate the event loop; a non-yielding backfill crawl still freezes live analytics. Isolation must be a separate process/service.
- **Resetting orphaned running rows instead of deleting** — re-claimed to running, flake persists.
- **Unscheduling the derive cron to stop test pollution** — breaks `sql-tests` assertion 6.
- **A Python reaper loop for orphaned rows** — never runs on the workerless test project.
- **Silent default for `WORKER_CLAIM_ROLE`** — violates the fail-loud mandate; keep the LOUD ValueError.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backfill rate limiting | A Python-side token bucket | The SQL claim throttle (`v_high_pending` CASE/EXISTS in the claim RPC) | Already atomic in the claim path; kind-filter is scoped to it too. |
| Orphaned-row reaping | A new Python watchdog thread | pg_cron DELETE cron (house-style) | Runs on the workerless test project where the flake lives; a Python reaper cannot. |
| Kind isolation | An in-process priority queue | The prod-applied `p_kind_include`/`p_kind_exclude` RPC | Landed, tested (`test_claim_kind_filter.sql`), byte-identical when NULL. |
| Healthz liveness during long jobs | A custom liveness ping | The existing heartbeat task + `LAST_TICK_AT` | Landed; only needs an end-to-end proof. |
| Unbounded DELETE safety | A hand-rolled row cap | The existing `retention_delete_guard` trigger (mig 121) | Already protects every retention cron body. |

**Key insight:** Almost everything is already built and prod-applied. The failure mode for this phase is *re-implementing landed groundwork* or *turning a LIVE op into a migration*. The genuinely-new artifact is one retention cron.

## Runtime State Inventory

This phase is fundamentally about RUNTIME STATE (Railway services, pg_cron schedules, orphaned DB rows) that code files do not capture. This inventory is the crux of planning it correctly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (prod) orphaned `running` compute_jobs — the safety-sweep target. (test `qmnijlgmdhviwzwfyzlc`) ~920 `running` + ~834 `failed_final` orphaned rows accumulated from the daily cron (found 2026-07-19). | **Data cleanup (one-time)**: `DELETE FROM compute_jobs WHERE created_at < now() - interval '1 hour'` on the test project to green CI immediately. **Recurring**: the new purge cron (code edit → migration). Both needed. |
| **Live service config** | Railway project `quantalyze-analytics` / env `production` / service `quantalyze-analytics` (confirmed via `railway status`). The `WORKER_CLAIM_ROLE` env is NOT set today (defaults to `"all"`). The interactive/backfill split is service+env config living in the Railway dashboard, NOT in git. | **Founder LIVE ops (human_needed)**: set `WORKER_CLAIM_ROLE=interactive` on the existing worker; stand up a second service with `WORKER_CLAIM_ROLE=backfill`. Confirm exact current service topology on the dashboard (API vs worker service split — see Open Questions). |
| **OS-registered / scheduler state** | pg_cron `derive-allocator-key-dailies` (jobid 9 on test, `30 5 * * *`) — ACTIVE on test, UNSCHEDULED on prod (v1.11 rollback). This is not in git as live state; the migration installed it once. | **Founder LIVE op (WORKER-03)**: `cron.schedule('derive-allocator-key-dailies','30 5 * * *')` on prod, gated on the backfill worker being live. Runbook step. Test keeps its schedule (assertion 6). |
| **Secrets / env vars** | `WORKER_CLAIM_ROLE` (new, string, no secret value); `SUPABASE_SERVICE_KEY` (existing, Python side — note NOT `_ROLE_KEY`); `WORKER_HEARTBEAT_INTERVAL_S` (optional, validated). No new SECRETS — `WORKER_CLAIM_ROLE` is a plain config value. | Set `WORKER_CLAIM_ROLE` per service (founder op). No secret rotation. |
| **Build artifacts / installed packages** | None. Same Docker image serves both workers; no new pip deps; no compiled artifacts. | None — verified: no `requirements` change, no new package. |

**The canonical question — after every repo file is updated, what runtime systems still carry old state?** (1) The prod Railway worker still claims ALL kinds until its env is set to `interactive` and the backfill service exists. (2) The prod `derive-allocator-key-dailies` cron is still UNSCHEDULED until the founder re-schedules it. (3) The test project still holds thousands of orphaned `running` rows until the one-time cleanup + the recurring purge cron run. All three are addressed above; none is a code-file change alone.

## Common Pitfalls

### Pitfall 1: Cron reschedule as a migration re-wedges prod
**What goes wrong:** Putting `cron.schedule('derive-allocator-key-dailies',…)` in a migration auto-applies it to prod on merge. If Railway skips the worker deploy (red main CI), the cron enqueues backfill jobs nothing claims → healthz stale → the exact v1.11 wedge.
**Why it happens:** `supabase/migrations/**` auto-apply to prod; Railway silently skips deploys on red CI (`railway-worker.md` "skipped-deploy gotcha").
**How to avoid:** WORKER-03 is a founder LIVE op, executed AFTER confirming both workers healthy. Never a migration.
**Warning signs:** a migration diff containing `derive-allocator-key-dailies` `cron.schedule`.

### Pitfall 2: Purge window unsafe on prod deletes live in-flight jobs
**What goes wrong:** A retention purge with a short window (e.g. 10 min) would DELETE legitimately-`running` prod jobs mid-crawl (`process_key_long` runs up to 40 min; watchdog threshold 40 min).
**Why it happens:** The SAME migration body applies to prod and test; you can't give test a 1h window and prod a different one from one cron body.
**How to avoid:** Use a single conservative window (`interval '2 hours'`) that exceeds the max watchdog threshold (40 min) with margin — safe on prod, still clears the test flake. Rely on `retention_delete_guard` as a backstop.
**Warning signs:** a window `<= 40 minutes`, or a window that references project identity.

### Pitfall 3: The flake's actual mechanism is partition-dedupe, not raw row count
**What goes wrong:** Assuming "delete old rows" is cosmetic. The flake is that stale `running` rows in a partition make the claim RPC's `x.status IN ('running','done_pending_children')` NOT-EXISTS arms exclude a fence test's freshly-seeded row → claim returns 0 → `assert claimed is not None` fails.
**Why it happens:** `claim_compute_jobs_with_priority` dedupe arms (see `20260719073701` lines 156-179).
**How to avoid:** DELETE the orphaned `running` rows (removes the collision); do NOT reset them to `pending` (re-claimed to running next run).
**Warning signs:** `test_compute_jobs_fencing.py` / `test_drain_semantics.py` failing with a varying count of failures across re-runs.

### Pitfall 4: Reset-to-pending doesn't fix the test flake
**What goes wrong:** Using the watchdog's reset semantics (running→pending) on the test project. The rows go back to pending and the next CI run re-claims them to `running` → collision returns.
**How to avoid:** DELETE (purge), not reset. The watchdog and the purge are different mechanisms with different purposes.

### Pitfall 5: Railway replicas can't carry different roles
**What goes wrong:** Scaling the existing worker to 2 replicas expecting one to be backfill. Replicas share the service's env + CMD, so both would have the same `WORKER_CLAIM_ROLE`.
**How to avoid:** A distinct Railway SERVICE for the backfill worker, with its own env + CMD override.

### Pitfall 6: Test-DB migration must be MCP-applied before the guard test runs
**What goes wrong:** The new retention-cron guard SQL test reddens on the test project because the migration hasn't been applied there yet.
**Why it happens:** `supabase/migrations/**` auto-apply to PROD on merge, but the TEST project must be MCP-applied manually BEFORE the RED-guarded SQL tests run (`project_test_project_catchup_unmasks_stale_tests`).
**How to avoid:** MCP `apply_migration` to `qmnijlgmdhviwzwfyzlc` before merge; gate the SQL test on presence (NOTICE-skip if absent), matching the fan-out test's presence gate.

## Code Examples

### Retention purge cron (matches `retention_compute_jobs_failed` house style)
```sql
-- Source: pattern from supabase/migrations/20260515210200_retention_crons_high_hardening.sql
-- (cron.unschedule-then-schedule idempotent re-apply; retention_delete_guard backstops)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'pg_cron not installed — retention cron cannot be scheduled'
      USING ERRCODE='feature_not_supported';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;
  -- Window > max watchdog threshold (process_key_long = 40 min) + margin.
  -- Safe on PROD (never a live in-flight job) AND clears the workerless
  -- test-project accumulation that flakes the fence tests.
  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '15 4 * * *',   -- daily, before the 05:30 derive cron; hour in the safe 1-22 band
    $cron$
    DELETE FROM compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '2 hours';
    $cron$
  );
  RAISE NOTICE 'Scheduled retention_compute_jobs_orphaned_running (running > 2h)';
END$$;
-- End with a self-verifying DO block asserting the job is registered (house style).
```

### Env-var contract for the two-worker split (documented in railway config / runbook)
```
# Existing worker service (live loop stays responsive):
WORKER_CLAIM_ROLE=interactive     # excludes derive_broker_dailies, derive_allocator_equity

# NEW backfill service (same image, CMD override: python -m main_worker):
WORKER_CLAIM_ROLE=backfill        # claims ONLY those kinds
# Optional, validated in (0, 90): WORKER_HEARTBEAT_INTERVAL_S=30
```

### End-to-end proof skeleton (WORKER-02)
```python
# Source: extends analytics-service/tests/test_main_worker.py heartbeat tests
# Run the real dispatch_tick + heartbeat + healthz server together.
# Case A: dispatch hangs past its per-crawl wait_for -> transient outcome, worker alive.
# Case B: dispatch runs long-but-alive (yielding) -> healthz stays 200 throughout
#         because the heartbeat advances LAST_TICK_AT.
# Assert: healthz TCP endpoint returns 200 during B; the hung crawl in A classifies
# as transient (asyncio.TimeoutError) without crashing the loop.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single sequential prod worker claims ALL kinds | Role-split: interactive EXCLUDES backfill kinds, dedicated backfill worker INCLUDES only them | v1.12 groundwork landed (123-02), activated this phase | A non-yielding backfill crawl can no longer freeze live analytics. |
| Per-crawl `wait_for` alone as the wedge guard | `wait_for` + heartbeat `LAST_TICK_AT` refresh + structural isolation | v1.11 rollback proved wait_for alone insufficient (5×300s = 25 min frozen healthz) | Healthz stays honest through legit long backfills; isolation is the real guarantee. |
| Retention reaps only `failed_*` rows (>90d) | Add orphaned-`running` purge (>2h) | This phase | Kills the recurring `python` fence-test CI flake at its root. |

**Deprecated/outdated:** none relevant. Note the ROADMAP's "Fly.io" static-IP path is SUPERSEDED (Railway Pro native egress) — irrelevant to Phase 125 (that's Phase 130), do not action.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A `2 hours` purge window is safe on prod (max legit run = 40 min watchdog threshold + margin) | Pattern 3 / Pitfall 2 | If a kind's real in-flight time exceeds 2h, the sweep could delete a live job. Mitigated: no watchdog threshold exceeds 40 min; verify `WATCHDOG_PER_KIND_OVERRIDES` at plan time. |
| A2 | The current prod topology has a distinct worker service (CMD override) separate from the API service | Runtime State Inventory / Open Q | `railway status` shows one linked service; the API/worker split may be dashboard-only. Founder must confirm before the cutover so the right service gets `interactive`. |
| A3 | pg_cron is enabled on BOTH projects | Standard Stack | Confirmed on test (jobid 9 active) and prod (derive cron ran there pre-rollback). Low risk. |
| A4 | The retention purge CAN be a migration (safe on both) while only WORKER-03 must be a LIVE op | Summary / Pattern 3 vs 4 | If founder wants ALL cron changes as LIVE ops for symmetry, the purge could move to a LIVE op too. Recommend migration; flag for founder confirmation in discuss/plan. |

## Open Questions (RESOLVED)

1. **Current prod service topology (API vs worker split).**
   - What we know: Railway project `quantalyze-analytics`, one linked service `quantalyze-analytics`, env production. The Dockerfile documents a CMD-override worker pattern; `/health` (FastAPI) reports `worker_last_tick_at`.
   - What's unclear: whether the API and the durable worker run as ONE service (combined) or two services today; the exact name of the service to flip to `interactive`.
   - RESOLVED: founder confirms on the Railway dashboard as the FIRST cutover step; plan 125-04 models this as a `human_needed`/`autonomous: false` verification leg (Step 0 topology-confirm).

2. **Purge cron as migration vs LIVE op.**
   - What we know: unlike WORKER-03's reschedule, the purge with a prod-safe window has no re-wedge risk.
   - What's unclear: founder preference for symmetry (all cron ops LIVE) vs. minimizing manual steps.
   - RESOLVED: ship as a migration (auto-applies safely to both; test project MCP-applied first) — implemented in plan 125-01.

3. **One-time test-project cleanup timing.**
   - What we know: `DELETE FROM compute_jobs WHERE created_at < now() - interval '1 hour'` on `qmnijlgmdhviwzwfyzlc` greens CI immediately; the recurring purge cron prevents re-accumulation.
   - RESOLVED: run the one-time cleanup via Supabase MCP as a `human_needed` verification leg alongside landing the purge cron — implemented in plan 125-03.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Railway CLI | Founder cutover / deploy verify | ✓ | 4.36.1 | Dashboard Redeploy flow |
| Railway MCP | Live service/env inspection | ✓ | server present | Railway CLI / dashboard |
| Supabase MCP | Apply migration to TEST, one-time cleanup, verify cron | ✓ | server present | psql with TEST_SUPABASE_DB_URL |
| pg_cron (test) | Retention purge + derive cron | ✓ | active (jobid 9) | — |
| pg_cron (prod) | Retention purge + WORKER-03 reschedule | ✓ (assumed — ran pre-rollback) | — | verify via MCP before founder op |
| Python 3.12 + pytest | E2E proof test | ✓ | 3.12-slim image | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none blocking; prod pg_cron presence to be verified via MCP before the WORKER-03 founder op.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (Python) | pytest (+ `--cov`, `--cov-fail-under=80`) |
| Framework (SQL) | plain PL/pgSQL DO blocks under `psql -v ON_ERROR_STOP=1` (no pgTAP) |
| Config file | `analytics-service/pytest.ini`; SQL tests auto-discovered `supabase/tests/test_*.sql` |
| Quick run command | `cd analytics-service && pytest tests/test_main_worker.py -x` |
| Full suite command | `cd analytics-service && pytest --cov=services --cov=routers --cov=main_worker --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WORKER-01 | Kind-filtered claim scope (include/exclude) enforced in SQL | SQL guard | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_claim_kind_filter.sql` | ✅ (LANDED) |
| WORKER-01 | `_claim_kind_args` role→payload mapping; LOUD ValueError on bad role | unit | `pytest tests/test_main_worker.py -k claim_role -x` | ✅ (LANDED — verify coverage of `backfill`/`interactive` payloads) |
| WORKER-02 | Heartbeat refreshes `LAST_TICK_AT` during long dispatch | unit | `pytest tests/test_main_worker.py -k heartbeat -x` | ✅ (LANDED) |
| WORKER-02 | END-TO-END: hung crawl times out (transient), worker alive, healthz 200 during long-but-alive | integration | `pytest tests/test_worker_isolation_e2e.py -x` | ❌ Wave 0 |
| WORKER-03 | derive cron registered at safe hour after reschedule | SQL guard | `psql … -f supabase/tests/test_derive_allocator_keys_fanout.sql` (assertion 6) | ✅ (LANDED) — LIVE op verified manually |
| WORKER-04 | Orphaned-running purge cron registered + deletes running >window, spares fresh | SQL guard | `psql … -f supabase/tests/test_retention_orphaned_running.sql` | ❌ Wave 0 |
| WORKER-04 | Fence tests green after purge | regression | `pytest tests/test_compute_jobs_fencing.py tests/test_drain_semantics.py -x` | ✅ (existing — proves the flake gone) |

### Sampling Rate
- **Per task commit:** `pytest tests/test_main_worker.py -x` (+ the new e2e/SQL test for the touched area)
- **Per wave merge:** full python suite + all `supabase/tests/test_*.sql`
- **Phase gate:** full suite green (incl. the fence tests, run SERIALLY — never `-n auto`) before `/gsd:verify-work`; the two founder LIVE ops verified as `human_needed` legs.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_worker_isolation_e2e.py` — covers WORKER-02 (end-to-end wait_for + healthz)
- [ ] `supabase/tests/test_retention_orphaned_running.sql` — covers WORKER-04 (purge cron registered; deletes running>window; spares <window and non-running)
- [ ] Migration `supabase/migrations/20260719XXXXXX_retention_orphaned_running_compute_jobs.sql` — MCP-applied to TEST before the guard runs
- [ ] Note: run fence tests SERIALLY (`-n auto` deferred, per CI comment) — the new purge fixes the DATA cause, not the concurrency vector.

## Security Domain

`security_enforcement` not disabled in config → included. This phase touches SECURITY DEFINER RPCs and service-role workers; low new surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface changed. |
| V3 Session Management | no | — |
| V4 Access Control | yes | The claim RPC is `SECURITY DEFINER SET search_path=public,pg_temp` with `REVOKE ALL … FROM PUBLIC, anon, authenticated`; the new purge cron runs as pg_cron superuser (no GRANT widening). Preserve both. |
| V5 Input Validation | yes | `WORKER_CLAIM_ROLE` validated LOUD (`_validate_claim_role`); `WORKER_HEARTBEAT_INTERVAL_S` bounded (0,90); the purge cron body is a fixed literal (no interpolation). |
| V6 Cryptography | no | No crypto; worker still `validate_kek_on_startup` (unchanged). |

### Known Threat Patterns for {Railway worker + pg_cron}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unbounded DELETE in a cron body wipes live jobs | Tampering / DoS | Conservative window (>2h) + `retention_delete_guard` trigger backstop; self-verifying DO block. |
| Mis-scoped worker role claims out-of-role jobs | Elevation / Tampering | LOUD ValueError on bad role; backfill worker REFUSES legacy-fallback claims. |
| Cron reschedule auto-applied without worker → re-wedge | DoS | WORKER-03 is a founder LIVE op gated on worker readiness (not a migration). |
| Purge cron running as superuser over-deletes | Elevation | Fixed-literal body, status+age predicate only, guard trigger. |

## Sources

### Primary (HIGH confidence — repo/live)
- `analytics-service/main_worker.py` — `WORKER_CLAIM_ROLE`, `_validate_claim_role`, `BACKFILL_KINDS`, `_claim_kind_args`, heartbeat/`LAST_TICK_AT`, `WATCHDOG_PER_KIND_OVERRIDES`, legacy-fallback role refusal
- `analytics-service/main_worker_healthz.py` — `STALE_THRESHOLD=90`, `LAST_TICK_AT` liveness
- `supabase/migrations/20260719073701_claim_kind_filter.sql` — prod-applied kind-filter RPC + partition-dedupe arms
- `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql` — `derive-allocator-key-dailies` cron `30 5 * * *`, fan-out fn
- `supabase/tests/test_derive_allocator_keys_fanout.sql` — assertion 6 (cron must stay registered, hour 1-22)
- `supabase/migrations/20260515210200_retention_crons_high_hardening.sql` — retention-cron house style, `retention_compute_jobs_failed`
- `supabase/migrations/20260412094449_compute_jobs_admin_and_defer.sql` — `reset_stalled_compute_jobs` watchdog semantics
- `analytics-service/railway.toml`, `Dockerfile` — CMD-override worker pattern, healthcheck
- `docs/runbooks/railway-worker.md` — skipped-deploy-on-red-CI gotcha, health check, one-off ssh
- `.github/workflows/ci.yml` — python job runs SERIALLY vs shared test DB; sql-tests discovery
- `railway status` (live) — project `quantalyze-analytics`, env production, service `quantalyze-analytics`
- memory `project_shared_testdb_concurrent_ci_flake` — the two flake mechanisms + exact remedy

### Secondary (MEDIUM)
- STATE.md / REQUIREMENTS.md — v1.11 rollback root cause, cron-unscheduled-on-prod fact, dependency spine

### Tertiary (LOW)
- None requiring validation — all claims grounded in repo/live state.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all components verified in-repo/live.
- Architecture: HIGH — groundwork landed and read directly; topology confirmed via `railway status` (one open question on API/worker service split).
- Pitfalls: HIGH — flake mechanism precisely documented in memory + verified against the claim RPC dedupe arms.
- Retention design: HIGH — window derived from actual `WATCHDOG_PER_KIND_OVERRIDES`; matches existing house style.

**Research date:** 2026-07-19
**Valid until:** 2026-08-19 (stable infra; re-verify Railway topology if services change)
