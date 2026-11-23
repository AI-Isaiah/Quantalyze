# Phase 227: JOBLEDGER - Research

**Researched:** 2026-11-23
**Domain:** Postgres compute-job lifecycle (claim / watchdog / mark RPCs, pg_cron sweeps) plus the Python worker loop (`analytics-service/main_worker.py`)
**Confidence:** MEDIUM. Every code claim was read at HEAD `fdd61c3d8`. **No PROD observation was taken.** The Supabase MCP SQL tool was not callable in this session, so every population count below is "no observation", not zero.

## Summary

All six requirements land on one seam, and four facts drive the plan:

1. **The live watchdog is `reset_stalled_compute_jobs`, not `reclaim_stuck_compute_jobs`.** The worker's `watchdog_tick` calls `reset_stalled_compute_jobs` (`analytics-service/main_worker.py:1171-1179`). A repo grep found no caller of `reclaim_stuck_compute_jobs` outside tests and comments. ROADMAP and TODOS `[164.2-RECLAIM-PROVENANCE]` both name `reclaim_stuck_compute_jobs`. Fixing only that function closes nothing in production, so the HEAL-04 and MT5D-01 write points must land in `reset_stalled_compute_jobs`. `reclaim_stuck_compute_jobs` gets the same treatment so it cannot become a second, silent path if someone wires it up.
2. **HEAL-02's root cause sits in the claim plus the dispatch loop, not in the watchdog threshold.** The 5-arg claim stamps one `claimed_at = now()` on a batch of up to 5 rows. `dispatch_tick` then runs them one after another. The watchdog resets any `running` row whose `claimed_at` is older than its kind threshold, so a row still waiting behind batch-mates ages. A stamp at actual start arrives too late, because the reset fires while the row waits. The design that closes it:
   - A **token-fenced lease renewal** of the claimed-but-not-yet-started rows the worker holds, driven by the existing per-job heartbeat task.
   - A **fence check immediately before `dispatch()`**: a row the worker no longer holds is skipped, never run.
3. **The MT5D-01 record should be written at the failure source, in the failing transaction**: `mark_compute_job_failed` for a real error, and `reset_stalled_compute_jobs` / `reclaim_stuck_compute_jobs` for a reset. Each record is then committed before any re-claim can run, by construction. The claim pair (`20260927120000`) does not need to change, so its self-verify, including the M-1137 `last_error` clear pin, stays untouched.
4. **HEAL-05's real exclusion is the second conjunct, not the status list.** `/cron-sync` (`analytics-service/routers/cron.py`) syncs strategies through the `sync_trades` SQL RPC, with no `compute_jobs` row (that file has no `enqueue_compute_job` call). `enqueue_poll_positions_for_all_strategies` requires a `sync_trades` compute job `done` in the last 30 days. So any strategy kept current by `/cron-sync` alone is excluded, whatever its status. That matches F-8's measurement of one strategy polled in 21 days. Widening the status list alone would enqueue almost nothing. (⛔ CORRECTED at plan revision, 2026-11-23: the parenthetical "no `compute_jobs` row" is wrong. `routers/cron.py` enqueues `derive_broker_dailies` jobs. It writes no `sync_trades` compute job, so the conclusion stands. See Assumption A3.)

**Primary recommendation:**
- New append-only `compute_job_attempt_failures`, written by `mark_compute_job_failed` and both reset RPCs.
- A lease-renew RPC plus a worker pre-dispatch fence (HEAL-02).
- A per-strategy sorted bridge call in `reset_stalled_compute_jobs` (HEAL-04).
- A new `reconcile_readmit_exhaustions` row written by the re-registered sweep, then paged by a Python reader through `ops_alert.page` (HEAL-03).
- A separate first-hop pg_cron sweep keyed on data absence, with a durable once-only marker (HEAL-01).
- A poll-cohort predicate that drops the compute-job conjunct for a key-health signal `/cron-sync` maintains (HEAL-05).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### HEAL-03 readmit ceiling signal (founder ruling 2026-11-23)
- Both: a durable row that outlives the job rows' retention, plus a page through the existing `ops_alert` channel (`analytics-service/services/ops_alert.py`, `page`). The ceiling is enforced in the pg_cron SQL sweep, so the SQL writes the durable row and a Python reader pages from it (planner sizes the reader; it must never raise, per the `ops_alert` contract). — **Reversibility:** one-way — a new persisted table or audit row class, plus a new `ops_alert` source/event that `src/lib/ops-alert-contract.ts` must mirror (parity test).

#### HEAL-01 dropped first sync_trades enqueue (founder ruling 2026-11-23)
- Auto re-enqueue by a sweep of its own (not a second predicate on `reconcile_dropped_enqueue_sweep`): key present, the strategy never synced and no job ever, and a grace period longer than 1 hour. A named state shows only if that retry also fails. A healthy new strategy must not be caught. The named state's user-visible wording is decided at plan time. — **Reversibility:** costly — a new pg_cron job and a new strategy-visible state that the UI and status readers depend on.

#### MT5D-01 per-attempt failure record (founder ruling 2026-11-23)
- New append-only table, one row per failed attempt: job id, attempt number, cause class (a real error vs a stall reset vs a watchdog reset), error text. Written before the M-1137 `last_error` clear on re-claim, which stays and stays pinned. Survives job-row pruning, because 230 MT5NIGHTLY reads real nights of these records. — **Reversibility:** one-way — persisted schema written by the claim/reclaim RPCs and read by Phase 230.

### Claude's Discretion
- HEAL-02 lease or heartbeat design (research first), HEAL-04 reclaim provenance mechanics, HEAL-05 cohort widening shape, the exact table and column names, test lanes and arm layout are the researcher's and planner's call, within PROOF-01 (RED-UNDER twins, RED-UNDER-SETUP listing, neuter/RED/byte-restore/GREEN recorded verbatim).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

Also from CONTEXT `<domain>`: out of scope is "anything 231 DEAD-02 owns beyond re-basing on these bodies". F-2 (REQUIREMENTS.md): no composite work, so the `stitch_composite` / multi-key arm of finalize is out.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md) | Research Support |
|----|-------------|------------------|
| MT5D-01 | Every failed attempt leaves an append-only record of its cause, written before the re-claim clears `last_error`; tells a stall/watchdog reset apart from a real error; readable after a later success; the M-1137 clear stays | Write-point census and table design (Pattern 1); retention facts (Pitfall 4) |
| HEAL-01 | A finalize-wizard strategy whose first `sync_trades` enqueue dropped is re-enqueued or shown in a named state, by its own mechanism | Finalize enqueue paths and false-positive enumeration (Pattern 5) |
| HEAL-02 | A `derive_allocator_equity` job behind slow batch-mates is never reset and run twice | Root-cause trace and lease design (Pattern 2) |
| HEAL-03 | A readmit that hits its ceiling emits a readable signal (founder: durable row + page) | Sweep body, pointer hygiene, ops_alert contract (Pattern 4) |
| HEAL-04 | A job reclaimed after a crash keeps its curated sentence; the strategy's analytics status follows | Provenance trigger mechanics and the bridge call (Pattern 3) |
| HEAL-05 | The daily positions poll covers private strategies; the `poll_positions` enqueue stays live | Cohort predicate trace (Pattern 6) |
| PROOF-01 | Every gate RED first, byte restore, GREEN; new SQL arms carry twins + RED-UNDER-SETUP | Validation Architecture |
</phase_requirements>

## Project Constraints (from CLAUDE.md, AGENTS.md, user memory)

- **PROD auto-apply:** a merge touching `supabase/migrations/**` applies to TEST and then to PROD automatically. There is no human gate, so every review must happen before merge (CLAUDE.md, CORRECTED 2026-09-23).
- **Migration review:** each migration needs a clean migration-reviewer and rls-policy-auditor pass (no MEDIUM+) before merge, plus the one serial migration lane (ROADMAP SC-6).
- **Re-basing:** before any CREATE OR REPLACE, re-base on the latest definition across all migrations (memory).
- **Data-reading guards:** `scripts/lint-migration-data-dependence.mjs` refuses new data-reading `DO`-block guards and has no opt-out. Self-verify must read only catalogs (`pg_get_functiondef`, `pg_proc`, `cron.job.command`), never `compute_jobs` rows.
- **Self-verify style:** migrations self-verify and `RAISE EXCEPTION` (fail loud). A pg_cron migration asserts the extension and RAISEs on its absence (`20260819150000` STEP 1 pattern). Every RAISE format string is one literal.
- **Floors by symbol:** read mutation floors by symbol from `scripts/mutation-floors.mjs`, never from prose. `WAIVED_CEILING` is 0: no waivers.
- **PROOF-01 restores:** neuter, then RED on the named arm, then `cp` the byte backup back and `cmp`, then GREEN. Never use `git checkout`, `restore` or `stash` on uncommitted work.
- **Prose hygiene:** never write a CI skip token in commit or PR text. Never put PROD ids, home paths, emails or account numbers in tracked text.
- **Python tests:** run pytest only from `analytics-service/`. CI runs mypy strict on analytics code. Never use `importlib.reload` in tests.
- **Next.js:** this is not the Next.js in training data. Read `node_modules/next/dist/docs/` before writing route code (AGENTS.md).
- **Closures:** raising retries or a watchdog threshold is not a close (ROADMAP).
- **Ship hygiene:** the ship PR deletes the `TODOS.md` entries it closes and names them in the CHANGELOG: `[164.2-RECLAIM-PROVENANCE]`, `166.5.1-DERIVE-BATCH-RESET-RESIDUAL`, `FANOUT-COHORT-SIBLING-POLL-01`, the readmit-ceiling bullet, and the `(D-05)` first-hop entry. `[175-NIGHTLY-MT5-DERIVE-CHECK]` is shared with 230: keep it, re-point it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Attempt-failure record (MT5D-01) | Database (SECDEF RPCs) | — | The cause is known only inside the failing RPC's transaction; writing it there is atomic with the status flip |
| Lease renewal / fence (HEAL-02) | Database (new RPC) | API/Backend (worker loop) | The worker knows which rows it still holds; the DB is the only place a token fence is atomic |
| Reclaim provenance (HEAL-04) | Database (`reset_stalled_compute_jobs` calls the bridge) | — | The bridge `sync_strategy_analytics_status` is SQL; every other requeue path calls it in-RPC |
| Readmit-ceiling signal (HEAL-03) | Database (pg_cron sweep writes row) | API/Backend (Python reader pages) | Founder-locked split |
| First-hop drop heal (HEAL-01) | Database (new pg_cron sweep) | Frontend server (named state read path) | Founder-locked "sweep of its own"; the named state surfaces through the existing analytics status readers |
| Poll cohort (HEAL-05) | Database (`enqueue_poll_positions_for_all_strategies`) | API/Backend (`daily_enqueue_tick` caller unchanged) | The cohort lives in the SQL predicate |

## Standard Stack

No new external packages. Everything is in-repo: PL/pgSQL + pg_cron (Supabase), Python 3 worker (`supabase-py` RPC calls), vitest, pytest, and the repo's SQL lanes.

| Tool | Version | Purpose |
|------|---------|---------|
| Postgres (lane image) | `17.6.1.113`, pinned by `LANE_PG_VERSION` in `scripts/local-stack/run.sh` [CITED: CLAUDE.md] | Local-stack `sql-tests` lane |
| pg_cron | available on the pg-lane via `shared_preload_libraries=pg_cron` [CITED: CLAUDE.md] | Sweep gates can run on the mutation lane |

## Package Legitimacy Audit

Not applicable. This phase installs no external packages.

## Architecture Patterns

### System Architecture Diagram

```
 finalize-wizard route ──after()──► enqueue_compute_job(sync_trades)   (legacy/contribution arm)
        │                          └─ may DROP (lambda death, RPC error) ──► [HEAL-01 first-hop sweep, new pg_cron]
        └─ postProcessKey ─► Python process_key ─► enqueue(process_key_long)  (manager single-key arm)

 compute_jobs (pending/failed_retry)
        │  claim_compute_jobs_with_priority(batch=5)  → status=running, claimed_at=now() for WHOLE batch,
        │                                               attempts+1, last_error=NULL (M-1137)
        ▼
 worker dispatch_tick: for job in batch (sequential)
        │   [HEAL-02 NEW] heartbeat renews claimed_at of still-WAITING rows (token-fenced)
        │   [HEAL-02 NEW] fence check: skip a row whose claim_token no longer matches
        │   dispatch(job) ─► DONE ─► mark_compute_job_done ─► bridge sync_strategy_analytics_status
        │                └─► FAILED ─► mark_compute_job_failed ─► [MT5D-01 NEW] attempt row (cause=error) ─► bridge
        ▼
 watchdog_tick (60s) ─► reset_stalled_compute_jobs(per-kind thresholds on claimed_at)
                          → status=pending, last_error='worker_stalled', claim_token=NULL
                          [MT5D-01 NEW] attempt row (cause=watchdog_reset)
                          [HEAL-04 NEW] sorted per-strategy bridge call  ─► strategy_analytics follows (computing, markers cleared)

 pg_cron reconcile_dropped_enqueue_sweep (hourly :35) ─► CSV strategies, readmit while marker count < 3
                          [HEAL-03 NEW] count >= 3 ─► INSERT reconcile_readmit_exhaustions (once per exhaustion)
                                                     ─► Python reader ─► ops_alert.page(new source) ─► stamp paged_at

 worker daily_enqueue_tick ─► enqueue_poll_positions_for_all_strategies
                          [HEAL-05] cohort: + private, and key health from /cron-sync instead of a sync_trades job row
```

### Pattern 1: MT5D-01, the attempt record at the failure source

**Write-point census** (functions that write `last_error`; grep over `supabase/schema/functions/*.sql`, plus cron bodies):

| Writer | What it does to the attempt | Cause class |
|---|---|---|
| `mark_compute_job_failed` (latest body `20261024120000`; snapshot `supabase/schema/functions/mark_compute_job_failed.sql:107-112`) | `SET status = v_new_status, last_error = p_error, error_kind = p_error_kind, next_attempt_at = v_next_attempt` | `error` (real) |
| `reset_stalled_compute_jobs` (latest `20260516104201`; snapshot lines 37-53 and 61-80) | `SET status = 'pending', claimed_at = NULL, claimed_by = NULL, next_attempt_at = now(), last_error = 'worker_stalled', claim_token = NULL`; **does not touch `attempts`** | `watchdog_reset` |
| `reclaim_stuck_compute_jobs` (latest `20260516104201`; snapshot lines 31-46) | `SET status = 'pending', …, attempts = GREATEST(attempts - 1, 0), reclaim_count = reclaim_count + 1`; writes no `last_error`; **no non-test caller found** | `stall_reclaim` |
| Orphan terminalizer cron (`20260817120000`) | running → `failed_final` with `last_error LIKE 'orphaned_running_reaped:%'` (literal per the sweep at `20260819150000`) | candidate `orphan_reaped` (see Open Question 2) |
| Fan-in cascade inside `mark_compute_job_failed` (snapshot lines 217-233) | child → `failed_final`, `last_error = 'fan_in_parent_failed: …'` | the child never ran; recommend NOT recording it as an attempt |
| `defer_compute_job`, `set_departed_key_history_inclusion` | also write `last_error` | not failures of an attempt; read the bodies before excluding them |

[VERIFIED: supabase/schema/functions/reset_stalled_compute_jobs.sql:37-53] verbatim excerpt:
```sql
      UPDATE compute_jobs
         SET status          = 'pending',
             claimed_at      = NULL,
             claimed_by      = NULL,
             next_attempt_at = now(),
             last_error      = 'worker_stalled',
             claim_token     = NULL    -- mig 117: P97 fence invalidation
       WHERE id IN (
         SELECT id FROM compute_jobs
           WHERE status = 'running'
             AND kind = v_kind
             AND claimed_at IS NOT NULL
             AND claimed_at < (now() - v_threshold)
```

**Recommended table** (names are discretion; `[ASSUMED]` shape):
- `compute_job_attempt_failures(id uuid pk default gen_random_uuid(), job_id uuid NOT NULL, strategy_id uuid NULL, kind text NOT NULL, attempt integer NOT NULL, claim_token uuid NULL, cause_class text NOT NULL CHECK (cause_class IN (...)), error_kind text NULL, error_text text NULL, worker_id text NULL, recorded_at timestamptz NOT NULL default now())`.
- **No foreign key to `compute_jobs`.** The precedent is `strategy_analytics.computation_error_job_id`, whose migration says "NO FOREIGN KEY … deliberately" (`20260906120000:222`). ⚠️ Do NOT copy `compute_job_dedup_events`: its `job_id` has `REFERENCES public.compute_jobs(id) ON DELETE CASCADE` [VERIFIED: supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql:176]. Under the 30- and 90-day prunes that would delete the very records 230 reads.
- **Attempt identity:** use `(job_id, claim_token)`, not `(job_id, attempts)`. `reclaim_stuck_compute_jobs` decrements `attempts`, so the attempts count can repeat. Each claim mints a fresh `claim_token = gen_random_uuid()`. The reset RPCs NULL `claim_token` in the same UPDATE, so capture the old token in a CTE that reads the locked rows first: `WITH old AS (SELECT id, claim_token, attempts, … FOR UPDATE SKIP LOCKED) UPDATE … FROM old … RETURNING old.*`, then INSERT from the RETURNING. A `UNIQUE (job_id, claim_token)` makes a double record impossible.
- **Ownership and access:** enable RLS with no policies, `REVOKE ALL FROM PUBLIC, anon, authenticated`, and grant `SELECT` to `service_role` for 230's reader. Writes come only through the SECDEF RPCs, so add no INSERT grant.
- **Retention:** keep the table out of every `retention_compute_jobs_*` cron, so it outlives job rows by construction. If it gets its own retention, it must be longer than 90 days.
- **"Before the re-claim clears `last_error`" holds by construction.** The record commits in the same transaction that sets the failure, which is before any later claim can read the row. The claim pair stays unedited. A lane arm must still prove the M-1137 clear holds: drive fail → claim and assert `last_error IS NULL` on the row while the ledger row survives. The existing self-verify pin stays in force: `claim_compute_jobs_with_priority does not clear last_error/error_kind on re-claim (M-1137/M-1138)` at `20260927120000:968`.

### Pattern 2: HEAL-02, lease renewal of waiting batch-mates

**Root cause, traced:**
- [VERIFIED: analytics-service/main_worker.py:714-722] `_claim_priority` sends `"p_batch_size": 5`.
- [VERIFIED: supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql:323-560] The 5-arg body's final UPDATE sets `claimed_at  = now()` (with `attempts = attempts + 1`, `claim_token = gen_random_uuid()`, `last_error = NULL`) on every row of the batch, `LIMIT p_batch_size`.
- `dispatch_tick` loops `for job in jobs:` and awaits `dispatch(job)` one job at a time (`main_worker.py` loop starting after the claim log line; `dispatch` is defined at `analytics-service/services/job_worker.py:18225`). Nothing between the claim and `dispatch()` re-checks the claim token. The token is read (`claim_token = job.get("claim_token")`) and used only at mark time.
- [VERIFIED: analytics-service/main_worker.py:251-254] `BACKFILL_KINDS = ("derive_broker_dailies", "derive_allocator_equity",)`. The backfill role claims only these two kinds (`_claim_kind_args`).
- [VERIFIED: analytics-service/services/job_worker.py:998,1000] `"derive_broker_dailies": 15 * 60`, `"derive_allocator_equity": 5 * 60` (`TIMEOUT_PER_KIND` starts at :985).
- `WATCHDOG_PER_KIND_OVERRIDES["derive_allocator_equity"] = "20 minutes"`, and `"derive_broker_dailies": "30 minutes"` (`main_worker.py:336-405`). The default is `"p_stale_threshold": "10 minutes"` (`main_worker.py:1171-1179`).
- **Sequence:** batch = [dbd₁ (15 min), dbd₂ (15 min), dae]. dae waits about 30 min with `claimed_at` frozen at claim time. At 20 min the watchdog resets dae to `pending` and NULLs its token, while it still sits unstarted in the worker's list. Another worker (or this one, next tick) re-claims it, and the original worker then runs dae anyway: run twice. The original worker's mark is then refused with `55006` (`mark_compute_job_failed.sql:77-82`).

**Design options, judged:**

| Option | Closes it? | Blast radius |
|---|---|---|
| **A. Token-fenced lease renewal of waiting rows + pre-dispatch fence (RECOMMENDED)** | Yes: a waiting row's `claimed_at` age stays at most about one heartbeat interval; a row reset anyway is skipped, never run | One new SECDEF RPC; worker loop change; claim pair, watchdog and thresholds untouched |
| B. `started_at` column stamped at actual start, watchdog reads it | No. The reset fires during the wait, before any start stamp. A watchdog that ignored unstarted rows would never reclaim a dead worker's claimed batch | Watchdog + column + claim changes |
| C. Batch size 1 for the backfill role | Mechanically yes, for that role only | Cuts backfill throughput fivefold; leaves the class open for every other kind; TODOS notes it was "not chosen" |
| D. Raise the threshold | Forbidden ("raising … a watchdog threshold is not a close") | — |

**Option A, concretely (`[ASSUMED]` names):**
- New `renew_compute_job_claims(p_job_ids uuid[], p_claim_tokens uuid[]) RETURNS SETOF uuid`. It runs `UPDATE compute_jobs SET claimed_at = now() WHERE status = 'running' AND (id, claim_token) IN (unnest pairs) RETURNING id`. It is SECURITY DEFINER with a pinned `search_path` and grants EXECUTE to `service_role` only.
- **Pre-dispatch fence:** at the top of each loop iteration, call renew for the job about to start plus every still-waiting job. If the job about to start is not in the returned set, skip it, log it loud with an `event_type`, and do not dispatch. Its new owner runs it.
- **Heartbeat:** the existing `_heartbeat` task (`main_worker.py:981-986`) also calls renew for the **still-waiting** rows only, every `_HEARTBEAT_INTERVAL_S`. **Never renew the running row itself.** Its staleness must stay governed by its own override, which `test_watchdog_threshold_exceeds_handler_timeout` keeps above its handler timeout. A loop-blocking freeze stops the heartbeat too, so a dead worker's waiting rows still age out and get reset, which is correct.
- The renewal must never raise into the loop. A failed renew is logged; the next iteration's fence then decides.
- **Gate:** a pytest that drives a fake batch through `dispatch_tick` with the renew RPC faked, plus a SQL lane arm. The arm claims a batch, back-dates `claimed_at` past 20 min on a waiting row, calls renew, runs the watchdog, and asserts the row is NOT reset. A twin arm asserts that a token-mismatched renew renews nothing. This is the TODOS close criterion: "a test reproduces a batch-mate wait past 20 minutes without a reset".

### Pattern 3: HEAL-04, the reset calls the bridge

**Mechanism** (trigger [VERIFIED: supabase/migrations/20260906120000_computation_error_provenance.sql:1155-1170]):
```sql
  IF NEW.computation_error IS DISTINCT FROM OLD.computation_error
     AND NEW.computation_error_source IS NOT DISTINCT FROM OLD.computation_error_source
     AND NEW.computation_error_job_id IS NOT DISTINCT FROM OLD.computation_error_job_id
  THEN
    NEW.computation_error_source := NULL;
    NEW.computation_error_job_id := NULL;
```
1. Attempt 1 of job J stamps sentence S1 with markers `('writer', J)`, then dies before its mark.
2. The watchdog resets J. Today no bridge call follows (`reset_stalled_compute_jobs` never calls `sync_strategy_analytics_status`), so `strategy_analytics` keeps its stale state: the status does not follow.
3. Attempt 2 writes S2 while restating `('writer', J)`. The trigger sees the sentence change with the markers unchanged, and NULLs the markers.
4. The next bridge call replaces S2 with the per-kind generic.

**Fix:** after the reset UPDATE, for each reset row with a non-NULL `strategy_id`:
- De-duplicate per strategy.
- Take the advisory lock `pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(strategy_id::text))` in the sorted order `ORDER BY hashtext(strategy_id::text), strategy_id`. Copy the loop shape [VERIFIED: supabase/schema/functions/mark_compute_job_failed.sql:259-272].
- Then call `PERFORM sync_strategy_analytics_status(strategy_id, job_id)`.

With J now `pending`, branch (a) fires (`v_nonterminal_count > 0`), resolves the row to `'computing'` and NULLs the sentence and both markers on the ELSE arms (`sync_strategy_analytics_status.sql:641-700`). Attempt 2's restated markers then differ from the NULL OLD markers, the trigger does not fire, and S2 survives. "Status follows" = the row reads `computing` instead of a stale `failed`.

**Exceptions to state:**
- The `complete_with_warnings` / refresh-keep arms hold the sentence. That is intended and is pinned by existing arms.
- The 2-arg sync signature exists at HEAD (`sync_strategy_analytics_status(p_strategy_id UUID, p_trigger_job_id UUID DEFAULT NULL)`). Confirm it also exists in whatever bridge revision the gate's RED-UNDER-SETUP applies.
- The side-kind early return (`v_side_kinds`) means a reset `poll_positions` / `sync_funding` / `reconcile_strategy` / `compute_intro_snapshot` job does not bounce the status. That is correct.

**Lock-order risk** (flag for migration-reviewer): the reset holds row locks on up to 500 rows per kind, then takes advisory locks. `mark_compute_job_*` takes its row lock, then the advisory lock. Both go row first, then advisory. No cycle was found, because the cascade locks only `done_pending_children` rows and a reset row is `running`. Still state it in the header.

The sync function's header comment lists `reset_stalled_compute_jobs` among the "NON-caller writers". That text is inside the sync body, so either re-issue sync (not recommended) or record the correction in the new migration's header.

**Gate placement:** TODOS asks for the arm in `supabase/tests/test_sync_status_curated_sentence_survives.sql`. Its `RED-UNDER-SETUP` stops at `20261003120000` and does not apply `20260516104201` (the latest reset body) or the new migration. Appending there means extending that apply list without perturbing seven existing arms. **Recommend a new gate file** with its own `RED-UNDER-SETUP` (ending in the new migration). Its arm reclaims, re-stamps a DIFFERENT sentence under the SAME job id, and reads it back. This satisfies SC-4's wording.

### Pattern 4: HEAL-03, the durable row plus page

**Sweep body** (latest registration `20260819150000`; no later migration re-registers `reconcile_dropped_enqueue_sweep`, per a grep). The ceiling conjunct, verbatim [VERIFIED: supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql, in the `$cron$` body]:
```sql
           AND (
                 SELECT count(*)
                   FROM public.compute_jobs cjc
                  WHERE cjc.strategy_id = s.id
                    AND cjc.status = 'failed_final'
                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'
               ) < 3
```

**Design:**
- Re-register the same jobname, same schedule `'35 * * * *'`. The body is transcribed byte-for-byte, plus ONE added statement before the INSERT. That statement inserts into `reconcile_readmit_exhaustions(strategy_id, generation_key, marker_count, detected_at, paged_at NULL)` the strategies that pass every other conjunct but have count `>= 3`, with `ON CONFLICT (strategy_id, generation_key) DO NOTHING`.
- **Once per exhaustion:** `generation_key` = the newest marker row's id. A strategy that cycles again after the rolling 90-day window gets a new key, so it pages again, and it never re-pages within one exhaustion.
- **Python reader:** for example inside the worker's existing loops. It selects `paged_at IS NULL` rows, calls `ops_alert.page(source="reconcile_readmit_ceiling", cause="readmit_ceiling", event="outage", detail=…)`, awaits `await_delivery`, and stamps `paged_at` only on a delivered page. It never raises.
  - `page()` signature [VERIFIED: analytics-service/services/ops_alert.py:430-438]: `async def page(source: str, cause: str, *, event: str = "outage", since: datetime | None = None, detail: str = "", extra_tags: dict[str, str] | None = None)`.
- **Contract:** the new source must be added to BOTH `OPS_ALERT_SOURCES` sets.
  - Python [VERIFIED: analytics-service/services/ops_alert.py:71-85]: `"mt5_jobs_terminal", "mt5_validation_terminal", "mt5_terminal_scrub", "mt5_relaunch_debt", "mt5_server_clock", "cron_sync", "backfill", "prod_prober", "drill", "unrecognised"`.
  - TS [VERIFIED: src/lib/ops-alert-contract.ts:15-27]: the same ten values.
  - Events are `"outage", "recovered"`. Causes match `"[a-z0-9_:.-]{1,64}"`.
  - `src/__tests__/ops-alert-contract-parity.test.ts` fails if only one side moves. `src/app/api/cron/ops-alert/route.ts` answers 400 for an unknown source.
- **Pointer hygiene (P-7)** is mandatory on re-registration, all in the SAME commit:
  - `FIX_TS` / `FIX_FILENAME` and `jobRefs` / marker counts in `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts`.
  - `_SWEEP_MIGRATION_NAME` in `analytics-service/tests/test_main_worker.py`.
  - The `public.compute_jobs` occurrence count (3 today; the new INSERT…SELECT adds references).
  - Part 1 counts in `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`.
  - The new migration's own STEP 2 self-verify.
  - The TS gate REDs on any later migration re-registering this jobname until it is re-pointed (header `20260819150000`, "Gates" section).
- **INT-1 reach caveat:** TODOS INT-1 shows real worker-started orphans are dropped by the analytics conjunct (`'computing'`, `'failed'`) before the ceiling evaluates, so the reachable population is the claim→mark window only. Gate arms must seed state that reaches the ceiling (no `strategy_analytics` row, as arms C4/C5/C5b do). Say plainly that the signal guards a narrow population. Do not widen the analytics conjunct: it is the protection against mass re-enqueue (INT-1 (a)).

### Pattern 5: HEAL-01, the first-hop sweep

**Finalize enqueue paths** (`src/app/api/strategies/finalize-wizard/route.ts`):
- Contribution (→ `'private'`) and composite take `runLegacyFinalize`, whose `after()` enqueues `sync_trades` (route ~2412-2433) or `stitch_composite` (composite, out of scope by F-2).
- Manager single-key (→ `'pending_review'`) goes through `postProcessKey` to Python `process_key`, which enqueues **`process_key_long`** (`analytics-service/routers/process_key.py:966-975`), not `sync_trades`.
- So the predicate must key on **no `compute_jobs` row of ANY kind** for the strategy, not "no `sync_trades` row".
- The same `after()` also touches `api_keys.last_sync_at` even when the enqueue fails (side effect `api_keys_last_sync_at_touch`). **`api_keys.last_sync_at` cannot be the "never synced" signal.**
- [VERIFIED: supabase/migrations/20260716130000_strategies_status_private.sql:61] `CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'))`.

**False-positive enumeration and how the predicate excludes each:**

| Healthy look-alike | Exclusion |
|---|---|
| Wizard in progress | `status = 'draft'` until `finalize_wizard_strategy` promotes it. Admit only `status IN ('pending_review','private')` (the two finalize terminal statuses, route :1007-1008) |
| Key validation / verification in flight | A `process_key_long` row exists, so the any-kind job conjunct excludes it |
| Archived | Not in the admitted status set |
| No key by design (CSV) | `api_key_id IS NOT NULL`. CSV strategies belong to the existing sweep (it requires `csv_daily_returns` EXISTS and no `strategy_keys`) |
| Composites | `api_key_id IS NULL` (members live in `strategy_keys`); also F-2 |
| Job rows pruned (`done` deleted at 30 d, failed at 90 d) | **Job absence alone is not "never ran".** The "never synced" conjunct must read DATA absence (no stored trades / daily rows / analytics figures for the strategy), not job absence. `/cron-sync` keeps `private`/`published` strategies current with no job rows at all |
| Contribution finalize where `decideFinalizeRerun` chose not to enqueue (complete analytics row already present) | Analytics conjunct: exclude `strategy_analytics.computation_status IN ('computing','complete','complete_with_warnings')`. Do NOT exclude `'failed'` blindly: a finalize whose enqueue errored can carry a `failed` placeholder, and that is the target |
| Freshly finalized, enqueue still in flight | Grace longer than 1 h measured from a finalize-time anchor. The existing sweep's header (`20260816140000:612-700`) records anchors already rejected. Read it before choosing (Open Question 3) |
| Re-enqueue loops forever on a bad key | A durable once-only marker table (unique per strategy) records the sweep's re-enqueue. If the re-enqueued work ends without data, the strategy shows the named state; it is never re-enqueued again |

The enqueue kind is `sync_trades` with `metadata {"source": "first-hop-sweep", "detected_at": now()}`, mirroring the existing marker shape. The named-state wording is decided at plan time (locked). The status readers that must render it: `computation_status` consumers (for example `useStrategySyncPoller`'s terminal test). Inventory them at plan time.

### Pattern 6: HEAL-05, the poll cohort

[VERIFIED: supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql, the loop's WHERE]:
```sql
      WHERE s.api_key_id IS NOT NULL
        AND s.status IN ('published', 'pending_review')
        AND EXISTS (
          SELECT 1 FROM compute_jobs cj
            WHERE cj.strategy_id = s.id
              AND cj.kind = 'sync_trades'
              AND cj.status = 'done'
              AND cj.updated_at > (now() - interval '30 days')
        )
```
- Only migration `20260412094449` defines this function (grep). It has never been re-based.
- **Change:** `status IN ('published','pending_review','private')`. Replace the compute-job conjunct with a key-health signal that `/cron-sync` maintains, for example the key's or strategy's sync cursor within 30 days.
  - `routers/cron.py` resumes from `api_keys.last_sync_at` and has a per-strategy SYNCCURSOR marker (164.5.1.4). Pick the column by reading `_sync_single_key`.
  - ⚠️ `api_keys.last_sync_at` is also touched cosmetically by finalize's `after()`, so pair it with a data-presence check or use the per-strategy cursor.
- The enqueue call itself (idempotency key `'daily-poll-' || to_char(now(),'YYYY-MM-DD') || '-' || strategy_id`) and the worker caller `daily_enqueue_tick` (`main_worker.py:1208-1220`) stay unchanged, so the enqueue stays live (F-8).
- **Re-measure before deciding** (TODOS trigger: "decide both together, with a fresh measurement"): count strategies by status, with a key, with a `/cron-sync` cursor in the last 30 days, versus with a done `sync_trades` job in the last 30 days.

### Anti-Patterns to Avoid
- **Fixing only `reclaim_stuck_compute_jobs`:** it has no live caller.
- **An FK from the new tables to `compute_jobs`:** pruning deletes the records.
- **Writing the attempt record in the claim** (capturing `last_error` before the clear): `failed_final` attempts are never re-claimed, so they would be missed. A stall reset's real cause is already lost by then.
- **Renewing the running row's `claimed_at` from the heartbeat:** it masks a yielding hung job from the watchdog.
- **A second predicate on `reconcile_dropped_enqueue_sweep` for HEAL-01:** forbidden by the locked decision and by TODOS (D-05).
- **Widening the existing sweep's analytics conjunct:** INT-1 (a).
- **Self-verify that reads `compute_jobs` rows:** refused by `lint-migration-data-dependence.mjs`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Alerting | a new Sentry/email path | `ops_alert.page` + `await_delivery` | Dedupe window, scrubbing, never-raise contract, parity with the route |
| Bridge to `strategy_analytics` | direct UPDATEs of `strategy_analytics` in the reset | `sync_strategy_analytics_status(strategy_id, job_id)` under the bridge advisory lock | Provenance, keep arms and read order are pinned in that function |
| Body-shape proof | ad hoc greps | the `pg_get_functiondef` comment-stripped regex self-verify style of `20260927120000:756-1087` | House convention; R1/R2 lint rules |
| Mutation proof | hand-run neuters only | `RED-UNDER` + `RED-UNDER-M` twins, `RED-UNDER-SETUP` (`scripts/mutation-runner/GRAMMAR.md`) | Executed on CI; counts toward the floors |

## Common Pitfalls

### Pitfall 1: The cron body re-registration jobid and pointer drift
**What goes wrong:** re-registering `reconcile_dropped_enqueue_sweep` changes its jobid and leaves sibling gates guarding the old body.
**How to avoid:** key on the jobname, and move every pointer and count in the same commit (Pattern 4).

### Pitfall 2: Mutation identity rules
**What goes wrong:** a twin edits a `TEST FAILED (` literal or a failure branch, giving `identity-rewrite`. A wrong `occurrences` count gives `occurrence-mismatch`. A twin that targets a `scripts/pg-lane/fixtures/` file is refused (rule 4). A missing `RED-UNDER-SETUP` is a hard error.
**How to avoid:** mutate the migration under test; measure `occurrences` with a count over the exact bytes.

### Pitfall 3: sql-gate-lint fixture shadowing (R5-R7)
**What goes wrong:** a gate fixture that `CREATE TABLE`s a name a migration creates (R5), another fixture's table (R6), or a policy (R7) is refused.
**How to avoid:** let the new migration create the new tables. Gate files seed rows only. Run `node scripts/lint-sql-gates.mjs --self-test && node scripts/lint-sql-gates.mjs`.

### Pitfall 4: Retention walls
- `retention_compute_jobs_done` deletes `status = 'done' AND created_at < now() - interval '30 days'` [VERIFIED: supabase/migrations/20260515113853_retention_crons_safe.sql:192-199].
- `retention_compute_jobs_failed` deletes `status IN ('failed_final', 'failed_retry') AND COALESCE(next_attempt_at, created_at) < now() - interval '90 days'` [VERIFIED: supabase/migrations/20260515210200_retention_crons_high_hardening.sql:251-258].
- No later re-registration of either was found by grep beyond the files listed. Re-check `cron.job` on PROD before relying on it.

### Pitfall 5: VAC-04 acknowledgements on function-changing migrations
Every function body a migration changes needs a `-- prod-body-ack: <hash>` pragma: the `live` column of `node scripts/sql-body-normalize.mjs --diff-bodies` for that function's drift row. It must be earned against PROD by VAC-04 on the PR, never pasted (`20260927120000:110-155`). Regenerate snapshots with `npm run schema:functions`. VAC-08 (`test-db-drift`) is RED on the PR by construction until apply-on-merge.

### Pitfall 6: Lock budget on the watchdog
Adding bridge calls to a 60 s RPC that can touch 500 rows per kind can lengthen it. The bridge takes an advisory lock per strategy and reads `compute_jobs` twice. Keep `SET LOCAL lock_timeout`. Measure on the lane with a realistic reset count. The worker retries the reset via `db_read_with_retry`.

## Code Examples

The sorted bridge loop to copy for HEAL-04 [VERIFIED: supabase/schema/functions/mark_compute_job_failed.sql:259-272]:
```sql
  FOR r_b IN
    SELECT d.strategy_id, d.job_id
      FROM (SELECT DISTINCT ON (u.strategy_id) u.strategy_id, u.job_id
              ...
     ORDER BY hashtext(d.strategy_id::text), d.strategy_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));
    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);
  END LOOP;
```

## State of the Art

| Old | Current | Impact |
|---|---|---|
| Threshold bumps per kind (`WATCHDOG_PER_KIND_OVERRIDES`) | Lease renewal for waiting rows (this phase) | The staleness clock measures silence, not batch position |
| `last_error` as the only trace (cleared on re-claim) | Append-only attempt ledger | 230 can read real nights |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Table, column and RPC names (`compute_job_attempt_failures`, `reconcile_readmit_exhaustions`, `renew_compute_job_claims`, new ops source `reconcile_readmit_ceiling`) | Patterns 1, 2, 4 | Cosmetic; pick at plan time. **RESOLVED (plans):** all four names kept: plan 01 (table), plan 03 (RPC), plan 04 (table, plus detector `record_reconcile_readmit_exhaustions`), plan 09 (ops source). Plan 05 adds `first_hop_enqueue_retries` and `first_hop_enqueue_sweep` |
| A2 | No pg_cron job or external caller invokes `reclaim_stuck_compute_jobs` on PROD (repo grep only) | Summary, Pattern 3 | If one exists, it is a live path too. Pattern 3 already covers both, so low risk. **RESOLVED (cron half):** PROD Census (d) confirms on 2026-11-23 that no pg_cron job calls it. The external-caller half still rests on a repo grep, and it does not matter: plan 02 DEC-02-A re-bases both functions |
| A3 | `/cron-sync` writes no `compute_jobs` row (no `enqueue_compute_job` in `routers/cron.py`) | Pattern 6 | If it did, the conjunct would not be the exclusion. **CORRECTED (plan 06):** false as written. `analytics-service/routers/cron.py` does call `enqueue_compute_job`: one strategy-mode `derive_broker_dailies` job for each strategy that stored rows. It still never writes a `sync_trades` compute job, so the conjunct is still the exclusion (plan 06 objective, DEC-06-A). The same correction applies to two other places. One is Summary point 4's parenthetical. The other is Pattern 5's "Job rows pruned" row, which says `/cron-sync` keeps strategies current "with no job rows at all". That row's conclusion still holds, because pruning alone makes job absence unreliable. Plan 05 DEC-05-C repeats the claim in its rationale, but its predicate does not depend on it: the corrected fact only makes job absence exclude more |
| A4 | No deadlock between the reset's row locks and the bridge advisory locks | Pattern 3 | Migration-reviewer must confirm. **Planned check:** plan 02 DEC-02-C records the order (row locks first, then the bridge advisory lock). The migration-reviewer pass before merge verifies it (plan 11's ship-records item (5)) |
| A5 | The finalize-time grace anchor and a data-based "never synced" signal exist as columns | Pattern 5 | If not, HEAL-01 needs a column or an anchor decision. **RESOLVED (plan 05):** false for the anchor. No finalize-time column exists, so DEC-05-B takes the anchor decision: the sweep's own first observation (`first_seen_at`). "Never synced" is read from data absence across existing tables (DEC-05-C). No new column |
| A6 | The unified manager arm leaves no job row when `postProcessKey` fails | Pattern 5 | If Python enqueues before failing, a `process_key_long` row exists and the sweep correctly skips it. **RESOLVED (plan 05):** moot. DEC-05-G admits `private` strategies only, so the manager arm is outside the sweep's population. DEC-05-C's job conjunct also matches by `api_key_id`, so a `process_key_long` row would exclude the strategy anyway |

## Open Questions (RESOLVED)

1. **PROD census (no observation this session).** Run read-only, marker query first, one query per MCP call: **RESOLVED (plan revision 2026-11-23):** the orchestrator's `## PROD Census` section at the end of this file answers (a) to (e) for 2026-11-23. Those are current-state counts, not invariants. Only (a) and (b) have a planned fresh re-measure before anything relies on them. (c), (d) and (e) are resolved by the census, and each line names the plan that uses the answer.
   - (a) The HEAL-01 candidate count with the full predicate. **RESOLVED:** census (a); plan 05's census note uses it, and its gate fabricates the dropped case. Fresh re-measure: plan 05 Task 3, runbook `docs/runbooks/jobledger-go-live.md` step P3 (a read-only candidate count, recorded, never acted on by hand).
   - (b) The HEAL-05 cohort: today's count versus the proposed predicate, by status. **RESOLVED:** census (b); plan 06 decides both conjuncts on it (DEC-06-A, DEC-06-B). Fresh re-measure: plan 06 Task 3, six counts by status recorded in 227-06-SUMMARY.md, where a zero private gain is reported as a finding.
   - (c) `derive_allocator_equity` jobs with attempts > 1 in the last 30 d. **RESOLVED:** census (c). By its own reading, the census cannot decide the HEAL-02 mechanism. No re-measure is planned. The mechanism is proven by plan 03's lane arm R1 (a renewed waiting row survives the real watchdog) and plan 08 Task 1's pre-dispatch fence.
   - (d) `cron.job` rows calling `reclaim_stuck_compute_jobs` or the retention jobs. **RESOLVED:** census (d): no pg_cron job calls `reclaim_stuck_compute_jobs` (the cron half of assumption A2). Plan 02 DEC-02-A re-bases both reset functions anyway. DEC-01-D (no foreign key, no retention cron) keeps the ledger outside the retention jobs the census lists. No re-measure is planned.
   - (e) The count of `orphaned_running_reaped:%` markers. **RESOLVED:** census (e): no markers in the retained window. Plan 07 DEC-07-C (no catch-up sweep) rests on that. The top real-error prefix, `Handler exceeded timeout`, is classified transient in `analytics-service/services/job_worker.py` and marked through `mark_compute_job_failed`, so plan 01's write records it as `error`. No re-measure is planned.
2. **Cause-class set.** CONTEXT names "a real error vs a stall reset vs a watchdog reset". In code the watchdog is `reset_stalled_compute_jobs`, the "stall" reclaim has no caller, and the orphan terminalizer is a third path. Recommend `error`, `watchdog_reset`, `stall_reclaim`, `orphan_reaped`. Re-registering the terminalizer cron to record `orphan_reaped` brings its own pointer-hygiene gates; decide in or defer. **RESOLVED (plan revision 2026-11-23):** decided IN, with all four classes. Plan 01 DEC-01-A's CHECK admits exactly `error`, `watchdog_reset`, `stall_reclaim` and `orphan_reaped`. Plan 02 writes the two reset classes. The terminalizer cron is NOT re-registered. Plan 07 DEC-07-A writes `orphan_reaped` through a WHEN-scoped trigger on the running-to-failed_final transition with error_kind `'orphaned'`, so the terminalizer and its pins stay untouched.
3. **HEAL-01 grace anchor and "never synced" column.** Read `20260816140000:612-700` (rejected anchors) and `finalize_wizard_strategy`'s writes before choosing. **RESOLVED (plan revision 2026-11-23):** plan 05 DEC-05-B. No finalize-time column exists, so the anchor is the sweep's own first observation (`first_seen_at`), and it re-enqueues only after 90 minutes. Rejected: `strategies.created_at`, and a new `finalized_at` column with a re-base of `finalize_wizard_strategy`. "Never synced" is DEC-05-C: data absence (no trades, csv_daily_returns or strategy_keys row, and no analytics row other than `'pending'`) plus job absence by strategy or by key. `api_keys.last_sync_at` is rejected as a signal.
4. **Worker-lost real errors.** On `MARK_FAILED_LOCK_BOUND` (55P03) and on a 55006 late mark, the real error is only logged, and the ledger would show `watchdog_reset`. Decide whether the worker should also append an `error` row through an RPC. **RESOLVED (plan revision 2026-11-23):** decided IN. Plan 01 Task 2 adds `record_compute_job_attempt_error`. It writes an `error` row when the job row attests the token (the 55P03 shape) or when a reset ledger row exists for the same claim token (the late-55006 shape), and it refuses a forged token. DEC-01-C's `UNIQUE (job_id, claim_token, cause_class)` lets one attempt carry both the reset row and the real-error row. Plan 08 Task 3 wires the worker to it, and that call never raises into the loop. Note: plan 01 cites this question as "Open Question 3", in DEC-01-C and in Task 2's action. This question is the one meant.
5. **Named-state readers (HEAL-01).** List every `computation_status` reader that must render the new state, and whether a new enum value or a `computation_error` copy carries it. **RESOLVED (plan revision 2026-11-23):** plan 05 DEC-05-E. There is no new enum value. The named state is `computation_status = 'failed'` plus a fixed `computation_error` sentence (quoted in plan 05's must_haves truths), with NULL provenance markers. The existing readers render it unchanged: SyncProgress, useStrategySyncPoller, ApiKeyManager, strategyGate and the admin review route.

## Environment Availability

| Dependency | Required By | Available | Fallback |
|---|---|---|---|
| Local Supabase stack (`scripts/local-stack/run.sh up`) | `sql-tests` lane | Not probed (Docker/CLI) | CI `sql-tests` job |
| pg-lane + pg_cron (`scripts/pg-lane/run.sh`) | mutation runner, cron-body gates | Not probed | CI `sql-mutation` job |
| Supabase MCP SQL (PROD read) | Open Question 1 | ✗ in this session | Orchestrator runs the census |

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| SQL gates | `supabase/tests/test_*.sql` (`TEST FAILED (<arm>):` idiom), on the local-stack lane (`sql-tests`) and the pg-lane mutation runner (`sql-mutation`, nightly full) |
| TS | vitest (`npm test`) |
| Python | pytest from `analytics-service/` + mypy strict |
| Quick run | `node scripts/mutation-runner/run.mjs --file supabase/tests/<gate>.sql` (diagnostic; never exits 0) |
| Full suite | `node scripts/mutation-runner/run.mjs`; `npm test`; `cd analytics-service && python -m pytest -x` |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command | File |
|---|---|---|---|---|
| MT5D-01 | Attempt 1 fails (error) then attempt 2 succeeds: ledger row readable; watchdog reset gives a distinct `watchdog_reset` row; `last_error` still NULL after re-claim (M-1137) | SQL lane | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_attempt_failures.sql` | ❌ Wave 0 |
| HEAL-02 | Back-dated waiting row renewed, so the watchdog does not reset it; token-mismatch renew is a no-op; the worker skips an unrenewed row | SQL lane + pytest | `... --file supabase/tests/test_compute_job_claim_renewal.sql`; `python -m pytest tests/test_main_worker.py -k renew` | ❌ Wave 0 |
| HEAL-03 | Strategy at ceiling gives one exhaustion row (idempotent across ticks); below ceiling gives none; reader pages once and stamps `paged_at`; parity | SQL lane + pytest + vitest | `... --file supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`; `npx vitest run src/__tests__/ops-alert-contract-parity.test.ts src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | extend existing |
| HEAL-04 | Reset, then a different sentence re-stamped under the same job id survives; status reads `computing` after reset | SQL lane | `... --file supabase/tests/test_reset_stalled_bridge_provenance.sql` | ❌ Wave 0 |
| HEAL-01 | Dropped-enqueue strategy re-enqueued once; each false-positive row in Pattern 5 not caught; retry failure gives the named state | SQL lane | `... --file supabase/tests/test_first_hop_enqueue_sweep.sql` | ❌ Wave 0 |
| HEAL-05 | Private strategy with a fresh `/cron-sync` cursor enqueued; draft/archived not; idempotent per day | SQL lane + pytest | `... --file supabase/tests/test_enqueue_poll_positions_cohort.sql`; `python -m pytest tests/test_daily_enqueue_lock.py` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the touched gate via `--file`, plus `node scripts/lint-sql-gates.mjs`, `node scripts/lint-migration-data-dependence.mjs`, and `npm run schema:functions` with an empty `git diff` afterwards.
- **Per wave merge:** the full mutation runner, `npm test`, pytest + mypy.
- **Phase gate:** all green, PROOF-01 transcripts in each SUMMARY.

### Wave 0 Gaps
- [ ] New gate files above, each with `RED-UNDER-SETUP` listing fixtures plus every migration the arm needs (including `20260516104201` and the new migration).
- [ ] Floors: a new annotated file or new arms move `FILES_FLOOR` / `ARMS_FLOOR`. `src/__tests__/mutation-runner-floors.test.ts` reports `RATCHET STALE` until `scripts/mutation-floors.mjs` is raised.
- [ ] Censuses that count gate files or arms: grep one sibling gate name across `scripts/ src/__tests__ .github/` before adding a file (memory: "a new supabase/tests file or arm moves several censuses").

## Security Domain

| ASVS | Applies | Control |
|---|---|---|
| V4 Access Control | yes | RLS enabled with no policies on the new tables; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; EXECUTE on new SECDEF RPCs for `service_role` only, asserted in self-verify (as `20260927120000:909-924`) |
| V5 Input Validation | yes | `cause_class` CHECK; RPC array-length equality check; ops detail through `scrub_alert_detail` |
| V6 Cryptography | no | — |
| SECDEF hygiene | yes | Exact `SET search_path` pin asserted against `pg_proc.proconfig` |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Error text carrying a secret into a long-lived table | Information disclosure | Same text already sits in `compute_jobs.last_error`; keep service-role-only read; no anon/auth grant |
| A forged renew extends another worker's claim | Tampering | Token fence (`claim_token` must match); service_role only |
| A page storm from a flapping exhaustion | DoS (ops) | Once per `generation_key`; `ops_alert` window |

## Sources

### Primary (HIGH, read this session)
- `analytics-service/main_worker.py` (:251-254, :336-405, :714-722, dispatch loop, :981-986, :1155-1220)
- `analytics-service/services/job_worker.py` (:985-1000, :18225)
- `supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql` (header, 5-arg body 323-560, self-verify 756-1087)
- `supabase/schema/functions/reset_stalled_compute_jobs.sql`, `reclaim_stuck_compute_jobs.sql`, `mark_compute_job_failed.sql`, `sync_strategy_analytics_status.sql` (:1-140, :584-720), `enqueue_poll_positions_for_all_strategies.sql`
- `supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql` (header + body)
- `supabase/migrations/20260906120000_computation_error_provenance.sql` (:1120-1210)
- Retention migrations `20260515113853`, `20260515210200`; `20261114130000` (:174-186); `20260716130000` (:61)
- `analytics-service/services/ops_alert.py` (:60-110, :430-438); `src/lib/ops-alert-contract.ts` (:1-35)
- `src/app/api/strategies/finalize-wizard/route.ts` (:1700-1745, :2160-2470); `analytics-service/routers/process_key.py` (:960-975); `analytics-service/routers/cron.py` (:201-221)
- `scripts/mutation-runner/GRAMMAR.md`; `TODOS.md` entries named above

### Tertiary
- None. No web sources were needed; this is an in-repo domain.

## Metadata
**Confidence breakdown:**
- HEAL-02 root cause: HIGH (code traced end to end).
- HEAL-04 mechanics: HIGH (trigger and branch (a) read).
- MT5D-01 write points: MEDIUM (terminalizer and defer bodies not read).
- HEAL-01 predicate: MEDIUM-LOW (anchor columns unread, no PROD census).
- HEAL-05: MEDIUM (cron-sync cursor column not yet chosen).

**Research date:** 2026-11-23 · **Valid until:** 2026-12-07 (fast-moving seam; re-grep for later redefinitions before each migration)

## PROD Census (orchestrator, 2026-11-23, read-only)

Taken by the phase orchestrator after research, through the Supabase MCP, one query per call. The marker query came first and named PRODUCTION. Nothing was written. Counts are current-state observations, not invariants. Re-measure before relying on them.

- **(d) `cron.job`:** no job calls `reclaim_stuck_compute_jobs` (A2 confirmed on PROD). The retention jobs are `retention_compute_jobs_done` (done rows older than 30 days, created_at), `retention_compute_jobs_failed` (failed_final/failed_retry older than 90 days on COALESCE(next_attempt_at, created_at)) and `retention_compute_jobs_orphaned_running` (hourly at :50). `reconcile_dropped_enqueue_sweep` runs at :35 hourly and `cron-sync-trades` (`cron_sync_tick()`) daily at 00:10. No pg_cron job calls `enqueue_poll_positions_for_all_strategies`. The worker (`analytics-service/main_worker.py`) calls it.
- **(c) Last 30 days, by kind/status/attempts:** `derive_allocator_equity` done/1 = 235, with no row above 1 attempt. Either the HEAL-02 double-run is not observed in the retained window, or it leaves attempts at 1 because the reset rewinds them. The gate must prove the mechanism; the census cannot. `derive_broker_dailies` done/1 = 982, done/2 = 10, failed_final/3 = 2. `poll_positions` done/1 = 19, done/2 = 1. `sync_trades` done/1 = 5, newest 2026-11-03.
- **(b) HEAL-05:** only 5 `sync_trades` jobs in 30 days, so today's "done `sync_trades` in the last 30 days" conjunct admits almost nothing. Strategies by status and key presence: private with a key = 11 (all have some job row, none have `trades` rows), private without a key = 6, published with a key = 3, pending_review with a key = 2, draft with a key = 1, archived = 20 (none have a key).
- **(a) HEAL-01:** strategies with a key and no `compute_jobs` row of any kind = 0 today. The sweep would catch nobody on today's data. Its gate must fabricate the dropped-enqueue case.
- **(e) `last_error` prefixes on retained rows:** no `orphaned_running_reaped:` markers. The top prefixes are MT5 unreachable (117), `Handler exceeded timeout` (60) and HTTP 400 (19), all failed_final. `Handler exceeded timeout` is the real-error class whose cause MT5D-01 must keep.
