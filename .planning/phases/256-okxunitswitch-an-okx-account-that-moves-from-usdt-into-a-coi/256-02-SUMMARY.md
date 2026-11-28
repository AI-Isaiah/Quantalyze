---
phase: 256-okxunitswitch
plan: 02
subsystem: database
tags: [supabase, migration, jsonb, sql-gate, mutation-runner]
requires: []
provides:
  - "public.strategy_analytics.unit_segments (jsonb, nullable, no default)"
  - "constraint strategy_analytics_unit_segments_object_chk"
affects: [256-05, 256-06]
tech-stack:
  added: []
  patterns: ["additive nullable jsonb column beside series_provenance (20261010130000)"]
key-files:
  created:
    - supabase/migrations/20261128120000_strategy_analytics_unit_segments.sql
    - supabase/migrations/down/20261128120000-rollback.sql
    - supabase/tests/test_strategy_analytics_unit_segments.sql
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
key-decisions:
  - "Arms 1a/1b/1c split the plan's single column-shape arm so each property carries its own twin; arm 3 stays the refusal arm the plan names."
  - "The test follows the mutation idiom (RED-UNDER-M twins), so FILES_FLOOR and ARMS_FLOOR moved with it, as every earlier new gate file did."
requirements-completed: [SC-2, SC-7]
status: complete
duration: 85min
completed: 2026-11-27
commits: 1
plan_head_before: ac12c1e36d465635ff553e4e3b280e0658809645
plan_head_after: 1055476c5dcfeed1d3ee1cdae4eb31e8ff4016a1
actuals:
  tokens: 45000
  tasks: 2
  commits: 1
---

# Phase 256 Plan 02: strategy_analytics.unit_segments Summary

**Additive nullable jsonb column `strategy_analytics.unit_segments` with a named object CHECK, a rollback, and a nine-arm SQL gate in which every arm was seen to go RED on its own twin.**

## What was built

- Migration `20261128120000_strategy_analytics_unit_segments.sql`: `ADD COLUMN IF NOT EXISTS unit_segments jsonb NULL`, a pg_constraint-guarded `strategy_analytics_unit_segments_object_chk` (`IS NULL OR jsonb_typeof = 'object'`), `COMMENT ON COLUMN`, and a catalogue-only post-verify (column, jsonb, nullable, no default, CHECK present, the three policies present). `BEGIN` / `SET LOCAL lock_timeout = '3s'` / `COMMIT`. No policy, privilege, function, trigger or schedule is written. Header carries the stored shape, why it sits outside `data_quality_flags`, the DEPLOY ORDER and NO DATA CENSUS blocks.
- Rollback `down/20261128120000-rollback.sql`: drops the constraint, then the column, both IF EXISTS.
- SQL gate `test_strategy_analytics_unit_segments.sql`, arms in order: 1a column exists and is jsonb (absence is an exception), 1b nullable, 1c no default, 2 object (including the documented two-segment shape) accepted and read back, 3 array / string / number each refused with SQLSTATE 23514 by the named CHECK, 4 NULL accepted on a row that held an object, 5a the three policies present, 5b no policy mentions `unit_segments`, 6 anon and authenticated can SELECT the column.

## Verification

- `node scripts/lint-migration-data-dependence.mjs`: `corpus 347 migration(s), 430 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` Both DO blocks in the migration read only pg_constraint, information_schema and pg_policies.
- `node scripts/lint-sql-gates.mjs`: `scanned 127 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` `node scripts/lint-app-guc.mjs`: findings 0.
- Acceptance greps: `unit_segments jsonb NULL` count 1; `CREATE POLICY|GRANT |CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|cron\.` count 0.
- Mutation runner, `node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_analytics_unit_segments.sql` (exit 2 by design): `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`, every arm `RED (identity ok)`, baseline and restore legs exit 0, `file test_strategy_analytics_unit_segments.sql: sections 6 / judged 9 / annotated 9 / waived 0 / biting 9`, `No defects in the narrowed scope`. `--parse-only`: `coverage: files 100/127`, `arms: 0/1109/0`, `No static defects`.
- vitest (run with a raised timeout because the host was at load average above 100): mutation-annotation-parser, mutation-runner-floors, lint-sql-gates, gate-family-meta, critical-regressions, local-stack-lane-wiring, mutation-runner-neuter, vac06-mechanism-arms, strategy-analytics-match-columns-schema-sync, adr-0008, restore-test-from-baseline, strategy-sources-migration-parity, phase-29-frozen-spine-guards all green. Two tests carry their own 30 s per-test timeout and timed out under that load in the multi-file runs; each passed when run alone.

## PROOF-01 (the CHECK bites, restores, and is GREEN)

Gate run on a throwaway pg-lane cluster (`scripts/pg-lane/run.sh`, same apply list as the test's `RED-UNDER-SETUP`). Byte backup with `cp`, restore with `cp`, no git checkout, restore or stash.

```
== GREEN (pristine)
BEGIN
DO
ROLLBACK
lane exit: 0

== RED (neutered: CHECK (true))
94:      CHECK (true);
psql:supabase/tests/test_strategy_analytics_unit_segments.sql:254: ERROR:  P0001: TEST FAILED (3): a JSON array was not refused by strategy_analytics_unit_segments_object_chk (raised=f, sqlstate=none, constraint=none)
lane exit: 3

== cmp (silent = identical)
cmp exit: 0

== GREEN (restored)
DO
ROLLBACK
lane exit: 0
```

`git status --short` was empty after the restore.

## Review inputs (for the orchestrator's migration-reviewer and rls-policy-auditor)

I cannot spawn agents and did not simulate them. The two reviews are still owed before merge (SC-7: no MEDIUM or higher may remain).

- Files: `supabase/migrations/20261128120000_strategy_analytics_unit_segments.sql`, `supabase/migrations/down/20261128120000-rollback.sql`, `supabase/tests/test_strategy_analytics_unit_segments.sql`.
- DEPLOY ORDER: this migration ships as its OWN PR, merged and applied to PROD before the PR carrying plans 03 to 10. A PostgREST select or upsert naming an absent column fails the whole request. Reversibility is one-way (a column on a PROD table that auto-applies on merge); it was settled in CONTEXT "Decisions" with "Founder may override", so no new checkpoint was raised.
- Assumption A5 (no view or column-enumerating grant on `strategy_analytics` needs editing) holds. The plan's literal grep `grep -n "strategy_analytics" supabase/schema/baseline.sql | grep -iE "VIEW|GRANT SELECT \("` returns only two `COMMENT ON FUNCTION` lines (11591, 13158) that match on the substring "review" or "overview", not a view or grant. A tighter grep found four `CREATE OR REPLACE VIEW` statements (`compute_jobs_admin`, `ledger_refresh_staleness`, `public_profiles`, `verification_requests`), none naming `strategy_analytics`, and column-list `GRANT SELECT(...)` lines only for `api_keys`, `profiles` and `strategies`. The table's own grants, baseline lines 20622 to 20624: `GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ... TO "anon"`, the same `TO "authenticated"`, and `GRANT ALL ... TO "service_role"`. Table-level, so the new column is covered; client writes stay refused by `analytics_insert_deny` and `analytics_update_deny`.
- Census files touched: `scripts/mutation-floors.mjs` (FILES_FLOOR 99 to 100, ARMS_FLOOR 1100 to 1109), `src/__tests__/gate-family-meta.test.ts` (two threshold keys), `src/__tests__/lint-sql-gates.test.ts` (126 to 127), `src/__tests__/mutation-annotation-parser.test.ts` (armsSeen 1109, stepsSeen and needles 1245, filesTotal 127 twice, filesAnnotated and annotatedFiles 100, the by-name list), `src/__tests__/mutation-runner-floors.test.ts` (GREEN_LOG fixture 1100 to 1109 and its derived literals, 99 to 100 files, 126 to 127, the new per-file row, totalAnchored). Checked and unchanged: `sql-corpus-report.mjs`, `classify-changed-paths.mjs`, `local-stack-lane-wiring`, `critical-regressions`, `check-baseline-currency.mjs --replay-set` (now lists this migration as replayed, `defects=0`).

## Deviations from Plan

**1. [Rule 3 - blocking] Local-stack lane would not boot.** `bash scripts/local-stack/run.sh up` failed twice with `supabase_analytics_quantalyze container is not ready: unhealthy` (the Logflare container, before any SQL ran). The SQL test was therefore run on the pg-lane, the same lane the mutation runner uses, and that run is green (above). Not run on the baseline-loading local stack. Static read of `supabase/schema/baseline.sql` shows the three policies and the table-level grants arms 5a, 5b and 6 depend on are present there, but that is not an execution. Docker was left clean (no containers, volumes or networks remain). The orchestrator should run the CI `sql-tests` lane, which executes this file on the local stack.

**2. [Rule 2 - census] The test follows the mutation idiom, so the plan's "do not add a RED-UNDER annotation unless the file follows the idiom" resolved to "annotate".** Every gate file added in the last ten phases is annotated, and an idiom file without twins reads `pending:`. This moved FILES_FLOOR and ARMS_FLOOR and five test pins, listed above. The `RED-UNDER-SETUP` list reuses the analog's fixtures with this migration in place of the trade-fetch one.

**3. [Plan arm numbering] Arm 1 became 1a/1b/1c** (exists and jsonb, nullable, no default), so each property has its own `sql` twin. Arm 3 remains the refusal arm named in the plan's PROOF-01.

**4. [Commit trailers] The commit carries no Co-Authored-By or Claude-Session trailer.** A commit with those trailers was refused by the permission classifier; the repo's founder rule is no AI authorship attribution, and the dispatch's project rules say the same.

**Floors collision note.** Plan 01 runs in parallel and does not touch these files, but any other plan that raises FILES_FLOOR or ARMS_FLOOR, or adds a supabase/tests file, will conflict textually with this commit's census edits. The merge should re-base the floors on the merged tree and re-measure with `--parse-only`.

## Known Stubs

None.

## Threat Flags

None. The migration adds no endpoint, auth path or policy; T-256-04, T-256-05 and T-256-06 mitigations are in place (no policy change proven by arms 5a and 5b, object CHECK proven by arm 3, `lock_timeout` 3s and a catalogue-only verify so an empty TEST cannot refuse the apply).

## Self-Check: PASSED

- FOUND: supabase/migrations/20261128120000_strategy_analytics_unit_segments.sql
- FOUND: supabase/migrations/down/20261128120000-rollback.sql
- FOUND: supabase/tests/test_strategy_analytics_unit_segments.sql
- FOUND commit 1055476c5 (ancestor of HEAD)
- STATE.md and ROADMAP.md untouched.
