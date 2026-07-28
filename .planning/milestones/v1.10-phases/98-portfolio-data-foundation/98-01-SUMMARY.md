---
phase: 98-portfolio-data-foundation
plan: 01
subsystem: database
tags: [postgres, migration, partial-unique-index, concurrency, portfolio_analytics, sql-test, PI-07]

# Dependency graph
requires:
  - phase: 07-portfolio-intelligence (mig 20260407075303)
    provides: portfolio_analytics table + computation_status enum
  - phase: audit-2026-05-07 (mig 20260516170400)
    provides: idx_portfolio_analytics_computing (the non-unique index being replaced)
provides:
  - Partial UNIQUE index portfolio_analytics_one_computing_per_portfolio (DB-atomic cross-process in-flight fence for PI-07)
  - Dedupe-first prod-safe migration replacing idx_portfolio_analytics_computing
  - Wave-0 real-PG concurrency SQL test pinning the 23505 fence behavior
  - Down rollback restoring the prior non-unique lookup index
affects: [portfolio.py in-flight guard, cron.py recompute enqueue, PI-07 application-side follow-up plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dedupe-first single-transaction partial UNIQUE build (lock_timeout + explicit ACCESS EXCLUSIVE) — atomic, zero dedupe->build race window, no CONCURRENTLY INVALID-index failure mode"
    - "Real-PG behavioral SQL test (RAISE EXCEPTION, no pgTAP) with BEGIN...ROLLBACK isolation and seeded-id-scoped counts for the shared test project"

key-files:
  created:
    - supabase/tests/test_portfolio_recompute_inflight_unique.sql
    - supabase/migrations/20260714090000_portfolio_recompute_inflight_unique.sql
    - supabase/migrations/down/20260714090000-rollback.sql
  modified: []

key-decisions:
  - "D-P4 replace-not-coexist: DROP idx_portfolio_analytics_computing, replace with single-column partial UNIQUE (no query orders by computed_at DESC within the computing partition)"
  - "D-P5 atomic single-tx plain build (NOT CONCURRENTLY): lock_timeout=5s + explicit ACCESS EXCLUSIVE, dedupe + DROP + CREATE UNIQUE + verify in one transaction"
  - "Dedupe survivor = greatest computed_at (NULLS LAST) tiebreak greatest id; losers -> failed (valid enum, matches the reaper)"
  - "No new SQL function (index-only, no SECDEF surface)"

patterns-established:
  - "Dedupe UPDATE must textually and executionally precede CREATE UNIQUE INDEX in the same transaction so prod auto-apply cannot abort on live duplicates"

requirements-completed: [PI-07]

# Metrics
duration: ~15min
completed: 2026-07-12
---

# Phase 98 Plan 01: Portfolio Recompute In-Flight UNIQUE Fence Summary

**Partial UNIQUE index `portfolio_analytics_one_computing_per_portfolio (portfolio_id) WHERE computation_status='computing'`, built dedupe-first in one transaction, pinned by a real-PG 23505 concurrency SQL test — the DB-atomic cross-process fence PI-07 named in cron.py:869-871.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-12
- **Tasks:** 2 (Task 1 TDD RED test, Task 2 migration + rollback)
- **Files created:** 3

## Accomplishments
- Wave-0 real-PG concurrency SQL test: Part 1 structural (pg_indexes: exists + UNIQUE + `computing` predicate), Part 2 functional (racing second `computing` INSERT → 23505; `complete` same-portfolio and `computing` other-portfolio negative controls; seeded-id-scoped counts; BEGIN...ROLLBACK on all paths)
- Dedupe-first partial UNIQUE migration in ONE transaction: `lock_timeout=5s` → `LOCK TABLE ... ACCESS EXCLUSIVE` → ranked-CTE dedupe (losers → `failed`) → DROP old index → CREATE UNIQUE → self-verifying DO block → COMMIT
- Down rollback restoring `idx_portfolio_analytics_computing (portfolio_id, computed_at DESC) WHERE computation_status='computing'`

## Task Commits

1. **Task 1: Wave-0 real-PG concurrency SQL test (RED before the index)** — `0a1aa247` (test)
2. **Task 2: Dedupe-first partial UNIQUE index migration + down rollback** — `2eb6adab` (feat)

_Task 1 is the TDD RED gate; Task 2 defines GREEN. No separate GREEN commit — the migration IS the implementation that flips the test._

## Files Created/Modified
- `supabase/tests/test_portfolio_recompute_inflight_unique.sql` — Wave-0 concurrency test (structural index assertion + functional 23505 assertion, per-portfolio + predicate scoping)
- `supabase/migrations/20260714090000_portfolio_recompute_inflight_unique.sql` — dedupe-first partial UNIQUE index migration, self-verifying DO block
- `supabase/migrations/down/20260714090000-rollback.sql` — drop unique index, restore prior non-unique lookup index

## Decisions Made
Followed the planner's locked decisions (D-P4, D-P5, dedupe survivor rule, no-new-function contract) exactly. No independent decisions required.

## RED/GREEN Status (fail-loud)

**The Wave-0 test is CI-GATED, not locally proven.** `TEST_SUPABASE_DB_URL` was NOT set in the executor environment, so RED (index absent pre-migration) and GREEN (23505 post-migration) could NOT be observed locally. Per the plan's fail-loud rule, no RED/GREEN observation is claimed. The runtime gate is the CI `sql-tests` step (ci.yml:663-803) run against the test project after the orchestrator's Supabase-MCP test-project catch-up applies the migration. The test is structurally RED against the current pre-migration schema (the index does not yet exist, so Part 1's DO block will RAISE `PI-07:`-prefixed) — this is by construction, not observed execution.

**Orchestrator handoff:** the executor has no Supabase MCP. Test-project catch-up (applying migration 20260714090000 to the test project so the sql-tests step goes GREEN) is the ORCHESTRATOR's pre-merge step. On merge to main, the migration auto-applies to PROD — the dedupe-first ordering makes that apply safe against pre-existing duplicate `computing` rows.

## Deviations from Plan

None — plan executed exactly as written. No deviation rules triggered; no auth gates.

## Issues Encountered
- The Task-2 verify awk gate (`dedupe line < CREATE UNIQUE INDEX line`) initially failed because the migration header comment contained the literal string "CREATE UNIQUE INDEX" in prose, which the text-order heuristic matched before the real dedupe UPDATE. Reworded the comment to "a unique index build" (no behavioral change); the actual statement order was always correct (dedupe UPDATE line 65 < DDL line 74). Gate green after reword.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- DB fence exists; the PI-07 application-side follow-up (replacing the TOCTOU SELECT-then-INSERT guard in portfolio.py/cron.py with catch-23505 handling) can now rely on the DB raising `unique_violation` on the racing INSERT.
- Blocker/handoff: orchestrator must run test-project MCP catch-up + route through migration-reviewer / rls-policy-auditor before merge (per plan `<verification>`), and confirm the CI sql-tests step goes GREEN.

## Self-Check: PASSED

---
*Phase: 98-portfolio-data-foundation*
*Completed: 2026-07-12*
