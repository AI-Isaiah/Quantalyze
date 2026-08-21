# Phase 159 — C-M1 PROD census (RANK-01 rank-visibility gate)

**Artifact:** `159-CENSUS.md` (D-01 / C-D1 decision gate)
**Authored:** 2026-08-21 (scaffold, plan 159-01 Task 1)
**Executed against PROD:** _pending — filled at plan 159-01 Task 2_
**PROD project ref (confirmed at execution):** _pending — recorded by the orchestrator before any query runs_

## Purpose

This file is the decided gate for every rank-visibility change in phase 159. Per D-01
(159-CONTEXT.md §Census & the C-D1 decision gate), it must exist **as a committed artifact
with real PROD numbers before** the RANK-01 percentile filter or the
`get_verified_cohort_rank` migration lands. It records:

- per-category published-with-analytics counts **before and after** the
  `isComputedAnalytics` gate, measured against **both** floors — the `< 5` badge floor
  (`src/lib/queries.ts:170` / `:180`, and the `getOwnRowPercentiles` twin at `:634` / `:646`)
  and the RPC min-N floor of `20`
  (`supabase/migrations/20260626120000_get_verified_cohort_rank.sql:152`);
- the pollution population the gate exists for — published strategies whose
  **non-computed** analytics rows nonetheless hold KPI values (the 2026-05-27-era fossil class);
- a per-strategy percentile **before/after** snapshot, keyed on strategy ids only;
- an explicit floor-crossing / expected-visible-change analysis for phase UAT.

## Rule of this file: no PII, ever

**This repository is PUBLIC and `.planning/` is tracked — everything pasted below is
world-readable on push.** The census therefore carries **counts, percentiles, and strategy
ids ONLY**. Never an email address, never an auth uid, never a user name, never a
credential, never a project URL. Strategy ids are non-secret per SHARE-01; nothing else
about a user is. Before pasting any result table, strip every email- or uid-shaped value
and every column not named in the query's own output list.

**All four queries below are read-only `SELECT`s.** No statement in this file mutates
PROD. The orchestrator executes exactly the blocks on this page — nothing improvised.

## The gate predicate (single source)

Everywhere in this census the computed-analytics gate is the **two-value** list

```
computation_status IN ('complete','complete_with_warnings')
```

matching `isComputedAnalytics` in `src/lib/closed-sets.ts` — `complete_with_warnings` **is**
a terminal success. A single-value equality on `'complete'` would measure a different,
stricter population than the one the phase actually ships, and appears nowhere here.

---

## Query 1 — per-category counts vs the `<5` badge floor

Copied verbatim from `159-RESEARCH.md` §Code Examples.

```sql
-- Per-category published-with-analytics counts, before/after the gate,
-- against the <5 badge floor (queries.ts) — plus the uncategorized pool.
SELECT
  coalesce(dc.slug, '(no category)')                                   AS category,
  count(*)                                                             AS published,
  count(a.strategy_id)                                                 AS with_analytics_row,
  count(*) FILTER (WHERE a.computation_status IN
                   ('complete','complete_with_warnings'))              AS after_gate,
  (count(a.strategy_id) >= 5)                                          AS badge_floor_before,
  (count(*) FILTER (WHERE a.computation_status IN
                   ('complete','complete_with_warnings')) >= 5)        AS badge_floor_after
FROM strategies s
LEFT JOIN strategy_analytics a  ON a.strategy_id = s.id
LEFT JOIN discovery_categories dc ON dc.id = s.category_id
WHERE s.status = 'published'
GROUP BY 1 ORDER BY 1;
```

### Results

RESULTS: PENDING

---

## Query 2 — RPC cohort vs min-N 20

Copied verbatim from `159-RESEARCH.md` §Code Examples. The floor is
`v_min_n CONSTANT INT := 20` at `20260626120000_get_verified_cohort_rank.sql:152`; below it
the RPC returns the honest `cohort_n` with all three percentiles NULL.

```sql
-- RPC cohort (min-N 20 floor), before/after the gate.
SELECT
  count(*)                                                             AS cohort_before,
  count(*) FILTER (WHERE a.computation_status IN
                   ('complete','complete_with_warnings'))              AS cohort_after
FROM strategies s
JOIN strategy_analytics a ON a.strategy_id = s.id
WHERE s.status = 'published'
  AND a.sharpe IS NOT NULL AND a.sortino IS NOT NULL AND a.max_drawdown IS NOT NULL
  AND EXISTS (SELECT 1 FROM strategy_verifications v
              WHERE v.strategy_id = s.id AND v.status = 'published');
```

### Results

RESULTS: PENDING

---

## Query 3 — the pollution population (fossil rows)

Copied verbatim from `159-RESEARCH.md` §Code Examples. This is the population RANK-01
exists to remove: published strategies whose analytics row never reached a terminal
success yet still carries KPI values.

```sql
-- The pollution population the gate exists for (ids only — no names/emails).
SELECT s.id, a.computation_status,
       (a.sharpe IS NOT NULL) AS has_sharpe, (a.cagr IS NOT NULL) AS has_cagr
FROM strategies s JOIN strategy_analytics a ON a.strategy_id = s.id
WHERE s.status = 'published'
  AND a.computation_status NOT IN ('complete','complete_with_warnings')
  AND (a.sharpe IS NOT NULL OR a.cagr IS NOT NULL);
```

### Results

RESULTS: PENDING

---

## Query 4 — per-strategy percentile before/after snapshot

Authored for this census (not in RESEARCH), mirroring the TS scorer **from source**, not
from memory. Provenance of every convention below:

| Convention | Source |
|---|---|
| The seven KPIs | `src/lib/queries.ts:126-127` (`PERCENTILE_ANALYTICS_COLUMNS`), identical to `PERCENTILE_METRICS` at `src/lib/percentile-core.ts:32-40` |
| `abs()` on `max_drawdown` | `src/lib/percentile-core.ts:60-64` (`metricValue`) — stored negative, so the magnitude is taken before ranking |
| `percentile = count(values <= v) / n * 100` | `src/lib/percentile-core.ts:108-109` |
| LOWER_IS_BETTER = exactly `max_drawdown`, `volatility` → `100 - percentile` | `src/lib/percentile-core.ts:45` and `:111-113` |
| Inversion happens **before** rounding | `src/lib/percentile-core.ts:111-118` — inverting after rounding disagrees by 1 on exact `.5` ties |
| Self-inclusive cohort (subject is a population member) | `src/lib/percentile-core.ts:15-28`, `:103-105`; `getPercentiles` passes `rows` as both subjects and population (`queries.ts:182`) |

`cume_dist()` over the cohort is precisely `count(values <= v) / n`, so the window
reproduces the TS formula rather than re-deriving it. BEFORE cohort = published strategies
holding a non-null value for that KPI. AFTER cohort = the same population restricted by the
two-value gate. A strategy gated out has **no** AFTER row, so its `pct_after` is NULL — that
NULL is the literal "this rank disappears" signal.

Note on partitioning: the live per-category surface uses an inner join on
`discovery_categories` (`queries.ts:146-152`), so the `(no category)` partition below is
**not** a rendered ranking surface; it is included only so the snapshot is exhaustive.

```sql
-- Per-strategy percentile before/after the computed-analytics gate.
-- Read-only. Strategy ids only — no names, emails, or uids in the output list.
WITH published AS (
  SELECT s.id                               AS strategy_id,
         coalesce(dc.slug, '(no category)') AS category,
         a.computation_status,
         a.cagr, a.sharpe, a.sortino, a.calmar,
         a.max_drawdown, a.volatility, a.cumulative_return
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  LEFT JOIN discovery_categories dc ON dc.id = s.category_id
  WHERE s.status = 'published'
),
-- Unpivot the seven PERCENTILE_ANALYTICS_COLUMNS KPIs into (kpi, val);
-- abs() on max_drawdown mirrors percentile-core.ts:60-64.
unpivoted AS (
  SELECT p.strategy_id, p.category, p.computation_status, k.kpi,
         CASE WHEN k.kpi = 'max_drawdown' THEN abs(k.val) ELSE k.val END AS val
  FROM published p
  CROSS JOIN LATERAL (VALUES
      ('cagr',              p.cagr::numeric),
      ('sharpe',            p.sharpe::numeric),
      ('sortino',           p.sortino::numeric),
      ('calmar',            p.calmar::numeric),
      ('max_drawdown',      p.max_drawdown::numeric),
      ('volatility',        p.volatility::numeric),
      ('cumulative_return', p.cumulative_return::numeric)
  ) AS k(kpi, val)
  WHERE k.val IS NOT NULL
),
-- BEFORE: every published strategy with a non-null value for the KPI.
before_raw AS (
  SELECT strategy_id, category, kpi,
         (100.0 * cume_dist() OVER (PARTITION BY category, kpi ORDER BY val))::numeric AS raw_pct
  FROM unpivoted
),
-- AFTER: the same population restricted by the two-value gate.
after_raw AS (
  SELECT strategy_id, category, kpi,
         (100.0 * cume_dist() OVER (PARTITION BY category, kpi ORDER BY val))::numeric AS raw_pct
  FROM unpivoted
  WHERE computation_status IN ('complete','complete_with_warnings')
)
SELECT b.strategy_id,
       b.category,
       b.kpi,
       round(CASE WHEN b.kpi IN ('max_drawdown','volatility')
                  THEN 100 - b.raw_pct ELSE b.raw_pct END) AS pct_before,
       round(CASE WHEN b.kpi IN ('max_drawdown','volatility')
                  THEN 100 - f.raw_pct ELSE f.raw_pct END) AS pct_after
FROM before_raw b
LEFT JOIN after_raw f
       ON f.strategy_id = b.strategy_id
      AND f.category    = b.category
      AND f.kpi         = b.kpi
ORDER BY b.category, b.kpi, b.strategy_id;
```

### Results

RESULTS: PENDING

---

## Floor crossings and expected visible changes (C-D1)

Filled at census execution. Each prompt is answered with concrete categories/ids **or the
word "none"** — never left blank. These entries are the phase-UAT surfacing input (D-01).

### (a) Categories crossing the `<5` badge floor because of the gate

From Query 1: every row where `badge_floor_before` is true and `badge_floor_after` is false.
Those categories lose their percentile badges entirely.

_pending_

### (b) Does the RPC cohort cross the min-N 20 floor?

From Query 2: state `cohort_before`, `cohort_after`, and whether `cohort_after < 20`. If it
does, `get_verified_cohort_rank` begins returning NULL percentiles with an honest
`cohort_n` for every caller.

_pending_

### (c) Strategies whose percentile visibly moves or disappears

From Query 4: strategy ids whose `pct_after` is NULL (rank disappears — the strategy was
itself gated out) and ids whose `pct_after` differs materially from `pct_before` (rank moves
because polluted peers left the cohort). List by id and KPI.

_pending_

### The D-01 decision

**The filter proceeds regardless.** A disappearing rank is the HONEST, pre-decided
outcome — the ROADMAP already made this call, and this census exists so that the change is
a *decided* one, surfaced in UAT, never a surprise. Nothing recorded above can veto the
gate; it only determines what phase UAT must be told to expect. Consistent with success
criterion 2, **no test asserts rank direction** — removing polluted rows moves other
strategies' percentiles both ways, and a "ranks improve" assertion would be false.

---

*Phase: 159-rank-public-ranking-integrity*
*Plan: 159-01 (scaffold Task 1; PROD results Task 2)*
