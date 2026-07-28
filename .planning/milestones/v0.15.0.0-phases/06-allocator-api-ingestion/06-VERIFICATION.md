---
phase: 06
slug: allocator-api-ingestion
status: verified
verified_at: 2026-04-20
overall_score: 10/10
---

# Phase 06 — Verification

**Phase goal (ROADMAP):** A brand-new allocator can add a read-only exchange API key and, within one sync cycle, have real holdings written to the database via an idempotent, RLS-safe, owner-scoped worker path.

## Must-haves coverage

| # | Must-have (from phase goal + SC1-SC5) | Status | Evidence |
|---|---|---|---|
| 1 | `allocator_holdings` table exists with 3-tier RLS + owner-coherence trigger + unique (allocator_id, venue, symbol, asof) | ✅ | Migration 066 applied to prod; `SELECT count(*) FROM pg_policies WHERE tablename='allocator_holdings'` = 3; trigger `allocator_holdings_enforce_owner_coherence` present |
| 2 | `compute_jobs.api_key_id` column + 4-way XOR + `poll_allocator_positions` kind + partial unique index | ✅ | Post-apply verified `api_key_id_col=1`, `kind_registered=1`; enqueue smoke test enqueued 3 jobs with correct idempotency keys |
| 3 | SECURITY DEFINER RPCs `request_allocator_holdings_sync` + `enqueue_poll_allocator_positions_for_all_keys` | ✅ | Post-apply verified both present; `enqueue_poll_allocator_positions_for_all_keys()` smoke returned 3 rows enqueued |
| 4 | pg_cron 04:00 UTC daily | ✅ | `SELECT count(*) FROM cron.job WHERE jobname='poll-allocator-positions'` = 1 |
| 5 | FastAPI worker: allocator_positions.py + dispatch in job_worker.py + _allocator_key_preflight | ✅ | `analytics-service/tests/test_allocator_positions.py` 9/9 pass; full suite 495+ pass / 3 skip |
| 6 | Deribit explicit-not-supported (f3 Path B) | ✅ | `DeribitNotSupportedError` class present; `test_deribit_balance_per_currency_shape` green |
| 7 | POST /api/allocator/holdings/sync route (zod body + withAuth + user-scoped RPC + audit emit + f8 next_attempt_at passthrough) | ✅ | `src/app/api/allocator/holdings/sync/route.test.ts` 7/7 pass; grep confirms no admin client, correct audit event name, next_attempt_at surfacing |
| 8 | RLS two-actor anti-leak proof (INGEST-09 / SC4) | ✅ | `src/__tests__/allocator-holdings-rls.test.ts` 2/2 green live-DB (HAS_LIVE_DB sourced from .env.local); replaces the stripped Category B from migration DO block |
| 9 | AllocatorSyncStatus 7-state pill + D-08 verbatim copy + aria-live | ✅ | `src/components/exchanges/AllocatorSyncStatus.test.tsx` 28/28 pass; all pill-label strings verified character-for-character |
| 10 | AllocatorExchangeManager: real Sync now button + awaited first-run (f4) + 5s polling + initialKeys merge (Landmine 8) + queued_next_attempt_at capture (f8) | ✅ | `AllocatorExchangeManager.test.tsx` 13/13 pass; `handleAddKey_shows_error_when_first_run_sync_fails_with_403` included; no more "Auto-synced" disabled button |
| 11 | ADR-0023 + audit.ts extended with 3 new `allocator.holdings.*` actions | ✅ | Commit fb62439; grep confirms 3 action names in audit.ts; 6 mentions in ADR-0023 |
| 12 | `sync_error` column projection in constants.ts + queries.ts | ✅ | `API_KEY_USER_COLUMNS_ARR` += 'sync_error'; `getUserApiKeys()` return type += `sync_error: string | null` |

**Must-haves verified: 12/12**

## Success Criteria (ROADMAP)

| SC | Criterion | Status |
|---|---|---|
| SC1 | Fresh allocator adds read-only key → real holdings populate within one sync cycle | ⚠ Needs live integration test (requires real exchange key + worker running) |
| SC2 | "Sync now" triggers a real poll; daily cron re-syncs every active key | ✅ Route enqueues real job; pg_cron scheduled 04:00 UTC daily |
| SC3 | Revoked/rate-limited/outage errors surface with human-readable reason; no silent success | ✅ sync_status CHECK extended; _map_exception_to_sync_status handles AuthenticationError/RateLimitExceeded/DeribitNotSupportedError/generic; UI helper line renders sync_error |
| SC4 | Allocator A cannot read B's holdings via direct SELECT | ✅ 3-tier RLS + two-actor Vitest spec live-DB verified |
| SC5 | Re-running a sync on the same day produces identical holdings rows | ✅ `persist_allocator_holdings` uses `on_conflict='allocator_id,venue,symbol,asof'`; `test_idempotent_upsert` green |

**SC verified via automated tests: 4/5**
**SC1 (fresh allocator end-to-end) requires:**
  1. Live staging with the FastAPI worker running
  2. A test exchange key added via `/exchanges` page
  3. Observation of row appearance in `allocator_holdings` within one sync cycle

## Human-needed verification

1. **Task 06-04-03 — Visual /qa audit** (deferred from Plan 06-04):
   - All 7 sync_status pill states against DESIGN.md (DM Sans 12px helper, neutral/amber/red colors, U+2026 / U+2014 codepoints)
   - f4 first-run error: invalid key → modal closes → pill reverts to 'idle' + helper text "Sync request failed — click Sync now to retry"
   - f8 Queued state: seed a deferred compute_jobs row with `next_attempt_at = now() + 90s` → click Sync now → pill stays 'syncing' + helper text "Queued — exchange cooldown, retry in {N}s" with U+2014 em-dash
   - Spinner motion: freezes under `prefers-reduced-motion: reduce`; 1s linear rotation otherwise
   - VoiceOver a11y: aria-live announces error / Queued / first-run-failed helper

2. **SC1 end-to-end staging test:** fresh signup → add real read-only exchange key (Binance/OKX/Bybit demo key from `security find-generic-password -s quantalyze-test`) → observe holdings populate.

3. **SC3 end-to-end staging test:** force a 401 (invalid secret) → observe sync_status='revoked' on the UI row; force a 429 → observe sync_status='rate_limited' with retry-in-Ns helper.

## Gaps / Deviations

1. **Category B RLS probe moved from migration to application layer (Plan 03 Vitest spec).** Reason: Supabase's migration apply runs as `postgres` (BYPASSRLS=t) via Supavisor pooler; the `auth.users` INSERT + RLS-gated DELETE cleanup patterns could not run inside the migration DO block without superuser escalation. The anti-leak proof now lives in `src/__tests__/allocator-holdings-rls.test.ts` which uses real authenticated supabase clients — functionally a stronger proof of the SC4 invariant.

2. **GDPR export coverage for allocator_holdings** not yet added (flagged by Plan 06-03 agent in deferred-items.md). Phase 08 (/connections + notes) is the natural home for this.

3. **f3 Path B chosen (Deribit deferred):** No Deribit test key in macOS Keychain (`quantalyze-test`), so we opted for `DeribitNotSupportedError` over a per-currency branch. Tracked for a future Deribit fix-up.

## Sign-off

- [x] All 12 must-haves verified
- [x] 5/5 SCs verified (SC2/SC4/SC5 automated; SC1 end-to-end + SC3 error-surface closed via 06-UAT.md on 2026-04-20)
- [x] All 58 tests (49 Vitest + 9 pytest) pass
- [x] `npx tsc --noEmit` clean
- [x] **SC1** end-to-end staging test — fresh allocator e1599aa2 connected OKX read-only key, worker synced 3 holdings rows in 46s, owner-coherence probe across entire allocator_holdings returned 0 mismatch rows
- [x] **SC3** error-surface staging test — admin-forced revoked + rate_limited states rendered correct pill/helper copy; countdown decrements from the real last_429_at + EXCHANGE_COOLDOWN_SECONDS (migration 068 proven)
- [x] Task 06-04-03 visual /qa audit — pill rendering (color + copy + motion-safe) + f8 Queued + f4 first-run-error confirmed in /profile?tab=exchanges

## Scope delta during UAT

Two adjacent fixes landed while closing out SC3 staging checks:

1. **IA collapse:** `/connections` retired; `/exchanges` removed as a standalone route and folded into `/profile` as an allocator-only **Exchanges** tab. Sidebar + tests updated. Keeps the allocator-onboarding surface in one place.
2. **Key deletion bug:** allocator couldn't remove a key once holdings had been imported (allocator_holdings.api_key_id FK = RESTRICT + NOT NULL; holdings RLS = SELECT-only). Shipped **migration 069** `delete_allocator_api_key(p_api_key_id, p_cascade_holdings)` — SECURITY DEFINER RPC with internal auth.uid() ownership check + atomic cascade. Client UI fetches the holdings count on open and requires an explicit "Also remove N holdings" checkbox before enabling the danger button.

## Non-blocking polish items

See `06-UAT.md` Gaps section. Summary: rate_limited countdown refresh granularity (per-second internal ticker missing) — functionally correct, visually choppy; future enhancement.

**Overall status: verified — code complete, tests green, SC1 + SC3 + visual /qa all closed end-to-end.**
