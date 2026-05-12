# Phase 19 — Stability Log (BACKBONE-04 / BACKBONE-09)

**Purpose:** Records the 7-calendar-day stability window between commit (b) flag-flip and commit (d) VIEW rename per BACKBONE-04. Plan-checker reads `flag_flipped_at` and asserts ≥168h delta before commit (d) ships.

## Flag Flip Timestamp

- **flag_flipped_at:** TODO (record from commit (b) timestamp; ISO-8601 UTC, e.g. `2026-05-15T14:00:00Z`)

## Daily Sentry Error-Envelope Rate (15-min tumbling windows averaged daily)

| Day | Date | Error rate (%) | /process-key calls | Errors | Notes |
|-----|------|----------------|--------------------|--------|-------|
| 1 | YYYY-MM-DD | 0.00 | N | M | first 24h post-flip |
| 2 | YYYY-MM-DD | 0.00 | N | M | |
| 3 | YYYY-MM-DD | 0.00 | N | M | |
| 4 | YYYY-MM-DD | 0.00 | N | M | |
| 5 | YYYY-MM-DD | 0.00 | N | M | |
| 6 | YYYY-MM-DD | 0.00 | N | M | |
| 7 | YYYY-MM-DD | 0.00 | N | M | ≥168h elapsed; commit (d) eligible if all rows below 0.5% |

## Daily vcrpy + repro-key-flow.sh Cassette Refresh (Theme 5)

| Day | OKX cassettes refreshed | Bybit cassettes refreshed | Result |
|-----|-------------------------|---------------------------|--------|
| 1 | 4/4 | 4/4 | ✓ |
| 2 | 4/4 | 4/4 | ✓ |
| ... | ... | ... | ... |

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
