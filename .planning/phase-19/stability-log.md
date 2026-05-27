# Phase 19 — Stability Log (BACKBONE-04 / BACKBONE-09)

**Purpose:** Records the 7-calendar-day stability window between commit (b) flag-flip and commit (d) VIEW rename per BACKBONE-04. Plan-checker reads `flag_flipped_at` and asserts ≥168h delta before commit (d) ships.

## Measurement (updated 2026-05-25 — prod-based gate)

The soak is now CI-verified against **production** by
`.github/workflows/phase-19-stability.yml` (hourly), which calls the read-only
`phase19_soak_status` RPC (migration `20260525113000`) with the prod ANON key
and runs `scripts/verify-no-legacy-writes.sh`. This **replaces** the prior
approach (test project + an audit trigger that was never shipped to prod),
under which the green hourly runs were no-op skips and proved nothing.

**Honest status as of 2026-05-25:** the kill-switch is **OFF** in prod
(`feature_flags.process_key_unified_backbone`), `flag_flipped_at` below is
unrecorded, and **the 168h soak has NOT started.** When the switch is flipped
to `on`, record the real ISO-8601 timestamp in `flag_flipped_at` below — the
script reads it to (a) start the window and (b) count post-flip writes to the
legacy `verification_requests` table. The gate now fails loud if the flag is
flipped without recording here, or rolled back mid-window.

## Flag Flip Timestamp

- **flag_flipped_at:** 2026-05-25T15:51:07Z

## Daily Sentry Error-Envelope Rate (Vercel cron-recorded; READ FROM Supabase)

The 7 daily rows are now written to `public.phase19_soak_daily` by
`/api/cron/phase19-error-rollup` (Vercel cron, daily at 00:30 UTC). The
gate workflow `.github/workflows/phase-19-stability.yml` reads them via
`phase19_soak_status()` (extended migration `20260527152800`) and fails
loud if (a) <7 rows exist past ≥168h, (b) any row has `error_rate >= 0.005`,
or (c) any row's `total_events` denominator is zero outside an explicitly-noted
no-traffic day.

Reviewer query for the go/no-go review:

```sql
SELECT date_utc, day_index, error_rate, total_events, error_events, notes, recorded_at
  FROM public.phase19_soak_daily
 ORDER BY date_utc;
```

Backfill: `curl -H "Authorization: Bearer $CRON_SECRET" \
  "$PROD_URL/api/cron/phase19-error-rollup?date=2026-05-26"` upserts a
specific historical day's row. Idempotent on `date_utc`.

Day-index convention: flip-date row = day 1; day 8+ = soak over-extension.
`day_index BETWEEN 1 AND 14` is CHECK-enforced.

## Daily Cassette Refresh (`scripts/repro-key-flow.sh --record`)

Coverage: **OKX + Bybit only** (Binance dropped 2026-05-27 — no test keys
provided). The TS-side `tests/cassettes/` and Python-side
`analytics-service/tests/cassettes/{okx,bybit}/` are both refreshed daily
by `.github/workflows/cassette-refresh.yml` from real broker APIs using
read-only credentials in GH secrets (`DEBUG_KEY_FLOW_OKX_*`,
`DEBUG_KEY_FLOW_BYBIT_*`). Workflow runs the leak-gate (Layers A + B) on
every refresh and opens an auto-PR if the cassettes diverge from main.

Reviewer evidence: cassette-refresh workflow run history under
`gh run list --workflow=cassette-refresh.yml`. ≥6 of the 7 soak days
must show `conclusion: success` for the go/no-go criterion to pass.

## Customer-Feedback Gate (founder-only)

Manual: founder records ≥1 verbatim entry in
`.planning/phase-19/customer-feedback.md`. The gate cannot be automated
because the content is qualitative. See template in that file.

## Exit Criteria

- All 7 days at error rate < 0.5%
- ≥168h between flag_flipped_at and commit (d)
- Daily cassette refresh succeeded all 7 days
- Customer-feedback file (`.planning/phase-19/customer-feedback.md`) has ≥1 verbatim entry
- **PR-X1 merged** (`prep/phase-19-m5-preflight-relax` / PR #145) — narrows migration 107's M-5 preflight to `WHERE flow_type<>'teaser' AND public_token IS NOT NULL`. Without this PR, the live snapshot of 7 csv/csv rows with `public_token=NULL` in `strategy_verifications` would trigger the abort at apply time and force a hotfix.
- **PR-X2 merged** (`prep/phase-19-python-verify-strategy-repoint`) — removes the `verification_requests` INSERT/UPDATE writes from `analytics-service/routers/portfolio.py`'s `verify_strategy` endpoint. Without this PR, the BACKBONE-05 D-4 kill-switch rollback path raises SQLSTATE 42501 from the INSTEAD OF triggers on every fallback request (the auto-rollback target becomes a kill-loop). The TS caller's `strategy_verifications` upsert (BACKBONE-04 step (a)) owns the row's state-machine for the legacy path; Python stays on the compute path and returns the metrics in its response.

## Auto-Rollback SLA (BACKBONE-05 — D-4)

The /api/cron/flag-monitor cron polls Sentry every 15 minutes. When error
envelope rate breaches 0.5% with sample ≥ 20, it flips the Supabase
feature_flags kill-switch row to `off`. The Next.js + analytics-service
read seams cache the flag for `PHASE_19_STABILITY_CACHE_TTL_S` seconds
(default 30s).

| State | Cron tick | Cache TTL | Worst-case latency (breach → all traffic falling back) |
|-------|-----------|-----------|--------------------------------------------------------|
| Default | 15 min | 30 s | 15 min 30 s |
| Stability window (D-4) | 15 min | 5 s (`PHASE_19_STABILITY_CACHE_TTL_S=5`) | 15 min 5 s |

**Founder action during the 7-day stability window:** set
`PHASE_19_STABILITY_CACHE_TTL_S=5` on Vercel (production) and
analytics-service (Railway). After PR-D ships, unset the override —
default 30s TTL trades 25s of additional rollback latency for a 6×
reduction in Supabase reads on the kill-switch row (cost optimization
once the surface is proven stable).

**Manual rollback fallback** (Supabase outage, or PGRST resolution
error caught by D-3): `.planning/phase-19/rollback-runbook.md`. The
cron sends a SEV-2 email when the auto-rollback path itself fails
(D-3 + H-2 escalation paths) so on-call sees both Sentry and Resend
alerts.
