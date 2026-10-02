# Phase 06: Allocator API Ingestion - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A brand-new allocator adds a read-only exchange API key (Binance / OKX / Bybit / Deribit), and within one sync cycle their real holdings are written to a new `allocator_holdings` table via an idempotent, RLS-safe, owner-scoped CCXT worker path.

In scope: `allocator_holdings` table + `poll_allocator_positions` compute-job kind + worker path + first-run on key-add + manual "Sync now" button wiring + daily cron re-syncs + surfaced error states + RLS regression test.

Out of scope (other phases or deferred): seed-purge / dashboard rewire (Phase 07), `/connections` rework + revoke/delete UX + notes (Phase 08), Bridge wire-up against `allocator_holdings` (Phase 09), onboarding nudges (Phase 11), CSV / manual entry (dropped from v0.15), wallet OAuth / custody integrations (post-v0.15).

</domain>

<decisions>
## Implementation Decisions

### Coverage (CCXT surface)
- **D-01:** Holdings ingestion calls **BOTH** `fetch_balance()` (spot) **AND** `fetch_positions()` (derivatives) per sync, normalizes both into a single `allocator_holdings` row stream distinguished by `holding_type` ('spot' | 'derivative'). Captures the realistic institutional crypto portfolio shape (USDT cash + spot tokens + open futures positions). The existing `services/positions.py::fetch_positions()` covers the derivatives side verbatim (Binance futures CCXT unified, OKX hedge dual-side, Bybit V5 fallback); a new `fetch_balance()` normalizer wraps `exchange.fetch_balance()` and emits one row per non-zero asset with `side='flat'`, `quantity=balance.total`, `value_usd=balance.total * mark_price` (mark from `fetch_tickers()` or per-asset `fetch_ticker(symbol)` — planner picks the lower-API-cost call shape).

### Schema (`allocator_holdings`)
- **D-02:** Columns:
  - **Identity:** `id UUID PK`, `allocator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT` (so revoke/delete in Phase 08 cascades cleanly without silently erasing audit history — mirrors Phase 5 D-20a precedent for FK choice), `venue TEXT NOT NULL` (= `api_keys.exchange`), `symbol TEXT NOT NULL`, `asof DATE NOT NULL` (UTC date of the snapshot — daily granularity, INGEST-04 idempotency anchor)
  - **Type / direction:** `holding_type TEXT NOT NULL CHECK (holding_type IN ('spot','derivative'))`, `side TEXT NOT NULL CHECK (side IN ('long','short','flat'))` (`'flat'` for spot per D-01)
  - **Metrics:** `quantity NUMERIC NOT NULL` (base), `value_usd NUMERIC NOT NULL`, `entry_price NUMERIC` (NULL for spot, populated for derivatives via CCXT entryPrice), `mark_price NUMERIC NOT NULL`, `unrealized_pnl_usd NUMERIC` (NULL for spot, populated for derivatives via CCXT unrealizedPnl), `cost_basis_usd NUMERIC` NULLABLE — see D-06
  - **Audit / debug:** `raw_payload JSONB` (the normalizer's input dict, capped — bounded by per-row ~4KB; full request/response stays in worker logs), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (with updated_at trigger — reuse the project-standard trigger function)
  - **Indexes:** `UNIQUE (allocator_id, venue, symbol, asof)` for INGEST-04 idempotent diff-upsert + `INDEX (allocator_id, asof DESC)` for Phase 07 dashboard fan-out + `INDEX (api_key_id)` for Phase 08 revoke/cascade flows
  - Mirrors `position_snapshots` shape so Phase 09 Bridge integration can reuse query patterns. **`weight_pct` is NOT denormalized** — dashboard computes it at read time (avoids partial-upsert inconsistency window).

### RLS (three-tier — mirrors `bridge_outcomes` migration 059)
- **D-03:**
  - `allocator_holdings_owner_select` — `FOR SELECT USING (allocator_id = auth.uid())` (owner self-select; INGEST-09 anti-leak primary defense)
  - `allocator_holdings_admin_select` — `FOR SELECT USING (current_user_has_app_role('admin'))` (admin support tooling per ADR-0005 / migration 054 pattern)
  - `allocator_holdings_service_all` — `FOR ALL USING (auth.role() = 'service_role')` (worker writes via service-role)
  - **No allocator UPDATE/INSERT/DELETE policy** — allocators never write directly; the worker is the only producer (Phase 8 revoke/delete in `MANAGE-02/03` operates via SECURITY DEFINER RPC, not direct DML).

### Compute job kind
- **D-04:** New kind `poll_allocator_positions`:
  - **Registry:** `INSERT INTO compute_job_kinds (name) VALUES ('poll_allocator_positions') ON CONFLICT DO NOTHING` (mirrors migration 048 line 110 / 062 step 5).
  - **CHECK:** `DROP+ADD compute_jobs_kind_target_coherence` — add branch `kind = 'poll_allocator_positions' AND api_key_id IS NOT NULL AND allocator_id IS NULL AND strategy_id IS NULL AND portfolio_id IS NULL`. Per INGEST-02, this is keyed off `api_key_id`, NOT `allocator_id` (one allocator can have N keys; each key has its own polling cadence + circuit-breaker state). Requires adding an `api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE` column to `compute_jobs` AND extending the existing 3-way XOR (`compute_jobs_target_xor`) to a **4-way XOR** across `strategy_id` / `portfolio_id` / `allocator_id` / `api_key_id` (DROP+ADD per migration 062 step 3 precedent).
  - **In-flight dedup:** new partial unique index `compute_jobs_one_inflight_per_kind_api_key` ON `(api_key_id, kind) WHERE api_key_id IS NOT NULL AND status IN ('pending','running','done_pending_children')` — mirrors the `_strategy` / `_portfolio` / `_allocator` precedents. Server-side dedup for "Sync now" spam protection (D-09).
  - **Per-kind timeout:** `TIMEOUT_PER_KIND['poll_allocator_positions'] = 3 * 60` (3 min — matches strategy-side `poll_positions` since the work shape is identical: one-or-two CCXT calls + a small upsert batch).

### Worker path
- **D-05:**
  - New file `analytics-service/services/allocator_positions.py` (sibling of `services/positions.py`). Houses: `fetch_allocator_holdings(exchange_name, exchange) -> list[dict]` (calls both `fetch_balance` + `fetch_positions`, normalizes to the unified shape), `persist_allocator_holdings(supabase, holdings, allocator_id, api_key_id, asof_date) -> int` (idempotent upsert via `on_conflict='allocator_id,venue,symbol,asof'`).
  - New handler `run_poll_allocator_positions_job(job)` in `services/job_worker.py` (added to the if/elif chain in `dispatch()` per the existing convention — dict lookup defeats monkey-patching tests). Pre-flight uses a **new helper** `_allocator_key_preflight(job, handler_name)` (sibling of `_exchange_preflight`) — loads `api_key` directly from `job.api_key_id` (no strategy hop), runs the same circuit-breaker check + decrypt + `create_exchange()` flow.
  - On `ccxt.RateLimitExceeded` (429): same `_stamp_429(supabase, key_row)` flow as strategy path — feeds the per-exchange circuit breaker.
  - Error classification: reuse `classify_exception()` unchanged. Set `api_keys.sync_status` + `sync_error` per D-07 in the same transaction as `mark_compute_job_failed`.

### Cost basis
- **D-06:** Worker writes `cost_basis_usd = entry_price * abs(quantity)` for any row with `holding_type='derivative'` AND non-null `entry_price`. **Spot rows keep `cost_basis_usd` NULL** — no exchange-reported basis exists for spot balances. Phase 9 Bridge logic must gate spot-row P&L computation on `cost_basis_usd IS NOT NULL`. Phase 8 (`MANAGE-06` notes / manual override) and any future trades-derived backfill will populate spot basis later. **Document this gap explicitly in PROJECT.md "Active — Inherited deferrals" at phase commit** so Phase 9 planner knows to gate.

### Error UX (sync_status surfacing)
- **D-07:** Extend the `api_keys.sync_status` CHECK constraint to add three new values: `revoked` (key returned 401/permission error), `rate_limited` (worker observed 429 and is in cooldown), `error` (already exists — covers exchange outage / unknown). Keep existing values: `idle` | `syncing` | `computing` | `complete` | `complete_with_warnings` | `error`. Worker writes `sync_status` + `sync_error` (free-text human-readable reason, ≤500 chars after sanitization per `classify_exception` truncation) atomically as part of the failure path.
- **D-08:** UI surfacing on `AllocatorExchangeManager.tsx` row:
  - Replace the disabled "Auto-synced" button with a real `Sync now` button (INGEST-06).
  - Inline status pill on the row (color-coded per DESIGN.md — neutral for `idle`/`syncing`/`complete`, amber for `rate_limited`/`complete_with_warnings`, red for `revoked`/`error`).
  - 12px muted helper line beneath the pill renders `sync_error` text (DM Sans, mirrors `MandateSaveStatus` aria-live pattern from Phase 2 — no new toast dependency).
  - Status pill copy table:
    - `idle` → "Idle" (neutral)
    - `syncing` → "Syncing…" (neutral, with spinner)
    - `complete` → "Synced {relative time ago}" (neutral)
    - `complete_with_warnings` → "Synced (warnings)" (amber, helper line shows warning text)
    - `rate_limited` → "Rate limited — retry in {N}s" (amber, helper line shows exchange + cooldown remaining)
    - `revoked` → "Key revoked" (red, helper line shows "Re-add a read-only key from your exchange.")
    - `error` → "Sync failed" (red, helper line shows sanitized `sync_error`)

### First-run UX + Sync now button behavior
- **D-09:** Key-add flow (INGEST-07):
  - `AllocatorExchangeManager::handleAddKey` continues calling `/api/keys/validate-and-encrypt` then inserting via the browser supabase client (existing path).
  - **After** the row insert succeeds, the client makes a **second call** to a new `POST /api/allocator/holdings/sync` with `{ api_key_id }` that enqueues a `poll_allocator_positions` job via `enqueue_compute_job` and sets `api_keys.sync_status='syncing'` in the same DB transaction. (Server-side enqueue, not a client supabase RPC — mirrors how strategy-side wizard finalize enqueues via the route layer.)
  - The route returns immediately. The client renders the new row with `sync_status='syncing'` pill.
- **D-10:** "Sync now" button (INGEST-06):
  - Same `POST /api/allocator/holdings/sync` route. Server-side `enqueue_compute_job` is idempotent against the `compute_jobs_one_inflight_per_kind_api_key` partial unique index (D-04); the route catches a `23505` SQLSTATE and returns `200 { already_inflight: true }` so the UX is "click is a no-op while syncing" instead of an error.
  - Client disables the button while `sync_status === 'syncing'` and re-enables on transition out. No client-side debounce timer needed — the in-flight unique index is the source of truth.
- **D-11:** Polling for status updates: client uses **`router.refresh()` every 5s** while any visible row has `sync_status === 'syncing'`, stops polling once all rows transition out. Reuses the `useTransition` import already in the component. **NOT** Supabase realtime — no other allocator-facing surface uses `postgres_changes` today and the planner shouldn't introduce a new realtime pattern in v0.15. (If polling proves bad UX in Phase 11 polish, swap to realtime then.)

### Cron orchestration (INGEST-08)
- **D-12:** New SECURITY DEFINER RPC `enqueue_poll_allocator_positions_for_all_keys()`:
  - Scans `api_keys WHERE is_active = true AND sync_status NOT IN ('revoked')` (excludes revoked but **includes** `error` so transient errors get retried daily; matches strategy-side semantics).
  - For each key, calls `enqueue_compute_job(p_kind:='poll_allocator_positions', p_api_key_id:=...)` with `run_at = now() + (random() * interval '600 seconds')` (0–600s jitter to avoid thundering herd against exchanges at 04:00 UTC).
  - Wrapped in the existing `enqueue_compute_job` flow — partial unique index dedups against any in-flight job from a prior cycle.
  - **Adds a new `p_run_at TIMESTAMPTZ DEFAULT NULL` parameter to `enqueue_compute_job` / `_enqueue_compute_job_internal`** if the existing signatures don't already support `run_at` (planner verifies during research; if absent, this is a 4th param-add cycle to those functions following the migration 062 DROP+REDEFINE precedent — same backwards-compat preserved via DEFAULT NULL).
  - **`compute_jobs.api_key_id` column add** in the same migration as the kind addition (D-04).
- **D-13:** Schedule via `cron.schedule()` in the same migration: `04:00 UTC daily` — off-peak for US + EU + APAC institutional desks, doesn't collide with the existing `warm-analytics` (00:00) or `alert-digest` (09:00) Vercel crons. Stays inside Postgres (pg_cron) so it bypasses the Hobby-plan 2-Vercel-cron cap.

### Routes / API surface
- **D-14:**
  - **NEW:** `POST /api/allocator/holdings/sync` — body `{ api_key_id: string }`. Wrapped in `withAuth`. Asserts the requested key belongs to the caller (`SELECT id FROM api_keys WHERE id = ? AND user_id = auth.uid()`), enqueues the job, sets `api_keys.sync_status='syncing'`, audit-logs via `log_audit_event({ action: 'allocator.holdings.sync_requested', entity_type: 'api_key', entity_id: api_key_id })`. Idempotent against the in-flight unique index per D-10.
  - **NO NEW READ ROUTE in Phase 06.** Phase 07 owns `getMyAllocationDashboard` extension to read `allocator_holdings`. Phase 06 ships the table + worker path + sync-trigger route + status surfacing only. The exchanges page already has `getUserApiKeys`; that's enough for the status pill.
  - **NO route added** under `/api/cron/*` — the daily orchestration is pg_cron-driven (D-13), not Vercel-cron-driven.

### RLS regression test (INGEST-09)
- **D-15:** Test framework = **pgTap-style DO block in the migration's self-verifying section** (mirrors the standard set by Phases 1–5: every migration ends with a `DO $$` block that asserts schema invariants + runs a SAVEPOINTed multi-actor test). The block:
  1. Creates two test allocator UUIDs `a1`, `a2`.
  2. INSERTs one `allocator_holdings` row owned by `a1` and one owned by `a2` via service-role.
  3. `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims = '{"sub":"<a1>"}'::jsonb`.
  4. `SELECT count(*) FROM allocator_holdings` must return 1 (only a1's row).
  5. Switch to a2's claim; assert count(*) = 1 again.
  6. ROLLBACK the SAVEPOINT so the migration leaves no test data behind.
  - Plus a Vitest integration spec under `src/__tests__/allocator-holdings-rls.test.ts` that uses the existing two-user test-helpers pattern (search `src/lib/test-helpers/` for the established two-actor harness — there is one for the `bridge_outcomes` RLS regression in Phase 1) and asserts the same anti-leak property at the application layer (defense in depth).

### Symbol normalization
- **D-16:** Symbol stored in `allocator_holdings.symbol` is the **CCXT-stripped form** — `_normalize_ccxt_position` in `services/positions.py` already does `symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")` for derivatives (e.g. `"BTC/USDT:USDT"` → `"BTCUSDT"`). The new spot normalizer applies the same convention: an asset key `"BTC"` from `fetch_balance()` is stored as `"BTC"` (no quote suffix). The `holding_type` column distinguishes — Phase 09 Bridge join logic must key on `(symbol, holding_type)` together, not symbol alone.

### Exchange coverage (in scope for Phase 06)
- **D-17:** All four exchanges already supported by `services/positions.py` and `services/exchange.py::create_exchange` ship in Phase 06: **Binance, OKX, Bybit, Deribit**. The `fetch_balance` path is uniformly supported by CCXT across all four; the per-exchange Bybit V5 fallback in `_fetch_positions_bybit` continues to apply for derivatives. Spot ingestion does not need per-exchange branching — `fetch_balance()` is a CCXT-unified call across the four. If a per-exchange edge case surfaces during implementation, the planner can DEFERRED-ID-it back here.

### Audit events
- **D-18:** New audit-event taxonomy entries (sync ADR-0023 in the same commit):
  - `allocator.holdings.sync_requested` — emitted by `POST /api/allocator/holdings/sync` (allocator-initiated)
  - `allocator.holdings.sync_completed` — emitted by worker on `DispatchOutcome.DONE` (one event per successful poll, `metadata = { row_count, holding_type_counts: {spot, derivative} }`)
  - `allocator.holdings.sync_failed` — emitted by worker on `DispatchOutcome.FAILED` (`metadata = { error_kind, sanitized_message }`)

### Migration ordering & application
- **D-19:** Single migration file `066_allocator_holdings.sql`:
  - Step 1: `CREATE TABLE allocator_holdings` + indexes + updated_at trigger.
  - Step 2: `ALTER TABLE compute_jobs ADD COLUMN api_key_id` + DROP+ADD `compute_jobs_target_xor` (4-way) + DROP+ADD `compute_jobs_kind_target_coherence` (with `poll_allocator_positions` branch).
  - Step 3: `INSERT INTO compute_job_kinds`.
  - Step 4: `CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_api_key`.
  - Step 5: `ALTER TABLE api_keys` — DROP+ADD CHECK on `sync_status` to add `revoked` and `rate_limited` values.
  - Step 6: DROP+REDEFINE `enqueue_compute_job` / `_enqueue_compute_job_internal` to add `p_api_key_id` and (if missing) `p_run_at`.
  - Step 7: `CREATE FUNCTION enqueue_poll_allocator_positions_for_all_keys()` (SECURITY DEFINER).
  - Step 8: `cron.schedule('poll-allocator-positions', '0 4 * * *', $$ SELECT enqueue_poll_allocator_positions_for_all_keys(); $$)`.
  - Step 9: 3 RLS policies on `allocator_holdings` (D-03).
  - Step 10: Self-verifying DO block — schema invariant asserts + SAVEPOINTed multi-actor RLS test (D-15).
  - **Application path:** `supabase db push` if all ops are CLI-compatible; otherwise `apply_migration` via Supabase MCP (Phase 5 D-20a/c precedent), then reconcile `supabase_migrations.schema_migrations.version`. Planner verifies during research whether the `cron.schedule` + DROP+REDEFINE FUNCTION + DROP+ADD CHECK combination needs MCP path.

### Claude's Discretion
- Exact CCXT call shape for spot pricing — `fetch_tickers()` (one bulk call) vs per-asset `fetch_ticker(symbol)` (N calls); planner picks based on per-exchange API rate-limit cost. Lower-cost shape wins.
- New file path for the route — likely `src/app/api/allocator/holdings/sync/route.ts` to leave room for `…/holdings/[id]/route.ts` etc. in Phase 08.
- Worker file shape inside `services/allocator_positions.py` — internal helper layout; just keep public API as `fetch_allocator_holdings()` + `persist_allocator_holdings()` per D-05.
- Vitest harness file location for the application-layer RLS spec (D-15) — co-located with other RLS regression tests if such a directory exists; else `src/__tests__/`.
- `raw_payload` JSONB column max size cap — planner picks (recommend ~4KB to keep the 1KB-typical row from blowing up).
- Exact spinner glyph / animation for the `syncing` pill — DESIGN.md motion-scale short (150ms).
- Mark price for spot `value_usd` calc — direct ticker query vs cached price oracle (Phase 07 PURGE-02 introduces a price-series oracle; if that lands first, reuse; otherwise direct ticker is fine for now and Phase 09 can swap).
- Whether `complete_with_warnings` is used in v0.15 (e.g. partial spot+derivative success where one side errored) or left as forward-compatible-only — planner picks based on whether the dual-call path can partial-fail.

### Folded Todos
None — `gsd-tools list-todos` returned `count: 0`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — v0.15.0.0 milestone goals, Sprint 9 success gate, Out of Scope (CSV / manual / wallet OAuth), Constraints (Supabase MCP for CLI-incompatible migrations, audit via `log_audit_event`, ADR-0023 sync rule)
- `.planning/REQUIREMENTS.md` — INGEST-01 through INGEST-09 (locked) + Migration disposition table
- `.planning/ROADMAP.md` — Phase 06 entry: goal, success criteria SC1–SC5, complexity High, no dependencies
- `.planning/STATE.md` — current phase pointer; Phases 1–5 complete; v0.15.0.0 milestone start
- `DESIGN.md` — DM Sans body 14px, 12px muted helper, neutral/amber/red status pill colors, motion-scale durations, no toast lib

### Cross-phase coupling — READ FIRST
- `.planning/phases/01-outcome-tracker/01-CONTEXT.md` — RLS three-tier (owner/admin/service) precedent, self-verifying DO block convention, idempotent upsert pattern
- `.planning/phases/01-outcome-tracker/01-01-SUMMARY.md` — migration 059 `bridge_outcomes` 3-tier RLS pattern (mirror for `allocator_holdings`)
- `.planning/phases/02-mandate-profile-builder/02-CONTEXT.md` — `MandateSaveStatus` aria-live + auto-save inline status pattern (mirror for sync_status pill helper line)
- `.planning/phases/03-mandate-aware-scoring-engine/03-CONTEXT.md` — migration 062 3-way XOR + new-kind add + `enqueue_compute_job` allocator-aware signature precedent (Phase 06 extends the same function for `api_key_id` + `run_at`)
- `.planning/phases/05-outcomes-dashboard/05-CONTEXT.md` — D-20a/c Supabase MCP `apply_migration` path + `schema_migrations.version` reconciliation procedure (apply same path here if `cron.schedule` + DROP+REDEFINE combination is CLI-incompatible)

### Architecture decision records
- `docs/architecture/adr-0001-rls-primary-authorization.md` — RLS as primary auth (owner-RLS on `allocator_holdings` enforces INGEST-09 anti-leak)
- `docs/architecture/adr-0003-service-role-bypass.md` — when admin client bypasses RLS (worker writes are service-role; admin debug reads use admin client per the 4 categories)
- `docs/architecture/adr-0004-route-wrappers.md` (verify path) — `withAuth` mandatory boundary for `POST /api/allocator/holdings/sync`
- `docs/architecture/adr-0005-rbac-roles.md` (verify path) — `current_user_has_app_role('admin')` for the admin-select RLS policy
- `docs/architecture/adr-0006-analytics-client-contract.md` — Next ↔ FastAPI contract; this phase does NOT call FastAPI from Next directly (worker is queue-driven), but sync-status reads stay on the Next side
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — sync this in the SAME commit as the migration when adding the three new event names (D-18)

### Migrations to mirror / extend
- `supabase/migrations/032_compute_jobs_queue.sql` — base `compute_jobs` table + `claim_compute_jobs` / `mark_compute_job_done` / `mark_compute_job_failed` / `defer_compute_job` / `reset_stalled_compute_jobs` RPCs + the strategy/portfolio partial unique indexes pattern (Phase 06 adds the api_key analog)
- `supabase/migrations/033_compute_jobs_admin_and_defer.sql` — `enqueue_poll_positions_for_all_strategies()` SECURITY DEFINER RPC (Phase 06 mirrors as `enqueue_poll_allocator_positions_for_all_keys()`)
- `supabase/migrations/036_poll_positions_kind.sql` — strategy-side `poll_positions` kind registration precedent
- `supabase/migrations/048_contact_request_metadata.sql` lines 110–141 — DROP+ADD CHECK + INSERT-into-registry pattern to follow exactly
- `supabase/migrations/059_bridge_outcomes.sql` — 3-tier RLS template (owner/admin/service-role) for `allocator_holdings`
- `supabase/migrations/062_scoring_weight_overrides.sql` — 3-way XOR DROP+ADD precedent (Phase 06 extends to 4-way), `_enqueue_compute_job_internal` DROP+REDEFINE pattern with new trailing parameter, allocator-scoped partial unique index pattern, self-verifying DO block at end
- `supabase/migrations/007_security_hardening.sql` lines 64–69 — `api_keys.sync_status` CHECK constraint precedent (Phase 06 extends)
- `supabase/migrations/027_api_keys_column_revoke.sql` — `api_keys` column-level REVOKE pattern (verify the new `sync_error` column doesn't need a REVOKE entry — likely service-role-only writes, allocator self-SELECT via existing api_keys policy is fine)
- `supabase/migrations/045_sync_checkpoints.sql` — `last_fetched_trade_timestamp` checkpoint pattern (analogous shape if Phase 06 ever needs cursor-style snapshot continuity beyond `asof`)

### FastAPI worker — files to extend
- `analytics-service/services/job_worker.py` — add `run_poll_allocator_positions_job` to `dispatch()` if/elif chain, add `_allocator_key_preflight()` helper, add `TIMEOUT_PER_KIND['poll_allocator_positions'] = 180`. Reuse `classify_exception`, `_check_circuit_breaker`, `_stamp_429`, `EXCHANGE_COOLDOWNS` unchanged.
- `analytics-service/services/positions.py` — `fetch_positions()` reusable verbatim for derivatives. Phase 06 adds new sibling `services/allocator_positions.py` rather than mutating this file (keep strategy-side path untouched).
- `analytics-service/services/exchange.py` — `create_exchange()`, `fetch_usdt_balance()` reusable. Phase 06's spot normalizer wraps `exchange.fetch_balance()` directly via the same async exchange object; no new factory needed.
- `analytics-service/services/encryption.py` — `decrypt_credentials(key_row, kek)` + `get_kek()` reusable verbatim.
- `analytics-service/services/db.py` — `db_execute()` + `get_supabase()` reusable verbatim.
- `analytics-service/main_worker.py` — dispatch loop calls `claim_compute_jobs`; no change needed (the new kind flows through automatically once `dispatch()` knows it).

### Next.js — files to extend / add
- `src/components/exchanges/AllocatorExchangeManager.tsx` — replace disabled "Auto-synced" button with real `Sync now` button, add status pill column, add 5s `router.refresh()` polling while any visible row is `syncing`. Helper line under the pill uses the `aria-live="polite"` pattern from `MandateSaveStatus`.
- `src/app/(dashboard)/exchanges/page.tsx` — no structural change; the existing `getUserApiKeys` already returns `sync_status` + `last_sync_at`. Phase 06 may need `getUserApiKeys` to also include `sync_error` (verify the column list).
- `src/lib/queries.ts` — `getUserApiKeys()` column projection: confirm `sync_error` is included; add if missing.
- `src/lib/constants.ts` — `API_KEY_USER_COLUMNS` constant; add `sync_error` if missing.
- `src/lib/api/withAuth.ts` — wrapper for the new sync route.
- `src/lib/audit.ts` — `logAuditEvent` already covers the new event names (taxonomy lives in ADR-0023, not in code).
- **NEW:** `src/app/api/allocator/holdings/sync/route.ts` — POST handler per D-14.
- **NEW:** `src/__tests__/allocator-holdings-rls.test.ts` — application-layer RLS regression spec per D-15.

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — three-tier split-stack diagram, "Three-client Supabase split" + "Durable Compute Jobs" sections (the patterns Phase 06 lives in); "Mutation flow" section for the new sync route shape
- `.planning/codebase/STACK.md` — Next 16 + Supabase + FastAPI + CCXT
- `.planning/codebase/STRUCTURE.md` — `src/app/api/**/route.ts` conventions; `analytics-service/services/` flat module layout
- `.planning/codebase/CONVENTIONS.md` — code style, kebab-case routes, file-co-located tests, audit-on-write
- `.planning/codebase/TESTING.md` — Vitest + RTL + pytest patterns; existing two-actor RLS harness if present
- `.planning/codebase/INTEGRATIONS.md` — CCXT exchange coverage matrix
- `.planning/codebase/CONCERNS.md` — `compute_jobs` RLS wide-open (`USING true`) is an existing concern; do NOT regress (Phase 06 reuses the same deny-all + service-role-write pattern)

### Runbook
- `docs/runbooks/vercel-cron-upgrade.md` — Hobby-plan 2-cron cap context (informs D-13's choice of pg_cron over Vercel cron)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/positions.py` — `fetch_positions()` (Binance futures CCXT unified, OKX hedge dual-side, Bybit V5 fallback) reused verbatim for D-01's derivative side.
- `analytics-service/services/exchange.py` — `create_exchange(exchange_name, api_key, api_secret, passphrase)` factory + `EXCHANGE_COOLDOWNS` map (Binance 120s / OKX 300s / Bybit 600s) reused for circuit-breaker stamping.
- `analytics-service/services/job_worker.py` — `_exchange_preflight` is the pattern for D-05's new `_allocator_key_preflight`; `classify_exception` + `_check_circuit_breaker` + `_stamp_429` reused unchanged; if/elif `dispatch()` chain extension point.
- `analytics-service/services/encryption.py` — `decrypt_credentials(key_row, kek)` + `get_kek()` reused; the Python service remains the sole holder of the KEK.
- `supabase/migrations/032/033/036/048/059/062` — collectively the migration template family Phase 06 mirrors. The `supabase/migrations/062_scoring_weight_overrides.sql` self-verifying DO block + DROP+REDEFINE FUNCTION + 3-way-XOR DROP+ADD pattern is the closest analog and the planner should treat it as the canonical reference.
- `src/components/mandate/MandateSaveStatus.tsx` (Phase 2) — aria-live inline status convention to mirror for the sync_status pill helper line.
- `src/lib/api/withAuth.ts` — route wrapper for `POST /api/allocator/holdings/sync`.
- `src/lib/audit.ts` — `logAuditEvent` (fire-and-forget) reused for D-18 audit events.

### Established Patterns
- **Compute job kind add:** registry INSERT + DROP+ADD CHECK + partial unique index (in-flight dedup) + per-kind timeout in worker — replicated four times historically (sync_trades, compute_analytics, compute_portfolio, poll_positions, sync_funding, reconcile_strategy, compute_intro_snapshot, rescore_allocator). Phase 06 follows it exactly.
- **3-tier RLS:** owner-self / admin-role / service-role — established by `bridge_outcomes` (migration 059); `allocator_holdings` mirrors verbatim.
- **DROP+REDEFINE FUNCTION with new trailing parameter:** migration 062 step 7 sets the precedent for adding `p_api_key_id` (and possibly `p_run_at`) to `enqueue_compute_job` / `_enqueue_compute_job_internal`. Backwards-compat preserved via DEFAULT NULL.
- **Self-verifying DO block:** every migration since Phase 1 ends with a `DO $$` that asserts schema invariants AND runs SAVEPOINTed integration assertions; Phase 06 must include the multi-actor RLS test (D-15) inside this block.
- **Idempotent upsert via unique index:** strategies use `(strategy_id, exchange, exchange_fill_id)`; allocator holdings use `(allocator_id, venue, symbol, asof)` (D-02).
- **Server-side enqueue from a Next route, not a client RPC:** strategy wizard finalize, mandate auto-save, and the new `POST /api/allocator/holdings/sync` all share this shape.

### Integration Points
- **`compute_jobs.api_key_id`** — new column extends the existing 3-way XOR to 4-way; this is the single largest schema ripple of Phase 06 (touches `compute_jobs_target_xor` + `compute_jobs_kind_target_coherence` + adds the partial unique index + extends `enqueue_compute_job` signature).
- **`api_keys.sync_status`** — CHECK extension to add `revoked` + `rate_limited`; existing `is_active` + `sync_status` semantics stay (Phase 08 will add the actual revoke RPC).
- **`AllocatorExchangeManager.tsx`** — the only Phase 06 frontend touch; remove the disabled-button branch comment block + replace with real wiring + add status pill column.
- **`getUserApiKeys` in `src/lib/queries.ts`** — verify `sync_error` is in the projection; add if missing.
- **pg_cron** — new schedule entry registered in the migration; coexists with the existing `match_cron_hourly` and the `cron_heartbeat` schedules.

</code_context>

<specifics>
## Specific Ideas

- D-01 explicitly: spot AND derivatives, both. Don't ship one without the other — institutional crypto allocators hold both, and the Sprint 9 acceptance gate (`fresh signup → API key → Performance populates`) would visibly fail for any LP whose entire book is on one side.
- D-02 mirrors `position_snapshots` schema shape on purpose so Phase 09 Bridge integration is a "swap the source table" exercise rather than a re-platform.
- D-08 status pill copy table is locked; the planner should not reword without flagging.
- D-15 RLS test: the SAVEPOINT-and-rollback pattern inside the self-verifying DO block is the only project-blessed way to leave no test data behind. Don't use `TRUNCATE` or per-test cleanup hooks.

</specifics>

<deferred>
## Deferred Ideas

- **`/connections` rework + revoke + delete UX** — Phase 08 (MANAGE-01/02/03). Phase 06 stops at: D-07 status pill on the existing `AllocatorExchangeManager.tsx` row + INGEST-06 Sync now wiring. Phase 08 owns the dedicated `/connections` route, the revoke RPC, and the cascade-or-flag-stale decision per key-deletion.
- **Spot cost-basis backfill (manual entry / notes / trades-derived)** — Phase 08 (MANAGE-06 notes) or a future trades-derived job. Phase 09 Bridge logic must gate spot-row P&L on `cost_basis_usd IS NOT NULL` until then. Tracked here so Phase 9 planner sees the gate.
- **Worker file shape (`services/allocator_positions.py` vs extend `services/positions.py`)** — D-05 picks new sibling file; if planner sees a strong reason to merge, flag during planning rather than mid-build.
- **`api_keys.is_active` semantics on revoke vs delete** — Phase 08 owns the actual revoke flow; Phase 06 only excludes `sync_status='revoked'` from the cron enqueue (D-12).
- **Symbol normalization edge cases** (e.g. perpetual-vs-quarterly futures with same base symbol on Deribit) — D-16 picks CCXT-stripped + `holding_type` discriminator; if a real edge case surfaces in implementation, surface back to discuss.
- **Vercel-cron path for alloc syncs** — explicitly rejected by D-13 (Hobby-plan 2-cron cap + pg_cron is already the project's daily-orchestration primitive). Re-evaluate post-Pro-plan upgrade.
- **Realtime push for sync_status** — D-11 picks 5s polling. Re-evaluate in Phase 11 polish if the polling burns visible function-instance time.
- **`weight_pct` denormalized on `allocator_holdings`** — explicitly rejected by D-02 (partial-upsert inconsistency window). Dashboard computes at read time.
- **Reviewed Todos (not folded)** — none surfaced (`gsd-tools list-todos` returned 0).

</deferred>

---

*Phase: 06-allocator-api-ingestion*
*Context gathered: 2026-04-19*
