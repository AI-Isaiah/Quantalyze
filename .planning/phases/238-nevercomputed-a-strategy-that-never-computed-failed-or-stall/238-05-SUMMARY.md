---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 05
subsystem: database
tags: [migration, strategy_analytics, computed_at, nullable, backfill, rollback, sql-exec, FACT-03]
status: complete
requires: [238-04]
provides:
  - "supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql: DROP DEFAULT, DROP NOT NULL, trigger-aware backfill of never-computed rows to NULL, NEVERCOMPUTED row guard, catalogue verify"
  - "supabase/migrations/down/20261126130000-rollback.sql: manual rollback, epoch fill, DEFAULT now(), NOT NULL, trigger re-enabled"
  - "src/__tests__/nevercomputed-backfill-sql-exec.test.ts: migration and rollback executed on a throwaway cluster over the real table, trigger lines and trigger bodies"
affects: [238-06, 238-08, 238-09]
key-files:
  created:
    - supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql
    - supabase/migrations/down/20261126130000-rollback.sql
    - src/__tests__/nevercomputed-backfill-sql-exec.test.ts
  modified: []
key-decisions:
  - "The backfill predicate is status IN (pending, computing, failed) AND computed_at IS NOT NULL AND cumulative_return IS NULL AND daily_returns and returns_series each NULL, '[]' or '{}'. Status alone would null the 7 honest last-good dates (Neuter J)"
  - "The post-UPDATE guard is the linter-accepted shape (PERFORM 1 FROM ... WHERE <same predicate>; IF FOUND THEN RAISE). The linter reports 0 NEW with no opt-out and no baseline-ledger line"
  - "The rollback fills the epoch, never now(): now() would reintroduce the false computed-just-now date this phase removes; the epoch is the instant the factsheet already treats as never computed"
  - "Test fixture seeds nine rows, not the plan's eight: a ninth (failed, dict-shaped daily_returns only) pins the predicate's rule that any non-empty shape counts as a series"
requirements-completed: [FACT-03]
completed: 2026-11-26
commits: 2
plan_head_before: 1cba72b2067bd86eb414dcb1af35b173d7b6fb3b
plan_head_after: 94fce23abd0824bfcf5e066b40930d0a6a8f0403
actuals:
  tokens: 10300
  tasks: 2
  commits: 2
---

# Phase 238 Plan 05: computed_at nullable, never-computed backfill and rollback Summary

The database half of FACT-03: `strategy_analytics.computed_at` loses its default and NOT NULL, the 11 never-computed PROD rows are backfilled to NULL past the hold trigger, and the real migration text plus a manual epoch-fill rollback are proven on a throwaway PostgreSQL cluster over the real table, trigger lines and trigger bodies.

## What shipped

- **Migration** `20261126130000_strategy_analytics_computed_at_nullable.sql` (the version 238-04 picked), one implicit transaction under `SET LOCAL lock_timeout = '3s'`: STEP 1 `DROP DEFAULT` and `DROP NOT NULL`; STEP 2 `DISABLE TRIGGER` on the hold trigger, one `UPDATE ... SET computed_at = NULL` with the predicate, `ENABLE TRIGGER`; STEP 3 a `DO` block with the `NEVERCOMPUTED` row guard and catalogue-only checks (`attnotnull` false, `atthasdef` false, hold trigger present, `tgenabled = 'O'`, `tgtype` row/before/update). The header states the R-04 reversal, the predicate and why it is not status alone (11 vs 7 on PROD), the caller impact, a paragraph for migration-reviewer on the first `DISABLE TRIGGER` in `supabase/migrations/`, and what it does not fix.
- **Rollback** `down/20261126130000-rollback.sql`: marker-query warning, manual, ledger row left in place; disable the hold trigger, `SET computed_at = TIMESTAMPTZ 'epoch' WHERE computed_at IS NULL`, enable, `SET DEFAULT now()`, `SET NOT NULL`. The header names the epoch and why.
- **Exec test** `nevercomputed-backfill-sql-exec.test.ts`: 17 tests, no skip gate (`beforeAll` throws without server binaries), unlisted in `vitest.node-env.ts` like its two siblings. It cuts the real `CREATE TABLE`, the three real `CREATE OR REPLACE TRIGGER` lines and the three real function bodies; a miss throws naming it.

## Verification

- `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts --maxWorkers=2`: 17 passed (2 static migration arms, 4 vacuity guards, 7 forward-migration arms, 3 rollback arms including a static one, 1 post-migration writes arm).
- `node scripts/lint-migration-data-dependence.mjs --self-test && node scripts/lint-migration-data-dependence.mjs`: `self-test OK (5 refusals, red+green each.)` and `corpus 340 migration(s), 422 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` No opt-out, no ledger line.
- `node scripts/lint-sql-gates.mjs --self-test`: `OK: 7 rules, red+green each.`
- Acceptance: one migration with the suffix; one non-comment `DISABLE TRIGGER` line and one `ENABLE TRIGGER` line; 0 explicit `BEGIN` or `COMMIT`; `supabase/migrations/down` rollback count 82 to 83; the rollback contains `TIMESTAMPTZ 'epoch'` and `which_database`.
- `src/__tests__/raise-exception-concat-grammar.test.ts` and `mandate-columns-schema-sync.test.ts` (both read the migrations directory): 4 passed, 1 skipped (pre-existing skip, not touched by this plan).
- TDD for Task 2: the three rollback arms were written first and went RED on `ENOENT` for the missing rollback file (14 passed, 3 failed), then GREEN (17 passed) once the rollback was written.

## PROOF-01: Neuters I to M (each: byte backup in the scratchpad, neuter, run, RED, `cp` back, `cmp` exit 0, GREEN)

Run command each time: `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts --maxWorkers=2`. Backups were taken with `cp` outside the repo; no `git checkout`, `restore` or `stash` was used. The tree was clean (`git status --short` empty) after each restore.

### Neuter I: delete the `DISABLE TRIGGER` statement from the migration

RED, verbatim (first behavioural arm to fail is "BACKFILL nulls exactly the never-computed rows"; the apply aborts with `NEVERCOMPUTED:`):

```
       × STATIC: one DISABLE and at least one ENABLE of the hold trigger outside comments, and the guard is the linter-accepted shape 7ms
       × BACKFILL nulls exactly the never-computed rows 89ms
       × KEEPS the figure-bearing rows byte-identical 126ms
       × COLUMN SHAPE: computed_at is nullable with no default afterwards 120ms
       × TRIGGER re-enabled: the hold trigger is 'O' after the migration, and so are the other two 156ms
       × IDEMPOTENT: applying the migration a second time changes no row 98ms
       × FAILS LOUD without the bypass: with the DISABLE statement removed the apply aborts with NEVERCOMPUTED and rolls everything back 79ms
       × FAILS LOUD on a left-disabled trigger: with the ENABLE statement removed the catalogue check raises and the trigger is not left off 125ms
       × ROLLBACK fills the epoch and restores NOT NULL 91ms
       × ROLLBACK without the bypass fails: with the DISABLE statement removed the NULLs survive and SET NOT NULL refuses 94ms
       × POST-MIGRATION writes: a first-ever INSERT with no date stores NULL, failed and computing keep a NULL date NULL, complete stamps it 88ms
AssertionError: stderr=psql:<stdin>:190: ERROR:  NEVERCOMPUTED: a never-completed row with no stored figures still carries a date (the hold trigger was not bypassed)
```

Restore: `cp` back, `cmp exit 0`. GREEN: `Tests  17 passed (17)`.

The "FAILS LOUD without the bypass" arm is red here only because its own neutering step finds nothing left to remove (it asserts the replacement changed the text); the arm itself passes on the real file.

### Neuter J: reduce the UPDATE predicate to status alone (the guard keeps the full predicate)

RED, verbatim:

```
       × KEEPS the figure-bearing rows byte-identical 136ms
       × ROLLBACK fills the epoch and restores NOT NULL 185ms
AssertionError: row 4 (failed WITH headline and series (honest last-good date)) must be byte-identical: expected 'b8d5b08fae88e24da360fc01391d4275' to be 'd53a5005cb8552b1aa2c4f83694661d0' // Object.is equality
AssertionError: row 4 must be byte-identical: expected 'f798b1b7398faaca8a42903647d1f6fa' to be 'b8d5b08fae88e24da360fc01391d4275' // Object.is equality
      Tests  2 failed | 15 passed (17)
```

Restore: `cp` back, `cmp exit 0`. GREEN: `Tests  17 passed (17)`. The honest last-good date on the failed row with figures is what this arm protects; "BACKFILL nulls exactly the never-computed rows" stays green because the never-computed rows are still nulled, which is why the byte-identity arm is the one that bites.

### Neuter K: delete the `ENABLE TRIGGER` statement

RED, verbatim (the migration's own catalogue check raises, so every arm that applies it fails, "TRIGGER re-enabled" among them):

```
       × STATIC: one DISABLE and at least one ENABLE of the hold trigger outside comments, and the guard is the linter-accepted shape 4ms
       × BACKFILL nulls exactly the never-computed rows 104ms
       × KEEPS the figure-bearing rows byte-identical 103ms
       × COLUMN SHAPE: computed_at is nullable with no default afterwards 105ms
       × TRIGGER re-enabled: the hold trigger is 'O' after the migration, and so are the other two 94ms
       × IDEMPOTENT: applying the migration a second time changes no row 90ms
       × FAILS LOUD on a left-disabled trigger: with the ENABLE statement removed the catalogue check raises and the trigger is not left off 83ms
       × ROLLBACK fills the epoch and restores NOT NULL 92ms
       × ROLLBACK without the bypass fails: with the DISABLE statement removed the NULLs survive and SET NOT NULL refuses 90ms
       × POST-MIGRATION writes: a first-ever INSERT with no date stores NULL, failed and computing keep a NULL date NULL, complete stamps it 93ms
AssertionError: stderr=psql:<stdin>:190: ERROR:  Migration 20261126130000 failed: the hold trigger is not enabled (tgenabled=D)
```

Restore: `cp` back, `cmp exit 0`. GREEN: `Tests  17 passed (17)`.

### Neuter L: delete `ALTER COLUMN computed_at DROP DEFAULT`

RED, verbatim (the migration's own column-shape check raises before any arm can read a dated INSERT):

```
       × BACKFILL nulls exactly the never-computed rows 103ms
       × KEEPS the figure-bearing rows byte-identical 109ms
       × COLUMN SHAPE: computed_at is nullable with no default afterwards 107ms
       × TRIGGER re-enabled: the hold trigger is 'O' after the migration, and so are the other two 94ms
       × IDEMPOTENT: applying the migration a second time changes no row 85ms
       × FAILS LOUD on a left-disabled trigger: with the ENABLE statement removed the catalogue check raises and the trigger is not left off 98ms
       × ROLLBACK fills the epoch and restores NOT NULL 98ms
       × ROLLBACK without the bypass fails: with the DISABLE statement removed the NULLs survive and SET NOT NULL refuses 93ms
       × POST-MIGRATION writes: a first-ever INSERT with no date stores NULL, failed and computing keep a NULL date NULL, complete stamps it 92ms
AssertionError: stderr=psql:<stdin>:191: ERROR:  Migration 20261126130000 failed: strategy_analytics.computed_at still has a default (a first-ever row would read as computed at its insert time)
```

Restore: `cp` back, `cmp exit 0`. GREEN: `Tests  17 passed (17)`.

### Neuter M: change the rollback fill from `TIMESTAMPTZ 'epoch'` to `now()`

RED, verbatim:

```
       × STATIC ROLLBACK: names the epoch and the marker query, carries no explicit transaction, and sets a lock timeout 6ms
       × ROLLBACK fills the epoch and restores NOT NULL 169ms
AssertionError: expected '\nSET LOCAL lock_timeout = \'3s\';\n\…' not to match /SET\s+computed_at\s*=\s*now\(\)/i
AssertionError: row 1 (failed, no figures) must read the epoch: expected '2026-11-26 07:11:11.639418+00' to be '1970-01-01 00:00:00+00' // Object.is equality
      Tests  2 failed | 15 passed (17)
```

Restore: `cp` back, `cmp exit 0`. GREEN (after all five restores): `Tests  17 passed (17)`.

## Deviations from Plan

### Auto-fixed Issues

None needing a code fix. Two small departures, both additive:

**1. [Rule 2 - coverage] A ninth seed row.** The plan listed eight rows. A ninth (failed, no headline, no series, a non-empty dict-shaped `daily_returns`) was added because the predicate's contract is that any non-empty `daily_returns` shape counts as a stored series; without it that rule had no row to bite on. It is a decoy that must stay byte-identical.
- **Files modified:** `src/__tests__/nevercomputed-backfill-sql-exec.test.ts`
- **Commit:** 0e5c3ac0e

**2. [Plan-ordering note] Neuter I's collateral reds.** The plan expected "BACKFILL nulls exactly the never-computed rows" to fail first. It does, but every arm that applies the migration also fails with the same `NEVERCOMPUTED:` abort, and the arm that neuters the migration itself fails on its own vacuity assertion. Recorded above; not a defect.

None of the three open items below is a plan deviation.

## Decisions Made

See `key-decisions` in the frontmatter.

## Known open items for later plans (not stubs)

- RESEARCH A3 stays unproven locally: whether the managed migration role may `DISABLE TRIGGER` (needs table ownership; PROD owner is `postgres`). Only the TEST `apply-test` log of the merge proves it; a refusal rolls back on TEST and blocks PROD (safe, a retry). Manual check in 238-09.
- `src/lib/database.types.ts` (`computed_at: string` to `string | null` in `Row`, `Insert` and `Update` of `strategy_analytics`) and every reader's NULL arm are 238-06 and 238-08, in the same PR as this migration; the migration header says so.
- `supabase/schema/baseline.sql`, `baseline-carried-migrations.txt` and `BASELINE.md` are deliberately not edited: the bot re-dump PR after the PROD apply owns them; the lanes replay this migration meanwhile (Decision F). 238-09 runs the replay lane.
- Nothing here edited STATE.md, ROADMAP.md or `.planning/state.json` (the orchestrator owns them).

## Threat Flags

None. No policy, grant, function or endpoint changed (T-238-13); the only privileged act is the in-transaction `DISABLE TRIGGER`, covered by T-238-10, T-238-11 and T-238-12 and proven by Neuters I to K.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql
- FOUND: supabase/migrations/down/20261126130000-rollback.sql
- FOUND: src/__tests__/nevercomputed-backfill-sql-exec.test.ts
- FOUND commit 0e5c3ac0e (Task 1), commit 94fce23ab (Task 2)
