---
phase: 19-unified-backbone-conditional-on-day-2-gate-commit
plan: 02
subsystem: database
tags: [postgres, supabase, plpgsql, security-definer, rls, jsonb, cosine-similarity, idempotency, migration]

# Dependency graph
requires:
  - phase: 15-csv-unblock
    provides: strategy_verifications table (migration 093) — wizard_session_id column, status enum, RLS policies
  - phase: 12-priority-queue
    provides: claim_compute_jobs_with_priority 2-arg form (migration 086) — body shape mirrored verbatim into the 3-arg drain extension
  - phase: 04-portfolio-intelligence
    provides: legacy verification_requests table (migration 010) — renamed to _legacy in 107
provides:
  - transition_strategy_verification(UUID, TEXT, JSONB) RPC — single source of truth for strategy_verifications status changes
  - 4 new strategy_verifications columns (transitioned_at, encrypted_credentials, public_token, expires_at) — first-class Pitfall 7 mitigation
  - strategy_verifications.wizard_session_id UNIQUE INDEX — DB-layer wizard double-submit prevention
  - compute_jobs.kind admits 'process_key_long' + 3-arg claim RPC writing unified_backbone_at_claim metadata at claim time
  - feature_flags table seeded with 'process_key_unified_backbone'='off' kill-switch row
  - strategies.fingerprint JSONB + partial index + version=1 CHECK + compute_similarity(JSONB,JSONB) NUMERIC(5,4) cosine RPC
  - VIEW shim sentinel (106) + production VIEW with INSTEAD OF triggers (107) for the 4-PR sequence
  - 5 paired down-migrations under supabase/migrations/down/
affects: [19-03, 19-04, 19-05, 19-06, 19-07, 19-08, 19-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-flight uniqueness assertions before CREATE UNIQUE INDEX (M-1)"
    - "SAVEPOINT-rolled-back functional smoke tests inside migration DO blocks (C-1/D-1 verification)"
    - "Snapshot-preserving COALESCE on metadata columns for watchdog re-claim safety (D-1)"
    - "Explicit IS NOT NULL guards in JSONB CHECK constraints (M-3 — defense against `NULL = 1` constraint-satisfied trap)"
    - "INSTEAD OF INSERT/UPDATE/DELETE triggers on read-only VIEW shim (C-9)"
    - "Paired down-migration files under supabase/migrations/down/ (C-8)"

key-files:
  created:
    - supabase/migrations/103_strategy_verifications_state_machine.sql
    - supabase/migrations/104_process_key_long_idempotency_drain.sql
    - supabase/migrations/105_strategies_fingerprint_compute_similarity.sql
    - supabase/migrations/106_view_shim_step_a_sentinel.sql
    - supabase/migrations/107_verification_requests_view_shim.sql
    - supabase/migrations/down/103-rollback.sql
    - supabase/migrations/down/104-rollback.sql
    - supabase/migrations/down/105-rollback.sql
    - supabase/migrations/down/106-rollback.sql
    - supabase/migrations/down/107-rollback.sql
    - analytics-service/tests/test_transition_rpc.py
    - analytics-service/tests/test_drain_semantics.py
    - analytics-service/tests/test_compute_similarity_sql.py
  modified: []

key-decisions:
  - "C-1 status filter: enum value is 'pending' per migration 032 L112-120 — using 'queued' would silently break dispatch (zero rows returned)"
  - "C-2 privilege preservation: REVOKE ALL preserved with NO new GRANT to authenticated; service_role bypasses RLS by default, so workers continue working without privilege expansion"
  - "C-3 schedule column: next_attempt_at per migration 032 L123 + 086 L131/L146; run_after does not exist"
  - "D-1 snapshot preservation: COALESCE(metadata->>'unified_backbone_at_claim', live_value) so watchdog reset_stalled re-claim does NOT overwrite the original claim-time snapshot"
  - "M-3 NULL-safe version CHECK: `(fingerprint->>'version') IS NOT NULL AND ::INT = 1` rejects fingerprints missing the version key (the naive form treats `NULL = 1 → NULL` as constraint-satisfied)"
  - "M-1 pre-flight: abort migration 104 if any duplicate wizard_session_id rows exist before applying CREATE UNIQUE INDEX (avoids partial-apply state)"
  - "C-7 backfill: copy historical legacy verification_requests rows into strategy_verifications with synthetic strategy_id (skips orphans); legacy enum mapped (complete→published, failed→draft)"
  - "C-9 INSTEAD OF coverage: 3 triggers (INSERT + UPDATE + DELETE) — not just INSERT — so read-modify callers post-PR-D get a clear error rather than silent UPDATE/DELETE no-op"
  - "M-5 narrow VIEW filter: keep WHERE flow_type='teaser' but pre-flight asserts no non-teaser rows exist; aborts migration if any do (so we widen filter rather than silently 404 the [id]/status route)"
  - "M-6 90-day public_token-gated SELECT policy preserved on verification_requests_legacy after rename (otherwise every pre-Phase-19 public verification URL would 404)"
  - "C-8 paired down-migrations under supabase/migrations/down/ for every forward DDL"
  - "Pitfall 7 first-class columns: public_token TEXT + expires_at TIMESTAMPTZ live on strategy_verifications, NOT JSONB-nested, so the verify-strategy/[id]/status route keeps reading by name and the VIEW maps them as columns"
  - "Pitfall 9 zero pgvector references: compute_similarity is plain plpgsql v0; pgvector explicitly deferred to v2 per UC-C"
  - "M-2 explicit BEGIN/COMMIT around compute_jobs.kind CHECK swap (DROP CONSTRAINT + ADD CONSTRAINT) for clarity"

patterns-established:
  - "Pattern 1 — Pre-flight assertion before destructive DDL: a DO-block uniqueness/coverage check at the top of the migration aborts BEFORE any DDL runs, avoiding partial-apply states (M-1, M-5)"
  - "Pattern 2 — SAVEPOINT-rolled-back functional smoke: seed a row, exercise the new RPC end-to-end, assert outcome, ROLLBACK TO SAVEPOINT — the migration verifies its own behavior in production without leaving residue (C-1/D-1 in migration 104)"
  - "Pattern 3 — COALESCE-preserved metadata snapshots: any column written by both a fast-path and a recovery path uses COALESCE(existing_value, fresh_value) so retries/watchdog re-claims don't clobber the original (D-1)"
  - "Pattern 4 — Defensive JSONB CHECK with explicit NULL guards: the `OR (key IS NOT NULL AND ::CAST = expected)` pattern rejects shape violations the naive `(key)::CAST = expected` would silently admit (M-3)"
  - "Pattern 5 — INSTEAD OF triggers on read-only VIEW for staged migration: the VIEW shim rejects writes loudly while preserving the legacy table in a renamed slot for support / 90-day public-reachability (C-9 + M-6)"

requirements-completed: [BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-07, BACKBONE-08, BACKBONE-09, FINGERPRINT-01, FINGERPRINT-02]

# Metrics
duration: ~50 min
completed: 2026-05-08
---

# Phase 19 Plan 02: Migrations 103-107 Summary

**5 forward migrations + 5 paired rollbacks delivering BACKBONE-03 (transition RPC + Pitfall 7 columns), BACKBONE-08 (wizard UNIQUE INDEX), BACKBONE-09 (process_key_long + drain RPC with snapshot-preserving COALESCE), BACKBONE-05 (feature_flags kill-switch), FINGERPRINT-01/02 (JSONB column + IMMUTABLE PARALLEL SAFE cosine), and BACKBONE-04 VIEW shim (sentinel + INSTEAD OF triggers + 90-day legacy public_token RLS).**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-08T10:23:00Z (approx)
- **Completed:** 2026-05-08T11:13:03Z
- **Tasks:** 7 (6 fully executed; Task 6 schema-push deferred — see Deviations)
- **Files created:** 13 (5 migrations + 5 rollbacks + 3 pytest stubs)
- **Files modified:** 0

## Accomplishments

- **Migration 103** — `transition_strategy_verification` SECURITY DEFINER RPC with hard-coded legal-pair table, FOR UPDATE row lock, restart path (`* → draft` when metadata.errors present), search_path=public,pg_temp hardening (H-B parity with 086). Adds 4 first-class columns mitigating Pitfall 7.
- **Migration 104** — wizard_session_id UNIQUE INDEX (BACKBONE-08), process_key_long admitted, 3-arg claim_compute_jobs_with_priority drain RPC with D-1 snapshot-preserving COALESCE, feature_flags table seeded 'off' (BACKBONE-05). Pre-flight aborts on duplicate wizard_session_id (M-1); SAVEPOINT-rolled-back functional smoke verifies C-1/D-1 inline.
- **Migration 105** — strategies.fingerprint JSONB + partial index + M-3 NULL-safe version CHECK; compute_similarity v0 plain plpgsql cosine returning NUMERIC(5,4), IMMUTABLE PARALLEL SAFE, returns 0.0 on NULL/version-mismatch/shape-mismatch (never errors). Zero pgvector references (Pitfall 9).
- **Migration 106** — sentinel migration documenting BACKBONE-04 step (a) repoint of verify-strategy/route.ts (no schema change; preserves 4-PR audit ordering).
- **Migration 107** — RENAME verification_requests → _legacy + read-only VIEW backed by strategy_verifications WHERE flow_type='teaser'; 3 INSTEAD OF triggers (INSERT+UPDATE+DELETE per C-9); C-7 backfill of historical legacy rows; M-5 pre-flight non-teaser assertion; M-6 90-day public_token-gated RLS policy on legacy table.
- **5 paired down-migrations** (C-8) covering every forward DDL — recovery from a half-applied push is one well-known SQL run.
- **3 pytest stubs** with auto-skip on missing SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_KEY: 5 tests in test_transition_rpc.py (incl. H-14 idempotent draft→draft), 6 tests in test_drain_semantics.py (incl. D-1 reclaim preserve and C-1 status enum), 7 tests in test_compute_similarity_sql.py (incl. M-3 missing-version regression).

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 103 — strategy_verifications state-machine RPC** — `16002a0` (feat)
2. **Task 2: Migration 104 — wizard UNIQUE + process_key_long + drain RPC + feature_flags** — `7e607d0` (feat)
3. **Task 3: Migration 105 — fingerprint JSONB + compute_similarity** — `e3b0126` (feat)
4. **Task 4: Migration 106 — VIEW-shim step (a) sentinel** — `dc634a1` (feat)
5. **Task 5: Migration 107 — VIEW-shim step (d) rename + VIEW + INSTEAD OF triggers** — `d6431c2` (feat)
6. **Task 6: Schema push to test Supabase** — DEFERRED (see Deviations)
7. **Task 7: C-8 paired down-migrations 103-107** — `7f1d718` (feat)

## Files Created/Modified

### Forward migrations
- `supabase/migrations/103_strategy_verifications_state_machine.sql` — transition RPC + 4 columns + partial unique index on public_token + self-verify DO block
- `supabase/migrations/104_process_key_long_idempotency_drain.sql` — wizard UNIQUE + kind CHECK widening + 3-arg claim RPC + feature_flags + M-1 pre-flight + C-1/D-1 SAVEPOINT smoke
- `supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` — JSONB column + M-3 NULL-safe CHECK + partial index + IMMUTABLE PARALLEL SAFE cosine
- `supabase/migrations/106_view_shim_step_a_sentinel.sql` — sentinel-only DO NOTICE
- `supabase/migrations/107_verification_requests_view_shim.sql` — RENAME + C-7 backfill + VIEW + 3× INSTEAD OF triggers + M-5 pre-flight + M-6 RLS policy

### Down-migrations
- `supabase/migrations/down/103-rollback.sql` — drops RPC + index + 4 columns
- `supabase/migrations/down/104-rollback.sql` — drops 3-arg form (preserves 086 2-arg) + UNIQUE INDEX + restores kind CHECK + drops feature_flags
- `supabase/migrations/down/105-rollback.sql` — drops cosine + index + CHECK + column
- `supabase/migrations/down/106-rollback.sql` — no-op for symmetry
- `supabase/migrations/down/107-rollback.sql` — drops triggers + VIEW + helper fn + policies + renames legacy back; documents C-7 asymmetry

### Pytest stubs
- `analytics-service/tests/test_transition_rpc.py` — 5 tests (legal/illegal/metadata-merge/restart/H-14 idempotent draft→draft)
- `analytics-service/tests/test_drain_semantics.py` — 6 tests (UNIQUE/process_key_long/metadata stamp/feature_flags seed/D-1 reclaim/C-1 status enum)
- `analytics-service/tests/test_compute_similarity_sql.py` — 7 tests (identical/orthogonal/null/version-mismatch/v0 CHECK/IMMUTABLE+PARALLEL SAFE flags/M-3 missing-version)

## Decisions Made

All architectural decisions were locked upstream in 19-CONTEXT.md and 19-RESEARCH.md and applied verbatim. The C-1/C-2/C-3/C-7/C-8/C-9, D-1/D-3, and M-1/M-2/M-3/M-4/M-5/M-6 review findings from 19-REVIEWS.md were incorporated into the migration bodies as documented above. No mid-execution architectural pivots required.

## Deviations from Plan

### 1. Task 6 (schema-push) DEFERRED with runbook note

- **Rule applied:** Critical-invariant escape hatch (executor prompt explicitly authorized this: *"If that project is unavailable, mark the task as deferred-with-runbook-note in the SUMMARY rather than failing"*).
- **Found during:** Task 6 — applying migrations to test Supabase project `qmnijlgmdhviwzwfyzlc`.
- **Issue:** As a parallel-worktree executor agent I do not have an MCP-bound Supabase apply_migration call available, and `supabase db push` from within the worktree would require `supabase link --project-ref qmnijlgmdhviwzwfyzlc` which (a) modifies repo-root state shared with the main checkout, (b) creates serialization risk against any sibling waves the orchestrator may also run against the same test project, and (c) the pre-flight assertions in 104/107 must run against the canonical orchestrator-controlled DB state, not against a worktree-local snapshot.
- **Fix (deferred to orchestrator):** The orchestrator owns the post-merge schema-push step. After this PR merges into the phase-19 integration branch, run:
  ```
  supabase link --project-ref qmnijlgmdhviwzwfyzlc
  supabase db push
  ```
  Verify each migration's `RAISE NOTICE 'Migration N: all assertions passed.'` line in the apply log. Per plan: apply 103, 104, 105, 106 in Wave 1; **defer 107** to P5 commit (d) per BACKBONE-04 7-day stability window.
  Post-push assertions (run via `mcp__supabase__execute_sql` or `supabase db psql`):
  - `SELECT count(*) FROM information_schema.columns WHERE table_name='strategy_verifications' AND column_name IN ('transitioned_at','encrypted_credentials','public_token','expires_at')` → 4
  - `SELECT count(*) FROM pg_indexes WHERE indexname='strategy_verifications_wizard_session_id_unique_idx'` → 1
  - `SELECT count(*) FROM information_schema.check_constraints WHERE constraint_name='compute_jobs_kind_check' AND check_clause LIKE '%process_key_long%'` → 1
  - `SELECT value FROM feature_flags WHERE flag_key='process_key_unified_backbone'` → 'off'
  - `SELECT compute_similarity('{"version":1,"trade_size_buckets":[1,0,0,0],"hold_duration_buckets":[1,0,0,0],"asset_class_mix":[1,0,0,0],"instrument_concentration":[1,0,0,0,0,0,0,0,0,0],"temporal_pattern":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb, '{"version":1,"trade_size_buckets":[1,0,0,0],"hold_duration_buckets":[1,0,0,0],"asset_class_mix":[1,0,0,0],"instrument_concentration":[1,0,0,0,0,0,0,0,0,0],"temporal_pattern":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb)` → 1.0000
  - `SELECT compute_similarity(NULL, '{"version":1,...}'::jsonb)` → 0.0
- **Verification:** All 5 forward migrations + 5 down-migrations are syntactically committed; balanced top-level BEGIN/COMMIT; no `run_after` references; `! grep -E 'CREATE EXTENSION (vector|pgvector)'` passes; all acceptance grep gates passed locally.
- **Files modified:** None (deferred task).
- **Committed in:** N/A (deferred).

---

**Total deviations:** 1 deferred (no auto-fixes — all C/D/M findings were applied inline as planned).
**Impact on plan:** Zero scope change. Schema-push is a runbook step the orchestrator owns post-merge to avoid concurrent worktree pushes corrupting test-project state. All migration files are ready to apply in order.

## Critical Invariants Verification

All 10 invariants in the executor prompt were verified before commit:

| # | Invariant | Verification |
|---|-----------|--------------|
| 1 | `WHERE status = 'pending'` (NOT 'queued') | `grep "status = 'pending'" 104` → 2 matches |
| 2 | `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` preserved; NO new GRANT EXECUTE on the 3-arg form | `grep REVOKE` → match; `grep GRANT EXECUTE ON FUNCTION claim_compute_jobs_with_priority` → 0 matches |
| 3 | `next_attempt_at` (NOT `run_after`) | 8× references; only `run_after` mention is in a comment explicitly stating "NEVER run_after (does not exist)" |
| 4 | `COALESCE(metadata->>'unified_backbone_at_claim', new_value)` for D-1 | Inline COALESCE present at the metadata merge in claim RPC |
| 5 | Migration 105 CHECK is `((fingerprint->>'version') IS NOT NULL AND ::INT = 1)` | Both clauses present in CHECK body |
| 6 | Migration 104 M-1 pre-flight DO block aborting on duplicate wizard_session_id | `grep "M-1 ABORT"` → match |
| 7 | Migration 107 includes INSTEAD OF UPDATE and INSTEAD OF DELETE triggers | All 3 triggers present (INSERT + UPDATE + DELETE) + self-verify asserts trigger count = 3 |
| 8 | Migration 107 backfills historical teaser rows (C-7) | `grep "C-7 backfill"` → match; INSERT INTO strategy_verifications loop present |
| 9 | 5 down-migrations under `supabase/migrations/down/{103,104,105,106,107}-rollback.sql` | `ls supabase/migrations/down/10[3-7]-rollback.sql \| wc -l` → 5 |
| 10 | Task 6 deferred-with-runbook-note (test Supabase unreachable from worktree executor) | Documented above under Deviations |

## Issues Encountered

- **Phase 19 plan files were not on the worktree branch.** The worktree was created from base `e9439e5` (before any phase-19 plan files were committed). The plan files exist as untracked files in the main checkout. Resolved by copying the entire `19-unified-backbone-conditional-on-day-2-gate-commit/` directory from the main checkout into the worktree's `.planning/phases/` so I could read the plan and the supporting CONTEXT/RESEARCH/REVIEWS files. The plan files themselves are not committed by this plan — they are an orchestrator-owned artifact.
- **One commenting/grep edge case in 104.** The original D-1 COALESCE block split the call across multiple lines with a comment between, which made the acceptance gate `grep "COALESCE.*metadata.*unified_backbone_at_claim"` fail because grep is line-by-line. Restructured the merge expression to put the COALESCE call on a single line with the `metadata->>'unified_backbone_at_claim'` argument inline. No behavioral change.
- **`RAISE NOTICE` placement.** First draft of 104 had a bare `RAISE NOTICE` outside any DO block; corrected to wrap in `DO $$ BEGIN RAISE NOTICE '...'; END $$;` (PL/pgSQL requires the DO wrapper for procedural statements).

## User Setup Required

None — all changes are SQL migrations + pytest stubs. The pytest stubs auto-skip when `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` are not configured (matching the existing test conftest convention).

## Next Phase Readiness

- **Wave 1 schema substrate complete.** Plans 19-03 through 19-09 can build on:
  - `transition_strategy_verification` RPC for state-machine drives (19-03, 19-04, 19-05)
  - 3-arg `claim_compute_jobs_with_priority` for the worker-snapshot drain pattern (19-06, 19-07)
  - `feature_flags.process_key_unified_backbone` row for the kill-switch cron (19-07)
  - `compute_similarity` for fingerprint-similarity ranking (19-09)
- **Schema-push runbook step queued for the orchestrator** (see Deviations §1).
- **Migration 107 explicitly NOT in the Wave 1 push set** — applies in P5 commit (d) after the 7-day stability window per BACKBONE-04 sequence. The file is ready and committed.
- **No blockers.** All critical invariants verified; all acceptance grep gates passed.

## Self-Check: PASSED

All migration files exist:
- `supabase/migrations/103_strategy_verifications_state_machine.sql` — FOUND
- `supabase/migrations/104_process_key_long_idempotency_drain.sql` — FOUND
- `supabase/migrations/105_strategies_fingerprint_compute_similarity.sql` — FOUND
- `supabase/migrations/106_view_shim_step_a_sentinel.sql` — FOUND
- `supabase/migrations/107_verification_requests_view_shim.sql` — FOUND

All down-migration files exist:
- `supabase/migrations/down/103-rollback.sql` — FOUND
- `supabase/migrations/down/104-rollback.sql` — FOUND
- `supabase/migrations/down/105-rollback.sql` — FOUND
- `supabase/migrations/down/106-rollback.sql` — FOUND
- `supabase/migrations/down/107-rollback.sql` — FOUND

All pytest stubs exist:
- `analytics-service/tests/test_transition_rpc.py` — FOUND (5 tests)
- `analytics-service/tests/test_drain_semantics.py` — FOUND (6 tests)
- `analytics-service/tests/test_compute_similarity_sql.py` — FOUND (7 tests)

All commits present in `git log e9439e5..HEAD`:
- `16002a0` — Task 1 — FOUND
- `7e607d0` — Task 2 — FOUND
- `e3b0126` — Task 3 — FOUND
- `dc634a1` — Task 4 — FOUND
- `d6431c2` — Task 5 — FOUND
- `7f1d718` — Task 7 — FOUND

---
*Phase: 19-unified-backbone-conditional-on-day-2-gate-commit*
*Completed: 2026-05-08*
