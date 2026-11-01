# Runbook — NAVMTM Daily Chain Move (Phase 167.2.1.1.1, D-03 and D-13)

> ⛔ **RETIRED 2026-10-31 (Phase 176 LEGACYRETIRE, D-02 and D-04):** the `refresh-allocator-equity` job is unscheduled by a hand-run step of `docs/runbooks/legacyretire-go-live.md`, and the cron manifest is re-captured in the same session. Its handler is a no-op, so the rollback forms below that move or re-create that job must not be run. The legacy rows these forms count stop growing at PR 2 of the phase, and the table is dropped by the phase's last migration. The `poll-allocator-positions` job is kept. Original text kept below.

**Owner:** the orchestrator runs the live ops (PROD writes are authorized); the founder is told
what was written · **Audience:** whoever moves, watches or rolls back the daily chain, months from
now, with no memory of this phase · **Risk:** this changes the clock time of two live PROD
`pg_cron` jobs. Nothing is created or deleted, but the first run after the move crawls every
eligible exchange key at a new hour, and a `cron.job` set that no longer matches the committed
manifest is reported by the hourly prober until the manifest is re-captured.

## What this activates

CONTEXT D-03, verbatim: "The daily chain keeps its order (trade sync, then derive, which writes
the mark, then compute) and moves to just after 00:00 UTC, so every mark sits on the UTC day
boundary and labels the day that just closed."

CONTEXT D-13, verbatim: "assertion 6 (hours 1-22) is replaced by a rule that the chain runs at
least a few minutes after 00:00Z. This is a consequence of D-03."

The new chain (decision CHAIN-1 of plan 167.2.1.1.1-05):

| Step | Job | Mechanism | Old schedule | New schedule |
|---|---|---|---|---|
| 1 | `refresh-benchmark` | Vercel cron, `vercel.json` | `30 0 * * *` | `5 0 * * *` |
| 2 | `cron-sync-trades` | PROD `pg_cron` | `30 4 * * *` | `10 0 * * *` |
| 3 | `derive-allocator-key-dailies` | PROD `pg_cron` | `30 5 * * *` | `40 0 * * *` |

Step 1 is committed (`vercel.json`) and moves when that file deploys. Steps 2 and 3 live in PROD
`cron.job`. **They are not moved by a migration:** a PROD migration auto-applies after `apply-test`
with no human stop, so a migration that wrote the live job catalog would be an unreviewed catalog
write. The move is Step B below, run by hand behind a database-marker guard, and only the
schedule changes. The `jobid` and the command text of both jobs stay as they are.

**Order of events, and why it is safe either way.** The worker that writes the marks (plans 06
and 07) and the Vercel deploy that carries the new benchmark schedule must be live BEFORE Step B
(pre-flight P1). Until Step B, the 04:30Z and 05:30Z runs still write marks and label them the
previous day (D-11, a mark may be written at any time that UTC day), so moving later loses nothing
and moving earlier than the worker would merely leave the old marks unwritten for one cycle.

## Why these slots

Re-read the slot occupancy from the committed manifest at run time, never from this section:

```bash
node -e 'const m=require("./scripts/prod-prober/cron-manifest.json");for(const j of m.jobs.slice().sort((a,b)=>a.schedule.localeCompare(b.schedule)))console.log(j.schedule.padEnd(14)+j.jobname)'
```

`docs/runbooks/cron-sync-go-live.md` ("Why 04:30") gave four reasons for the old trade-sync slot.
Each is re-derived here for the new slots. Re-check every one against that listing before Step B.

- **(a) The 04:00 poll cluster, which shares per-IP OKX and Bybit rate limits with the tick.** The
  poll (`poll-allocator-positions`, `0 4 * * *`) is not moved, so at 00:10 and 00:40 it is no
  longer ahead of the sync and cannot compete with it. The only jobs near 00:10 are the hourly
  `match_engine_cron` at minute 0 (in-DB, no venue call) and Vercel `warm-analytics` at 00:00 (no
  venue call). Nothing in the listing sits at minute 10 of hour 0. The derive at 00:40 shares its
  minute with the hourly `ops_staleness_check`; that job is a read-only in-DB reader that makes no
  venue call and enqueues nothing, so the shared minute costs a venue nothing. Its backfill arm
  does judge the queue the derives wait on (it reads unclaimed backfill-kind jobs against a
  ceiling), so a slow drain after 00:40 is reported there at 01:40 and at later hours.
- **(b) The sync's strategy derives and the fan-out must not share the backfill queue.** At the old
  slots they were an hour apart (04:30 and 05:30) and the queue was idle at 04:30. At 00:10 and
  00:40 the gap is 30 minutes. 30 minutes is the **starting value**, not a measured fit. The first
  run measures the queue (First run, reading 3) and any later move stays inside the D-13 band
  (minute 5 or later after 00:00Z, hour 22 at the latest) and goes through this runbook.
- **(c) What the 05:00 refresh needs from the sync.** Nothing. `refresh-allocator-equity` fans out
  one `refresh_allocator_equity_daily` job per key, and that handler
  (`run_refresh_allocator_equity_daily_job` in `analytics-service/services/equity_reconstruction.py`)
  reads each key's latest `allocator_holdings`, which the 04:00 poll writes. It does not read what
  the trade sync stores. So its "30 minutes after the sync" margin (the old reason) is gone and no
  replacement is needed.
- **(d) The 03:30 `reconcile-strategies` read of `api_keys.last_sync_at` stays inside its 24-hour
  gate.** With the sync at 00:10 the value it reads at 03:30 is about 3 hours old, where it used
  to be about 23 hours old. The condition is easier to meet, not harder.

**The benchmark.** `latest_completed_close_day` (`analytics-service/services/native_to_usd.py`)
returns the day before the UTC date of "now", so a mark taken at about 00:10Z needs the BTC close
of the day that just closed. `/api/cron/refresh-benchmark` writes it and refuses with a 5xx unless
the stored series reaches the previous UTC day, so a run that finds no candle yet fails loudly and
is retried by the platform. It therefore runs at 00:05Z, ahead of the 00:10Z read. If the close is
missing at read time a BTC-unit MT5 key refuses its mark with the token `native_unpriced` and
**no older close is ever used** (a stale price would be a wrong mark, not a late one).

## Left where they are

`poll-allocator-positions` (`0 4 * * *`) and `refresh-allocator-equity` (`0 5 * * *`) stay. They
feed the legacy snapshot curve, which belongs to the MARKSOURCE phase, and D-03 names "the daily
chain" as sync, derive, compute. This is a decision, recorded here so the next reader does not
take their old hours for an oversight.
2026-10-27 note: MARKSOURCE (Phase 167.2.1.1.1.1) moves these two jobs next to the mark read; see [the legacy poll and refresh move](marksource-legacy-chain-move-go-live.md).

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export NM_SP="${NM_SP:-$HOME/.cache/quantalyze/navmtm-167.2.1.1.1}"; mkdir -p "$NM_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link exists only there and it targets
  PRODUCTION. If `--workdir` is refused, run the same command with the main checkout as the
  current directory.
- `NM_SP` is a scratch directory outside the repo. Every SQL file and CSV lives there, never in a
  tracked path.
- **The CLI returns only the LAST statement's rows.** So every read here carries the marker check
  as its first column (`marker_is_prod`: 1 only when the database's own comment equals the
  manifest's `database_marker`, else 0, and a NULL comment reads 0), and every write file starts
  with a guard that RAISES.
- **Never hand-type the marker string.** The renderer reads `database_marker` from
  `scripts/prod-prober/cron-manifest.json`.
- Always `grep -a`. Tracked text is counts-only: no key ids, owner ids, emails, hostnames,
  project refs or home paths. Jobs are named by `jobname`, never by `jobid`.

The renderer extracts a named SQL form from this file, so what is run is what is written here.

```bash
cat > "$NM_SP/form.mjs" <<'JS'
import fs from "node:fs";
const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name>");
const md = fs.readFileSync("docs/runbooks/navmtm-chain-move-go-live.md", "utf8");
const m = md.match(new RegExp("<!-- form: " + name + " -->\\n```sql\\n([\\s\\S]*?)\\n```"));
if (!m) fail("no form named " + name);
const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) fail("database_marker unusable");
process.stdout.write(m[1].split("__MARKER__").join("$m$" + marker + "$m$") + "\n");
JS
```

Usage: `node "$NM_SP/form.mjs" <form-name> > "$NM_SP/<name>.sql"`, then
`q "$NM_SP/<name>.sql" > "$NM_SP/<name>.csv"`.

The plain marker read, run as its own call and recorded before anything that writes (`CLAUDE.md`,
"Which database am I on?"):

<!-- form: marker -->
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

The read-only state of the two jobs, with the marker check as its first column:

<!-- form: state -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('cron-sync-trades', 'derive-allocator-key-dailies')
 ORDER BY j.jobname;
```

## Pre-flight — ALL BLOCKING

Any item that does not return its expected answer is an ABORT: do not run Step B.

- **P0 — which database is this? (FIRST, every session).** Run the `marker` form as its own call
  and record that it names PRODUCTION (the text is already public in the manifest and is not
  repeated here). **Abort if** it names anything else or comes back NULL: a NULL means the label
  was lost, re-set it before writing, never proceed on a guess.
- **P1 — the code the new clock depends on is live.** The Railway worker revision includes plans 06
  and 07 of this phase (the mark writer), and the Vercel production deployment carries
  `/api/cron/refresh-benchmark` at `5 0 * * *`. Read both from the platforms, record the git SHAs
  (public) in the SUMMARY of the plan you are executing. **Abort if** either is not yet live.
- **P2 — the committed manifest agrees with live PROD, BEFORE anything changes.**
  `node scripts/prod-prober/run.mjs --preflight-repoint` (needs `PROBER_POOLER_URL` and
  `SUPABASE_DB_PASSWORD`; the founder exports the database password). Expected exit 0. Exit 1
  means a defect was found, read the printed remedy; exit 3 means nothing was measured, fix that
  first. Also run the `state` form: expected two rows, `cron-sync-trades` at `30 4 * * *` and
  `derive-allocator-key-dailies` at `30 5 * * *`, both active, with the command texts
  `SELECT public.cron_sync_tick();` and `SELECT enqueue_derive_broker_dailies_for_allocator_keys();`.
- **P3 — no derive is open.** `compute_jobs` has no row of kind `derive_broker_dailies` in status
  `pending`, `running`, `failed_retry` or `done_pending_children`. Moving the clock under a
  running chain would hide whether the first new-clock run is clean. **Abort if** any is open;
  wait for it.
- **P4 — `pg_cron` offers `cron.alter_job`.** Read `SELECT extversion FROM pg_extension WHERE
  extname = 'pg_cron'` (the function exists from 1.3; derive and sync were registered under 1.6).
  **Abort if** the version is below 1.3 or the function is absent from `pg_proc`.
- **P5 — the working tree is clean.** `git status --short` prints nothing, so the manifest Step C
  produces is reviewable against a known-clean baseline.
- **P6 — the broker server clock is measured and the worker setting matches it.** On a trading
  day, while a liquid symbol is visibly ticking, read the server time MT5 Market Watch shows and
  UTC at the same moment; the difference rounded to whole hours is server minus UTC. Then read
  the MT5 clock setting on every Railway service that runs the analytics worker (at the time of
  writing `quantalyze-analytics` and `quantalyze-analytics-backfill`): either
  `MT5_SERVER_UTC_OFFSET_S` alone (the fixed form, whole seconds) or, once Phase 175 is live,
  `MT5_SERVER_TIME_RULE` alone (`eu`: daylight saving from the last Sunday of March to the last
  Sunday of October, at 01:00 UTC; `us`: from the second Sunday of March to the first Sunday of
  November, at 02:00 New York time; both +2 h outside daylight saving and +3 h inside it). The
  setting must give today's reading. Record the date, the whole-hour difference and the setting
  (a rule id or a whole-hour count) in the SUMMARY of the plan being executed, never the server
  name, a login or a balance. **Abort if** the setting is absent on any of those services, both
  variables are set, or the setting disagrees with the reading, because a flow made in the hour
  after a mark's read is then filed on the wrong side of it (Phase 167.2.1.1.1 REVIEW-3 WR-02,
  Phase 175).

## Step B — the move

Re-run P0, P2 and P3 immediately before it, and keep the merge hold (below) from now on.
Re-run P6 too when the move happens on another day than the P6 reading.

One statement moves both jobs, so both move or neither does. The guard first refuses unless the
database names PRODUCTION AND both jobs are at their expected starting schedule and command (a
compare-and-set: PROD that drifted somewhere this runbook was not looking is not overwritten).

<!-- form: move -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'cron-sync-trades' AND schedule = '30 4 * * *' AND command = 'SELECT public.cron_sync_tick();') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'derive-allocator-key-dailies' AND schedule = '30 5 * * *' AND command = 'SELECT enqueue_derive_broker_dailies_for_allocator_keys();') <> 1 THEN
    RAISE EXCEPTION 'live jobs are not at their expected starting schedule and command; refusing to continue';
  END IF;
END
$guard$;
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'cron-sync-trades'), schedule := '10 0 * * *') AS sync_moved, cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'derive-allocator-key-dailies'), schedule := '40 0 * * *') AS derive_moved; -- WRITE
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('cron-sync-trades', 'derive-allocator-key-dailies')
 ORDER BY j.jobname;
```

- **Expected readback:** two data rows, both with `marker_is_prod` 1: `cron-sync-trades` at
  `10 0 * * *` and `derive-allocator-key-dailies` at `40 0 * * *`, both active, command texts
  exactly as in P2. Anything else is a defect: run the `state` form and the rollback.
- `IS DISTINCT FROM` in the guard is deliberate: a NULL marker refuses exactly as a mismatched one
  does. A retry after an ambiguous CLI error is safe: the compare-and-set refuses once the jobs
  have moved, so read the `state` form first.
- This statement lives HERE and in no migration, for the reason in "What this activates".

## Step C — the manifest, in the SAME session

The moment Step B succeeds, PROD carries two schedules the committed manifest does not, and the
hourly `cron-drift` arm reports them on every prober run. Finish this step before the session ends.
Never wait the drift out and never silence the arm.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out "$NM_SP/cron-manifest-capture.json"
diff scripts/prod-prober/cron-manifest.json "$NM_SP/cron-manifest-capture.json"
```

- The capture refuses and writes nothing on: no `--out`; an unlabelled database; a `cron.job`
  record it cannot parse or whose count disagrees with the database's own row count (exit 3); or a
  row failing a hygiene rule (exit 1). A refusal is information, not an obstacle.
- **Expected diff:** exactly the two `schedule` strings (`cron-sync-trades` `10 0 * * *`,
  `derive-allocator-key-dailies` `40 0 * * *`) and the `captured_at` line. Nothing else.
- **Abort (do not move the file into place) if any OTHER field or job differs.** PROD drifted
  somewhere this runbook was not looking, and committing the manifest would bless it. Investigate
  with the read-only P2 comparison. **Never edit the manifest by hand.**
- On exactly the expected diff: move the file into place, then `node scripts/prod-prober/run.mjs
  --preflight-repoint` must exit 0, and `npx vitest run src/__tests__/prod-prober-wiring.test.ts`
  plus `node scripts/prod-prober/run.mjs --self-test` stay green. The capture ships as its own PR
  through the normal ship flow, merged outside the hold below.

## First run (the first 00:10Z after Step B) — readings

Counts and ages only. No key id, strategy id, owner id or amount goes into a tracked file. The
reading plan (14) records these; this runbook says how. Run each through the marker-first
convention above.

1. **The closed day's BTC close exists.** `SELECT count(*) FROM benchmark_prices WHERE
   symbol = 'BTC' AND date = <the day that just closed>`, expected 1 (`BTC` is the default symbol of the
   benchmark service in `analytics-service/services/benchmark.py`). The table stores no write time, so precedence over the 00:10Z read is evidenced by the
   Vercel invocation time of the refresh (00:05Z, from the platform log) and by zero
   `native_unpriced` refusals that night. If it is missing, record how many keys refused.
2. **Funding arrival (RESEARCH 4.2, assumption A3).** Per exchange, the newest `funding_fees`
   `timestamp` and the age of the newest row with `timestamp` on the 00:00:00Z boundary, relative
   to the start of the sync run (`cron_runs`, `cron_name = 'cron_sync'`). The point is whether
   settlements stamped 00:00Z had reached the read APIs by about 00:10Z. After the start every
   return is the observed difference between two stored marks, so lag cannot corrupt a stored
   value; the reading is for the trade-sync freshness and the pre-start history.
3. **Queue drain (assumption A8).** For `compute_jobs` of kind `derive_broker_dailies` created
   between 00:00Z and 02:00Z: the min and max of `created_at`, `claimed_at` and `updated_at` for
   the jobs the 00:10Z tick enqueued (strategy-mode, `strategy_id` set) and for those the 00:40Z
   fan-out enqueued (`api_key_id` set), and the count of open jobs at 00:40Z. If the first set had
   not drained when the second was enqueued, propose a later fan-out slot inside the D-13 band and
   run it through this runbook (alter the schedule, then Step C again).
4. **Rate limits.** The count of 429 or rate-limit lines in the worker logs from 00:00Z to 01:45Z.
5. **Marks written.** Per venue, the number of keys with a mark for the closed day in
   `api_key_nav_marks` and the min and max of `marked_at`. The table exists once plan 06's
   migration has applied.
6. **Refusals by token.** Per refusal token, the count in the worker log lines of that night.
7. **The cron set equals the manifest.** The next hourly prober run's `cron-drift` arm reports no
   defect.

## Mark refusals (Phase 174)

*Added 2026-10-27 (Phase 174 MARKPAUSE, D-02 and D-03).* When a derive's mark read is refused, the
reason and the day it began are kept on one row per key, in `allocator_equity_derived`,
`kind = 'nav_mark_refusal:<api_key_id>'`. The row is owner-SELECT and service-role write, so it is
readable by the key's owner or by an admin through the service role, and it is **never** in the
public `strategy_analytics.data_quality_flags`. The payload is `{token, first_seen_day,
last_seen_day}` and nothing else: ISO UTC label days (a read at 00:10Z on the 8th labels the 7th)
and a token from the closed set `MARK_REFUSAL_TOKENS` in `analytics-service/services/nav_marks.py`,
which is where each token's meaning is written. A later refusal of the same key keeps
`first_seen_day` and moves `last_seen_day`; the row is deleted when a derive of that key stores or
finds the day's mark. A row therefore means "this key was last refused on `last_seen_day`", not "the
key is paused now": a row can be stale if the clear failed (it logs a WARNING and is not retried), and
a key that was disconnected, revoked, deactivated or deleted while refused never clears its row. The
readout counts only keys that can still be derived, but even for those, compare `last_seen_day` with
the key's latest derive before reading a row as a live pause.

The readout is read-only, runs through the marker-first convention above, and names no owner id and
no key id: it returns one row per token and day pair with a count.

<!-- form: mark-refusals -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, r.token, r.first_seen_day, r.last_seen_day, r.refused_keys
  FROM m
  LEFT JOIN (
    SELECT aed.payload->>'token' AS token,
           aed.payload->>'first_seen_day' AS first_seen_day,
           aed.payload->>'last_seen_day' AS last_seen_day,
           count(*) AS refused_keys
      FROM public.allocator_equity_derived aed
      JOIN public.api_keys ak
        ON aed.kind = 'nav_mark_refusal:' || ak.id::text
       AND ak.user_id = aed.allocator_id
       AND ak.disconnected_at IS NULL
       AND ak.sync_status IS DISTINCT FROM 'revoked'
       AND ak.is_active
     WHERE aed.kind LIKE 'nav_mark_refusal:%'
     GROUP BY 1, 2, 3
  ) r ON true
 ORDER BY r.token, r.first_seen_day;
```

Render and run it with `node "$NM_SP/form.mjs" mark-refusals > "$NM_SP/mark-refusals.sql"` then
`q "$NM_SP/mark-refusals.sql"`. Expect `marker_is_prod = 1` on every row. With no refused key the
readout is one row with NULLs after the marker column.

## Merge and deploy hold

From the move on, no merge to `main` from any phase between **00:00 UTC and 01:45 UTC**, and in any
case until open `derive_broker_dailies` jobs are 0 again. Reason: a merge redeploys the analytics
service, which would cut a running `cron_sync` request, and a Railway redeploy of the backfill
service kills a derive mid-run and strands its in-flight jobs for up to the per-kind watchdog
threshold. This replaces the 04:00-05:45 hold the other runbooks state (each carries a dated note
pointing here). Before Step B the old window still applies.
2026-10-27 note: MARKSOURCE extends this hold to 45 minutes after the moved refresh slot; see [the legacy poll and refresh move](marksource-legacy-chain-move-go-live.md).

## Rollback

Same compare-and-set, reversed. Run P0 first.

<!-- form: rollback -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'cron-sync-trades' AND schedule = '10 0 * * *') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'derive-allocator-key-dailies' AND schedule = '40 0 * * *') <> 1 THEN
    RAISE EXCEPTION 'live jobs are not at the moved schedule; refusing to continue';
  END IF;
END
$guard$;
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'cron-sync-trades'), schedule := '30 4 * * *') AS sync_back, cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'derive-allocator-key-dailies'), schedule := '30 5 * * *') AS derive_back; -- WRITE
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('cron-sync-trades', 'derive-allocator-key-dailies')
 ORDER BY j.jobname;
```

- Expected readback: `cron-sync-trades` at `30 4 * * *` and `derive-allocator-key-dailies` at
  `30 5 * * *`, marker 1.
- Then, in the SAME session, re-capture the manifest as in Step C. The expected diff is the two
  schedules back to their old strings and `captured_at`, nothing else.
- Marks already stored stay: they are write-once (D-06) and rolling the clock back does not
  delete them. The Vercel schedule rolls back by reverting `vercel.json` and deploying; leaving it
  at 00:05Z is harmless, because the benchmark refresh has no ordering dependency on the late
  chain.
- If the chain has already run at the new clock and left open jobs, let them drain: they are the
  same work, and a stored mark is valid data. Do not delete jobs.

## What this runbook does not cover

- **The mark writer, the marks table and the consumers** (plans 06 onward). This runbook only moves
  the clock.
- **The legacy poll and snapshot refresh.** Left in place on purpose (above).
- **Applied migrations that say "MERGE OUTSIDE 04:00-05:45".** Three applied migrations carry that
  sentence in their header. Applied migrations are never edited; the windows above supersede it in
  the runbooks, and the migration headers are history.
- **Reading `cron.job_run_details.status` as proof of the derive work.** It proves the SQL ran, not
  the worker side.
