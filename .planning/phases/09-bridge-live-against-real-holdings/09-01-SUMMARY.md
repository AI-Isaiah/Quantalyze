---
phase: "09"
plan: "01"
subsystem: "bridge-schema-foundation"
tags:
  - supabase
  - migrations
  - schema
  - xor-check
  - unique-index
  - holding-branch
  - cron
  - live-db-tests

dependency_graph:
  requires:
    - "08-connection-management-and-notes"
    - "059_bridge_outcomes.sql"
    - "060_compute_bridge_outcome_deltas.sql"
    - "065_match_decisions_original_strategy_notnull.sql"
  provides:
    - "match_decisions.original_holding_ref TEXT (XOR-gated)"
    - "match_decisions_original_xor CHECK constraint"
    - "bridge_outcomes.original_holding_ref TEXT (denormalized via trigger)"
    - "bridge_outcomes_unique_per_strategy_holding UNIQUE index"
    - "match_decisions uniq_match_dec_thumbup/down_per_pair_holding indexes"
    - "match_batches.holding_flags JSONB NOT NULL DEFAULT '[]'"
    - "compute_bridge_outcome_deltas holding branch (migration 073)"
    - "supabase/types.generated.ts (regenerated, 3256 lines)"
  affects:
    - "09-02 analytics engine (holding-branch writes)"
    - "09-03 SSR dashboard (holding_flags reads)"

tech_stack:
  added:
    - "PostgreSQL BEFORE trigger: bridge_outcomes_sync_holding_ref"
    - "PostgreSQL UNIQUE index with COALESCE expression: bridge_outcomes_unique_per_strategy_holding"
    - "PostgreSQL partial UNIQUE indexes with COALESCE: uniq_match_dec_thumbup/down_per_pair_holding"
  patterns:
    - "Denormalized column + sync trigger (Postgres 17 IMMUTABLE constraint workaround)"
    - "XOR CHECK constraint for mutually exclusive nullable FK columns"
    - "COALESCE(col, '') normalization for NULL-inclusive partial UNIQUE indexes"
    - "Self-verifying DO block with NOTICE strings (finding g3 pattern)"

key_files:
  created:
    - "supabase/migrations/072_match_decisions_original_holding_ref.sql"
    - "supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql"
    - "supabase/migrations/074_match_decisions_widen_unique_holding.sql"
    - "supabase/types.generated.ts"
    - "src/__tests__/match-decisions-xor-rls.test.ts"
    - "src/__tests__/bridge-outcome-cron-holding.test.ts"
    - ".planning/phases/09-bridge-live-against-real-holdings/ADR-0023.md"
  modified:
    - "src/__tests__/bridge-outcome-cron.test.ts"

decisions:
  - "Migration 072: DROP NOT NULL on original_strategy_id before adding XOR CHECK (Pitfall 1)"
  - "Denormalized column + BEFORE trigger for bridge_outcomes holding-ref UNIQUE (Postgres 17 IMMUTABLE limitation)"
  - "COALESCE(original_holding_ref, '') in all UNIQUE indexes preserves legacy 1-per-pair guarantee"
  - "Migration 074 authored post-push (never edit post-push migrations): widen match_decisions partial indexes"
  - "Test 2 futureAnchor replaced with recentAnchor (ANCHOR_DATE+10) to satisfy allocated_at_check window"
  - "STRATEGY_LEGACY_NULL_2 added to Tests 3/4 to avoid bridge_outcomes UNIQUE slot collision"

metrics:
  duration: "~90 minutes (continuation agent)"
  completed: "2026-04-21T16:11:48Z"
  tasks_completed: 6
  files_changed: 8
---

# Phase 09 Plan 01: Schema Foundation — SUMMARY

**One-liner:** XOR-gated holding-ref column on match_decisions + denormalized UNIQUE widening on bridge_outcomes + holding branch in compute_bridge_outcome_deltas, proven by 16 live-DB tests.

## Tasks Completed

| # | Task | Commit | Result |
|---|------|--------|--------|
| 1 | Migration 072 authored (XOR CHECK + UNIQUE widening + holding_flags) | e39b81c | Applied to live DB |
| 2 | Migration 073 authored (compute_bridge_outcome_deltas holding branch) | e39b81c | Applied to live DB |
| 3 | ADR-0023 Phase 09 section | e39b81c | Committed |
| 4 | Supabase types regenerated (3256 lines, 6x original_holding_ref, 3x holding_flags) | 6a0bd06 | Committed |
| 5 | XOR regression test (match-decisions-xor-rls.test.ts) — 8/8 live-DB | d0ee1c7 + 2ffb4b5 | Green |
| 6 | Cron holding regression test (bridge-outcome-cron-holding.test.ts) — 4/4 live-DB | d0ee1c7 + 2abc2bf | Green |
| Bonus | Existing bridge-outcome-cron.test.ts strategy regression — 4/4 live-DB | 2abc2bf | Green |

## Live-DB Test Results

```
Test Files  3 passed (3)
Tests       16 passed (16)
Duration    ~46s (parallel execution)
```

| Suite | Tests | Result |
|-------|-------|--------|
| match-decisions-xor-rls.test.ts | 8/8 | PASS |
| bridge-outcome-cron-holding.test.ts | 4/4 | PASS |
| bridge-outcome-cron.test.ts | 4/4 | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration 072 missed widening match_decisions partial UNIQUE indexes**
- **Found during:** Task 5 live-DB run
- **Issue:** `uniq_match_dec_thumbup_per_pair` and `uniq_match_dec_thumbdown_per_pair` (migration 011) blocked two holding-sourced decisions against the same (allocator, strategy) with different holdings. Migration 072 widened bridge_outcomes but not match_decisions.
- **Fix:** Migration 074 — drops both narrow indexes, recreates as `(allocator_id, strategy_id, COALESCE(original_holding_ref, ''))` partial indexes. 3-assertion self-verifying DO block, pushed and verified.
- **Files modified:** `supabase/migrations/074_match_decisions_widen_unique_holding.sql`
- **Commit:** 5a7a152

**2. [Rule 1 - Bug] XOR regression test: bridge_outcomes dedup test used wrong approach**
- **Found during:** Task 5 — test "same (allocator+strategy+holding_ref) second INSERT fails with 23505"
- **Issue:** Test created two match_decisions with identical (allocator, strategy, holding_ref, decision) to prove bridge_outcomes dedup. Migration 074 correctly blocks the second match_decisions insert first.
- **Fix:** Revised to reuse `md1.id` for second bridge_outcomes insert — trigger populates same holding_ref → bridge_outcomes_unique_per_strategy_holding fires.
- **Files modified:** `src/__tests__/match-decisions-xor-rls.test.ts`
- **Commit:** 2ffb4b5

**3. [Rule 1 - Bug] Cron holding test: futureAnchor (2027-01-01) violated allocated_at_check**
- **Found during:** Task 6 live-DB run
- **Issue:** Test 2 used `addDays(ANCHOR_DATE, 365) = "2027-01-01"` which exceeds `CURRENT_DATE`, violating the bridge_outcomes check constraint `allocated_at <= CURRENT_DATE`.
- **Fix:** Replaced with `recentAnchor = addDays(ANCHOR_DATE, 10) = "2026-01-11"` — within window, no forward snapshots in DB.
- **Files modified:** `src/__tests__/bridge-outcome-cron-holding.test.ts`
- **Commit:** 2abc2bf

**4. [Rule 1 - Bug] Cron holding test: Tests 3 and 4 collided on bridge_outcomes UNIQUE slot**
- **Found during:** Task 6 live-DB run (Test 4 failure with 23505)
- **Issue:** Both tests used STRATEGY_LEGACY_NULL; both produce `original_holding_ref=NULL → COALESCE=''` → same unique slot `(allocator, strategy_legacy_null, '')`.
- **Fix:** Added `STRATEGY_LEGACY_NULL_2 = "00000000-0000-0000-0000-000000000732"` for Test 4. Seeded/cleaned in beforeAll/afterAll.
- **Files modified:** `src/__tests__/bridge-outcome-cron-holding.test.ts`
- **Commit:** 2abc2bf

**5. [Rule 1 - Bug] Existing bridge-outcome-cron.test.ts violated migration 072 XOR CHECK**
- **Found during:** Existing regression run
- **Issue:** Test seeded match_decisions with both `original_strategy_id` and `original_holding_ref` absent — violates `(original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL)`.
- **Fix:** Added `original_strategy_id: stratId, original_holding_ref: null` to seed loop.
- **Files modified:** `src/__tests__/bridge-outcome-cron.test.ts`
- **Commit:** 2abc2bf

## Migration Push Verification

All 3 migrations applied to live DB with self-verification assertions passing:

| Migration | NOTICE strings verified |
|-----------|------------------------|
| 072 | `phase09: match_decisions.original_holding_ref XOR CHECK deployed` |
| 072 | `phase09: bridge_outcomes UNIQUE index widened for holding-ref siblings` |
| 072 | `phase09: match_batches.holding_flags JSONB column deployed` |
| 072 | `Migration 072: all 7 self-verification assertions (a-g) passed.` |
| 073 | `phase09: compute_bridge_outcome_deltas holding branch deployed` |
| 073 | `Migration 073: compute_bridge_outcome_deltas holding branch installed` |
| 074 | `phase09: match_decisions UNIQUE indexes widened for holding-ref siblings` |
| 074 | `Migration 074: all 3 self-verification assertions (a-c) passed.` |

## Known Stubs

None. All schema changes are live in Supabase. The holding branch of `compute_bridge_outcome_deltas` is functional and verified end-to-end.

## Threat Flags

None. Migration 074's new indexes are dedup constraints only. The `bridge_outcomes_sync_holding_ref` BEFORE trigger remains SECURITY DEFINER with locked `search_path = public, pg_catalog` (T-09-01-PRIV mitigated in migration 072).

## Self-Check

Key files verified present:
- FOUND: supabase/migrations/072_match_decisions_original_holding_ref.sql
- FOUND: supabase/migrations/073_compute_bridge_outcome_deltas_holding_branch.sql
- FOUND: supabase/migrations/074_match_decisions_widen_unique_holding.sql
- FOUND: supabase/types.generated.ts
- FOUND: src/__tests__/match-decisions-xor-rls.test.ts
- FOUND: src/__tests__/bridge-outcome-cron-holding.test.ts
- FOUND: src/__tests__/bridge-outcome-cron.test.ts
- FOUND: docs/architecture/adr-0023-audit-event-taxonomy.md

Commits verified present: e39b81c, 6a0bd06, d0ee1c7, 5a7a152, 2ffb4b5, 2abc2bf

## Self-Check: PASSED

