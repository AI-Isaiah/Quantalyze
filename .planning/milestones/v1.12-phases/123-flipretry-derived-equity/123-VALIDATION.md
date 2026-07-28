---
phase: 123
slug: flipretry-derived-equity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-19
---

# Phase 123 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) + vitest (queries.ts) |
| **Quick run** | `cd analytics-service && .venv/bin/python -m pytest tests/test_job_worker_flipretry*.py -q` |
| **Full suite** | `cd analytics-service && .venv/bin/python -m pytest -q` ; `npm test` |

## Per-Task Verification Map

| Task | Requirement | Correct Behavior | Test | Status |
|------|-------------|------------------|------|--------|
| wait_for crawl bounds | FLIPRETRY-01 | build_deribit_native_ledger + fetch_ccxt_transfers each wrapped; a hung crawl → transient (bounded), NEVER unbounded await | unit (fake hang) | ⬜ |
| dedicated batched worker | FLIPRETRY-02 | backfill kinds claimed by a kind-filtered claim → OFF the prod sequential loop; prod claim EXCLUDES them; cron `derive-allocator-key-dailies` `30 5 * * *` re-scheduled (safe) | unit + migration | ⬜ |
| E2 ground-truth gate | FLIPRETRY-03 | is_trustworthy set ONLY when E2 anchor-consistency passes (independent oracle); extractTrustworthyDerivedCurve shows derived only when trustworthy else legacy | unit (fixture pass/fail → derived/legacy) | ⬜ (live founder) |
| health + rollback | FLIPRETRY-04 | prod healthz never stale during backfill (dedicated worker isolates); enqueue idempotent (one-inflight guard); documented rollback (delete jobs + empty allocator_equity_derived + unschedule cron) | unit + runbook | ⬜ |

## Wave 0

- [ ] `analytics-service/tests/test_job_worker_flipretry.py` — fake-hang crawl → the wait_for bound fires transient (FLIPRETRY-01, plan 01)
- [ ] `supabase/tests/test_claim_kind_filter.sql` — the kind-filtered claim (include/exclude/NULL-passthrough) + fan-out idempotency (FLIPRETRY-02/04, plan 02)
- [ ] `analytics-service/tests/test_main_worker.py` — the per-job `LAST_TICK_AT` refresh (healthz-fresh, FLIPRETRY-04, plan 02)
- [ ] the E2-gate fixture test (anchor pass → is_trustworthy True → derived; anchor fail → False → legacy) (FLIPRETRY-03, plan 03)

## Manual-Only (founder ops)

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| Live E2_GROUND_TRUTH run | needs `E2_GROUND_TRUTH_*` env (read-only key in Railway) | Founder runs `e2_allocator_ground_truth.py`; a material divergence FAILS LOUD |
| Deploy the dedicated batched worker + re-schedule cron + prod backfill enqueue | new Railway worker + prod ops | Founder deploys the backfill worker, re-schedules the cron, runs the bounded enqueue watching healthz; rollback documented |

## Validation Sign-Off

- [ ] a hung crawl can NEVER block the prod worker loop (wait_for + dedicated worker — both tested)
- [ ] prod healthz never stale past 90s during backfill (dedicated worker isolates)
- [ ] the flip shows derived ONLY when the E2 gate passes (fixture-proven)
- [ ] rollback documented (the v1.11 recovery verbatim); enqueue idempotent
- [ ] P115: the E2 anchor oracle is independent
- [ ] `nyquist_compliant: true`

**Approval:** pending
