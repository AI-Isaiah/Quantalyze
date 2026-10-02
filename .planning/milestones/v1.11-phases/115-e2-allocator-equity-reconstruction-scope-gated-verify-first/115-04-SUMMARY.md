---
phase: 115-e2-allocator-equity-reconstruction-scope-gated-verify-first
plan: 04
subsystem: analytics-service
tags: [pytest, deribit, allocator, per-key-dailies, derive-broker-dailies, enqueue, verify-first, backbone]

# Dependency graph
requires:
  - phase: 115-01
    provides: A1 by-venue census (TEST 364/364 deribit allocator keys at 0 per-key csv_daily_returns) + shared E2 fixtures
  - phase: 35
    provides: dual-mode run_derive_broker_dailies_job (key-mode api_key upsert) + phase35_backfill_enqueue one-off
provides:
  - "Root-cause verdict for the all-deribit allocator dogfooding gap: (B) never-backfilled — handler (H) and enqueue predicate (E) both PROVEN correct by mutation-falsifiable pins"
  - "Durable regression pins: key-mode deribit -> per-key csv_daily_returns (H); structural-refusal fail-loud/zero-rows; phase35 enqueue reaches eligible deribit keys (E, venue-agnostic); D3 blend-eligibility shape; ccxt<->deribit key-mode upsert parity"
affects: [115.1-display-repoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verify-first characterization: three tests pin the exact failure LAYER (H/E/B) before any fix, so the root cause is proven not guessed"
    - "In-memory PostgREST fake that ACTUALLY filters rows -> a venue carve-out added at enqueue-time drops the deribit key and reddens the pin (genuine mutation-falsifiability, not a call-shape assertion)"

key-files:
  created:
    - analytics-service/tests/test_e2_deribit_allocator_dailies.py
  modified:
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py

key-decisions:
  - "Root cause is (B) never-backfilled, NOT (H) handler or (E) enqueue-filter: the key-mode deribit native branch already upserts per-key csv_daily_returns correctly, and the phase35 backfill predicate is role- AND venue-agnostic (deribit included). No job_worker.py change was warranted (Rule 3 — the plan explicitly allows job_worker.py untouched when the root cause is not there)."
  - "The operational remediation (run phase35_backfill_enqueue against the allocator-key population) is an approval-gated infra op (per 115-01 the PROD run is approval-gated; the worker must be draining to produce rows). NOT run autonomously from the executor; documented as a follow-up for the merge/deploy watcher."
  - "No migration added (root cause is not an enqueue-registration SQL gap)."

requirements-completed: []

# Metrics
duration: ~40min
completed: 2026-07-17
---

# Phase 115 Plan 04: All-deribit allocator per-key dailies — verify-first root-cause Summary

**Verify-first proved the all-deribit dogfooding gap is (B) never-backfilled — the key-mode deribit handler already produces per-key `csv_daily_returns` correctly and the one-off `phase35_backfill_enqueue` predicate already reaches eligible deribit keys (both pinned mutation-falsifiably) — so the ONLY remaining action is the approval-gated backfill, not a code fix; no `job_worker.py` change, legacy store / carve-out / `compute_twr` untouched.**

## Reproduce -> Root-cause -> (no code fix) chain

**Reproduce + characterize (Task 1, `tests/test_e2_deribit_allocator_dailies.py`, 4 tests GREEN):**
- **(H) handler** — `run_derive_broker_dailies_job` in KEY-MODE with `venue=deribit` (mocked native account-state + native ledger) UPSERTS `csv_daily_returns` keyed `(api_key_id, date)` with denormalized `allocator_id = key.user_id`, `strategy_id None`, `on_conflict='api_key_id,date'`, and does NOT enqueue `compute_analytics_from_csv` / stamp `strategy_analytics`. **PASSES → handler is correct.** The deribit native branch (`if venue == "deribit":`) runs for BOTH modes; the post-branch upsert (`job_worker.py:2848`) builds the api_key payload when `is_key_mode`.
- **fail-loud invariant** — a deribit key-mode derive whose native core raises `NavReconstructionError` returns FAILED/permanent with ZERO `csv_daily_returns` and no per-key stamp, secret scrubbed (T-115-15). **PASSES → no fabricated spot-gap series.**
- **(E) enqueue coverage** — driving `phase35_backfill_enqueue.main()` over an in-memory api_keys set shows the eligible deribit allocator key lands in the bulk-insert payload; revoked + disconnected keys are excluded. **PASSES → the key-mode enqueue predicate is role- AND venue-agnostic; deribit is NOT filtered out.**

**Root cause (by elimination): (B) never-backfilled.** Handler ✓ and enqueue predicate ✓ are both correct, yet 115-01's A1 census shows 364/364 eligible deribit allocator keys (and all 517 eligible allocator keys of every venue) at 0 per-key `csv_daily_returns` on TEST. The one-off `phase35_backfill_enqueue` is the ONLY api_key-scoped (key-mode) `derive_broker_dailies` enqueue in the codebase — every recurring enqueue (`routers/cron.py:448`, `services/job_worker.py:1504` sync_trades epilogue, `services/ingestion/long_fetch.py:500` tail) passes `p_strategy_id` (strategy-scoped). So the allocator-key population is only ever fed per-key dailies by that one-off script, which was never run against them.

**No code fix at source is warranted** (the source is correct on both the handler and the enqueue-predicate axes). The plan explicitly permits `job_worker.py` untouched when the root cause is not there. The remediation is operational (run the backfill), documented below.

## Mutation-falsifiability evidence (both pins proven RED when neutered, then reverted)

1. **Enqueue pin** — adding a deribit carve-out to the phase35 predicate (`.neq("exchange", "deribit")`) reddens `TestKeyModeEnqueueReachesDeribit::test_phase35_enqueue_includes_eligible_deribit_key` (the in-memory fake actually filters, so the deribit key vanishes from the payload). Reverted.
2. **Handler pin** — sourcing `allocator_id` from the job payload instead of `ctx.key_row["user_id"]` reddens `TestHandlerKeyModeDeribitPath::test_key_mode_deribit_upserts_per_key_dailies` (T-115-16 authoritative-owner guard). Reverted.

## Task Commits
1. **Task 1: characterize the gap (H/E/B)** — `b59ef813` (test)
2. **Task 2: deribit key-mode <-> ccxt key-mode upsert parity** — `8e373c41` (test)

## Verification
- `tests/test_e2_deribit_allocator_dailies.py tests/test_derive_broker_dailies_dualmode.py tests/test_e1_delete_gate.py tests/test_e2_match_score_golden.py tests/test_mtm_single_key.py` → **58 passed** (numpy divide-by-zero warnings are pre-existing in unrelated tests).
- Diff grep-gate (T-115-17): this plan's changes touch ONLY the two test files — `equity_reconstruction.py` / `allocator_equity_snapshots` / `compute_twr` are untouched. `test_e1_delete_gate.py` green.
- ccxt dualmode + strategy-mode assertions byte-unchanged (no `job_worker.py` edit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test correctness] Over-specified scrub assertion in the fail-loud test**
- **Found during:** Task 1 (structural-refusal test)
- **Issue:** the initial assertion expected a raw numeric `amount=12345` to be scrubbed from the surfaced error. `services.redact.scrub_freeform_string` only redacts denylisted SECRET key=value patterns (`secret=`, `key=`, …), not numeric amounts — account-size scrubbing is the RESPONSIBILITY OF THE CORE (its errors already carry codes/counts/ratios only).
- **Fix:** the test now injects a denylisted `secret=hunter2` token into the `NavReconstructionError` and asserts it is scrubbed — proving the worker's scrub pass runs on the disposition (matches the proven `test_derive_broker_dailies_dualmode` approach).
- **Files modified:** `tests/test_e2_deribit_allocator_dailies.py`
- **Verification:** test GREEN after the fix.

### Scope note (not a deviation)
- No `job_worker.py` change and no migration: the root cause is (B), not (H)/(E). The plan's `files_modified` lists `job_worker.py` as conditional ("only if the root cause lands here").

## Known Stubs
None. No placeholder/empty-value stubs introduced; the tests assert real produced payloads.

## User Setup Required / Approval-gated follow-up
- **Operational remediation (approval-gated):** run the one-off key-mode backfill to populate per-key dailies for the existing allocator keys, then let the worker drain:
  `railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"`
  This is idempotency-guarded (pending-job pre-check + `(api_key_id, kind)` in-flight partial unique index) and additive (enqueues jobs the worker processes; the deribit native derive fails loud on a structural refusal, never fabricating rows). Per 115-01 the PROD run is approval-gated; it was NOT run from the executor. Until it runs, an all-deribit allocator still has 0 per-key rows and the Phase-36 blend does not yet render for them — but the derivation path is now PROVEN end-to-end and pinned against regression.
- **Durable gap (recorded, out of this plan's narrow scope):** there is NO recurring/automatic key-mode `derive_broker_dailies` enqueue for allocator keys (only the one-off script). New allocator keys connected going forward will not get per-key dailies without a re-run or a new recurring enqueue (e.g. off the allocator holdings-sync path). Flagged for 115.1 / a follow-up.

## Threat Flags
None new. The threat register (T-115-14/15/16/17) is covered by the fail-loud + scrub + authoritative-owner + grep-gate assertions.

## Self-Check: PASSED
- `tests/test_e2_deribit_allocator_dailies.py` exists on disk (created).
- Both task commits present in git log: `b59ef813` (Task 1), `8e373c41` (Task 2).
- Full suite: 58 passed.
