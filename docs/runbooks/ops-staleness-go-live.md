# Runbook — Ops-Staleness Alarm Go-Live (OUTAGEALERT, Phase 164.6.8)

**Owner:** founder (both live ops below are LIVE ops — no autonomous run may execute them
without the marker query in P0 answering PRODUCTION first) · **Audience:** whoever registers the
reader on PROD, once, with no memory of this phase · **Risk:** registering a live PROD
`cron.job` while the committed cron-drift oracle stays behind it, and arming an hourly outbound
post that carries the Vault-held service key. Read
[Blast radius](#blast-radius--read-this-before-the-pre-flight-not-after-it) before the
pre-flight, not after it.

## What this activates

One hourly PROD `pg_cron` job named `ops_staleness_check`, running
`SELECT public.ops_staleness_check();`. What it does, in one paragraph: it reads two sources.
(1) The newest closed `public.cron_runs` row under `cron_name = 'cron_sync'`, the daily trade
sync's heartbeat, and pages when there is none, when it is older than the ceiling declared inside
the function as `c_cron_sync_ceiling` (2 days), or when the two newest closed rows are both
`error`. (2) The backfill queue in `public.compute_jobs` for the kinds in `c_backfill_kinds`, and
pages when an eligible job has sat unclaimed past `c_backfill_ceiling`, or a running job has
outlived that ceiling plus one watchdog tick. Every call writes ONE observer row under
`cron_name = 'ops_staleness_check'` (status `ok` or `error`, causes and minutes in `metadata`)
and, only when a source is stale, posts to the existing analytics-service route
`POST /api/prober-cadence-alert` with a `cron_name`, a `cause` and the gap. That route logs
unconditionally and escalates to Sentry and the founder email (Phase 164.6.8 plan 01).

**The migration that must have applied first.**
`supabase/migrations/20261020120000_ops_staleness_check.sql` creates the function this schedule
calls. If it has not applied, the job errors on every tick rather than doing nothing:
`public.ops_staleness_check()` will not exist and `cron.job_run_details` carries an
`undefined_function` SQLSTATE on every run. The migration registers nothing, and a raw-text test
(`src/__tests__/outagealert-migration-schedules-nothing.test.ts`) fails the build if it ever
does.

**The alert channel must be live first.** Plan 01's analytics-service route change and the Sentry
rule that notifies the founder must be deployed, or the page reaches only the service log. Check
the plan 01 SUMMARY for the rule type recorded there before Step 1.

## Schedule

Minute 40 of every hour: `40 * * * *`.

Minute 40 is the orchestrator call **O-1** in `164.6.8-CONTEXT.md` (2026-10-13): minute 35 is
already taken by `reconcile_dropped_enqueue_sweep`, and 40 is free.

⛔ **Re-derive this from the committed manifest at the time you run this session — do not trust
this paragraph.** Read as of this writing, `scripts/prod-prober/cron-manifest.json` carries the
hourly jobs at minutes 0 (`match_engine_cron`), 20 (`prod_prober_cadence_check`), 25
(`ledger_refresh_fanout`), 35 (`reconcile_dropped_enqueue_sweep`) and 50
(`retention_compute_jobs_orphaned_running`), one job on the quarter hours
(`reap_strategy_analytics_stuck_computing`) and the daily jobs from 03:00 to 05:30 UTC. Minute 40
is not among them, so `ops_staleness_check` shares its minute with no other job, is off the hour
(which carries `match_engine_cron`), and is off the :20 prober check. ⚠️ If the manifest has
gained a job at minute 40 since, pick a minute it does not carry and change it in Step 1, the
verify, the Step 2 expected diff and the first-tick note together. The manifest is the oracle;
this paragraph is one reading of it, taken on a date that will pass.

## Blast radius — read this BEFORE the pre-flight, not after it

Five things, each measured against the shipped code, not recalled.

1. **The committed cron-drift oracle goes stale the moment the schedule statement succeeds.**
   `scripts/prod-prober/arms/cron-drift.mjs` compares live PROD `cron.job` against the committed
   manifest by jobname-set equality first. A new row the manifest does not carry is drift on every
   subsequent prober run, which is why the manifest re-capture is Step 2 of THIS session, not a
   follow-up task. Stopping after Step 1 leaves the repository reporting a regression this
   session caused; the remedy is to finish Step 2, never to wait it out or silence the arm.
2. **One `public.cron_runs` row per tick, 24 a day, unpruned.** Every reader of that table is
   narrowed by `cron_name`, so none is perturbed, but the table grows with no retention policy,
   the same precedent `prod_prober_cadence_check` set.
3. **When it alarms, it posts to the analytics service carrying the Vault-held
   `analytics_service_key` in an `X-Service-Key` header.** Same key and same destination host
   (`{analytics_service_url}/api/prober-cadence-alert`) that `match_engine_cron_tick` and
   `cron_sync_tick` already use. No new secret leaves this database and no new destination
   becomes reachable.
4. **If `net.http_post` is unavailable, or the destination fails the in-body allow-list re-check,
   or the key is missing or not unique, the tick RAISES.** That is deliberate: an alarm whose
   delivery failure is silently caught reports success for a message nobody received. A RAISE
   rolls back the observer row written earlier in the same tick, so a tick that could not
   deliver leaves NO row, and that absence is itself the next tick's evidence.
5. **It reports `never_ran` until a `cron_sync` heartbeat exists.** If the daily trade sync has
   not produced its first closed `cron_sync` row yet, the first scheduled tick pages with cause
   `never_ran`. That is correct behaviour, not a bug. Either register after the first daily sync
   has written a heartbeat (P3 tells you whether it has) or expect and acknowledge that one
   page.

## Pre-flight — ALL BLOCKING

Any item below that does not return its expected answer is an ABORT: do not run Step 1.

### P0 — which database is this? (FIRST, every session)

`current_database()` is `postgres` on both projects and proves nothing. Before any statement
below that writes:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

- **Expected:** the hand-set marker naming PRODUCTION (see `CLAUDE.md`, "Which database am I
  on?").
- **Abort if:** it names anything else, or comes back NULL. A NULL marker means the label was
  lost: re-set it before writing, never proceed on a guess. This checkout's linked CLI and the
  browser SQL editor carry no other production guard.

### P1 — the function is applied, correctly

```sql
SELECT p.prosecdef,
       EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) c WHERE c LIKE 'search_path=%'
       ) AS search_path_pinned,
       (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',')
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.privilege_type = 'EXECUTE'
           AND (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
               IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
       ) AS disallowed_grantees
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'ops_staleness_check' AND p.pronargs = 0;
```

- **Expected:** one row, `prosecdef = t`, `search_path_pinned = t`, `disallowed_grantees` NULL
  (EXECUTE is held by the owner alone).
- **Abort if:** zero rows (the migration has not applied), `prosecdef = f`,
  `search_path_pinned = f`, or `disallowed_grantees` non-null.

### P2 — the key and the destination exist and are singular (counts only)

```sql
SELECT count(*) AS n_keys FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';

SELECT count(*) AS n_url_rows,
       count(*) FILTER (WHERE s.value ~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$')
         AS n_url_allowed
  FROM public.system_settings s WHERE s.key = 'analytics_service_url';
```

- **Expected:** `n_keys = 1`, `n_url_rows = 1`, `n_url_allowed = 1`. This is the same key and
  destination `match_engine_cron_tick()` and `cron_sync_tick()` use, so the check is normally a
  formality. The statements return counts on purpose: never print the key, and do not paste the
  URL value into a ticket or a commit.
- **Abort if:** `n_keys <> 1` (the function raises on a missing or duplicate secret, so every
  stale tick would leave no observer row), or `n_url_rows <> 1`, or `n_url_allowed <> 1`.

### P3 — has the trade sync written a heartbeat? (information, not an abort)

```sql
SELECT count(*) AS n_heartbeats, max(completed_at) AS newest
  FROM public.cron_runs WHERE cron_name = 'cron_sync' AND completed_at IS NOT NULL;
```

- **Expected:** `n_heartbeats >= 1`.
- **If `n_heartbeats = 0`, this is NOT an abort.** The first scheduled tick will page with cause
  `never_ran` (blast radius item 5). Say so to whoever is watching, rather than letting them read
  the page as a defect. Prefer to register after the first daily sync.
- ⛔ **Do NOT call `public.ops_staleness_check()` by hand to "see what it says".** A manual call
  runs the whole function: when a source is stale it writes an observer row AND queues a live
  outbound post carrying the service key. The first tick is the first call.

### P4 — the committed manifest agrees with live PROD, BEFORE anything changes

```bash
node scripts/prod-prober/run.mjs --preflight-repoint
```

- **Expected:** exit 0, `preflight-repoint: PROD cron.job matches the committed manifest (...
  row(s)). Safe to proceed.`
- **Abort if:** non-zero. Exit 1 means the comparison ran and found a defect: read the printed
  remedy per defect kind first. Exit 3 means nothing was measured (an unreadable manifest, an
  unlabelled database, or an unparseable `cron.job` reading): fix that first; a 3 is not a pass.

### P5 — the working tree is clean

```bash
git status --short
```

- **Expected:** empty. The manifest Step 2 writes must be reviewable as a diff against a
  known-clean baseline.
- **Abort if:** any output. Commit or set aside pending work first.

### P6 — the deploy window

Step 2 ends with a commit on a branch that is later merged. A merge to `main` redeploys the
analytics service, which would cut a running `cron_sync` request and strand in-flight derives on
the backfill service. On a trade-sync tick day, merge nothing to `main`, from any phase, from
04:00 UTC to 05:45 UTC (**MOVED 2026-10-26 (Phase 167.2.1.1.1 NAVMTM, D-03):** from the live move
recorded in `docs/runbooks/navmtm-chain-move-go-live.md` the window is 00:00 UTC to 01:45 UTC; before that move this one applies).
The registration itself (Steps 1 and 2) deploys nothing and can run at
any time outside that window; only the later merge of the manifest branch is held.

---

## Step 1 — the schedule (LIVE op 1 of 2)

```sql
SELECT cron.schedule(
  'ops_staleness_check',
  '40 * * * *',
  $$SELECT public.ops_staleness_check();$$
);
```

`cron.schedule` UPSERTs on `(jobname, username)`, so this statement is safe to re-run. The return
value is the jobid: record it.

**Verify, in the same session:**

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'ops_staleness_check';
```

- **Expected:** one row, `schedule = '40 * * * *'`, `active = t`.

⛔ **This statement lives HERE and in no migration file, and here is why.** Applied migrations
reach PROD by merge, then the apply-test workflow, then an automatic PROD apply: since
2026-09-23 there is no human reviewer between the merge and the write. A migration that wrote the
live job catalog would arm a secret-bearing outbound post on merge with no founder eyes on the
moment it happens, and would make every later merge an unreviewed catalog write. Every write in
this runbook is a SQL statement pasted into a database session by the founder.

## Step 2 — the manifest, in the SAME session (LIVE op 2 of 2)

⚠️ **Part of the operation, not follow-up.** The moment Step 1 succeeds, PROD carries a job the
committed manifest does not, and `cron-drift` reports drift on every prober run until the
manifest is re-captured. That is the arm doing its job: the remedy is to finish this step, never
to wait it out or silence the arm.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out /tmp/cron-manifest-capture.json
```

- **Refuses and writes nothing** on: no `--out` path; an unlabelled database; a `cron.job`
  record it cannot parse or whose count disagrees with the database's own row count (exit 3,
  "nothing was measured"); or a row that fails a hygiene rule (exit 1, "hygiene ran and found
  something": the row's jobname and the rule id are printed, the offending command text never is).
  A refusal is information, not an obstacle: read it and fix the cause, never retry blindly.

Then, on success:

```bash
diff scripts/prod-prober/cron-manifest.json /tmp/cron-manifest-capture.json
```

- **Expected:** the ONLY change is one new job row, `ops_staleness_check`, `40 * * * *`, active.
  Read the `command` text of that one new row before committing: the manifest is a committed,
  world-readable file in a public repository.
- **Abort (do not move the file into place) if:** any OTHER job differs. A second unexplained
  difference means PROD drifted somewhere this runbook was not looking, and committing the
  manifest would bless it. Investigate that drift with the read-only P4 comparison, never by
  editing the manifest by hand.

If the diff is exactly the one expected row, on a branch (never on `main`):

```bash
mv /tmp/cron-manifest-capture.json scripts/prod-prober/cron-manifest.json
git add scripts/prod-prober/cron-manifest.json
git commit -m "chore(164.6.8): re-capture the cron manifest after registering ops_staleness_check"
```

Merge that branch outside the P6 window.

## First tick — what to expect

At minute 40: one new `public.cron_runs` row under `cron_name = 'ops_staleness_check'`.
`status = 'ok'` when both sources are healthy; `status = 'error'` (and one outbound post per stale
source) otherwise.

```sql
SELECT started_at, completed_at, status, error, metadata
  FROM public.cron_runs
 WHERE cron_name = 'ops_staleness_check'
 ORDER BY completed_at DESC LIMIT 1;
```

`metadata` carries `cron_sync_cause`, `cron_sync_gap_minutes`, `backfill_cause` and
`backfill_gap_minutes`. If a post was queued, read what the analytics service answered by hand:

```sql
SELECT id, status_code, created
  FROM net._http_response
 ORDER BY created DESC LIMIT 5;
```

⛔ **A tick that RAISED leaves no row at all**: a RAISE anywhere in the function rolls back the
whole transaction, observer row included (blast radius item 4). So an absent row after the first
scheduled minute means the tick failed outright, not that it judged both sources healthy. Look at
`cron.job_run_details` for the SQLSTATE:

```sql
SELECT d.start_time, d.status, d.return_message
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'ops_staleness_check'
 ORDER BY d.start_time DESC LIMIT 3;
```

⚠️ **Standing caution.** `cron.job_run_details.status` proves the job was INVOKED, never that an
async `net.http_post` delivered. This project has a dated record of seven days of 401s hiding
behind a green cron history. Delivery is answered on the `net._http_response` side, and reading
it is a MANUAL check today, as it is for the prober cadence check: nothing automated watches this
function's own posts. `net._http_response` carries no job id, so match a response to a tick by
time, not by key.

## Watching it

1. **The observer's own rows** (`cron_name = 'ops_staleness_check'`): its OWN liveness. A gap
   here, once `pg_cron` itself is confirmed alive, means this function stopped ticking.
2. **The heartbeats it judges** (`cron_name = 'cron_sync'`) and the queue it judges
   (`public.compute_jobs`, kinds `derive_broker_dailies` and `derive_allocator_equity`).
3. **The analytics-service side**: whether an alert was actually received. Escalate per
   `docs/runbooks/sentry-triage.md`. ⚠️ Delivery still depends on a Railway environment
   variable this repository cannot see (`SENTRY_DSN`) and on the Sentry rule recorded in plan 01;
   a later change to either would silently re-open the gap this phase exists to close.

There is no recovered notice for these two sources: the function pages while a source is stale
and stays quiet when it recovers. The next `ok` observer row is the recovery evidence.

## Rollback

```sql
SELECT cron.unschedule('ops_staleness_check');
```

Then, in the SAME session, for the same reason as Step 2:

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out /tmp/cron-manifest-capture.json
diff scripts/prod-prober/cron-manifest.json /tmp/cron-manifest-capture.json   # expect: the one row REMOVED, nothing else
mv /tmp/cron-manifest-capture.json scripts/prod-prober/cron-manifest.json
git add scripts/prod-prober/cron-manifest.json
git commit -m "chore(164.6.8): re-capture the cron manifest after unscheduling ops_staleness_check"
```

Unscheduling is the whole rollback while the function stays. To remove the function as well,
unschedule FIRST, then run `supabase/migrations/down/20261020120000-rollback.sql` through its own
migration PR after the marker query names the database; it refuses on a database that does not
carry the function and leaves the observer rows and the ledger row in place.

**What unscheduling costs.** The daily trade-sync heartbeat and the backfill queue go back to
unobserved: nothing pages when either goes quiet. The observer rows already written are left in
place; nothing here reads them destructively.

## What this runbook deliberately does not cover

- **PROD `pg_cron` itself stopping.** Nothing in this repository periodically checks `pg_cron`'s
  own liveness independently of any specific job's body, so if it stops, this reader stops
  silently with it (the standing `[PGCRON-LIVENESS-UNWATCHED-01]` residual in `TODOS.md`). A human
  can run `SELECT public.latest_cron_success('ops_staleness_check');` by hand and see the silence;
  that is a query somebody has to decide to run, never coverage.
- **Automated delivery verification for this function's own post.** The prober's `cron-obs` arm
  watches one named job, not this one, and `net._http_response` cannot be attributed to a job.
  The `net._http_response` query in "First tick" is manual.
- **A recovered notice.** Not built for these two sources (the MT5 outage source has its own).
