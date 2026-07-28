---
phase: 135-mt5src-source-lockstep
plan: 02
subsystem: database
tags: [mt5, constraint-widen, boundary-check, migration, source-lockstep, red-guard, typescript, sql]

# Dependency graph
requires:
  - phase: 135-mt5src-source-lockstep
    plan: 01
    provides: "'mt5' registered as a first-class Source across the Python ingestion registry + pydantic key-save Literals + mt5_enabled_server() worker gate"
  - phase: 119-sfox-boundary
    provides: "20260718182056 sfox constraint-widen migration + test_sfox_exchange_boundary.sql RED-guard template (itself cloning the deribit precedent)"
provides:
  - "DB admits 'mt5' at EXACTLY the four parity-pinned exchange CHECKs (api_keys / compute_jobs / strategies.source / strategy_verifications.source); a bogus value still raises 23514 (widened NOT dropped)"
  - "TS single source of truth widened in lockstep: SUPPORTED_EXCHANGES + EXCHANGE_DISPLAY + STRATEGY_SOURCES admit 'mt5'; isMt5EnabledServer() server go-dark gate exported for plan 135-04"
  - "supabase/tests/test_mt5_exchange_boundary.sql — CI-auto-discovered RED guard (admit-mt5 / reject-bogus / NULL-preserved per constraint)"
  - "test_boundary_literals_parity.py TestMt5MigrationWidensEveryKeyBoundaryCheck byte-parity class pinning the migration file"
affects: [135-03, 135-04, 138-mt5ui, 139-mt5golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constraint-widening migration cloning the sfox/deribit precedent verbatim (4 named ADD CONSTRAINTs + self-verify DO blocks + forward-only, no DOWN)"
    - "TS enum widen atomic with the migration in ONE plan (set-equality vitest parity forces atomicity — no red window)"
    - "MT5 seam ships DARK: mt5 IN the key-save allowlist, OUT of every UI-offered / funding surface"

key-files:
  created:
    - "supabase/migrations/20260723172032_mt5_exchange_boundary_checks.sql — 4-constraint widen with self-verify DO blocks"
    - "supabase/tests/test_mt5_exchange_boundary.sql — 4 DO-block RED guard"
  modified:
    - "analytics-service/tests/test_boundary_literals_parity.py — _MT5_BOUNDARY_MIGRATION + TestMt5MigrationWidensEveryKeyBoundaryCheck"
    - "src/lib/closed-sets.ts — SUPPORTED_EXCHANGES + EXCHANGE_DISPLAY + isMt5EnabledServer()"
    - "src/lib/strategy-sources.ts — STRATEGY_SOURCES +'mt5'"
    - "src/lib/closed-sets.test.ts — SUPPORTED_EXCHANGES exact-set pin +'mt5'"
    - "src/components/admin/AdminTabs.tsx — SOURCE_BADGE_LABEL exhaustive Record +'mt5'"

key-decisions:
  - "Migration widens EXACTLY FOUR constraints (135-RESEARCH correction over the ROADMAP/REQUIREMENTS '≥5'): api_keys / compute_jobs [nullable IS NULL OR] / strategies.source / strategy_verifications.source. funding_fees / position_snapshots / verification_requests VIEW are parity-pinned exclusions — documented in the migration header, NOT widened."
  - "Forward-dated timestamp 20260723172032 (> tip 20260720120000) — backdated migrations are CI-blocked by migration-policy.yml."
  - "A5 re-verified at execution: 20260718182056 is still the newest ADD CONSTRAINT for all four (no later re-base), so mt5 re-bases on the sfox defs."
  - "isMt5EnabledServer() is a verbatim clone of isSfoxEnabledServer (MT5_ENABLED strict ==='true', fail-closed). NEXT_PUBLIC_MT5_ENABLED (UI offer) deliberately NOT added — Phase 138."

requirements-completed: []
requirements-partial: [MT5SRC-03]

# Metrics
duration: 18min
completed: 2026-07-23
---

# Phase 135 Plan 02: MT5 constraint-widen migration + TS enum lockstep Summary

**The DB admits 'mt5' at exactly the four parity-pinned exchange CHECK constraints (widened, not dropped — a bogus value still raises 23514), and the TS single source of truth (SUPPORTED_EXCHANGES / EXCHANGE_DISPLAY / STRATEGY_SOURCES) widens in the SAME plan so the set-equality parity suite never goes red in between — with the MCP TEST-apply + reject-before/accept-after verification DEFERRED TO THE ORCHESTRATOR.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2 executed (of the plan's 3; Task 3 MCP-apply deferred — see below)
- **Files:** 7 (2 created, 5 modified)

## Accomplishments

- Landed `20260723172032_mt5_exchange_boundary_checks.sql` — a verbatim clone of the sfox precedent widening EXACTLY FOUR named CHECK constraints to admit `'mt5'`: `api_keys_exchange_check`, `compute_jobs_exchange_check` (nullable `IS NULL OR` form preserved), `strategies_source_check` (10→11 values), `strategy_verifications_source_check`. Each has a self-verify `DO` block that fails loud at apply if the new def is missing any expected value; `funding_fees` / `position_snapshots` / the `verification_requests` VIEW are documented parity-pinned exclusions and are NOT touched (0 widened).
- Created `supabase/tests/test_mt5_exchange_boundary.sql` — four `DO $$` blocks proving (a) `'mt5'` admitted, (b) a bogus value still raises `check_violation` (23514, widened not dropped), and for `compute_jobs` (c) NULL still admitted. Uses `gen_random_uuid()` fixtures + full cleanup and satisfies the two unrelated `compute_jobs` guards (kind-target-coherence, one-inflight-per-kind-strategy). CI auto-discovers `supabase/tests/test_*.sql`.
- Added the `_MT5_BOUNDARY_MIGRATION` path const + `TestMt5MigrationWidensEveryKeyBoundaryCheck` byte-parity class to `test_boundary_literals_parity.py` (mirroring the sfox class), pinning that each of the four `ADD CONSTRAINT`s appears exactly once with `'mt5'` in its CHECK body.
- Widened the TS single source of truth atomically with the migration: `SUPPORTED_EXCHANGES` + `EXCHANGE_DISPLAY` (`mt5: "MT5"`, the `satisfies Record<SupportedExchange,string>` proving the paired edit) in `closed-sets.ts`, `STRATEGY_SOURCES` in `strategy-sources.ts`, plus `isMt5EnabledServer()` exported for plan 135-04. `UI_EXCHANGE_CODES` / `FUNDING_EXCHANGES` untouched — the seam ships dark.

## Task Commits

1. **Task 1: Migration + SQL RED-guard test + Python byte-parity class** — `a631808d` (feat)
2. **Task 2: TS const lockstep (SUPPORTED_EXCHANGES / EXCHANGE_DISPLAY / STRATEGY_SOURCES / isMt5EnabledServer)** — `0c2b2ad8` (feat)

## Verification

- `pytest tests/test_boundary_literals_parity.py -x -q` → 18 passed (includes the new mt5 byte-parity class).
- `npx tsc --noEmit` → clean.
- `npx vitest run check-zod-db-check-parity + strategy-sources-migration-parity + closed-sets + closed-sets.sfox-flag` → 53 passed; `contracts-registry` → 34 passed. `onlyInSql` / `onlyInTs` both empty for every mt5-touched column.
- Migration grep acceptance: `ADD CONSTRAINT` count = 4; `IS NULL OR` count = 3 (≥2); 0 excluded tables widened; filename matches `^[0-9]{14}_mt5_exchange_boundary_checks\.sql$` and `20260723172032 > 20260720120000` (tip).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `AdminTabs.tsx` SOURCE_BADGE_LABEL missing `mt5` → tsc compile error**
- **Found during:** Task 2 (`npx tsc --noEmit` after the `STRATEGY_SOURCES` widen).
- **Issue:** `SOURCE_BADGE_LABEL: Record<StrategySource, string>` is an exhaustive lookup; adding `'mt5'` to `STRATEGY_SOURCES` made the missing `mt5` key a `TS2741` compile error (this is exactly the drift guard the Record was designed to trip — documented in the strategy-sources.ts comment).
- **Fix:** Added `mt5: "mt5"` to the badge map.
- **Files modified:** `src/components/admin/AdminTabs.tsx`
- **Committed in:** `0c2b2ad8` (Task 2 commit).

**2. [Rule 1 - Test pin] `closed-sets.test.ts` SUPPORTED_EXCHANGES exact-set pin**
- **Found during:** Task 2 (pre-emptive — grep-hunt for stale set pins per the plan's action).
- **Issue:** The test asserts `SUPPORTED_EXCHANGES` deep-equals the exact 5-value array; the mt5 widen would red it.
- **Fix:** Updated the pin to include `"mt5"` (kept set-equality — did NOT weaken to containment, per the plan directive).
- **Files modified:** `src/lib/closed-sets.test.ts`
- **Committed in:** `0c2b2ad8` (Task 2 commit).

**Total deviations:** 2 auto-fixed (1 blocking compile fix, 1 test-pin update) — both directly caused by the in-scope enum widen; no scope creep.

## DEFERRED TO ORCHESTRATOR — MCP TEST-apply (plan Task 3)

**MCP TEST-apply + reject-before / accept-after verification is DEFERRED TO THE ORCHESTRATOR.** This executor did NOT MCP-apply the migration to the TEST project (`qmnijlgmdhviwzwfyzlc`). **MT5SRC-03 is NOT marked fully done** — the DB apply is a separate orchestrator step. The orchestrator must:

1. **RED-before proof:** via Supabase MCP `execute_sql` on TEST, attempt an `api_keys` INSERT with `exchange='mt5'` (gen_random_uuid fixture) and assert it FAILS with `check_violation` 23514 (pre-widen CHECK rejects mt5); clean up.
2. **Apply:** `apply_migration` on TEST `qmnijlgmdhviwzwfyzlc` with name matching the file — NEVER MCP-apply to prod `khslejtfbuezsmvmtsdn`.
3. **Fix version drift (Pitfall 5):** MCP `apply_migration` stamps `now()` into `supabase_migrations.schema_migrations` — UPDATE the newest row's version to `20260723172032` so the merge-time CLI sees consistent history.
4. **GREEN-after proof:** execute the full `supabase/tests/test_mt5_exchange_boundary.sql` on TEST (all four DO blocks complete with NOTICEs only).
5. **Audit:** `pg_get_constraintdef` for the four widened constraints each contains `'mt5'` and `compute_jobs` retains `IS NULL OR`; the EXCLUSION audit confirms `funding_fees` + `position_snapshots` defs contain NO `'mt5'`.

**Ship-time (post-merge, orchestrator/`/ship`):** route the migration through the `migration-reviewer` agent before the PR; `supabase/migrations/**` AUTO-APPLIES to PROD on merge to main (`supabase-migrate.yml`) — watch the run and re-verify the constraint defs on prod after merge.

## Known Stubs

None. mt5 is a newly-admitted value; no placeholder data or unwired components introduced. The mt5 CONNECT surface ships intentionally dark behind `isMt5EnabledServer()` (fail-closed until `MT5_ENABLED=true` at Phase 139) — an intentional, documented go-dark gate, not a stub.

## Self-Check: PASSED

- Created files verified present: the migration + `test_mt5_exchange_boundary.sql`.
- Commits verified in `git log`: `a631808d` (Task 1), `0c2b2ad8` (Task 2).
- pytest 18 passed; tsc clean; vitest parity 53 + contracts-registry 34 passed.

---
*Phase: 135-mt5src-source-lockstep*
*Completed: 2026-07-23*
