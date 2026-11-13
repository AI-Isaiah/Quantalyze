---
phase: 204-introauth
verdict: SECURED
asvs_level: 1
block_on: high
threats_total: 11
threats_closed: 11
threats_open: 0
audited_head: e2e97eb03
audited: 2026-11-10
---

# Phase 204 INTROAUTH: security verification

**Verdict: SECURED.** Every declared mitigation was found in the implemented code at head
`e2e97eb03`. Nothing is open, blocking or non-blocking.

Scope: the phase hardens the intro path's database-side authorization so it matches
`/api/intro`: the INSERT policy on `public.contact_requests`, the EXECUTE grants on the
six-argument `public.send_intro_with_decision`, and the gate, rollback, fixture and census
edits that prove and carry that change. The register is the union of the two plan
`<threat_model>` blocks (T-204-01 to T-204-08, T-204-SC), plus SEC-01 from review round 2.

Method: ASVS L1 with the L2 placement check the registers call for (each mitigation was
checked in the layer that enforces it, not only for presence). Verification was by reading
the code and by re-running what can run without Docker, PROD or TEST access:

- the static linters and the census pins;
- the route test file;
- one local pg-lane run of the gate on the real migration, and two hand-neuters through the
  lane's `--post-apply` hook, with scratch kept outside the repo and no tracked file touched.

The real-dump `sql-tests` lane, `sql-mutation` FULL and the TEST then PROD apply are CI-only
and were not run here.

## Threat verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|---|---|---|---|---|---|
| T-204-01 | Elevation of privilege (insert path parity) | high | mitigate | CLOSED | Migration `supabase/migrations/20261110150000_intro_path_authz_hardening.sql:40-51`: `ALTER POLICY "contact_requests_insert" ... WITH CHECK` carries `allocator_id = auth.uid()` (:41), the profiles EXISTS with role in (allocator, both) and the admin / verified-allocator / both-and-both-verified approval disjunction (:42-48), and the attestation EXISTS with `attested_at IS NOT NULL` (:49-51). One non-comment `ALTER POLICY`, no DROP/CREATE. The predicate was compared with `src/lib/approval.ts:25-49` and `src/app/api/intro/route.ts:95-150` and matches. Refusal arms exist in `supabase/tests/test_contact_requests_insert_intro_authz.sql` at :282 (POL-UNAPPROVED), :293 (POL-BOTH-HALF), :304 (POL-MANAGER), :315 (POL-ADMIN-MANAGER), :327 (POL-UNATTESTED), :338 (POL-OWNER), :349 (POL-ANON). Each requires a refusal with SQLSTATE 42501, a `row-level security` message and 0 rows. Each carries a post-apply `sql` twin that restates the migration's whole check with exactly one change (extracted and compared). Independent run: the lane exited 0 with `ALL 15 ARMS EXECUTED`. A hand-neuter returning the policy to `allocator_id = auth.uid()` turned the gate red with `TEST FAILED (POL-UNAPPROVED)` as the first failure. |
| T-204-02 | Elevation of privilege (function EXECUTE path) | high | mitigate | CLOSED | Migration `:56-57`: `REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated`. The migration's catalogue check asserts it at `:91-109` (function present, service_role keeps EXECUTE, anon and authenticated hold none, no grantee-0 EXECUTE via `aclexplode`). Gate arms: ACL-PUBLIC (`:190`), ACL-ANON (`:203`), ACL-AUTH (`:211`), ACL-CALL (`:226`, an authenticated call refused with 42501 and `permission denied for function`, raise at `:248`). Each has a twin. Independent run: a hand-neuter granting EXECUTE to anon and authenticated turned the gate red with `TEST FAILED (ACL-ANON)` first. No `CREATE FUNCTION` and no non-comment `GRANT` in the migration (count 0), so the body is not re-created. The only runtime caller (`src/app/api/admin/match/send-intro/route.ts:460`) uses `createAdminClient()` behind `isAdminUser` (:71, :93). |
| T-204-03 | Denial of service (policy stricter than the route) | medium | mitigate | CLOSED | Admit arms POL-ADMIT (`:252`, raise `:258`), POL-BOTH (`:262`) and POL-ADMIN (`:272`) require `admitted` and exactly one row. They passed in the independent lane run, which also shows the caller reads its own `profiles` and `investor_attestations` rows inside the policy. Their twins narrow the predicate (false; role list narrowed to allocator; is_admin disjunct removed). Real-schema column grants cover every column the policy reads (`supabase/schema/baseline.sql:18431-18452`), and `profiles_read_public` and `attestations_self_read` are present (`:16465`, `:16965`). |
| T-204-04 | Denial of service (admin match path loses EXECUTE) | medium | mitigate | CLOSED | No GRANT or CREATE FUNCTION in the migration. The REVOKE names PUBLIC, anon and authenticated only (`:56-57`). The DO block raises if service_role lacks EXECUTE (`:95-97`). Arm ACL-SVC (`:218`) with a `REVOKE ... FROM service_role` twin. Function body untouched (the diff for the phase touches no function file). |
| T-204-05 | Tampering (migration blocks the TEST then PROD apply) | medium | mitigate | CLOSED | The migration's only DO block (`:62-112`) reads `pg_policies`, `pg_proc`, `has_function_privilege` and `aclexplode`, and no table. The rollback's DO block (`down/20261110150000-rollback.sql:42-71`) reads `pg_policies` and the function catalogue only. Region check run here: 0 matches of `FROM` followed by contact_requests, profiles or investor_attestations in either file. `node scripts/lint-migration-data-dependence.mjs --self-test` printed OK, and the scan printed `corpus 319 migration(s), 401 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` with 319 equal to the top-level `supabase/migrations/*.sql` count. |
| T-204-06 | Information disclosure (tracked text departs from D-08 wording) | high | mitigate | CLOSED | The migration, rollback, fixture 43 and gate describe the change as aligning the database side with `/api/intro` and say what the policy admits and refuses. A keyword scan of those files, `src/lib/intro/refusal-codes.ts` and the added lines of `route.ts` found no misuse description and no statement about the current state of any live object. The 12 commits in `a83b7ac8c..HEAD` carry no skip-CI token and no AI-attribution trailer. The phase `held/` directory is gitignored (`git check-ignore` true) and `git ls-files` lists 0 files under it. The phase's explicit-path commits touch only the 14 expected non-planning files. Observation routed to the orchestrator, not counted: see Notes. |
| T-204-07 | Tampering (floors set by hand, or a waiver added) | high | mitigate | CLOSED | `scripts/mutation-floors.mjs:1348` `FILES_FLOOR = 81`, `:3425` `ARMS_FLOOR = 830`, `:3539` `WAIVED_CEILING = 0`. `node scripts/mutation-runner/run.mjs --parse-only` run here printed `coverage: files 81/108`, `arms: 0/830/0` and `No static defects`, so the floors equal the live corpus and the gate file's row reads `15 prose / 15 twin(s) / 0 waiver(s)`. Registry keys `FILES_FLOOR=81` and `ARMS_FLOOR=830` in `src/__tests__/gate-family-meta.test.ts:944-945`. The gate file has 15 `RED-UNDER:` and 15 `RED-UNDER-M:` lines and no `"kind":"edit"` twin. `gate-family-meta`, `mutation-runner-floors`, the anti-skip contract test and the route test passed here. |
| T-204-08 | Repudiation (gate skips arms unnoticed on the real-dump lane) | medium | mitigate | CLOSED | `.github/workflows/ci.yml:4940` roster row `test_contact_requests_insert_intro_authz.sql   15`, `:5289` `SENTINEL_FLOOR=28`, `:5290` `ARMS_FLOOR=445` with the new `+ 15` term. The phase diff of `ci.yml` is only the roster row, the dated paragraph, the two floor lines and the sum comment, and touches no `timeout-minutes`. The gate prints one `ALL 15 ARMS EXECUTED (...)` sentinel (`:360`) naming every arm, and its setup checks use the untwinned `ARM 0 FAILED (control)` spelling (`:180`, `:184`, `:187`). `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` and the pins in `drift-check-scripts.test.ts` passed. |
| SEC-01 | Information disclosure (error reporting carries row details) | medium | mitigate (found in review round 2, registered here) | CLOSED | `src/app/api/intro/route.ts` has exactly three `captureToSentry` call sites (`:128`, `:216`, `:228`). Each passes `new Error(\`<label>: ${err.code} ${err.message}\`)` and nothing else from the PostgREST error. The `details` and `hint` fields are not referenced as properties anywhere in the file (only in the two SEC-01 comments, `:126`, `:215`). Tags are static (`area: intro` plus a stage). The HTTP bodies are static strings and named codes (`:134-140`, `:143-149`, `:220-226`, `src/lib/intro/refusal-codes.ts:12-21`), never a database message. The chokepoint `src/lib/sentry-capture.ts` also scrubs the message. Tests in `src/app/api/intro/route.test.ts` set `DETAILS-SENTINEL` and `HINT-SENTINEL` on the error and assert neither appears in the captured argument while the code does, for the 42501 insert path (`:484-508`), the generic insert path (same `it.each`) and the attestation-read path (`:583-603`). The file passes here. Review round 2 recorded RED evidence against the pre-fix route. |
| T-204-SC (plans 01 and 02) | Tampering (package installs) | low | accept | CLOSED | `git diff a83b7ac8c..HEAD` over `package.json`, `package-lock.json` and the analytics requirements files is empty. Accepted-risk entry: this register line. |

## Accepted risks log

| ID | Risk | Basis |
|---|---|---|
| T-204-SC | No dependency was added by either plan | No change to any dependency manifest in the phase range (empty diff above). |

## Unregistered flags

- The `## Threat Flags` sections of `204-01-SUMMARY.md` and `204-02-SUMMARY.md` report none.
- SEC-01 appeared during review, after the plans were written. It is registered above and
  closed.
- No further new attack surface was found in the phase's non-planning diff: the new 403 body
  is two static strings, and no new function, grant or table is introduced.

## Notes (non-blocking, not counted in `threats_open`)

1. **Recorded, not re-executed here.** The real-dump `sql-tests` run, the FULL `sql-mutation`
   run, the TEST then PROD apply, and the migration ordering against the applied tip are
   CI-side items the plans themselves mark as CI-only. The summaries state each as not run
   locally. The local pg-lane evidence above is independent of those.
2. **Test flake, not a phase defect.** One parallel vitest run of five files showed a single
   failure in `drift-check-scripts.test.ts` (the machine-wide `mktemp -d` leak detector, which
   documents its own sensitivity to parallel workers). The same file passed 917/917 when run
   alone.
3. **Wording observation routed to the orchestrator.** The pre-implementation planning
   artifacts (CONTEXT, RESEARCH, PATTERNS) are outside the implemented-code scope of this audit.
   Their D-08 wording is the orchestrator's call, so it is not re-judged in this file.
4. **Scope limits recorded by the reviewers, unchanged by this phase.** `contact_requests_update`
   and `contact_requests_read` and the table-level grants are deferred in CONTEXT.
   The policy governs who may insert, not the row's other column values. Other API routes
   pass raw Supabase errors to the same capture helper (booked by review round 2).
5. **Pre-existing, outside the SEC-01 scope.** `route.ts` also logs the raw enqueue and update
   errors with `console.error` (`:297-300`, `:323-326`). These were not changed and are not
   Sentry captures.

**threats_open:** 0
