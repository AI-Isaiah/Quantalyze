# Phase 06: Allocator API Ingestion — Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 10 new/modified files
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/066_allocator_holdings.sql` | migration | CRUD + DDL | `supabase/migrations/062_scoring_weight_overrides.sql` | exact |
| `analytics-service/services/allocator_positions.py` | service | CRUD + batch | `analytics-service/services/positions.py` | exact |
| `analytics-service/services/job_worker.py` (extend) | worker | event-driven | self (extend `_exchange_preflight` + `dispatch()`) | exact |
| `analytics-service/services/exchange.py` (extend) | config/factory | request-response | self (extend `EXCHANGE_CLASSES`) | exact |
| `src/app/api/allocator/holdings/sync/route.ts` | route | request-response | `src/app/api/keys/sync/route.ts` | exact |
| `src/components/exchanges/AllocatorExchangeManager.tsx` (extend) | component | request-response + polling | self (extend disabled button + add pill) | exact |
| `src/components/exchanges/AllocatorSyncStatus.tsx` (new sub-component) | component | request-response | `src/components/mandate/MandateSaveStatus.tsx` | role-match |
| `src/lib/queries.ts` (extend) | utility | CRUD | self (extend `getUserApiKeys`) | exact |
| `src/lib/constants.ts` (extend) | config | — | self (extend `API_KEY_USER_COLUMNS_ARR`) | exact |
| `src/__tests__/allocator-holdings-rls.test.ts` | test | CRUD | `src/__tests__/bridge-outcomes-rls.test.ts` | exact |
| `analytics-service/tests/test_allocator_positions.py` | test | CRUD + batch | `analytics-service/services/positions.py` (test shape) | role-match |

---

## Pattern Assignments

---

### `supabase/migrations/066_allocator_holdings.sql` (migration, DDL + CRUD)

**Analog:** `supabase/migrations/062_scoring_weight_overrides.sql` (all 9 steps mirror exactly; Phase 06 adds a 10th step for the DO block which matches migration 062 lines 484–637)

**Secondary analog for RLS:** `supabase/migrations/059_bridge_outcomes.sql` (three-tier RLS policy block verbatim)

**Delta from analog:**
- Step 1: new `allocator_holdings` table (not a column add); includes `updated_at` trigger (mirror migration 059 Step 3 `bridge_outcomes_set_updated_at_trigger` shape).
- Step 2: `compute_jobs.api_key_id` column + 4-way XOR (extends migration 062's 3-way XOR by adding `api_key_id IS NULL` to all three existing branches and a new 4th branch).
- Step 3: `compute_job_kinds` INSERT for `poll_allocator_positions`.
- Step 4: new partial unique index `compute_jobs_one_inflight_per_kind_api_key`.
- Step 5: DROP+ADD `api_keys_sync_status_check` to add `revoked` and `rate_limited`.
- Step 6: DROP+REDEFINE `enqueue_compute_job` / `_enqueue_compute_job_internal` — add `p_api_key_id UUID DEFAULT NULL` and `p_run_at TIMESTAMPTZ DEFAULT NULL` as params 8 and 9.
- Step 7: CREATE FUNCTION `enqueue_poll_allocator_positions_for_all_keys()` SECURITY DEFINER.
- Step 8: `cron.schedule('poll-allocator-positions', '0 4 * * *', ...)`.
- Step 9: 3-tier RLS on `allocator_holdings`.
- Step 10: self-verifying DO block with explicit DELETE cleanup (NOT SAVEPOINT — see Landmine 6).
- GRANT: `GRANT SELECT (sync_error) ON api_keys TO authenticated` (Landmine 2).

**Pattern 1 — Step 2: 3-way XOR → 4-way XOR** (migration 062, lines 97–108):
```sql
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_target_xor;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_target_xor CHECK (
    (strategy_id IS NOT NULL AND portfolio_id IS NULL     AND allocator_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NOT NULL AND allocator_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NOT NULL)
  );
```
Phase 06 extends this by:
- Adding `AND api_key_id IS NULL` to every existing branch.
- Adding a 4th branch: `(strategy_id IS NULL AND portfolio_id IS NULL AND allocator_id IS NULL AND api_key_id IS NOT NULL)`.

**Pattern 2 — Step 4: kind coherence CHECK extension** (migration 062, lines 114–134):
```sql
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio'
        AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
    (kind = 'rescore_allocator'
        AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
    (kind IN (
      'sync_trades','compute_analytics','poll_positions',
      'sync_funding','reconcile_strategy','compute_intro_snapshot'
    ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL)
  );
```
Phase 06 adds before the closing `)`:
```sql
OR (kind = 'poll_allocator_positions'
    AND api_key_id IS NOT NULL AND strategy_id IS NULL
    AND portfolio_id IS NULL AND allocator_id IS NULL)
```
The XOR constraint already guarantees `api_key_id IS NULL` for every other branch, but the new branch must explicitly assert `api_key_id IS NOT NULL` (it's the sole non-null target for this kind).

**Pattern 3 — Step 6: DROP+REDEFINE enqueue_compute_job** (migration 062, lines 168–335):
```sql
-- Drop old 8-param signature (post-062):
DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid);
-- Drop old 7-param signature (post-062):
DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid);
```
Then redefine with trailing params added:
```sql
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,   -- NEW
  p_run_at          TIMESTAMPTZ DEFAULT NULL  -- NEW
)
```
The 4-way XOR guard inside the function body:
```sql
v_target_count :=
  (CASE WHEN p_strategy_id  IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN p_portfolio_id IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN p_allocator_id IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN p_api_key_id   IS NOT NULL THEN 1 ELSE 0 END);
IF v_target_count <> 1 THEN
  RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one target must be non-null ...';
END IF;
```
`p_run_at` maps to `next_attempt_at` in the INSERT (the existing column, confirmed at migration 032 line 123). Add branch to optimistic lookup and INSERT for `api_key_id`.

The current `enqueue_compute_job` raises on `p_strategy_id=NULL, p_allocator_id=NULL` (migration 062 lines 326–329) — **Landmine 4**. The Phase 06 redefine must add a third valid path and replace that RAISE with:
```sql
ELSIF p_api_key_id IS NOT NULL AND p_strategy_id IS NULL AND p_allocator_id IS NULL THEN
  RETURN _enqueue_compute_job_internal(
    NULL, NULL, p_kind, p_idempotency_key,
    p_parent_job_ids, p_exchange, p_metadata, NULL, p_api_key_id, p_run_at
  );
END IF;
RAISE EXCEPTION 'enqueue_compute_job: exactly one of p_strategy_id, p_allocator_id, p_api_key_id must be non-null ...';
```
`REVOKE ALL ON FUNCTION enqueue_compute_job FROM PUBLIC, anon, authenticated;` must follow both new function definitions (mirror migration 062 lines 289, 335).

**Pattern 4 — Step 7: SECURITY DEFINER cron-RPC** (migration 033, lines 221–278):
```sql
CREATE OR REPLACE FUNCTION enqueue_poll_positions_for_all_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id UUID;
  v_exchange TEXT;
  v_enqueued INTEGER := 0;
  v_job_id UUID;
  v_existing_count INTEGER;
BEGIN
  FOR v_strategy_id, v_exchange IN
    SELECT DISTINCT s.id, ak.exchange
      FROM strategies s
      JOIN api_keys ak ON ak.id = s.api_key_id
      WHERE s.api_key_id IS NOT NULL
        AND s.status IN ('published', 'pending_review')
        ...
  LOOP
    ...
    v_job_id := enqueue_compute_job(
      v_strategy_id,
      'poll_positions',
      'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_strategy_id::text,
      ...
    );
    IF v_existing_count = 0 AND v_job_id IS NOT NULL THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;
  RETURN v_enqueued;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon, authenticated;
```
Phase 06 analog: `enqueue_poll_allocator_positions_for_all_keys()` — iterate `api_keys WHERE is_active = true AND sync_status NOT IN ('revoked')`, call `enqueue_compute_job(p_api_key_id := ..., p_kind := 'poll_allocator_positions', p_run_at := now() + (random() * interval '600 seconds'))`. Use advisory lock name `'daily_allocator_polling'` (distinct from strategy-side `'daily_position_polling'`).

**Pattern 5 — Step 9: three-tier RLS** (migration 059, lines 219–239):
```sql
ALTER TABLE bridge_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bridge_outcomes_select_own ON bridge_outcomes;
CREATE POLICY bridge_outcomes_select_own ON bridge_outcomes FOR SELECT
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcomes_admin_read ON bridge_outcomes;
CREATE POLICY bridge_outcomes_admin_read ON bridge_outcomes FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- NOTE: No explicit service_role policy — service_role bypasses RLS by default
-- per ADR-0003. No DELETE policy ...
```
Phase 06 policies on `allocator_holdings` (D-03):
- `allocator_holdings_owner_select` — `FOR SELECT USING (allocator_id = auth.uid())`
- `allocator_holdings_admin_select` — `FOR SELECT USING (current_user_has_app_role('admin'))`
- `allocator_holdings_service_all` — `FOR ALL USING (auth.role() = 'service_role')`
No INSERT/UPDATE/DELETE policy for authenticated — worker is sole producer via service_role.

**Pattern 6 — Step 10: self-verifying DO block with explicit DELETE cleanup** (migration 062, lines 579–637):
```sql
DO $$
DECLARE
  v_probe_allocator UUID := gen_random_uuid();
  v_inserted_job_id UUID;
  -- ... other declares ...
BEGIN
  -- Schema invariant assertions
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'compute_jobs' AND column_name = 'allocator_id')
  INTO v_column_exists;
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'Migration 062 failed: compute_jobs.allocator_id missing';
  END IF;
  -- ... more assertions ...

  -- Functional probe (INSERT + assert shape + assert partial unique dedup)
  INSERT INTO auth.users (id, email) VALUES (v_probe_allocator, 'migration-062-probe@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  v_inserted_job_id := enqueue_compute_job(
    p_strategy_id  := NULL,
    p_kind         := 'rescore_allocator',
    p_allocator_id := v_probe_allocator
  );

  -- ... verify the row exists with correct shape ...

  -- Explicit cleanup — NOT SAVEPOINT (PL/pgSQL cannot issue transaction-control
  -- statements inside DO $$. SAVEPOINT/ROLLBACK TO are FORBIDDEN here).
  DELETE FROM compute_jobs WHERE allocator_id = v_probe_allocator;
  DELETE FROM auth.users WHERE id = v_probe_allocator;

END;
$$;
```
Phase 06 DO block must:
1. Assert `allocator_holdings` table exists, `compute_jobs.api_key_id` column exists, XOR constraint references `api_key_id`, kind coherence references `poll_allocator_positions`, partial unique index exists, `enqueue_compute_job` signature contains `p_api_key_id`.
2. Multi-actor RLS probe: INSERT two `allocator_holdings` rows (via service-role) owned by `v_probe_a` and `v_probe_b` auth users; switch role/claims; assert each sees only their own row.
3. Use explicit `DELETE FROM` cleanup at the end — not SAVEPOINT (Landmine 6).

**Acceptance anchors:**
- `grep -n 'api_key_id IS NOT NULL' supabase/migrations/066_allocator_holdings.sql` — appears in XOR CHECK + coherence CHECK + partial unique index predicate.
- `grep -n 'poll_allocator_positions' supabase/migrations/066_allocator_holdings.sql` — appears in kind coherence CHECK + `compute_job_kinds` INSERT + cron schedule + cron function body.
- `grep -n 'revoked\|rate_limited' supabase/migrations/066_allocator_holdings.sql` — appears in `api_keys_sync_status_check` ADD CONSTRAINT.
- `grep -n 'allocator_holdings_owner_select\|allocator_holdings_admin_select\|allocator_holdings_service_all' supabase/migrations/066_allocator_holdings.sql` — three policies present.
- `grep -n 'GRANT SELECT.*sync_error' supabase/migrations/066_allocator_holdings.sql` — must be present (Landmine 2 fix).

---

### `analytics-service/services/allocator_positions.py` (service, CRUD + batch)

**Analog:** `analytics-service/services/positions.py`

**Delta from analog:** New sibling file (not a mutation of `positions.py`). Public API: `fetch_allocator_holdings(exchange_name, exchange)` + `persist_allocator_holdings(supabase, holdings, allocator_id, api_key_id, asof_date)`. Imports `fetch_positions` + `_normalize_ccxt_position` from `positions.py` verbatim for the derivatives side. Adds a new spot normalizer.

**Pattern 1 — `_normalize_ccxt_position` for derivatives** (positions.py, lines 91–125):
```python
def _normalize_ccxt_position(pos: dict, exchange_name: str) -> dict | None:
    contracts = pos.get("contracts") or 0
    contract_size = pos.get("contractSize") or 1
    size_base = abs(float(contracts) * float(contract_size))
    if size_base < 1e-12:
        return None
    raw_side = pos.get("side", "")
    if raw_side in ("long", "short"):
        side = raw_side
    else:
        side = "flat"
    # Symbol: strip the funding/settlement suffix
    # "BTC/USDT:USDT" → "BTCUSDT"
    symbol = pos.get("symbol", "")
    symbol = symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")
    return {
        "symbol": symbol,
        "side": side,
        "size_base": size_base,
        "size_usd": float(pos.get("notional") or 0),
        "entry_price": float(pos.get("entryPrice") or 0),
        "mark_price": float(pos.get("markPrice") or 0),
        "unrealized_pnl": float(pos.get("unrealizedPnl") or 0),
        "exchange": exchange_name,
    }
```
Phase 06 reuses this for the derivatives normalization path. The output dict is remapped to `allocator_holdings` column names inside `fetch_allocator_holdings`.

**Pattern 2 — `persist_position_snapshots` idempotent upsert** (positions.py, lines 202–228):
```python
async def persist_position_snapshots(
    supabase_client: Any,
    snapshots: list[dict],
    strategy_id: str,
    snapshot_date: str,
) -> int:
    if not snapshots:
        return 0
    rows = [
        {**snap, "strategy_id": strategy_id, "snapshot_date": snapshot_date}
        for snap in snapshots
    ]
    def _upsert():
        return supabase_client.table("position_snapshots").upsert(
            rows,
            on_conflict="strategy_id,snapshot_date,symbol,side",
        ).execute()
    result = await db_execute(_upsert)
    return len(rows)
```
Phase 06 `persist_allocator_holdings` mirrors this shape exactly with:
- Table: `allocator_holdings`
- on_conflict: `"allocator_id,venue,symbol,asof"`
- Added fields per row: `allocator_id`, `api_key_id`, `asof` (date string), `venue` (= exchange name)

**Pattern 3 — spot normalizer shape (new, no direct analog):**
For spot rows from `exchange.fetch_balance()`:
- `symbol`: raw currency key from `balance['total']` (e.g. `"BTC"` stays `"BTC"` — no suffix strip needed, per D-16)
- `side`: `"flat"` (hardcoded for all spot rows)
- `holding_type`: `"spot"`
- `quantity`: `balance['total'][currency]`
- `value_usd`: `quantity * mark_price` (mark_price from `fetch_tickers(symbol_list)` bulk call; stablecoins USDT/USDC/BUSD get `mark_price=1.0` without a ticker call)
- `entry_price`: `None`
- `unrealized_pnl_usd`: `None`
- `cost_basis_usd`: `None` (D-06: spot rows never get cost basis from worker)
- `raw_payload`: truncated source dict (cap at ~4KB via `json.dumps(source)[:4096]`)

**Pattern 4 — `complete_with_warnings` partial-success** (Claude's discretion, Section 8 Q2):
If `fetch_balance()` succeeds but `fetch_positions()` raises a non-auth exception (transient exchange outage): persist the spot rows, return `sync_status='complete_with_warnings'` with `sync_error` = the positions error message (truncated to 500 chars via `classify_exception`). If `fetch_balance()` raises auth: classify as `revoked`. If `fetch_balance()` raises rate-limit: classify as `rate_limited` (no partial persist).

**Acceptance anchors:**
- `grep -n 'fetch_allocator_holdings\|persist_allocator_holdings' analytics-service/services/allocator_positions.py` — both public functions present.
- `grep -n "on_conflict.*allocator_id,venue,symbol,asof" analytics-service/services/allocator_positions.py` — idempotent upsert.
- `grep -n "holding_type.*spot\|holding_type.*derivative" analytics-service/services/allocator_positions.py` — both types emitted.
- `grep -n "cost_basis_usd" analytics-service/services/allocator_positions.py` — set from `entry_price * abs(quantity)` for derivatives, `None` for spot.

---

### `analytics-service/services/job_worker.py` (extend — dispatch chain + preflight + timeout)

**Analog:** self — extend existing `_exchange_preflight` (lines 310–355), `dispatch()` (lines 1170–1191), `TIMEOUT_PER_KIND` (lines 123–132).

**Delta from analog:**
1. Add `"poll_allocator_positions": 3 * 60` to `TIMEOUT_PER_KIND`.
2. Add new `_allocator_key_preflight(job, handler_name)` function (sibling of `_exchange_preflight`).
3. Add `run_poll_allocator_positions_job` handler.
4. Add `elif kind == "poll_allocator_positions":` branch to `dispatch()` before the `else`.

**Pattern 1 — `_exchange_preflight` as template for `_allocator_key_preflight`** (job_worker.py, lines 310–355):
```python
@dataclass
class _ExchangeContext:
    supabase: object
    strategy_row: dict
    key_row: dict
    exchange: object

async def _exchange_preflight(
    job: dict, handler_name: str
) -> DispatchResult | _ExchangeContext:
    strategy_id = job.get("strategy_id")
    if not strategy_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: strategy_id missing",
            error_kind="permanent",
        )
    kek = get_kek()
    supabase = get_supabase()
    strategy_row, key_row, error_msg = await _load_strategy_and_key(supabase, strategy_id)
    if error_msg:
        return DispatchResult(outcome=DispatchOutcome.FAILED, ...)
    defer_result = await _check_circuit_breaker(supabase, job, key_row)
    if defer_result is not None:
        return defer_result
    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
    exchange = create_exchange(key_row["exchange"], api_key, api_secret, passphrase)
    return _ExchangeContext(supabase=supabase, strategy_row=strategy_row,
                             key_row=key_row, exchange=exchange)
```
Phase 06 `_allocator_key_preflight` replaces the strategy-hop with a direct key load:
```python
async def _allocator_key_preflight(
    job: dict, handler_name: str
) -> DispatchResult | _ExchangeContext:
    api_key_id = job.get("api_key_id")
    if not api_key_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: api_key_id missing",
            error_kind="permanent",
        )
    kek = get_kek()
    supabase = get_supabase()
    # Direct load — no strategy hop
    res = supabase.table("api_keys").select("*").eq("id", api_key_id).maybe_single().execute()
    key_row = res.data
    if not key_row:
        return DispatchResult(outcome=DispatchOutcome.FAILED,
                              error_message=f"{handler_name}: api_key {api_key_id} not found",
                              error_kind="permanent")
    defer_result = await _check_circuit_breaker(supabase, job, key_row)
    if defer_result is not None:
        return defer_result
    api_key_dec, api_secret_dec, passphrase_dec = decrypt_credentials(key_row, kek)
    exchange = create_exchange(key_row["exchange"], api_key_dec, api_secret_dec, passphrase_dec)
    return _ExchangeContext(supabase=supabase, strategy_row=None,
                             key_row=key_row, exchange=exchange)
```
Reuse the existing `_ExchangeContext` dataclass with `strategy_row=None` (simpler than a new dataclass).

**Pattern 2 — `run_poll_positions_job` as template for `run_poll_allocator_positions_job`** (job_worker.py, lines 586–622):
```python
async def run_poll_positions_job(job: dict) -> DispatchResult:
    ctx = await _exchange_preflight(job, "run_poll_positions_job")
    if isinstance(ctx, DispatchResult):
        return ctx
    strategy_id = job["strategy_id"]
    try:
        snapshots = await fetch_positions(ctx.key_row["exchange"], ctx.exchange)
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
        raise
    finally:
        try:
            await ctx.exchange.close()
        except Exception:
            pass
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    count = await persist_position_snapshots(ctx.supabase, snapshots, strategy_id, today_str)
    return DispatchResult(outcome=DispatchOutcome.DONE)
```
Phase 06 variant calls `_allocator_key_preflight`, then `fetch_allocator_holdings` (from `allocator_positions.py`), then `persist_allocator_holdings`. Additionally:
- Maps `classify_exception` error_kind to `sync_status`: `permanent` → check if `AuthenticationError`/`PermissionDenied` → `'revoked'`; `transient` from `RateLimitExceeded` → `'rate_limited'`; other → `'error'`.
- Writes `api_keys.sync_status` + `sync_error` atomically with `mark_compute_job_failed` on the failure path (service-role client write).
- Emits audit events `allocator.holdings.sync_completed` (DONE) and `allocator.holdings.sync_failed` (FAILED) per D-18.

**Pattern 3 — `dispatch()` if/elif extension** (job_worker.py, lines 1188–1191):
```python
elif kind == "rescore_allocator":
    handler = run_rescore_allocator_job
else:
    handler = None
```
Insert before the `else`:
```python
elif kind == "poll_allocator_positions":
    handler = run_poll_allocator_positions_job
```

**Acceptance anchors:**
- `grep -n 'poll_allocator_positions' analytics-service/services/job_worker.py` — in TIMEOUT_PER_KIND + dispatch() elif chain.
- `grep -n '_allocator_key_preflight' analytics-service/services/job_worker.py` — function defined and called from `run_poll_allocator_positions_job`.
- `grep -n '_stamp_429\|classify_exception' analytics-service/services/job_worker.py` — both reused in the new handler.

---

### `analytics-service/services/exchange.py` (extend — add Deribit)

**Analog:** self — extend `EXCHANGE_CLASSES` at lines 11–15.

**Delta from analog:** Add `"deribit": ccxt.deribit` to the dict. This is **Landmine 1** — without this, `create_exchange("deribit", ...)` raises `ValueError: Unsupported exchange: deribit`.

**Pattern — EXCHANGE_CLASSES dict** (exchange.py, lines 1–32):
```python
import ccxt.async_support as ccxt
...
EXCHANGE_CLASSES: dict[str, type] = {
    "binance": ccxt.binance,
    "okx": ccxt.okx,
    "bybit": ccxt.bybit,
    # DERIBIT IS MISSING — Phase 06 adds it:
}

def create_exchange(exchange_name: str, api_key: str, api_secret: str,
                    passphrase: str | None = None) -> ccxt.Exchange:
    cls = EXCHANGE_CLASSES.get(exchange_name)
    if not cls:
        raise ValueError(f"Unsupported exchange: {exchange_name}")
    config: dict[str, Any] = {
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
    }
    if passphrase:
        config["password"] = passphrase
    return cls(config)
```
Add: `"deribit": ccxt.deribit`. Deribit uses `client_id`/`client_secret` stored in the `api_key`/`api_secret` envelope respectively; `passphrase` is `None`. The `validate_exchange_id` check at line 59 (`if exchange.id not in EXCHANGE_CLASSES`) will automatically include Deribit once the key is added. Add a `_fetch_balance_deribit` branch in `allocator_positions.py` if `fetch_balance()` shape testing reveals per-currency call is needed.

**Acceptance anchors:**
- `grep -n 'deribit' analytics-service/services/exchange.py` — present in `EXCHANGE_CLASSES`.

---

### `src/app/api/allocator/holdings/sync/route.ts` (route, request-response)

**Analog:** `src/app/api/keys/sync/route.ts`

**Delta from analog:** No legacy `after()` path (queue path only). Ownership check is on `api_keys` not `strategies`. Returns `200` (not `202`) per D-10 shape. Catches `23505` SQLSTATE from in-flight unique index and returns `{ already_inflight: true }`. Emits `allocator.holdings.sync_requested` audit event.

**Pattern 1 — withAuth + ownership check** (keys/sync/route.ts, lines 1–76):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { logAuditEvent } from "@/lib/audit";
import type { User } from "@supabase/supabase-js";

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { strategy_id } = body;
  if (!strategy_id || typeof strategy_id !== "string") {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400 });
  }
  // Ownership check via user-scoped client
  const supabase = await createClient();
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, user_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();
  if (!strategy) {
    return NextResponse.json(
      { error: "Strategy not found or not owned by you" },
      { status: 403 },
    );
  }
  ...
```
Phase 06 variant: replace `strategies` ownership check with `api_keys`:
```typescript
const { data: apiKey } = await supabase
  .from("api_keys")
  .select("id, user_id")
  .eq("id", api_key_id)
  .eq("user_id", user.id)
  .single();
if (!apiKey) {
  return NextResponse.json(
    { error: "API key not found or not owned by you" },
    { status: 403 },
  );
}
```

**Pattern 2 — enqueue via admin client + audit** (keys/sync/route.ts, lines 79–116):
```typescript
const admin = createAdminClient();
const { data: rpcData, error: rpcError } = await admin.rpc(
  "enqueue_compute_job",
  { p_strategy_id: strategy_id, p_kind: "sync_trades" },
);
if (rpcError) {
  return NextResponse.json({ error: "Could not start sync." }, { status: 503 });
}
logAuditEvent(supabase, {
  action: "sync.start",
  entity_type: "sync",
  entity_id: strategy_id,
  metadata: { path: "queue" },
});
return NextResponse.json({ accepted: true, strategy_id, status: "syncing" }, { status: 202 });
```
Phase 06 variant: call `enqueue_compute_job` with `p_api_key_id` and set `sync_status='syncing'` in the same request. Catch 23505 (unique violation from in-flight index) and return `200 { already_inflight: true }` per D-10. Use `logAuditEvent` with `action: "allocator.holdings.sync_requested"`.

**Acceptance anchors:**
- `grep -n 'withAuth' src/app/api/allocator/holdings/sync/route.ts` — present.
- `grep -n 'already_inflight' src/app/api/allocator/holdings/sync/route.ts` — 23505 catch returns this.
- `grep -n 'allocator.holdings.sync_requested' src/app/api/allocator/holdings/sync/route.ts` — audit event present.
- `grep -n 'api_key_id' src/app/api/allocator/holdings/sync/route.ts` — body param + enqueue call.

---

### `src/components/exchanges/AllocatorExchangeManager.tsx` (extend — Sync now button + polling)

**Analog:** self — extend. Primary patterns from `MandateSaveStatus.tsx` (aria-live) and RESEARCH.md Section 4.

**Delta from analog:**
1. Add `sync_error: string | null` to `ExchangeConnection` interface (Landmine 3).
2. Add `handleSync(apiKeyId)` function calling `POST /api/allocator/holdings/sync`.
3. Replace disabled `Auto-synced` button (lines 235–241) with real `Sync now` button.
4. Add 5s `router.refresh()` polling loop via `useEffect` + `setInterval` (D-11).
5. Add `useEffect(() => { setKeys(initialKeys); }, [initialKeys])` to sync prop changes back to state (Landmine 8).
6. Render `<AllocatorSyncStatus>` sub-component per row.

**Pattern 1 — existing disabled button to replace** (AllocatorExchangeManager.tsx, lines 235–241):
```tsx
<Button
  variant="secondary"
  disabled
  title="Exchange sync is not yet available"
>
  Auto-synced
</Button>
```
Replace with:
```tsx
<Button
  variant="primary"
  disabled={key.sync_status === "syncing"}
  aria-label={`Sync ${key.exchange} now`}
  onClick={() => handleSync(key.id)}
>
  Sync now
</Button>
```

**Pattern 2 — router.refresh() via startTransition** (AllocatorExchangeManager.tsx, line 156):
```typescript
startTransition(() => router.refresh());
```
5s polling loop:
```typescript
useEffect(() => {
  const hasSyncing = keys.some((k) => k.sync_status === "syncing");
  if (!hasSyncing) return;
  const id = setInterval(() => {
    startTransition(() => router.refresh());
  }, 5000);
  return () => clearInterval(id);
}, [keys, startTransition]);
```

**Pattern 3 — initialKeys prop sync to state** (from RESEARCH.md Landmine 8):
```typescript
useEffect(() => {
  setKeys(initialKeys);
}, [initialKeys]);
```
Add immediately after the `useState(initialKeys)` line. Without this, `router.refresh()` re-renders the server component but the client state stays stale.

**Pattern 4 — handleSync function** (mirrors handleAddKey shape at lines 91–161):
```typescript
async function handleSync(apiKeyId: string) {
  setKeys((prev) =>
    prev.map((k) =>
      k.id === apiKeyId ? { ...k, sync_status: "syncing" } : k
    )
  );
  try {
    const res = await fetch("/api/allocator/holdings/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key_id: apiKeyId }),
    });
    const json = await res.json();
    if (!res.ok && !json.already_inflight) {
      // Row-scoped error: show in helper line, do NOT mutate sync_status
      setKeys((prev) =>
        prev.map((k) =>
          k.id === apiKeyId
            ? { ...k, sync_status: k.sync_status, sync_error: "Sync request failed — try again" }
            : k
        )
      );
    }
  } catch {
    // Network error — revert optimistic syncing
    setKeys((prev) =>
      prev.map((k) =>
        k.id === apiKeyId
          ? { ...k, sync_status: null, sync_error: "Sync request failed — try again" }
          : k
      )
    );
  }
}
```

**Acceptance anchors:**
- `grep -n 'sync_error' src/components/exchanges/AllocatorExchangeManager.tsx` — in `ExchangeConnection` interface + handleSync.
- `grep -n 'setInterval\|clearInterval' src/components/exchanges/AllocatorExchangeManager.tsx` — polling loop present.
- `grep -n 'initialKeys' src/components/exchanges/AllocatorExchangeManager.tsx` — `useEffect` sync to state present.
- `grep -n 'already_inflight' src/components/exchanges/AllocatorExchangeManager.tsx` — handled in handleSync.

---

### `src/components/exchanges/AllocatorSyncStatus.tsx` (new sub-component)

**Analog:** `src/components/mandate/MandateSaveStatus.tsx`

**Delta from analog:** Seven-state pill instead of three-state save status. No self-tick timer. Returns pill + optional helper line. Props: `{ syncStatus, syncError, lastSyncAt, retryAtSeconds?, exchange }`.

**Pattern 1 — aria-live region** (MandateSaveStatus.tsx, lines 43–48):
```tsx
<div
  role="status"
  aria-live="polite"
  data-testid="mandate-save-status"
  className="text-xs text-text-muted font-metric tabular-nums tracking-tight"
>
```
Phase 06 helper line:
```tsx
<div
  role="status"
  aria-live="polite"
  className="text-xs text-text-muted mt-1"
>
  {helperText && <span>{helperText}</span>}
</div>
```
The pill itself does NOT get aria-live — the helper line is the sole announcement channel (per UI-SPEC aria-live contract).

**Pattern 2 — inline SVG spinner** (MandateSaveStatus.tsx, lines 56–65):
```tsx
<span
  aria-hidden="true"
  className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-accent/10 text-accent"
>
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
    <path d="M1.5 4l2 2 3-4" stroke="currentColor" strokeWidth="1.5" ... />
  </svg>
</span>
```
Phase 06 spinner: 12×12 SVG circle with 270° stroke arc, CSS `animation: spin 1s linear infinite`. Freeze on `prefers-reduced-motion: reduce` per `globals.css` precedent.

**Pattern 3 — seven-state pill color map** (UI-SPEC pill color table):
```typescript
// Inline in AllocatorSyncStatus.tsx
const PILL_STYLES: Record<string, { pill: string; text: string }> = {
  idle:                  { pill: "bg-[#F1F5F9]",   text: "text-text-secondary" },
  syncing:               { pill: "bg-[#F1F5F9]",   text: "text-text-secondary" },
  complete:              { pill: "bg-[#F1F5F9]",   text: "text-text-secondary" },
  complete_with_warnings:{ pill: "bg-warning/10",  text: "text-warning" },
  rate_limited:          { pill: "bg-warning/10",  text: "text-warning" },
  revoked:               { pill: "bg-negative/10", text: "text-negative" },
  error:                 { pill: "bg-negative/10", text: "text-negative" },
};
```
Pill label constants (LOCKED D-08 — do not reword):
```typescript
// U+2026 ellipsis — NOT three dots
const PILL_LABEL: Record<string, string> = {
  idle:                   "Idle",
  syncing:                "Syncing\u2026",
  complete:               "Synced {relative time ago}",  // interpolate formatRelative(lastSyncAt)
  complete_with_warnings: "Synced (warnings)",
  rate_limited:           "Rate limited \u2014 retry in {N}s",  // interpolate retryAtSeconds
  revoked:                "Key revoked",
  error:                  "Sync failed",
};
```

**Acceptance anchors:**
- `grep -n 'aria-live.*polite' src/components/exchanges/AllocatorSyncStatus.tsx` — present.
- `grep -n 'Syncing\\\\u2026\|Syncing…' src/components/exchanges/AllocatorSyncStatus.tsx` — U+2026 ellipsis used, not `...`.
- `grep -n 'bg-warning/10\|bg-negative/10' src/components/exchanges/AllocatorSyncStatus.tsx` — both semantic colors present.

---

### `src/lib/queries.ts` (extend — `getUserApiKeys` projection)

**Analog:** self — extend `getUserApiKeys` (lines 609–625).

**Delta from analog:** Add `sync_error` to the projection. Requires `GRANT SELECT (sync_error) ON api_keys TO authenticated` in migration 066 (Landmine 2) first, then this TS change.

**Pattern — current projection** (queries.ts, lines 609–625 per RESEARCH):
```typescript
// getUserApiKeys — currently projects API_KEY_USER_COLUMNS which does NOT include sync_error
const { data, error } = await supabase
  .from("api_keys")
  .select(API_KEY_USER_COLUMNS)
  ...
```
After Phase 06: `API_KEY_USER_COLUMNS` includes `sync_error`. The return type must add `sync_error: string | null`.

**Acceptance anchors:**
- `grep -n 'sync_error' src/lib/queries.ts` — in return type.
- `grep -n 'sync_error' src/lib/constants.ts` — in `API_KEY_USER_COLUMNS_ARR`.

---

### `src/lib/constants.ts` (extend — add `sync_error` to allowlist)

**Analog:** self — extend `API_KEY_USER_COLUMNS_ARR` (lines 83–97).

**Delta from analog:** Add `"sync_error"` to the array. Also update the string literal type on `API_KEY_USER_COLUMNS` (line 96–97) to include it.

**Pattern — current constant** (constants.ts, lines 83–97):
```typescript
export const API_KEY_USER_COLUMNS_ARR = [
  "id",
  "user_id",
  "exchange",
  "label",
  "is_active",
  "sync_status",
  "last_sync_at",
  "account_balance_usdt",
  "created_at",
] as const;

export const API_KEY_USER_COLUMNS = API_KEY_USER_COLUMNS_ARR.join(", ") as
  "id, user_id, exchange, label, is_active, sync_status, last_sync_at, account_balance_usdt, created_at";
```
After Phase 06: add `"sync_error"` to array and update the string literal type accordingly. The `ApiKeyUserColumn` type union is derived from the array so it updates automatically.

**Acceptance anchors:**
- `grep -n 'sync_error' src/lib/constants.ts` — present in `API_KEY_USER_COLUMNS_ARR`.

---

### `src/__tests__/allocator-holdings-rls.test.ts` (test, live-DB)

**Analog:** `src/__tests__/bridge-outcomes-rls.test.ts` — mirror verbatim structure, adapting only the seeded table and FK shape.

**Delta from analog:** `allocator_holdings` FK references `auth.users(id)` directly (not `profiles(id)`), so no `profiles` upsert needed for seeded rows. Cleanup is inline `DELETE` (no `cleanupLiveDbRow` helper extension needed for this file). The two-actor RLS test is the minimum: owner A sees own row, allocator B sees zero rows.

**Pattern 1 — test harness imports and gate** (bridge-outcomes-rls.test.ts, lines 1–38):
```typescript
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
```

**Pattern 2 — service-role seed + authed client** (bridge-outcomes-rls.test.ts, lines 115–144):
```typescript
async function createAuthedClient(email: string, password: string) {
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: { session }, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) { ... return null; }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}
```

**Pattern 3 — two-actor test body** (bridge-outcomes-rls.test.ts, lines 154–180):
```typescript
it.skipIf(!HAS_LIVE_DB)(
  "bridge_outcomes: owner reads own row; foreign allocator reads 0 rows",
  async () => {
    const admin = createLiveAdminClient();
    const ts = Date.now();
    const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
      userIds: [],
      strategyIds: [],
    };
    try {
      const allocatorAId = await createTestUser(admin, `rls-alloc-a-${ts}@test.sec`, passwordA);
      const allocatorBId = await createTestUser(admin, `rls-alloc-b-${ts}@test.sec`, passwordB);
      // seed rows via admin (bypasses RLS) ...
      // createAuthedClient(emailA, passwordA) ...
      // assert clientA.from("bridge_outcomes").select("id") returns count=1 ...
      // assert clientB.from("bridge_outcomes").select("id") returns count=0 ...
    } finally {
      await cleanupLiveDbRow(admin, cleanup);
    }
  }
);
```
Phase 06 adaptation: seed `allocator_holdings` rows instead of `bridge_outcomes`; the seed function uses `admin.from("allocator_holdings").insert({ allocator_id, venue, symbol, asof, ... })`. Cleanup deletes by `allocator_id`. No strategy FK needed.

**Acceptance anchors:**
- `grep -n 'HAS_LIVE_DB\|it.skipIf' src/__tests__/allocator-holdings-rls.test.ts` — live-DB gate present.
- `grep -n 'allocator_holdings' src/__tests__/allocator-holdings-rls.test.ts` — table referenced.
- `grep -n 'count.*1\|count.*0' src/__tests__/allocator-holdings-rls.test.ts` — anti-leak assertion present.

---

### `analytics-service/tests/test_allocator_positions.py` (test, pytest)

**Analog:** No direct existing test file for positions.py exists (role-match with positions.py structure). New file.

**Pattern — pytest with mock exchange** (inferred from positions.py public interface shape):
```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from services.allocator_positions import fetch_allocator_holdings, persist_allocator_holdings

@pytest.mark.asyncio
async def test_fetch_allocator_holdings_returns_both_types():
    """D-01: both spot and derivative rows emitted per sync."""
    mock_exchange = AsyncMock()
    mock_exchange.fetch_balance.return_value = {
        "total": {"BTC": 0.5, "USDT": 1000.0, "ETH": 2.0}
    }
    mock_exchange.fetch_tickers.return_value = {
        "BTC/USDT": {"last": 50000.0},
        "ETH/USDT": {"last": 3000.0},
    }
    # fetch_positions mock returns one derivative row
    ...
    result = await fetch_allocator_holdings("binance", mock_exchange)
    spot_rows = [r for r in result if r["holding_type"] == "spot"]
    deriv_rows = [r for r in result if r["holding_type"] == "derivative"]
    assert len(spot_rows) >= 2  # BTC + ETH (USDT gets mark_price=1.0)
    assert len(deriv_rows) >= 1

@pytest.mark.asyncio
async def test_idempotent_upsert():
    """INGEST-04 / SC5: re-running same day = identical rows."""
    ...
    count1 = await persist_allocator_holdings(mock_supabase, holdings, allocator_id, key_id, today)
    count2 = await persist_allocator_holdings(mock_supabase, holdings, allocator_id, key_id, today)
    assert count1 == count2  # upsert, not double-insert

def test_error_status_mapping():
    """INGEST-05: AuthenticationError → revoked; RateLimitExceeded → rate_limited."""
    ...
```

**Acceptance anchors:**
- `grep -n 'test_full_sync_writes_holdings\|test_idempotent_upsert\|test_error_status_mapping' analytics-service/tests/test_allocator_positions.py` — three required test cases present.

---

## Shared Patterns

### Authentication / withAuth
**Source:** `src/lib/api/withAuth.ts`
**Apply to:** `src/app/api/allocator/holdings/sync/route.ts`
```typescript
export const POST = withAuth(async (req: NextRequest, user: User) => {
  // user.id is verified JWT sub — use for ownership check + audit attribution
  ...
});
```

### Error Handling — route layer
**Source:** `src/app/api/keys/sync/route.ts` (lines 86–95 for RPC error, lines 56–59 for missing body)
```typescript
if (rpcError) {
  console.error(`[keys/sync] enqueue_compute_job RPC failed for ${strategy_id}:`, rpcError);
  return NextResponse.json({ error: "Could not start sync. Try again in a moment." }, { status: 503 });
}
```
Phase 06 route additionally catches `rpcError?.code === '23505'` (unique violation) and returns `200 { already_inflight: true }`.

### Audit (fire-and-forget)
**Source:** `src/lib/audit.ts` — `logAuditEvent(supabase, event)` uses `after()` semantics, swallows errors, never blocks response.
**Apply to:** `src/app/api/allocator/holdings/sync/route.ts` (emit `allocator.holdings.sync_requested`) and the Python worker (emit `sync_completed` / `sync_failed` via the service-role audit path).

### Supabase client split (route handler)
**Source:** `src/app/api/keys/sync/route.ts` (lines 63, 80)
```typescript
const supabase = await createClient();   // user-scoped — for ownership check + audit
const admin = createAdminClient();       // service-role — for enqueue_compute_job RPC
```
**Apply to:** `src/app/api/allocator/holdings/sync/route.ts` — same split required. Do NOT use `createAdminClient()` for the ownership check (auth.uid() returns NULL on the admin client — Pitfall 1 from RESEARCH Section 7).

### Compute job enqueue via SECURITY DEFINER RPC (not direct INSERT)
**Source:** `src/app/api/keys/sync/route.ts` (lines 80–96)
```typescript
const { data: rpcData, error: rpcError } = await admin.rpc(
  "enqueue_compute_job",
  { p_strategy_id: strategy_id, p_kind: "sync_trades" },
);
```
**Apply to:** `src/app/api/allocator/holdings/sync/route.ts` — call `enqueue_compute_job` with `p_api_key_id` and `p_kind: "poll_allocator_positions"`.

### Migration: DROP FUNCTION before CREATE OR REPLACE when param count changes
**Source:** `supabase/migrations/062_scoring_weight_overrides.sql` (lines 168–169)
```sql
DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb);
DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb);
```
**Apply to:** Migration 066 Step 6 — DROP with the current 8- and 7-param signatures before redefining with 9- and 8-param signatures. Explicit arg list on DROP FUNCTION is mandatory — "DROP FUNCTION foo" is ambiguous if multiple overloads exist.

### Migration: REVOKE after SECURITY DEFINER functions
**Source:** `supabase/migrations/062_scoring_weight_overrides.sql` (lines 289, 335)
```sql
REVOKE ALL ON FUNCTION _enqueue_compute_job_internal FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION enqueue_compute_job FROM PUBLIC, anon, authenticated;
```
**Apply to:** Every new SECURITY DEFINER function in migration 066 (`enqueue_compute_job`, `_enqueue_compute_job_internal`, `enqueue_poll_allocator_positions_for_all_keys`).

---

## Landmines (from RESEARCH.md) — Planner Must Address

| # | File | Problem | Required Fix |
|---|---|---|---|
| 1 | `exchange.py` | Deribit absent from `EXCHANGE_CLASSES` | Add `"deribit": ccxt.deribit`; test `fetch_balance()` shape |
| 2 | `constants.ts` + migration 066 | `sync_error` SELECT revoked from `authenticated` | Migration 066 must `GRANT SELECT (sync_error) ON api_keys TO authenticated`; then add to `API_KEY_USER_COLUMNS_ARR` |
| 3 | `AllocatorExchangeManager.tsx` | `ExchangeConnection` interface missing `sync_error` | Add `sync_error: string \| null` to interface |
| 4 | migration 066 Step 6 | `enqueue_compute_job` raises on `p_strategy_id=NULL, p_allocator_id=NULL` | Redefine must add `p_api_key_id IS NOT NULL` path before the RAISE |
| 5 | migration 066 Step 2 | `compute_jobs_admin` view won't show `api_key_label` for allocator jobs | Extend view with `LEFT JOIN api_keys ak ON ak.id = cj.api_key_id` |
| 6 | migration 066 Step 10 | D-15 says SAVEPOINT; actual project convention is explicit DELETE cleanup | Use explicit `DELETE FROM` at end of DO block — NOT `ROLLBACK TO SAVEPOINT` |
| 7 | migration 066 Step 2 | coherence CHECK does NOT need `api_key_id IS NULL` in existing branches | The 4-way XOR guarantees it; only the new `poll_allocator_positions` branch needs `api_key_id IS NOT NULL` |
| 8 | `AllocatorExchangeManager.tsx` | `useState(initialKeys)` does not re-sync on `router.refresh()` prop changes | Add `useEffect(() => { setKeys(initialKeys); }, [initialKeys])` |

---

## No Analog Found

All files in scope have close analogs. No files require RESEARCH.md-only patterns.

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `analytics-service/services/`, `src/app/api/`, `src/components/exchanges/`, `src/components/mandate/`, `src/__tests__/`, `src/lib/`
**Files read:** 14 analog files + 3 planning documents
**Pattern extraction date:** 2026-04-19
