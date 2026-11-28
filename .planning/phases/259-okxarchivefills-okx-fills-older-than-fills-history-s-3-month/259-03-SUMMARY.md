---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 03
subsystem: analytics-service
tags: [okx, sync_trades, compute_jobs, cooldown, chain]
status: complete
requires:
  - phase: 167.1.2.2.2.1 OKXHISTORY
    provides: the okx_archive_rebuild job kind and its account check
provides:
  - "chain_okx_archive_fills: trigger predicate and enqueue of one okx_archive_rebuild job, mode fills_apply, on the syncing OKX key"
  - "a one-hunk best-effort seam at the tail of run_sync_trades_job"
  - "FILLS_APPLY_MODE and WRITE_BOUND_MARGIN_MS as the one definition each (plans 05 and 07 import and bind them)"
affects: [259-05, 259-07, 259-08]
commits: 2
plan_head_before: 69646de134c48eb9ec05abd2bd7fd54dcf0da7d3
plan_head_after: f8f252905d12ba5d3e8e223b5083d1fff1610e41
actuals:
  tokens: 9400
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "cross-target re-entry on the api_key, not a parented follow-on: JOB_CHAIN_FOLLOW_ON and the reaper ceiling stay unchanged"
    - "verdict table driving both a per-verdict arm and an all-verdicts census"
key-files:
  created:
    - analytics-service/services/okx_archive_fills_chain.py
    - analytics-service/tests/test_okx_archive_fills_chain.py
  modified:
    - analytics-service/services/job_worker.py
key-decisions:
  - "The seam gates on a clean FILLS read only (not on the daily read), so the three PROD OKX strategies whose daily read is refused on every sync still chain (recorded at planning time)."
  - "The cooldown is account-scoped (every OKX key sharing the venue_account_id), and the mode filter lives in the query so a fills_calibrate row is never returned."
requirements-completed: [SC-4, SC-5]
---

# Phase 259 Plan 03: OKX archive-fills chain Summary

A finished OKX `sync_trades` with a clean fills read now chains one `okx_archive_rebuild` job (`{"mode": "fills_apply"}`, `p_strategy_id` None) on its own key, after the `derive_broker_dailies` follow-on, when the strategy's earliest daily return is below the write bound and its earliest stored fill is absent or more than 2 days later, unless an account-wide 14-day cooldown applies. The chain can never change the sync's outcome.

## Accomplishments

- `services/okx_archive_fills_chain.py`: `chain_okx_archive_fills` returns one verdict of `CHAIN_VERDICTS` (`not_okx`, `no_account`, `no_anchor`, `unreadable`, `anchor_in_reach`, `fills_reach_anchor`, `cooldown`, `enqueued`). Reads go through `db_read_with_retry`, the write through `db_execute`, the whole body inside `asyncio.timeout(CHAIN_TIMEOUT_S)`. A blank `venue_account_id` makes zero reads. An enqueue before 01:45 UTC carries `p_run_at` 01:50 UTC the same day.
- Cooldown: `fills_apply` jobs created in the last 14 days on any OKX key of the same account count when in flight, `done`, or `failed_final` with a named stop other than `invalid_input`; `fills_calibrate` never counts.
- `job_worker.py`: one hunk immediately before the final `return DispatchResult(` of `run_sync_trades_job`, lazy import, `except Exception`, gated on `okx and _RAW_TRADE_INGESTION_ENABLED and not _fills_read_skipped and not phase2_failed and not _fills_incomplete`. `git diff -U0 <phase base> -- job_worker.py` has exactly 1 hunk.
- `JOB_CHAIN_FOLLOW_ON`, `TIMEOUT_PER_KIND` (16), `WATCHDOG_PER_KIND_OVERRIDES` and `BACKFILL_KINDS` are untouched.

## Task Commits

1. Task 1 (tracer): `53a1f16bf` feat(259-03): chain the OKX archive-fills read from sync_trades
2. Task 2: `f8f252905` test(259-03): pin every chain verdict, the cooldown rules, window deferral, seam gating and isolation

## Verification

- `tests/test_okx_archive_fills_chain.py`: 30 passed. Every verdict is produced by a case (`test_every_verdict_is_produced`).
- Regression suites named in the plan (okxtrades cursor/walk, sync_trades store truth / preserves fills / resume seed / enqueue-failure bridge, mt5 sync path, nullanchor, binancefills cursor/e2e, main_worker, okx_archive_job): 593 passed, 12 skipped. The 12 skips are the live-DB lane tests (`LANE_DB_URL` unset / local-stack lane not configured) in `test_sync_trades_preserves_fills.py` and `test_sync_trades_enqueue_failure_bridge_live.py`, pre-existing and unrelated to this plan. None of those suites was edited (`git diff` against the phase base is empty for them).
- `make typecheck`: mypy strict, no issues in 147 source files.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 13 claims.
- Quick neuter check (byte backup, restored and proven with `cmp`): dropping the `metadata->>mode` filter turned `test_cooldown_ignores_calibrate` RED; dropping `not phase2_failed` from the seam turned `test_seam_skips_failed_fills_read` RED. The formal PROOF-01 run stays with plan 08.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's hand-typed in-window clock is outside the window**
- **Found during:** Task 1 (verifying the hand-typed instants with Python before use)
- **Issue:** the plan gives 1795745520000 as "2026-11-27T00:12:00Z", but it is 2026-11-27T02:12:00Z, after the 01:45 window end, so `p_run_at` would never be attached.
- **Fix:** the test uses `WINDOW_NOW_MS = 1795738320000`, verified as 2026-11-27T00:12:00Z; the expected `p_run_at` "2026-11-27T01:50:00+00:00" is unchanged.
- **Files modified:** `analytics-service/tests/test_okx_archive_fills_chain.py`
- **Commit:** `53a1f16bf`

**2. [Rule 3 - Blocking] The recording fake needed the re-read bound table**
- **Found during:** Task 1
- **Issue:** the OKX run also records a provisional re-read bound (`set_strategy_fills_reread_bound`); a plain RPC stub answered it "not owned", so the handler skipped the fills read and the seam gate was false.
- **Fix:** the fake serves `strategy_fills_reread_bounds` and that RPC through the existing `tests._binance_fills.RereadBounds`.
- **Files modified:** `analytics-service/tests/test_okx_archive_fills_chain.py`
- **Commit:** `53a1f16bf`

No change to `okx_archive_fills_chain.py` was needed after Task 1; no arm was weakened.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the service-role enqueue the threat model already names (T-259-05 to T-259-08), each mitigated and pinned by a named arm.

## Self-Check: PASSED

- FOUND: analytics-service/services/okx_archive_fills_chain.py
- FOUND: analytics-service/tests/test_okx_archive_fills_chain.py
- FOUND commits: 53a1f16bf, f8f252905 (ancestors of HEAD)
