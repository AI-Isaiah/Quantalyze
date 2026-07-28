# Phase 35: Per-key dailies foundation - Research

**Researched:** 2026-06-24
**Domain:** Postgres schema migration (Supabase PG17) + Python (FastAPI/Railway) compute-job worker generalization + RLS tenant isolation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Store design — ALTER `csv_daily_returns`** (NOT a new table). PK problem + resolution:
  - Drop `csv_daily_returns_pkey`.
  - `ALTER COLUMN strategy_id DROP NOT NULL`.
  - Add a surrogate PK (`id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, or UUID — planner's call).
  - Add `api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE` (nullable).
  - Add `allocator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` (nullable; denormalized).
  - XOR check: `num_nonnulls(strategy_id, api_key_id) = 1`.
  - Per-key integrity: `CHECK (api_key_id IS NULL OR allocator_id IS NOT NULL)`.
  - **Two NON-partial unique indexes** — `UNIQUE (strategy_id, date)` and `UNIQUE (api_key_id, date)`. NON-partial is deliberate (NULLs-distinct lets row-types not collide AND keeps the bare `on_conflict` upsert working). VERIFY NULLs-distinct against the live PG version in a test.
- **RLS scoping — denormalize allocator_id.** Owner read policy `allocator_id = auth.uid()` as a NEW SELECT policy for per-key rows. Keep the existing strategy-owner policy, `service_role ALL`, and the admin SELECT.
- **Derive job — generalize `run_derive_broker_dailies_job` to dual-mode.** When the payload carries `api_key_id` (no strategy): preflight loads the api_key DIRECTLY; fetch realized+funding; `combine_realized_and_funding` → dense ~365-row calendar; upsert `{api_key_id, allocator_id (= api_keys.user_id), strategy_id: NULL, date, daily_return}` with `on_conflict="api_key_id,date"`, chunked 1000 rows, service-role. Do NOT enqueue `compute_analytics_from_csv` for key-scoped rows. Strategy-scoped behavior UNCHANGED.
- **Backfill — enqueue-based, idempotent.** Mirror `analytics-service/scripts/phase12_backfill_enqueue.py`: enqueue the generalized derive job (`api_key_id`-scoped) for every existing active allocator exchange key. Pre-check guard, atomic, 23505-safe, non-zero exit on skip. Run via `railway ssh`.

### Claude's Discretion
- Surrogate PK type (BIGINT identity vs UUID).
- Exact migration timestamp (must sort AFTER the latest APPLIED prod migration — today is 2026-06-24 so `20260624…`).
- Whether ongoing auto-enqueue after allocator-key sync is wired now or deferred (minimal correct wiring — planner's call).

### Deferred Ideas (OUT OF SCOPE)
- Reading/blending per-key dailies into Overview/queries.ts — Phase 36.
- Per-key factsheet surface — v2 (UNIFY-V2-01).
- Ongoing auto-enqueue richness beyond minimal wiring — keep surgical.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DAILIES-01 | Per-key dailies store carries an `api_key_id` axis, resolving the `strategy_id NOT NULL FK` blocker without synthetic strategy rows | ALTER `csv_daily_returns` plan below; surrogate PK + nullable strategy_id + XOR + two non-partial unique indexes. Verified against the live table DDL (`20260522111839_csv_daily_returns.sql`). |
| DAILIES-02 | Generalize `run_derive_broker_dailies_job` from strategy-scoped to allocator-key-scoped (realized+funding @365 density) | `_allocator_key_preflight` already exists (job_worker.py:727) and loads the api_key directly with no strategy. Funding fetch passes `strategy_id` only as a label/log/match-key, NOT as a fetch scope — see Common Pitfalls. |
| DAILIES-03 | Backfill existing allocator exchange keys | `phase12_backfill_enqueue.py` precedent + the canonical active-key predicate `is_active=true AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL` (equity_reconstruction.py:1489-1491). |
| DAILIES-04 | Migration ships with an RLS review scoping per-key dailies to the owning allocator (no cross-tenant read) | New `allocator_id = auth.uid()` SELECT policy mirroring `allocator_holdings_owner_select`. Two-actor live RLS test pattern exists (`test_persist_csv_daily_returns_live.py`). |
</phase_requirements>

## Summary

The single most important finding: **`compute_jobs` is NOT a second blocker.** The queue table already has an `api_key_id` column (added in migration `20260420073003_allocator_holdings.sql` STEP 2), a 4-way target XOR that admits api_key-scoped jobs, a `compute_jobs_one_inflight_per_kind_api_key` partial unique index, and an `enqueue_compute_job(..., p_api_key_id := …)` path (9-param signature). Three existing job kinds (`poll_allocator_positions`, `reconstruct_allocator_history`, `refresh_allocator_equity_daily`) are already api_key-scoped and route through this exact machinery. The ONLY queue-side DDL Phase 35 needs is to add an **api_key-scoped arm for `derive_broker_dailies`** to the `compute_jobs_kind_target_coherence` CHECK (today that kind is registered strategy-scoped only). This is a ~15-line DROP+ADD CHECK swap with a strict-superset guard — the same pattern migration `20260614120000_derive_broker_dailies_kind.sql` already used to register the kind.

On the Python side, the dual-mode derive job is also largely pre-solved: `_allocator_key_preflight` (job_worker.py:727) loads an api_key directly from `job['api_key_id']` with no strategy hop, runs the circuit breaker, and decrypts. `run_derive_broker_dailies_job` (job_worker.py:1716) needs to branch on `api_key_id` vs `strategy_id`, use the key preflight in key-mode, skip the strategy-keyed `strategy_analytics` write and the `compute_analytics_from_csv` enqueue, and upsert keyed by `api_key_id,date`. The funding fetch's `strategy_id` argument is a label/log/match-key only (it never scopes the exchange call) — confirmed by reading `funding_fetch.py` and `broker_dailies.combine_realized_and_funding`. The derive job does NOT persist to `funding_fees` (that is `run_sync_funding_job`'s job), so the `funding_fees.strategy_id` FK is irrelevant here.

The schema ALTER is mechanically straightforward but has two correctness landmines the plan must address: (1) the live test `test_persist_csv_daily_returns_live.py::TestNoRedundantIndex::test_no_redundant_index` asserts `index_names == ["csv_daily_returns_pkey"]` and WILL FAIL after the ALTER — it must be rewritten in-phase; (2) the CSV-strategy reader's pagination relies on the `(strategy_id, date)` uniqueness for stable page boundaries (analytics_runner.py:1976-1978), so that uniqueness must survive the PK→unique-index conversion (it does, by design). Postgres prod is PG17 (`supabase/config.toml:36 major_version = 17`); the NULLs-distinct behavior the plan depends on is the default across all PG versions.

**Primary recommendation:** Ship ONE migration (`20260624…`) that ALTERs `csv_daily_returns` (surrogate PK, nullable strategy_id, api_key_id + allocator_id, XOR + per-key integrity checks, two non-partial unique indexes, new owner RLS policy) AND adds the api_key-scoped `derive_broker_dailies` arm to `compute_jobs_kind_target_coherence`. Generalize `run_derive_broker_dailies_job` to dual-mode reusing `_allocator_key_preflight`. Add a `phase35_backfill_*` enqueue script keyed on active connected api_keys. Rewrite the index-pin test. No new queue infrastructure is required.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-key dailies storage + tenant isolation | Database / Storage (Supabase PG17) | — | Schema + RLS are the source of truth; the "dark store" is written here, read nowhere yet. |
| Dual-mode derive (realized+funding → dailies) | API / Backend (FastAPI worker on Railway) | Database (service-role upsert) | The worker fetches exchange history, computes the series, and writes via SUPABASE_SERVICE_KEY (bypasses RLS). |
| Key-scoped job enqueue + dedup/fencing | Database (SECDEF RPCs + partial unique index) | API / Backend (cron/sync epilogue caller) | `enqueue_compute_job` is a SECDEF RPC; idempotency/fencing live in the DB layer (already built for api_key scope). |
| Backfill orchestration | API / Backend (one-off Python script via `railway ssh`) | Database (atomic bulk INSERT) | Operator-run enqueue, mirrors `phase12_backfill_enqueue.py`. |
| Reading per-key stats into Overview | (OUT OF SCOPE — Phase 36) | — | Store is "dark" until Phase 36 repoints `queries.ts`. |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md:** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing Next.js code. *Phase 35 ships ZERO Next.js code* (DB migration + Python worker + Python backfill script only), so this constraint is not triggered. The minimal ongoing auto-enqueue (Claude's Discretion) — if wired — should reuse the existing SECDEF RPC `enqueue_compute_job`, not a new route.
- **Test coverage gate (TS):** lines 82 / statements 80 / functions 74 / branches 72 in `vitest.config.ts`. Phase 35 touches no TS source, so the TS gate is a non-event unless the planner wires a TS-side auto-enqueue (avoid).
- **Python coverage gate:** `--cov-fail-under=80` in `analytics-service` CI. New worker branches + backfill script need tests to hold the line.
- **DESIGN.md:** read before any UI/visual decision. Phase 35 has no UI surface — not triggered.
- **Migration-reviewer + rls-policy-auditor agents WILL review the migration** (Specific Ideas in CONTEXT). Design to pass: SECDEF hardening, two-layer auth gate, BYPASSRLS-aware, 23502/23505 timebombs, NUMERIC vs INTEGER, backdated guard, self-verifying DO block.
- **Global CLAUDE.md Rule 3 (surgical) / Rule 6 (root-cause) / Rule 12 (fail loud):** the strategy path must be byte-unchanged; the backfill must exit non-zero on any skip (mirror phase12).

## Standard Stack

This phase uses ONLY the project's existing stack — no new dependencies.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase Postgres | 17 (`config.toml major_version=17`) | Schema, RLS, SECDEF RPCs, the compute_jobs queue | The project's single source of truth; prod ref `khslejtfbuezsmvmtsdn`. |
| supabase-py | 2.15.1 (CI/prod pin) | Worker DB client (`get_supabase()` → SUPABASE_SERVICE_KEY) | Already the worker DB layer; service-role bypasses RLS. [CITED: CLAUDE.md memory B-mypy local venv drift] |
| pandas | (existing in analytics-service) | `combine_realized_and_funding`, gap-fill calendar | Already drives broker_dailies. |
| pytest + psycopg | (existing) | Unit tests + live two-actor RLS tests | `test_persist_csv_daily_returns_live.py` precedent. |

**No `npm install` / `pip install` required.** This phase adds zero packages.

## Package Legitimacy Audit

> Not applicable — Phase 35 installs NO external packages. All work uses libraries already present in the repo (`supabase-py`, `pandas`, `pytest`, `psycopg`). Skipping slopcheck per protocol (no new dependencies).

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────────┐
   BACKFILL (one-off)  │ scripts/phase35_backfill_*.py (railway ssh)  │
   operator-run        │  SELECT active api_keys (is_active,          │
                       │   sync_status != revoked, disconnected NULL) │
                       │  → atomic bulk INSERT compute_jobs rows       │
                       │     (kind=derive_broker_dailies, api_key_id)  │
                       └───────────────────────┬─────────────────────┘
                                               │ (also: ongoing — cron/sync
                                               │  epilogue may enqueue, optional)
                                               ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ compute_jobs  (EXISTING queue — api_key_id column already present) │
   │  pending → claim_compute_jobs (SKIP LOCKED) → running              │
   │  partial unique: one in-flight per (api_key_id, kind)              │
   └───────────────────────────────┬──────────────────────────────────┘
                                    │ Railway worker tick claims
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ run_derive_broker_dailies_job  (GENERALIZED dual-mode)            │
   │                                                                    │
   │   job has api_key_id? ──yes──► _allocator_key_preflight (EXISTS)   │
   │        │                         load api_key, breaker, decrypt    │
   │        │                                                           │
   │        └─no (strategy_id)──► _exchange_preflight (UNCHANGED)       │
   │                                                                    │
   │   fetch_account_equity_usd ─┐                                      │
   │   fetch_all_trades          ├─► combine_realized_and_funding       │
   │   fetch_funding_{venue}     ┘    (strategy_id arg = label only)    │
   │                                  → dense ~365-row daily series      │
   │                                                                    │
   │   key-mode: upsert {api_key_id, allocator_id, strategy_id:NULL,    │
   │             date, daily_return} on_conflict="api_key_id,date"      │
   │             → DONE  (NO compute_analytics_from_csv enqueue)        │
   │   strategy-mode: upsert on_conflict="strategy_id,date"             │
   │             → enqueue compute_analytics_from_csv  (UNCHANGED)      │
   └───────────────────────────────┬──────────────────────────────────┘
                                    │ service-role write (bypasses RLS)
                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ csv_daily_returns  (ALTERED — dual-axis)                          │
   │  surrogate PK; strategy_id NULLABLE; api_key_id; allocator_id      │
   │  XOR(strategy_id, api_key_id); CHECK(api_key_id⇒allocator_id)      │
   │  UNIQUE(strategy_id,date)  UNIQUE(api_key_id,date)  [non-partial]  │
   │  RLS: owner-by-strategy ∪ owner-by-allocator_id ∪ admin ∪ service  │
   └──────────────────────────────────────────────────────────────────┘
        ▲                                            ▲
        │ strategy rows (UNCHANGED reader)           │ per-key rows = DARK
   run_csv_strategy_analytics                        (read nowhere until Phase 36)
   .select("date,daily_return").eq("strategy_id",…)
```

### Component Responsibilities

| File | Responsibility | Change in Phase 35 |
|------|----------------|--------------------|
| `supabase/migrations/20260624…_per_key_dailies.sql` | ALTER `csv_daily_returns` + add `derive_broker_dailies` api_key arm to coherence CHECK + new RLS policy + self-verifying DO block | NEW |
| `analytics-service/services/job_worker.py:1716 run_derive_broker_dailies_job` | Dual-mode branch (key vs strategy) | EDIT |
| `analytics-service/services/job_worker.py:727 _allocator_key_preflight` | Direct api_key load, no strategy | REUSE (no change) |
| `analytics-service/scripts/phase35_backfill_*.py` | Enqueue derive job per active key | NEW (mirror phase12) |
| `analytics-service/tests/test_persist_csv_daily_returns_live.py::TestNoRedundantIndex` | Index-inventory pin | MUST REWRITE (will fail) |
| `analytics-service/services/analytics_runner.py:1980 run_csv_strategy_analytics` | CSV-strategy reader | UNCHANGED (prove unaffected) |

### Pattern 1: ALTER a PK table to dual-axis without breaking the bare `on_conflict` upsert
**What:** Drop the composite PK, add a surrogate PK, make one axis nullable, add the second axis, then create TWO **non-partial** unique indexes — one per axis pair.
**When to use:** When an existing table must carry a second mutually-exclusive identity axis and existing code already does `.upsert(on_conflict="strategy_id,date")`.
**Why non-partial is mandatory here:** PostgREST infers `ON CONFLICT (cols)` from the bare `on_conflict` string. A **partial** unique index's predicate is NOT inferable, so `.upsert(on_conflict="strategy_id,date")` against a partial index raises `42P10` ("no matching constraint"). This exact trap is documented in `phase12_backfill_enqueue.py:24-29`. Non-partial unique indexes ARE inferable, and Postgres treats NULLs as DISTINCT by default, so:
- `UNIQUE(strategy_id, date)` admits unlimited per-key rows (all `strategy_id IS NULL`) without collision.
- `UNIQUE(api_key_id, date)` admits unlimited strategy rows (all `api_key_id IS NULL`) without collision.
**Source:** Live DDL `20260522111839_csv_daily_returns.sql` + `phase12_backfill_enqueue.py:24-29` [VERIFIED: codebase].

### Pattern 2: Dual-mode worker handler via preflight selection
**What:** Branch on the job's identity axis at the top of the handler, pick the matching preflight, share the rest.
**Example (existing precedent — `run_poll_allocator_positions_job` uses the key preflight):**
```python
# Source: analytics-service/services/job_worker.py:1912 (VERIFIED)
ctx = await _allocator_key_preflight(job, "run_poll_allocator_positions_job")
if isinstance(ctx, DispatchResult):
    return ctx
# ctx.strategy_row is None on the key path; ctx.key_row + ctx.exchange are populated
```
**Phase 35 application:** at the top of `run_derive_broker_dailies_job`, `if job.get("api_key_id"): ctx = await _allocator_key_preflight(...)` else keep `_exchange_preflight`. The `_ExchangeContext` dataclass already tolerates `strategy_row=None` (job_worker.py:651-653) [VERIFIED: codebase].

### Pattern 3: Idempotent CHECK-constraint extension (strict superset)
**What:** `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` with the prior arms preserved verbatim plus the new arm, then a DO-block superset guard asserting every prior kind still appears in the constraint def.
**Source:** `20260614120000_derive_broker_dailies_kind.sql` (the exact precedent for `derive_broker_dailies`) [VERIFIED: codebase]. Phase 35 reuses this to flip `derive_broker_dailies` from a strategy-only arm to BOTH a strategy arm AND an api_key arm.

### Anti-Patterns to Avoid
- **Creating a new dedicated per-key table.** Explicitly overruled by the user — ALTER `csv_daily_returns`.
- **Using a partial unique index on `(api_key_id, date)` `WHERE api_key_id IS NOT NULL`.** Tempting (it scopes precisely) but it BREAKS the `on_conflict` upsert (42P10) — non-partial is required. The user already specified non-partial; do not "optimize" to partial.
- **Calling `compute_analytics_from_csv` for key-scoped rows.** That path is strategy-keyed and would try to read `csv_daily_returns.eq("strategy_id", NULL)` → garbage. Per-key reads are Phase 36.
- **Writing the key-mode series via `persist_csv_daily_returns` RPC.** That RPC is auth-gated (`auth.uid()` required) and strategy-scoped; the worker has no session and must upsert the table directly via service-role (exactly as the existing strategy path does, job_worker.py:1826).
- **Synthetic strategy rows for keys.** Explicitly the thing DAILIES-01 forbids.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Key-scoped job enqueue | A new `enqueue_*` RPC or a new compute_jobs column | EXISTING `enqueue_compute_job(p_api_key_id := …)` (9-param, mig 066) | api_key_id column, 4-way XOR, in-flight partial unique index, race-safe ON CONFLICT path all already exist. |
| Direct api_key load (no strategy) in the worker | A new preflight | EXISTING `_allocator_key_preflight` (job_worker.py:727) | Loads key, runs circuit breaker, decrypts, builds exchange — already battle-tested by `poll_allocator_positions`. |
| Dense calendar / funding combine | New series math | EXISTING `combine_realized_and_funding` + `gap_fill_daily_returns` (broker_dailies.py) | Already produces the dense ~365-row series; reads only `timestamp`+`amount` from funding rows. |
| Active-key selection predicate | A bespoke filter | EXISTING `is_active=true AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL` | Canonical worker-dispatch filter (equity_reconstruction.py:1489-1491; mig 066 enqueue_poll_allocator_positions_for_all_keys). |
| Idempotent backfill enqueue | A loop of N inserts | EXISTING `phase12_backfill_enqueue.py` shape (pre-check + atomic bulk INSERT + 23505 catch + exit-1) | Race-safe, fail-loud, single-statement atomic abort. |

**Key insight:** Phase 35 is ~80% wiring of already-built infrastructure. The genuinely new artifacts are the `csv_daily_returns` ALTER, the dual-mode branch in one handler, the backfill script, and a rewritten index-pin test. There is no new queue, no new RPC, no new preflight.

## compute_jobs Blocker Analysis (planning_critical_unknown #1 — RESOLVED)

**Verdict: compute_jobs is NOT a second blocker.** Detailed evidence:

| Concern from the brief | Reality (VERIFIED) |
|------------------------|--------------------|
| Is `compute_jobs.strategy_id` NOT NULL? | NO. `strategy_id` is nullable (mig 032 line 108: `strategy_id UUID REFERENCES strategies(id)` — no NOT NULL). The table uses a 4-way target XOR, not a NOT NULL strategy_id. |
| Does the enqueue RPC accept only `p_strategy_id`? | NO. `enqueue_compute_job` has a 9-param signature `(p_strategy_id, p_kind, p_idempotency_key, p_parent_job_ids, p_exchange, p_metadata, p_allocator_id, p_api_key_id, p_run_at)` (mig 066 STEP 6, line 465-475). Three live kinds already enqueue api_key-scoped jobs. |
| Does compute_jobs have an `api_key_id`? | YES (mig 066 STEP 2, line 240-242: `ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE`). And `allocator_id` (added earlier, mig 062 `scoring_weight_overrides`). |
| Uniqueness/fencing for api_key jobs? | `compute_jobs_one_inflight_per_kind_api_key` partial unique index (mig 066 STEP 4) + claim_token fencing (mig `20260515114555`) + `claim_compute_jobs` SKIP LOCKED. All reused as-is. |
| What MUST change for a key-scoped `derive_broker_dailies`? | EXACTLY ONE thing: the `compute_jobs_kind_target_coherence` CHECK currently lists `derive_broker_dailies` in the strategy-scoped arm ONLY (mig `20260614120000` line 78). Add an api_key-scoped arm so a `{kind:'derive_broker_dailies', api_key_id:…}` row passes coherence. ~15-line DROP+ADD swap, strict-superset guard. |

**Recommended minimal approach:** In the same Phase-35 migration, DROP+ADD `compute_jobs_kind_target_coherence` adding ONE arm:
```sql
(kind = 'derive_broker_dailies'
    AND api_key_id IS NOT NULL AND strategy_id IS NULL
    AND portfolio_id IS NULL AND allocator_id IS NULL)
```
…while preserving the EXISTING `derive_broker_dailies` membership in the strategy-scoped IN-list arm (so strategy-mode derive jobs still pass). Net: `derive_broker_dailies` becomes a dual-target kind, exactly like the worker handler becomes dual-mode. Base the DROP+ADD on the LATEST live coherence def (`20260614120000`), preserve every prior arm verbatim, and add a superset guard for `process_key_long`, `compute_analytics_from_csv`, AND `poll_allocator_positions` (the canonical regression tripwires).

> **Migration-reviewer note:** `CREATE OR REPLACE`/`DROP+ADD` of an existing constraint must re-base on the latest migration that defined it (the `b5b` lesson in memory). The latest coherence def is `20260614120000_derive_broker_dailies_kind.sql` lines 69-92 — copy it verbatim and add the one arm.

## `_exchange_preflight` / derive-job refactor surface (planning_critical_unknown #2 — MAPPED)

`run_derive_broker_dailies_job` (job_worker.py:1716-1847). Every `strategy_id` read and what it's used for:

| Line | Use of `strategy_id` | Key-mode substitute |
|------|----------------------|---------------------|
| 1731 `_exchange_preflight(job, …)` | Resolves strategy → api_key, FAILS if `strategy_id` missing (line 668-674) | Branch to `_allocator_key_preflight(job, …)` when `job.get("api_key_id")` is set (loads key directly, line 737). |
| 1735 `strategy_id = job["strategy_id"]` | Local var | `api_key_id = ctx.key_row["id"]`; `allocator_id = ctx.key_row["user_id"]`. |
| 1755/1757/1759 `fetch_funding_{venue}(ctx.exchange, strategy_id, None)` | **Label/log/match-key ONLY** — builds `match_key=f"{strategy_id}:{exchange}:{symbol}:…"` (funding_fetch.py:252), sets `FundingFeeRow.strategy_id`, appears in log lines. Does NOT scope the exchange API call (fetch pulls the WHOLE account from `ctx.exchange`). And `combine_realized_and_funding` reads ONLY `timestamp`+`amount` from funding rows (broker_dailies.py:83-90). | Pass `api_key_id` (or a stable synthetic label) as the funding label. Since the derive job does NOT persist `funding_fees` (see below), the match_key value is non-load-bearing — it only affects in-memory dedup within the funding stream, which is keyed per-(label, exchange, symbol, ts). Passing `api_key_id` is safe and clean. |
| 1791-1803 `strategy_analytics.upsert({strategy_id, computation_status:'failed', …})` | Strategy-keyed insufficient-history stamp | **SKIP in key-mode.** There is no per-key analytics row to stamp (per-key reads are Phase 36). Return `DONE` (or a benign `DONE`/`FAILED` with a log) without touching `strategy_analytics`. |
| 1813-1820 `rows_payload = [{strategy_id, date, daily_return}, …]` | The upsert payload | Key-mode payload: `{api_key_id, allocator_id, strategy_id: None, date, daily_return}`. |
| 1827-1829 `.upsert(batch, on_conflict="strategy_id,date")` | Idempotent strategy upsert | Key-mode: `on_conflict="api_key_id,date"`. |
| 1840-1844 `enqueue_compute_job(p_strategy_id, 'compute_analytics_from_csv')` | Hand off to CSV factsheet compile | **SKIP in key-mode** (strategy-keyed path). |

**Funding-fetch persistence check (CRITICAL — verified):** `run_derive_broker_dailies_job` does NOT call `upsert_funding_rows`/`persist_funding_fees`. The funding fetch returns rows in-memory only; persistence to `funding_fees` (which has a strategy-keyed `match_key`) is done by `run_sync_funding_job`, a different handler. So the `funding_fees` table is NOT touched by the derive job and is NOT a key-mode blocker. [VERIFIED: codebase — grep of derive-job body shows only `strategy_analytics` + `csv_daily_returns` upserts].

**`_ExchangeContext` already supports key-mode:** dataclass field `strategy_row: dict | None` with the comment "strategy_row is None on the allocator path" (job_worker.py:651-653). No dataclass change needed.

**Dispatch routing (job_worker.py:2874-2876):** `elif kind == "derive_broker_dailies": handler = run_derive_broker_dailies_job` — UNCHANGED. The handler internally branches on the job's identity axis.

## Existing `csv_daily_returns` RLS DDL (planning_critical_unknown #3 — exact statements)

From `20260522111839_csv_daily_returns.sql` (RLS enabled at line 56, three policies). Quote the live statements the plan must EXTEND (not replace):

```sql
-- (line 56) RLS enabled; FORCE is NOT set (default — table owner / service-role bypass via role, not FORCE)
ALTER TABLE public.csv_daily_returns ENABLE ROW LEVEL SECURITY;

-- service_role_all (KEEP verbatim)
CREATE POLICY csv_daily_returns_service_role_all ON public.csv_daily_returns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- owner_select via STRATEGY ownership (KEEP — per-key rows have strategy_id NULL so they won't match it)
CREATE POLICY csv_daily_returns_owner_select ON public.csv_daily_returns
  FOR SELECT TO authenticated
  USING ( strategy_id IN (SELECT id FROM public.strategies WHERE user_id = auth.uid()) );

-- admin_select via profiles.is_admin (KEEP verbatim)
CREATE POLICY csv_daily_returns_admin_select ON public.csv_daily_returns
  FOR SELECT TO authenticated
  USING ( EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true) );
```

**ADD (the new per-key owner policy)** — mirror `allocator_holdings_owner_select` (mig 066 line 706):
```sql
CREATE POLICY csv_daily_returns_allocator_owner_select ON public.csv_daily_returns
  FOR SELECT TO authenticated
  USING ( allocator_id = auth.uid() );
```

Notes for the planner:
- **Two distinct owner mechanisms coexist:** strategy rows are scoped via `strategy_id IN (… strategies WHERE user_id = auth.uid())`; per-key rows via `allocator_id = auth.uid()`. A SELECT policy set is a UNION — an authenticated user sees a row if ANY policy matches. The strategy policy never matches a per-key row (strategy_id NULL ⇒ `NULL IN (…)` ⇒ NULL ⇒ not true), and the allocator policy never matches a strategy row (allocator_id NULL ⇒ `NULL = auth.uid()` ⇒ NULL ⇒ not true). Clean separation; no weakening.
- **Admin pattern divergence (flag for the reviewer):** `csv_daily_returns` admin policy uses inline `profiles.is_admin` EXISTS, whereas `allocator_holdings` uses `current_user_has_app_role(ARRAY['admin'])` (mig 066 line 711). KEEP the existing `csv_daily_returns` inline-`is_admin` admin policy (Rule 3 surgical; don't refactor an unrelated policy). Both are valid; do not "unify."
- **No INSERT/UPDATE/DELETE policy for authenticated** — worker writes via service-role (SUPABASE_SERVICE_KEY bypasses RLS). Preserve this (the existing comment at mig line 92-95).
- **RLS FORCE:** not set on this table (the migration only `ENABLE`s RLS). The service-role + definer-RPC writes rely on role-bypass, not on absence of FORCE; do not add FORCE (it would break the worker's service-role writes unless an explicit service-role policy WITH CHECK exists — there is one, so FORCE *could* be added, but it's out of scope and the reviewer prefers surgical).

## on_conflict + non-partial unique index proof (planning_critical_unknown #4)

- **Live Postgres version:** **17** (`supabase/config.toml:36 major_version = 17`). [VERIFIED: codebase]
- **NULLs-distinct:** Postgres treats NULLs as DISTINCT in a unique index **by default** on ALL versions (this is standard SQL `UNIQUE` semantics, unrelated to the PG15+ `NULLS NOT DISTINCT` opt-in clause). So after the ALTER:
  - Many per-key rows (`strategy_id IS NULL`) coexist under `UNIQUE(strategy_id, date)` without collision.
  - Many strategy rows (`api_key_id IS NULL`) coexist under `UNIQUE(api_key_id, date)` without collision.
  - The plan must NOT use `NULLS NOT DISTINCT` — it relies on the DEFAULT distinct behavior. [VERIFIED: PG docs semantics + codebase intent]
- **on_conflict inference:** PostgREST `.upsert(batch, on_conflict="strategy_id,date")` emits SQL `ON CONFLICT (strategy_id, date)`. Postgres matches this to a **non-partial** unique index on exactly `(strategy_id, date)`. A partial index would NOT match (42P10) — documented in `phase12_backfill_enqueue.py:24-29`. The user's non-partial choice is therefore load-bearing for keeping the EXISTING strategy upsert working AND for the NEW key upsert (`on_conflict="api_key_id,date"`). [VERIFIED: codebase + PostgREST/PG conflict-arbiter rules]
- **Safest DDL ordering** (single transaction, `SET lock_timeout='3s'`):
  1. `ALTER TABLE … DROP CONSTRAINT csv_daily_returns_pkey;` (PK drop — also drops the implicit PK index).
  2. `ALTER TABLE … ALTER COLUMN strategy_id DROP NOT NULL;`
  3. `ALTER TABLE … ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY;` then `ADD CONSTRAINT csv_daily_returns_pkey PRIMARY KEY (id);` (surrogate PK — recommend BIGINT identity over UUID: smaller, append-friendly, no random-UUID index bloat, and the table is service-role-written so no client needs to predict ids).
  4. `ADD COLUMN api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE;`
  5. `ADD COLUMN allocator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;`
  6. `ADD CONSTRAINT csv_daily_returns_axis_xor CHECK (num_nonnulls(strategy_id, api_key_id) = 1);`
  7. `ADD CONSTRAINT csv_daily_returns_perkey_allocator CHECK (api_key_id IS NULL OR allocator_id IS NOT NULL);`
  8. `CREATE UNIQUE INDEX csv_daily_returns_strategy_date_key ON … (strategy_id, date);` (RECREATES the `(strategy_id, date)` uniqueness the dropped PK provided — REQUIRED so the strategy upsert's `on_conflict` still has an arbiter AND the paginated reader's stable page boundaries survive).
  9. `CREATE UNIQUE INDEX csv_daily_returns_api_key_date_key ON … (api_key_id, date);`
  - **Existing-data safety:** all current rows have `strategy_id` set and `api_key_id`/`allocator_id` NULL, so the XOR (`num_nonnulls=1`) and the per-key check (`api_key_id IS NULL ⇒ true`) both pass for every legacy row — no 23514 on ALTER. Confirm in the DO-block.
  - **23505 risk on index build:** none — the new unique indexes are over the same/disjoint column space the data already satisfies.

## Latest APPLIED prod migration timestamp (planning_critical_unknown #5)

- **Prod project ref:** `khslejtfbuezsmvmtsdn` (confirmed: `.env.local NEXT_PUBLIC_SUPABASE_URL=https://khslejtfbuezsmvmtsdn.supabase.co` + `supabase/.temp/project-ref`). [VERIFIED: codebase]
- **Test project ref:** `qmnijlgmdhviwzwfyzlc` (for `apply_migration` during execution). [CITED: CLAUDE.md memory]
- **Latest LOCAL migration (= source of truth via `db push --include-all`):** `20260622120000_scenario_shares_and_read_rpc.sql`. Phase 34 shipped Python-only (no migration), so the prod tip should equal this. [VERIFIED: codebase — `ls supabase/migrations | tail`]
- **Backdate guard mechanics:** `.github/workflows/migration-policy.yml` queries `SELECT MAX(version) FROM supabase_migrations.schema_migrations` on the linked prod project at PR time and fails if any newly-added migration's 14-digit prefix `< REMOTE_TIP` (and not allowlisted). [VERIFIED: codebase, lines 244-277]
- **Recommended new timestamp:** `20260624HHMMSS` (today). Any `20260624…` sorts strictly after `20260622120000` regardless of the exact HHMMSS, so it passes the guard.
- **Planner action (belt-and-suspenders):** before finalizing the filename, confirm the prod tip via Supabase MCP `list_migrations` against `khslejtfbuezsmvmtsdn` (read-only). If an out-of-band migration newer than `20260622120000` was applied, bump the new timestamp above it. (I could not reach the Management API from this sandbox — the CLI token isn't shell-exposable — so this MCP confirmation is deferred to plan/execution time. Default `20260624…` is safe given `include-all` source-of-truth semantics.)

## Allocator exchange keys for backfill (planning_critical_unknown #6)

- **There is NO dedicated "allocator key" type on `api_keys`.** `api_keys` schema (`20260405061911_initial_schema.sql:19-32`): `id, user_id NOT NULL FK→profiles, exchange CHECK IN (binance,okx,bybit), is_active, sync_status, last_429_at, disconnected_at, …`. The OWNER (`user_id`) is the allocator; the owner's `profiles.role` is one of `manager|allocator|both` (initial_schema.sql:12). [VERIFIED: codebase]
- **`exchange IN (binance,okx,bybit)` is automatically satisfied** — the column CHECK constrains every api_key to those three crypto venues. So "allocator exchange keys" = "all api_keys" by exchange; no IN-filter needed beyond the CHECK (though an explicit `.in_("exchange", [...])` is harmless defense-in-depth).
- **Canonical active-key predicate to backfill (RECOMMENDED):** mirror the worker-dispatch filter used by `enqueue_poll_allocator_positions_for_all_keys` and the equity-reconstruction sibling check:
  ```
  is_active = true
  AND sync_status IS DISTINCT FROM 'revoked'
  AND disconnected_at IS NULL
  ```
  [VERIFIED: equity_reconstruction.py:1489-1491 + mig 066 line 637-638]
- **Important nuance for the planner:** this predicate targets EVERY active connected api_key — including keys owned by strategy-managers (role='manager') who have a strategy linked. A strategy-manager's key ALSO gets a per-key dailies series. That is acceptable for Phase 35 (the store is dark; per-key rows for any key are valid), but flag it: if the product intent is "allocator keys only," add `AND user_id IN (SELECT id FROM profiles WHERE role IN ('allocator','both'))`. **Recommendation:** do NOT add the role filter — the per-key axis is key-identity, not role-identity, and Phase 36/37 will read per-key series for any key an allocator owns. Keeping the predicate role-agnostic matches the existing api_key-scoped job fan-outs (which are also role-agnostic). Surface this as an Assumption (A1) for user confirmation.
- **Backfill = re-derive from the exchange API** (no existing per-key data to copy); the enqueued derive job does the fetch. Idempotent via the `(api_key_id, kind)` in-flight partial unique index + the `(api_key_id, date)` upsert.

## CSV-strategy regression surface (planning_critical_unknown #7)

**What reads `csv_daily_returns` by strategy_id today:**
- **`run_csv_strategy_analytics`** (analytics_runner.py:1980-1987): `.select("date, daily_return").eq("strategy_id", strategy_id)` with paginated order-by `(date asc)`. This is the ONLY production reader. It explicitly filters `strategy_id = <uuid>`, so per-key rows (`strategy_id IS NULL`) are invisible to it. **UNAFFECTED.** [VERIFIED]
- **`persist_csv_daily_returns` RPC** (mig `20260522111839` STEP 3): writes strategy rows via `ON CONFLICT (strategy_id, date)`. After the ALTER, `(strategy_id, date)` is a non-partial UNIQUE index (recreated in DDL step 8), so the RPC's `ON CONFLICT (strategy_id, date)` still resolves. The RPC body is byte-unchanged. **UNAFFECTED** — but the planner MUST verify the recreated unique index name/columns match what `ON CONFLICT (strategy_id, date)` needs (the constraint inference keys on columns, not name, so any name works). [VERIFIED]
- **No SQL views, triggers, or other functions over `csv_daily_returns`** (grep of `supabase/migrations` shows only the create migration + two kind-check migrations reference the name; no `CREATE VIEW`/`CREATE TRIGGER` on it). **UNAFFECTED.** [VERIFIED]

**Subtle correctness note (MUST encode in the plan):** `run_csv_strategy_analytics` paginates with the comment (analytics_runner.py:1976-1978) that the `(date asc)` order-by relies on the `(strategy_id, date) UNIQUE index` for stable page boundaries. Converting the PK to a non-partial unique index on the SAME columns preserves this. Do NOT drop the `(strategy_id, date)` uniqueness — it is load-bearing for both the upsert arbiter and the paginated read.

**The one test that WILL break:** `analytics-service/tests/test_persist_csv_daily_returns_live.py::TestNoRedundantIndex::test_no_redundant_index` asserts `index_names == ["csv_daily_returns_pkey"]` (line 654). After the ALTER the table has: the surrogate PK index + `csv_daily_returns_strategy_date_key` + `csv_daily_returns_api_key_date_key` + the FK-supporting indexes Postgres auto-creates for the new FK columns? (Postgres does NOT auto-index FK columns, so only the explicit indexes appear). This test MUST be rewritten to assert the NEW expected index set. [VERIFIED]

## Runtime State Inventory

> Phase 35 is a schema-extension + dark-write phase (no rename). This inventory covers the runtime-state surfaces a reviewer would otherwise miss.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `csv_daily_returns` existing strategy rows (all `strategy_id` set, `api_key_id`/`allocator_id` NULL) | Verify the new XOR + per-key CHECK pass for ALL legacy rows on ALTER (they do: `num_nonnulls(strategy_id,NULL)=1`; `api_key_id IS NULL ⇒ check true`). DO-block assertion. |
| Live service config | `pg_cron` jobs that enqueue jobs (e.g. `poll-allocator-positions` @04:00 UTC) | None changed. The OPTIONAL ongoing auto-enqueue of `derive_broker_dailies` (Claude's Discretion) would either add a cron arm OR ride the existing sync epilogue. Recommend deferring richness; backfill covers existing keys. |
| OS-registered state | None — no Task Scheduler / launchd / pm2 surfaces in this phase | None — verified by scope (DB + Python worker only). |
| Secrets/env vars | `SUPABASE_SERVICE_KEY` (worker write path), `BROKER_DAILIES_VIA_FUNDING` kill-switch (job_worker.py:177) | None renamed. Key-mode derive should honor the SAME kill-switch posture as strategy-mode (it's default-ON). |
| Build artifacts | None — no package rename, no egg-info | None — verified. |

## Common Pitfalls

### Pitfall 1: Using a partial unique index on `(api_key_id, date)` to "scope precisely"
**What goes wrong:** `.upsert(on_conflict="api_key_id,date")` raises `42P10` (no matching constraint) because a partial index predicate isn't inferable from a bare `on_conflict`.
**Why it happens:** It feels cleaner to write `WHERE api_key_id IS NOT NULL`.
**How to avoid:** Non-partial unique indexes only (the user already specified this). NULLs-distinct does the scoping for free.
**Warning signs:** A 42P10 in the worker's upsert, or in the backfill.

### Pitfall 2: Passing `strategy_id` to the funding fetch in key-mode and breaking match-key dedup
**What goes wrong:** In key-mode there is no `strategy_id`; passing `None` or `""` could collapse match-keys across keys if the funding stream were persisted.
**Why it happens:** The funding fetch signature requires a `strategy_id: str`.
**How to avoid:** Pass `api_key_id` (a stable, key-unique string) as the funding label in key-mode. The derive job does NOT persist `funding_fees`, so match_key only affects in-memory per-stream dedup — but using `api_key_id` keeps it correct and non-colliding regardless.
**Warning signs:** Funding rows deduped across keys (would only matter if a future change persists them).

### Pitfall 3: Forgetting to recreate the `(strategy_id, date)` uniqueness after dropping the PK
**What goes wrong:** The strategy `on_conflict="strategy_id,date"` upsert silently inserts duplicates (no arbiter) OR raises 42P10; the paginated reader's page boundaries become unstable.
**Why it happens:** Dropping the composite PK also drops its implicit unique index; it's easy to add only the surrogate PK and the api_key index and forget the strategy index.
**How to avoid:** Explicitly `CREATE UNIQUE INDEX csv_daily_returns_strategy_date_key ON … (strategy_id, date)`. Assert its presence in the DO-block.
**Warning signs:** Duplicate strategy daily rows; `test_persist_csv_daily_returns_live` upsert-idempotency tests fail.

### Pitfall 4: Key-mode derive enqueues `compute_analytics_from_csv`
**What goes wrong:** That handler reads `csv_daily_returns.eq("strategy_id", NULL)` → empty/garbage; pollutes `strategy_analytics`.
**Why it happens:** Copy-paste from the strategy path (job_worker.py:1840-1844).
**How to avoid:** Gate the enqueue + the `strategy_analytics` insufficient-history stamp behind `if not is_key_mode`.
**Warning signs:** Stray `compute_analytics_from_csv` jobs with NULL-strategy targets failing coherence/preflight.

### Pitfall 5: Backdated migration timestamp
**What goes wrong:** The `migration-policy.yml` PR guard fails (or, worse, `db push` collides) if the new timestamp `< 20260622120000`.
**How to avoid:** Use `20260624…`; confirm prod tip via MCP `list_migrations` at plan time.
**Warning signs:** Red `Migration Policy` check on the PR.

### Pitfall 6: `migration-reviewer` rejects the constraint swap for not re-basing on the latest def
**What goes wrong:** A `DROP+ADD compute_jobs_kind_target_coherence` based on an OLD def silently drops a prior arm (e.g. `process_key_long`).
**How to avoid:** Copy the EXACT def from `20260614120000_derive_broker_dailies_kind.sql` (lines 69-92), add ONE arm, keep the strict-superset DO-block guard.
**Warning signs:** The DO-block's `position('process_key_long' IN v_coherence_clause)=0` guard raises at apply time.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `csv_daily_returns` is strategy-only (`PRIMARY KEY (strategy_id, date)`) | Dual-axis (strategy OR api_key) via surrogate PK + XOR + two non-partial unique indexes | Phase 35 (this) | Per-key dailies share the CSV compute path; no synthetic strategies. |
| `derive_broker_dailies` is strategy-scoped only | Dual-target kind (strategy OR api_key) | Phase 35 (this) | Reuses the existing api_key job machinery. |
| Allocator stats reconstructed from blended `allocator_equity_snapshots` | (Phase 36) read per-key dailies | Phase 36 (next) | Out of scope here; store is dark until then. |

**Deprecated/outdated:** none introduced. The existing strategy path is byte-preserved.

## Code Examples

### Dual-mode handler entry (the new branch)
```python
# Source: pattern from job_worker.py:1912 (_allocator_key_preflight) + 1731 (_exchange_preflight) [VERIFIED]
is_key_mode = bool(job.get("api_key_id"))
if is_key_mode:
    ctx = await _allocator_key_preflight(job, "run_derive_broker_dailies_job")
else:
    ctx = await _exchange_preflight(job, "run_derive_broker_dailies_job")
if isinstance(ctx, DispatchResult):
    return ctx

if is_key_mode:
    api_key_id = ctx.key_row["id"]
    allocator_id = ctx.key_row["user_id"]
    funding_label = api_key_id          # label/log only — never scopes the fetch
else:
    strategy_id = job["strategy_id"]
    funding_label = strategy_id
venue = ctx.key_row["exchange"]
```

### Key-mode upsert payload + conflict target
```python
# Source: adapted from job_worker.py:1813-1831 (strategy path) [VERIFIED]
if is_key_mode:
    rows_payload = [
        {"api_key_id": api_key_id, "allocator_id": allocator_id,
         "strategy_id": None, "date": ts.date().isoformat(),
         "daily_return": float(val)}
        for ts, val in returns.items()
    ]
    conflict = "api_key_id,date"
else:
    rows_payload = [
        {"strategy_id": strategy_id, "date": ts.date().isoformat(),
         "daily_return": float(val)}
        for ts, val in returns.items()
    ]
    conflict = "strategy_id,date"
# … chunked 1000-row .upsert(batch, on_conflict=conflict) …
# key-mode: NO compute_analytics_from_csv enqueue; NO strategy_analytics stamp.
```

### compute_jobs coherence CHECK — the one new arm
```sql
-- Source: extend 20260614120000_derive_broker_dailies_kind.sql lines 69-92 verbatim, adding:
(kind = 'derive_broker_dailies'
    AND api_key_id IS NOT NULL AND strategy_id IS NULL
    AND portfolio_id IS NULL AND allocator_id IS NULL)
-- AND keep 'derive_broker_dailies' in the existing strategy-scoped IN(...) arm.
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (Python worker/DB) | pytest (config: `analytics-service/pytest.ini`, `testpaths = tests`) |
| Live DB tests | psycopg against the TEST Supabase DSN (skip-gated); precedent `test_persist_csv_daily_returns_live.py`, `test_legacy_table_rls.py` |
| Quick run command | `cd analytics-service && pytest tests/test_broker_dailies.py -x` (unit) |
| Full suite command | `cd analytics-service && make test` (pytest + `--cov-fail-under=80`) |
| Migration apply (TEST) | Supabase MCP `apply_migration` against `qmnijlgmdhviwzwfyzlc` (prod auto-applies on merge) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DAILIES-04 | Allocator A cannot SELECT allocator B's per-key rows (authenticated probe, NOT service-role) | live RLS (two-actor) | `pytest tests/test_csv_daily_returns_perkey_rls_live.py -x` | ❌ Wave 0 (new; copy `_set_authenticated`/`_create_test_user` harness from `test_persist_csv_daily_returns_live.py`) |
| DAILIES-01 | NULLs-distinct: 2 per-key rows (same date, diff api_key) coexist; 2 strategy rows (same date, diff strategy) coexist; XOR rejects both-null/both-set | live DDL | `pytest tests/test_csv_daily_returns_dualaxis_live.py -x` | ❌ Wave 0 (new) |
| DAILIES-01 | Strategy path unaffected: existing `persist_csv_daily_returns` upsert idempotency + `run_csv_strategy_analytics` reader still green | live + unit | existing `test_persist_csv_daily_returns_live.py` (rewrite `TestNoRedundantIndex`) | ✅ exists / ❌ index test rewrite |
| DAILIES-02 | Dual-mode derive: key-mode upserts `api_key_id`-keyed rows, sets `allocator_id`, skips CSV enqueue + strategy_analytics; strategy-mode unchanged | unit (mocked supabase + fetchers) | `pytest tests/test_derive_broker_dailies_dualmode.py -x` | ❌ Wave 0 (new; extend `test_broker_dailies.py` patterns) |
| DAILIES-02 | `derive_broker_dailies` admitted by `compute_jobs_kind_target_coherence` in BOTH the strategy arm AND the new api_key arm; prior arms preserved | migration DO-block + live | self-verifying DO block in the migration (apply asserts) | ❌ in-migration |
| DAILIES-03 | Backfill enqueues one `derive_broker_dailies` (api_key_id) per active key; idempotent (re-run = 0 / 23505-safe); exit non-zero on skip | unit (mocked supabase) | `pytest tests/test_phase35_backfill_enqueue.py -x` | ❌ Wave 0 (new; mirror any existing backfill test for phase12) |

### Sampling Rate
- **Per task commit:** `pytest tests/test_broker_dailies.py tests/test_derive_broker_dailies_dualmode.py -x` (fast unit).
- **Per wave merge:** `make test` (full Python suite + coverage gate); migration applied to TEST project via MCP, live RLS + dual-axis tests run against TEST DSN.
- **Phase gate:** Full suite green + migration-reviewer + rls-policy-auditor pass before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_csv_daily_returns_perkey_rls_live.py` — DAILIES-04 two-actor cross-tenant RLS (assert on row CONTENT/id, not just error code — RLS fails silently to empty rows).
- [ ] `tests/test_csv_daily_returns_dualaxis_live.py` — DAILIES-01 NULLs-distinct + XOR + per-key-allocator CHECK + `(strategy_id,date)` & `(api_key_id,date)` uniqueness.
- [ ] `tests/test_derive_broker_dailies_dualmode.py` — DAILIES-02 key-mode vs strategy-mode branch (payload shape, conflict target, no-CSV-enqueue, allocator_id wiring).
- [ ] `tests/test_phase35_backfill_enqueue.py` — DAILIES-03 enqueue predicate + idempotency + exit code.
- [ ] **Rewrite** `tests/test_persist_csv_daily_returns_live.py::TestNoRedundantIndex` to assert the NEW post-ALTER index inventory (surrogate PK + 2 unique indexes), not `["csv_daily_returns_pkey"]`.
- [ ] Self-verifying DO block in the migration (table assertions + 4 RLS policies + both unique indexes + XOR/per-key CHECK + coherence superset guard + legacy-row CHECK-pass probe).

## Security Domain

> `security_enforcement` not set to false in config — included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added (worker uses service-role; no new authenticated route). |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | RLS tenant isolation: per-key rows scoped to `allocator_id = auth.uid()`; cross-tenant read proven by a two-actor authenticated live test (RLS fails silently → assert on content, not error code). Mirrors PR #477 / Phase 25 RLS-leak discipline. |
| V5 Input Validation | yes (DB layer) | XOR + per-key-allocator CHECK constraints reject malformed rows at write time; coherence CHECK rejects miswired jobs. |
| V6 Cryptography | no (reuse) | Exchange credential decrypt reuses `decrypt_credentials` + KEK (no new crypto). |

### Known Threat Patterns for {Supabase RLS + service-role worker}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read of another allocator's per-key series | Information Disclosure | `allocator_id = auth.uid()` SELECT policy + two-actor live test asserting B sees zero of A's rows (content-level, not error-code). |
| Owner fork: `api_keys.user_id` reassigned while denormalized `allocator_id` stays stale | Tampering | The derive job sets `allocator_id = api_keys.user_id` at write time; if richer coupling is wanted, mirror `allocator_holdings`'s owner-coherence trigger — BUT that's gold-plating for a dark store; recommend NOT adding the trigger (Rule 2) and instead deriving `allocator_id` fresh on every re-derive. Flag as Assumption A2. |
| Service-role write bypassing RLS writes wrong allocator_id | Tampering | Worker reads `allocator_id` from `ctx.key_row["user_id"]` (authoritative), never from job payload. |
| Probe-oracle (enumerate which api_key_ids exist via error distinction) | Information Disclosure | Backfill/enqueue go through existing SECDEF `enqueue_compute_job` ownership gate; no new authenticated RPC introduced. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase prod (`khslejtfbuezsmvmtsdn`) | migration apply | ✓ (via Supabase Migrate on merge) | PG17 | — |
| Supabase TEST (`qmnijlgmdhviwzwfyzlc`) | MCP `apply_migration` for execution-time testing | ✓ | PG17 | — |
| Railway worker | run the dual-mode derive job + `railway ssh` backfill | ✓ | — | — |
| Exchange APIs (binance/okx/bybit) | derive fetches realized+funding | ✓ (read keys) | — | per-key job marks insufficient-history on <2 days |
| Supabase Management API (from THIS sandbox) | confirm prod migration tip from bash | ✗ | — | Use Supabase MCP `list_migrations` at plan time; default `20260624…` is safe given include-all semantics |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Management-API-from-bash (use MCP tool instead — non-blocking).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Backfill targets ALL active connected api_keys (role-agnostic: manager + allocator + both), since the per-key axis is key-identity not role-identity and existing api_key job fan-outs are role-agnostic | Allocator keys for backfill (#6) | If product intent is "allocator-role keys only," add `AND user_id IN (SELECT id FROM profiles WHERE role IN ('allocator','both'))`. Low risk: extra per-key rows are harmless in a dark store; Phase 36 reads per-key by key ownership regardless. |
| A2 | Derive `allocator_id` fresh from `api_keys.user_id` on every write; do NOT add an owner-coherence trigger (vs `allocator_holdings`) | Security Domain | If a key's `user_id` is reassigned between writes, old rows keep the old allocator_id until re-derived. Low risk for a dark store; the `ON DELETE CASCADE` on both FKs cleans up on key/user deletion. |
| A3 | Prod migration tip = `20260622120000` (Phase 34 was Python-only); new timestamp `20260624…` is safe | Latest prod migration (#5) | If an out-of-band newer migration exists, the backdate guard fails the PR — caught at PR time, fixable by bumping the timestamp. Planner should MCP-confirm. |
| A4 | Surrogate PK = `BIGINT GENERATED ALWAYS AS IDENTITY` (vs UUID) | DDL ordering (#4) | None functional; BIGINT is smaller/append-friendly. Either satisfies the user's "planner's call." |

**If this table is empty:** it is not — confirm A1 (backfill role scope) and A2 (no coherence trigger) with the user during plan/discuss; A3/A4 are low-risk planner calls.

## Open Questions

1. **Ongoing auto-enqueue: now or deferred?** (Claude's Discretion in CONTEXT.)
   - What we know: Backfill covers existing keys. New keys onboarded after Phase 35 would need an enqueue trigger to get a per-key series.
   - What's unclear: Whether to wire `derive_broker_dailies` (api_key) into the existing sync epilogue / a new cron arm now, or defer to Phase 36/37 when the series is actually read.
   - Recommendation: **Defer richness; ship minimal.** Since the store is dark until Phase 36, a per-key series that lags a few days for brand-new keys is invisible. Add ongoing auto-enqueue in Phase 36 (when reads begin) OR as a one-line addition to `enqueue_poll_allocator_positions_for_all_keys`'s sibling cron if trivial. Keep Phase 35 surgical.

2. **Does prod actually sit at `20260622120000`?** Resolve via MCP `list_migrations` at plan time (A3).

## Sources

### Primary (HIGH confidence — codebase, VERIFIED)
- `supabase/migrations/20260522111839_csv_daily_returns.sql` — live `csv_daily_returns` DDL + RLS + `persist_csv_daily_returns` RPC.
- `supabase/migrations/20260411144407_compute_jobs_queue.sql` — base compute_jobs queue + enqueue RPCs (strategy/portfolio).
- `supabase/migrations/20260420073003_allocator_holdings.sql` — `api_key_id` column + 4-way XOR + `enqueue_compute_job` 9-param + api_key in-flight index + `allocator_holdings` RLS analog.
- `supabase/migrations/20260420103104_allocator_sync_queued_prefetch.sql` — `enqueue_compute_job(p_api_key_id := …)` live usage.
- `supabase/migrations/20260614120000_derive_broker_dailies_kind.sql` — the kind registration + coherence-CHECK extension precedent.
- `analytics-service/services/job_worker.py` — `run_derive_broker_dailies_job` (1716), `_exchange_preflight` (658), `_allocator_key_preflight` (727), dispatch (2874).
- `analytics-service/services/broker_dailies.py` + `funding_fetch.py` — funding combine reads only timestamp+amount; `strategy_id` is a label.
- `analytics-service/services/analytics_runner.py:1980` — the sole CSV-strategy reader.
- `analytics-service/services/equity_reconstruction.py:1489` — canonical active-key predicate.
- `analytics-service/scripts/phase12_backfill_enqueue.py` — backfill precedent + the 42P10 partial-index caveat.
- `analytics-service/tests/test_persist_csv_daily_returns_live.py` — index-pin test (will break) + two-actor harness pattern.
- `supabase/config.toml:36` — `major_version = 17`; `.env.local` — prod ref `khslejtfbuezsmvmtsdn`.
- `.github/workflows/migration-policy.yml` — backdate guard mechanics.

### Secondary (MEDIUM confidence)
- `.planning/config.json` — `nyquist_validation: true`, profiles.

### Tertiary (LOW confidence)
- Supabase Management API prod-tip query — NOT reachable from this sandbox; deferred to MCP `list_migrations` at plan time (A3).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all artifacts read directly from the repo.
- Architecture (compute_jobs NOT a blocker; dual-mode preflight exists): HIGH — verified by reading the exact migrations + worker code, including the live `enqueue_compute_job(p_api_key_id := …)` call site.
- Schema ALTER correctness (NULLs-distinct, on_conflict, DDL ordering): HIGH — PG17 confirmed; non-partial+NULLs-distinct is standard PG default; the 42P10 partial-index trap is documented in the repo itself.
- Pitfalls + regression surface: HIGH — the breaking test and the paginated-read dependency were located by direct grep/read.
- Prod migration tip: MEDIUM — local source-of-truth tip confirmed; MCP confirmation deferred (A3).

**Research date:** 2026-06-24
**Valid until:** ~2026-07-24 (stable; the only fast-moving item is the prod migration tip, re-confirm via MCP at plan time).
