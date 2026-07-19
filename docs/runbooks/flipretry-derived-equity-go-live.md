# Runbook — Derived-Allocator-Equity FLIP Go-Live (FLIPRETRY, Phase 123)

**Owner:** founder (all live legs) · **Audience:** whoever executes the flip · **Risk:** re-wedging the prod worker (the v1.11 incident) if the ordering is not followed.

This runbook takes the derived-allocator-equity path from **dormant** (every allocator renders the legacy snapshot curve) to **live** (trustworthy backfilled keys render the derived cash-basis curve), WITHOUT ever showing an unvalidated curve and WITHOUT re-wedging the sequential prod worker.

## Why this document exists (the v1.11 root cause)

At v1.11 close, `phase35_backfill_enqueue` fanned out 24 keys onto the **single** sequential prod worker. A slow/hanging live exchange crawl (deribit native ledger ~inception; bybit 19k rows) blocked the asyncio event loop on an `await` → `LAST_TICK_AT` froze → healthz was stale for 12 min → the 90s auto-restart never fired. Recovery: deleted the flip jobs, emptied `allocator_equity_derived` (0 curves had ever been shown), and **unscheduled the `derive-allocator-key-dailies` cron**. The derived path has been DORMANT on legacy ever since.

Plans 123-01 and 123-02 landed the structural fixes that make go-live safe:

- **123-01:** each live exchange crawl is now bounded by `asyncio.wait_for` (`BROKER_CRAWL_TIMEOUT_S`, default 300s; `SFOX_CRAWL_TIMEOUT_S` 300s; `RECONSTRUCT_CRAWL_TIMEOUT_S` 1500s) — a hung crawl fails the job transiently instead of hanging the loop.
- **123-02:** `claim_compute_jobs_with_priority` gained a kind filter, and `main_worker` gained `WORKER_CLAIM_ROLE` (`all` | `interactive` | `backfill`) + `BACKFILL_KINDS = (derive_broker_dailies, derive_allocator_equity)`. This lets a **dedicated backfill worker** claim ONLY those kinds while the prod worker EXCLUDES them — structural isolation so backfill can never freeze the prod loop's healthz tick.

`wait_for` alone is necessary but NOT sufficient (it cannot cancel a non-yielding await on a frozen loop). **The dedicated worker is the load-bearing guarantee.** That is why the cron reschedule is dead LAST.

## The staged gate (no unvalidated curve is ever shown)

The flip is **data-driven, no flag**: `extractTrustworthyDerivedCurve` (`src/lib/queries.ts`) returns the derived curve ONLY when the persisted `is_trustworthy === true` AND the curve is well-formed and dense; otherwise the SSR path renders legacy. The safety model is:

1. Backfill writes per-key curves carrying a **self-assessed** `is_trustworthy`.
2. The founder runs the **independent** E2 harness (`scripts/e2_allocator_ground_truth.py`) — anchor-consistency against a live read — and REQUIRES `exit 0`.
3. ONLY on E2 exit 0 does the founder run the full enqueue + reschedule the cron.
4. The SSR flip reads the persisted `is_trustworthy` at request time (no per-request live read).

CI carries the committed harness + fixtures (`tests/test_e2_ground_truth_harness.py`, `src/lib/queries.test.ts`); the live legs below are founder-gated and must never be faked.

---

## Preconditions (Step 0)

- [ ] Plans 123-01 + 123-02 merged to `main`.
- [ ] Migration `20260719073701_claim_kind_filter.sql` auto-applied on PROD at merge — **verify the object**: `claim_compute_jobs_with_priority(integer,text,boolean,text[],text[])` exists (`::regprocedure`). A committed migration auto-applies to PROD on merge; confirm it actually ran (a red-main CI run silently skips nothing here — migrations apply — but verify regardless).
- [ ] The existing prod Railway worker is deployed **at the merge commit** — verify `commitHash` + `/health` (Railway silently SKIPS deploys on red main CI; a stale worker will not have the role logic).

**Abort at any step below → jump to [Step 8 — ROLLBACK].**

---

## Step 1 — Deploy the dedicated backfill worker

Create a **second** Railway service from the same repo/image as the prod worker.

- Env: `WORKER_CLAIM_ROLE=backfill` + the standard worker env (service-role key var name is **`SUPABASE_SERVICE_KEY`**, plus the same DB/exchange config the prod worker carries).
- **Verify:** the new service `/health` is 200, and its logs show it claims NOTHING while the queue holds no `derive_broker_dailies` / `derive_allocator_equity` jobs (role `backfill` → `p_kind_include=BACKFILL_KINDS`, so it only ever claims those two kinds).
- **Abort path:** if the service can't reach the DB or `WORKER_CLAIM_ROLE` fails validation (it raises loud on any non-`{all,interactive,backfill}` value), fix env and redeploy before proceeding. Nothing has been enqueued yet, so there is nothing to roll back at this step.

## Step 2 — Cut the prod worker over to `interactive`

Set `WORKER_CLAIM_ROLE=interactive` on the **existing** prod worker service and redeploy.

- Role `interactive` → `p_kind_exclude=BACKFILL_KINDS`, so the prod worker will no longer claim the backfill kinds.
- **Verify:** prod `/health` stays 200/fresh through the redeploy, and new-key connects still process end-to-end.
- **⚠️ CONSEQUENCE — from this step the dedicated backfill worker is PROD-CRITICAL for onboarding.** Broker-dailies onboarding for deribit/sfox key connects rides the `derive_broker_dailies` kind, which the prod worker now EXCLUDES. If the backfill worker is down, those onboarding jobs will NOT be claimed by anyone. Keep the backfill worker healthy for the entire time the interactive role is set.
- **Abort path:** if onboarding stalls, set `WORKER_CLAIM_ROLE=all` back on prod (restores the pre-cutover single-worker behavior) and investigate the backfill worker.

## Step 3 — Pilot enqueue + bound verification (research A1)

Enqueue exactly ONE known-heavy key (the deribit-inception key or the bybit-19k key):

```sql
SELECT enqueue_compute_job(
  p_kind          := 'derive_broker_dailies',
  p_api_key_id    := '<the-heavy-key-uuid>',
  p_idempotency_key := 'derive-dailies-<the-heavy-key-uuid>-<UTC-date>'
);
```

Watch, simultaneously:

1. **The dedicated worker's crawl duration vs the `BROKER_CRAWL_TIMEOUT_S` (300s) bound (A1).** If a *healthy* heavy crawl legitimately exceeds 300s, **raise the env bound on the backfill service** (`BROKER_CRAWL_TIMEOUT_S`, and `SFOX_CRAWL_TIMEOUT_S` for an active sfox account) BEFORE the full enqueue — otherwise every heavy key will transient-loop and never complete (the F5 failure mode). Do NOT lower it below the observed healthy crawl time.
2. **The PROD worker's healthz stays 200/fresh the entire time** — this is the FLIPRETRY-04 live proof that backfill no longer touches the prod loop.

- **Verify:** the pilot key produces a `derive_allocator_equity` follow-on and an `allocator_equity_derived` row; prod healthz never went stale.
- **Abort path:** if prod healthz goes stale during the pilot, the isolation is not holding — **[Step 8 — ROLLBACK]** and investigate the claim filter / worker roles before retrying.

## Step 4 — LIVE E2 ground-truth gate (exit 0 REQUIRED)

Set the read-only E2 creds on Railway (`E2_GROUND_TRUTH_API_KEY`, `E2_GROUND_TRUTH_API_SECRET`, `E2_GROUND_TRUTH_PASSPHRASE` if the venue needs one — a **READ-ONLY** exchange key, rotate after the run). Then, from the worker's egress:

```bash
railway ssh "cd /app && python -m scripts.e2_allocator_ground_truth \
  --exchange <venue> \
  --allocator-id <allocator_uuid> \
  --member <strategy_uuid>:<anchor_usd> [...]"
```

- **REQUIRE exit 0.** Exit 3 is a SKIP (missing env / spec) — **a SKIP is NOT a pass**. Exit 2 is a scope violation (the key is not provably read-only). A non-zero, non-skip exit is a material live-vs-derived divergence.
- **NEVER widen `--same-day-drift-tol` to make it pass.** A divergence beyond the 2% band FAILS LOUD → **[Step 8 — ROLLBACK]**, investigate the derivation/anchors, do not go live.
- The harness gates on the curve's `is_trustworthy` and scrubs evidence via the `deribit_ground_truth` `assert_sanitized`/`sanitize_evidence` contract (the P115 independence guarantee) — it does not re-derive with the compose module's own formula.

## Step 5 — Full backfill enqueue

Only after Step 4 exits 0:

```sql
SELECT enqueue_derive_broker_dailies_for_allocator_keys();
```

- **Safe to re-run:** an advisory lock (`pg_try_advisory_lock(hashtext('derive_broker_dailies_key_fanout'))`) makes concurrent runs skip; a per-`(api_key_id, UTC-date)` idempotency key + `EXCEPTION WHEN unique_violation THEN NULL` + the `compute_jobs_one_inflight_per_kind_api_key` index guarantee one in-flight `derive_broker_dailies` per key per day (pinned by the SQL gates in `supabase/tests/`).
- **Verify:** watch prod healthz stays fresh AND the dedicated worker burns the queue down. Spot-check that `allocator_equity_derived` repopulates.
- **Abort path:** **[Step 8 — ROLLBACK]** at any sign of prod-loop starvation.

## Step 6 — Reschedule the cron (LAST) — a founder LIVE SQL op, NOT a migration

Only after Steps 1–5 are all verified:

```sql
SELECT cron.schedule(
  'derive-allocator-key-dailies',
  '30 5 * * *',
  $$SELECT enqueue_derive_broker_dailies_for_allocator_keys();$$
);
```

**⚠️ This is a founder-executed live SQL op, NOT a repo migration — on purpose.** The repo migration `20260717233529` STILL contains this schedule; the cron was UNSCHEDULED live at the v1.11 recovery, so live pg_cron state and git DIVERGE intentionally. If we instead committed a new forward migration to reschedule it, that migration would **auto-apply to PROD at merge**. If the Railway worker deploy for the same merge were then **silently skipped** (the red-main-CI skip failure mode), the cron would start fanning out backfill jobs onto the OLD, unfiltered, unwrapped worker — recreating the v1.11 wedge **verbatim**. The cron may only exist once the dedicated worker + role cutover (Steps 1–2) are proven live. So it is a hand-run SQL op gated on human verification, never an auto-applying migration.

- **Verify:** `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'derive-allocator-key-dailies';` shows the job scheduled at `30 5 * * *`.

---

## Step 8 — ROLLBACK (verbatim v1.11 recovery — executable at ANY step)

Returns the system to the dormant-legacy state (0 user impact — the TS flip degrades to legacy on an empty/absent derived surface):

```sql
-- 1. Delete in-flight/pending flip jobs.
DELETE FROM compute_jobs
 WHERE kind IN ('derive_broker_dailies','derive_allocator_equity')
   AND status IN ('pending','running');

-- 2. Empty the derived surface (the TS flip renders legacy on empty — safe).
DELETE FROM allocator_equity_derived;

-- 3. Unschedule the cron.
SELECT cron.unschedule('derive-allocator-key-dailies');
```

Then, if the role isolation itself is suspect, set `WORKER_CLAIM_ROLE=all` back on the prod worker (restores single-worker behavior). **Result:** the derived path is DORMANT and every allocator renders the legacy snapshot curve, exactly as before go-live.

---

## Appendix — sFOX F5 fold

The sFOX active-account transactions crawl rides this worker for free: it is already a `venue='sfox'` branch of `run_derive_broker_dailies_job` with its own FLIPRETRY-01 `wait_for`, and the `derive_broker_dailies` kind is claimed by the dedicated backfill worker (all venues). No sFOX-specific batching is built. If an active sFOX account outruns even the dedicated worker's bound, raise `SFOX_CRAWL_TIMEOUT_S` on the **backfill service only** (Step 3, item 1).
