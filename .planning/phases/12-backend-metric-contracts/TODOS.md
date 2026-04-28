# Phase 12 — TODOS

## D-15: is_maker coverage audit (run 2026-04-28)

**Audit SQL (executed against production Supabase project `khslejtfbuezsmvmtsdn`):**

```sql
SELECT exchange,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE is_maker IS NOT NULL) AS populated,
       ROUND((COUNT(*) FILTER (WHERE is_maker IS NOT NULL))::numeric
             / NULLIF(COUNT(*), 0) * 100, 4) AS coverage_pct
FROM trades
WHERE is_fill = true
  AND exchange IN ('binance', 'okx', 'bybit')
GROUP BY exchange
ORDER BY exchange;
```

**Note on table name:** The plan-as-drafted referenced `raw_fills`; production schema has these
columns on `trades` with `is_fill = true` discriminating raw fills from legacy `daily_pnl` rows
(see `supabase/migrations/039_trades_raw_fills.sql:47` for `is_maker BOOLEAN` and
`039_trades_raw_fills.sql:46` for `is_fill BOOLEAN NOT NULL DEFAULT false`).
SQL corrected at audit time to query `trades WHERE is_fill = true` — same semantic, real table.

**Production state probe (all `trades` rows, not gated by `is_fill`):**

```sql
SELECT COUNT(*) AS row_count FROM trades;  -- => 0
SELECT (SELECT COUNT(*) FROM strategies) AS strategies,
       (SELECT COUNT(*) FROM strategies WHERE status='published') AS published,
       (SELECT COUNT(*) FROM strategy_analytics) AS analytics_rows;
-- => strategies=15, published=15, analytics_rows=15
```

15 published strategies with analytics rows, but the `trades` table is empty in production.
Raw-fill ingestion has not populated `trades` yet on this Supabase project — the fill rows live
upstream of where the v0.17 Trade Mix aggregator would read.

### Coverage table

| Exchange | Total fills | Populated (is_maker NOT NULL) | Coverage %       | Pass (≥99%)? |
|----------|-------------|-------------------------------|------------------|--------------|
| binance  | 0           | 0                             | undefined (0/0)  | NO           |
| okx      | 0           | 0                             | undefined (0/0)  | NO           |
| bybit    | 0           | 0                             | undefined (0/0)  | NO           |
| deribit  | N/A         | N/A                           | N/A              | N/A by design — `analytics-service/services/exchange.py:325-334` confirms `fetch_raw_trades` does not dispatch to Deribit (only binance/okx/bybit handlers; `else` branch logs `"unsupported exchange"` and returns []). |

**Audit method:** `supabase db query --linked` against project `khslejtfbuezsmvmtsdn` on 2026-04-28.
Aggregate query — read-only, no row-level data exfiltrated.

## D-15 Branch Decision

**TRADE_MIX_HAS_MAKER_TAKER = false**

- If all 3 exchanges ≥ 99%: TRUE → ship 4-bucket Trade Mix (long_maker, long_taker, short_maker, short_taker)
- If any 1 < 99%: FALSE → ship 2-bucket fallback (long, short) + log v0.17.1 follow-up

**Decision rationale:** The `trades` table contains zero rows for binance/okx/bybit on
production. Coverage of `is_maker` cannot meet the ≥ 99% threshold when `total = 0` for every
exchange (the ratio is undefined and division-by-zero returns NULL). Per D-15, *any* exchange
< 99% triggers the descope. Three exchanges with no data each fail the gate independently.

Ship the 2-bucket long/short fallback now. Defer the maker/taker dimension to v0.17.1 once
raw-fill ingestion has populated `trades` on production for at least binance/okx/bybit and the
audit can be re-run against a non-empty dataset.

**Downstream impact:**
- Wave D Trade Mix aggregator builds 2-bucket version (`trade_metrics.trade_mix.{long, short}`).
- `regen_golden.py` writes 2-bucket expected JSON; the parity fixture's expected output omits
  the 4-bucket keys (`long_maker`, `long_taker`, `short_maker`, `short_taker`). When
  TRADE_MIX_HAS_MAKER_TAKER flips to `true` in v0.17.1, the fixture regenerates with the
  4-bucket shape and the parity gate still passes.
- `src/lib/types.ts` `TradeMixBuckets` interface uses the 2-bucket shape (`{ long: Bucket;
  short: Bucket }`) with the maker/taker variants reachable behind a discriminated union when
  the flag flips.
- METRICS-10 done-criterion passes only if 2-bucket payload appears in `trade_metrics.trade_mix`.
- `analytics-service/scripts/phase12_deploy.py` (Plan 12-10 Task 2) reads this exact line via
  regex `TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)` and propagates `false` to `.env.test`
  (gitignored) so CI sources the value before running parity tests. The audit-table format
  above keeps the literal `TRADE_MIX_HAS_MAKER_TAKER = false` line so the regex match succeeds.

**v0.17.1 follow-up:** When raw-fill ingestion has populated `trades` for binance/okx/bybit
on production, re-run this audit. If coverage ≥ 99% on all three exchanges, flip
TRADE_MIX_HAS_MAKER_TAKER to `true`, regenerate `golden_252d_expected.json`, and ship the
4-bucket Trade Mix in v0.17.1. Add a tracking task in v0.17.1 milestone planning.

## Other Phase 12 todos

- [ ] Migration numbering reconciled: 086 + 087 (NOT 084/085 — those are taken by shipped
      Phase 11 work)

## Phase 12 SC#4 — queue-depth probe (Plan 12-10 Task 2)

Phase 12 SC#4: total `compute_analytics` pending count must never exceed 50 for >10 min
during the post-deploy backfill window. Plan 12-10 Task 2 records the probe data here.

**How to run** (every 60s for ~12 min after `python -m scripts.phase12_deploy` exits 0):
```bash
cd /Users/helios-mammut/claude-projects/quantalyze
export SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:?Set this from local env}"
supabase db remote query "SELECT priority, status, count(*) FROM compute_jobs WHERE kind='compute_analytics' AND status='pending' GROUP BY priority, status ORDER BY priority;"
```

**Probe results** (filled in at deploy time, recorded here for the SC#4 audit trail):

| t+min | priority | status  | count |
|-------|----------|---------|-------|
| 0     | _pending — record after `phase12_deploy.py` ships and is run against the live DB_ |       |       |

**Pass/fail summary:** _pending — record after the 12-min window closes._

If max `count` ≤ 50 across the window, SC#4 passes and the throttle
(`claim_compute_jobs_with_priority` RPC + dispatch_tick) is paced correctly. If any
60s tick records `count > 50`, escalate (check claim RPC throttle logic + worker logs)
and do NOT mark the plan complete.
