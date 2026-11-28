# Runbook — OKX archive fills backfill (OKXARCHIVEFILLS, Phase 259)

**Owner:** the orchestrator runs the live ops (PROD writes are authorized, founder 2026-10-03); the
founder is told what was written and decides at any no-go · **Audience:** whoever calibrates,
backfills, re-runs or rolls back the archive-fills read, months from now, with no memory of this
phase · **Risk:** `fills_apply` inserts rows into `trades` (`is_fill`, `exchange = 'okx'`) for every
affected OKX strategy. The rows are tagged and a rerun inserts nothing, but the mapping from OKX's
bills archive to a fill is a costly decision to undo (section 15).

**Two rules to read first.**

- **Ids never go into tracked text.** Every strategy and key is named by ORDINAL, derived by the SQL
  at run time. No id, email, account number, uid or home path appears in this file, in a note, or in
  the SUMMARY. The statements below take an ordinal (`<N>`) and a run label (`<RUN>`) typed by the
  operator and nothing else.
- **The Q3 2026 overlap with `fills-history` closes about 2026-12-29.** The calibrate proves the
  archive-to-fill mapping by comparing the archive's trade bills with the fills OKX's
  `fills-history` endpoint still serves for the same days. That endpoint reaches back about three
  months, so each day the overlap shrinks, and from about 2026-12-29 the reconcile reads
  `window_empty` and the mapping can no longer be proven on real data. Run this before then.

## 1. Purpose and mechanism

OKX's `fills-history` endpoint serves only about the last three months of fills, so a strategy
whose track record starts earlier has no stored fills for its older quarters. Those fills are
recoverable only from OKX's bills archive (`bills-history-archive`, one file per ended quarter).
This runbook runs that recovery on PROD through the product's own path.

The capability is two modes of the existing compute job kind `okx_archive_rebuild` (no new kind, no
migration):

- **`fills_calibrate`** runs everything except the write: it derives its targets and quarters
  in-claim, requests and waits for the archive files, downloads and parses them, proves the running
  balance chains, maps the trade bills to fills, reconciles the mapping against the stored
  `fills-history` fills, reads each target's already stored rows, and ends `done` with one result
  object at `compute_jobs.metadata -> 'member_progress'`. It writes no `trades` row.
- **`fills_apply`** runs the same read and every same gate, plus the permanent stop
  `fills_legacy_mismatch`, and only when all of them pass for every target writes each target's
  archive fills in its window through the live ingestion's own upsert (`ignore_duplicates`, so the
  unique index absorbs a rerun). Written rows carry `raw_data.source = okx_bills_history_archive`.

Properties the rest of this file relies on:

- **All or nothing per read.** Every gate for every target is evaluated before the one write. A
  gate that fails ends the job with a named `stop_class` and writes nothing. A write batch that
  fails after others landed is the transient `fills_write_failed`; the retry is idempotent. Its
  detail reads `inserted_before_failure=<n>`, or `unknown` when a written target's count could not
  be read (the answer was not a list, or the claim budget ran out around a batch); then the PROD
  after-count is the authority, as for `info.inserted_count_unreadable`.
- **At most 4 quarters per job** (the named known gap `259-ARCHIVE-QUARTER-CAP`, section 14): the
  newest 4 needed quarters are read; older ones are listed in `info.over_cap_quarters`.
- **The job waits for OKX without holding a worker.** OKX builds a file in about 2 h (up to 3 at
  peak); a link lives 5.5 h; the job polls every 15 min, gives up 8 h after OKX's request time, and
  stops waiting 24 h after its own `created_at`. The apply budget is small: one quarter is
  requested at most twice ever (`FILLS_MAX_APPLIES_PER_QUARTER`), and the count is persisted in the
  result block so it survives a restart. Read the symbols at execution time; this file states no
  further number.
- **Targets are derived, never carried.** The job key's venue account decides which strategies are
  read: every non-archived strategy on a connected OKX key sharing that account. The enqueue carries
  `mode` (and, for the manual path in section 14, `quarters`) and nothing else.
- **No amounts in logs.** `last_error` reads `okx_archive_rebuild: <stop_class> ...` followed by
  counts and days only.

## 2. What deploy activates

The chain is live from the moment the analytics worker carrying Phase 259 is deployed. A clean OKX
`sync_trades` chains one `fills_apply` job on the syncing key when ALL of these hold
(`chain_okx_archive_fills`, `analytics-service/services/okx_archive_fills_chain.py`, read the symbol
at execution time):

- the strategy's first daily return is earlier than the write bound (one day above the
  `fills-history` reach floor);
- its earliest stored OKX fill is absent or more than 2 days after that first daily return;
- no `fills_apply` job in the last 14 days on ANY OKX key of the same venue account is in flight,
  done, or failed with a PERMANENT named stop: `last_error` starts `okx_archive_rebuild: ` and its
  class is neither `invalid_input` nor a transient class (`claim_budget_exceeded`, `link_expired`,
  `live_fetch_failed`, `fills_write_failed`, `fills_count_not_persisted`). A `fills_calibrate` never
  counts, and neither does a failure without a named stop, with a `last_error` from anywhere else,
  or one that ended on a transient class after its retries ran out: the next sync re-chains, and the
  idempotent upsert completes a partial write (each target's batches are written newest first, so the
  oldest fills are the ones a stopped write leaves for that re-chain).

So the first daily trade-sync tick after deploy MAY start a `fills_apply` before any calibrate
exists. That is safe in the sense that its gates are the calibrate's gates plus the
`fills_legacy_mismatch` stop (a stored row inside the read quarters that the archive contradicts,
lacks, or cannot be compared with), so it writes only when they pass. Two consequences:

- A named permanent stop (`fills_legacy_mismatch` included) ends that job `failed_final` and starts
  the account's 14-day chain cooldown. A transient class that ran its retries out ends `failed_final`
  too but does NOT start it. A manual enqueue is never blocked by the cooldown.
- **The first step after the marker is to look for such a job and read it instead of calibrating**
  (section 7).

The chain's own enqueue inside 00:00-01:45 UTC is deferred to 01:50 UTC the same day. After the
2026-12-29 expiry the reconcile reads `window_empty`; a `window_empty` read may still write for an
instType proven on a real file (`SWAP`) with the bal chain passing, and records that fact.

## 3. Preconditions

1. **The deployed worker carries the Phase 259 merge.** The analytics service `/health` `git_sha`
   contains the merge commit (the Railway deploy runs only after main CI is green; see
   `docs/runbooks/railway-worker.md`). An old worker ends an unknown mode `invalid_input`, which
   does not start the cooldown but spends nothing useful.
2. **Main CI is green on the merge commit**, bound to that commit's SHA with the expected check
   count.
3. **The time is outside 00:00-01:45 UTC** (the daily chain window shared with the OKXHISTORY
   runbook). Every enqueue statement below refuses inside it.
4. **Reads go through the Supabase MCP**, one query per call, never chained. Where the MCP is
   unavailable the CLI is the fallback, still one query per call. The CLI is linked to PRODUCTION
   (`CLAUDE.md`, "Which database am I on?"), which is why the marker below comes first.

## 4. Step 0 — the marker (every session, and before every write)

`current_database()` is `postgres` on both projects and proves nothing. Run this as its own call:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

The row must name PRODUCTION. NULL means the marker was lost: re-set it before writing, never
proceed on a guess. Anything else stops the session. Record the answer's first words in the log.

Every write statement in this file also carries its own guard as its first statement (a `DO` block
that raises unless the comment is present and names PRODUCTION), so a wrong database refuses even
if this step was skipped:

```sql
DO $guard$
BEGIN
  IF coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database
                WHERE datname = current_database()) NOT LIKE '%PRODUCTION%', true) THEN
    RAISE EXCEPTION 'marker query did not name PRODUCTION; refusing to continue';
  END IF;
  IF (now() AT TIME ZONE 'UTC')::time BETWEEN time '00:00' AND time '01:45' THEN
    RAISE EXCEPTION '00:00-01:45 UTC belongs to the daily chain; run this outside it';
  END IF;
END
$guard$;
```

Below this block is called **the guard**. A write statement is: the guard, then the enqueue, then
the readback, pasted as one text.

## 5. Step 1 — the universe (read only)

Lists every non-archived OKX strategy with an ordinal, whether its key is connected, whether its
key has a stored venue account (a boolean, never the value), its first daily return, a group number
showing which strategies share one venue account (a dense rank over the value, never the value),
and `target_position`, the 0-based position the job gives a strategy in its own target order (the
`position` in the result's `strategies` and `reconcile.strategies`). Ordinals are a `row_number()`
and not ids: a new or archived OKX strategy shifts them, so re-run this immediately before each
write and stop if the row count is not what you recorded.

```sql
WITH ou AS (
  SELECT s.id AS strategy_id, s.api_key_id AS key_id, s.status, k.venue_account_id AS acct,
         (k.is_active AND k.disconnected_at IS NULL AND k.sync_status IS DISTINCT FROM 'revoked') AS connected
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
SELECT row_number() OVER (ORDER BY ou.strategy_id) AS ordinal,
       ou.status, ou.connected,
       (ou.acct IS NOT NULL AND btrim(ou.acct) <> '') AS has_venue_account,
       CASE WHEN ou.acct IS NOT NULL AND btrim(ou.acct) <> '' THEN dense_rank() OVER (ORDER BY ou.acct) END AS account_group,
       CASE WHEN ou.connected AND ou.acct IS NOT NULL AND btrim(ou.acct) <> ''
            THEN row_number() OVER (PARTITION BY ou.acct, ou.connected ORDER BY ou.strategy_id) - 1 END AS target_position,
       (SELECT min(c.date) FROM csv_daily_returns c WHERE c.strategy_id = ou.strategy_id) AS first_daily_return
  FROM ou
 ORDER BY ordinal;
```

Record: the row count, which ordinals share an `account_group` (one archive file per quarter
serves all of them), and each one's `first_daily_return`. At booking there were three OKX
strategies, apparently on one account, first daily returns 2026-02-23 or 2026-04-30; re-read, do
not trust that line.

A strategy on a disconnected key is not a target: the job counts it in
`info.targets_skipped_disconnected` and reads the rest. A strategy with no first daily return has
state `no_anchor` and one whose first daily return is inside the `fills-history` reach has state
`anchor_in_reach`; neither is written, both are named in the result.

**The shared fragment.** The write statements below need the ordinal-to-id mapping, so each begins
with the same CTE (call it **the universe CTE**; paste it verbatim after the guard):

```sql
ou AS (
  SELECT s.id AS strategy_id, s.api_key_id AS key_id,
         row_number() OVER (ORDER BY s.id) AS ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
```

## 6. Step 2 — fills before (read only)

Per ordinal: how many OKX fills are stored, the earliest and latest, how many came from the
archive, and the earliest stored fill against the first daily return. Run it now, run it again at
step 8 and step 9, and report the three readings side by side.

```sql
WITH ou AS (
  SELECT s.id AS strategy_id,
         row_number() OVER (ORDER BY s.id) AS ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
SELECT ou.ordinal,
       count(t.id) AS fills,
       min(t.timestamp) AS earliest_fill,
       max(t.timestamp) AS latest_fill,
       count(t.id) FILTER (WHERE t.raw_data ->> 'source' = 'okx_bills_history_archive') AS archive_sourced,
       (SELECT min(c.date) FROM csv_daily_returns c WHERE c.strategy_id = ou.strategy_id) AS first_daily_return,
       min(t.timestamp)::date - (SELECT min(c.date) FROM csv_daily_returns c WHERE c.strategy_id = ou.strategy_id) AS earliest_fill_minus_first_return_days
  FROM ou
  LEFT JOIN trades t ON t.strategy_id = ou.strategy_id AND t.is_fill AND t.exchange = 'okx'
 GROUP BY ou.ordinal, ou.strategy_id
 ORDER BY ou.ordinal;
```

## 7. Step 3 — look for a chained job (read only)

Lists the archive jobs on any OKX key of the account in the last 24 hours, with the mode, status,
attempts, next attempt, and the class prefix of `last_error`. Replace `<N>` with an ordinal from
the step 1 group you are working on.

```sql
WITH ou AS (
  SELECT s.api_key_id AS key_id, k.venue_account_id AS acct,
         row_number() OVER (ORDER BY s.id) AS ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
SELECT j.created_at, j.metadata ->> 'mode' AS mode, j.status, j.attempts, j.max_attempts,
       j.next_attempt_at,
       substring(j.last_error from '^okx_archive_rebuild: ([a-z0-9_]+)') AS error_class,
       j.metadata -> 'member_progress' ->> 'stop_class' AS stop_class,
       j.metadata -> 'member_progress' -> 'info' ->> 'outcome' AS outcome
  FROM compute_jobs j
 WHERE j.kind = 'okx_archive_rebuild'
   AND j.created_at > now() - interval '24 hours'
   AND j.api_key_id IN (
         SELECT o.key_id FROM ou o
          WHERE o.acct IS NOT NULL AND o.acct = (SELECT o2.acct FROM ou o2 WHERE o2.ordinal = <N>))
 ORDER BY j.created_at DESC;
```

- **A `fills_apply` job exists:** its result IS the reading. Wait for it (`pending`, `running`,
  `done_pending_children` and `failed_retry` are all waiting) and go to step 6 (section 11) to read
  it. Do not calibrate, do not enqueue: a second enqueue while one is in flight returns the
  existing row.
- **It ended `failed_final` with a named class:** that is a STOP (see the stop table in section 9).
  Read it, return to the founder. Its cooldown stays on the chain; a manual enqueue is unaffected.
- **None:** go to step 4.

## 8. Step 4 — calibrate

Marker first (section 4), then the guard, the universe CTE, and the enqueue. Replace `<N>` with an
ordinal of the step 1 group and `<RUN>` with a UTC timestamp you type (letters, digits, `:`, `.`
and `-` only). The key is selected by ordinal inside the statement and never pasted; the
statement refuses when the universe no longer has the row count you recorded (`<UNIVERSE_ROWS>`).

```sql
-- the guard first (section 4), then:
DO $refuse$
BEGIN
  IF (SELECT count(*) FROM strategies s JOIN api_keys k ON k.id = s.api_key_id
       WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived') <> <UNIVERSE_ROWS> THEN
    RAISE EXCEPTION 'the OKX universe changed since step 1; re-read it';
  END IF;
END
$refuse$;
WITH ou AS (
  SELECT s.api_key_id AS key_id, row_number() OVER (ORDER BY s.id) AS ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
SELECT enqueue_compute_job(
  p_strategy_id := NULL,
  p_kind := 'okx_archive_rebuild',
  p_idempotency_key := 'okx-fills-calibrate-' || '<RUN>',
  p_metadata := jsonb_build_object('mode', 'fills_calibrate'),
  p_api_key_id := (SELECT ou.key_id FROM ou WHERE ou.ordinal = <N>),
  p_run_at := now()
);
SELECT (SELECT count(*) FROM compute_jobs
         WHERE kind = 'okx_archive_rebuild'
           AND idempotency_key = 'okx-fills-calibrate-' || '<RUN>') AS this_run_jobs,
       (SELECT count(*) FROM compute_jobs
         WHERE kind = 'okx_archive_rebuild'
           AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')) AS in_flight;
```

Expected readback: `this_run_jobs` 1. `0` means a job of the kind already holds this key's in-flight
slot and the enqueue returned it: read it in step 3 instead. The enqueue form is
`enqueue_compute_job(p_strategy_id, p_kind, p_idempotency_key, p_parent_job_ids, p_exchange,
p_metadata, p_allocator_id, p_api_key_id, p_run_at)`; an api_key-scoped `okx_archive_rebuild`
passes `p_strategy_id := NULL`. A repeat of the same `<RUN>` is a no-op that returns the same job;
use a new `<RUN>` for a new calibrate.

Cost: up to one archive apply POST per needed quarter OKX holds no live request for (2026 Q1 was
never requested; the OKXHISTORY Q2 and Q3 requests are older than 30 days), against a budget of 12
a day. The job spends them itself.

## 9. Step 5 — read the calibrate and decide

**While it waits.** After the job's first defer (`next_attempt_at` set, status `pending`), read the
persisted quarter block once. Each requested quarter must carry an integer `applies` (the
persisted apply count that bounds re-applies survives the real claim round trip). If a quarter's
`applies` is not an integer, STOP and report: do not enqueue anything further.

```sql
SELECT q ->> 'year' AS year, q ->> 'quarter' AS quarter, q ->> 'role' AS role,
       q ->> 'state' AS state, q -> 'applies' AS applies,
       jsonb_typeof(q -> 'applies') AS applies_type
  FROM compute_jobs j,
       jsonb_array_elements(j.metadata -> 'member_progress' -> 'quarters') AS q
 WHERE j.kind = 'okx_archive_rebuild'
   AND j.idempotency_key = 'okx-fills-calibrate-' || '<RUN>';
```

Zero rows means the block has not been written yet; read again after the job's next claim.
`applies_type` must read `number` for every row.

**The job-result read.** Once the job is `done` (or has stopped), read the verdict inputs. It
returns scalars and the named parts of `member_progress` as text; the CSV or result stays in the
operator's scratch and only counts and days go into any note.

```sql
SELECT j.status, j.attempts, j.next_attempt_at,
       substring(j.last_error from '^okx_archive_rebuild: ([a-z0-9_]+)') AS error_class,
       CASE WHEN j.last_error ~ '^okx_archive_rebuild: ' THEN j.last_error END AS last_error,
       (j.last_error IS NOT NULL AND j.last_error !~ '^okx_archive_rebuild: ') AS last_error_uncontracted,
       p ->> 'stop_class' AS stop_class,
       p -> 'info' ->> 'outcome' AS outcome,
       (p -> 'quarters')::text AS quarters,
       (p -> 'census')::text AS census,
       (p -> 'info' -> 'bal_chain')::text AS bal_chain,
       (p -> 'info' -> 'unread_spans')::text AS unread_spans,
       (p -> 'info' -> 'over_cap_quarters')::text AS over_cap_quarters,
       (p -> 'reconcile' -> 'strategies')::text AS reconcile_strategies,
       (p -> 'strategies')::text AS strategies
  FROM compute_jobs j
 CROSS JOIN LATERAL (SELECT j.metadata -> 'member_progress' AS p) x
 WHERE j.kind = 'okx_archive_rebuild'
   AND j.idempotency_key = 'okx-fills-calibrate-' || '<RUN>';
```

`last_error_uncontracted` true means the text came from the dispatcher, not from the job: do not
paste it, return to the founder. A job that is `pending` or `running` is waiting or working: a venue
rate limit is a defer, not a failure, and `failed_retry` with `fills_write_failed`, `fills_count_not_persisted`,
`claim_budget_exceeded` or `link_expired` is a retry in progress. Any other permanent
`error_class` ends the session at this step: return its class and counts to the founder, never
re-enqueue to get past it.

**What each key means** (`strategies[*]` and `reconcile.strategies[*]` carry `position`, the
0-based `target_position` of step 1):

- `stop_class`: null on a clean read.
- `quarters[*]`: `state` (`finished` once OKX has the file), `applies`, `row_count`, `ts_min_day`,
  `ts_max_day`, `role` (`write`, `reconcile`, `write_reconcile`, `out_of_window`).
- `census`: `trade_bills`, `trade_bills_by_inst_type`, `readable` (`trade_id`, `px`, `sz`,
  `fill_time`, `ord_id`, `exec_type`: counts of readable trade cells), `by_sub_type`,
  `trade_id_shapes`.
- `info.bal_chain`: on a clean read `ccys.<ccy>` with `pairs_checked`, `first_day`, `last_day`, and
  `total_pairs`. A broken chain is the stop `archive_incomplete`.
- `reconcile.strategies[*]`: `state` (`equal`, `window_empty`, `miss`, `not_read`, `not_performed`), `pairs`,
  `archive_count`, `stored_count`, `ts_match`, `fill_time_match`, `ts_column`.
- `strategies[*]`: `state` (`read`, `anchor_in_reach`, `no_anchor`), `anchor_day`,
  `earliest_stored_fill_day`, `write_from_day`, `write_bound_day`, `archive_fills_in_window`,
  `already_stored`, `would_insert`, `before_anchor`, `inserted` (null until an apply writes), and
  `legacy` (`stored`, `matched`, `unequal`, `unequal_by_field`, `absent_in_archive`,
  `unreadable`).
- `info.unread_spans[*]`: `{from_day, until_day, reason}` with reason `over_cap`, `not_requested`,
  `pre_archive`, `unreachable`, or per strategy `before_anchor` (carries `position`: fills read but
  older than the strategy's first daily return).
- `info.over_cap_quarters`: the quarter tags left out by the 4-quarter cap (section 14).

### The go/no-go rule (a checklist, not a judgment)

Proceed to step 6 ONLY when every line below holds. Tick each in the log.

1. The calibrate ended `done`, `stop_class` is null, and `info.outcome` is `read_complete`.
2. Every trade cell is readable: `census.readable.trade_id`, `census.readable.px` and
   `census.readable.sz` each equal `census.trade_bills`, and `census.trade_bills` is above 0.
3. SWAP is the only trade-bill instType: `census.trade_bills_by_inst_type` has the key `SWAP` and
   no other key.
4. The balance chain reading is present: `info.bal_chain` is not null and its `ccys` is not empty.
5. Every strategy whose `strategies[*].state` is `read` has `reconcile.strategies[*].state`
   `equal` with `ts_match` equal to `pairs`; or `window_empty`, accepted ONLY after the overlap
   with `fills-history` has expired (about 2026-12-29), recorded as such in the log. `not_performed`
   means the reconcile quarter was not read at all (the write bound sits in the unfinished quarter,
   or a `quarters` override left it out): NO comparison happened, so it is not `equal` and not
   `window_empty`. It follows the same recorded decision as `window_empty` (an unread overlap may
   write for a proven instType with the bal chain passing), so record it in the log as "reconcile
   not performed" and let the bal chain and the legacy reading carry the proof. At least one
   strategy is `read`: if none is, there is nothing to write, stop.
6. Every `read` strategy's `legacy` has `unequal` 0, `absent_in_archive` 0 and `unreadable` 0.
   This is exactly the predicate `fills_apply` enforces itself as the permanent stop
   `fills_legacy_mismatch`, so this rule and the automatic chain cannot disagree.

Anything else STOPS: nothing is written, nothing more is enqueued, and the calibrate's reading
goes to the founder. Specific branches:

- `ts_match` 0 while `fill_time_match` equals `pairs`: the archive's timestamp column must be
  switched in code (`ARCHIVE_TS_COLUMN` in `okx_archive_fills_map.py`). That is a founder decision
  and a code change, not a runbook step. STOP.
- A non-empty `info.over_cap_quarters` is NOT a no-go: record it and handle it in section 14.
- `before_anchor` or `not_requested` spans are not a no-go either: they are named gaps, recorded in
  the report (section 12).
- A `fills_legacy_mismatch` stop (or a calibrate whose legacy reading is non-zero) means a stored
  row inside a read quarter disagrees with, is missing from, or cannot be compared with the archive.
  Do not widen anything: return it to the founder. The stop is permanent and the chain's 14-day
  cooldown counts it.

Stop classes a read can end with, each a STOP to return to the founder with the class and counts:
`archive_incomplete`, `archive_request_failed`, `archive_give_up`, `quarter_range_mismatch`,
`unproven_inst_type`, `unmapped_trade_subtype`, `unreadable_trade_bill`, `unknown_contract_size`,
`duplicate_trade_id`, `fills_reconcile_miss`, `fills_legacy_mismatch`, `account_mismatch`,
`invalid_input`, and the rest of the rebuild's closed set (`STOP_CLASSES` in `okx_archive_job.py`,
for example `key_disconnected`, `download_refused`, `header_drift`, `duplicate_bill_conflict`).
Transient (the job retries itself, wait): `link_expired`, `live_fetch_failed`,
`claim_budget_exceeded`, `fills_write_failed`, `fills_count_not_persisted` (the apply count could not be
stored, so no apply was POSTed; nothing was spent).

## 10. Step 6 — backfill through the product path

Marker first. Enqueue a `sync_trades` job per affected strategy, as Phase 255 did, so the chain
fires on its own. Doing this within 5.5 h of the calibrate's quarters reading `finished` keeps the
links alive and costs no apply. Later is safe but not free: a `finished` quarter whose link has died
is re-applied once by the job, a counted apply inside the per-quarter cap (the job then waits for
OKX to generate the file again, about 2 h), so the apply budget is spent only in that case.

Per affected ordinal `<N>` (every strategy whose `state` was `read` in the calibrate), one
statement each, a new `<RUN>` per statement:

```sql
-- the guard first (section 4), then:
WITH ou AS (
  SELECT s.id AS strategy_id, row_number() OVER (ORDER BY s.id) AS ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
SELECT enqueue_compute_job(
  p_strategy_id := (SELECT ou.strategy_id FROM ou WHERE ou.ordinal = <N>),
  p_kind := 'sync_trades',
  p_idempotency_key := 'okx-fills-sync-' || '<RUN>' || '-' || '<N>',
  p_run_at := now()
);
SELECT count(*) AS this_run_jobs FROM compute_jobs
 WHERE kind = 'sync_trades' AND idempotency_key = 'okx-fills-sync-' || '<RUN>' || '-' || '<N>';
```

Wait for each `sync_trades` job to be `done`:

```sql
SELECT j.status, j.attempts, j.next_attempt_at,
       left(j.last_error, 60) AS last_error_prefix
  FROM compute_jobs j
 WHERE j.kind = 'sync_trades'
   AND j.idempotency_key = 'okx-fills-sync-' || '<RUN>' || '-' || '<N>';
```

Then run step 3's query again. A `fills_apply` job created after the syncs means the chain fired:
wait for it and read it (section 11). If NONE was created, the trigger was false (the strategy's
earliest stored fill is within 2 days of its first daily return, which is likely for strategies
that kept leftover fills from the earlier one-page pager) or a cooldown holds. Enqueue the apply
directly. The form is step 4's with mode `fills_apply`:

```sql
-- the guard first (section 4), then the DO $refuse$ block of step 4 and:
WITH ou AS (
  SELECT s.api_key_id AS key_id, row_number() OVER (ORDER BY s.id) AS ordinal
    FROM strategies s
    JOIN api_keys k ON k.id = s.api_key_id
   WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived'
)
SELECT enqueue_compute_job(
  p_strategy_id := NULL,
  p_kind := 'okx_archive_rebuild',
  p_idempotency_key := 'okx-fills-apply-' || '<RUN>',
  p_metadata := jsonb_build_object('mode', 'fills_apply'),
  p_api_key_id := (SELECT ou.key_id FROM ou WHERE ou.ordinal = <N>),
  p_run_at := now()
);
SELECT (SELECT count(*) FROM compute_jobs
         WHERE kind = 'okx_archive_rebuild'
           AND idempotency_key = 'okx-fills-apply-' || '<RUN>') AS this_run_jobs;
```

Readback `this_run_jobs` 1. `0` means an archive job already holds the key's slot: read it in step 3.
No other write is part of this runbook.

## 11. Step 7 — read the apply

Use section 9's job-result read with the apply's idempotency key (for a chained job, the newest
`fills_apply` job of step 3's query, filtered by `created_at`). Read it the same way, plus:

- `info.outcome` is `applied`;
- `strategies[*].inserted` per `read` strategy (null only for a strategy not read, or for every
  strategy when `info.inserted_count_unreadable` is set, in which case the step 2 after-count is
  the authority);
- `info.unread_spans`, unchanged from the calibrate unless a quarter changed state.

A `fills_legacy_mismatch`, `fills_reconcile_miss` or any gate class here means NOTHING was written
(the gates precede the write). A `fills_write_failed` is transient: the job retries, and the retry
is idempotent.

## 12. Step 8 — fills after

Repeat step 2 (section 6). Report, per ordinal:

| Reading | Source |
|---|---|
| fills before and after (count, earliest, latest, archive-sourced) | step 2, before and after |
| the earliest stored fill against the first daily return | step 2's `earliest_fill_minus_first_return_days` |
| rows inserted | step 7's `strategies[*].inserted` (and the step 2 difference) |
| every span not written, with its reason | `info.unread_spans`: `over_cap`, `not_requested`, `pre_archive`, `unreachable`, and per strategy `before_anchor` |

`before_anchor` carries the strategy's position: fills the archive held for days older than the
strategy's first daily return, read but deliberately not stored, because the daily return series
does not reach them. It is a named span, not a defect.

## 13. Step 9 — idempotency on PROD

Immediately after step 8, enqueue a second `fills_apply` with a NEW idempotency key (step 6's
direct `fills_apply` form with a new `<RUN>`; the first job must be `done`, otherwise this returns
the in-flight one). Read it as in section 11. Expected: `inserted` 0 for every `read` strategy, and
step 2's counts unchanged. A non-zero insert here means the unique index did not absorb a stored
fill: STOP and return to the founder.

## 14. Quarters beyond the cap (`259-ARCHIVE-QUARTER-CAP`)

A job reads at most 4 quarters, the newest kept. When the calibrate or the apply lists quarter tags
in `info.over_cap_quarters` (and the matching `over_cap` spans), those quarters were NOT read.
Reach them, newest first, with manual `fills_apply` jobs:

- the step 6 direct `fills_apply` form whose `p_metadata` also carries a `quarters` list of up to 4
  contiguous `{"year": ..., "quarter": ...}` entries copied from `info.over_cap_quarters` (a quarter
  tag such as `2025-Q4` is year 2025, quarter `Q4`), and a NEW idempotency key per job:

  ```sql
  p_metadata := jsonb_build_object(
    'mode', 'fills_apply',
    'quarters', '[{"year": <YYYY>, "quarter": "<Q>"}, {"year": <YYYY>, "quarter": "<Q>"}]'::jsonb
  ),
  ```

- one job at a time, each read through sections 11 and 12 before the next;
- each job can spend one apply POST per quarter of the 12-a-day budget;
- a quarter that has not ended is refused (`invalid_input`); the current quarter is never in the
  archive.

The automatic chain never reaches these quarters: after each 14-day cooldown it re-reads the same
newest four, idempotently. A quarter whose file OKX still serves with a live link costs no apply; a
quarter whose link has died (links live about 5.5 h, so a chained read usually finds them dead)
costs one counted apply POST per read to have the file generated again, inside the per-quarter cap.
Quarter-walking is not built. **Record
every over-cap quarter left unread** in the report; a quarter reached by a manual job is reported
like any other read.

## 15. Rollback (founder only)

The mapping from the archive to a fill is a costly decision to undo (CONTEXT), so a rollback is the
founder's call and is never run by an executor or on a hunch. The rows are findable exactly: they
carry `raw_data.source = okx_bills_history_archive`. Run a count with the same predicate first and
read it back to the founder, then the delete, both scoped by ordinal, marker first:

```sql
-- the count (read only):
SELECT count(*) FROM trades t
 WHERE t.is_fill AND t.exchange = 'okx'
   AND t.raw_data ->> 'source' = 'okx_bills_history_archive'
   AND t.strategy_id = (SELECT x.strategy_id FROM (
         SELECT s.id AS strategy_id, row_number() OVER (ORDER BY s.id) AS ordinal
           FROM strategies s JOIN api_keys k ON k.id = s.api_key_id
          WHERE lower(k.exchange) = 'okx' AND s.status <> 'archived') x
        WHERE x.ordinal = <N>);
```

The delete is the same predicate in a `DELETE FROM trades t WHERE ...` behind the guard (section 4),
for the named ordinals only, after the founder has seen the count. A deleted row is re-created by
the next `fills_apply` for its quarter (idempotent), so the rollback also wants the chain's
cooldown and the founder's decision about why the rows were wrong in hand first: deleting without
fixing the cause only schedules the same rows to return.

## 16. Reporting rule

Report by ordinal, as in section 12. No id, email, account number or uid appears in any tracked
text: this file, the SUMMARY, a commit message or a PR body. `member_progress` and any CSV of it stay
in the operator's scratch and are pasted nowhere; counts and days go into notes. The SUMMARY's log
records the marker answer that preceded every write, each enqueue's readback, each job's final
status and `stop_class`, the go/no-go checklist ticks, and every unwritten span and over-cap quarter
with its reason.
