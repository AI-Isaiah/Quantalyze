# Runbook — OKX Archive Rebuild Go-Live (OKXHISTORY, Phase 167.1.2.2.2.1)

**Owner:** the orchestrator runs the live ops (PROD writes are authorized, founder 2026-10-03); the
founder is told what was written, and decides at Step 3 · **Audience:** whoever triggers, reviews or
rolls back an OKX archive rebuild, months from now, with no memory of this phase · **Risk:** the
`apply` mode writes `csv_daily_returns` rows and `series_provenance` entries for published and
pending strategies, and the rebuilt days COUNT in their public headline metrics (D-07). Read "Blast
radius" and "What this runbook does not cover" before the pre-flight.

**Two dates and one rule to read first.**

- **The Q3 overlap expires about 2026-12-30.** The reconciliation compares the archive file with
  the live-derived days both cover. For Q3 2026 that overlap is 2026-08-02 to 2026-09-30, and OKX
  serves live bills only about 90 days back, so the overlap shrinks day by day and is gone about
  2026-12-30. After that, `calibrate` has nothing to compare for Q3 and the D-10 measurement cannot
  be repeated. Do the calibration before then, or re-decide the tolerance with the founder.
- **Deploy order.** The analytics worker carrying `run_okx_archive_rebuild_job` must be live, and the
  `compute_jobs` kind migration (`supabase/migrations/20261026120000_okx_archive_rebuild.sql`) must
  have applied, BEFORE any enqueue form is run. An old worker fails an unknown kind straight to
  `failed_final`, and a database without the migration refuses the enqueue. `guard-check` prints
  `kind_registered` for the second half; the first half is the worker's `/health` `git_sha`
  containing the merge.
- **Scheduling.** Enqueue outside 04:15-05:45 UTC. That window belongs to the daily trade-sync tick
  (04:30) and the allocator derive (05:30), which share the OKX rate limits and the worker queue
  with this job. The three enqueue forms refuse inside it.

## What this activates

Nothing runs by itself (D-04). The capability is a durable job kind, `okx_archive_rebuild`,
triggered ONLY by the enqueue forms in this file, which call `enqueue_compute_job` with the
api_key-scoped contract: `p_strategy_id` NULL, `p_api_key_id` = the key of the published, connected
rebuild target (ordinal 2).

The chain an enqueue starts:

1. `enqueue_compute_job(p_kind := 'okx_archive_rebuild', ...)` stores one `compute_jobs` row. Its
   `metadata` carries the INPUT keys only: `mode` (`preflight`, `calibrate` or `apply`), `quarters`,
   `rebuild_strategy_ids`, and per mode `zero_check_strategy_ids` or `approved_fingerprint`.
2. The worker claims it and runs `run_okx_archive_rebuild_job`
   (`analytics-service/services/okx_archive_job.py`). It refuses a non-OKX, disconnected, inactive or
   revoked key, a key on another venue account, and a key without the `read_only` permission, all
   before any archive request (D-02). It then requests each quarter's file from OKX's
   `bills-history-archive`, survives the hours-long wait and a service restart without holding a
   worker, downloads through the reviewed safe downloader, parses and classifies every bill
   (an unclassified type fails loud, D-08), and reconciles the file against the live-derived days.
3. The result is ONE object written with `set_compute_job_progress` and read back at
   `metadata->'member_progress'`. Top-level keys: `result_version`, `mode`, `stop_class` (null when
   clean), `account`, `subtypes`, `quarters`, `census`, `reconcile`, `excluded`, `info`, `d03`,
   `strategies`, `fingerprint`. A key a mode does not reach is null. Amounts appear only inside this
   database object, never in a log, `last_error` or tracked text. `last_error` reads
   `okx_archive_rebuild: <stop_class>` followed by dates and counts only.
4. `preflight` reads the account and the quarter state and writes nothing. `calibrate` measures the
   reconciliation and the D-03 zero-day check and returns a `fingerprint` of what it would write; it
   writes nothing. `apply` takes the founder-approved `approved_fingerprint`, re-derives the same
   fingerprint, refuses on any difference, and then calls `apply_okx_archive_rebuild` once per
   target strategy: one transaction that inserts the missing days into `csv_daily_returns` and
   narrows `unrecovered_gaps` / appends `reconstructed_ranges` in `series_provenance`.

The rebuild is scoped by the founder's decisions, not by this file: gaps only (D-01), the strategy on
the disconnected key excluded (D-02), strategy 4's June and July 0.0 days checked read-only (D-03),
transfers are external flows (D-08), the tolerance is one cent per day and for the window total and
is never widened (D-10), and a miss aborts that strategy's whole rebuild and writes nothing (D-11).

## Why it is safe now

What closed the failure modes of a first run, each cited by SYMBOL. **Re-read each at execution time;
this section states no number.**

- **The key refusals.** `_check_keys` and `_check_account` in `okx_archive_job.py`: pure-database
  identity checks run ahead of any credential decrypt, then the live `account/config` uid must equal
  the stored `venue_account_id` of the job key and of every target key (NULL never matches). Plan 07's
  `TestRefusals` pins each refusal with a neuter proof.
- **The closed stop set.** `STOP_CLASSES` (module constant). A stop writes the result block first, then
  returns FAILED; `link_expired` is the one transient class.
- **The download surface.** `okx_archive_download` (allow-listed hosts in code, never by env; redirects
  refused; size and decompression caps). The link appears in no RPC parameter, log record or error text.
- **The write.** `apply_okx_archive_rebuild` (`supabase/schema/functions/apply_okx_archive_rebuild.sql`):
  compare-and-set against the stored gaps, containment (a row outside every stored gap rolls the whole
  call back), `ON CONFLICT (strategy_id, date) DO NOTHING` so a day that already has a row keeps it
  (D-12), and the narrowed gaps cross-checked against the caller's own computation. Rows and
  disclosure are written in ONE transaction.
- **The forms below.** Every read is a counts-and-dates form that carries the marker as its first
  column; every write form starts from a guard that RAISES on a wrong, NULL or missing marker; the
  enqueue forms refuse in SQL when a target's key is disconnected (D-02) and `enqueue-apply`
  refuses a fingerprint that is not 64 lowercase hex.

## Blast radius

Counts as measured 2026-10-15 (re-measure with `ordinals` and `worklist`):

1. **Population.** 4 non-archived OKX strategies. Ordinals 1 and 2 are the rebuild targets (D-01):
   ordinal 1 is `pending_review` with a 70-day `unrecovered_gaps` entry, ordinal 2 is `published` with
   an 87-day entry (157 days in all, inside 2026 Q2 and Q3). Ordinal 3 sits on a DISCONNECTED key and
   is excluded (D-02): no form here targets it and the enqueue forms refuse if it appears as a target.
   Ordinal 4 is the zero-check (D-03): read-only, `calibrate` only. Ordinals 1, 2 and 4 share one venue
   account, so one archive file per quarter serves all of them.
2. **What changes.** `csv_daily_returns` gains up to 157 rows (ordinals 1 and 2 together) and
   `strategy_analytics.series_provenance` gains `reconstructed_ranges` entries and narrower
   `unrecovered_gaps`, for ordinals 1 and 2 only. No other table, no other strategy, no schema.
3. **Public numbers change.** Rebuilt days count in headline metrics (D-07). Ordinal 2 is published:
   its `headline_since` moves from 2026-08-02 toward 2026-02-23. Ordinal 1 is `pending_review`: its
   moves toward about 2026-05-24. The factsheet also gains the D-06 line naming each rebuilt range.
4. **The next tick recomputes anyway.** The daily 04:30Z tick enqueues a derive and a following
   analytics compute for each connected key's strategy, so the rebuilt rows reach the headline at the
   next tick whether or not anything else runs. When the founder wants to see the changed headline
   before it is public, `apply` is held until just before the consolidated recompute (Step 3).
5. **Accepted residual risks.** The first real archive response is unmeasured (container, host, header
   columns, quarter boundaries, currencies): `calibrate` is the measurement and it STOPS on any
   surprise. `reconstructed_ranges` can over-claim a day that a later live derive overwrote (Step 5).

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export TS_SP="${TS_SP:-$HOME/.cache/quantalyze/okxhistory-167.1.2.2.2.1}"; mkdir -p "$TS_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link (`supabase/.temp/project-ref`) exists only
  there, and it targets PRODUCTION. `--agent no` pins plain CSV with no envelope. Pass `-f` an
  ABSOLUTE path: the CLI resolves a relative one against `--workdir`.
- `TS_SP` is the scratch directory: outside the repo, persistent, shared by every session of this
  phase. Every SQL file and CSV lives there, never in a tracked path. **Readback outputs that carry
  `series_provenance` or `member_progress` are read in `TS_SP` and pasted nowhere.**
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
  numbers, amounts or home paths. Strategies and keys are named by ORDINAL below.

The renderer extracts a named SQL form from this very file, so what is run is what is written
here. Install it once:

```bash
cat > "$TS_SP/form.mjs" <<'JS'
import fs from "node:fs";

const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name, ...kv] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name> [KEY=value ...]");
const md = fs.readFileSync("docs/runbooks/okxhistory-go-live.md", "utf8");
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
  if (!/^[A-Z0-9_]+$/.test(k) || !/^[A-Za-z0-9:.+-]+$/.test(v)) fail("bad parameter " + a);
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
  if (/cron\.(un)?schedule\s*\(|apply_okx_archive_rebuild\s*\(|enqueue_\w+\s*\(|\b(insert|update|delete)\b/i.test(scan)) fail("DRY render still carries a write");
}
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$TS_SP/form.mjs" <form-name> [KEY=value ...] > "$TS_SP/<file>.sql"`, then
`q "$TS_SP/<file>.sql" > "$TS_SP/<file>.csv"`.

- `DRY=1` deletes every line ending in `-- WRITE` and refuses to emit a file that still contains
  `cron.schedule(`, `cron.unschedule(`, an `apply_okx_archive_rebuild(` call, an `enqueue_...(` call,
  or an INSERT, UPDATE or DELETE. The scan first removes the marker literal, because the marker's own
  sentence contains the word DELETE; do the same before grepping a file by hand for those words.
  **`DRY` is read only as a `KEY=value` argument; an environment variable is ignored.** Every read form
  in this file is run with `DRY=1`.
- **A write statement is tagged line by line.** Every line of a write statement ends in
  `-- WRITE`, and a shared fragment expanded on such a line is tagged by the renderer, so a DRY
  render removes the whole statement and leaves the guard, the refusal checks and the readback.
- `GUARD_TEST=mismatch` or `GUARD_TEST=null` renders the guard's two refusal variants.
- **Ordinals are not ids.** `ord` numbers the non-archived OKX strategies by status, then id
  (`row_number() OVER (ORDER BY s.status, s.id)`). A new OKX strategy can shift them, which is why the
  enqueue forms re-check each target's key and venue account in SQL and why `ordinals` is read first.

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

### Shared fragments

Two CTE fragments the forms below expand. They are not operator steps. A fragment holds CTEs only,
has no trailing comma, and is used as `WITH __NAME__, next_cte AS (...)`.

The universe: every non-archived OKX strategy, with its ordinal, its key's connected flag and its key's
venue account. `connected` is the worker's own definition (`_key_is_connected`): active, not
disconnected, not revoked.

<!-- form: okx-universe -->
```sql
ou AS (
  SELECT s.id AS strategy_id, s.api_key_id AS key_id, s.status,
         (k.is_active AND k.disconnected_at IS NULL AND k.sync_status IS DISTINCT FROM 'revoked') AS connected,
         k.venue_account_id AS acct,
         row_number() OVER (ORDER BY s.status, s.id) AS ord
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
```

The stored provenance per ordinal, each list normalised to an array (a NULL column or a non-array value
reads as empty, as the public reader does) and the headline start from `data_quality_flags`:

<!-- form: okx-prov -->
```sql
__OKX_UNIVERSE__,
pv AS (
  SELECT ou.ord, ou.strategy_id, ou.status, ou.connected,
         CASE WHEN jsonb_typeof(a.series_provenance -> 'legacy_ranges') = 'array' THEN a.series_provenance -> 'legacy_ranges' ELSE '[]'::jsonb END AS legacy,
         CASE WHEN jsonb_typeof(a.series_provenance -> 'unrecovered_gaps') = 'array' THEN a.series_provenance -> 'unrecovered_gaps' ELSE '[]'::jsonb END AS gaps,
         CASE WHEN jsonb_typeof(a.series_provenance -> 'reconstructed_ranges') = 'array' THEN a.series_provenance -> 'reconstructed_ranges' ELSE '[]'::jsonb END AS recon,
         a.data_quality_flags ->> 'headline_since' AS headline_since,
         a.series_provenance
    FROM ou
    LEFT JOIN strategy_analytics a ON a.strategy_id = ou.strategy_id
)
```

## Pre-flight

Run these in order, in one session. Any non-`1` `marker_is_prod`, or a refusal, stops the session.

**P0. The marker, alone.** Render and run `marker` as its own call. Record the one row it returns and
confirm it names PRODUCTION. If it is NULL, the marker was lost: re-set it before writing, never
proceed on a guess.

```bash
node "$TS_SP/form.mjs" marker > "$TS_SP/p0.sql" && q "$TS_SP/p0.sql" > "$TS_SP/p0.csv"
```

**P1. The OKX universe, by ordinal.** `ordinals` lists each non-archived OKX strategy with its status,
whether its key is connected, whether that key shares the venue account with ordinal 2, and the role
the enqueue forms would give it. Expected on 2026-10-15: four rows; ordinals 1 and 2 `rebuild target`;
ordinal 3 key NOT connected, `refused (D-02)`; ordinal 4 `zero-check`; ordinals 1, 2 and 4 share the
account.

<!-- form: ordinals -->
```sql
WITH __OKX_UNIVERSE__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, ou.ord AS ordinal, ou.status, ou.connected AS key_connected,
       (ou.acct IS NOT NULL AND ou.acct IS NOT DISTINCT FROM o2.acct) AS shares_account_with_ordinal_2,
       CASE WHEN ou.ord IS NULL THEN NULL
            WHEN NOT ou.connected THEN 'refused (D-02)'
            WHEN ou.ord IN (1, 2) THEN 'rebuild target'
            WHEN ou.ord = 4 THEN 'zero-check'
            ELSE 'not targeted' END AS form_role
  FROM m
  LEFT JOIN ou ON true
  LEFT JOIN ou o2 ON o2.ord = 2
 ORDER BY ou.ord;
```

**P2. The work list, by ordinal.** `worklist` counts and dates only: the carried-forward
`legacy_ranges`, the named `unrecovered_gaps`, any `reconstructed_ranges`, and `headline_since`. Each
`*_dates` column is `from:to` islands joined by `+`, or `none`.
Expected on 2026-10-15: ordinal 1 gap 2026-05-24 to 2026-08-01, ordinal 2 gap 2026-05-07 to 2026-08-01,
ordinals 3 and 4 no gap, no `reconstructed_ranges` anywhere.

<!-- form: worklist -->
```sql
WITH __OKX_PROV__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, pv.ord AS ordinal, pv.status, pv.connected AS key_connected,
       jsonb_array_length(pv.legacy) AS legacy_ranges_n,
       coalesce((SELECT string_agg((x ->> 'from') || ':' || (x ->> 'to'), '+' ORDER BY x ->> 'from') FROM jsonb_array_elements(pv.legacy) x), 'none') AS legacy_dates,
       jsonb_array_length(pv.gaps) AS unrecovered_gaps_n,
       coalesce((SELECT string_agg((x ->> 'from') || ':' || (x ->> 'to'), '+' ORDER BY x ->> 'from') FROM jsonb_array_elements(pv.gaps) x), 'none') AS unrecovered_dates,
       jsonb_array_length(pv.recon) AS reconstructed_ranges_n,
       coalesce((SELECT string_agg((x ->> 'from') || ':' || (x ->> 'to'), '+' ORDER BY x ->> 'from') FROM jsonb_array_elements(pv.recon) x), 'none') AS reconstructed_dates,
       pv.headline_since
  FROM m
  LEFT JOIN pv ON true
 ORDER BY pv.ord;
```

```bash
for n in ordinals worklist; do
  node "$TS_SP/form.mjs" "$n" DRY=1 > "$TS_SP/p-$n.sql" && q "$TS_SP/p-$n.sql" > "$TS_SP/p-$n.csv"
done
```

The step forms (Steps 1 to 5), the rollback and the parameter table follow in the sections below.
