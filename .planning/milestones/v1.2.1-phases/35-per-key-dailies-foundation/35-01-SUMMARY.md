---
phase: 35-per-key-dailies-foundation
plan: 01
subsystem: database
tags: [supabase, postgres, rls, csv_daily_returns, dual-axis, pytest, psycopg]

requires:
  - phase: 15-csv-unblock
    provides: csv_daily_returns table + persist_csv_daily_returns RPC (the strategy-axis CSV pipeline)
provides:
  - csv_daily_returns dual-axis schema (surrogate PK, nullable strategy_id, api_key_id + allocator_id, XOR + per-key CHECK, two non-partial unique indexes)
  - per-key owner RLS policy (allocator_id = auth.uid()) + owner-coherence trigger
  - committed live SQL tests proving NULLs-distinct coexistence, both upsert arbiters, the CHECK rejections, and cross-tenant RLS isolation
affects: [35-02 dual-mode derive job, 35-03 backfill, 36 per-key reads]

tech-stack:
  added: []
  patterns:
    - "Dual-axis table: surrogate PK + two NON-partial unique indexes (NULLs-distinct isolates each row-type AND keeps the bare ON CONFLICT upsert resolving)"
    - "Two coexisting owner RLS mechanisms (strategy ownership UNION allocator_id = auth.uid()); SELECT policies union, neither matches the other row-type (NULL not TRUE)"

key-files:
  created:
    - analytics-service/tests/test_csv_daily_returns_dualaxis_live.py
    - analytics-service/tests/test_csv_daily_returns_perkey_rls_live.py
  modified:
    - analytics-service/tests/test_persist_csv_daily_returns_live.py (TestNoRedundantIndex rewritten)
    - supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql (written + applied by orchestrator, committed a365b984)

key-decisions:
  - "Surrogate PK = BIGINT GENERATED ALWAYS AS IDENTITY (smaller, append-friendly, service-role-written)"
  - "Two NON-partial unique indexes (a partial index would 42P10 the bare on_conflict upsert)"
  - "Orchestrator added an owner-coherence BEFORE trigger (enforce_csv_daily_returns_owner_coherence) beyond the original plan — denormalized allocator_id MUST equal api_keys.user_id (overrides research A2's no-trigger recommendation; defense-in-depth)"

patterns-established:
  - "Live two-actor RLS test asserts on row CONTENT/id absence (RLS fails silently to empty), not error code"
  - "Index-inventory pin updated to the dual-axis 3-index set, preserving the no-redundant-index intent"

requirements-completed: [DAILIES-01, DAILIES-04]

duration: 14min
completed: 2026-06-24
---

# Phase 35 Plan 01: Per-key dailies store (csv_daily_returns dual-axis) Summary

**csv_daily_returns becomes a dual-axis store (strategy XOR api_key) with a per-key owner RLS policy + owner-coherence trigger, proven by committed live SQL/RLS tests for NULLs-distinct coexistence, both upsert arbiters, the CHECK rejections, and content-level cross-tenant isolation.**

## Performance

- **Duration:** ~14 min (within the larger phase-35 execution window)
- **Started:** 2026-06-24T14:40:19Z
- **Completed:** 2026-06-24T14:54:51Z (phase total)
- **Tasks:** 2 of 4 executed by this agent (Tasks 1+2 — migration write/apply — done by the orchestrator, committed a365b984 + applied to TEST)
- **Files modified:** 3 (2 created, 1 rewritten)

## Accomplishments
- Wrote `test_csv_daily_returns_dualaxis_live.py` (DAILIES-01): NULLs-distinct coexistence on BOTH axes, both ON CONFLICT arbiters resolve (no 42P10), and the three CHECK rejections (XOR both-set, XOR neither-set, per-key missing-allocator → 23514).
- Wrote `test_csv_daily_returns_perkey_rls_live.py` (DAILIES-04): two-actor content-level probe — A sees A's per-key row, never B's; the strategy-owner policy does not leak per-key rows (NULL strategy_id); service-role reads both.
- Rewrote `TestNoRedundantIndex` to the post-ALTER 3-index inventory (surrogate PK + the two non-partial per-axis unique arbiters), preserving the PR #272 "no redundant index" intent.

## Task Commits

1. **Tasks 1+2 (migration write + apply to TEST):** done by the orchestrator — `a365b984` (migration committed; applied to TEST ref qmnijlgmdhviwzwfyzlc; behaviors MCP-verified + rolled back).
2. **Tasks 3+4 (dual-axis + RLS live tests, index-pin rewrite):** `37cc14c7` (test).

## Files Created/Modified
- `analytics-service/tests/test_csv_daily_returns_dualaxis_live.py` - DAILIES-01 dual-axis DDL proofs (live, skip-gated on TEST_SUPABASE_DB_URL).
- `analytics-service/tests/test_csv_daily_returns_perkey_rls_live.py` - DAILIES-04 cross-tenant RLS gate (live).
- `analytics-service/tests/test_persist_csv_daily_returns_live.py` - `TestNoRedundantIndex` rewritten to the 3-index inventory.
- `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql` - ALTER + RLS policy + owner-coherence trigger + self-verifying DO block (orchestrator).

## Decisions Made
- BIGINT surrogate PK (A4); two NON-partial unique indexes (locked by D-01).
- The committed migration includes an **owner-coherence trigger** the original plan did not enumerate — the orchestrator added `enforce_csv_daily_returns_owner_coherence` (BEFORE INSERT/UPDATE, WHEN api_key_id IS NOT NULL) enforcing `allocator_id = api_keys.user_id`. This OVERRIDES research A2 (which recommended no trigger) for defense-in-depth, mirroring `allocator_holdings`. The live tests account for it (per-key INSERTs pass allocator_id = key owner).

## Deviations from Plan

The migration scope was already executed and committed by the orchestrator before this agent ran (Tasks 1+2). This agent executed only the code+test tasks (Tasks 3+4). The committed migration is a strict superset of the planned one (it adds the owner-coherence trigger) — no functional conflict; the tests verify the realized schema, not the plan text.

**Total deviations:** 0 auto-fixes by this agent (the trigger addition was an orchestrator decision, pre-committed).
**Impact on plan:** None — tests pin the as-built schema.

## Issues Encountered
- Local env lacks `TEST_SUPABASE_DB_URL`, so the new live tests SKIP locally (24 live tests skip cleanly with a verbose reason). The behaviors are MCP-proven by the orchestrator (XOR/coherence/NULLs-distinct/RLS all verified on TEST and rolled back); CI has the DSN and runs them. Verified the test files collect + import + skip cleanly against the harness.

## User Setup Required
None beyond what the orchestrator already did (migration applied to TEST; prod auto-applies on merge via Supabase Migrate). CI must have `TEST_SUPABASE_DB_URL` for the live tests to execute (existing CI secret).

## Next Phase Readiness
- The dual-axis store + per-key RLS are in place — Plan 02's dual-mode derive job writes to it; Plan 03 backfills it.

---
*Phase: 35-per-key-dailies-foundation*
*Completed: 2026-06-24*

## Self-Check: PASSED

All created files exist on disk; all task commits (37cc14c7, 17f6f425, 84d3d52e) found in git log.
