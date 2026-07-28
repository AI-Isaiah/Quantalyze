---
phase: 19
slug: unified-backbone-conditional-on-day-2-gate-commit
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-08
updated: 2026-05-08
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated by gsd-planner from RESEARCH.md §Validation Architecture (line 2027+)
> and the 9 plan files (19-01..19-09 PLAN.md).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) + Vitest 3.0.0 (Next.js) + Playwright 1.51.0 (E2E) |
| **Config files** | `analytics-service/pytest.ini`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command (backend)** | `cd analytics-service && pytest tests/test_<file>.py::<test> -x` |
| **Quick run command (frontend)** | `npx vitest run --reporter=basic <file>` |
| **Full suite (backend)** | `cd analytics-service && pytest --cov=services --cov-fail-under=80` |
| **Full suite (frontend)** | `npm run test:coverage && npm run test:e2e` |
| **Estimated runtime** | quick ~30s; full ~3-4 min frontend + ~5 min analytics |

---

## Sampling Rate

- **After every task commit:** Run quick suite for the task's REQ-IDs (test files mapped to `files_modified`).
- **After every plan wave:** Run full suite (both pytest and vitest).
- **Before `/gsd-verify-work`:** Full suite green + e2e green.
- **Max feedback latency:** ~30 seconds for quick.

---

## Per-Task Verification Map

| Plan | Task | REQ IDs | Threat Refs | Automated Test Command | Wave 0 File |
|------|------|---------|-------------|------------------------|-------------|
| 19-01 | P1-1 (route-inventory.md) | BACKBONE-10 | T-19-01 | `bash scripts/check-route-inventory.sh` | `.planning/phase-19/route-inventory.md` |
| 19-01 | P1-2 (migration-plan.md) | BACKBONE-04, BACKBONE-10 | T-19-02 | `grep -E '\\| 10[3-7] \\|' .planning/phase-19/migration-plan.md \| wc -l` returns 5 | `.planning/phase-19/migration-plan.md` |
| 19-01 | P1-3 (CI scripts + 3 stubs) | BACKBONE-04, BACKBONE-10 | T-19-01, T-19-02, T-19-03 | `test -x scripts/check-route-inventory.sh && test -x scripts/check-phase-19-shim-commits.sh && bash scripts/check-route-inventory.sh` | `scripts/check-route-inventory.sh`, `scripts/check-phase-19-shim-commits.sh` |
| 19-02 | P2-1 (migration 103 RPC) | BACKBONE-03, BACKBONE-07 | T-19-04, T-19-05 | `pytest analytics-service/tests/test_transition_rpc.py -x` (5 tests including H-14 test_validate_failure_resets_draft_with_errors) | `analytics-service/tests/test_transition_rpc.py` |
| 19-02 | P2-2 (migration 104 + drain) [C-1, C-2, C-3, D-1, M-1, M-2] | BACKBONE-05, BACKBONE-08, BACKBONE-09 | T-19-06, T-19-09 | `pytest analytics-service/tests/test_drain_semantics.py -x` (6 tests: 4 + D-1 reclaim-preserves-snapshot + C-1 status-enum-pending) + migration self-verify DO block contains SAVEPOINT-wrapped functional smoke for C-1 | `analytics-service/tests/test_drain_semantics.py` |
| 19-02 | P2-3 (migration 105 + similarity) [M-3, M-4, H-9] | FINGERPRINT-01, FINGERPRINT-02 | T-19-07, T-19-08, T-19-51 | `pytest analytics-service/tests/test_compute_similarity_sql.py -x` (7 tests: 6 + M-3 test_check_rejects_missing_version) (skipped without test Supabase) | `analytics-service/tests/test_compute_similarity_sql.py` |
| 19-02 | P2-4 (migration 106 sentinel) | BACKBONE-04 | (sentinel only) | `grep -q 'BACKBONE-04 step (a)' supabase/migrations/106_*.sql` | (sentinel migration) |
| 19-02 | P2-5 (migration 107 VIEW) | BACKBONE-04 | T-19-10 | `grep -q 'INSTEAD OF INSERT' supabase/migrations/107_*.sql && grep -q 'INSTEAD OF UPDATE' supabase/migrations/107_*.sql && grep -q 'INSTEAD OF DELETE' supabase/migrations/107_*.sql && grep -q 'verification_requests_legacy_public_token_select' supabase/migrations/107_*.sql && grep -q 'C-7 backfill' supabase/migrations/107_*.sql` (C-7 + C-9 + M-5 + M-6) | (deferred apply to P5 PR-D) |
| 19-02 | P2-6 (BLOCKING schema push) | BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-08, BACKBONE-09, FINGERPRINT-01, FINGERPRINT-02 | T-19-04..T-19-10 | `mcp__supabase__apply_migration` for 103, 104, 105, 106 (107 deferred to P5 PR-D) + post-push DO-block self-verify | (live test Supabase verify) |
| 19-02 | P2-7 (down-migrations 103-107) [C-8] | BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-08, BACKBONE-09, FINGERPRINT-01, FINGERPRINT-02 | (no new threat surface) | `ls supabase/migrations/down/10[3-7]-rollback.sql \| wc -l` returns 5 | `supabase/migrations/down/{103-107}-rollback.sql` |
| 19-03 | P3-1 (Protocol + dataclasses) | BACKBONE-01, BACKBONE-02 | (no new threat surface) | `pytest analytics-service/tests/test_ingestion_protocol.py -x` | `analytics-service/tests/test_ingestion_protocol.py` |
| 19-03 | P3-2 (3 broker adapters) | BACKBONE-02 | T-19-12, T-19-13 | `python -c "from services.ingestion import IngestionAdapter; from services.ingestion.okx import OkxAdapter; from services.ingestion.binance import BinanceAdapter; from services.ingestion.bybit import BybitAdapter; assert isinstance(OkxAdapter(), IngestionAdapter); assert isinstance(BinanceAdapter(), IngestionAdapter); assert isinstance(BybitAdapter(), IngestionAdapter)"` | (Python import smoke) |
| 19-03 | P3-3 (CSV adapter) | BACKBONE-02 | T-19-15 | `pytest analytics-service/tests/test_csv_adapter.py -x` | `analytics-service/tests/test_csv_adapter.py` |
| 19-04 | P4-1 (feature_flags.py) | BACKBONE-04, BACKBONE-05 | T-19-21, T-19-23 | `pytest analytics-service/tests/test_feature_flags.py -x` | `analytics-service/tests/test_feature_flags.py` |
| 19-04 | P4-2 (process_key router) [H-2, H-3, H-11, H-12, MC-4] | BACKBONE-01, BACKBONE-02, BACKBONE-04, BACKBONE-08 | T-19-16..T-19-22 | `pytest analytics-service/tests/test_process_key.py -x` (13 tests: 9 + H-11 source whitelist + H-12 INTERNAL_API_TOKEN regression + MC-4 metrics encoder + H-2 audit-write) | `analytics-service/tests/test_process_key.py` |
| 19-05 | P5-1 (TS feature-flags.ts) | BACKBONE-04, BACKBONE-05 | T-19-23 | `npx vitest run tests/lib/feature-flags.test.ts` | `tests/lib/feature-flags.test.ts` |
| 19-05 | P5-2 (5 thin adapters + status route) [C-5, H-1] | BACKBONE-01, BACKBONE-04, BACKBONE-10 | T-19-24, T-19-26, T-19-28 | `npx vitest run tests/integration/process-key-thin-adapters.test.ts tests/integration/phase-19-pra-write.test.ts tests/integration/phase-19-pra-status-roundtrip.test.ts` (C-5 NOT NULL + H-1 status round-trip) | `tests/integration/phase-19-pra-write.test.ts`, `tests/integration/phase-19-pra-status-roundtrip.test.ts` |
| 19-05 | P5-3 (4-PR shim sequence) [H-7, H-8] | BACKBONE-04, BACKBONE-05, BACKBONE-10 | T-19-25, T-19-27, T-19-29 | `bash scripts/check-phase-19-shim-commits.sh` (after PR-D merges; H-7 168h delta enforced) + `bash scripts/verify-no-legacy-writes.sh` (during PR-C — now CI-cron blocking, H-8) + Postgres trigger `verification_requests_post_phase19_audit` writing to audit_log on legacy writes (H-8) | `scripts/verify-no-legacy-writes.sh`, `.github/workflows/phase-19-stability.yml` |
| 19-06 | P6-1 (long_fetch.py worker) | BACKBONE-05, BACKBONE-09 | T-19-30..T-19-34 | `pytest analytics-service/tests/test_long_fetch.py -x` | `analytics-service/tests/test_long_fetch.py` |
| 19-06 | P6-2 (main_worker dispatch flag) | BACKBONE-05, BACKBONE-09 | T-19-30 | `pytest analytics-service/tests/test_drain_semantics.py -x` (P2's test still passes after Python wiring update) | (existing test) |
| 19-06 | P6-3 (WIZARD_DUPLICATE code) [H-4] | BACKBONE-08 | (no new threat surface) | `npx tsc --noEmit && WIZARD_ERROR_COPY['WIZARD_DUPLICATE'] shape valid via tests/lib/wizard-errors-shape.test.ts + vitest renders duplicate state through formatKeyError` (H-4 — replaces grep-only) | `tests/lib/wizard-errors-shape.test.ts` |
| 19-07 | P7-1 (Sentry probe script) | BACKBONE-05 | T-19-40 | manual run + verify shape (checkpoint) | `scripts/probe-sentry-events-api.sh` |
| 19-07 | P7-1.5 (Sentry environment tag) [H-6] | BACKBONE-05 | (no new threat surface) | `tests/integration/sentry-environment.test.ts` asserts captured event tags.environment === VERCEL_ENV | `tests/integration/sentry-environment.test.ts` |
| 19-07 | P7-2 (flag-monitor cron) [H-2] | BACKBONE-05, BACKBONE-09 | T-19-35..T-19-41 | `npx vitest run tests/integration/cron-flag-monitor.test.ts` (11 tests: 7 + H-2 zero-denominator alert + zero-denominator streak reset + D-3 PostgREST fallback + H-6 Sentry environment smoke) | `tests/integration/cron-flag-monitor.test.ts` |
| 19-07 | P7-3 (e2e auto-rollback + PostgREST fallback + cache TTL) [H-10, D-3, D-4] | BACKBONE-05 | T-19-35..T-19-41 | `npx vitest run tests/integration/cron-flag-monitor-rollback-e2e.test.ts` (e2e propagation within 30s; D-3 PostgREST fallback; D-4 PHASE_19_STABILITY_CACHE_TTL_S env var honored) | `tests/integration/cron-flag-monitor-rollback-e2e.test.ts` |
| 19-08 | P8-1 (quantstats probe + fifo decision) | BACKBONE-06, BACKBONE-07 | (assumption verification) | manual run (checkpoint) | `scripts/probe-quantstats-version.sh` |
| 19-08 | P8-2 (EquityCurveBuilder + fetch_mark_prices) | BACKBONE-06, BACKBONE-07, BACKBONE-09 | T-19-42..T-19-46 | `pytest analytics-service/tests/test_equity_curve_builder.py -x` | (Task 3 ships the test) |
| 19-08 | P8-3 (4 golden fixtures + pytest) [H-13, MC-2] | BACKBONE-06, BACKBONE-07, BACKBONE-10 | T-19-42, T-19-47 | `pytest analytics-service/tests/test_equity_curve_builder.py -x` (8 tests: 7 + H-13 test_csv_adapter_twr_ytd_parity) | `analytics-service/tests/test_equity_curve_builder.py` + 4 fixture JSONs (okx-multi-month-perps, binance-spot-only, bybit-perp-with-funding, csv-spot-only [H-13]) |
| 19-09 | P9-1 (compute_fingerprint_v1) [H-9] | FINGERPRINT-01, FINGERPRINT-02 | T-19-48..T-19-52 | `pytest analytics-service/tests/test_fingerprint.py -x -k 'not integration'` (17 tests: 11 + H-9 5 explicit similarity tests + H-14 cross-reference) (Python-only) + `-k integration` against test Supabase | `analytics-service/tests/test_fingerprint.py` |

---

## Wave 0 Requirements

All Wave 0 file dependencies are scaffolded by their owning plan task (each task creates its own pytest stub before/alongside the implementation it verifies). All tests are NEW for Phase 19 — no existing test infrastructure covers these REQs.

- [x] (covered by 19-04 P4-2) `analytics-service/tests/test_process_key.py` — BACKBONE-01, BACKBONE-08
- [x] (covered by 19-03 P3-1) `analytics-service/tests/test_ingestion_protocol.py` — BACKBONE-02
- [x] (covered by 19-03 P3-3) `analytics-service/tests/test_csv_adapter.py` — BACKBONE-02 (CSV branch)
- [x] (covered by 19-02 P2-1) `analytics-service/tests/test_transition_rpc.py` — BACKBONE-03 state machine
- [x] (covered by 19-06 P6-1) `analytics-service/tests/test_long_fetch.py` — BACKBONE-09 worker
- [x] (covered by 19-02 P2-2) `analytics-service/tests/test_drain_semantics.py` — BACKBONE-05/09 drain
- [x] (covered by 19-08 P8-3) `analytics-service/tests/test_equity_curve_builder.py` — BACKBONE-06, BACKBONE-07
- [x] (covered by 19-09 P9-1) `analytics-service/tests/test_fingerprint.py` — FINGERPRINT-01
- [x] (covered by 19-02 P2-3) `analytics-service/tests/test_compute_similarity_sql.py` — FINGERPRINT-02
- [x] (covered by 19-04 P4-1) `analytics-service/tests/test_feature_flags.py` — BACKBONE-05 Python
- [x] (covered by 19-08 P8-3) `analytics-service/tests/fixtures/equity-curve-golden/` — 3 JSON golden files
- [x] (covered by 19-05 P5-1) `tests/lib/feature-flags.test.ts` — Next.js side flag-read seam
- [x] (covered by 19-05 P5-2) `tests/integration/process-key-thin-adapters.test.ts` — 5-route delegation
- [x] (covered by 19-07 P7-2) `tests/integration/cron-flag-monitor.test.ts` — cron handler unit test
- [x] (covered by 19-01 P1-3) `scripts/check-phase-19-shim-commits.sh` — CI guard (H-7 168h delta enforced)
- [x] (covered by 19-01 P1-3) `scripts/check-route-inventory.sh` — CI guard (C-6 method-label parity)
- [x] (covered by 19-08 P8-2) `analytics-service/requirements-dev.txt` — quantstats add
- [x] (covered by 19-02 P2-7) `supabase/migrations/down/{103-107}-rollback.sql` — C-8 paired down-migrations
- [x] (covered by 19-05 P5-2) `tests/integration/phase-19-pra-write.test.ts` — C-5 NOT NULL upsert proof
- [x] (covered by 19-05 P5-2) `tests/integration/phase-19-pra-status-roundtrip.test.ts` — H-1 status read repoint
- [x] (covered by 19-05 P5-3) `.github/workflows/phase-19-stability.yml` — H-8 hourly CI cron during stability window
- [x] (covered by 19-07 P7-1.5) `tests/integration/sentry-environment.test.ts` — H-6 Sentry environment smoke
- [x] (covered by 19-07 P7-3) `tests/integration/cron-flag-monitor-rollback-e2e.test.ts` — H-10 e2e auto-rollback + D-3 PostgREST fallback + D-4 cache TTL
- [x] (covered by 19-08 P8-3) `analytics-service/tests/fixtures/equity-curve-golden/csv-spot-only.json` — H-13 CSV TWR/YTD parity fixture

*Existing infrastructure does NOT cover any of the above; each is genuinely new for Phase 19.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 7-day stability window at 100% rollout (BACKBONE-09) | BACKBONE-04, BACKBONE-09 | Calendar-time window cannot be CI-tested | After P5 PR-B flag-flip lands, watch Sentry error-envelope rate ≤ 0.5% for ≥168h before P5 PR-D rename. Document in `.planning/phase-19/stability-log.md` (P1 stub). Daily run `scripts/repro-key-flow.sh` (Theme 5) refresh. |
| Customer-feedback exit gate (Theme 4) | BACKBONE-10 (exit gate) | Real-team feedback cannot be synthesized | Founder collects verbatim feedback from 1-2 of the 10 onboarding teams running a real key submission via the unified flow. Write to `.planning/phase-19/customer-feedback.md` (P1 + P8 stub). |
| Sentry events API shape verification (Assumption A1) | BACKBONE-05 cron | Live API call needed; shape may have drifted | `scripts/probe-sentry-events-api.sh` (P7-1 checkpoint) — run with real SENTRY_AUTH_TOKEN before P7-2 deploys. |
| Quantstats API verification (Assumption A2) | BACKBONE-07 | pip index + import probe needed | `scripts/probe-quantstats-version.sh` (P8-1 checkpoint) — run + pin version before P8-2 ships. |
| FIFO matcher exposure decision (Option A vs B) | BACKBONE-06, BACKBONE-09 | Architectural choice — touches REUSE primitive | P8-1 checkpoint records the decision; P8-2 implementation follows the chosen path. |
| Bybit broker-quirk regression check | (cross-cutting Theme 5) | Live broker testnet required | Run `scripts/repro-key-flow.sh bybit` daily during stability window (P5 PR-C); capture vcrpy cassette refresh. |
| Legacy write detection (H-8) | BACKBONE-04 | Now CI-cron blocking + Postgres trigger logs to audit_log | `.github/workflows/phase-19-stability.yml` runs `scripts/verify-no-legacy-writes.sh` hourly during the 168h window. Founder reviews the dashboard daily; PR-D ships only when 168 contiguous green runs achieved. |
| Vercel prod INTERNAL_API_TOKEN parity | (cross-cutting) | Already fixed 2026-05-06; smoke-verify post-deploy | After Phase 19 deploy, `vercel env pull --environment=production` and grep for `\\n` literal in INTERNAL_API_TOKEN row. |
| Migration 107 apply (commit (d)) | BACKBONE-04 | Calendar-day delta enforces 7-day window | P5-3 task ships migration 107 via `mcp__supabase__apply_migration` ONLY at PR-D, after PR-C verifies zero legacy writes. |

---

## Cross-cutting Theme Coverage

| Theme | Coverage Task |
|-------|---------------|
| Theme 4 — customer-feedback exit gate | 19-01 P1-3 stub + 19-08 P8-3 re-verify |
| Theme 5 — daily vcrpy cassettes + repro-key-flow.sh | 19-05 P5-3 documents daily cadence in PR-C |
| Theme 6 — route-inventory completeness CI guard | 19-01 P1-3 ships `scripts/check-route-inventory.sh` |
| Pitfall 1 — VIEW-shim 4th-orphan-path | 19-01 P1-1 inventory + plan-checker grep |
| Pitfall 2 — wizard double-submit race (23505) | 19-04 P4-2 catch-and-return-existing pattern |
| Pitfall 3 — drain split-brain | 19-06 P6-1 metadata snapshot read |
| Pitfall 7 — VIEW shim breaks public_token reads | 19-02 P2-1 first-class public_token + expires_at columns |
| Pitfall 8 — Sentry env filter | 19-07 P7-2 environment:production filter on cron query |
| Pitfall 9 — pgvector accidental dependency | 19-02 P2-3 grep guard + 19-09 P9-1 docstring |
| Pitfall 10 — squash-merge collapses 4-PR shim | 19-01 P1-3 commit-message convention guard |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s for quick suite
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (gsd-planner output 2026-05-08)
