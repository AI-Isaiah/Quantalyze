# Phase 162 — PROD census (HONEST-01 root cause / HONEST-02 flat-vs-gap)

**Artifact:** `162-CENSUS.md` (the phase's decision gate — plans 162-07 and 162-08 branch on the verdict lines below)
**Authored:** 2026-08-26 (scaffold, plan 162-01 Task 1)
**Executed against PROD:** _(filled by Task 2)_
**Read lane used:** _(filled by Task 2)_
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
| S2 — the FRESH-but-stale factsheet | HONEST-02 | the "Phoenix Protocol" strategy; observation window ended **2026-05-06** while the chip read `COMPUTED · FRESH (0d)`. Its id is resolved by query 0 and used by ids thereafter. |

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
   OR s.name = 'Phoenix Protocol'
ORDER BY 2;
```

### Results

_(filled by Task 2)_

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

_(filled by Task 2)_

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

_(filled by Task 2)_

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

_(filled by Task 2)_

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

### Results

_(filled by Task 2)_

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

### Results

_(filled by Task 2)_

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

| id | surface | computation_status | computed_on | p_str_none | p_traceback | p_type_prefix | error_len |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _(filled by Task 2)_ | | | | | | | |

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
  (s.name = 'Phoenix Protocol')                 AS is_s2
FROM strategies s
LEFT JOIN strategy_analytics a ON a.strategy_id = s.id
LEFT JOIN api_keys k           ON k.id = s.api_key_id
WHERE s.is_example = true
  AND s.status = 'published'
ORDER BY 5, 1;
```

### Results — example-row status

| id | source | has_api_key | exchange | computation_status | computed_on | has_returns_series | has_daily_returns | had_error | is_s2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _(filled by Task 2)_ | | | | | | | | | |

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
HONEST-02 VERDICT: _(filled by Task 2 — flat-account | derive-gap)_
```

**Evidence trail:** _(filled by Task 2 — the specific rows that decided it)_

**A2 answer (is S2 one of the 15 example rows?):** _(filled by Task 2)_

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
HONEST-01 ROOT-CAUSE: _(filled by Task 2 — site-identified <path:line> | site-gone | inconclusive)_
```

**Evidence trail:** _(filled by Task 2)_
