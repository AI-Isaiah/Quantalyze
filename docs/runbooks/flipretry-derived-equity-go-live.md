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
2. The founder runs the **independent** E2 harness (`scripts/e2_allocator_ground_truth.py`) — anchor-consistency against a live read — and REQUIRES `exit 0` **AND** `anchor_consistency.within_same_day_tolerance === true` in the emitted JSON. Exit 0 alone only means "the run completed and printed evidence"; the PASS/FAIL verdict is the JSON field, not the exit code (see Step 4).
3. ONLY on that two-part green (exit 0 + `within_same_day_tolerance === true`) does the founder run the full enqueue + reschedule the cron.
4. The SSR flip reads the persisted `is_trustworthy` at request time (no per-request live read).

CI carries the committed harness + fixtures (`tests/test_e2_ground_truth_harness.py`, `src/lib/queries.test.ts`); the live legs below are founder-gated and must never be faked.

---

## Preconditions (Step 0)

- [ ] Plans 123-01 + 123-02 merged to `main`.
- [ ] Migration `20260719073701_claim_kind_filter.sql` auto-applied on PROD at merge — **verify the object**: `claim_compute_jobs_with_priority(integer,text,boolean,text[],text[])` exists (`::regprocedure`). A committed migration auto-applies to PROD on merge; confirm it actually ran (a red-main CI run silently skips nothing here — migrations apply — but verify regardless).
- [ ] The existing prod Railway worker is deployed **at the merge commit** — verify `commitHash` + `/health` (Railway silently SKIPS deploys on red main CI; a stale worker will not have the role logic).
- [ ] **Topology confirm (Phase 125, RESEARCH Open Q1/A2) — do this FIRST.** On the Railway dashboard, confirm whether the FastAPI API and the durable worker currently run as **ONE combined service or TWO** in project `quantalyze-analytics` / env `production`. The CLI shows a single linked service (`quantalyze-analytics`); the API/worker split may be dashboard-only. **Name the exact service that will receive `WORKER_CLAIM_ROLE=interactive`** (the one running the durable worker loop, CMD `python -m main_worker`). If today it is a single combined API+worker service, the cutover means the NEW backfill service becomes the second worker while the existing one keeps serving the API AND runs the interactive worker — decide that explicitly here.
  - **Decision (env contract, not committed config):** the `interactive`/`backfill` split is a **documented DASHBOARD ENV CONTRACT** (this runbook, Step 1), NOT a committed `analytics-service/railway.worker.toml`. Rationale: the split is Railway service+env state that lives in the dashboard, not git — a second toml **cannot bind itself to a Railway service** and would imply git controls topology it does not. **Alternative / override:** if the founder prefers a committed config file, record it as a one-file follow-up (add `analytics-service/railway.worker.toml` pointing the second service at the same image with the worker CMD) — it changes nothing operationally, it only version-controls the intent.

**Abort at any step below → jump to [Step 8 — ROLLBACK].**

---

## Step 1 — Deploy the dedicated backfill worker

Create a **second** Railway service from the same repo/image as the prod worker. This is the **dashboard env contract** (per the Step 0 decision) — a distinct SERVICE, not a replica.

**Backfill-service env contract (set on the NEW service):**

| Setting | Value | Note |
|---------|-------|------|
| Image / repo | SAME as the prod worker | one image serves both roles |
| **CMD override** | `python -m main_worker` | the Dockerfile default is `uvicorn main:app` (the API); the worker service MUST override CMD to the worker entrypoint |
| `WORKER_CLAIM_ROLE` | `backfill` (`WORKER_CLAIM_ROLE=backfill`) | → `p_kind_include=BACKFILL_KINDS`; claims ONLY `derive_broker_dailies` + `derive_allocator_equity` |
| `SUPABASE_SERVICE_KEY` | (service-role key) | **NOT `SUPABASE_SERVICE_ROLE_KEY`** — the Python worker reads `SUPABASE_SERVICE_KEY` |
| DB / exchange env | SAME set the prod worker carries | so it can reach the DB + crawl venues |
| `WORKER_HEARTBEAT_INTERVAL_S` | optional | validated in `(0, 90)`; defaults are fine — omit unless tuning |
| `PORT` / healthz | default `8080` | its own `main_worker_healthz` listens here; Railway health-checks it independently |

- **⚠️ Railway REPLICAS cannot carry distinct roles.** Scaling the existing worker to 2 replicas will NOT work — replicas share the service's env + CMD, so both would get the same `WORKER_CLAIM_ROLE`. A **distinct SERVICE** (its own env + CMD override) is required for the split (RESEARCH Pitfall 5).
- **Fail-loud guarantees (rely on these; do not add a silent default):** a typo'd `WORKER_CLAIM_ROLE` (any value outside `{all, interactive, backfill}`) raises a LOUD `ValueError` at worker startup — the service fails to boot rather than silently mis-scoping claims (`_validate_claim_role`). And as a defence-in-depth net, a `backfill` worker that ever lands on the legacy 2-arg claim (kind-filter migration absent) **REFUSES to claim** rather than take interactive jobs out-of-role (logs `claim_rpc_fallback_backfill_refused`). Since `20260719073701` is prod-applied, that fallback is a safety net, not an expected path.
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

## Step 4 — LIVE E2 ground-truth gate (E2GT-01 — founder LIVE op, `human_needed`)

**This is the E2GT-01 live-acceptance run.** It is a founder LIVE op against a real read-only exchange key — it can NEVER be claimed done from CI or without the emitted evidence JSON. The Phase-127 fixture gates (below) carry the *display* proof; this step carries the *live anchor-consistency* proof that gates the FLIP.

**1. Provision the read-only creds (Railway env only — never argv, never a tracked file).** Set on the worker service that has the allocator account's egress:

| Env var | Required | Note |
|---------|----------|------|
| `E2_GROUND_TRUTH_API_KEY` | yes | a **READ-ONLY** exchange key for the allocator account |
| `E2_GROUND_TRUTH_API_SECRET` | yes | never printed by the harness |
| `E2_GROUND_TRUTH_PASSPHRASE` | OKX-family only | omit for venues that don't use one |

Rotate the key after the run. The harness **proves the key is read-only BEFORE any data fetch** and is **read-only by construction — it NEVER writes any table** (service-role reads of `csv_daily_returns` + a live balance read only).

**2. Run from the worker's egress:**

```bash
railway ssh "cd /app && python -m scripts.e2_allocator_ground_truth \
  --exchange <venue> \
  --allocator-id <allocator_uuid> \
  --member <strategy_uuid>:<anchor_usd> [--member <strategy_uuid_2>:<anchor_usd> ...] \
  > e2-evidence.json"
```

`<anchor_usd>` is each member key's persisted terminal equity (its last-sync `allocator_holdings.value_usd`). Members may instead be supplied via `--config members.json` (`[{"strategy_id": "...", "anchor_usd": 120000}, ...]`). The optional `--same-day-drift-tol` defaults to `0.02` (2%).

**3. Interpret the result — the gate is TWO parts, exit code AND evidence field:**

| Exit | Meaning | Gate action |
|------|---------|-------------|
| `0` | The run COMPLETED and printed the sanitized evidence JSON. **This alone is NOT a pass** — you MUST then read `anchor_consistency.within_same_day_tolerance` from the JSON. | `within_same_day_tolerance === true` → **GATE GREEN**. `=== false` → the anchor DRIFTED beyond band (or a blocking degradation) → **FAIL → [Step 8 — ROLLBACK]**. |
| `2` | **FAIL-LOUD scope breach** — the key is not provably read-only (trade/withdraw scope, or the permission probe errored). | Never fetches account data. Fix the key (must be read-only), do not proceed. |
| `3` | **SKIP** — missing `E2_GROUND_TRUTH_*` env, missing member spec, or missing service-role config. **A SKIP is NOT a pass.** | Provision the env/spec and re-run. |
| `1` | Any other failure (scrubbed message to stderr). | Investigate; do not proceed. |

- **⚠️ Exit 0 does NOT imply the anchor passed.** A material live-vs-derived divergence beyond the 2% band returns `within_same_day_tolerance: false` **at exit 0** — the verdict is surfaced as EVIDENCE in the JSON, not as a non-zero exit. Following "exit 0 ⇒ flip" blindly would push a drifted curve live. Read the field.
- **NEVER widen `--same-day-drift-tol` to force `within_same_day_tolerance` true.** A divergence beyond band FAILS LOUD → **[Step 8 — ROLLBACK]**, investigate the derivation/anchors, do not go live.
- The verdict `within_same_day_tolerance` is the AND of (drift-in-band, curve `is_trustworthy`): a blocking degradation fails the gate even at zero drift. The harness scrubs evidence via the `deribit_ground_truth` `assert_sanitized`/`sanitize_evidence` contract (the P115 independence guarantee) — it does not re-derive with the compose module's own formula.

**4. The gate unblocks the downstream phases.** A two-part green (exit 0 + `within_same_day_tolerance === true`) is the precondition for **Step 5 (full backfill)**, **Phase 129 (the prod backfill-enqueue FLIP)**, and **Phase 130 (go-live)**. The E2 gate MUST be GREEN before the FLIP — no green, no flip.

## Step 5 — Full backfill enqueue

Only after Step 4 is two-part green (exit 0 **AND** `anchor_consistency.within_same_day_tolerance === true`):

```sql
SELECT enqueue_derive_broker_dailies_for_allocator_keys();
```

- **Safe to re-run:** an advisory lock (`pg_try_advisory_lock(hashtext('derive_broker_dailies_key_fanout'))`) makes concurrent runs skip; a per-`(api_key_id, UTC-date)` idempotency key + `EXCEPTION WHEN unique_violation THEN NULL` + the `compute_jobs_one_inflight_per_kind_api_key` index guarantee one in-flight `derive_broker_dailies` per key per day (pinned by the SQL gates in `supabase/tests/`).
- **Verify:** watch prod healthz stays fresh AND the dedicated worker burns the queue down. Spot-check that `allocator_equity_derived` repopulates.
- **Abort path:** **[Step 8 — ROLLBACK]** at any sign of prod-loop starvation.

## Phase 125 retention hygiene (orphaned-`running` purge) — a MIGRATION, unlike Step 6

Phase 125 landed a recurring safety sweep that keeps the queue clean and, as a side effect, kills the recurring `python` fence-test CI flake at its root:

- **`retention_compute_jobs_orphaned_running`** — a pg_cron job (`15 4 * * *`, 04:15 UTC, in the safe 1–22 hour band) that `DELETE`s `status='running'` rows whose `claimed_at` is older than `interval '2 hours'`. This one **lands as a MIGRATION** (`20260719120000`), safe on BOTH projects: the 2h window is ~3× the longest per-kind watchdog threshold (`process_key_long = 40 min`), so it never touches a legit in-flight prod job, while on the workerless TEST project (which has no watchdog) it clears the daily orphan accumulation.
  - **TEST-first apply (plan 125-03):** the migration was MCP-applied to the TEST project `qmnijlgmdhviwzwfyzlc` BEFORE merge (so the RED-guarded SQL test asserts green there), and it **auto-applies to PROD `khslejtfbuezsmvmtsdn` at merge — the founder watches the migration land** and confirms the `retention_compute_jobs_orphaned_running` `cron.job` row appears.
  - **One-time TEST cleanup (plan 125-03):** a scoped `DELETE FROM compute_jobs WHERE status='running' AND created_at < now() - interval '1 hour'` was run on `qmnijlgmdhviwzwfyzlc` alongside the migration to green CI immediately (verified no-op at execution — the project was already clean; the recurring cron prevents re-accumulation nightly). **⚠️ TEST-ONLY — never run this snippet against a live-worker project (incl. prod `khslejtfbuezsmvmtsdn`).** Its `created_at < 1h` window is looser than the recurring cron's `claimed_at < 2h` safe predicate; on a project with a running worker it could delete a legit in-flight job before the watchdog resets it. On prod the recurring migration cron (2h/`claimed_at` window) is the only orphan-purge mechanism — this one-time snippet is exclusively for the workerless TEST project.
- **Why the purge is a migration but the Step 6 reschedule is NOT:** the purge has **no worker-readiness dependency** — it is prod-safe the moment it applies (it only ever deletes definitively-orphaned rows). The Step 6 cron reschedule DOES have that dependency — if it auto-applied via a migration and the worker deploy were skipped, it would fan out backfill jobs onto the old unfiltered worker and re-wedge prod (see Step 6). So the purge auto-applies; the reschedule is a hand-run LIVE op gated on Steps 1–5.

**Founder op ordering (unambiguous):** purge migration merges (auto-applies to prod, founder watches) → cutover **Steps 1–2** (backfill service up, prod worker → `interactive`) → **Steps 3–5** (pilot enqueue, LIVE E2 gate two-part green, full backfill) → **Step 6** cron reschedule **LAST**. The purge cron's 04:15 UTC slot sits before the 05:30 UTC `derive-allocator-key-dailies` derive cron by design, so each day's sweep runs ahead of the fan-out.

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
