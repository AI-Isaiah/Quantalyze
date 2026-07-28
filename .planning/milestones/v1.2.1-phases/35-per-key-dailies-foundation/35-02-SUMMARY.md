---
phase: 35-per-key-dailies-foundation
plan: 02
subsystem: api
tags: [python, fastapi, job-worker, compute-jobs, derive-broker-dailies, supabase, pytest]

requires:
  - phase: 35-per-key-dailies-foundation
    provides: csv_daily_returns dual-axis schema + (api_key_id, date) unique arbiter (Plan 01)
provides:
  - dual-mode run_derive_broker_dailies_job (branches on api_key_id vs strategy_id)
  - key-mode per-key upsert (allocator_id from key_row.user_id, on_conflict=api_key_id,date, no CSV enqueue, no strategy_analytics stamp)
  - derive_broker_dailies as a dual-target compute job kind (api_key arm on compute_jobs_kind_target_coherence)
affects: [35-03 backfill enqueues this job, 36 per-key reads]

tech-stack:
  added: []
  patterns:
    - "Dual-mode worker handler via preflight selection (_allocator_key_preflight vs _exchange_preflight) on the job's identity axis"
    - "Service-role write reads allocator_id from the authoritative api_keys.user_id (ctx.key_row), never from the job payload"

key-files:
  created:
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  modified:
    - analytics-service/services/job_worker.py (run_derive_broker_dailies_job dual-mode branch)
    - supabase/migrations/20260624120100_derive_broker_dailies_api_key_coherence.sql (written + applied by orchestrator, committed a365b984)

key-decisions:
  - "funding_label (the fetch_funding_* second arg) is api_key_id in key-mode — it is a label/log/match-key only, never scopes the exchange call"
  - "Key-mode <2-day branch logs + returns DONE without touching strategy_analytics (no per-key analytics row exists; per-key reads are Phase 36)"
  - "Strategy-mode path kept byte-unchanged (same preflight, conflict target, <2-day failed stamp, compute_analytics_from_csv enqueue)"

patterns-established:
  - "Per-mode upsert payload + on_conflict selection inside one shared handler body"
  - "Mutation-falsifiable unit assertions (each fails if the branch is neutered)"

requirements-completed: [DAILIES-02]

duration: ~6min
completed: 2026-06-24
---

# Phase 35 Plan 02: Dual-mode derive_broker_dailies Summary

**run_derive_broker_dailies_job now branches on the job's identity axis — an api_key_id payload derives realized+funding dailies and upserts them keyed by (api_key_id, date) with the authoritative allocator_id, skipping both strategy-keyed side-effects; the strategy path is byte-unchanged.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-24T14:40:19Z (phase window)
- **Completed:** 2026-06-24T14:54:51Z (phase total)
- **Tasks:** 1 of 2 executed by this agent (Task 1 — coherence migration — done by the orchestrator, committed a365b984 + applied to TEST)
- **Files modified:** 2 (1 created, 1 modified source)

## Accomplishments
- Generalized `run_derive_broker_dailies_job` to dual-mode: `is_key_mode = bool(job.get("api_key_id"))` selects `_allocator_key_preflight` (no strategy hop) vs `_exchange_preflight`. Key-mode upserts `{api_key_id, allocator_id=key_row.user_id, strategy_id:None}` on `on_conflict="api_key_id,date"`, gating BOTH the `compute_analytics_from_csv` enqueue and the `strategy_analytics` insufficient-history stamp behind `if not is_key_mode`.
- `allocator_id` is sourced ONLY from `ctx.key_row["user_id"]` (authoritative) — never from the job payload (the owner-coherence trigger enforces this at write time; the unit test asserts it).
- Added `test_derive_broker_dailies_dualmode.py` (5 tests): key-mode payload/conflict-target/allocator-wiring + no-CSV-enqueue + <2-day no-stamp; strategy-mode non-regression (conflict target + CSV enqueue still fire) + <2-day failed stamp.

## Task Commits

1. **Task 1 (coherence api_key arm migration):** done by the orchestrator — `a365b984` (migration `20260624120100`, applied to TEST; api_key + strategy arms both present, DO-block clean).
2. **Task 2 (dual-mode handler + unit test):** `17f6f425` (feat).

## Files Created/Modified
- `analytics-service/services/job_worker.py` - dual-mode `run_derive_broker_dailies_job`.
- `analytics-service/tests/test_derive_broker_dailies_dualmode.py` - DAILIES-02 unit proofs.
- `supabase/migrations/20260624120100_derive_broker_dailies_api_key_coherence.sql` - dual-target coherence (orchestrator).

## Decisions Made
- Strategy path byte-unchanged; key-mode skips both strategy-keyed side-effects (Pitfall 4 avoided).
- `funding_label = api_key_id` in key-mode (label only).
- mypy --strict on `job_worker.py` is clean against the CI-pinned venv (supabase 2.15.1 / postgrest 1.0.2, Python 3.12) — the 2 local `APIResponse[Any]` errors are pre-existing venv drift (B-mypy memory), not in my edit region.

## Deviations from Plan
None by this agent for the handler/test. Task 1 (the coherence migration) was pre-executed and committed by the orchestrator; the as-built coherence constraint matches the planned api_key arm + preserves all prior arms (verified by reading the committed migration).

**Total deviations:** 0.
**Impact on plan:** None.

## Issues Encountered
- B-mypy local-venv-drift: the repo `.venv` is Python 3.14 with supabase 2.28.3 (non-generic `APIResponse`), producing 2 false errors at pre-existing lines 516/522. Resolved by building a CI-pinned `uv venv --python 3.12` from `requirements.txt` and confirming `mypy --strict --follow-imports=silent services/ routers/ models/` → "Success: no issues found in 68 source files."

## User Setup Required
None. The coherence migration is applied to TEST (orchestrator); prod auto-applies on merge.

## Next Phase Readiness
- A per-key derive job is now runnable; Plan 03's backfill fans it out across the active key population.

---
*Phase: 35-per-key-dailies-foundation*
*Completed: 2026-06-24*

## Self-Check: PASSED

All created files exist on disk; all task commits (37cc14c7, 17f6f425, 84d3d52e) found in git log.
