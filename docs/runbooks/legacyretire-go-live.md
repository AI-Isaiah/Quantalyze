# Runbook — LEGACYRETIRE: the legacy allocator equity curve is retired (Phase 176)

**Owner:** the orchestrator runs the live ops on the founder's standing PROD authorization; the
founder is told what was written · **Audience:** whoever reads, retires or rolls back the
legacy allocator equity curve months from now, with no memory of this phase · **Risk:** reads
only, except one guarded `pg_cron` removal (`unschedule-refresh`) and its rollback
(`reschedule-refresh`). Nothing in this runbook drops the table: that is the PR 3 migration, which
this runbook only brackets with a pre-flight and a post-check.

This runbook is the sequel to [the MARKSOURCE legacy poll and refresh move](marksource-legacy-chain-move-go-live.md),
the runbook that put the two legacy jobs on their present clock. It copies that runbook's skeleton
section for section, and where a rule is unchanged it says so instead of restating the reasoning.

## What this activates

The legacy curve is `public.allocator_equity_snapshots`, written by the daily refresh, the history
reconstruct and the window replace. The derived curve is `public.allocator_equity_derived` with kind
`equity_curve`: realized basis before an account's first mark, marked from it on. Phase 176 moves
every reader to the derived curve, stops the legacy writes, and drops the table. These are the
decisions of record this runbook serves, quoted from the phase's CONTEXT.

D-01 (the part this runbook measures): "181's success criterion 4 ("every allocator holding
non-Deribit positions has a snapshot for the closed day") becomes: every such allocator has a derived
curve point for the closed day."

D-02, verbatim: "Drop the table" (founder 2026-10-31). — **Reversibility:** one-way — the migration
drops `allocator_equity_snapshots` and its rows; undoing it needs a restore from backup. "**Order
(orchestrator constraint, not a new decision):** first every reader moves, and the move is deployed
and read live on PROD. Then the writes stop. The drop ships last, in its own migration and PR."

D-04, verbatim: "Retire the job (Recommended)". The `reconstruct_allocator_history` job retires with
the table. All three enqueue paths stop, including the one in `request_allocator_holdings_sync`,
which is re-based in a migration. The handler becomes a stub that returns DONE, so already-queued jobs
finish as no-ops. Its `compute_job_kinds` row stays, because `compute_jobs.kind` is a foreign key to
it.

D-06, verbatim: "Reset and recompute once (Recommended)". The PR 1 migration sets `needs_recompute =
TRUE` and NULLs the old deltas together, for the holding-measuring outcome rows only, so every stored
outcome ends up on the new basis. Before writing, the affected rows are counted read-only on PROD
(research form R3).

D-07, verbatim: "Remove both (Recommended)". The "Only N months of history available on {venues}"
copy (`minHistoryDepthMonths`) and the "Limited equity history" banner (`equityBaselineUnknown`) are
removed. Before removing them, who sees the banner today is counted read-only (form R0). The 30-day
warm-up countdown stays, counted on the derived curve's days.

The phase ships as three ordered PRs, and the reading that gates each next step is a form below.

| PR | What it does | Read BEFORE it merges | Read AFTER it is live on PROD |
|---|---|---|---|
| 1 | every reader moves to the derived curve; the bridge-outcome migration re-bases the holding branch and resets the stored holding outcomes (D-06) | `r0-baseline-unknown` (D-07), `r3-bridge-holding` (D-06) | `ledger-row` and `body-check` (the schema-apply checks), then `r1-closed-day-points`, `r2-zero-legacy-and-linked`, and `r3-bridge-holding` again after the first 03:00Z run |
| 2 | the legacy writers stop (D-04); the `refresh-allocator-equity` cron is removed by hand | `cron-state` | `unschedule-refresh`, then in the SAME session the manifest re-capture, `cron-state`, `r4-legacy-writes-stopped` |
| 3 | the table, the two replace RPCs, `extract_symbol_value_at` and the fan-out function are dropped (D-02) | `r5-drop-preflight` and `r5-pre-drop-count` | `ledger-row`, then `r6-drop-applied` |

The cron job `refresh-allocator-equity` is the only `pg_cron` job this phase changes. It is removed
by hand (`unschedule-refresh`), by name, behind a database-marker guard, and **no migration touches
the job catalog**. The reason is the one the MARKSOURCE move gives: a PROD migration auto-applies
after `apply-test` with no human stop, so a migration that wrote the live job catalog would be an
unreviewed catalog write. The repo never runs `db push`: the merge's `apply-test` job and then its
`apply` job are the push, which is why `ledger-row` and `body-check` exist as [BLOCKING] checks after
each PROD apply.

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export LR_SP="${LR_SP:-$HOME/.cache/quantalyze/legacyretire-176}"; mkdir -p "$LR_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link exists only there and it targets
  PRODUCTION. If `--workdir` is refused, run the same command with the main checkout as the
  current directory.
- `LR_SP` is a scratch directory outside the repo. Every SQL file and CSV lives there, never in a
  tracked path.
- **The CLI returns only the LAST statement's rows.** So every read here carries the marker check
  as its first column (`marker_is_prod`: 1 only when the database's own comment equals the
  manifest's `database_marker`, else 0, and a NULL comment reads 0), and every write file starts
  with a guard that RAISES. The two TEST forms carry `marker_is_test` instead.
- **Never hand-type the marker string.** The renderer reads `database_marker` from
  `scripts/prod-prober/cron-manifest.json`.
- **Never hand-write SQL at run time.** Every statement the operator runs in this phase is a form in
  this file, rendered by the renderer below, so what is run is what is written and what a reviewer
  read. A form that errors is a defect in this runbook: fix the runbook, do not edit the rendered
  file.
- Always `grep -a`. Tracked text is counts-only: no key ids, owner ids, emails, hostnames,
  project refs, amounts or home paths. Jobs are named by `jobname`, never by `jobid`.

The renderer extracts a named SQL form from this file. It substitutes `__MARKER__` from the
manifest, refuses (exit 2, nothing printed) a manifest marker it cannot use, and refuses an unknown
form name or an unresolved `__PLACEHOLDER__`. The placeholders a form may carry come from the
environment, each validated, each refused when its variable is absent or malformed:

| Placeholder | Variable | Accepted shape |
|---|---|---|
| `__SINCE__` | `LR_SINCE` | `YYYY-MM-DDTHH:MM:SSZ`, a real calendar instant |
| `__DEPLOY_DAY__` | `LR_DEPLOY_DAY` | `YYYY-MM-DD`, a real calendar day |
| `__VERSION__` | `LR_VERSION` | exactly 14 digits (a migration version) |
| `__PROC__` | `LR_PROC` | `public.` then a lower-case name and a parenthesised argument-type list, e.g. `public.some_function(uuid, text)` |
| `__NEEDLE__` | `LR_NEEDLE` | lower-case letters and underscores only |

```bash
cat > "$LR_SP/form.mjs" <<'JS'
import fs from "node:fs";
const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name>");
const md = fs.readFileSync("docs/runbooks/legacyretire-go-live.md", "utf8");
const m = md.match(new RegExp("<!-- form: " + name + " -->\\n```sql\\n([\\s\\S]*?)\\n```"));
if (!m) fail("no form named " + name);
let sql = m[1];
const uses = (ph) => sql.includes(ph);
const put = (ph, value) => { sql = sql.split(ph).join(value); };
if (uses("__MARKER__")) {
  const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
  if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) fail("__MARKER__: database_marker unusable");
  put("__MARKER__", "$m$" + marker + "$m$");
}
const isDay = (v) => {
  if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isInstant = (v) => {
  if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v.replace("Z", ".000Z");
};
if (uses("__SINCE__")) {
  if (!isInstant(process.env.LR_SINCE)) fail("LR_SINCE: set it to a UTC instant such as '2026-11-01T00:00:00Z'");
  put("__SINCE__", process.env.LR_SINCE);
}
if (uses("__DEPLOY_DAY__")) {
  if (!isDay(process.env.LR_DEPLOY_DAY)) fail("LR_DEPLOY_DAY: set it to a calendar day such as '2026-11-01'");
  put("__DEPLOY_DAY__", process.env.LR_DEPLOY_DAY);
}
if (uses("__VERSION__")) {
  if (!/^[0-9]{14}$/.test(process.env.LR_VERSION || "")) fail("LR_VERSION: set it to the 14-digit migration version");
  put("__VERSION__", process.env.LR_VERSION);
}
if (uses("__PROC__")) {
  if (!/^public\.[a-z_]+\([a-z, ]*\)$/.test(process.env.LR_PROC || "")) fail("LR_PROC: set it to a schema-qualified signature such as 'public.some_function(uuid, text)'");
  put("__PROC__", process.env.LR_PROC);
}
if (uses("__NEEDLE__")) {
  if (!/^[a-z_]+$/.test(process.env.LR_NEEDLE || "")) fail("LR_NEEDLE: set it to a lower-case identifier such as 'some_name'");
  put("__NEEDLE__", process.env.LR_NEEDLE);
}
const left = sql.match(/__[A-Z0-9_]+__/);
if (left) fail("unresolved placeholder " + left[0]);
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$LR_SP/form.mjs" <form-name> > "$LR_SP/<name>.sql"`, then
`q "$LR_SP/<name>.sql" > "$LR_SP/<name>.csv"`. A form that carries a placeholder needs its variable
exported first.

The plain marker read, run as its own call and recorded before anything that writes (`CLAUDE.md`,
"Which database am I on?"). Record that it names PRODUCTION (the text is already public in the
manifest and is not repeated here); a NULL means the label was lost: re-set it before writing, never
proceed on a guess.

<!-- form: marker -->
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

## Before PR 1 merges — who loses the baseline banner (D-07)

`r0-baseline-unknown` counts, read-only, the allocators that see the "Limited equity history" banner
today: any legacy row carrying `pre_terminus_balance_unknown`. It records, before plan 05's change
lands, who the banner's removal affects. Columns: `allocators_with_unknown_baseline` (distinct
allocators with at least one such row), `rows_with_unknown_baseline`, and `allocators_with_any_row`
(the denominator). Counts only. **This form reads the legacy table, so it is pre-drop only:** after
PR 3 it errors on a missing relation, which is correct.

<!-- form: r0-baseline-unknown -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod,
       (SELECT count(DISTINCT s.allocator_id) FROM public.allocator_equity_snapshots s WHERE s.pre_terminus_balance_unknown)::int AS allocators_with_unknown_baseline,
       (SELECT count(*) FROM public.allocator_equity_snapshots s WHERE s.pre_terminus_balance_unknown)::int AS rows_with_unknown_baseline,
       (SELECT count(DISTINCT s.allocator_id) FROM public.allocator_equity_snapshots s)::int AS allocators_with_any_row
  FROM m;
```

## Before PR 1 merges, and again after its first 03:00Z run — the stored bridge outcomes (D-06)

`r3-bridge-holding` counts, read-only, the holding-measuring `bridge_outcomes` rows: kind
`allocated`, whose decision has `original_strategy_id` NULL and `original_holding_ref` NOT NULL and a
holding reference that parses to a symbol. This is the population the PR 1 migration resets
(`needs_recompute = TRUE`, old deltas NULLed together) and the population the cron's holding branch
then recomputes. Export `LR_DEPLOY_DAY` (the UTC day PR 1's migration is applied on PROD) first.

Columns, all counts: `holding_rows` (the population), `with_delta_30d`, `with_delta_90d`,
`with_delta_180d` (rows whose delta is stored), `needs_recompute`, `computed_since_deploy_day` (rows
whose `deltas_computed_at` falls on or after `LR_DEPLOY_DAY`, UTC), `inside_check_window` and
`outside_check_window` (`allocated_at` against `CURRENT_DATE - '365 days'::interval`, the expression
of the `bridge_outcomes_allocated_at_check` constraint, so the split says how many rows are old
enough that the constraint would refuse a write that re-states them), and
`aged_candidates_any_branch` (rows of kind `allocated` in ANY branch with no stored 30-day delta or
flagged for recompute whose `allocated_at` is older than 300 days: the population a CHECK abort of
the cron would come from, which is what plan 02 of the phase must not trip).

Run it twice: BEFORE PR 1 merges, as the sizing read (the stored numbers are the old basis), and
AFTER PR 1 is live and the first 03:00Z run has finished, as the outcome read. **Expected after:**
`needs_recompute` back to the rows the cron could not compute, `computed_since_deploy_day` at the
rows it could, and `with_delta_*` no larger than before for a row the new rule cannot compute (an
uncomputable outcome is NULL, never a number). A `needs_recompute` that stays above the sizing read's
uncomputable share is a finding to read, not to clear.

<!-- form: r3-bridge-holding -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
holding AS (
  SELECT bo.id, bo.allocated_at, bo.delta_30d, bo.delta_90d, bo.delta_180d, bo.needs_recompute, bo.deltas_computed_at
    FROM public.bridge_outcomes bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    LEFT JOIN LATERAL public.parse_holding_ref(md.original_holding_ref) hp ON TRUE
   WHERE bo.kind = 'allocated'
     AND bo.allocated_at IS NOT NULL
     AND md.original_strategy_id IS NULL
     AND md.original_holding_ref IS NOT NULL
     AND hp.symbol IS NOT NULL
)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM holding)::int AS holding_rows,
       (SELECT count(*) FROM holding h WHERE h.delta_30d IS NOT NULL)::int AS with_delta_30d,
       (SELECT count(*) FROM holding h WHERE h.delta_90d IS NOT NULL)::int AS with_delta_90d,
       (SELECT count(*) FROM holding h WHERE h.delta_180d IS NOT NULL)::int AS with_delta_180d,
       (SELECT count(*) FROM holding h WHERE h.needs_recompute)::int AS needs_recompute,
       (SELECT count(*) FROM holding h WHERE (h.deltas_computed_at AT TIME ZONE 'UTC')::date >= '__DEPLOY_DAY__'::date)::int AS computed_since_deploy_day,
       (SELECT count(*) FROM holding h WHERE h.allocated_at <= CURRENT_DATE AND h.allocated_at >= (CURRENT_DATE - '365 days'::interval))::int AS inside_check_window,
       (SELECT count(*) FROM holding h WHERE NOT (h.allocated_at <= CURRENT_DATE AND h.allocated_at >= (CURRENT_DATE - '365 days'::interval)))::int AS outside_check_window,
       (SELECT count(*) FROM public.bridge_outcomes bo WHERE bo.kind = 'allocated' AND bo.allocated_at IS NOT NULL AND (bo.delta_30d IS NULL OR bo.needs_recompute) AND bo.allocated_at < CURRENT_DATE - 300)::int AS aged_candidates_any_branch
  FROM m;
```

## After PR 1 is live — every allocator has a derived point for the closed day (181 SC-4 rewritten)

CONTEXT D-01 rewrote 181's success criterion 4: "every such allocator has a derived curve point for
the closed day." Run these once the PR 1 web deploy and the schema apply are both live, at least
45 minutes after the day's compose has had time to finish and not before 02:00Z, so the closed
day's point has landed. Each form computes the run day and the closed day (the run day minus one)
from the database clock, so a reading run on any other day reads that other day.

Before either, run the two schema-apply checks of "After each PROD apply" below. They are
[BLOCKING]: a green merge says the apply job succeeded, not that PROD carries the function body.

`r1-closed-day-points`: **holders** are the allocators with a non-Deribit `allocator_holdings` row
dated the run day on a key that is active, not revoked and not disconnected. For them it reports
`holders`, `with_derived_row` (an `allocator_equity_derived` row of kind `equity_curve`),
`trustworthy` (the payload says `is_trustworthy`), and `with_closed_day_point` (a curve element whose
date is the closed day; a curve that is not an array counts as no point and does not raise).
**Expected:** all four equal. A holder without a closed-day point is a count to name and read, not to
clear.

<!-- form: r1-closed-day-points -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day,
         (now() AT TIME ZONE 'UTC')::date - 1 AS closed_day
),
holders AS (
  SELECT DISTINCT h.allocator_id
    FROM public.allocator_holdings h
    CROSS JOIN d
    JOIN public.api_keys k ON k.id = h.api_key_id
   WHERE h.asof = d.run_day
     AND lower(h.venue) <> 'deribit'
     AND k.is_active
     AND k.sync_status IS DISTINCT FROM 'revoked'
     AND k.disconnected_at IS NULL
),
per_holder AS (
  SELECT ho.allocator_id,
         (dv.allocator_id IS NOT NULL) AS has_row,
         coalesce(dv.payload ->> 'is_trustworthy' = 'true', false) AS is_trustworthy,
         CASE WHEN jsonb_typeof(dv.payload -> 'curve') = 'array'
              THEN EXISTS (SELECT 1 FROM jsonb_array_elements(dv.payload -> 'curve') e WHERE e ->> 'date' = d.closed_day::text)
              ELSE false END AS has_closed_point
    FROM holders ho
    CROSS JOIN d
    LEFT JOIN public.allocator_equity_derived dv ON dv.allocator_id = ho.allocator_id AND dv.kind = 'equity_curve'
)
SELECT m.marker_is_prod,
       d.run_day,
       d.closed_day,
       (SELECT count(*) FROM per_holder)::int AS holders,
       (SELECT count(*) FROM per_holder p WHERE p.has_row)::int AS with_derived_row,
       (SELECT count(*) FROM per_holder p WHERE p.is_trustworthy)::int AS trustworthy,
       (SELECT count(*) FROM per_holder p WHERE p.has_closed_point)::int AS with_closed_day_point
  FROM m CROSS JOIN d;
```

`r2-zero-legacy-and-linked` reports the same four counts for two populations of the holders above,
one row each, labelled by `population`: `no_legacy_row` (holders with no `allocator_equity_snapshots`
row at all: the books the legacy curve never covered) and `all_keys_linked` (holders with at least
one connected key whose every connected key is linked, through `strategies.api_key_id` or
`strategy_keys`, to a non-archived strategy: the books the legacy bootstrap's link filter skipped,
which the shared-key rule of 2026-10-31 now counts). **Expected:** in each row `with_closed_day_point`
equals `holders`. **Pre-drop only:** it reads the legacy table to tell the first population.

<!-- form: r2-zero-legacy-and-linked -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day,
         (now() AT TIME ZONE 'UTC')::date - 1 AS closed_day
),
holders AS (
  SELECT DISTINCT h.allocator_id
    FROM public.allocator_holdings h
    CROSS JOIN d
    JOIN public.api_keys k ON k.id = h.api_key_id
   WHERE h.asof = d.run_day
     AND lower(h.venue) <> 'deribit'
     AND k.is_active
     AND k.sync_status IS DISTINCT FROM 'revoked'
     AND k.disconnected_at IS NULL
),
per_holder AS (
  SELECT ho.allocator_id,
         (dv.allocator_id IS NOT NULL) AS has_row,
         coalesce(dv.payload ->> 'is_trustworthy' = 'true', false) AS is_trustworthy,
         CASE WHEN jsonb_typeof(dv.payload -> 'curve') = 'array'
              THEN EXISTS (SELECT 1 FROM jsonb_array_elements(dv.payload -> 'curve') e WHERE e ->> 'date' = d.closed_day::text)
              ELSE false END AS has_closed_point
    FROM holders ho
    CROSS JOIN d
    LEFT JOIN public.allocator_equity_derived dv ON dv.allocator_id = ho.allocator_id AND dv.kind = 'equity_curve'
),
pop AS (
  SELECT 'no_legacy_row'::text AS population, p.allocator_id, p.has_row, p.is_trustworthy, p.has_closed_point
    FROM per_holder p
   WHERE NOT EXISTS (SELECT 1 FROM public.allocator_equity_snapshots s WHERE s.allocator_id = p.allocator_id)
  UNION ALL
  SELECT 'all_keys_linked'::text AS population, p.allocator_id, p.has_row, p.is_trustworthy, p.has_closed_point
    FROM per_holder p
   WHERE EXISTS (
           SELECT 1 FROM public.api_keys k
            WHERE k.user_id = p.allocator_id AND k.is_active AND k.sync_status IS DISTINCT FROM 'revoked' AND k.disconnected_at IS NULL)
     AND NOT EXISTS (
           SELECT 1 FROM public.api_keys k
            WHERE k.user_id = p.allocator_id AND k.is_active AND k.sync_status IS DISTINCT FROM 'revoked' AND k.disconnected_at IS NULL
              AND NOT (
                EXISTS (SELECT 1 FROM public.strategies st WHERE st.api_key_id = k.id AND st.status <> 'archived')
                OR EXISTS (SELECT 1 FROM public.strategy_keys sk JOIN public.strategies st2 ON st2.id = sk.strategy_id WHERE sk.api_key_id = k.id AND st2.status <> 'archived')))
),
labels AS (
  SELECT unnest(ARRAY['no_legacy_row', 'all_keys_linked']) AS population
)
SELECT m.marker_is_prod,
       l.population,
       count(p.allocator_id)::int AS holders,
       (count(p.allocator_id) FILTER (WHERE p.has_row))::int AS with_derived_row,
       (count(p.allocator_id) FILTER (WHERE p.is_trustworthy))::int AS trustworthy,
       (count(p.allocator_id) FILTER (WHERE p.has_closed_point))::int AS with_closed_day_point
  FROM m CROSS JOIN labels l LEFT JOIN pop p ON p.population = l.population
 GROUP BY m.marker_is_prod, l.population
 ORDER BY l.population;
```

## PR 2 — the cron is removed, by hand, behind a guard (D-04, D-02)

### Before: the state of the four allocator jobs

`cron-state` reads the four allocator jobs (`poll-allocator-positions`, `refresh-allocator-equity`,
`derive-allocator-key-dailies`, `compute_bridge_outcome_deltas`) with the marker check as the first
column, plus one text column listing the open jobs of the two retired kinds
(`reconstruct_allocator_history`, `refresh_allocator_equity_daily`) as `kind:status=count`, or `none`.
Open means `pending`, `running`, `failed_retry` or `done_pending_children`. **Expected before
`unschedule-refresh`:** four rows, all active, and `refresh-allocator-equity` at `30 1 * * *` with
command `SELECT enqueue_refresh_allocator_equity_for_all();`. If it is anywhere else, PROD drifted
somewhere this runbook was not looking: stop and read the difference. Read the committed manifest's
listing too, never a copy of it in prose:

```bash
node -e 'const m=require("./scripts/prod-prober/cron-manifest.json");for(const j of m.jobs.slice().sort((a,b)=>a.schedule.localeCompare(b.schedule)))console.log(j.schedule.padEnd(14)+j.jobname)'
```

<!-- form: cron-state -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
open_jobs AS (
  SELECT c.kind, c.status, count(*)::int AS n
    FROM public.compute_jobs c
   WHERE c.kind IN ('reconstruct_allocator_history', 'refresh_allocator_equity_daily')
     AND c.status IN ('pending', 'running', 'failed_retry', 'done_pending_children')
   GROUP BY c.kind, c.status
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command,
       (SELECT coalesce(string_agg(o.kind || ':' || o.status || '=' || o.n, ', ' ORDER BY o.kind, o.status), 'none') FROM open_jobs o) AS open_retired_kind_jobs_by_status
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('poll-allocator-positions', 'refresh-allocator-equity', 'derive-allocator-key-dailies', 'compute_bridge_outcome_deltas')
 ORDER BY j.jobname;
```

### The removal

Run the `marker` form (P0 of every session), then `cron-state`, then this. **Order:** unschedule the
cron BEFORE or WITH the PR 2 worker deploy, so no refresh or bootstrap job is enqueued for a retired
handler. After PR 1 is live nothing reads the legacy rows, so stopping the cron early loses nothing.

`unschedule-refresh` is the one PROD write of this phase. Its guard refuses unless the database
names PRODUCTION (`IS DISTINCT FROM`, so a NULL marker refuses exactly as a mismatched one does) AND
exactly one job is named `refresh-allocator-equity` AND that job is at schedule `30 1 * * *` with
command `SELECT enqueue_refresh_allocator_equity_for_all();` (a compare-and-set: PROD that drifted
somewhere this runbook was not looking is not overwritten). It then removes the job BY NAME, never by
`jobid`, which differs between databases. The read-back selects the marker check first, then
`jobs_named_refresh` (expected 0) and `other_allocator_jobs` (the other three jobs, expected 3).
A retry after an ambiguous CLI error is safe: the compare-and-set refuses once the job is gone, so
read `cron-state` first. The statement lives HERE and in no migration, for the reason in "What this
activates".

<!-- form: unschedule-refresh -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity' AND schedule = '30 1 * * *' AND command = 'SELECT enqueue_refresh_allocator_equity_for_all();') <> 1 THEN
    RAISE EXCEPTION 'the refresh job is not exactly one job at its expected schedule and command; refusing to continue';
  END IF;
END
$guard$;
SELECT cron.unschedule('refresh-allocator-equity') AS refresh_unscheduled;
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job j WHERE j.jobname = 'refresh-allocator-equity')::int AS jobs_named_refresh,
       (SELECT count(*) FROM cron.job j WHERE j.jobname IN ('poll-allocator-positions', 'derive-allocator-key-dailies', 'compute_bridge_outcome_deltas'))::int AS other_allocator_jobs
  FROM m;
```

### The manifest, in the SAME session

The moment the job is gone, PROD carries one job fewer than the committed manifest, and the hourly
`cron-drift` arm reports it on every prober run. Finish this before the session ends. Never wait the
drift out and never silence the arm. The capture is the one MARKSOURCE's Step C describes; its
refusals and its "never edit the manifest by hand" rule apply unchanged.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out "$LR_SP/cron-manifest-capture.json"
diff scripts/prod-prober/cron-manifest.json "$LR_SP/cron-manifest-capture.json"
```

- Run it from a checkout of current `main`.
- **Expected diff:** the one `refresh-allocator-equity` job object removed, and the `captured_at`
  line. Nothing else. **Abort (do not move the file into place) if any OTHER field or job differs.**
- On exactly the expected diff: move the file into place, then `node scripts/prod-prober/run.mjs
  --preflight-repoint` must exit 0, and `npx vitest run src/__tests__/prod-prober-wiring.test.ts
  src/__tests__/legacyretire-runbook-forms.test.ts` plus `node scripts/prod-prober/run.mjs --self-test`
  stay green. The pin test of this runbook accepts the manifest with or without the
  `refresh-allocator-equity` row, so the re-capture does not break it. The capture ships as its own
  PR through the normal ship flow, merged outside the hold below.

### After: the legacy writes have stopped (D-02 order, step 2)

`r4-legacy-writes-stopped` is run after `unschedule-refresh` AND after the PR 2 worker is live.
Export `LR_SINCE`, the first UTC instant after the worker deploy. It reports `legacy_rows_since` (legacy
rows reconstructed at or after that instant), `refresh_cron_rows` (cron jobs whose command names the
fan-out function) and `retired_kind_jobs_since_by_status` (jobs of the two retired kinds created
since, by status). **Expected, read after the next UTC day boundary:** `legacy_rows_since` 0,
`refresh_cron_rows` 0, and the retired kinds either `none` or only terminal statuses. A nonzero
`legacy_rows_since` after the worker is live means a writer survived: STOP, PR 3 does not ship.
**Pre-drop only.**

<!-- form: r4-legacy-writes-stopped -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
recent AS (
  SELECT c.kind, c.status, count(*)::int AS n
    FROM public.compute_jobs c
   WHERE c.kind IN ('reconstruct_allocator_history', 'refresh_allocator_equity_daily')
     AND c.created_at >= '__SINCE__'::timestamptz
   GROUP BY c.kind, c.status
)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM public.allocator_equity_snapshots s WHERE s.reconstructed_at >= '__SINCE__'::timestamptz)::int AS legacy_rows_since,
       (SELECT count(*) FROM cron.job j WHERE j.command ILIKE '%enqueue_refresh_allocator_equity_for_all%')::int AS refresh_cron_rows,
       (SELECT coalesce(string_agg(r.kind || ':' || r.status || '=' || r.n, ', ' ORDER BY r.kind, r.status), 'none') FROM recent r) AS retired_kind_jobs_since_by_status
  FROM m;
```

## PR 3 — the drop (D-02, one-way)

### Before it merges

The drop is the last step and cannot be undone without a restore from backup. Two reads gate the
merge, both pre-drop.

`r5-drop-preflight` lists, by name, every `public` function whose body mentions the table, with the
`--` line comments and block comments stripped before the test (a name inside a comment is not a
dependent; the comment characters are built with `chr(45)` so this form itself carries no `--`). The
strip is a regular-expression approximation that does not understand string literals, which is why
the expected set below is judged BY NAME and not by a count. **Expected set:**
`delete_allocator_api_key`, `enqueue_refresh_allocator_equity_for_all`, `extract_symbol_value_at`,
`replace_allocator_equity_snapshots` and `replace_allocator_equity_snapshots_window` all with
`names_table_outside_comments` true; `backfill_api_keys_history_reconstructed_at` with it false (it
names the table in a comment only). **Anything else STOPs PR 3:** a function not on the drop-and-re-base
list would be broken by the drop, and plpgsql bodies are not dependency-tracked by the database.

<!-- form: r5-drop-preflight -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
named AS (
  SELECT p.proname::text AS proname,
         regexp_replace(
           regexp_replace(lower(p.prosrc), '/[*].*?[*]/', '', 'g'),
           chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g') AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND strpos(lower(p.prosrc), 'allocator_equity_snapshots') > 0
)
SELECT m.marker_is_prod,
       s.proname,
       (strpos(s.body, 'allocator_equity_snapshots') > 0) AS names_table_outside_comments
  FROM m LEFT JOIN named s ON true
 ORDER BY s.proname;
```

`r5-pre-drop-count` is the row count the drop destroys, plus the structural reads: `legacy_rows`,
`legacy_allocators`, `oldest_asof`, `newest_asof` (dates), `dependent_objects` (database dependency
rows on the table other than its own constraints, indexes, policies, row type, defaults and TOAST
table: a view or a trigger would show here; **expected 0**), `cron_jobs_naming_table_or_fanout`
(**expected 0** after PR 2) and `boundary_rows` (`allocator_equity_derived` rows of kind
`snapshot_rebuild_boundary`, which the drop migration deletes because the window RPC that wrote them
goes with the table). Record the numbers in the plan's SUMMARY: they are the only record of what the
drop destroyed. **Pre-drop only.**

<!-- form: r5-pre-drop-count -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM public.allocator_equity_snapshots)::int AS legacy_rows,
       (SELECT count(DISTINCT s.allocator_id) FROM public.allocator_equity_snapshots s)::int AS legacy_allocators,
       (SELECT min(s.asof) FROM public.allocator_equity_snapshots s) AS oldest_asof,
       (SELECT max(s.asof) FROM public.allocator_equity_snapshots s) AS newest_asof,
       (SELECT count(*) FROM pg_depend dp WHERE dp.refobjid = to_regclass('public.allocator_equity_snapshots') AND dp.classid::regclass::text NOT IN ('pg_constraint', 'pg_class', 'pg_policy', 'pg_type', 'pg_attrdef'))::int AS dependent_objects,
       (SELECT count(*) FROM cron.job j WHERE j.command ILIKE '%allocator_equity_snapshots%' OR j.command ILIKE '%enqueue_refresh_allocator_equity_for_all%')::int AS cron_jobs_naming_table_or_fanout,
       (SELECT count(*) FROM public.allocator_equity_derived x WHERE x.kind = 'snapshot_rebuild_boundary')::int AS boundary_rows
  FROM m;
```

### After the PROD apply of PR 3

Run the `ledger-row` check below for the PR 3 migration's version, then `r6-drop-applied`.
Export `LR_VERSION` first. It reports `table_gone` (**expected true**), `bodies_naming_table` (public
function bodies naming the table outside comments, **expected 0**), `dropped_functions_present`
(how many of the four dropped signatures still exist: `replace_allocator_equity_snapshots(uuid, jsonb,
integer)`, `replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)`,
`extract_symbol_value_at(uuid, text, date)`, `enqueue_refresh_allocator_equity_for_all()`; **expected 0**),
`boundary_rows` (**expected 0**) and `ledger_row_present` (**expected true**).

<!-- form: r6-drop-applied -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
named AS (
  SELECT regexp_replace(
           regexp_replace(lower(p.prosrc), '/[*].*?[*]/', '', 'g'),
           chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g') AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND strpos(lower(p.prosrc), 'allocator_equity_snapshots') > 0
)
SELECT m.marker_is_prod,
       (to_regclass('public.allocator_equity_snapshots') IS NULL) AS table_gone,
       (SELECT count(*) FROM named s WHERE strpos(s.body, 'allocator_equity_snapshots') > 0)::int AS bodies_naming_table,
       ((to_regprocedure('public.replace_allocator_equity_snapshots(uuid, jsonb, integer)') IS NOT NULL)::int
        + (to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)') IS NOT NULL)::int
        + (to_regprocedure('public.extract_symbol_value_at(uuid, text, date)') IS NOT NULL)::int
        + (to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()') IS NOT NULL)::int) AS dropped_functions_present,
       (SELECT count(*) FROM public.allocator_equity_derived x WHERE x.kind = 'snapshot_rebuild_boundary')::int AS boundary_rows,
       EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations v WHERE v.version = '__VERSION__') AS ledger_row_present
  FROM m;
```

## After each PROD apply — the [BLOCKING] schema-apply checks (plans 07, 12 and 16)

The repo never runs `db push`. A merge that touches `supabase/migrations/**` applies to TEST first
(`apply-test`) and then to PROD (`apply`), and PROD auto-applies once TEST succeeds: there is no human
stop. So after every merge of this phase that carries a migration, and before the next step is taken,
check that PROD carries what the merge claims. A green check on the PR says the apply job succeeded;
these two forms say the database changed.

`ledger-row`: export `LR_VERSION` (the migration's 14-digit version, from its filename) and read
`ledger_row_present` (**expected true**). `body-check`: export `LR_PROC` (a schema-qualified function
signature such as `public.compute_bridge_outcome_deltas()`) and `LR_NEEDLE` (a lower-case identifier
the new body must contain), and read `proc_exists` (**expected true**) and `body_names_needle`
(**expected true**; the body is lower-cased and stripped of comments first, so a needle that appears
only in a comment reads false). The orchestrator picks the needle from the migration it just merged,
for example a name the re-based body introduced. A `false` from either is a stop: do not read the
other forms, run `migration-failure.md`'s apply check, and tell the founder.

<!-- form: ledger-row -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod,
       EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations v WHERE v.version = '__VERSION__') AS ledger_row_present
  FROM m;
```

<!-- form: body-check -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
fn AS (
  SELECT regexp_replace(
           regexp_replace(lower(p.prosrc), '/[*].*?[*]/', '', 'g'),
           chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g') AS body
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('__PROC__')::oid
)
SELECT m.marker_is_prod,
       (to_regprocedure('__PROC__') IS NOT NULL) AS proc_exists,
       coalesce((SELECT strpos(f.body, '__NEEDLE__') > 0 FROM fn f), false) AS body_names_needle
  FROM m;
```

## TEST variants (plan 12)

Plan 12 may need the same cron on shared TEST. These two forms are run through the orchestrator's TEST
connection, **never through the PROD-linked CLI**, and only if TEST carries the job: read
`test-cron-state` first. They select `marker_is_test` instead of `marker_is_prod`, and the guard of
the write refuses unless the marker names TEST as a whole word and does not name PROD: the predicate
`supabase-migrate.yml`'s `apply-test` uses, spelled in SQL with the same two regular expressions. TEST is
shared with other people's CI, so a write there is not private: assert about your own reading only.

<!-- form: test-cron-state -->
```sql
WITH mk AS (
  SELECT shobj_description(oid, 'pg_database') AS txt FROM pg_database WHERE datname = current_database()
),
m AS (
  SELECT coalesce(mk.txt ~* '(^|[^[:alnum:]_])test([^[:alnum:]_]|$)' AND mk.txt !~* 'prod', false)::int AS marker_is_test FROM mk
)
SELECT m.marker_is_test, j.jobname, j.schedule, j.active, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('poll-allocator-positions', 'refresh-allocator-equity', 'derive-allocator-key-dailies', 'compute_bridge_outcome_deltas')
 ORDER BY j.jobname;
```

<!-- form: unschedule-refresh-test -->
```sql
DO $guard$
DECLARE
  v_marker text;
BEGIN
  SELECT shobj_description(oid, 'pg_database') INTO v_marker FROM pg_database WHERE datname = current_database();
  IF v_marker IS NULL OR v_marker !~* '(^|[^[:alnum:]_])test([^[:alnum:]_]|$)' OR v_marker ~* 'prod' THEN
    RAISE EXCEPTION 'marker query did not name TEST and not PROD; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity' AND schedule = '30 1 * * *' AND command = 'SELECT enqueue_refresh_allocator_equity_for_all();') <> 1 THEN
    RAISE EXCEPTION 'the refresh job is not exactly one job at its expected schedule and command; refusing to continue';
  END IF;
END
$guard$;
SELECT cron.unschedule('refresh-allocator-equity') AS refresh_unscheduled;
WITH mk AS (
  SELECT shobj_description(oid, 'pg_database') AS txt FROM pg_database WHERE datname = current_database()
),
m AS (
  SELECT coalesce(mk.txt ~* '(^|[^[:alnum:]_])test([^[:alnum:]_]|$)' AND mk.txt !~* 'prod', false)::int AS marker_is_test FROM mk
)
SELECT m.marker_is_test,
       (SELECT count(*) FROM cron.job j WHERE j.jobname = 'refresh-allocator-equity')::int AS jobs_named_refresh
  FROM m;
```

## Rollback

Each step's rollback is the step reversed. **PR 3 has none in this runbook:** the drop is one-way
(D-02) and undoing it needs a restore from backup. PR 1 and PR 2 are code: rolling them back is a
revert and redeploy, not a step here.

`reschedule-refresh` puts the removed job back, by name, at the recorded schedule and command. Run
the `marker` form first. Its guard refuses unless the database names PRODUCTION, no job named
`refresh-allocator-equity` exists, and the fan-out function `enqueue_refresh_allocator_equity_for_all()`
still exists. **It refuses after PR 3**: a cron job that calls a missing function fails on every run,
and a rollback that schedules one is worse than no rollback. Read-back: `jobs_named_refresh` (expected
1) and `jobs_at_recorded_state` (expected 1). Then, in the SAME session, re-capture the manifest as
above; the expected diff is the job object back, and `captured_at`.

<!-- form: reschedule-refresh -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity') <> 0 THEN
    RAISE EXCEPTION 'a job named refresh-allocator-equity already exists; refusing to continue';
  END IF;
  IF to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()') IS NULL THEN
    RAISE EXCEPTION 'the fan-out function is gone, a job that calls it would fail on every run; refusing to continue';
  END IF;
END
$guard$;
SELECT cron.schedule('refresh-allocator-equity', '30 1 * * *', 'SELECT enqueue_refresh_allocator_equity_for_all();') AS refresh_scheduled;
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod,
       (SELECT count(*) FROM cron.job j WHERE j.jobname = 'refresh-allocator-equity')::int AS jobs_named_refresh,
       (SELECT count(*) FROM cron.job j WHERE j.jobname = 'refresh-allocator-equity' AND j.schedule = '30 1 * * *' AND j.command = 'SELECT enqueue_refresh_allocator_equity_for_all();')::int AS jobs_at_recorded_state
  FROM m;
```

- Open jobs of the retired kinds are never deleted: let them drain, they are the same work (the
  retired handler finishes them as no-ops, D-04).
- Rows already written to the legacy table keep their label and are not touched by any step of this
  runbook before PR 3.

## Merge and deploy hold

On any UTC day a form in this runbook is run, no merge to `main` from any phase between **00:30 UTC and
03:45 UTC**. Reason: a merge redeploys the analytics service, and a Railway redeploy of the worker kills
a job mid-run and strands its in-flight jobs until the watchdog threshold. The window covers the
`derive-allocator-key-dailies` fan-out at 00:40Z and its compose, the poll and refresh at 01:00Z and
01:30Z, and the `compute_bridge_outcome_deltas` run at 03:00Z that PR 1's `r3-bridge-holding` reads
after. Re-read those times from the `cron-state` form and the manifest listing above before relying on
them. Also hold until the `cron-state` form's `open_retired_kind_jobs_by_status` and the derive queue
are drained.

## What this runbook does not cover

- **The PR 3 migration itself.** It drops the table, the two replace RPCs, `extract_symbol_value_at`
  and the fan-out function, re-bases `delete_allocator_api_key`, and verifies itself against the
  catalogue. This runbook brackets it with `r5-drop-preflight`, `r5-pre-drop-count`, `ledger-row` and
  `r6-drop-applied`.
- **The baseline re-dump** the automation opens after a migration merges, and the carried-migrations
  marker it regenerates.
- **Worker and web deploys.** Read the deployed revisions from the platforms, and tie each reading
  here to a merged SHA in the SUMMARY of the plan that runs it.
- **The TODOS closures and the ROADMAP lines** for 181 and 182: they are the closing plan's.
- **Reading `cron.job_run_details.status` as proof of work.** It proves the SQL ran, not the worker
  side.
