# Runbook — OKX Archive Rebuild Go-Live (OKXHISTORY, Phase 167.1.2.2.2.1)

**Owner:** the orchestrator runs the live ops (PROD writes are authorized, founder 2026-10-03); the
founder is told what was written, and decides at Step 3 · **Audience:** whoever triggers, reviews or
rolls back an OKX archive rebuild, months from now, with no memory of this phase · **Risk:** the
`apply` mode writes `csv_daily_returns` rows and `series_provenance` entries for published and
pending strategies, and the rebuilt days COUNT in their public headline metrics (D-07). Read "Blast
radius" and "What this runbook does not cover" before the pre-flight.

**Two dates and one rule to read first.**

- **The Q3 overlap closes about 2026-12-12.** The reconciliation compares the archive file with
  the live-derived days both cover. The job takes the live reach as the run date minus
  `LIVE_REACH_ASSUMED_DAYS` (88), opens the window the day after that boundary, and needs at least
  `MIN_COMPARED_DAYS` (14) compared days with `MIN_ACTIVE_DAYS` (5) active ones (review round 1, CR-01
  and F3). OKX cuts quarters at 00:00 UTC+8 (D-15), so the Q3 file ends at 16:00 UTC on 2026-09-30, and
  2026-09-30 is a quarter-edge day only the Q4 file (the current quarter, which OKX excludes) could make
  whole. The last compared Q3 day is therefore 2026-09-29, and a Q3 window of 14 days is last possible on
  a run dated 2026-12-12 UTC: that date minus 88 days is 2026-09-15, so the first full live day is 09-16,
  and 09-16..09-29 is 14 days. After that `calibrate` stops `reconcile_miss cause=insufficient_overlap`
  and the D-10 measurement cannot be repeated. Do the calibration before then, or re-decide with the founder.
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
  returns FAILED; the transient classes are the members of `TRANSIENT_STOP_CLASSES` (`link_expired`,
  `live_fetch_failed`, `claim_budget_exceeded`), and the job retries those itself.
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
  refuses a fingerprint that is not 64 lowercase hex. `after` and `rollback` refuse in SQL when the
  ordinal no longer names the strategy the saved `before` CSV described (its `ord_digest`), because
  ordinals are a `row_number()` and not ids.

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
   columns, quarter boundaries (the cut was measured on 2026-10-22 as 00:00 UTC+8, D-15), currencies):
   `calibrate` is the measurement and it STOPS on any surprise. `reconstructed_ranges` can over-claim a day that a later live derive overwrote (Step 5).

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
  **`before` therefore records an `ord_digest` per ordinal** (`md5(strategy_id::text)`, an identity
  check and not a secret), and `after` and `rollback` take the digest as a parameter and REFUSE in SQL,
  before any read or write, when the ordinal now names a different strategy. The digest lives only in the
  scratch `before` CSV and never in tracked text (tracked text names no strategy id, and a digest of one
  is treated the same).

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

**P1. The guard proves itself, and the deploy order is read.** `guard-check` carries the guard and
returns the marker column, whether the job kind is registered in this database (`kind_registered`, 1
after the migration applied) and how many jobs of the kind are in flight. It proves the guard on three
branches; each run renders the same form with one change:

<!-- form: guard-check -->
```sql
__GUARD__
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM compute_job_kinds WHERE name = 'okx_archive_rebuild') AS kind_registered,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')) AS in_flight
  FROM m;
```

- Positive (no `GUARD_TEST`): returns one row, `1,1,0` once the migration has applied and nothing runs.
  `kind_registered` 0 means the migration has not applied: stop, nothing below can be enqueued.
- `GUARD_TEST=mismatch`: must exit non-zero with `refusing to continue` and return NO row.
- `GUARD_TEST=null`: the live value replaced by a NULL text literal; same expectation. This is the
  proof that a lost marker refuses rather than passes.

```bash
node "$TS_SP/form.mjs" guard-check > "$TS_SP/p1.sql" && q "$TS_SP/p1.sql" > "$TS_SP/p1.csv"
node "$TS_SP/form.mjs" guard-check GUARD_TEST=mismatch > "$TS_SP/p1m.sql"; q "$TS_SP/p1m.sql" && echo "UNEXPECTED: mismatch did not refuse"
node "$TS_SP/form.mjs" guard-check GUARD_TEST=null > "$TS_SP/p1n.sql"; q "$TS_SP/p1n.sql" && echo "UNEXPECTED: null did not refuse"
```

Also confirm the worker is live with the merge: the analytics service `/health` `git_sha` contains the
merge commit (the Railway deploy runs only after main CI is green; see `docs/runbooks/railway-worker.md`).

**P2. The OKX universe, by ordinal.** `ordinals` lists each non-archived OKX strategy with its status,
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

**P3. The work list, by ordinal.** `worklist` counts and dates only: the carried-forward
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

## Forms and their parameters

| Parameter | Meaning | Example |
|---|---|---|
| `RUN` | a run label, letters, digits and `: . -` only; it becomes part of the job's idempotency key | `20261020T1000` |
| `FP` | the founder-approved fingerprint, 64 lowercase hex, copied from the `calibrate` result | |
| `O1_GAPS`, `O2_GAPS` | ordinal 1's and ordinal 2's stored gaps BEFORE apply: the `before` CSV's `gaps_param` value, `from:to` islands joined by `+`, or `none` | `2026-05-24:2026-08-01` |
| `O1_DIGEST`, `O2_DIGEST` | ordinal 1's and ordinal 2's `ord_digest` from the SAME `before` CSV row (32 lowercase hex); `after` refuses in SQL when either ordinal is no longer that strategy | `0123456789abcdef0123456789abcdef` |
| `ORD` | the ordinal to roll back | `1` |
| `GAPS` | that ordinal's `before` `gaps_param` value (the gaps to restore) | `2026-05-24:2026-08-01` |
| `DIGEST` | that ordinal's `before` `ord_digest` value; `rollback` refuses in SQL when the ordinal is no longer that strategy | `0123456789abcdef0123456789abcdef` |

| Form | Kind | Parameters |
|---|---|---|
| `marker`, `ordinals`, `worklist`, `job-result`, `before`, `survival` | read, run with `DRY=1` | none |
| `after` | read, run with `DRY=1` | `O1_GAPS`, `O2_GAPS`, `O1_DIGEST`, `O2_DIGEST` |
| `guard-check` | read behind the guard | none (`GUARD_TEST` optional) |
| `enqueue-preflight`, `enqueue-calibrate` | WRITE (one job row) | `RUN` |
| `enqueue-apply` | WRITE (one job row) | `RUN`, `FP` |
| `rollback` | WRITE (founder decision only) | `ORD`, `GAPS`, `DIGEST` |

The fragments `okx-universe`, `okx-prov` and `target-refusal` are expanded by the forms and are never
run on their own. The enqueue forms carry today's work list as literals: rebuild targets are ordinals
1 and 2, the job key is ordinal 2's, the zero-check target is ordinal 4, the quarters are 2026 Q2 and
Q3. A different work list is a reviewed edit of these forms, never a parameter.

## Step 1 — preflight

Reads the account and the quarter state; writes nothing. It proves the key is the right account before
anything is requested from OKX's archive.

Every enqueue form starts from the marker guard, then refuses in SQL when: the time is inside the
04:15-05:45 UTC window; a rebuild target is missing, sits on a disconnected, inactive or revoked key
(the D-02 refusal; ordinal 3 is exactly this case), or is on another venue account than the job key.
It then enqueues, and ends with a readback row counting this run's job and the in-flight jobs.

<!-- form: target-refusal -->
```sql
DO $refuse$
DECLARE
  v_bad integer;
  v_now time := (now() AT TIME ZONE 'UTC')::time;
BEGIN
  IF v_now BETWEEN time '04:15' AND time '05:45' THEN
    RAISE EXCEPTION 'okx_archive_rebuild: 04:15-05:45 UTC belongs to the daily tick and the allocator derive; run this form outside it';
  END IF;
  WITH __OKX_UNIVERSE__
  SELECT count(*) INTO v_bad
    FROM unnest(ARRAY[1, 2]) AS t (ord)
    LEFT JOIN ou ON ou.ord = t.ord
   WHERE ou.strategy_id IS NULL
      OR ou.connected IS NOT TRUE
      OR ou.acct IS NULL
      OR ou.acct IS DISTINCT FROM (SELECT o2.acct FROM ou o2 WHERE o2.ord = 2);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'okx_archive_rebuild: a rebuild target is missing, sits on a disconnected key, or is on another venue account (D-02); re-read ordinals';
  END IF;
END
$refuse$;
```

<!-- form: enqueue-preflight -->
```sql
__GUARD__
__TARGET_REFUSAL__
SELECT enqueue_compute_job( -- WRITE
  p_kind := 'okx_archive_rebuild', -- WRITE
  p_api_key_id := (WITH __OKX_UNIVERSE__ SELECT ou.key_id FROM ou WHERE ou.ord = 2), -- WRITE
  p_strategy_id := NULL, -- WRITE
  p_idempotency_key := 'okx-archive-preflight-' || __RUN__, -- WRITE
  p_metadata := jsonb_build_object( -- WRITE
    'mode', 'preflight', -- WRITE
    'quarters', '[{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]'::jsonb, -- WRITE
    'rebuild_strategy_ids', (WITH __OKX_UNIVERSE__ SELECT jsonb_agg(ou.strategy_id ORDER BY ou.ord) FROM ou WHERE ou.ord IN (1, 2)) -- WRITE
  ), -- WRITE
  p_run_at := now() -- WRITE
); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, 'preflight' AS mode,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND idempotency_key = 'okx-archive-preflight-' || __RUN__) AS this_run_jobs,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')) AS in_flight
  FROM m;
```

```bash
node "$TS_SP/form.mjs" enqueue-preflight RUN=20261020T1000 > "$TS_SP/s1.sql" && q "$TS_SP/s1.sql" > "$TS_SP/s1.csv"
```

Expected readback: `this_run_jobs 1`. The idempotency key makes a repeat of the same `RUN` a no-op that
returns the same job; use a new `RUN` for a new preflight. Then read the job (below) until it is `done`.

**Read the result.** `job-result` lists the five newest jobs of the kind: status, attempts,
`next_attempt_at`, the class prefix of `last_error`, `last_error` whole only when it is the job's own stop
text (`okx_archive_rebuild: ...`, which by the job contract carries dates, counts and closed-vocabulary
classes only), `last_error_uncontracted`, `stop_class` from the result, and the whole `member_progress`
object as text. The CSV goes to `TS_SP` and is read there; **its `member_progress` column carries amounts
and is never pasted into a tracked file or a chat.** `last_error_uncontracted` true means the text came
from the dispatcher or the key preflight, not from the job; the `last_error` column is empty for that row
and the text is not selected. It gets the same never-paste rule as `member_progress`: return to the
founder.

<!-- form: job-result -->
```sql
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
j AS (
  SELECT * FROM compute_jobs WHERE kind = 'okx_archive_rebuild' ORDER BY created_at DESC LIMIT 5
)
SELECT m.marker_is_prod, j.idempotency_key, j.metadata ->> 'mode' AS mode, j.status, j.attempts, j.max_attempts,
       j.next_attempt_at,
       substring(j.last_error from '^okx_archive_rebuild: ([a-z0-9_]+)') AS error_class,
       CASE WHEN j.last_error ~ '^okx_archive_rebuild: ' THEN j.last_error END AS last_error,
       (j.last_error IS NOT NULL AND j.last_error !~ '^okx_archive_rebuild: ') AS last_error_uncontracted,
       j.error_kind,
       j.metadata ->> 'member_progress_at' AS progress_at,
       j.metadata -> 'member_progress' ->> 'stop_class' AS stop_class,
       (j.metadata -> 'member_progress')::text AS member_progress
  FROM m
  LEFT JOIN j ON true
 ORDER BY j.created_at DESC;
```

```bash
node "$TS_SP/form.mjs" job-result DRY=1 > "$TS_SP/jr.sql" && q "$TS_SP/jr.sql" > "$TS_SP/jr.csv"
```

A job that is `pending` or `running` is waiting or working: the archive wait is hours and the job defers
itself, so there is nothing to do but read again later. A venue rate limit (on an archive call or on the
live crawl) is a defer too, not a failure: the job returns to `pending` with a later `next_attempt_at`
(at least 15 minutes) and no attempt is used, so read again after that time.

**Transient classes: wait, do not escalate.** `failed_retry` with `error_class` `link_expired`,
`live_fetch_failed` or `claim_budget_exceeded` (the members of `TRANSIENT_STOP_CLASSES` in
`okx_archive_job.py`, read the symbol at execution time) is a retry in progress: the job retries itself
and the next claim re-reads OKX from scratch. Nothing is lost between claims. It stays a wait for as long
as `attempts` is below `max_attempts`; if it ends `failed_final` instead, it is a STOP like any other.

**STOP: `archive_give_up`.** A permanent `error_class` `archive_give_up` means the job stopped waiting
for OKX: either the 8 h bound from OKX's request time (`last_error` ends `quarter=... age_h=N`) or the 24 h
backstop from the job's own `created_at` (`last_error` ends `backstop age_h=N`, or `backstop age=unreadable`
when the job's age could not be read, which fails closed). Nothing was written. Return to the founder with
the quarter and the age; do not re-enqueue to get past it.

Any other `error_class` is permanent (`failed_final`): it is a STOP, read the class and the dates and
counts in `last_error`, and return to the founder. Never re-enqueue to get past a stop.

**Preflight reading, from `member_progress`:** `account.uid_match` true, `account.read_only` true,
`subtypes.drift` empty, `quarters[].state` per quarter (`finished`, `ongoing`, `failed` or null) and
`quarters[].href_scheme` / `href_host` (the allow-list entry the founder reviews at Step 3).
**STOP if** `uid_match` is false (the key is not the account the strategies were derived from),
`read_only` is false, `subtypes.drift` is non-empty, or `stop_class` is set.

## Step 2 — calibrate

Requests the Q2 and Q3 files (the ~2-3 hour wait is the job's, not yours), downloads and parses them,
and measures the reconciliation against the live-derived days both cover. It also runs the D-03
read-only check of ordinal 4's stored zero-return days. It writes NOTHING and returns a `fingerprint` of
what `apply` would write.

`enqueue-calibrate` is `enqueue-preflight` with the mode `calibrate`, ordinal 4 as the zero-check
target, and one more refusal for that target.

<!-- form: enqueue-calibrate -->
```sql
__GUARD__
__TARGET_REFUSAL__
DO $refuse0$
DECLARE
  v_bad integer;
BEGIN
  WITH __OKX_UNIVERSE__
  SELECT count(*) INTO v_bad
    FROM unnest(ARRAY[4]) AS t (ord)
    LEFT JOIN ou ON ou.ord = t.ord
   WHERE ou.strategy_id IS NULL
      OR ou.connected IS NOT TRUE
      OR ou.acct IS DISTINCT FROM (SELECT o2.acct FROM ou o2 WHERE o2.ord = 2);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'okx_archive_rebuild: the zero-check target is missing, sits on a disconnected key, or is on another venue account (D-02); re-read ordinals';
  END IF;
END
$refuse0$;
SELECT enqueue_compute_job( -- WRITE
  p_kind := 'okx_archive_rebuild', -- WRITE
  p_api_key_id := (WITH __OKX_UNIVERSE__ SELECT ou.key_id FROM ou WHERE ou.ord = 2), -- WRITE
  p_strategy_id := NULL, -- WRITE
  p_idempotency_key := 'okx-archive-calibrate-' || __RUN__, -- WRITE
  p_metadata := jsonb_build_object( -- WRITE
    'mode', 'calibrate', -- WRITE
    'quarters', '[{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]'::jsonb, -- WRITE
    'rebuild_strategy_ids', (WITH __OKX_UNIVERSE__ SELECT jsonb_agg(ou.strategy_id ORDER BY ou.ord) FROM ou WHERE ou.ord IN (1, 2)), -- WRITE
    'zero_check_strategy_ids', (WITH __OKX_UNIVERSE__ SELECT jsonb_agg(ou.strategy_id ORDER BY ou.ord) FROM ou WHERE ou.ord = 4) -- WRITE
  ), -- WRITE
  p_run_at := now() -- WRITE
); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, 'calibrate' AS mode,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND idempotency_key = 'okx-archive-calibrate-' || __RUN__) AS this_run_jobs,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')) AS in_flight
  FROM m;
```

```bash
node "$TS_SP/form.mjs" enqueue-calibrate RUN=20261020T1100 > "$TS_SP/s2.sql" && q "$TS_SP/s2.sql" > "$TS_SP/s2.csv"
```

**Calibrate reading, from `member_progress`** (read in `TS_SP`, counts and dates only into any note):

- `quarters[]`: `state` `finished` for both, `container`, `has_type_column`, `ts_min_day` / `ts_max_day`
  with every `ts` inside the quarter as OKX cuts it, from 00:00 UTC+8 on its first day to 00:00 UTC+8 on
  the day after its last (16:00 UTC the day before each, D-15). So Q2's `ts_min_day` can read 03-31, and
  both Q2's `ts_max_day` and Q3's `ts_min_day` can read 06-30. A row outside is the STOP
  `quarter_range_mismatch`. For a refused file the block's
  `ts_min_day` / `ts_max_day` stay null; read the stop's `last_error` instead (the `last_error` column of
  `job-result`). It names `range_start` and `range_end_exclusive` (the requested quarter's first day and
  the day after its last; the parser cuts each at 00:00 UTC+8, that is 16:00 UTC the day before, D-15),
  `observed_min_day` and `observed_max_day` (the file's earliest and latest `ts` as UTC days) and
  `rows_outside` (the count of rows outside the range); `unreadable` marks a value the job would not echo.
  An `empty_file` stop (`parse=empty_file`) carries none of these. Under the UTC+8 cut a mismatch is a new
  finding; the dates go to the founder (D-14, D-15); do not re-enqueue to get past it.
  Also in the result, per quarter: `quarters[].longest_billless_run` (`{days, from, to}`). Step 3 reads it
  with `info.bal_chain`, the one balance-chain proof.
- `info.bal_chain`: on a clean calibrate, `ccys.<ccy>` with `pairs_checked`, `first_day` and `last_day`
  (the days the chain reaches), the `total_pairs` over all currencies and the `floor` (2 pairs; a currency
  that carries money with fewer cannot prove completeness) and `blank_ccy_skipped` (D-16), the count of
  bills with a blank `ccy` and no effect at all (`balChg`, `pnl` and `fee` all 0) left out of the chain.
  Such a bill cannot move any currency's balance, so its neighbours still chain without it. On a clean
  calibrate it equals `census.by_ccy` `(blank)`, and it is a reading, not a stop. The chain runs per
  currency across the deduplicated bills of every ADJACENT requested quarter in billId order, so the Q2
  to Q3 seam is inside it. A clean calibrate proves the chain by the absence of the `archive_incomplete`
  stop and shows the numbers above. The stop's own `info.bal_chain` adds `reason` (`bal_chain_break`,
  `too_few_pairs` or `unchainable_row`; `last_error` carries `cause=<reason>`), per currency `breaks`,
  `seam_breaks` (breaks on a pair that crosses two files) and `first_break_day`, `starved` (the
  currencies under the floor) and `files[]` (each file's `ts_min_day` / `ts_max_day`). An
  `unchainable_row` stop (D-16) is a bill the chain cannot place. That is a blank `ccy` with an effect
  (`blank_ccy`) or a `billId` that is not all digits (`nondigit_bill_id`, whatever its effect). One bill
  can carry both causes, and `rows` counts each once. Its `info.bal_chain` adds `rows`, `blank_ccy`,
  `nondigit_bill_id`, `first_day` / `last_day` (the UTC days of the first and last such bill) and
  `blank_ccy_skipped`. Per file, in `files[]` in `quarters[]` order, it adds the same counts and days
  beside `ts_min_day` / `ts_max_day`. Its `last_error` continues after `cause=unchainable_row` with
  `rows=`, `blank_ccy=`, `nondigit_bill_id=`, `first_day=`, `last_day=` and
  `rows_by_quarter=<YYYY-Qn>:<n>,...`, and `unreadable` marks a value the job would not echo. Counts and
  dates only, never a billId or an amount. The readings go to the founder (D-16); do not re-enqueue to
  get past the stop.
- `census`: `by_ccy` all USDT, apart from a `(blank)` count that on a clean calibrate equals
  `info.bal_chain.blank_ccy_skipped` (D-16), `by_sub_type` with no unclassified type, `unknown_zero_effect` 0. A
  non-USD currency is the STOP `non_usd_ccy`, and it is the measurement that settles
  `[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]`. `census.edge_days` (`{whole, missing}`, dates only) names the
  quarter-edge UTC days, the days OKX's 00:00 UTC+8 cut splits between two files (03-31, 06-30, 09-30,
  12-31). A day in `whole` had both neighbouring files read and counts like any other day. A day in
  `missing` has no daily total: it is never compared, never written and never 0.0, and if it lies inside a
  stored gap it stays in `gaps_after` (named, TRADESYNC D-02). For the Q2 and Q3 run the expected reading
  is `whole` [2026-06-30] and `missing` [2026-03-31, 2026-09-30]. Neither missing day lies in the two named
  gaps: 03-31 sits in the carried-forward `legacy_ranges` and 09-30 on live-derived days (D-01, D-12), so Q1
  is not requested. A classification stop's census (`non_usd_ccy`, `unknown_subtype_nonzero`) carries the
  four count keys only.
- `reconcile`: for `realized` and `funding`, `ok` true, `days_over_cent` 0, `max_abs_diff` and
  `window_total_diff` within one cent, `misses` empty, and `reconcile.window` naming the overlap days
  actually compared; it ends at the last whole covered UTC day, 2026-09-29 for Q3 without Q4 (D-15).
- `d03`: `hits` empty (D-03). A hit is the STOP `d03_zero_day_has_archive_pnl`; nothing is rewritten and
  the fix, if any, is a separate founder decision.
- `strategies[]`: `insert_days`, `insert_ranges`, `gaps_before` and `gaps_after` per target, in input order.
- `fingerprint`: 64 lowercase hex, the value Step 3 approves.

**D-10: any calibration day above one cent STOPS for the founder.** The tolerance is one cent per day
and the same bound on the window total, measured first on the real overlap. It is never widened, never
configurable, and nothing in this file or in the job changes it. A reading above it ends this runbook at
this step and returns the exact day count and dates to the founder. **D-11: a miss writes nothing**;
there is nothing to clean up after a stop here.

## Step 3 — founder review (go / no-go and the fingerprint)

No form runs here; the founder reads and decides, with the orchestrator's summary of counts and dates:

1. The calibration readings above are clean (no STOP class, `days_over_cent` 0 in both legs).
2. **The archive files are complete, not merely in range (review round 1 F1, round 2 WR-01).** A bill-less
   day is rebuilt as an explicit 0.0 return, so a file that silently lost weeks would publish zeros for
   days that were real. Read `info.bal_chain` beside `quarters[].ts_min_day`, `quarters[].ts_max_day` and
   `quarters[].longest_billless_run.days` (with its `from` / `to`).
   - **What the chain proves:** the interior of every file and the Q2 to Q3 seam. Each currency's running
     balance chains bill to bill across both files, else the STOP `archive_incomplete`; a clean calibrate
     shows `pairs_checked` per currency. Every bill after a currency's first adds one pair, so
     `total_pairs` equals the sum of `quarters[].row_count`, less `info.bal_chain.blank_ccy_skipped`
     (D-16) and less one per currency; a total far below that is not a mystery to approve past.
   - **What it cannot prove:** the HEAD of the earliest file (Q2) and the TAIL of the latest (Q3). A file
     missing its first or last bills still chains. `info.bal_chain.ccys.<ccy>.first_day` and `last_day`
     say how far the proven chain reaches for each currency.
   - **When that needs the founder's judgment:** only for a gap day inside the unprovable head or tail,
     that is, an entry of `strategies[].gaps_before` earlier than the P&L currency's `first_day` or later
     than its `last_day`. `ts_min_day` later than the day before the quarter's first day, or `ts_max_day`
     earlier than the quarter's last day, is NOT a no-go by itself (an account with no bill in the first or
     last hours of the quarter, as OKX cuts it at 00:00 UTC+8, is complete and quiet). The
     bill-less run is read the same way: a long run is a no-go only if the account's real activity cannot
     explain it AND it overlaps the unprovable head or tail; an interior long run is already covered by
     the chain, because a missing bill would have broken it.
   A gap day in the unprovable head or tail, or a `first_day` / `last_day` the founder cannot reconcile
   with how the account traded, is a no-go to return to the founder, never a figure to approve. The key
   names match the shipped `okx_archive_job.py` (reconciled after review round 2).
3. The download host named by `quarters[].href_host` is in the code allow-list of `okx_archive_download`
   (a host that is not there stops the job as `download_refused`; adding one is a reviewed code change).
4. The `excluded` totals by month and class are as expected (information, not gates).
   **The readings that stand in for the money gates the founder has not decided.** None of these stops
   the job, no numeric bound is wired in code, and whether to bound one is the founder's decision. Each
   is read here, and a no-go is returned to the founder rather than approved:
   - `strategies[].insert_returns` (`{min, max, cumulative}`, the daily returns `apply` would write; they
     are anchored on today's equity and are deliberately NOT in the fingerprint). No-go: a `min` or `max`
     the account's real trading cannot explain, or `cumulative` null (a written day would be at or below
     -100%, so the compounded total is uncomputable).
   - `info.realized_balance_vs_rolled_nav` (`{day, archive_balance_usd_family, rolled_nav, diff}`). The
     one reading that checks the live anchor and the flow model together: the archive's balance at the
     end of the boundary day against today's equity rolled back to it. No-go: a `diff` the founder cannot
     explain by assets held outside the dollar family, or any of the three values null.
   - `info.flow_seam` and `info.flow_totals_overlap`, both measured around the real flow seam
     (`live_from.flows`, midnight of the run date minus 90 days), not around the P&L reconcile window.
     `flow_seam` gives, within seven days before the seam and up to seven days after it (never past
     the last day the archive covers, see `window.to`), the archive transfers the roll uses
     (`archive_before_seam_used`), the ones it discards (`archive_from_seam_discarded`) and the live flows
     it uses (`live_from_seam_used`), and `diff` (discarded minus used). All zero is a quiet seam. No-go:
     a `diff` the founder cannot match to one movement he knows of (a movement missing from both
     sources, or counted by one that the other disagrees with). `archive_before_seam_used` and
     `live_from_seam_used` both being nonzero is NOT a no-go on its own: any account with an ordinary
     deposit in the week before the seam and another in the week after shows both. No numeric limit is
     written anywhere; whether to set one is the founder's call at the Step 3 go/no-go. Every rebuilt day
     before the seam shifts by an unexplained `diff` in the NAV denominator. When the archive ends before
     the seam (`unmeasurable` is `archive_ends_before_the_seam`, `diff` null), there is nothing to
     compare: that is a missing reading, not a zero, and it is returned to the founder rather than
     approved.
     `flow_totals_overlap` (`{archive, live}`) is the same two sources
     from the seam to the end of the archive, the days both sources can carry (the live flows start at the
     seam, so an archive transfer before it belongs to `flow_seam`, never here); a disagreement there is an
     internal transfer the live endpoints do not list.
   - `info.live_from` (`{pnl, flows}`): the first day each live source owns. `pnl` must be the day after
     `reconcile.excluded_boundary_day`, and `flows` must equal `flow_seam.seam_day`. No-go: either
     disagrees, or `flows` is null.
5. The headline change for ordinal 2 (published) and ordinal 1 (`pending_review`): `strategies[]`
   `insert_ranges` is what each factsheet will name, and each headline start moves earlier.
6. **Timing.** The 04:30Z tick recomputes anyway (Blast radius, item 4), so the moment of `apply` is the
   founder's decision: apply just before the Wave 5 consolidated recompute to review the changed
   headline first, or apply early and let the next tick publish it.
7. Go / no-go. On go, the founder approves the `fingerprint` from the calibrate result. That value is
   `FP` below, and `apply` refuses on any other.

## Step 4 — apply

Run outside 04:15-05:45 UTC. Order: `before`, then `enqueue-apply`, then `job-result`, then `after` and
`survival`.

**4a. `before`.** Per ordinal: total `csv_daily_returns` rows, rows inside the stored gap ranges, the
gap and range entries with dates, a `gaps_param` column encoding the stored gaps as `from:to` islands
joined by `+` (for example `2026-05-24:2026-08-01`, or `none`), `headline_since`, the `ord_digest`
(`md5(strategy_id::text)`: which strategy this ordinal named at this moment), and the full
`series_provenance` value. **Save the CSV in `TS_SP` under a name that says `before`: its
`series_provenance` column is the rollback reference, and `gaps_param` and `ord_digest` for ordinals 1
and 2 are what `after` and `rollback` take. Take both from the SAME `before` CSV row: ordinals are
`row_number()` over status then id, so an ordinal read from a stale `before` can name another strategy,
and the digest is what makes `after` and `rollback` refuse that.**

<!-- form: before -->
```sql
WITH __OKX_PROV__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, pv.ord AS ordinal, pv.status,
       md5(pv.strategy_id::text) AS ord_digest,
       (SELECT count(*) FROM csv_daily_returns c WHERE c.strategy_id = pv.strategy_id) AS csv_rows_total,
       (SELECT count(*) FROM csv_daily_returns c
         WHERE c.strategy_id = pv.strategy_id
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(pv.gaps) g
                        WHERE c.date BETWEEN (g ->> 'from')::date AND (g ->> 'to')::date)) AS rows_in_stored_gaps,
       jsonb_array_length(pv.gaps) AS unrecovered_gaps_n,
       coalesce((SELECT string_agg((g ->> 'from') || ':' || (g ->> 'to'), '+' ORDER BY g ->> 'from') FROM jsonb_array_elements(pv.gaps) g), 'none') AS gaps_param,
       jsonb_array_length(pv.recon) AS reconstructed_ranges_n,
       coalesce((SELECT string_agg((g ->> 'from') || ':' || (g ->> 'to'), '+' ORDER BY g ->> 'from') FROM jsonb_array_elements(pv.recon) g), 'none') AS reconstructed_dates,
       jsonb_array_length(pv.legacy) AS legacy_ranges_n,
       pv.headline_since,
       pv.series_provenance::text AS series_provenance
  FROM m
  LEFT JOIN pv ON true
 ORDER BY pv.ord;
```

```bash
node "$TS_SP/form.mjs" before DRY=1 > "$TS_SP/b.sql" && q "$TS_SP/b.sql" > "$TS_SP/before-$(date -u +%Y%m%dT%H%M%SZ).csv"
```

**4b. `enqueue-apply`.** Takes the approved fingerprint as `FP`. The form refuses a value that is not 64
lowercase hex before anything is enqueued; the job refuses any value that is not the fingerprint it
re-derives (`fingerprint_mismatch`), and `zero_check_strategy_ids` is not passed (the job refuses it in
`apply`).

<!-- form: enqueue-apply -->
```sql
__GUARD__
DO $fp$
BEGIN
  IF __FP__ !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'okx_archive_rebuild: FP must be 64 lowercase hex characters (the approved fingerprint); refusing';
  END IF;
END
$fp$;
__TARGET_REFUSAL__
SELECT enqueue_compute_job( -- WRITE
  p_kind := 'okx_archive_rebuild', -- WRITE
  p_api_key_id := (WITH __OKX_UNIVERSE__ SELECT ou.key_id FROM ou WHERE ou.ord = 2), -- WRITE
  p_strategy_id := NULL, -- WRITE
  p_idempotency_key := 'okx-archive-apply-' || __RUN__, -- WRITE
  p_metadata := jsonb_build_object( -- WRITE
    'mode', 'apply', -- WRITE
    'quarters', '[{"year": 2026, "quarter": "Q2"}, {"year": 2026, "quarter": "Q3"}]'::jsonb, -- WRITE
    'rebuild_strategy_ids', (WITH __OKX_UNIVERSE__ SELECT jsonb_agg(ou.strategy_id ORDER BY ou.ord) FROM ou WHERE ou.ord IN (1, 2)), -- WRITE
    'approved_fingerprint', __FP__ -- WRITE
  ), -- WRITE
  p_run_at := now() -- WRITE
); -- WRITE
WITH m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, 'apply' AS mode,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND idempotency_key = 'okx-archive-apply-' || __RUN__) AS this_run_jobs,
       (SELECT count(*) FROM compute_jobs WHERE kind = 'okx_archive_rebuild' AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')) AS in_flight
  FROM m;
```

```bash
node "$TS_SP/form.mjs" enqueue-apply RUN=20261020T1500 FP=<the-approved-64-hex> > "$TS_SP/s4.sql" && q "$TS_SP/s4.sql" > "$TS_SP/s4.csv"
```

**4c. `job-result`.** Read until `done`. `strategies[].rpc.status` is `applied` (or `already_applied` on
a repeat, which writes nothing and is reported only when the stored archive `reconstructed_ranges`
already cover every planned day; a target with nothing to write is never a success, it is the STOP
`nothing_to_apply` before any write), `strategies[].insert_days` and `insert_ranges` name what was written,
and `gaps_after` is what remains unrecovered. A stop here (`fingerprint_missing`,
`fingerprint_mismatch`, `reconcile_miss`, `rpc_refused`, ...) wrote nothing for the strategy that
stopped (D-11, and the RPC's own rollback), and returns to the founder.

**4d. `after`.** Same columns as `before`, except the row count is taken inside the OLD gap ranges given
by the parameters, because apply NARROWS the stored gaps, so counting inside the stored gaps at read
time would undercount. Copy `O1_GAPS` and `O2_GAPS` from the saved `before` CSV's `gaps_param` column
and `O1_DIGEST` and `O2_DIGEST` from its `ord_digest` column (ordinals 1 and 2, the same CSV). The form
refuses a malformed value (anything that is not `from:to` islands joined by `+`, or `none`, or a range
that ends before it starts, or a digest that is not 32 lowercase hex), and it refuses when ordinal 1 or 2
no longer names the strategy whose digest was given, so a shifted ordinal cannot produce a readback
for another strategy.

<!-- form: after -->
```sql
DO $chk$
DECLARE
  p text;
  e text;
BEGIN
  IF __O1_DIGEST__ !~ '^[0-9a-f]{32}$' OR __O2_DIGEST__ !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'after: O1_DIGEST and O2_DIGEST must be the 32-hex ord_digest values of the saved before CSV; refusing';
  END IF;
  IF (WITH __OKX_UNIVERSE__ SELECT md5(ou.strategy_id::text) FROM ou WHERE ou.ord = 1) IS DISTINCT FROM __O1_DIGEST__
     OR (WITH __OKX_UNIVERSE__ SELECT md5(ou.strategy_id::text) FROM ou WHERE ou.ord = 2) IS DISTINCT FROM __O2_DIGEST__ THEN
    RAISE EXCEPTION 'after: ordinal 1 or 2 no longer names the strategy the before CSV described (ord_digest mismatch); re-read ordinals and before; refusing';
  END IF;
  FOREACH p IN ARRAY ARRAY[__O1_GAPS__, __O2_GAPS__] LOOP
    IF p <> 'none' THEN
      IF p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}(\+[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2})*$' THEN
        RAISE EXCEPTION 'after: O1_GAPS and O2_GAPS must be from:to islands joined by +, or none; refusing';
      END IF;
      FOREACH e IN ARRAY string_to_array(p, '+') LOOP
        IF split_part(e, ':', 1)::date > split_part(e, ':', 2)::date THEN
          RAISE EXCEPTION 'after: a gap island ends before it starts; refusing';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$chk$;
WITH __OKX_PROV__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod),
old AS (
  SELECT 1 AS ord, __O1_GAPS__ AS p
  UNION ALL
  SELECT 2, __O2_GAPS__
),
oi AS (
  SELECT old.ord, split_part(e, ':', 1)::date AS d_from, split_part(e, ':', 2)::date AS d_to
    FROM old
   CROSS JOIN LATERAL unnest(string_to_array(old.p, '+')) AS e
   WHERE old.p <> 'none'
)
SELECT m.marker_is_prod, pv.ord AS ordinal, pv.status,
       (SELECT count(*) FROM csv_daily_returns c WHERE c.strategy_id = pv.strategy_id) AS csv_rows_total,
       (SELECT count(*) FROM csv_daily_returns c
         WHERE c.strategy_id = pv.strategy_id
           AND EXISTS (SELECT 1 FROM oi WHERE oi.ord = pv.ord AND c.date BETWEEN oi.d_from AND oi.d_to)) AS rows_in_old_gaps,
       jsonb_array_length(pv.gaps) AS unrecovered_gaps_n,
       coalesce((SELECT string_agg((g ->> 'from') || ':' || (g ->> 'to'), '+' ORDER BY g ->> 'from') FROM jsonb_array_elements(pv.gaps) g), 'none') AS gaps_param,
       jsonb_array_length(pv.recon) AS reconstructed_ranges_n,
       coalesce((SELECT string_agg((g ->> 'from') || ':' || (g ->> 'to'), '+' ORDER BY g ->> 'from') FROM jsonb_array_elements(pv.recon) g), 'none') AS reconstructed_dates,
       jsonb_array_length(pv.legacy) AS legacy_ranges_n,
       pv.headline_since,
       pv.series_provenance::text AS series_provenance
  FROM m
  LEFT JOIN pv ON true
 ORDER BY pv.ord;
```

```bash
node "$TS_SP/form.mjs" after O1_GAPS=<before-gaps_param-of-1> O2_GAPS=<before-gaps_param-of-2> \
  O1_DIGEST=<before-ord_digest-of-1> O2_DIGEST=<before-ord_digest-of-2> DRY=1 > "$TS_SP/a.sql" \
  && q "$TS_SP/a.sql" > "$TS_SP/after-$(date -u +%Y%m%dT%H%M%SZ).csv"
```

**Expected, per rebuilt ordinal (1 and 2):** `rows_in_old_gaps` (after) minus `rows_in_stored_gaps` (before) equals
the job result's `strategies[].insert_days`; `reconstructed_ranges_n` rose by the number of
`insert_ranges`; `unrecovered_gaps_n` and `gaps_param` equal the result's `gaps_after` (a day nothing
covered stays named, never 0.0, never interpolated); `legacy_ranges_n` and the other ordinals'
`csv_rows_total` are unchanged (ordinals 3 and 4 and `legacy_ranges` are never touched, D-01 / D-02).
`headline_since` does NOT move until the next analytics compute: that is Step 5.

**4e. `survival`.** Per ordinal, the number of days inside `reconstructed_ranges` that have no
`csv_daily_returns` row. Expected 0 for every ordinal. It is the check that a rebuilt day was not lost,
and it is run again after the next 04:30Z tick (Step 5).

<!-- form: survival -->
```sql
WITH __OKX_PROV__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, pv.ord AS ordinal,
       jsonb_array_length(pv.recon) AS reconstructed_ranges_n,
       (SELECT coalesce(sum((r ->> 'to')::date - (r ->> 'from')::date + 1), 0)
          FROM jsonb_array_elements(pv.recon) r) AS days_in_ranges,
       (SELECT count(*)
          FROM jsonb_array_elements(pv.recon) r
         CROSS JOIN LATERAL generate_series(0, (r ->> 'to')::date - (r ->> 'from')::date) AS n
         WHERE NOT EXISTS (SELECT 1 FROM csv_daily_returns c
                            WHERE c.strategy_id = pv.strategy_id AND c.date = (r ->> 'from')::date + n)) AS days_without_row
  FROM m
  LEFT JOIN pv ON true
 ORDER BY pv.ord;
```

```bash
node "$TS_SP/form.mjs" survival DRY=1 > "$TS_SP/sv.sql" && q "$TS_SP/sv.sql" > "$TS_SP/survival-$(date -u +%Y%m%dT%H%M%SZ).csv"
```

## Step 5 — Wave 5 hand-off and read-backs

The recompute that moves each `headline_since` is not run by this runbook and the job never enqueues
analytics. The rebuilt rows are recomputed by the next 04:30Z tick's derive-then-compute chain
regardless, and by the Wave 5 consolidated recompute when it runs first. The hand-off is booked as
`167.1.2.2.2.1-WAVE5-RECOMPUTE` in `TODOS.md`, with its Owner, trigger (the apply job `done` and the
analytics service deployed) and acceptance reading.

After the recompute (or the next tick), read back, per ordinal 1 and 2:

1. `worklist`: `headline_since` has moved earlier (ordinal 2 from 2026-08-02 toward 2026-02-23, ordinal 1
   toward about 2026-05-24), `unrecovered_gaps` is what the apply result's `gaps_after` said, and
   `reconstructed_ranges` is present.
2. `survival`: `days_without_row` 0 for every ordinal. A live derive upserts by date and never deletes
   an archive day, so a non-zero here is a defect to return to the founder, not noise.
3. The public line: the factsheet names each `reconstructed_ranges` entry once (D-06), shown to everyone,
   and the chart is not marked.

**`reconstructed_ranges` can over-claim a day.** If a later live derive overwrites a rebuilt day (live
wins, D-12), that day keeps its row, now live-derived, and `survival` still reads 0, so the public line
may name a day whose stored value is the live one. This is accepted: the range records what was rebuilt,
not who owns a day today. A day the archive never covered is never named as rebuilt.

## Rollback

**A founder decision only.** Apply is atomic per strategy, a stop writes nothing, and the job never
undoes anything, so a rollback is for the case where the founder reverses the rebuild after it applied.

`rollback` takes the ordinal, that ordinal's `before` `gaps_param` value and its `before` `ord_digest`
value (`ORD`, `GAPS`, `DIGEST`). Ordinals are `row_number()` over status then id, not ids, so between
`before` and a rollback an ordinal can come to name another strategy; the form therefore refuses, in SQL
and before any write, a `DIGEST` that is not 32 lowercase hex or that is not `md5(strategy_id::text)` of
the strategy `ORD` names NOW, and an `ORD` that names no strategy at all. For that
one strategy it, in a single statement: deletes the `csv_daily_returns` rows inside the strategy's
`okx_bills_history_archive` ranges, removes only those range entries from `reconstructed_ranges`, and
sets `unrecovered_gaps` back to `GAPS`. It touches no other strategy, no other key and no
`legacy_ranges`. It refuses (in SQL, before writing) a `GAPS` that is not `from:to` islands joined by `+`
(or `none`), a digest mismatch, and an ordinal with no archive range to roll back. Run it only after reading `before` and
`after`; the saved `before` CSV's `series_provenance` column is the reference the post-rollback reading
is compared against.

<!-- form: rollback -->
```sql
__GUARD__
DO $rb$
DECLARE
  e text;
BEGIN
  IF __DIGEST__ !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'rollback: DIGEST must be the 32-hex ord_digest of the saved before CSV row for this ordinal; refusing';
  END IF;
  IF (WITH __OKX_UNIVERSE__ SELECT md5(ou.strategy_id::text) FROM ou WHERE ou.ord = __ORD__::int) IS DISTINCT FROM __DIGEST__ THEN
    RAISE EXCEPTION 'rollback: that ordinal no longer names the strategy the before CSV described (ord_digest mismatch); re-read ordinals and before; refusing';
  END IF;
  IF __GAPS__ <> 'none' THEN
    IF __GAPS__ !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}(\+[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2})*$' THEN
      RAISE EXCEPTION 'rollback: GAPS must be from:to islands joined by +, or none; refusing';
    END IF;
    FOREACH e IN ARRAY string_to_array(__GAPS__, '+') LOOP
      IF split_part(e, ':', 1)::date > split_part(e, ':', 2)::date THEN
        RAISE EXCEPTION 'rollback: a gap island ends before it starts; refusing';
      END IF;
    END LOOP;
  END IF;
  IF NOT EXISTS (
    WITH __OKX_PROV__
    SELECT 1 FROM pv, jsonb_array_elements(pv.recon) r
     WHERE pv.ord = __ORD__::int AND r ->> 'source' = 'okx_bills_history_archive'
  ) THEN
    RAISE EXCEPTION 'rollback: that ordinal has no okx_bills_history_archive range; nothing to roll back';
  END IF;
END
$rb$;
WITH __OKX_UNIVERSE__, -- WRITE
tgt AS ( -- WRITE
  SELECT ou.strategy_id FROM ou WHERE ou.ord = __ORD__::int -- WRITE
), -- WRITE
rng AS ( -- WRITE
  SELECT tgt.strategy_id, (x ->> 'from')::date AS d_from, (x ->> 'to')::date AS d_to -- WRITE
    FROM tgt -- WRITE
    JOIN strategy_analytics a ON a.strategy_id = tgt.strategy_id -- WRITE
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.series_provenance -> 'reconstructed_ranges') = 'array' THEN a.series_provenance -> 'reconstructed_ranges' ELSE '[]'::jsonb END) AS x -- WRITE
   WHERE x ->> 'source' = 'okx_bills_history_archive' -- WRITE
), -- WRITE
del AS ( -- WRITE
  DELETE FROM csv_daily_returns c USING rng -- WRITE
   WHERE c.strategy_id = rng.strategy_id AND c.date BETWEEN rng.d_from AND rng.d_to -- WRITE
  RETURNING c.date -- WRITE
) -- WRITE
UPDATE strategy_analytics a -- WRITE
   SET series_provenance = jsonb_set( -- WRITE
         jsonb_set(a.series_provenance, '{reconstructed_ranges}', -- WRITE
           coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.series_provenance -> 'reconstructed_ranges') = 'array' THEN a.series_provenance -> 'reconstructed_ranges' ELSE '[]'::jsonb END) AS r WHERE r ->> 'source' IS DISTINCT FROM 'okx_bills_history_archive'), '[]'::jsonb), true), -- WRITE
         '{unrecovered_gaps}', -- WRITE
         coalesce((SELECT jsonb_agg(jsonb_build_object('from', split_part(e, ':', 1), 'to', split_part(e, ':', 2), 'recorded_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) ORDER BY split_part(e, ':', 1)) FROM unnest(string_to_array(__GAPS__, '+')) AS e WHERE __GAPS__ <> 'none'), '[]'::jsonb), true) -- WRITE
  FROM tgt -- WRITE
 WHERE a.strategy_id = tgt.strategy_id AND a.series_provenance IS NOT NULL; -- WRITE
WITH __OKX_PROV__,
m AS (SELECT __MARKER_IS_PROD__ AS marker_is_prod)
SELECT m.marker_is_prod, pv.ord AS ordinal,
       (SELECT count(*) FROM csv_daily_returns c WHERE c.strategy_id = pv.strategy_id) AS csv_rows_after,
       jsonb_array_length(pv.gaps) AS unrecovered_gaps_n,
       coalesce((SELECT string_agg((g ->> 'from') || ':' || (g ->> 'to'), '+' ORDER BY g ->> 'from') FROM jsonb_array_elements(pv.gaps) g), 'none') AS gaps_param,
       jsonb_array_length(pv.recon) AS reconstructed_ranges_n,
       pv.headline_since,
       pv.series_provenance::text AS series_provenance
  FROM m
  LEFT JOIN pv ON pv.ord = __ORD__::int
 ORDER BY pv.ord;
```

```bash
node "$TS_SP/form.mjs" rollback ORD=1 GAPS=<before-gaps_param-of-1> DIGEST=<before-ord_digest-of-1> > "$TS_SP/rb.sql" && q "$TS_SP/rb.sql" > "$TS_SP/rollback-$(date -u +%Y%m%dT%H%M%SZ).csv"
```

Expected readback: `reconstructed_ranges_n` back to its `before` value, `gaps_param` equal to the `before`
`gaps_param`, `csv_rows_after` equal to the `before` `csv_rows_total`. Then run `survival` (expected 0
everywhere) and `before` once more and compare the `series_provenance` column with the saved `before`
copy: it differs only in the `recorded_at` stamps of the restored gaps (re-stamped at the rollback) and,
if the key was absent before the apply, an empty `reconstructed_ranges` array in its place.

- **Caveat on a live-overwritten day.** The delete covers the recorded archive ranges, so a day inside a
  range that a later live derive overwrote (the over-claim above) is deleted with the range. The next
  derive re-creates it if the venue still serves that day. Read `before` and `after` first and decide
  case by case.
- **Data is kept otherwise.** Nothing else is removed: the job's own `compute_jobs` rows, the live-derived
  series and every other strategy stay as they were.
- **Re-applying after a rollback** needs a fresh `calibrate` and a fresh founder-approved fingerprint:
  the stored gaps are the compare-and-set input, so a stale fingerprint cannot apply.

## What this runbook does not cover

- **Automatic triggering (D-04).** There is no cron and no onboarding hook. A new OKX key onboarded later
  is rebuilt only by a reviewed edit of these forms (the ordinals, the quarters) and a founder go.
- **The carried-forward `legacy_ranges` and ordinal 4's stored January-April daily P&L (D-01).** They are
  not replaced and not extended into a series. Deferred.
- **Any fix to ordinal 4's June or July 0.0 days (D-03).** The check is read-only; if it finds realized
  P&L the dates and both figures are reported and any fix is a separate founder decision.
- **The live-path defects.** `[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]` (the live aggregation sums every
  currency at face value; the `calibrate` census is its measurement) and
  `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]` (the live page cap; the reconciliation's archive-only day
  inside live reach is its detector) stay open in `TODOS.md`. This runbook fixes neither.
- **Running the recompute.** Step 5 books and reads it; the Wave 5 consolidated recompute runs it.
- **A page when the job fails.** No human is paged. A stuck or failed job is seen only by reading
  `job-result`; the compute-jobs admin table shows the same row.
