# Phase 19: Unified Backbone *(conditional on Day-2 gate = COMMIT)* - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode), 4 areas, all accepted

<domain>
## Phase Boundary

Replace the 5 divergent entry routes (`verify-strategy`, `keys/validate-and-encrypt`, `strategies/finalize-wizard`, `keys/sync` as `flow_type='resync'`, `factsheet/[id]/pdf`) with one observable, idempotent, flag-gated `POST /process-key` FastAPI RPC backed by an `IngestionAdapter` Protocol. Migrate `verification_requests` → `strategy_verifications` via a 4-step VIEW-shim sequence shipped as exactly 4 sequential PRs. Ship the `process_key_unified_backbone` feature flag, the `/api/cron/flag-monitor` auto-rollback cron, drain semantics for in-flight jobs. Fix open-perpetual position valuation correctness (BACKBONE-06) and TWR ≠ YTD reconciliation (BACKBONE-07) at the equity-curve layer — pushed in from Phase 18 because they pair naturally with `IngestionAdapter.reconstruct_positions`. Ship the `strategies.fingerprint JSONB` placeholder column + `compute_similarity()` SQL function. pgvector explicitly deferred to v2 per UC-C.

</domain>

<decisions>
## Implementation Decisions

### Plan Slicing & Wave Structure

- **9 plans total**, one per architectural workstream:
  - **P1** — Entry-gate docs (`route-inventory.md` + `migration-plan.md`); plan-checker hard-blocks Phase 19 entry without both. Smallest diff; ships first.
  - **P2** — Migrations 103-107 (numbers shifted from original 093-097 spec because slots 093, 094, 098-102 are already taken). 103 = strategy_verifications schema additions for state-machine completion + `transition_strategy_verification` RPC; 104 = `wizard_session_id` UNIQUE INDEX + `process_key_long` registry insert + `unified_backbone_at_claim` metadata write on claim; 105 = fingerprint JSONB column + partial index + `compute_similarity()` SQL function; 106 = VIEW-shim flip step (a) — repoint `verify-strategy/route.ts:115` UPDATE to `strategy_verifications` BEFORE rename; 107 = rename old to `verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT ... FROM strategy_verifications` + INSTEAD OF read-only triggers.
  - **P3** — `IngestionAdapter` Protocol + 4 concrete adapters (`okx.py`, `binance.py`, `bybit.py`, `csv_adapter.py`) under new `analytics-service/services/ingestion/` package. Delegates to existing `services/exchange.py` (NOT rewrite per REUSE flag).
  - **P4** — `POST /process-key` router (`analytics-service/routers/process_key.py`) + state-machine wizard transitions (calls migration-103 RPC) + Sentry+structlog instrumentation + auth via `INTERNAL_API_TOKEN`.
  - **P5** — Next.js thin adapters: 5 entry routes become delegators to `${ANALYTICS_BASE_URL}/process-key`; flag read seam at `src/lib/feature-flags.ts`. **VIEW-shim 4-PR sequence ships as 4 sequential commits within P5** (plan-checker validates via PR description metadata that no commit combines adjacent shim steps).
  - **P6** — `wizard_session_id` idempotency (UNIQUE INDEX prevents wizard-double-submit) + long-fetch dispatch via existing PR #53 worker dyno (`compute_jobs.kind='process_key_long'`, `priority='normal'`).
  - **P7** — Flag-monitor cron at `/api/cron/flag-monitor` (15-min schedule) + drain semantics (worker re-reads `compute_jobs.metadata->>'unified_backbone_at_claim'`, NOT live env var).
  - **P8** — BACKBONE-06 (open-perp mark-price valuation + funding-rate accumulation) + BACKBONE-07 (TWR ≠ YTD reconciliation at equity-curve layer). Adds `EquityCurveBuilder` to existing `services/equity_reconstruction.py`.
  - **P9** — Fingerprint v0 (5-component JSONB shape, written at end of `/process-key` pipeline).

- **3 waves** for parallelism:
  - **Wave 1** (independent foundation): P1 + P2 + P3
  - **Wave 2** (depends on W1 schema + Protocol): P4 + P6 + P8 + P9
  - **Wave 3** (depends on W2 router contract): P5 + P7

### Feature Flag + Drain Semantics + Flag-Monitor Cron

- **Flag mechanism**: `PROCESS_KEY_UNIFIED_BACKBONE=on/off` env var on both Vercel and Railway. Read seams: `src/lib/feature-flags.ts` (new, ~40 LOC, in-process 30s cache) on Next.js; `analytics-service/services/feature_flags.py` (new, ~30 LOC, in-process 30s cache) on FastAPI. No new dependency (no Edge Config, LaunchDarkly, Hypertune, or PostHog flags wiring — codebase has none today).
- **Auto-rollback target**: Supabase `feature_flags` kill-switch row (NOT Vercel env var flip). Avoids redeploy churn and `VERCEL_TOKEN` requirement. Flag read seams check kill-switch first; if `off`, override env var. Cached 30s.
- **Drain semantics**: `claim_compute_job` RPC sets `compute_jobs.metadata->>'unified_backbone_at_claim'` at claim time. Workers read THIS value, not the live env var, when picking the code path. Migration 104 adds the metadata write. Flag flip mid-execution does not split-brain in-flight jobs.
- **Flag-monitor cron**: `/api/cron/flag-monitor`, schedule `*/15 * * * *` (every 15 min, fixed tumbling windows). Polls Sentry events API (`SENTRY_AUTH_TOKEN`, scope `org:read,event:read`) for events tagged `correlation_id` + path matching the unified routes + `level=error`. Denominator = total `process-key` correlation_ids logged in the same window from a Supabase audit row. Threshold: error envelope rate > 0.5% in 15-min window → flips kill-switch row to `off`. Sends Sentry alert + Resend email to founder on every breach (regardless of auto-rollback action).

### IngestionAdapter Protocol — Module Layout & Adapters

- **Module layout**: new `analytics-service/services/ingestion/` package.
  - `ingestion/__init__.py` exports `IngestionAdapter` Protocol + shared types.
  - `ingestion/adapter.py` — Protocol definition + `KeySubmissionRequest`, `VerificationResult`, `Trade`, `Position`, `MetricsSnapshot`, `Fingerprint` dataclasses.
  - `ingestion/okx.py`, `ingestion/binance.py`, `ingestion/bybit.py`, `ingestion/csv_adapter.py` — concrete adapters. Delegate to existing `services/exchange.py` (629 LOC unchanged per ROADMAP REUSE flag).

- **Protocol shape — 5 explicit methods**:
  1. `validate(req: KeySubmissionRequest) -> ValidationResult` — broker creds (API path) OR file format (CSV path).
  2. `fetch_raw(creds_or_file) -> list[Trade]` — broker fetch (API) OR CSV parse (CSV).
  3. `compute_metrics(trades: list[Trade]) -> MetricsSnapshot`.
  4. `compute_fingerprint(trades, metrics) -> Fingerprint`.
  5. `reconstruct_positions(trades) -> list[Position]` — wires existing `position_reconstruction.py` + `positions.py` + `funding_fetch.py` primitives (BACKBONE-09 reuse).

- **Router orchestrates the 5 methods in sequence**. State-machine RPC called between steps to advance status (`draft → validated → metrics_captured → encrypted → report_queued → published`).

- **`POST /process-key` location**: new router `analytics-service/routers/process_key.py`, registered in `main.py` after `csv.router` (around L211). Auth: `INTERNAL_API_TOKEN` constant-time check (matches `routers/internal.py:117`). Next.js callers send `Authorization: Bearer ${INTERNAL_API_TOKEN}`.

- **State-machine wizard transitions — DB-side via RPC**: migration 103 ships `transition_strategy_verification(verification_id, new_status, metadata)` RPC. Atomic CHECK constraint + trigger enforces legal state transitions. Single source of truth; cannot bypass via direct UPDATE. Adapter calls this RPC after each pipeline step.

### Fingerprint v0 Shape + Equity-Curve Unification

- **Fingerprint v0 — 5-component JSONB**:
  ```jsonc
  {
    "version": 1,
    "trade_size_buckets": [<4 floats summing to 1.0>],         // <$1k, $1-10k, $10-100k, $100k+
    "hold_duration_buckets": [<4 floats summing to 1.0>],      // <1h, 1-24h, 1-7d, >7d
    "asset_class_mix": [<4 floats summing to 1.0>],            // spot, perp_long, perp_short, futures
    "instrument_concentration": [<10 floats summing to 1.0>],  // top-10 by % volume; pad with 0.0 if <10
    "temporal_pattern": [<24 floats summing to 1.0>]           // % volume per UTC hour
  }
  ```
  Versioned shape preserves identity for future weighting per UC-C.

- **`compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC`** — plain plpgsql cosine on the concatenated fixed-length numeric vector (4+4+4+10+24 = 46 dims). Returns NUMERIC(5,4) in [0,1]. Returns 0.0 if either input is NULL OR `version` mismatches (never errors). `IMMUTABLE PARALLEL SAFE`.

- **Equity-curve unification (BACKBONE-06 + BACKBONE-07)**: add `EquityCurveBuilder` class to existing `services/equity_reconstruction.py`. Wraps `position_reconstruction.py` + `positions.py` + `funding_fetch.py` primitives. Open perps valued at mark-price fetched on demand from broker via `services/exchange.py.get_mark_price` (cached 60s in-process). YTD = window-filtered TWR; TWR = full-history. Sharpe matches an independently-computed quantstats reference within ±0.05 per source.

- **Golden-file fixture format**: JSON at `analytics-service/tests/fixtures/equity-curve-golden/{strategy_name}.json` with `{trades, expected_equity_curve, expected_twr, expected_ytd, expected_sharpe}`. Asserts known-position equity matches manual computation.

- **Adapter wires `reconstruct_positions()` from existing primitive**: `IngestionAdapter.reconstruct_positions()` calls `services.position_reconstruction.reconstruct_positions(trades, mark_prices)` (existing). Mark prices come from `services/exchange.py.fetch_mark_prices(instruments)` for live brokers. For CSV ingestion, mark prices are not applicable (open positions assumed flat at upload time, documented as a known v0 limitation in `IngestionAdapter.csv_adapter` docstring).

### Claude's Discretion

- Exact file/symbol names within the `ingestion/` package (e.g., shared dataclass module split between `adapter.py` and `types.py` if `adapter.py` grows large).
- Concrete `transition_strategy_verification` RPC body — likely guards via `IF NOT EXISTS (SELECT ... FROM transitions WHERE from_status=OLD.status AND to_status=NEW.status) THEN RAISE EXCEPTION` pattern.
- Exact `compute_similarity` SQL implementation details (loop unrolling vs `array_agg` + `unnest`).
- Exact Resend template + email body for the flag-monitor breach alert.
- Whether `EquityCurveBuilder` is a class or module-level functions — pick whichever sits better with neighboring code.
- Plan-checker metadata format for the VIEW-shim 4-commit boundary check inside P5 (commit message convention: `phase-19-shim-step-{a|b|c|d}: …`).
- Test framework specifics within established analytics-service pytest patterns.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`analytics-service/services/exchange.py`** (629 LOC) — UNCHANGED per ROADMAP REUSE flag; adapters wrap, don't rewrite. Provides `validate_key_permissions`, `fetch_raw_trades`, etc.
- **`analytics-service/services/encryption.py`** — KEK env-var encrypt/decrypt; `decrypt_credentials(encrypted_row, kek)` signature already correct.
- **`analytics-service/services/position_reconstruction.py`** + **`services/positions.py`** + **`services/funding_fetch.py`** — perp primitives already 70% built per ROADMAP; BACKBONE-09 wires them through `reconstruct_positions()`.
- **`analytics-service/services/equity_reconstruction.py`** — existing equity-curve module; `EquityCurveBuilder` extends it (no new module).
- **`analytics-service/services/redact.py`** — Phase 18 PII scrub mirror; Sentry boundaries use it.
- **`src/lib/admin/pii-scrub.ts`** — TS denylist + JWT detector + recursive walker. Phase 19 callers use through error envelope per Phase 17 DESIGN-05 contract.
- **`analytics-service/services/job_worker.py`** — existing worker dyno from PR #53; `process_key_long` joins existing `kind` enum (`sync_trades`, `compute_analytics`, `compute_portfolio`, `poll_positions`, `sync_funding`).
- **`analytics-service/routers/internal.py:117`** — `INTERNAL_API_TOKEN` constant-time check pattern; reused for `/process-key` auth.
- **`src/lib/wizardErrors.ts`** — 360 LOC source-of-truth for `human_message` per Phase 17 DESIGN-05 contract.
- **`src/lib/analytics-client.ts:66`** — correlation_id seam already wired (Phase 16 OBSERV-09); `/process-key` callers automatically inherit.

### Established Patterns

- **FastAPI router registration**: each `routers/{name}.py` exposes `router = APIRouter()`; `main.py:204-211` includes them. New router slots in after `csv.router` (L211).
- **Auth pattern**: `Authorization: Bearer ${INTERNAL_API_TOKEN}` on every internal Vercel→Railway call. `routers/internal.py:117` shows the constant-time check via `secrets.compare_digest`.
- **Migration numbering**: sequential, no gaps. Latest is 102 (`sync_trades_preserve_fills`). Phase 19 claims 103-107.
- **structlog instrumentation**: every router call logs `correlation_id` + `path` + `status` + `duration_ms` via the existing structlog config in `analytics-service/services/logging_config.py`.
- **Sentry boundaries**: `analytics-service/sentry_init.py` `before_send` already runs `redact.py` per Phase 18 wire-up.
- **Vercel cron registration**: `vercel.json` `crons` array. Existing crons: `warm-analytics`, `alert-digest`, `cleanup-wizard-drafts`, `sync-funding`, `reconcile-strategies`, `cleanup-ack-tokens`. Phase 19 adds `flag-monitor`. (NOT `vercel.ts` — repo uses `vercel.json` per Phase 18 LP cron decision.)
- **Test framework**: pytest for analytics-service; vitest for Next.js. Test fixtures live next to test files (`analytics-service/tests/fixtures/`, `tests/fixtures/`).

### Integration Points

- **Next.js → FastAPI**: 5 thin adapter routes (`verify-strategy`, `keys/validate-and-encrypt`, `strategies/finalize-wizard`, `keys/sync`, `factsheet/[id]/pdf`) all `POST` to `${ANALYTICS_BASE_URL}/process-key` with `Authorization: Bearer ${INTERNAL_API_TOKEN}` and request body shaped as `KeySubmissionRequest`.
- **Worker dyno → DB**: `process_key_long` jobs claim via existing `claim_compute_job` RPC; migration 104 adds `unified_backbone_at_claim` metadata write on claim.
- **Cron monitor → Supabase + Sentry**: `/api/cron/flag-monitor` reads Sentry events API + writes Supabase `feature_flags` kill-switch row.
- **Wizard UI → idempotency**: `wizard_session_id` already passed via Phase 15 wizard chrome; UNIQUE INDEX (migration 104) prevents double-submit at the DB level. Wizard UI displays "Already submitted" message on the duplicate-key error.

</code_context>

<specifics>
## Specific Ideas

- VIEW-shim 4-PR sequence is enforceable via PR description metadata (commit message convention `phase-19-shim-step-{a|b|c|d}: …`) — plan-checker grep validates that no single commit combines adjacent shim steps.
- Migration 094 (`strategy_verifications_rls_polish`) and 098-102 are already shipped; migration plan must account for the sequential gap and renumber 093-097 → 103-107.
- Phase 19 customer-feedback exit gate (`.planning/phase-19/customer-feedback.md`): captures verbatim feedback from 1-2 of the 10 onboarding teams running a real key submission via the unified flow.
- Day-2 decision = COMMIT confirmed in `.planning/phase-16/day-2-decision.md` (verdict, evidence chain, 3 wizard root causes shipped in PR #116, broker-quirk patches in #117-#120).
- Theme 4 ≥1 Metaworld verbal-in-writing commitment — SATISFIED 2026-05-06 in `.planning/phase-18-root-cause-fix-founder-lp-skeleton/metaworld-commitment.md` per Phase 18 CONTEXT.
- Phase 17 hard exit gate (zero TBDs in DESIGN.md 9-state matrix) — confirm before Phase 19 entry; if any TBD remains, plan-checker rejects.
- Vercel prod `INTERNAL_API_TOKEN` literal `\n` suffix bug (Day-2 hypothesis #12) was fixed 2026-05-06; Phase 19 inherits the clean value.

</specifics>

<deferred>
## Deferred Ideas

- **pgvector + HNSW indexing** — explicitly deferred to v2 per UC-C. Phase 19 ships JSONB placeholder only.
- **MT5 / IBKR adapters** — UC-B drops these; v1.0.0 source list is exactly OKX, Binance, Bybit, CSV.
- **Per-component fingerprint weighting** — UC-C accepts placeholder identity preservation. Weights tuned in v2 once N≥1000 strategies allow statistical validation.
- **Mobile-readable wizard fallback** — Phase 17 DESIGN-04 deferred to v2; trigger condition = PostHog `wizard_start` mobile count > 0 over rolling 7-day window.
- **Auto-rollback via Vercel env var flip** — considered, rejected for redeploy churn. Kept as a manual fallback (founder runs `vercel env rm` if Supabase kill-switch fails).
- **Per-broker quality SLA pattern** (suggested by Bybit broker-quirk PRs #117-#120) — out of v1.0.0 scope; tracked as longer-term architectural concern.

</deferred>
