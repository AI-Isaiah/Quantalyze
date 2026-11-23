---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 04
subsystem: database
tags: [postgres, pg_cron, reconcile-sweep, readmit-ceiling, durable-row, security-definer, mutation-runner, vitest]

requires:
  - phase: 146.2
    provides: the reconcile sweep's readmit attempt ceiling (3 orphan markers), unchanged here
provides:
  - table public.reconcile_readmit_exhaustions, one durable row per exhaustion, outliving the 90-day failed-row retention
  - SECURITY DEFINER public.record_reconcile_readmit_exhaustions() RETURNS integer (service_role only), the sweep's candidate predicate with the ceiling inverted
  - SQL gate test_reconcile_readmit_exhaustions.sql (X1, X1/key, X2 to X7, all twinned)
  - vitest pinning the detector predicate to the PROD-captured sweep predicate
affects: [227-09 (the Python reader pages from these rows), 227-10 (census pins, NAME_SET_RATCHET row), 227-11 (validation map)]

actuals:
  tokens: 17900
  tasks: 3
  commits: 3
plan_head_before: 0bb1b4293909e4a12315e5039528ba704695348c
plan_head_after: 0600e8a9445af695fb4fd11bdff2b612112fa974

tech-stack:
  added: []
  patterns:
    - "detector function instead of a sweep edit: a migration never schedules or re-registers a job"
    - "twin layered with a neuter of the migration's own self-verify clause, so the apply does not abort before the gate runs"

key-files:
  created:
    - supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql
    - supabase/migrations/down/20261124120300-rollback.sql
    - supabase/tests/test_reconcile_readmit_exhaustions.sql
    - supabase/schema/functions/record_reconcile_readmit_exhaustions.sql
    - src/__tests__/readmit-exhaustion-predicate-parity.test.ts
  modified: []

key-decisions:
  - "DEC-04-A detector function, sweep command untouched (no schedule or re-registration in any migration)"
  - "DEC-04-C generation_key = newest marker id, UNIQUE (strategy_id, generation_key): one row per exhaustion, a new one when a strategy exhausts again"
  - "The parity vitest compares against the PROD-captured cron manifest, not against an earlier migration (DEC-04-E)"

requirements-completed: [HEAL-03]

duration: 40min
completed: 2026-11-23
status: complete
---

# Phase 227 Plan 04: Reconcile readmit exhaustion, durable row Summary

**A strategy the reconcile sweep stops readmitting at three orphan markers now gets exactly one durable row, written by a SECURITY DEFINER SQL detector that reuses the sweep's own candidate predicate with only the ceiling comparison inverted, and a vitest pins the two predicates together against the PROD-captured manifest.**

## Performance

- **Duration:** about 40 min (20:39 to 21:19 local)
- **Tasks:** 3 of 3 (Task 1 tracer, Task 2 auto/tdd, Task 3 auto/tdd)
- **Files:** 5 created, 0 modified

## Accomplishments

- `public.reconcile_readmit_exhaustions`: `id`, `strategy_id` (FK to strategies, ON DELETE CASCADE), `generation_key` (no foreign key to compute_jobs, so it outlives the 90-day failed-row retention), `marker_count` (named CHECK `>= 3`), `detected_at`, `paged_at`, named `UNIQUE (strategy_id, generation_key)`. RLS on, no FORCE, no policy. service_role holds SELECT and `UPDATE (paged_at)` only.
- `public.record_reconcile_readmit_exhaustions()`: the sweep's WHERE span transcribed from `scripts/prod-prober/cron-manifest.json` with `) < 3` turned into `) >= 3`, `ORDER BY` the sweep's expression, `LIMIT 100`, `ON CONFLICT DO NOTHING`. Returns the number of rows written. EXECUTE for service_role only.
- A catalogue-only self-verify block (no row read, so the data-dependence linter passes), including the owner-exempt-from-row-security check, because compute_jobs carries FORCE ROW LEVEL SECURITY.
- Manual rollback that drops the function, revokes, and renames the table and its constraints aside (rows kept), proved on the pg-lane.
- Gate with arms X1, X1/key, X2 to X7, every arm with a prose RED-UNDER and a RED-UNDER-M twin; the runner scores all eight `RED (identity ok)`.
- Vitest `readmit-exhaustion-predicate-parity.test.ts` (4 tests).
- Nothing registers or re-registers a job; the sweep migration, its TS pins, its pytest pointer and the manifest are byte-untouched (`git diff` over those four paths is empty).

## Task Commits

1. **Task 1 (tracer): table, detector, arm X1 against the real sweep** - `32cbabd15` (feat)
2. **Task 2: X2 to X7, self-verify, rollback** - `a89cc367e` (feat)
3. **Task 3: predicate parity vitest** - `0600e8a94` (test)

## Verification (verbatim)

Task 1 verify, `node scripts/mutation-runner/run.mjs --file supabase/tests/test_reconcile_readmit_exhaustions.sql` (exit 2 expected, the diagnostic mode never exits 0):

```
  arm X1                       exit   3  RED (identity ok)  (2.5s)
  arm X1/key                   exit   3  RED (identity ok)  (2.5s)
arms: 2/2/0   (executed/annotated/waived)
biting: 2
```

Task 2 verify (final tree), linters then the diagnostic:

```
lint-migration-data-dependence: corpus 327 migration(s), 409 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.
lint-sql-gates: scanned 113 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
runner-exit=2
  arm X1 .. X7 and X1/key: exit 3  RED (identity ok)
arms: 8/8/0   (executed/annotated/waived)
biting: 8
```

`node scripts/mutation-runner/run.mjs --parse-only` (corpus-wide): `No static defects. Every prose marker has a twin and every needle still matches.`

Rollback proved on the pg-lane (apply list, then the rollback as the gate): `Rollback 20261124120300: the function is dropped and the table is renamed to reconcile_readmit_exhaustions_rolled_back_20261124 with its rows intact.`

### PROOF-01, gate side (X1)

Procedure: byte backup, edit the working copy, run the real lane, restore from the backup, `cmp -s`, GREEN.

```
cp supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql <scratch>/M.bak
A) edit only:  "    ) >= 3"  ->  "    ) > 3"
   psql:...20261124120300_reconcile_readmit_exhaustions.sql:394: ERROR:  P0001: Migration 20261124120300: the detector body lost its
   inverted ceiling comparison (>= 3), so it no longer selects the strategies the sweep refuses
   (the self-verify aborts the apply, so the gate never runs: this is why every twin layers a neuter of its verify clause)
B) the same edit plus "IF v_body NOT LIKE '%) >= 3%' THEN" -> "IF FALSE AND v_body NOT LIKE ..." (the twin's exact shape)
   psql:supabase/tests/test_reconcile_readmit_exhaustions.sql:444: ERROR:  P0001: TEST FAILED (X1): the sweep refused a strategy
   carrying three orphan markers and the detector wrote 0 durable row(s) for it (it returned 0), expected exactly 1. An exhausted
   strategy stays silent: the sweep gave up on it, nothing records that, and the ...
cp <scratch>/M.bak supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql ; cmp -s  ->  cmp exit=0
GREEN: runner-exit=2 with arm X1 .. X7 RED (identity ok); the baseline and the restore legs of the runner both exit 0
```

The pristine gate on the lane (no mutation) prints `ALL 7 ARMS EXECUTED (X1, X2, X3, X4, X5, X6, X7)` and exits 0.

### PROOF-01, vitest side (Task 3)

All restores were `cp` from a byte backup with `cmp -s` exit 0 afterwards (no git restore or checkout).

```
GREEN (pristine):  Test Files 1 passed, Tests 4 passed (4)
RED  snapshot grace window "interval '1 hour'" -> "interval '2 hours'":
     FAIL ... > the detector's predicate is the sweep's with only the ceiling comparison inverted
     AssertionError: expected 'WHERE s.status <> \'archived\' AND EX...' to be 'WHERE s.status <> \'archived\' AND EX...'   (Tests 1 failed | 3 passed)
RED  snapshot ceiling ") >= 3" -> ") < 3":
     AssertionError: the detector's WHERE span must contain exactly one ") >= 3": expected +0 to be 1
RED  manifest side drifted ("interval '1 hour'" -> "interval '2 hour'" in the sweep job's command):
     FAIL ... > the detector's predicate is the sweep's with only the ceiling comparison inverted   (Tests 1 failed | 3 passed)
RED  start anchor "archived" -> "draft" (an earlier attempt, snapshot only):
     Error: detector snapshot record_reconcile_readmit_exhaustions.sql: cannot locate the span start (WHERE s.status <> 'archived'), so the candidate predicate cannot be compared
GREEN after every byte restore: Test Files 1 passed, Tests 4 passed (4)
```

`npx eslint` and `tsc --noEmit` report nothing for the new test file.

## Environment substitution (recorded)

Docker is not available on this host, so `scripts/local-stack/run.sh up` cannot run here. Every SQL proof above ran on the throwaway PostgreSQL lane (`scripts/pg-lane/run.sh`, through `node scripts/mutation-runner/run.mjs --file ...` and directly with the gate's own RED-UNDER-SETUP list). The local-stack (`sql-tests`) proof of this gate is left to CI, which plan 10 owns.

## Decisions Made

- **Detector function, not a sweep edit (DEC-04-A).** Followed as written: the sweep command is byte-identical and nothing in the migration schedules anything (`grep -c "cron\.schedule\|cron\.unschedule"` prints 0).
- **Once per exhaustion (DEC-04-C).** generation_key is the newest marker's id with no FK; X4 proves a second exhaustion after the oldest marker aged out gets its own row, and X6 proves the rows survive the markers.
- **Parity compares against the manifest (DEC-04-E).** The vitest reads the PROD-captured manifest and the detector snapshot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] X4's twin needed a neuter of X1/key, which is a second identity**
- **Found during:** Task 2 (designing the twins before writing them)
- **Issue:** X1 asserts `generation_key` is the newest marker's id (plan text), and X4's twin orders the newest-marker subquery ascending. Under that mutation X1's key assertion would fire first, so X4 could never be the first failure.
- **Fix:** the key assertion carries its own identity `X1/key` with its own twin (the same ascending edit), and X4's twin carries `"neuter":[{"arm":"X1/key"}]`. The sentinel roster stays the seven arms X1 to X7 (`X1/key` is a sub-identity of X1); the runner counts eight sections, all biting.
- **Files modified:** supabase/tests/test_reconcile_readmit_exhaustions.sql
- **Commit:** 32cbabd15, a89cc367e

**2. [Rule 3 - Blocking] Twins layer a neuter of the self-verify clause that would abort the apply**
- **Found during:** Task 2
- **Issue:** the migration's catalogue-only self-verify (required by Task 2) aborts the apply for X1, X2, X3, X6 and X7's mutations, so the gate would never run and no arm could be first. The plan asks for this ("make each twin also neuter the self-verify clause that catches it").
- **Fix:** each affected twin carries a second `edit` step of the form `IF FALSE AND <clause>`; X7 neuters two clauses (the table-level and the column-level anon check).
- **Commit:** a89cc367e

**3. [Rule 1 - Bug avoided] X3 calls the detector before the sweep**
- **Issue:** the plan's order (sweep first, detector after) makes the `>= 2` twin unbiteable: once the sweep readmits the two-marker strategy it carries a pending job and the detector excludes it for a reason unrelated to the ceiling. The table's own CHECK also turns the loosened comparison into a raw error with no identity.
- **Fix:** the detector runs first, wrapped so a raw error becomes a state the raise names (also used in X2, X4, X5); the sweep readmit assertion follows as the seed-integrity half.
- **Commit:** a89cc367e

**4. [Rule 2 - Missing critical] Seeds use a century-back dailies stamp and explicit marker timestamps**
- **Issue:** the plan seeds dailies "two hours ago". The sweep gate's convention (century back) makes the seeds outrank any foreign candidate under the sweep's own ORDER BY on a shared database; the markers also need distinct `created_at` so "newest marker" is unambiguous (same-transaction rows share `now()`).
- **Fix:** century-back dailies, markers at -3, -2, -1 days. Assertions are scoped to this file's own strategy ids (the detector's return value is only required to be at least 1 in X1).

**5. [Rule 3 - Blocking] The setup list adds the default-privilege fixture**
- **Issue:** without `07-fixture-supabase-default-privileges.sql` the lane's tables and functions carry no default grants, so the migration's REVOKEs revoke nothing and X7 would test a database that never resembled Supabase.
- **Fix:** the list is the sweep gate's plus fixture 07 (just before the migration) plus the migration.

**Total deviations:** 5 (all test-design adjustments inside the plan's own files). **Impact:** none on scope; no file outside the plan's list was touched.

## Known Limits (stated plainly)

- **INT-1 reach.** The detector guards the narrow population the sweep itself can reach: a strategy with dailies, no analytics row, no key and only marker jobs. A worker-started orphan that leaves a computing or failed analytics row drops out of the sweep before the ceiling applies and is not detected. Widening the sweep's analytics conjunct is out of scope (plan 227-04 DEC-04-B and INT-1).
- **Nothing calls the detector yet.** Plan 09's Python reader does. Until it runs, no row is written and nothing pages.
- **`npm run schema:functions:check` is red by construction** (`snapshot-only: record_reconcile_readmit_exhaustions`) until plan 10 adds its `NAME_SET_RATCHET` row; plan 01 and the plan 10 text forbid editing `scripts/dump-sql-functions.ts` here. `npm run schema:functions` itself adds only the new snapshot file. The `baseline-content-drift` and VAC-08 rows for the new objects likewise appear until apply-on-merge and the post-apply re-dump (plan 11 owns the follow-up).
- **Local-stack lane not run** (no Docker); see the substitution note above.
- **Census pins were not edited, and three vitest files read red because of this plan's new gate (measured by running the 32 vitest files that scan `supabase/migrations`; the other 29 pass).** They move once, in plan 10, from a measured run: `mutation-runner-floors.test.ts` (86 of 113 files annotated against `FILES_FLOOR` 85; 918 twins against `ARMS_FLOOR` 910, which is this file's eight), `mutation-annotation-parser.test.ts` (corpus ratio 113 against 112, plus the 918-versus-910 and 1042-versus-1028 twin and needle counts) and `contracts/ci-anti-skip-gate.contract.test.ts` (31 sentinel files against 30, and ci.yml's per-file arm table lacks this file's `ALL 7 ARMS EXECUTED`). Sibling plans add their own deltas to the same counts, which is why plan 10 owns them.

## Issues Encountered

- A shell slip during the vitest RED proof (a failed `sed -i` on macOS skipped the variable assignments, so the backup landed at `/snap.bak` and failed). The snapshot had already been mutated; it was restored by re-running `npm run schema:functions` (deterministic from the committed migration), after which `git status` showed the snapshot unchanged against the committed one. Every later proof used explicit variables, a `cp` backup and `cmp -s`.

## Threat Flags

None. The new surface (one table, one SECURITY DEFINER function) is exactly the plan's threat register: T-227-11 (RLS on, no policy, anon and authenticated hold nothing, X7), T-227-12 (column grant `UPDATE (paged_at)` only, X7), T-227-13 (LIMIT 100, read-only, no row locks).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261124120300_reconcile_readmit_exhaustions.sql, supabase/migrations/down/20261124120300-rollback.sql, supabase/tests/test_reconcile_readmit_exhaustions.sql, supabase/schema/functions/record_reconcile_readmit_exhaustions.sql, src/__tests__/readmit-exhaustion-predicate-parity.test.ts
- FOUND commits: 32cbabd15, a89cc367e, 0600e8a94 (ancestors of HEAD)
- Acceptance criteria re-run: `grep -c "CREATE TABLE public.reconcile_readmit_exhaustions"` = 1, `grep -c "cron\.schedule\|cron\.unschedule"` = 0, snapshot present, `grep -c "TEST FAILED (X"` = 20 (at least 7), rollback present, PROOF-01 transcript above names X1.
- `git diff 0bb1b42..HEAD` over 20260819150000, `reconcile-dropped-enqueue-sweep.test.ts`, `test_main_worker.py` and the cron manifest is empty.
