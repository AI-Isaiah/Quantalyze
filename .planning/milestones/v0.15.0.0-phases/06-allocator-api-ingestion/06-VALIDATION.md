---
phase: 06
slug: allocator-api-ingestion
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-19
updated: 2026-04-20
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Populated by gsd-planner; finalized per-task after planning.
>
> **2026-04-20 update:** Revised to fold 8 accepted voice findings (VOICES-ACCEPTED.md).
> Added Task 06-01-1.5 (preview-branch apply + smoke test, f2) and refreshed verification commands
> to match the new acceptance criteria across Plan 01 (f1/f5/f6), Plan 02 (f3/f7/f8), Plan 03 (f8),
> and Plan 04 (f4/f8).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Next side) + pytest (analytics-service side) + psql self-verifying DO block (migration side) + Supabase MCP preview-branch smoke tests (f2 gate) |
| **Config file** | `vitest.config.ts` + `analytics-service/pytest.ini` |
| **Quick run command (Next)** | `npm run test -- --run <path>` |
| **Quick run command (Python)** | `cd analytics-service && pytest tests/test_allocator_positions.py -x -q` |
| **Full suite command** | `npm run test -- --run` + `cd analytics-service && pytest` |
| **Estimated runtime** | ~60–120 seconds full |

---

## Sampling Rate

- **After every task commit:** Run scope-matched quick command (RLS spec for DB tasks, pytest file for worker tasks, Vitest component test for UI tasks).
- **After every plan wave:** Run full suite command.
- **Before `/gsd-verify-work`:** Full suite must be green AND the self-verifying DO block must pass inside `supabase db push` / `apply_migration` output AND Task 1.5 preview-branch smoke tests must have been green prior to Task 2 (f2).
- **Max feedback latency:** 120 seconds.

---

## Per-Task Verification Map

_Populated by gsd-planner. One row per task across all four plans. Updated 2026-04-20 per VOICES-ACCEPTED findings._

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | INGEST-01, INGEST-02, INGEST-08, INGEST-09 | T-06-01-01..11 | Migration file written with table + RLS + 4-way XOR + 4 RPCs + pg_cron + owner-coherence trigger (f5) + role-switched DO block (f1) + jitter-safe cron RPC (f6) + rollback comment block (f2) | migration (file write) | `grep -c -E '^(CREATE TABLE\|CREATE INDEX\|CREATE UNIQUE INDEX\|CREATE OR REPLACE FUNCTION\|CREATE POLICY\|ALTER TABLE\|INSERT INTO compute_job_kinds\|SELECT cron\.schedule\|GRANT SELECT\|GRANT EXECUTE\|REVOKE ALL\|DO \$\$\|CREATE TRIGGER)' supabase/migrations/066_allocator_holdings.sql` | ❌ W0 | ⬜ pending |
| 06-01-01a | 01 | 1 | INGEST-09 | T-06-01-01 | **f1:** RLS probe uses `SET LOCAL ROLE authenticated` (not `set_config('role',...)`), asserts rolbypassrls=false | grep | `grep -c "SET LOCAL ROLE authenticated" supabase/migrations/066_allocator_holdings.sql` ≥ 2 AND `grep -c "set_config('role'" supabase/migrations/066_allocator_holdings.sql` = 0 AND `grep -c 'rolbypassrls' supabase/migrations/066_allocator_holdings.sql` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-01-01b | 01 | 1 | INGEST-09 | T-06-01-09 | **f5:** owner-coherence function + trigger + mismatched-owner DO-block probe | grep | `grep -c 'CREATE OR REPLACE FUNCTION enforce_allocator_holdings_owner_coherence' supabase/migrations/066_allocator_holdings.sql` = 1 AND `grep -c 'BEFORE INSERT OR UPDATE ON allocator_holdings' supabase/migrations/066_allocator_holdings.sql` = 1 AND `grep -c 'mismatched-owner\|owner-coherence trigger probe' supabase/migrations/066_allocator_holdings.sql` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-01-01c | 01 | 1 | INGEST-08 | T-06-01-10 | **f6:** jitter-first idempotency key + cron-hour [1,22] assertion | grep | `grep -c 'v_run_at := now() + v_jitter' supabase/migrations/066_allocator_holdings.sql` = 1 AND `grep -c "to_char(v_run_at AT TIME ZONE 'UTC'" supabase/migrations/066_allocator_holdings.sql` = 1 AND `grep -c 'BETWEEN 1 AND 22\|poll-allocator-positions cron schedule must stay' supabase/migrations/066_allocator_holdings.sql` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-01-01d | 01 | 1 | INGEST-01..09 (rollback) | T-06-01-11 | **f2:** rollback comment block present in migration file | grep | `grep -c 'ROLLBACK PLAN' supabase/migrations/066_allocator_holdings.sql` = 1 | ❌ W0 | ⬜ pending |
| 06-01-1.5 | 01 | 1 | INGEST-01..09 (preview gate) | T-06-01-11 | **f2:** Migration 066 proven on Supabase preview branch; `enqueue_poll_positions_for_all_strategies` (existing) + `enqueue_poll_allocator_positions_for_all_keys` (new) + legacy 1-2 param `enqueue_compute_job` all succeed on preview before production apply | live preview-branch verification | Supabase MCP `create_branch` → `apply_migration` on preview → `execute_sql` runs three smoke-test SQL blocks (strategy cron RPC, allocator cron RPC, legacy 1-param call); all three return integer results without raising; probe compute_jobs rows cleaned up post-run | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | INGEST-01, INGEST-02, INGEST-05, INGEST-08, INGEST-09 | T-06-01-01, T-06-01-08, T-06-01-09, T-06-01-10 | Migration 066 applied to production; DO block self-verify passes (role-switched RLS probe + owner-coherence probe + cron-hour assert); trigger fires; RLS enforced live | live-DB verification | Supabase MCP execute_sql — 12 queries verifying table, policies, cron, GRANT, constraint, trigger (f5), cron-hour range (f6), no probe leak | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | INGEST-05, INGEST-09 (audit side) | T-06-01-07 | AuditAction + ADR-0023 synced; API_KEY_USER_COLUMNS_ARR includes sync_error | compile + grep | `grep -c '"allocator.holdings.sync_requested"\|"allocator.holdings.sync_completed"\|"allocator.holdings.sync_failed"' src/lib/audit.ts` ≥ 3 AND `grep -c '"sync_error"' src/lib/constants.ts` = 1 AND `npx tsc --noEmit` clean | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | INGEST-03, INGEST-04, INGEST-05 | T-06-02-01, T-06-02-05, T-06-02-07 | pytest test file written with 9 RED cases (6 original + Deribit per-currency shape test + 2 handler-level tests including sync_completed audit emission — f3 + f7) | pytest collection | `cd analytics-service && pytest tests/test_allocator_positions.py --co -q 2>&1 | grep -cE 'test_fetch_allocator_holdings_returns_both_types\|test_idempotent_upsert\|test_error_status_mapping\|test_stablecoin_mark_price_is_one\|test_partial_success_emits_warnings\|test_raw_payload_cap_4kb\|test_deribit_balance_per_currency_shape\|test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done\|test_run_poll_allocator_positions_job_auth_error_sets_revoked'` ≥ 9 | ❌ W0 | ⬜ pending |
| 06-02-01a | 02 | 2 | INGEST-05 (audit) | T-06-02-05 | **f7:** `services/audit.py::log_audit_event` signature verified during pre-task inspection (no silent local no-op in worker) | grep | `grep -c 'def log_audit_event' analytics-service/services/audit.py` = 1 AND `grep -c 'log_audit_event_service' analytics-service/services/audit.py` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | INGEST-03, INGEST-04 (spot + derivatives + idempotent + Deribit deferral) | T-06-02-01, T-06-02-04, T-06-02-06, T-06-02-07 | exchange.py extended with Deribit; allocator_positions.py implements dual fetch + idempotent upsert + stablecoin skip + raw_payload cap + DeribitNotSupportedError branch (f3 Path B) | pytest | `cd analytics-service && pytest tests/test_allocator_positions.py -x -q -k "not run_poll_allocator_positions_job"` → 7/7 pass (6 pure + Deribit shape) |  |
| 06-02-02a | 02 | 2 | INGEST-03 | T-06-02-07 | **f3:** Deribit branch + DeribitNotSupportedError class + locked error message | grep | `grep -c 'class DeribitNotSupportedError' analytics-service/services/allocator_positions.py` = 1 AND `grep -c "getattr(exchange, \"id\", None) == \"deribit\"\|exchange.id.*==.*'deribit'" analytics-service/services/allocator_positions.py` ≥ 1 AND `grep -c 'Deribit spot ingestion not yet supported' analytics-service/services/allocator_positions.py` = 1 | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 2 | INGEST-03, INGEST-05 (worker dispatch + error mapping + audit emission + complete_with_warnings) | T-06-02-01, T-06-02-02, T-06-02-04, T-06-02-05 | job_worker.py extended with preflight + handler + dispatch + TIMEOUT; error → sync_status mapping + audit emission via services.audit.log_audit_event (f7); rate-limit contagion comment (f8) | pytest | `cd analytics-service && pytest tests/test_allocator_positions.py -x -q` → 9/9 pass AND `cd analytics-service && pytest tests/ -x -q` full suite green |  |
| 06-02-03a | 02 | 2 | INGEST-05 | T-06-02-05 | **f7:** audit emission routed through services.audit (not a local no-op); strings registered at call sites | grep | `grep -c 'allocator.holdings.sync_completed\|allocator.holdings.sync_failed\|allocator.holdings.sync_requested' analytics-service/services/audit.py analytics-service/services/job_worker.py` ≥ 2 AND `grep -c 'log_audit_event\|_emit_audit' analytics-service/services/job_worker.py` ≥ 2 | ❌ W0 | ⬜ pending |
| 06-02-03b | 02 | 2 | INGEST-03 (contagion acceptance) | T-06-02-04 | **f8:** rate-limit contagion documented inline above `_allocator_key_preflight` | grep | `grep -c 'Rate-limit contagion\|DEFERRED.*valid terminal\|per-exchange.*shared with strategy-side' analytics-service/services/job_worker.py` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 2 | INGEST-06, INGEST-09 | T-06-03-01, T-06-03-05 | Route unit test RED + RLS regression spec RED; route test includes f8 next_attempt_at passthrough case | vitest | `npm test -- --run src/app/api/allocator/holdings/sync/route.test.ts src/__tests__/allocator-holdings-rls.test.ts` → 7 RED cases (including f8 next_attempt_at passthrough) + 1 RLS spec (skip OR RED without impl) AND `grep -c 'next_attempt_at' src/app/api/allocator/holdings/sync/route.test.ts` ≥ 2 | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 2 | INGEST-06 | T-06-03-01, T-06-03-02, T-06-03-03, T-06-03-04, T-06-03-06 | POST /api/allocator/holdings/sync live; withAuth + zod + user-scoped RPC + 42501 branch + audit; RPC body passthrough preserves next_attempt_at (f8) | vitest | `npm test -- --run src/app/api/allocator/holdings/sync/route.test.ts` → 7/7 pass; `grep -c 'createAdminClient' src/app/api/allocator/holdings/sync/route.ts` = 0 AND `grep -c 'NextResponse.json(data' src/app/api/allocator/holdings/sync/route.ts` = 1 (verbatim passthrough) | ❌ W0 | ⬜ pending |
| 06-03-03 | 03 | 2 | INGEST-09 (app-layer regression) | T-06-03-05 | RLS regression spec GREEN or SKIP; no leak | vitest live-DB | `npm test -- --run src/__tests__/allocator-holdings-rls.test.ts` → 1 pass OR 1 skipped; full Vitest suite green | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 3 | INGEST-05 (UI surface), INGEST-06 (pill state) | T-06-04-01, T-06-04-04 | AllocatorSyncStatus sub-component + D-08 copy verbatim + aria-live helper + f8 Queued helper + f4 helperOverride | vitest | `npm test -- --run src/components/exchanges/AllocatorSyncStatus.test.tsx` → all pass; includes U+2026 + U+2014 codepoint assertions + f8 Queued threshold test + f4 helperOverride precedence test |  |
| 06-04-01a | 04 | 3 | INGEST-06 | T-06-04-08 | **f8:** Queued helper rendered when syncing + queuedNextAttemptAt ≥30s out | grep | `grep -c 'queuedNextAttemptAt\|Queued.*exchange cooldown' src/components/exchanges/AllocatorSyncStatus.tsx` ≥ 2 AND `grep -c 'QUEUED_THRESHOLD_SECONDS\|>= 30\|>=30' src/components/exchanges/AllocatorSyncStatus.tsx` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-04-02 | 04 | 3 | INGEST-05, INGEST-06, INGEST-07 | T-06-04-01..08 | AllocatorExchangeManager extended: real Sync now button, handleSync with next_attempt_at capture (f8), 5s polling, initialKeys merge effect, AWAITED first-run chain with error surfacing (f4) | vitest | `npm test -- --run src/components/exchanges/AllocatorExchangeManager.test.tsx` → all pass; `grep -c 'Auto-synced' src/components/exchanges/AllocatorExchangeManager.tsx` = 0 AND `grep -c '\.catch(() => {})' src/components/exchanges/AllocatorExchangeManager.tsx` = 0 (f4: no more fire-and-forget swallow) |  |
| 06-04-02a | 04 | 3 | INGEST-07 | T-06-04-07 | **f4:** AWAITED first-run POST + 403 error surfaces helper text; LOCKED unit test name | grep + vitest | `grep -c 'handleAddKey_shows_error_when_first_run_sync_fails_with_403' src/components/exchanges/AllocatorExchangeManager.test.tsx` = 1 AND `grep -c 'Sync request failed' src/components/exchanges/AllocatorExchangeManager.tsx` ≥ 2 | ❌ W0 | ⬜ pending |
| 06-04-02b | 04 | 3 | INGEST-06 | T-06-04-08 | **f8:** client captures next_attempt_at from already_inflight response and propagates to row state | grep + vitest | `grep -c 'queued_next_attempt_at' src/components/exchanges/AllocatorExchangeManager.tsx` ≥ 3 AND `grep -c 'already_inflight.*next_attempt_at\|next_attempt_at.*already_inflight\|Queued.*exchange cooldown' src/components/exchanges/AllocatorExchangeManager.test.tsx` ≥ 1 | ❌ W0 | ⬜ pending |
| 06-04-03 | 04 | 3 | INGEST-05, INGEST-06, INGEST-07 (visual + a11y) | T-06-04-01, T-06-04-06, T-06-04-07, T-06-04-08 | All 7 pill states + f4 first-run 403 surface + f8 Queued state visually audited against DESIGN.md + UI-SPEC; first-run UX confirmed on staging | manual — /qa checkpoint | 7 pill screenshots + f4 first-run-403 screenshot + f8 Queued screenshot + live-DB row count > 0 after first-run + VoiceOver a11y pass | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_allocator_positions.py` — pytest module with NINE RED cases (6 fetch/persist + `test_deribit_balance_per_currency_shape` [f3] + `test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done` [f7] + `test_run_poll_allocator_positions_job_auth_error_sets_revoked`). Created in Plan 02 Task 1.
- [ ] `analytics-service/tests/conftest.py` — reuse existing Supabase mock fixtures; add `api_key_row_factory` if missing. Plan 02 Task 1.
- [ ] **f7 pre-task inspection of `analytics-service/services/audit.py`** — verify `log_audit_event(user_id, action, entity_type, entity_id, metadata)` exists + RPC dispatch; add if missing (expected: no-op). Plan 02 Task 1.
- [ ] `src/app/api/allocator/holdings/sync/route.test.ts` — 7 RED route unit cases including f8 `already_inflight + next_attempt_at` passthrough. Plan 03 Task 1.
- [ ] `src/__tests__/allocator-holdings-rls.test.ts` — two-actor Vitest spec mirroring `bridge-outcomes-rls.test.ts`; covers INGEST-09 app-layer. Plan 03 Task 1.
- [ ] `src/components/exchanges/AllocatorSyncStatus.test.tsx` — D-08 copy-verbatim + color-map test cases + f8 Queued-threshold test + f4 helperOverride precedence test. Plan 04 Task 1.
- [ ] `src/components/exchanges/AllocatorExchangeManager.test.tsx` — component tests for handleSync, handleAddKey chain with f4 `handleAddKey_shows_error_when_first_run_sync_fails_with_403` LOCKED test, polling, prop-sync-merge effect, f8 already_inflight+next_attempt_at capture. Plan 04 Task 2.
- [ ] Self-verifying DO block inside `066_allocator_holdings.sql` — covers INGEST-01 / INGEST-02 / INGEST-09 schema invariants + **f1 role-switched RLS probe** + **f5 owner-coherence trigger probe** + **f6 cron-hour assertion**. Plan 01 Task 1.
- [ ] **Task 1.5 preview-branch gate (f2)** — Supabase MCP `create_branch` + `apply_migration` on preview + three smoke-test SQL calls must all return cleanly BEFORE Plan 01 Task 2 runs against production.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Gate |
|----------|-------------|------------|-------------------|------|
| First-run UX — add real read-only exchange key on staging, observe `syncing → complete` transition on AllocatorExchangeManager | INGEST-07 | Requires a live read-only exchange key against a real exchange edge | Use Keychain demo-allocator creds; add key on `/exchanges`; watch pill state transitions; confirm `allocator_holdings` rows land within 3 min | Plan 04 Task 3 |
| **f4 — first-run failure UX:** connect exchange with invalid key, verify modal closes + row pill is `idle` (not stuck at `syncing`) + helper line renders "Sync request failed — click Sync now to retry" | INGEST-07 (f4) | Requires an actual 403/500 response against the staging route | Invalid api_key/api_secret pair or pre-revoked user access; submit form; verify row state + helper text + VoiceOver announcement | Plan 04 Task 3 |
| **f8 — Queued-state UX:** seed a deferred `pending` compute_jobs row for the test key (next_attempt_at = now() + 90s), click Sync now, verify helper text "Queued — exchange cooldown, retry in 90s" renders | INGEST-06 (f8) | Requires a real `compute_jobs` row seeded via service-role + a live route POST | MCP `execute_sql` to seed the deferred row; click Sync now; capture screenshot; clean up via `DELETE FROM compute_jobs WHERE api_key_id=...` | Plan 04 Task 3 |
| pg_cron 04:00 UTC fire-once after daily boundary | INGEST-08 | Real clock + pg_cron — no Playwright harness | Next morning after deploy, verify `SELECT * FROM cron.job_run_details WHERE jobname='poll-allocator-positions'` shows successful invocation and `compute_jobs` rows enqueued; verify idempotency_key date portion matches `to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')` (f6) | Post-deploy manual (milestone close) |
| Status pill copy + color across 7 states on DESIGN.md audit | D-08 copy table | Visual DESIGN.md compliance (DM Sans 12px helper, neutral/amber/red pill) — requires a human eye | `/qa` run against `/exchanges` with each `sync_status` forced via service-role UPDATE; capture screenshots for each state; verify U+2026 + U+2014 rendering; VoiceOver a11y walk-through | Plan 04 Task 3 |
| Reduced-motion spinner behavior | D-08 motion | Browser DevTools emulation — not automatable in Vitest | DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`; verify spinner freezes visible; toggle back, verify rotation | Plan 04 Task 3 |
| Migration 066 apply via Supabase MCP `apply_migration` + schema_migrations reconciliation | INGEST-01..09 (schema side) | MCP interaction is not in the automated harness | Supabase MCP `apply_migration` + 12 verification queries + no-leak check + trigger-exists check (f5) + cron-hour range check (f6) | Plan 01 Task 2 |
| **f2 — Migration 066 preview-branch gate:** stand up a Supabase preview branch via MCP `create_branch`, apply the migration, run 3 smoke SQL blocks, verify backward-compat of strategy-side cron RPC, tear down the preview after production Task 2 green | INGEST-01..09 (preview gate) | MCP branch creation is manual; backward-compat proof for DROP+REDEFINE requires real Postgres | Plan 01 Task 1.5 `how-to-verify` block — full procedure with SQL smoke tests | Plan 01 Task 1.5 (blocks Task 2) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (every `<verify><automated>` block has a concrete command; no MISSING entries)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has one)
- [x] Wave 0 covers all MISSING references (RLS spec + pytest module + route test + 2 component tests + DO block + audit.py pre-task inspection)
- [x] No watch-mode flags in any command (all use `--run` for Vitest, `-x -q` for pytest, one-shot for grep)
- [x] Feedback latency < 120s (quick commands ~10s; full suite ~90s)
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Voice findings (VOICES-ACCEPTED.md) folded into verification map: f1 (task 06-01-01a), f2 (task 06-01-1.5 + 01d), f3 (task 06-02-02a), f4 (task 06-04-02a), f5 (task 06-01-01b), f6 (task 06-01-01c), f7 (tasks 06-02-01a + 03a), f8 (tasks 06-02-03b + 06-03 route passthrough + 06-04-01a + 06-04-02b)

**Approval:** planned — pending execution (updated 2026-04-20 per VOICES-ACCEPTED.md)
</content>
</invoke>