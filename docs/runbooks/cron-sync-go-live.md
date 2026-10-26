# Runbook — Daily Trade-Sync Tick Go-Live (TRADESYNC, Phase 167.1.2.2.2)

**Owner:** the orchestrator runs the live ops (PROD writes are authorized, founder 2026-10-03); the
founder is told what was written · **Audience:** whoever registers, watches or rolls back the daily
trade sync, months from now, with no memory of this phase · **Risk:** a live PROD `pg_cron` job
makes the analytics service read the exchange accounts behind every connected strategy key once a
day, and the steps before it write PROD data (carry-forward of stored points, a freshness seed).
Read "Blast radius" and "What this runbook does not cover" before the pre-flight.

## What this activates

One daily PROD `pg_cron` job named `cron-sync-trades`, schedule `30 4 * * *` (UTC), command
`SELECT public.cron_sync_tick();`.

> **MOVED 2026-10-26 (Phase 167.2.1.1.1 NAVMTM, D-03).** From the live move recorded in
> `docs/runbooks/navmtm-chain-move-go-live.md` the schedule is `10 0 * * *`
> (00:10Z), ahead of which `/api/cron/refresh-benchmark` runs at 00:05Z. Every 04:30 or 04:15-05:45
> statement below describes the original registration and holds until that move.

The chain it starts:

1. `public.cron_sync_tick()` reads the service key from Vault and the service URL from
   `public.system_settings`, and posts one empty JSON body to the analytics service's
   `POST /api/cron-sync` through `pg_net`. It returns a request id, nothing more.
2. `cron_sync` in `analytics-service/routers/cron.py` selects the connected keys that back an
   eligible strategy, resumes each strategy from its own marker (or, with no marker, from its own
   newest stored daily-P&L day floored to 00:00 UTC), fetches the venue's daily P&L, stores it
   through the `sync_trades` RPC, advances the marker and stamps
   `strategy_analytics.trades_fetched_at`, and enqueues a strategy-mode `derive_broker_dailies`
   job per strategy that stored rows.
3. The backfill worker runs those derives and rewrites `csv_daily_returns` and the strategy's
   analytics.
4. The run writes one counter-only `cron_runs` row (`cron_name = 'cron_sync'`).

The tick function is defined once, in `supabase/migrations/20261010140000_cron_sync_tick.sql`, and
the two columns it feeds in `20261010130000_strategy_analytics_trade_fetch_provenance.sql`. **The
schedule is not a migration** (the Phase 164.7 rule): a PROD migration auto-applies after
`apply-test` with no human gate, so a migration that wrote the live job catalog would be an
unreviewed catalog write that also skips the rehearsal below. The registration is Step C, run by
hand behind a database-marker guard.

**Why 04:30.** Re-read the slot occupancy from the committed manifest at run time, never from this
paragraph:

```bash
node -e 'const m=require("./scripts/prod-prober/cron-manifest.json");for(const j of m.jobs.slice().sort((a,b)=>a.schedule.localeCompare(b.schedule)))console.log(j.schedule.padEnd(14)+j.jobname)'
```

The reasons the slot was chosen (RESEARCH Section 1), each to be re-checked against that listing:
(a) it sits after the 04:00 poll cluster, which shares per-IP OKX and Bybit rate limits with the
tick; (b) the strategy-mode derives the tick enqueues run on the backfill queue that the 05:30
allocator derive floods, and at 04:30 that queue is idle; (c) it leaves 30 minutes before the
05:00 refresh; (d) the 03:30 Vercel `reconcile-strategies` read of `api_keys.last_sync_at` still
sees a value inside its 24-hour gate. If the listing shows another job at `30 4 * * *`, stop and
choose a different slot with the founder before Step C.

> **MOVED 2026-10-26 (Phase 167.2.1.1.1 NAVMTM, D-03).** The four reasons above are
> re-derived for the 00:10Z slot in `docs/runbooks/navmtm-chain-move-go-live.md`
> ("Why these slots"): (a) the 04:00 poll no longer precedes the sync; (b) the sync's strategy
> derives and the fan-out are 30 minutes apart (00:10Z and 00:40Z), a starting value the first run
> measures; (c) the 05:00 refresh never read what the sync stores, so that margin is gone; (d) the
> 03:30 reconcile read now sees a value about 3 hours old.

## Why it is safe now

What closed the failure modes of a first tick, each cited by SYMBOL. **Re-read each value at
execution time; this section deliberately states none** beyond the 180 s the migration declares.

- **The selector.** `cron_sync` reads only `is_active` keys with `disconnected_at IS NULL` and
  drops any key with no eligible strategy before any venue call (`skipped_no_strategy` in the
  response). D-13, plan 06. `ALLOWED_STRATEGY_STATUSES` is the eligibility set.
- **The resume window.** `_load_strategy_high_waters`, `_strategy_resume_point`,
  `_resume_floor_ms` and `_floor_to_utc_day_ms` in `routers/cron.py`: a strategy with no marker
  resumes from its own stored high-water, unclamped, at 00:00 UTC of that day (D-11, plan 05). A
  seeded marker would have been clamped to 30 days by `MAX_MARKER_LOOKBACK_MS`, which is why this
  runbook seeds nothing in `strategy_sync_cursors`.
- **The timeout budget.** `KEY_SYNC_TIMEOUT`, `BATCH_SIZE` and `EXCHANGE_BATCH_DELAY` in
  `routers/cron.py`, against `timeout_milliseconds` in the tick migration.
  `analytics-service/tests/test_cron_sync_timeout_budget.py` derives the filtered worst case from
  those constants and fails if the batch structure or the timeout changes (plan 06). It is a PLAN,
  not a measurement: Step B is the measurement.
- **The heartbeat.** `_heartbeat_cron_sync` and `_record_cron_sync_run`: one `cron_runs` row per
  run, on every exit path, counters only.
- **The freshness stamp.** `strategy_analytics.trades_fetched_at`, single writer `cron_sync`,
  stamped only when the strategy advanced.

## Blast radius

Counts as measured 2026-10-10 (re-measure with `stepa-proof` and `p1`):

1. **Population.** The tick selects every connected key that backs an eligible strategy: 12 keys.
   Four are on ccxt trade venues (okx 3, bybit 1) and are the ones that fetch. Eight are `mt5`
   keys, which take the benign `deferred` path (no venue call, no write, the key stays active).
   The `mt5` group adds one inter-batch delay (`EXCHANGE_BATCH_DELAY`) to the run, about 2 s; it
   does not change the verdict arithmetic. `expected_keys` in `stepb-response` is this 12.
2. **Strategies.** Five strategies sit on ccxt keys: three published OKX strategies (one of them
   on a DISCONNECTED key, which the tick does not read), one `pending_review` OKX strategy and one
   `pending_review` Bybit strategy. 0 portfolios hold any of them, so the portfolio recompute
   cascade has nothing to do.
3. **Drift window.** The moment Step C succeeds, PROD `cron.job` carries a row the committed
   manifest `scripts/prod-prober/cron-manifest.json` does not. The hourly `cron-drift` arm reports
   one defect per prober run until the manifest lands on `main`. Finish Step D in the same session.
   The remedy is never to wait it out and never to silence the arm.
4. **Public numbers change.** The three published OKX strategies read their series from
   `csv_daily_returns`. Step A2 (D-08) carries their stored points into that table first, so the
   first derive extends the published history instead of replacing it with the roughly 3 months
   OKX still serves. The headline of a merged series is suffix-only, see plan 07's
   `merged-series-measurement` block; the founder confirmation of plan 16 is a precondition of
   Step A2.
5. **Accepted residual risks.**
   - **No human is paged when the tick fails.** See "What this runbook does not cover".
   - **A merge redeploys the analytics service mid-run.** P6 holds merges around the tick.
   - **The first run is a backfill.** See "The rehearsal is the first backfill" in Step B.

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export TS_SP="${TS_SP:-$HOME/.cache/quantalyze/tradesync-167.1.2.2.2}"; mkdir -p "$TS_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link (`supabase/.temp/project-ref`) exists only
  there, and it targets PRODUCTION. `--agent no` pins plain CSV with no envelope. Pass `-f` an
  ABSOLUTE path: the CLI resolves a relative one against `--workdir`.
- `TS_SP` is the scratch directory: outside the repo, persistent, shared by every session of this
  phase. Every SQL file and CSV lives there, never in a tracked path.
- **The CLI returns only the LAST statement's rows.** A marker query that is merely the first
  statement is invisible. So every read carries the marker as its first column
  (`marker_is_prod`: 1 only when the database's own comment equals the manifest's
  `database_marker`, else 0; a NULL comment reads 0), every read returns at least one row, and
  every write file starts with a guard that RAISES.
- **Never hand-type the marker string.** The renderer below reads `database_marker` from
  `scripts/prod-prober/cron-manifest.json` and builds both the guard and the read column from it.
- **A file passed to the CLI must not start with a `--` comment**; the renderer never emits one.
- Always `grep -a`. Pipelines run under `set -o pipefail`.
- Tracked text is counts-only: no key ids, owner ids, strategy ids, emails, project refs, account
  numbers or home paths. Strategies and keys are named by ORDINAL below.

The renderer extracts a named SQL form from this very file, so what is run is what is written
here. Install it once:

```bash
cat > "$TS_SP/form.mjs" <<'JS'
import fs from "node:fs";

const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name, ...kv] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name> [KEY=value ...]");
const md = fs.readFileSync("docs/runbooks/cron-sync-go-live.md", "utf8");
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
const WRITE = /-- WRITE\s*$/;
const expand = (sql, depth) => {
  if (depth > 4) fail("expansion too deep");
  return sql.split("\n").map((line) => {
    const tagged = WRITE.test(line);
    const out = line.replace(/__([A-Z0-9_]+)__/g, (tok, key) => {
      if (key in params) return params[key];
      let text = body(key.toLowerCase().replace(/_/g, "-"));
      if (text === null) fail("unresolved " + tok);
      if (key === "GUARD" && guardTest === "mismatch") text = text.replace("__MARKER__", () => "$m$mismatch$m$");
      if (key === "GUARD" && guardTest === "null") {
        if (!text.includes(LIVE)) fail("guard shape changed");
        text = text.replace(LIVE, () => "NULL::text");
      }
      return expand(text, depth + 1);
    });
    // A fragment expanded on a line that ends in `-- WRITE` is part of the write
    // statement, so every line of it is a write line (DRY strips the whole statement).
    if (!tagged || !out.includes("\n")) return out;
    return out.split("\n").map((l) => (WRITE.test(l) ? l : l + " -- WRITE")).join("\n");
  }).join("\n");
};
const form = body(name);
if (form === null) fail("no form named " + name);
let sql = expand(form, 0);
if (dry) {
  sql = sql.split("\n").filter((l) => !WRITE.test(l)).join("\n");
  const scan = sql.split(params.MARKER).join("''");
  if (/cron\.(un)?schedule\s*\(|cron_sync_tick\s*\(|enqueue_\w+\s*\(|\b(insert|update|delete)\b/i.test(scan)) fail("DRY render still carries a write");
}
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$TS_SP/form.mjs" <form-name> [KEY=value ...] > "$TS_SP/<file>.sql"`, then
`q "$TS_SP/<file>.sql" > "$TS_SP/<file>.csv"`.

- `DRY=1` deletes every line ending in `-- WRITE` and refuses to emit a file that still contains
  `cron.schedule(`, `cron.unschedule(`, a `cron_sync_tick(` call, an `enqueue_...(` call, or an
  INSERT, UPDATE or DELETE. The scan first removes the marker literal, because the marker's own
  sentence contains the word DELETE; do the same before grepping a file by hand for those words.
- **A write statement is tagged line by line.** Every line of a write statement ends in
  `-- WRITE`, and a shared fragment expanded on such a line is tagged by the renderer, so a DRY
  render removes the whole statement and leaves the guard and the readback. A write form in this
  file therefore never has an untagged line inside its INSERT, UPDATE or DELETE.
- `GUARD_TEST=mismatch` or `GUARD_TEST=null` renders the guard's two refusal variants.
- **Parameters** are `KEY=value` with a value of letters, digits and `: . + -`:

| Parameter | Meaning | Example |
|---|---|---|
| `STRATS` | strategy ordinals to act on, `.`-separated | `1.2.3` |
| `ORACLE_INPUT` | the candidate series the oracle compounds | `grid` |
| `PRE_HW` | pre-tick high-water per strategy, `ordinal:date` pairs separated by `.`, or `none` | `1:2026-05-06.2:2026-05-23` |
| `REDERIVED` | per strategy, the first re-derived date for the rollback cutoff, same shape as `PRE_HW`, or `none` | `none` |
| `START` | the database clock read before the write, `YYYY-MM-DDTHH:MM:SS.UUUUUUZ` | |
| `REQ` | the pg_net request id the tick returned | `4431` |
| `RUN_AT` | 04:30Z of a run day | `2026-10-11T04:30:00Z` |

- **Ordinals are not ids.** `strategy_ordinal` numbers the strategies on `okx`, `bybit` and
  `binance` keys by `(created_at, id)`; `key_ordinal` numbers their keys the same way. A new
  strategy appends at the end, so an ordinal read today still names the same strategy tomorrow.
  `stepa-proof` prints the ordinals and the exact `PRE_HW` string to pass later.

Forms and their parameters (the executing plans name their own files under `TS_SP`):

| Form | Parameters |
|---|---|
| `marker`, `guard-check`, `p1`, `p3`, `stepa-proof`, `d08-detect`, `stepc-register`, `jobid`, `rollback` | none |
| `d08-before`, `d08-write`, `d08-after`, `d08-provenance`, `d10-before`, `d10-write`, `d10-after`, `gap-write` | `STRATS` |
| `d08-oracle` | `STRATS`, `ORACLE_INPUT` |
| `d08-rollback` | `STRATS`, `REDERIVED` |
| `stepb-tick` | none |
| `stepb-response` | `START`, `REQ` |
| `stepb-downstream` | `START`, `PRE_HW` |
| `gap-measure` | none |
| `okxhistory-worklist` | `PRE_HW` |
| `first-tick` | `RUN_AT` |

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

The guard proves itself on PROD before anything writes, on three branches. Each run renders the
same form with one change:

<!-- form: guard-check -->
```sql
__GUARD__
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job WHERE jobname = 'cron-sync-trades') AS job_rows
  FROM m;
```

- Positive (no `GUARD_TEST`): returns one row; before Step C it is `1,0`, after it `1,1`.
- `GUARD_TEST=mismatch`: must exit non-zero with `refusing to continue` and return NO row.
- `GUARD_TEST=null`: the live value replaced by a NULL text literal; same expectation. This is
  the proof that a lost marker refuses rather than passes.

### Shared fragments

Three CTE fragments the forms below expand. They are forms so that detection, write, readback and
oracle all read one definition. A fragment holds CTEs only, has no trailing comma, and is used as
`WITH __NAME__, next_cte AS (...)`.

The universe: every strategy on a ccxt trade venue's key, with its ordinals.

<!-- form: strat-universe -->
```sql
u AS (
  SELECT s.id AS strategy_id, s.api_key_id AS key_id, s.status, lower(k.exchange) AS venue,
         (k.is_active AND k.disconnected_at IS NULL) AS connected,
         k.last_sync_at AS key_last_sync_at,
         row_number() OVER (ORDER BY s.created_at, s.id) AS strategy_ordinal,
         dense_rank() OVER (ORDER BY k.created_at, k.id) AS key_ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) IN ('okx', 'bybit', 'binance')
)
```

The tick population inside it: connected, and the strategy's status is in the route's
`ALLOWED_STRATEGY_STATUSES`.

<!-- form: tick-scope -->
```sql
__STRAT_UNIVERSE__,
t AS (
  SELECT u.* FROM u
   WHERE u.connected AND u.status IN ('draft', 'pending_review', 'published', 'private')
)
```

The D-08 scope: the OKX strategies, with what the carry-forward and its oracle need. The
compounding method follows the row's own `data_quality_flags->>'cumulative_method'`; an absent flag
reads `geometric`, the default `services/wealth_returns.curve_method_from_flags` applies. An absent
flag while `strategies.returns_denominator_config->>'cumulative_method'` is `simple` is ambiguous
(`method_conflict`), as is a present flag that is neither literal. A curve of 5000 points is the
`cap_data_points` ceiling, so its first point is not the series start (`curve_capped`).

<!-- form: d08-scope -->
```sql
__STRAT_UNIVERSE__,
d08 AS (
  SELECT u.strategy_ordinal, u.strategy_id, u.status, u.connected,
         (SELECT count(*) FROM csv_daily_returns c WHERE c.strategy_id = u.strategy_id) AS csv_rows,
         (SELECT jsonb_array_length(g.payload) FROM strategy_analytics_series g
           WHERE g.strategy_id = u.strategy_id AND g.kind = 'daily_returns_grid' AND jsonb_typeof(g.payload) = 'array') AS grid_points,
         CASE WHEN jsonb_typeof(a.returns_series) = 'array' THEN jsonb_array_length(a.returns_series) ELSE 0 END AS curve_dates,
         a.data_quality_flags ->> 'cumulative_method' AS flag_method,
         st.returns_denominator_config ->> 'cumulative_method' AS cfg_method
    FROM u
    JOIN strategies st ON st.id = u.strategy_id
    LEFT JOIN strategy_analytics a ON a.strategy_id = u.strategy_id
   WHERE u.venue = 'okx'
),
d08m AS (
  SELECT d08.*,
         CASE WHEN flag_method IN ('geometric', 'simple') THEN flag_method ELSE 'geometric' END AS cumulative_method,
         CASE WHEN flag_method IS NULL THEN 'default' ELSE 'flag' END AS method_source,
         coalesce((flag_method IS NULL AND cfg_method = 'simple')
                  OR (flag_method IS NOT NULL AND flag_method NOT IN ('geometric', 'simple')), false) AS method_conflict,
         (curve_dates >= 5000) AS curve_capped
    FROM d08
)
```

## Pre-flight — ALL BLOCKING

Any item that does not return its expected answer is an ABORT: do not run Step A2 or later.

### P0 — which database is this? (FIRST, every session)

Run the `marker` form as its own call and record the answer (that it names PRODUCTION; the text
itself is already public in the manifest and is not repeated in tracked files). Then the positive
`guard-check` (expect `1,0` before Step C; after Step C expect `1,1`).

- **Abort if** the marker names anything else or comes back NULL. A NULL means the label was lost:
  re-set it before writing, never proceed on a guess.

### P1 — the tick exists, is locked down, the job does not, and the columns are there

<!-- form: p1 -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       coalesce((SELECT count(*) = 1
                        AND bool_and(p.prosecdef AND p.pronargs = 0
                                     AND NOT EXISTS (SELECT 1
                                                       FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                                      WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner))
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'cron_sync_tick'), false)::int AS fn_ok,
       (SELECT count(*) FROM cron.job WHERE jobname = 'cron-sync-trades') AS job_rows,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'strategy_analytics'
           AND column_name IN ('trades_fetched_at', 'series_provenance')) AS columns_present
  FROM m;
```

- **Expected before Step C:** `fn_ok = 1` (exactly one function of that name, SECURITY DEFINER, no
  arguments, EXECUTE held by the owner alone), `job_rows = 0`, `columns_present = 2`. After Step C,
  `job_rows` is exactly `1`.
- **Abort if** `fn_ok = 0`, `columns_present` is not 2, or `job_rows` is not the expected value
  for the step you are about to run.

### P2 — Railway: the analytics service is healthy on the code that ships the fixes

Run from `QZ_MAIN` (where the Railway CLI is linked). Reads only; prints no variable values and no
deployment or service ids. `PRB_SHA` is the merge commit of the PR that shipped plans 05 and 06
(git SHAs are public).

```bash
cat > "$TS_SP/p2.mjs" <<'JS'
import { execFileSync } from "node:child_process";
const sh = (args) => execFileSync("railway", args, { encoding: "utf8", cwd: process.env.QZ_MAIN, stdio: ["ignore", "pipe", "ignore"] });
let abort = false;
const svc = "quantalyze-analytics";
const dep = JSON.parse(sh(["deployment", "list", "--service", svc, "--limit", "1", "--json"]))[0];
const replicas = dep.meta.serviceManifest.deploy.numReplicas;
const ok = dep.status === "SUCCESS" && replicas === 1;
if (!ok) abort = true;
console.log(svc + ": status=" + dep.status + " commit=" + String(dep.meta.commitHash || "").slice(0, 9) + " replicas=" + replicas + " -> " + (ok ? "OK" : "ABORT"));
const st = JSON.parse(sh(["status", "--json"]));
const api = st.environments.edges[0].node.serviceInstances.edges.map((e) => e.node).find((n) => n.serviceName === svc);
const host = api && api.domains.serviceDomains[0] && api.domains.serviceDomains[0].domain;
const h = host ? await (await fetch("https://" + host + "/health")).json() : {};
const want = String(process.env.PRB_SHA || "");
const sha = String(h.git_sha || "");
const shaOk = want.length >= 7 && sha.length >= 7 && (sha.startsWith(want) || want.startsWith(sha));
console.log("api health: status=" + h.status + " config_ok=" + h.config_ok + " git_sha=" + sha.slice(0, 9) + " matches PRB_SHA=" + shaOk);
if (h.status !== "ok" || h.config_ok !== true || !shaOk) abort = true;
process.exit(abort ? 1 : 0);
JS
PRB_SHA=<merge sha> node "$TS_SP/p2.mjs"
```

- **Expected:** `OK`; API health `ok`; `matches PRB_SHA=true`. Record the deployed SHA in the
  SUMMARY of the plan you are executing.
- **Abort if** the service is mid-deploy, is not at 1 replica, or `/health` reports a `git_sha`
  other than the one that ships the selector filter and the resume fix: the tick would run the old
  code, which resumes from the poll's `last_sync_at` and reads 42 keys.

### P3 — no backfill-kind compute job is open

<!-- form: p3 -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM compute_jobs
         WHERE status IN ('pending', 'running', 'failed_retry', 'done_pending_children')
           AND kind IN ('derive_broker_dailies', 'derive_allocator_equity')) AS open_backfill_jobs
  FROM m;
```

- **Expected before Step B:** `open_backfill_jobs = 0`. The rehearsal's own derives are read per
  strategy afterwards; an unrelated open job muddies that reading.
- **Abort if** it is above 0: wait for it to drain.

### P4 — the committed manifest agrees with live PROD, BEFORE anything changes

```bash
node scripts/prod-prober/run.mjs --preflight-repoint
```

Needs `PROBER_POOLER_URL` and `SUPABASE_DB_PASSWORD` (the founder exports the database password;
the prober reads `SUPABASE_DB_PASSWORD`, not `PGPASSWORD`). Expected exit 0. Exit 1 means a defect
was found, read the printed remedy; exit 3 means nothing was measured, fix that first. Required
before Step C, not before Step A (Steps A to B write no `cron.job` row).

### P5 — the working tree is clean

`git status --short` prints nothing. The manifest Step D produces must be reviewable against a
known-clean baseline.

### P6 — the merge hold

On a tick day, no merge to `main`, from any phase, from 04:15 UTC to 05:45 UTC.
**MOVED 2026-10-26 (Phase 167.2.1.1.1 NAVMTM, D-03):** from the live move recorded in
`docs/runbooks/navmtm-chain-move-go-live.md` the hold is **00:00 UTC to 01:45 UTC**; before that move the
window in this sentence applies. Reason: a merge
redeploys the analytics service, which would cut a running `cron_sync` request, and a later
deploy strands in-flight strategy derives on the backfill service. During the Step B rehearsal
the hold runs from the start of the tick until `open_backfill_jobs` is 0 again.

## Step A — the pre-tick proof (read only, D-11)

Go: founder decision D-11 (amends ROADMAP SC-2), 2026-10-09. **Nothing is seeded in
`strategy_sync_cursors`.** A seeded marker would be clamped to 30 days by `MAX_MARKER_LOOKBACK_MS`,
which would cut the three gaps older than that; the route resumes a marker-less strategy from its
own newest stored daily-P&L day instead, unclamped. This step proves the premise of that design on
live data before the first tick, and records what the tick will do.

Run the `stepa-proof` form. One row per strategy in the tick population (connected key on an
`okx`, `bybit` or `binance` venue, strategy status in the route's eligible set):

<!-- form: stepa-proof -->
```sql
WITH __TICK_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
r AS (
  SELECT t.key_ordinal, t.strategy_ordinal, t.venue, t.status AS strategy_status, t.key_last_sync_at,
         (SELECT count(*) FROM trades x WHERE x.strategy_id = t.strategy_id AND NOT x.is_fill) AS pnl_rows,
         (SELECT (max(x.timestamp) AT TIME ZONE 'UTC')::date FROM trades x
           WHERE x.strategy_id = t.strategy_id AND NOT x.is_fill) AS newest_pnl_date,
         (SELECT count(*) FROM strategy_sync_cursors c WHERE c.strategy_id = t.strategy_id) AS marker_rows
    FROM t
)
SELECT m.marker_is_prod, r.key_ordinal, r.strategy_ordinal, r.venue, r.strategy_status, r.pnl_rows,
       r.newest_pnl_date,
       ((now() AT TIME ZONE 'UTC')::date - r.newest_pnl_date) AS newest_pnl_age_days,
       r.marker_rows,
       round((extract(epoch FROM (now() - r.key_last_sync_at)) / 86400)::numeric, 2) AS last_sync_age_days,
       r.newest_pnl_date AS expected_floor_date,
       coalesce((SELECT string_agg(x.strategy_ordinal::text || ':' || x.newest_pnl_date::text, '.' ORDER BY x.strategy_ordinal)
                   FROM r x WHERE x.newest_pnl_date IS NOT NULL), 'none') AS pre_hw_param
  FROM m LEFT JOIN r ON true
 ORDER BY r.key_ordinal, r.strategy_ordinal;
```

Columns: `newest_pnl_date` and `newest_pnl_age_days` (the newest daily-P&L row, UTC date, and its age
in days), `pnl_rows`, `marker_rows` (the strategy's `strategy_sync_cursors` rows, **expected 0 for
every row**), `last_sync_age_days` (the key's `last_sync_at`; the 04:00 poll rewrites it daily, so
it is expected near 0 and is the number the old fallback would have wrongly resumed from),
`expected_floor_date` (the day the tick will resume from: the newest daily-P&L day at 00:00 UTC;
empty means nothing stored and a full-reach fetch), and `pre_hw_param` (the `PRE_HW` string every
later form takes; the same on every row).

- **Record, per strategy:** the pre-tick high-water date (`newest_pnl_date`), and keep
  `pre_hw_param` in a file under `TS_SP`. The pair "pre-tick high-water, post-tick earliest new
  row" is the D-09 work list for the follow-on phase OKXHISTORY.
- **The widest window.** `max(newest_pnl_age_days)` over the rows is the widest span, in days, the
  first fetch will request. It is quoted in the rehearsal verdict (below). OKX serves roughly the
  last 3 months of daily P&L, so a window wider than that is only partly recoverable by the tick.
- **Abort if** any `marker_rows` is not 0 (someone seeded or a tick already ran; the premise of
  this proof is gone, re-plan), or a row has `marker_is_prod` 0.

## Step A2 — the D-08 carry-forward (a PROD data write)

**Precondition: the founder confirmation of plan 16 Task 1.** Without it, stop here. D-08 (founder,
2026-10-09): each OKX strategy's existing stored points are carried forward into the
daily-returns table, marked as legacy, so the re-derive extends the published history instead of
replacing it with the roughly 3 months OKX still serves.

**Why the source is the per-day grid, never `returns_series`.** `strategy_analytics.returns_series`
is the CUMULATIVE curve (`compute_all_metrics` in `services/metrics.py` builds it from `cumulative`),
so carrying its values as daily returns would be wrong money math. The source is
`strategy_analytics_series` kind `daily_returns_grid`, written by `_daily_returns_grid_from_series`.
The insert mirrors what `run_csv_strategy_analytics` reads: strategy-axis rows (`strategy_id` set,
`api_key_id` NULL), arbitrated by `csv_daily_returns_strategy_date_key`.

**Why the carried rows survive the re-derive.** The strategy-mode derive upserts its payload and then
deletes only stored days inside `[span_start, span_end]` that the payload does not carry
(`_calendar_days_absent_from` in `services/job_worker.py`); rows older than the derived span are
never named. `analytics-service/tests/test_tradesync_legacy_merge.py` pins it. A carried row dated
inside the derived span is overwritten by the trade-derived value (D-04, trade-derived wins); the
`d08-detect` read prints how many grid points fall inside versus outside the venue's reach.

### 1. Detect

<!-- form: d08-detect -->
```sql
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
reach AS (SELECT (((now() AT TIME ZONE 'UTC')::date) - interval '3 months')::date AS reach_from),
gd AS (
  SELECT d.strategy_ordinal,
         min((e.v ->> 'date')::date) AS grid_first,
         max((e.v ->> 'date')::date) AS grid_last,
         count(*) FILTER (WHERE (e.v ->> 'date')::date >= (SELECT reach_from FROM reach)) AS grid_inside_reach,
         count(*) FILTER (WHERE (e.v ->> 'date')::date < (SELECT reach_from FROM reach)) AS grid_outside_reach
    FROM d08m d
    JOIN strategy_analytics_series g
      ON g.strategy_id = d.strategy_id AND g.kind = 'daily_returns_grid' AND jsonb_typeof(g.payload) = 'array'
   CROSS JOIN LATERAL jsonb_array_elements(g.payload) AS e (v)
   GROUP BY d.strategy_ordinal
)
SELECT m.marker_is_prod, d.strategy_ordinal, d.status AS strategy_status, d.connected AS key_connected,
       d.csv_rows, coalesce(d.grid_points, 0) AS grid_points,
       gd.grid_first, gd.grid_last,
       coalesce(gd.grid_inside_reach, 0) AS grid_inside_reach,
       coalesce(gd.grid_outside_reach, 0) AS grid_outside_reach,
       d.curve_dates, d.curve_capped, d.cumulative_method, d.method_source, d.method_conflict,
       (d.csv_rows = 0 AND coalesce(d.grid_points, 0) > 0 AND NOT d.method_conflict AND NOT d.curve_capped) AS carry_ok
  FROM m
  LEFT JOIN d08m d ON true
  LEFT JOIN gd ON gd.strategy_ordinal = d.strategy_ordinal
 ORDER BY d.strategy_ordinal;
```

One row per OKX strategy. `carry_ok` is true for a strategy with 0 `csv_daily_returns` rows, a
stored grid, an unambiguous compounding method and an uncapped curve; those are the strategies the
write will carry. Record the counts: strategies listed, strategies with `carry_ok`, and per
strategy `grid_inside_reach` versus `grid_outside_reach`.

**STOP rules (a strategy that fails one is not carried; report it by ordinal and venue to the
orchestrator and take it to the founder; never widen a rule to get past it):**

- its grid is absent (`grid_points` 0 or empty);
- its compounding method is ambiguous (`method_conflict` true);
- its curve has 5000 points (`curve_capped` true);
- `d08-oracle` with `ORACLE_INPUT=grid` returns `oracle_ok` false for it, or
  `ORACLE_INPUT=carried` does after the write.

### 2. Before counts, the write, after counts

Choose `STRATS` from the detect output: the ordinals of the `carry_ok` strategies the founder
confirmed, `.`-separated (for example `1.2.3`).

<!-- form: d08-before -->
```sql
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, d.strategy_ordinal, d.csv_rows, coalesce(d.grid_points, 0) AS grid_points,
       CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array'
            THEN jsonb_array_length(a.series_provenance -> 'legacy_ranges') ELSE 0 END AS legacy_ranges_n
  FROM m
  LEFT JOIN d08m d ON d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
  LEFT JOIN strategy_analytics a ON a.strategy_id = d.strategy_id
 ORDER BY d.strategy_ordinal;
```

The write. It carries only strategies that still satisfy every detect condition at write time,
and `ON CONFLICT (strategy_id, date) DO NOTHING` makes a re-run a no-op and means a re-derived row
is never overwritten:

<!-- form: d08-write -->
```sql
__GUARD__
WITH __D08_SCOPE__, -- WRITE
sel AS ( -- WRITE
  SELECT d.strategy_id FROM d08m d -- WRITE
   WHERE d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[]) -- WRITE
     AND d.csv_rows = 0 AND coalesce(d.grid_points, 0) > 0 AND NOT d.method_conflict AND NOT d.curve_capped -- WRITE
) -- WRITE
INSERT INTO csv_daily_returns (strategy_id, date, daily_return) -- WRITE
SELECT sel.strategy_id, (e.v ->> 'date')::date, (e.v ->> 'value')::float8 -- WRITE
  FROM sel -- WRITE
  JOIN strategy_analytics_series g ON g.strategy_id = sel.strategy_id AND g.kind = 'daily_returns_grid' -- WRITE
 CROSS JOIN LATERAL jsonb_array_elements(g.payload) AS e (v) -- WRITE
ON CONFLICT (strategy_id, date) DO NOTHING; -- WRITE
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, d.strategy_ordinal, d.csv_rows AS csv_rows_after, coalesce(d.grid_points, 0) AS grid_points
  FROM m
  LEFT JOIN d08m d ON d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
 ORDER BY d.strategy_ordinal;
```

Expected readback: `csv_rows_after = grid_points` for every carried strategy. **If the call fails
or the readback disagrees, the write may already have happened:** record the CLI output (minus any
id), do NOT re-run blindly, read the state with `d08-after`, and stop for a decision.

<!-- form: d08-after -->
```sql
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
sel AS (SELECT * FROM d08m d WHERE d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])),
gp AS (
  SELECT sel.strategy_ordinal, (e.v ->> 'date')::date AS dt
    FROM sel
    JOIN strategy_analytics_series g
      ON g.strategy_id = sel.strategy_id AND g.kind = 'daily_returns_grid' AND jsonb_typeof(g.payload) = 'array'
   CROSS JOIN LATERAL jsonb_array_elements(g.payload) AS e (v)
),
cp AS (
  SELECT sel.strategy_ordinal, c.date AS dt
    FROM sel JOIN csv_daily_returns c ON c.strategy_id = sel.strategy_id
)
SELECT m.marker_is_prod, sel.strategy_ordinal,
       (SELECT count(*) FROM cp WHERE cp.strategy_ordinal = sel.strategy_ordinal) AS csv_rows,
       (SELECT count(*) FROM gp WHERE gp.strategy_ordinal = sel.strategy_ordinal) AS grid_points,
       (SELECT count(*) FROM gp WHERE gp.strategy_ordinal = sel.strategy_ordinal
           AND NOT EXISTS (SELECT 1 FROM cp WHERE cp.strategy_ordinal = gp.strategy_ordinal AND cp.dt = gp.dt)) AS grid_missing_from_csv,
       (SELECT count(*) FROM cp WHERE cp.strategy_ordinal = sel.strategy_ordinal
           AND NOT EXISTS (SELECT 1 FROM gp WHERE gp.strategy_ordinal = cp.strategy_ordinal AND gp.dt = cp.dt)) AS csv_not_in_grid,
       (SELECT min(dt) FROM cp WHERE cp.strategy_ordinal = sel.strategy_ordinal) AS csv_first,
       (SELECT max(dt) FROM cp WHERE cp.strategy_ordinal = sel.strategy_ordinal) AS csv_last
  FROM m
  LEFT JOIN sel ON true
 ORDER BY sel.strategy_ordinal;
```

Expected right after the write (before any tick): `csv_rows = grid_points`, `grid_missing_from_csv 0`,
`csv_not_in_grid 0`. After a re-derive the grid also carries the derived days, so the last two
legitimately move; judge this form only before the first tick.

### 3. The independent compounding oracle

The oracle recomputes, in SQL and independently of the Python that built the curve, the cumulative
curve the carried daily returns would produce, and compares it with the stored curve at every
curve date. It is run on four inputs, selected by the parameter `ORACLE_INPUT`, which takes
exactly these four values (any other value returns no row, and the at-least-one-row rule refuses
it):

| `ORACLE_INPUT` | What is compounded | Expected |
|---|---|---|
| `grid` | the source grid itself (before the write) | `oracle_ok` true for every detected strategy |
| `cumulative-as-daily` | the `returns_series` values read as if they were daily returns | `oracle_ok` false for every strategy |
| `drop-largest-day` | the grid without its largest-magnitude day (a wrong day count) | `oracle_ok` false for every strategy |
| `carried` | the strategy-axis `csv_daily_returns` rows dated on or before the curve's last date (after the write) | `oracle_ok` true for every carried strategy |

**Method.** Per strategy the candidate daily returns are compounded by the method the stored curve
was BUILT with, read from that row's `strategy_analytics.data_quality_flags->>'cumulative_method'`
(absent means `geometric`, the default `services/wealth_returns.curve_method_from_flags` applies):

- `geometric`: `C_k = PRODUCT over i<=k of (1 + r_i)` (`compute_all_metrics`: `cumprod`). In SQL
  the product is `exp(sum(ln(1 + r)))` over the date-ordered rows on or before the curve date.
- `simple`: `C_k = 1 + SUM over i<=k of r_i` (`compute_all_metrics`: `1.0 + cumsum`).

`method_conflict` (flag absent while the strategy's `returns_denominator_config` says `simple`, or a
present flag that is neither literal) and `curve_capped` (5000 points, the `cap_data_points`
ceiling, so the curve's first point is not the series start) both force `oracle_ok` false and are
STOP conditions. A curve date with no candidate row compounds as 0, exactly as the curve's own
`fillna(0)` does, and is counted in `zero_assumed_days`.

**Tolerance, derived and not tuned.** The grid is rounded to 6 decimals
(`_daily_returns_grid_from_series` calls `_format_series_points(..., 6)`), so each carried `r_i`
differs from the value the curve compounded by at most `e = 5e-7`, while `returns_series` is stored
unrounded. With `n_k` the number of carried days on or before curve date `k`:

- `simple`: `|dC_k| <= n_k x 5e-7`, exactly.
- `geometric`: `|dC_k| <= C_k x (exp(SUM over carried i<=k of 5e-7 / (1 + r_i)) - 1)`, which is
  about `n_k x 5e-7 x C_k`.

Each bound gets `+1e-12` for float8 arithmetic and nothing else. **`oracle_ok` holds iff**
`|diff_k| <= tol_k` at every curve date, no carried date lies outside the curve, the curve has at
least 2 dates, at least one day is carried, `method_conflict` is false and `curve_capped` is false.
The bound uses the stored curve value `C_k`, and the 5e-7 rounding is the only slack: a wrong day
count or the cumulative read as daily moves the compounded value by far more than it.

Columns, by name: `marker_is_prod`, `strategy_ordinal`, `oracle_input`, `cumulative_method`,
`method_source` (`flag` or `default`), `method_conflict`, `curve_dates`, `curve_capped`,
`carried_days`, `zero_assumed_days`, `extra_carried_days` (candidate rows dated outside the curve's
date set), `max_abs_diff`, `tol_at_max` (the tolerance at the curve date of the largest difference),
`max_diff_over_tol` (the largest ratio of difference to tolerance over all curve dates), and
`oracle_ok`.

<!-- form: d08-oracle -->
```sql
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
sel AS (SELECT * FROM d08m d WHERE d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])),
curve AS (
  SELECT sel.strategy_ordinal, (e.v ->> 'date')::date AS dt, (e.v ->> 'value')::float8 AS cv
    FROM sel
    JOIN strategy_analytics a ON a.strategy_id = sel.strategy_id AND jsonb_typeof(a.returns_series) = 'array'
   CROSS JOIN LATERAL jsonb_array_elements(a.returns_series) AS e (v)
),
cand0 AS (
  SELECT sel.strategy_ordinal, c.date AS dt, c.daily_return::float8 AS r
    FROM sel
    JOIN csv_daily_returns c ON c.strategy_id = sel.strategy_id
   WHERE __ORACLE_INPUT__ = 'carried'
     AND c.date <= (SELECT max(cu.dt) FROM curve cu WHERE cu.strategy_ordinal = sel.strategy_ordinal)
  UNION ALL
  SELECT sel.strategy_ordinal, (e.v ->> 'date')::date, (e.v ->> 'value')::float8
    FROM sel
    JOIN strategy_analytics_series g
      ON g.strategy_id = sel.strategy_id AND g.kind = 'daily_returns_grid' AND jsonb_typeof(g.payload) = 'array'
   CROSS JOIN LATERAL jsonb_array_elements(g.payload) AS e (v)
   WHERE __ORACLE_INPUT__ IN ('grid', 'drop-largest-day')
  UNION ALL
  SELECT cu.strategy_ordinal, cu.dt, cu.cv FROM curve cu WHERE __ORACLE_INPUT__ = 'cumulative-as-daily'
),
dropped AS (
  SELECT DISTINCT ON (c0.strategy_ordinal) c0.strategy_ordinal, c0.dt
    FROM cand0 c0 WHERE __ORACLE_INPUT__ = 'drop-largest-day'
   ORDER BY c0.strategy_ordinal, abs(c0.r) DESC, c0.dt
),
cand AS (
  SELECT c0.* FROM cand0 c0
   WHERE NOT EXISTS (SELECT 1 FROM dropped dr WHERE dr.strategy_ordinal = c0.strategy_ordinal AND dr.dt = c0.dt)
),
steps AS (
  SELECT cu.strategy_ordinal, cu.dt, cu.cv, sel.cumulative_method,
         (SELECT count(*) FROM cand x WHERE x.strategy_ordinal = cu.strategy_ordinal AND x.dt <= cu.dt) AS n_k,
         (SELECT coalesce(sum(ln(greatest(1 + x.r, 1e-9))), 0) FROM cand x
           WHERE x.strategy_ordinal = cu.strategy_ordinal AND x.dt <= cu.dt) AS s_log,
         (SELECT coalesce(sum(x.r), 0) FROM cand x
           WHERE x.strategy_ordinal = cu.strategy_ordinal AND x.dt <= cu.dt) AS s_sum,
         (SELECT coalesce(sum(5e-7::float8 / greatest(1 + x.r, 1e-9)), 0) FROM cand x
           WHERE x.strategy_ordinal = cu.strategy_ordinal AND x.dt <= cu.dt) AS s_tol,
         EXISTS (SELECT 1 FROM cand x WHERE x.strategy_ordinal = cu.strategy_ordinal AND x.dt = cu.dt) AS has_row
    FROM curve cu
    JOIN sel ON sel.strategy_ordinal = cu.strategy_ordinal
),
scored AS (
  SELECT st.*,
         CASE WHEN st.cumulative_method = 'simple' THEN 1.0 + st.s_sum ELSE exp(st.s_log) END AS cand_cv,
         CASE WHEN st.cumulative_method = 'simple' THEN st.n_k * 5e-7::float8 + 1e-12
              ELSE st.cv * (exp(st.s_tol) - 1) + 1e-12 END AS tol_k
    FROM steps st
),
agg AS (
  SELECT sc.strategy_ordinal,
         count(*) FILTER (WHERE NOT sc.has_row) AS zero_assumed_days,
         max(abs(sc.cand_cv - sc.cv)) AS max_abs_diff,
         (array_agg(sc.tol_k ORDER BY abs(sc.cand_cv - sc.cv) DESC, sc.dt))[1] AS tol_at_max,
         max(abs(sc.cand_cv - sc.cv) / sc.tol_k) AS max_diff_over_tol
    FROM scored sc
   GROUP BY sc.strategy_ordinal
),
outs AS (
  SELECT c.strategy_ordinal, count(*) AS carried_days,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM curve cu WHERE cu.strategy_ordinal = c.strategy_ordinal AND cu.dt = c.dt)) AS extra_carried_days
    FROM cand c
   GROUP BY c.strategy_ordinal
)
SELECT m.marker_is_prod, sel.strategy_ordinal, __ORACLE_INPUT__ AS oracle_input,
       sel.cumulative_method, sel.method_source, sel.method_conflict, sel.curve_dates, sel.curve_capped,
       coalesce(outs.carried_days, 0) AS carried_days,
       agg.zero_assumed_days,
       coalesce(outs.extra_carried_days, 0) AS extra_carried_days,
       agg.max_abs_diff, agg.tol_at_max, agg.max_diff_over_tol,
       (agg.max_diff_over_tol IS NOT NULL AND agg.max_diff_over_tol <= 1
        AND coalesce(outs.carried_days, 0) > 0 AND coalesce(outs.extra_carried_days, 0) = 0
        AND sel.curve_dates >= 2 AND NOT sel.method_conflict AND NOT sel.curve_capped) AS oracle_ok
  FROM m
  CROSS JOIN sel
  LEFT JOIN agg ON agg.strategy_ordinal = sel.strategy_ordinal
  LEFT JOIN outs ON outs.strategy_ordinal = sel.strategy_ordinal
 WHERE __ORACLE_INPUT__ IN ('carried', 'grid', 'cumulative-as-daily', 'drop-largest-day')
 ORDER BY sel.strategy_ordinal;
```

**The oracle must be proven non-vacuous before it is trusted** (plan 14 does this on the real data,
before any write): `grid` PASSES for every detected strategy, and both `cumulative-as-daily` and
`drop-largest-day` are RED for every one. A strategy whose `drop-largest-day` row stays true has a
largest daily move below its own tolerance, so the oracle cannot see a missing day there: that is
"oracle-blind", a STOP, and the probe is never loosened. After the write, `carried` must pass for
every carried strategy; if it does not, do not write provenance, run `d08-rollback`, and report.

### 4. Provenance: mark the carried range as legacy (D-03 / D-08)

Run after the `carried` oracle passes and BEFORE the first tick. The range is recorded in
`strategy_analytics.series_provenance` under `legacy_ranges`, never in `data_quality_flags`:
`run_csv_strategy_analytics` rebuilds that field wholesale on every run, so a runbook write there
would be erased by the very re-derive it accompanies. `jsonb_set` preserves every other key, and
the `NOT EXISTS` makes a re-run a no-op.

<!-- form: d08-provenance -->
```sql
__GUARD__
WITH __D08_SCOPE__, -- WRITE
gd AS ( -- WRITE
  SELECT d.strategy_id, min((e.v ->> 'date')::date) AS d_from, max((e.v ->> 'date')::date) AS d_to -- WRITE
    FROM d08m d -- WRITE
    JOIN strategy_analytics_series g ON g.strategy_id = d.strategy_id AND g.kind = 'daily_returns_grid' AND jsonb_typeof(g.payload) = 'array' -- WRITE
   CROSS JOIN LATERAL jsonb_array_elements(g.payload) AS e (v) -- WRITE
   WHERE d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[]) AND d.csv_rows > 0 -- WRITE
   GROUP BY d.strategy_id -- WRITE
) -- WRITE
UPDATE strategy_analytics a -- WRITE
   SET series_provenance = jsonb_set(coalesce(a.series_provenance, '{}'::jsonb), '{legacy_ranges}', -- WRITE
         coalesce(CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array' THEN a.series_provenance -> 'legacy_ranges' END, '[]'::jsonb) -- WRITE
         || jsonb_build_array(jsonb_build_object('from', gd.d_from::text, 'to', gd.d_to::text, 'source', 'returns_grid_carry_forward', -- WRITE
              'recorded_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))), true) -- WRITE
  FROM gd -- WRITE
 WHERE a.strategy_id = gd.strategy_id -- WRITE
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array' THEN a.series_provenance -> 'legacy_ranges' ELSE '[]'::jsonb END) AS x -- WRITE
                    WHERE x ->> 'from' = gd.d_from::text AND x ->> 'to' = gd.d_to::text AND x ->> 'source' = 'returns_grid_carry_forward'); -- WRITE
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, d.strategy_ordinal,
       CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array'
            THEN jsonb_array_length(a.series_provenance -> 'legacy_ranges') ELSE 0 END AS legacy_ranges_n,
       a.series_provenance -> 'legacy_ranges' -> 0 ->> 'from' AS first_range_from,
       a.series_provenance -> 'legacy_ranges' -> 0 ->> 'to' AS first_range_to
  FROM m
  LEFT JOIN d08m d ON d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
  LEFT JOIN strategy_analytics a ON a.strategy_id = d.strategy_id
 ORDER BY d.strategy_ordinal;
```

Expected readback: `legacy_ranges_n 1` per carried strategy, the range being the carried dates.

## Step A3 — the D-10 seed (a PROD data write)

D-10 (founder, 2026-10-09): a published strategy whose key is excluded from the tick shows the
stale line "Last trades fetched N days ago". The tick will never stamp it, so its
`strategy_analytics.trades_fetched_at` is seeded from a dated fact once, and never again
overwritten by a cron stamp.

**Source rule.** The newest recorded successful trade-sync completion for that strategy if one is
retained (the newest `compute_jobs` row of kind `sync_trades` with status `done` or
`done_pending_children` for the strategy), else its newest stored daily-P&L instant. The source
used is printed (`seed_source`) and recorded in the SUMMARY of the plan that runs it.

<!-- form: d10-before -->
```sql
WITH __STRAT_UNIVERSE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
x AS (
  SELECT u.strategy_ordinal, u.venue, a.trades_fetched_at,
         (SELECT max(j.updated_at) FROM compute_jobs j
           WHERE j.strategy_id = u.strategy_id AND j.kind = 'sync_trades'
             AND j.status IN ('done', 'done_pending_children')) AS job_done_at,
         (SELECT max(t.timestamp) FROM trades t WHERE t.strategy_id = u.strategy_id AND NOT t.is_fill) AS newest_pnl_at
    FROM u
    LEFT JOIN strategy_analytics a ON a.strategy_id = u.strategy_id
   WHERE u.status = 'published' AND NOT u.connected
)
SELECT m.marker_is_prod, x.strategy_ordinal, x.venue,
       CASE WHEN x.trades_fetched_at IS NULL THEN NULL
            ELSE floor(extract(epoch FROM (now() - x.trades_fetched_at)) / 86400)::int END AS trades_fetched_at_age_days,
       (x.job_done_at AT TIME ZONE 'UTC')::date AS job_done_date,
       (x.newest_pnl_at AT TIME ZONE 'UTC')::date AS newest_pnl_date,
       CASE WHEN x.job_done_at IS NOT NULL THEN 'completed_sync_job'
            WHEN x.newest_pnl_at IS NOT NULL THEN 'newest_daily_pnl' ELSE 'none' END AS seed_source,
       (coalesce(x.job_done_at, x.newest_pnl_at) AT TIME ZONE 'UTC')::date AS seed_date
  FROM m
  LEFT JOIN x ON true
 ORDER BY x.strategy_ordinal;
```

Choose `STRATS` from the rows (the published strategy on the disconnected key, by ordinal). The
write seeds only where `trades_fetched_at IS NULL`, so it never overwrites a cron stamp and a
re-run is a no-op:

<!-- form: d10-write -->
```sql
__GUARD__
WITH __STRAT_UNIVERSE__, -- WRITE
src AS ( -- WRITE
  SELECT u.strategy_id, -- WRITE
         coalesce((SELECT max(j.updated_at) FROM compute_jobs j -- WRITE
                    WHERE j.strategy_id = u.strategy_id AND j.kind = 'sync_trades' AND j.status IN ('done', 'done_pending_children')), -- WRITE
                  (SELECT max(t.timestamp) FROM trades t WHERE t.strategy_id = u.strategy_id AND NOT t.is_fill)) AS seed_at -- WRITE
    FROM u -- WRITE
   WHERE u.status = 'published' AND NOT u.connected -- WRITE
     AND u.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[]) -- WRITE
) -- WRITE
UPDATE strategy_analytics a -- WRITE
   SET trades_fetched_at = src.seed_at -- WRITE
  FROM src -- WRITE
 WHERE a.strategy_id = src.strategy_id AND a.trades_fetched_at IS NULL AND src.seed_at IS NOT NULL; -- WRITE
WITH __STRAT_UNIVERSE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, u.strategy_ordinal,
       CASE WHEN a.trades_fetched_at IS NULL THEN NULL
            ELSE floor(extract(epoch FROM (now() - a.trades_fetched_at)) / 86400)::int END AS trades_fetched_at_age_days
  FROM m
  LEFT JOIN u ON u.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
  LEFT JOIN strategy_analytics a ON a.strategy_id = u.strategy_id
 ORDER BY u.strategy_ordinal;
```

<!-- form: d10-after -->
```sql
WITH __STRAT_UNIVERSE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, u.strategy_ordinal,
       CASE WHEN a.trades_fetched_at IS NULL THEN NULL
            ELSE floor(extract(epoch FROM (now() - a.trades_fetched_at)) / 86400)::int END AS trades_fetched_at_age_days,
       (a.trades_fetched_at AT TIME ZONE 'UTC')::date AS trades_fetched_date,
       (SELECT (max(t.timestamp) AT TIME ZONE 'UTC')::date FROM trades t WHERE t.strategy_id = u.strategy_id AND NOT t.is_fill) AS newest_pnl_date
  FROM m
  LEFT JOIN u ON u.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
  LEFT JOIN strategy_analytics a ON a.strategy_id = u.strategy_id
 ORDER BY u.strategy_ordinal;
```

Expected: the seeded strategy reads an age above 2 days (stale by D-05, which is the point), and
`trades_fetched_date` is the `seed_date` the before read printed. The write touches
`trades_fetched_at` only; `computation_status`, `computed_at` and every other column are untouched
(the table's two BEFORE UPDATE triggers key on the status column).

## Step B — the rehearsal (a PROD write: one real tick)

Runs after Step A, Step A2 (D-08) and Step A3 (D-10) are done, and after P0, P1 (`job_rows 0`),
P2, P3 and P4 are re-run immediately before it. Keep the P6 hold from the start of the tick until
the backfill queue drains again.

**The rehearsal is the heavy FIRST BACKFILL, not the steady-state tick.** It fetches each key's
window from its stored high-water, which is up to about 3 months on OKX (Step A prints the widest
window in days), while the daily tick fetches about one day. So a `FITS` verdict is an upper bound
that holds a fortiori for the daily tick, and a `PGNET-TOO-SLOW` or `KEY-TIMEOUT` verdict is
recorded together with the widest Step A window in days (a `rehearsal-reason:` line), so the
decision is taken knowing the backfill alone may be the cause.

### 1. The tick

`stepb-tick` runs `SELECT public.cron_sync_tick();` behind the guard. The function only POSTS
through `pg_net`: it returns a request id at once, and the route runs afterwards, for up to the
function's `timeout_milliseconds`. The readback prints the database's own clock (use it as `START`)
and the last pg_net request id (use it as `REQ`; nothing else posts between the two statements, and
`stepb-response` also pins the response to the time window).

<!-- form: stepb-tick -->
```sql
__GUARD__
SELECT public.cron_sync_tick(); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS db_now_utc,
       (SELECT last_value FROM net.http_request_queue_id_seq) AS last_request_id
  FROM m;
```

- **If the call fails, or the readback is missing: the tick may already have been posted.** Never
  re-run the file. Read `stepb-response` first (it needs only a `START` a few minutes before) and
  the `cron_runs` row, and stop for a decision.
- A pg_net "success" only means the request was queued. Nothing below is judged by the status.

### 2. The response

Within the 6 hour `pg_net.ttl`, read the response row. A `START` and a `REQ` are required. When
the pg_net row timed out and carries no body, the same read takes the counters from the run's
`cron_runs` row (`cron_name = 'cron_sync'`, metadata written by the route's heartbeat) and names
the source:

<!-- form: stepb-response -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
r AS (
  SELECT x.status_code, x.timed_out, x.content
    FROM net._http_response x
   WHERE x.id = __REQ__::bigint AND x.created >= __START__::timestamptz - interval '1 minute'
),
b AS (
  SELECT r.status_code, r.timed_out,
         CASE WHEN r.content IS NOT NULL AND pg_input_is_valid(r.content, 'jsonb') THEN r.content::jsonb END AS j
    FROM r
),
bo AS (
  SELECT b.status_code, b.timed_out,
         CASE WHEN jsonb_typeof(b.j) = 'object' AND (b.j -> 'total_keys') IS NOT NULL THEN b.j END AS j
    FROM b
),
cr AS (
  SELECT c.metadata AS j
    FROM cron_runs c
   WHERE c.cron_name = 'cron_sync' AND c.started_at >= __START__::timestamptz - interval '1 minute'
   ORDER BY c.started_at DESC
   LIMIT 1
),
pick AS (
  SELECT bo.status_code, bo.timed_out, bo.j AS body, coalesce(bo.j, cr.j) AS cnt,
         CASE WHEN bo.j IS NOT NULL THEN 'pgnet_body' WHEN cr.j IS NOT NULL THEN 'cron_runs' ELSE 'none' END AS counters_source
    FROM (SELECT 1) AS one
    LEFT JOIN bo ON true
    LEFT JOIN cr ON true
),
ek AS (
  SELECT count(*) AS n FROM api_keys k
   WHERE k.is_active AND k.disconnected_at IS NULL
     AND EXISTS (SELECT 1 FROM strategies s
                  WHERE s.api_key_id = k.id AND s.status IN ('draft', 'pending_review', 'published', 'private'))
)
SELECT m.marker_is_prod,
       pick.status_code,
       pick.timed_out AS pgnet_timed_out,
       (pick.cnt ->> 'duration_s')::numeric AS duration_s,
       (pick.cnt ->> 'total_keys')::int AS total_keys,
       ek.n AS expected_keys,
       (pick.cnt ->> 'skipped_no_strategy')::int AS skipped_no_strategy,
       (pick.cnt ->> 'synced')::int AS synced,
       (pick.cnt ->> 'held')::int AS held,
       (pick.cnt ->> 'failed')::int AS failed,
       (pick.cnt ->> 'timed_out')::int AS timed_out_keys,
       (pick.cnt ->> 'revoked')::int AS revoked,
       CASE WHEN pick.body IS NULL THEN NULL
            ELSE (SELECT count(*) FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(pick.body -> 'results') = 'array' THEN pick.body -> 'results' ELSE '[]'::jsonb END) AS x
                   WHERE jsonb_typeof(x -> 'strategy_cursor_window_clamped') = 'object'
                     AND (x -> 'strategy_cursor_window_clamped') <> '{}'::jsonb) END AS clamped_keys,
       pick.counters_source
  FROM m
  CROSS JOIN pick
  CROSS JOIN ek;
```

Columns, by name (plan 17's verify recomputes the verdict from these): `status_code`,
`pgnet_timed_out`, `duration_s`, `total_keys`, `expected_keys` (the count of connected keys that
back an eligible strategy, re-measured in the same read: the route's own selection; it includes
the `mt5` keys that take the deferred path), `skipped_no_strategy`, `synced`, `held`, `failed`,
`timed_out_keys` (the route's `timed_out`: keys cancelled by `KEY_SYNC_TIMEOUT` in
`routers/cron.py`), `revoked`, `clamped_keys` (a count of keys whose result carries a non-empty
`strategy_cursor_window_clamped`, never JSON in a CSV cell; empty when the counters came from
`cron_runs`, which does not carry it), and `counters_source` (`pgnet_body`, `cron_runs` or `none`).

A row whose `status_code` AND `pgnet_timed_out` are both empty means no pg_net response row was
found for `REQ` (the request is still running, the row was purged after the 6 hour TTL, or `REQ`
or `START` is wrong). While the request is plausibly still running, re-read after a minute. Once it
is not, re-check `REQ` and `START`; do NOT issue a verdict from the `cron_runs` counters alone in
that case, because `pgnet_timed_out` cannot be judged. pg_net reports a timeout at the function's
`timeout_milliseconds`. The handler may still be running at that moment (whether the service
cancels it when the connection drops is untested), so the counters appear in `cron_runs` only
once the handler finishes: if they are absent too, wait for the run to end before judging.

### 3. The downstream effect (the verdict never rests on the status alone)

After the tick's strategy derives drain (`p3` back to `open_backfill_jobs 0`), read the effect.
`PRE_HW` is the `pre_hw_param` string Step A printed; `START` the tick's `db_now_utc`:

<!-- form: stepb-downstream -->
```sql
WITH __TICK_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
hw AS (
  SELECT split_part(e, ':', 1)::int AS strategy_ordinal, NULLIF(split_part(e, ':', 2), '')::date AS pre_hw
    FROM unnest(string_to_array(__PRE_HW__, '.')) AS e
   WHERE e LIKE '%:%'
),
per AS (
  SELECT t.key_ordinal, t.venue, t.strategy_id,
         (SELECT (max(x.timestamp) AT TIME ZONE 'UTC')::date FROM trades x
           WHERE x.strategy_id = t.strategy_id AND NOT x.is_fill) AS newest_pnl,
         (SELECT min((x.timestamp AT TIME ZONE 'UTC')::date) FROM trades x, hw
           WHERE hw.strategy_ordinal = t.strategy_ordinal AND x.strategy_id = t.strategy_id AND NOT x.is_fill
             AND (x.timestamp AT TIME ZONE 'UTC')::date > hw.pre_hw) AS earliest_new,
         (SELECT count(*) FROM strategy_sync_cursors c WHERE c.strategy_id = t.strategy_id) AS marker_rows,
         a.trades_fetched_at
    FROM t
    LEFT JOIN strategy_analytics a ON a.strategy_id = t.strategy_id
)
SELECT m.marker_is_prod, p.key_ordinal, p.venue,
       CASE WHEN bool_or(p.newest_pnl IS NULL) THEN NULL
            ELSE max((now() AT TIME ZONE 'UTC')::date - p.newest_pnl) END AS newest_pnl_age_days,
       min(p.earliest_new) AS earliest_new_row_date,
       sum(p.marker_rows) AS marker_rows,
       CASE WHEN bool_or(p.trades_fetched_at IS NULL) THEN NULL
            ELSE max(floor(extract(epoch FROM (now() - p.trades_fetched_at)) / 86400))::int END AS trades_fetched_at_age_days,
       (SELECT count(*) FROM cron_runs c
         WHERE c.cron_name = 'cron_sync' AND c.started_at >= __START__::timestamptz - interval '1 minute') AS cron_runs_rows
  FROM m
  LEFT JOIN per p ON true
 GROUP BY m.marker_is_prod, p.key_ordinal, p.venue
 ORDER BY p.key_ordinal;
```

One row per connected key. The key-level columns aggregate its eligible strategies the honest way:
`newest_pnl_age_days` is the STALEST strategy's age (current UTC date minus its newest daily-P&L
date, an integer; empty if any strategy has no row), `trades_fetched_at_age_days` the oldest
stamp's age in whole days (empty if any strategy is unstamped), `marker_rows` the strategies'
`strategy_sync_cursors` rows summed, `earliest_new_row_date` the earliest daily-P&L date stored
AFTER the strategy's pre-tick high-water (empty when this run stored no row for the key; pass
`PRE_HW=none` on later days), and `cron_runs_rows` the `cron_sync` heartbeat rows written since
`START`.

**What good looks like after the rehearsal:** `newest_pnl_age_days` at most 1, `marker_rows` equal
to the key's strategy count, `trades_fetched_at_age_days` 0, `cron_runs_rows` 1. The SC-2 gate in
plans 17 and 21 reads these columns by name. A key that reads `newest_pnl_age_days` above 1 stored
nothing: its `earliest_new_row_date` is empty and it is a finding whatever the verdict says.

### 4. The verdict

One ordered decision. **First match wins.** Compute it from the `stepb-response` columns
(`DEFECT` conditions are the route or its selection misbehaving; the others are about time):

| # | Verdict | When | Next step |
|---|---|---|---|
| 1 | `DEFECT` | `status_code` is a non-200 with a body; or `counters_source` is `none` (counters unreadable from both pg_net and `cron_runs`); or `revoked` above 0; or `clamped_keys` above 0 (a non-empty `strategy_cursor_window_clamped`); or `total_keys` is not `expected_keys` | Stop the phase for diagnosis. Do not register, do not repeat. |
| 2 | `KEY-TIMEOUT` | `timed_out_keys` above 0: a key was cancelled by `KEY_SYNC_TIMEOUT` in `routers/cron.py` | Stop for diagnosis. The async route does NOT cure it: the per-key cancel runs inside the sync body whether the route answers 200 or 202. A repeat rehearsal is allowed only under the repeat rule below. |
| 3 | `PGNET-TOO-SLOW` | no key timed out, but `duration_s` above 90 or `pgnet_timed_out` is true | Do not register. Take the conditional async plan 18. |
| 4 | `FITS` | `duration_s` at most 90, `pgnet_timed_out` false, `timed_out_keys` 0, `revoked` 0, no clamp, `total_keys` equal to `expected_keys` | Register (Step C). |

Record two lines in the plan's verdict file:

```
rehearsal-verdict: FITS | PGNET-TOO-SLOW | KEY-TIMEOUT | DEFECT
rehearsal-reason: <the triggering counters> widest_step_a_window_days=<n>
```

Every non-FITS verdict carries a `rehearsal-reason:` line with the triggering counters and the
widest Step A window in days (`max(newest_pnl_age_days)` from `stepa-proof`).
`failed` and `held` above 0 are recorded in the reason line and judged by the downstream read; a
key that failed or was held stored nothing new and shows in `newest_pnl_age_days`.

**The repeat rule (`KEY-TIMEOUT` only).** A repeat rehearsal runs only when `stepb-downstream`
shows that every cancelled key's strategies advanced their marker or their high-water in the run
just judged (`marker_rows` above 0, or `newest_pnl_age_days` lower than Step A's), at most two
repeats. Each attempt is saved as `17-response-aN.csv` and `17-verdict-aN.txt`; the latest attempt
is copied to `17-response.csv` and `17-verdict.txt` as the governing reading. A repeat renders
`stepb-tick` again, which resumes from the markers this run already advanced: it fetches less, and
that is the reason it is allowed only against markers that did advance.

## Step B2 — the gap, named and not filled (D-02 / D-09)

Run after the rehearsal's derives have drained. D-09 split the recovery of days the trade API no
longer serves into Phase 167.1.2.2.2.1 OKXHISTORY; this phase only NAMES what is unrecovered and
records OKXHISTORY's work list. **Nothing is filled, interpolated or written as 0.0.**

### 1. Measure the hole

For each strategy carrying a `legacy_ranges` entry, the hole is the span in `csv_daily_returns`
between its last legacy day and its first re-derived day. The form also counts rows with a return
of exactly 0.0 dated before the venue's first stored daily-P&L day after the legacy range: such a
row would be a zero-fill of the hole (the failure plan 07 pinned at the combiner), and the stop
rule is that there are none.

<!-- form: gap-scope -->
```sql
__STRAT_UNIVERSE__,
lr AS (
  SELECT u.strategy_ordinal, u.strategy_id, max((x ->> 'to')::date) AS legacy_to
    FROM u
    JOIN strategy_analytics a ON a.strategy_id = u.strategy_id
   CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array' THEN a.series_provenance -> 'legacy_ranges' ELSE '[]'::jsonb END) AS x
   WHERE x ->> 'source' = 'returns_grid_carry_forward'
   GROUP BY u.strategy_ordinal, u.strategy_id
),
gap AS (
  SELECT lr.strategy_ordinal, lr.strategy_id, lr.legacy_to,
         (SELECT min(c.date) FROM csv_daily_returns c WHERE c.strategy_id = lr.strategy_id AND c.date > lr.legacy_to) AS csv_next,
         (SELECT min((t.timestamp AT TIME ZONE 'UTC')::date) FROM trades t
           WHERE t.strategy_id = lr.strategy_id AND NOT t.is_fill AND (t.timestamp AT TIME ZONE 'UTC')::date > lr.legacy_to) AS pnl_next
    FROM lr
),
gapm AS (
  SELECT gap.*,
         (gap.legacy_to + 1) AS gap_from,
         (gap.csv_next - 1) AS gap_to,
         (SELECT count(*) FROM csv_daily_returns c
           WHERE c.strategy_id = gap.strategy_id AND c.daily_return = 0 AND c.date > gap.legacy_to
             AND c.date < coalesce(gap.pnl_next, gap.csv_next, '9999-12-31'::date)) AS zero_rows_in_gap
    FROM gap
)
```

<!-- form: gap-measure -->
```sql
WITH __GAP_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, g.strategy_ordinal, g.gap_from, g.gap_to,
       CASE WHEN g.gap_to IS NULL THEN NULL ELSE greatest(g.gap_to - g.gap_from + 1, 0) END AS gap_days,
       g.zero_rows_in_gap
  FROM m
  LEFT JOIN gapm g ON true
 ORDER BY g.strategy_ordinal;
```

Columns: `gap_from` and `gap_to` (inclusive: the day after the last legacy day, and the day before the
first re-derived row), `gap_days`, `zero_rows_in_gap`. An empty `gap_to` means no re-derived row
exists after the legacy range yet (nothing to name); `gap_days` 0 means the re-derived window
reaches the legacy range (no hole).

**STOP if `zero_rows_in_gap` is above 0 for any strategy:** the hole was zero-filled. Do not write
the gap; report it.

### 2. Write the gap (only where there is one, and never over a zero-fill)

<!-- form: gap-write -->
```sql
__GUARD__
WITH __GAP_SCOPE__, -- WRITE
w AS ( -- WRITE
  SELECT gm.strategy_id, gm.gap_from, gm.gap_to FROM gapm gm -- WRITE
   WHERE gm.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[]) -- WRITE
     AND gm.gap_to IS NOT NULL AND gm.gap_to >= gm.gap_from AND gm.zero_rows_in_gap = 0 -- WRITE
) -- WRITE
UPDATE strategy_analytics a -- WRITE
   SET series_provenance = jsonb_set(coalesce(a.series_provenance, '{}'::jsonb), '{unrecovered_gaps}', -- WRITE
         coalesce(CASE WHEN jsonb_typeof(a.series_provenance -> 'unrecovered_gaps') = 'array' THEN a.series_provenance -> 'unrecovered_gaps' END, '[]'::jsonb) -- WRITE
         || jsonb_build_array(jsonb_build_object('from', w.gap_from::text, 'to', w.gap_to::text, -- WRITE
              'recorded_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))), true) -- WRITE
  FROM w -- WRITE
 WHERE a.strategy_id = w.strategy_id -- WRITE
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.series_provenance -> 'unrecovered_gaps') = 'array' THEN a.series_provenance -> 'unrecovered_gaps' ELSE '[]'::jsonb END) AS x -- WRITE
                    WHERE x ->> 'from' = w.gap_from::text AND x ->> 'to' = w.gap_to::text); -- WRITE
WITH __STRAT_UNIVERSE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, u.strategy_ordinal,
       CASE WHEN jsonb_typeof(a.series_provenance -> 'unrecovered_gaps') = 'array'
            THEN jsonb_array_length(a.series_provenance -> 'unrecovered_gaps') ELSE 0 END AS unrecovered_gaps_n,
       a.series_provenance -> 'unrecovered_gaps' -> 0 ->> 'from' AS first_gap_from,
       a.series_provenance -> 'unrecovered_gaps' -> 0 ->> 'to' AS first_gap_to
  FROM m
  LEFT JOIN u ON u.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
  LEFT JOIN strategy_analytics a ON a.strategy_id = u.strategy_id
 ORDER BY u.strategy_ordinal;
```

Expected readback: `unrecovered_gaps_n 1` for each strategy that has a hole above 0 days, with
`first_gap_from` and `first_gap_to` equal to the `gap-measure` row. Dates are inclusive
`YYYY-MM-DD`; the entry also carries `recorded_at`. `jsonb_set` preserves every other key
(`legacy_ranges` included), and the `NOT EXISTS` makes a re-run a no-op.

### 3. OKXHISTORY's work list

Records, per strategy, the pre-tick high-water (from `PRE_HW`) and the post-tick earliest new
daily-P&L row, dates only. This is the follow-on phase's input: nothing is filled here.

<!-- form: okxhistory-worklist -->
```sql
WITH __STRAT_UNIVERSE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
hw AS (
  SELECT split_part(e, ':', 1)::int AS strategy_ordinal, NULLIF(split_part(e, ':', 2), '')::date AS pre_hw
    FROM unnest(string_to_array(__PRE_HW__, '.')) AS e
   WHERE e LIKE '%:%'
),
w AS (
  SELECT hw.strategy_ordinal, u.venue, hw.pre_hw,
         (SELECT min((t.timestamp AT TIME ZONE 'UTC')::date) FROM trades t
           WHERE t.strategy_id = u.strategy_id AND NOT t.is_fill AND (t.timestamp AT TIME ZONE 'UTC')::date > hw.pre_hw) AS earliest_new
    FROM hw JOIN u ON u.strategy_ordinal = hw.strategy_ordinal
)
SELECT m.marker_is_prod, w.strategy_ordinal, w.venue,
       w.pre_hw AS pre_tick_high_water,
       w.earliest_new AS earliest_new_row_date,
       CASE WHEN w.earliest_new IS NULL THEN NULL ELSE greatest(w.earliest_new - w.pre_hw - 1, 0) END AS unrecovered_days
  FROM m
  LEFT JOIN w ON true
 ORDER BY w.strategy_ordinal;
```

## Step C — the registration

Runs only after a rehearsal verdict of `FITS`. Re-run P0, P1 (`job_rows 0`), P2, P3 and P4
immediately before it, re-read the slot occupancy (see "What this activates"), and keep the P6 hold
from now on: the first scheduled run starts the hold at 04:15Z.

<!-- form: stepc-register -->
```sql
__GUARD__
SELECT cron.schedule('cron-sync-trades', '30 4 * * *', $$SELECT public.cron_sync_tick();$$); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.username, j.database, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname = 'cron-sync-trades';
```

- **Expected readback:** exactly one data row: `1`, `cron-sync-trades`, `30 4 * * *`, `t` (or
  `true`), `postgres`, `postgres`, and the command exactly `SELECT public.cron_sync_tick();`.
- `cron.schedule` upserts by job name (pg_cron 1.6), so a retry after an ambiguous CLI error is
  safe, but read the state first.
- The new `jobid` is printed by the arm and deliberately not compared. Read it for the record:

<!-- form: jobid -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, j.jobid
  FROM m LEFT JOIN cron.job j ON j.jobname = 'cron-sync-trades';
```

- This statement lives HERE and in no migration, for the reason in "What this activates".

## Step D — the manifest, in the SAME session

The moment Step C succeeds, PROD carries a job the committed manifest does not, and `cron-drift`
reports it on every prober run. Finish this step before the session ends. Stage the manifest PR
before registering if you can, but it must NOT merge before Step C (the arm would report the job
"missing from PROD").

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out "$TS_SP/cron-manifest-capture.json"
diff scripts/prod-prober/cron-manifest.json "$TS_SP/cron-manifest-capture.json"
```

- The capture refuses and writes nothing on: no `--out`; an unlabelled database; a `cron.job`
  record it cannot parse or whose count disagrees with the database's own row count (exit 3); or a
  row failing a hygiene rule (exit 1). A refusal is information, not an obstacle.
- **Expected diff:** the ONLY job change is one added row: `jobname` `cron-sync-trades`,
  `schedule` `30 4 * * *`, `active` true, `database` `postgres`, `username` `postgres`, `command`
  exactly `SELECT public.cron_sync_tick();` and `command_sha256` equal to the plain SHA-256 of that
  string (the arm computes it through its own `normalizeCommand` and `sha256Hex`; recompute it
  with `printf '%s' 'SELECT public.cron_sync_tick();' | shasum -a 256`, which read
  `fb9381445efaafaa539f5f299fa2102df3735813b549ab99ae6e7da50beab72a` on 2026-10-10). The
  `captured_at` line also changes.
- **Abort (do not move the file into place) if any OTHER job differs.** PROD drifted somewhere this
  runbook was not looking, and committing the manifest would bless it. Investigate with the
  read-only P4 comparison; never edit the manifest by hand.
- On exactly the expected diff: move the file into place, then `node scripts/prod-prober/run.mjs
  --preflight-repoint` must exit 0, and `npx vitest run src/__tests__/prod-prober-wiring.test.ts`
  plus `node scripts/prod-prober/run.mjs --self-test` stay green. The PR carrying the manifest
  merges AFTER Step C, outside the P6 hold.

## First tick (04:31Z of the first cron day)

<!-- form: first-tick -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
r AS (
  SELECT d.status, d.start_time, d.end_time
    FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = 'cron-sync-trades'
   ORDER BY d.start_time DESC LIMIT 2
)
SELECT m.marker_is_prod, r.status,
       (r.start_time >= __RUN_AT__::timestamptz AND r.start_time < __RUN_AT__::timestamptz + interval '24 hours')::int AS started_after_run_at,
       round(extract(epoch FROM (r.end_time - r.start_time)) * 1000) AS run_ms
  FROM m LEFT JOIN r ON true
 ORDER BY r.start_time DESC NULLS LAST;
```

Render with `RUN_AT=<04:30Z of the run day>`. Expected newest row: `1`, `succeeded`, `1`, and a
`run_ms` of a few milliseconds (the function only posts).

**`succeeded` proves only that the SQL ran, never the route.** The pg_net request is queued and
the route runs afterwards. The proof of the first tick is the Step B downstream read again
(`stepb-downstream` with `START=<RUN_AT>` and `PRE_HW=none`) at about 04:45Z, then the response
read for the run's request, with the same four-way verdict. `cron-obs` does not observe this
job (see below), so these reads are the only proof.

## Rollback

Unschedule by NAME (a `jobid` differs per project, so never by id), behind the same guard:

<!-- form: rollback -->
```sql
__GUARD__
SELECT cron.unschedule('cron-sync-trades'); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job WHERE jobname = 'cron-sync-trades') AS job_rows
  FROM m;
```

- The readback is one row, `marker_is_prod` and `job_rows`, expected `1,0`. If the job is already
  absent, `cron.unschedule` raises and the readback does not run: read the state with
  `guard-check` instead.
- Then, in the SAME session, re-capture the manifest as in Step D. The expected diff is the one
  row REMOVED and nothing else.
- **Data is kept** (disconnect, never delete): the stored trades, markers, stamps and re-derived
  series are valid data. The marker rows only mean the next tick, after a re-registration, resumes
  from them.

### Rolling back the D-08 carry-forward

Only if the `carried` oracle fails after the write, or the founder reverses D-08. It deletes ONLY
the carried rows: rows dated inside a recorded `legacy_ranges` entry AND strictly before the
strategy's first re-derived day. The latter is `REDERIVED`, one `ordinal:date` pair per strategy
(the `earliest_new_row_date` the worklist printed), or `none` when no re-derive has run yet. A
row dated on or after that day was written or overwritten by a trade-derived value (D-04, the
trade-derived figure wins), so it is never deleted, and a legacy range reaching it stays recorded
(decide that case by hand). Take `d08-before` first and read it again after:

<!-- form: rederived-cut -->
```sql
cut AS (
  SELECT split_part(e, ':', 1)::int AS strategy_ordinal, NULLIF(split_part(e, ':', 2), '')::date AS first_rederived
    FROM unnest(string_to_array(__REDERIVED__, '.')) AS e
   WHERE e LIKE '%:%'
)
```

<!-- form: d08-rollback -->
```sql
__GUARD__
WITH __D08_SCOPE__, -- WRITE
__REDERIVED_CUT__, -- WRITE
rng AS ( -- WRITE
  SELECT d.strategy_id, (x ->> 'from')::date AS d_from, (x ->> 'to')::date AS d_to, -- WRITE
         coalesce(cut.first_rederived, '9999-12-31'::date) AS cutoff -- WRITE
    FROM d08m d -- WRITE
    JOIN strategy_analytics a ON a.strategy_id = d.strategy_id -- WRITE
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array' THEN a.series_provenance -> 'legacy_ranges' ELSE '[]'::jsonb END) AS x -- WRITE
    LEFT JOIN cut ON cut.strategy_ordinal = d.strategy_ordinal -- WRITE
   WHERE d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[]) AND x ->> 'source' = 'returns_grid_carry_forward' -- WRITE
) -- WRITE
DELETE FROM csv_daily_returns c USING rng -- WRITE
 WHERE c.strategy_id = rng.strategy_id AND c.date BETWEEN rng.d_from AND rng.d_to AND c.date < rng.cutoff; -- WRITE
WITH __D08_SCOPE__, -- WRITE
__REDERIVED_CUT__, -- WRITE
keep AS ( -- WRITE
  SELECT d.strategy_id, -- WRITE
         coalesce(jsonb_agg(x) FILTER (WHERE NOT (x ->> 'source' = 'returns_grid_carry_forward' AND (x ->> 'to')::date < coalesce(cut.first_rederived, '9999-12-31'::date))), '[]'::jsonb) AS kept -- WRITE
    FROM d08m d -- WRITE
    JOIN strategy_analytics a ON a.strategy_id = d.strategy_id -- WRITE
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array' THEN a.series_provenance -> 'legacy_ranges' ELSE '[]'::jsonb END) AS x -- WRITE
    LEFT JOIN cut ON cut.strategy_ordinal = d.strategy_ordinal -- WRITE
   WHERE d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[]) -- WRITE
   GROUP BY d.strategy_id -- WRITE
) -- WRITE
UPDATE strategy_analytics a -- WRITE
   SET series_provenance = jsonb_set(a.series_provenance, '{legacy_ranges}', keep.kept, true) -- WRITE
  FROM keep -- WRITE
 WHERE a.strategy_id = keep.strategy_id AND a.series_provenance IS NOT NULL; -- WRITE
WITH __D08_SCOPE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, d.strategy_ordinal, d.csv_rows AS csv_rows_after,
       CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array'
            THEN jsonb_array_length(a.series_provenance -> 'legacy_ranges') ELSE 0 END AS legacy_ranges_after
  FROM m
  LEFT JOIN d08m d ON d.strategy_ordinal = ANY (string_to_array(__STRATS__, '.')::int[])
  LEFT JOIN strategy_analytics a ON a.strategy_id = d.strategy_id
 ORDER BY d.strategy_ordinal;
```

Expected readback after a clean rollback with `REDERIVED=none`: `csv_rows_after 0` and
`legacy_ranges_after 0` for each strategy. This is a destructive PROD write on money-adjacent
rows: render it only after reading `d08-before` and `d08-after`, and record the before and after
counts in the SUMMARY.

## What this runbook does not cover

- **A page when the tick fails.** No human is paged. `cron-obs` (`scripts/prod-prober/arms/cron-obs.mjs`)
  observes `match_engine_cron` and the ledger fan-out by job name and joins `net._http_response` by
  time only; it does NOT observe `cron-sync-trades`, and this job's pg_net rows can land in its
  time window. The staleness alarm is booked as `[167.1.2.2.2-TRADESYNC-STALENESS-ALARM]` to
  Phase 164.6.8 OUTAGEALERT (input: the `cron_runs` heartbeat, ceiling: D-05's 2 days). Until it
  exists, the public stale styling (D-06) and the first-tick reads above are the only signals, and
  they are human readings, not monitoring.
- **Recovery of the days the trade API no longer serves** (D-01, split out by D-09): Phase
  167.1.2.2.2.1 OKXHISTORY owns it, from the work list `okxhistory-worklist` prints. Nothing is
  filled here.
- **The sibling resume paths.** `POST /sync-trades` in `routers/exchange.py` and the queued
  `sync_trades` job still seed their window from `api_keys.last_sync_at`, which the 04:00 poll
  overwrites daily. Booked in `TODOS.md`, not fixed here.
- **`mt5` and `deribit` keys.** The tick selects connected `mt5` keys that back a strategy and
  they take the `deferred` path; a `deribit` key has no daily-P&L branch. Neither fetches.
- **Reading `cron.job_run_details.status` as proof of the sync.** It proves the SQL ran.
