# Runbook — First-Hop Enqueue Sweep Go-Live (JOBLEDGER, Phase 227, HEAL-01)

**Owner:** founder (the live ops below are LIVE PROD ops; no autonomous run may execute them
without the marker query in P0 answering PRODUCTION first) · **Audience:** whoever registers the
sweep on PROD, once, with no memory of this phase · **Risk:** registering a live PROD `cron.job`
while the committed cron-drift oracle stays behind it, and arming an hourly job that inserts
compute jobs and writes a user-visible analytics status. Read
[Blast radius](#blast-radius--read-this-before-the-pre-flight-not-after-it) before the
pre-flight, not after it.

## What this activates

One hourly PROD `pg_cron` job named `first_hop_enqueue_sweep`, running
`SELECT public.first_hop_enqueue_sweep();`. What it does, in one paragraph: a strategy finalized
through the wizard as a contribution (status `private`, one active connected key) gets its first
`sync_trades` job from an `after()` side effect of the finalize route, and nothing re-tries that
enqueue if it drops. The sweep finds such a strategy (no job of any kind by strategy or by key, no
trades, no daily returns, no composite members, no analytics row beyond `pending`), records when it
first saw it in `public.first_hop_enqueue_retries`, and only after it has been observed for more
than 90 minutes inserts one `sync_trades` job with `metadata.source = 'first-hop-sweep'`. It does
this at most once per strategy, ever. If that retry also ends without a result (every job of the
strategy `failed_final`, analytics row absent or still `pending`), the strategy reads
`computation_status = 'failed'` with the sentence defined once as `c_named_state_copy` inside the
function, and no provenance markers. Founder ruling 2026-11-23 (HEAL-01); the decisions are
DEC-05-A to DEC-05-G in plan 05 and the migration header.

**The migration that must have applied first.**
`supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql` creates the table and the function
this schedule calls. If it has not applied, the job errors on every tick: the function will not
exist and `cron.job_run_details` carries an `undefined_function` SQLSTATE on every run. The
migration registers nothing.

## Why the schedule is not a migration

The Phase 164.7 rule, restated as D-02 in `docs/runbooks/derivecron-go-live.md` and D-10 in
`src/__tests__/outagealert-migration-schedules-nothing.test.ts`: a migration never schedules.
Merged migrations reach PROD by merge, then the apply-test workflow, then an automatic PROD apply,
with no human reviewer between the merge and the write. A migration that wrote the live job catalog
would arm an unattended job on merge with no founder eyes on the moment, so every write in this
runbook is a SQL statement the founder pastes into a database session.

⚠️ **The window, in these words: from the merge until Step 1 runs, the first-hop sweep does not
fire.** During that window a dropped first `sync_trades` enqueue strands exactly as it does today.
HEAL-01 is therefore recorded as lane-proven with PROD registration pending until Step 1b below has
been run and its output pasted into the Phase 227 verification report.

Plan 09's reader and plan 04's detector are worker-driven (the reader runs in the worker's
`watchdog_loop` and calls the detector first) and need no registration; this sweep is the only
Phase 227 job that does.

## Schedule

Minute 55 of every hour: `55 * * * *` (DEC-05-F).

⛔ **Re-derive this from the committed manifest at the time you run this session; do not trust this
paragraph.** P2 prints the occupied slots. Read as of this writing, the manifest's hourly jobs sit
at minutes 0 (`match_engine_cron`), 20 (`prod_prober_cadence_check`), 25 (`ledger_refresh_fanout`),
35 (`reconcile_dropped_enqueue_sweep`), 40 (`ops_staleness_check`) and 50
(`retention_compute_jobs_orphaned_running`), plus one job on every quarter hour
(`reap_strategy_analytics_stuck_computing`, so 0, 15, 30 and 45). Minute 55 is not among them. If
the manifest has gained a job at minute 55 since, pick a free minute and change it in Step 1, Step
1b, the Step 2 expected diff and the first-tick note together. The manifest is the oracle; this
paragraph is one reading of it, taken on a date that will pass.

## Blast radius — read this BEFORE the pre-flight, not after it

1. **The committed cron-drift oracle goes stale the moment Step 1 succeeds.**
   `scripts/prod-prober/arms/cron-drift.mjs` compares live PROD `cron.job` against the committed
   manifest by jobname-set equality first, so a new row the manifest does not carry is drift on
   every later prober run. That is why the manifest re-capture is Step 2 of THIS session, not a
   follow-up. Stopping after Step 1 leaves the repository reporting a regression this session
   caused; finish Step 2, never wait it out or silence the arm.
2. **It inserts compute jobs.** The sweep inserts at most 25 `sync_trades` rows per tick, each
   against a strategy's own key. A strategy is re-enqueued once, ever, so a bad key is tried against
   an exchange once and not every hour.
3. **It can write a user-visible status.** Only the named-state sentence, only onto an absent or
   `pending` analytics row, only after a failed retry. A row the status bridge already wrote as
   `failed` is never overwritten.
4. **PROD reachability is 0 on measured data.** RESEARCH census (a): no keyed strategy lacked a job
   row when the plan was written, so the first ticks are expected to do nothing. P3 re-reads that
   count; a non-zero count is reported and never acted on by hand.
5. **A RAISE leaves nothing behind.** The function writes inside one transaction per tick; a tick
   that raises rolls back its own observations and inserts.

## Environment

Run everything from the repo root of the checkout that holds this file.

```bash
export JL_SP="${JL_SP:-$HOME/.cache/quantalyze/jobledger-227}"; mkdir -p "$JL_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link (`supabase/.temp/project-ref`) exists only
  there, and it targets PRODUCTION.
- **MCP first.** The Supabase MCP `execute_sql` against the PROD project is the preferred way to
  run every read here. The CLI is the fallback: ONE query per call, never chained (the CLI returns
  only the LAST statement's rows).
- Every SQL file lives in `JL_SP`, outside the repo, never in a tracked path.
- Tracked text is counts-only: no project refs, job ids, owner ids, emails, account numbers or home
  paths. Do not paste any of them into the verification report either.

### Rendering a guarded write

A write never runs bare. This renderer reads `database_marker` from the committed manifest (never
hand-type the marker string) and prepends a guard that RAISES unless the database's own comment
equals it. A NULL marker (the label was lost) refuses exactly as a mismatched one does.

```bash
cat > "$JL_SP/guard.mjs" <<'JS'
import fs from "node:fs";
const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) {
  process.stderr.write("guard: database_marker unusable\n");
  process.exit(2);
}
const body = fs.readFileSync(process.argv[2], "utf8");
const guard =
  "DO $guard$\nBEGIN\n" +
  "  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM $m$" +
  marker +
  "$m$ THEN\n    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';\n  END IF;\nEND\n$guard$;\n";
process.stdout.write(guard + body);
JS
```

Usage: write the statement to `$JL_SP/<name>.sql`, render
`node "$JL_SP/guard.mjs" "$JL_SP/<name>.sql" > "$JL_SP/<name>-guarded.sql"`, then run the guarded
file through the MCP `execute_sql`, or `q "$JL_SP/<name>-guarded.sql"`.

## Pre-flight — ALL BLOCKING

Any item below that does not return its expected answer is an ABORT: do not run Step 1.

### P0 — which database is this? (FIRST, every session, its own call)

`current_database()` is `postgres` on both projects and proves nothing. Run this as its own call:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

- **Expected:** the hand-set marker naming PRODUCTION (`CLAUDE.md`, "Which database am I on?").
  Record the answer; it is pasted into the verification report beside the Step 1b output.
- **Abort if:** it names anything else, or comes back NULL. A NULL marker means the label was lost:
  re-set it before writing, never proceed on a guess.

### P1 — the function is applied, correctly (read-only)

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
 WHERE n.nspname = 'public' AND p.proname = 'first_hop_enqueue_sweep' AND p.pronargs = 0;
```

- **Expected:** one row, `prosecdef = t`, `search_path_pinned = t`, `disallowed_grantees` NULL
  (EXECUTE is held by the owner alone).
- **Abort if:** zero rows (the migration has not applied), `prosecdef = f`, `search_path_pinned = f`,
  or `disallowed_grantees` non-null.

### P2 — slot occupancy and no existing job of this name

```bash
node -e 'const j=require("./scripts/prod-prober/cron-manifest.json").jobs.filter(x=>x.active).sort((a,b)=>a.schedule.localeCompare(b.schedule)); for (const x of j) console.log(x.schedule.padEnd(20), x.jobname)'
```

- **Expected:** no listed job runs at minute 55 (a schedule beginning `55 `, a comma list
  containing 55, or a `*/5` or `*/1` step), and no job named `first_hop_enqueue_sweep`.
- **Abort if:** minute 55 is occupied (choose another free minute and carry it through every step
  below), or the job already exists (read its state with Step 1b before doing anything).

### P3 — the candidate count (read-only; information, not an abort)

This is the function's candidate predicate as a plain SELECT. Record the number.

```sql
SELECT count(*) AS n_candidates
  FROM public.strategies s
 WHERE s.status = 'private'
   AND EXISTS (SELECT 1 FROM public.api_keys ak
                WHERE ak.id = s.api_key_id AND ak.is_active AND ak.disconnected_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.compute_jobs cj
                    WHERE cj.strategy_id = s.id OR cj.api_key_id = s.api_key_id)
   AND NOT EXISTS (SELECT 1 FROM public.trades t WHERE t.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.strategy_analytics sa
                    WHERE sa.strategy_id = s.id AND sa.computation_status <> 'pending');
```

- **Expected:** RESEARCH census (a) expects 0.
- **A non-zero count is reported and NOT acted on by hand.** Each counted strategy is one the sweep
  will observe on its first tick and re-enqueue after 90 minutes; say so to whoever is watching, and
  do not enqueue anything yourself.
- ⛔ **Do NOT call `public.first_hop_enqueue_sweep()` by hand to "see what it says".** A manual call
  runs the whole function: it writes observation rows and, after the grace, inserts live jobs. The
  first tick is the first call.

### P4 — the committed manifest agrees with live PROD, BEFORE anything changes

```bash
node scripts/prod-prober/run.mjs --preflight-repoint
```

Needs `PROBER_POOLER_URL` and `SUPABASE_DB_PASSWORD` (the founder exports the database password).

- **Expected:** exit 0, `preflight-repoint: PROD cron.job matches the committed manifest (...
  row(s)). Safe to proceed.`
- **Abort if:** non-zero. Exit 1 means a defect was found: read the printed remedy per defect kind.
  Exit 3 means nothing was measured: fix that first; a 3 is not a pass.

### P5 — the working tree is clean

```bash
git status --short
```

- **Expected:** empty, so the manifest Step 2 writes is reviewable as a diff against a known-clean
  baseline. **Abort if:** any output.

### P6 — the merge hold

Step 2 ends with a commit on a branch that is later merged. A merge to `main` redeploys the
analytics service, so hold the manifest branch's merge outside the trade-sync window recorded in
`docs/runbooks/ops-staleness-go-live.md` (P6 there, with its 2026-10-26 move note). The
registration itself (Steps 1 and 1b) deploys nothing and can run at any time outside that window.

---

## Step 1 — the registration (LIVE op 1 of 2)

Re-run P0, P1, P2 and P4 immediately before it. Write the statement and its readback to
`$JL_SP/step1.sql`:

```sql
SELECT cron.schedule('first_hop_enqueue_sweep', '55 * * * *', $$SELECT public.first_hop_enqueue_sweep();$$);
```

Render it guarded and run it:

```bash
node "$JL_SP/guard.mjs" "$JL_SP/step1.sql" > "$JL_SP/step1-guarded.sql"
```

The schedule call upserts by job name, so a retry after an ambiguous CLI error is safe, but read the
state first with Step 1b. The return value is the jobid: do not record it anywhere tracked.

⛔ **This statement lives HERE and in no migration**, for the reason in "Why the schedule is not a
migration".

## Step 1b — the evidence read (read-only, in the same session, its own call)

Run this as its OWN read-only call after the write (MCP first, or one CLI query per call, never
chained to the write):

```sql
SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'first_hop_enqueue_sweep';
```

- **Expected:** exactly one row: `jobname` `first_hop_enqueue_sweep`, `schedule` `55 * * * *`,
  `command` exactly `SELECT public.first_hop_enqueue_sweep();`, `active` true.
- **Zero rows, two rows, another schedule or command, or `active` false is a FAILED go-live.**
  Report it as failed; never record it as a pass. The query selects no jobid, so the pasted row
  carries no PROD id.
- ⛔ **Never widen the jobname filter.** Other jobs' command text can carry a credential, and this
  output is pasted into a public repository.

**This read is HEAL-01's delivery evidence.** HEAL-01 is recorded as delivered only with this
output pasted verbatim, together with the P0 marker result and Step 2's manifest diff line, in the
Phase 227 verification report. Without all three, HEAL-01 stays recorded as lane-proven with PROD
registration pending.

## Step 2 — the manifest, in the SAME session (LIVE op 2 of 2)

⚠️ **Part of the operation, not follow-up.** The moment Step 1 succeeds, PROD carries a job the
committed manifest does not, and `cron-drift` reports drift on every prober run until the manifest
is re-captured.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out "$JL_SP/cron-manifest-capture.json"
diff scripts/prod-prober/cron-manifest.json "$JL_SP/cron-manifest-capture.json"
```

- The capture refuses and writes nothing on: no `--out`; an unlabelled database; a `cron.job` record
  it cannot parse or whose count disagrees with the database's own row count (exit 3); or a row that
  fails a hygiene rule (exit 1). A refusal is information, not an obstacle.
- **Expected:** the ONLY job change is ONE new row, `first_hop_enqueue_sweep`, `55 * * * *`, active,
  command `SELECT public.first_hop_enqueue_sweep();`. The `captured_at` line also changes. Read the
  new row's `command` before committing: the manifest is a committed, world-readable file.
- **Abort (do not move the file into place) if any OTHER job differs.** PROD drifted somewhere this
  runbook was not looking, and committing the manifest would bless it. Investigate with the
  read-only P4 comparison, never by editing the manifest by hand.

On exactly the expected diff, on a branch (never on `main`):

```bash
mv "$JL_SP/cron-manifest-capture.json" scripts/prod-prober/cron-manifest.json
git add scripts/prod-prober/cron-manifest.json
git commit -m "chore(227): re-capture the cron manifest after registering first_hop_enqueue_sweep"
```

Then `node scripts/prod-prober/run.mjs --preflight-repoint` must exit 0. Merge the branch outside the
P6 window.

## First tick — what to expect

After the next minute 55, read the sweep's effect as counts only:

```sql
SELECT count(*) AS n_observed,
       count(*) FILTER (WHERE reenqueued_at IS NOT NULL) AS n_reenqueued,
       count(*) FILTER (WHERE named_state_at IS NOT NULL) AS n_named
  FROM public.first_hop_enqueue_retries;
```

With P3 at 0 all three are expected to be 0. A non-zero `n_observed` is a strategy the sweep is
watching; it is re-enqueued only after it has been observed for more than 90 minutes, so a
`n_reenqueued` of 0 on the first tick is correct even then.

Confirm the tick ran without an error:

```sql
SELECT d.start_time, d.status, d.return_message
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'first_hop_enqueue_sweep'
 ORDER BY d.start_time DESC LIMIT 3;
```

⚠️ `cron.job_run_details.status` proves the job was invoked and its statement returned. The sweep
writes no observer row of its own; its evidence is the counts above.

## Rollback

Run the removal in the same guarded form. Write the statement to `$JL_SP/rollback.sql`:

```sql
SELECT cron.unschedule('first_hop_enqueue_sweep');
```

Unschedule by NAME (a `jobid` differs per project, so never by id). Render it with `guard.mjs` and
run it. If the job is already absent, the unschedule call raises: read the state with Step 1b instead.
Then confirm the job is gone, as its own read-only call:

```sql
SELECT count(*) AS job_rows FROM cron.job WHERE jobname = 'first_hop_enqueue_sweep';
```

Expected `0`. Then, in the SAME session, re-capture the manifest as in Step 2; the expected diff is
the one row REMOVED and nothing else, committed as
`chore(227): re-capture the cron manifest after unscheduling first_hop_enqueue_sweep`.

Unscheduling is the whole rollback while the function stays. To remove the function and rename the
table aside, unschedule FIRST, then run `supabase/migrations/down/20261124120400-rollback.sql`
through its own migration PR after the marker query names the database. That file refuses while a
job still names the function. Named-state rows already written, and sync jobs already inserted, are
left in place.

**What unscheduling costs.** A dropped first `sync_trades` enqueue strands again until the user
re-syncs. No observation row is lost.

## What this runbook deliberately does not cover

- **`pg_cron` itself stopping.** Nothing independently checks `pg_cron`'s own liveness, so if it
  stops this sweep stops silently with it (the standing `[PGCRON-LIVENESS-UNWATCHED-01]` residual in
  `TODOS.md`).
- **A strategy whose key is bad.** The sweep tries it once. After that the named state is the only
  signal; there is no page, by the founder's ruling that only the named state shows.
- **Manager (`pending_review`) strategies and composites.** Their first hop is not a `sync_trades`
  enqueue (DEC-05-G); they are outside this sweep by design.
