---
phase: 220-extractor-the-baseline-re-dump-carrying-phase-219-s-migratio
plan: 01
subsystem: ci
tags: [local-stack, nonpublic-objects, auth.users, triggers, update-of, baseline-redump]
requires: []
provides:
  - "nonpublic-objects.mjs folds AFTER UPDATE OF <columns> triggers on auth.users and compares their column set against the lane catalogue"
affects: [local-stack lane boot (sql-tests, frontend-local-stack, frontend-live-db-lane, python, e2e-seeded), bot re-dump PR #1294]
tech-stack:
  added: []
  patterns: ["7-field trigger catalogue row (tgattr names as the 7th field)", "column set compared sorted on both sides, collation never trusted"]
key-files:
  created: []
  modified:
    - scripts/local-stack/nonpublic-objects.mjs
    - scripts/local-stack/nonpublic-catalogue.sql
    - src/__tests__/local-stack-lane-wiring.test.ts
key-decisions:
  - "UPDATE OF columns are parsed from the original-case event list token by token, never split on comma or OR (a quoted name can carry either)"
  - "A declared column whose folded name contains a comma or pipe is MEASURE_FAIL: the comma-joined catalogue field could not represent it"
  - "The EVENT_ITEM walker consumes IDENT lists greedily, so a column literally named insert is read as a column, not an event"
requirements-completed: []
status: complete
actuals:
  tokens: 14000
  tasks: 3
  commits: 2
plan_head_before: 76620528f5f70a43208f73d51cc1213fa62155fa
plan_head_after: f0da0c017aad233062b6ee96cdff58a49eda760a
duration: 45min
completed: 2026-11-20
---

# Phase 220 Plan 01: UPDATE OF in the non-public extractor Summary

**The local-stack extractor now folds `AFTER UPDATE OF <columns>` triggers on `auth.users` and reports column drift in every direction, proven on a full real lane boot of the re-dump's baseline.**

**Task 3 path taken: the FULL lane boot** (Docker lane, no fallback). `commits: 2` is the two code commits; the SUMMARY commit follows it.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | `05b8b1017` | feat(220-01): the extractor folds UPDATE OF auth.users triggers and compares their columns |
| 2 | `f0da0c017` | test(220-01): UPDATE OF red and refusal arms, each shown RED by a neuter; header docs |
| 3 | (no commit) | real-path proof, evidence below |

## What changed

- `nonpublic-objects.mjs`: `EVENT` accepts `UPDATE OF <IDENT, ...>`; `foldAuthTriggers` walks the original-case event list with `EVENT_ITEM`, passes bare keywords to `tgtypeOf`, and records `columns` (sorted, comma-joined, `""` for none); `parseCatalogue` requires exactly 7 fields on a `trigger|` row and re-sorts field 7 in JS; `check()` pushes `DIFFERS  auth.users trigger <name>: update-of columns lane=<x> declared=<y>` on any inequality, an empty set printed `(none)`. Refusal message and header comments no longer list `UPDATE OF`. WHEN, REFERENCING and CONSTRAINT stay MEASURE_FAIL. Census and verdict line formats unchanged.
- `nonpublic-catalogue.sql`: the trigger row gains the 7th field, `coalesce(string_agg(a.attname::text, ',' ORDER BY a.attname)` over `unnest(t.tgattr::int2[])` joined to `pg_attribute`. It still names no trigger and no job.
- Test file: fixtures moved to 7 fields; 11 new arms in the D-G block (D-G now 19 arms): the UPDATE OF green arm (Task 1) and R1-R4, G2, G3, M1-M4 (Task 2).

## Test results

- `npx vitest run src/__tests__/local-stack-lane-wiring.test.ts`: 73 passed (whole file). `-t "auth.users trigger class"`: 19 passed, 54 skipped.
- eslint on the module and the test file: clean.

## --emit repro on the re-dump's carried set

RED baseline before any code change (HEAD at 76620528f, carried set of 325 files from `origin/automation/baseline-redump`, which lists `20261119120000_sync_profile_email_from_auth.sql`):

```
::error::nonpublic-extract MEASURE_FAIL: 20261119120000_sync_profile_email_from_auth.sql statement 11: a CREATE TRIGGER shape this module does not parse (WHEN, UPDATE OF, REFERENCING and CONSTRAINT are refused)
exit=2
```

After Task 1, exit 0:

```
nonpublic-extract: carried-files=325 auth-triggers=2 (on_auth_user_created<-20260405061912_rls_policies.sql on_auth_user_email_updated<-20261119120000_sync_profile_email_from_auth.sql) schedule-calls=31 unschedule-calls=30 cron-jobs=15 (...) no-op-unschedules=16 never-scheduled=1 (retention_audit_log)
```

`nonpublic-auth-triggers.sql` carries the line `  AFTER UPDATE OF email ON auth.users` verbatim.

## Neuter evidence (Task 2, byte backup, no git checkout/restore/stash)

Each neuter was applied to `nonpublic-objects.mjs`, the D-G block run, the file restored with `cp` from the byte backup and checked with `cmp` (no output means identical; each printed `cmp-X identical`).

| Neuter | Change | Arms RED (by name) | cmp after restore |
|--------|--------|--------------------|-------------------|
| A | the columns comparison in `check()` never pushes (`false &&`) | R1 "DRIFT when the lane's UPDATE OF columns differ ... (name vs email)", R2 "DRIFT when a declared plain AFTER UPDATE has UPDATE OF columns on the lane", R3 "DRIFT when a declared UPDATE OF has no columns on the lane", R4 "DRIFT when the lane's UPDATE OF list is NARROWED" (4 failed, 15 passed) | identical |
| B | trigger branch of `parseCatalogue` also accepts 6 fields (undefined field 7 read as none) | M1 "MEASURE_FAIL on a 6-field trigger row, never read as 'no columns'" (1 failed) | identical |
| C | comma/pipe column refusal disabled | M4 "MEASURE_FAIL on a declared UPDATE OF column whose name carries a comma" (1 failed) | identical |
| D | `(?:\s+REFERENCING\b.*?)?` added before `FOR EACH` in CREATE_SHAPE | M2 "MEASURE_FAIL on a trigger carrying REFERENCING" (1 failed) | identical |
| E | optional `CONSTRAINT\s+` admitted in CREATE_SHAPE | M3 "MEASURE_FAIL on a CONSTRAINT trigger, even one carrying UPDATE OF" (1 failed) | identical |

After the last restore the full file was green (73 passed). Neuter B first used a version that crashed on `undefined.split`; it was reworked so the neuter fails on the arm's assertion, not on a thrown TypeError.

## Real-path proof (Task 3): full lane boot on the re-dump's baseline

Throwaway tree: `git archive HEAD` extracted into the scratchpad, with only `baseline.sql`, `baseline-carried-migrations.txt` and `BASELINE.md` overwritten from `origin/automation/baseline-redump`. Preflight: docker, psql and supabase present; `docker ps --filter 'name=_quantalyze$'` printed nothing (no other lane running). `run.sh --check-currency` printed `baseline-currency: carried=325 replay=0 marker-sha=match defects=0` and `baseline-replay: 0 migration(s) newer than the dump (none)`, so the 219 migration is carried, not replayed.

`run.sh up` exit 0. Key boot-log lines:

```
nonpublic-extract: carried-files=325 auth-triggers=2 (on_auth_user_created<-20260405061912_rls_policies.sql on_auth_user_email_updated<-20261119120000_sync_profile_email_from_auth.sql) schedule-calls=31 ... cron-jobs=15 (...)
[local-stack] nonpublic-load: 2 auth.users trigger(s) applied via the superuser role supabase_admin; 15 cron job(s) registered as the loading role postgres
nonpublic-fidelity: auth-users-triggers=2/2 cron-jobs=15/15 drift=0 verdict OK
[local-stack] ledger: 325 carried migration row(s) written (dump sha256 0558f0948605e883…)
[local-stack] replay complete: 0 migration(s) applied on top of the dump
[local-stack] up complete
```

Forced real drift on that lane (`run.sh --assert-local-handoff` passed first: loopback; DSN derived from the copy's `.stack-env`, never printed). Catalogue read through the superuser DSN before any write, rows produced by the real `nonpublic-catalogue.sql` on PostgreSQL:

```
trigger|users|on_auth_user_created|5|O|public.handle_new_user()|
trigger|users|on_auth_user_email_updated|17|O|public.sync_profile_email_from_auth()|email
```

Control `--check` on it: `nonpublic-fidelity: auth-users-triggers=2/2 cron-jobs=15/15 drift=0 verdict OK`, exit 0.

Then DROP TRIGGER on_auth_user_email_updated and recreate it as plain `AFTER UPDATE` (one `psql -1` call). Re-read rows:

```
trigger|users|on_auth_user_created|5|O|public.handle_new_user()|
trigger|users|on_auth_user_email_updated|17|O|public.sync_profile_email_from_auth()|
```

Drift `--check`, exit 1:

```
nonpublic-drift: DIFFERS  auth.users trigger on_auth_user_email_updated: update-of columns lane=(none) declared=email
nonpublic-fidelity: auth-users-triggers=2/2 cron-jobs=15/15 drift=1 verdict DRIFT
```

Teardown: `run.sh down` ran for the lane this task started (exit 0, `down complete`); afterwards `docker ps --filter 'name=_quantalyze$'` shows 0 containers. `git status --porcelain -- . ':!.planning'` in the phase worktree printed nothing; `git diff --stat e4899ee74 -- . ':!.planning'` lists exactly the three `files_modified`. `run.sh` and `supabase/migrations` are untouched; no re-dump file reached the branch.

## Deviations from Plan

None - plan executed exactly as written. Two tool-handling notes only: the Neuter B variant was adjusted as described above, and the plan's `$TMPDIR` was replaced by the session scratchpad directory throughout.

## Known Stubs

None.

## Threat Flags

None. T-220-01 to T-220-04 are mitigated and pinned (arms M2/M3 under Neuters D/E, R1-R4 under A, M1 under B, M4 under C); T-220-06 held (loopback lane, handoff asserted first, no shared TEST or PROD access).

## Ship-time follow-ups (owned by /gsd-ship, not done here)

- Delete `TODOS.md` `[219-EXTRACTOR-UPDATE-OF]` in the ship PR and name it in the CHANGELOG entry (CLAUDE.md "TODOS.md holds open work only", rule (b)).
- #1294 (the re-dump) can land after this ships; its NAME_SET_RATCHET row for `sync_profile_email_from_auth` stays its own concern.

## Self-Check: PASSED

- FOUND: scripts/local-stack/nonpublic-objects.mjs, scripts/local-stack/nonpublic-catalogue.sql, src/__tests__/local-stack-lane-wiring.test.ts (modified, committed)
- FOUND commits: 05b8b1017, f0da0c017 (both ancestors of HEAD)
