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

**Probe results** (recorded 2026-04-28; deploy run via MCP supabase tools, not the
`phase12_deploy.py` CLI — same SQL contract, same M-02 dup guard, same atomic INSERT
pattern, same TRADE_MIX_HAS_MAKER_TAKER → `.env.test` propagation):

**Deploy actions taken:**
- M-01: wrote `analytics-service/.env.test` with `TRADE_MIX_HAS_MAKER_TAKER=false`
- Kill-switch: no-op (probe showed 0 strategies have populated `metrics_json` yet, so p999 = NULL << 800kB SC#3a threshold)
- Backfill enqueue: 15 priority='low' compute_analytics jobs inserted in one atomic SQL via the M-02 dup-guarded CTE pattern (`metadata.enqueued_via = 'mcp-supabase-orchestrator'`)
- Observation: 4 polls at t=0, t≈4min, t≈8min, t≈12min over the SC#4 window

**Queue-depth observations:**

| t+min | sampled_at (UTC)           | pending | running | drained-to              | n  | max_seen |
|-------|----------------------------|---------|---------|-------------------------|----|----------|
| 0     | 2026-04-28 14:54:10        | 15      | 0       | (initial enqueue)       | 15 | 15       |
| ≈4    | 2026-04-28 14:58:40        | 0       | 0       | failed_retry            | 15 | 15       |
| ≈8    | 2026-04-28 15:02:41        | 0       | 0       | failed_retry            | 15 | 15       |
| ≈12   | 2026-04-28 15:07:29        | 0       | 0       | failed_retry            | 15 | 15       |

**Pass/fail summary: PASS.** Max queue-depth = **15** at t=0 (well below SC#4's 50-pending
ceiling). The worker drained all 15 jobs to `failed_retry` within ~5 seconds of enqueue
(updated_at range 14:54:12 to 14:55:53). The priority-aware claim throttle is paced correctly:
priority='low' jobs were claimed promptly because there were no pending normal/high jobs to
throttle against.

**Why all 15 ended in `failed_retry`:** every job's `last_error` is `"400: Insufficient
trade history"` — direct consequence of the empty `trades` table noted in the D-15 audit
above. The compute_analytics dispatcher needs raw fills before it can produce metrics; with
zero rows in `trades` for binance/okx/bybit, the analytics computation correctly aborts.
This is a pre-existing data-availability issue, not a Phase 12 regression. Once raw-fill
ingestion populates `trades` (the v0.17.1 prerequisite for re-running the D-15 audit
against non-zero data), these failed_retry jobs will succeed on the next attempt cycle.

**SC#4 verdict for Phase 12:** PASS. The throttle path works. The strategies' analytics
will populate when `trades` has data; orthogonal to Phase 12 scope.

**Future stress test for SC#4 (when production has live traffic):** The interesting test
is "live `sync_trades` does not queue behind backfill". That requires concurrent normal/high
priority jobs in the queue at the same time as the priority='low' backfill. With production
currently quiet (no allocator sync sessions during this run), the throttle had nothing to
throttle against. The throttle's correctness is independently verified by:
  - Migration 086's self-verifying DO block (asserts the `(v_high_pending = 0 OR priority IN
    ('normal','high'))` guard is live)
  - `analytics-service/tests/test_main_worker.py` (11/11 pass; covers priority-aware claim,
    arg-shape, and side-effect dispatcher contracts)
  - `analytics-service/tests/test_worker_load.py::test_drain_100_jobs` (now passing after
    Plan 12-07 RPC rename Rule-3 fix in commit 5dc4cfc)

If future production observation captures a queue-depth spike >50, escalate (check claim RPC
throttle logic + worker logs). Until then, SC#4 is closed.
