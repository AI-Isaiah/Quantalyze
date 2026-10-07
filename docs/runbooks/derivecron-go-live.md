# Runbook — Daily Allocator Derive Go-Live (DERIVECRON, Phase 167.1.2.2)

**Owner:** the orchestrator runs the live ops (PROD writes are authorized, decision D-02); the
founder is told what was written · **Audience:** whoever registers, watches or rolls back the
daily fan-out, months from now, with no memory of this phase · **Risk:** a live PROD
`pg_cron` job fans one full-history crawl per eligible exchange key onto the backfill worker
every day. The cost is stated under Blast radius below. Read it before the pre-flight.

## What this activates

One daily PROD `pg_cron` job named `derive-allocator-key-dailies`, schedule `30 5 * * *`, command
`SELECT enqueue_derive_broker_dailies_for_allocator_keys();`.

The chain it starts:

1. The fan-out enqueues one key-mode `derive_broker_dailies` job per eligible `api_keys` row
   (`is_active`, `sync_status` not `revoked`, `disconnected_at` null).
2. The dedicated backfill service (Railway service `quantalyze-analytics-backfill`, role
   `backfill`) crawls each key and writes that key's `csv_daily_returns` and its `key_inputs:<key>`
   row.
3. Each completed derive enqueues an allocator-scoped `derive_allocator_equity` compose job.
4. The compose writes the version-2 `equity_curve` row the SSR reader accepts
   (`src/lib/queries.ts`: a book is `ready` only for `version === 2` and `is_trustworthy === true`).
   Without that row the page shows the rebuilding panel. Since 167.1.2 plan 11 there is no legacy
   fallback, so this cron is what the page's promise rests on.

The fan-out function is defined once, in `20260717233529_allocator_equity_derived_surface.sql`.
**The schedule is not a migration** (D-02). A PROD migration auto-applies after `apply-test` with
no human gate since 2026-09-23, so a migration that wrote the live job catalog would be an
unreviewed catalog write, and it would do so whether or not the worker deploy for the same merge
succeeded. The registration is Step B below, run by hand behind a database-marker guard.

## Why it is safe now (D-03)

The July wedge (the v1.11 incident recorded in `docs/runbooks/flipretry-derived-equity-go-live.md`)
was one process and one event loop claiming everything, with a crawl bounded by nothing but the
outer budget. What closes it, cited by SYMBOL. **Re-read each value at execution time; this
section deliberately states none.**

- **Claim isolation.** `BACKFILL_KINDS` and `WORKER_CLAIM_ROLE` in `analytics-service/main_worker.py`.
  The `interactive` role excludes the two backfill kinds at claim time; the `backfill` role
  includes only them. The claim census (below) proves it from PROD data rather than from code.
- **Per-crawl and per-job bounds.** `_BROKER_CRAWL_TIMEOUT_S` and `TIMEOUT_PER_KIND` in
  `analytics-service/services/job_worker.py`; every handler runs under `asyncio.wait_for` against
  its kind's entry.
- **Watchdog.** `WATCHDOG_PER_KIND_OVERRIDES` in `analytics-service/main_worker.py` carries the
  per-kind reset threshold for `derive_broker_dailies`.
- **Honest health.** A per-job heartbeat in `main_worker.py` refreshes the health tick while the
  loop turns.
- **Topology.** Two Railway services, one replica each. P2 below reads it live.

What this does NOT close is listed under Blast radius (R1 to R4).

## Blast radius

1. **Drift window.** The moment Step B succeeds, PROD `cron.job` carries a row the committed
   oracle `scripts/prod-prober/cron-manifest.json` does not. The hourly `cron-drift` arm reports
   one defect per prober run until the manifest lands on `main`. Finish Step C in the same
   session. The remedy is never to wait it out and never to silence the arm.
2. **Accepted residual risks** (none is a wedge of the July kind):
   - **R1: a truly frozen backfill event loop is not restarted by anything.** Railway health
     checks run at deploy time only, and the restart policy covers process exit, not a stalled
     loop. Mitigation here: the Step A watch and the backlog read after every run (Pitfall: a
     frozen worker looks healthy until morning). The standing alarm is NOT built in this phase:
     it is booked as `[167.1.2.2-BACKFILL-STALENESS-ALARM]` and routed to Phase 164.6.8
     OUTAGEALERT (D-10).
   - **R2: batch-tail watchdog reclaim.** The worker claims a batch at once, runs it one job after
     another, and the watchdog resets any `running` row older than the per-kind threshold whether
     or not the worker has reached it. A heavy batch can lose its last job to a wasted re-crawl.
     The rehearsal measures it (`reclaimed_batch`); the verdict `RECLAIMS` routes to a
     backfill-role batch of 1 (plan 04) and a re-rehearsal (plan 05).
   - **R3: the MT5 terminal lease is per process.** The backfill service is a second process on
     the one MT5 gateway. The login bracket (`assert_expected_login` before and after the read)
     fails closed as a transient error, never as silent corruption. Booked in `TODOS.md` as
     `[167.1.2.2-MT5-CROSS-SERVICE-TERMINAL]`.
   - **R4: onboarding derives queue behind the fan-out.** A key connected during the run waits
     for the earlier jobs. Accepted.
3. **A second full crawl at the next 05:30.** Idempotency is in-flight only: the idempotency key
   (`derive-dailies-<api_key_id>-<UTC date>`) is correlation, not a database constraint, and the
   only dedup is the partial unique index over open rows. A run after the previous one finished
   re-crawls every key. So Step A runs once, and the cron then runs tomorrow regardless.

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export DC_SP="${DC_SP:-$HOME/.cache/quantalyze/derivecron-167.1.2.2}"; mkdir -p "$DC_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link (`supabase/.temp/project-ref`) exists only
  there, and it targets PRODUCTION. `--agent no` pins plain CSV with no envelope. If `--workdir`
  is refused, run the same command with the main checkout as the current directory.
- `DC_SP` is the scratch directory: outside the repo, persistent, shared by every session of this
  phase. Every SQL file and CSV lives there, never in a tracked path.
- **The CLI returns only the LAST statement's rows.** A marker query that is merely the first
  statement is invisible. So every read carries the marker as its first column
  (`marker_is_prod`: 1 only when the database's own comment equals the manifest's
  `database_marker`, else 0; a NULL comment reads 0), every read returns at least one row, and
  every write file starts with a guard that RAISES.
- **Never hand-type the marker string.** The renderer below reads `database_marker` from
  `scripts/prod-prober/cron-manifest.json` and builds both the guard and the read column from it.
- Always `grep -a`. Pipelines run under `set -o pipefail`.
- Tracked text is counts-only: no key ids, owner ids, emails, worker hostnames, deployment ids,
  account numbers, project refs or home paths.

The renderer extracts a named SQL form from this very file, so what is run is what is written
here. Install it once:

```bash
cat > "$DC_SP/form.mjs" <<'JS'
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name, ...kv] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name> [KEY=value ...]");
const md = fs.readFileSync("docs/runbooks/derivecron-go-live.md", "utf8");
const body = (n) => {
  const m = md.match(new RegExp("<!-- form: " + n + " -->\\n```sql\\n([\\s\\S]*?)\\n```"));
  return m ? m[1] : null;
};
const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) fail("database_marker unusable");
const params = { MARKER: "$m$" + marker + "$m$" };
let dry = false;
let guardTest = "";
for (const a of kv) {
  const i = a.indexOf("=");
  const k = a.slice(0, i);
  const v = a.slice(i + 1);
  if (k === "DRY" && v === "1") { dry = true; continue; }
  if (k === "GUARD_TEST" && (v === "mismatch" || v === "null")) { guardTest = v; continue; }
  if (!/^[A-Z_]+$/.test(k) || !/^[A-Za-z0-9:.+-]+$/.test(v)) fail("bad parameter " + a);
  params[k] = "'" + v + "'";
}
const LIVE = "(SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database())";
const censusE = () => {
  const t = execFileSync("node", ["scripts/accounttruth-census.mjs", "--print-sql=e"], { encoding: "utf8" });
  const cut = t.indexOf("SELECT 'owners_with_eligible_keys'");
  if (cut < 0) fail("census e shape changed");
  return t.slice(0, cut).replace(/\s+$/, "");
};
const expand = (sql, depth) => {
  if (depth > 4) fail("expansion too deep");
  return sql.replace(/__([A-Z0-9_]+)__/g, (tok, key) => {
    if (key in params) return params[key];
    if (key === "CENSUS_E") return censusE();
    let text = body(key.toLowerCase().replace(/_/g, "-"));
    if (text === null) fail("unresolved " + tok);
    if (key === "GUARD" && guardTest === "mismatch") text = text.replace("__MARKER__", () => "$m$mismatch$m$");
    if (key === "GUARD" && guardTest === "null") {
      if (!text.includes(LIVE)) fail("guard shape changed");
      text = text.replace(LIVE, () => "NULL::text");
    }
    return expand(text, depth + 1);
  });
};
const form = body(name);
if (form === null) fail("no form named " + name);
let sql = expand(form, 0);
if (dry) {
  sql = sql.split("\n").filter((l) => !/-- WRITE\s*$/.test(l)).join("\n");
  const scan = sql.split(params.MARKER).join("''");
  if (/cron\.(un)?schedule\s*\(|enqueue_\w+\s*\(|\b(insert|update|delete)\b/i.test(scan)) fail("DRY render still carries a write");
}
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$DC_SP/form.mjs" <form-name> [KEY=value ...] > "$DC_SP/<file>.sql"`, then
`q "$DC_SP/<file>.sql" > "$DC_SP/<file>.csv"`. Parameters are timestamps such as
`START=2026-10-08T20:00:00Z` or `RUN_AT=2026-10-09T05:30:00Z`. `DRY=1` deletes every line ending
in `-- WRITE` and refuses to emit a file that still contains `cron.schedule(`,
`cron.unschedule(`, an `enqueue_...(` call, or an INSERT, UPDATE or DELETE. `GUARD_TEST=mismatch`
or `GUARD_TEST=null` renders the guard's two refusal variants. The scan first removes the marker
literal, because the marker's own sentence contains the word DELETE; do the same before grepping
a file by hand for those words.

Forms by file name used by the plans:

| File (in `DC_SP`) | Form | Parameters |
|---|---|---|
| `02-start.sql`, `05-start.sql` | `stepa-start` | none |
| `02-enqueue.sql`, `05-enqueue.sql` | `stepa` | `START` |
| `06-register.sql` | `stepb` | none |
| `06-jobid.sql` | `jobid` | none |
| `08-tick.sql` | `first-tick` | `RUN_AT` |
| `08-d06-owner.sql` | `d06-owner` | `RUN_AT` |
| backlog / claim-census / final-readings / final-detail reads | `backlog`, `claim-census`, `final-readings`, `final-detail` | `START` where noted |

### The guard and the read column

Both are forms, so they appear once and every other form expands them.

<!-- form: guard -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
END
$guard$;
```

`IS DISTINCT FROM` is deliberate: a NULL marker (the comment was lost) refuses exactly as a
mismatched one does. Nothing after a refusal runs.

<!-- form: marker-is-prod -->
```sql
coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int
```

The plain marker read, run as its own call and recorded before anything that writes
(`CLAUDE.md`, "Which database am I on?"):

<!-- form: marker -->
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

The guard proves itself on PROD before anything writes, on three branches. Each run below
renders the same form with one change:

<!-- form: guard-check -->
```sql
__GUARD__
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') AS job_rows
  FROM m;
```

- Positive (no `GUARD_TEST`): returns one row; before Step B it is `1,0`.
- `GUARD_TEST=mismatch`: must exit non-zero with `refusing to continue` and return NO row.
- `GUARD_TEST=null`: the live value replaced by a NULL text literal; same expectation. This is
  the proof that a lost marker refuses rather than passes.

## Pre-flight — ALL BLOCKING

Any item that does not return its expected answer is an ABORT: do not run Step A or Step B.

### P0 — which database is this? (FIRST, every session)

Run the `marker` form as its own call and record the answer (that it names PRODUCTION; the text
itself is already public in the manifest and is not repeated in tracked files). Then the positive
`guard-check` (expect `1,0` before Step B; after Step B expect `1,1`).

- **Abort if** the marker names anything else or comes back NULL. A NULL means the label was lost:
  re-set it before writing, never proceed on a guess.

### P1 — the fan-out function exists and the job does not (before Step B)

<!-- form: p1 -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       coalesce((SELECT bool_and(p.prosecdef AND has_function_privilege(p.oid, 'EXECUTE'))
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'enqueue_derive_broker_dailies_for_allocator_keys'
                    AND p.pronargs = 0), false)::int AS fn_ok,
       (SELECT count(*) FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') AS job_rows
  FROM m;
```

- **Expected:** `fn_ok = 1` (the function exists, is SECURITY DEFINER, and the CLI role can execute
  it). `job_rows = 0` before Step B; exactly `1` after it.
- **Abort if** `fn_ok = 0`, or `job_rows` is not the expected value for the step you are about to
  run.

### P2 — Railway: both services healthy, on their roles, one replica each

Run from `QZ_MAIN` (where the Railway CLI is linked). Reads only; prints no variable values other
than the role word and prints no deployment or service ids.

```bash
cat > "$DC_SP/p2.mjs" <<'JS'
import { execFileSync } from "node:child_process";
const sh = (args) => execFileSync("railway", args, { encoding: "utf8", cwd: process.env.QZ_MAIN, stdio: ["ignore", "pipe", "ignore"] });
let abort = false;
for (const [svc, role] of [["quantalyze-analytics", "interactive"], ["quantalyze-analytics-backfill", "backfill"]]) {
  const dep = JSON.parse(sh(["deployment", "list", "--service", svc, "--limit", "1", "--json"]))[0];
  const replicas = dep.meta.serviceManifest.deploy.numReplicas;
  const got = JSON.parse(sh(["variables", "--service", svc, "--json"])).WORKER_CLAIM_ROLE;
  const ok = dep.status === "SUCCESS" && replicas === 1 && got === role;
  if (!ok) abort = true;
  console.log(svc + ": status=" + dep.status + " commit=" + String(dep.meta.commitHash || "").slice(0, 9) + " replicas=" + replicas + " role=" + got + " -> " + (ok ? "OK" : "ABORT"));
}
const st = JSON.parse(sh(["status", "--json"]));
const api = st.environments.edges[0].node.serviceInstances.edges.map((e) => e.node).find((n) => n.serviceName === "quantalyze-analytics");
const host = api && api.domains.serviceDomains[0] && api.domains.serviceDomains[0].domain;
const h = host ? await (await fetch("https://" + host + "/health")).json() : {};
console.log("api health: status=" + h.status + " config_ok=" + h.config_ok + " worker_age_s=" + Math.round(h.worker_age_s));
if (h.status !== "ok" || h.config_ok !== true) abort = true;
process.exit(abort ? 1 : 0);
JS
node "$DC_SP/p2.mjs"
```

- **Expected:** both lines `OK`; the API health `ok`. Record both deployed commit SHAs in the
  SUMMARY of the plan you are executing (git SHAs are public). A skew between the two services is
  recorded, not hidden: derive and compose code runs on the backfill service, interactive code on
  the other.
- **Abort if** either service is mid-deploy (status other than `SUCCESS`), off its role, or not at
  1 replica. A role of `all` on the API service would let it claim derive jobs.

### P3 — the queue is empty and the fan-out's advisory lock is free

<!-- form: p3-lock -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM compute_jobs WHERE status IN ('pending', 'running', 'failed_retry', 'done_pending_children')) AS open_jobs,
       (SELECT count(*) FROM pg_locks l
         WHERE l.locktype = 'advisory' AND l.objsubid = 1
           AND l.classid::bigint = ((hashtext('derive_broker_dailies_key_fanout')::bigint >> 32) & 4294967295)
           AND l.objid::bigint = (hashtext('derive_broker_dailies_key_fanout')::bigint & 4294967295)) AS lock_holders
  FROM m;
```

- **Expected before Step A:** `open_jobs = 0`, `lock_holders = 0`.
- **Abort if** the queue is not empty (an unrelated open job is not a blocker for the cron, but
  for the rehearsal it muddies the per-venue readings: wait for it) or the lock is held.

### P4 — the committed manifest agrees with live PROD, BEFORE anything changes

```bash
node scripts/prod-prober/run.mjs --preflight-repoint
```

Needs `PROBER_POOLER_URL` and `PGPASSWORD` (the founder exports the database password). Expected
exit 0. Exit 1 means a defect was found, read the printed remedy; exit 3 means nothing was
measured, fix that first. Required before Step B, not before Step A (Step A writes no `cron.job`
row).

### P5 — the working tree is clean

`git status --short` prints nothing. The manifest Step C produces must be reviewable against a
known-clean baseline.

### P6 — the merge hold

No merge to `main`, from any phase, from (the Step A start, or 05:30Z of a scheduled run) MINUS
the deploy latency, until open backfill-kind jobs are 0. Reason: a merge redeploys the backfill
service and strands its in-flight jobs for up to the per-kind watchdog threshold
(`WATCHDOG_PER_KIND_OVERRIDES`). Deploy latency is measured from the backfill service's most
recent deploy, merge to live (Railway deployment list); use 40 minutes when unmeasured.

## Step A — the rehearsal (D-08), run once

Go: founder decision D-08, 2026-10-07. One manual fan-out through the product's own function,
watched to completion, then judged. The cron is registered only after a verdict of `CLEAN` or
`CLEAN-WITH-OKX-BOUND`.

1. **Start read.** The database's own clock is the rehearsal start (never the operator's):

<!-- form: stepa-start -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS db_now_utc
  FROM m;
```

2. **The write.** Render with `START=<the start read's timestamp>`:

<!-- form: stepa -->
```sql
__GUARD__
SELECT enqueue_derive_broker_dailies_for_allocator_keys(); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM compute_jobs j
         WHERE j.kind = 'derive_broker_dailies' AND j.api_key_id IS NOT NULL
           AND j.idempotency_key LIKE 'derive-dailies-%-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
           AND j.created_at >= __START__::timestamptz) AS enqueued,
       (SELECT count(*) FROM api_keys ak
         WHERE ak.is_active = TRUE AND ak.sync_status IS DISTINCT FROM 'revoked'
           AND ak.disconnected_at IS NULL) AS eligible
  FROM m;
```

   Expected readback: `1,<n>,<n>` with `enqueued = eligible > 0`. A key already in flight is
   skipped by design, so `enqueued < eligible` with open rows present means someone else enqueued
   first: record it.

   **If the call fails, or the readback is missing or disagrees: the write may already have
   happened and cannot be undone.** Record the CLI output (minus any id). NEVER re-run the file (a
   repeat after completion re-crawls every key). Read the queue with a separate read-only SELECT
   (the `backlog` form), and stop for a decision.

3. **The watch.** About every 15 minutes run the `backlog` and `claim-census` reads and note open
   derive jobs, the oldest open age and the age of the latest derive update. Use a background
   wait or monitor, not a foreground sleep.

<!-- form: backlog -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM compute_jobs WHERE status IN ('pending', 'running', 'failed_retry', 'done_pending_children')) AS open_jobs,
       (SELECT count(*) FROM compute_jobs WHERE status IN ('pending', 'running', 'failed_retry', 'done_pending_children')
           AND kind IN ('derive_broker_dailies', 'derive_allocator_equity')) AS open_derive_jobs,
       (SELECT coalesce(max(round(extract(epoch FROM (now() - created_at)))), 0) FROM compute_jobs
         WHERE status IN ('pending', 'failed_retry')) AS oldest_open_age_s,
       (SELECT count(*) FROM compute_jobs WHERE status = 'running'
           AND kind IN ('derive_broker_dailies', 'derive_allocator_equity')) AS running_derive_jobs,
       (SELECT round(extract(epoch FROM (now() - max(updated_at)))) FROM compute_jobs
         WHERE kind IN ('derive_broker_dailies', 'derive_allocator_equity')
           AND updated_at > now() - interval '3 days') AS derive_last_update_age_s
  FROM m;
```

   The claim census proves the role split from PROD data: backfill kinds claimed only by backfill
   hosts, other kinds only by the others. A host that claimed both is a role failure.
   `START` is the window start (the rehearsal start, or `RUN_AT` for a scheduled run):

<!-- form: claim-census -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
w AS (
  SELECT regexp_replace(claimed_by, '-[0-9]+$', '') AS host,
         bool_or(kind IN ('derive_broker_dailies', 'derive_allocator_equity')) AS ran_backfill_kind,
         bool_or(kind NOT IN ('derive_broker_dailies', 'derive_allocator_equity')) AS ran_other_kind
    FROM compute_jobs
   WHERE claimed_at >= __START__::timestamptz AND claimed_by IS NOT NULL
   GROUP BY 1
)
SELECT m.marker_is_prod,
       count(*) FILTER (WHERE w.ran_backfill_kind AND NOT w.ran_other_kind) AS backfill_only_hosts,
       count(*) FILTER (WHERE w.ran_other_kind AND NOT w.ran_backfill_kind) AS other_only_hosts,
       count(*) FILTER (WHERE w.ran_backfill_kind AND w.ran_other_kind) AS claim_census_mixed_hosts
  FROM m LEFT JOIN w ON true
 GROUP BY m.marker_is_prod;
```

   **R1 rule.** If open derive jobs stop moving for 30 minutes (no open-count change and
   `derive_last_update_age_s` growing past that), restart the backfill service and record the UTC
   time and the reason: `railway restart --service quantalyze-analytics-backfill --yes` from
   `QZ_MAIN`. A restart or redeploy time recorded here is what lets a reclaim be classed
   `reclaimed_restart` below. A single running job is normal for up to its crawl bound, so judge
   "stopped moving" over the whole open set, not one job.

4. **Completion.** Open backfill-kind jobs are 0 (`open_derive_jobs = 0`). Record the drain time.
   Keep the merge hold until then.

5. **Final readings.** Every reading has `created_at` at or after the start and inside the next 24
   hours (read within hours of the drain). Render with `START=<start>`. The result is long-form:
   one row per reading and detail, always with explicit zero rows.

<!-- form: final-readings -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
j AS (
  SELECT cj.status, cj.last_error, cj.reclaim_count,
         coalesce(lower(btrim(ak.exchange)), 'unknown') AS venue,
         round(extract(epoch FROM (cj.updated_at - cj.claimed_at))) AS run_s,
         (cj.last_error ILIKE '%wall-clock bound%' OR cj.last_error ILIKE '%per-crawl%') AS bound_hit,
         (cj.last_error ILIKE '%mt5 terminal account mismatch%') AS login_mismatch,
         CASE
           WHEN cj.status <> 'failed_final' THEN NULL
           WHEN cj.last_error ILIKE '%interpretable%' OR cj.last_error ILIKE '%at least 2 days%' THEN 'E1'
           WHEN (cj.last_error ILIKE '%wall-clock bound%' OR cj.last_error ILIKE '%per-crawl%')
                AND lower(btrim(ak.exchange)) = 'okx' THEN 'E2'
           WHEN cj.last_error ILIKE '%duplicate%' OR cj.last_error ILIKE '%identity%'
                OR cj.last_error ILIKE '%not syncing%' THEN 'E3'
           ELSE 'unexplained'
         END AS cls
    FROM compute_jobs cj
    LEFT JOIN api_keys ak ON ak.id = cj.api_key_id
   WHERE cj.kind = 'derive_broker_dailies' AND cj.api_key_id IS NOT NULL
     AND cj.created_at >= __START__::timestamptz
     AND cj.created_at < __START__::timestamptz + interval '24 hours'
),
r AS (
  SELECT 'venue_jobs' AS reading, venue AS detail, count(*) AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY run_s) AS median_s, max(run_s) AS max_s
    FROM j GROUP BY venue
  UNION ALL
  SELECT 'venue_status', venue || ':' || status, count(*), NULL, NULL FROM j GROUP BY venue, status
  UNION ALL
  SELECT 'reclaimed', 'all', count(*), NULL, NULL FROM j
   WHERE last_error = 'worker_stalled' OR coalesce(reclaim_count, 0) > 0
  UNION ALL
  SELECT 'crawl_bound_hits', d.k, count(j.venue), NULL, NULL
    FROM (VALUES ('okx'), ('other')) AS d (k)
    LEFT JOIN j ON j.bound_hit AND ((d.k = 'okx') = (j.venue = 'okx'))
   GROUP BY d.k
  UNION ALL
  SELECT 'mt5_login_mismatch', d.k, count(j.venue), NULL, NULL
    FROM (VALUES ('final'), ('retried')) AS d (k)
    LEFT JOIN j ON j.venue = 'mt5' AND j.login_mismatch
               AND ((d.k = 'final' AND j.status = 'failed_final') OR (d.k = 'retried' AND j.status = 'done'))
   GROUP BY d.k
  UNION ALL
  SELECT 'failed_final_class', d.k, count(j.cls), NULL, NULL
    FROM (VALUES ('E1'), ('E2'), ('E3'), ('unexplained')) AS d (k)
    LEFT JOIN j ON j.cls = d.k
   GROUP BY d.k
  UNION ALL
  SELECT 'compose_status', status, count(*), NULL, NULL FROM compute_jobs
   WHERE kind = 'derive_allocator_equity'
     AND created_at >= __START__::timestamptz AND created_at < __START__::timestamptz + interval '24 hours'
   GROUP BY status
  UNION ALL
  SELECT 'v2_rows_fresh', 'all', count(*), NULL, NULL FROM allocator_equity_derived
   WHERE kind = 'equity_curve' AND payload -> 'version' = '2'::jsonb
     AND computed_at >= __START__::timestamptz AND computed_at < __START__::timestamptz + interval '24 hours'
  UNION ALL
  SELECT 'eligible_keys', 'all', count(*), NULL, NULL FROM api_keys
   WHERE is_active = TRUE AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL
  UNION ALL
  SELECT 'jobs_considered', 'all', count(*), NULL, NULL FROM j
)
SELECT m.marker_is_prod, r.reading, r.detail, r.n, r.median_s, r.max_s
  FROM m LEFT JOIN r ON true
 ORDER BY r.reading, r.detail;
```

   The same form with `START=<RUN_AT>` is the D-06 job-outcome read. The per-row companion, for
   timing a reclaim and for reviewing the `unexplained` bucket (venue, status, attempts, timestamps
   and the first 120 characters of the stored error; no ids; read it, never paste it into a
   tracked file):

<!-- form: final-detail -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       CASE WHEN cj.status IS NULL THEN NULL ELSE coalesce(lower(btrim(ak.exchange)), 'unknown') END AS venue,
       cj.status,
       cj.attempts,
       cj.reclaim_count,
       to_char(cj.claimed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS claimed_at_utc,
       to_char(cj.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at_utc,
       round(extract(epoch FROM (cj.updated_at - cj.claimed_at))) AS run_s,
       left(regexp_replace(coalesce(cj.last_error, ''), '[,"\r\n]', ' ', 'g'), 120) AS error_head
  FROM m
  LEFT JOIN (SELECT * FROM compute_jobs
              WHERE kind = 'derive_broker_dailies' AND api_key_id IS NOT NULL
                AND created_at >= __START__::timestamptz AND created_at < __START__::timestamptz + interval '24 hours'
                AND (status <> 'done' OR last_error IS NOT NULL OR coalesce(reclaim_count, 0) > 0)) cj ON true
  LEFT JOIN api_keys ak ON ak.id = cj.api_key_id
 ORDER BY cj.claimed_at;
```

   **Readings to record (counts only):**
   - per venue: job count, median and max of `updated_at - claimed_at`, status counts
     (`venue_jobs`, `venue_status`);
   - `reclaimed`, split in two by the backfill service's logs: `reclaimed_restart` (the reclaim's
     watchdog reset falls inside a recorded restart or redeploy window, from its time to its time
     plus the per-kind watchdog threshold) and `reclaimed_batch` (every other reclaim). The reset
     time is not stored on the row: read it from the backfill service's logs
     (`railway logs --service quantalyze-analytics-backfill`, read-only);
   - `crawl_bound_hits_okx` and `crawl_bound_hits_other` (`crawl_bound_hits`). A bound hit that a
     later attempt cleared leaves no trace in `last_error`; the logs are the second source;
   - `mt5_login_mismatch_final` (an MT5 row that ended `failed_final` with a login mismatch) and
     `mt5_login_mismatch_retried` (one that hit it and ended `done`);
   - `unexplained_failures` (`failed_final_class` / `unexplained`, after reading `final-detail`:
     the SQL classes are a first pass over error text, the closed list below is the rule);
   - `claim_census_mixed_hosts`, `open_derive_jobs_at_end`, version-2 rows with `computed_at` at
     or after the start (`v2_rows_fresh`).

   **The closed list of explained-failure causes (anything else is unexplained):**
   - E1: the derive's refusal for fewer than two interpretable daily-return days;
   - E2: an okx crawl ending on the per-crawl bound;
   - E3: a refusal whose error names an existing gate (duplicate account, account identity
     pending, key not syncing);
   - E4: a job interrupted by a recorded restart or redeploy that then ended `done` (not a
     failure; it is why `reclaimed_restart` is its own class).

6. **The verdict.** One ordered decision list. **First match wins.**

   1. `UNCLEAN` when the queue did not drain, or `claim_census_mixed_hosts` is above 0, or
      `unexplained_failures` is above 0, or `crawl_bound_hits_other` is above 0 (D-09 covers okx
      only), or `mt5_login_mismatch_final` is above 0.
   2. `RECLAIMS` when `reclaimed_batch` is above 0 (plan 04 ships the backfill batch of 1, plan 05
      re-rehearses).
   3. `CLEAN-WITH-OKX-BOUND` when `crawl_bound_hits_okx` is above 0 (D-09: register anyway, a
      bound hit ends that job with an error and the next day retries; book okx crawl speed as a
      follow-up).
   4. `CLEAN`.

   `reclaimed_restart` and `mt5_login_mismatch_retried` are recorded and change no verdict. An
   `UNCLEAN` verdict stops the phase for a decision; it is never reclassified to get a cron out.

## Step B — the registration

Runs only after a Step A verdict of `CLEAN` or `CLEAN-WITH-OKX-BOUND` (after plan 05's clean
re-rehearsal when the verdict was `RECLAIMS`). Re-run P0, P1 (`job_rows = 0`), P2, P3 and P4
immediately before it, and keep the P6 hold from now on: the first scheduled run starts the hold
at 05:30Z minus the deploy latency.

<!-- form: stepb -->
```sql
__GUARD__
SELECT cron.schedule('derive-allocator-key-dailies', '30 5 * * *', $$SELECT enqueue_derive_broker_dailies_for_allocator_keys();$$); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.username, j.database, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname = 'derive-allocator-key-dailies';
```

- **Expected readback:** exactly one data row: `1`, `derive-allocator-key-dailies`, `30 5 * * *`,
  `t` (or `true`), `postgres`, `postgres`, and the command exactly as above.
- `cron.schedule` upserts by job name (pg_cron 1.6), so a retry after an ambiguous CLI error is
  safe, but read the state first.
- The new `jobid` is printed by the arm and deliberately not compared. Read it for the record
  with the one-row form:

<!-- form: jobid -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, j.jobid
  FROM m LEFT JOIN cron.job j ON j.jobname = 'derive-allocator-key-dailies';
```

- This statement lives HERE and in no migration (D-02), for the reason in "What this activates".

## Step C — the manifest, in the SAME session

The moment Step B succeeds, PROD carries a job the committed manifest does not, and `cron-drift`
reports it on every prober run. Finish this step before the session ends. Stage the manifest PR
before registering if you can, but it must NOT merge before Step B (the arm would report the job
"missing from PROD").

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out "$DC_SP/cron-manifest-capture.json"
diff scripts/prod-prober/cron-manifest.json "$DC_SP/cron-manifest-capture.json"
```

- The capture refuses and writes nothing on: no `--out`; an unlabelled database; a `cron.job`
  record it cannot parse or whose count disagrees with the database's own row count (exit 3);
  or a row failing a hygiene rule (exit 1). A refusal is information, not an obstacle.
- **Expected diff:** the ONLY job change is one added row: `jobname`
  `derive-allocator-key-dailies`, `schedule` `30 5 * * *`, `active` true, `database` `postgres`,
  `username` `postgres`, `command` exactly `SELECT enqueue_derive_broker_dailies_for_allocator_keys();`
  and `command_sha256`
  `f5b3b242b93dd4a760c76306ca783be72fa71cda98d8658e1825de51be24a540` (computed through the arm's
  own `normalizeCommand` and `sha256Hex`; equal to a plain SHA-256 of that string). The `captured_at`
  line also changes.
- **Abort (do not move the file into place) if any OTHER job differs.** PROD drifted somewhere
  this runbook was not looking, and committing the manifest would bless it. Investigate with the
  read-only P4 comparison; never edit the manifest by hand.
- On exactly the expected diff: move the file into place, then `node scripts/prod-prober/run.mjs
  --preflight-repoint` must exit 0, and `npx vitest run src/__tests__/prod-prober-wiring.test.ts`
  plus `node scripts/prod-prober/run.mjs --self-test` stay green. The PR carrying the manifest
  merges AFTER Step C, under the P6 hold, and only outside a derive run.

## First tick (05:31Z of the first cron day)

<!-- form: first-tick -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
r AS (
  SELECT d.status, d.start_time, d.end_time
    FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = 'derive-allocator-key-dailies'
   ORDER BY d.start_time DESC LIMIT 2
)
SELECT m.marker_is_prod, r.status,
       (r.start_time >= __RUN_AT__::timestamptz AND r.start_time < __RUN_AT__::timestamptz + interval '24 hours')::int AS started_after_run_at,
       round(extract(epoch FROM (r.end_time - r.start_time)) * 1000) AS run_ms
  FROM m LEFT JOIN r ON true
 ORDER BY r.start_time DESC NULLS LAST;
```

Render with `RUN_AT=<05:30Z of the run day>`. Expected newest row: `1`, `succeeded`,
`1`, and a `run_ms` well under 2000 (the sibling fan-outs measure well under a second).

`succeeded` proves the SQL ran, never the worker side. The fan-out is all-or-nothing: a
non-`unique_violation` error rolls back every enqueue of that run and shows as a failed row here
(read `return_message`). The worker-side proof is the D-06 reads below.

## D-06 reads (about 4 hours after 05:30Z)

`RUN_AT` is 05:30Z of the run day. Every freshness and job filter below is bounded to the window
from `RUN_AT` to `RUN_AT + 24 hours`, so a read that slips past the next 05:30Z cannot count the
next day's rows.

**The freshness trap.** After Step A, version-2 rows already exist. Success is therefore judged on
`computed_at` and `created_at` inside the window, never on row existence (D-08).

1. The census labels, one label per call: `node scripts/accounttruth-census.mjs --print-sql=marker`
   (must name PRODUCTION), then `rls` (must answer `bypasses_rls`), then `c`, `d`, `e`; each
   printed statement run with `q`.
2. The job-outcome read (`final-readings` with `START=<RUN_AT>`), the `backlog` read and the
   `claim-census` read (`START=<RUN_AT>`).
3. The per-owner read. It copies census label `e`'s `state` CTE verbatim from the census script's
   own `--print-sql=e` output (the renderer's `__CENSUS_E__`), never re-deriving the reasons.

<!-- form: d06-owner -->
```sql
__CENSUS_E__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
win AS (SELECT __RUN_AT__::timestamptz AS t0),
fresh AS (
  SELECT d.allocator_id
    FROM public.allocator_equity_derived d CROSS JOIN win
   WHERE d.kind = 'equity_curve'
     AND d.payload -> 'version' = '2'::jsonb
     AND d.payload -> 'is_trustworthy' = 'true'::jsonb
     AND d.computed_at >= win.t0 AND d.computed_at < win.t0 + interval '24 hours'
),
okxb AS (
  SELECT DISTINCT k.user_id
    FROM keys k
    JOIN public.compute_jobs cj ON cj.api_key_id = k.id AND cj.kind = 'derive_broker_dailies'
    CROSS JOIN win
   WHERE k.eligible AND k.exchange = 'okx'
     AND cj.created_at >= win.t0 AND cj.created_at < win.t0 + interval '24 hours'
     AND cj.status IN ('failed_final', 'failed_retry')
     AND (cj.last_error ILIKE '%wall-clock bound%' OR cj.last_error ILIKE '%per-crawl%')
)
SELECT m.marker_is_prod,
       count(s.user_id) AS eligible_owners,
       count(s.user_id) FILTER (WHERE s.s IN ('rebuilding:duplicate_account', 'rebuilding:key_not_syncing', 'rebuilding:account_identity_pending')) AS held,
       count(s.user_id) FILTER (WHERE s.s = 'rebuilding:duplicate_account') AS held_duplicate_account,
       count(s.user_id) FILTER (WHERE s.s = 'rebuilding:key_not_syncing') AS held_key_not_syncing,
       count(s.user_id) FILTER (WHERE s.s = 'rebuilding:account_identity_pending') AS held_account_identity_pending,
       count(s.user_id) FILTER (WHERE s.s = 'ready') AS ready,
       count(s.user_id) FILTER (WHERE s.s = 'rebuilding:awaiting_derivation') AS awaiting,
       count(s.user_id) FILTER (WHERE s.s NOT IN ('ready', 'rebuilding:awaiting_derivation', 'rebuilding:duplicate_account', 'rebuilding:key_not_syncing', 'rebuilding:account_identity_pending')) AS other_shortfall,
       (SELECT count(*) FROM fresh f JOIN state s2 ON s2.user_id = f.allocator_id
         WHERE s2.s NOT IN ('rebuilding:duplicate_account', 'rebuilding:key_not_syncing', 'rebuilding:account_identity_pending')) AS v2_trustworthy_fresh_nonheld,
       (SELECT count(*) FROM public.allocator_equity_derived d CROSS JOIN win
         WHERE starts_with(d.kind, 'key_inputs:')
           AND d.computed_at >= win.t0 AND d.computed_at < win.t0 + interval '24 hours') AS key_inputs_fresh_since_run,
       (SELECT count(*) FROM okxb o JOIN state s3 ON s3.user_id = o.user_id
         WHERE s3.s = 'rebuilding:awaiting_derivation') AS okx_bound_owners,
       (SELECT count(*) FROM keys WHERE eligible) AS eligible_keys
  FROM m LEFT JOIN state s ON true
 GROUP BY m.marker_is_prod;
```

   Columns, in order: `marker_is_prod`, `eligible_owners` (exactly the population of census e's
   `state` CTE: one row per owner with an eligible key), `held` (owners in the closed held set
   `rebuilding:duplicate_account`, `rebuilding:key_not_syncing`,
   `rebuilding:account_identity_pending`; also emitted per reason as `held_duplicate_account`,
   `held_key_not_syncing`, `held_account_identity_pending`, which sum to `held`), `ready`,
   `awaiting` (`rebuilding:awaiting_derivation`), `other_shortfall` (every other non-ready state),
   `v2_trustworthy_fresh_nonheld` (non-held owners whose `equity_curve` row is version 2,
   `is_trustworthy` true and `computed_at` inside the window), `key_inputs_fresh_since_run`,
   `okx_bound_owners` (non-held owners in state `rebuilding:awaiting_derivation` with an eligible
   okx key whose `derive_broker_dailies` job created inside the window ended `failed_final` or
   `failed_retry` with a crawl-bound error), and `eligible_keys`.

4. **The pass rule (the SC-3 verdict).** `PASS` when `ready` and `v2_trustworthy_fresh_nonheld`
   both equal `eligible_owners - held`, and `awaiting` and `other_shortfall` are 0.
   `PASS-WITH-D09-OKX` when `okx_bound_owners` is above 0, `ready + okx_bound_owners` equals
   `eligible_owners - held`, `v2_trustworthy_fresh_nonheld` equals `ready`, `awaiting` equals
   `okx_bound_owners` and `other_shortfall` is 0. Otherwise `FAIL`. **Both passing verdicts also
   need** 0 open derive jobs, `reclaimed_batch` 0 and no mixed host.

   "Every eligible allocator" in SC-3 is read as every eligible allocator NOT held by an earlier
   named gate; held owners are listed by reason and count. The held set is the three gates above
   and no other, so a new reason cannot hide a regression: it lands in `other_shortfall`.

## Rollback

Unschedule by NAME (a `jobid` differs per project, so never by id), behind the same guard:

<!-- form: rollback -->
```sql
__GUARD__
SELECT cron.unschedule('derive-allocator-key-dailies'); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') AS job_rows
  FROM m;
```

- The rollback readback is one row, `marker_is_prod` and `job_rows`, expected `1,0`. If the job is
  already absent, `cron.unschedule` raises and the readback does not run: read the state with
  `guard-check` instead.
- Then let pending derives drain: they are the same work, and a version-2 row is valid data. Do
  NOT delete jobs or `allocator_equity_derived` rows; the FLIP runbook's Step 8 deletes no longer
  apply (167.1.2 plan 11 removed the legacy fallback they returned the system to).
- Then, in the SAME session, re-capture the manifest as in Step C. The expected diff is the one
  row REMOVED and nothing else.

## What this runbook does not cover

- **The backfill staleness alarm** (D-10): booked as `[167.1.2.2-BACKFILL-STALENESS-ALARM]`,
  owned by Phase 164.6.8 OUTAGEALERT. Until it exists, the backlog read after each run is the only
  check, and it is a human reading, not monitoring.
- **okx crawl speed** (D-09): if Step A or a scheduled run shows okx bound hits, a follow-up phase
  owns it (`[167.1.2.2-OKX-CRAWL-BOUND]`). The cron is not held for it.
- **MT5 cross-process contention** (R3): booked in `TODOS.md`.
- **E2GT-01** (the live ground-truth harness): waived as a pre-gate by D-07 (founder, 2026-10-07)
  because the harness cannot run for a Deribit key-mode allocator and the legacy fallback it
  protected is gone. It stays an after-the-fact audit item once the harness supports key-mode.
- **Reading `cron.job_run_details.status` as proof of the derive work.** It proves the SQL ran.
