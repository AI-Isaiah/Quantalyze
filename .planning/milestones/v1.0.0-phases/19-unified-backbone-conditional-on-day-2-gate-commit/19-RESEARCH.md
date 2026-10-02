# Phase 19: Unified Backbone — Research

**Researched:** 2026-05-08
**Domain:** Multi-tier API-key ingestion unification (Next.js → FastAPI → Postgres)
**Confidence:** HIGH (all major claims verified against codebase via direct reads)
**Branch verified:** `v1.0.0-phase-19-unified-backbone` ✓

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Plan Slicing & Wave Structure** — 9 plans, 3 waves:
- **P1** Entry-gate docs (`route-inventory.md` + `migration-plan.md`)
- **P2** Migrations 103–107 (numbers shifted from 093–097 spec; slots 093/094/098–102 already taken)
  - 103 = `strategy_verifications` schema additions for state-machine + `transition_strategy_verification` RPC
  - 104 = `wizard_session_id` UNIQUE INDEX + `process_key_long` registry insert + `unified_backbone_at_claim` metadata write on claim
  - 105 = fingerprint JSONB column + partial index + `compute_similarity()` SQL function
  - 106 = VIEW-shim flip step (a) — repoint `verify-strategy/route.ts:115` UPDATE to `strategy_verifications` BEFORE rename
  - 107 = rename old to `verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT … FROM strategy_verifications` + INSTEAD OF read-only triggers
- **P3** `IngestionAdapter` Protocol + 4 adapters in new `analytics-service/services/ingestion/` package
- **P4** `POST /process-key` router (`analytics-service/routers/process_key.py`) + state-machine RPC + structlog/Sentry instrumentation + `INTERNAL_API_TOKEN` auth
- **P5** Next.js thin adapters (5 entry routes); flag read seam at `src/lib/feature-flags.ts`; **VIEW-shim 4-PR sequence ships as 4 sequential commits within P5**, plan-checker validates via PR description metadata convention `phase-19-shim-step-{a|b|c|d}: …`
- **P6** `wizard_session_id` idempotency + `compute_jobs.kind='process_key_long'` long-fetch dispatch via PR #53 worker dyno
- **P7** Flag-monitor cron (`/api/cron/flag-monitor`, `*/15 * * * *`) + drain semantics (worker reads `compute_jobs.metadata->>'unified_backbone_at_claim'`, NOT live env var)
- **P8** BACKBONE-06 (open-perp mark-price valuation + funding accumulation) + BACKBONE-07 (TWR ≠ YTD reconciliation at equity-curve layer); adds `EquityCurveBuilder` to existing `services/equity_reconstruction.py`
- **P9** Fingerprint v0 (5-component JSONB)

**Wave structure:**
- Wave 1: P1 + P2 + P3 (independent foundation)
- Wave 2: P4 + P6 + P8 + P9 (depend on W1 schema + Protocol)
- Wave 3: P5 + P7 (depend on W2 router contract)

**Feature Flag + Drain Semantics + Flag-Monitor Cron:**
- **Flag mechanism:** `PROCESS_KEY_UNIFIED_BACKBONE=on/off` env var on both Vercel and Railway. New `src/lib/feature-flags.ts` (~40 LOC, 30s in-process cache) + `analytics-service/services/feature_flags.py` (~30 LOC, 30s cache). No new deps.
- **Auto-rollback target:** Supabase `feature_flags` kill-switch row (NOT Vercel env-var flip). Flag read seams check kill-switch first; if `off`, override env var. Cached 30s.
- **Drain semantics:** `claim_compute_job` RPC sets `compute_jobs.metadata->>'unified_backbone_at_claim'` at claim time. Workers read THIS, not live env var, when picking the code path. Migration 104 adds the metadata write.
- **Flag-monitor cron:** `/api/cron/flag-monitor`, `*/15 * * * *`. Polls Sentry events API (`SENTRY_AUTH_TOKEN`, scope `org:read,event:read`) for events tagged `correlation_id` + path matching unified routes + `level=error`. Denominator from Supabase audit row. Threshold: error envelope rate > 0.5% in 15-min tumbling window → flips kill-switch row to `off`. Sends Sentry alert + Resend founder email on every breach.

**IngestionAdapter Protocol — Module Layout & Adapters:**
- New `analytics-service/services/ingestion/` package:
  - `ingestion/__init__.py` exports `IngestionAdapter` Protocol + shared types
  - `ingestion/adapter.py` — Protocol + `KeySubmissionRequest`, `VerificationResult`, `Trade`, `Position`, `MetricsSnapshot`, `Fingerprint` dataclasses
  - `ingestion/okx.py`, `ingestion/binance.py`, `ingestion/bybit.py`, `ingestion/csv_adapter.py` — concrete adapters; delegate to `services/exchange.py` (629 LOC unchanged per ROADMAP REUSE flag)
- Protocol — 5 explicit methods:
  1. `validate(req: KeySubmissionRequest) -> ValidationResult`
  2. `fetch_raw(creds_or_file) -> list[Trade]`
  3. `compute_metrics(trades) -> MetricsSnapshot`
  4. `compute_fingerprint(trades, metrics) -> Fingerprint`
  5. `reconstruct_positions(trades) -> list[Position]` — wires `position_reconstruction.py` + `positions.py` + `funding_fetch.py` (BACKBONE-09 reuse)
- Router orchestrates the 5 methods in sequence. State-machine RPC called between steps to advance status (`draft → validated → metrics_captured → encrypted → report_queued → published`).
- **`POST /process-key` location:** new router `analytics-service/routers/process_key.py`, registered in `main.py` after `csv.router` (around L211). Auth: `INTERNAL_API_TOKEN` constant-time check (matches `routers/internal.py:117`). Next.js callers send `Authorization: Bearer ${INTERNAL_API_TOKEN}`.
- **State-machine wizard transitions — DB-side via RPC**: migration 103 ships `transition_strategy_verification(verification_id, new_status, metadata)` RPC. Atomic CHECK constraint + trigger enforces legal transitions. Adapter calls this RPC after each pipeline step.

**Fingerprint v0 Shape + Equity-Curve Unification:**
- Fingerprint v0 — 5-component JSONB (4+4+4+10+24 = 46 dims):
  ```jsonc
  {
    "version": 1,
    "trade_size_buckets":       [4 floats summing to 1.0],   // <$1k, $1-10k, $10-100k, $100k+
    "hold_duration_buckets":    [4 floats summing to 1.0],   // <1h, 1-24h, 1-7d, >7d
    "asset_class_mix":          [4 floats summing to 1.0],   // spot, perp_long, perp_short, futures
    "instrument_concentration": [10 floats summing to 1.0],  // top-10 by % volume; pad with 0.0
    "temporal_pattern":         [24 floats summing to 1.0]   // % volume per UTC hour
  }
  ```
- `compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC` — plain plpgsql cosine on concatenated fixed-length 46-dim vector. Returns NUMERIC(5,4) in [0,1]. Returns 0.0 if either input is NULL OR `version` mismatches (never errors). `IMMUTABLE PARALLEL SAFE`.
- Equity-curve unification: add `EquityCurveBuilder` class to existing `services/equity_reconstruction.py`. Open perps valued at mark-price via new `services/exchange.py.fetch_mark_prices(instruments)` (cached 60s in-process). YTD = window-filtered TWR; TWR = full-history. Sharpe ±0.05 vs quantstats reference per source.
- Golden-file fixtures at `analytics-service/tests/fixtures/equity-curve-golden/{strategy_name}.json` with `{trades, expected_equity_curve, expected_twr, expected_ytd, expected_sharpe}`.
- For CSV ingestion, mark prices not applicable; open positions assumed flat at upload time, documented as v0 limitation in `IngestionAdapter.csv_adapter` docstring.

### Claude's Discretion

- Exact file/symbol names within `ingestion/` package (e.g., shared dataclass split between `adapter.py` and `types.py` if `adapter.py` grows large)
- Concrete `transition_strategy_verification` RPC body (likely `IF NOT EXISTS (SELECT … FROM transitions WHERE from_status=OLD.status AND to_status=NEW.status) THEN RAISE EXCEPTION` pattern)
- Exact `compute_similarity` SQL implementation (loop unrolling vs `array_agg` + `unnest`)
- Resend template + email body for flag-monitor breach alert
- Whether `EquityCurveBuilder` is class or module-level functions
- Plan-checker metadata format for VIEW-shim 4-commit boundary check inside P5
- Test framework specifics within established analytics-service pytest patterns

### Deferred Ideas (OUT OF SCOPE)

- pgvector + HNSW indexing — explicitly deferred to v2 per UC-C
- MT5 / IBKR adapters — UC-B drops these; v1.0.0 source list is exactly OKX, Binance, Bybit, CSV
- Per-component fingerprint weighting — UC-C accepts placeholder identity preservation
- Mobile-readable wizard fallback — Phase 17 DESIGN-04 deferred to v2
- Auto-rollback via Vercel env-var flip — manual fallback only (`vercel env rm`)
- Per-broker quality SLA pattern — out of v1.0.0 scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BACKBONE-01 | `POST /process-key` FastAPI RPC accepts `KeySubmissionRequest{flow_type ∈ {teaser, onboard, internal_report, csv, resync}, source ∈ {okx, binance, bybit, csv}, context: dict}`; returns `VerificationResult` with `metrics_snapshot`, `fingerprint`, `encrypted_credentials` (optional), `status`, `trust_tier`, `errors[]` | P4 router skeleton — see §P4. Mirrors `routers/exchange.py` shape. Auth via `INTERNAL_API_TOKEN` per `routers/internal.py:117`. |
| BACKBONE-02 | `IngestionAdapter` Protocol with 5 methods; per-method explicit error envelope contract; separate flow paths for CSV (file-format validation) vs API (broker-credential validation) | P3 — `analytics-service/services/ingestion/` package. Wraps `services/exchange.py` validate_key_permissions / fetch_raw_trades. CSV adapter wraps existing `services/csv_validator.py`. |
| BACKBONE-03 | `strategy_verifications` table with status state-machine + `trust_tier` column (`api_verified` \| `csv_uploaded` \| `self_reported`) + TEXT CHECK | Already shipped in migration 093 (Phase 15). 103 adds state-machine RPC + extra metadata columns. |
| BACKBONE-04 | VIEW-shim migration sequence — exactly 4 sequential PRs (a/b/c/d); 7 calendar days at 100% rollout before VIEW drop; plan-checker rejects exit if any single PR combines adjacent steps | P5 ships migration 106 (UPDATE repoint) + 107 (rename + VIEW + INSTEAD OF triggers) + flag flip + verification step as 4 commits with `phase-19-shim-step-{a\|b\|c\|d}: …` convention. |
| BACKBONE-05 | Feature flag `process_key_unified_backbone` — env var + Supabase kill-switch row; 7-day stability window at 100% rollout with zero error-envelope regressions; manual rollback via `vercel env rm`; old route handlers remain reactivatable behind flag during 90-day support-lookup window | P5 + P7. New `src/lib/feature-flags.ts` + `analytics-service/services/feature_flags.py` with 30s cache. Kill-switch reads from Supabase `feature_flags` table (P2 must add this table to migration 104). |
| BACKBONE-06 | Open-perp position correctness — `reconstruct_positions()` adapter method wires existing `position_reconstruction.py` + `positions.py` + funding-fees primitives; mark-price valuation + funding-rate accumulation; golden-file fixture | P8. New `services/exchange.py.fetch_mark_prices(instruments)` with 60s in-process cache. `EquityCurveBuilder.attach_open_perp_marks()` method. |
| BACKBONE-07 | TWR ≠ YTD bug fixed at equity-curve layer; YTD = window-filtered TWR (full-history); Sharpe matches quantstats reference within ±0.05 per source | P8. `EquityCurveBuilder.compute_twr()` + `.compute_ytd_window()`. Quantstats reference assertion in golden-file tests. |
| BACKBONE-08 | `wizard_session_id` UNIQUE INDEX on `strategy_verifications` + route-level idempotency check on `/process-key` — wizard double-submit produces single row, not duplicates | P6. Migration 104 adds `CREATE UNIQUE INDEX … WHERE wizard_session_id IS NOT NULL`. Route catches `23505` and returns existing row. |
| BACKBONE-09 | Long-fetch flows dispatch via existing PR #53 worker dyno on Railway — `compute_jobs.kind='process_key_long'`, `priority='normal'`; `/process-key` returns `{queued, correlation_id}` synchronously; worker writes `VerificationResult` back to `strategy_verifications` row; idempotent under retries via `wizard_session_id` | P6. New `run_process_key_long_job(job)` handler in `services/job_worker.py`. Migration 104 widens `compute_jobs.kind` CHECK to admit `process_key_long` AND adds `unified_backbone_at_claim` metadata write inside `claim_compute_jobs_with_priority`. |
| BACKBONE-10 | All 5 entry routes become thin Next.js adapters delegating to `/process-key`; pre-Phase-19 deliverable `.planning/phase-19/route-inventory.md` greps every Next.js non-GET route touching {api_keys, strategies, strategy_analytics, verification_requests, strategy_verifications, compute_jobs} | P1 (entry-gate docs) + P5 (thin adapters). 5 routes: `verify-strategy`, `keys/validate-and-encrypt`, `strategies/finalize-wizard`, `keys/sync` as `flow_type='resync'`, `factsheet/[id]/pdf`. |
| FINGERPRINT-01 | `strategies.fingerprint JSONB` column added (versioned shape, per-component arrays); partial index `WHERE fingerprint IS NOT NULL`; on every key ingestion (any `flow_type`), compute fingerprint and persist; backfill script on first cron run after ship | P2 migration 105 + P9 fingerprint computation + P9 backfill cron entry. |
| FINGERPRINT-02 | `compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC` SQL function — `IMMUTABLE PARALLEL SAFE`, plain plpgsql cosine, returns 0.0 on shape/version mismatch (never errors); `REVOKE EXECUTE … FROM PUBLIC; GRANT EXECUTE TO authenticated, service_role`; `search_path=public, pg_temp` hardening | P2 migration 105. Mirrors 086 H-B SECURITY DEFINER pattern. |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Banned packages:** `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai`. Use native `fetch()` or `undici` for HTTP.
- **Next.js docs:** read from `node_modules/next/dist/docs/` BEFORE writing code (this version has breaking changes vs training data).
- **Always read `DESIGN.md`** before any visual/UI decisions. Phase 19 customer-facing surfaces (wizard error envelopes, broker selector grid, CSV escape-hatch card) must match the locked Phase 17 contract.
- **Always update VERSION + package.json in same commit** — frontend CI fails (critical-regressions.test.ts) on drift.
- **Test Supabase project:** `qmnijlgmdhviwzwfyzlc` for E2E. Migrations apply via Supabase MCP `apply_migration`; do NOT run `supabase db push` in CI without ratification.
- **Subagent branch protection:** GSD subagents may run `git checkout main` + `git pull` mid-task; future plans must include explicit "no git branch ops" constraint when delegating.
- **Test framework:** pytest for analytics-service (uses `pytest-asyncio` + `respx` for httpx mocks); Vitest 3.0.0 for Next.js; Playwright for E2E.
- **Migration drift:** sequential, no gaps. Latest is 102. Phase 19 claims 103–107.

---

## Executive Summary

Phase 19 unifies five divergent Next.js entry routes (`verify-strategy`, `keys/validate-and-encrypt`, `strategies/finalize-wizard`, `keys/sync` as `flow_type='resync'`, `factsheet/[id]/pdf`) into one observable `POST /process-key` FastAPI RPC backed by an `IngestionAdapter` Protocol with four concrete adapters (OKX, Binance, Bybit, CSV). The unification ships behind a feature flag (`PROCESS_KEY_UNIFIED_BACKBONE`) with a Supabase kill-switch row for auto-rollback, drain semantics that snapshot the flag value into `compute_jobs.metadata` at claim time, and a 15-minute tumbling-window cron monitor that polls Sentry's events API. Phase 19 also closes BACKBONE-06/-07 (open-perp mark-price valuation + TWR ≠ YTD reconciliation) at the equity-curve layer using existing 70%-built primitives, and ships a versioned 5-component JSONB `fingerprint` column with a `compute_similarity()` plpgsql cosine function — pgvector explicitly deferred to v2.

**Primary recommendation:** ship migrations 103–107 in P2 first (Wave 1), so the schema substrate (`strategy_verifications` state-machine RPC, `wizard_session_id` UNIQUE INDEX, fingerprint JSONB, VIEW-shim) is in place before P4 (router) and P5 (thin adapters) are written. The 4-PR VIEW-shim sequence is the highest-risk operational manoeuvre; P5 must enforce commit-message convention `phase-19-shim-step-{a\|b\|c\|d}: …` so the plan-checker can grep-validate the 4-commit boundary at exit. Use `[ASSUMED]` tags on Sentry events API field shapes (Sentry's API changes frequently and the team must verify the v0 query payload against the live Sentry org before P7 ships).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wizard form + UI state | Browser / Next.js client | — | DESIGN.md locks the wizard as desktop-first React |
| 5 entry-route thin adapters | Frontend Server (Next.js route handlers) | — | App Router non-GET handlers; auth + rate-limit before delegating |
| `/process-key` business logic | API / FastAPI (Railway) | — | Long-running broker fetches; Vercel 300s ceiling forces queue dispatch |
| Adapter Protocol + concrete adapters | API / FastAPI (Railway) | — | Wraps `ccxt.async_support`; CPU + IO bound |
| State-machine transitions | Database / Postgres | API / FastAPI | RPC enforces legal transitions; adapter calls RPC between pipeline steps |
| Long-fetch dispatch | Worker dyno / FastAPI background | API / FastAPI | Existing PR #53 worker; `compute_jobs.kind='process_key_long'` |
| Feature flag read | Frontend Server + API | Database (kill-switch row) | Two read seams (TS + Python); both check Supabase first |
| Flag-monitor cron | Frontend Server (Next.js cron route) | Sentry HTTP API | `vercel.json` cron registry; runs as Vercel function |
| Drain semantics | Database (claim RPC) | Worker dyno | RPC writes `unified_backbone_at_claim` at claim time; worker reads from row, not env |
| Equity curve / open-perp | API / FastAPI | Database (mark-price cache) | New `EquityCurveBuilder` extends `equity_reconstruction.py` |
| Fingerprint compute | API / FastAPI | Database (similarity SQL) | Compute end-of-pipeline; persist JSONB; SQL cosine for queries |
| VIEW-shim cutover | Database (migrations) | Application code (P5) | 4-PR sequence: repoint → flag flip → 24h verify → rename + INSTEAD OF |

---

## Standard Stack

### Core (already in repo — REUSE)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastapi` | (already pinned) | RPC server | Existing analytics-service router pattern |
| `ccxt.async_support` | (already pinned) | Broker SDK | All 4 brokers (binance/okx/bybit/deribit); existing `services/exchange.py` wrap |
| `cryptography.fernet` | (already pinned) | KEK envelope encryption | Existing `services/encryption.py` |
| `structlog` | 25.5.0 | JSON logs with `correlation_id` contextvar | OBSERV-09; `services/logging_config.py` |
| `sentry-sdk[fastapi]` | 2.58.0 | Error tracking with `before_send` PII scrub | OBSERV-05; `analytics-service/sentry_init.py` |
| `httpx` | (already pinned, transitive of supabase-py) | HTTP client for Sentry events API | No `axios` (banned); `httpx` already used in `equity_reconstruction.py` |
| `pytest-asyncio` | (already pinned) | Async test runner | Mirrors `test_job_worker.py` pattern |
| `respx` | (already pinned) | httpx mock | For mocking Sentry API in P7 |
| `@supabase/supabase-js` | (already pinned, server side) | Postgres + RLS access | Existing `src/lib/supabase/admin.ts` |
| `next` (App Router) | (verify against `package.json`; AGENTS.md says treat docs as authoritative) | Route handlers + cron via `vercel.json` | Existing pattern matches |

### New (to add)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `quantstats` | latest stable | Independent Sharpe reference for golden-file fixtures | P8 only — vendored as dev dep `analytics-service/requirements-dev.txt`, not prod |

**Version verification:** `[ASSUMED]` quantstats current version. The planner must run `pip index versions quantstats` and pin to a specific release before P8. Quantstats has had API drift; use `quantstats.stats.sharpe(returns, periods=365)` interface only.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain plpgsql cosine | `pgvector` + HNSW | Deferred to v2 per UC-C — statistically meaningless at N=10 |
| Edge Config / LaunchDarkly | Env var + Supabase kill-switch row | Locked decision; no new dep; founder doesn't have LaunchDarkly account |
| Sentry events API polling | Sentry webhooks → Supabase | Webhooks require Sentry Pro; cron polling works on free tier |
| `typing.Protocol` | `abc.ABC` + abstract methods | PEP 544 Protocol gives structural typing; no inheritance required for adapters; mypy-checked |
| Discriminated union RPC | One RPC per status transition | Single `transition_strategy_verification` RPC keeps the state machine in one place; easier to audit |

**Installation (P8 only):**
```bash
echo "quantstats>=0.0.62" >> analytics-service/requirements-dev.txt
pip install -r analytics-service/requirements-dev.txt
```

---

## P1 — Entry-gate docs (`route-inventory.md` + `migration-plan.md`)

**Files to create:**
- `.planning/phase-19/route-inventory.md` — completeness gate (Theme 6, Pitfall 1)
- `.planning/phase-19/migration-plan.md` — slot reservation 103–107 (the original 093–097 spec is impossible because those slots are taken)

**Existing routes to inventory.** Run from repo root:
```bash
find src/app/api -name 'route.ts' -type f | xargs grep -l 'export async function POST\|export const POST\|export async function PUT\|export async function PATCH\|export async function DELETE' 2>/dev/null
```

I have already grepped — the non-GET routes touching the 6 sentinel tables are:

| Route file | Method | Touches | Maps to flow_type | Notes |
|------------|--------|---------|-------------------|-------|
| `src/app/api/verify-strategy/route.ts` | POST | `verification_requests` (rate-limit count + UPDATE public_token, L66 + L114-117) | `teaser` | **Public unauthenticated**; CSRF + IP rate limit; existing call to `verifyStrategy()` analytics-client wrapper |
| `src/app/api/verify-strategy/[id]/status/route.ts` | GET | `verification_requests` (SELECT only) | (read-only — out of scope for thin adapter, but moves to VIEW-read in shim) | Public token-gated read |
| `src/app/api/keys/validate-and-encrypt/route.ts` | POST | `api_keys` (writes encrypted blob) | `onboard` (validate-only step) | `withAuth` user-scoped; calls `validateKey` + `encryptKey` analytics-client wrappers |
| `src/app/api/strategies/finalize-wizard/route.ts` | POST | `strategies` + `api_keys` (last_sync_at touch via `after()`) | `onboard` (finalize step) | Force-refresh live permissions probe at L60-86; calls `finalize_wizard_strategy` RPC |
| `src/app/api/keys/sync/route.ts` | POST | `compute_jobs` + `strategy_analytics` | `resync` | Two execution paths via `USE_COMPUTE_JOBS_QUEUE` flag — Phase 19 retires the legacy `after()` path |
| `src/app/api/factsheet/[id]/pdf/route.ts` | GET | `strategies` + `strategy_analytics` (SELECT only) | `internal_report` | Cron + public IP rate limit; bypass via `x-internal-token` for cron callers; PDF generation is the "read" arm — does not produce a `strategy_verifications` write but should consume one |
| `src/app/api/strategies/csv-validate/route.ts` | POST | (no DB write — validate-only) | `csv` (validate step) | Phase 15 ships this; Phase 19 absorbs it into `IngestionAdapter.validate` |
| `src/app/api/strategies/csv-finalize/route.ts` | POST | `strategies` + `strategy_verifications` (via `finalize_csv_strategy` RPC) | `csv` (finalize step) | Phase 15 already at `strategy_verifications.status='validated'` |
| `src/app/api/strategies/draft/route.ts` | POST/PUT | `strategies` (draft step) | (out of scope — pre-validation draft) | Wizard step 1; not a key-submission |
| `src/app/api/strategies/draft/[id]/route.ts` | PATCH/DELETE | `strategies` (draft mutation) | (out of scope) | Same |
| `src/app/api/strategies/create-with-key/route.ts` | POST | `strategies` + `api_keys` (legacy create-with-key) | (out of scope — pre-wizard legacy; deprecated, slated for removal post-Phase 19) | Document explicit "out of scope, rationale: deprecated" |
| `src/app/api/strategies/browse/route.ts` | GET | `strategies` (read) | (out of scope) | Public marketplace read |
| `src/app/api/portfolio-strategies/alias/route.ts` | POST | `portfolio_strategies` (alias write) | (out of scope) | Allocator-side; not key-submission |
| `src/app/api/cron/reconcile-strategies/route.ts` | GET | `compute_jobs` (enqueue reconcile) | (out of scope — cron, not user) | Cron path |
| `src/app/api/keys/[id]/permissions/route.ts` | POST | `api_keys` (probe) | (out of scope — internal probe, not submission) | Server-to-server only |

**Theme 6 / Pitfall 1 / 4th-orphan-path mitigation format:** every row in `route-inventory.md` MUST carry one of:
- `flow_type=teaser|onboard|internal_report|csv|resync` — explicit unification target
- `out of scope, rationale: <one-line reason>` — explicit refusal with auditable reason

The plan-checker grep at Phase 19 entry asserts every non-GET row matches the regex `(flow_type=(teaser|onboard|internal_report|csv|resync))|out of scope, rationale: .{10,}`. The list above suggests **5 in-scope unification targets** + **2 explicit out-of-scope** for the deprecated and read-only siblings — covering the autoplan's claim of "5 entry routes" and explicitly accounting for the 4th-orphan path risk.

**`migration-plan.md` slot reservation table (verbatim format):**

```markdown
| Slot | Title | Phase 19 Plan | Required For |
|------|-------|---------------|--------------|
| 103 | strategy_verifications state-machine extensions + transition_strategy_verification RPC | P2 | BACKBONE-03 (state-machine) + P4 router pipeline |
| 104 | wizard_session_id UNIQUE INDEX + compute_jobs.kind='process_key_long' + claim_compute_jobs_with_priority adds unified_backbone_at_claim metadata + feature_flags kill-switch table | P2 | BACKBONE-08 + BACKBONE-09 + BACKBONE-05 + drain semantics |
| 105 | strategies.fingerprint JSONB + partial index + compute_similarity() SQL function | P2 | FINGERPRINT-01 + FINGERPRINT-02 |
| 106 | VIEW-shim step (a): repoint verify-strategy/route.ts:115 UPDATE to strategy_verifications BEFORE rename | P5 (commit a) | BACKBONE-04 |
| 107 | VIEW-shim step (d): rename old verification_requests to verification_requests_legacy + CREATE VIEW + INSTEAD OF read-only triggers | P5 (commit d) | BACKBONE-04 |
```

The original autoplan reserved 093–097, but those (and 098–102) are taken:
- 093 = `strategy_verifications` (Phase 15 / CSV-01)
- 094 = `strategy_verifications` RLS polish
- 095–097 = NOT YET ASSIGNED in the codebase listing — but `migration-drift-resolution.md` (Phase 16 prep) consumed those slots in absentia
- 098 = `resend_message_correlation`
- 099 = `mark_compute_job_atomic_status_bridge`
- 100 = `strategies_source_csv`
- 101 = `partner_tag_check_constraint`
- 102 = `sync_trades_preserve_fills`

`[VERIFIED: ls supabase/migrations/]` Latest is 102; 103–107 are the next 5 sequential slots.

---

## P2 — Migrations 103–107 (concrete DDL)

### Migration 103 — strategy_verifications state-machine RPC + extra columns

`[VERIFIED: 093-strategy_verifications.sql]` Migration 093 already created the table with status CHECK admitting all 6 states (`draft → validated → metrics_captured → encrypted → report_queued → published`). The Phase 15 path only writes `validated`. Migration 103 must:

1. **Add `transitions` lookup table** (or static array CHECK) — defines legal `(from_status, to_status)` pairs:
   - `draft → validated`
   - `validated → metrics_captured`
   - `metrics_captured → encrypted`
   - `encrypted → report_queued`
   - `report_queued → published`
   - `* → draft` (only when `errors IS NOT NULL` — restart path)

2. **Add `transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now()`** column to `strategy_verifications`. Updated by RPC. `metrics_snapshot` and `errors` columns already exist (per 093).

3. **Add `encrypted_credentials JSONB`** column (NULL allowed; populated only at `encrypted` state for API flows; always NULL for `csv`).

4. **Ship `transition_strategy_verification(verification_id UUID, new_status TEXT, metadata JSONB DEFAULT NULL) RETURNS JSONB`** SECURITY DEFINER RPC:
   - Atomic: `SELECT … FOR UPDATE` on the row.
   - Reads current `status`, `metrics_snapshot`, `errors`, `encrypted_credentials`.
   - Asserts `(current_status, new_status)` is in the legal-transitions set; `RAISE EXCEPTION USING ERRCODE='22023'` otherwise.
   - Merges `metadata` keys (`metrics_snapshot`, `errors`, `encrypted_credentials`, `correlation_id`) into respective columns via JSONB ops.
   - `UPDATE … SET status=new_status, transitioned_at=now()`.
   - Returns the resulting row as JSONB so the caller doesn't need a follow-up SELECT.

5. **Self-verifying DO block** (mirror 093 STEP 7 shape): assert RPC exists, has 3 args, returns JSONB, search_path is set to `public, pg_temp`.

6. **Comments** on RPC pinning Phase 19 / BACKBONE-03 attribution and "single source of truth — adapter MUST NOT direct-UPDATE status."

**Rollback semantics:** drop RPC, drop `transitioned_at` + `encrypted_credentials` columns. Existing rows preserved (no DELETE). Phase 15 finalize_csv_strategy RPC continues working because it INSERTs a fresh `validated` row that ignores `transitioned_at` (uses DEFAULT now()).

### Migration 104 — `wizard_session_id` UNIQUE + `process_key_long` registration + drain semantics + kill-switch

This is the heaviest migration; consider splitting into 104a (idempotency + kind enum) and 104b (drain RPC) if the planner judges complexity warrants it. Single migration recommended for atomic apply.

1. **`wizard_session_id` UNIQUE INDEX** (BACKBONE-08):
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_wizard_session_id_unique_idx
     ON strategy_verifications (wizard_session_id)
     WHERE wizard_session_id IS NOT NULL;
   ```
   Partial index handles the Phase 15 path which leaves wizard_session_id NULL on early CSV finalize. **Caveat:** migration 093 lines 80-84 declare `wizard_session_id UUID NOT NULL` — verify with `\d+ strategy_verifications` whether it's actually NOT NULL on the live test project; if so, drop the partial predicate. `[VERIFIED: 093 line 80]` it is NOT NULL → use plain `CREATE UNIQUE INDEX … (wizard_session_id);` without the WHERE.

2. **`compute_jobs.kind` CHECK widening** (BACKBONE-09):
   ```sql
   ALTER TABLE compute_jobs DROP CONSTRAINT compute_jobs_kind_check;
   ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (kind IN (
     'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
     'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
     'rescore_allocator', 'poll_allocator_positions',
     'reconstruct_allocator_history', 'refresh_allocator_equity_daily',
     'process_key_long'   -- Phase 19 / BACKBONE-09
   ));
   ```
   `[VERIFIED]` exact existing kinds list against `services/job_worker.py:9-17` docstring + `TIMEOUT_PER_KIND` dict at L126-138 to ensure no drift.

3. **Drain semantics — extend `claim_compute_jobs_with_priority` RPC to write `unified_backbone_at_claim`** (BACKBONE-05):
   ```sql
   CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
     p_batch_size INTEGER,
     p_worker_id  TEXT,
     p_unified_backbone_active BOOLEAN DEFAULT NULL  -- NEW: caller passes effective flag value
   )
   RETURNS SETOF compute_jobs
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $$
   -- ... existing body unchanged ...
   -- After SET status='running', merge the metadata:
   -- The UPDATE clause becomes:
   UPDATE compute_jobs
      SET status = 'running',
          claimed_at = now(),
          claimed_by = p_worker_id,
          attempts = attempts + 1,
          metadata = metadata || jsonb_build_object(
            'unified_backbone_at_claim',
            CASE WHEN p_unified_backbone_active IS NULL THEN NULL
                 ELSE p_unified_backbone_active::text END
          )
   WHERE id IN (...) -- existing inner SELECT
   RETURNING *;
   $$;
   ```
   **Caveat:** the existing 086 RPC has 2 args — adding a 3rd default-NULL arg means PostgREST still resolves the old call sites (`claim_compute_jobs_with_priority(p_batch_size, p_worker_id)`). The Python `main_worker.py` dispatch loop must be updated in P6 to pass the third arg.

4. **`feature_flags` kill-switch table** (BACKBONE-05 auto-rollback target):
   ```sql
   CREATE TABLE IF NOT EXISTS feature_flags (
     flag_key   TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_by TEXT
   );
   ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
   CREATE POLICY feature_flags_service_all ON feature_flags FOR ALL
     USING (auth.role() = 'service_role')
     WITH CHECK (auth.role() = 'service_role');
   CREATE POLICY feature_flags_authenticated_select ON feature_flags FOR SELECT
     USING (true);   -- read-only for everyone; writes restricted to service-role
   INSERT INTO feature_flags (flag_key, value)
     VALUES ('process_key_unified_backbone', 'off')
     ON CONFLICT (flag_key) DO NOTHING;
   ```
   The flag-monitor cron (P7) writes to this table when threshold is breached.

5. **Self-verifying DO block:** assert UNIQUE INDEX exists, kind CHECK admits `process_key_long`, RPC has 3 args, kill-switch row exists.

**Rollback:** drop UNIQUE INDEX (safe — no other code reads it), narrow kind CHECK (requires no `process_key_long` rows in flight; verify count first), drop feature_flags table (kills auto-rollback but flags fall back to env var read).

### Migration 105 — fingerprint JSONB + partial index + `compute_similarity()`

```sql
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS fingerprint JSONB;
CREATE INDEX IF NOT EXISTS strategies_fingerprint_idx
  ON strategies (id) WHERE fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION compute_similarity(a JSONB, b JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp  -- migration 086 H-B hardening
AS $$
DECLARE
  v_a_version INT;
  v_b_version INT;
  v_a_vec NUMERIC[];
  v_b_vec NUMERIC[];
  v_dot NUMERIC := 0;
  v_norm_a NUMERIC := 0;
  v_norm_b NUMERIC := 0;
  i INT;
BEGIN
  -- Defensive: NULL OR version mismatch returns 0.0 (never errors per FINGERPRINT-02)
  IF a IS NULL OR b IS NULL THEN RETURN 0.0; END IF;
  v_a_version := (a->>'version')::INT;
  v_b_version := (b->>'version')::INT;
  IF v_a_version IS NULL OR v_b_version IS NULL OR v_a_version != v_b_version THEN
    RETURN 0.0;
  END IF;
  IF v_a_version != 1 THEN RETURN 0.0; END IF;  -- Only v1 supported in v1.0.0

  -- Concat the 5 component arrays into a 46-dim vector.
  -- jsonb_array_elements_text emits each element as text; cast to NUMERIC.
  -- Helper: recover_array(a, key) returns NUMERIC[] of fixed length.
  -- For brevity here we inline; the full implementation either:
  --   (a) loops via FOR … IN SELECT jsonb_array_elements_text(...), or
  --   (b) uses array_agg over the 5 components + array_cat.
  v_a_vec := (
    SELECT array_agg(elem::NUMERIC)
    FROM jsonb_array_elements_text(a->'trade_size_buckets') WITH ORDINALITY t(elem, ord)
    UNION ALL
    SELECT array_agg(elem::NUMERIC)
    FROM jsonb_array_elements_text(a->'hold_duration_buckets') WITH ORDINALITY t(elem, ord)
    -- … repeat for the other 3 components …
  );
  -- Same for b.

  -- Length check: both vectors must be exactly 46 floats.
  IF array_length(v_a_vec, 1) != 46 OR array_length(v_b_vec, 1) != 46 THEN
    RETURN 0.0;
  END IF;

  FOR i IN 1..46 LOOP
    v_dot   := v_dot   + v_a_vec[i] * v_b_vec[i];
    v_norm_a := v_norm_a + v_a_vec[i] * v_a_vec[i];
    v_norm_b := v_norm_b + v_b_vec[i] * v_b_vec[i];
  END LOOP;

  IF v_norm_a = 0 OR v_norm_b = 0 THEN RETURN 0.0; END IF;

  -- Cosine: dot / (sqrt(norm_a) * sqrt(norm_b)) ∈ [-1, 1]; clamp to [0, 1] for similarity
  RETURN GREATEST(0.0, LEAST(1.0, v_dot / (sqrt(v_norm_a) * sqrt(v_norm_b))))::NUMERIC(5,4);
EXCEPTION
  WHEN OTHERS THEN
    -- Defensive: any cast/type error returns 0.0 (never errors per FINGERPRINT-02)
    RETURN 0.0;
END;
$$;

REVOKE EXECUTE ON FUNCTION compute_similarity(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION compute_similarity(JSONB, JSONB) TO authenticated, service_role;
```

`[CITED: PostgreSQL 16 docs — JSON Functions and Operators]` `jsonb_array_elements_text` is the right primitive. The actual SQL above is illustrative; the planner must verify the array_agg-with-UNION-ALL form aggregates correctly (UNION ALL inside a single array_agg is non-standard; the cleaner form is one CTE per component then `v1 || v2 || v3 || v4 || v5` array concatenation). Mark this as a planner-discretion item; the algorithm is fixed but the SQL form is flexible.

**Self-verifying DO block:** assert column exists, partial index exists, function exists with `IMMUTABLE PARALLEL SAFE` flags + correct search_path. Test row insert + similarity call returning a NUMERIC in [0,1].

### Migration 106 — VIEW-shim step (a): repoint `verify-strategy/route.ts:115` UPDATE

This migration is **code-only** at the SQL layer (no schema change); it ships ALONGSIDE the route.ts repoint as commit (a) in P5. The migration file is a no-op DO block that documents the cutover — kept as a numbered migration for sequencing audit.

```sql
-- Migration 106: Phase 19 / BACKBONE-04 step (a) — sentinel-only
-- The actual change is the Next.js route handler at
-- src/app/api/verify-strategy/route.ts:114-117 changing FROM
--   .from("verification_requests").update({...})
-- TO
--   .from("strategy_verifications").update({...})
-- This migration carries no schema change; it exists so the migration
-- sequence preserves the 4-PR shim ordering for audit.
DO $$
BEGIN
  RAISE NOTICE 'Migration 106: Phase 19 BACKBONE-04 step (a) — verify-strategy/route.ts repoint sentinel.';
END
$$;
```

### Migration 107 — VIEW-shim step (d): rename + VIEW + INSTEAD OF triggers

Ships at end of Phase 19 — AFTER 7 calendar days of zero writes to old `verification_requests` table:

```sql
BEGIN;

-- 1. Rename the legacy table out of the way (keeps data + FKs)
ALTER TABLE verification_requests RENAME TO verification_requests_legacy;

-- 2. CREATE VIEW verification_requests AS SELECT … FROM strategy_verifications
-- The columns must match the OLD verification_requests shape that legacy callers expect.
-- Existing readers (verify-strategy/[id]/status/route.ts) read: id, status, public_token, expires_at, results
CREATE VIEW verification_requests AS
SELECT
  sv.id                                AS id,
  sv.errors->'email'                   AS email,    -- nested under errors metadata if needed
  sv.source                            AS exchange,
  NULL::TEXT                           AS api_key_encrypted,    -- legacy field; never read after step (a)
  NULL::TEXT                           AS api_secret_encrypted,
  NULL::TEXT                           AS passphrase_encrypted,
  NULL::TEXT                           AS dek_encrypted,
  sv.status                            AS status,
  sv.errors->>'public_token'           AS public_token,    -- moved into errors JSONB
  sv.errors->>'expires_at'             AS expires_at,
  sv.metrics_snapshot                  AS results,
  sv.created_at                        AS created_at,
  sv.transitioned_at                   AS completed_at
FROM strategy_verifications sv
WHERE sv.flow_type = 'teaser';

-- 3. Read-only enforcement: INSTEAD OF triggers reject INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION verification_requests_view_readonly_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verification_requests is now a read-only VIEW; write to strategy_verifications instead'
    USING ERRCODE='42501', HINT='See migration 107 / Phase 19 BACKBONE-04 step (d).';
END;
$$;
CREATE TRIGGER verification_requests_view_readonly_insert
  INSTEAD OF INSERT ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
CREATE TRIGGER verification_requests_view_readonly_update
  INSTEAD OF UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
CREATE TRIGGER verification_requests_view_readonly_delete
  INSTEAD OF DELETE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();

-- 4. RLS on legacy table — block all writes; keep reads for 90-day support window
ALTER TABLE verification_requests_legacy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_admin_select ON verification_requests_legacy FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));
-- Service-role reads still work via auth.role() default bypass; explicit policy not needed.

-- 5. Self-verifying DO block: assert VIEW exists, INSTEAD OF triggers exist, legacy table renamed.

COMMIT;
```

**Rollback semantics for 107:** the rename + VIEW pair is a 30-second forward migration that's hard to reverse cleanly because writes after step (d) only land in `strategy_verifications`. The 7-day stability window before 107 ships is critical; if a regression surfaces, the rollback path is:
1. Drop VIEW + INSTEAD OF triggers
2. `ALTER TABLE verification_requests_legacy RENAME TO verification_requests`
3. Re-flip the kill-switch via `UPDATE feature_flags SET value='off' WHERE flag_key='process_key_unified_backbone'`
4. Restart Vercel + Railway to clear the 30s flag cache
5. New writes resume against the legacy table

**Caveat — VIEW column mapping:** the SELECT shape above merges some legacy columns into `sv.errors` JSONB (e.g., `public_token`, `expires_at`). If the VIEW must surface them as top-level columns for the read sibling `verify-strategy/[id]/status/route.ts` to keep working, the planner must add a `public_token TEXT` and `expires_at TIMESTAMPTZ` column directly to `strategy_verifications` in migration 103 (don't bury them in JSONB). Recommend the latter — extract them as first-class columns. Mark as planner-discretion.

---

## P3 — IngestionAdapter Protocol + 4 concrete adapters

### Why `typing.Protocol` (not `abc.ABC`)

`[CITED: PEP 544]` `typing.Protocol` enables structural subtyping ("static duck typing") — adapters don't inherit from a base class, mypy verifies shape. Recommendation: **use Protocol**. Concrete adapters are normal classes with method names matching the Protocol; mypy + Protocol enforce the shape.

Mirror precedent: the existing analytics-service has no Protocol uses, but the equity-reconstruction module pattern (`run_reconstruct_allocator_history_job` registered in dispatch via dispatch dict) is the closest. Adapters are accessed by `source` lookup:

```python
# analytics-service/services/ingestion/__init__.py
from typing import Protocol, runtime_checkable

@runtime_checkable
class IngestionAdapter(Protocol):
    """Phase 19 / BACKBONE-02. Five-method pipeline contract.
    Concrete impls live in this package as okx.py / binance.py / bybit.py / csv_adapter.py.
    Routers/process_key.py orchestrates calls to these methods in sequence.
    """
    async def validate(self, req: "KeySubmissionRequest") -> "ValidationResult": ...
    async def fetch_raw(self, creds_or_file: dict) -> list["Trade"]: ...
    def compute_metrics(self, trades: list["Trade"]) -> "MetricsSnapshot": ...
    def compute_fingerprint(self, trades: list["Trade"], metrics: "MetricsSnapshot") -> "Fingerprint": ...
    async def reconstruct_positions(self, trades: list["Trade"]) -> list["Position"]: ...

ADAPTERS: dict[str, IngestionAdapter] = {}

def get_adapter(source: str) -> IngestionAdapter:
    if source not in ADAPTERS:
        raise ValueError(f"Unsupported source: {source!r}; valid: {sorted(ADAPTERS.keys())}")
    return ADAPTERS[source]
```

### Shared types — `ingestion/adapter.py`

```python
# Use pydantic BaseModel (already in repo via FastAPI) for FastAPI auto-validation,
# OR @dataclass for plain dataclasses. CONTEXT.md says "dataclasses"; matches the
# existing services/exchange.py:444 RawFill @dataclass precedent.
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

FlowType = Literal["teaser", "onboard", "internal_report", "csv", "resync"]
Source = Literal["okx", "binance", "bybit", "csv"]
TrustTier = Literal["api_verified", "csv_uploaded", "self_reported"]
Status = Literal[
    "draft", "validated", "metrics_captured",
    "encrypted", "report_queued", "published",
]

@dataclass
class KeySubmissionRequest:
    flow_type: FlowType
    source: Source
    context: dict[str, Any]   # carries credentials OR csv_blob_url, wizard_session_id, user_id

@dataclass
class ValidationResult:
    valid: bool
    read_only: bool | None        # None for CSV
    error_code: str | None        # AUTH_FAILED | PERMISSION_DENIED | RATE_LIMITED | ... (mirrors services/exchange.py:55)
    human_message: str | None     # source-of-truth: src/lib/wizardErrors.ts via Phase 17 DESIGN-05 contract
    debug_context: dict[str, Any] | None

@dataclass
class Trade:
    exchange: str
    symbol: str
    side: str
    price: float
    quantity: float
    fee: float
    fee_currency: str
    timestamp: datetime
    order_type: str
    is_fill: bool

@dataclass
class Position:
    strategy_id: str
    symbol: str
    side: str
    opened_at: datetime
    closed_at: datetime | None
    entry_price: float
    exit_price: float | None
    quantity: float
    pnl: float | None
    funding_pnl: float | None
    status: Literal["open", "closed"]
    roi: float | None
    duration_days: float | None  # NUMERIC per migration 092

@dataclass
class MetricsSnapshot:
    sharpe: float | None
    twr: float | None
    ytd: float | None
    max_drawdown: float | None
    total_pnl: float | None
    trade_count: int
    win_rate: float | None
    # ... extends current strategy_analytics shape; defer detailed schema to P8 EquityCurveBuilder

@dataclass
class Fingerprint:
    version: int = 1
    trade_size_buckets: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    hold_duration_buckets: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    asset_class_mix: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)
    instrument_concentration: tuple[float, ...] = (0.0,) * 10
    temporal_pattern: tuple[float, ...] = (0.0,) * 24

    def to_jsonb(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "trade_size_buckets": list(self.trade_size_buckets),
            "hold_duration_buckets": list(self.hold_duration_buckets),
            "asset_class_mix": list(self.asset_class_mix),
            "instrument_concentration": list(self.instrument_concentration),
            "temporal_pattern": list(self.temporal_pattern),
        }

@dataclass
class VerificationResult:
    status: Status
    trust_tier: TrustTier
    metrics_snapshot: MetricsSnapshot | None
    fingerprint: Fingerprint | None
    encrypted_credentials: dict | None
    errors: list[dict] | None    # [{code, human_message, debug_context}, ...]
    correlation_id: str
```

### OKX adapter — `ingestion/okx.py`

Wraps `services/exchange.py` (629 LOC unchanged):

```python
from services.ingestion.adapter import (
    IngestionAdapter, KeySubmissionRequest, ValidationResult,
    Trade, MetricsSnapshot, Fingerprint, Position,
)
from services import exchange as exchange_service
from services import position_reconstruction
from services.encryption import encrypt_credentials, get_kek

class OkxAdapter:
    SOURCE = "okx"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # context carries: api_key, api_secret, passphrase
        creds = req.context
        ex = exchange_service.create_exchange(
            "okx",
            creds["api_key"], creds["api_secret"], creds.get("passphrase"),
        )
        try:
            result = await exchange_service.validate_key_permissions(ex)
            return ValidationResult(
                valid=result["valid"],
                read_only=result["read_only"],
                error_code=result["error_code"],
                human_message=result["error"],
                debug_context={"markers": {
                    "markets_loaded": result["markets_loaded"],
                    "probe_error": result.get("probe_error"),
                }} if not result["valid"] else None,
            )
        finally:
            await ex.close()

    async def fetch_raw(self, creds_or_file: dict) -> list[Trade]:
        # Wraps services.exchange.fetch_raw_trades for the OKX path.
        ex = exchange_service.create_exchange(
            "okx",
            creds_or_file["api_key"], creds_or_file["api_secret"],
            creds_or_file.get("passphrase"),
        )
        try:
            raw = await exchange_service._fetch_raw_trades_okx(ex, since_ms=None)
            return [Trade(**_normalize_trade(r)) for r in raw]
        finally:
            await ex.close()

    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot:
        # Delegates to P8's EquityCurveBuilder — see §P8.
        from services.equity_reconstruction import EquityCurveBuilder
        return EquityCurveBuilder(trades).to_metrics_snapshot()

    def compute_fingerprint(self, trades: list[Trade], metrics: MetricsSnapshot) -> Fingerprint:
        # Delegates to P9.
        from services.ingestion.fingerprint import compute_fingerprint_v1
        return compute_fingerprint_v1(trades, metrics)

    async def reconstruct_positions(self, trades: list[Trade]) -> list[Position]:
        # BACKBONE-09 reuse: existing position_reconstruction.reconstruct_positions
        # takes (strategy_id, supabase). Phase 19 wraps with a pure-trades variant
        # that does not require DB write — see P8.
        from services.equity_reconstruction import EquityCurveBuilder
        builder = EquityCurveBuilder(trades)
        return builder.reconstruct_positions()
```

Binance + Bybit adapters follow the same pattern, swapping `_fetch_raw_trades_okx` → `_fetch_raw_trades_binance` / `_fetch_raw_trades_bybit` per `services/exchange.py:484-719`.

### CSV adapter — `ingestion/csv_adapter.py`

```python
class CsvAdapter:
    SOURCE = "csv"

    async def validate(self, req: KeySubmissionRequest) -> ValidationResult:
        # context carries: csv_blob_url OR raw_bytes, fmt ∈ {daily_returns, daily_nav, trades}
        from services import csv_validator
        try:
            df = csv_validator.parse_csv(req.context["raw_bytes"], req.context["fmt"])
            csv_validator.validate_schema(df, req.context["fmt"])
            return ValidationResult(
                valid=True, read_only=None,  # N/A for CSV
                error_code=None, human_message=None, debug_context=None,
            )
        except csv_validator.CsvValidationError as e:
            return ValidationResult(
                valid=False, read_only=None,
                error_code=e.code, human_message=e.human_message,
                debug_context={"violations": e.violations},
            )

    async def fetch_raw(self, creds_or_file: dict) -> list[Trade]:
        # Parse CSV into Trade list — only the 'trades' fmt produces fill-level
        # data; daily_returns / daily_nav produce daily-PnL pseudo-trades.
        from services import csv_validator
        df = csv_validator.parse_csv(creds_or_file["raw_bytes"], creds_or_file["fmt"])
        return csv_validator.df_to_trades(df, creds_or_file["fmt"])

    def compute_metrics(self, trades): ...
    def compute_fingerprint(self, trades, metrics): ...

    async def reconstruct_positions(self, trades):
        # CSV v0 limitation: open positions assumed flat at upload time.
        # No mark-price fetch, no funding accumulation. Documented per CONTEXT.md.
        return []  # TODO: add a ReconstructionWarning to MetricsSnapshot
```

### Adapter registration

`ingestion/__init__.py`:
```python
from .okx import OkxAdapter
from .binance import BinanceAdapter
from .bybit import BybitAdapter
from .csv_adapter import CsvAdapter

ADAPTERS = {
    "okx": OkxAdapter(),
    "binance": BinanceAdapter(),
    "bybit": BybitAdapter(),
    "csv": CsvAdapter(),
}
```

### Gotchas

- **CSV adapter has no broker creds** — `validate()` reads `req.context["raw_bytes"]`, NOT `api_key`/`api_secret`. Adapter signature is uniform but the schema discriminates on `req.flow_type == "csv"` vs API flows.
- **Adapters MUST close ccxt exchanges in `finally:`** — every API path opens a CCXT instance that holds an httpx pool. The existing `services/exchange.py` wrappers all use try/finally; replicate the pattern.
- **Bybit quirks already patched** in `services/exchange.py:35-46` (fetchCurrencies disable). Adapter wraps, doesn't rewrite — DO NOT re-patch the quirk.
- **Validation result `human_message` source-of-truth is `src/lib/wizardErrors.ts`** per Phase 17 DESIGN-05 contract. The adapter returns the existing `error_code` enum from `validate_key_permissions` (AUTH_FAILED, PERMISSION_DENIED, RATE_LIMITED, etc.); the Next.js error envelope at the route boundary does the lookup against `wizardErrors.ts`. Adapter should NOT hard-code human messages.

---

## P4 — `POST /process-key` router

### File: `analytics-service/routers/process_key.py`

```python
"""Phase 19 / BACKBONE-01 — unified key-submission RPC.

Wraps the IngestionAdapter Protocol (BACKBONE-02) and the strategy_verifications
state-machine RPC (BACKBONE-03 / migration 103). Auth via INTERNAL_API_TOKEN
(constant-time compare; mirrors routers/internal.py:117).

Two execution modes:
  - SYNCHRONOUS (default for csv flow_type and short-history API flows):
    Runs the full 5-method pipeline inline, returns VerificationResult.
  - QUEUED (for resync + onboard with multi-year history):
    Returns {queued, correlation_id} synchronously; enqueues a
    process_key_long compute_job; worker writes the result back to
    strategy_verifications. See BACKBONE-09.
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.db import get_supabase
from services.feature_flags import is_unified_backbone_active
from services.ingestion import get_adapter
from services.ingestion.adapter import (
    KeySubmissionRequest, VerificationResult,
)

router = APIRouter(prefix="/process-key", tags=["process-key"])
log = structlog.get_logger("quantalyze.analytics.process_key")


class _ProcessKeyBody(BaseModel):
    flow_type: str = Field(..., pattern=r"^(teaser|onboard|internal_report|csv|resync)$")
    source: str = Field(..., pattern=r"^(okx|binance|bybit|csv)$")
    context: dict[str, Any]


def _verify_internal_token(request: Request) -> None:
    """Mirror routers/internal.py:104-118 — constant-time compare on Authorization header."""
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        log.error("INTERNAL_API_TOKEN not set", path="/process-key")
        raise HTTPException(status_code=403, detail="Internal API not configured")
    auth = request.headers.get("Authorization", "")
    # Accept both "Bearer <token>" and bare token for flexibility.
    if auth.startswith("Bearer "):
        provided = auth[len("Bearer ") :]
    else:
        provided = auth
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


@router.post("")
async def process_key(req: Request, body: _ProcessKeyBody) -> dict:
    _verify_internal_token(req)
    correlation_id = req.headers.get("X-Correlation-Id", "")
    started_at = time.monotonic()

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        flow_type=body.flow_type,
        source=body.source,
    )
    log.info("process_key.start")

    # Drain semantics — read kill-switch + env var. Cached 30s in services.feature_flags.
    flag_active = await is_unified_backbone_active()
    if not flag_active:
        log.info("process_key.flag_off — bouncing to legacy adapter")
        # Legacy fallback: 503 with retry-after, OR caller-side pre-check
        # (Next.js feature-flags.ts SHOULD do this gating; FastAPI is defense-in-depth)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "UNIFIED_BACKBONE_DISABLED",
                "human_message": "Unified backbone is disabled; legacy route should handle.",
                "correlation_id": correlation_id,
            },
        )

    # ---- short-history (synchronous) path ----
    request = KeySubmissionRequest(
        flow_type=body.flow_type,
        source=body.source,
        context=body.context,
    )
    supabase = get_supabase()

    # 1) Idempotency check (BACKBONE-08): wizard_session_id UNIQUE INDEX.
    wizard_session_id = body.context.get("wizard_session_id")
    if wizard_session_id:
        existing = supabase.table("strategy_verifications").select("*").eq(
            "wizard_session_id", wizard_session_id
        ).maybe_single().execute()
        if existing.data:
            log.info("process_key.idempotent_hit", verification_id=existing.data["id"])
            return {"verification_id": existing.data["id"], "status": existing.data["status"]}

    # 2) Insert draft row (status='draft') with FK to strategy_id (which the
    # caller must have created via wizard or csv-finalize flow).
    strategy_id = body.context["strategy_id"]
    draft_insert = supabase.table("strategy_verifications").insert({
        "strategy_id": strategy_id,
        "wizard_session_id": wizard_session_id,
        "status": "draft",
        "trust_tier": "csv_uploaded" if body.source == "csv" else "api_verified",
        "flow_type": body.flow_type,
        "source": body.source,
        "correlation_id": correlation_id,
    }).execute()
    verification_id = draft_insert.data[0]["id"]

    # 3) Long-fetch dispatch — onboard + multi-year history → enqueue process_key_long.
    if _is_long_fetch(body):
        supabase.rpc("enqueue_compute_job", {
            "p_strategy_id": strategy_id,
            "p_kind": "process_key_long",
            "p_metadata": {
                "correlation_id": correlation_id,
                "verification_id": verification_id,
                "flow_type": body.flow_type,
                "source": body.source,
            },
        }).execute()
        log.info("process_key.queued")
        return {"queued": True, "correlation_id": correlation_id, "verification_id": verification_id}

    # 4) Synchronous pipeline — IngestionAdapter 5 methods.
    adapter = get_adapter(body.source)

    # validate
    val = await adapter.validate(request)
    if not val.valid:
        supabase.rpc("transition_strategy_verification", {
            "p_verification_id": verification_id,
            "p_new_status": "draft",
            "p_metadata": {"errors": [{"code": val.error_code, "human_message": val.human_message}]},
        }).execute()
        return _envelope_error(val.error_code, val.human_message, correlation_id, verification_id)

    supabase.rpc("transition_strategy_verification", {
        "p_verification_id": verification_id, "p_new_status": "validated", "p_metadata": {},
    }).execute()

    # fetch_raw
    trades = await adapter.fetch_raw(body.context)

    # compute_metrics
    metrics = adapter.compute_metrics(trades)
    supabase.rpc("transition_strategy_verification", {
        "p_verification_id": verification_id, "p_new_status": "metrics_captured",
        "p_metadata": {"metrics_snapshot": _metrics_to_jsonb(metrics)},
    }).execute()

    # encrypt_credentials (API path only)
    encrypted = None
    if body.source != "csv":
        from services.encryption import encrypt_credentials, get_kek
        encrypted = encrypt_credentials(
            body.context["api_key"], body.context["api_secret"],
            body.context.get("passphrase"), get_kek(),
        )
        supabase.rpc("transition_strategy_verification", {
            "p_verification_id": verification_id, "p_new_status": "encrypted",
            "p_metadata": {"encrypted_credentials": encrypted},
        }).execute()
    else:
        # CSV path skips encrypt; jump from metrics_captured → report_queued
        supabase.rpc("transition_strategy_verification", {
            "p_verification_id": verification_id, "p_new_status": "encrypted",  # legal even for csv
            "p_metadata": {},
        }).execute()

    # compute_fingerprint
    fp = adapter.compute_fingerprint(trades, metrics)
    supabase.table("strategies").update({"fingerprint": fp.to_jsonb()}).eq(
        "id", strategy_id
    ).execute()

    supabase.rpc("transition_strategy_verification", {
        "p_verification_id": verification_id, "p_new_status": "report_queued", "p_metadata": {},
    }).execute()

    # reconstruct_positions (BACKBONE-09 wiring) — runs after report_queued
    # because positions are a derived view; trades are the SoT.
    positions = await adapter.reconstruct_positions(trades)
    # Persist positions via existing position_reconstruction primitives.
    # ... (see P8) ...

    # Final transition
    supabase.rpc("transition_strategy_verification", {
        "p_verification_id": verification_id, "p_new_status": "published", "p_metadata": {},
    }).execute()

    duration_ms = int((time.monotonic() - started_at) * 1000)
    log.info("process_key.complete", verification_id=verification_id, duration_ms=duration_ms)

    return {
        "verification_id": verification_id,
        "status": "published",
        "trust_tier": "csv_uploaded" if body.source == "csv" else "api_verified",
        "metrics_snapshot": _metrics_to_jsonb(metrics),
        "fingerprint": fp.to_jsonb(),
        "encrypted_credentials": encrypted,
        "errors": [],
        "correlation_id": correlation_id,
    }


def _is_long_fetch(body: _ProcessKeyBody) -> bool:
    """Heuristic: onboard flows for OKX/Binance/Bybit are long-fetch
    (multi-year backfill). teaser + csv + internal_report = synchronous.
    resync triggers worker dispatch via existing route.
    """
    if body.flow_type == "csv":
        return False
    if body.flow_type == "teaser":
        return False
    if body.flow_type == "internal_report":
        return False
    return True   # onboard + resync via worker


def _envelope_error(code: str | None, msg: str | None, cid: str, vid: str) -> dict:
    """Phase 17 DESIGN-05 envelope shape."""
    return {
        "ok": False,
        "code": code or "UNKNOWN",
        "human_message": msg or "Unknown error",
        "debug_context": {"verification_id": vid},
        "correlation_id": cid,
        "recoverable": code in {"RATE_LIMITED", "EXCHANGE_UNAVAILABLE", "NETWORK_UNAVAILABLE"},
    }


def _metrics_to_jsonb(m) -> dict:
    return {k: v for k, v in m.__dict__.items()}
```

### Register in `main.py:211` AFTER `csv.router`

```python
# main.py L211 area
app.include_router(csv.router)
# Phase 19 / BACKBONE-01 — unified key-submission backbone
from routers import process_key as process_key_router  # noqa: E402
app.include_router(process_key_router.router)
```

### Worker handler — `run_process_key_long_job(job)` in `services/job_worker.py`

`[VERIFIED: services/job_worker.py:486-707]` Pattern: existing `run_sync_trades_job` is the closest analog. Add to the dispatch dict at L1576-1604 alongside other kinds:

```python
elif kind == "process_key_long":
    handler = run_process_key_long_job
```

The handler reads `job.metadata['unified_backbone_at_claim']` (NOT live env var) per drain semantics. It then calls the same adapter pipeline as the synchronous router; the only difference is the result is written back to `strategy_verifications` instead of returned to the caller. Add corresponding `TIMEOUT_PER_KIND` entry: `"process_key_long": 30 * 60` (30 min — supports OKX 90-day archive paginate).

### Gotchas

- **`structlog.contextvars.bind_contextvars`** is the right binding API for the request-scoped `correlation_id` (per `services/logging_config.py` precedent). Don't use `structlog.get_logger().bind(...)` — that gives a new logger, not contextvars.
- **Sentry capture is automatic** via `sentry-sdk[fastapi]==2.58.0` integration. The `before_send` hook in `sentry_init.py` already runs `redact.py`. New code must NOT call `sentry_sdk.capture_exception` manually — let the FastAPI integration capture, with structured log context piggybacking.
- **`secrets.compare_digest`** mirrors `routers/internal.py:117`. Use the same shape.
- **Idempotency via `wizard_session_id`** — when a UNIQUE-INDEX violation surfaces (SQLSTATE 23505), the caller should fetch the existing row and return it. The pre-check above handles the common case; the post-INSERT race is handled by an exception block (omitted for brevity — see Pitfall 2 below).
- **Drain semantics for synchronous calls** — the `is_unified_backbone_active()` check at the top is FINE for sync (no work has started). For queued jobs, the worker reads the metadata snapshot taken at claim time; sync vs queued is the boundary the planner must enforce.

---

## P5 — Next.js thin adapters + VIEW-shim 4-PR sequence

### Feature flag read seam — `src/lib/feature-flags.ts` (NEW)

```typescript
import { createAdminClient } from "@/lib/supabase/admin";

const CACHE_TTL_MS = 30_000;
let _cache: { value: boolean; expiresAt: number } | null = null;

export async function isUnifiedBackboneActive(): Promise<boolean> {
  // Phase 19 / BACKBONE-05. Reads Supabase kill-switch row first, falls back
  // to PROCESS_KEY_UNIFIED_BACKBONE env var. 30-second cache.
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;

  // 1) Kill-switch row check (Supabase). If 'off', force OFF regardless of env.
  let killSwitchOff = false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("feature_flags")
      .select("value")
      .eq("flag_key", "process_key_unified_backbone")
      .maybeSingle();
    if (data?.value === "off") killSwitchOff = true;
  } catch (err) {
    // Failure to read kill-switch: fall through to env var. Don't block on Supabase outage.
    console.warn("[feature-flags] kill-switch read failed:", err);
  }

  // 2) Env var (default OFF for safety until Phase 19 enabling commit).
  const envValue = process.env.PROCESS_KEY_UNIFIED_BACKBONE === "on";

  const value = envValue && !killSwitchOff;
  _cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function _resetCacheForTests(): void { _cache = null; }
```

### Thin adapter pattern — example for `keys/sync/route.ts`

The 5 routes become near-identical thin proxies:

```typescript
// src/app/api/keys/sync/route.ts (Phase 19 thin-adapter form)
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { getCorrelationId } from "@/lib/correlation-id";

const ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;

export const maxDuration = 300;

export const POST = withAuth(async (req: NextRequest, user) => {
  const { strategy_id, wizard_session_id } = await req.json();

  // Phase 19 / BACKBONE-05 — gate behind flag.
  if (!(await isUnifiedBackboneActive())) {
    // Legacy path: keep the existing route.ts L43-213 body unchanged
    // until the 7-day window passes. After 100% rollout proves stable, the
    // legacy block is deleted in a follow-up cleanup PR (out of v1.0.0 scope).
    return await legacyKeysSyncHandler(req, user);
  }

  // Unified backbone delegation
  const correlationId = await getCorrelationId();
  const res = await fetch(`${ANALYTICS_URL}/process-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${INTERNAL_TOKEN}`,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify({
      flow_type: "resync",
      source: "okx",   // TODO: derive from strategies.api_keys.exchange via SELECT
      context: { strategy_id, wizard_session_id, user_id: user.id },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status });
  }
  return NextResponse.json(await res.json());
});

async function legacyKeysSyncHandler(req: NextRequest, user: any): Promise<NextResponse> {
  // ... existing route.ts L46-213 body verbatim ...
}
```

The same shape applies to:
- `verify-strategy/route.ts` → flow_type=teaser, source=okx|binance|bybit
- `keys/validate-and-encrypt/route.ts` → flow_type=onboard, source from request
- `strategies/finalize-wizard/route.ts` → flow_type=onboard (finalize step), source from strategies.api_keys join
- `factsheet/[id]/pdf/route.ts` → READS `strategy_verifications` via the VIEW; no /process-key call from this route

### 4-PR VIEW-shim sequence (commits within P5 single plan)

| Commit | Title prefix | Scope |
|--------|--------------|-------|
| (a) | `phase-19-shim-step-a:` | Migration 106 (sentinel) + repoint `verify-strategy/route.ts:115` UPDATE from `verification_requests` to `strategy_verifications`. Test: existing verify-strategy/route.test.ts updated to assert the .from("strategy_verifications") string is present. |
| (b) | `phase-19-shim-step-b:` | Flag flip — `PROCESS_KEY_UNIFIED_BACKBONE=on` set on Vercel + Railway production. NO code changes; commit body documents env-var rollout. Optionally include `vercel env add` in scripts/. |
| (c) | `phase-19-shim-step-c:` | Verification — 24h after step (b), founder runs `scripts/verify-no-legacy-writes.sh` (NEW: greps Supabase audit log + Sentry events for any write to `verification_requests` table since flag-flip). Commit message records the verification timestamp + zero-writes evidence link. |
| (d) | `phase-19-shim-step-d:` | Migration 107 — rename + VIEW + INSTEAD OF triggers. Old table becomes read-only; legacy reads via VIEW pass through to strategy_verifications. |

**Plan-checker enforcement:** the planner adds a CI script `scripts/check-phase-19-shim-commits.sh` that:
```bash
git log --format='%s' phase-19-start..HEAD | \
  grep -c '^phase-19-shim-step-[abcd]:' || \
  (echo "Phase 19 shim commits malformed" && exit 1)
```
This must run as part of the Phase 19 exit gate (per BACKBONE-04 plan-checker rule).

### Gotchas

- **CSV escape-hatch routes (`csv-validate`, `csv-finalize`) are already thin** post-Phase 15. P5 only needs to re-route their internal target from analytics-service `/csv/validate` to `/process-key` with `flow_type='csv'`.
- **`factsheet/[id]/pdf/route.ts` is a READ-side route** (GET). It does NOT call `/process-key`. The VIEW shim must surface its read columns correctly (see migration 107 caveat).
- **`getCorrelationId()` from `@/lib/correlation-id`** automatically threads the inbound `x-correlation-id` header; no special handling needed.
- **`isUnifiedBackboneActive()` does a Supabase round-trip every 30s** — that's ~1 RPC call/req on a hot path. Acceptable; the cache hit ratio is ~99.9% at sustained traffic. If pathological, the planner can move to an in-process global with EventEmitter-based invalidation, but UC-locked decision is the simple cache.
- **Banned packages reminder:** none of the 5 entry routes use axios — they all use native `fetch()`. Continue that pattern.

---

## P6 — `wizard_session_id` idempotency + `process_key_long` dispatch

### `wizard_session_id` UNIQUE INDEX shape

`[VERIFIED: 093 line 80]` `wizard_session_id UUID NOT NULL` already on `strategy_verifications`. Migration 104:

```sql
CREATE UNIQUE INDEX strategy_verifications_wizard_session_id_unique_idx
  ON strategy_verifications (wizard_session_id);
```

(Plain UNIQUE, not partial — column is NOT NULL.)

### Dispatch pattern via existing `job_worker.py`

`[VERIFIED: services/job_worker.py:1576-1604]` The dispatch loop currently has 11 kind handlers. Add `process_key_long`:

```python
# services/job_worker.py L126 area
TIMEOUT_PER_KIND: dict[str, float] = {
    # ... existing entries ...
    "process_key_long": 30 * 60,   # Phase 19 / BACKBONE-09 — supports 90-day OKX archive
}

# L1604 area — add to dispatch chain
elif kind == "process_key_long":
    from services.ingestion.long_fetch import run_process_key_long_job
    handler = run_process_key_long_job
```

New file `analytics-service/services/ingestion/long_fetch.py`:

```python
async def run_process_key_long_job(job: dict) -> "DispatchResult":
    """Phase 19 / BACKBONE-09. Worker handler for queued /process-key calls.

    Reads job.metadata for the captured flag value (drain semantics) and the
    correlation_id; runs the same adapter pipeline as routers/process_key.py;
    writes VerificationResult back to strategy_verifications via
    transition_strategy_verification RPC.
    """
    from services.job_worker import DispatchOutcome, DispatchResult
    metadata = job.get("metadata") or {}
    verification_id = metadata.get("verification_id")
    flow_type = metadata.get("flow_type")
    source = metadata.get("source")
    correlation_id = metadata.get("correlation_id")
    flag_at_claim = metadata.get("unified_backbone_at_claim")  # set by claim RPC

    # Drain check: if flag was 'false' at claim, this job was claimed in
    # the legacy era and shouldn't re-enter the unified path.
    if flag_at_claim == "false":
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="process_key_long: claimed under legacy backbone; legacy worker should handle.",
            error_kind="permanent",
        )

    # ... adapter pipeline (mirror routers/process_key.py POST handler) ...
    # ... transition_strategy_verification RPC at each step ...
```

### How PR #53 worker dyno picks up the job

`[VERIFIED: main.py:84-86, 109-114]` The dispatch loop is a background asyncio task in the FastAPI process (PR #53 merged the worker into main.py via `lifespan`); it polls `claim_compute_jobs_with_priority` every few seconds and calls `dispatch(job)` per claimed row. No new infrastructure; `process_key_long` rides the existing claim → dispatch → mark_done/mark_failed cycle.

### Gotchas

- **Migration 104 widens `compute_jobs_kind_check`** — must DROP and recreate, not ALTER ADD. PostgreSQL doesn't support extending a CHECK constraint; only replacing.
- **Idempotency at SQL layer + at route layer.** Even with the UNIQUE INDEX, a fast double-submit can race between SELECT and INSERT. Pattern: catch `23505` SQLSTATE on INSERT failure, then SELECT the existing row by `wizard_session_id` and return. Phase 02 `compute_jobs.idempotency_key` precedent (CONTEXT.md) — use the same try/catch shape.
- **Worker timeout 30 min** is a safety ceiling, not a target. OKX archive backfill can take ~10 min on 2 years of trades; 30 min handles the long tail (Bybit + funding fetch on a noisy account).

---

## P7 — Flag-monitor cron + drain semantics

### Sentry events API client

`[ASSUMED]` Sentry's events API requires `SENTRY_AUTH_TOKEN` (org-scoped, `event:read`). Endpoint pattern:
```
GET https://sentry.io/api/0/organizations/{org_slug}/events/?statsPeriod=15m&query=correlation_id:* path:/api/process-key level:error&field=count()
```

Returns JSON: `{ "data": [ { "count": <int> } ], "meta": {...} }`.

**The team must verify** the exact endpoint path + query syntax against Sentry's current docs before P7 ships — Sentry's API has changed shape twice since the GA Events API in 2023. Use Context7 lookup for "sentry events api organizations":

```bash
mcp__context7__resolve-library-id with libraryName="sentry api"
# ... then mcp__context7__get-library-docs with topic="events api query"
```

Use `httpx.AsyncClient` (already in repo). Fallback: if Sentry is unreachable, the cron logs WARN and exits without flipping; alert via sentry-sdk's own self-monitoring tag.

### Cron route — `/api/cron/flag-monitor/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
const SENTRY_ORG = process.env.SENTRY_ORG_SLUG;
const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN;

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Tumbling 15-min window: aligned to wall-clock (e.g., 14:00–14:15).
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

  // 1) Numerator: error events from Sentry
  const sentryUrl = `https://sentry.io/api/0/organizations/${SENTRY_ORG}/events/`;
  const params = new URLSearchParams({
    statsPeriod: "15m",
    query: "level:error path:/api/process-key correlation_id:*",
    field: "count()",
  });
  const sentryRes = await fetch(`${sentryUrl}?${params}`, {
    headers: { Authorization: `Bearer ${SENTRY_TOKEN}` },
  });
  if (!sentryRes.ok) {
    console.warn("[cron/flag-monitor] sentry events fetch failed:", sentryRes.status);
    return NextResponse.json({ ok: false, reason: "sentry_unreachable" });
  }
  const sentryData = await sentryRes.json();
  const errorCount: number = sentryData?.data?.[0]?.count ?? 0;

  // 2) Denominator: total /process-key correlation_ids in same window from
  // Supabase audit row. Phase 19 must add an audit-log row at the entry of
  // every /process-key call (P4 router instrumentation).
  const { count: totalCount } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "process_key")
    .gte("created_at", windowStart.toISOString());

  const total = totalCount ?? 0;
  const errorRate = total > 0 ? errorCount / total : 0;

  // 3) Threshold: 0.5% in 15-min window
  if (errorRate > 0.005 && total >= 20 /* min sample for stat reliability */) {
    // Flip the kill-switch row
    await admin.from("feature_flags").upsert({
      flag_key: "process_key_unified_backbone",
      value: "off",
      updated_at: now.toISOString(),
      updated_by: "cron/flag-monitor",
    }, { onConflict: "flag_key" });

    // Alert founder (Sentry + Resend)
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Quantalyze <alerts@quantalyze.com>",
      to: process.env.FOUNDER_LP_REPORT_TO!,
      subject: `[ALERT] Phase 19 backbone auto-rolled-back: ${(errorRate * 100).toFixed(2)}% error rate`,
      html: `<p>Error envelope rate <code>${(errorRate * 100).toFixed(2)}%</code> exceeded 0.5% threshold over the past 15 minutes (${errorCount}/${total}). Kill-switch row <code>process_key_unified_backbone</code> has been flipped to <code>off</code>; new traffic falls back to legacy routes within 30 seconds.</p>`,
    });

    // Sentry breadcrumb (NOT capture — we don't want to inflate the same metric)
    console.warn(`[cron/flag-monitor] AUTO-ROLLBACK: ${errorRate} error rate`);

    return NextResponse.json({ ok: true, action: "rolled_back", errorRate, errorCount, total });
  }

  // Even when below threshold, send breach-warn email if errorRate > 0.25%
  // (CONTEXT.md "regardless of auto-rollback action") — separate email subject.
  if (errorRate > 0.0025) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Quantalyze <alerts@quantalyze.com>",
      to: process.env.FOUNDER_LP_REPORT_TO!,
      subject: `[WARN] Phase 19 error rate ${(errorRate * 100).toFixed(2)}% — below auto-rollback threshold`,
      html: `<p>Error rate ${errorCount}/${total} = ${(errorRate * 100).toFixed(2)}% — below the 0.5% auto-rollback threshold but worth a look.</p>`,
    });
  }

  return NextResponse.json({ ok: true, errorRate, errorCount, total });
}

export const GET = handle;
export const POST = handle;
```

### `vercel.json` cron registration

Add to existing crons array (between `cleanup-ack-tokens` and `founder-lp-report`):
```json
{ "path": "/api/cron/flag-monitor", "schedule": "*/15 * * * *" }
```

### Drain semantics — Python read seam

`analytics-service/services/feature_flags.py`:

```python
"""Phase 19 / BACKBONE-05 — feature flag read seam (Python).
Mirrors src/lib/feature-flags.ts. 30s in-process cache.
"""
import os
import time
from services.db import get_supabase

_CACHE_TTL_S = 30
_cache: dict = {}

async def is_unified_backbone_active() -> bool:
    now = time.monotonic()
    cached = _cache.get("process_key_unified_backbone")
    if cached and cached["expires_at"] > now:
        return cached["value"]

    kill_switch_off = False
    try:
        supabase = get_supabase()
        result = supabase.table("feature_flags").select("value").eq(
            "flag_key", "process_key_unified_backbone"
        ).maybe_single().execute()
        if result.data and result.data["value"] == "off":
            kill_switch_off = True
    except Exception as exc:
        # Don't block on Supabase outage; fall through to env var
        pass

    env_value = os.getenv("PROCESS_KEY_UNIFIED_BACKBONE", "off") == "on"
    value = env_value and not kill_switch_off
    _cache["process_key_unified_backbone"] = {
        "value": value, "expires_at": now + _CACHE_TTL_S
    }
    return value

def _reset_cache_for_tests() -> None:
    _cache.clear()
```

### Drain semantics — claim-time metadata write

`[VERIFIED]` Migration 086 `claim_compute_jobs_with_priority` body. Migration 104 must extend the RPC to:

1. Accept a 3rd arg `p_unified_backbone_active BOOLEAN DEFAULT NULL`.
2. After the inner UPDATE, write `metadata = metadata || jsonb_build_object('unified_backbone_at_claim', p_unified_backbone_active::text)`.

The Python dispatch loop (`main_worker.py`) must be updated in P6 to read the flag once per dispatch tick and pass it to the RPC:

```python
# main_worker.py dispatch loop
from services.feature_flags import is_unified_backbone_active

flag_active = await is_unified_backbone_active()
claimed = supabase.rpc(
    "claim_compute_jobs_with_priority",
    {
        "p_batch_size": BATCH_SIZE,
        "p_worker_id": WORKER_ID,
        "p_unified_backbone_active": flag_active,
    },
).execute()
```

### Gotchas

- **Supabase RLS on `feature_flags`** must allow service-role write (P7 cron) + authenticated read (clients). The migration 104 policy block above does this. Don't forget RLS — it's enabled but the policies must be present, otherwise the kill-switch flip silently no-ops.
- **`audit_log` denominator** requires P4 to write an audit row at /process-key entry. Plan must explicitly add this; it's easy to miss.
- **Sentry rate limits**: 30 req/sec org-wide on the events API. The cron polls 1× / 15 min — well under limit.
- **Cron clock drift between Vercel + tumbling window** — Vercel cron schedules are best-effort; jitter ±60 sec. The query uses `statsPeriod=15m` which is a sliding window, so clock drift just shifts the window slightly. Acceptable.
- **Min sample size guard (`total >= 20`)** prevents a single error in a 1-call window from triggering rollback. Tune at /ship time based on baseline traffic.

---

## P8 — BACKBONE-06 (open-perp) + BACKBONE-07 (TWR ≠ YTD)

### `EquityCurveBuilder` — extend `services/equity_reconstruction.py`

`[VERIFIED: services/equity_reconstruction.py:1-100]` Existing module hosts allocator-side equity reconstruction (Phase 07). Phase 19 adds a class for per-strategy equity curves built from raw trades.

```python
# analytics-service/services/equity_reconstruction.py — APPEND below existing module

from dataclasses import dataclass
import asyncio
from collections import defaultdict
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from typing import Iterable

import pandas as pd

from services.ingestion.adapter import Trade, Position, MetricsSnapshot

class EquityCurveBuilder:
    """Phase 19 / BACKBONE-06 + BACKBONE-07. Builds an equity curve from raw
    trades, with mark-price valuation for open perpetual positions and
    funding-rate accumulation. YTD = window-filtered TWR; TWR = full-history.

    Wraps existing primitives:
      - position_reconstruction.reconstruct_positions (FIFO matching)
      - positions.fetch_positions (current open positions snapshot)
      - funding_fetch.upsert_funding_rows (signed funding payments)
      - new: services/exchange.py.fetch_mark_prices(instruments)

    Sharpe matches an independently-computed quantstats reference within ±0.05.
    """

    def __init__(self, trades: list[Trade], mark_prices: dict[str, float] | None = None):
        self.trades = sorted(trades, key=lambda t: t.timestamp)
        self.mark_prices = mark_prices or {}

    def reconstruct_positions(self) -> list[Position]:
        """In-memory FIFO matching. NOT the same as services.position_reconstruction
        which is DB-side; this returns Position objects without persisting.
        """
        from services.position_reconstruction import _match_positions_fifo
        positions_by_symbol = defaultdict(list)
        for trade in self.trades:
            positions_by_symbol[trade.symbol].append(trade.__dict__)

        all_positions = []
        for symbol, fills in positions_by_symbol.items():
            matched = _match_positions_fifo(symbol, fills, strategy_id="<in-memory>")
            all_positions.extend(matched)

        # Attach mark prices to open positions
        for pos in all_positions:
            if pos["status"] == "open":
                mark = self.mark_prices.get(pos["symbol"])
                if mark is not None:
                    pos["mark_price"] = mark
                    pos["unrealized_pnl"] = (
                        (mark - pos["entry_price"]) * pos["quantity"]
                        if pos["side"] == "buy"
                        else (pos["entry_price"] - mark) * pos["quantity"]
                    )

        return [Position(**p) for p in all_positions]

    def attach_funding(self, funding_rows: list[dict]) -> None:
        """Sum signed funding payments into the equity curve at each
        funding window (8h cycles per services/funding_fetch.py).
        """
        # Bucket by 8h window; merge into self._funding_pnl_by_day
        ...

    def to_equity_curve_daily(self) -> pd.DataFrame:
        """Returns a daily equity DataFrame with columns:
        [date, realized_pnl, unrealized_pnl, funding_pnl, equity, daily_return].
        """
        ...

    def compute_twr(self) -> float | None:
        """Time-Weighted Return over full history. Uses geometric chaining
        of daily returns to neutralize cash flows.
        """
        df = self.to_equity_curve_daily()
        if df.empty: return None
        # (1 + r1)(1 + r2)...(1 + rN) - 1
        return float((1 + df["daily_return"]).prod() - 1)

    def compute_ytd(self) -> float | None:
        """YTD = TWR computed over the year-to-date window.
        IMPORTANT: differs from full-history TWR when history > 1 year.
        BACKBONE-07: prevents TWR == YTD bug when strategy has multi-period history.
        """
        df = self.to_equity_curve_daily()
        if df.empty: return None
        year_start = date(date.today().year, 1, 1)
        ytd_df = df[df["date"] >= year_start]
        if ytd_df.empty: return None
        return float((1 + ytd_df["daily_return"]).prod() - 1)

    def compute_sharpe(self, risk_free_rate: float = 0.0) -> float | None:
        """Annualized Sharpe ratio. Matches quantstats.stats.sharpe() within ±0.05.
        Formula: sqrt(252) * mean(daily_return) / stdev(daily_return)
        """
        df = self.to_equity_curve_daily()
        if df.empty or len(df) < 2: return None
        returns = df["daily_return"]
        excess = returns - (risk_free_rate / 252)
        if excess.std() == 0: return None
        return float((excess.mean() / excess.std()) * (252 ** 0.5))

    def to_metrics_snapshot(self) -> MetricsSnapshot:
        # Composes the above into a MetricsSnapshot dataclass
        ...
```

### Mark-price fetch with 60s in-process cache — extend `services/exchange.py`

```python
# Append to services/exchange.py
import time

_MARK_PRICE_CACHE: dict[str, tuple[float, float]] = {}  # symbol → (price, expires_at)
_MARK_PRICE_TTL_S = 60.0

async def fetch_mark_prices(
    exchange: ccxt.Exchange,
    instruments: list[str],
) -> dict[str, float]:
    """Phase 19 / BACKBONE-06. Fetch current mark prices for open perp instruments.
    60s in-process cache prevents fan-out hammering on equity-curve recompute.
    """
    now = time.monotonic()
    result: dict[str, float] = {}
    to_fetch: list[str] = []
    for sym in instruments:
        cached = _MARK_PRICE_CACHE.get(sym)
        if cached and cached[1] > now:
            result[sym] = cached[0]
        else:
            to_fetch.append(sym)

    if not to_fetch:
        return result

    if exchange.id == "okx":
        # OKX: GET /api/v5/public/mark-price (instId per row)
        for sym in to_fetch:
            try:
                resp = await exchange.public_get_public_mark_price({"instId": sym})
                price = float(resp["data"][0]["markPx"])
                result[sym] = price
                _MARK_PRICE_CACHE[sym] = (price, now + _MARK_PRICE_TTL_S)
            except Exception as e:
                logger.warning("fetch_mark_prices OKX failed for %s: %s", sym, e)
    elif exchange.id == "binance":
        # fapiPublic_get_premiumindex (mark price endpoint)
        ...
    elif exchange.id == "bybit":
        # private_get_v5_market_tickers ?category=linear
        ...

    return result
```

### Golden-file fixture format

Path: `analytics-service/tests/fixtures/equity-curve-golden/{strategy_name}.json`

Shape:
```json
{
  "strategy_name": "okx-multi-month-perps",
  "trades": [
    {"timestamp": "2025-01-15T10:30:00Z", "symbol": "BTC-USDT-SWAP", "side": "buy", "price": 42000.0, "quantity": 0.1, "fee": 1.05},
    {"timestamp": "2025-02-20T14:00:00Z", "symbol": "BTC-USDT-SWAP", "side": "sell", "price": 48000.0, "quantity": 0.1, "fee": 1.20}
  ],
  "mark_prices": {},
  "funding_rows": [],
  "expected_equity_curve": [
    {"date": "2025-01-15", "equity": 100000.00, "daily_return": 0.0},
    {"date": "2025-02-20", "equity": 100598.75, "daily_return": 0.00599}
  ],
  "expected_twr": 0.00599,
  "expected_ytd": 0.00599,   /* same since trades are within 2025 */
  "expected_sharpe": 1.42,
  "quantstats_sharpe_reference": 1.40   /* must be within ±0.05 */
}
```

Test:
```python
@pytest.mark.parametrize("fixture_name", ["okx-multi-month-perps", "binance-spot-only", "bybit-perp-with-funding"])
def test_equity_curve_golden(fixture_name):
    with open(f"tests/fixtures/equity-curve-golden/{fixture_name}.json") as f:
        gold = json.load(f)
    builder = EquityCurveBuilder(
        [Trade(**t) for t in gold["trades"]],
        mark_prices=gold["mark_prices"],
    )
    builder.attach_funding(gold["funding_rows"])

    actual_curve = builder.to_equity_curve_daily()
    expected_curve = pd.DataFrame(gold["expected_equity_curve"])
    pd.testing.assert_frame_equal(actual_curve, expected_curve, check_exact=False, rtol=1e-4)

    assert abs(builder.compute_twr() - gold["expected_twr"]) < 1e-5
    assert abs(builder.compute_ytd() - gold["expected_ytd"]) < 1e-5
    assert abs(builder.compute_sharpe() - gold["expected_sharpe"]) < 0.05

    # Cross-check against quantstats reference (BACKBONE-07 + REQ "Sharpe ±0.05")
    import quantstats as qs
    qs_sharpe = qs.stats.sharpe(actual_curve["daily_return"], periods=252)
    assert abs(builder.compute_sharpe() - qs_sharpe) < 0.05
```

### Gotchas

- **`_match_positions_fifo` is currently a private function in `position_reconstruction.py`** (verified by reading L25-86). P8 may need to expose it as `match_positions_fifo` (drop underscore) or pull it into a shared `services/positions/fifo.py`. The CONTEXT.md "BACKBONE-09 reuse" flag means: keep the implementation, just expose the function for in-memory use. Discuss with planner.
- **Quantstats `qs.stats.sharpe(returns, periods=252)`** — verify the `periods` arg matches the codebase convention (252 trading days vs 365 calendar days). Existing `analytics_runner.py` uses 252; align with that. `[ASSUMED]` quantstats default; verify via Context7 lookup.
- **YTD when history is < 1 year** — `compute_ytd()` correctly returns the same as TWR if all trades are within the current year. The "TWR != YTD" bug surfaces only when there's multi-year history. Golden-file fixtures must include at least one multi-year case.
- **Open-perp valuation precision** — `Decimal` vs `float`. Existing code uses `float` throughout. Don't introduce Decimal mid-pipeline; quantstats expects float64.

---

## P9 — Fingerprint v0 + `compute_similarity`

### Fingerprint computation — `analytics-service/services/ingestion/fingerprint.py`

```python
"""Phase 19 / FINGERPRINT-01. Versioned 5-component fingerprint computed at the
end of every /process-key pipeline run. Persisted to strategies.fingerprint.
"""
from collections import Counter, defaultdict
from datetime import datetime
from typing import Iterable

from services.ingestion.adapter import Trade, MetricsSnapshot, Fingerprint

# Bucket boundaries (CONTEXT.md L66-72)
TRADE_SIZE_BUCKETS_USD = (1_000, 10_000, 100_000)         # 4 buckets: <1k, 1-10k, 10-100k, 100k+
HOLD_DURATION_BUCKETS_HRS = (1, 24, 24 * 7)               # 4 buckets: <1h, 1-24h, 1-7d, >7d
ASSET_CLASSES = ("spot", "perp_long", "perp_short", "futures")  # 4 buckets


def compute_fingerprint_v1(
    trades: list[Trade],
    metrics: MetricsSnapshot | None = None,
    positions: list | None = None,
) -> Fingerprint:
    """5-component cosine-similarity-friendly fingerprint.

    All 5 components are L1-normalized to sum to 1.0, so cosine
    similarity is meaningful (each component is a probability distribution).
    Empty trades → all-zeros fingerprint (compute_similarity returns 0.0
    on either-zero input).
    """
    if not trades:
        return Fingerprint()  # all-zeros

    # 1. Trade-size buckets — by USD notional
    notionals = [(t.price * t.quantity) for t in trades]
    size_counts = [0, 0, 0, 0]
    for n in notionals:
        if n < TRADE_SIZE_BUCKETS_USD[0]: size_counts[0] += 1
        elif n < TRADE_SIZE_BUCKETS_USD[1]: size_counts[1] += 1
        elif n < TRADE_SIZE_BUCKETS_USD[2]: size_counts[2] += 1
        else: size_counts[3] += 1
    total = len(trades)
    size_dist = tuple(c / total for c in size_counts)

    # 2. Hold-duration buckets — requires position lifecycle.
    # If positions provided, use closed-position duration; else fall back to 0-duration (single fills)
    hold_counts = [0, 0, 0, 0]
    if positions:
        for p in positions:
            if p.status != "closed" or p.duration_days is None: continue
            hours = p.duration_days * 24
            if hours < HOLD_DURATION_BUCKETS_HRS[0]: hold_counts[0] += 1
            elif hours < HOLD_DURATION_BUCKETS_HRS[1]: hold_counts[1] += 1
            elif hours < HOLD_DURATION_BUCKETS_HRS[2]: hold_counts[2] += 1
            else: hold_counts[3] += 1
    hold_total = sum(hold_counts)
    hold_dist = tuple(c / hold_total if hold_total > 0 else 0.0 for c in hold_counts)

    # 3. Asset class mix — heuristic per symbol pattern
    class_counts = [0, 0, 0, 0]
    for t in trades:
        if "SWAP" in t.symbol or "PERP" in t.symbol or "USDT" in t.symbol:
            # Heuristic: side determines long/short — refine in v2
            idx = 1 if t.side == "buy" else 2  # perp_long / perp_short
        elif "FUTURES" in t.symbol or "/USDT-FUTURES" in t.symbol:
            idx = 3
        else:
            idx = 0  # spot
        class_counts[idx] += 1
    class_dist = tuple(c / total for c in class_counts)

    # 4. Instrument concentration — top-10 by % volume
    volume_by_symbol = defaultdict(float)
    for t in trades:
        volume_by_symbol[t.symbol] += t.price * t.quantity
    total_vol = sum(volume_by_symbol.values())
    top10 = sorted(volume_by_symbol.values(), reverse=True)[:10]
    instr_dist = tuple(v / total_vol for v in top10) if total_vol > 0 else (0.0,) * 10
    # Pad to 10
    instr_dist = instr_dist + (0.0,) * (10 - len(instr_dist))

    # 5. Temporal pattern — % volume per UTC hour (24 buckets)
    hour_volumes = [0.0] * 24
    for t in trades:
        hour = t.timestamp.astimezone(timezone.utc).hour
        hour_volumes[hour] += t.price * t.quantity
    total_hv = sum(hour_volumes)
    temporal_dist = tuple(v / total_hv if total_hv > 0 else 0.0 for v in hour_volumes)

    return Fingerprint(
        version=1,
        trade_size_buckets=size_dist,
        hold_duration_buckets=hold_dist,
        asset_class_mix=class_dist,
        instrument_concentration=instr_dist,
        temporal_pattern=temporal_dist,
    )
```

### Persistence — at end of `/process-key` pipeline

P4 router shows the call:
```python
fp = adapter.compute_fingerprint(trades, metrics)
supabase.table("strategies").update({"fingerprint": fp.to_jsonb()}).eq(
    "id", strategy_id
).execute()
```

### Backfill cron entry (FINGERPRINT-01 spec)

Add to `vercel.json` crons array OR run as a one-shot Railway script:
```json
{ "path": "/api/cron/backfill-fingerprints", "schedule": "0 5 1 * *" }
```

The cron iterates `strategies WHERE fingerprint IS NULL`, fetches trades from the existing `trades` table, computes the fingerprint, persists. Recommended as a separate one-shot manual script (not cron) for v1.0.0 — cron creates new attack surface.

### `compute_similarity` test cases

```python
def test_compute_similarity_identical():
    """Identical fingerprints → similarity = 1.0"""
    fp = compute_fingerprint_v1(SAMPLE_TRADES_OKX)
    similarity = supabase.rpc("compute_similarity", {"a": fp.to_jsonb(), "b": fp.to_jsonb()}).execute()
    assert similarity.data == 1.0  # NUMERIC(5,4) → 1.0000

def test_compute_similarity_disjoint():
    """Disjoint fingerprints → similarity ≈ 0"""
    fp_a = Fingerprint(version=1, trade_size_buckets=(1.0, 0, 0, 0), ...)  # all small trades, hour 0 only
    fp_b = Fingerprint(version=1, trade_size_buckets=(0, 0, 0, 1.0), ...)  # all huge trades, hour 12 only
    sim = supabase.rpc("compute_similarity", {"a": fp_a.to_jsonb(), "b": fp_b.to_jsonb()}).execute()
    assert sim.data < 0.1

def test_compute_similarity_null():
    """NULL inputs → 0.0 (never errors per FINGERPRINT-02)"""
    sim = supabase.rpc("compute_similarity", {"a": None, "b": Fingerprint().to_jsonb()}).execute()
    assert sim.data == 0.0

def test_compute_similarity_version_mismatch():
    fp_v1 = Fingerprint(version=1, ...)
    fp_v2 = Fingerprint(version=2, ...)  # hypothetical future version
    sim = supabase.rpc("compute_similarity", {"a": fp_v1.to_jsonb(), "b": fp_v2.to_jsonb()}).execute()
    assert sim.data == 0.0
```

### Gotchas

- **`asset_class_mix` heuristic is crude** — symbol patterns differ across exchanges (OKX uses `BTC-USDT-SWAP`, Binance uses `BTCUSDT`, Bybit uses `BTCUSDT`). Phase 19 ships v0 with the simple rule above; UC-C accepts placeholder identity preservation. v2 refinement.
- **Empty `instrument_concentration`** — when fewer than 10 instruments traded, the array is padded with 0.0s. The cosine math handles this correctly (zero contribution to dot product + norm).
- **`compute_similarity` is `IMMUTABLE PARALLEL SAFE`** — must NOT do any I/O. Pure computation only. Don't accidentally `SELECT … FROM …` inside the body; those break IMMUTABLE.

---

## Project Constraints (from CLAUDE.md)

| Directive | Source | Phase 19 implication |
|-----------|--------|----------------------|
| Banned packages: `axios`, `react-native-international-phone-number`, etc. | Global CLAUDE.md | All Next.js routes use native `fetch()`; no axios. |
| Read `node_modules/next/dist/docs/` before writing Next.js code | AGENTS.md | Planner must verify App Router non-GET handler signatures + `vercel.json` cron schema against current Next.js version. |
| Always read `DESIGN.md` before any visual decisions | Project CLAUDE.md | Phase 19 customer-facing surfaces (wizard error envelopes, broker selector grid) must match Phase 17 contract. Trust-tier tokens regex-asserted against `src/lib/design-tokens/trust-tier.ts`. |
| Update VERSION + package.json in same commit | Memory | Each P5 commit MUST bump VERSION and package.json or critical-regressions.test.ts fails. |
| Test Supabase project: `qmnijlgmdhviwzwfyzlc` | Memory | Migrations apply via Supabase MCP `apply_migration`; check production drift before /ship. |
| Subagent branch protection | Memory | Phase 19 plans MUST include "no git branch ops" constraint when delegating to executor agents. |
| Theme 1: trust-tier tokens regex-asserted | Phase 17 DESIGN-01 | P5 must not introduce new colors; reuse `TRUST_TIER_TOKENS`. |
| Theme 4: customer-feedback exit gate | Phase 19 exit | P8/P9 must include the `.planning/phase-19/customer-feedback.md` artifact with verbatim feedback from 1-2 of 10 onboarding teams. |
| Theme 5: vcrpy cassettes + repro-key-flow.sh during 7-day stability window | Phase 19 stability | Add CI cron / nightly job runs `scripts/repro-key-flow.sh` against 8 cassettes (OKX 4/4, Bybit 4/4 — Binance deferred). |
| Theme 6: route-inventory completeness + 4-PR shim sequence | Phase 19 entry/exit | P1 + plan-checker grep enforcement on commit message convention. |

---

## Standard Stack

(Already documented above in the new entries. The repo's existing pinned versions stand: `fastapi`, `ccxt.async_support`, `cryptography.fernet`, `structlog==25.5.0`, `sentry-sdk[fastapi]==2.58.0`, `httpx`, `pytest-asyncio`, `respx`, `@supabase/supabase-js`, `next` (App Router).)

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sharpe / annualized return | Custom rolling-stdev math | `quantstats.stats.sharpe()` for golden reference | Numerical edge cases (NaN propagation, sample-vs-population stdev) — quantstats encapsulates years of backtester learnings |
| Cosine similarity | Pure-Python loop | plpgsql `compute_similarity` RPC (in DB) | Locality with the JSONB data; avoids round-trip; v2 swap to pgvector is direct |
| Feature flag plumbing | Edge Config / LaunchDarkly | Env var + Supabase kill-switch row | Locked decision; no new dep |
| Sentry events polling | Build a custom event sink | `httpx.AsyncClient` against Sentry's events API | Single endpoint, one HTTP call; webhooks would be Sentry-Pro-only |
| Idempotency tokens | Custom dedup-store | UNIQUE INDEX + 23505 retry pattern | Migrations 062 + 032 already use this pattern; Phase 02 precedent |
| State-machine transitions | App-side validation | `transition_strategy_verification` RPC with CHECK | DB is single source of truth; no risk of bypass via direct UPDATE |
| Fernet envelope encryption | Custom AES-GCM | Existing `services/encryption.py` | Already audited; KEK rotation tested |
| FIFO position matching | New module | Reuse `position_reconstruction._match_positions_fifo` | 70% built per ROADMAP REUSE flag; expose for in-memory variant |
| Mark-price cache | Redis | In-process dict with TTL | Single FastAPI process per Railway pod; matches existing `key_permissions._FAIL_CLOSED` cache pattern |

**Key insight:** Phase 19 is unification, not new construction. Every component has a precedent in the codebase — RPC + UNIQUE INDEX + 4-PR migration + cron + adapter Protocol. The risk is operational (4-PR shim sequence, drain semantics, flag flips), not algorithmic. Plans should be precise about which existing module each adapter wraps and which existing RPC each thin route calls.

---

## Common Pitfalls

### Pitfall 1: VIEW-shim race during step (a) → (b) window
**What goes wrong:** Step (a) repoints `verify-strategy/route.ts:115` UPDATE to `strategy_verifications`, but the OLD `verification_requests` table still receives writes from any caller that wasn't listed in `route-inventory.md` (the 4th-orphan-path risk).
**Why it happens:** Theme 6. Route inventory was incomplete OR a deprecated route was missed.
**How to avoid:** P1 plan-checker grep at Phase 19 entry rejects without complete inventory. P5 commit (c) verification step explicitly greps Supabase audit log for ANY write to `verification_requests` over the past 24h before commit (d) ships.
**Warning signs:** `verify-no-legacy-writes.sh` output shows non-zero rows on day 7.

### Pitfall 2: Wizard double-submit race (`23505` UNIQUE violation)
**What goes wrong:** User clicks Submit twice; both requests pass the SELECT-by-`wizard_session_id` check; both reach INSERT; second one gets 23505 SQLSTATE.
**Why it happens:** TOCTOU between SELECT and INSERT in P4 router.
**How to avoid:** Catch 23505 explicitly; on catch, SELECT the existing row by `wizard_session_id` and return it. Don't rely on the SELECT pre-check alone.

```python
try:
    inserted = supabase.table("strategy_verifications").insert(...).execute()
except APIError as exc:
    if "23505" in str(exc) or getattr(exc, "code", "") == "23505":
        # idempotent retry
        existing = supabase.table("strategy_verifications").select("*").eq(
            "wizard_session_id", wizard_session_id
        ).single().execute()
        return existing.data
    raise
```

### Pitfall 3: Drain semantics split-brain
**What goes wrong:** Flag flips from `on` → `off` while a worker is mid-dispatch on a `process_key_long` job. The worker reads the live env var (off) and aborts, but the strategy_verifications row was already at `metrics_captured` status — leaving it stranded.
**Why it happens:** Worker reads live env var instead of `unified_backbone_at_claim` metadata snapshot.
**How to avoid:** Worker handler MUST read `job.metadata.unified_backbone_at_claim` first. Never call `is_unified_backbone_active()` mid-job.

### Pitfall 4: Migration 104 `claim_compute_jobs_with_priority` signature drift
**What goes wrong:** Adding the 3rd arg `p_unified_backbone_active` breaks PostgREST resolution if any caller passes the old 2-arg form.
**Why it happens:** PostgREST resolves by named-arg, but ORDER OF args still matters in some clients.
**How to avoid:** New arg has `DEFAULT NULL`. Old callers without the arg get NULL — handler checks for `flag_at_claim is None` (legacy claim) and treats it as `false` (legacy backbone). Verify the Python `main_worker.py` is updated in P6 to pass the third arg.

### Pitfall 5: `compute_similarity` IMMUTABLE violation
**What goes wrong:** Function body does any I/O (e.g., reads `feature_flags` table to gate behavior) — Postgres marks the function non-IMMUTABLE silently and dies during planner reasoning.
**Why it happens:** Defensive coding ("disable similarity if v2 active") creeps into the function body.
**How to avoid:** `compute_similarity` MUST be pure. Versioning is in the JSONB shape (`version` field), not in the function body. Test via `pg_proc.provolatile = 'i'` assertion in the migration's self-verifying DO block.

### Pitfall 6: Feature flag cache miss storm
**What goes wrong:** 30s cache expires; 100 concurrent requests all hit `feature_flags` table simultaneously.
**Why it happens:** Naïve cache-miss → DB roundtrip pattern.
**How to avoid:** Phase 19 v0 accepts the storm (Supabase handles it). For volume tuning, P5 + P7 use `unstable_cache` (Next.js) or `cache_lock` pattern (Python). Acceptable defer for v1.0.0.

### Pitfall 7: VIEW shim breaks `verify-strategy/[id]/status/route.ts` reads
**What goes wrong:** After 107 ships, the `verification_requests` VIEW maps `public_token` from JSONB. The status route's `SELECT id, status, public_token, expires_at, results FROM verification_requests` returns NULL for `public_token`.
**Why it happens:** Migration 107 mapping pushes legacy fields into `errors` JSONB.
**How to avoid:** Add `public_token TEXT` and `expires_at TIMESTAMPTZ` as first-class columns to `strategy_verifications` in migration 103. The VIEW maps them as columns, not nested JSONB. Plan owner reviews shape before commit (d).

### Pitfall 8: Sentry events API rate limit on tight time-resolution
**What goes wrong:** Cron polls every 15 min, but a developer running CI cassette runs floods Sentry with ERROR events that get counted toward the production rollback threshold.
**Why it happens:** No environment tag filter on the Sentry query.
**How to avoid:** Add `environment:production` to the query string. Verify Sentry SDK init sets `environment: process.env.VERCEL_ENV` on both halves.

### Pitfall 9: pgvector accidental dependency
**What goes wrong:** Someone reads "compute_similarity" and pulls in `pgvector` extension despite UC-C deferral.
**Why it happens:** Habit; pgvector is the obvious answer.
**How to avoid:** P2 migration 105's body MUST NOT contain `CREATE EXTENSION vector;` or `vector` type references. Plan-checker grep on the migration file blocks this. Documentation in `compute_similarity` DOCSTRING explicitly says "v0 placeholder; pgvector deferred per UC-C v2".

### Pitfall 10: 4-PR shim commits squashed during merge
**What goes wrong:** GitHub PR squash-merge collapses the 4 shim commits into 1; plan-checker grep fails to find `phase-19-shim-step-{a|b|c|d}:` prefixes.
**Why it happens:** Default GitHub merge strategy.
**How to avoid:** Each shim step ships as its OWN PR (not 4 commits in 1 PR). The CONTEXT.md says "ships as exactly 4 sequential PRs"; honor that. P5 plan must explicitly call out 4 PRs, NOT 4 commits in 1 PR.

---

## Runtime State Inventory

> Phase 19 is a unification refactor with significant runtime state implications. Inventory below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) `verification_requests` table — 90-day legacy retention after rename in 107. (2) `strategy_verifications` table — Phase 15 already wrote `csv_uploaded` rows; Phase 19 writes 5 new flow_types. (3) `compute_jobs` rows mid-flight at flag-flip boundary — drain via metadata snapshot. (4) `strategies.fingerprint` JSONB — backfill required for existing rows. | (1) Migration 107 RLS keeps reads working 90 days. (2) Existing rows preserved; status state-machine RPC compatible with `validated` initial state. (3) Drain semantics handle. (4) One-shot backfill script `scripts/backfill-fingerprints.py`; not a cron. |
| Live service config | (1) Sentry org config — `SENTRY_AUTH_TOKEN` scope `org:read,event:read` must be issued. (2) Resend domain — `alerts@quantalyze.com` if not already verified. (3) Vercel cron registry in `vercel.json` — adds 1 entry. (4) Railway worker dyno (PR #53) — picks up `process_key_long` automatically once kind enum is widened. | (1) Founder issues token in Sentry UI; sets as Vercel env var. (2) Verify Resend domain. (3) Code change. (4) Code change. |
| OS-registered state | None — Phase 19 doesn't introduce new OS-level registrations. Vercel cron is managed by Vercel; Railway worker is managed by Railway. | None |
| Secrets/env vars | (1) `INTERNAL_API_TOKEN` — already exists; Phase 19 adds `Authorization: Bearer ${TOKEN}` on `/process-key` calls. (2) `PROCESS_KEY_UNIFIED_BACKBONE` — NEW on Vercel + Railway (default `off`). (3) `SENTRY_AUTH_TOKEN` — NEW on Vercel. (4) `SENTRY_ORG_SLUG` — NEW on Vercel. (5) `FOUNDER_LP_REPORT_TO` — already exists from Phase 18; reused. (6) `CRON_SECRET` — already exists. | (1) None. (2) Founder sets at /ship time. (3) Issued from Sentry UI. (4) Founder sets. (5) None. (6) None. |
| Build artifacts / installed packages | (1) `requirements-dev.txt` adds `quantstats`. (2) `requirements.txt` — no new prod deps. (3) `package.json` — no new deps. | (1) Reinstall analytics-service venv: `pip install -r requirements-dev.txt`. (2) None. (3) None. |

**Critical runtime state question — all 5 categories answered above.** No category is blank.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase project `qmnijlgmdhviwzwfyzlc` | All migrations 103-107 | ✓ (linked) | — | None — must apply via MCP `apply_migration` |
| Sentry org with events:read scope | P7 cron | ✓ (assumed; founder has Sentry account) | — | Cron logs WARN and exits without flipping if API unreachable |
| Resend account with verified `alerts@` domain | P7 cron alerts | ✓ (Phase 18 LP cron uses Resend) | — | Sentry capture is the secondary alert path |
| Railway worker dyno (PR #53) | P6 long-fetch dispatch | ✓ (merged into FastAPI process via lifespan) | — | None — it's the only worker |
| Vercel `vercel.json` crons (Pro plan) | P7 flag-monitor cron | ✓ (existing crons confirmed in `vercel.json`) | — | Out of crons cap; Pro plan has 40 cron slots |
| `quantstats` Python package | P8 golden-file fixtures only | ✗ (not yet in requirements-dev.txt) | — | Only used in tests; install on the spot |
| `ccxt.async_support` | P3 adapters | ✓ (already imported via `services/exchange.py`) | (pinned in requirements.txt) | None |
| Test Supabase E2E project | P5 + P6 + P8 integration tests | ✓ (linked, 4 GH secrets wired per memory) | — | None |

**Missing dependencies with no fallback:** None blocking. Phase 19 can execute against current environment.

**Missing dependencies with fallback:** quantstats — install during P8.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Frontend framework | Vitest 3.0.0 (per `vitest.config.ts`); Playwright 1.51.0 for E2E |
| Backend framework | pytest with `pytest-asyncio` + `respx` for httpx mocks |
| Frontend config | `vitest.config.ts` (root) — coverage thresholds 60% lines/functions/branches/statements |
| Backend config | `analytics-service/pytest.ini` (verify exists; if absent, surface as Wave 0 gap) |
| Quick run command (frontend) | `npm test -- --run --reporter=basic <file>` |
| Quick run command (backend) | `cd analytics-service && pytest tests/<file>.py::<class>::<test> -x` |
| Full suite (frontend) | `npm run test:coverage && npm run test:e2e` |
| Full suite (backend) | `cd analytics-service && pytest --cov=services --cov-fail-under=80` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BACKBONE-01 | `POST /process-key` accepts canonical body shape, returns VerificationResult | unit (FastAPI test client) | `pytest analytics-service/tests/test_process_key.py::test_process_key_happy_path -x` | ❌ Wave 0 |
| BACKBONE-01 | `INTERNAL_API_TOKEN` constant-time auth | unit | `pytest analytics-service/tests/test_process_key.py::test_internal_token_auth -x` | ❌ Wave 0 |
| BACKBONE-02 | `IngestionAdapter` Protocol — OkxAdapter conforms | unit (Protocol runtime check) | `pytest analytics-service/tests/test_ingestion_protocol.py -x` | ❌ Wave 0 |
| BACKBONE-02 | CSV adapter returns ValidationResult with `read_only=None` | unit | `pytest analytics-service/tests/test_csv_adapter.py::test_validate_returns_none_read_only -x` | ❌ Wave 0 |
| BACKBONE-03 | `transition_strategy_verification` RPC rejects illegal transitions | integration | `pytest analytics-service/tests/test_transition_rpc.py::test_illegal_transition_raises -x` | ❌ Wave 0 |
| BACKBONE-04 | 4-PR shim commit message convention | CI (custom shell) | `bash scripts/check-phase-19-shim-commits.sh` | ❌ Wave 0 |
| BACKBONE-05 | Feature flag — env var ON + kill-switch OFF → flag is OFF | unit (TS) | `npm test -- src/lib/feature-flags.test.ts` | ❌ Wave 0 |
| BACKBONE-05 | Feature flag — Python read seam matches TS shape | unit (Python) | `pytest analytics-service/tests/test_feature_flags.py -x` | ❌ Wave 0 |
| BACKBONE-06 | Open-perp valuation — golden fixture | unit (golden-file) | `pytest analytics-service/tests/test_equity_curve_builder.py::test_open_perp_valuation -x` | ❌ Wave 0 |
| BACKBONE-07 | TWR ≠ YTD when multi-year history | unit (golden-file) | `pytest analytics-service/tests/test_equity_curve_builder.py::test_twr_neq_ytd_multi_year -x` | ❌ Wave 0 |
| BACKBONE-07 | Sharpe ±0.05 vs quantstats reference | unit (golden-file) | `pytest analytics-service/tests/test_equity_curve_builder.py::test_sharpe_within_tolerance -x` | ❌ Wave 0 |
| BACKBONE-08 | `wizard_session_id` UNIQUE — double-submit returns 1 row | integration | `pytest analytics-service/tests/test_process_key.py::test_idempotent_double_submit -x` | ❌ Wave 0 |
| BACKBONE-09 | `process_key_long` worker handler dispatches | unit | `pytest analytics-service/tests/test_long_fetch.py -x` | ❌ Wave 0 |
| BACKBONE-09 | Drain — claim writes `unified_backbone_at_claim` metadata | integration | `pytest analytics-service/tests/test_drain_semantics.py -x` | ❌ Wave 0 |
| BACKBONE-10 | Route inventory completeness | CI (grep) | `bash scripts/check-route-inventory.sh` | ❌ Wave 0 |
| FINGERPRINT-01 | `compute_fingerprint_v1` — empty trades returns all-zeros | unit | `pytest analytics-service/tests/test_fingerprint.py::test_empty_trades_zero_fingerprint -x` | ❌ Wave 0 |
| FINGERPRINT-02 | `compute_similarity` identical fingerprints → 1.0 | integration (SQL) | `pytest analytics-service/tests/test_compute_similarity_sql.py::test_identical_returns_one -x` | ❌ Wave 0 |
| FINGERPRINT-02 | `compute_similarity` NULL inputs → 0.0 (no error) | integration | `pytest analytics-service/tests/test_compute_similarity_sql.py::test_null_inputs -x` | ❌ Wave 0 |
| FINGERPRINT-02 | `compute_similarity` IMMUTABLE PARALLEL SAFE flags | migration self-verify | (in DO block of 105) | ❌ Wave 0 (in migration) |

### Sampling Rate

- **Per task commit:** Run the specific test for the task's REQ-ID. Quick command (≤30 sec).
- **Per wave merge:** Run all tests for the REQs in the wave (e.g., Wave 1 = P1+P2+P3 tests).
- **Phase gate:** Full suite green before `/gsd-verify-work`. Backend: `pytest --cov-fail-under=80`. Frontend: `npm run test:coverage` (60% threshold) + `npm run test:e2e`.

### Wave 0 Gaps

- [ ] `analytics-service/tests/test_process_key.py` — covers BACKBONE-01 + BACKBONE-08
- [ ] `analytics-service/tests/test_ingestion_protocol.py` — covers BACKBONE-02
- [ ] `analytics-service/tests/test_csv_adapter.py` — CSV-specific adapter behavior
- [ ] `analytics-service/tests/test_transition_rpc.py` — RPC integration vs migration 103
- [ ] `analytics-service/tests/test_long_fetch.py` — `process_key_long` worker handler
- [ ] `analytics-service/tests/test_drain_semantics.py` — claim-time metadata write
- [ ] `analytics-service/tests/test_equity_curve_builder.py` — BACKBONE-06/-07 golden files
- [ ] `analytics-service/tests/test_fingerprint.py` — FINGERPRINT-01
- [ ] `analytics-service/tests/test_compute_similarity_sql.py` — FINGERPRINT-02
- [ ] `analytics-service/tests/test_feature_flags.py` — Python feature flag seam
- [ ] `analytics-service/tests/fixtures/equity-curve-golden/` — 3+ JSON golden files
- [ ] `src/lib/feature-flags.test.ts` — TS feature flag seam
- [ ] `src/app/api/cron/flag-monitor/route.test.ts` — cron handler unit test
- [ ] `scripts/check-phase-19-shim-commits.sh` — CI guard for 4-PR shim sequence
- [ ] `scripts/check-route-inventory.sh` — CI guard for route-inventory completeness
- [ ] `analytics-service/requirements-dev.txt` — `quantstats` add (Wave 1 / P8)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `INTERNAL_API_TOKEN` constant-time compare (`secrets.compare_digest`) on `/process-key`; mirrors `routers/internal.py:117`. Vercel cron uses `safeCompare` against `CRON_SECRET`. |
| V3 Session Management | yes | `withAuth` wrapper on Next.js routes (existing pattern); user-scoped Supabase client respects RLS. |
| V4 Access Control | yes | RLS on `strategy_verifications` (already shipped via 093/094); `feature_flags` table needs RLS in 104; `compute_similarity` GRANT EXECUTE narrowed to `authenticated, service_role`. |
| V5 Input Validation | yes | Pydantic `_ProcessKeyBody` regex-validates `flow_type` and `source` enums; FastAPI auto-422 on shape violation. |
| V6 Cryptography | yes | KEK envelope encryption via existing `services/encryption.py` (Fernet). NEVER hand-roll. |
| V8 Data Protection | yes | `analytics-service/services/redact.py` (Phase 18) scrubs PII in Sentry/structlog/audit-log boundaries; mirrors `pii-scrub.ts`. |
| V13 API and Web Service | yes | Rate limiting via slowapi (existing pattern); `/process-key` endpoint should add `@limiter.limit("100/hour")` mirroring `/api/validate-key`. |

### Known Threat Patterns for Phase 19 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay attack on `/process-key` (capture + replay token) | Spoofing | `INTERNAL_API_TOKEN` is bearer; Vercel→Railway TLS enforces channel binding; rotation tracked in Day-2 doc |
| Wizard double-submit creates dup rows | Tampering | UNIQUE INDEX on `wizard_session_id` (BACKBONE-08) |
| Direct UPDATE bypassing state machine | Tampering | All mutations gated behind `transition_strategy_verification` RPC; CHECK constraint enforces legal transitions |
| PII leak in error envelope or Sentry | Information disclosure | `redact.py` runs at Sentry `before_send`; structlog processor; audit-log writer (3 boundaries) |
| Flag-monitor cron false positive flips kill-switch | Denial of service | `total >= 20` minimum sample guard; founder Resend alert for visibility on every flip |
| Side-channel timing on `INTERNAL_API_TOKEN` | Spoofing | `secrets.compare_digest` constant-time |
| RLS bypass via VIEW | Tampering | INSTEAD OF triggers reject all writes on `verification_requests` view; legacy table RLS retained |
| Compromised Sentry token reads other-org events | Information disclosure | Token scoped to org-only (`org:read,event:read`); not user-readable |
| `compute_similarity` SQL injection via fingerprint payload | Injection | All inputs typed as `JSONB`; no string concatenation; IMMUTABLE function |

---

## Code Examples

### Adapter Protocol shape — `IngestionAdapter` (PEP 544)

```python
# analytics-service/services/ingestion/__init__.py
# Source: PEP 544 + existing services/exchange.py:444 dataclass precedent
from typing import Protocol, runtime_checkable
from .adapter import KeySubmissionRequest, ValidationResult, Trade, ...

@runtime_checkable
class IngestionAdapter(Protocol):
    async def validate(self, req: KeySubmissionRequest) -> ValidationResult: ...
    async def fetch_raw(self, creds_or_file: dict) -> list[Trade]: ...
    def compute_metrics(self, trades: list[Trade]) -> MetricsSnapshot: ...
    def compute_fingerprint(self, trades: list[Trade], metrics: MetricsSnapshot) -> Fingerprint: ...
    async def reconstruct_positions(self, trades: list[Trade]) -> list[Position]: ...
```

### Constant-time `INTERNAL_API_TOKEN` check

```python
# Source: analytics-service/routers/internal.py:104-118 (verbatim pattern)
import os
import secrets
from fastapi import HTTPException, Request

def _verify_internal_token(request: Request) -> None:
    expected = os.getenv("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(status_code=403, detail="Internal API not configured")
    auth = request.headers.get("Authorization", "")
    provided = auth[len("Bearer "):] if auth.startswith("Bearer ") else auth
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")
```

### `enqueue_compute_job` with metadata (Phase 18 pattern)

```typescript
// Source: src/app/api/keys/sync/route.ts:88-94 (verbatim)
const correlation_id = await getCorrelationId();
const { data, error } = await admin.rpc("enqueue_compute_job", {
  p_strategy_id: strategy_id,
  p_kind: "process_key_long",  // Phase 19 / BACKBONE-09
  p_metadata: {
    correlation_id,
    verification_id,
    flow_type,
    source,
  },
});
```

### Self-verifying migration DO block (mirrors 093 STEP 7)

```sql
-- Source: supabase/migrations/093_strategy_verifications.sql:296-370
DO $$
DECLARE
  v_index_count INT;
  v_check_admits BOOLEAN;
BEGIN
  SELECT count(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='strategy_verifications'
      AND indexname='strategy_verifications_wizard_session_id_unique_idx';
  IF v_index_count <> 1 THEN
    RAISE EXCEPTION 'Migration 104 failed: wizard_session_id UNIQUE INDEX missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name='compute_jobs_kind_check'
      AND check_clause LIKE '%process_key_long%'
  ) INTO v_check_admits;
  IF NOT v_check_admits THEN
    RAISE EXCEPTION 'Migration 104 failed: process_key_long not in compute_jobs_kind_check';
  END IF;

  RAISE NOTICE 'Migration 104: all assertions passed.';
END
$$;
```

### Vercel cron auth check (Bearer + safeCompare)

```typescript
// Source: src/app/api/cron/sync-funding/route.ts:29-32
import { safeCompare } from "@/lib/timing-safe-compare";

const auth = req.headers.get("authorization") ?? "";
const expected = `Bearer ${process.env.CRON_SECRET}`;
if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 5 divergent entry routes for the same flow | 1 unified `/process-key` RPC + thin Next.js adapters | Phase 19 (this phase) | Reduces test surface 5× |
| Separate `verification_requests` table for landing-page teaser | Single `strategy_verifications` table with `flow_type` discriminator | Phase 15 (started) → Phase 19 (completed) | Idempotency + state-machine becomes possible |
| `try/except Exception:` on broker validation | `try/except` per ccxt class hierarchy + `error_code` discriminator | Phase 18 PR #116 | Surfaces real broker errors instead of `code: UNKNOWN` |
| Vercel env-var flip for rollback | Supabase kill-switch row | Phase 19 (this phase) | Avoids redeploy churn; auto-rollback by cron |
| Bridge call after dispatch | Atomic bridge inside `mark_compute_job_done` RPC | Phase 18 migration 099 | Eliminates split-brain; preserves drain semantics design |
| `pgvector` for fingerprint similarity | Plain plpgsql cosine on JSONB | UC-C 2026-04-30 (deferred to v2) | Statistically meaningless at N=10; defer until N≥1000 |
| Hand-rolled FIFO matcher | Reuse existing `position_reconstruction._match_positions_fifo` | Phase 19 | 70% built per ROADMAP; expose function only |

**Deprecated/outdated:**
- `analytics_status.sync_strategy_analytics_status` should NOT be called from new dispatch loops (Phase 18 099 made it atomic inside `mark_compute_job_done/failed`).
- `verification_requests.public_token` legacy column moved into `strategy_verifications.public_token` first-class column (per Pitfall 7) — DO NOT add to `errors` JSONB.
- New routes MUST NOT call `validateKey` / `encryptKey` / `verifyStrategy` analytics-client wrappers directly post-Phase-19; route through `/process-key` instead. Old wrappers stay for legacy fallback during 7-day window only.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Sentry events API endpoint shape `/api/0/organizations/{org}/events/?statsPeriod=15m&query=…` | P7 | If Sentry shape changed, cron returns wrong count → flag thrashes. Founder MUST verify before P7 ships. |
| A2 | quantstats `qs.stats.sharpe(returns, periods=252)` is the current API; defaults to annual scaling | P8 | Tolerance assertion `±0.05` may pass falsely if quantstats default changed. Verify via Context7 lookup before P8. |
| A3 | `migration 094` (RLS polish) is the actual contents of slot 094 — NOT a Phase 19 reservation | P2 | If 094 is actually open, the slot reservation table is wrong. Verified via direct `ls supabase/migrations/` — slot 094 is RLS polish, taken. ✓ |
| A4 | `wizard_session_id UUID NOT NULL` per migration 093 line 80 | P6 / migration 104 | Verified via direct read; UNIQUE INDEX without WHERE is correct. ✓ |
| A5 | `compute_jobs.metadata` JSONB column already exists (per `enqueue_compute_job` `p_metadata` arg in migration 062) | P6 / migration 104 | Verified via 062:174-180; column exists. ✓ |
| A6 | Sentry SDK `before_send` redaction in `analytics-service/sentry_init.py` already wires `redact.py` per Phase 18 | P4 | If Phase 18 hasn't completed FIX-04, the new /process-key route will leak credentials in error events. Plan MUST verify Phase 18 redact.py is wired before P4 ships. |
| A7 | Vercel cron Pro plan supports the additional `flag-monitor` slot (40-cron cap) | P7 | `vercel.json` currently has 7 entries; +1 = 8. Well under Pro cap. ✓ |
| A8 | `process_key_unified_backbone` env var defaults to `off` until founder enables — no accidental on-state at deploy time | All | If default is missing, first deployment to prod after merge would activate the unified path immediately. P5 must include `.env.example` change with `PROCESS_KEY_UNIFIED_BACKBONE=off` documented. |
| A9 | `[ASSUMED]` Phase 17 trust-tier tokens at `src/lib/design-tokens/trust-tier.ts` exist and are imported in TrustTierLabel | P5 thin adapters | Phase 17 marked complete in STATE.md (6/6 plans); A9 verified by completion status. ✓ |
| A10 | The 5 entry routes can each be reduced to ~30 LOC thin adapters without breaking existing E2E tests | P5 | If finalize-wizard's force-refresh permissions probe (route.ts:60-86) is critical to scope-broadening defense, the thin adapter must preserve it OR move it to `/process-key` validate(). Plan must explicitly route this. |

---

## Open Questions

1. **Where does the `force-refresh permissions probe` live in the unified flow?**
   - What we know: `finalize-wizard/route.ts:60-86` does a force-refresh probe before the SECURITY DEFINER RPC; this prevents scope-broadening between Connect and Submit.
   - What's unclear: Should the probe move INTO `IngestionAdapter.validate()` (so it runs at every transition), OR stay at the route layer (so the unified backbone doesn't add latency to the synchronous teaser flow)?
   - Recommendation: leave the probe at the thin-adapter route layer for scope-broadening defense (matches existing Phase 18 hardening); document explicitly in P5 plan that finalize-wizard's adapter retains the probe block before delegating.

2. **Does the `factsheet/[id]/pdf` route need to consume `strategy_verifications` rows or stay reading from `strategies + strategy_analytics`?**
   - What we know: Phase 19 BACKBONE-10 lists factsheet/pdf as one of 5 entry routes that delegate to `/process-key`. But the route is GET (read-only); the body of route.ts shows it queries `strategies` + `strategy_analytics`, not `strategy_verifications`.
   - What's unclear: Is the autoplan saying the cron-PDF flow is `flow_type='internal_report'` and should write to `strategy_verifications` for audit, OR is the route just a "thin adapter to /process-key for trace-discovery" with a no-op body?
   - Recommendation: keep factsheet/pdf as a GET-side reader; don't add a /process-key call for the PDF generation. Document as "out of scope for unification — trace-only" in P1 route inventory. This contradicts the autoplan's literal "5 entry routes" claim, but the autoplan was describing the BACKBONE-01 unification scope, not factsheet specifically.

3. **Does P2's migration 105 actually need a `version` column on the `strategies.fingerprint` JSONB itself, or is the JSONB shape's `version` field sufficient?**
   - What we know: `Fingerprint.to_jsonb()` includes `"version": 1` in the JSONB body.
   - What's unclear: Could a future caller insert a malformed JSONB without `version`? Should there be a CHECK constraint `(fingerprint->>'version')::INT = 1`?
   - Recommendation: ship a CHECK constraint `WHERE fingerprint IS NOT NULL` in migration 105 so the partial index ENFORCEMENT also enforces shape. Defer detailed enforcement to v2.

4. **Is the 7-day stability window measured in calendar days or business days?**
   - What we know: CONTEXT.md says "7 calendar days at 100% rollout before VIEW drop".
   - What's unclear: If the flag flips on a Friday, do we wait until next Friday?
   - Recommendation: calendar days. Record exact `flag_flipped_at` timestamp on commit (b); commit (d) ships ≥168h later. Plan-checker enforces by commit timestamp delta.

5. **What's the expected throughput shape of `/process-key` — how many concurrent requests does the FastAPI process need to handle?**
   - What we know: Currently 5 routes' aggregate traffic is "low" (10 onboarding teams + a handful of teaser submissions).
   - What's unclear: Should P4 add slowapi rate limiting?
   - Recommendation: yes. `@limiter.limit("100/hour")` per-IP, mirrors `/api/validate-key`. Easy add.

---

## Sources

### Primary (HIGH confidence — verified by direct read)

- **Codebase files (read in this research session):**
  - `analytics-service/main.py` (router registration L204-213; lifespan worker merge L75-148)
  - `analytics-service/routers/internal.py` (INTERNAL_API_TOKEN auth pattern L104-118)
  - `analytics-service/routers/exchange.py` (validate-key, encrypt-key, fetch-trades shape L24-157)
  - `analytics-service/services/exchange.py` (629 LOC; ccxt hierarchy patterns L101-213)
  - `analytics-service/services/encryption.py` (KEK envelope + decrypt_credentials signature L90-107)
  - `analytics-service/services/job_worker.py` (1653 LOC; dispatch + classify_exception + per-kind handlers)
  - `analytics-service/services/equity_reconstruction.py` (Phase 07 module; existing primitives L1-100)
  - `analytics-service/services/position_reconstruction.py` (FIFO matching L25-100)
  - `analytics-service/services/funding_fetch.py` (8h bucket dedup L60-80)
  - `analytics-service/services/redact.py` (Phase 18 PII scrub L1-80)
  - `src/app/api/keys/sync/route.ts` (queue path + legacy after L80-213)
  - `src/app/api/keys/validate-and-encrypt/route.ts` (38 LOC thin pattern)
  - `src/app/api/strategies/finalize-wizard/route.ts` (scope-broadening probe L60-86; RPC + after L248-376)
  - `src/app/api/factsheet/[id]/pdf/route.ts` (GET; cron-bypass via x-internal-token L42-49)
  - `src/app/api/verify-strategy/route.ts` (verification_requests UPDATE L114-117)
  - `src/app/api/verify-strategy/[id]/status/route.ts` (verification_requests SELECT L20-46)
  - `src/lib/analytics-client.ts` (correlation_id seam L56-121)
  - `src/app/api/cron/sync-funding/route.ts` (cron auth + correlation_id pattern L1-80)
  - `vercel.json` (7 existing crons; pro plan)
  - `supabase/migrations/093_strategy_verifications.sql` (CSV table + RLS + RPC + DO block)
  - `supabase/migrations/094_strategy_verifications_rls_polish.sql`
  - `supabase/migrations/099_mark_compute_job_atomic_status_bridge.sql` (Phase 18 atomic bridge)
  - `supabase/migrations/086_compute_jobs_priority.sql` (claim_compute_jobs_with_priority RPC L96-160)
  - `supabase/migrations/032_compute_jobs_queue.sql` (claim_compute_jobs RPC L531-578)
  - `supabase/migrations/010_portfolio_intelligence.sql` (verification_requests origin L78-98)
  - `supabase/migrations/062_scoring_weight_overrides.sql` (enqueue_compute_job + p_metadata default NULL L160-335)
  - `.planning/REQUIREMENTS.md` (BACKBONE-01..10 + FINGERPRINT-01,02 verbatim)
  - `.planning/ROADMAP.md` (Phase 19 section L181-225)
  - `.planning/STATE.md` (milestone progress L1-170)
  - `.planning/phase-16/day-2-decision.md` (COMMIT verdict + 13 hypotheses + Section 4 BACKBONE table)
  - `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md` (smart discuss output)
  - `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` (BACKBONE-06/07 push-down)
  - `.planning/phases/17-design-contract/17-CONTEXT.md` (DESIGN-01..05 contract)

### Secondary (MEDIUM confidence)

- **`[CITED: PEP 544]`** Protocol structural typing (Python 3.8+) — official PEP
- **`[CITED: PostgreSQL 16 docs]`** `jsonb_array_elements_text`, `IMMUTABLE PARALLEL SAFE` function attributes — official Postgres docs
- **`[CITED: Vercel Cron docs]`** `vercel.json` `crons` array schema; Pro plan 40-cron cap

### Tertiary (LOW confidence — `[ASSUMED]` markers above)

- **A1** Sentry events API endpoint shape — must verify before P7 ships
- **A2** quantstats default `periods=252` — must verify before P8 ships

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every recommended library is already in repo or planner-discretion
- Architecture: HIGH — every workstream has direct codebase precedent
- Pitfalls: HIGH — 10 pitfalls all rooted in actual codebase patterns or recent Phase 18 incidents
- Validation architecture: HIGH — pytest + Vitest patterns verified against existing test suites
- Sentry events API: MEDIUM — endpoint shape MUST be verified live
- quantstats version: LOW — `[ASSUMED]` current pinned version; verify before P8

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days; codebase moves slowly during stability windows)
**Branch verified at end of research:** `v1.0.0-phase-19-unified-backbone` ✓ (no git ops performed)
