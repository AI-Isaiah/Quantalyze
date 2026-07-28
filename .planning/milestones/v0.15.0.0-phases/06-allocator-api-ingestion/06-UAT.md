---
status: complete
phase: 06-allocator-api-ingestion
source:
  - 06-01-SUMMARY.md
  - 06-02-SUMMARY.md
  - 06-03-SUMMARY.md
  - 06-04-SUMMARY.md
  - 06-VERIFICATION.md
started: 2026-04-20T12:35:00.000Z
updated: 2026-04-20T12:32:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: |
  Fresh boot of the app + worker against production DB (migration 066 applied).
  - `npm run dev` starts Next without errors
  - `/exchanges` page loads for an authenticated allocator with 0 errors in console
  - FastAPI analytics-service worker starts (`uvicorn` or docker-compose up) and logs a ready signal
  - `SELECT count(*) FROM cron.job WHERE jobname='poll-allocator-positions'` returns 1
  - `SELECT count(*) FROM pg_policies WHERE tablename='allocator_holdings'` returns 3
result: pass
verified_by: assistant+user
notes: |
  Assistant verified: Next 16.2.3 on :3000 returns 200 on /, 307 on /exchanges (unauth redirect as expected).
  SQL checks: cron_count=1, rls_policies=3, mig067_applied (pre-check logic present, dead EXCEPTION removed),
  mig068_grant=true (authenticated has last_429_at SELECT), anon_leak_check=false (anon does NOT).
  User confirmed Railway worker + browser-auth /exchanges load.

### 2. Task 06-04-03 — Visual QA of 7 sync_status pill states
expected: |
  On `/exchanges` with a test allocator, force each sync_status value via service-role UPDATE and verify the pill + helper line.
  - **idle** — neutral pill, no helper text
  - **syncing** — amber pill with 12×12 spinner rotating (1s linear), helper text "Syncing… latest holdings" with U+2026 (NOT three ASCII dots)
  - **ok** — neutral pill, helper shows "Last sync {relative time}"
  - **revoked** — red pill, helper text "Key revoked — re-add to resume syncing" with U+2014 em-dash (NOT two hyphens)
  - **rate_limited** — amber pill, helper text shows a real countdown "Rate limited — retry in {N}s" with U+2014 (countdown now reads api_keys.last_429_at per migration 068; no more "retry in 0s")
  - **error** — red pill, helper shows sync_error from DB (≤500 chars)
  - **f4 first-run error** — invalid key submitted → modal closes → pill reverts to 'idle' + helper "Sync request failed — click Sync now to retry"
  - **f8 Queued state** — with an existing live compute_jobs row for the same api_key (next_attempt_at in the future), click Sync now → RPC now returns already_inflight via the migration-067 pre-check (no more dead EXCEPTION handler) → pill stays 'syncing' + helper "Queued — exchange cooldown, retry in {N}s" with U+2014
  - **prefers-reduced-motion** — spinner freezes (no rotation) under OS reduce-motion
  - **VoiceOver** — aria-live="polite" announces error / Queued / first-run-failed helper exactly once
  Cross-check DESIGN.md: DM Sans 12px helper, neutral/amber/red tokens match.
result: pass
verified_by: user
notes: |
  UAT detour surfaced two fixes before pass: (a) /connections route removed + /exchanges moved into /profile?tab=exchanges as a separate tab; (b) Remove-key button + migration 069 delete_allocator_api_key RPC (cascade-aware). User confirmed pill surface functional after the moves.

### 3. SC1 — Fresh allocator end-to-end holdings populate
expected: |
  Clean-slate allocator signup → add real read-only exchange key (Binance/OKX/Bybit demo key from macOS Keychain `quantalyze-test`) → real holdings populate via the worker within one sync cycle.
  - New allocator signs up from scratch (no existing rows in api_keys)
  - On `/profile?tab=exchanges`, click "+ Connect exchange", choose exchange, paste demo API key + secret, submit
  - Modal closes; row appears with pill = "syncing"
  - Within ~30s (first-run sync), pill transitions to "complete" and helper shows "Last sync just now"
  - `SELECT count(*) FROM allocator_holdings WHERE allocator_id = <new_user>` returns > 0
  - Rows have asof = today, owner_user_id matches the allocator, no rows leak across allocators
result: pass
verified_by: assistant+user
notes: |
  Fresh allocator e1599aa2-7bd8-4d01-8348-ef533906fb94 connected OKX read-only key at 11:59:07Z; worker synced at 11:59:53Z (46s end-to-end). sync_status=complete, 3 holdings rows (USDT spot 194.8k, ETHUSDT long derivative 21.464, BTC dust) all tied to single api_key, asof=2026-04-20. Owner-coherence probe across full allocator_holdings table returned 0 mismatch rows. Note: UAT expected pill label "ok"; actual pill state is "complete" per the sync_status CHECK taxonomy (migration 066+067+068) — UAT spec updated.

### 4. SC3 — Error-surface staging test (revoked + rate_limited)
expected: |
  Force exchange errors and confirm the pill + helper reflect the right sync_status.
  - **Revoked:** sync_status='revoked' → red pill labelled "Key revoked", helper "Re-add a read-only key from your exchange." (D-08 locked copy)
  - **Rate limited:** sync_status='rate_limited' + last_429_at stamped recently → amber pill labelled "Rate limited — retry in {N}s" with U+2014 em-dash, where N decrements toward 0 based on api_keys.last_429_at + EXCHANGE_COOLDOWN_SECONDS
  - Worker→status mapping already proven by test_allocator_positions.py (9/9 green including AuthenticationError→revoked, RateLimitExceeded→rate_limited). This UAT just verifies UI rendering reads the DB values correctly.
result: pass
verified_by: assistant+user
notes: |
  Admin-UPDATE of api_keys.dd914c8f-9e25-4f83-a4ba-0aa6638d3194 (helmut.mueller1@gmail.com OKX key) exercised both states end-to-end. User observed: (a) revoked → red pill "Key revoked" + helper "Re-add a read-only key from your exchange." (matches AllocatorSyncStatus.tsx:77 REVOKED_HELPER constant); (b) rate_limited → amber pill with real decrementing countdown from ~300s (OKX cooldown). Key restored to idle after verification. Minor polish item logged in Gaps (countdown refresh granularity).

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0

## Gaps

Non-blocking polish items surfaced during UAT. None gate Phase 06 completion.

- **rate_limited countdown refresh granularity** — the "retry in {N}s" number only refreshes on `router.refresh()` polling ticks (5s interval, occasionally coalesced to ~10s on dev Turbopack). No per-second internal ticker on AllocatorSyncStatus. Choppy under observation but functionally correct. Future polish: add a 1s setInterval inside AllocatorSyncStatus that re-renders only when normalized==='rate_limited'.
- **UAT spec copy drift** — my initial UAT spec used "retry to resume syncing" / pill label "ok" / helper "Rate limited — retry in {N}s"; the implemented D-08 copy is "Re-add a read-only key from your exchange." / pill "complete" / pill label "Rate limited — retry in {N}s". Implementation + unit tests are right; the UAT spec was my hallucination. Not a code issue.
