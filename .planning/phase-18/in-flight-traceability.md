---
gate: phase-18-fix-01-traceability
status: RECORDED
captured_at: "2026-05-06"
captured_by: "Phase 18 Plan 01 (gsd-execute-phase)"
requirement: FIX-01
---

# Phase 18 FIX-01 — In-Flight Traceability

## TL;DR

Phase 18 FIX-01 ("root-cause fix at the source layer + regression test that
fails without the fix") was satisfied IN-FLIGHT before plan-phase ran. PR #116
(commit `3932842`, merged 2026-05-05) shipped three distinct wizard root
causes; commits `a48a92e` + `1960f54` shipped the Bug #1 forensic patch
threading `correlation_id` through `compute_jobs.metadata` at three Next.js
enqueue callsites; PRs #117–#120 shipped four Bybit-specific broker quirk
fixes. This file records all three groups as Phase 18 traceability per
CONTEXT.md L37-41. NO re-plan; NO code change in this task.

## PR #116 — Wizard root-cause fix (per D-PR116)

- **Commit:** `3932842` (cite verbatim — used by plan-checker as the PR fingerprint)
- **Merged:** 2026-05-05 (PR title self-titled "Phase 18 / Day-2 root-cause
  fix" per Day-2 doc Section 1 hypothesis #9)
- **Three root causes shipped:**
  1. **Bridge race** — `analytics-service/main_worker.py:155-165` dispatched
     `sync_strategy_analytics_status` BEFORE `mark_compute_job_done`. The 50ms
     gap let the bridge fire while `compute_jobs.status='running'`, the 038
     RPC's "any non-terminal → 'computing'" branch wrote
     `strategy_analytics.computation_status='computing'`, and the bridge was
     never re-fired after the terminal flip. Migration
     `099_mark_compute_job_atomic_status_bridge.sql` adds a self-verifying
     invariant DO-block that makes the bridge atomic with the status flip.
  2. **Missing chain link** — `run_sync_trades_job` did not enqueue the
     follow-on `compute_analytics` job. PR #116 wires the enqueue with
     transient-failure tolerance.
  3. **Validate-key swallow sites** — bare `except Exception:` clauses in
     `analytics-service/routers/exchange.py` (`validate_key`) and
     `analytics-service/services/exchange.py` (`validate_key_permissions`)
     were replaced with `logger.exception`, exposing the real ccxt class +
     body that customers had been seeing collapsed to `code: UNKNOWN`.
- **Regression test:**
  `analytics-service/tests/test_job_worker.py:553 TestSyncTradesEnqueuesComputeAnalytics`
  (asserts `run_sync_trades_job` enqueues `compute_analytics`).
- **Migration self-test:** migration
  `099_mark_compute_job_atomic_status_bridge.sql` DO-block invariant.
- **Live verification:** OKX strategy with 272 trades unstuck in
  production-equivalent env (Day-2 doc Section 1 hypothesis #9 evidence row).

## Bug #1 forensic patch — correlation_id thread (per D-BUG1)

Bug #1 was a forensic gap, not the wizard-hang root cause. The
`enqueue_compute_job` Postgres RPC accepts `p_metadata JSONB DEFAULT NULL`
(migration 062), and three Next.js callsites were not threading the inbound
`correlation_id` into that arg. Two commits closed it:

- **Commit `a48a92e`** — initial thread at
  `src/app/api/keys/sync/route.ts:94` (sync flow) and
  `src/app/api/intro/route.ts:220` (intro flow).
- **Commit `1960f54`** — follow-up `compute_intro_snapshot` thread; covered by
  `src/app/api/intro/route.test.ts:265-291` (test name "Phase 18 Bug #1
  follow-up").

Pattern (now locked): every new `enqueue_compute_job` callsite in Next.js MUST
pass `p_metadata: { correlation_id }` from `getCorrelationId()`. Mirror sweep
at `src/app/api/allocator/holdings/sync/route.ts` was reviewed at PR time per
Day-2 doc Section 2.

## Bybit broker quirks — PRs #117–#120 (per D-BYBIT-QUIRKS)

Record-only. These four PRs patched broker-specific issues and belong to a
longer-term broker-quality SLA pattern, not the v1.0.0 wizard-hang root cause:

- **PR #117** (commit `f852548`) — Bybit fetchCurrencies disable +
  load_markets best-effort fallback + INTERNAL_API_TOKEN parity wiring.
- **PR #118** (commit `7a418d7`) — readOnly flag supersedes permissions
  arrays in `detect_bybit_permissions`.
- **PR #119** (commit `5a55f0e`) — readOnly is STRING not INT in ccxt
  response (Bybit detection precedence fix).
- **PR #120** (commit `25fa4da`) — wizard polish + EquityChart polish +
  Tailwind v4 sweep + scope-escalation hardening + silent-failure cleanup.

(Note: the original plan body mapped PR#→commit slightly differently based on
Day-2 doc Section 1 row #6. The hashes above are the verbatim
`git log --oneline` resolutions on this branch as of execute time.)

## Verdict

FIX-01 is **CLOSED** as record-only against this file. The plan-checker greps
this file for `3932842`, `TestSyncTradesEnqueuesComputeAnalytics`, `a48a92e`,
and `1960f54` — all four MUST appear verbatim.

Do NOT alter or paraphrase commit hashes. The plan-checker's grep gate is
exact-match.
