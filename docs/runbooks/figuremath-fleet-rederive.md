# Runbook — FIGUREMATH fleet re-derive (Phase 236, FIG-05)

The stored figures that Phase 236 moves are rewritten only when a strategy's analytics are
recomputed. This runbook hands that recompute to the coordinator. **It is a PROD write and no
plan of Phase 236 runs it.** Until it is done and recorded, FIG-05 stays pending.

**None of the SQL or shell in this file has been executed against PROD or TEST** (the author had no
database access). The forms were checked against the code and the schema dump, and the SQL was
parsed and run on a throwaway local PostgreSQL with stub tables holding one strategy of each kind
(CSV, the six venues, a composite, a failed row, a version-3 row, a one-row series), which proves
the syntax, the marker gate and the population routing, not the production data shapes. The first run of each form is its own test: read every
result before the next step, and treat a surprise as a STOP.

What moves, per figure and per strategy group, is in the phase's `236-FIGURES-MOVED.md`. This file
only says how to re-derive and how to read the result.

Scope: the stored `strategy_analytics` row of EVERY strategy that is not a composite, whatever its
origin: CSV uploads, key-backed strategies on Binance, OKX, Bybit, Deribit, sFOX and MT5, and any
other strategy that holds a stored `metrics_json`; plus the stored allocator MWR (XIRR). Composites
(a strategy with a `strategy_keys` row) are out of scope (F-2) and are not selected below.

**The population is read from `strategies` and `strategy_analytics`, never from
`ledger_refresh_staleness`.** That view is ledger-scoped by design (`venues` is `deribit`, `sfox`,
`mt5`, migration `20261114151700_ledger_staleness_closed_composites.sql`): a CSV strategy or a
Binance, OKX or Bybit strategy has no row in it. A population joined to it reaches only those three
venues and still reads "done". Do not join it back in.

## Why a re-derive is needed at all

- `FIGURE_DEFS_VERSION` moved 2 to 3 in both languages. A row stored under version 2 is read as OLD
  by `overlayStoredFigureDefs`, so until a row is recomputed the factsheet shows the TypeScript
  engine's computed figures (already on the F-5 convention) and not the stored ones. The factsheet
  carries the stored `cvar` only as `storedFigureDefs.cvar95` (`fetch-and-build-payload.ts`), which
  `overlayStoredFigureDefs` compares by `figure_defs_version`. A grep of `src/`,
  `analytics-service/services`, `analytics-service/routers` and `supabase/migrations` on 2026-11-25
  found no other reader of the stored key. It did not cover SQL views outside `supabase/migrations`,
  exports, or consumers outside this repo: any such reader sees the old convention until its row is
  recomputed.
- The stored figures that change only on a recompute: `cvar` (null under 60 observations),
  `smart_sharpe` and `smart_sortino` (crypto), `serenity_index`, and on NaN-carrying series
  `common_sense_ratio`, `time_in_market` and `probabilistic_sharpe_ratio`; the new additive keys
  `cagr_start` and `cagr_end`; and the allocator MWR (XIRR on a 365-day year).

## Environment

Run from the repo root of the checkout that holds this file.

```bash
export FM_SP="${FM_SP:-$HOME/.cache/quantalyze/figuremath-236}"; mkdir -p "$FM_SP"
set -o pipefail
QZ_MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
ROOT="$(git rev-parse --show-toplevel)"
# Fills <MARKER> (from the manifest, never retyped), <ENQ_AT>, <IDS> and <ID> (from the exported
# ENQ_AT, IDS and RECOVER_ID) into a copy of the SQL file; refuses a token whose variable is unset.
render() { node -e '
const fs = require("fs");
const [file, root] = process.argv.slice(1);
const marker = JSON.parse(fs.readFileSync(root + "/scripts/prod-prober/cron-manifest.json", "utf8")).database_marker;
const sq = (v) => String(v).replace(/\x27/g, "\x27\x27");
let s = fs.readFileSync(file, "utf8");
for (const [tok, val] of [["<ENQ_AT>", process.env.ENQ_AT], ["<IDS>", process.env.IDS], ["<ID>", process.env.RECOVER_ID]]) {
  if (s.includes(tok) && val === undefined) { process.stderr.write("render: " + tok + " needs its variable\n"); process.exit(1); }
  if (tok === "<IDS>" && s.includes(tok) && val === "") { process.stderr.write("render: IDS is empty, the bind bound nothing\n"); process.exit(1); }
}
s = s.split("<MARKER>").join(sq(marker)).split("<ENQ_AT>").join(sq(process.env.ENQ_AT))
     .split("<IDS>").join(process.env.IDS).split("<ID>").join(sq(process.env.RECOVER_ID));
process.stdout.write(s);' "$1" "$ROOT"; }
q() { render "$1" > "$1.run" && supabase db query --linked --agent no --workdir "$QZ_MAIN" -o csv -f "$1.run"; }
# Guards an allocator read (allocator-before or allocator-after) as the bind step guards before.csv:
# `q ... > file` creates the file even when the read fails, so STOP on no data row or on any row
# whose which_database is not the manifest marker, and print the data-row count.
guard_alloc() { python3 -I - "$FM_SP/$1.csv" "$ROOT" <<'PY' || { echo "STOP: $1.csv failed its guard"; return 1; }
import csv, json, sys
marker = json.load(open(f"{sys.argv[2]}/scripts/prod-prober/cron-manifest.json"))["database_marker"]
rows = list(csv.DictReader(open(sys.argv[1], newline="")))
if not rows or any(r.get("which_database") != marker for r in rows):
    print("STOP: %s is empty or carries a row without the manifest marker" % sys.argv[1]); sys.exit(1)
print("%s data rows=%d" % (sys.argv[1], len(rows)))
PY
}
```

- The Supabase CLI link (`supabase/.temp/project-ref`) exists only in the main checkout, and it
  targets PRODUCTION. `--agent no` pins plain CSV. If `--workdir` is refused, run the same command
  with the main checkout as the current directory.
- The CLI returns only the LAST statement's rows, so each form below is a single statement whose
  first column is the database marker. A file must not start with a `--` comment.
- `FM_SP` is outside the repo. Every CSV with a strategy id or an allocator id lives there and
  never in a tracked path. So do the `.run` files `q` writes: they carry the rendered marker and the
  bound ids. What goes into the CHANGELOG is counts and per-figure ratios only.
- Always `grep -a`. If `SUPABASE_DB_PASSWORD` is not exported and the CLI asks, read it from the
  macOS Keychain inline for that one command and never echo it.

## 1. Preconditions

1. Phases 233 and 234 are merged to `main` (234 is PR #1339). One re-derive covers the stored
   inputs they change, so it runs after both.
2. The Phase 236 merge is on `main`, and the analytics worker on Railway is running that merge's
   SHA (the recompute runs the worker's code, so an older worker would store version 2 again).
3. Re-check the 155.2 freeze, fresh (the re-derive may run days after the merge, so the answer
   can have changed). **The deciding input is the coordinator's WRITTEN confirmation of plan 12's
   state, taken now**: has plan 12's recapture not begun, is it done or in progress, and has plan 14
   closed the window. The SUMMARY files are a supporting signal only, because they land in records
   PRs AFTER the code, so a window can be open while both are still absent (`0` and `0` is then a
   false clear). `git fetch origin main`, then look for the two 155.2 SUMMARYs on `origin/main`:

   ```bash
   if ! git fetch origin main; then echo "STOP: fetch failed, origin/main is stale"
   elif T=$(git ls-tree -r --name-only origin/main -- .planning/phases/) && [ -n "$T" ]; then
     printf '%s\n' "$T" | grep -a -c '155.2-12-SUMMARY.md'
     printf '%s\n' "$T" | grep -a -c '155.2-14-SUMMARY.md'
   else echo "STOP: ls-tree failed or empty, no counts"; fi
   ```

   | Coordinator's written confirmation | Counts (12, 14) | Result |
   |---|---|---|
   | plan 12's recapture has not begun | `0` and `0` | Proceed: the Phase 236 merge landed BEFORE the recapture. |
   | plan 14 has closed the window | `1` and `1` | Proceed: the merge sits AFTER the window. |
   | the window is open (plan 12 done or in progress, plan 14 not) | `0` and `0`, or `1` and `0` | STOP. Wait, or return it as a blocker: a re-derive moves `computed_at`, which the window's recapture binds. |

   **STOP for any other combination**: no written confirmation, a confirmation that disagrees with
   the counts (including a lagging records PR: reconcile with the coordinator, do not guess), a pair
   not in the table (`0` and `1`, or any count above `1`), or a failed fetch. Record the written
   confirmation (who, when), the counts and `git rev-parse origin/main` in the plan's SUMMARY.

## 2. The marker query, first, alone

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

Compare the answer with `database_marker` in `scripts/prod-prober/cron-manifest.json`; never retype
it. **Abort on a NULL or on any answer that is not that marker.** `current_database()` is `postgres`
on both projects and proves nothing. Every form below repeats the marker as its first column; a
changed answer in any later read means STOP. Every WRITE form is also gated on the marker inside
the statement itself (`<MARKER>`, filled in by `render` from the manifest): on any other database it
selects nothing, enqueues nothing and prints `marker_ok = false` or returns no row, and no row back
from a WRITE form is a STOP, not "no work left".

## 3. The "before" read

One row per non-composite strategy that has an analytics row, **whatever its status or origin** (the
closing check compares each id's status before and after, so a row that is already failed must be
visible here), carrying every figure this phase moves, plus `asset_class` for the crypto /
traditional split and `key_exchange` (the exchange of the strategy's own API key; empty for a CSV
strategy, which has no key). A composite is excluded by the same predicate the staleness view uses
for `is_composite`: a `strategy_keys` row exists. Save it to scratch.

```sql
SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS which_database,
       sa.strategy_id,
       sa.computation_status,
       sa.computed_at,
       s.asset_class,
       s.status AS strategy_status,
       s.source AS strategy_source,
       ak.exchange AS key_exchange,
       sa.cagr, sa.sharpe, sa.sortino, sa.volatility, sa.calmar,
       sa.metrics_json->>'cvar' AS cvar,
       sa.metrics_json->>'serenity_index' AS serenity_index,
       sa.metrics_json->>'common_sense_ratio' AS common_sense_ratio,
       sa.metrics_json->>'smart_sharpe' AS smart_sharpe,
       sa.metrics_json->>'smart_sortino' AS smart_sortino,
       sa.metrics_json->>'time_in_market' AS time_in_market,
       sa.metrics_json->>'probabilistic_sharpe_ratio' AS probabilistic_sharpe_ratio,
       sa.metrics_json->>'alpha' AS alpha,
       sa.metrics_json->>'cagr_start' AS cagr_start,
       sa.metrics_json->>'cagr_end' AS cagr_end,
       sa.metrics_json->>'figure_defs_version' AS figure_defs_version
  FROM public.strategy_analytics sa
  JOIN public.strategies s ON s.id = sa.strategy_id
  LEFT JOIN public.api_keys ak ON ak.id = s.api_key_id
 WHERE NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id)
 ORDER BY sa.strategy_id;
```

```bash
q "$FM_SP/before.sql" > "$FM_SP/before.csv"
```

The allocator MWR (XIRR), same discipline:

```sql
SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS which_database,
       aed.allocator_id,
       aed.computed_at,
       aed.payload->'scalars'->>'mwr' AS mwr
  FROM public.allocator_equity_derived aed
 WHERE aed.kind = 'equity_curve'
 ORDER BY aed.allocator_id;
```

```bash
q "$FM_SP/allocator-before.sql" > "$FM_SP/allocator-before.csv"
guard_alloc allocator-before
```

`guard_alloc` (defined in the Environment block) STOPs, and nothing after it runs, when
`allocator-before.csv` has no data row or any row's `which_database` is not the manifest marker. An
empty file is what a failed read leaves, and it would make the section 5 allocator gate and the
section 6 MWR number-to-null STOP pass with nothing to compare. Zero data rows is a STOP unless the
coordinator confirms in writing that PROD has no `equity_curve` row. Write the printed row count
down: section 5 reads against it.

Take both reads before the first enqueue. Then record the time, once:

```bash
export ENQ_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

and **bind the target set**: the ids of `before.csv` whose status is complete or complete with
warnings, minus any id listed in `$FM_SP/out-of-scope.txt` (one id per line; the file does not exist
until the coordinator has taken a strategy out of scope in writing, see section 3a). Every closing
check reads this bound set (`bound-ids.txt` and `IDS`), so a strategy created or failed after this
point cannot move the result. The step also prints, to the terminal, the bound count per key
exchange and the count of rows left outside the set per status. Read both: a venue that should be in
the fleet and shows no row is a STOP (the population is wrong), and the outside-the-set counts go
into the plan's SUMMARY. This step is safe to re-run after `out-of-scope.txt` changes; it does not
touch `ENQ_AT`.

The step STOPs (prints a `STOP:` line and binds nothing; `IDS` is left unset, or set-and-empty in zsh, which `render` refuses) when `before.csv` has no data row (a
failed or empty read leaves an empty file, because `q ... > before.csv` creates it either way), when
any row's `which_database` is not the manifest marker, or when the bound set is empty. Pasted as a
block it still ends with `export IDS`, which returns 0, so read the `STOP:` line, not the exit status.

```bash
IDS="$(python3 -I - "$FM_SP" "$ROOT" <<'PY'
import collections, csv, json, os, sys
ok = {"complete", "complete_with_warnings"}
sp = sys.argv[1]
marker = json.load(open(f"{sys.argv[2]}/scripts/prod-prober/cron-manifest.json"))["database_marker"]
oos = set()
if os.path.exists(f"{sp}/out-of-scope.txt"):
    with open(f"{sp}/out-of-scope.txt") as f:
        oos = {l.strip() for l in f if l.strip() and not l.startswith("#")}
rows = list(csv.DictReader(open(f"{sp}/before.csv", newline="")))
if not rows:
    print("STOP: before.csv has no data row, the before read failed or came back empty", file=sys.stderr)
    sys.exit(1)
wrong = sum(1 for r in rows if r.get("which_database") != marker)
if wrong:
    print("STOP: %d row(s) of before.csv do not carry the manifest marker" % wrong, file=sys.stderr)
    sys.exit(1)
bound = [r for r in rows if r["computation_status"] in ok and r["strategy_id"] not in oos]
if not bound:
    print("STOP: the bound set is empty", file=sys.stderr)
    sys.exit(1)
with open(f"{sp}/bound-ids.txt", "w") as f:
    f.write("".join(r["strategy_id"] + "\n" for r in bound))
by_ex = collections.Counter(r["key_exchange"] or "(csv, no key)" for r in bound)
outside = collections.Counter(r["computation_status"] for r in rows if r["computation_status"] not in ok)
print("bound=%d out_of_scope=%d" % (len(bound), len(oos)), file=sys.stderr)
print("bound per key_exchange: " + ", ".join(f"{k}={v}" for k, v in sorted(by_ex.items())), file=sys.stderr)
print("outside the set per status: " + (", ".join(f"{k}={v}" for k, v in sorted(outside.items())) or "none"), file=sys.stderr)
print(",".join("'" + r["strategy_id"] + "'" for r in bound))
PY
)" || { unset IDS; echo "STOP: the bind step failed"; false; }
[ -n "$IDS" ] || { unset IDS; echo "STOP: IDS empty"; false; }
export IDS
```

A STOP here means no later step runs: `render` refuses a missing or empty `IDS`, but only this
guard says why. Count the data rows of `bound-ids.txt` and write the number down: it is what
sections 3a, 4 and 5 are read against.

## 3a. Pre-flight: can every target be recomputed? (read-only, STOP rule)

A re-derive that cannot compute does not leave the row alone. The batch job is unmarked (see
section 4), so `run_csv_strategy_analytics` stamps the row `failed` and the strategy stops being
published; a failed row then drops out of every target query. So prove, before the first enqueue,
that no target is one of the cases that fail. This reads the bound set (`IDS`, section 3), so it
covers every kind of strategy in it: CSV uploads and key-backed strategies on every venue. The cases,
read from `compute_analytics_from_csv`
(`run_compute_analytics_from_csv_job` in `job_worker.py`, which calls `run_csv_strategy_analytics`
in `analytics_runner.py`):

| Condition in the code | Result | Pre-flighted below |
|---|---|---|
| fewer than 2 `csv_daily_returns` rows (`CsvInsufficientHistory`) | row stamped `failed`, permanent | yes: finite-row count |
| fewer than 2 FINITE rows (`derive_basis_series` raises on them, the catch-all stamps the row) | `failed`, job `failed_retry` | yes, same count (NaN and infinities excluded) |
| `returns_denominator_config` malformed (`parse_returns_denominator_config` / `metrics_day_basis`, `ReturnsDenominatorConfigError`) | `failed`, permanent | partly: every target that carries a config is listed for an offline parse |
| more than `_SERIES_PAGE_SIZE` x `_SERIES_HARD_CAP_PAGES` (1,000,000) rows (`PaginatedSelectTruncated`) | `failed`, permanent | no: not reachable by a daily series |
| any other exception while computing or persisting (the catch-all, "CSV analytics computation failed.") | `failed`, job `failed_retry` | no: cannot be read ahead; the batch size, the stop rule and Recovery cover it |

Every failure stamp also deletes the persisted cash series row (`_heal_delete_cash_series`).

```sql
WITH t AS (
  SELECT sa.strategy_id,
         s.returns_denominator_config AS cfg,
         (SELECT count(*) FROM public.csv_daily_returns c
           WHERE c.strategy_id = sa.strategy_id
             AND c.daily_return NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)) AS finite_rows
    FROM public.strategy_analytics sa
    JOIN public.strategies s ON s.id = sa.strategy_id
   WHERE sa.strategy_id = ANY (ARRAY[<IDS>]::uuid[])
     AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id)
     AND sa.computation_status IN ('complete', 'complete_with_warnings')
     AND (sa.metrics_json->>'figure_defs_version') IS DISTINCT FROM '3'
)
SELECT m.which_database,
       (SELECT count(*) FROM t) AS targets,
       x.strategy_id, x.reason, x.finite_rows
  FROM (SELECT shobj_description(oid, 'pg_database') AS which_database
          FROM pg_database WHERE datname = current_database()) m
  LEFT JOIN (
    SELECT strategy_id, finite_rows,
           CASE WHEN finite_rows < 2 THEN 'under_two_rows'
                ELSE 'has_denominator_config' END AS reason
      FROM t
     WHERE finite_rows < 2 OR (cfg IS NOT NULL AND cfg <> '{}'::jsonb)
  ) x ON TRUE
 ORDER BY x.strategy_id;
```

Read the result:

- A row with `strategy_id` empty means no target is listed. Proceed.
- Any `under_two_rows`: **STOP.** That strategy would be un-published by the first batch that
  selects it. **This runbook has no safe enqueue path for it:** the tail has no series to compute
  from. Return it to the coordinator as a blocker; its series has to be rebuilt first, by the
  strategy's own path. For a key-backed strategy that path is the chain head `derive_broker_dailies`
  (an exchange crawl that rewrites the strategy's `csv_daily_returns` and then chains the tail), which
  the daily sync already enqueues for any strategy with new trades; a strategy it does not reach
  (a revoked key, no new trades) is a manual step for the coordinator. For a CSV upload with under 2
  rows the owner has to upload again; for any strategy with stored analytics but no series (an old
  trades-path or imported row) there is nothing to rebuild from here. Do not enqueue until the count
  is zero or the coordinator has explicitly taken that strategy out of scope in writing. Taking it
  out of scope means: append its id to `$FM_SP/out-of-scope.txt`, re-run the bind step of section 3
  (it re-reads the file and rewrites `IDS` and `bound-ids.txt`), and re-run this query. Record the
  count (never the id) of such strategies in the plan's SUMMARY, and FIG-05 stays pending for them.
- Any `has_denominator_config`: the SQL cannot judge a config's dates, ordering or amounts. Parse
  each listed config offline with `parse_returns_denominator_config` from
  `analytics-service/services/allocated_capital.py` (read-only, no database access from the parser).
  A `ReturnsDenominatorConfigError` means the job would fail: STOP for that strategy as above. The
  configs hold capital amounts: scratch only.

## 4. The enqueue path, traced

All of these are the product's own enqueue functions. There is no hand `UPDATE` anywhere in this
runbook, and none is allowed.

Every strategy kind that holds a stored `metrics_json` is recomputed by one kind of job, because
the stored figures of every kind are written by the same last hop. `run_csv_strategy_analytics` reads
only the strategy-keyed `csv_daily_returns` rows (`_load_strategy_daily_returns`, `.eq("strategy_id", ...)`),
and each origin leaves them there: a CSV upload writes them directly, and every broker key (the
`derive_broker_dailies` path is gated on `strategies.api_key_id IS NOT NULL`, whatever the venue)
writes its dense daily series to them before chaining the tail
(`JOB_CHAIN_FOLLOW_ON`: `derive_broker_dailies` to `compute_analytics_from_csv`, which is
chain-terminal).

| Kind of strategy (how to tell, in `before.csv`) | What recomputes its stored figures | Covered by `compute_analytics_from_csv`? | Path in this runbook |
|---|---|---|---|
| CSV upload (`key_exchange` empty, no `strategy_keys` row) | the tail alone: it has no derive hop, the series is the upload | yes | `enqueue_compute_job(p_strategy_id := <id>, p_kind := 'compute_analytics_from_csv')` |
| Binance, OKX, Bybit key strategy (`key_exchange` is that venue) | the tail over the series the last `derive_broker_dailies` stored; the daily sync re-enters the derive only for a strategy with new trades, so an idle strategy is never recomputed on its own | yes | the same call |
| Deribit, sFOX, MT5 key strategy | the tail, as above (the ledger fan-out also reaches these, but only when stale) | yes | the same call |
| Any other `key_exchange` value | the same tail: it reads only `csv_daily_returns` | yes, if it has at least 2 finite rows | the same call; name the value in the SUMMARY, it was not enumerated by this runbook's author |
| Composite (a `strategy_keys` row exists) | `stitch_composite` | out of scope (F-2) | none, excluded by the population |
| Stored analytics, under 2 finite rows in `csv_daily_returns` | nothing here: the tail would stamp it `failed` | no | none: the section 3a STOP, a manual step for the coordinator |
| Allocator keys (XIRR) | `derive_allocator_equity`, the crawl-free compose job (5 minute budget); it writes `allocator_equity_derived` kind `equity_curve`, and its `payload.scalars.mwr` is the stored XIRR | not a strategy: a different kind | nothing to run by hand: the daily `derive-allocator-key-dailies` cron (05:30 UTC) calls `enqueue_derive_broker_dailies_for_allocator_keys()` for every active key, and each finished key derive enqueues the compose from the worker's service-role client |

The tail recomputes the FIGURES from the stored series. It does not refresh the series: a key-backed
strategy whose last derive is old keeps that old series, now on figure-defs version 3. This runbook
moves the figure math, not the inputs.

**The allocator compose cannot be enqueued from this CLI.** `enqueue_compute_job(p_allocator_id := ...)`
accepts a caller only when `auth.role() = 'service_role'` or `p_allocator_id = auth.uid()`; the CLI
session is neither, so it raises 42501 (`insufficient_privilege`). The only caller with that role is
the worker, and this runbook does not forge a role claim to get past the gate. The default is to wait
for the cron and read the allocator gate in section 5 after the next 05:30 UTC tick plus the derives'
run time.

If the coordinator needs it earlier, the product's own entry is the function the cron calls. It has
no role gate (it enqueues key-scoped `derive_broker_dailies` jobs, an exchange crawl for EVERY active
allocator key, the same load as the cron). Its idempotency key is per UTC day, so a call after that
day's tick should add nothing for keys the tick already enqueued; it is only useful before 05:30 UTC.
Gated on the marker; no row back means STOP:

```sql
SELECT m.which_database, public.enqueue_derive_broker_dailies_for_allocator_keys() AS called
  FROM (SELECT shobj_description(oid, 'pg_database') AS which_database
          FROM pg_database WHERE datname = current_database()) m
 WHERE m.which_database = '<MARKER>';   -- WRITE
```

The precedent for the strategy rows is the OKXHISTORY close-out in `okxhistory-go-live.md`
("Run the recompute yourself ... through the product's own guarded path: `enqueue_compute_job` with
kind `compute_analytics_from_csv`"). From the CLI the strategy branch passes because `_assert_owner`
returns when `auth.uid()` is NULL, which is the service-role path.

**Do not use `enqueue_ledger_refresh_for_strategies()` for this.** It is a staleness-gated refresher,
not a fleet re-derive, and it is blind to every CSV and Binance, OKX and Bybit strategy (the same
view scope as above): it admits only stale ledger-venue strategies, at most 4 per tick and 2 per venue, behind a
20 hour attempt cooldown that becomes 7 days under the weekly cap (the no-advance cap and the
paused-marks cap), it enqueues `derive_broker_dailies` (an exchange crawl that then chains into the
same `compute_analytics_from_csv`), and it is dormant unless `system_flags.ledger_refresh_enabled`
is TRUE. Using it would both miss every non-stale strategy and recompute the stale ones twice. The
weekly cap is that function's own throttle; the explicit enqueue below is not subject to it, which
is why it is paced by hand.

**Order, so no row recomputes twice.** The target set is the bound set (section 3)
narrowed by the version: a bound strategy is a target while its stored `figure_defs_version` is not 3. Any recompute, this
runbook's or the nightly chain's, flips it to 3 and takes it out of the target set. Two further
exclusions keep a row from being picked forever: rows with a job already in flight are skipped, and
so is every row that already has ANY job tagged `figuremath-236-rederive` (whatever its status), so a
row whose job ended `done` but whose version is still not 3 is never re-selected. Such a row is a
STOP, not a retry (see Recovery). Then:

1. Strategies (CSV and every venue's key-backed strategies together, one function): batches of 10 as below.
2. Allocators: the daily cron, as above. Step 1 does not change the allocator's inputs, so the order
   between them is free; strategies first only so the factsheet rows land before the allocator
   payloads are read.

Pace: a batch of 10, then wait until the batch has no job in flight, then read the outcome, then the
next. Save each batch's one-row result as `$FM_SP/batch-<n>.csv`. **Stop on any of:** `marker_ok`
false or no row back; `tagged_total` of the batch outcome (below) differing from the running sum of
`selected` over the `batch-<n>.csv` files; the first `failed_retry` or `failed_final`; an
`ids_not_done` that is still not empty once the batch has drained. The job carries no ledger-refresh marker (same as the OKXHISTORY
recompute), so a failure on a published strategy takes the runner's loud path, which stamps the
analytics row failed. That is why the batch is small and the stop rule is strict. For the same reason
the SQL status bridge (`sync_strategy_analytics_status`, branch (a)) reads a plain `complete` row as
`computing` while its job is in flight, per its documented behaviour (not observed here): a strategy
in the batch is not shown as complete until its job ends.

**What this path rewrites.** The tail `compute_analytics_from_csv` rewrites the cash headline
(`metrics_json` and the headline columns) and the `cash_settlement` series row. The
`mark_to_market` and `smoothed_mtm` entries of `metrics_json_by_basis` are written by the derive
hop (`derive_broker_dailies`), which this path does not run. For a strategy with those bases they stay
on the old rules until its next derive hop (the nightly chain when it syncs new trades, or the ledger
fan-out), and until then the factsheet reads computed figures for those bases through the same
version gate (`overlayStoredFigureDefs`, per basis). If the coordinator wants them moved at once,
enqueue `derive_broker_dailies` for those strategies instead; it chains into the same tail, so do
not also enqueue the tail for them. Section 5 reports how many rows still carry an old per-basis
version, as information and not as a done gate.

**The batch tag is deliberately not a refresh marker.** `source = 'figuremath-236-rederive'` is
none of the two values the SQL status bridge, `_record_enqueue_dedup` and the worker recognise as a
marked refresh (`'ledger-refresh'` and `'ledger-refresh-composite'`, compared exactly), so all
three read this job as unmarked and agree on a failure. Do not reuse either marker value.

**Attempt cooldown (Deribit, sFOX and MT5 strategies only).** Each explicit enqueue is an attempt the
ledger fan-out's 20 hour cooldown reads (`compute_analytics_from_csv` jobs count), so a re-derived
ledger-venue strategy skips its next fan-out tick. Run the batches after the daily tick, not just
before it. CSV and Binance, OKX and Bybit strategies are not in that fan-out and read no such
cooldown.

### Targets still to do

This set is the bound set (the complete-status rows of every non-composite strategy, minus any
out-of-scope id) only on purpose: a failed or pending row has no stored figures to move. Section 3
printed the count of rows outside it per status, and the SUMMARY records them.

```sql
SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS which_database,
       count(*) AS targets
  FROM public.strategy_analytics sa
 WHERE sa.strategy_id = ANY (ARRAY[<IDS>]::uuid[])
   AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = sa.strategy_id)
   AND sa.computation_status IN ('complete', 'complete_with_warnings')
   AND (sa.metrics_json->>'figure_defs_version') IS DISTINCT FROM '3'
   AND NOT EXISTS (SELECT 1 FROM public.compute_jobs cj
                    WHERE cj.strategy_id = sa.strategy_id
                      AND (cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
                           OR (cj.kind = 'compute_analytics_from_csv'
                               AND cj.metadata->>'source' = 'figuremath-236-rederive')));
```

### One batch (WRITE)

Gated on the marker: on any other database `sel` is empty, the statement enqueues nothing and prints
`marker_ok = false`. The statement returns ONE row; `enqueued` counts the non-null job ids the
enqueue function returned, `selected` the ids it was called for. `enqueued` is NOT a stop signal:
`enqueue_compute_job` returns the id of an existing pending, running or done_pending_children job
on a dedup hit (`_enqueue_compute_job_internal`, both look-ups) and raises on a lost race, so
`enqueued` equals `selected` even when nothing new was enqueued for an id. The batch outcome below
counts the jobs that exist instead.

```sql
WITH m AS (
  SELECT shobj_description(oid, 'pg_database') AS which_database
    FROM pg_database WHERE datname = current_database()
), sel AS (
  SELECT sa.strategy_id
    FROM public.strategy_analytics sa
   WHERE (SELECT which_database FROM m) = '<MARKER>'
     AND sa.strategy_id = ANY (ARRAY[<IDS>]::uuid[])
     AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = sa.strategy_id)
     AND sa.computation_status IN ('complete', 'complete_with_warnings')
     AND (sa.metrics_json->>'figure_defs_version') IS DISTINCT FROM '3'
     AND NOT EXISTS (SELECT 1 FROM public.compute_jobs cj
                      WHERE cj.strategy_id = sa.strategy_id
                        AND (cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
                             OR (cj.kind = 'compute_analytics_from_csv'
                                 AND cj.metadata->>'source' = 'figuremath-236-rederive')))
   ORDER BY sa.strategy_id
   LIMIT 10
), enq AS (
  SELECT sel.strategy_id,
         public.enqueue_compute_job(
           p_strategy_id := sel.strategy_id,
           p_kind        := 'compute_analytics_from_csv',
           p_metadata    := jsonb_build_object('source', 'figuremath-236-rederive', 'enqueued_at', now())
         ) AS job_id
    FROM sel
)
SELECT m.which_database,
       (m.which_database = '<MARKER>') AS marker_ok,
       (SELECT count(*) FROM sel) AS selected,
       (SELECT count(job_id) FROM enq) AS enqueued
  FROM m;   -- WRITE
```

Stop if `marker_ok` is false, if the statement raises, or if `selected` is 0 while the
"Targets still to do" count is not. Repeat until the targets count is 0.

### Batch outcome

Run after each batch drains. It lists every job of this run by status, names the ids of any job
that is not `done`, and carries `tagged_total`, the count of jobs tagged `figuremath-236-rederive`
across ALL statuses (the retry tag is not part of any batch):

```sql
SELECT m.which_database,
       cj.status, count(cj.id) AS jobs,
       (SELECT count(*) FROM public.compute_jobs t
         WHERE t.kind = 'compute_analytics_from_csv'
           AND t.metadata->>'source' = 'figuremath-236-rederive') AS tagged_total,
       string_agg(cj.strategy_id::text, ' ' ORDER BY cj.strategy_id) FILTER (WHERE cj.status <> 'done') AS ids_not_done
  FROM (SELECT shobj_description(oid, 'pg_database') AS which_database
          FROM pg_database WHERE datname = current_database()) m
  LEFT JOIN public.compute_jobs cj
    ON cj.kind = 'compute_analytics_from_csv'
   AND cj.metadata->>'source' IN ('figuremath-236-rederive', 'figuremath-236-rederive-retry')
 GROUP BY m.which_database, cj.status
 ORDER BY cj.status;
```

Then compare `tagged_total` (the same value on every row) with the running sum of `selected` over
every `batch-<n>.csv` so far. A mismatch is a STOP: a short count means an id was deduplicated
onto a job this runbook did not create (or a tagged job vanished), a long count means tagged jobs
exist that no saved batch accounts for. The check also refuses an unusable batch file:

```bash
python3 -I - "$FM_SP" <<'PY'
import csv, glob, sys
sel = 0
files = sorted(glob.glob(f"{sys.argv[1]}/batch-*.csv"))
for fn in files:
    rows = list(csv.DictReader(open(fn, newline="")))
    if len(rows) != 1 or rows[0]["marker_ok"] not in ("true", "t"):
        print("STOP: %s is not one row with marker_ok true" % fn); sys.exit(1)
    sel += int(rows[0]["selected"])
print("batches=%d sum_selected=%d  (must equal tagged_total)" % (len(files), sel))
PY
```

Expected: `done` only, with `pending` and `running` draining to zero and `ids_not_done` empty. A
`pg_net` cron "success" only means a job was queued, and `last_sync_at` says nothing about this;
neither is evidence. The verification below is.

### Recovery: a row this run stamped failed

A job that fails stamps the strategy's analytics row `failed`, which un-publishes the strategy until a
later job for it succeeds. There is no other way back: do not `UPDATE` the row. First name the ids and
the cause (scratch only; `last_error` is the operator column and can hold raw detail):

```sql
SELECT m.which_database, x.strategy_id, x.job_status, x.error_kind, x.last_error,
       x.computation_status, x.computation_error
  FROM (SELECT shobj_description(oid, 'pg_database') AS which_database
          FROM pg_database WHERE datname = current_database()) m
  LEFT JOIN (
    SELECT cj.strategy_id, cj.status AS job_status, cj.error_kind, cj.last_error,
           sa.computation_status, sa.computation_error
      FROM public.compute_jobs cj
      LEFT JOIN public.strategy_analytics sa ON sa.strategy_id = cj.strategy_id
     WHERE cj.kind = 'compute_analytics_from_csv'
       AND cj.metadata->>'source' IN ('figuremath-236-rederive', 'figuremath-236-rederive-retry')
       AND (cj.status = 'failed_retry' OR sa.computation_status = 'failed')
  ) x ON TRUE
 ORDER BY x.strategy_id;
```

1. **Stop the batches.** Do not select further batches while a failed id is unexplained.
2. **Read the cause.** "Insufficient CSV history" means the series has under 2 rows (the pre-flight
   should have stopped it). "CSV analytics computation failed." is the catch-all: read the job's
   `last_error` and the analytics worker's log line `csv analytics failed for <id>`. A malformed
   denominator config is a permanent failure with its own sentence.
3. **Fix the cause by the strategy's own path** (rebuild or re-derive the series, correct the config),
   not by editing analytics rows.
4. **Wait for the failed job to be terminal** (`failed_final`) before enqueuing again; do not enqueue
   beside a `failed_retry`.
5. **Re-enqueue the same kind for that one id**, with a source tag the target query does not exclude
   (`figuremath-236-rederive-retry`, also not a refresh marker). Set `RECOVER_ID` to the id and run:

   ```sql
   SELECT m.which_database, public.enqueue_compute_job(
            p_strategy_id := '<ID>'::uuid,
            p_kind        := 'compute_analytics_from_csv',
            p_metadata    := jsonb_build_object('source', 'figuremath-236-rederive-retry', 'enqueued_at', now())
          ) AS job_id
     FROM (SELECT shobj_description(oid, 'pg_database') AS which_database
             FROM pg_database WHERE datname = current_database()) m
    WHERE m.which_database = '<MARKER>';   -- WRITE
   ```

   When that job reaches `done`, the status bridge ignores the older `failed_final` of the same kind
   (a failed job poisons the strategy only until a strictly later `done` of the same strategy and
   kind), and the row returns to complete.
6. **If the cause cannot be fixed now**, the strategy stays failed and unpublished. Record the count
   (never the id) and return it to the coordinator as a blocker; it cannot close FIG-05 as done.
7. A row whose job is `done` but whose version is still not 3 is not retried either: stop and read
   the worker log for that id first.

## 5. Verification

Freshness is `strategy_analytics.computed_at`, never `last_sync_at`. The read covers the bound set
(`IDS`, fixed in section 3), whatever status those rows have now, so a failed recompute cannot leave
the population and read as done, and a strategy created after the bind cannot disturb it:

```sql
SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS which_database,
       array_length(ARRAY[<IDS>]::uuid[], 1) AS bound,
       count(*) AS bound_found,
       count(*) FILTER (WHERE sa.computation_status NOT IN ('complete', 'complete_with_warnings')) AS left_complete_set,
       count(*) FILTER (WHERE sa.computation_status IN ('complete', 'complete_with_warnings')
                          AND sa.metrics_json->>'figure_defs_version' = '3'
                          AND sa.computed_at > '<ENQ_AT>'::timestamptz) AS rederived,
       count(*) FILTER (WHERE sa.computation_status IN ('complete', 'complete_with_warnings')
                          AND sa.metrics_json->>'figure_defs_version' IS DISTINCT FROM '3') AS still_old,
       count(*) FILTER (WHERE jsonb_path_exists(sa.metrics_json_by_basis, '$.**.figure_defs_version ? (@ < 3)')) AS old_per_basis
  FROM public.strategy_analytics sa
 WHERE sa.strategy_id = ANY (ARRAY[<IDS>]::uuid[]);
```

`<ENQ_AT>` and `<IDS>` are filled in by `render` from the exported `ENQ_AT` and `IDS`.

Then take the "after" capture (the section 3 reads again, into `after.csv` and
`allocator-after.csv`), run `guard_alloc allocator-after` right after taking the second file
(the same STOP: no data row, or a row without the manifest marker, and zero rows after is a STOP
unless the coordinator confirmed in writing that PROD has no `equity_curve` row), and run the per-id status diff over `bound-ids.txt`, the set section 3 bound
(every kind of strategy, minus out-of-scope ids). It fails (exit 1) on any id of the bound set
that is missing from `after.csv`, is no longer complete or complete with warnings, or is not on
version 3, and it names the id:

```bash
python3 -I - "$FM_SP" <<'PY'
import csv, sys
ok = {"complete", "complete_with_warnings"}
def rows(name):
    with open(f"{sys.argv[1]}/{name}.csv", newline="") as f:
        return {r["strategy_id"]: r for r in csv.DictReader(f)}
after = rows("after")
with open(f"{sys.argv[1]}/bound-ids.txt") as f:
    bound = [l.strip() for l in f if l.strip()]
if not bound:
    print("STOP: bound-ids.txt is empty, nothing was bound")
    sys.exit(1)
bad = []
for i in bound:
    a = after.get(i)
    if a is None:
        bad.append((i, "missing from after"))
    elif a["computation_status"] not in ok:
        bad.append((i, "status " + a["computation_status"]))
    elif a["figure_defs_version"] != "3":
        bad.append((i, "version " + a["figure_defs_version"]))
print(f"bound={len(bound)} not_done={len(bad)}")
for i, why in bad:
    print(i, why)
sys.exit(1 if bad else 0)
PY
```

Done means all of these hold:
- the diff above exits 0, and in the SQL read `bound_found = bound`, `left_complete_set = 0` and
  `still_old = 0`, with `bound` a number (NULL means an empty bind) equal to the row count of
  `bound-ids.txt`. A strategy the nightly chain recomputed first is on version 3 with an earlier
  `computed_at` than `ENQ_AT`; it is done through `still_old`, not through `rederived`;
- the bind step's per-`key_exchange` counts are in the SUMMARY and show every venue the coordinator
  expects (CSV, binance, okx, bybit, deribit, sfox, mt5 as far as the fleet has them), the counts
  outside the set per status are recorded, and the number of out-of-scope strategies is recorded
  (never their ids), each with its written approval;
- every `batch-<n>.csv` has `marker_ok` true, the final `tagged_total` equals the sum of `selected`
  over the batches, and every batch outcome was `done` with `ids_not_done` empty (a recovered id
  counts once its retry job is `done`);
- the allocator gate below returns `not_rederived = 0`.

`old_per_basis` is information: it counts rows whose mark-to-market or smoothed entry still carries a
version below 3 (see "What this path rewrites"). It is not zero straight after this runbook, and it
falls as derive hops run.

For the allocators the gate has a failure condition. Every `equity_curve` row must carry a
`computed_at` after `ENQ_AT`, and none may have gone missing:

```sql
SELECT shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS which_database,
       count(*) AS equity_curve_rows,
       count(*) FILTER (WHERE aed.computed_at <= '<ENQ_AT>'::timestamptz) AS not_rederived,
       string_agg(aed.allocator_id::text, ' ' ORDER BY aed.allocator_id)
         FILTER (WHERE aed.computed_at <= '<ENQ_AT>'::timestamptz) AS not_rederived_ids
  FROM public.allocator_equity_derived aed
 WHERE aed.kind = 'equity_curve';
```

This gate checks freshness only; an MWR that went to null is read in section 6, where it is a
STOP. Done: `not_rederived = 0`, and `equity_curve_rows` is at least the number of data rows in
`allocator-before.csv` (the count `guard_alloc` printed, which is never 0 once the guard passed). Until the cron's next 05:30 UTC tick has
run and its derives have drained, `not_rederived` is non-zero by construction: wait and re-run, it is
not a verdict. An allocator that stays listed after that has no key the cron reaches (for example no
active key): each such id must be explained to the coordinator, not ignored, and FIG-05's allocator
half stays pending for it.

## 6. The "after" read and the CHANGELOG diff

Use `after.csv` and `allocator-after.csv` from section 5. In scratch, join `before` and `after` on
the id and produce, per figure, only these aggregates: how many strategies changed, and the minimum,
median and maximum of `after / before` over the strategies where both are present and the before
value is not zero. The figures are `volatility`, `sharpe`, `sortino`, `cagr`, `calmar`, `cvar`,
`serenity_index`, `common_sense_ratio`, `smart_sharpe`, `smart_sortino`, `time_in_market` and
`probabilistic_sharpe_ratio`. Plus:

- for EVERY figure above and for the allocator MWR, two counts: strategies (allocators) that went
  from a number to null, and from null to a number (an empty CSV cell is null; an allocator with a
  numeric MWR in `allocator-before.csv` and no row in `allocator-after.csv` counts as number-to-null). The ratio
  aggregates skip any pair with a null side, so a figure that drops to null leaves the ratio
  looking healthy and only these counts show it. A number-to-null count above zero is a STOP, for
  `cvar` too: name each id (scratch only) and the cause, and the coordinator accepts it in writing
  before FIG-05 closes. The one expected cause is `cvar` on a series under 60 observations;
  any other figure going to null is unexpected. Record the counts (never the ids);
- for `smart_sharpe` and `smart_sortino`, the median ratio split on the `asset_class` column: crypto
  (expected near 1.2035, which is sqrt(365/252)) and every other class (expected 1);
- `cagr_start` and `cagr_end` are new: report how many rows carry each;
- for the allocator MWR, the same ratio aggregates from `allocator-before.csv` and
  `allocator-after.csv` (the log-rate scales by 365 / 365.25).

Those aggregates are the "figures that moved, for real" paragraph of the ship's CHANGELOG entry.
Never write an id, an email, an account number or a project ref into a tracked file.

## 7. Closing FIG-05

FIG-05 closes when sections 5 and 6 are recorded: the marker line, the freeze side (with the
coordinator's written confirmation), the per-figure and MWR number-to-null and null-to-number
counts (every number-to-null explained in writing), the per-batch
`selected` and `enqueued` counts and outcomes, the per-id diff result, `still_old = 0`, the
allocator gate, and the per-figure aggregates. Until then it stays pending.
