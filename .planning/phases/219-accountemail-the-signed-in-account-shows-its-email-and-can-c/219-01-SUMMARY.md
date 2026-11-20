---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 01
subsystem: database
tags: [postgres, supabase-auth, trigger, security-definer, rls, sql-gate, mutation-runner]

requires:
  - phase: 164.x SQL gate corpus
    provides: pg-lane, mutation runner, RED-UNDER-M annotation grammar, local-stack replay lane
provides:
  - public.sync_profile_email_from_auth() SECURITY DEFINER trigger function (EXECUTE revoked from PUBLIC, anon, authenticated)
  - on_auth_user_email_updated trigger, limited to the email column of auth.users
  - REVOKE UPDATE (email) ON public.profiles FROM authenticated (D-07, writer proof met)
  - down/ rollback for the migration
  - supabase/tests/test_profiles_email_sync.sql, ten twinned arms, every arm mutation-proven
affects: [219-02 account email UI, 219-03 census pins and TODOS entry, ship step (migration-reviewer, rls-policy-auditor)]

actuals:
  tokens: 9400
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A1 proof by temp-table trigger: fire a SECURITY DEFINER trigger function as a role with no EXECUTE, identical on pg-lane stub and real auth.users"
    - "tgattr compared as text (int2vector keeps lower bound 0, so an int2[] cast never equals ARRAY[...])"

key-files:
  created:
    - supabase/migrations/20261119120000_sync_profile_email_from_auth.sql
    - supabase/migrations/down/20261119120000-rollback.sql
    - supabase/tests/test_profiles_email_sync.sql
  modified: []

key-decisions:
  - "D-07 REVOKE written: the writer proof re-run at HEAD found no user-session writer of profiles.email"
  - "A1 resolved empirically: EXECUTE revoked from PUBLIC, anon, authenticated; arm 1b proves a role with no EXECUTE still fires the sync (zero-risk fallback not needed)"
  - "No sentinel notice: no arm returns early, so the ci.yml sentinel census is untouched"
  - "Verify block is catalogue-only (function and trigger existence), so a mutated migration still applies and the twins go RED on behaviour"

requirements-completed: [D-06, D-07, D-08, D-09, D-10, D-11]

coverage:
  - id: D1
    description: "A confirmed auth.users.email change is copied into profiles.email in the same transaction; an unchanged address and the sanitize path write nothing"
    requirement: "D-06"
    verification:
      - kind: other
        ref: "bash scripts/pg-lane/run.sh ... --gate supabase/tests/test_profiles_email_sync.sql (exit 0, arms 1, 1b, 2, 3a, 3b)"
        status: pass
      - kind: other
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_profiles_email_sync.sql (arms 1, 1b, 2, 3a, 3b RED, identity ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "authenticated can no longer UPDATE profiles.email and can still UPDATE display_name"
    requirement: "D-07"
    verification:
      - kind: other
        ref: "test_profiles_email_sync.sql arms 4 and 5, mutation runner RED (identity ok)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Function hardening (definer rights, pinned search_path, EXECUTE revoked) and trigger shape (AFTER UPDATE, FOR EACH ROW, email column only)"
    requirement: "D-06"
    verification:
      - kind: other
        ref: "test_profiles_email_sync.sql arms 6, 7, 8, mutation runner RED (identity ok)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The trigger fires and syncs on a real GoTrue-shaped auth.users on the Supabase Postgres image, and the DDL applies there as the postgres role"
    requirement: "D-06"
    verification:
      - kind: other
        ref: "migration plus full gate applied in one rolled-back transaction against the loopback lane DSN (all ten arms passed, nothing persisted); boot-time replay UNMEASURED, see Deviations"
        status: pass
    human_judgment: true
    rationale: "The boot-time replay (run.sh up naming the migration on its baseline-replay line) could not be run here, and whether Auth's own role fires the trigger on a real confirmation is routed to post-merge UAT (RESEARCH A2, A3, A4)."
  - id: D5
    description: "D-09 hand-off: migration-reviewer and rls-policy-auditor verdicts CLEAN on the migration and its rollback before merge"
    requirement: "D-09"
    verification: []
    human_judgment: true
    rationale: "A review-step obligation for the orchestrator, not an executor task; no executor check can satisfy it."

plan_head_before: befe706f0efb0d8b1cd017312cbb3e6153006504
plan_head_after: 25064fdd107eb55b835ef70d87c71676c8b486e6

duration: 16min
completed: 2026-11-19
status: complete
---

# Phase 219 Plan 01: sync profiles.email from auth.users Summary

**An AFTER UPDATE OF email trigger on auth.users copies a confirmed sign-in email into the derived profiles.email through a SECURITY DEFINER function, a column revoke closes the user-session write path to that column, and a ten-arm gate proves both and goes RED under all ten named mutations.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-19T16:06:00Z
- **Completed:** 2026-11-19T16:21:00Z
- **Tasks:** 2
- **Files modified:** 3 (all created)
- **PLAN_BASE:** `befe706f0efb0d8b1cd017312cbb3e6153006504` (recorded before the first edit)

## Accomplishments

- Migration `20261119120000_sync_profile_email_from_auth.sql`: `public.sync_profile_email_from_auth()` (definer, `SET search_path = public, pg_catalog`, early return on `quantalyze.sanitize_in_progress = 'on'`, one distinct guard, no WHEN clause), `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, trigger `on_auth_user_email_updated AFTER UPDATE OF email ON auth.users`, `REVOKE UPDATE (email) ON public.profiles FROM authenticated`, catalogue-only verify block. No BEGIN/COMMIT, no backfill, no `WHEN (`.
- Rollback `down/20261119120000-rollback.sql`: precondition, drop trigger, drop function, re-grant `UPDATE (email)`, verify. Touches no data.
- Gate `supabase/tests/test_profiles_email_sync.sql`: arms 1, 1b, 2, 3a, 3b, 4, 5, 6, 7, 8, each with a `RED-UNDER` prose line and a `RED-UNDER-M` twin; ten of ten bite.
- A1 closed by measurement: arm 1b (temp-table trigger fired by `authenticated`, which holds no EXECUTE, no JWT claims) passes on the pg-lane and on a real Supabase Postgres image, and its SECURITY INVOKER twin goes RED.

## Step 0 - lane privilege probe (measured before anything was written)

Run against the loopback lane DSN (`127.0.0.1:54422`, `capability-probe.mjs --refuse-nonlocal-dsn` printed `loopback-dsn: OK (127.0.0.1/localhost, one host, a port, no query string)`), one psql call, ended in ROLLBACK:

```
 current_user | can_trigger | can_update
 postgres     | t           | t
CREATE FUNCTION
CREATE TRIGGER
UPDATE 0
 probe ok
ROLLBACK
```

Both privileges are held and the probe `CREATE TRIGGER ... AFTER UPDATE OF email ON auth.users` and `UPDATE auth.users SET email = email` were accepted. No HALT. The DSN belongs to a stack booted by another agent (see Deviations 1); the probe changed nothing there.

## Step A - writer proof for D-07 (run at HEAD `befe706f0`)

Command 1: `grep -rnE "\.from\(\s*[\"'\`]profiles[\"'\`]\s*\)" src analytics-service --include='*.ts' --include='*.tsx' --include='*.py' -A8 | grep -E "\.(update|upsert|insert)\("`

```
src/app/api/admin/match/preferences/[allocator_id]/route.ts-115-    .update({ preferences_updated_at: new Date().toISOString() })
src/app/api/admin/partner-import/route.ts:707:      const { error: profileErr } = await admin.from("profiles").upsert(
src/app/api/admin/partner-import/route.ts:795:      const { error: profileErr } = await admin.from("profiles").upsert(
src/app/api/admin/manager-approve/route.ts-83-    .update({ manager_status: "verified" })
src/app/api/admin/allocator-approve/route.ts-71-    .update({ allocator_status: "verified" })
src/components/auth/ProfileForm.tsx-40-      .update({
src/components/auth/OnboardingWizard.noseeed.test.tsx:12: * `supabase.from('profiles').update(...)` on the current user. It must
src/components/auth/OnboardingWizard.noseeed.test.tsx:18: *   1. supabase.from("profiles") was called and .update(...) fired.
src/components/auth/OnboardingWizard.noseeed.test.tsx-21- *   4. No mocked table ever received an .insert(...) call — the only
src/components/auth/OnboardingWizard.noseeed.test.tsx:128:  it("calls supabase.from('profiles').update(...) at least once", async () => {
src/components/auth/OnboardingWizard.tsx-47-      .update({
src/__tests__/user-app-roles-backfill.test.ts-179-          .update({ is_admin: true, role: "allocator" })
src/__tests__/user-app-roles-backfill.test.ts-216-          .update({ is_admin: false, role: "both" })
src/__tests__/user-app-roles-backfill.test.ts-380-          .update({ is_admin: true, role: "both" })
src/__tests__/user-app-roles-backfill.test.ts-421-          .update({ is_admin: true, role: "allocator" })
src/__tests__/scenario-commit-batch-race.test.ts-105-      .upsert(
src/__tests__/csv-finalize-concurrent-never-classified.test.ts-322-      .upsert({ id: userId, display_name: userEmail }, { onConflict: "id" });
src/__tests__/scenario-commit-rls.test.ts-214-      .upsert({ id: allocAId, display_name: aEmail }, { onConflict: "id" });
src/__tests__/scenario-commit-rls.test.ts-230-      .upsert({ id: allocBId, display_name: bEmail }, { onConflict: "id" });
src/__tests__/sanitize-user-rpc.test.ts-102-          .update({ display_name: "[deleted]" })
src/__tests__/sanitize-user-rpc.test.ts-145-          .update({ partner_tag: tag })
src/__tests__/sanitize-user-rpc.test.ts-242-            .update({ display_name: variant })
src/__tests__/retention-crons.test.ts-368-          .update({ email: userEmail })
src/__tests__/retention-crons.test.ts:455:        await admin.from("profiles").update({ email: userEmail }).eq("id", userId);
src/__tests__/retention-crons.test.ts-462-          .insert({
src/__tests__/retention-crons.test.ts-579-          .update({ email: userEmail })
src/__tests__/retention-crons.test.ts:677:        await admin.from("profiles").update({ email: userEmail }).eq("id", userId);
src/__tests__/retention-crons.test.ts-684-          .insert({
src/__tests__/scenario-commit-batch-tx.test.ts-95-      .upsert(
src/__tests__/scenario-commit-batch-tx.test.ts-116-      .upsert(
src/__tests__/audit-coverage.test.ts:1706:    snippet: 'const { error: profileErr } = await admin.from("profiles").upsert(',
src/__tests__/audit-coverage.test.ts-1712-    snippet: 'await args.admin.from("feature_flags").upsert(',
src/lib/test-helpers/live-db.ts-65-    .upsert({ id: data.user.id, display_name: email }, { onConflict: "id" });
```

Command 2: `grep -nE "UPDATE\s+(public\.)?profiles" supabase/migrations/*.sql` (18 hits): `20260407164606_perfect_match.sql:37` (sets is_admin), `20260417110538_sanitize_user.sql:298`, `20260513073518_sanitize_user_hardening.sql:265`, `20260515114310_redact_guc_bypass_use_current_user.sql:30` (comment) and `:438`, `20260516160100_sanitize_user_purge_notification_dispatches.sql:113`, `20260515210100_sanitize_user_high_hardening.sql:258`, `20260521150000_universal_signup_approval_gate.sql:23,28,33` (allocator_status, manager_status), `20260517013100_sanitize_user_recipient_email_case_insensitive.sql:140`, `20260530120000_admin_role_mutate.sql:185,214,291` (is_admin), `20260716120000_backfill_staff_role_both.sql:72` (role), `20260827130000_sanitize_user_revoke_strategy_shares.sql:18` (comment) and `:245`. The non-sanitize statements were opened and set is_admin, allocator_status, manager_status or role only.

Every hit that carries `email` is a service_role admin client (`admin.from("profiles").upsert` in partner-import, the retention-crons test helpers), a SECURITY DEFINER function (`sanitize_user`, `handle_new_user`) or a rolled-back migration self-test. The two user-session writers (`ProfileForm.tsx`, `OnboardingWizard.tsx`) send no `email`. **Verdict: REVOKE written** (D-07 condition met).

## Local-stack result

`local-stack: UNMEASURED (boot-time replay)` - host reason in Deviations 1. The interim measurement that was possible, all against the already-running lane's loopback DSN, in one transaction that ended in ROLLBACK: `BEGIN;` + the migration + the full gate. The migration applied as `postgres` (function, REVOKE, COMMENT, DROP TRIGGER, CREATE TRIGGER, column REVOKE, verify NOTICE), and the gate passed all ten arms on the real Supabase `auth.users` (the closing notice printed, then `ROLLBACK`). A follow-up `select count(*) from pg_trigger where tgname='on_auth_user_email_updated'` and the same count on `pg_proc` for the new function and the probe function both returned 0, so nothing persisted. `node scripts/check-baseline-currency.mjs --replay-set` prints `baseline-currency: carried=324 replay=1 marker-sha=match defects=0` and `baseline-replay: 1 migration(s) newer than the dump: 20261119120000_sync_profile_email_from_auth.sql`, so a real boot replays exactly this migration. CI `sql-tests` on the PR head carries the replay proof.

## Task Commits

1. **Task 1 (tracer): migration, rollback, gate arm 1** - `70f22d022` (feat)
2. **Task 2: nine more arms, every twin proven** - `25064fdd1` (test)

## Verification evidence

- Task 1 tracer: pg-lane plain run exited 0 ("Arm 1 OK"); `node scripts/mutation-runner/run.mjs --file ...` printed `arm 1 exit 3 RED (identity ok)` and `No defects in the narrowed scope`.
- Mutation runner, full file (final run): `baseline exit 0`, then `arm 1`, `1b`, `2`, `3a`, `3b`, `4`, `5`, `6`, `7`, `8` each `RED (identity ok)`, `restore exit 0`, `arms: 10/10/0`, `biting: 10`, `lane-invocations: 10`, `coverage: files 84/111`, `No defects in the narrowed scope`. (`--file` is a diagnostic mode that never exits 0 by design; the verdict is the printed line.)
- pg-lane plain run of the final gate: exit 0, closing notice `profiles email sync gate passed: ...`.
- Byte-backup neuter/restore: `cp -p` of the migration to the scratchpad, hand-edit replacing the UPDATE with `NULL;`, pg-lane gate exit 3 with `ERROR:  P0001: TEST FAILED (1): profiles.email did not follow the confirmed auth.users.email change (got the old address)`; `cp -p` restore, `cmp` exit **0**, re-run exit 0 green; `git status` showed the migration unmodified.
- Lints: `lint-migration-data-dependence`: `83 refusal(s), 83 allowlisted, 0 NEW`; `lint-sql-gates`: `scanned 111 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`; `lint-app-guc --self-test` OK and corpus `app-guc: findings 0`.
- Acceptance greps: migration non-comment lines carry `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, the GUC test, the distinct guard, the profiles UPDATE, `FROM PUBLIC, anon, authenticated;` and the column REVOKE exactly once each; 0 BEGIN/COMMIT; 0 `WHEN (`. Gate: 10 `RED-UNDER-M` lines, identities exactly `1 1b 2 3a 3b 4 5 6 7 8`, 0 `ARMS EXECUTED`, 0 `SKIP (`. `git diff --name-only <PLAN_BASE> -- supabase/schema/baseline-carried-migrations.txt supabase/schema/baseline.sql` printed nothing.

## Deviations from Plan

**1. [Environmental - local-stack boot not run] Boot-time replay UNMEASURED**
- **Found during:** Task 1 Step 0 / Step E
- **Issue:** `docker ps` showed a Supabase stack for project id `quantalyze` already up (started minutes earlier from another agent's worktree). The lane's container names are fixed by the project id, so `run.sh up` would collide with it and `run.sh down` would tear down another agent's stack. The host data volume was also at 100% (about 150-350 MB free of 228 GB), which would not take a stack boot.
- **Fix:** Did not boot or stop anything. Ran the Step 0 probe and the full migration plus gate against that stack's loopback DSN, each inside one transaction that ended in ROLLBACK, and confirmed afterwards that no object persisted. Recorded `local-stack: UNMEASURED (boot-time replay)`; CI `sql-tests` carries it.
- **Files modified:** none

**2. [Rule 1 - Bug, in my own gate draft] arm 6 compared tgattr as int2[]**
- **Found during:** Task 2 first pg-lane run (`TEST FAILED (6) ... (tgattr [0:0]={3})`)
- **Issue:** `tgattr` is an int2vector whose array form keeps lower bound 0, so it never equals `ARRAY[attnum]::int2[]`.
- **Fix:** compare `tgattr::text` with `attnum::text`. Committed in the same Task 2 commit (the draft never reached a commit).
- **Files modified:** supabase/tests/test_profiles_email_sync.sql

**3. [Plan premise] the narrowed mutation-runner run never exits 0**
- The plan's `<automated>` lines chain `node scripts/mutation-runner/run.mjs --file ...`; that mode exits non-zero by design and prints `No defects in the narrowed scope`. I read the printed verdict instead of the exit code. A full unnarrowed run was not attempted (RESEARCH: it wants about 15 GB free, and this host has under 1 GB).

**4. [Disk pressure, first mutation run] one run was invalid**
- The first full runner pass hit `ENOSPC` mid-run: arms 4, 6, 7, 8 and the restore leg reported `NO-IDENTITY` or exit 1 with 1.3-1.8 s lane times. That run is discarded. Arm 4 was re-run alone (RED, identity ok) and then the whole file was re-run (all ten RED, identity ok), which is the reading reported above.

**Total deviations:** 4 (1 environmental, 1 self-fix before commit, 2 notes). **Impact:** none on the migration or the gate as shipped; the only open proof is the boot-time replay, which CI covers.

## Issues Encountered

- Host disk is at 100% (about 150-350 MB free of 228 GB at the time of the runs). Not caused by this plan (its footprint is under a few hundred MB of scratch) but it makes full-corpus mutation runs and stack boots impossible on this host until space is freed. Surfaced to the orchestrator.

## Open items routed elsewhere

- **D-09 (review step, not an executor task):** before merge the phase REVIEW must record migration-reviewer and rls-policy-auditor verdicts CLEAN on `20261119120000_sync_profile_email_from_auth.sql` and its rollback, alongside gsd-code-reviewer and silent-failure-hunter.
- **Plan 03:** census pins for the new gate file, `NAME_SET_RATCHET` row, `COMPARED_FLOOR`, `supabase/schema/functions/` regeneration and the `[219-EXTRACTOR-UPDATE-OF]` TODOS entry. `scripts/local-stack/nonpublic-objects.mjs` was not touched.
- **Ship step:** re-pick the migration timestamp against origin/main; rename touches `grep -rlna 20261119120000 supabase scripts src .planning/phases/219-*`.
- **Post-merge UAT (founder, RESEARCH A2/A3/A4):** change an email in the app on TEST, read `profiles.email` count-only, observe the double-confirm first-click landing and the redirect allow-list.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-219-01 to T-219-07 are mitigated by the column revoke, the definer pinning, the EXECUTE revoke, arm 1b, the sanitize early return and the catalogue-only verify block).

## Self-Check: PASSED

- FOUND: supabase/migrations/20261119120000_sync_profile_email_from_auth.sql
- FOUND: supabase/migrations/down/20261119120000-rollback.sql
- FOUND: supabase/tests/test_profiles_email_sync.sql
- FOUND: 70f22d022
- FOUND: 25064fdd1
