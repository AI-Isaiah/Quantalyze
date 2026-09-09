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
   - ⚠️ **CORRECTED 2026-09-07 — the statement this step used to instruct cannot run here.** It said: `ALTER DATABASE postgres SET app.admin_email = 'founder@quantalyze.io';` (persist via `ALTER DATABASE` so restores remain idempotent). **Measured on PROD 2026-09-05 in the Supabase SQL editor as `postgres`: `ERROR: 42501: permission denied to set parameter`** — a custom placeholder GUC needs superuser and `postgres` is not one on this platform. The role-level form returns the same. Only a session-scoped `SET` succeeds, and a session GUC dies with the session, so it can never survive a restore. Anyone following the old step stalled on it.
   - **There is nothing to set.** `app.admin_email` is read exactly ONCE, by the one-shot `DO $$ … END $$` block in `20260407164606_perfect_match.sql` that ran when the migration applied on 2026-04-07 and can never run again — no function body, no cron command, no view, and no second definition anywhere in `supabase/migrations/`. It has **no live reader**. That is disposition **D-04**, the SCOPE AMENDMENT recorded in ROADMAP criterion 2 and `164.7-CONTEXT.md`: the file carries a dated `-- APP-GUC-LINEAGE:` header rather than being migrated (a block that already ran) or deleted (an applied migration is the record of what ran against PROD).
   - **To grant admin on a fresh database,** run the `UPDATE profiles SET is_admin = true WHERE …` by hand after the migration applies — exactly what the migration's own comment already says to do when the setting is absent, which from 2026-09-07 is always.
   - Run `20260407164606_perfect_match.sql`
   - Verify: `SELECT id, is_admin FROM profiles WHERE email = 'founder@...';` → is_admin = true
1a-bis. The match-engine cron's mechanism — same correction, same cause:
   - The hourly `match_engine_cron` job no longer resolves anything from `app.*`. PROD's jobid 1 was hand-repaired on 2026-09-01 onto a `DO` block reading the key from `vault.decrypted_secrets`, and the repo now describes that mechanism as `public.match_engine_cron_tick()` in `20260907120000_analytics_service_settings_and_vault_tick.sql` — key from Vault, URL from `public.system_settings`, a loud `RAISE` on either absence.
   - ⚠️ **The LIVE `cron.job` row is not yet pointed at that function.** Repointing it is Phase 164.5 item (7), against the captured `scripts/prod-prober/cron-manifest.json`. Until then the repo and the live row agree in MECHANISM but not in TEXT, and the Phase 164.1 `cron-drift` arm is the instrument that says so.
   - ✅ **`[A1]` MEASURED 2026-09-09 on shared TEST — the assumption HELD, and it no longer gates the repoint.** The question was whether a `SECURITY DEFINER` function owned by `postgres` may read the real encrypted `vault.decrypted_secrets` view on a hosted Supabase project. Read in the TEST SQL editor by the founder:

     ```sql
     SELECT has_schema_privilege('postgres','vault','USAGE')                   AS usage,      -- true
            has_table_privilege('postgres','vault.decrypted_secrets','SELECT') AS can_select; -- true
     ```

     Conditions that make the reading load-bearing rather than incidental, measured in the same session: `supabase_vault` is installed, `vault.decrypted_secrets` is owned by **`supabase_admin`** (not by `postgres`), and `postgres` is **NOT** a superuser there — i.e. the hosted-platform constraint the assumption was about is genuinely present, not bypassed by an over-privileged role. `SECURITY DEFINER` executes as the function's OWNER, so `postgres` holding both privileges is exactly what the callable needs.
     ⭐ Independent corroboration, different instrument: PROD's live jobid 1 already performs this same Vault read hourly as `username: postgres` and succeeds (`net._http_response` id 3485 → 200, 2026-09-01). ACL and runtime therefore agree.
     ⚠️ **What is still NOT proven, stated so nobody upgrades it by retelling:** no `SECURITY DEFINER` wrapper was actually executed against the real Vault — the ACL was read, the function was not called. Calling the shipped `public.match_engine_cron_tick()` would fire a real `net.http_post` at the production analytics service, which is why it was not called. The wrapper is expected to be a no-op on role (definer `postgres`, caller `postgres`), but that is an argument, not a measurement.
     ⛔ The pg-lane cannot answer this class at all — its vault is a plaintext stand-in by construction. Do not "confirm" A1 from a lane run.
   - To change the analytics URL without touching secrets, behind the which-database marker from `CLAUDE.md`: `UPDATE public.system_settings SET value = '<host>', updated_at = now() WHERE key = 'analytics_service_url';`
1a. Migration 014 applied to staging:
   - Run `20260408155411_strategy_codename.sql` (adds nullable `strategies.codename`).
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

- `match_engine_recompute_total{status}` — cron status. Discrete values:
  `ok` (failures don't outnumber successes), `degraded` (`failed > processed`,
  majority-failure but at least one row through), `total_failure`
  (`processed=0, failed>0` — structural fault, alert immediately),
  `disabled`, `skipped` (recent batch), `no_allocators`, `empty_universe`.
  Pre-v0.22.37.0 this label was binary `ok`/`failed` and `total_failure` was
  masked as a green 200; alert on `degraded` or `total_failure` going forward.
- `match_engine_candidates_generated_total` — should tick up each cron run
- `match_engine_recompute_latency_seconds` — p95 < 30s
- Eval dashboard hit rate — the single most important metric for v2 graduation
