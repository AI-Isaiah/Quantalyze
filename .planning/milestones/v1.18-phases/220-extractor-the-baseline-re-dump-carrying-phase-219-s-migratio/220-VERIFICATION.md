---
phase: 220-extractor-the-baseline-re-dump-carrying-phase-219-s-migratio
verified: 2026-11-20T00:00:00Z
status: passed
score: 7/7 must-haves verified
verified_at_sha: d7ec9cd414cb204640ce3931dd90a3f33724b4ec
drift_subjects:
  - scripts/local-stack/nonpublic-objects.mjs
  - scripts/local-stack/nonpublic-catalogue.sql
  - src/__tests__/local-stack-lane-wiring.test.ts
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 220: EXTRACTOR Verification Report

**Phase Goal:** The local-stack non-public extractor (`scripts/local-stack/nonpublic-objects.mjs`) accepts an `AFTER UPDATE OF <columns>` trigger on `auth.users`, records its columns and compares them against the catalogue so column drift is a finding, so the baseline re-dump that carries Phase 219's migration `20261119120000` can land without making every lane boot FATAL, and main's `sql-gate-lint` goes green again. Owns `TODOS.md` `[219-EXTRACTOR-UPDATE-OF]`.
**Verified:** 2026-11-20, at HEAD `d7ec9cd414cb204640ce3931dd90a3f33724b4ec`
**Status:** passed
**Re-verification:** No, initial verification

## Out-of-phase dependency (recorded, not a gap)

The goal clause "main's `sql-gate-lint` goes green again" only comes true once the bot re-dump PR #1294 (`automation/baseline-redump`) merges after this phase ships. It is a dependency on a later event outside this phase. The phase's own deliverable is the precondition: the re-dump can land without lane boots going FATAL. This is not scored against the phase.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `--emit` with the re-dump's carried set exits 0, names both auth.users triggers, and writes the `UPDATE OF email` statement's own bytes | VERIFIED | Re-measured. The carried set was rebuilt from `origin/automation/baseline-redump` (325 files, contains `20261119120000_sync_profile_email_from_auth.sql`). `--emit` printed `carried-files=325 auth-triggers=2 (on_auth_user_created<-20260405061912_rls_policies.sql on_auth_user_email_updated<-20261119120000_sync_profile_email_from_auth.sql)`, exit 0. The emitted `nonpublic-auth-triggers.sql` line 6 is `  AFTER UPDATE OF email ON auth.users`. |
| 2 | A declared `UPDATE OF` trigger is OK under `--check` only when the lane's column set equals the declared set (sorted set, after `ident()` folding) | VERIFIED | Code: `foldAuthTriggers` records `columns: [...cols].sort().join(",")`; `parseCatalogue` re-sorts field 7; `check()` compares `got.columns !== d.columns`. Arms: "OK on an exact UPDATE OF column match", "OK ... different order", "OK when the lane lists its UPDATE OF columns unsorted". 74/74 pass. Independent real-PostgreSQL run (below) gave `drift=0 verdict OK`. |
| 3 | Column drift in either direction is DRIFT (exit 1) with a DIFFERS line | VERIFIED | `check()` pushes `DIFFERS  auth.users trigger <name>: update-of columns lane=<x> declared=<y>` (empty set printed `(none)`). Arms cover name vs email, widened, plain-vs-OF, narrowed. Independent real-PostgreSQL run: trigger recreated as a plain `AFTER UPDATE` turned `--check` to `DIFFERS ... lane=(none) declared=email`, `verdict DRIFT`, exit 1. |
| 4 | A 6-field `trigger|` catalogue row is MEASURE_FAIL (exit 2), never read as "no columns" | VERIFIED | `parseCatalogue` trigger branch requires `f.length === 7`; a 6-field row falls through to the unrecognised-line MEASURE_FAIL. Arm "MEASURE_FAIL on a 6-field trigger row, never read as 'no columns'" present and green. |
| 5 | WHEN, REFERENCING and CONSTRAINT triggers stay MEASURE_FAIL | VERIFIED | `CREATE_SHAPE` still has no WHEN, REFERENCING or CONSTRAINT alternative (diff shows only `EVENT` widened). Arms for WHEN, REFERENCING, and CONSTRAINT (even with UPDATE OF) present and green. |
| 6 | On a real lane booted from the re-dump's baseline, the boot passes fidelity (`auth-users-triggers=2/2 verdict OK`); a plain `AFTER UPDATE` there turns `--check` to DRIFT naming the column difference | VERIFIED (partly SUMMARY-sourced) | I did not repeat the Docker lane boot. I re-measured its two halves against real PostgreSQL 16 instead (local cluster, scratch dir, stopped after). The real `nonpublic-catalogue.sql` ran unmodified and emitted `trigger|users|on_auth_user_email_updated|17|O|public.sync_profile_email_from_auth()|email` and `trigger|users|on_auth_user_created|5|O|public.handle_new_user()|` (7 fields, empty 7th for the plain trigger). `--check` against the 219 migration plus the rls_policies migration returned `auth-users-triggers=2/2 drift=0 verdict OK`, exit 0. After recreating the trigger as a plain `AFTER UPDATE`, it returned DRIFT, exit 1. `run.sh` is untouched (`load_nonpublic_objects` and `check_nonpublic_fidelity` only chain the two measured calls). The full `run.sh up` log is the SUMMARY's claim, not mine. |
| 7 | The deliverable is surgical: only the 3 intended source files change | VERIFIED | `git diff --stat e4899ee74..HEAD -- . ':!.planning'` lists exactly `nonpublic-catalogue.sql` (+6), `nonpublic-objects.mjs` (+53/-), `local-stack-lane-wiring.test.ts` (+114/-), 3 files, 160 insertions, 13 deletions. Worktree clean. |

**Score:** 7/7 truths verified, 0 behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/local-stack/nonpublic-objects.mjs` | `CREATE_SHAPE` accepts `UPDATE OF`, fold field `columns`, 7-field parse, `check()` compare | VERIFIED | All four present in the diff. Wired: called by `run.sh` at the `--emit` and `--check` sites. |
| `scripts/local-stack/nonpublic-catalogue.sql` | 7th trigger field from `tgattr` | VERIFIED | `coalesce((SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) FROM unnest(t.tgattr::int2[]) ... JOIN pg_attribute ...), '')`. Still names no trigger or job. Executed on real PostgreSQL, output above. |
| `src/__tests__/local-stack-lane-wiring.test.ts` | UPDATE OF green and red arms in the D-G block | VERIFIED | 14 new or changed `it(` arms in the D-G block, one migrations dir each via `nonpublicGate`, plus four catalogue-SQL pins (SFH-01) and the lane-side re-sort arm (SFH-02). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `nonpublic-catalogue.sql` | `nonpublic-objects.mjs` | 7th `\|` field parsed by `parseCatalogue`, compared in `check()` | WIRED | Real-PG rows fed to `--check` produced OK and DRIFT as expected. |
| `run.sh` | `nonpublic-objects.mjs` | `load_nonpublic_objects` (`--emit`, census `auth-triggers=N` sed) and `check_nonpublic_fidelity` (`--check`) | WIRED | Census line format unchanged (`carried-files=… auth-triggers=2 (…) schedule-calls=…`). `run.sh` unmodified. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Wiring test file | `npx vitest run src/__tests__/local-stack-lane-wiring.test.ts` | Default 5s timeout: 73 passed, 1 failed (see Warning). With `--testTimeout=60000`: 74 passed (74) | PASS (see Warning) |
| `--emit` with re-dump carried set | `node scripts/local-stack/nonpublic-objects.mjs --emit --migrations supabase/migrations --carried <325-file set> --out-dir <scratch>` | exit 0, both triggers named, `AFTER UPDATE OF email ON auth.users` in output | PASS |
| `--emit` with current marker | same, `--carried <current marker, comment lines stripped>` | exit 0, `carried-files=324 auth-triggers=1 (on_auth_user_created<-…)`. The 219 migration is replayed, not carried, so no `UPDATE OF` path today, no regression | PASS |
| Real-PG catalogue, control | psql on a local PostgreSQL 16 cluster, real catalogue SQL, then `--check` | `auth-users-triggers=2/2 drift=0 verdict OK`, exit 0 | PASS |
| Real-PG catalogue, drift | trigger recreated plain `AFTER UPDATE`, then `--check` | `DIFFERS … update-of columns lane=(none) declared=email`, `verdict DRIFT`, exit 1 | PASS |

Note on the current-marker run: the raw marker file begins with comment lines, and `--carried` requires strict basenames, so passing it raw gives `MEASURE_FAIL: carried set line 1 is not a strict migration basename`. That is the module's strictness, not a regression. `run.sh` hands the module a filtered set; I passed the comment-stripped list.

### Probe Execution

No probes declared by the plan. Step 7c: SKIPPED.

### Requirements Coverage

The plan declares `requirements: []` and ROADMAP lists `Requirements: TBD`. No requirement IDs to map. The phase's owned backlog item, `TODOS.md` `[219-EXTRACTOR-UPDATE-OF]`, is satisfied: fix direction implemented (accept `UPDATE OF`, record columns, tgattr in the catalogue row, compare in `check()`, the three other shapes stay refused), and gate present (red and green arms in the D-G block). The entry is still in `TODOS.md` by design: deleting it is the ship PR's job and must be named in that PR's CHANGELOG entry (CLAUDE.md, "TODOS.md holds open work only", rule (b)). Not a phase gap.

### Anti-Patterns Found

None in the 3 modified files: no `TBD`/`FIXME`/`XXX` markers added by the phase's diff, no stubs. Step 7 anti-pattern scan on the diff found nothing blocking.

### Code Review State

`220-REVIEW.md`: 0 critical, 0 high, 2 medium (SFH-01, SFH-02), 1 low, 4 info. Both mediums are recorded FIXED in `18521d1b0` (test-only, pins the catalogue SQL's 7th-field expression and the lane-side re-sort). I confirmed the arms are present in the test file and green. LOW and INFO survivors (LR-01 whitespace inside a quoted column reads as false DRIFT, fail-loud; IN-01 to IN-04) stay in the REVIEW only, per repo rule.

### Human Verification Required

None.

### Warnings (non-blocking)

1. **One existing test times out at the default 5s in this environment.** "run.sh --assert-local-handoff refuses a non-loopback handoff and never echoes it (Phase 164.9.4 D-04)" spawns `run.sh` about ten times; one invocation takes about 1.3s here, so the arm hits vitest's 5000ms limit. It passes with `--testTimeout=60000` (74/74). The arm is not in the phase diff, `run.sh` is unchanged, and the phase touches nothing it exercises, so I treat it as pre-existing slowness. It could also flake in a loaded CI shard; I did not measure it at the phase base. Flagging so the ship step's CI reading does not mistake it for a phase regression.
2. **The Docker lane-boot log is SUMMARY-sourced.** Truth 6's real-PostgreSQL halves were re-measured here as described; the end-to-end `run.sh up` transcript was not repeated.

### Gaps Summary

No gaps. Every must-have resolves to VERIFIED. The extractor folds and compares `UPDATE OF` columns in both directions, the catalogue SQL emits the 7th field correctly on a real PostgreSQL, the refused shapes stay refused, and the change set is the three intended files. The only unmet goal clause, main's `sql-gate-lint` going green, depends on PR #1294 merging after this phase ships, as recorded above.

---

_Verified: 2026-11-20_
_Verifier: Claude (gsd-verifier)_
