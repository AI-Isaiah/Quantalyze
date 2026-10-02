# Phase 98: Portfolio Data Foundation - Research

**Researched:** 2026-07-12
**Domain:** Server-side read layer over `allocator_holdings` (Next.js RSC queries + Python analytics) + a cross-process concurrency fence (Postgres partial UNIQUE INDEX) for portfolio recompute.
**Confidence:** HIGH (all core claims verified against source at file:line in this repo)

## Summary

This phase has two independent deliverables. (1) **PI-07** — a cross-process duplicate-`computing` fence. The exact write path, table, and partition key are already located and the fix is literally spelled out in a code comment: `analytics-service/routers/cron.py:869-871` says *"A real cross-process guard would need a UNIQUE INDEX on `portfolio_analytics(portfolio_id) WHERE computation_status='computing'` or a Postgres advisory lock."* [VERIFIED: cron.py:869-871]. The `computing` row is INSERTed at `analytics-service/routers/portfolio.py:646-648` (public POST) and reached from cron at `cron.py:922-923`. A **non-unique** partial index already exists on the same predicate (`idx_portfolio_analytics_computing`, migration `20260516170400`) — PI-07 upgrades this to a partial **UNIQUE** index and adds INSERT-side 23505 handling. (2) **The read layer** — net-new server-only typed reads over `allocator_holdings` (owner-scoped RLS user client, no SECDEF) for Exposure-by-Asset-Class (latest `asof`), Net-Exposure-Over-Time (sum per `asof`), and Allocation-Over-Time (weight per `asof`). Confirmed reusable table + indexes exist.

**Two non-trivial flags the planner must resolve before Phase 99:**
1. **`asset_class` for a POSITION is degenerate today.** The #597 classifier is `strategies.asset_class` (`crypto`/`traditional`), a **strategy-level** column [VERIFIED: `20260709130000_strategies_asset_class.sql:26`]. `allocator_holdings` has NO `asset_class`; its `venue` is always a crypto exchange (Bybit/Binance/OKX/Deribit — fed by `allocator_positions.py:216,253`), so grouping holdings by crypto/traditional yields a single all-crypto bucket. The real per-position dimension available today is **`holding_type` (`spot`/`derivative`)** [VERIFIED: `allocator_positions.py:218,255`] and `symbol`. "Exposure by Asset Class" needs a decided per-position taxonomy — this is an ASSUMED area, not a locked reuse.
2. **The migration must dedupe existing live `computing` rows before the UNIQUE build**, or the `CREATE UNIQUE INDEX` will fail on any portfolio that currently holds ≥2 fresh (<30 min, un-reaped) `computing` rows — exactly the race PI-07 exists to prevent.

**Primary recommendation:** Ship PI-07 as one migration (dedupe existing `computing` dupes → build partial UNIQUE index → keep the semaphore as fast-path) + INSERT-side 23505→409/`in_flight` handling in both `portfolio.py` and `cron.py`, pinned by a real-PG `supabase/tests/test_*.sql`. Ship the read layer as net-new typed functions in `src/lib/queries.ts` using the USER supabase client + owner RLS, honest-empty, coverage-mask-consistent (intersection/marked-gap, never zero-fill).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Duplicate-`computing` fence (PI-07) | Database (partial UNIQUE index) | API/worker (23505 handling) | Only the DB is cross-process; the semaphore is process-local [cron.py:863-871] |
| Position-level read (Exposure/Net-Exposure/Allocation) | Frontend Server (RSC, `queries.ts`) | Database (RLS) | Established pattern: server-only reads via USER supabase client + owner RLS [queries.ts:2543-2558] |
| Owner scoping / tenant isolation | Database (RLS policy) | — | `allocator_holdings_owner_select USING (allocator_id = auth.uid())` [mig 066:705-707] |
| Asset-class classification of a position | **UNDECIDED** — no tier owns it today | — | `strategies.asset_class` is strategy-scoped; no position classifier exists (see Open Questions Q1) |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Reuse the existing `allocator_holdings` table (allocator_id, venue, symbol, asof, holding_type, quantity, value_usd, mark_price) as BOTH the position-level source and the `asof` time axis — do NOT introduce a new positions table.
- **Exposure by Asset Class** = group latest-`asof` holdings by asset_class, derived from venue/symbol via the EXISTING classifier (crypto vs traditional — #597); value = sum(`value_usd`).
- **Net Exposure Over Time** = sum(`value_usd`) per `asof` (a real series over the holdings history).
- **Allocation Over Time** = per-strategy (or per-venue) weight = value_usd / total, per `asof`.
- Read functions are server-only, typed, return honest-empty (`[]` / null series) when the allocator has no holdings — never fabricated or zero-filled.
- Time-series reads mirror the factsheet coverage-mask discipline: a missing `asof` is a marked gap, never a zero-fill. Reuse the existing convention.
- Owner-scoped: an allocator reads only their own holdings (RLS already enforces). Do NOT bypass via SECDEF unless a specific need is proven; prefer the RLS-scoped user client.
- Secretless: no `api_key` ciphertext or key material in any read shape.
- **PI-07:** partial UNIQUE INDEX on the portfolio-recompute inflight key (mirror `compute_jobs_one_inflight_per_kind_strategy`) so two racing processes cannot both insert a `computing` row. Semaphore stays as fast-path; DB index is the real fence. Pin with a real-PG integration test in `supabase/tests/test_*.sql`: two concurrent inserts → one survives.
- Migration discipline: 14-digit timestamp later than latest; grep-all + re-base if it touches an existing object; SECDEF-hardened if any new function; route through migration-reviewer + rls-policy-auditor. Auto-applies to prod on merge; must be applied to the test project via MCP before the PR can go green.

### Claude's Discretion
- The exact shape/signatures of the read functions (typed returns), and where the per-position taxonomy question in Q1 lands (foundation stub vs decided in Phase 99).
- Whether Allocation-Over-Time weights are per-venue or per-strategy (CONTEXT says "per-strategy (or per-venue)").

### Deferred Ideas (OUT OF SCOPE)
- Widget rendering (Phase 99), optimizer sleeve + Notes (Phase 100), options-MTM (101/102).
- Any NEW position-ingestion source — this phase READS existing `allocator_holdings`, adds no ingestion.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PI-07 | Cross-process recompute deduped by a UNIQUE INDEX; integration test vs real PG | Write path located: INSERT at `portfolio.py:646-648`, table `portfolio_analytics`, predicate `computation_status='computing'`, partition key `portfolio_id`. Existing non-unique index `idx_portfolio_analytics_computing` (mig 20260516170400) to upgrade. Test template: `supabase/tests/test_claim_compute_jobs_dedupe_partition.sql`. |
| PI-01 (read) | Exposure-by-Asset-Class server read | `allocator_holdings` latest-`asof` grouping; BUT position `asset_class` undecided (Q1). RLS read pattern at `queries.ts:2543-2558`. |
| PI-02 (read) | Net-Exposure-Over-Time series read | `sum(value_usd)` per `asof`; coverage-mask convention (`scenario-benchmark.ts`, `factsheet/types.ts:472-478`). |
| PI-03 (read) | Allocation-Over-Time (weight history) read | per-venue/strategy `value_usd / total` per `asof`; grain confirmed unique `(allocator_id, venue, symbol, asof)` [mig 066:146-147]. |

## Standard Stack

No new external packages. This phase is entirely in-repo: Postgres DDL (a migration), the existing `@supabase/supabase-js` server client, TypeScript reads in `src/lib/queries.ts`, and Python edits in `analytics-service/routers/`. **Package Legitimacy Audit: N/A — zero new dependencies installed.**

### Core (existing, reused)
| Component | Where | Purpose |
|-----------|-------|---------|
| `allocator_holdings` table | `20260420073003_allocator_holdings.sql` | Position + `asof` time source; unique `(allocator_id, venue, symbol, asof)` [:146-147], index `allocator_holdings_allocator_asof_desc_idx (allocator_id, asof DESC)` [:150-151] |
| USER supabase server client | `src/lib/queries.ts` | Owner-scoped RLS reads (NOT admin) [:2543-2558, 2525-2526 comment] |
| `portfolio_analytics` table | `20260407075303_portfolio_intelligence.sql` | Recompute state row; `computation_status` enum incl. `computing` |
| Partial-unique-index pattern | `compute_jobs_one_inflight_per_kind_strategy` [mig 20260411144407:179-182] | The model DDL for PI-07 |
| SQL test harness | `.github/workflows/ci.yml:663-803`; `supabase/tests/test_*.sql` | `psql -v ON_ERROR_STOP=1 -f` after a meta-command preflight |

## Architecture Patterns

### PI-07 write path (data flow)

```
POST /api/portfolio-analytics (portfolio.py:1531)          cron_recompute (cron.py:_guarded_recompute:891)
        │                                                          │
   async with _compute_semaphore  (process-local, N=3)       async with cron_recompute_sem, _compute_semaphore
        │  portfolio.py:1555                                       │  cron.py:901
   SELECT computing row  (TOCTOU gap ↓)                       SELECT computing row  (same TOCTOU gap)
        │  portfolio.py:1556-1558                                  │  cron.py:902-909
   _compute_portfolio_analytics(pid)                          _compute_portfolio_analytics(pid)
        │                                                          │  cron.py:922-923
        └────────────►  INSERT portfolio_analytics {computation_status:'computing'}  ◄────────────┘
                                       portfolio.py:646-648
                                            │
                     ❌ TWO processes both pass SELECT, both INSERT → duplicate 'computing'
                     ✅ PI-07: partial UNIQUE(portfolio_id) WHERE status='computing' → 2nd INSERT raises 23505
```

**Key insight:** the SELECT-then-INSERT is TOCTOU across processes (`cron.py:867-868` says so explicitly). The semaphore only bounds within-process burst (`portfolio.py:544-546`). The UNIQUE index is the only cross-process fence.

### Pattern 1: PI-07 migration (mirror the compute_jobs model)
**What:** partial UNIQUE index on the inflight predicate.
**Model DDL** [Source: `20260411144407_compute_jobs_queue.sql:179-182`]:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_strategy
  ON compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');
```
**PI-07 target** (single-column partition, single-status predicate):
```sql
-- MUST dedupe existing live 'computing' dupes FIRST (see Pitfall 1), then:
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_analytics_one_computing_per_portfolio
  ON public.portfolio_analytics (portfolio_id)
  WHERE computation_status = 'computing';
```
**Note:** the existing `idx_portfolio_analytics_computing` is `(portfolio_id, computed_at DESC) WHERE computation_status='computing'` and is **non-unique** — a lookup index, not a fence [mig 20260516170400:37-39]. Decide whether the new UNIQUE index supersedes it (a single-column UNIQUE partial index also serves the lookup) or coexists. Prefer replacing to avoid two overlapping partial indexes.

### Pattern 2: INSERT-side 23505 handling (co-requisite code change)
**What:** once the UNIQUE index exists, the INSERT at `portfolio.py:646-648` will raise a PostgREST `APIError` with code `23505` when a race loses — today there is NO try/except there, so it would surface as a 500. Convert 23505 → the existing 409 semantics.
- `portfolio.py`: wrap the INSERT; on 23505 raise `HTTPException(409, "already in progress")` (matches the existing in-flight 409 at `:1561-1564`).
- `cron.py _guarded_recompute`: on 23505 return `(pid, "in_flight", None)` (matches the existing in-flight bucket at `:921`).
**Why load-bearing:** the whole point of PI-07 is that the losing racer is handled gracefully, not 500'd. A migration without this code change turns a silent dup into a loud 500.

### Pattern 3: read layer (owner-scoped, honest-empty)
**Source pattern** [`queries.ts:2543-2558`]: USER `supabase` client, `.from("allocator_holdings").eq("allocator_id", userId).order("asof", ...)`. No `admin`, no SECDEF — RLS `allocator_holdings_owner_select USING (allocator_id = auth.uid())` [mig 066:705-707] enforces ownership. Project only non-secret columns (never `raw_payload` / key material). Return `[]` / null series on no rows.

### Anti-Patterns to Avoid
- **Zero-filling a missing `asof`** in Net-Exposure-Over-Time — reads as flat real exposure. The whole coverage-mask discipline forbids it (`factsheet/types.ts:472-478`, `scenario-benchmark.ts:8-17,83`).
- **Using the admin client for holdings reads** — bypasses owner RLS; the codebase deliberately uses the USER client here and only drops to `admin` where a table lacks a self-SELECT policy [queries.ts:2500-2519 comment].
- **Building the UNIQUE index without pre-deduping live `computing` rows** — see Pitfall 1.
- **Adding a SECDEF function you don't need** — PI-07 is index-only; no new function ⇒ no SECDEF hardening required. Only harden (search_path + REVOKE PUBLIC/anon/authenticated) IF the plan introduces a function [pattern: `reset_stalled_portfolio_analytics.sql:35-36`].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-process recompute mutex | An app-level distributed lock / Redis lock | Partial UNIQUE index (PI-07) | Postgres already fences it atomically; the repo's own `compute_jobs` uses exactly this |
| Owner scoping | Manual `.eq("allocator_id")` as the sole guard | Existing RLS policy + USER client | RLS is the enforced boundary; the `.eq` is defence-in-depth, not the fence |
| Gap handling in the time series | A new gap/interpolation scheme | The intersection/marked-gap convention (`scenario-benchmark.ts`, factsheet `missingSegments`) | No-invented-data is a LOCKED milestone invariant |
| SQL integration test scaffold | A bespoke harness | Copy `test_claim_compute_jobs_dedupe_partition.sql` | Same BEGIN/ROLLBACK + RAISE-EXCEPTION + scoped-count pattern CI already runs |

## Common Pitfalls

### Pitfall 1: UNIQUE index build fails on existing prod `computing` duplicates
**What goes wrong:** `CREATE UNIQUE INDEX ... WHERE computation_status='computing'` fails immediately if any `portfolio_id` currently has ≥2 `computing` rows — precisely the race PI-07 fixes. Migrations auto-apply to prod on merge, so this would fail the prod apply.
**Why it happens:** the reaper (`reset_stalled_portfolio_analytics`) only clears rows older than 30 min [cron.py:843-846]; fresh duplicates slip under it.
**How to avoid:** in the migration, BEFORE the index build, collapse existing live `computing` dupes to one survivor per portfolio (e.g., keep the most-recent `computed_at`, mark the rest `failed`/reaped), then build the index. Verify with a self-checking `DO` block (repo convention — see `20260516170400:44-58`).
**Warning sign:** migration apply errors with `23505` / `could not create unique index`.

### Pitfall 2: CONCURRENTLY vs transactional migration
**What goes wrong:** `CREATE UNIQUE INDEX CONCURRENTLY` cannot run inside a transaction block; the prior non-unique index migration split into two phases for exactly this [mig 20260516170400:20-39]. But CONCURRENTLY also cannot pre-dedupe in the same tx.
**How to avoid:** decide index build strategy. Options: (a) plain `CREATE UNIQUE INDEX` (takes a brief lock; `portfolio_analytics` write volume is low — recompute cadence, not per-request) — simplest, dedupe + build in one tx; or (b) CONCURRENTLY in a non-tx phase after a transactional dedupe phase. Prefer (a) unless lock duration is shown to matter.

### Pitfall 3: Test project must be caught up before the PR goes green
**What goes wrong:** `supabase/tests/test_*.sql` run via `psql` against the TEST project [ci.yml:789-803]. The new index/columns must exist there or the test errors on missing objects. Test DB lags main.
**How to avoid:** apply the migration to the test project via Supabase MCP `apply_migration` before pushing (project ref `qmnijlgmdhviwzwfyzlc`; note MCP stamps `now()` not the file timestamp — rename the `schema_migrations` row if drift matters). This is a documented recurring gotcha in project memory.

### Pitfall 4: PostgREST 23505 shape
**What goes wrong:** supabase-py / supabase-js raise the unique violation as an `APIError`/`PostgrestError` with `.code == "23505"`, not a raw psycopg exception — catching the wrong type misses it.
**How to avoid:** catch the PostgREST error and branch on `code == "23505"` (Python) / `error.code === "23505"` (TS).

## Runtime State Inventory

> This is a read-layer + index phase, not a rename/migration-of-data phase, but the PI-07 index interacts with live state — inventoried for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Live `portfolio_analytics` rows with `computation_status='computing'` in prod may contain duplicates per portfolio | Data cleanup INSIDE the migration (dedupe before UNIQUE build) — see Pitfall 1 |
| Live service config | None — no external service holds this state | None |
| OS-registered state | None — cron is app-internal (`cron.py`), no OS scheduler | None (verified: recompute is a FastAPI cron route, not a Task Scheduler entry) |
| Secrets/env vars | None touched. Reads must NOT project `api_key` ciphertext / `raw_payload` | Code-review gate only (no key material in read shapes) |
| Build artifacts | `src/lib/database.types.ts` is generated — regenerate if the migration changes `portfolio_analytics` columns (PI-07 adds only an index, so likely no type change) | Regenerate types only if columns change (index-only ⇒ none) |

## Coverage-Mask Convention (verified)

The reusable no-zero-fill convention lives in three places the Net-Exposure-Over-Time read must mirror:
- **Intersection, never union-with-zero-fill:** `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts:8-17,69,83` ("NO zero-fill, NO interpolation … intersection only").
- **Marked gap spans, excluded from compounding:** factsheet `missingSegments?: { start; end; kind:"gap"; days }[]` [`src/lib/factsheet/types.ts:472-478`], and composite read path "ABSENT, never zero-filled" [`src/lib/factsheet/composite-read-path.ts:22`].
**For the series read:** emit the real `asof` points that exist; represent missing days as a marked gap (or simply omit and let the widget mark the discontinuity) — do NOT synthesize `value_usd=0` for a missing `asof`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| TS unit | Vitest (`vitest.config.ts`; coverage-gated per CLAUDE.md) |
| Python unit | pytest (`analytics-service/`, `--cov-fail-under=80`) |
| SQL integration | raw `psql -v ON_ERROR_STOP=1 -f supabase/tests/test_*.sql` in `ci.yml:663-803` (RAISE EXCEPTION on failure; pgTAP NOT used) |
| Quick run | `npm run test` (TS) / `pytest analytics-service/tests/test_portfolio_*.py` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | File |
|-----|----------|-----------|---------|------|
| PI-07 | Two concurrent `computing` INSERTs → exactly one survives, 2nd raises 23505 | SQL integration (real PG) | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_portfolio_analytics_one_computing.sql` | ❌ Wave 0 (new) — model on `test_claim_compute_jobs_dedupe_partition.sql` |
| PI-07 | Migration dedupes existing dupes before index build (self-verifying DO block) | SQL (in-migration) | runs on apply | in migration file |
| PI-07 | Losing racer → 409 (public) / `in_flight` (cron), not 500 | Python unit | `pytest analytics-service/tests/test_portfolio_compute_integration.py` (extend) | ❌ Wave 0 — add 23505-branch case |
| PI-01/02/03 reads | Honest-empty on no rows; owner-scoped; no secret columns; no zero-fill in series | TS unit (Vitest) | `npm run test -- queries` | ❌ Wave 0 — new tests for the new read fns |

### Sampling Rate
- **Per task commit:** the touched suite (`pytest ...test_portfolio_compute_integration.py` or `npm run test -- queries`).
- **Per wave merge:** full `npm run test` + `pytest` + the SQL test file via psql.
- **Phase gate:** full suite green + test project caught up via MCP before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `supabase/tests/test_portfolio_analytics_one_computing.sql` — real-PG PI-07 fence (23505 on 2nd concurrent `computing` insert), copy structure from `test_claim_compute_jobs_dedupe_partition.sql` (BEGIN/ROLLBACK, scoped counts, nested block catching `unique_violation`).
- [ ] Python case in `test_portfolio_compute_integration.py` asserting the 23505→409/`in_flight` branch.
- [ ] Vitest cases for each new read fn (honest-empty, owner filter present, no `raw_payload`/`api_key*` in projection, series has no zero-filled `asof`).
- [ ] Migration self-verifying `DO` block (index present + no remaining live dupes).

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | Owner RLS `allocator_holdings_owner_select USING (allocator_id = auth.uid())` [mig 066:705-707]; read via USER client, never `admin`/SECDEF |
| V5 Input Validation | partial | Read functions take `userId` from the authed session, not client input; no free-form query params |
| V6 Cryptography | yes (by omission) | Secretless: never project `raw_payload` / `api_key` ciphertext — LOCKED invariant |
| V1 Data Protection | yes | `allocator_holdings` is GDPR personal data [gdpr-export-manifest.ts:623]; reads stay owner-scoped |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Cross-tenant holdings read | Information Disclosure | RLS owner policy + USER client (not admin) |
| Duplicate-`computing` race → double compute / stuck row | DoS / Tampering | PI-07 partial UNIQUE index (the deliverable) |
| Secret leak via read projection | Information Disclosure | Column allow-list in the read; no `raw_payload` |
| Migration privilege drift | Elevation | If (and only if) a function is added, harden `search_path` + `REVOKE PUBLIC/anon/authenticated`; route through migration-reviewer + rls-policy-auditor |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres (prod + test project) | PI-07 index + SQL test | ✓ | Supabase-managed | — |
| `psql` client | CI SQL test | ✓ (installed in ci.yml step :718) | — | — |
| Supabase MCP | Apply migration to test project pre-merge | ✓ | — | Manual SQL apply |
| Existing crypto-exchange holdings data | Read layer to return non-empty | partial — depends on allocator having synced keys | — | Honest-empty is the correct, tested behavior |

No new external packages ⇒ no install step, no supply-chain surface.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Exposure by Asset Class" needs a per-position taxonomy that does NOT exist today (strategy `asset_class` is degenerate all-crypto for holdings) | Summary / Q1 | If the planner assumes the #597 classifier "just works" per-position, PI-01 renders a single all-crypto bucket — wrong. Needs a decided dimension (holding_type spot/derivative, per-venue, or a new symbol→class map). |
| A2 | Plain (non-CONCURRENTLY) UNIQUE index build is acceptable given low `portfolio_analytics` write volume | Pitfall 2 | If recompute write volume is higher than assumed, a brief exclusive lock could stall writers; fall back to the two-phase CONCURRENTLY approach. |
| A3 | PI-07 is index-only (no new SQL function) ⇒ no SECDEF hardening needed | Anti-Patterns / Security | If the plan adds a dedupe helper function, it MUST be SECDEF-hardened + routed through the auditors. |
| A4 | Allocation-Over-Time weight denominator is per-`asof` total across the allocator's holdings | Read layer | If the intended denominator is per-strategy AUM or a different base, the weights are wrong. CONTEXT leaves per-strategy vs per-venue to discretion. |

## Open Questions

1. **What is "asset class" for a POSITION?** (A1) — `strategies.asset_class` is `crypto`/`traditional` and strategy-scoped [mig 20260709130000:26]; `allocator_holdings` venues are all crypto exchanges [allocator_positions.py:216,253], so that axis is degenerate. Available per-position dimensions: `holding_type` (`spot`/`derivative`) [allocator_positions.py:218,255] and `symbol`.
   - Recommendation: Phase 98 delivers the raw grouped read keyed by `holding_type` + `symbol` + `venue` (all present, honest), and defers the *display* taxonomy label to a Phase-99 decision. Do NOT invent a crypto/traditional split that reads as all-crypto. Flag for discuss-phase if the demo specifically needs a named "asset class" breakdown.
2. **Replace or coexist for the partial index?** The existing non-unique `idx_portfolio_analytics_computing (portfolio_id, computed_at DESC)` overlaps the PI-07 predicate. Recommendation: replace it with the single-column partial UNIQUE index (which still serves the lookup) to avoid two overlapping partial indexes; confirm no query depends on the `computed_at DESC` ordering within the `computing` partition (unlikely — reaper filters by age, not order).
3. **Are there live prod `computing` duplicates right now?** Determines whether the migration's dedupe step will actually fire. Recommendation: query prod via MCP during planning to size the cleanup; the dedupe DO-block must be present regardless (defence).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Process-local `asyncio.Semaphore(3)` as the only recompute guard | DB partial UNIQUE index as the cross-process fence (PI-07) | This phase | Semaphore demoted to fast-path; DB becomes the truth |
| Non-unique `idx_portfolio_analytics_computing` (lookup only) | Partial UNIQUE on same predicate | This phase | Enforces the invariant the lookup index only observed |

## Sources

### Primary (HIGH — repo source, file:line)
- `analytics-service/routers/cron.py:863-871, 891-926, 843-846` — semaphore TOCTOU + the literal PI-07 fix description + reaper.
- `analytics-service/routers/portfolio.py:544-546, 632-663, 1552-1564` — INSERT path + existing 409 semantics.
- `supabase/migrations/20260411144407_compute_jobs_queue.sql:179-182` — model partial-unique DDL.
- `supabase/migrations/20260516170400_portfolio_analytics_computing_idx_concurrently.sql` — existing non-unique index + CONCURRENTLY two-phase pattern.
- `supabase/migrations/20260420073003_allocator_holdings.sql:89-151, 700-707` — table grain, indexes, RLS owner policy.
- `supabase/migrations/20260709130000_strategies_asset_class.sql:26-34` — strategy-level asset_class (crypto/traditional).
- `analytics-service/services/allocator_positions.py:216-255, 314-338` — venue = crypto exchange, holding_type spot/derivative, upsert grain.
- `src/lib/queries.ts:2500-2558` — USER-client owner-scoped holdings read pattern.
- `src/lib/factsheet/types.ts:472-478`, `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts:8-83` — coverage-mask / no-zero-fill convention.
- `supabase/tests/test_claim_compute_jobs_dedupe_partition.sql` — SQL integration test template.
- `.github/workflows/ci.yml:663-803` — SQL test harness wiring.
- `src/lib/database.types.ts:150-207` — allocator_holdings column shape.

### Secondary (MEDIUM)
- Project memory: DB-test CI wiring, test project `qmnijlgmdhviwzwfyzlc`, MCP `apply_migration` `now()` drift.

## Metadata

**Confidence breakdown:**
- PI-07 root + fix: HIGH — the fix is named verbatim in a code comment and the write path is read at file:line.
- Read layer pattern: HIGH — established owner-scoped read exists and is quoted.
- asset_class degeneracy (A1): HIGH — strategy-level column + crypto-only venues both verified; the *resolution* is an open decision (flagged).
- Coverage-mask reuse: HIGH — three concrete source anchors.
- Migration mechanics (dedupe-first, CONCURRENTLY): HIGH on the constraint, MEDIUM on the chosen strategy (A2).

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (stable; in-repo facts don't drift unless the recompute path is refactored in a parallel milestone)

## RESEARCH COMPLETE

PI-07 is well-bounded: table `portfolio_analytics`, partition key `portfolio_id`, predicate `computation_status='computing'` — upgrade the existing non-unique index to a partial UNIQUE (dedupe live dupes first), add 23505→409/`in_flight` handling in `portfolio.py` + `cron.py`, and pin with a real-PG `supabase/tests/*.sql`; the read layer is net-new owner-scoped RLS reads over `allocator_holdings`, but "Exposure by Asset Class" has NO usable per-position classifier today (strategy `asset_class` is degenerate all-crypto) — the planner must decide the position taxonomy (recommend `holding_type`/`symbol`/`venue`, defer the "asset class" label to Phase 99).
