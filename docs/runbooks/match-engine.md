# Match Engine Runbook

Operational guide for the Perfect Match Engine (founder-amplifier). See the
implementation plan at `docs/superpowers/plans/2026-04-07-perfect-match-engine.md`.

## Overview

- **What it does:** scores quant strategies for each allocator and surfaces a
  ranked candidate list to the founder in `/admin/match/[allocator_id]`.
- **Who sees it:** the founder only. Allocators never see the score.
- **How the founder uses it:** open the match queue, pick 3 candidates per
  allocator, send an intro via the existing `contact_requests` flow.
- **Ground truth:** `match_decisions` records every thumbs-up / thumbs-down /
  sent-as-intro decision. The eval dashboard measures algorithm hit rate
  against the founder's actual picks.

## Deploy checklist

1. Migration 011 applied to staging:
   - `ALTER DATABASE postgres SET app.admin_email = 'founder@quantalyze.io';` (persist via `ALTER DATABASE` so restores remain idempotent)
   - Run `011_perfect_match.sql`
   - Verify: `SELECT id, is_admin FROM profiles WHERE email = 'founder@...';` → is_admin = true
1a. Migration 014 applied to staging:
   - Run `014_strategy_codename.sql` (adds nullable `strategies.codename`).
   - Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name = 'codename';` → returns one row.
   - Without this column the match engine recompute 500s with `column strategies.codename does not exist` and `/admin/match/[allocator_id]` returns 500.
2. Python service deployed with the new `routers/match.py` registered in `main.py`
3. Next.js deployed with the new admin API routes
4. Environment variables confirmed: `ADMIN_EMAIL`, `ANALYTICS_SERVICE_URL`, `ANALYTICS_SERVICE_KEY`
5. Smoke test (as founder):
   - Visit `/admin/match` → allocator list loads
   - Click "Recompute all" → progress shows
   - Open one allocator → shortlist strip + two-pane renders
   - Click "Send intro →" → modal opens, submit → verify `contact_requests` row created

## Common issues

### Engine returning empty queues for everyone
1. **Kill switch?** Check `system_flags.enabled` where `key = 'match_engine_enabled'`. If false, flip it back on via the admin UI.
2. **Migration not applied?** `SELECT COUNT(*) FROM match_batches;` — if the table doesn't exist, migration 011 hasn't run.
3. **Python service down?** `curl $ANALYTICS_SERVICE_URL/health`
4. **No strategies in universe?** `SELECT COUNT(*) FROM strategies WHERE status = 'published';` — if 0, the engine has nothing to score.
5. **All candidates excluded?** Check `/admin/match/[id]` → excluded list. Adjust preferences.

### Recompute fails with RLS error
- Verify service role token is being used: `SELECT auth.role();` in the failing query context. Should be `service_role`.
- Check policies: `SELECT * FROM pg_policies WHERE tablename IN ('match_candidates', 'match_batches', 'match_decisions');`
- Both `_service_insert` and `_admin_select` policies must exist per table.

### Send Intro returns "already sent" but the founder expected a new one
- By design: `contact_requests` has `UNIQUE (allocator_id, strategy_id)` from migration 001. The RPC respects this constraint and surfaces `was_already_sent = true`.
- If the founder needs to re-pitch, they should message the allocator directly via Telegram/email, not through the engine.

### Cron takes > 5 minutes
- Check concurrency: the semaphore is 3, so increasing helps only up to CPU saturation.
- Benchmark per-allocator latency: `SELECT allocator_id, latency_ms FROM match_batches ORDER BY computed_at DESC LIMIT 50;`
- If p95 latency > 10s per allocator, the universe caching isn't working or the pandas alignment loop is pathological. Profile with `py-spy` on the analytics service.

### `is_admin` is false for the founder
- Manual backfill:
  ```sql
  UPDATE profiles SET is_admin = true
  WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('founder@quantalyze.io'));
  ```
- The email-based gate in `lib/admin.ts` is still active as a fallback, so the founder should still be able to access `/admin/match` even if `is_admin = false`. But RLS won't let them SELECT from `match_*` tables without `is_admin = true`.

### Hit rate is 0%
- Expected in the first week: the founder doesn't have enough decisions yet for the eval dashboard to be meaningful.
- Graduation gate: 20+ intros + 40% top-3 hit rate + 5+ conversions. Check the eval dashboard at `/admin/match/eval`.

## Manual operations

### Disable the engine immediately
- Click the **Engine: ON** pill in `/admin/match` → toggles to OFF
- OR directly: `UPDATE system_flags SET enabled = false WHERE key = 'match_engine_enabled';`

### Reset a bad batch for an allocator
```sql
DELETE FROM match_batches WHERE allocator_id = 'ALLOCATOR_UUID' ORDER BY computed_at DESC LIMIT 1;
-- Then click Recompute now in the admin UI.
```

### Re-enable for new allocator
Any profile with `role IN ('allocator', 'both')` is automatically included in the next cron run. No manual opt-in needed.

## Metrics to watch

- `match_engine_recompute_total{status}` — cron success/failure/disabled
- `match_engine_candidates_generated_total` — should tick up each cron run
- `match_engine_recompute_latency_seconds` — p95 < 30s
- Eval dashboard hit rate — the single most important metric for v2 graduation
