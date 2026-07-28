---
gate: phase-18-lp-cron-readiness-runbook
status: PENDING
captured_at: "2026-05-06"
captured_by: "Phase 18 Plan 03 (gsd-execute-phase)"
requirement: LP-01
---

# Phase 18 LP-01 — Founder LP Cron Pre-Flight Runbook

> **Required by:** REQUIREMENTS.md LP-01 + Adversarial revision 2026-05-06 (B1).
> The factsheet PDF endpoint at `src/app/api/factsheet/[id]/pdf/route.ts:37-55`
> requires:
>
> - `strategies.status = 'published'` (filter at line 43)
> - `strategy_analytics.computation_status = 'complete'` (filter at line 51)
>
> If either check fails, the endpoint returns 404 (status) or 400 (analytics).
> The cron at `/api/cron/founder-lp-report` will then fall into the dual-alert
> failure path on every tick.

> **Decision (founder)**: BEFORE the first scheduled cron tick (`15 9 1 * *`),
> the founder MUST:
>
> 1. Run the wizard for the founder strategy → `strategies.status = 'active'`
> 2. Wait for analytics worker → `strategy_analytics.computation_status = 'complete'`
> 3. Flip `strategies.status` from `'active'` to `'published'` via Supabase Studio
> 4. Run `npm run check:founder-lp-readiness` to confirm both columns are green
> 5. THEN the next 1st-of-month cron tick is allowed to fire

## Pre-flight checklist (founder fills timestamps at /ship time)

| Step | Timestamp (ISO-8601 UTC) |
|------|---------------------------|
| 1. Wizard run completed → `status='active'` | `<TODO: ISO-8601>` |
| 2. Analytics worker → `computation_status='complete'` | `<TODO: ISO-8601>` |
| 3. Manual flip → `status='published'` | `<TODO: ISO-8601>` |
| 4. `npm run check:founder-lp-readiness` exits 0 | `<TODO: ISO-8601>` |
| 5. First cron tick (`15 9 1 * *` after step 4) | `<TODO: ISO-8601>` |

## Manual flip command (Supabase Studio SQL)

```sql
UPDATE strategies
SET status = 'published', updated_at = NOW()
WHERE id = '<FOUNDER_LP_STRATEGY_ID>'
  AND status = 'active';

SELECT id, status, name FROM strategies WHERE id = '<FOUNDER_LP_STRATEGY_ID>';
-- Expect: status='published'
```

## Readiness gate

The cron handler ALSO logs a Sentry warning at startup if either column is
not in the expected state — this is defense-in-depth so a missed runbook
step still surfaces (instead of a silent dual-alert).

## Vercel UI env-var staging (do BEFORE first scheduled tick)

| Env var | Source | Required at |
|---------|--------|-------------|
| `FOUNDER_LP_STRATEGY_ID` | Founder picks own strategy UUID from `strategies` table | Vercel UI → Settings → Environment Variables → Production |
| `FOUNDER_LP_REPORT_TO` | Founder email (falls back to `ADMIN_EMAIL`) | Vercel UI |
| `INTERNAL_API_TOKEN` | Already wired (PR #120). Reused for `x-internal-token` header on internal fetch to bypass `publicIpLimiter` (Adversarial revision: B4) | Already staged |
| `CRON_SECRET` | Already wired | Already staged |
| `RESEND_API_KEY` | Already wired | Already staged |
| `SENTRY_DSN` | Already wired (optional but recommended) | Already staged |

## /ship-time runbook entry

After PR merges:

1. Confirm three env vars staged in Vercel UI: `FOUNDER_LP_STRATEGY_ID`,
   `FOUNDER_LP_REPORT_TO`, `INTERNAL_API_TOKEN` (already present).
2. Founder flips `strategies.status = 'published'` per the SQL block above.
3. Run `npm run check:founder-lp-readiness` locally with production env
   pulled (`vercel env pull --environment=production`).
4. Manually trigger the cron once via Vercel Dashboard → Project → Crons →
   `/api/cron/founder-lp-report` → "Run Now" — confirm Resend email +
   PDF attachment delivery.
5. Mark this gate `status: COMPLETE` and update the timestamp table above.
