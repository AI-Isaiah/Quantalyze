---
phase: 204-introauth-the-intro-path-s-database-side-authorization-match
verified: 2026-11-10T21:00:00Z
status: passed
score: 4/4 must-haves verified locally
verified_at_sha: e2e97eb0390834e23310ce98ff1923749d4a9e62
drift_subjects:
  - supabase/migrations/20261110150000_intro_path_authz_hardening.sql
  - supabase/migrations/down/20261110150000-rollback.sql
  - supabase/tests/test_contact_requests_insert_intro_authz.sql
  - scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql
  - scripts/mutation-floors.mjs
  - src/app/api/intro/route.ts
  - src/lib/intro/refusal-codes.ts
  - src/lib/approval.ts
  - .github/workflows/ci.yml
behavior_unverified: 0
human_verification:
  - test: "CI sql-tests (real-dump local-stack lane) on the PR head SHA"
    expected: "the new gate runs green against the committed schema dump plus the replayed migration"
    why_human: "CI-only. The real-schema lane needs Docker; it was not run locally."
  - test: "CI sql-mutation FULL on the pull request (floors edit forces FULL) and sql-gate-lint"
    expected: "FILES_FLOOR 81 and ARMS_FLOOR 830 hold at the full-corpus reading; WAIVED_CEILING 0"
    why_human: "CI-only. The full mutation corpus was deliberately not run locally."
  - test: "migration-reviewer and rls-policy-auditor clean before merge; apply-test then PROD apply ordering"
    expected: "timestamp 20261110150000 sorts after the applied tip; apply-test succeeds before the PROD apply"
    why_human: "Pre-merge review gates and post-merge apply path; no TEST or PROD access was used here."
---

# Phase 204: INTROAUTH Verification Report

**Phase Goal:** The database side of the intro path enforces what `/api/intro` enforces: only an approved, attested allocator can create an intro, on every entry point, not only through the route.
**Verified:** 2026-11-10
**Status:** passed (2026-11-10; was human_needed, see the Human Verification resolution note below)
**Re-verification:** No, initial verification

Nothing in this report was run against TEST or PROD. The real-schema `sql-tests` lane and the CI FULL `sql-mutation` run are CI-only and were NOT run locally.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The `contact_requests_insert` policy admits a row only for the row's own allocator who holds the allocator or both role, is approved, and has an attestation on file, which is the predicate `/api/intro` applies | VERIFIED | Migration STEP 1 is an `ALTER POLICY` with `allocator_id = auth.uid()`, a `profiles` EXISTS (role in allocator/both; `is_admin`, or allocator+verified, or both+both verified) and an `investor_attestations` EXISTS (`attested_at IS NOT NULL`). Compared line by line with `src/lib/approval.ts` `isProfileApproved` and the route order (approval gate, then role in allocator/both, then attestation): same truth table, including the admin-with-manager-role refusal. Lane run of the gate: exit 0, sentinel `ALL 15 ARMS EXECUTED`; policy arms cover admit (3) and refuse (7). |
| 2 | The six-argument `send_intro_with_decision` is callable by `service_role` only, so the admin match path (service-role client) keeps working and no client role can call it directly | VERIFIED | Migration STEP 2 `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; catalogue block asserts `service_role` keeps EXECUTE and anon/authenticated/PUBLIC hold none. The only app caller (`src/app/api/admin/match/send-intro/route.ts:460`) uses the admin client; no other caller in `src`, `scripts`, `analytics-service` or `e2e`. Gate arms ACL-PUBLIC/ANON/AUTH/SVC/CALL pass on the lane. |
| 3 | Every new gate arm can fail: each is annotated `RED-UNDER` and reddens its own arm first when neutered | VERIFIED | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_contact_requests_insert_intro_authz.sql`: `arms: 15/15/0`, `biting: 15`, `lane-invocations: 15`, row `sections 15 / judged 15 / annotated 15 / waived 0 / biting 15`, "No defects in the narrowed scope". |
| 4 | The censuses and floors moved with the new gate and the route handles a policy refusal visibly | VERIFIED | `--parse-only`: `files 81/108`, `arms: 0/830/0`; `FILES_FLOOR=81`, `ARMS_FLOOR=830`, `WAIVED_CEILING=0` in `scripts/mutation-floors.mjs`; `ci.yml` sentinel roster moved to SENTINEL_FLOOR 28 / ARMS_FLOOR 445. Targeted vitest green: gate-family-meta, mutation-runner-floors, mutation-annotation-parser, lint-sql-gates, drift-check-scripts (6 files, 1275 tests), `contracts/ci-anti-skip-gate.contract.test.ts` (33), `src/app/api/intro` (43, including the 42501 refusal path returning a named 403 and a reduced Sentry error that drops `details` and `hint`). `npx tsc --noEmit -p .` clean. |

**Score:** 4/4 truths verified locally; 0 behavior-unverified. The truths were exercised on the throwaway pg-lane cluster, not on the real schema dump (see Human Verification).

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20261110150000_intro_path_authz_hardening.sql` | VERIFIED | Substantive, no placeholders or debt markers. Verification block reads only `pg_policies`, `pg_proc`, `has_function_privilege` and `aclexplode`, no table rows (D-06), so it applies on schema-only TEST. No function created or replaced. |
| `supabase/migrations/down/20261110150000-rollback.sql` | VERIFIED | Restores the policy to `allocator_id = auth.uid()` and the three grants; header documents that the ledger row stays. Manual, off the auto-apply path. |
| `supabase/tests/test_contact_requests_insert_intro_authz.sql` | VERIFIED | 15 twinned arms plus sentinel; executed on the lane. |
| `scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql` | VERIFIED | Lane-only stand-ins; listed in the gate's `RED-UNDER-SETUP`. |
| `scripts/mutation-floors.mjs`, census tests, `ci.yml` roster | VERIFIED | Values match the measured reading above. |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| Policy predicate | `isProfileApproved` plus route role and attestation checks | WIRED | Same conjunction and order of cases (see Truth 1). |
| `/api/intro` insert (user-scoped client) | the tightened policy | WIRED | Route inserts with the user client (`route.ts:195`); a refusal (42501) is mapped to a named 403 and captured with a reduced error. |
| Admin send-intro route | six-arg function via service role | WIRED | `admin.rpc(...)` at `route.ts:460`; `service_role` EXECUTE retained and asserted. |
| Other `contact_requests` writers | RLS | NOT AFFECTED | Seed scripts use the service-role client; the admin intro-request, intro-response and sanitize paths use the admin client; `RequestIntroButton` only SELECTs. |

### Requirements Coverage

D-01 to D-08 from CONTEXT: all addressed. D-01/D-02/D-03 (inline EXISTS, mirrored predicate, no helper), D-04/D-05 (REVOKE only, admin path unchanged), D-06 (catalogue-only block, confirmed), D-07 (gate with biting annotations, censuses moved), D-08 (no misuse recipe or "currently open" claim in the migration, rollback, gate or fixture; grep found none; `held/` has zero tracked files and zero appearances in the phase's commit file lists).

### Behavioral Spot-Checks and Probes

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Gate on throwaway cluster | `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <the gate's RED-UNDER-SETUP list> --gate supabase/tests/test_contact_requests_insert_intro_authz.sql` | exit 0, `ALL 15 ARMS EXECUTED` | PASS |
| Mutation file run | `node scripts/mutation-runner/run.mjs --file <gate>` | 15/15/0, biting 15, no defects (exit 2 is the narrowed-scope clean exit) | PASS |
| Parse-only census | `node scripts/mutation-runner/run.mjs --parse-only` | files 81/108, arms 0/830/0 | PASS |
| Typecheck | `npx tsc --noEmit -p .` | no errors | PASS |

### Anti-Patterns Found

None in the phase's files (no TBD, FIXME or XXX; no stubs).

### Notes (non-blocking)

- Plan context lists the `/api/intro` route logic as out of scope; commits `fa554f0c8` and `5a7b0da83` touch the route (named 403 for a policy refusal, reduced Sentry error). They came from review rounds 1 to 3 (SF-01, SEC-01, both closed; round 3 clean: 0 critical, 0 high, 0 medium) and are consistent with the phase goal. Not a gap.
- The FULL local mutation run was not performed (disk headroom); `ARMS_FLOOR 830` is the static annotated-unwaived count, an upper bound on biting. The per-file run above proves this file's 15 arms bite; the CI FULL run is the authoritative full-corpus reading.

### Human Verification Required

1. **CI `sql-tests` on the PR head SHA.** Expected: the gate is green on the real dump plus replayed migration. Why human: CI-only, needs Docker; not run locally.
2. **CI `sql-mutation` FULL and `sql-gate-lint`.** Expected: floors 81 / 830 / 0 hold. Why human: CI-only; the full mutation corpus was not run locally.
3. **migration-reviewer and rls-policy-auditor before merge; `apply-test` then the PROD apply.** Expected: clean reviews; timestamp sorts after the applied tip. Why human: review gates and post-merge apply path; no TEST or PROD access was used.

### Gaps Summary

No gaps. Every local check passes; the phase is `human_needed` solely for the CI-only and pre-merge items above.

---

_Verified: 2026-11-10_
_Verifier: Claude (gsd-verifier)_

### Human Verification resolved (2026-11-10)

All three items are met, so the status moved from `human_needed` to `passed`. `verified_at_sha` and `drift_subjects` are unchanged.

1. **CI `sql-tests` and `sql-mutation` (FULL) passed** on PR #1245 at head `2f367739b0f2cc3e85e717be657f4c82eb0cff36`, with all 31 check runs at that SHA succeeding, `sql-gate-lint` included.
2. **migration-reviewer and rls-policy-auditor were clean** in all three review rounds (`204-REVIEW.md`, `204-REVIEW-R2.md`, `204-REVIEW-R3.md`).
3. **The migration is live.** PR #1245 merged as `2516d8b13`. Supabase Migrate ran plan, `apply-test` and the PROD apply, all successful. A read-only check through the Supabase MCP, with the marker query first, confirmed three things on PROD:
   - the applied tip is `20261110150000`;
   - `contact_requests_insert` carries the new check;
   - the 6-arg `send_intro_with_decision` is executable by `postgres` and `service_role` only.
