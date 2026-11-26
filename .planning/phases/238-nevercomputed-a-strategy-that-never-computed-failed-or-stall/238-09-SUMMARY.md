---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 09
subsystem: database
tags: [migration-gate, local-stack, review, todos, FACT-03]
status: complete
requires: [238-04, 238-05, 238-06, 238-07, 238-08]
provides:
  - "baseline-replay line proving 20261126130000_strategy_analytics_computed_at_nullable.sql is in the lane's replay set (no Docker)"
  - "hand-patched strategy_analytics computed_at types shown equivalent to the generator's convention"
  - "TODOS.md entry 166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT deleted; no live pointer to it remains"
  - "targeted test, typecheck, eslint, hygiene and migration-linter results for everything the phase touched"
affects: []
key-files:
  created: []
  modified:
    - TODOS.md
key-decisions:
  - "Local-stack lane did not run (orchestrator override, no Docker). CI sql-tests (Decision F replay) is the authoritative replay"
  - "No database.types.ts change: the 3 hand-patched lines already match the generator convention, so the census pin (computed_at 20, analytics_computed_at 1) is untouched"
requirements-completed: [FACT-03]
completed: 2026-11-26
commits: 1
plan_head_before: 46bc55e76e12699b57c5359b83bdf1df4df3ef0b
plan_head_after: 17d4af07805d46425cd43ea7f6a10dedb67dea04
actuals:
  tokens: 1200
  tasks: 3
  commits: 1
---

# Phase 238 Plan 09: PR-2 close-out Summary

The migration is in the lane's replay set and its exec proof is green; the closed TODOS entry is deleted; the targeted gate over everything the phase touched is green. The local-stack lane did not boot here, so CI `sql-tests` is the replay that counts.

## Commits

- `17d4af078` chore(238-09): delete the closed TODOS entry for the never-computed computed_at default (Task 3)
- Tasks 1 and 2 changed no file, so they have no commit of their own.

## Task 1: replay and types (tracer)

| Step | Result |
|---|---|
| `node scripts/check-baseline-currency.mjs --replay-set` | `baseline-currency: carried=339 replay=1 marker-sha=match defects=0` then `baseline-replay: 1 migration(s) newer than the dump: 20261126130000_strategy_analytics_computed_at_nullable.sql` |
| `bash scripts/local-stack/run.sh --check-currency` | Safe to run: its function `check_baseline_currency` only calls `scripts/check-baseline-currency.mjs --replay-set` and the header says "no daemon". Same two lines, plus `baseline-replay: excluded 0 reference-data allowlist line(s) naming replayed migrations: (none)`. Exit 0 |
| `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts --maxWorkers=2` | `Test Files 1 passed (1)`, `Tests 17 passed (17)`. Not a skip: the file has no skip gate (its `beforeAll` throws without server binaries) and it ran migration and rollback on a throwaway cluster |
| `run.sh up`, `--assert-local-handoff`, psql over `supabase/tests/*.sql` naming `computed_at`, `down` | **NOT RUN.** Override 2: no Docker. `scripts/local-stack/.stack-env` does not exist. Recorded as not run, never as passed |
| `run.sh --assert-teardown` | **NOT RUN.** It asserts "0 containers", which presumes a Docker daemon and nothing was booted |
| `supabase gen types --local` | **NOT RUN.** Override 4: no CLI, no Docker, no PROD |

CI's `sql-tests` job (private local-stack lane, replays the migration on top of the committed dump, full corpus) is the authoritative replay and is pending the PR.

### Types equivalence (reasoned, not regenerated)

Migration: `ALTER COLUMN computed_at DROP DEFAULT` and `DROP NOT NULL`. The generator maps a nullable column to `T | null` in `Row`, and a nullable or defaulted column to optional in `Insert` and `Update`. The comparable column in the same `strategy_analytics` block is `computing_started_at` (`timestamptz`, nullable, no default, added by `20260802120000_strategy_analytics_stuck_computing_reaper.sql`).

| | Row | Insert | Update |
|---|---|---|---|
| `computed_at` (`src/lib/database.types.ts` lines 2887, 2925, 2963) | `computed_at: string \| null` | `computed_at?: string \| null` | `computed_at?: string \| null` |
| `computing_started_at` (lines 2888, 2926, 2964) | `computing_started_at: string \| null` | `computing_started_at?: string \| null` | `computing_started_at?: string \| null` |

The patch (from plan 238-06, diff `e510ef6c1..HEAD`) is exactly three one-line hunks: `string` to `string | null`, `string` stays optional but gains `| null`, twice. Shapes are identical to the comparable column, so a regeneration would produce no diff on these hunks. `database.types.ts` was not changed in this plan, so `computed-at-reader-census.test.ts` counts (computed_at 20, analytics_computed_at 1) stay as pinned; that test passes (below).

## Task 2: migration-reviewer and rls-policy-auditor

Dispatched by the orchestrator (the executor has no Agent tool); final verdicts in `238-MIGRATION-REVIEW.md`. Final verdicts (0 fix rounds): migration-reviewer: "Verdict: CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW; 5 INFO)." ; rls-policy-auditor: "RLS audit: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW. Leak scopes: []. Verdict: CLEAN (no MEDIUM+)." INFO findings are recorded in `238-MIGRATION-REVIEW.md` only (TODOS rule (a)). The migration and rollback were not edited in this plan. The exec test re-ran green (17 passed, above) and both SQL linters re-ran green (below).

## Task 3: TODOS deletion and the targeted gate

### Deletion

Deleted the whole bullet for `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT` from `TODOS.md` (the bullet line, its `Owned by Phase 238 NEVERCOMPUTED` continuation line and the trailing blank line; 3 lines). `grep -c` of the id in `TODOS.md` is now 0 (was 1 at line 301). Byte backup was taken in the scratchpad before the edit.

Whole-repo grep (`grep -arln`, excluding `node_modules`, `.git`, `.next`) found the id in these files, all lineage and left alone:

- `CHANGELOG.md` (not to be touched; the ship step names the id there)
- `supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql` (migration comment)
- `.planning/REQUIREMENTS.md`, `.planning/research/v1.22/{SUMMARY,ARCHITECTURE,FEATURES,PITFALLS}.md`
- `.planning/milestones/v1.20-phases/166.5-.../166.5-REVIEW-FIX.md` and `166.5-VERIFICATION.md`
- phase 238 docs: `238-05-PLAN.md`, `238-09-PLAN.md`, `238-PATTERNS.md`, `238-RESEARCH.md`, `238-UI-SPEC.md`, `238-CONTEXT.md`

No file under `src/`, `scripts/`, `analytics-service/`, `docs/`, `CLAUDE.md` or `AGENTS.md` cites it, so no test or script needs the entry and no pointer needs fixing. `CLAUDE.md` does not mention it, so no dated correction note was added. A broader substring grep (`COMPUTED-AT-NEVER-COMPUTED`) over those same directories hit only the migration comment and `TODOS.md` (before the edit). The tests that read `TODOS.md` (`baseline-content-drift-allowlist`, `verify-plan-anchors`, `gate-family-meta`, `audit-coverage`, `ci-docs-path-filter.contract`, `lint-migration-data-dependence`) all pass after the deletion.

### Command results

| Command | Result |
|---|---|
| `vitest run` over the 9 test files `git diff --name-only e510ef6c1..HEAD -- 'src/**/*.test.*' 'src/__tests__/*'` returns (`computed-at-reader-census`, `nevercomputed-backfill-sql-exec`, `never-computed-date`, `AdminTabs`, `FactsheetPreview`, `StrategyGrid`, `StrategyTable.stale-analytics`, `SyncBadge.trade-fetch`, `never-computed-stamp`), `--maxWorkers=2` | `Test Files 9 passed (9)`, `Tests 182 passed (182)` |
| `vitest run` over `baseline-content-drift-allowlist`, `verify-plan-anchors`, `gate-family-meta`, `audit-coverage`, `ci-docs-path-filter.contract`, `lint-migration-data-dependence`, `mandate-columns-schema-sync`, `raise-exception-concat-grammar`, `--maxWorkers=2` | `Test Files 8 passed (8)`, `Tests 213 passed \| 1 skipped (214)` |
| `npm run typecheck` | exit 0, no output after the `tsc --noEmit` banner |
| `npx eslint` over every file under `src/` changed in `e510ef6c1..HEAD` (source and tests) | exit 0, no output |
| `npx tsx scripts/check-planning-hygiene.ts` | exit 0: `12482 tracked files scanned`; `ROADMAP-STRUCTURE (rule 6) OK`; `STATE-POSITION (rule 7) OK` |
| `node scripts/lint-migration-data-dependence.mjs --self-test` | `self-test OK (5 refusals, red+green each.)` |
| `node scripts/lint-migration-data-dependence.mjs` | `corpus 340 migration(s), 422 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` |
| `node scripts/lint-sql-gates.mjs --self-test` | `lint-sql-gates self-test OK: 7 rules, red+green each.` |

The 1 skipped test is `mandate-columns-schema-sync.test.ts:119`, `it.skipIf(!HAS_LIVE_DB)(...)`. It is **pre-existing, not introduced by this phase**: `git show origin/main:src/__tests__/mandate-columns-schema-sync.test.ts | grep -nE "skip|todo"` gives the identical line 119, and `git diff origin/main..HEAD` on the file is empty. It skips only when no live database is configured, which is the case here.

No pin or guard was added or changed in this plan, so no new neuter was needed. The deleted TODOS entry has no gate that reads it.

## Deviations from Plan

All are orchestrator overrides, recorded as instructed.

1. **[Override 1] Task 3's full `npm test` and repo-wide `npm run lint` replaced** by targeted `vitest run <files> --maxWorkers=2` over every test file the phase touched or created (plus the `TODOS.md` readers and the two migration-directory readers), `npm run typecheck`, `eslint` on the phase's touched `src` files, `check-planning-hygiene.ts`, and the migration linters. The full suite and full lint did not run. Reason: machine load limit.
2. **[Override 2] Task 1's local-stack lane not booted**: `run.sh up`, `--assert-local-handoff`, the per-file psql runs of the `computed_at` SQL gates, `down` and `--assert-teardown` did not run. The replay-set check, `--check-currency` and the exec test did run. CI `sql-tests` is the authoritative replay.
3. **[Override 3] Task 2's reviewers dispatched by the orchestrator**, not by this executor. Verdicts live in `238-MIGRATION-REVIEW.md`.
4. **[Override 4] `src/lib/database.types.ts` not regenerated**: equivalence was reasoned (above). No change made.
5. **[Override 5] Task 3 deletion**: done; `CLAUDE.md` had no citation, so no correction note was added.
6. **[Override 6] mandate-columns skip checked**: pre-existing.

Plan frontmatter lists `src/lib/database.types.ts`, the migration, the rollback and the exec test under `files_modified`; none changed here, because the plan said they change only on a regeneration diff or a review fix, and neither occurred.

## Pending (post-merge, not a stop)

`<human-check>`: after the PR-2 merge, read the `apply-test` job log of `supabase-migrate.yml` for the merge commit. Expected: the migration applies on TEST with no "must be owner" or permission error (the table owner is `postgres`; whether the migration role may `DISABLE TRIGGER` is provable only there), and the post-verify passes. A refusal rolls back on TEST and blocks PROD. **Status: pending.**

Also pending for the ship step: CHANGELOG must name the deleted TODOS id `166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT`; `.planning/` changes must not reach the ship branch.

## Known Stubs

None.

## Threat Flags

None. No source or SQL changed in this plan.

## Self-Check: PASSED

- `TODOS.md` edit present in `17d4af078` (`git merge-base --is-ancestor 17d4af078 HEAD` exit 0); id count in `TODOS.md` is 0.
- The commit deleted no tracked file (post-commit deletion check empty).
