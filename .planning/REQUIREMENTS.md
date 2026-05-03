# Requirements — v1.0.0 (API-Key Rewrite — Diagnose → Fix → Unify → Ship to LPs)

**Defined:** 2026-04-30
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked.

**Milestone goal:** Ship the version Quantalyze can credibly put in front of LPs and managers. Fix the recurring API-key wizard failure at the root, unify three divergent code paths into one observable backbone, unblock the 10 quant teams in pipeline (CSV-bridged immediately + API-fixed by Day 10), and establish a working dogfood loop with the founder's own LP report.

**Success gate (falsifiable, observable at week 4):** running the full wizard against test credentials per source (OKX, Binance, Bybit) plus a sample daily-returns CSV plus the founder's own fund data, every check passes:
- Wizard accepts the test OKX key → `strategies` row at `status='active'` with `encrypted_key` decrypting cleanly via Vault
- All 10 onboarding teams reach `strategy_verifications.status='published'` (API path for OKX/Binance/Bybit teams; CSV path for MT5/IBKR teams)
- Sharpe matches an independently-computed quantstats reference within ±0.05 per source
- TWR ≠ YTD when the strategy has multi-period history (no single-period mock-data symptom)
- Open perpetual positions valued at mark-price with funding-rate accumulation included
- CSV upload produces same downstream artifacts as API path (different `trust_tier`, same `metrics_snapshot` and `fingerprint`)
- No "Something went wrong" anywhere in the flow — every error path shows `correlation_id` + actionable `human_message`
- No PII (api_key/api_secret/passphrase) in any log or error payload (verified via grep over Supabase log table)
- Founder LP report cron emits a monthly PDF without hand-built intervention
- Widgets render correctly for at least one strategy per source

**Source:** derived from `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260429-225031.md` (1495-line autoplan plan, dual-voice review across CEO + Design + Eng phases, 11 User Challenges resolved 2026-04-30 — 10 accepted, 1 modified) + parallel research outputs in `.planning/research/` (4 researchers + synthesis SUMMARY.md, 2026-04-30).

**Net session estimate:** ~17 CC days (range 17-22). If Day-2 decision gate skips Phase 19: ~10 CC days total.

---

## v1.0.0 Requirements

### CSV — CSV unblock primitive (Phase 15)

- [ ] **CSV-01**: User can upload daily-returns / NAV / trades CSV via first-class `flow_type='csv'` adapter (replaces PR #22 partner-pilot side-branch as canonical entry path)
- [ ] **CSV-02**: Uploaded CSV passes `pandera` row-schema validation before downstream metrics computation — max file size 10MB, monotonic dates, NAV non-zero (no division-by-zero), daily return > -100% impossible, daily Sharpe > 10 sentinel suspicious, currency = USD or blank
- [ ] **CSV-03**: Strategies onboarded via CSV display `csv_uploaded` trust-tier placeholder on factsheet + marketplace tile (Phase 17 polishes the badge component; CSV-03 ships the data-model wiring + placeholder text)

### OBSERV — Diagnostic spike + observability (Phase 16)

- [x] **OBSERV-01**: `correlation_id` UUID injected at `src/lib/analytics-client.ts:66` (NOT `src/proxy.ts` per audit correction); propagates as `x-correlation-id` header through every outbound fetch to FastAPI
- [x] **OBSERV-02**: FastAPI receives `correlation_id` via Sentry CorrelationMiddleware + structlog contextvar; every exception log line + every outbound DB/Resend call carries the value
- [x] **OBSERV-03**: Resend `tags` array carries `correlation_id` on send; webhook handlers read it from inbound payload (with custom-header fallback if `tags` round-trip empirically fails — verified during Phase 16 instrumentation)
- [x] **OBSERV-04**: `@sentry/nextjs` framework hook (already in `src/instrumentation.ts`) extended into `src/app/error.tsx` + `src/app/global-error.tsx` route boundaries (replaces existing `// TODO: wire Sentry.captureException` markers); correlation_id surfaces as Sentry tag
- [x] **OBSERV-05**: `sentry-sdk[fastapi]==2.58.0` added to `analytics-service/requirements.txt`; init pattern mirrors `src/instrumentation.ts` (`SENTRY_DSN` gate, `traces_sample_rate=0.1`, `send_default_pii=False`, `before_send=_redact_before_send`)
- [x] **OBSERV-06**: User sees actionable structured error envelope (RFC 9457-style: `{ok, code, human_message, debug_context, correlation_id, recoverable}`) on every wizard error path — no "Something went wrong" generic; copy-diagnostics button included in `<details>`
- [x] **OBSERV-07**: Admin-gated `/api/debug-key-flow` SSE endpoint (separate token, never persists submitted credentials, short-TTL admin role, audit-log every invocation) runs Path 1 + Path 2 + sync sequentially against test credentials and streams structured diagnostic JSON to caller
- [x] **OBSERV-08**: `scripts/repro-key-flow.sh` runs the unified key flow against `vcrpy==8.1.1` cassettes for OKX/Binance/Bybit happy + failure paths without network access; cassettes scrub auth headers via PII filters before commit
- [x] **OBSERV-09**: `structlog==25.5.0` produces JSON-format logs from FastAPI with `correlation_id` in every record via contextvar
- [x] **OBSERV-10**: Migrations `084_first_api_key_added_trigger.sql` + `085_stamp_first_bridge_surfaced.sql` + `086_compute_jobs_priority.sql` audited under unified pipeline; integration tests assert each `stamp_first_*` RPC fires correctly; RLS context drift across Railway → Supabase boundary verified
- [x] **OBSERV-11**: PostHog `wizard_start` mobile-device audit completes with documented count (gates UC-H Phase 17 mobile-readable fallback build); count value committed to TODOS.md
- [x] **OBSERV-12**: `restore-e2e-fixtures` PR merged before any other Phase 16 instrumentation work begins — bit-for-bit pre-PR-#90 restore of `e2e/api-key-flow.spec.ts` (-242 LOC) + `scripts/seed-full-app-demo.ts` (-1721 LOC) + `src/lib/observability.ts` (-28 LOC); presence-check assertion in CI

### DESIGN — Design contract (Phase 17, hard exit gate before Phase 19)

- [ ] **DESIGN-01**: DESIGN.md gains trust-tier badge component variants — `api_verified` filled accent #1B6B5A pill, `csv_uploaded` neutral #4A5568 outline pill, `self_reported` warning amber #B45309 outline pill — with typed token constants in `src/lib/design-tokens/trust-tier.ts`; regex test asserts DESIGN.md ↔ token file consistency
- [ ] **DESIGN-02**: DESIGN.md gains error envelope render wireframe — title=`human_message` (16px DM Sans semibold #1A1A2E), CTA derived from `recoverable` boolean (Retry true / Contact support false), collapsed `<details>` with code + correlation_id in Geist Mono 12px #718096, copy-diagnostics ghost button inline with `QUANTALYZE_DIAG` payload format
- [ ] **DESIGN-03**: DESIGN.md gains broker selector 2×3 card grid (white surface, 1px #E2E8F0 border, 8px radius) + per-source field schema enumerated; CSV escape-hatch full-width card BELOW the broker grid titled "Don't have an API key? Upload CSV instead" (3 accepted formats as segmented control: daily_nav / daily_returns / trades; max 10MB)
- [ ] **DESIGN-04**: DESIGN.md gains mobile-readable wizard fallback specification (read-only review state for < 640px viewports) — conditional on OBSERV-11 mobile-start audit count > 0; if count = 0, ship 640px gate as today
- [ ] **DESIGN-05**: DESIGN.md gains 9-state matrix per surface (loading / empty / error / partial / success / retry-in-flight / stale / optimistic / offline) with zero TBD cells; a11y minimums published (4.5:1 contrast on trust badges, ARIA live regions on state changes, keyboard-nav stepper, focus management between wizard steps); `wizardErrors.ts` declared source-of-truth for `human_message` strings (envelope's `human_message` = existing `title`; `debug_context` carries existing `fix[]` array as expandable list)

### FIX — Root-cause fix (Phase 18)

- [ ] **FIX-01**: Whatever root cause Phase 16 surfaced (Vault KEK access / finalize-wizard FK / Resend env drift / Supabase RLS / OKX passphrase encoding / off-list cause) is fixed at the source layer; regression test that fails without the fix is committed alongside the fix
- [ ] **FIX-02**: Founder's own OKX test key passes the wizard end-to-end in the production-equivalent environment; `strategies` row at `status='active'`, `encrypted_key` decrypts cleanly via Vault to the exact original tuple
- [ ] **FIX-03**: All 10 onboarding teams' keys flow through end-to-end: `strategy_verifications.status='published'` for OKX/Binance/Bybit teams via API path; `status='validated'` (or higher) for MT5/IBKR teams via CSV path from Phase 15; per-team status tracked in TODOS.md
- [ ] **FIX-04**: PII redaction utility — `analytics-service/services/redact.py` mirrors existing `src/lib/admin/pii-scrub.ts` denylist (8 keys: `apikey`, `apisecret`, `secret`, `signature`, `passphrase`, `authorization`, `x-mbx-apikey`, `ok-access-sign`) with case-insensitive regex `/^.*(key|secret|pass|token|credential|cookie|session|auth|bearer)$/i`, recursive walker, JWT-shape detector, account-id truncator; shared fixture corpus across TS + Python (20 bad / 5 good); grep over Supabase log table after a test run shows zero PII. **Do NOT create `src/lib/redact.ts` — `pii-scrub.ts` already exists.**

### LP — Founder LP report skeleton (Phase 18)

- [ ] **LP-01**: Founder LP report cron emits monthly PDF via existing `/api/factsheet/[id]/pdf` endpoint reused as-is — no branded design dependency; Vercel cron schedule registered in `vercel.ts`
- [ ] **LP-02**: Founder LP cron failure surfaces alert (Sentry capture with cron-failure tag + correlation_id); silent failure prohibited
- [ ] **LP-03**: Phase 18 exit interview captures founder verbal-in-writing commitment to send the unedited cron PDF to a real LP within 14 days of milestone close (dogfood loop closure per Pitfall 10); commitment text logged in `.planning/phase-18/dogfood-commitment.md`

### BACKBONE — Unified backbone (Phase 19, conditional on Day-2 decision gate)

- [ ] **BACKBONE-01**: `POST /process-key` FastAPI RPC accepts `KeySubmissionRequest{flow_type ∈ {teaser, onboard, internal_report, csv, resync}, source ∈ {okx, binance, bybit, csv}, context: dict}`; standardized `VerificationResult` response with `metrics_snapshot`, `fingerprint`, `encrypted_credentials` (optional), `status`, `trust_tier`, `errors[]`
- [ ] **BACKBONE-02**: `IngestionAdapter` Protocol with `validate_credentials` / `fetch_history` / `reconstruct_positions` methods; per-method explicit error envelope contract; separate flow paths for CSV (file-format validation) vs API (broker-credential validation); implementations live in `analytics-service/services/adapters/{okx,binance,bybit,csv}.py`
- [ ] **BACKBONE-03**: `strategy_verifications` table with status state-machine (`draft → validated → metrics_captured → encrypted → report_queued → published`) + `trust_tier` column (`api_verified` | `csv_uploaded` | `self_reported`); migration 093 ships the schema with TEXT CHECK constraint (not ENUM type for ALTER ergonomics)
- [ ] **BACKBONE-04**: VIEW-shim migration sequence — exactly 4 sequential PRs: (a) repoint `verify-strategy/route.ts:115` UPDATE to `strategy_verifications` BEFORE rename, (b) flip `process_key_unified_backbone` flag, (c) verify zero writes to old table over ≥24h via logs, (d) rename old to `verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT ... FROM strategy_verifications` with `INSTEAD OF` triggers (read-only enforcement); 7 calendar days at 100% rollout before VIEW drop. Plan-checker rejects Phase 19 exit if any single PR combines adjacent steps.
- [ ] **BACKBONE-05**: Feature flag `process_key_unified_backbone` (Vercel env var, per-environment); 7-day stability window at 100% rollout with zero error-envelope regressions; manual rollback via `vercel env rm`; old route handlers remain reactivatable behind flag during 90-day support-lookup window
- [ ] **BACKBONE-06**: `/api/cron/flag-monitor` cron route (every 15 min via `vercel.ts` cron config) polls Sentry events API + Vercel REST API and flips feature flag if error-envelope rate > 0.5% in 15-min window; auth tokens (`SENTRY_AUTH_TOKEN` event:read scope, `VERCEL_API_TOKEN` project-scoped) stored as Vercel env vars; alerting webhook to founder on any auto-flip
- [ ] **BACKBONE-07**: `wizard_session_id` UNIQUE INDEX on `strategy_verifications` + route-level idempotency check on `/process-key` — wizard double-submit produces single row, not duplicates; matches Phase 02 `compute_jobs.idempotency_key` precedent
- [ ] **BACKBONE-08**: Long-fetch flows (multi-year history pulls from slow exchanges) dispatch via existing PR #53 worker dyno on Railway — `compute_jobs.kind='process_key_long'`, `priority='normal'`; `/process-key` returns `{queued, correlation_id}` synchronously; worker writes `VerificationResult` back to `strategy_verifications` row; idempotent under retries via `wizard_session_id`. Avoids Vercel 300s timeout per autoplan A1.4.
- [ ] **BACKBONE-09**: Open-perp position correctness — `reconstruct_positions()` adapter method wires existing `analytics-service/services/position_reconstruction.py` + `positions.py` + funding-fees migration (primitives already 70% built per Architecture audit); mark-price valuation + funding-rate accumulation included in equity curve; TWR=YTD bug fixed at equity-curve layer; golden-file fixture asserts known-position equity matches manual computation. +1-2 CC days per E-9.
- [ ] **BACKBONE-10**: All 5 entry routes (`/api/verify-strategy`, `/api/keys/validate-and-encrypt`, `/api/strategies/finalize-wizard`, `/api/keys/sync` as `flow_type='resync'`, `/api/factsheet/[id]/pdf`) become thin Next.js adapters delegating to `/process-key`; pre-Phase-19 deliverable: `.planning/phase-19/route-inventory.md` greps every Next.js route exporting non-GET handlers touching `api_keys | strategies | strategy_analytics | verification_requests | strategy_verifications | compute_jobs` — every row maps to a `flow_type` or carries explicit "out of scope" rationale (Pitfall 1 — 4th orphan path)

### FINGERPRINT — Similarity placeholder (Phase 19)

- [ ] **FINGERPRINT-01**: `strategies.fingerprint JSONB` column added (versioned shape with per-component arrays preserving identity for future weighting); partial index `WHERE fingerprint IS NOT NULL`; on every key ingestion (any `flow_type`), compute fingerprint and persist; backfill script over existing rows on first cron run after ship. Migration 096.
- [ ] **FINGERPRINT-02**: `compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC` SQL function — `IMMUTABLE PARALLEL SAFE`, plain plpgsql cosine over component-vector arrays, returns 0.0 on shape mismatch (never errors); `REVOKE EXECUTE ... FROM PUBLIC; GRANT EXECUTE TO authenticated, service_role;` mirrors migration 086/087 H-B `search_path=public, pg_temp` hardening; called from psql or debug endpoint. **pgvector explicitly deferred to v2 design doc per UC-C.**

---

## Future Requirements (v2 — opens after Phase 19 stability window passes)

### MATCH-FLAG MOAT

- **MATCH-FLAG-01**: pgvector + HNSW migration from JSONB placeholder (gated on N≥1000 strategies in fingerprint index)
- **MATCH-FLAG-02**: Match-flag UX in branded PDFs + public verify page — confidence score, top-K similar strategies, "uncertain match" UI variant
- **MATCH-FLAG-03**: Outbound queue + ops outreach mechanism for unmatched fingerprints
- **MATCH-FLAG-04**: Cross-fund similarity audit dashboard for FoF allocators

### FOF SURFACE

- **FOF-01**: `/for-allocators/verify` landing surface with IC-handoff PDF template (Eltican Positron Dashboard reference)
- **FOF-02**: Pricing experiment ($100-$2k/mo seat with Metaworld + first paying FoFs)
- **FOF-03**: Trust-tier filter on FoF verification dashboard (api_verified vs csv_uploaded vs self_reported)
- **FOF-04**: Multi-tenant FoF organizations (manager-to-allocator separation)

### MULTI-BROKER

- **MT5-01**: MetaTrader 5 API adapter (feasibility study + Windows-worker pattern OR report-export-based ingestion + dedicated infra workstream)
- **IBKR-01**: Interactive Brokers adapter (TWS gateway connection on dedicated Railway worker OR IBKR Web API)
- **MULTI-BENCHMARK-01**: ETH / SOL benchmark ingestion pipelines (`benchmarks_eth`, `benchmarks_sol` tables, ccxt fetch path); `benchmark.py` extension to accept ETH/SOL alongside BTC

### LP REPORT BRANDED

- **LP-BRANDED-01**: Branded LP report design (Eltican Positron Dashboard reference); replaces v1 unbranded factsheet PDF cron
- **LP-BRANDED-02**: Multi-strategy bundle editor for fund-level LP report
- **LP-BRANDED-03**: PDF presskit auto-generation

### MANAGER WORKSPACE

- **TEAM-WORKSPACE-01..05**: Manager Workspace 5-tab IA, Inbox queue, Counterparty drawer + Intro Threads with Realtime + Storage RLS, Team roster + invitations on existing `organizations` schema, Canonical Mandate doc + Activity log + monthly tear-sheet cron — formerly v0.18 plan, deferred until paid pilots validate FoF/manager demand

### ANALYTICS DEFERRED

- **ANALYTICS-01..04**: Stress testing engine, monthly performance commentary (deterministic, no LLM), drawdown story card, advanced portfolio optimizer (risk parity + explicit constraints) — deferred from Sprint 8

### PEER

- **PEER-01**: Peer benchmarking foundation (gated on 5+ connected allocators)

---

## Out of Scope (v1.0.0 explicit exclusions)

| Feature | Reason |
|---------|--------|
| Match-flag UX in PDFs / verify page | v2 — gated on N≥1000 + paid FoF validation; UC-C accepted defer |
| pgvector + HNSW index | v2 — JSONB placeholder + `compute_similarity()` ships in v1; statistically meaningless at N=10 (Theme 3) |
| MT5 + IBKR API adapters | v2 — CSV bridge ships in v1 (UC-B accepted defer); MT5 historically Windows-only; IBKR persistent gateway connection incompatible with Railway serverless |
| FoF-specific landing surface (`/for-allocators/verify`) | v2 — Phase 4 deferred per autoplan; opens only after Phase 19 stability window |
| IC-handoff PDF template (Eltican Positron Dashboard reference) | v2 — branded design dependency; UC-F skeleton-only in v1 |
| Pricing experiment with Metaworld + first paying FoFs | v2 — happens after v1 ships and ≥1 paid pilot validates demand |
| Branded LP report design | v2 — UC-F skeleton-only; cron PDF reuses existing factsheet endpoint with no new design |
| Manager Workspace 5-tab IA | post-v1 — formerly v0.18 plan; reconsider after v1 ships and FoF/manager demand validated |
| Multi-benchmark correlation matrix (ETH / SOL) | post-v1 — needs new benchmark ingestion pipeline |
| Mobile-responsive polish on strategy pages | post-v1 — desktop-only acceptable for v1 LP demo |
| Match-flag at N=10 | Anti-feature — statistically meaningless; false positives damage credibility (Theme 3) |
| Silent retry on errors | Anti-feature — hides root causes; perpetuates recurrence (Theme 5) |
| Mid-rewrite tooling upgrades (TS5→6, ESLint 10, chromium 133→148) | Anti-feature — orthogonal risk; bundle as single tooling-upgrade PR post-Phase-19 |
| `src/lib/redact.ts` (new file from autoplan text) | Anti-feature — `src/lib/admin/pii-scrub.ts` already exists with tested denylist; Phase 18 ships only the Python mirror |
| `verification_requests` legacy data backfill | Different semantic model — public verifications were ephemeral teasers; old table renamed to `_legacy`, retained read-only 90 days for support lookup, then dropped |
| New top-level `mandate_fit` weight | Composed inside `W_PREFERENCE_FIT` to preserve total weight sum = 1.0 (Sprint 8 ratified) |
| Full column-level RLS on mandates | Postgres doesn't support it; SECURITY DEFINER RPC gives the same guarantee |
| LLM-generated financial commentary | Liability risk for institutional product; all commentary deterministic |
| Real-time WebSocket data | Year 2 |
| White-label partner portal | Year 3 |
| `_check_trading_window` rule on CSV-02 | Crypto markets trade 24/7 — flagging weekend dates would fail every real customer CSV. Dropped 2026-04-30 during Phase 15 cross-AI revision pass. |

---

## Phase-Internal Gates (operational, not REQ-IDs)

These are blocking gates the roadmapper must encode as phase entry/exit conditions, NOT requirements per se. They depend on founder action that engineering cannot enforce.

| Gate | Phase | Resolution |
|------|-------|------------|
| Day 0.5 — Vault-from-Railway pre-flight | Phase 16 | Read known KEK row from Supabase Vault and decrypt test ciphertext. If access denied: skip ahead to Phase 18 with "fix Vault access" as first task. |
| 10/10 teams onboarded via CSV by Day 2 (≥3 reply threshold) | Phase 15 | Per-team `strategy_verifications.status='validated'` row check. Below ≥3-of-10 reply threshold logs gap to `.planning/phase-15/customer-signal-gap.md` and ships anyway. |
| Theme 4 founder-interview pass | Phase 18 entry | ≥1 verbal-in-writing Metaworld commitment (text logged in `.planning/phase-18/metaworld-commitment.md`) before Phase 18 starts |
| Day-2 decision gate (Day 4) | Phase 16 → Phase 19 | Founder reviews `/api/debug-key-flow` output. Decides: COMMIT Phase 19 OR apply 1-line fix and skip Phase 19 (close milestone at ~10 CC days). 2-hour minimum deliberation floor; falsifiable SKIP/COMMIT/HOLD criteria + correlation_id evidence chain + regression test snippet documented in `.planning/phase-16/day-2-decision.md` before Phase 18 or 19 code lands. |
| Phase 17 Design Contract complete (no TBD cells) | Phase 17 → Phase 19 | Hard gate — Phase 19 cannot start while any per-surface state is "TBD" in DESIGN.md additions. Plan-checker rejects Phase 19 entry without DESIGN.md grep showing zero TBDs. |
| `restore-e2e-fixtures` PR merged | Phase 16 prep | UC-E modified — let PR #90 merge but pin restore-e2e-fixtures PR FIRST putting back api-key-flow.spec.ts + seed-full-app-demo.ts + observability.ts before any Phase 16 instrumentation work |
| Phase 19 route inventory | Phase 19 entry | `.planning/phase-19/route-inventory.md` greps every Next.js route exporting non-GET handlers touching api_keys / strategies / strategy_analytics / verification_requests / strategy_verifications / compute_jobs. Every row maps to a `flow_type` or carries explicit out-of-scope rationale. (Pitfall 1 mitigation.) |
| Migration drift resolution | Phase 16 prerequisite | Path A/B/C decision in TODOS.md from v0.17 carryover (DISCO-05 push pending). Resolved BEFORE any v1 migration files (093-097) land. |
| Phase 19 migration plan | Phase 19 entry | Numbers 093-097 reserved upfront in `.planning/phase-19/migration-plan.md` to prevent drift collisions. Plan-checker rejects Phase 19 entry without this document. |

---

## Traceability

Phase mapping (v1.0 phase numbers continue from v0.17 — Phase 14b → Phase 15-19). Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CSV-01 | Phase 15 | Pending |
| CSV-02 | Phase 15 | Pending |
| CSV-03 | Phase 15 | Pending |
| OBSERV-01 | Phase 16 | Complete |
| OBSERV-02 | Phase 16 | Complete |
| OBSERV-03 | Phase 16 | Complete |
| OBSERV-04 | Phase 16 | Complete |
| OBSERV-05 | Phase 16 | Complete |
| OBSERV-06 | Phase 16 | Complete |
| OBSERV-07 | Phase 16 | Complete |
| OBSERV-08 | Phase 16 | Complete |
| OBSERV-09 | Phase 16 | Complete |
| OBSERV-10 | Phase 16 | Complete |
| OBSERV-11 | Phase 16 | Complete |
| OBSERV-12 | Phase 16 | Complete |
| DESIGN-01 | Phase 17 | Pending |
| DESIGN-02 | Phase 17 | Pending |
| DESIGN-03 | Phase 17 | Pending |
| DESIGN-04 | Phase 17 | Pending |
| DESIGN-05 | Phase 17 | Pending |
| FIX-01 | Phase 18 | Pending |
| FIX-02 | Phase 18 | Pending |
| FIX-03 | Phase 18 | Pending |
| FIX-04 | Phase 18 | Pending |
| LP-01 | Phase 18 | Pending |
| LP-02 | Phase 18 | Pending |
| LP-03 | Phase 18 | Pending |
| BACKBONE-01 | Phase 19 (conditional) | Pending |
| BACKBONE-02 | Phase 19 (conditional) | Pending |
| BACKBONE-03 | Phase 19 (conditional) | Pending |
| BACKBONE-04 | Phase 19 (conditional) | Pending |
| BACKBONE-05 | Phase 19 (conditional) | Pending |
| BACKBONE-06 | Phase 19 (conditional) | Pending |
| BACKBONE-07 | Phase 19 (conditional) | Pending |
| BACKBONE-08 | Phase 19 (conditional) | Pending |
| BACKBONE-09 | Phase 19 (conditional) | Pending |
| BACKBONE-10 | Phase 19 (conditional) | Pending |
| FINGERPRINT-01 | Phase 19 (conditional) | Pending |
| FINGERPRINT-02 | Phase 19 (conditional) | Pending |

**Coverage:**
- v1.0.0 requirements: 39 total (3 CSV + 12 OBSERV + 5 DESIGN + 4 FIX + 3 LP + 10 BACKBONE + 2 FINGERPRINT)
- Mapped to phases: 39 ✓
- Unmapped: 0 ✓

---

*Requirements defined: 2026-04-30*
*Last updated: 2026-04-30 — Phase 15 cross-AI revision pass: dropped `_check_trading_window` rule from CSV-02 (crypto trades 24/7).*
