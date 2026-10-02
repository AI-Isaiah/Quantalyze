---
phase: 106-stage-b-cutover-delete-legacy
verified: 2026-07-15T13:35:00Z
status: passed
score: 5/5 must-haves verified
re_verification:
  previous_status: none
  note: initial goal-backward verification of Stage B
gaps: []
human_verification: []
merge_gate_reminders:
  - "supabase/tests/test_compute_analytics_kind_retired.sql is RED-guarded: apply migration 20260716090000 to the TEST project (qmnijlgmdhviwzwfyzlc) via Supabase MCP BEFORE merge, else the SQL gate reddens in CI by design."
---

# Phase 106 Stage B — Cutover / Delete-Legacy Verification Report

**Phase Goal (BB-03):** After Stage B the unified backbone is MANDATORY — the
legacy/dark compute path, its 4 re-entry points, and the rollback flag
machinery are deleted so no code can route onto a non-backbone path. Rollback
is git-revert only.

**Verified:** 2026-07-15 · **Status:** GOAL ACHIEVED · **Re-verification:** No (initial)

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dark `run_strategy_analytics` chain deleted, zero live callers, permanent grep-gate asserts invariants and passes | ✓ VERIFIED | `def run_strategy_analytics` absent; only comment/docstring mentions remain in 3 keep-tests; `test_dark_path_deleted.py` 7/7 PASS (negative + SC-3 positive) |
| 2 | All 4 dark-path re-entries retired; RPC guard rejects retired kind in BOTH overloads | ✓ VERIFIED | BROKER_DAILIES_VIA_FUNDING gone (comments only); phase12_backfill_enqueue.py + routers/analytics.py deleted; both funding paths collapsed to unconditional `derive_broker_dailies` (job_worker:1504, cron:448); legacyKeysSyncHandler gone; timeout/watchdog residue gone; migration guard at both overloads (SQL:83, :224) |
| 3 | Rollback net removed, unified mandatory | ✓ VERIFIED | flag-monitor alert-only (upsert targets ZERO_DENOM_STREAK_KEY, never kill-switch); phase19-error-rollup route+test deleted; feature-flags.ts + feature_flags.py deleted; process_key 503 arm gone (body unconditional, process_key:539 comment only); main_worker `flag_active = True` constant with `p_unified_backbone_active` still passed — claim-RPC signature byte-identical, NO claim migration in diff |
| 4 | SC-3 keeps intact; 45 historical rows + kind CHECK/registry preserved | ✓ VERIFIED | run_csv_strategy_analytics, compute_all_metrics, trades_to_daily_returns_with_status, run_compute_analytics_from_csv_job all live; dispatch map keeps csv/derive handlers; migration is RPC-guard NOT registry/CHECK drop (SQL:5-9); SQL test asserts CHECK still admits kind |
| 5 | No silent behavior change on true path; runLegacyFinalize correctly KEPT | ✓ VERIFIED | Unified/composite finalize tests pass unchanged; runLegacyFinalize STAYS, reachable via composite hoist (finalize-wizard:616) for stitch_composite enqueue + side-effect fan-out; single-key flag-off fall-through deleted (route:624-626) |

**Score: 5/5 truths verified.**

## Executed Gates & Tests

| Suite | Result |
|-------|--------|
| `test_dark_path_deleted.py` (permanent grep-gate) | 7 passed |
| Python: process_key/job_worker/main_worker/cron/phase12_deploy/worker_load | 296 passed, 1 skipped |
| Python: analytics_runner/csv_analytics_runner/cash_basis_series_sc4 (SC-3 keeps) | 146 passed |
| TS: flag-monitor / finalize-wizard / keys-sync / csv-validate / verify-strategy / process-key-thin-adapters / cron-flag-monitor | 170 passed (7 files) |
| SQL gate `test_compute_analytics_kind_retired.sql` | NOT EXECUTED — needs live DB; RED-guarded by design; structure verified (both overloads + CHECK-preserved asserts present) |

## Over-deletion / Under-deletion Audit

- **Over-deletion (a KEEP that died):** NONE. SC-3 positive asserts pass; all keep functions/handlers/helpers present; no dangling imports (Python AST parse OK, no TS/py imports of deleted feature-flags modules).
- **Under-deletion (a re-entry that survived):** NONE. Repo-wide greps for BROKER_DAILIES_VIA_FUNDING, USE_COMPUTE_JOBS_QUEUE, isUnifiedBackboneActive, is_unified_backbone_active, legacyKeysSyncHandler, computeAnalytics, run_compute_analytics_job return only comments (zero live references). vercel.json cron list no longer registers phase19-error-rollup.

## Merge-Gate Reminder (not a code gap)

The SQL gate `test_compute_analytics_kind_retired.sql` reads live function bodies
and is RED-guarded until migration `20260716090000` is applied to the TEST
project (qmnijlgmdhviwzwfyzlc) via Supabase MCP. Apply BEFORE merge so CI goes
green. This is documented in the SQL test header and is expected behavior, not a
defect in the Stage-B code.

---

_Verified: 2026-07-15 · Verifier: Claude (gsd-verifier), goal-backward_
