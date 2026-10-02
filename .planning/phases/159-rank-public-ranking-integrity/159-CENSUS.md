# Phase 159 — C-M1 PROD census (RANK-01 rank-visibility gate)

**Artifact:** `159-CENSUS.md` (D-01 / C-D1 decision gate)
**Authored:** 2026-08-21 (scaffold, plan 159-01 Task 1)
**Executed against PROD:** 2026-08-21 (plan 159-01 Task 2, orchestrator, read-only)
**PROD project ref (confirmed at execution):** `khslejtfbuezsmvmtsdn` (name `quantalyze`, ACTIVE_HEALTHY) — confirmed against the project list before any query ran; the TEST ref `qmnijlgmdhviwzwfyzlc` (`quantalyze-test`) was NOT used.

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

| category | published | with_analytics_row | after_gate | badge_floor_before | badge_floor_after |
| --- | --- | --- | --- | --- | --- |
| crypto-sma | 18 | 18 | 1 | true | **false** |

**One category exists in PROD.** All 18 published strategies carry an analytics row; exactly
**1** passes the two-value computed gate. `badge_floor_before` true -> `badge_floor_after`
false: this category crosses the `< 5` floor, so its percentile badges stop rendering
entirely. There is no `(no category)` partition — every published strategy is categorised.

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

| cohort_before | cohort_after |
| --- | --- |
| 3 | 1 |

**The min-N 20 floor was ALREADY unmet before the gate** (3 < 20). `get_verified_cohort_rank`
therefore returns NULL percentiles with an honest `cohort_n` today, and continues to after
the gate — the gate changes the cohort size (3 -> 1) but crosses no floor, because the floor
was never met. This is the one surface where the census proves *no* visible change.

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

**17 rows** — every one `computation_status = 'failed'` while carrying BOTH `sharpe` and
`cagr`. This is the entire population the RANK-01 gate exists for.

| id | computation_status | has_sharpe | has_cagr |
| --- | --- | --- | --- |
| `51a111ed-0000-4000-8000-000000000001` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000002` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000003` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000004` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000005` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000006` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000007` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000008` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000009` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000010` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000011` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000012` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000013` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000014` | failed | true | true |
| `51a111ed-0000-4000-8000-000000000015` | failed | true | true |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | failed | true | true |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | failed | true | true |

**Composition (interpretive query, counts only):**

| is_example | computation_status | n | computed_at | with_sharpe |
| --- | --- | --- | --- | --- |
| true | failed | 15 | 2026-05-27 | 15 |
| false | failed | 2 | 2026-08-21 | 2 |
| false | complete | 1 | 2026-08-21 | 1 |

**15 of the 17 polluting rows are seeded example strategies** (`is_example = true`, ids
`51a111ed-…-0000000000NN`), computed once on 2026-05-27 and `failed` ever since while
retaining KPI values. The remaining 2 are real strategies that failed on 2026-08-21. The
single gate survivor is a real, `complete` strategy computed 2026-08-21.

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

All 18 published strategies x 7 KPIs = **126 rows**, category `crypto-sma` throughout.
`pct_after = NULL` means the strategy was itself gated out (its rank disappears).

**KPI `cagr`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 22 | 100 |
| `51a111ed-0000-4000-8000-000000000001` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 39 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 11 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 100 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 28 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 67 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 83 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 33 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 89 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 94 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 17 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 6 | NULL |

**KPI `calmar`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 33 | 100 |
| `51a111ed-0000-4000-8000-000000000001` | 89 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 67 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 100 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 11 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 83 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 22 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 22 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 39 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 94 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 28 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 6 | NULL |

**KPI `cumulative_return`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 22 | 100 |
| `51a111ed-0000-4000-8000-000000000001` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 39 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 83 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 6 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 100 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 67 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 28 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 33 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 89 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 94 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 17 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 11 | NULL |

**KPI `max_drawdown`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 89 | 0 |
| `51a111ed-0000-4000-8000-000000000001` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 83 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 0 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 6 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 67 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 22 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 11 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 28 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 33 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 39 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 94 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 17 | NULL |

**KPI `sharpe`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 33 | 100 |
| `51a111ed-0000-4000-8000-000000000001` | 89 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 100 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 11 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 67 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 83 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 22 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 28 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 39 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 94 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 17 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 6 | NULL |

**KPI `sortino`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 33 | 100 |
| `51a111ed-0000-4000-8000-000000000001` | 89 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 94 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 11 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 67 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 83 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 22 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 28 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 39 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 100 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 17 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 6 | NULL |

**KPI `volatility`**

| strategy_id | pct_before | pct_after |
| --- | --- | --- |
| `13f7b07f-b792-41fc-bfef-6854adce2c4f` | 83 | 0 |
| `51a111ed-0000-4000-8000-000000000001` | 89 | NULL |
| `51a111ed-0000-4000-8000-000000000002` | 94 | NULL |
| `51a111ed-0000-4000-8000-000000000003` | 78 | NULL |
| `51a111ed-0000-4000-8000-000000000004` | 11 | NULL |
| `51a111ed-0000-4000-8000-000000000005` | 0 | NULL |
| `51a111ed-0000-4000-8000-000000000006` | 44 | NULL |
| `51a111ed-0000-4000-8000-000000000007` | 72 | NULL |
| `51a111ed-0000-4000-8000-000000000008` | 28 | NULL |
| `51a111ed-0000-4000-8000-000000000009` | 50 | NULL |
| `51a111ed-0000-4000-8000-000000000010` | 39 | NULL |
| `51a111ed-0000-4000-8000-000000000011` | 56 | NULL |
| `51a111ed-0000-4000-8000-000000000012` | 17 | NULL |
| `51a111ed-0000-4000-8000-000000000013` | 22 | NULL |
| `51a111ed-0000-4000-8000-000000000014` | 61 | NULL |
| `51a111ed-0000-4000-8000-000000000015` | 33 | NULL |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | 67 | NULL |
| `fc1b4014-da41-49d7-8592-138be5a6fa12` | 6 | NULL |

**Reading:** 17 of 18 strategies have `pct_after = NULL` on every KPI — gated out. The sole
survivor `13f7b07f-…` becomes a **single-member cohort**, so `cume_dist` puts it at 100 on
every higher-is-better KPI and 0 on both lower-is-better KPIs (`max_drawdown`, `volatility`).
That degenerate self-percentile is exactly what the `< 5` badge floor exists to suppress —
and it holds: with `after_gate = 1`, no badge renders. The floor is doing its job.

---

## Floor crossings and expected visible changes (C-D1)

Filled at census execution. Each prompt is answered with concrete categories/ids **or the
word "none"** — never left blank. These entries are the phase-UAT surfacing input (D-01).

### (a) Categories crossing the `<5` badge floor because of the gate

From Query 1: every row where `badge_floor_before` is true and `badge_floor_after` is false.
Those categories lose their percentile badges entirely.

**`crypto-sma`** — the only category in PROD. `badge_floor_before` true (18 rows),
`badge_floor_after` false (1 row). It crosses the floor, so **every percentile badge on the
public discovery surface stops rendering** once the gate lands. This is the single largest
visible change in phase 159 and the headline UAT expectation.

### (b) Does the RPC cohort cross the min-N 20 floor?

From Query 2: state `cohort_before`, `cohort_after`, and whether `cohort_after < 20`. If it
does, `get_verified_cohort_rank` begins returning NULL percentiles with an honest
`cohort_n` for every caller.

`cohort_before` = **3**, `cohort_after` = **1**. `cohort_after < 20` is **true** — but so was
`cohort_before < 20`. **No crossing occurs**: the RPC already returns NULL percentiles with an
honest `cohort_n` today and will continue to. The gate is invisible on this surface.

### (c) Strategies whose percentile visibly moves or disappears

From Query 4: strategy ids whose `pct_after` is NULL (rank disappears — the strategy was
itself gated out) and ids whose `pct_after` differs materially from `pct_before` (rank moves
because polluted peers left the cohort). List by id and KPI.

**Rank disappears (pct_after NULL) — 17 strategies, all 7 KPIs each:** the 15 seeded example
ids `51a111ed-0000-4000-8000-000000000001` … `-000000000015`, plus
`8581f739-1a7b-42a4-a209-3acfa327e259` and `fc1b4014-da41-49d7-8592-138be5a6fa12`.

**Rank moves — 1 strategy, `13f7b07f-b792-41fc-bfef-6854adce2c4f`** (the sole survivor), on
all 7 KPIs: `cagr` 22 -> 100, `calmar` 33 -> 100, `cumulative_return` 22 -> 100, `sharpe`
33 -> 100, `sortino` 33 -> 100, `max_drawdown` 89 -> 0, `volatility` 83 -> 0. Direction is
**not** uniform — it improves on five KPIs and worsens on two, which is precisely why no test
may assert "ranks improve" (success criterion 2). None of these values render: the `< 5`
badge floor suppresses the whole category.

### (d) Root-cause note — the pollution is 88% seeded demo data (recorded, not acted on here)

15 of the 17 gated-out rows are `is_example = true` seed strategies whose analytics have sat
at `failed` since 2026-05-27 while still carrying KPI values. The gate treats them correctly:
a failed computation must not produce a published rank. But it means the visible badge loss on
`crypto-sma` is driven by **demo-data quality**, not by real user data — only 2 real strategies
are gated out, and 1 real strategy survives.

That is a data-repair question (recompute or unpublish the examples), **not** a code question,
and it is explicitly OUT of phase-159 scope. Logged to TODOS.md as a follow-up so the badge
loss has a recorded remedy path rather than becoming permanent by silence.

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
