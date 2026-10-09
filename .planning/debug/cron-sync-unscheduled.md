---
status: diagnosed
trigger: "does live API keys' daily trade ingestion actually run on PROD? (no scheduler for /cron-sync found; strategy_sync_cursors has 0 rows on PROD)"
created: 2026-10-09
updated: 2026-10-09
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED. Nothing has ever scheduled POST /api/cron-sync from version control, and nothing calls it on PROD today. The ccxt strategy keys it exists for (3 okx, 1 bybit on PROD) have had no trade ingestion for 14 to 156 days. "Synced Nd ago" does not read trade freshness.
bug_class: Bohrbug (deterministic absence of a caller)
next_action: founder decision on the scheduler surface (see Resolution); fix is out of scope for this session

## Symptoms

expected: every active live API key's trades are pulled on a recurring cadence (cron.py writes one strategy_sync_cursors row per strategy of every key it reaches, each tick)
actual: PROD strategy_sync_cursors has 0 rows; no scheduled sync_trades jobs; no scheduler found on Vercel, GitHub, Edge Functions, pg_cron or Railway
errors: none (silent absence)
reproduction: read PROD cron.job, strategy_sync_cursors, compute_jobs, trades
started: no version-controlled caller ever existed (route added 2026-04-06); the last observed caller is a June 2026 CHANGELOG note

## Eliminated

- hypothesis: a PROD pg_cron job calls /cron-sync (directly or through a SQL function)
  evidence: 17 cron.job rows on 2026-10-09; none mentions cron-sync in its command; the two functions that use net.http_post (match_engine_cron_tick, prod_prober_cadence_check) target other routes
  timestamp: 2026-10-09
- hypothesis: a Vercel cron calls it
  evidence: vercel.json crons (9 entries) never listed it across the file's whole git history; no src/ caller other than a comment
  timestamp: 2026-10-09
- hypothesis: the worker's own loops ingest trades
  evidence: main_worker.py runs dispatch, watchdog and daily_enqueue (poll_positions = open-position snapshots only); none fetches trades
  timestamp: 2026-10-09
- hypothesis: "Synced 1d / 3d ago" proves trades are fresh
  evidence: the pill reads strategy_analytics.computed_at (SyncBadge computedAt), and api_keys.last_sync_at is bumped daily at about 04:05 UTC by poll_allocator_positions for every active key, strategy keys included (23 of 23 matched within 10 min of that job)
  timestamp: 2026-10-09

## Evidence

- timestamp: 2026-10-09
  checked: git log -S '/api/cron-sync' (code paths); commit c055eddf4 (2026-04-06) that added the route
  found: the route was added in Phase 3 as "Daily cron sync (3.4)" with no scheduler; no migration ever cron.schedule()s it; vercel.json never listed it
  implication: no version-controlled scheduler has ever existed for /cron-sync

- timestamp: 2026-10-09
  checked: docs/architecture/adr-0008-cron-architecture.md; CHANGELOG 0.24.15.47 / 0.24.15.116 (2026-06-01, 2026-06-04); 161.1-RESEARCH OQ-1
  found: ADR says "triggered by pg_cron" but its inventory has no such row. CHANGELOG 2026-06-01 describes Sentry errors from "the daily /api/cron-sync", so something called it then; 2026-06-04 names the caller as "a Railway probe hitting the path without the service key". 161.1 research left "is cron-sync scheduled on PROD" open (OQ-1) and it was never closed
  implication: the caller was out-of-band (not in git) and has since disappeared; nobody re-measured it

- timestamp: 2026-10-09
  checked: PROD cron.job (read-only)
  found: 17 jobs, all active; none touches cron-sync. derive-allocator-key-dailies is registered but has not run yet. ledger_refresh_fanout runs hourly (ledger venues only)
  implication: no pg_cron path to cron-sync

- timestamp: 2026-10-09
  checked: PROD compute_jobs, last 14 days, by kind and source
  found: sync_trades 3 (all source finalize-wizard, newest 2026-10-04); derive_broker_dailies 58 unsourced + 31 ledger-refresh; poll_allocator_positions 379 (daily 04:00); refresh_allocator_equity_daily 258; reconcile_strategy 65; sync_funding 70 (14 failed); poll_positions 13 (daily_loop, one strategy); process_key_long 9 (mt5)
  implication: no recurring trade-ingestion job exists for ccxt strategy keys

- timestamp: 2026-10-09
  checked: PROD per strategy on active ccxt keys (the exact set cron_sync would sync)
  found: 4 strategies (okx 3, bybit 1). Newest trade age: 14.4 / 50.5 / 138.5 / 155.7 days. Newest daily return: bybit 15 d, okx one 51 d, two okx have none. All 3 okx have funding_fees rows from 0.3 d ago (96 to 231 funding rows dated after their last trade); the bybit one has open positions on 13 of the last 14 days. strategy_analytics.computed_at is 0.2 d for all 4
  implication: the accounts are live (funding is accruing today, positions are open) while trade and daily-return ingestion is frozen. Recomputes keep computed_at fresh, so the UI looks current

- timestamp: 2026-10-09
  checked: PROD per active key by venue (23 non-revoked + 5 revoked-but-is_active bybit allocator keys)
  found: mt5 8 strategy keys: daily 1 to 4 d old, fed by ledger-refresh and process_key_long (cron_sync defers mt5 anyway). deribit 8 and okx 3 allocator keys (no strategy): dailies 1 to 2 d old, fed by the allocator crons. bybit 5 allocator keys: sync_status revoked, last_sync 64 d, still is_active=true
  implication: only the 4 ccxt strategy keys depend on cron-sync; the allocator and mt5 lanes have their own schedulers

- timestamp: 2026-10-09
  checked: cron.py resume logic (_strategy_resume_point, _resume_floor_ms) against PROD state
  found: with 0 strategy_sync_cursors rows every strategy falls back to api_keys.last_sync_at, and poll_allocator_positions overwrites that column daily at about 04:05 UTC
  implication: if /cron-sync is scheduled as-is, its first tick fetches only from about 04:05 UTC today, then writes cursor rows at "now". That silently and permanently skips the 14 to 156 day gap. Seeding the cursors must come before (or with) the schedule

- timestamp: 2026-10-09
  checked: PROD scheduler prerequisites
  found: pg_net installed; vault secret analytics_service_key exists; the app.analytics_service_url / app.analytics_service_key GUCs are NOT set (the vault + system_settings tick pattern from 20260907120000 replaced them); Railway HTTP logs for the current deployment show 0 requests to /api/cron-sync (positive control: /health and /api/benchmark-refresh present)
  implication: the pg_cron route needs a vault-reading tick function like match_engine_cron_tick, not the old GUC pattern

## Resolution

root_cause: POST /api/cron-sync (analytics-service/routers/cron.py) has no scheduler on any PROD surface, and none was ever committed. The only caller ever recorded was out-of-band (June 2026) and is gone. The 4 live ccxt strategy keys (3 okx, 1 bybit) have had no trade or daily-return ingestion for 14 to 156 days. This is masked twice: strategy_analytics.computed_at is refreshed by recomputes (the "Synced Nd ago" pill), and api_keys.last_sync_at is refreshed daily by poll_allocator_positions
fix: not applied (diagnose-only)
verification:
files_changed: []
