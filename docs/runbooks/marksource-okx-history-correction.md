# Runbook — OKX history correction (Phase 167.2.1.1.1.1 MARKSOURCE, D-05)

**Owner:** the orchestrator runs the live steps under the standing PROD authorization and tells
the founder what was written · **Audience:** whoever rebuilds an OKX-holding allocator's stored
history, months from now, with no memory of this phase · **Risk:** a forced rebuild replaces the
last 90 days of stored `allocator_equity_snapshots` rows for every account it touches. It is
one-way through the product path (see "Rollback"). A rebuild that is refused writes nothing.

## What this corrects

The daily allocator equity refresh adds each OKX derivative's open profit to the account total
(`total += upnl` in `run_refresh_allocator_equity_daily_job`, in force since 2026-04-24), while
the holdings poll used to store the OKX USDT row from ccxt's per-currency total, which OKX
reports as `eq` and which already contains open profit. So every refresh row since then counts
an OKX allocator's open profit twice, and so does every `allocator_holdings` USDT history row.
The forward fix (`_extract_okx_cash_balances` in `analytics-service/services/allocator_positions.py`)
makes the poll read `cashBal`, so no new row carries it. This runbook corrects the rows already
stored, through the one recompute path the product has: the forced whole-account rebuild
(`reconstruct_allocator_history` with metadata `force_rebuild: true`), which anchors every
exchange account on its live balance total (OKX: `eq`, once) and replaces the last 90 days
(`OKX_TRADE_TERMINUS_DAYS`) in one transaction (`replace_allocator_equity_snapshots_window`),
keeping every older row byte for byte and recording the seam.

**What it cannot reach is KEPT and NAMED** in the last section: refresh rows older than the
90-day window, every `allocator_holdings` history row, and any scenario-commit audit size.

## Where this stands (CONTEXT D-09, founder 2026-10-27)

CONTEXT D-05 asked for the stored past rows to be corrected through the product's own recompute
path, measured read-only on PROD first, with a before and after census. D-09 then ruled, after
the census: "The stored-row rewrite of D-05 waits on the OKX ordering gate
(`167.2.1.1.2.1-OKX-ORDER-UNMEASURED`): this phase ships the forward fix and records the rewrite
as a deferral; a booked follow-up phase measures the gate with a founder-approved worker probe
and then rebuilds the 90-day window."

So this runbook is the procedure the follow-up phase runs. Until the ordering gate reads measured
with 0 violations, pre-flight P4 is a write STOP: the read-only steps (P0 to P3, P5, P6, B'1,
B'2) run and are recorded, and nothing from B'3a on runs. A follow-up session re-runs every
pre-flight and every census fresh: readings from an earlier session are claims, not inputs.

## Which database am I on? (FIRST, every session)

`CLAUDE.md` ("Which database am I on?") is the rule. The Supabase CLI in the main checkout is
linked to PRODUCTION and `current_database()` is `postgres` on both projects, so only the
database's own comment tells them apart.

- Run the `marker` form as its own call and record that it names PRODUCTION (the text is public
  in `scripts/prod-prober/cron-manifest.json` and is not repeated here). A NULL means the label
  was lost: re-set it before writing, never proceed on a guess.
- **The CLI returns only the LAST statement's rows.** So every read form below carries
  `marker_is_prod` as its first output column (1 only when the database's own comment equals the
  manifest's `database_marker`, else 0, and a NULL comment reads 0), and the one write form
  starts with a `DO $guard$` block that RAISES unless the marker names PRODUCTION.
- **Never hand-type the marker.** The renderer reads `database_marker` from the manifest.
- The committed census files in `docs/runbooks/marksource-okx-census/` carry no marker column:
  run the `marker` form as its own call immediately before them, in the same session.
- Always `grep -a`. Tracked text is counts-only: no key id, owner id, email, hostname, project
  ref, amount or home path. Accounts are `a1`, `a2`, ... (the census files' a-labels, ordered by
  each allocator's earliest OKX key, so a before and an after run agree). Columns ending `_usd`
  and the whole `okx-snapshot-rows.sql` output carry amounts: they stay in the scratch directory
  and are deleted after use.

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export MS_SP="${MS_SP:-$HOME/.cache/quantalyze/marksource-167.2.1.1.1.1}"; mkdir -p "$MS_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link exists only there and it targets
  PRODUCTION. If `--workdir` is refused, run the same command with the main checkout as the
  current directory. Pass census files by absolute path (`"$PWD/docs/runbooks/..."`).
- `MS_SP` is a scratch directory outside the repo. Every SQL file and CSV lives there.

The renderer extracts a named SQL form from this file, so what is run is what is written here.
It substitutes four placeholders and refuses (exit 2, nothing printed) when a placeholder in
the form has no valid value:

| Placeholder | Source | Validated as | Rendered as |
|---|---|---|---|
| `__MARKER__` | `database_marker` in `scripts/prod-prober/cron-manifest.json` | a string of 20 or more characters without `$m$` | dollar-quoted `$m$...$m$` |
| `__LABELS__` | env `MS_LABELS` | `^[1-9][0-9]*(,[1-9][0-9]*)*$` | `ARRAY[1,2]::bigint[]` |
| `__T0__` | env `MS_T0` | an ISO UTC instant ending in `Z`, a real calendar date | `'...'::timestamptz` |
| `__DEPLOYED_AT__` | env `MS_DEPLOYED_AT` | the same | `'...'::timestamptz` |

```bash
cat > "$MS_SP/form.mjs" <<'JS'
import fs from "node:fs";
const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name>");
const md = fs.readFileSync("docs/runbooks/marksource-okx-history-correction.md", "utf8");
const m = md.match(new RegExp("<!-- form: " + name + " -->\\n```sql\\n([\\s\\S]*?)\\n```"));
if (!m) fail("no form named " + name);
let sql = m[1];
const uses = (ph) => sql.includes(ph);
if (uses("__MARKER__")) {
  const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
  if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) fail("__MARKER__: database_marker unusable");
  sql = sql.split("__MARKER__").join("$m$" + marker + "$m$");
}
if (uses("__LABELS__")) {
  const v = process.env.MS_LABELS;
  if (typeof v !== "string" || !/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(v)) fail("__LABELS__: set MS_LABELS to comma-separated positive integers such as 1,2");
  sql = sql.split("__LABELS__").join("ARRAY[" + v + "]::bigint[]");
}
const instant = (ph, envName) => {
  if (!uses(ph)) return;
  const v = process.env[envName];
  const ok = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)
    && !Number.isNaN(Date.parse(v)) && new Date(Date.parse(v)).toISOString().slice(0, 19) === v.slice(0, 19);
  if (!ok) fail(ph + ": set " + envName + " to an ISO UTC instant such as 2026-01-31T20:00:00Z");
  sql = sql.split(ph).join("'" + v + "'::timestamptz");
};
instant("__T0__", "MS_T0");
instant("__DEPLOYED_AT__", "MS_DEPLOYED_AT");
const left = sql.match(/__[A-Z0-9_]+__/);
if (left) fail("unresolved placeholder " + left[0]);
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$MS_SP/form.mjs" <form-name> > "$MS_SP/<name>.sql"`, then
`q "$MS_SP/<name>.sql" > "$MS_SP/<name>.csv"`. `MS_LABELS`, `MS_T0` and `MS_DEPLOYED_AT` are
exported by hand from readings the steps below produce.

The plain marker read, run as its own call and recorded before anything else:

<!-- form: marker -->
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

Each OKX account's working OKX keys, and how many of them have a spot holdings row written after
the forward fix was deployed (`__DEPLOYED_AT__`):

<!-- form: pollafter -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
okx_key AS (
  SELECT a.label_no,
         k.id,
         (k.is_active
            AND k.disconnected_at IS NULL
            AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))) AS working
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
   WHERE lower(k.exchange) = 'okx'
     AND a.label_no = ANY(__LABELS__)
),
polled AS (
  SELECT DISTINCT h.api_key_id
    FROM public.allocator_holdings h
   WHERE h.holding_type = 'spot'
     AND lower(h.venue) = 'okx'
     AND h.updated_at > __DEPLOYED_AT__
)
SELECT m.marker_is_prod,
       'a' || o.label_no AS account_label,
       count(*) FILTER (WHERE o.working) AS okx_working_keys,
       count(*) FILTER (WHERE o.working AND p.api_key_id IS NOT NULL) AS okx_working_keys_polled_after_deploy
  FROM m
 CROSS JOIN okx_key o
  LEFT JOIN polled p ON p.api_key_id = o.id
 GROUP BY m.marker_is_prod, o.label_no
 ORDER BY o.label_no;
```

Whether the window-replace function exists and who may run it:

<!-- form: rebuildfn -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod,
       f.function_count,
       f.service_role_execute,
       f.anon_execute,
       f.authenticated_execute
  FROM m
 CROSS JOIN (
   SELECT count(*) AS function_count,
          coalesce(bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')), false) AS service_role_execute,
          coalesce(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), false) AS anon_execute,
          coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')), false) AS authenticated_execute
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'replace_allocator_equity_snapshots_window'
 ) f;
```

The database clock and the reconstruct jobs open on every key of the chosen accounts (all
exchanges, not only OKX). `t0` is printed as an ISO UTC instant so it can be exported as
`MS_T0` unchanged:

<!-- form: inflight -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
account_key AS (
  SELECT a.label_no,
         k.id
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
   WHERE a.label_no = ANY(__LABELS__)
)
SELECT m.marker_is_prod,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t0,
       (SELECT count(*)
          FROM public.compute_jobs j
          JOIN account_key ak ON ak.id = j.api_key_id
         WHERE j.kind = 'reconstruct_allocator_history'
           AND j.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')) AS reconstruct_jobs_in_flight,
       (SELECT count(DISTINCT ak.label_no) FROM account_key ak) AS accounts_selected
  FROM m;
```

## The committed census files

Four read-only files in `docs/runbooks/marksource-okx-census/` (each ONE statement, run with `q`
by absolute path, output to `MS_SP` only; its README says what each column means) carry the
measurement. They are run by name in the steps below:

| File | Used in | What it gives |
|---|---|---|
| `okx-rebuild-feasibility.sql` | B'1 | per a-label: keys by venue and working state, the predicted 90-day window, days already written in bulk, whether a seam row exists, jobs in flight |
| `okx-snapshot-census.sql` | B'1 and B'6 | per a-label: snapshot days, the days the double count is suspected on, split by the 90-day window, and the size of the overcount as ratios |
| `okx-holdings-census.sql` | B'1 and B'6 | the same question for the `allocator_holdings` USDT row, which no product path can rewrite |
| `okx-snapshot-rows.sql` | B'2 and B'6 | the row set for the before and after diff; carries amounts, scratch only |

`marker.sql` in the same directory is the `marker` form as a file.

## Pre-flight — ALL BLOCKING, P4 is a write STOP

Any item that does not return its expected answer is an ABORT (do not go on), except P4, which is
a STOP on the write sequence only. Record each answer as a count, a boolean or a public SHA.

- **P0 — which database is this? (FIRST, every session).** Run the `marker` form as its own call.
  **Abort if** it names anything else or comes back NULL.
- **P1 — the forward fix and the rebuild code are deployed.** Read the git SHA of every analytics
  worker service from the platform's deployment record (the plan 10 census recorded two, a
  backfill service and an interactive one). Never `railway ssh`: TRADEPAGES found it broken.
  Then, in this checkout, for each SHA:
  `git grep -n -F '_extract_okx_cash_balances' <sha> -- analytics-service/services/allocator_positions.py`
  and
  `git grep -n -F 'FORCED_REBUILD_REFUSAL_REASONS' <sha> -- analytics-service/services/equity_reconstruction.py`
  must each print a hit. Record the SHAs (public). **Abort if** either is missing on any service
  or a SHA cannot be read.
- **P2 — every working OKX key has been polled by the fixed worker (`pollafter`).** Export
  `MS_LABELS` as every a-label (`1,2,...`, from the census), and `MS_DEPLOYED_AT` as the instant
  the deployment from P1 went live (the platform record, in UTC). Expected: for every a-label,
  `okx_working_keys_polled_after_deploy` equals `okx_working_keys`, and at least one row. **Abort
  if** any key was not polled since: the next refresh would write a double-counted row on top of
  the rebuilt window (RESEARCH "Ordering"). Wait for the daily poll; never enqueue a poll by hand.
- **P3 — the window-replace function exists and only the service role may run it (`rebuildfn`).**
  Expected: `function_count` 1, `service_role_execute` true, `anon_execute` false,
  `authenticated_execute` false. **Abort if** not.
- **P4 — the TRADEPAGES gates, read from TODOS on main.**
  `git fetch origin main`, then
  `git show origin/main:TODOS.md | grep -a '^### 167.2.1.1.2.1-OKX-ORDER-UNMEASURED'` and the
  same for `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`. A heading that ends with `CLOSED <date>)` is
  closed; a heading without it is open. Record both readings.
  - `167.2.1.1.2.1-OKX-ORDER-UNMEASURED`: "Until it is measured, no OKX-holding account may be
    rebuilt." It closes when `okx_order_readings` equals the number of OKX members that read
    trades and violations are 0 (the allocator history probe,
    `analytics-service/scripts/allocator_history_probe.py`, prints both). While it is open,
    **STOP here means no write until the founder rules at plan 14 Task 2.** The read-only
    steps still run and are recorded: P5, P6, B'1 and B'2. B'3a onward (the in-flight check, the
    guarded `enqueue` and everything after it) does not run before the ruling, and a rebuild runs
    only once the gate reads measured with 0 violations.
  - `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`: one OKX account (named there by the probe's own
    label, which is not an a-label: map it by what the entry says, one OKX member and a 90-day
    window, against B'1's `okx_working` and `keys_total`) is refused `anchor_skipped_implausible`.
    Predict that token for it in B'1. If it cannot be mapped with certainty, record "unmapped" and
    let B'5 decide; the token is record-only there.
- **P5 — no reconstruct job is in flight (`inflight`).** Export `MS_LABELS` as the chosen
  a-labels. Expected: `reconstruct_jobs_in_flight` 0. **Abort if** it is above 0: wait for the
  jobs to end, never cancel one.
- **P6 — the clock.** Read `t0` from the `inflight` output: it is the database's UTC time. **Abort
  if** it is within 30 minutes of 00:00Z on either side: a job that crosses midnight mid-crawl
  refuses `anchor_skipped_okx_terminus`. Run late in the UTC day: the rebuild's last row is a live
  read labelled today, so the closer to the close, the closer it is to that day's close.

## B'1 — census and prediction (read-only, counts only)

Run the `marker` form as its own call, then each of the three census files (by absolute path),
output to `MS_SP`:

```bash
q "$PWD/docs/runbooks/marksource-okx-census/okx-rebuild-feasibility.sql" > "$MS_SP/b1-feasibility.csv"
q "$PWD/docs/runbooks/marksource-okx-census/okx-snapshot-census.sql"      > "$MS_SP/b1-snapshot.csv"
q "$PWD/docs/runbooks/marksource-okx-census/okx-holdings-census.sql"      > "$MS_SP/b1-holdings.csv"
```

**Choose `MS_LABELS`.** The post-deploy tail is the set of suspect days whose refresh row was
written from a poll that already reads `cashBal` (P2 proves every working OKX key was polled
that way). The census heuristic cannot tell them apart: it flags any refresh day whose holdings
carry a non-zero OKX derivative profit, correct or not. Compute the tail from `last_suspect_asof`
and the date of the first post-deploy refresh (the refresh runs after the poll and labels the day
that just closed): it is the number of calendar days from the first post-deploy refresh label to
`last_suspect_asof`, an upper bound. Record both dates and the tail. `MS_LABELS` is every a-label
whose `suspect_days_in_window` is above the tail. Choose by suspect days, never by predicted
outcome: a refusal writes nothing, and its token is the record. An account with
`snapshot_days` 0 has nothing to correct, and one whose `in_window_days_written_in_bulk` covers
its window may already have been rebuilt: both read `suspect_days_in_window` 0 and are left out.

**Predict each chosen account's outcome by the code's rules** and record the prediction per
a-label (all from the feasibility file's columns, plus P4):

- `keys_on_a_venue_the_rebuild_refuses` above 0: `account_key_venue_unsupported`
  (`_ACCOUNT_REBUILD_VENUES` is bybit, binance, mt5, okx; Deribit counts as $0).
- An exchange account with no working key: `account_key_not_working`.
- `working_keys_with_unknown_account` above 1: look closer (the file does not split it by
  exchange). Two or more unstamped working keys on one of bybit, binance or okx:
  `account_identity_pending`.
- The account `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` names (P4): `anchor_skipped_implausible`.
- Otherwise: rebuildable unless a venue-read refusal or `history_days_unreproduced`, which depends
  on the replay and cannot be predicted from the database.
- Predicted window: `predicted_window_days` (90, the OKX window). A seam row is expected iff
  `days_before_the_90_day_window` is above 0. `keys_total` is the key count B'5 compares with
  `account_key_count`.

## B'2 — before (read-only, scratch only, amounts)

```bash
q "$PWD/docs/runbooks/marksource-okx-census/okx-snapshot-rows.sql" > "$MS_SP/b2-rows-before.csv"
```

Keep it in `MS_SP`. Nothing from it is written into a tracked file.

## B'3a — in-flight pre-check (first step that is not run while P4 is a STOP)

Export `MS_LABELS`, render and run `inflight`. Expected: `reconstruct_jobs_in_flight` 0. If it is
above 0, wait for the jobs to end (never cancel one) and run it again. Export the `t0` of the run
that read 0 as `MS_T0` and keep it in `MS_SP`.

## B'3b — the one write: ONE forced reconstruct per chosen account

Re-read the latest `enqueue_compute_job` definition first (the newest `CREATE OR REPLACE` across
`supabase/migrations/` and `supabase/schema/baseline.sql`): the form calls it with named
parameters, and a changed signature must fail here, not on PROD.

The `DO $guard$` block refuses unless the database names PRODUCTION, and the statement after it
calls only `public.enqueue_compute_job`. The job key of each a-label is chosen inside the SQL as
the allocator history probe chose it: the earliest-created working Bybit key, else the earliest-
created working OKX key. The statement skips an account that already has a reconstruct job open
or created at or after `MS_T0`, so a retry after an ambiguous CLI error can never queue a second
forced job (two would race the same window replace). It prints `marker_is_prod`, the accounts it
targeted and the ids it got back, nothing else.

<!-- form: enqueue -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
END
$guard$;
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
job_key AS (
  SELECT DISTINCT ON (k.user_id)
         a.label_no,
         k.id AS api_key_id
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
   WHERE a.label_no = ANY(__LABELS__)
     AND k.is_active
     AND k.disconnected_at IS NULL
     AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))
     AND lower(k.exchange) IN ('bybit', 'okx')
     AND NOT EXISTS (
       SELECT 1
         FROM public.compute_jobs c
         JOIN public.api_keys ck ON ck.id = c.api_key_id
        WHERE ck.user_id = k.user_id
          AND c.kind = 'reconstruct_allocator_history'
          AND (c.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
               OR c.created_at >= __T0__)
     )
   ORDER BY k.user_id, CASE lower(k.exchange) WHEN 'bybit' THEN 0 ELSE 1 END, k.created_at, k.id
),
enq AS (
  SELECT j.label_no,
         public.enqueue_compute_job(
           p_strategy_id := NULL,
           p_kind := 'reconstruct_allocator_history',
           p_api_key_id := j.api_key_id,
           p_metadata := jsonb_build_object('force_rebuild', true)
         ) AS job_id
    FROM job_key j
)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM job_key) AS accounts_targeted,
       (SELECT count(e.job_id) FROM enq e) AS jobs_returned
  FROM m;
```

- **Expected:** `marker_is_prod` 1 and `accounts_targeted` equal to `jobs_returned`. Fewer
  targeted accounts than labels means an account has no working Bybit or OKX key (or a job open):
  B'3c names which. An exception from the guard means the database did not name PRODUCTION:
  nothing was written.
- A returned id is not proof of a new job (`_enqueue_compute_job_internal` returns an existing
  open job's id for the same target and kind): B'3c is the proof.
- A `serialization_failure` is a lost race. Re-run B'3a for a fresh `t0`, then B'3b.
- The flag literal is `force_rebuild`, pinned in the worker by
  `test_force_rebuild_key_spelling_is_the_handoff_literal`.
- **Never a second forced job for the same account in one attempt.**

## B'3c — new-job proof (read-only, right after B'3b)

Per a-label: does a `reconstruct_allocator_history` row exist for its job key with
`created_at >= MS_T0` and `metadata -> 'force_rebuild' = 'true'::jsonb`?

<!-- form: newjob -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
job_key AS (
  SELECT DISTINCT ON (k.user_id)
         a.label_no,
         k.id AS api_key_id
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
   WHERE a.label_no = ANY(__LABELS__)
     AND k.is_active
     AND k.disconnected_at IS NULL
     AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))
     AND lower(k.exchange) IN ('bybit', 'okx')
   ORDER BY k.user_id, CASE lower(k.exchange) WHEN 'bybit' THEN 0 ELSE 1 END, k.created_at, k.id
)
SELECT m.marker_is_prod,
       'a' || a.label_no AS account_label,
       (jk.api_key_id IS NOT NULL) AS job_key_found,
       count(c.id) AS forced_jobs_since_t0,
       (array_agg(c.status ORDER BY c.created_at DESC) FILTER (WHERE c.id IS NOT NULL))[1] AS latest_status,
       (array_agg(c.error_kind ORDER BY c.created_at DESC) FILTER (WHERE c.id IS NOT NULL))[1] AS latest_error_kind,
       (array_agg(c.attempts ORDER BY c.created_at DESC) FILTER (WHERE c.id IS NOT NULL))[1] AS latest_attempts
  FROM m
 CROSS JOIN okx_account a
  LEFT JOIN job_key jk ON jk.label_no = a.label_no
  LEFT JOIN public.compute_jobs c
    ON c.api_key_id = jk.api_key_id
   AND c.kind = 'reconstruct_allocator_history'
   AND c.created_at >= __T0__
   AND c.metadata -> 'force_rebuild' = 'true'::jsonb
 WHERE a.label_no = ANY(__LABELS__)
 GROUP BY m.marker_is_prod, a.label_no, jk.api_key_id
 ORDER BY a.label_no;
```

An account with `forced_jobs_since_t0` 0 was absorbed by an existing open job (or has no job
key): wait for it to end, then repeat B'3a to B'3c for that account only. Never enqueue a second
forced job by hand outside that loop.

## B'4 — wait

Re-run `newjob` until every enqueued job's `latest_status` is `done` or `failed_final`. A forced
job may be DEFERRED by an exchange cooldown on ANY key of its account: it returns to `pending`
and is claimed again, so keep waiting. `failed_retry` is the queue retrying it. A failed job is
recorded by `latest_error_kind`, never hand-fixed. If waiting stops while a job is not terminal,
that account's outcome is "not shown (job not terminal)".

## B'5 — after: what each account's audit says

Per a-label, the job key's audit after `MS_T0` (`audit_log`, `entity_type = 'api_key'`,
`entity_id` = that key). The FORCED START is the latest `allocator.equity.reconstruct_started`
row with `metadata -> 'forced_rebuild' = 'true'::jsonb`. The TERMINAL AUDIT is, after it, the
first `reconstruct_failed` whose `sanitized_message` starts with `forced rebuild refused (` if
one exists, else the first of `reconstruct_complete`, `reconstruct_failed`,
`reconstruct_no_data`, `reconstruct_partial_unsupported` or `reconstruct_unexpected_noop`.
Labels, booleans and counts only:

<!-- form: audit -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
job_key AS (
  SELECT DISTINCT ON (k.user_id)
         a.label_no,
         k.id AS api_key_id
    FROM public.api_keys k
    JOIN okx_account a ON a.allocator_id = k.user_id
   WHERE a.label_no = ANY(__LABELS__)
     AND k.is_active
     AND k.disconnected_at IS NULL
     AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))
     AND lower(k.exchange) IN ('bybit', 'okx')
   ORDER BY k.user_id, CASE lower(k.exchange) WHEN 'bybit' THEN 0 ELSE 1 END, k.created_at, k.id
)
SELECT m.marker_is_prod,
       'a' || a.label_no AS account_label,
       (fs.started_at IS NOT NULL) AS forced_start_present,
       replace(tm.action, 'allocator.equity.', '') AS terminal_kind,
       substring(tm.metadata ->> 'sanitized_message' FROM 'forced rebuild refused \(([a-z_]+)\)') AS refusal_token,
       tm.metadata ->> 'reason' AS completion_reason,
       coalesce(tm.metadata -> 'atomic_replace' = 'true'::jsonb, false) AS atomic_replace,
       coalesce(tm.metadata -> 'account_rebuild' = 'true'::jsonb, false) AS account_rebuild,
       coalesce(tm.metadata -> 'forced_rebuild' = 'true'::jsonb, false) AS forced_rebuild,
       CASE WHEN jsonb_typeof(tm.metadata -> 'account_key_count') = 'number' THEN (tm.metadata ->> 'account_key_count')::int END AS account_key_count,
       CASE WHEN jsonb_typeof(tm.metadata -> 'window_days') = 'number' THEN (tm.metadata ->> 'window_days')::int END AS window_days,
       coalesce(tm.metadata -> 'okx_terminus_hit' = 'true'::jsonb, false) AS okx_terminus_hit,
       coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(tm.metadata -> 'anchor_partial_ticker_symbols') = 'array' THEN tm.metadata -> 'anchor_partial_ticker_symbols' END), 0) > 0 AS partial_ticker_symbols_named,
       coalesce(tm.metadata -> 'anchor_offset_implausible' = 'true'::jsonb, false) AS anchor_offset_implausible,
       coalesce(tm.metadata -> 'anchor_replay_unreliable' = 'true'::jsonb, false) AS anchor_replay_unreliable,
       EXISTS (
         SELECT 1
           FROM public.allocator_equity_derived d
          WHERE d.allocator_id = a.allocator_id
            AND d.kind = 'snapshot_rebuild_boundary'
       ) AS snapshot_rebuild_boundary_present
  FROM m
 CROSS JOIN okx_account a
  LEFT JOIN job_key jk ON jk.label_no = a.label_no
  LEFT JOIN LATERAL (
    SELECT s.created_at AS started_at
      FROM public.audit_log s
     WHERE s.entity_type = 'api_key'
       AND s.entity_id = jk.api_key_id
       AND s.action = 'allocator.equity.reconstruct_started'
       AND s.created_at >= __T0__
       AND s.metadata -> 'forced_rebuild' = 'true'::jsonb
     ORDER BY s.created_at DESC
     LIMIT 1
  ) fs ON true
  LEFT JOIN LATERAL (
    SELECT t.action, t.metadata
      FROM public.audit_log t
     WHERE t.entity_type = 'api_key'
       AND t.entity_id = jk.api_key_id
       AND fs.started_at IS NOT NULL
       AND t.created_at >= fs.started_at
       AND t.action IN ('allocator.equity.reconstruct_complete', 'allocator.equity.reconstruct_failed', 'allocator.equity.reconstruct_no_data', 'allocator.equity.reconstruct_partial_unsupported', 'allocator.equity.reconstruct_unexpected_noop')
     ORDER BY (t.action = 'allocator.equity.reconstruct_failed' AND coalesce(t.metadata ->> 'sanitized_message', '') LIKE 'forced rebuild refused (%') DESC, t.created_at
     LIMIT 1
  ) tm ON true
 WHERE a.label_no = ANY(__LABELS__)
 ORDER BY a.label_no;
```

Re-run `newjob` as well at this point: rule (v) needs the job's final status. Then classify each
account by these rules, in order.

1. **No forced start:** not shown. Re-enqueue once through B'3a to B'3c; if still not shown,
   record "not shown" and ask the founder.
2. **`terminal_kind` `reconstruct_complete` with `completion_reason`
   `already_reconstructed_for_api_key`:** STOP and ask the founder (the flag did not reach the
   handler).
3. **A refusal (`refusal_token` present):** NOT recomputed. A refused account writes nothing and
   is recorded; it is never retried by hand beyond the one re-enqueue allowed below. Compare the
   token with B'1's prediction; a mismatch is recorded and the founder asked. The closed set is
   `FORCED_REBUILD_REFUSAL_REASONS`, 15 tokens, and a token outside it is a STOP (the deployed
   code is not the code this runbook was written for).
   - **Re-enqueue ONCE** (fresh B'3a, B'3b, B'3c, B'4, then this audit again with the new `t0`;
     keep the first attempt's token) for these 7: `positions_unreadable`, `anchor_unreadable`,
     `anchor_skipped_partial_ticker`, `anchor_skipped_okx_terminus`, `account_state_unreadable`,
     `account_key_read_failed`, `account_keys_changed`. If it refuses again, record "recorded, not
     recomputed (<token>)".
   - **Record only, no re-run** for these 8: `anchor_skipped_unreliable_replay`,
     `anchor_skipped_implausible`, `account_identity_pending`, `account_key_venue_unsupported`,
     `account_key_not_working`, `account_key_no_rows`, `account_sum_empty`,
     `history_days_unreproduced`. Note each one's count.
   - Any other `reconstruct_failed` (no token): record by `latest_error_kind`.
4. **A `reconstruct_complete` that is not clean:** `partial_ticker_symbols_named`,
   `anchor_offset_implausible`, `anchor_replay_unreliable` or `okx_terminus_hit` true: STOP and
   ask the founder.
5. **RECOMPUTED only when ALL of these hold:** `terminal_kind` is `reconstruct_complete` with no
   `completion_reason` and none of rule 4's flags; the `newjob` row's `latest_status` is `done`;
   `atomic_replace`, `account_rebuild` and `forced_rebuild` are true; `account_key_count` equals
   B'1's `keys_total`; `window_days` equals B'1's predicted window (90); a seam row exists
   (`snapshot_rebuild_boundary_present`) iff B'1 counted days before the window; **and the
   after-census's `suspect_days_in_window` for the a-label is at or below the post-deploy tail**
   (B'6). Then the row diff in B'6 is read; rows before the seam changed must be 0, any other
   count is a STOP (the older rows were to be kept byte for byte).
6. **Everything else is NOT recomputed** and is recorded with its cause. A completion with
   `atomic_replace` false, or without `account_rebuild`, is a STOP (the deployed code is not this
   runbook's). `reconstruct_unexpected_noop`, `reconstruct_no_data` and
   `reconstruct_partial_unsupported` are "recorded, not recomputed (<kind>)", and the founder is
   asked if any row changed. No terminal audit while the job is terminal is "not shown (no
   terminal audit)". Anything else is "not shown (<cause>)".

A rebuild's in-window level move is expected to be about the summed open profit, and for an
account whose stored days were first-writer-wins from one exchange, up to the other exchange
accounts' equity: it rewrites the whole window, not only the double count. Record the size; do
not judge it.

## B'6 — after-census and record

Run the three census files and `okx-snapshot-rows.sql` again into `MS_SP` (`b6-*.csv`,
`b6-rows-after.csv`), the `marker` form first. The row diff is computed in scratch, counts only:

```bash
cat > "$MS_SP/rowdiff.mjs" <<'JS'
import fs from "node:fs";
const fail = (m) => { process.stderr.write("rowdiff: " + m + "\n"); process.exit(2); };
const [beforePath, afterPath, t0] = process.argv.slice(2);
if (!beforePath || !afterPath || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(t0 || "") || Number.isNaN(Date.parse(t0))) {
  fail("usage: node rowdiff.mjs <before.csv> <after.csv> <MS_T0>");
}
const start = new Date(Date.parse(t0));
start.setUTCDate(start.getUTCDate() - 89);
const windowStart = start.toISOString().slice(0, 10);
const HEADER = "account_label,asof,value_usd,source,history_depth_months,pre_terminus_balance_unknown,reconstructed_at";
const load = (p) => {
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines[0] !== HEADER) fail(p + ": unexpected header");
  const rows = new Map();
  for (const line of lines.slice(1)) {
    if (line.includes('"')) fail(p + ": a quoted field; this tool reads plain fields only");
    const f = line.split(",");
    if (f.length !== 7 || !Number.isFinite(Number(f[2]))) fail(p + ": a row that is not seven plain fields");
    rows.set(f[0] + "|" + f[1], { label: f[0], asof: f[1], value: Number(f[2]), line });
  }
  return rows;
};
const before = load(beforePath);
const after = load(afterPath);
const stats = new Map();
const of = (label) => {
  if (!stats.has(label)) stats.set(label, { older_rows_changed: 0, in_window_before: 0, in_window_after: 0, in_window_changed: 0, in_window_added: 0, in_window_removed: 0, max_rel: 0 });
  return stats.get(label);
};
for (const [key, b] of before) {
  const s = of(b.label);
  const a = after.get(key);
  if (b.asof < windowStart) { if (!a || a.line !== b.line) s.older_rows_changed += 1; continue; }
  s.in_window_before += 1;
  if (!a) { s.in_window_removed += 1; continue; }
  if (Math.abs(a.value - b.value) > 0.005) {
    s.in_window_changed += 1;
    if (b.value !== 0) s.max_rel = Math.max(s.max_rel, Math.abs(a.value - b.value) / Math.abs(b.value));
  }
}
for (const [key, a] of after) {
  const s = of(a.label);
  const b = before.get(key);
  if (a.asof < windowStart) { if (!b) s.older_rows_changed += 1; continue; }
  s.in_window_after += 1;
  if (!b) s.in_window_added += 1;
}
const total = { older_rows_changed: 0, in_window_before: 0, in_window_after: 0, in_window_changed: 0, in_window_added: 0, in_window_removed: 0, max_rel: 0 };
for (const s of stats.values()) for (const k of Object.keys(total)) total[k] = k === "max_rel" ? Math.max(total[k], s[k]) : total[k] + s[k];
const out = (label, s) => console.log(label + " window_start=" + windowStart + " " + Object.entries(s).map(([k, v]) => k + "=" + (k === "max_rel" ? Number(v.toPrecision(3)) : v)).join(" "));
for (const label of [...stats.keys()].sort()) out(label, stats.get(label));
out("all", total);
JS
node "$MS_SP/rowdiff.mjs" "$MS_SP/b2-rows-before.csv" "$MS_SP/b6-rows-after.csv" "$MS_T0"
```

`window_start` is the rebuild's UTC date minus 89 days, the first day of the replaced window.
`older_rows_changed` is EXPECTED 0 for every a-label (rows before the seam, compared whole,
including `reconstructed_at`); any other count is a STOP. `max_rel` is the largest relative
change of an in-window row to 3 significant figures (a rebuild that moves nothing prints 0).

Record in the phase VERIFICATION, as counts, day counts, ratios and per-label outcomes only:

- B'1 with the predictions, the tail and its two dates, and `MS_LABELS`;
- B'3c and B'5 as printed (labels, tokens, booleans, counts);
- per a-label, the after-census `suspect_days_in_window` against the tail, and the row diff;
- **the double-count estimate and the row diff side by side, never the estimate as the change:**
  B'1's median and maximum overcount share are an estimate of what the double count was; the row
  diff's `in_window_changed` and `max_rel` are what the rebuild did, and they differ because the
  rebuild rewrites the whole window (see B'5);
- per a-label, one outcome: `recomputed`, `recorded, not recomputed (<token or kind>)`, or
  `not shown (<cause>)`.

Then delete the scratch directory (print its path first: `echo "$MS_SP"`, then `rm -r -- "$MS_SP"`).

## What this cannot reach

The forced rebuild is the only product path that recomputes a stored past row, and it reaches the
last 90 days of snapshots. Three things stay as stored. Each is KEPT and NAMED here and in the
ledger entry `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW` in `TODOS.md`, and the
census counts each one:

- **Refresh-written snapshot rows older than the 90-day window.** The double count is in force
  from 2026-04-24 (the commit that added `total += upnl` to the refresh). For a correction run on
  day D, the span left as stored is 2026-04-24 to D - 90. The window replace keeps those rows
  byte for byte and records the seam. Counted by `suspect_days_outside_window` in
  `okx-snapshot-census.sql`.
- **Every `allocator_holdings` history row.** A holdings row is one point-in-time venue read: OKX
  cannot be asked what the wallet held on a past day, and no job rebuilds a past poll. The USDT
  rows of OKX-holding allocators carry the open profit twice on every poll day before the forward
  fix, and the Exposure-over-time charts read those rows (`getNetExposureSeries` and
  `getAllocationSeries` in `src/lib/portfolio-exposure.ts`), so their gross and per-venue weights
  are high on those past days by the open profit. Counted by `usdt_row_days_carrying_open_profit`
  in `okx-holdings-census.sql`.
- **Any scenario-commit audit size.** `size_at_decision_usd` and `server_aum` are written once at
  commit time from the holdings AUM of that moment, in an append-only `audit_log` row. An OKX
  allocator who committed a scenario while open profit was on carries the double count in that
  row, if any such commit exists. Nothing reads it after the commit.

**The hand-computed subtraction is not a product path and is not in this runbook.** Subtracting
the same-day OKX derivative open profit from the USDT row and from the snapshot is deterministic
in principle, but no later run reproduces it, and CONTEXT D-05 allows a correction only where it
"writes nothing a later run cannot reproduce". It would need an explicit founder yes (question F1
of the phase research), and D-09 recorded the founder's answer: rows older than the window and
`allocator_holdings` history are kept and named.

## Rollback

There is no rollback form. The window replace is one-way through the product path: the rows it
overwrites are not kept anywhere in the product, and nothing in this runbook writes a stored row
back. A refused job writes nothing and leaves the stored curve as it was. The B'2 before file is
evidence for the row diff, not a restore source, and B'6 deletes it with the rest of the scratch
directory. Every older row, the seam and the other stores are untouched by construction.
