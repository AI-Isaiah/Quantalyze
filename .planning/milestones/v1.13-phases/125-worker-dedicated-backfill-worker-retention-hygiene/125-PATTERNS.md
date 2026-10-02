# Phase 125: WORKER — dedicated backfill worker + retention hygiene - Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 5 (1 migration, 2 tests, 1 runbook edit, 1 optional railway config)
**Analogs found:** 5 / 5 (every genuinely-new artifact has an in-repo analog)

> This is a Python/FastAPI worker on Railway + Supabase Postgres phase — NOT a
> Next.js/Vercel concern. The Vercel storage/Next.js skill suggestions fired on
> the `supabase/**` path are noise here; ignore them.
>
> **Critical framing (from RESEARCH):** almost everything is already built and
> prod-applied (v1.12 groundwork in `main_worker.py`, the kind-filter RPC
> `20260719073701`). The genuinely-new code artifacts are only: (1) one
> retention purge migration, (2) one SQL guard test, (3) one Python e2e test,
> (4) a runbook extension. The two founder LIVE ops (two-worker cutover,
> WORKER-03 cron reschedule) are `human_needed` legs — NO new code files.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/20260719XXXXXX_retention_orphaned_running_compute_jobs.sql` (NEW) | migration | batch / retention-DELETE via pg_cron | `supabase/migrations/20260515210200_retention_crons_high_hardening.sql` | exact (same retention-cron house style, same `retention_compute_jobs_failed` sibling cron in the same file) |
| `supabase/tests/test_retention_orphaned_running.sql` (NEW) | test | request-response (assert) | `supabase/tests/test_retention_crons_safe.sql` + `supabase/tests/test_derive_allocator_keys_fanout.sql` | exact (former = cron-body/guard assertions; latter = presence-gate + cron-registration assertion idiom) |
| `analytics-service/tests/test_worker_isolation_e2e.py` (NEW) | test | event-driven / async integration | `analytics-service/tests/test_main_worker.py` (`TestDispatchTick` heartbeat tests) | role-match (same file/class family; e2e wires the real healthz TCP server + dispatch loop together, the existing tests mock pieces) |
| `docs/runbooks/flipretry-derived-equity-go-live.md` (MODIFY) | config/doc | doc | itself (Steps 1-2 cutover + Step 6 reschedule already present) | exact (extend in place; the two-worker cutover + LIVE cron reschedule steps already exist) |
| `analytics-service/railway.worker.toml` (NEW, OPTIONAL) | config | deploy topology | `analytics-service/railway.toml` | role-match — **see note**; RESEARCH says this MAY instead be a documented dashboard env contract in the runbook (Railway service config is dashboard-only state, not git) |

## Pattern Assignments

### `supabase/migrations/…_retention_orphaned_running_compute_jobs.sql` (migration, retention-DELETE)

**Analog:** `supabase/migrations/20260515210200_retention_crons_high_hardening.sql`
(the `retention_compute_jobs_failed` cron in this same file is the direct sibling
— it already DELETEs from `compute_jobs` on a cron; the new job DELETEs a
different status/age slice.)

**House-style skeleton — transaction + lock_timeout header** (analog lines 94-95):
```sql
BEGIN;
SET lock_timeout = '5s';
```

**pg_cron fail-loud presence guard** (analog lines 141-152) — REQUIRED, matches
the RESEARCH "fail-loud is mandatory" mandate and the `feature_not_supported`
ERRCODE house style:
```sql
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      '…: pg_cron extension is NOT installed. Retention re-scheduling cannot proceed…'
      USING ERRCODE = 'feature_not_supported';
  END IF;
  …
```

**Idempotent unschedule-then-schedule + cron body** (analog lines 248-259, the
`retention_compute_jobs_failed` job — copy this exact shape, swap the predicate):
```sql
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_failed') THEN
    PERFORM cron.unschedule('retention_compute_jobs_failed');
  END IF;
  PERFORM cron.schedule(
    'retention_compute_jobs_failed',
    '30 3 * * *',
    $cron$
    DELETE FROM compute_jobs
     WHERE status IN ('failed_final', 'failed_retry')
       AND COALESCE(next_attempt_at, created_at) < now() - interval '90 days';
    $cron$
  );
```
→ New job body (per RESEARCH Pattern 3 / Pitfall 2 — window `2 hours` >> max
watchdog threshold, safe on prod AND clears the workerless test-project flake;
DELETE not reset; fixed literal, no interpolation):
```sql
    DELETE FROM compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '2 hours';
```
Schedule at a safe hour in the 1-22 band, BEFORE the 05:30 derive cron
(RESEARCH suggests `'15 4 * * *'`).

**Self-verifying terminal DO block** (analog lines 267-320) — house style,
MANDATORY. Assert the new job is registered and its body carries the intended
predicate (mirror the `ILIKE '%…%'` command-introspection checks):
```sql
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION '…: retention_compute_jobs_orphaned_running cron job missing';
  END IF;
  IF v_command NOT ILIKE '%status = ''running''%' THEN
    RAISE EXCEPTION '… verification failed: body does not target running rows';
  END IF;
```
Close with `COMMIT;` (analog line 322).

**Backstop already in place — do NOT rebuild:** the `retention_delete_guard`
trigger (mig 121) caps per-statement DELETE volume and protects every retention
cron body, including this new one. Header comment should note it (analog lines
84-87 pattern).

---

### `supabase/tests/test_retention_orphaned_running.sql` (test, assert)

**Primary analog:** `supabase/tests/test_retention_crons_safe.sql` (cron-body +
guard assertions). **Secondary analog:** `supabase/tests/test_derive_allocator_keys_fanout.sql`
(presence-gate + cron-registration idiom — critical for the MCP-apply-to-test-first
timing, RESEARCH Pitfall 6).

**File header + BEGIN/ROLLBACK envelope + run command** (from fanout analog
lines 33-37, 172): plain PL/pgSQL DO blocks under `psql -v ON_ERROR_STOP=1`, NO
pgTAP, whole test rolls back:
```sql
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_retention_orphaned_running.sql
BEGIN;
…
ROLLBACK;
```

**pg_cron presence-skip guard** (retention-crons-safe analog lines 102-105) —
NOTICE-skip when pg_cron absent so local dev doesn't red:
```sql
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Test N skipped: pg_cron not installed';
    RETURN;
  END IF;
```

**Cron-registered + body-content assertion** (retention-crons-safe analog lines
107-117) — assert the new job exists and its body filters as intended:
```sql
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'Test failed: cron.job retention_compute_jobs_orphaned_running not registered (migration not applied)';
  END IF;
  IF v_command NOT ILIKE '%status = ''running''%' THEN
    RAISE EXCEPTION 'Test failed: body lacks the running-status filter. command was: %', v_command;
  END IF;
```

**Behavioral seed → DELETE-behavior assertion** (RESEARCH Wave-0 requires
"deletes running>window; spares fresh <window and non-running"). Follow the
fanout analog's seed-then-assert-then-teardown shape (lines 59-168): seed a
`running` row with `claimed_at = now() - interval '3 hours'` (should be
deletable), a fresh `running` row `claimed_at = now()` (must survive), and a
`done`/`pending` row (must survive), invoke the cron body's DELETE inline, count.
The migration presence-gate (fanout analog lines 51-57) protects test-DB lag:
```sql
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    RAISE NOTICE 'SKIP: purge migration not yet applied here. Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;
```

**Regression note the test should encode (Rule 9 — test intent):** the flake
mechanism is partition-dedupe collision (RESEARCH Pitfall 3), not raw row count.
The oracle is "an orphaned `running` row older than the window is GONE" — DELETE,
not reset (a reset row would re-collide).

---

### `analytics-service/tests/test_worker_isolation_e2e.py` (test, async integration)

**Analog:** `analytics-service/tests/test_main_worker.py` — specifically
`TestDispatchTick.test_heartbeat_refreshes_last_tick_during_long_dispatch`
(lines 247-289) and `TestWorkerClaimRole` (lines 1738-1811). The gap
(RESEARCH Pattern 2): the existing tests mock `dispatch` and never bind the real
`main_worker_healthz` TCP server — the e2e proof must wire the healthz server +
dispatch loop + a genuinely-hung crawl together.

**Imports + async-test decorator + module-global save/restore** (analog lines
16-30, 256-289). The `LAST_TICK_AT` module-global MUST be saved/restored in
`finally` — every existing test does this (`_saved_tick` idiom):
```python
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from main_worker import dispatch_tick
from services.job_worker import DispatchOutcome, DispatchResult
…
    import main_worker_healthz
    _saved_tick = main_worker_healthz.LAST_TICK_AT
    try:
        …
    finally:
        main_worker_healthz.LAST_TICK_AT = _saved_tick
```

**Heartbeat-during-long-dispatch pattern to extend (Case B — long-but-alive)**
(analog lines 259-287): shrink `_HEARTBEAT_INTERVAL_S` via monkeypatch, run a
yielding slow dispatch, assert `LAST_TICK_AT` advanced past the start stamp:
```python
    monkeypatch.setattr(main_worker, "_HEARTBEAT_INTERVAL_S", 0.02)
    async def _slow_dispatch(job):
        captured["at_start"] = main_worker_healthz.LAST_TICK_AT
        await asyncio.sleep(0.15)  # ~7 heartbeat intervals, all yielding
        return DispatchResult(outcome=DispatchOutcome.DONE)
    …
    assert main_worker_healthz.LAST_TICK_AT > captured["at_start"]
```

**E2E NEW piece — bind the real healthz server and probe it over TCP.** Source
of the server + staleness contract is `analytics-service/main_worker_healthz.py`
(`start_healthz_server`, `STALE_THRESHOLD = 90.0`, 200-if-fresh / 503-if-stale,
`_handle_healthz` lines 32-93). Start it on an ephemeral `PORT`, then assert an
HTTP GET returns `200` during Case B (long-but-alive) because the heartbeat
advances `LAST_TICK_AT`:
```python
# main_worker_healthz.start_healthz_server() reads int(os.getenv("PORT","8080"))
# and does asyncio.start_server(_handle_healthz, "0.0.0.0", port).
# Body when fresh: {"status":"ok","last_tick_at":<float>,...} at "200 OK";
# when age > STALE_THRESHOLD: "503 Service Unavailable".
```

**Case A — hung crawl times out to a transient, worker stays live.** The
per-crawl bound lives in `services/job_worker.py` (`_BROKER_CRAWL_TIMEOUT_S`,
`_SFOX_CRAWL_TIMEOUT_S`, `_DERIVE_OUTER_BUDGET_S = 900.0`), which wraps handlers
in `asyncio.wait_for` and classifies `asyncio.TimeoutError → transient` (analog
worker lines 194-242, 2319-2391). Assert a dispatch that exceeds its bound
yields a transient `DispatchOutcome` (NOT a crash) and the loop keeps ticking.
Do NOT re-implement the bound — drive a dispatch that outlasts a shrunk timeout.

**Role-isolation assertion (optional but cheap, reuse `TestWorkerClaimRole`
helper shape, analog lines 1744-1756):** with `patch("main_worker.WORKER_CLAIM_ROLE","backfill")`
the claim payload carries `p_kind_include == list(BACKFILL_KINDS)`; with
`"interactive"` it carries `p_kind_exclude` — proves the two workers never
contend for the same kinds.

**Serial-run caveat (RESEARCH Validation Architecture):** fence/e2e tests run
SERIALLY — never `-n auto` (per CI comment). Quick command:
`cd analytics-service && pytest tests/test_worker_isolation_e2e.py -x`.

---

### `docs/runbooks/flipretry-derived-equity-go-live.md` (MODIFY, doc)

**Analog:** the file itself — it ALREADY contains the two-worker cutover (Step 1
"Deploy the dedicated backfill worker", Step 2 "Cut the prod worker over to
`interactive`") and Step 6 "Reschedule the cron (LAST) — a founder LIVE SQL op,
NOT a migration". Phase 125 EXTENDS in place, matching the existing step format:
numbered step, `Env:` / `Verify:` / `Abort path:` sub-bullets, fenced `railway`
and `sql` command blocks.

**Existing env-contract excerpt to build on** (analog lines 45-46) — the service
-role key var name is a known footgun (`SUPABASE_SERVICE_KEY`, NOT `_ROLE_KEY`):
```
Env: WORKER_CLAIM_ROLE=backfill + the standard worker env (service-role key var
name is SUPABASE_SERVICE_KEY, plus the same DB/exchange config the prod worker carries).
```

**Existing LIVE-op-not-migration rationale to reference** (analog lines 105-119):
Step 6 already documents why the cron reschedule is a hand-run SQL op gated on
worker readiness. Phase 125 additions: (a) note the NEW retention purge cron
lands as a migration (safe both projects, MCP-apply to TEST first per Pitfall 6),
(b) add the one-time test-project cleanup as a `human_needed` verification leg
(`DELETE FROM compute_jobs WHERE created_at < now() - interval '1 hour'` on
`qmnijlgmdhviwzwfyzlc`), (c) confirm the founder-op ordering: purge migration
merges → cutover (Steps 1-2) → pilot/E2/full backfill → cron reschedule LAST.

---

### `analytics-service/railway.worker.toml` (NEW, OPTIONAL — see decision)

**Analog:** `analytics-service/railway.toml`:
```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"
dockerfileTarget = ""

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```
The `Dockerfile` documents the CMD override (`python -m main_worker`) for a
worker service; default CMD is `uvicorn main:app` for the API (Dockerfile lines
1-8, 26). **Planner decision needed (RESEARCH Open Q1 + A2):** the interactive/
backfill split is Railway service+env config that lives in the DASHBOARD, not
git. RESEARCH recommends EITHER a committed `railway.worker.toml` OR a documented
dashboard env contract in the runbook. Railway REPLICAS cannot carry different
roles (Pitfall 5) — a distinct SERVICE is required. If a config file is not
added, this row collapses into the runbook edit above.

## Shared Patterns

### Fail-loud (MANDATORY — CONTEXT + RESEARCH V5)
**Source:** `analytics-service/main_worker.py` lines 145-160 (`_validate_claim_role`
→ LOUD `ValueError`; `WORKER_CLAIM_ROLE` read once at import) and lines 136-142
(`WORKER_HEARTBEAT_INTERVAL_S` bounded `(0, STALE_THRESHOLD)` or raise).
**SQL analog:** the migration `RAISE EXCEPTION … USING ERRCODE` guard (retention
analog lines 148-152).
**Apply to:** the new migration (pg_cron-absent → RAISE EXCEPTION), the SQL guard
test (missing cron → RAISE EXCEPTION). Do NOT add a silent default anywhere.
```python
if role not in _VALID_CLAIM_ROLES:
    raise ValueError(f"WORKER_CLAIM_ROLE={role!r} is invalid; must be one of {_VALID_CLAIM_ROLES}")
```

### Self-verifying terminal DO block
**Source:** `supabase/migrations/20260515210200_…sql` lines 267-320 (asserts every
object the migration ships is present + carries the intended body, via
`pg_indexes` / `cron.job.command ILIKE`).
**Apply to:** the new retention migration — end with a DO block asserting the
purge job is registered with the running/2h predicate.

### Presence-gate for test-DB lag (RESEARCH Pitfall 6)
**Source:** `supabase/tests/test_derive_allocator_keys_fanout.sql` lines 51-57
(NOTICE-skip when the migrated object is absent) — pairs with MCP-applying the
migration to TEST (`qmnijlgmdhviwzwfyzlc`) BEFORE the guard runs.
**Apply to:** the new SQL guard test.

### Module-global save/restore in async tests
**Source:** `analytics-service/tests/test_main_worker.py` — every `LAST_TICK_AT`
test wraps mutation in `try/finally` restoring `main_worker_healthz.LAST_TICK_AT`
(and resets `_FALLBACK_CLAIM_RPC` / `_FALLBACK_LATCHED_AT` for order-independence,
lines 1836-1845). Prevents cross-test pollution on the shared module globals.
**Apply to:** the new e2e test.

### Retention-DELETE backstop (do NOT rebuild)
**Source:** `retention_delete_guard` trigger (mig 121), referenced in
`20260515210200_…sql` lines 84-87 and `supabase/tests/test_retention_crons_safe.sql`
(the whole file verifies it). Caps per-statement DELETE at 100k rows.
**Apply to:** the new purge cron inherits this protection automatically — the
migration header should cite it; no new guard needed.

## No Analog Found

None. Every genuinely-new artifact maps to an in-repo analog. The remaining
Phase-125 work items are RUNTIME-STATE / founder LIVE ops with NO code file:

| Item | Why no file | Handling |
|------|-------------|----------|
| Two-worker Railway cutover (WORKER-01 activation) | Dashboard service + env config, not git | `human_needed` verification leg; runbook Steps 1-2 |
| WORKER-03 cron reschedule (`'30 5 * * *'`) | Founder LIVE SQL op, deliberately NOT a migration (auto-apply + skipped deploy = re-wedge) | `human_needed` leg; runbook Step 6 |
| One-time test-project orphan cleanup | MCP SQL op on `qmnijlgmdhviwzwfyzlc` | `human_needed` leg alongside the purge migration |

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`,
`analytics-service/`, `analytics-service/tests/`, `docs/runbooks/`.
**Files scanned:** migration `20260515210200`, tests `test_retention_crons_safe.sql`
+ `test_derive_allocator_keys_fanout.sql`, `test_main_worker.py` (1947 lines,
targeted reads), `main_worker.py` + `main_worker_healthz.py`, `railway.toml` +
`Dockerfile` CMD note, `services/job_worker.py` (crawl-bound grep), the runbook.
**Pattern extraction date:** 2026-07-19
