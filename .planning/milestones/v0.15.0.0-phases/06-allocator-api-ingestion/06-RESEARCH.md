# Phase 06: Allocator API Ingestion — Research

**Researched:** 2026-04-19
**Domain:** CCXT holdings ingestion, Supabase schema extension (compute_jobs XOR, allocator_holdings, api_keys CHECK), FastAPI worker dispatch, Next.js route + React status polling
**Confidence:** HIGH (all critical claims verified against actual code/files)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01 through D-19 in `06-CONTEXT.md` — all locked. Summary:
- Both `fetch_balance()` (spot) and `fetch_positions()` (derivatives) per sync.
- `allocator_holdings` schema, RLS (3-tier), indexes, and unique constraint.
- Compute-job kind `poll_allocator_positions` with 4-way XOR on `compute_jobs`.
- New `api_key_id` column on `compute_jobs`; partial unique index for in-flight dedup.
- New file `services/allocator_positions.py`; new handler in `job_worker.py`.
- `cost_basis_usd` populated for derivatives only; spot rows NULL.
- `sync_status` CHECK extended with `revoked` + `rate_limited`.
- Status pill on `AllocatorExchangeManager`; 5s `router.refresh()` polling (not realtime).
- `POST /api/allocator/holdings/sync` route; no new Vercel cron (pg_cron only).
- Single migration `066_allocator_holdings.sql` with 10 steps.
- `supabase db push` if CLI-compatible; Supabase MCP `apply_migration` otherwise.
- Self-verifying DO block includes SAVEPOINTed multi-actor RLS test.

### Claude's Discretion
- `fetch_tickers()` vs `fetch_ticker(symbol)` for spot mark price — planner picks lower-cost shape.
- Route file path `src/app/api/allocator/holdings/sync/route.ts`.
- Worker file internal helper layout (public API: `fetch_allocator_holdings()` + `persist_allocator_holdings()`).
- Vitest harness location for application-layer RLS spec.
- `raw_payload` JSONB column cap size (suggested ~4KB).
- Exact spinner glyph/animation for `syncing` pill.
- Mark price for spot `value_usd` — direct ticker vs cached oracle.
- Whether `complete_with_warnings` is used in v0.15.

### Deferred Ideas (OUT OF SCOPE)
- `/connections` rework + revoke/delete UX (Phase 08).
- Spot cost-basis backfill (Phase 08 MANAGE-06 or future).
- Symbol normalization edge cases (Deribit perpetual vs quarterly).
- Vercel-cron path for allocator syncs.
- Realtime push for `sync_status`.
- `weight_pct` denormalized on `allocator_holdings`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGEST-01 | `allocator_holdings` table + owner-RLS + admin-select + service-role-all + unique index + updated_at trigger + self-verifying DO block | Migration 059/062 templates verified; trigger pattern in 059 Step 3; DO block pattern in 062 Step 9 |
| INGEST-02 | New compute-job kind `poll_allocator_positions` with extended `compute_jobs_kind_target_coherence` CHECK | 4-way XOR extends migration 062 3-way; current CHECK text verified |
| INGEST-03 | `job_worker.py` dispatches `poll_allocator_positions` to `services/allocator_positions.py` via CCXT | dispatch() if/elif pattern verified; `_exchange_preflight` signature confirmed |
| INGEST-04 | First-run = full snapshot; subsequent runs diff-upsert per-allocator-per-exchange | `persist_position_snapshots` upsert pattern in `positions.py` confirmed; unique index `(allocator_id, venue, symbol, asof)` enables this |
| INGEST-05 | API-key errors set `api_keys.sync_status = 'error'` with surfaced reason | `classify_exception` + `_stamp_429` pattern in `job_worker.py` confirmed; CHECK extension needed |
| INGEST-06 | `AllocatorExchangeManager` "Sync now" button enqueues a real job (no-op replaced) | Current disabled button at line 236-241 of `AllocatorExchangeManager.tsx` confirmed |
| INGEST-07 | Adding a new API key enqueues an immediate first-run fetch | `handleAddKey` flow in `AllocatorExchangeManager.tsx` confirmed; second POST needed post-insert |
| INGEST-08 | Daily cron enqueues re-syncs for all active allocator API keys | pg_cron pattern from migration 033 `enqueue_poll_positions_for_all_strategies` confirmed |
| INGEST-09 | RLS enforced — allocator A cannot read allocator B's rows, regression test proves it | `bridge-outcomes-rls.test.ts` two-actor pattern confirmed; live-db helper confirmed |
</phase_requirements>

---

## Summary

Phase 06 is a pure extension of established project patterns — no architectural novelties. Every mechanism it needs already exists in a working form:

**Worker:** The `job_worker.py` dispatch chain, `_exchange_preflight` dataclass, `classify_exception`, `_check_circuit_breaker`, and `_stamp_429` are all production-proven from `poll_positions` and `sync_trades`. Phase 06 adds a sibling preflight (`_allocator_key_preflight`) that skips the strategy-hop and loads the API key directly by `job.api_key_id`. The key difference from the strategy path is that there is no strategy row to dereference — the API key itself is the target. This is a simpler preflight, not a more complex one.

**Schema:** Migration 062 is the canonical template. The 4-way XOR is a mechanical extension of the 3-way XOR — replace `allocator_id IS NULL` with `api_key_id IS NULL` and add the new branch. The `enqueue_compute_job` function already accepts 7 parameters; Phase 06 adds an 8th (`p_api_key_id`) plus potentially a 9th (`p_run_at`). `p_run_at` does NOT require a new DB column — `compute_jobs.next_attempt_at` already exists and defaults to `now()`; the enqueue function can simply accept an optional override that sets `next_attempt_at` to the supplied value. This is a smaller change than CONTEXT.md implies.

**Frontend:** `AllocatorExchangeManager.tsx` has the disabled "Auto-synced" button at line 236-241, `useTransition` already imported, and `router.refresh()` already called in `handleAddKey`. The status pill needs `sync_error` added to the column projection — that column exists in the DB (`api_keys.sync_error TEXT` added in migration 007 lines 64-69) but is NOT currently in `API_KEY_USER_COLUMNS` (the allowlist in `constants.ts`) and NOT in the `getUserApiKeys` return type. This is a **landmine**: migration 027 revoked SELECT on `sync_error` from `authenticated`. The fix requires a new migration GRANT step inside migration 066 (not just a TS constant change).

**Primary recommendation:** The migration's most complex step is the 4-way XOR extension + `enqueue_compute_job` DROP+REDEFINE. Because the current function has `pronargs = 7` (confirmed by migration 062's self-verifying DO block at line 566), adding `p_api_key_id UUID DEFAULT NULL` and `p_run_at TIMESTAMPTZ DEFAULT NULL` as parameters 8 and 9 requires explicit `DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid)` before the `CREATE OR REPLACE`. The `cron.schedule` call is pg_cron which is CLI-compatible on Supabase; however the DROP+REDEFINE FUNCTION combination has historically required the MCP path per Phase 5 precedent. Apply migration 066 via Supabase MCP `apply_migration`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Holdings fetch from exchange | FastAPI worker (Railway) | — | Only the Python service holds the KEK; CCXT is Python-native |
| Holdings persistence (writes) | FastAPI worker via service-role | — | Worker is sole producer; allocator has no direct INSERT/UPDATE/DELETE |
| Holdings reads (allocator) | Supabase RLS (owner-select) | Next.js query layer | Phase 07 owns the read routes; Phase 06 owns the table + policies |
| Sync job enqueueing | Next.js route handler (`POST /api/allocator/holdings/sync`) | pg_cron RPC (daily) | Two enqueue paths: user-triggered via route, automated via pg_cron |
| Sync status display | Browser (React client component) | — | `AllocatorExchangeManager` is `"use client"` |
| API key column grant for `sync_error` | Database migration | Next.js constants.ts | New GRANT needed in migration 066; TS constant add follows |
| RLS anti-leak proof | Database (self-verifying DO block) + Vitest live-DB test | — | Defense in depth: DB-level proof + application-layer regression guard |
| Cron orchestration | pg_cron (Postgres-side) | — | Explicitly NOT Vercel cron (Hobby 2-cron cap) |

---

## Section 1: Domain Research — CCXT Surface

### `fetch_balance()` — unified shape (all 4 exchanges)
[VERIFIED: codebase + ASSUMED: CCXT docs] `exchange.fetch_balance()` returns a dict with top-level keys: `free`, `used`, `total` (each is a dict of `{currency: amount}`), plus nested per-currency info. The `total[currency]` gives total balance (free + used + in-orders). Only non-zero assets should be emitted as `allocator_holdings` rows.

**Per-exchange notes:**
- **Binance:** `fetch_balance()` returns spot account by default. For Binance Futures (USDT-M) use `fetch_balance({'type': 'future'})`. Confirmed in `exchange.py::fetch_usdt_balance` — existing code uses plain `fetch_balance()` which returns the spot/cross-margin balance. [ASSUMED] Institutional allocators on Binance may hold both spot and futures accounts — D-17 says Binance ships in Phase 06; the worker may need `type=future` for futures balance. However the existing `fetch_usdt_balance` already calls plain `fetch_balance()` and it returns `USDT` balance including both. The spot normalizer can simply iterate `balance['total']`.
- **OKX:** `fetch_balance()` in unified mode aggregates across SPOT, FUTURES, SWAP, MARGIN. The `total` dict is the combined balance. OKX hedge mode is already handled in `fetch_positions()`.
- **Bybit:** `fetch_balance()` returns unified account balance in V5. The `total` dict is populated.
- **Deribit:** NOTE — `create_exchange` in `exchange.py` line 12-15 shows `EXCHANGE_CLASSES` only contains `binance`, `okx`, `bybit`. **Deribit is NOT in `EXCHANGE_CLASSES`.** [VERIFIED: `analytics-service/services/exchange.py` lines 12-15] This means `create_exchange("deribit", ...)` raises `ValueError: Unsupported exchange: deribit`. CONTEXT.md D-17 says all four exchanges ship in Phase 06 — **this is a blocker for Deribit**.

**Deribit gap (LANDMINE #1):** `services/exchange.py::EXCHANGE_CLASSES` does not include Deribit. Adding it requires `import ccxt.async_support as ccxt` (already present) and adding `"deribit": ccxt.deribit` to the dict. Deribit uses OAuth-style authentication with client_id/client_secret rather than api_key/api_secret/passphrase. The encrypt/decrypt format in `encryption.py` bundles `api_key`, `api_secret`, `passphrase` — Deribit needs `api_key=client_id`, `api_secret=client_secret`, `passphrase=None`. This should work with the existing envelope but needs verification that the CCXT Deribit constructor accepts these field names. [ASSUMED] The planner should flag Deribit as a known extension that needs explicit CCXT constructor config testing.

### `fetch_positions()` — derivatives, existing code
[VERIFIED: `analytics-service/services/positions.py`] `fetch_positions(exchange_name, exchange)` already handles Binance (CCXT unified), OKX (dual-side hedge), Bybit (CCXT first, V5 fallback). Returns normalized dicts with keys: `symbol`, `side`, `size_base`, `size_usd`, `entry_price`, `mark_price`, `unrealized_pnl`, `exchange`. The `_normalize_ccxt_position` function at line 91-125 does symbol stripping (`"BTC/USDT:USDT"` → `"BTCUSDT"`). This is the exact normalizer D-16 references — reusable verbatim for derivatives in `fetch_allocator_holdings`.

### `fetch_tickers()` vs `fetch_ticker(symbol)` — spot mark price
[ASSUMED] For the spot balance normalizer, mark price is needed for `value_usd = quantity * mark_price`. Two options:
- `await exchange.fetch_tickers(symbols)` — one bulk call for a list of symbols like `["BTC/USDT", "ETH/USDT"]`. Returns a dict `{symbol: {last, bid, ask, ...}}`. Lower API cost per symbol but must be called with explicit symbol list (not all-symbols on all exchanges — Binance has 1000+ symbols, fetch_tickers() without args fetches all which is expensive).
- `await exchange.fetch_ticker(symbol)` — per-symbol call; N calls for N assets.

**Recommendation for planner:** Construct the CCXT-format symbol list from the non-zero balance keys first, then call `fetch_tickers(symbol_list)` in one shot. For 10-20 non-zero assets this is 1 call vs 10-20 calls. Exception: USDT/USD/USDC stablecoins should be assigned `mark_price=1.0` without a ticker fetch (they are the quote currency, not tradeable instruments).

### CCXT error hierarchy relevant to Phase 06
[VERIFIED: `analytics-service/services/job_worker.py` lines 139-183] `classify_exception` already handles:
- `ccxt.RateLimitExceeded` → transient (also triggers `_stamp_429`)
- `ccxt.AuthenticationError` | `ccxt.PermissionDenied` → permanent (maps to `sync_status='revoked'` per D-07)
- `ccxt.NetworkError` | `ccxt.RequestTimeout` → transient
- `ccxt.BadRequest` → permanent
- `ccxt.BaseError` → unknown
- Everything else → unknown

The `sync_status` mapping from `error_kind` to status value is NOT currently in `classify_exception` — that function returns `(error_kind, message)` without writing to `api_keys`. The worker path for `poll_allocator_positions` must add a step that maps `error_kind='permanent'` → `sync_status='revoked'` (if the exception is AuthenticationError/PermissionDenied) and `error_kind='transient'` (from RateLimitExceeded) → `sync_status='rate_limited'`. This mapping logic belongs in `run_poll_allocator_positions_job` or `_allocator_key_preflight`, not in `classify_exception` itself (to avoid mutating the shared function).

---

## Section 2: Codebase Anchors

### `job_worker.py` — exact extension points

**`dispatch()` if/elif chain** — `analytics-service/services/job_worker.py` lines 1174-1191. Current tail:
```python
elif kind == "rescore_allocator":
    handler = run_rescore_allocator_job
else:
    handler = None
```
Add before the `else`:
```python
elif kind == "poll_allocator_positions":
    handler = run_poll_allocator_positions_job
```
[VERIFIED: job_worker.py line 1188-1191]

**`TIMEOUT_PER_KIND`** — lines 123-132. Currently 8 entries. Add:
```python
"poll_allocator_positions": 3 * 60,  # 3 minutes — same as poll_positions
```
[VERIFIED: job_worker.py line 128 shows `"poll_positions": 3 * 60`]

**`_exchange_preflight` function** — lines 310-355. This function expects `job.get("strategy_id")` as its first check (line 326). The new `_allocator_key_preflight` must instead check `job.get("api_key_id")` and skip the `_load_strategy_and_key` helper entirely. It loads the API key row directly:
```python
def _load_key_by_id(key_id: str) -> dict | None:
    res = supabase.table("api_keys").select("*").eq("id", key_id).maybe_single().execute()
    return res.data
```
Then calls `_check_circuit_breaker`, `decrypt_credentials`, `create_exchange` — same sequence as `_exchange_preflight` from line 341 onward.
[VERIFIED: job_worker.py lines 310-355]

**`_ExchangeContext` dataclass** — lines 301-308. The new path produces the same `_ExchangeContext` shape (supabase + key_row + exchange) but without `strategy_row`. Either reuse the dataclass with `strategy_row=None` or define a parallel `_AllocatorExchangeContext` without that field. Reusing with `strategy_row=None` is simpler.

**`classify_exception` signature** — `(exc: Exception) -> tuple[str, str]`. Returns `(error_kind, sanitized_message)`. This is consumed by `dispatch()` in the outer `except` block at lines 1205-1210. The inner handler must `raise` on `ccxt.RateLimitExceeded` after `_stamp_429` (same pattern as `run_poll_positions_job` line 603-606).

### `positions.py` — reusable functions
[VERIFIED: `analytics-service/services/positions.py`]

| Function | Location | Phase 06 use |
|----------|----------|--------------|
| `fetch_positions(exchange_name, exchange)` | line 158 | Derivatives side — call verbatim |
| `_normalize_ccxt_position(pos, exchange_name)` | line 91 | Internals for derivatives normalization |
| `_fetch_positions_bybit(exchange)` | line 182 | Called by fetch_positions; transparent |
| `persist_position_snapshots(supabase, snapshots, strategy_id, date)` | line 202 | NOT reused — different table/key |

The `persist_position_snapshots` function upserts into `position_snapshots` using `on_conflict="strategy_id,snapshot_date,symbol,side"`. The new `persist_allocator_holdings` function upserts into `allocator_holdings` using `on_conflict="allocator_id,venue,symbol,asof"`. These are separate functions.

### `exchange.py` — `create_exchange` and `EXCHANGE_CLASSES`
[VERIFIED: `analytics-service/services/exchange.py` lines 11-32]

```python
EXCHANGE_CLASSES: dict[str, type] = {
    "binance": ccxt.binance,
    "okx": ccxt.okx,
    "bybit": ccxt.bybit,
    # DERIBIT IS MISSING
}
```

`create_exchange` function signature: `create_exchange(exchange_name: str, api_key: str, api_secret: str, passphrase: str | None = None) -> ccxt.Exchange`. This is reused verbatim.

`fetch_usdt_balance(exchange)` at line 619 fetches USDT total via `exchange.fetch_balance()`. This can serve as a model for the spot normalizer but returns only USDT — Phase 06 needs ALL non-zero assets.

### `encryption.py` — decrypt pattern
[VERIFIED: `analytics-service/services/encryption.py` lines 90-107]

```python
def decrypt_credentials(encrypted_row: dict, kek: bytes) -> tuple[str, str, str | None]:
    kek_cipher = Fernet(kek)
    dek = kek_cipher.decrypt(encrypted_row["dek_encrypted"].encode())
    data_cipher = Fernet(dek)
    payload = json.loads(data_cipher.decrypt(encrypted_row["api_key_encrypted"].encode()))
    return payload["api_key"], payload["api_secret"], payload.get("passphrase")
```

Input: the full `api_keys` row (service-role read). Returns `(api_key, api_secret, passphrase_or_None)`. This is the credential triple passed directly to `create_exchange`. No changes needed.

### Migration 062 — exact DROP signatures for extension
[VERIFIED: `supabase/migrations/062_scoring_weight_overrides.sql` lines 168-169]

```sql
DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb);
DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb);
```

After migration 062, the live signatures are:
- `_enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid)` — 8 params
- `enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid)` — 7 params

Migration 066 must DROP these with the 8- and 7-param signatures respectively, then redefine with 9 and 8+ params.

### Current `compute_jobs_target_xor` text (after migration 062)
[VERIFIED: `supabase/migrations/062_scoring_weight_overrides.sql` lines 97-108]

```sql
CHECK (
  (strategy_id IS NOT NULL AND portfolio_id IS NULL     AND allocator_id IS NULL) OR
  (strategy_id IS NULL     AND portfolio_id IS NOT NULL AND allocator_id IS NULL) OR
  (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NOT NULL)
)
```

Migration 066 extends this to a 4-way XOR by adding `api_key_id IS NULL` to every existing OR-branch and adding a 4th branch:
```sql
(strategy_id IS NULL AND portfolio_id IS NULL AND allocator_id IS NULL AND api_key_id IS NOT NULL)
```

### Current `compute_jobs_kind_target_coherence` (after migration 062)
[VERIFIED: `supabase/migrations/062_scoring_weight_overrides.sql` lines 117-134]

```sql
CHECK (
  (kind = 'compute_portfolio'
    AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
    AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot'
  ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL)
)
```

Migration 066 adds the new branch before the closing `)`:
```sql
OR (kind = 'poll_allocator_positions'
    AND api_key_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL AND allocator_id IS NULL)
```
Note: existing branches also need `AND api_key_id IS NULL` added for full 4-way coherence.

### `api_keys.sync_status` CHECK (current)
[VERIFIED: `supabase/migrations/007_security_hardening.sql` lines 64-66]

```sql
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'idle'
  CHECK (sync_status IN ('idle', 'syncing', 'computing', 'complete', 'complete_with_warnings', 'error'));
```

Migration 066 Step 5 must:
```sql
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_sync_status_check
  CHECK (sync_status IN ('idle', 'syncing', 'computing', 'complete', 'complete_with_warnings', 'error', 'revoked', 'rate_limited'));
```

**Note on constraint naming:** The `ADD COLUMN IF NOT EXISTS ... CHECK (...)` syntax creates an unnamed inline constraint. To DROP it by name, you first need to find the constraint name. Use `pg_constraint WHERE conrelid = 'api_keys'::regclass AND contype = 'c'`. Alternatively the migration can use a named constraint from scratch. The planner should use a named approach:
```sql
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
```
(If the inline constraint was unnamed, this will silently succeed on the DROP via `IF EXISTS`, then the ADD creates the named version.)

### `enqueue_compute_job` — current full signature (post-migration 062)
[VERIFIED: `supabase/migrations/062_scoring_weight_overrides.sql` lines 291-299]

```sql
CREATE OR REPLACE FUNCTION enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_allocator_id    UUID DEFAULT NULL
)
```

Phase 06 adds two more trailing params:
```sql
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
```

The `p_run_at` parameter sets `next_attempt_at` in the INSERT (the cron jitter path). There is NO existing `run_at` column — `next_attempt_at` is the existing column that serves this purpose. [VERIFIED: `supabase/migrations/032_compute_jobs_queue.sql` line 123: `next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()`].

### Migration 033 — `enqueue_poll_positions_for_all_strategies` as cron-RPC template
[VERIFIED: `supabase/migrations/033_compute_jobs_admin_and_defer.sql` lines 221-277]

The Phase 06 analog `enqueue_poll_allocator_positions_for_all_keys()` mirrors this exactly:
- Loop over `api_keys WHERE is_active = true AND sync_status NOT IN ('revoked')`
- For each key, call `enqueue_compute_job(p_api_key_id := ..., p_kind := 'poll_allocator_positions', p_run_at := now() + (random() * interval '600 seconds'))`
- Return count of newly-enqueued jobs

The strategy-side RPC uses `pg_try_advisory_lock('daily_position_polling')` for multi-replica safety. The allocator-side RPC should use a different advisory lock name (e.g., `'daily_allocator_polling'`).

---

## Section 3: Migration Feasibility

### Does `cron.schedule` + DROP+REDEFINE FUNCTION + DROP+ADD CHECK require MCP path?

[VERIFIED: Phase 5 D-20a/c precedent in `05-CONTEXT.md`] Phase 5 established that `apply_migration` via Supabase MCP is the safe path for any migration combining `pg_cron` + `DROP+REDEFINE FUNCTION` in a single transaction. This is because `supabase db push` can fail silently on pg_cron-dependent steps when the extension isn't in the migration search path, and DROP FUNCTION on a function that security definer other functions depend on can conflict with Supabase's internal bookkeeping in ways that `db push` handles differently from `apply_migration`.

**Recommendation:** Use Supabase MCP `apply_migration` for migration 066. After applying, reconcile `supabase_migrations.schema_migrations.version` per the Phase 5 D-20c procedure. The `supabase db push` path is NOT recommended for this migration due to the combination of:
1. `cron.schedule` (pg_cron dependency)
2. Multiple `DROP FUNCTION IF EXISTS` + `CREATE OR REPLACE` sequences
3. `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`
4. `DO $$` self-verifying block that inserts/deletes from `auth.users`

### Migration 066 step ordering risks

Step 2 (ADD `compute_jobs.api_key_id` column + DROP+ADD `compute_jobs_target_xor`) must occur BEFORE Step 3 (INSERT `compute_job_kinds`) and Step 4 (CREATE UNIQUE INDEX) — the index references the new column. The CONTEXT.md ordering is correct.

Step 6 (DROP+REDEFINE `enqueue_compute_job`) must occur BEFORE Step 7 (CREATE FUNCTION `enqueue_poll_allocator_positions_for_all_keys`) which calls it.

Step 8 (`cron.schedule`) must occur AFTER Step 7 (the scheduled function must exist before scheduling it).

**The 10-step order in CONTEXT.md D-19 is correct.** No reordering needed.

---

## Section 4: Frontend Integration

### `AllocatorExchangeManager.tsx` — current shape
[VERIFIED: `src/components/exchanges/AllocatorExchangeManager.tsx`]

**Key facts:**
- File is `"use client"` (line 1).
- `useState`, `useTransition` from React already imported (line 20). `useRouter` from `next/navigation` already imported (line 21).
- `[, startTransition] = useTransition()` at line 87 — transition state destructured, only `startTransition` used (no pending indicator currently).
- `router.refresh()` called at line 156 wrapped in `startTransition` — pattern already present.
- The disabled button is at lines 235-241:
  ```tsx
  <Button
    variant="secondary"
    disabled
    title="Exchange sync is not yet available"
  >
    Auto-synced
  </Button>
  ```
- `ExchangeConnection` interface (lines 29-39) includes `sync_status: string | null` but **does NOT include `sync_error`**. This must be added.
- `initialKeys: ExchangeConnection[]` is the prop — the server component passes `getUserApiKeys()` result.

**Changes needed to `ExchangeConnection` interface:**
```typescript
interface ExchangeConnection {
  // ... existing fields ...
  sync_error: string | null;  // ADD THIS
}
```

**NOTE:** The `is_active` field is in the interface but `getUserApiKeys()` return type (lines 616-625 of queries.ts) does NOT include `is_active`. The interface and query return type are mismatched — `is_active` is in `API_KEY_USER_COLUMNS_ARR` (line 87 of constants.ts) so it IS granted and queryable, but the typed return object in queries.ts doesn't list it. This is a pre-existing minor inconsistency; the planner should normalize it while adding `sync_error`.

### `getUserApiKeys` — column projection
[VERIFIED: `src/lib/queries.ts` lines 609-625, `src/lib/constants.ts` lines 83-97]

`API_KEY_USER_COLUMNS_ARR` currently contains:
```typescript
["id", "user_id", "exchange", "label", "is_active", "sync_status", "last_sync_at",
 "account_balance_usdt", "created_at"]
```

**`sync_error` is NOT in this list.** It appears in `supabase/migrations/027_api_keys_column_revoke.sql` lines 51-53 as explicitly excluded from the allowlist:
```
-- Non-sensitive but NOT in the allowlist (future expansion requires a new
-- migration extending the grant):
--   sync_started_at, sync_error, kek_version
```

**This means two things:**
1. `sync_error` SELECT on `api_keys` is REVOKED from `authenticated`. Any query projecting it from a user-scoped client returns NULL.
2. Migration 066 must add a `GRANT SELECT (sync_error) ON api_keys TO authenticated` step.
3. `API_KEY_USER_COLUMNS_ARR` in `constants.ts` must add `"sync_error"`.
4. The `getUserApiKeys()` return type must add `sync_error: string | null`.
5. The type string literal `API_KEY_USER_COLUMNS` must be updated.

### `router.refresh()` pattern in the app
[VERIFIED: `src/components/exchanges/AllocatorExchangeManager.tsx` line 156]

```typescript
startTransition(() => router.refresh());
```

The 5s polling loop from D-11 should follow this exact pattern. The implementation needs an interval that fires `startTransition(() => router.refresh())` while any visible row has `sync_status === 'syncing'`, and clears the interval when all rows transition out. The `isPending` boolean from `useTransition` can be used to show a subtle loading state on the page while the refresh is in flight.

### Status pill colors vs DESIGN.md
[VERIFIED: `DESIGN.md` lines 43-47]

| Status | DESIGN.md Color | Hex |
|--------|----------------|-----|
| neutral | Text secondary / muted | `#4A5568` / `#718096` |
| amber (warning) | Warning | `#D97706` |
| red (error) | Negative | `#DC2626` |

The `syncing` state spinner should use `motion-scale short (150ms)` per DESIGN.md line 71.

### `MandateSaveStatus` — aria-live pattern to mirror
[VERIFIED: `src/components/mandate/MandateSaveStatus.tsx`]

The analog for the sync_error helper line:
```tsx
<div
  role="status"
  aria-live="polite"
  className="text-xs text-text-muted ..."
>
  {sync_error && <span>{sync_error}</span>}
</div>
```
The DM Sans 12px muted helper line sits beneath the status pill per D-08. Uses `role="status"` + `aria-live="polite"` — same pattern as `MandateSaveStatus`.

### Audit type registration for the new route
[VERIFIED: `src/lib/audit.ts` lines 85-133, 143-175]

`AuditAction` and `AuditEntityType` are TypeScript union types. The new events from D-18 must be added:
- `AuditAction`: add `"allocator.holdings.sync_requested"` | `"allocator.holdings.sync_completed"` | `"allocator.holdings.sync_failed"`
- `AuditEntityType`: add `"api_key"` — already exists (line 146). The entity_id for all three events is `api_key_id`.

The Python worker's sync_completed and sync_failed events go via `log_audit_event_service` (service-role path) — those need to be added in `analytics-service/services/audit.py` as string constants (not TypeScript). No TS change needed for the Python side.

---

## Section 5: RLS Test Harness Detection

### Existing two-actor harness
[VERIFIED: `src/lib/test-helpers/live-db.ts` + `src/__tests__/bridge-outcomes-rls.test.ts`]

A complete two-actor live-DB RLS test harness EXISTS. `bridge-outcomes-rls.test.ts` demonstrates:
1. `createLiveAdminClient()` for service-role setup
2. `createTestUser(admin, email, password)` creates auth.users + profiles rows
3. `createAuthedClient(email, password)` signs in and returns an RLS-scoped client
4. `cleanupLiveDbRow(admin, { userIds, strategyIds })` for test cleanup
5. `it.skipIf(!HAS_LIVE_DB)` pattern for CI-safe gating
6. Two-actor pattern: allocatorA sees own row, allocatorB sees zero rows

**For `allocator_holdings-rls.test.ts`**, the only adaptation needed is:
- Insert `allocator_holdings` rows (via service-role, which bypasses RLS) instead of `bridge_outcomes` rows
- The `allocator_holdings` FK references `auth.users(id)` directly (not `profiles(id)` like bridge_outcomes) — so no `profiles` upsert needed for the seeded rows; the auth user row is sufficient
- `cleanupLiveDbRow` needs a new `allocatorHoldingsIds` field, or the cleanup can delete by `allocator_id` directly

**The cleanupLiveDbRow helper does NOT currently support `allocator_holdings` rows.** It supports `strategyIds` and `apiKeyIds` and `userIds`. The new test file will either extend this helper or use inline cleanup. Inline cleanup is simpler for a new test file.

**File location:** `src/__tests__/allocator-holdings-rls.test.ts` (consistent with `bridge-outcomes-rls.test.ts` location and D-15).

---

## Section 6: Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`. Validation is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 + pytest (analytics-service) |
| Config file | `vitest.config.ts` (TypeScript), `analytics-service/pytest.ini` (Python) |
| Quick run command (TS) | `npm test` |
| Full suite command (TS + Python) | `npm test && cd analytics-service && pytest` |
| Live-DB gate | `HAS_LIVE_DB` env var |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INGEST-01 | `allocator_holdings` table exists with RLS + indexes + trigger | Live-DB (DO block assertion) + Vitest live-DB | Migration self-verify at apply time; `npx vitest run src/__tests__/allocator-holdings-rls.test.ts` | ❌ Wave 0 |
| INGEST-02 | `compute_jobs_kind_target_coherence` rejects `poll_allocator_positions` with NULL `api_key_id` | Live-DB (migration DO block assertion) | Migration self-verify at apply time | ❌ Wave 0 (in migration DO block) |
| INGEST-03 | Worker dispatches `poll_allocator_positions` and calls fetch/persist | pytest unit | `cd analytics-service && pytest tests/test_allocator_positions.py -x` | ❌ Wave 0 |
| INGEST-04 | Re-running sync on same day produces identical rows (idempotent upsert) | pytest unit | `cd analytics-service && pytest tests/test_allocator_positions.py::test_idempotent_upsert -x` | ❌ Wave 0 |
| INGEST-05 | AuthenticationError sets `sync_status='revoked'`; RateLimitExceeded sets `sync_status='rate_limited'` | pytest unit | `cd analytics-service && pytest tests/test_allocator_positions.py::test_error_status_mapping -x` | ❌ Wave 0 |
| INGEST-06 | "Sync now" button sends POST to `/api/allocator/holdings/sync` | Vitest route handler | `npx vitest run src/app/api/allocator/holdings/sync/route.test.ts` | ❌ Wave 0 |
| INGEST-07 | handleAddKey calls POST sync after insert succeeds | Vitest component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx` | ❌ Wave 0 |
| INGEST-08 | `enqueue_poll_allocator_positions_for_all_keys` loops active non-revoked keys | Live-DB (DO block) | Migration self-verify at apply time | ❌ Wave 0 (in migration DO block) |
| INGEST-09 | Allocator A cannot read allocator B's rows | Live-DB Vitest | `npx vitest run src/__tests__/allocator-holdings-rls.test.ts` | ❌ Wave 0 |

### Mapping to Success Criteria (SC1–SC5)

| SC | Criterion | Test Coverage |
|----|-----------|---------------|
| SC1 | Holdings appear within one sync cycle | `test_allocator_positions.py::test_full_sync_writes_holdings` + migration DO block |
| SC2 | "Sync now" is real + daily cron works | route handler test + migration DO block (cron schedule verified) |
| SC3 | Error state surfaced with human-readable reason | `test_error_status_mapping` + `AllocatorExchangeManager.test.tsx` status pill rendering |
| SC4 | Allocator A cannot read B's rows + regression test | `allocator-holdings-rls.test.ts` (required) |
| SC5 | Re-running same day = identical rows | `test_idempotent_upsert` (required) |

### Sampling Rate
- **Per task commit:** `npm test` (Vitest) or `pytest tests/test_allocator_positions.py -x` (for Python tasks)
- **Per wave merge:** `npm test && cd analytics-service && pytest`
- **Phase gate:** Full suite green + live-DB RLS test passes before `/gsd-verify-work`

### Wave 0 Gaps (test files to create before implementation)
- [ ] `src/__tests__/allocator-holdings-rls.test.ts` — covers INGEST-09, SC4
- [ ] `src/app/api/allocator/holdings/sync/route.test.ts` — covers INGEST-06
- [ ] `analytics-service/tests/test_allocator_positions.py` — covers INGEST-03, INGEST-04, INGEST-05, SC1, SC2, SC5
- [ ] `src/components/exchanges/AllocatorExchangeManager.test.tsx` — covers INGEST-06, INGEST-07 (component layer)
- Migration 066 DO block — covers INGEST-01, INGEST-02, INGEST-08 (at apply time)

---

## Section 7: Landmines and Pitfalls

### Landmine 1: Deribit absent from `EXCHANGE_CLASSES`
**File:** `analytics-service/services/exchange.py` lines 12-15
**Problem:** `EXCHANGE_CLASSES` only contains `binance`, `okx`, `bybit`. `create_exchange("deribit", ...)` raises `ValueError: Unsupported exchange: deribit`. D-17 says Deribit ships in Phase 06.
**Fix:** Add `"deribit": ccxt.deribit` to `EXCHANGE_CLASSES`. Verify Deribit CCXT constructor accepts `apiKey=client_id`, `secret=client_secret`. Deribit uses read-only API keys differently — the `fetch_balance()` call requires the `currency` parameter (`BTC`, `ETH`, `USDC`). Pure portfolio-level balance is `fetch_balance({'currency': 'BTC'})` etc. Unlike the other three exchanges, Deribit doesn't have a unified USDT account balance; it's per-settlement-currency. The new `fetch_allocator_holdings` function may need a Deribit-specific branch similar to the Bybit V5 fallback in `positions.py`.
**Risk if missed:** `poll_allocator_positions` jobs for Deribit API keys fail at `create_exchange` with permanent error; allocators see `sync_status='error'` immediately.

### Landmine 2: `sync_error` column is REVOKED from `authenticated`
**File:** `supabase/migrations/027_api_keys_column_revoke.sql` lines 51-53
**Problem:** `sync_error` is explicitly listed as "Non-sensitive but NOT in the allowlist". A user-scoped client query that projects `sync_error` returns NULL — silently, no error. The status pill's helper line (D-08) will show blank even when there is an error message.
**Fix:** Migration 066 must include `GRANT SELECT (sync_error) ON api_keys TO authenticated;` (after adding `sync_error` to `API_KEY_USER_COLUMNS_ARR` in constants.ts). Also add `sync_error` to the `getUserApiKeys()` return type.
**Risk if missed:** Status pill helper line always blank; error detail invisible to allocators.

### Landmine 3: `ExchangeConnection` interface missing `sync_error`
**File:** `src/components/exchanges/AllocatorExchangeManager.tsx` lines 29-39
**Problem:** The `ExchangeConnection` interface does not include `sync_error`. The `ExchangeConnection` is used as the prop type AND the `useState` type. Adding `sync_error` to the query but not the interface will cause TS errors.
**Fix:** Add `sync_error: string | null` to `ExchangeConnection`. Update wherever `initialKeys: ExchangeConnection[]` is typed.
**Risk if missed:** TypeScript compile error on CI.

### Landmine 4: `enqueue_compute_job` currently rejects any call with both `p_strategy_id=NULL` and `p_allocator_id=NULL`
**File:** `supabase/migrations/062_scoring_weight_overrides.sql` lines 326-329
**Problem:**
```sql
RAISE EXCEPTION 'enqueue_compute_job: exactly one of p_strategy_id or p_allocator_id must be non-null ...'
```
The current function raises if called with `p_strategy_id=NULL, p_allocator_id=NULL, p_api_key_id=<value>`. The Phase 06 DROP+REDEFINE must add a third valid path: `p_api_key_id IS NOT NULL AND p_strategy_id IS NULL AND p_allocator_id IS NULL`.
**Risk if missed:** All `poll_allocator_positions` enqueue calls fail with `invalid_parameter_value` exception.

### Landmine 5: `compute_jobs_admin` view does not include `api_key_id` column
**File:** `supabase/migrations/033_compute_jobs_admin_and_defer.sql` lines 60-90
**Problem:** The admin view joins `compute_jobs` with `strategies`, `portfolios`, and `profiles` (strategy + portfolio owner). It does NOT reference `api_keys`. After adding `api_key_id` to `compute_jobs`, the admin view still works but won't show the API key label or allocator email for `poll_allocator_positions` jobs. The existing JOIN to `profiles sp ON sp.id = s.user_id` will produce NULL for api_key_id-scoped jobs.
**Fix options:**
1. Add a LEFT JOIN to `api_keys ak ON ak.id = cj.api_key_id` in migration 066 (extend the view).
2. Accept the NULL for now — admin UI shows blank strategy_name for allocator jobs.
**Recommendation:** Extend the view in migration 066 Step 2 (or as a separate Step 11) to avoid confusion in production support. This is low-risk.

### Landmine 6: Self-verifying DO block cannot use `SAVEPOINT` in a `DO $$` block for the multi-actor RLS test
**Source:** CONTEXT.md D-15 says the RLS test runs inside a SAVEPOINTed block. BUT migration 062 self-verifying section (lines 579-637) demonstrates the project does NOT use SAVEPOINT — instead it:
1. Inserts probe data
2. Asserts
3. Explicitly DELETEs probe data at the end

[VERIFIED: `supabase/migrations/062_scoring_weight_overrides.sql` lines 636-637]
```sql
DELETE FROM compute_jobs WHERE allocator_id = v_probe_allocator;
DELETE FROM auth.users WHERE id = v_probe_allocator;
```

CONTEXT.md D-15 says "ROLLBACK the SAVEPOINT so the migration leaves no test data behind" but the actual project convention (as proven by migration 062) is explicit DELETE cleanup, NOT SAVEPOINT. PL/pgSQL in a `DO $$` block cannot issue transaction-control statements (`SAVEPOINT`, `ROLLBACK TO`) because those are caller-visible transaction operations.

The `BEGIN...EXCEPTION...END` pattern IS supported inside `DO $$` and IS used in migration 062 (line 622-629) for catching `unique_violation`. The multi-actor test should use:
1. `SET LOCAL ROLE` to switch to `authenticated` (within a transaction that auto-reverts on `COMMIT`)
2. OR just do service-role inserts + explicit DELETE cleanup at the end

**The planner MUST use explicit DELETE cleanup, not ROLLBACK TO SAVEPOINT, for the migration 066 DO block.**

### Landmine 7: `compute_jobs_kind_target_coherence` CHECK — existing strategy-scoped branch needs `api_key_id IS NULL`
**Source:** CONTEXT.md D-04 mentions this implicitly but the full implication may be missed.

The current CHECK (after migration 062) has the strategy-scoped branch:
```sql
(kind IN ('sync_trades', ...) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL)
```

After adding `api_key_id` column to `compute_jobs`, any existing strategy-scoped job row that has `api_key_id IS NULL` (which all existing rows do) will still pass this constraint. But the constraint definition doesn't explicitly require `api_key_id IS NULL`. This is fine because the 4-way XOR on `compute_jobs_target_xor` already ensures exactly one target column is non-null — so if `strategy_id IS NOT NULL`, then `api_key_id IS NULL` by the XOR constraint. The coherence CHECK does NOT need to repeat `api_key_id IS NULL` in each branch. However, for the new `poll_allocator_positions` branch it MUST say `api_key_id IS NOT NULL`.

### Landmine 8: The `5s router.refresh()` polling creates `useEffect` + `setInterval` interaction that requires cleanup
**Source:** `AllocatorExchangeManager.tsx` pattern analysis
**Problem:** The D-11 polling spec says "client uses router.refresh() every 5s while any visible row has sync_status === 'syncing', stops polling once all rows transition out." This requires a `useEffect` with a `setInterval` that checks `keys.some(k => k.sync_status === 'syncing')`. The `keys` state is local React state updated by `setKeys`. There is a subtle bug risk: if `keys` comes from `router.refresh()` (which re-runs the server component and passes new `initialKeys` prop), the local `keys` state doesn't update automatically — the component initializes `useState(initialKeys)` and server prop changes don't re-sync unless the component re-mounts or the effect is wired to propagate them.

**Actual pattern:** The component uses `initialKeys` prop + local `keys` state with `useState(initialKeys)`. `router.refresh()` triggers a React server component re-render which DOES propagate new `initialKeys` to the client component IF the client component is a direct child of the server component (which it is — `AllocatorExchangeManager` receives `initialKeys` from `exchanges/page.tsx`). In Next.js 15+ (App Router), `router.refresh()` invalidates the server cache and re-renders the server component, passing new props to the client component. The `useState` initializer only runs on mount — subsequent prop changes do NOT update `keys` state automatically.

**Fix:** Add a `useEffect` that syncs `initialKeys` prop changes into `keys` state:
```typescript
useEffect(() => {
  setKeys(initialKeys);
}, [initialKeys]);
```
This is the correct pattern for client components that receive server-side-refreshed data as props.

---

## Section 8: Open Questions

1. **`fetch_tickers()` call shape for spot mark price**
   - What we know: CCXT `fetch_tickers(symbols)` is a bulk call; `fetch_ticker(symbol)` is per-asset. Stablecoins (USDT, USDC, BUSD) should be priced at 1.0 without a ticker call.
   - What's unclear: Rate limit cost of `fetch_tickers` varies by exchange. On Binance, `fetch_tickers()` with a symbol list is a single REST call. On Deribit, the asset universe is smaller (BTC/ETH-based).
   - Recommendation: Use `fetch_tickers(symbol_list)` with stablecoin skip. The symbol list must be converted from raw currency names (e.g., `"BTC"`) to CCXT market symbols (e.g., `"BTC/USDT"`) using `exchange.markets` loaded via `exchange.load_markets()`.

2. **Whether `complete_with_warnings` is used in v0.15**
   - What we know: The dual-call path (fetch_balance + fetch_positions) can partial-fail — e.g., balance succeeds but positions fail.
   - What's unclear: Should the worker write `complete_with_warnings` if one side (spot or derivative) succeeds and the other fails?
   - Recommendation: YES, use it. If `fetch_balance()` succeeds but `fetch_positions()` raises a non-auth error (exchange outage, timeout), write the spot rows and set `sync_status='complete_with_warnings'` with `sync_error` = the positions error message. This avoids losing the spot data when the derivatives endpoint is transiently down.

3. **Deribit `fetch_balance()` shape**
   - What we know: Deribit is per-settlement-currency (`BTC`, `ETH`, `USDC`); no unified USDT account.
   - What's unclear: Whether CCXT's unified `fetch_balance()` on Deribit returns a unified dict or requires per-currency calls.
   - Recommendation: Add Deribit to `EXCHANGE_CLASSES` and test the `fetch_balance()` return shape in a pytest fixture with a mock exchange. If it requires per-currency calls, add a `_fetch_balance_deribit(exchange)` branch similar to `_fetch_positions_bybit`.

4. **The `compute_jobs_admin` view — extend or leave for now?**
   - What we know: The view currently joins strategies + portfolios but not `api_keys`. Admin UI will show blank for allocator jobs.
   - What's unclear: Whether the admin queue UI is used in production for debugging.
   - Recommendation: Extend the view in migration 066 with `LEFT JOIN api_keys ak ON ak.id = cj.api_key_id` and expose `ak.label AS api_key_label`, `ak.exchange AS api_key_exchange`. Low-risk, high ops-value.

5. **`_assert_owner` in the new `enqueue_compute_job` path**
   - What we know: The strategy path calls `_assert_owner('strategies'::regclass, p_strategy_id, ...)`. The allocator path skips it. The api_key path should verify the calling user owns the api_key.
   - What's unclear: Should the `POST /api/allocator/holdings/sync` route do the ownership check in the route handler (TypeScript) or in the DB function?
   - Recommendation: Do it in the route handler (TypeScript, `withAuth` wrapper) — the route already has the `user.id` from JWT. The DB function (`enqueue_compute_job`) should NOT own the api_key-ownership assertion; it's SECURITY DEFINER and called from the pg_cron path which has no user context. The ownership check belongs in the route, not the DB function.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CCXT unified position normalization | Custom normalizer from scratch | `_normalize_ccxt_position` + `fetch_positions` from `positions.py` | Already handles Binance/OKX/Bybit/Bybit-V5-fallback; 3+ exchange edge cases |
| Credential decryption | Direct Fernet calls | `decrypt_credentials(key_row, kek)` from `encryption.py` | Envelope-encryption pattern with KEK version tracking |
| Exchange factory | Direct `ccxt.binance(...)` | `create_exchange(name, key, secret, passphrase)` | Rate-limit enable + passphrase handling standardized |
| Circuit breaker check | Time-based logic inline | `_check_circuit_breaker(supabase, job, key_row)` | Handles per-exchange cooldown, defer RPC, cooldown math |
| 429 stamping | Direct DB update | `_stamp_429(supabase, key_row)` | Best-effort with failure swallow |
| In-flight job dedup | Client-side debounce | `compute_jobs_one_inflight_per_kind_api_key` partial unique index | Race-safe, DB-level, works across worker replicas |
| RLS proof | Trust code review | Self-verifying DO block + `bridge-outcomes-rls.test.ts` pattern | Actually exercises live Postgres policies |
| Audit fire-and-forget | Direct RPC await | `logAuditEvent(supabase, event)` | `after()` semantics, swallows errors, never blocks response |

---

## Common Pitfalls

### Pitfall 1: Using wrong Supabase client in the sync route
**What goes wrong:** Route handler uses `createAdminClient()` instead of `createClient()` for the ownership check, so `auth.uid()` returns NULL in the RPC, causing the audit event to have no user attribution.
**How to avoid:** Use `createClient()` (user-scoped) for the ownership verify + audit emission. Use service-role only if you need to write `api_keys.sync_status` directly (workaround: use `enqueue_compute_job` which is SECURITY DEFINER and handles the service-side write).

### Pitfall 2: `router.refresh()` does not re-sync client state without a `useEffect`
**What goes wrong:** `router.refresh()` re-renders the server component, passes new `initialKeys` prop, but `useState(initialKeys)` only uses the value on mount. Subsequent prop changes are ignored. Polling appears to work (no errors) but the UI never updates.
**How to avoid:** Add `useEffect(() => { setKeys(initialKeys); }, [initialKeys])` in `AllocatorExchangeManager`.

### Pitfall 3: Missing `GRANT SELECT (sync_error)` in migration
**What goes wrong:** `sync_error` column added to `API_KEY_USER_COLUMNS` and the TS type, but the Supabase query returns NULL because `authenticated` role doesn't have column-level SELECT. Helper line always blank.
**How to avoid:** Migration 066 must include the GRANT. Self-verifying DO block should assert `has_column_privilege('authenticated', 'api_keys', 'sync_error', 'SELECT')`.

### Pitfall 4: Deribit not in `EXCHANGE_CLASSES` causes silent permanent failure
**What goes wrong:** Job enqueued for a Deribit key; worker hits `ValueError` in `create_exchange`; job marked permanent failure; allocator sees `sync_status='error'` with unhelpful message.
**How to avoid:** Add Deribit to `EXCHANGE_CLASSES` before shipping. If Deribit balance shape requires per-currency calls, add the branch in `fetch_allocator_holdings`.

### Pitfall 5: `enqueue_compute_job` raises on `p_api_key_id` path if old signature survives
**What goes wrong:** Migration 066 DROP uses the post-062 7-param signature. If a future re-run of `db push` re-applies migrations out of order, the wrong function is dropped.
**How to avoid:** Always specify exact param-type lists in `DROP FUNCTION IF EXISTS`. The DO block's `pronargs` assertion (like migration 062 line 566) catches signature drift.

### Pitfall 6: Status pill shows `null` instead of "Idle" for freshly inserted keys
**What goes wrong:** New key inserted with `sync_status: "idle"` but `ExchangeConnection.sync_status` is typed `string | null`. Component must handle `null` (pre-first-sync rows) and `"idle"` (explicitly set) as the same neutral state.
**How to avoid:** The pill renderer should treat `null` and `"idle"` identically. The `handleAddKey` path sets `sync_status: "idle"` on INSERT (line 144 of `AllocatorExchangeManager.tsx`) which is correct.

---

## Code Examples

### Pattern: `_allocator_key_preflight` skeleton
```python
# Source: analytics-service/services/job_worker.py (new function, following _exchange_preflight pattern)
@dataclass
class _AllocatorExchangeContext:
    supabase: object
    key_row: dict
    exchange: object

async def _allocator_key_preflight(
    job: dict, handler_name: str
) -> DispatchResult | _AllocatorExchangeContext:
    api_key_id = job.get("api_key_id")
    if not api_key_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: api_key_id missing",
            error_kind="permanent",
        )

    kek = get_kek()
    supabase = get_supabase()

    def _load_key() -> dict | None:
        res = (
            supabase.table("api_keys")
            .select("*")
            .eq("id", api_key_id)
            .maybe_single()
            .execute()
        )
        return res.data

    key_row = await db_execute(_load_key)
    if not key_row:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="API key not found",
            error_kind="permanent",
        )

    if not key_row.get("is_active"):
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="API key is inactive",
            error_kind="permanent",
        )

    defer_result = await _check_circuit_breaker(supabase, job, key_row)
    if defer_result is not None:
        return defer_result

    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
    exchange = create_exchange(key_row["exchange"], api_key, api_secret, passphrase)

    return _AllocatorExchangeContext(
        supabase=supabase,
        key_row=key_row,
        exchange=exchange,
    )
```

### Pattern: `persist_allocator_holdings` idempotent upsert
```python
# Source: modeled on positions.py::persist_position_snapshots (line 202)
async def persist_allocator_holdings(
    supabase_client,
    holdings: list[dict],
    allocator_id: str,
    api_key_id: str,
    asof_date: str,  # "YYYY-MM-DD"
) -> int:
    if not holdings:
        return 0

    rows = [
        {
            **h,
            "allocator_id": allocator_id,
            "api_key_id": api_key_id,
            "asof": asof_date,
        }
        for h in holdings
    ]

    def _upsert():
        return supabase_client.table("allocator_holdings").upsert(
            rows,
            on_conflict="allocator_id,venue,symbol,asof",
        ).execute()

    await db_execute(_upsert)
    return len(rows)
```

### Pattern: Migration 066 4-way XOR (skeleton)
```sql
-- Source: extends supabase/migrations/062_scoring_weight_overrides.sql lines 97-108
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_target_xor;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_target_xor CHECK (
    (strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL AND api_key_id IS NULL) OR
    (strategy_id IS NULL AND portfolio_id IS NOT NULL AND allocator_id IS NULL AND api_key_id IS NULL) OR
    (strategy_id IS NULL AND portfolio_id IS NULL AND allocator_id IS NOT NULL AND api_key_id IS NULL) OR
    (strategy_id IS NULL AND portfolio_id IS NULL AND allocator_id IS NULL AND api_key_id IS NOT NULL)
  );
```

### Pattern: POST /api/allocator/holdings/sync route skeleton
```typescript
// Source: follows src/lib/api/withAuth.ts pattern (line 8)
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";
import { z } from "zod";

const BodySchema = z.object({ api_key_id: z.string().uuid() });

export const POST = withAuth(async (req: NextRequest, user) => {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { api_key_id } = parsed.data;

  const supabase = await createClient();

  // Ownership check: key must belong to the calling user
  const { data: keyRow, error: keyErr } = await supabase
    .from("api_keys")
    .select("id")
    .eq("id", api_key_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (keyErr || !keyRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Enqueue via SECURITY DEFINER RPC (idempotent — partial unique index handles duplicates)
  const { error: enqueueErr } = await supabase.rpc("enqueue_compute_job", {
    p_strategy_id: null,
    p_api_key_id: api_key_id,
    p_kind: "poll_allocator_positions",
  });
  if (enqueueErr) {
    // 23505 = unique_violation = already in-flight
    if (enqueueErr.code === "23505") {
      return NextResponse.json({ already_inflight: true }, { status: 200 });
    }
    return NextResponse.json({ error: "Enqueue failed" }, { status: 500 });
  }

  // Stamp syncing status
  await supabase
    .from("api_keys")
    .update({ sync_status: "syncing" })
    .eq("id", api_key_id);

  logAuditEvent(supabase, {
    action: "allocator.holdings.sync_requested",
    entity_type: "api_key",
    entity_id: api_key_id,
  });

  return NextResponse.json({ ok: true });
});
```

**NOTE:** The `enqueue_compute_job` RPC currently has `REVOKE ALL ON FUNCTION enqueue_compute_job FROM PUBLIC, anon, authenticated` (migration 062 line 335). The route uses a user-scoped `createClient()` which runs as `authenticated`. **This means the route cannot directly call `enqueue_compute_job` via the user-scoped client.** Options:
1. Add a new thin SECURITY DEFINER wrapper RPC (e.g., `request_allocator_holdings_sync(p_api_key_id UUID)`) that does the ownership check + enqueue in one call. GRANT EXECUTE to `authenticated`. This is the cleanest pattern and matches how the mandate write path works.
2. Use the admin client for just the enqueue call (ownership check stays on user-scoped client first). This requires importing `createAdminClient` in the route.

**Option 1 (new RPC wrapper) is strongly recommended** — it matches ADR-0001/ADR-0004, keeps the ownership check in the DB (defense in depth), and avoids introducing admin-client calls in a user-facing route. The RPC would be: `request_allocator_holdings_sync(p_api_key_id UUID)` — checks ownership via `auth.uid()`, calls `enqueue_compute_job(p_api_key_id:=..., p_kind:='poll_allocator_positions')`, sets `sync_status='syncing'`. This becomes Step 7.5 in migration 066 (before the cron function) or merged into Step 7.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact for Phase 06 |
|--------------|------------------|--------------|---------------------|
| Direct `supabase.rpc()` call from route for enqueueing | SECURITY DEFINER RPC wrappers | Migration 032 | Route cannot call `enqueue_compute_job` as `authenticated` — needs a thin wrapper RPC |
| Manual strategy loading in every worker | Shared `_exchange_preflight` + `_ExchangeContext` dataclass | Sprint 3 | Copy the pattern exactly for the allocator path |
| `SAVEPOINT` in DO blocks | Explicit INSERT + DELETE cleanup | Migration 062 precedent | CONTEXT.md D-15 says SAVEPOINT — actual project convention is explicit DELETE |
| `sync_status` fixed 6-value CHECK | Extensible via DROP+ADD CHECK | Migration 007 | Phase 06 adds `revoked` + `rate_limited` via same pattern |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deribit CCXT unified `fetch_balance()` returns same `{total: {currency: amount}}` shape as other exchanges | Section 1 | Deribit-side holdings silently empty or error; need per-currency call branch |
| A2 | `fetch_tickers(symbol_list)` is available on all 4 exchanges for bulk spot pricing | Section 1 / Open Questions | Need to fall back to per-symbol `fetch_ticker` or skip mark price for non-USDT assets |
| A3 | pg_cron `cron.schedule()` in migration 066 is CLI-compatible on the project's Supabase tier | Section 3 | Need MCP path if pg_cron extension version mismatch |
| A4 | `compute_jobs_admin` view does NOT currently break if `api_key_id IS NOT NULL` rows exist (LEFT JOINs return NULLs gracefully) | Section 7 Landmine 5 | Admin view query errors; low risk since it's all LEFT JOINs |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| CCXT (Python) | Worker exchange calls | ✓ | Installed in analytics-service | — |
| pg_cron | Migration 066 Step 8 | ✓ (project uses it in prior migrations) | Supabase-managed | Use worker daily loop instead |
| Supabase MCP `apply_migration` | Migration 066 (recommended path) | ✓ (used in Phase 5) | — | `supabase db push` (not recommended) |
| `withAuth` wrapper | New sync route | ✓ (verified) | — | — |
| `logAuditEvent` | New sync route | ✓ (verified) | — | — |
| `live-db.ts` test helper | `allocator-holdings-rls.test.ts` | ✓ (verified) | — | — |

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | `withAuth` on `POST /api/allocator/holdings/sync`; CSRF via `assertSameOrigin` |
| V3 Session Management | No | Session management not in scope |
| V4 Access Control | Yes | Ownership check in route; RLS on `allocator_holdings`; REVOKE on `enqueue_compute_job` |
| V5 Input Validation | Yes | Zod schema on route body; `p_api_key_id` UUID validation in RPC |
| V6 Cryptography | Yes | Existing envelope encryption via `decrypt_credentials` + Fernet; no hand-roll |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Allocator spoofs another allocator's `api_key_id` in sync request | Spoofing | Route ownership check + RLS `USING (allocator_id = auth.uid())` |
| Client tries to read another allocator's holdings | Information Disclosure | `allocator_holdings_owner_select` RLS policy + regression test |
| Sync endpoint DoS (repeated "Sync now" spam) | Denial of Service | `compute_jobs_one_inflight_per_kind_api_key` partial unique index; 23505 caught as `already_inflight` |
| KEK rotation breaks existing decrypt | Tampering | `kek_version` column on `api_keys`; `InvalidToken` → permanent error classification |
| `sync_error` exposes internal details | Information Disclosure | `classify_exception` truncates to 500 chars; worker sanitizes before writing |

---

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/job_worker.py` — dispatch chain, preflight, classify_exception, circuit breaker
- `analytics-service/services/positions.py` — fetch_positions, normalize_ccxt_position
- `analytics-service/services/exchange.py` — create_exchange, EXCHANGE_CLASSES
- `analytics-service/services/encryption.py` — decrypt_credentials
- `supabase/migrations/062_scoring_weight_overrides.sql` — canonical XOR/DROP+REDEFINE/DO-block template
- `supabase/migrations/059_bridge_outcomes.sql` — 3-tier RLS template
- `supabase/migrations/007_security_hardening.sql` — api_keys.sync_status CHECK origin
- `supabase/migrations/027_api_keys_column_revoke.sql` — sync_error REVOKE status
- `supabase/migrations/033_compute_jobs_admin_and_defer.sql` — enqueue_poll_positions_for_all_strategies template
- `src/components/exchanges/AllocatorExchangeManager.tsx` — current UI shape
- `src/lib/queries.ts` + `src/lib/constants.ts` — getUserApiKeys + API_KEY_USER_COLUMNS
- `src/lib/api/withAuth.ts` — route wrapper pattern
- `src/lib/audit.ts` — logAuditEvent, AuditAction, AuditEntityType
- `src/__tests__/bridge-outcomes-rls.test.ts` + `src/lib/test-helpers/live-db.ts` — two-actor test harness
- `.planning/config.json` — nyquist_validation: true confirmed

### Secondary (MEDIUM confidence)
- CONTEXT.md D-01 through D-19 — locked decisions (already user-validated)
- `.planning/codebase/TESTING.md` — test structure patterns

### Tertiary (LOW / ASSUMED)
- CCXT `fetch_tickers()` bulk call shape across Deribit — not verified in codebase
- Deribit `fetch_balance()` per-currency requirement — [ASSUMED] based on Deribit's settlement model

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all files verified against actual codebase
- Architecture: HIGH — migration patterns and dispatch chain confirmed
- Pitfalls: HIGH — landmines verified against actual file contents
- Test harness: HIGH — `bridge-outcomes-rls.test.ts` pattern confirmed verbatim

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (stable patterns; CCXT version assumptions need re-check if ccxt is upgraded)
