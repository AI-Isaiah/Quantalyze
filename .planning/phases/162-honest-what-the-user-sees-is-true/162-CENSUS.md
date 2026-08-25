# Phase 162 — PROD census (HONEST-01 root cause / HONEST-02 flat-vs-gap)

**Artifact:** `162-CENSUS.md` (the phase's decision gate — plans 162-07 and 162-08 branch on the verdict lines below)
**Authored:** 2026-08-26 (scaffold, plan 162-01 Task 1)
**Executed against PROD:** 2026-08-26 (plan 162-01 Task 2, read-only)
**Read lane used:** a throwaway node script in the session scratchpad (never committed) issuing PostgREST **GET** requests with the service key read from the primary checkout's untracked local env file. Every request was a `GET`; the script aborts before any request if the URL's project ref does not match the PROD ref recorded in 159-CENSUS. JSON reduction (max/min date inside `returns_series`, pattern booleans over `computation_error`) happened client-side inside the script, so the raw column text never entered a transcript or this file. **No write, upsert, RPC, or DELETE was issued.**

⚠️ **Outage caveat carried into this census.** A PROD misconfiguration (Vercel's analytics service key not matching the worker's) made every guarded analytics route return 401 for an unknown period ending ~21:30Z on 2026-08-25. Two guards against mis-attribution: (a) the HONEST-02 evidence rests on a **111-day** window (2026-05-06 → 2026-08-25), far wider than any plausible outage; (b) the decisive key-side witness (`last_sync_at` 2026-08-25T04:07Z) **predates** the 21:30Z fix, and it shows the sync path succeeding — so the outage cannot be what silenced this strategy. The HONEST-01 evidence is from June 2026 and is untouched by it.
**PROD-vs-TEST confirmation:** the PROD project ref and the TEST ref it must not be confused with are recorded **once**, in `.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md` (header, "PROD project ref (confirmed at execution)"). This file deliberately does **not** re-embed either ref. Before any query below runs, the executor confirms the connection targets the ref recorded there.

## Rule of this file: no PII, ever

**This repository is PUBLIC and `.planning/` is tracked — everything pasted below is
world-readable on push.** The census therefore carries **counts, dates, and strategy /
portfolio ids ONLY**. Never an email address, never an auth uid, never a user name, never a
credential, never a production hostname or project ref. Strategy ids are non-secret per
SHARE-01; nothing else about a user is. Before pasting any result table, strip every email-
or uid-shaped value and every column not named in that query's own output list.

⚠️ **`computation_error` / `last_error` TEXT is never pasted into this file.** The whole
reason HONEST-01 exists is that those columns carry unmapped exception prose, and exception
prose can embed user-adjacent detail (paths, identifiers, echoed input). Query 6 therefore
emits **pattern booleans**, not the string, and query 5 emits an error *shape* label the
executor writes by hand after reading the value out-of-band.

## Rule of this file: read-only

**Every statement below is a `SELECT`.** Nothing in this file mutates PROD. Plan 162-01
issues no writes at all; the only PROD mutation anywhere in this phase is plan 162-08's
recompute enqueue, which is a different plan with its own precondition. The executor runs
exactly the blocks on this page — nothing improvised.

## Subjects

Recovered at execution time from the pre-scope snapshot `git show ca3f0c5c2:TODOS.md`
(§"v1.16 milestone human-audit QA sweep", items 1 and 3):

| Subject | Requirement | How it is identified below |
| --- | --- | --- |
| S1 — the raw-exception row | HONEST-01 | strategy id prefix `ec722557` (the row whose `computation_error` held the bare `'<' not supported between instances of 'str' and 'NoneType'`) |
| S2 — the FRESH-but-stale factsheet | HONEST-02 | the strategy named in snapshot item 3 (API-verified, "Synced 8h ago", chip reading `COMPUTED · FRESH (0d)`, observation window ended **2026-05-06**). Resolved by name **at execution time** against the snapshot; the name is deliberately not repeated here — from query 0 onward the subject is carried by **id only**. |

### Confirmed against source before the queries were written

- **Trades table name (assumption A5).** The `sync_trades` RPC — latest definition
  `supabase/migrations/20260510180535_sync_trades_date_range_scoped_delete.sql:106,114` —
  does `DELETE FROM trades` / `INSERT INTO trades (strategy_id, exchange, symbol, side,
  price, quantity, fee, fee_currency, timestamp, order_type)`. So the store is **`trades`**,
  keyed by **`strategy_id`** (not by key id), with the fill time in **`timestamp`**.
- **`compute_jobs` columns** — `supabase/migrations/20260411144407_compute_jobs_queue.sql:106-136`:
  `strategy_id, portfolio_id, kind, status, attempts, last_error, error_kind, exchange,
  trade_count, created_at`. `status` terminal-failure value is `failed_final`.
- **`strategies.source`** — `supabase/migrations/20260411103316_wizard_source_column.sql:76-83`:
  `TEXT NOT NULL DEFAULT 'legacy'`, `CHECK (source IN ('legacy','wizard','admin_import'))`.

---

## Query 0 — resolve the two subject ids

```sql
-- Resolve S1 (by id prefix) and S2 (by name) to full ids. Output: ids only.
SELECT
  s.id,
  CASE WHEN s.id::text LIKE 'ec722557%' THEN 'S1' ELSE 'S2' END AS subject,
  s.status,
  s.is_example,
  s.source,
  (s.api_key_id IS NOT NULL)                                     AS has_api_key
FROM strategies s
WHERE s.id::text LIKE 'ec722557%'
   OR s.name = '<S2_NAME from ca3f0c5c2:TODOS.md item 3 — not repeated in this public file>'
ORDER BY 2;
```

### Results

48 strategies scanned; both subjects resolved uniquely.

| subject | id | status | is_example | source | has_api_key |
| --- | --- | --- | --- | --- | --- |
| S1 | `ec722557-7781-44db-8f2c-edbe252957c0` | pending_review | false | wizard | true |
| S2 | `13f7b07f-b792-41fc-bfef-6854adce2c4f` | published | false | wizard | true |

---

## Query 1 — HONEST-02 step 1: the subject's venue

The venue decides which structural gap is even applicable: the **ledger fan-out** gap
(ledger venues have no recurring refresh — 161.1's mechanism is built but dormant) versus
the **ccxt `stored > 0` filter** at `analytics-service/routers/cron.py:471-472`, which drops
a strategy from the recompute list on any flat day.

```sql
-- S2's key venue. Output: strategy id, exchange, key age markers only.
SELECT
  s.id                    AS strategy_id,
  k.exchange,
  (k.id IS NOT NULL)      AS key_present,
  k.created_at            AS key_created_at
FROM strategies s
LEFT JOIN api_keys k ON k.id = s.api_key_id
WHERE s.id = '<S2>';
```

### Results

| strategy_id | exchange | key_present | key_created_at |
| --- | --- | --- | --- |
| `13f7b07f…` | **okx** | true | 2026-05-06 |

`strategy_keys` rows for S2: **0** (single-key link only, via `strategies.api_key_id`).

**Consequence:** okx is a **ccxt** venue, not a ledger venue. The ledger fan-out gap (161.1's
dormant mechanism) is therefore **not applicable** to this subject; the only structural gap in
play is the ccxt `stored > 0` recompute filter at `analytics-service/routers/cron.py:471-472`.

---

## Query 2 — HONEST-02 step 2: series end date

Same semantics as the `ledger_refresh_staleness` view (migration `20260825120000`): the
freshness truth signal is `max((e->>'date')::date)` over `strategy_analytics.returns_series`
— "a column that only a real analytics run can advance". `computed_at` and `last_sync_at`
are proven liars (that view's D-03 header) and are pulled here only to be *contrasted*, never
to decide anything.

```sql
-- S2 series end vs the two liar timestamps. Output: dates + counts only.
SELECT
  a.strategy_id,
  a.computation_status,
  (SELECT max((e->>'date')::date)
     FROM jsonb_array_elements(a.returns_series) e)   AS series_end_date,
  (SELECT min((e->>'date')::date)
     FROM jsonb_array_elements(a.returns_series) e)   AS series_start_date,
  jsonb_array_length(a.returns_series)                AS series_points,
  a.computed_at::date                                 AS computed_at_date
FROM strategy_analytics a
WHERE a.strategy_id = '<S2>';
```

### Results

| strategy_id | computation_status | series_start | **series_end** | points | computed_at_date |
| --- | --- | --- | --- | --- | --- |
| `13f7b07f…` | complete | 2026-02-23 | **2026-05-06** | 73 | 2026-08-25 |

`daily_returns` is NULL (API-ingested strategy — the track lives in `returns_series`).

**`SERIES_END = 2026-05-06`** — matching the snapshot finding exactly, and **112 days** before
this census. Note the contrast the D-03 verdict predicts: `computed_at` reads **2026-08-25**
(yesterday) while the series has not advanced since May. That gap is the HONEST-02 bug in one row.

---

## Query 3 — HONEST-02 step 3: fills after the series end date

This is the query that decides the verdict. Table name confirmed against the `sync_trades`
RPC definition above (`trades`, keyed by `strategy_id`, fill time in `timestamp`).

```sql
-- Fills for S2 before/after the series end date. Output: counts + dates only.
SELECT
  count(*)                                                     AS trades_total,
  count(*) FILTER (WHERE t.timestamp::date >  '<SERIES_END>')  AS trades_after_end,
  count(*) FILTER (WHERE t.timestamp::date <= '<SERIES_END>')  AS trades_upto_end,
  max(t.timestamp)::date                                       AS last_fill_date,
  min(t.timestamp)::date                                       AS first_fill_date
FROM trades t
WHERE t.strategy_id = '<S2>';
```

### Results

| trades_total | **trades_after_end** | trades_upto_end | first_fill_date | last_fill_date |
| --- | --- | --- | --- | --- |
| 273 | **0** | 273 | 2026-02-23 | **2026-05-06** |

---

## Query 3b — the decisive witness: is the key still being polled?

Query 3 alone **cannot** decide the verdict, and saying otherwise would be the error this
census exists to avoid. `trades_after_end = 0` means *our store* holds no newer fill; it does
**not** mean the venue produced none, because a poller that never ran would produce exactly the
same zero. So the key row itself is interrogated. `last_sync_at` is a proven liar about
*freshness* (161.1 D-03: it advances even on zero-trade syncs) — which is precisely what makes
it a **good** witness for the different question asked here: *was a sync attempted at all?*

```sql
-- Sync-liveness witness for S2's key. Output: dates + null-ness only; no key material.
SELECT
  k.exchange,
  k.is_active,
  k.sync_status,
  k.created_at,
  k.last_sync_at,
  k.last_fetched_trade_timestamp,
  (k.sync_error   IS NOT NULL) AS has_sync_error,
  (k.last_429_at  IS NOT NULL) AS has_recent_429,
  (k.disconnected_at IS NOT NULL) AS is_disconnected
FROM api_keys k
WHERE k.id = '<S2_KEY>';
```

### Results

| field | value |
| --- | --- |
| exchange / attested_venue | okx / okx |
| is_active | **true** |
| sync_status | **complete** |
| created_at | 2026-05-06T19:47:53Z |
| **last_sync_at** | **2026-08-25T04:07:24Z** (the day before this census) |
| **last_fetched_trade_timestamp** | **2026-05-06T19:49:35Z** |
| has_sync_error / has_recent_429 / is_disconnected | false / false / false |

**Read this pair together — it is the whole verdict.** The key was connected at 19:47:53Z on
2026-05-06 and its backfill reached a newest fill of 19:49:35Z **two minutes later**. Since then
the key has been polled to a *successful* completion as recently as yesterday, with no sync
error, no 429 cooldown, and no disconnection — and across those 111 days the newest fill the
poller has ever received has not moved by a single second.

Fleet context (counts only, no ids): of 33 keys, 28 have `last_sync_at` within 1 day and 5 are
8–30 days old. S2's key is in the healthy 28 — it is not a stalled outlier.

---

## Query 4 — HONEST-02 step 4: S2's job history since the series end

```sql
-- S2 compute_jobs since the series end date. Output: kind/status/date/count only.
-- last_error is reduced to a presence boolean; its text is never pasted.
SELECT
  j.kind,
  j.status,
  j.created_at::date            AS created_on,
  j.trade_count,
  (j.last_error IS NOT NULL)    AS had_error,
  j.error_kind
FROM compute_jobs j
WHERE j.strategy_id = '<S2>'
  AND j.created_at::date >= '<SERIES_END>'
ORDER BY j.created_at DESC
LIMIT 100;
```

Run **unpaginated** (ascending, paged to exhaustion) rather than `LIMIT 100` — a
newest-first 100-row cut only reached back to 2026-07-26 and would have hidden the silent
window below. Recorded because the truncated read looked like a different answer.

### Results — all S2 jobs since 2026-05-06 (n = 62, exhaustive)

| kind | status | n | date range | trade_count sum | with_error |
| --- | --- | --- | --- | --- | --- |
| `sync_funding` | done | 31 | 2026-07-26 … 2026-08-25 | 0 (all NULL) | 0 |
| `reconcile_strategy` | done | 31 | 2026-07-26 … 2026-08-25 | 0 (all NULL) | 0 |

- `sync_trades` jobs since the series end: **0**
- `compute_analytics` jobs since the series end: **0**
- jobs with `trade_count > 0` since the series end: **0**
- **no `compute_jobs` row of any kind exists between 2026-05-06 and 2026-07-26** (a 81-day hole)

**Fleet-wide job recency (counts/dates only):** newest `sync_trades` anywhere = 2026-08-25
(done); newest `sync_funding` / `reconcile_strategy` anywhere = 2026-08-25 (done); newest
**`compute_analytics` anywhere = 2026-05-27 (failed_final)**; newest `poll_positions` anywhere
= 2026-06-14 (failed_final).

⚠️ **Do not over-read the missing `sync_trades` rows for S2.** The recurring ccxt trade sync
runs **inline** in the cron path (`analytics-service/routers/cron.py:370-373` calls the
`sync_trades` RPC directly) and does not necessarily mint a `compute_jobs` row per key. Their
absence is therefore not evidence that no sync ran — and query 3b shows directly that syncs
*did* run. This is why the verdict below rests on the key witness, not on this table.

---

## Query 5 — HONEST-01: S1's full job history, newest first

The str/None root cause is **not** statically determinable from this repo (162-RESEARCH
§HONEST-01, "The str/None root cause is NOT statically determinable"): the failing row
predates several rewrites, so the pipeline stage has to come from the job history before any
source site can be argued for. `last_error` text stays out of this file — the executor reads
it out-of-band and records only a **shape label** (e.g. `str/None-compare`, `timeout`,
`auth`, `other`) plus the kind and date.

```sql
-- S1 compute_jobs, newest first. Output: kind/status/date + error presence only.
SELECT
  j.kind,
  j.status,
  j.created_at::date                                              AS created_on,
  j.attempts,
  j.trade_count,
  (j.last_error IS NOT NULL)                                      AS had_error,
  j.error_kind,
  (j.last_error ILIKE '%not supported between instances%')        AS is_str_none_compare
FROM compute_jobs j
WHERE j.strategy_id = '<S1>'
ORDER BY j.created_at DESC
LIMIT 200;
```

### Results — S1 job history (67 rows since 2026-05-06)

| kind | status | n | date range | with_error | `is_str_none_compare` |
| --- | --- | --- | --- | --- | --- |
| **`poll_positions`** | **failed_final** | **5** | **2026-06-10 … 2026-06-14** | 5 | **true (5 / 5)** |
| `reconcile_strategy` | done | 31 | 2026-07-26 … 2026-08-25 | 0 | false |
| `sync_funding` | done | 31 | 2026-07-26 … 2026-08-25 | 0 | false |

**The str/None `TypeError` is confined to one job kind: `poll_positions`.** Every
`poll_positions` job that has ever existed for S1 (5 of 5, all `failed_final`) carries it; no
other kind on this strategy has ever carried an error at all.

S1's current analytics row: `computation_status = failed`, `computed_on = 2026-08-25`,
`is_str_none_compare = true`, `error_len = 59`, no Python-type prefix, message begins with `'`
— i.e. the bare `TypeError` message, unprefixed, exactly as the snapshot recorded. Note again
the `computed_at` liar: the row reads *yesterday* for an error last produced on **2026-06-14**.

**Blast radius (query 6 confirms):** the identical 59-character error sits on a **second**
strategy, `8581f739-1a7b-42a4-a209-3acfa327e259` (published, `source=wizard`, API-keyed), whose
`poll_positions` jobs failed on the **same five days** (2026-06-10 … 2026-06-14, all
`failed_final`). Two strategies, one five-day window, one job kind — this reads as a single
episode, not a per-strategy data quirk.

---

## Query 6 — the exception-shaped `computation_error` repair population

Mapping at the writer (plan 162-02) stops **new** leaks; existing rows keep rendering the old
text until repaired or until their next terminal write. This enumerates the repair set for
plan 162-08. **Booleans only — the error text itself is never emitted.**

```sql
-- Strategy-side repair population. Output: id, status, pattern booleans, length.
SELECT
  a.strategy_id                                                       AS id,
  'strategy'                                                          AS surface,
  a.computation_status,
  a.computed_at::date                                                 AS computed_on,
  (a.computation_error ILIKE '%not supported between instances%')     AS p_str_none,
  (a.computation_error ILIKE '%Traceback%')                           AS p_traceback,
  (a.computation_error ~ '^[A-Z][A-Za-z]*Error: ')                    AS p_type_prefix,
  length(a.computation_error)                                         AS error_len
FROM strategy_analytics a
WHERE a.computation_error IS NOT NULL
  AND (   a.computation_error ILIKE '%not supported between instances%'
       OR a.computation_error ILIKE '%Traceback%'
       OR a.computation_error ~ '^[A-Z][A-Za-z]*Error: ')
ORDER BY 4 DESC NULLS LAST;
```

```sql
-- Portfolio-side repair population (routers/portfolio.py:1191 writes
-- f"{type(exc).__name__}: {str(exc)[:400]}" into this column).
-- Output: id, status, pattern booleans, length.
SELECT
  p.portfolio_id                                                      AS id,
  'portfolio'                                                         AS surface,
  p.computation_status,
  p.computed_at::date                                                 AS computed_on,
  (p.computation_error ILIKE '%not supported between instances%')     AS p_str_none,
  (p.computation_error ILIKE '%Traceback%')                           AS p_traceback,
  (p.computation_error ~ '^[A-Z][A-Za-z]*Error: ')                    AS p_type_prefix,
  length(p.computation_error)                                         AS error_len
FROM portfolio_analytics p
WHERE p.computation_error IS NOT NULL
  AND (   p.computation_error ILIKE '%not supported between instances%'
       OR p.computation_error ILIKE '%Traceback%'
       OR p.computation_error ~ '^[A-Z][A-Za-z]*Error: ')
ORDER BY 4 DESC NULLS LAST;
```

### Results — repair population

Scanned: **37** `strategy_analytics` rows with a non-NULL `computation_error`, and **0**
`portfolio_analytics` rows with one. Exception-shaped hits: **2**, both strategy-side.

| id | surface | computation_status | computed_on | p_str_none | p_traceback | p_type_prefix | error_len |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ec722557-7781-44db-8f2c-edbe252957c0` | strategy | failed | 2026-08-25 | **true** | false | false | 59 |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | strategy | failed | 2026-08-25 | **true** | false | false | 59 |

**The repair population is exactly 2 rows, and they are the same defect.** The other 35
non-NULL `computation_error` values are curated copy from the already-mapped writers
(162-RESEARCH §HONEST-01 "Writers that are already curated") and are not repair candidates.

**Portfolio surface is clean today — but that is not a reason to skip it.** The live raw writer
at `analytics-service/routers/portfolio.py:1191` (`_fail(f"{type(exc).__name__}: {str(exc)[:400]}")`)
still exists at HEAD and still renders verbatim through `StaleWarning`. Zero rows means the
door has not been walked through yet, not that it is shut; D-162-4's strict scope stands.

**S1's status caveat for plan 162-08:** S1 is `pending_review`, not `published`. Its leaked
error is reachable through the wizard's terminal failure screen, not through discovery.
`8581f739…` **is** published.

---

## Query 7 — example-row re-census (assumption A3), plan 162-08's input

The 159 census recorded all 15 published `is_example` strategies at
`computation_status = 'failed'` since 2026-05-27. D-162-1 decided to recompute them to
terminal success; plan 162-08 needs the per-row **mechanism** input (CSV-ingested vs
API-keyed) to pick how. The `is_s2` column answers **assumption A2** — whether the HONEST-02
subject is itself one of these 15, in which case HONEST-02 partially collapses into D-162-1's
recompute and plan 162-07 must read that note.

```sql
-- The published is_example cohort. Output: ids, status, dates, mechanism booleans.
SELECT
  s.id,
  s.source,
  (s.api_key_id IS NOT NULL)                    AS has_api_key,
  k.exchange,
  a.computation_status,
  a.computed_at::date                           AS computed_on,
  (a.returns_series IS NOT NULL)                AS has_returns_series,
  (a.daily_returns  IS NOT NULL)                AS has_daily_returns,
  (a.computation_error IS NOT NULL)             AS had_error,
  (s.id = '<S2>')                               AS is_s2
FROM strategies s
LEFT JOIN strategy_analytics a ON a.strategy_id = s.id
LEFT JOIN api_keys k           ON k.id = s.api_key_id
WHERE s.is_example = true
  AND s.status = 'published'
ORDER BY 5, 1;
```

### Results — example-row status

**15 rows — the cohort is uniform, which simplifies plan 162-08's mechanism choice to one
decision rather than fifteen.** Every row: `source = legacy`, `has_api_key = false` (so **no
venue**, and no API sync path exists for any of them), `computation_status = failed`,
`computed_on = 2026-05-27`, both `returns_series` and `daily_returns` populated, and
`computation_error` non-NULL (curated copy — none is exception-shaped, per query 6).

| id | source | has_api_key | exchange | computation_status | computed_on | has_returns_series | has_daily_returns | had_error | is_s2 | series_end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `51a111ed-0000-4000-8000-000000000001` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-07 |
| `51a111ed-0000-4000-8000-000000000002` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-06 |
| `51a111ed-0000-4000-8000-000000000003` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-03 |
| `51a111ed-0000-4000-8000-000000000004` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-06 |
| `51a111ed-0000-4000-8000-000000000005` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-08 |
| `51a111ed-0000-4000-8000-000000000006` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-06 |
| `51a111ed-0000-4000-8000-000000000007` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-06 |
| `51a111ed-0000-4000-8000-000000000008` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-07 |
| `51a111ed-0000-4000-8000-000000000009` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-02 |
| `51a111ed-0000-4000-8000-000000000010` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-08 |
| `51a111ed-0000-4000-8000-000000000011` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-06 |
| `51a111ed-0000-4000-8000-000000000012` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-02 |
| `51a111ed-0000-4000-8000-000000000013` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-03 |
| `51a111ed-0000-4000-8000-000000000014` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-07 |
| `51a111ed-0000-4000-8000-000000000015` | legacy | false | — | failed | 2026-05-27 | true | true | true | false | 2026-04-08 |

### What plan 162-08 must take from this table

1. **Mechanism.** No row has a key or a venue, so a venue-sync-then-recompute path does not
   exist for this cohort. The recompute must run off the series each row already carries
   (both `returns_series` and `daily_returns` are present) — i.e. the CSV/seed-style
   analytics path, not the API path. Confirm the enqueue kind against the repo's own
   definitions before writing anything; this census establishes the *constraint*, not the call.
2. **A seeded cohort is not a customer cohort.** These are `51a111ed-…-0000000000NN` seed ids
   with April 2026 series ends. Recomputing them yields honest analytics over a track that
   still stops in April — D-162-1's "terminal success" makes the *status* honest; it does not
   make the data current. If a fresh series is wanted, that is a reseed, and a different call.
3. **Fence check.** D-162-1's fence applies if the recompute cannot reach terminal success:
   fall back to unpublishing and say so. Never synthesize values.

---

# Verdicts

## HONEST-02 — flat account or derive gap?

**Decision rule (written down BEFORE the data, per success criterion 2 — this verdict is
decided on the evidence rows, never pre-judged):**

| Evidence (queries 2, 3, 4) | Verdict |
| --- | --- |
| `trades_after_end = 0` **and** sync jobs since the series end completed with `trade_count = 0` | `flat-account` — the venue produced no fills after the end date; the series legitimately ends there |
| `trades_after_end > 0` (data landed that no compute consumed) **or** no `compute_analytics` job ran at all since the end date | `derive-gap` — the pipeline, not the account, is why the series stops |

⚠️ **The recorded wrinkle, stated here so the verdict is not read naively:** under the ccxt
`stored > 0` filter (`analytics-service/routers/cron.py:471-472`) a flat account *causes* a
derive gap — a flat trading day drops the strategy from the recompute list entirely. The two
categories therefore overlap, which is exactly why the success criterion refuses to pre-judge
and why the verdict must cite its rows. If the evidence cannot separate them, say so in the
trail rather than picking the convenient one.

**Consequence for plan 162-07 (D-162-2's fence):** `flat-account` → the
"Track record through {date}" recency line ships. `derive-gap` → the line does **not** ship;
the routing (161.1 dormant fan-out runbook, or the ccxt filter) is recorded for the phase close.

```
HONEST-02 VERDICT: flat-account
```

**Evidence trail — the four rows that decided it, in the order they were weighed:**

1. **Series end = 2026-05-06**, 73 points, `computation_status = complete` (query 2). Not a
   failed run; a successful run over a track that stops.
2. **`trades_after_end = 0`** of 273 total fills; `last_fill_date = 2026-05-06` (query 3).
   *On its own this proves nothing* — an unrun poller produces the same zero.
3. **The key is alive and polling.** `last_sync_at = 2026-08-25T04:07Z`, `sync_status =
   complete`, `is_active = true`, `sync_error` NULL, `last_429_at` NULL, `disconnected_at`
   NULL (query 3b). So the zero in (2) was *measured*, not assumed.
4. **`last_fetched_trade_timestamp = 2026-05-06T19:49:35Z`** — frozen for 111 days while the
   poller kept succeeding (query 3b). This is the decisive row: the venue-facing watermark
   has not moved even though we asked it every day. **The account is flat.**

**Why this is not the derive-gap arm, stated against that arm's own evidence.** The
derive-gap trigger written into the rule *is* met on its face — **0** `compute_analytics` jobs
ran since the series end, and in fact **none has run anywhere in PROD since 2026-05-27**. But
a derive gap means *data exists that no compute consumed*, and rows (2)–(4) show there is no
such data. The missing recompute is the **recorded wrinkle firing exactly as predicted**: the
ccxt `stored > 0` filter (`routers/cron.py:471-472`) drops a zero-fill strategy from the
recompute list, so a flat account *causes* the derive gap rather than being disproved by it.
Cause and effect run flat-account → no-recompute, not the reverse.

**Two honest limits on this verdict, recorded rather than smoothed over:**
- `last_fetched_trade_timestamp` is a *store-side* watermark. It proves the poller never
  *received* a newer fill; it cannot independently prove okx holds none. Across 111 days of
  error-free, non-rate-limited, non-disconnected polling, that is as strong as this evidence
  class gets — but it is not a venue-side attestation.
- The fleet-wide `compute_analytics` drought since 2026-05-27 is **its own finding**, wider
  than this subject, and is *not* closed by this verdict. It belongs in the phase close.

**Consequence for plan 162-07 (D-162-2):** the `flat-account` arm is live — **the
"Track record through {date}" recency line ships**, keyed on the resolved series' last point
(2026-05-06 for this subject), never on `computed_at`. The derive-gap arm is not taken.

**A2 answer (is S2 one of the 15 example rows?): NO.** S2 (`13f7b07f…`) is a `published`,
`is_example = false`, wizard-created, okx-keyed strategy. Every one of the 15 example rows is
`legacy`/keyless with a `51a111ed-…` seed id. **HONEST-02 does not collapse into D-162-1's
recompute** — plan 162-07 and plan 162-08 act on disjoint populations and neither can satisfy
the other.

---

## HONEST-01 — the str/None root cause

**Procedure (162-RESEARCH §HONEST-01):** from the job history (kinds + error shapes + dates),
identify which pipeline stage raised the `TypeError`; then grep the `analytics-service`
source **at HEAD** for reachable mixed `str`/`None` comparison candidates in that stage
(`sorted()` / `min` / `max` over date-keyed rows with nullable fields). Sentry is
orchestrator-only; if its evidence is required and unavailable, that is noted in the trail
rather than guessed around.

| Verdict | When it applies | What plan 162-08 does with it |
| --- | --- | --- |
| `site-identified <path:line>` | a reachable live site at HEAD explains the failure | RED-witnessed compare fix |
| `site-gone` | the failing code predates rewrites; no reachable site exists at HEAD | documented closure + row repair, with the commit evidence |
| `inconclusive` | the job history cannot disambiguate the stage | documented closure + row repair (162-RESEARCH endorses this arm; it is a legitimate outcome, not a failure) |

```
HONEST-01 ROOT-CAUSE: inconclusive
```

**This is a decided verdict, not an unfinished one.** The job history localised the failure
far more tightly than the research expected, but it stops one step short of naming a line, and
naming one anyway would be a guess dressed as a finding. 162-RESEARCH endorses this arm; plan
162-08 closes HONEST-01 as documented-plus-repair.

**Evidence trail — what the census DID establish (all of it narrows 162-08's search):**

1. **Stage: `poll_positions`.** All 5 str/None failures on S1 are `poll_positions` jobs; no
   other kind on that strategy has ever carried an error.
2. **Window: 2026-06-10 … 2026-06-14**, five consecutive days, all `failed_final`.
3. **Population: exactly 2 strategies** (`ec722557…`, `8581f739…`), failing on the *same five
   days* with the *same 59-character* message. One episode, not two coincidences.
4. **The kind has been silent since.** The newest `poll_positions` job anywhere in PROD is
   2026-06-14 — so there has been no opportunity for the defect to recur or to be observed
   again, in either direction. Absence of recurrence is **not** evidence of a fix here.
5. **Message shape:** 59 chars, begins with `'`, **no** Python-type prefix — the bare
   `TypeError` text, confirming the `classify_exception` unknown-arm path
   (`job_worker.py:828,831` → `compute_jobs.last_error` → bridge branch (b)) as the leak route.
   The *leak route* is fully established; only the *raiser* is not.

**Why not `site-identified`.** The handler's own path was read at HEAD and does not host a
`str`/`None` compare: `run_poll_positions_job` (`analytics-service/services/job_worker.py:7871`)
→ `fetch_positions` (`analytics-service/services/positions.py:317`), whose every comparison is
numeric (`positions.py:64,132,166,168,231`), → `persist_position_snapshots`
(`positions.py:361-387`), which contains no comparison at all. No candidate was found to point at.

**Why not `site-gone`.** The search was not exhaustive — the ccxt-facing normalisation inside
`fetch_positions` and the shared `_exchange_preflight` were not fully traced, and `poll_positions`
is very much alive at HEAD (daily enqueue via `enqueue_poll_positions_for_all_strategies`,
`main_worker.py:1026-1036`; handler registered at `job_worker.py:492`). Declaring the site gone
would assert something not measured.

**No traceback was available.** `compute_jobs.last_error` holds only the 59-character message —
the catch-all truncates to `str(exc)[:500]` and keeps no frames. Sentry is orchestrator-only and
was not reachable from this agent; per the plan that is recorded here rather than guessed around.

**Handoffs for plan 162-08 (and the phase close):**
- Close HONEST-01's root-cause clause as documented-plus-repair, citing this trail.
- Repair the 2 rows in the query-6 population; the writer-side fix (plan 162-02) stops new
  leaks but cannot rewrite these.
- **File separately, not as HONEST-01:** (a) `poll_positions` has not been enqueued anywhere in
  PROD since 2026-06-14 although the daily enqueue exists at HEAD; (b) no `compute_analytics`
  job has run anywhere in PROD since 2026-05-27. Both are wider than this phase and neither is
  closed by it. If Sentry is consulted later, the search key is narrow and exact: job kind
  `poll_positions`, 2026-06-10 … 2026-06-14, two strategy ids.
