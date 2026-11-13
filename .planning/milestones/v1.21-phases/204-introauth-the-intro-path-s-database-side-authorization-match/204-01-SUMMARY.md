---
phase: 204-introauth-the-intro-path-s-database-side-authorization-match
plan: 01
subsystem: database
tags: [postgres, rls, alter-policy, function-acl, sql-gate, mutation-runner, pg-lane]

requires:
  - phase: 194
    provides: the /api/intro approval, role and attestation checks the database side now matches
provides:
  - migration 20261110150000 aligning the contact_requests INSERT policy and the six-argument send_intro_with_decision ACL with /api/intro
  - manual rollback for it
  - pg-lane fixture 43 (attestation columns, RLS and grants, stand-in six-argument function)
  - SQL gate with 15 twinned arms and one sentinel
affects: [204-02 census moves, ship step (CHANGELOG, VERSION), migration-reviewer, rls-policy-auditor]

actuals:
  tokens: 10462
  tasks: 3
  commits: 2
plan_head_before: a83b7ac8c23b178790e0e5211e85743f2c6332d5
plan_head_after: 346698eca112867f3854a87810da43ea4096efce

tech-stack:
  added: []
  patterns:
    - "every gate twin is a post-apply sql step (an edit of the migration would trip its own verification block)"
    - "insert attempts through one pg_temp helper so every TEST FAILED raise sits directly in the DO body"

key-files:
  created:
    - supabase/migrations/20261110150000_intro_path_authz_hardening.sql
    - supabase/migrations/down/20261110150000-rollback.sql
    - scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql
    - supabase/tests/test_contact_requests_insert_intro_authz.sql
  modified: []

key-decisions:
  - "Policy check is inline EXISTS subqueries on profiles and investor_attestations, no helper function (D-03), measured with no recursion on the lane"
  - "Function body untouched, REVOKE only (D-04, D-05): npm run schema:functions:check reports the snapshot current"
  - "Fixture 43 also grants anon SELECT on profiles and investor_attestations, as the real schema does, so the anon arm measures row level security"

patterns-established:
  - "Refusal arms read SQLSTATE and message text and require 'row-level security', with an up-front grant control spelled ARM 0 FAILED (control)"

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08]

coverage:
  - id: D1
    description: "contact_requests INSERT policy admits exactly what /api/intro admits (approved attested allocator, both, attested admin with allocator role) and refuses the rest, each arm biting under its twin"
    requirement: "D-02"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --subset-from <list> (arms 15/15/0, biting 15)"
        status: pass
      - kind: integration
        ref: "bash scripts/pg-lane/run.sh gate run, ALL 15 ARMS EXECUTED"
        status: pass
    human_judgment: false
  - id: D2
    description: "six-argument send_intro_with_decision callable by service_role only, authenticated call refused at the privilege check"
    requirement: "D-04"
    verification:
      - kind: integration
        ref: "bash scripts/pg-lane/run.sh gate run, arms ACL-PUBLIC to ACL-CALL"
        status: pass
    human_judgment: false
  - id: D3
    description: "behaviour on the real dump (local-stack lane) and PROD apply order"
    verification: []
    human_judgment: true
    rationale: "Cannot run locally (no Docker); CI sql-tests on the PR head SHA and apply-test then the PROD apply own it"

duration: 45min
completed: 2026-11-10
status: complete
---

# Phase 204 Plan 01: Intro path database-side authorization Summary

**One ALTER POLICY plus one REVOKE aligning the intro path's database side with /api/intro, with a catalogue-only verification block, a manual rollback, a lane fixture, and a 15-arm gate whose every twin bites as its own first failure.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-11-10T20:05Z
- **Tasks:** 3 (one tracer, one auto/tdd, one evidence task)
- **Files created:** 4

## Accomplishments

- Migration `20261110150000_intro_path_authz_hardening.sql`: `ALTER POLICY "contact_requests_insert"` to the route predicate (owner, allocator or both role, approval, attestation), `REVOKE ALL ... FROM PUBLIC, anon, authenticated` on the six-argument function, and one DO block that reads only `pg_policies`, `pg_proc`, `has_function_privilege` and `aclexplode`. No function is created.
- Gate `test_contact_requests_insert_intro_authz.sql`: 5 function-ACL arms and 10 policy arms (3 admit, 7 refuse), 3 untwinned setup controls, one `ALL 15 ARMS EXECUTED` sentinel. Every twin is a post-apply `sql` step.
- Rollback `down/20261110150000-rollback.sql`, applied once on the lane after the migration to confirm it runs (exit 0, its notice printed).
- Fixture `43-fixture-intro-authz-stand-ins.sql` for the lane.

## Task Commits

1. **Task 1: tracer (fixture 43, migration, three-arm gate)** - `86b61773f` (feat)
2. **Task 2: 15 arms, sentinel, rollback** - `346698eca` (test)
3. **Task 3: evidence only** - no tracked file changed; evidence lines below

**Plan metadata:** the commit carrying this SUMMARY (docs).

## Evidence lines

gc-204-tracer-lane: exit=0
gc-204-tracer-file: exit=2 no-defects
gc-204-lane: exit=0 sentinel=ALL 15 ARMS EXECUTED
gc-204-file: exit=2 no-defects
gc-204-arms: N=15 n=15
gc-204-neuter-policy: first=POL-UNAPPROVED result=red restored=identical
gc-204-neuter-acl: first=ACL-ANON result=red restored=identical
gc-204-neuter-pre: first=ACL-ANON result=red restored=identical
gc-204-migdep: lint-migration-data-dependence: corpus 319 migration(s), 401 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.
gc-204-d06: do-block-table-reads=0
gc-204-seed: service-role=yes
gc-204-fn-body: unchanged
gc-204-subset: exit=0
gc-204-row: file test_contact_requests_insert_intro_authz.sql: sections 15 / judged 15 / annotated 15 / waived 0 / biting 15
gc-204-parse: coverage: files 81/108 | arms: 0/830/0   (executed/annotated/waived)
gc-204-real-dump: not-run (CI sql-tests on the PR head SHA owns it; no Docker locally)

Notes on the readings: the neuters ran through the lane's `--post-apply` hook and a shortened setup list, so no tracked file was edited and the `cmp` of each backup (migration, gate, fixture 43) against its tracked file was silent. Baseline before the migration existed was 318 migrations and 400 anonymous blocks, matching the plan's expectation of 319 and 401 with it. `--parse-only` reads 830 annotated arms, which is 815 plus 15, and 81/108 files.

## Files Created/Modified

- `supabase/migrations/20261110150000_intro_path_authz_hardening.sql` - policy, REVOKE, catalogue-only verification
- `supabase/migrations/down/20261110150000-rollback.sql` - manual rollback, catalogue-only check
- `scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql` - lane stand-ins
- `supabase/tests/test_contact_requests_insert_intro_authz.sql` - the gate

## Decisions Made

- Gate arm layout followed the plan's table exactly; no twin needed changing and no arm needed a waiver. `ACL-CALL` carries the one planned neuter of `ACL-AUTH`.
- Insert attempts go through one `pg_temp.ia_insert_as` helper that raises nothing, so each `TEST FAILED` raise stays directly in the DO body (GRAMMAR rule 3c).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixture 43 did not model the anon grants the real schema carries**
- **Found during:** Task 2 (first full-gate lane run, arm POL-ANON)
- **Issue:** A NULL-uid session does not short-circuit the check (NULL AND x still evaluates x), so the anon insert reached the subqueries and was refused with a table-permission message on `profiles` (the lane gave anon no grant there), not a row-level-security message. The real schema grants anon SELECT on `investor_attestations` and column SELECT on the five `profiles` columns the check reads.
- **Fix:** fixture 43 now also runs `GRANT SELECT ON public.investor_attestations TO authenticated, anon` and `GRANT SELECT ON public.profiles TO anon`, with a header paragraph saying why.
- **Files modified:** `scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql` (a file of Task 1, edited in Task 2 and committed with it)
- **Verification:** full gate on the lane exits 0 with the sentinel; `--file` shows 15 of 15 biting.
- **Committed in:** `346698eca`

---

**Total deviations:** 1 auto-fixed (1 Rule 1)
**Impact on plan:** the fixture edit widens lane grants to match the real schema; no scope change. The plan's Task 2 file list did not name the fixture.

## Issues Encountered

None beyond the deviation above.

## CI-only items (not run locally)

- Real-dump run: `sql-tests` on the local-stack lane at the PR head SHA (the gate seeds only columns the real tables carry and one strategy per insert, but this is unmeasured locally).
- `sql-mutation` FULL on the pull request (a floors edit in 204-02 makes it FULL), and `sql-gate-lint`.
- After merge: `apply-test`, then the PROD apply (auto-applies once `apply-test` succeeds). migration-reviewer and rls-policy-auditor must be clean before merge.
- The migration timestamp 20261110150000 must sort after PROD's applied tip (`migration-policy.yml`); no PROD read was made in this plan.
- Census files go red until plan 204-02 moves them: `mutation-runner-floors`, `gate-family-meta`, `mutation-annotation-parser`, `lint-sql-gates`, `drift-check-scripts` and `ci-anti-skip-gate.contract` tests, `scripts/mutation-floors.mjs`, and the `ci.yml` sentinel roster. Not edited here, as planned.

## Known Stubs

None. The fixture's function body is an intentional stand-in, declared as one in its header; the real function body is untouched.

## Threat Flags

None. The change only narrows existing surface (one policy, one ACL).

## Next Phase Readiness

Plan 204-02 can read the measured values above: N=15 twins, n=15 sentinel arms, per-file row `sections 15 / judged 15 / annotated 15 / waived 0 / biting 15`, parse reading `files 81/108` and `arms 0/830/0`.

## Self-Check: PASSED

- Created files present: the four paths under Files Created/Modified exist on disk.
- Commits `86b61773f` and `346698eca` are ancestors of HEAD.
- Verify commands of Tasks 1 and 2 returned OK; the Task 3 evidence lines are all present above.

---
*Phase: 204-introauth-the-intro-path-s-database-side-authorization-match*
*Completed: 2026-11-10*
