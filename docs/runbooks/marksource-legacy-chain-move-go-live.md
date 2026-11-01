# Runbook — MARKSOURCE Legacy Poll and Refresh Move (Phase 167.2.1.1.1.1, D-01 and D-08)

> ⛔ **RETIRED 2026-10-31 (Phase 176 LEGACYRETIRE, D-02 and D-04):** the `refresh-allocator-equity` job is unscheduled by a hand-run step of `docs/runbooks/legacyretire-go-live.md`, and the cron manifest is re-captured in the same session. Its handler is a no-op, so the rollback forms below that move or re-create that job must not be run. The legacy rows these forms count stop growing at PR 2 of the phase, and the table is dropped by the phase's last migration. The `poll-allocator-positions` job is kept. Original text kept below.

**Owner:** the orchestrator runs the live ops (PROD writes are authorized); the founder is told
what was written · **Audience:** whoever moves, watches or rolls back the legacy allocator
poll and refresh, months from now, with no memory of this phase · **Risk:** this changes the clock
time of two live PROD `pg_cron` jobs. Nothing is created or deleted, but the first run after the
move polls every eligible exchange key at a new hour, and a `cron.job` set that no longer matches
the committed manifest is reported by the hourly prober until the manifest is re-captured.

This runbook is the sequel to [the NAVMTM chain move](navmtm-chain-move-go-live.md). It copies that
runbook's skeleton section for section, and where a rule is unchanged it says so instead of
restating the reasoning.

## What this activates

CONTEXT D-01, verbatim: "The legacy holdings poll and daily refresh move next to the ~00:10Z mark
read (a hand-run pg_cron change from a runbook, like NAVMTM's chain move), legacy rows are labelled
by the UTC day that closed, and a cross-curve test proves agreement within max($1, 0.5% of level) on
marked non-Deribit days."

The legacy curve is `allocator_equity_snapshots`, written once a day by the refresh from the rows
the poll stored in `allocator_holdings`. The derived curve is `allocator_equity_derived`, built on
the NAV marks the daily chain stores in `api_key_nav_marks`. The two can only be compared day for day
when they are read close together, so the poll and the refresh move next to the mark read.

| Step | Job | Mechanism | Old schedule | New schedule |
|---|---|---|---|---|
| 1 | `poll-allocator-positions` | PROD `pg_cron` | `0 4 * * *` | chosen at Step B (`MS_POLL`, `MS_REFRESH`) |
| 2 | `refresh-allocator-equity` | PROD `pg_cron` | `0 5 * * *` | chosen at Step B (`MS_POLL`, `MS_REFRESH`) |

The two NAVMTM jobs the move sits beside are read, never changed, by this runbook:
`cron-sync-trades` and `derive-allocator-key-dailies`. Where they are is read live (the `state`
form), never taken from this file: the NAVMTM runbook moved them to `10 0 * * *` and `40 0 * * *`,
but a rollback of that move would put them back, and this runbook must not guess.

Both jobs live in PROD `cron.job`. **They are not moved by a migration:** a PROD migration
auto-applies after `apply-test` with no human stop, so a migration that wrote the live job catalog
would be an unreviewed catalog write. The move is Step B below, run by hand behind a
database-marker guard, and only the schedule changes. The `jobid` and the command text of both jobs
stay as they are. No workflow file is edited.

## Environment and rendering the SQL

Run everything from the repo root of the checkout that holds this file.

```bash
export MS_SP="${MS_SP:-$HOME/.cache/quantalyze/marksource-legacy-167.2.1.1.1.1}"; mkdir -p "$MS_SP"
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
q() { supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1"; }
```

- `QZ_MAIN` is the main checkout. The Supabase CLI link exists only there and it targets
  PRODUCTION. If `--workdir` is refused, run the same command with the main checkout as the
  current directory.
- `MS_SP` is a scratch directory outside the repo. Every SQL file and CSV lives there, never in a
  tracked path.
- **The CLI returns only the LAST statement's rows.** So every read here carries the marker check
  as its first column (`marker_is_prod`: 1 only when the database's own comment equals the
  manifest's `database_marker`, else 0, and a NULL comment reads 0), and every write file starts
  with a guard that RAISES.
- **Never hand-type the marker string.** The renderer reads `database_marker` from
  `scripts/prod-prober/cron-manifest.json`.
- **Never hand-write SQL at run time.** Every statement the operator runs on PROD is a form in this
  file, rendered by the renderer below, so what is run is what is written and what a reviewer
  read. A form that errors is a defect in this runbook: fix the runbook, do not edit the rendered
  file.
- Always `grep -a`. Tracked text is counts-only: no key ids, owner ids, emails, hostnames,
  project refs or home paths. Jobs are named by `jobname`, never by `jobid`.

The renderer extracts a named SQL form from this file. The two slots of the move are chosen by the
operator at Step B and passed in the environment (`MS_POLL` and `MS_REFRESH`, each in the cron form
`M H * * *`). The renderer refuses, with exit 2 and nothing printed, a slot that is not `M H * * *`,
a minute above 59, an hour above 22, minute 0 to 4 of hour 0 (the NAVMTM D-13 band: the chain runs
at least a few minutes after 00:00Z), or a refresh less than 30 minutes after the poll (the poll
must have drained before the refresh reads what it wrote).

```bash
cat > "$MS_SP/form.mjs" <<'JS'
import fs from "node:fs";
const fail = (m) => { process.stderr.write("form: " + m + "\n"); process.exit(2); };
const [name] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "")) fail("usage: node form.mjs <name>");
const md = fs.readFileSync("docs/runbooks/marksource-legacy-chain-move-go-live.md", "utf8");
const m = md.match(new RegExp("<!-- form: " + name + " -->\\n```sql\\n([\\s\\S]*?)\\n```"));
if (!m) fail("no form named " + name);
let sql = m[1];
const uses = (ph) => sql.includes(ph);
if (uses("__MARKER__")) {
  const marker = JSON.parse(fs.readFileSync("scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
  if (typeof marker !== "string" || marker.length < 20 || marker.includes("$m$")) fail("__MARKER__: database_marker unusable");
  sql = sql.split("__MARKER__").join("$m$" + marker + "$m$");
}
const slot = (envName) => {
  const v = process.env[envName];
  const s = typeof v === "string" ? v.match(/^([0-9]{1,2}) ([0-9]{1,2}) \* \* \*$/) : null;
  if (!s) fail(envName + ": set it to a daily cron slot of the form 'M H * * *', such as '0 1 * * *'");
  const minute = Number(s[1]);
  const hour = Number(s[2]);
  if (minute > 59) fail(envName + ": minute above 59");
  if (hour > 22) fail(envName + ": hour above 22 (the D-13 band ends at hour 22)");
  if (hour === 0 && minute < 5) fail(envName + ": minute 0-4 of hour 0 is inside the D-13 band; use minute 5 or later");
  return { text: minute + " " + hour + " * * *", minuteOfDay: hour * 60 + minute };
};
if (uses("__POLL_SCHEDULE__") || uses("__REFRESH_SCHEDULE__")) {
  const poll = slot("MS_POLL");
  const refresh = slot("MS_REFRESH");
  if (refresh.minuteOfDay < poll.minuteOfDay + 30) fail("MS_REFRESH: the refresh must start at least 30 minutes after the poll");
  sql = sql.split("__POLL_SCHEDULE__").join(poll.text).split("__REFRESH_SCHEDULE__").join(refresh.text);
}
const left = sql.match(/__[A-Z0-9_]+__/);
if (left) fail("unresolved placeholder " + left[0]);
process.stdout.write(sql + "\n");
JS
```

Usage: `node "$MS_SP/form.mjs" <form-name> > "$MS_SP/<name>.sql"`, then
`q "$MS_SP/<name>.sql" > "$MS_SP/<name>.csv"`. The `move` and `rollback` forms also need
`MS_POLL` and `MS_REFRESH` exported first.

The plain marker read, run as its own call and recorded before anything that writes (`CLAUDE.md`,
"Which database am I on?"):

<!-- form: marker -->
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

The read-only state of the four jobs, with the marker check as its first column. The columns after
`command` are the same on every row: the number of open legacy poll and refresh jobs in the queue
(pre-flight P3), the installed `pg_cron` version and whether `cron.alter_job` exists (pre-flight
P4), and the number of snapshot rows labelled the previous UTC day and the current UTC day
(pre-flight P7, the cut-over outcome).

<!-- form: state -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command,
       (SELECT count(*) FROM public.compute_jobs c WHERE c.kind IN ('poll_allocator_positions', 'refresh_allocator_equity_daily') AND c.status IN ('pending', 'running', 'failed_retry', 'done_pending_children'))::int AS open_legacy_jobs,
       (SELECT extversion FROM pg_extension WHERE extname = 'pg_cron') AS pg_cron_version,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'cron' AND p.proname = 'alter_job') AS has_alter_job,
       (SELECT count(*) FROM public.allocator_equity_snapshots s WHERE s.asof = (now() AT TIME ZONE 'UTC')::date - 1)::int AS snapshot_rows_labelled_yesterday,
       (SELECT count(*) FROM public.allocator_equity_snapshots s WHERE s.asof = (now() AT TIME ZONE 'UTC')::date)::int AS snapshot_rows_labelled_today
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('poll-allocator-positions', 'refresh-allocator-equity', 'cron-sync-trades', 'derive-allocator-key-dailies')
 ORDER BY j.jobname;
```

## Why these slots

**A premise corrected.** CONTEXT D-01 says "the ~00:10Z mark read". The 00:10Z tick of
`cron-sync-trades` runs the strategy-mode derive. The key-mode derives that write most marks are
fanned out by `derive-allocator-key-dailies` (00:40Z after the NAVMTM move) and drained by the queue,
and NAVMTM D-11 lets a mark be written at any time on that UTC day (`marked_at` records the real
time). So marks are written in a window of roughly 00:10Z to 01:45Z, and the poll and the refresh
should sit inside it, so that the clock skew between the legacy read and the stored mark is bounded.

Re-read the slot occupancy from the committed manifest at run time, never from this section:

```bash
node -e 'const m=require("./scripts/prod-prober/cron-manifest.json");for(const j of m.jobs.slice().sort((a,b)=>a.schedule.localeCompare(b.schedule)))console.log(j.schedule.padEnd(14)+j.jobname)'
```

The slots are the operator's choice at Step B, from the first-night readings of the NAVMTM move
(its "First run" reading 3, the queue drain). Five constraints bind that choice. Re-check each
against the listing above before Step B.

- **(1) No overlap with the sync tick or the derive fan-out on one venue IP.** The poll must not run
  concurrently with the 00:10Z sync tick or the fan-out slot: OKX and Bybit enforce per-IP rate
  limits that the sync and the poll share (`cron-sync-go-live.md`, "Why 04:30").
- **(2) The refresh starts after the poll has drained.** The refresh reads what the poll wrote. The
  old gap was 60 minutes (04:00 to 05:00). The renderer refuses less than 30 minutes; the drain of
  the poll's jobs is the thing to look at (the `state` form's `open_legacy_jobs` after the poll).
- **(3) The D-13 band.** No earlier than minute 5 after 00:00Z and no later than hour 22, the same
  band as the NAVMTM chain. The renderer enforces it.
- **(4) Inside the merge hold, or the hold is extended.** The NAVMTM hold ends 01:45Z. A refresh
  slot later than that extends it: this runbook's hold (below) ends 45 minutes after the refresh
  slot, and names the new end.
- **(5) The bridge-outcome job at 03:00Z.** `compute_bridge_outcome_deltas` then finds the closed
  day's legacy row already written, which is an improvement over the old clock (it read a row
  labelled with the run day).

**The candidate, to put in front of the founder:** poll `0 1 * * *`, refresh `30 1 * * *`. It is a
candidate, not a decision. If the NAVMTM reading shows the fan-out drained early, the alternative is
poll `20 0 * * *` with refresh `0 1 * * *`. The founder picks at Step B; the choice is recorded in
the SUMMARY of the plan that runs this runbook, and nothing in this file hard-codes it.

## Cut-over timing

The snapshot write is first-writer-wins (`on_conflict="allocator_id,asof"` with
`ignore_duplicates=True`): a second writer of the same label writes nothing. The label code
(plan 05 of this phase) writes the row under the UTC day that closed, whatever the clock. That makes
the label change and the clock move one event with an order:

1. **The worker carrying the label code is live first** (pre-flight P1). With the label code live and
   the jobs still on the old clock, the 05:00Z refresh labels the day before the run day: the curve
   lags one day more and loses none. Pinned by
   `test_refresh_at_the_old_clock_labels_the_closed_day`.
2. **Step B runs before 04:00Z on the cut-over day D0 AND before the chosen poll slot on D0.** Then
   the old 04:00Z poll and 05:00Z refresh never run on D0, the new pair runs on D0 at the new slots,
   and every label gets exactly one row. **Both halves matter.** A Step B run after the new poll
   slot has passed (for example at 02:00Z with a poll slot of 01:00Z) and before 04:00Z would leave
   D0 with no run at all: the old pair has moved away, the new pair has already gone by, and the
   label D0 - 1 would never be written. Pre-flight P6 refuses that time of day.
3. **A row already stored for a label is kept, never replaced** (first-writer-wins). Pinned by
   `test_refresh_keeps_a_row_already_stored_for_its_label`. The pre-flight (P7) reads whether a
   snapshot labelled D0 - 1 already exists. If it does not (`snapshot_rows_labelled_yesterday` is
   0), outcome 1 applies: D0's first new run writes the D0 - 1 row with the closed-day price, one
   row per label. If it does (a first-connect or rebuild row, or a row written by a worker that
   predates the label code), outcome 2 applies: that allocator's D0 - 1 row is kept as stored, its
   value is not the closed-day price, and the first night's reading (c) can show it as a
   disagreement for that one day. Record the count; it is not a defect.

## Pre-flight — ALL BLOCKING

Any item that does not return its expected answer is an ABORT: do not run Step B.

- **P0 — which database is this? (FIRST, every session).** Run the `marker` form as its own call
  and record that it names PRODUCTION (the text is already public in the manifest and is not
  repeated here). **Abort if** it names anything else or comes back NULL: a NULL means the label
  was lost, re-set it before writing, never proceed on a guess.
- **P1 — the code the new clock depends on is live.** The Railway worker revision carries this
  phase's Python code (plans 01 to 05, plan 09's Python predicate in
  `analytics-service/services/holding_equity.py`, and plans 12 and 15) and the Vercel production
  deployment carries its TypeScript (plans 09 and 11). Plans 06 and 16 are tests and deploy
  nothing. Read both revisions from the platforms and record the git SHAs (public) in the SUMMARY of
  the plan you are executing. **Abort if** either is not yet live.
- **P2 — the committed manifest agrees with live PROD, BEFORE anything changes.**
  `node scripts/prod-prober/run.mjs --preflight-repoint` (needs `PROBER_POOLER_URL` and
  `SUPABASE_DB_PASSWORD`; the founder exports the database password). Expected exit 0. Exit 1
  means a defect was found, read the printed remedy; exit 3 means nothing was measured, fix that
  first. Also run the `state` form and read it, never assume it: expected four rows, all active,
  `poll-allocator-positions` at `0 4 * * *` with command
  `SELECT enqueue_poll_allocator_positions_for_all_keys();` and `refresh-allocator-equity` at
  `0 5 * * *` with command `SELECT enqueue_refresh_allocator_equity_for_all();`, and
  `cron-sync-trades` and `derive-allocator-key-dailies` **no longer** at `30 4 * * *` and
  `30 5 * * *`. **Abort with "run the NAVMTM runbook first" if either NAVMTM job is still at its old
  schedule:** the mark read this move sits beside must exist. If the legacy pair is not at its old
  schedule and command, PROD drifted somewhere this runbook was not looking: stop and read the
  difference.
- **P3 — no open poll or refresh job.** The `state` form's `open_legacy_jobs` is 0 (no
  `compute_jobs` row of kind `poll_allocator_positions` or `refresh_allocator_equity_daily` in status
  `pending`, `running`, `failed_retry` or `done_pending_children`). Moving the clock under a running
  fan-out would hide whether the first new-clock run is clean. **Abort if** it is above 0; wait.
- **P4 — `pg_cron` offers `cron.alter_job`.** The `state` form's `has_alter_job` is true and
  `pg_cron_version` is 1.3 or later (the function exists from 1.3). **Abort if** not.
- **P5 — the working tree is clean.** `git status --short` prints nothing, so the manifest Step C
  produces is reviewable against a known-clean baseline.
- **P6 — the time of day.** Step B runs before 04:00Z and before the chosen poll slot, on a UTC day
  D0 (see "Cut-over timing"), and outside any other merge hold. **Abort if** the time is later than
  either.
- **P7 — which cut-over outcome applies.** From the `state` form, record
  `snapshot_rows_labelled_yesterday`: 0 means outcome 1, above 0 means outcome 2 (see "Cut-over
  timing"). Record `snapshot_rows_labelled_today` as well; it should be 0 outside a first-connect
  reconstruct.

## Step B — the move

Re-run P0, P2, P3 and P6 immediately before it, choose the two slots, export them, and keep the
merge hold (below) from now on.

```bash
export MS_POLL='0 1 * * *' MS_REFRESH='30 1 * * *'   # the candidate; the founder chooses at Step B
node "$MS_SP/form.mjs" move > "$MS_SP/move.sql"
```

The renderer exits 2 and prints nothing on a slot it refuses (see "Environment and rendering the
SQL"). One statement moves both jobs, so both move or neither does. The guard first refuses unless
the database names PRODUCTION AND both legacy jobs are at their expected starting schedule and
command (a compare-and-set: PROD that drifted somewhere this runbook was not looking is not
overwritten) AND the two NAVMTM jobs both exist and are no longer at their old schedules.

<!-- form: move -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'poll-allocator-positions' AND schedule = '0 4 * * *' AND command = 'SELECT enqueue_poll_allocator_positions_for_all_keys();') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity' AND schedule = '0 5 * * *' AND command = 'SELECT enqueue_refresh_allocator_equity_for_all();') <> 1 THEN
    RAISE EXCEPTION 'live jobs are not at their expected starting schedule and command; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('cron-sync-trades', 'derive-allocator-key-dailies')) <> 2
     OR (SELECT count(*) FROM cron.job WHERE (jobname = 'cron-sync-trades' AND schedule = '30 4 * * *') OR (jobname = 'derive-allocator-key-dailies' AND schedule = '30 5 * * *')) <> 0 THEN
    RAISE EXCEPTION 'the NAVMTM chain is absent or still on its old clock; run its runbook first';
  END IF;
END
$guard$;
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'poll-allocator-positions'), schedule := '__POLL_SCHEDULE__') AS poll_moved, cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'refresh-allocator-equity'), schedule := '__REFRESH_SCHEDULE__') AS refresh_moved; -- WRITE
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('poll-allocator-positions', 'refresh-allocator-equity', 'cron-sync-trades', 'derive-allocator-key-dailies')
 ORDER BY j.jobname;
```

- **Expected readback:** four data rows, all with `marker_is_prod` 1 and `active` true:
  `poll-allocator-positions` at the chosen poll slot and `refresh-allocator-equity` at the chosen
  refresh slot, command texts exactly as in P2, and the two NAVMTM jobs exactly as the `state` form
  showed them before the move. Anything else is a defect: run the `state` form and the rollback.
- `IS DISTINCT FROM` in the guard is deliberate: a NULL marker refuses exactly as a mismatched one
  does. A retry after an ambiguous CLI error is safe: the compare-and-set refuses once the jobs
  have moved, so read the `state` form first.
- The guard's refusal of the NAVMTM jobs at `30 4 * * *` and `30 5 * * *` is a no-op on a PROD where
  the NAVMTM move has run and a guard if that move is ever rolled back.
- This statement lives HERE and in no migration, for the reason in "What this activates".

## Step C — the manifest, in the SAME session

The moment Step B succeeds, PROD carries two schedules the committed manifest does not, and the
hourly `cron-drift` arm reports them on every prober run. Finish this step before the session ends.
Never wait the drift out and never silence the arm.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out "$MS_SP/cron-manifest-capture.json"
diff scripts/prod-prober/cron-manifest.json "$MS_SP/cron-manifest-capture.json"
```

- The capture refuses and writes nothing on: no `--out`; an unlabelled database; a `cron.job`
  record it cannot parse or whose count disagrees with the database's own row count (exit 3); or a
  row failing a hygiene rule (exit 1). A refusal is information, not an obstacle.
- Run it from a checkout of current `main`: the manifest there already carries the NAVMTM capture.
  If the diff shows the two NAVMTM schedules, the checkout predates that capture; update it. The
  file is not edited to make the diff small.
- **Expected diff:** exactly the two legacy `schedule` strings (`poll-allocator-positions` and
  `refresh-allocator-equity`, at the chosen slots) and the `captured_at` line. Nothing else.
- **Abort (do not move the file into place) if any OTHER field or job differs.** PROD drifted
  somewhere this runbook was not looking, and committing the manifest would bless it. Investigate
  with the read-only P2 comparison. **Never edit the manifest by hand.**
- On exactly the expected diff: move the file into place, then `node scripts/prod-prober/run.mjs
  --preflight-repoint` must exit 0, and `npx vitest run src/__tests__/prod-prober-wiring.test.ts`
  plus `node scripts/prod-prober/run.mjs --self-test` stay green. The capture ships as its own PR
  through the normal ship flow, merged outside the hold below.

## First run (the first new-clock day, after its refresh slot) — readings

Counts, dates, ratios and minutes only. No key id, allocator id, strategy id, owner id or amount goes
into a tracked file. Allocators are named by a per-run a-label (`a1`, `a2`, ...) that means nothing
outside the run it was printed in. Run the `marker` form first, then each reading through the
marker-first convention above: `node "$MS_SP/form.mjs" <name> > "$MS_SP/<name>.sql"`, then `q`.

Run the readings on the UTC day of the first new-clock refresh, at least 45 minutes after the
refresh slot and after 01:45Z, so that the poll, the refresh and the day's marks have all landed.
Each form computes the run day and the closed day (the run day minus one) from the database clock,
so a reading run on any other day reads that other day.

**(a) One snapshot row per allocator, labelled the day that closed, and none labelled today.**
`reading-a` counts the allocators with a non-Deribit holdings row dated the run day, how many of them
have a snapshot labelled the closed day, how many are missing one, and how many snapshot rows are
labelled the run day. Expected: no allocator missing a row, and the run-day count 0 except a
first-connect reconstruct (a stated exclusion, below).

<!-- form: reading-a -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day,
         (now() AT TIME ZONE 'UTC')::date - 1 AS closed_day
),
eligible AS (
  SELECT DISTINCT h.allocator_id
    FROM public.allocator_holdings h
    CROSS JOIN d
   WHERE h.asof = d.run_day
     AND lower(h.venue) <> 'deribit'
),
closed AS (
  SELECT DISTINCT s.allocator_id
    FROM public.allocator_equity_snapshots s
    CROSS JOIN d
   WHERE s.asof = d.closed_day
)
SELECT m.marker_is_prod,
       d.run_day,
       d.closed_day,
       (SELECT count(*) FROM eligible)::int AS eligible_allocators,
       (SELECT count(*) FROM eligible e WHERE e.allocator_id IN (SELECT allocator_id FROM closed))::int AS with_closed_day_row,
       (SELECT count(*) FROM eligible e WHERE e.allocator_id NOT IN (SELECT allocator_id FROM closed))::int AS missing_closed_day_row,
       (SELECT count(*) FROM public.allocator_equity_snapshots s WHERE s.asof = d.run_day)::int AS run_day_labelled_rows
  FROM m CROSS JOIN d;
```

**(b) What the refresh did, by audit action and reason.** `reading-b` counts, since 00:00Z of the run
day, the refresh audit rows per action and per reason, and how many distinct allocators they cover,
then the three left-out counts (an account whose keys all fail, left out of the day with a count),
each taken as the per-allocator maximum and then summed: every job of an allocator writes the same
allocator-level counts, so a plain sum over audit rows would count one allocator once per key. The
audit reason maps to the Sentry outcome the refresh raises, so a Sentry search and this reading
agree:

| Audit reason (action `allocator.equity.refresh_held`) | Sentry `refresh_outcome` |
|---|---|
| `never_polled_working` | `held_never_polled` |
| `carry_over_age` | `held_carry_over_age` |
| `identity_pending` | `held_identity_pending` |
| `price_gap` | `held_price_gap` |

The left-out counts map the same way: `never_polled_failing_accounts` to
`left_out_never_polled_failing`, `over_age_failing_accounts` to `left_out_carry_over_age_failing`,
`price_gap_failing_accounts` to `left_out_price_gap_failing`. A `refresh_complete` row with reason
`none` is a day written normally, `book_emptied` a day written as an emptied book, and
`price_gap_left_out` a day with nothing else to write whose only content was left out for want of a
price. Every nonzero held row is a day that was not written: read its reason, do not clear it.

<!-- form: reading-b -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day
),
ev AS (
  SELECT a.user_id, a.action, coalesce(a.metadata ->> 'reason', 'none') AS reason, a.metadata
    FROM public.audit_log a
    CROSS JOIN d
   WHERE a.action IN ('allocator.equity.refresh_held', 'allocator.equity.refresh_complete', 'allocator.equity.refresh_held_for_reconstruct')
     AND a.created_at >= (d.run_day::timestamp AT TIME ZONE 'UTC')
),
by_kind AS (
  SELECT e.action, e.reason, count(*)::int AS audit_rows, count(DISTINCT e.user_id)::int AS allocators
    FROM ev e
   GROUP BY e.action, e.reason
),
left_out AS (
  SELECT e.user_id,
         max(coalesce((e.metadata ->> 'never_polled_failing_accounts')::int, 0)) AS never_polled_failing,
         max(coalesce((e.metadata ->> 'over_age_failing_accounts')::int, 0)) AS over_age_failing,
         max(coalesce((e.metadata ->> 'price_gap_failing_accounts')::int, 0)) AS price_gap_failing
    FROM ev e
   GROUP BY e.user_id
)
SELECT m.marker_is_prod,
       k.action,
       k.reason,
       k.audit_rows,
       k.allocators,
       (SELECT coalesce(sum(l.never_polled_failing), 0) FROM left_out l)::int AS never_polled_failing_accounts,
       (SELECT coalesce(sum(l.over_age_failing), 0) FROM left_out l)::int AS over_age_failing_accounts,
       (SELECT coalesce(sum(l.price_gap_failing), 0) FROM left_out l)::int AS price_gap_failing_accounts
  FROM m LEFT JOIN by_kind k ON true
 ORDER BY k.action, k.reason;
```

The last three columns repeat on every row: they are totals over all allocators, not per row.

**(c) Agreement of the two curves, WITH the skew.** `reading-c` takes each allocator whose every key
with a non-Deribit holdings row dated the run day has a stored mark for the closed day, and whose
non-Deribit mark sum is positive. Two columns state that population, repeated on every row: `allocators_considered` (those compared) and
`allocators_excluded_unmarked` (allocators polled the run day that were left out, for a key with no
stored mark or a non-positive mark sum). Read an agreement against `allocators_considered`; when it is 0
the single row has a NULL label and `within_tolerance` reads `false`, which is "nothing was compared",
not agreement. For each it prints a per-run a-label, whether a snapshot labelled
the closed day exists, `rel_diff` (the absolute difference between the snapshot and the mark sum, as
a fraction of the mark sum, to 3 significant figures), `within_tolerance` (that difference is at most
the greater of $1 and 0.5% of the mark sum, the stated D-01 tolerance; `false` when no snapshot labelled
the closed day exists, so a missing row never reads as agreeing), and `skew_minutes` (the
largest gap, over the allocator's keys, between the poll's `allocator_holdings.updated_at` and the
mark's `api_key_nav_marks.marked_at`, in whole minutes). **Agreement is reported with the measured
skew, never as a bare pass rate.** In CI both legs read the same typed prices, so the cross-curve test
proves the RULE agrees. In PROD the two reads differ by clock time, up to about 90 minutes inside the
mark window, and an all-crypto book can move more than 0.5% in that time: a disagreement with a large
`skew_minutes` is the clock, a disagreement with a small one is a defect to read. No column carries
a level, an amount or an id.

<!-- form: reading-c -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day,
         (now() AT TIME ZONE 'UTC')::date - 1 AS closed_day
),
polled AS (
  SELECT h.allocator_id, h.api_key_id, max(h.updated_at) AS polled_at
    FROM public.allocator_holdings h
    CROSS JOIN d
   WHERE h.asof = d.run_day
     AND lower(h.venue) <> 'deribit'
   GROUP BY h.allocator_id, h.api_key_id
),
keyed AS (
  SELECT p.allocator_id, p.polled_at, n.nav_usd, n.marked_at
    FROM polled p
    CROSS JOIN d
    LEFT JOIN public.api_key_nav_marks n ON n.api_key_id = p.api_key_id AND n.mark_day = d.closed_day
),
per_allocator AS (
  SELECT k.allocator_id,
         bool_and(k.nav_usd IS NOT NULL) AS every_key_marked,
         sum(k.nav_usd) AS mark_sum,
         max(abs(extract(epoch FROM (k.polled_at - k.marked_at)))) AS skew_seconds
    FROM keyed k
   GROUP BY k.allocator_id
),
compared AS (
  SELECT row_number() OVER (ORDER BY a.allocator_id) AS label_no,
         s.value_usd AS snapshot_value,
         a.mark_sum,
         abs(s.value_usd - a.mark_sum) AS abs_diff,
         abs(s.value_usd - a.mark_sum) / a.mark_sum AS rel_diff,
         (abs(s.value_usd - a.mark_sum) <= greatest(1, 0.005 * a.mark_sum)) AS within_tolerance,
         a.skew_seconds
    FROM per_allocator a
    CROSS JOIN d
    LEFT JOIN public.allocator_equity_snapshots s ON s.allocator_id = a.allocator_id AND s.asof = d.closed_day
   WHERE a.every_key_marked
     AND a.mark_sum > 0
),
population AS (
  SELECT count(*) FILTER (WHERE every_key_marked AND mark_sum > 0)::int AS allocators_considered,
         count(*) FILTER (WHERE NOT (every_key_marked AND mark_sum > 0))::int AS allocators_excluded_unmarked
    FROM per_allocator
)
SELECT m.marker_is_prod,
       pop.allocators_considered,
       pop.allocators_excluded_unmarked,
       'a' || c.label_no AS allocator_label,
       (c.snapshot_value IS NOT NULL) AS has_closed_day_row,
       CASE WHEN c.rel_diff IS NULL THEN NULL WHEN c.rel_diff = 0 THEN 0 ELSE round(c.rel_diff, 2 - floor(log(c.rel_diff))::int) END AS rel_diff,
       coalesce(c.within_tolerance, false) AS within_tolerance,
       floor(c.skew_seconds / 60)::int AS skew_minutes
  FROM m CROSS JOIN population pop LEFT JOIN compared c ON true
 ORDER BY c.label_no;
```

**(d) The cron set equals the manifest.** No new SQL: run the `state` form, then wait for the next
hourly prober run and read its `cron-drift` arm, which compares `cron.job` with the committed
manifest. Expected: no defect, after Step C has merged.

**(e) OKX allocators the forward fix reaches.** `reading-e` counts the OKX allocators with any
holdings row dated the run day, and those with a `derivative` row. These are the allocators whose
Holdings USDT row stopped counting open profit twice at the first poll on the worker that carries
the OKX `cashBal` fix (R-1 and D-05's forward half): the population the fix applies to. The stored
past rows are the business of
[the OKX history correction](marksource-okx-history-correction.md), not of this reading.

<!-- form: reading-e -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day
)
SELECT m.marker_is_prod,
       d.run_day,
       (SELECT count(DISTINCT h.allocator_id) FROM public.allocator_holdings h WHERE h.asof = d.run_day AND lower(h.venue) = 'okx')::int AS okx_allocators_with_holdings,
       (SELECT count(DISTINCT h.allocator_id) FROM public.allocator_holdings h WHERE h.asof = d.run_day AND lower(h.venue) = 'okx' AND h.holding_type = 'derivative')::int AS okx_allocators_with_derivative_rows
  FROM m CROSS JOIN d;
```

**(f) What the refresh left out by name, in counts.** `reading-f` takes, for each allocator, the
maximum over that night's `allocator.equity.refresh_complete` and `allocator.equity.refresh_held` audit
rows of each of five counts, then sums each across allocators and prints how many allocators it read.
The maximum comes first because every job of an allocator writes the same allocator-level counts. The
five counts are `price_gap_accounts` (accounts with a sized gap at or above the floor, which hold the
day), `price_gap_failing_accounts` (accounts whose keys all fail, left out with a count),
`price_gap_dust_rows` and `price_gap_unsizable_rows` (gap rows left out of the day and named in the
snapshot's `__price_gap_left_out__` record, D-06) and `native_unpriced_accounts` (BTC-unit MT5 accounts
whose closed-day close was missing, left out and not held, D-08). Counts only: each number is a
population to read, and the section below says what each one means for the legacy row.

<!-- form: reading-f -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
d AS (
  SELECT (now() AT TIME ZONE 'UTC')::date AS run_day
),
per_allocator AS (
  SELECT a.user_id,
         max(coalesce((a.metadata ->> 'price_gap_accounts')::int, 0)) AS price_gap_accounts,
         max(coalesce((a.metadata ->> 'price_gap_failing_accounts')::int, 0)) AS price_gap_failing_accounts,
         max(coalesce((a.metadata ->> 'price_gap_dust_rows')::int, 0)) AS price_gap_dust_rows,
         max(coalesce((a.metadata ->> 'price_gap_unsizable_rows')::int, 0)) AS price_gap_unsizable_rows,
         max(coalesce((a.metadata ->> 'native_unpriced_accounts')::int, 0)) AS native_unpriced_accounts
    FROM public.audit_log a
    CROSS JOIN d
   WHERE a.action IN ('allocator.equity.refresh_complete', 'allocator.equity.refresh_held')
     AND a.created_at >= (d.run_day::timestamp AT TIME ZONE 'UTC')
   GROUP BY a.user_id
)
SELECT m.marker_is_prod,
       (SELECT run_day FROM d) AS run_day,
       count(p.user_id)::int AS allocators_read,
       coalesce(sum(p.price_gap_accounts), 0)::int AS price_gap_accounts,
       coalesce(sum(p.price_gap_failing_accounts), 0)::int AS price_gap_failing_accounts,
       coalesce(sum(p.price_gap_dust_rows), 0)::int AS price_gap_dust_rows,
       coalesce(sum(p.price_gap_unsizable_rows), 0)::int AS price_gap_unsizable_rows,
       coalesce(sum(p.native_unpriced_accounts), 0)::int AS native_unpriced_accounts
  FROM m LEFT JOIN per_allocator p ON true
 GROUP BY m.marker_is_prod;
```

## What the legacy curve leaves out

CONTEXT D-08, verbatim: "A BTC-unit MT5 account with a missing close and sFOX non-stable balances
are left out of the legacy row as named exclusions: written in the runbook, a TODOS entry each, and
asserted by name in the cross-curve test."

D-01 states two more (Deribit, and the days before the marks start) and D-06 adds the gap cases. Nine
exclusions in all. Each row says what is left out, where the code leaves it out, the test that asserts
it by name in `analytics-service/tests/test_marksource_cross_curve.py`, and the `TODOS.md` entry that
owns the two D-08 items. A reader of the first-night readings above should expect exactly these
disagreements and no others: a legacy row that differs from the mark sum on one of these days is
the listed cause, not a defect.

| What is left out | Where the code leaves it out | Asserting test | TODOS id |
|---|---|---|---|
| Deribit holdings: the legacy row never includes the venue, though the derived curve marks it | the refresh skips the venue (`run_refresh_allocator_equity_daily_job`) | `test_excluded_deribit_holdings_are_not_in_the_legacy_row` | none, D-01 |
| Days before `marks_since`: the derived level is the realized roll, not a mark (NAVMTM L1 and D-09) | the derive composes realized returns until the key's first stored mark | `test_excluded_pre_start_days_are_realized_basis` | none, D-01 |
| The connect-day and rebuild-day row: a live read, kept by first-writer-wins (RESEARCH A8) | `reconstruct_allocator_history` writes the in-progress day; the refresh then writes nothing for that label | `test_excluded_connect_day_row_is_first_writer` | none, D-01 |
| A held price-gap day: a balance with no price, sized at or above the floor, holds the whole day | the sizable-gap partition in `_fetch_latest_holdings_per_eligible_key`; reason `price_gap`, Sentry `held_price_gap` (D-04 as refined by D-06) | `test_excluded_price_gap_day_has_no_legacy_row` | none, D-04 |
| A dust gap: a priced-out balance below the floor is left out of the day and named in the snapshot's `__price_gap_left_out__` record | `price_rule.gap_disposition`; counted as `price_gap_dust_rows` (D-06) | `test_excluded_dust_price_gap_is_left_out_by_name` | none, D-06 |
| An unsizable gap: a gap balance never priced by the account and symbol, left out and named under the recorded decision | `price_rule.UNSIZABLE_GAP_HOLDS` is False; counted as `price_gap_unsizable_rows` (D-06) | `test_excluded_unsizable_price_gap_follows_the_recorded_decision` | none, D-06 |
| A BTC-unit MT5 account whose closed-day close is missing: left out, not held, so the legacy row is short by that account | the `native_unpriced:<key>` marker, read by `read_native_unpriced_days`; counted as `native_unpriced_accounts` | `test_excluded_native_unpriced_mt5_is_left_out` | `167.2.1.1.1.1-MT5-BTC-MISSING-CLOSE-LEGACY-EXCLUSION` |
| sFOX non-stable balances: USD and stablecoins are valued at 1.0, every other asset is skipped and named in the poll's warning, so the legacy row is short by those balances while sFOX's NAV mark counts them | `_fetch_sfox_balance_rows` in `analytics-service/services/allocator_positions.py` (AUM-05) | `test_excluded_sfox_non_stable_balances_are_unpriced` | `167.2.1.1.1.1-SFOX-NONSTABLE-LEGACY-EXCLUSION` |
| A day with no stored mark, or a refused mark: the derived curve has no level that day (NAVMTM D-05), so the day is not compared | the derive writes no level for a day without an accepted mark | `test_excluded_no_mark_and_refused_mark_days_have_no_derived_level` | none, NAVMTM D-05 |

The two D-08 entries are in `TODOS.md` under the MARKSOURCE section. Each says what the legacy row is
short by, which test pins it, and what closes it; neither is fixed by this phase.

## Merge and deploy hold

From Step B on, no merge to `main` from any phase between **00:00 UTC and 45 minutes after the
refresh slot** (with the candidate slots, 00:00 to 02:15 UTC). Reason: a merge redeploys the analytics
service, and a Railway redeploy of the worker kills a poll or refresh job mid-run and strands its
in-flight jobs until the watchdog threshold; the hold also still covers the NAVMTM chain, whose own
window ends at 01:45 UTC. This extends the NAVMTM hold (which carries a dated note pointing here).
Before Step B the old windows still apply. Also hold until the `state` form's `open_legacy_jobs` is 0
again.

## Rollback

Same compare-and-set, reversed. Run P0 first, and export the same `MS_POLL` and `MS_REFRESH` the
move used (the guard refuses unless the jobs are at exactly those slots).

<!-- form: rollback -->
```sql
DO $guard$
BEGIN
  IF (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) IS DISTINCT FROM __MARKER__ THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'poll-allocator-positions' AND schedule = '__POLL_SCHEDULE__' AND command = 'SELECT enqueue_poll_allocator_positions_for_all_keys();') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-allocator-equity' AND schedule = '__REFRESH_SCHEDULE__' AND command = 'SELECT enqueue_refresh_allocator_equity_for_all();') <> 1 THEN
    RAISE EXCEPTION 'live jobs are not at the moved schedule; refusing to continue';
  END IF;
END
$guard$;
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'poll-allocator-positions'), schedule := '0 4 * * *') AS poll_back, cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'refresh-allocator-equity'), schedule := '0 5 * * *') AS refresh_back; -- WRITE
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
)
SELECT m.marker_is_prod, j.jobname, j.schedule, j.active, j.command
  FROM m LEFT JOIN cron.job j ON j.jobname IN ('poll-allocator-positions', 'refresh-allocator-equity', 'cron-sync-trades', 'derive-allocator-key-dailies')
 ORDER BY j.jobname;
```

- Expected readback: `poll-allocator-positions` at `0 4 * * *` and `refresh-allocator-equity` at
  `0 5 * * *`, marker 1, the NAVMTM pair untouched.
- Then, in the SAME session, re-capture the manifest as in Step C. The expected diff is the two
  legacy schedules back to their old strings and `captured_at`, nothing else.
- Snapshot rows already written keep their label (first-writer-wins) and are NOT deleted. A rollback
  leaves the label code in place, so the old clock then labels the closed day too (the curve lags a
  day and loses none; see "Cut-over timing"). Rolling back the label code is a code revert, not a
  step of this runbook.
- If the new clock has already run and left open jobs, let them drain: they are the same work. Do not
  delete jobs.

## What this runbook does not cover

- **The mark writer, the marks table and the consumers.** This runbook only moves two clocks.
- **Retiring the legacy curve.** CONTEXT deferred it: it is booked as its own phase, with the readers
  of `allocator_equity_snapshots` moved off it first.
- **The bridge-outcome straddle.** `compute_bridge_outcome_deltas` compares snapshot values at
  `allocated_at` and 30, 90 and 180 days later. A window that crosses the cut-over compares a row
  labelled with the run day and a row labelled with the closed day, an effective interval of 29 or 31
  days. Only `allocated` outcomes whose window crosses the move date are affected and each is
  computed once. This is a known limit, recorded here and not fixed.
- **The D-05 correction of the stored OKX rows.** It has its own runbook,
  [the OKX history correction](marksource-okx-history-correction.md).
- **Reading `cron.job_run_details.status` as proof of the poll or refresh work.** It proves the SQL
  ran, not the worker side.
