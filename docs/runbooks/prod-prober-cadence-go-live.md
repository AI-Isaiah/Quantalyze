# Runbook — Prod-Prober Cadence Go-Live (PROBERCADENCE, Phase 164.1.1)

**Owner:** founder (both live ops below are LIVE ops — no autonomous run may execute them) ·
**Audience:** whoever registers the observer on PROD, once, months from now, with no memory of
this phase · **Risk:** registering a live PROD `cron.job` while the committed cron-drift oracle
stays behind it. The cost is stated in
[Blast radius](#blast-radius--read-this-before-the-pre-flight-not-after-it) — read it before the
pre-flight, not after it.

## What this activates

One hourly PROD `pg_cron` job named `prod_prober_cadence_check`, running
`SELECT public.prod_prober_cadence_check();`. What it does, in one paragraph: it reads the most
recent `public.cron_runs` row under `cron_name = 'prod_prober'` — the prober's own unconditional
contact write (Phase 164.1.1 plan 01) — compares the gap since that row to the ceiling declared
inside the function as `c_contact_ceiling`, writes its own unconditional `public.cron_runs` row
under `cron_name = 'prod_prober_cadence_check'` either way, and — only when the ceiling is crossed
— posts to the existing analytics service via `POST /api/prober-cadence-alert` (Phase 164.1.1
plan 04), which logs unconditionally and escalates to Sentry at most once per hour.

**The migration that must have applied first.** `supabase/migrations/20260918120000_prod_prober_cadence.sql`
creates the function this schedule calls. If it has not applied, the job errors on every tick
rather than doing nothing: `public.prod_prober_cadence_check()` will not exist, and
`cron.job_run_details` will carry an `undefined_function` SQLSTATE on every run.

## Schedule

Minute 20 of every hour: `20 * * * *`.

⛔ **Re-derive this from the committed manifest at the time you run this session — do not trust
this paragraph.** Read as of this writing: `scripts/prod-prober/cron-manifest.json` carries the
existing hourly jobs at minutes 0 (`match_engine_cron`), 25 (`ledger_refresh_fanout`), 35
(`reconcile_dropped_enqueue_sweep`) and 50 (`retention_compute_jobs_orphaned_running`), plus one
job firing every fifteen minutes on the quarter hours (`reap_strategy_analytics_stuck_computing`).
Minute 20 collides with none of the hourly jobs. The manifest is the oracle; this paragraph is one
reading of it, taken on a date that will pass.

## Blast radius — read this BEFORE the pre-flight, not after it

Four things, each measured against the shipped code, not recalled.

1. **The committed cron-drift oracle goes stale the moment the schedule statement succeeds.**
   `scripts/prod-prober/arms/cron-drift.mjs` compares live PROD `cron.job` against the committed
   `scripts/prod-prober/cron-manifest.json` by jobname-set equality first. A new row the manifest
   does not carry is drift on every subsequent prober run — which is why the manifest re-capture
   is Step 2 of THIS session, not a follow-up task. Stopping after Step 1 leaves the repository
   reporting a regression this session caused; the remedy is to finish Step 2, never to wait it
   out or silence the arm.
2. **One `public.cron_runs` row per tick, 24 a day, unpruned.** Every other reader of that table
   is narrowed by `cron_name`, so none is perturbed — but the row count of `public.cron_runs`
   grows with no retention policy, the same precedent the `mt5_session_episode` writer already
   established for this table.
3. **When it alarms, it posts to the analytics service carrying the Vault-held
   `analytics_service_key` in an `X-Service-Key` header.** Same key, same destination
   (`{analytics_service_url}/api/prober-cadence-alert`) an existing job (`match_engine_cron_tick`)
   already posts to. No new secret leaves this database and no new destination becomes reachable.
4. **If `net.http_post` is unavailable, or the destination fails the in-body allow-list re-check,
   the tick RAISES.** That is deliberate — see the migration's own header and its step-6 comment:
   an alarm whose delivery failure is silently caught would report success for a message nobody
   received, which is this whole phase's subject, one level down. A RAISE rolls back the observer
   row written earlier in the same tick, so a tick that could not deliver leaves NO row — and
   that absence is itself the next tick's evidence.

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
  lost — re-set it before writing, never proceed on a guess. This checkout's linked CLI and the
  browser SQL editor carry no other production guard.

### P1 — the migration is applied, correctly

```sql
SELECT p.prosecdef,
       EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) c WHERE c LIKE 'search_path=%'
       ) AS search_path_pinned,
       (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',')
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.privilege_type = 'EXECUTE'
           AND (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) IN ('PUBLIC', 'anon', 'authenticated')
       ) AS disallowed_grantees
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'prod_prober_cadence_check' AND p.pronargs = 0;
```

- **Expected:** one row, `prosecdef = t`, `search_path_pinned = t`, `disallowed_grantees` NULL.
- **Abort if:** zero rows (the migration has not applied), `prosecdef = f`, `search_path_pinned = f`,
  or `disallowed_grantees` non-null.

### P2 — the destination and the key exist and are singular

```sql
SELECT count(*) AS n_keys FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';
SELECT s.value AS analytics_service_url FROM public.system_settings s WHERE s.key = 'analytics_service_url';
```

- **Expected:** `n_keys = 1`; exactly one `analytics_service_url` row whose value matches
  `^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$` (the same allow-list
  the function re-tests in its own body). This is the SAME key and destination
  `match_engine_cron_tick()` already uses, so this check is normally a formality, not a discovery.
- **Abort if:** `n_keys = 0` (the function raises, and every stale tick leaves no observer row) or
  `n_keys > 1` (the function raises for the same reason a duplicate secret name has always raised
  for its siblings); the URL is missing or fails the allow-list.

### P3 — at least one prober contact row exists

```sql
SELECT count(*) AS n, max(completed_at) AS newest FROM public.cron_runs WHERE cron_name = 'prod_prober';
```

- **Expected:** `n >= 1`.
- **If `n = 0`, this is NOT an abort — it is information you must not be surprised by.**
  Registering the observer before the prober has ever written a contact row means the observer's
  OWN first tick reads an absent contact, judges that the loudest possible stale signal, and
  alarms immediately. That is correct behaviour (see the migration's own step-2 comment) — say so
  to whoever is watching the first tick, rather than letting them read an immediate alarm as a
  bug.

### P4 — the committed manifest agrees with live PROD, BEFORE anything changes

```bash
node scripts/prod-prober/run.mjs --preflight-repoint
```

- **Expected:** exit 0, `preflight-repoint: PROD cron.job matches the committed manifest (… row(s)).
  Safe to proceed.`
- **Abort if:** non-zero. Exit 1 means the comparison ran and found a defect — read the printed
  remedy per defect kind before doing anything else. Exit 3 means nothing was measured (an
  unreadable manifest, an unlabelled database, or an unparseable `cron.job` reading) — fix that
  first; a 3 is not a pass.

### P5 — the working tree is clean

```bash
git status --short
```

- **Expected:** empty. The manifest Step 2 writes must be reviewable as a diff against a
  known-clean baseline.
- **Abort if:** any output. Commit or set aside pending work first — do not begin this runbook
  mid-edit.

---

## Step 1 — the schedule (LIVE op 1 of 2)

```sql
SELECT cron.schedule(
  'prod_prober_cadence_check',
  '20 * * * *',
  $$SELECT public.prod_prober_cadence_check();$$
);
```

`cron.schedule` UPSERTs on `(jobname, username)`, so this statement is safe to re-run. The return
value is the jobid — record it.

**Verify, in the same session:**

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'prod_prober_cadence_check';
```

- **Expected:** one row, `schedule = '20 * * * *'`, `active = t`.

⛔ **This statement lives HERE and in no migration file, and here is why.** Applied migrations
reach PROD by merge → the apply-test workflow → the Production environment's human-reviewer
gate — a path with no founder eyes on the exact moment a live `cron.job` row is written. This
checkout's linked CLI performs no write anywhere in this runbook: every write here is a SQL
statement pasted into a database session by the founder, exactly as the Phase 164.5.1 CRONREPOINT
and Phase 161.1 LEDGER-REFRESH activations were performed. A migration that wrote the live job
catalog would be the first in this repository to do so, and it would make every later merge an
unreviewed catalog write.

## Step 2 — the manifest, in the SAME session (LIVE op 2 of 2)

⚠️ **Part of the operation, not follow-up.** The moment Step 1 succeeds, PROD carries a job the
committed manifest does not, and `cron-drift` reports drift on every prober run until the
manifest is re-captured. That is the arm doing its job — the remedy is to finish this step, never
to wait it out or to silence the arm.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out /tmp/cron-manifest-capture.json
```

- **Refuses and writes nothing** on: no `--out` path; an unlabelled database; a `cron.job` record
  it cannot parse or whose count disagrees with the database's own row count (exit 3, "nothing
  was measured"); or a row that fails one of the hygiene rules (exit 1, "hygiene ran and found
  something" — the row's jobname and the rule id are printed, the offending command text never
  is). A refusal is information, not an obstacle — read it and fix the cause, never retry
  blindly.

Then, on success:

```bash
diff scripts/prod-prober/cron-manifest.json /tmp/cron-manifest-capture.json
```

- **Expected:** the ONLY change is one new job row — `prod_prober_cadence_check`, `20 * * * *`,
  active. Read the `command` text of that one new row before committing — the manifest is a
  committed, world-readable file in a public repository, and each command string is individually
  approved for publication when first captured.
- **Abort (do not move the file into place) if:** any OTHER job differs. A second unexplained
  difference means PROD drifted somewhere this runbook was not looking, and committing the
  manifest would bless it — investigate that drift before finishing this session, using the
  read-only P4 comparison again, never by editing the manifest by hand.

If the diff is exactly the one expected row:

```bash
mv /tmp/cron-manifest-capture.json scripts/prod-prober/cron-manifest.json
git add scripts/prod-prober/cron-manifest.json
git commit -m "chore(164.1.1-06): re-capture the cron manifest after registering prod_prober_cadence_check"
```

## First tick — what to expect

At minute 20: one new `public.cron_runs` row under `cron_name = 'prod_prober_cadence_check'`.
`status = 'ok'` if the prober contacted within `c_contact_ceiling`, `status = 'error'` (and one
outbound post) otherwise.

```sql
SELECT started_at, completed_at, status, error, metadata
  FROM public.cron_runs
 WHERE cron_name = 'prod_prober_cadence_check'
 ORDER BY completed_at DESC LIMIT 1;

SELECT started_at, completed_at, status, error, metadata
  FROM public.cron_runs
 WHERE cron_name = 'prod_prober'
 ORDER BY completed_at DESC LIMIT 1;
```

⛔ **A tick that RAISED leaves no row at all** — the observer's own row-write happens before the
outbound post, but a RAISE anywhere in the function rolls back the WHOLE transaction, observer row
included (see Blast radius, item 4). So an absent row after the first scheduled minute means the
tick failed outright — not that it judged fresh silently. Look at `cron.job_run_details` for the
SQLSTATE:

```sql
SELECT d.start_time, d.status, d.return_message
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'prod_prober_cadence_check'
 ORDER BY d.start_time DESC LIMIT 3;
```

⚠️ **Standing caution.** `cron.job_run_details.status` proves the job was INVOKED, never that an
async `net.http_post` delivered. This project has a dated record of seven days of 401s hiding
behind a green cron history. The delivery question is answered on the `net._http_response` side —
the distinction the prober's own `cron-obs` arm exists to make.

## Watching it

Three readings, and what each does and does not prove:

1. **The observer's own rows** (`cron_name = 'prod_prober_cadence_check'`) — its OWN liveness. A
   gap here, once pg_cron itself is confirmed alive, means this function stopped ticking.
2. **The prober's contact rows** (`cron_name = 'prod_prober'`) — what it measures. This is the
   signal the observer is judging.
3. **The analytics-service side** — whether an alert was actually received. Since Phase 164.1.1
   plan 03's checkpoint recorded outcome `a-sentry-already-set` (SENTRY_DSN confirmed set on
   Railway analytics-service production, founder-measured 2026-09-18), escalate per
   `docs/runbooks/sentry-triage.md`. ⚠️ **Standing caveat, carried forward from plans 03/04 — do
   not drop it here.** Delivery still depends on a Railway environment variable this repository
   cannot see or verify; a later unset of `SENTRY_DSN` would silently re-open the gap this phase
   exists to close.

## Rollback

```sql
SELECT cron.unschedule('prod_prober_cadence_check');
```

Then, in the SAME session, for the same reason as Step 2:

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out /tmp/cron-manifest-capture.json
diff scripts/prod-prober/cron-manifest.json /tmp/cron-manifest-capture.json   # expect: the one row REMOVED, nothing else
mv /tmp/cron-manifest-capture.json scripts/prod-prober/cron-manifest.json
git add scripts/prod-prober/cron-manifest.json
git commit -m "chore(164.1.1-06): re-capture the cron manifest after unscheduling prod_prober_cadence_check"
```

**What unscheduling costs.** The prober's cadence goes back to unobserved — the exact state
`[PROBER-CADENCE-UNDELIVERED-01]` describes. The rows already written by the observer are left in
place; nothing here reads them destructively.

## What this runbook deliberately does not cover

- **PROD `pg_cron` itself stopping.** `[PLACEHOLDER — filled in by this plan's task 3 with the
  residual id TODOS.md records]`
- **Shortening the prober's own GitHub Actions schedule to "fix" cadence.** Under the same GitHub
  throttling, a tighter cron buys more attempts, not a bounded gap — a louder claim rather than a
  measured one. This is the premise the whole phase's ceiling derivation (CTX-04) rests on;
  shortening the cron does not change GitHub's delivery rate, it only asks for more of it.
