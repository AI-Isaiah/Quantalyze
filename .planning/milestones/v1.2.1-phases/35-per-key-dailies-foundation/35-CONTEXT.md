# Phase 35: Per-key dailies foundation - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Give exchange API keys a per-key daily-returns series so the ONE
CSV → `compute_all_metrics` path can later (Phase 36) read an allocator's stats from a per-key
source instead of reconstructing from blended `allocator_equity_snapshots`.

In scope:
1. **Schema** — extend `csv_daily_returns` (user decision: ALTER the existing table, not a new one)
   to carry an `api_key_id` axis + a denormalized `allocator_id`, resolving the
   `strategy_id NOT NULL FK` blocker without synthetic strategy rows.
2. **Derive job** — generalize `run_derive_broker_dailies_job` from strategy-scoped to ALSO
   allocator-exchange-key-scoped (dual-mode): derive realized+funding dailies per crypto exchange
   key on the dense ~365-row calendar and upsert keyed by `api_key_id`.
3. **Backfill** — enqueue the generalized derive job for every existing allocator exchange key so
   historical keys get a per-key series.
4. **RLS** — scope per-key rows to the owning allocator (no cross-tenant read), proven by a test.

Out of scope: reading/blending the per-key series into Overview (Phase 36), the scenario per-source
toggle (Phase 37), composer chart (Phase 38). The store is "dark" (written, not yet read) until 36.
Annualization is **252** via the Phase-34 unified path — "365" here is calendar DENSITY only.
</domain>

<decisions>
## Implementation Decisions

### Store design — ALTER `csv_daily_returns` (user decision, 2026-06-24)
- The user chose to extend the existing `csv_daily_returns` table rather than create a new dedicated
  table. Consolidate per-key dailies into the same table the CSV-strategy pipeline already uses.
- **PK problem + resolution:** current `PRIMARY KEY (strategy_id, date)` cannot survive a nullable
  `strategy_id` (PK columns must be NOT NULL). Plan:
  - Drop `csv_daily_returns_pkey`.
  - `ALTER COLUMN strategy_id DROP NOT NULL`.
  - Add a surrogate PK (`id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, or UUID — planner's call).
  - Add `api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE` (nullable).
  - Add `allocator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` (nullable; denormalized).
  - XOR check: `num_nonnulls(strategy_id, api_key_id) = 1` (a row is EITHER a CSV-strategy daily OR a
    per-key daily, never both/neither).
  - Per-key integrity: `CHECK (api_key_id IS NULL OR allocator_id IS NOT NULL)` (per-key rows must
    carry their allocator).
  - **Two NON-partial unique indexes** — `UNIQUE (strategy_id, date)` and `UNIQUE (api_key_id, date)`.
    NON-partial is deliberate: Postgres treats NULLs as DISTINCT, so strategy rows (api_key_id NULL)
    don't collide on the api_key index and per-key rows (strategy_id NULL) don't collide on the
    strategy index — each index enforces only its own row-type, AND the existing
    `on_conflict="strategy_id,date"` upsert keeps working (a partial index would break that bare
    ON CONFLICT). VERIFY this NULLs-distinct behavior against the live PG version in a test.

### RLS scoping — denormalize allocator_id (user decision)
- Owner read policy: `allocator_id = auth.uid()` (mirrors `allocator_holdings` /
  `allocator_equity_snapshots`). Add this as a NEW SELECT policy for per-key rows — the existing
  `csv_daily_returns_owner_select` scopes via strategy ownership and per-key rows have NULL
  strategy_id, so they won't match it. Keep the existing strategy-owner policy for strategy rows.
- Keep `service_role ALL` (worker writes bypass RLS via SUPABASE_SERVICE_KEY) and the admin SELECT.
- **Cross-tenant test (criterion 4):** allocator A cannot SELECT allocator B's per-key rows. Prove
  with an authenticated (non-service-role) probe in the SQL/RLS test.

### Derive job — generalize `run_derive_broker_dailies_job` to dual-mode (criterion 2)
- Same job, generalized. When the job payload carries `api_key_id` (key-scoped, no strategy):
  preflight loads the api_key DIRECTLY (today it loads via `strategy_id` → strategy → api_key;
  allocator keys have NO strategy, so the strategy lookup must become optional). Fetch realized +
  funding for the key's exchange, `combine_realized_and_funding` → dense ~365-row calendar, upsert
  `{api_key_id, allocator_id (= api_keys.user_id), strategy_id: NULL, date, daily_return}` with
  `on_conflict="api_key_id,date"`, chunked 1000 rows, service-role.
- Do NOT enqueue `compute_analytics_from_csv` for key-scoped rows (that path is strategy-keyed;
  per-key reads are Phase 36). Strategy-scoped behavior is UNCHANGED.

### Backfill — enqueue-based, idempotent (criterion 3)
- Mirror `analytics-service/scripts/phase12_backfill_enqueue.py`: a one-off script that enqueues the
  generalized derive job (`api_key_id`-scoped) for every existing active allocator exchange key
  (`api_keys` where exchange IN binance/okx/bybit). Pre-check guard against duplicate pending jobs;
  atomic; 23505-safe; non-zero exit on any skip. Run via `railway ssh "cd /app && python -m
  scripts.<name>"` (SUPABASE_SERVICE_KEY env). Backfill = re-derive from the exchange API (there is no
  existing per-key data to copy).

### Claude's Discretion
- Surrogate PK type (BIGINT identity vs UUID); exact migration timestamp (must sort AFTER the latest
  APPLIED prod migration — check via Supabase MCP list_migrations, today is 2026-06-24 so 20260624…);
  whether ongoing auto-enqueue after allocator-key sync is wired now or deferred to the natural
  cron/sync epilogue (minimal correct wiring — planner's call).
</decisions>

<code_context>
## Existing Code Insights (codebase scout, 2026-06-24)

### Key files / facts
- `supabase/migrations/20260522111839_csv_daily_returns.sql:36-43` — `csv_daily_returns
  (strategy_id UUID NOT NULL FK→strategies ON DELETE CASCADE, date DATE, daily_return DOUBLE
  PRECISION, created_at, updated_at, PRIMARY KEY (strategy_id, date))`. RLS: `_service_role_all`,
  `_owner_select` (via strategy ownership), `_admin_select`.
- `analytics-service/services/job_worker.py:1716-1847` — `run_derive_broker_dailies_job`. Payload =
  `{kind:"derive_broker_dailies", strategy_id}`. `_exchange_preflight` loads strategy+api_key. Fetches
  full account history + per-exchange funding (`fetch_funding_{binance,okx,bybit}`, since_ms=None).
  `combine_realized_and_funding` (broker_dailies.py:119) → dense calendar via
  `pd.date_range(min,max,freq="D")`. Upsert `on_conflict="strategy_id,date"`, 1000-row chunks,
  service-role. Enqueues `compute_analytics_from_csv` after. Kill-switch
  `BROKER_DAILIES_VIA_FUNDING` (job_worker.py:177).
- `api_keys` (`20260405061911_initial_schema.sql:19-32`) — `id, user_id NOT NULL FK→profiles
  (=auth.uid()), exchange CHECK IN (binance,okx,bybit), label, encrypted creds, is_active,
  last_sync_at, last_429_at, ...`. NO allocator_id column — the OWNER (user_id) IS the allocator.
  RLS: `api_keys_owner` USING `user_id = auth.uid()`.
- **Closest analog — `allocator_holdings`** (`20260420073003`): already carries `allocator_id UUID
  FK→auth.users` + `api_key_id UUID FK→api_keys` + per-day rows; RLS = owner `allocator_id =
  auth.uid()` SELECT, admin `current_user_has_app_role(['admin'])` SELECT, `service_role` ALL.
  `allocator_equity_snapshots` (`20260420213754`) same RLS shape.
- Worker DB client = `services/db.py:71-77` `get_supabase()` → SUPABASE_SERVICE_KEY → **bypasses RLS**.
- Backfill precedent: `analytics-service/scripts/phase12_backfill_enqueue.py` (pre-check guard, atomic
  bulk insert, 23505 race handling, service-role, exit-1 on partial). Run `python -m scripts.<name>`.

### Migration conventions
- `YYYYMMDDHHMMSS_name.sql`, lexicographic order. Newest local: `20260622120000_…`. New migration must
  sort AFTER the latest APPLIED prod migration (memory: a backdated-migration safety guard exists +
  the `migration-reviewer` agent enforces timestamp/SECDEF/RLS invariants — run it before PR).
- Apply to TEST project via Supabase MCP `apply_migration`; prod auto-applies via Supabase Migrate on
  merge (per prior milestone practice).
</code_context>

<specifics>
## Specific Ideas

- The migration MUST pass the `migration-reviewer` AND `rls-policy-auditor` agents before PR — this is
  the criterion-4 RLS gate. Specifically prove: (a) no cross-tenant read (allocator A ↛ allocator B),
  (b) the two non-partial unique indexes enforce per-row-type uniqueness with NULLs-distinct, (c) the
  existing strategy-scoped upsert/path is byte-unchanged for strategy rows.
- The existing CSV-strategy pipeline (analytics_runner `run_csv_strategy_analytics`, the strategy
  upsert) must be PROVEN unaffected — a regression there breaks live factsheets.
</specifics>

<deferred>
## Deferred Ideas

- Reading/blending per-key dailies into Overview/queries.ts — Phase 36.
- Per-key factsheet surface — v2 (UNIFY-V2-01).
- Ongoing auto-enqueue richness beyond minimal wiring — keep surgical.
</deferred>
