# Deploy runbook — Migration 117 (compute_jobs claim-token fence)

audit-2026-05-07 P97 / G12.A.2 (CRITICAL). PR #149.

This is the operational playbook for shipping migration 117 + the Python
worker companion change. It covers pre-deploy queue drain, the safe
deploy sequence, post-deploy verification, the LATE_MARK_IGNORED alert
threshold, the rollout-window risk, and rollback.

> The migration is **forward-compatible by design**: `p_claim_token`
> defaults to NULL on the Postgres side, so legacy callers (admin
> runbook, Edge Functions, pre-redeploy worker processes still in
> flight) continue to function — they hit the back-compat `p_claim_token
> IS NULL` branch and skip the fence. The fence engages once the new
> Python worker code is deployed and the next claim cycle stamps a
> token.

---

## 1. Pre-deploy: drain dead workers

Worker processes whose `claimed_at` is more than 30 minutes old are very
likely dead (the sync_trades watchdog override is 30 min; legitimate
in-flight rows never sit beyond that). Flip these back to `pending`
before applying the migration so STEP 1.5's `UPDATE` only stamps tokens
on rows that genuinely belong to a live worker:

```sql
UPDATE compute_jobs
   SET status = 'pending',
       claimed_at = NULL,
       claimed_by = NULL,
       last_error = 'pre-mig-117 drain (dead worker)'
 WHERE status = 'running'
   AND claimed_at < now() - interval '30 minutes';
```

This is optional but reduces the rollout-window noise window (see §5).

## 2. Apply migration 117

```bash
supabase db push   # or your usual migration runner
```

The migration runs inside a single `BEGIN; … COMMIT;` block. STEP 1.5
backfills `claim_token = gen_random_uuid()` for every pre-existing
`status='running'` row so the fence isn't a no-op for in-flight work.
STEP 7's DO-block self-verifies (overload count = 1, body shape, dedupe
shape) and raises on any drift — if STEP 7 fails, the whole migration
rolls back.

## 3. Verify the schema landed

```sql
-- column exists, nullable, type UUID
SELECT data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'compute_jobs'
   AND column_name  = 'claim_token';
-- → uuid | YES

-- exactly one overload of each mark RPC
SELECT proname, count(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND proname IN ('mark_compute_job_done', 'mark_compute_job_failed')
 GROUP BY proname;
-- → mark_compute_job_done   | 1
-- → mark_compute_job_failed | 1

-- backfill ran: no running rows without a token
SELECT count(*) FROM compute_jobs
 WHERE status = 'running' AND claim_token IS NULL;
-- → 0     ← required. If non-zero, STEP 1.5 was skipped or a worker
--           pre-deploy started a job between STEP 1.5 and now without
--           the new code path. Run the STEP 1.5 UPDATE manually:
--             UPDATE compute_jobs SET claim_token = gen_random_uuid()
--             WHERE status='running' AND claim_token IS NULL;
```

## 4. Redeploy the Python worker (analytics-service)

`analytics-service/main_worker.py` already threads `p_claim_token` and
catches `serialization_failure`. Redeploy on Railway:

```bash
git push railway audit/p97-claim-token-fencing:main   # or whatever path
```

Watch the deploy logs for two markers:
1. `Worker starting as worker-<host>-<pid>` — process came up.
2. `Claimed N jobs: [<uuid>, ...]` — claim cycle completed. From this
   point on, every new mark call carries `p_claim_token`.

## 5. Rollout window risk (the known edge case)

Between **STEP 1.5 backfill** and **first redeployed-worker claim**, the
fence is a no-op for any worker process that was already running before
the deploy:

- Worker W1 (old code, pre-deploy) is mid-sync_trades on row R.
- Migration applies, STEP 1.5 stamps `R.claim_token = T_backfill`.
- W1 finishes its handler and calls
  `mark_compute_job_done(R, /* no p_claim_token */)`. PostgreSQL
  defaults `p_claim_token` to NULL → fence WHERE clause is
  `(NULL IS NULL OR claim_token = NULL)` → match → row flips done.
- This is expected and harmless: W1 is the legitimate worker for R.

If W1 was preempted by a watchdog reclaim during the deploy:
- STEP 1.5 stamps `R.claim_token = T_backfill`.
- Watchdog runs, NULLs `R.claim_token`, flips R to `pending`.
- W2 (redeployed, new code) claims R, stamps fresh `T_new`.
- W1 finishes its handler and calls `mark_compute_job_done(R)` with
  NULL token. The new RPC's WHERE clause is
  `(NULL IS NULL OR claim_token = NULL)` against a row with
  `claim_token = T_new` → the `IS NULL` branch wins → fence SKIPPED →
  row flips done.

**This is the documented residual risk for the deploy window only.** It
shrinks to zero as soon as every worker is on the new code path
(workers redeploy on every Railway push) and STEP 1.5 backfill ran.

After the rollout window: every claim stamps a fresh token, every mark
carries it, the fence is fully engaged.

## 6. LATE_MARK_IGNORED — baseline + alert threshold

The Python worker logs `LATE_MARK_IGNORED` at WARNING when a mark RPC
raises `serialization_failure` (SQLSTATE 40001). This is the
**expected** late-mark path: the watchdog reclaimed the row and a
second worker has taken over. The original worker logs and moves on
without retry.

| Metric                          | Baseline (steady state) | Alert threshold |
| ------------------------------- | ----------------------- | --------------- |
| LATE_MARK_IGNORED / day         | ~10                     | >100            |
| LATE_MARK_IGNORED / 5min        | ~1                      | >10             |

**Below baseline**: a healthy queue rarely preempts. ~10/day corresponds
to the sync_trades 30-min override edge cases (a backfill that
legitimately exceeds 30 min, e.g., a strategy with a multi-year OKX
archive scan).

**Above threshold**: investigate.
1. Verify the message contains `preempted by watchdog reclaim`:
   ```bash
   grep LATE_MARK_IGNORED <railway-log> | head -20
   ```
2. If the message text matches, check which kinds are preempting:
   ```sql
   SELECT kind, count(*) FROM compute_jobs
    WHERE last_error = 'worker_stalled'
      AND updated_at > now() - interval '1 hour'
    GROUP BY kind;
   ```
   * If `sync_trades` dominates → an exchange backfill is exceeding 30
     min. Raise the watchdog override or chunk the backfill.
   * If `compute_analytics` dominates → handler timeout drift; check
     `services.job_worker.TIMEOUT_PER_KIND` vs.
     `WATCHDOG_PER_KIND_OVERRIDES`. Test
     `test_watchdog_threshold_exceeds_handler_timeout` pins this.
3. If the message text does NOT match (some OTHER 40001 source —
   serializable-isolation conflict, lock-timeout retry, etc.), this is
   NOT a P97 preemption. Escalate: a 40001 from elsewhere is being
   misclassified as a late mark and the worker is silently swallowing
   it. Check `_is_serialization_failure` in main_worker.py — review fix
   I4 tightened it to `code == '40001'` or `'preempted by watchdog
   reclaim'` in message, so the fuzzy `'40001' in msg` /
   `'serialization_failure' in msg` paths no longer collide.

## 7. Rollback

The pre-mig-117 mark RPCs (mig 109) and claim RPC (mig 104) are
restorable verbatim. Rollback script:

```sql
BEGIN;

-- Restore mig 109 P6 mark_compute_job_done (1-arg)
DROP FUNCTION IF EXISTS mark_compute_job_done(UUID, UUID);
-- Paste mig 109's CREATE OR REPLACE FUNCTION mark_compute_job_done(p_job_id UUID) body verbatim

-- Restore mig 109 P4 mark_compute_job_failed (3-arg)
DROP FUNCTION IF EXISTS mark_compute_job_failed(UUID, TEXT, TEXT, UUID);
-- Paste mig 109's CREATE OR REPLACE FUNCTION mark_compute_job_failed(...) 3-arg body verbatim

-- Restore mig 104 claim_compute_jobs_with_priority (no claim_token stamp)
-- Paste mig 104's CREATE OR REPLACE body verbatim

-- Restore mig 033 reset_stalled_compute_jobs (no claim_token NULL-out)
-- Paste mig 033's CREATE OR REPLACE body verbatim

-- Drop the column (last — anything that reads claim_token must already
-- be rolled back at this point)
ALTER TABLE compute_jobs DROP COLUMN IF EXISTS claim_token;

COMMIT;
```

Then redeploy the Python worker WITHOUT the mig 117 companion changes
(`git revert 6cd7ebd` and the dependent commits on this branch). The
worker tolerates the missing column because mig 117 made
`p_claim_token` optional and `claim_token` lives only in the row
payload — old-code workers that don't read it continue to function.

## 8. Known gap: Race B cursor regression (NOT closed by this PR)

PR #149 closes **Race A** (mark_compute_job_done late-flip by preempted
worker, see `.planning/audit-2026-05-07/INVEST-P97.md` §Recommendation).

**Race B** — cursor regression via concurrent `sync_trades` runs — is
NOT closed by the claim-token fence. The cursor write in
`run_sync_trades_job` is still last-writer-wins. INVEST-P97 §"File:line
targets" calls out the cursor-advance fence as an **optional** follow-up
and explicitly scopes it OUT of this PR.

Mitigation in production until a follow-up lands:
* **Metric to watch**: count of strategies where
  `api_keys.last_fetched_trade_timestamp` decreases between consecutive
  ticks (regression event). The dispatch_tick should not normally make
  that field go backward.
  ```sql
  -- Pseudocode for the alert: compare current vs. previous snapshot
  SELECT id, last_fetched_trade_timestamp
    FROM api_keys
   WHERE updated_at > now() - interval '5 minutes';
  -- Compare against the same row 5 minutes ago; flag any decrease.
  ```
* **Follow-up tracking**: a new P-number (TBD) for the cursor-advance
  fence — `run_sync_trades_job` reads `claim_token` from the claimed row
  and writes the cursor update with `WHERE strategy_id = $1 AND
  current_claim_token = $token` (or equivalent). Until that ships,
  count any cursor regression as a Race B occurrence and investigate
  the contemporaneous compute_jobs rows for sync_trades.

## 9. Related references

- `.planning/audit-2026-05-07/INVEST-P97.md` — full investigation (the
  Race A / Race B taxonomy, why migrations 102 / 110 didn't close it).
- `supabase/migrations/117_compute_jobs_claim_token_fencing.sql` — the
  migration this runbook deploys.
- `analytics-service/main_worker.py` — the dispatch_tick + watchdog
  worker code; threads `p_claim_token` and detects 40001.
- `analytics-service/tests/test_compute_jobs_fencing.py` — live-DB +
  mocked regression tests for the fence.
- `docs/runbooks/compute-queue.md` — the broader compute_jobs runbook.
