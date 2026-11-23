---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 03
subsystem: database
tags: [postgres, compute_jobs, watchdog, lease-renewal, secdef-rpc, sql-gate, mutation-runner]
status: complete

requires:
  - phase: 164.9.3
    provides: claim_compute_jobs_with_priority 5-arg (claim_token stamp) used as the real claim in the gate
provides:
  - "public.renew_compute_job_claims(uuid[], uuid[]) RETURNS SETOF uuid, SECDEF, service_role only"
  - "supabase/tests/test_compute_job_claim_renewal.sql: SQL gate arms R1-R5, all twinned and biting"
  - "manual rollback that drops the function"
affects: [227-08 worker loop (calls the renew before each dispatch and from the heartbeat), 227-10 runbook and census pins]

actuals:
  tokens: 10400
  tasks: 2
  commits: 2
plan_head_before: 0bb1b4293909e4a12315e5039528ba704695348c
plan_head_after: e85ac0c0df25acd5970d67ceee8bdef535c065bf
commits: 2

tech-stack:
  added: []
  patterns:
    - "Token-fenced lease renewal: a row renews only under its own claim_token and status running; the watchdog NULLs the token, so a reset row can never be renewed by its old worker"
    - "Self-verify clauses on their own IF lines so each mutation twin can stand down exactly the clause it trips"

key-files:
  created:
    - supabase/migrations/20261124120200_compute_job_claim_renewal.sql
    - supabase/migrations/down/20261124120200-rollback.sql
    - supabase/tests/test_compute_job_claim_renewal.sql
    - supabase/schema/functions/renew_compute_job_claims.sql
  modified: []

key-decisions:
  - "DEC-03-A fence on claim_token plus status running, not on worker id"
  - "DEC-03-B no row-skipping lock clause: a row being reset waits, then sees the NULL token and renews nothing"
  - "DEC-03-C the function returns the renewed ids so the worker reads membership as ownership"
  - "The gate loads reset_stalled_compute_jobs from its generated snapshot file, not from migration 20260516104201 (see Deviations)"

requirements-completed: [HEAL-02]

coverage:
  - id: D1
    description: "A derive_allocator_equity row waiting 25 minutes behind batch-mates and renewed with its own token is not reset by the real watchdog with the worker's 20-minute override"
    requirement: HEAL-02
    verification:
      - kind: integration
        ref: "supabase/tests/test_compute_job_claim_renewal.sql#R1 (pg-lane, mutation runner RED (identity ok))"
        status: pass
    human_judgment: false
  - id: D2
    description: "A non-matching token, a non-running row, mismatched or NULL arrays and the ACL/search_path are each refused, proven behaviourally and from the catalogue"
    requirement: HEAL-02
    verification:
      - kind: integration
        ref: "supabase/tests/test_compute_job_claim_renewal.sql#R2-R5 (pg-lane, mutation runner RED (identity ok))"
        status: pass
    human_judgment: false
  - id: D3
    description: "The worker actually calls the renew (plan 08); this plan alone changes no production behaviour"
    requirement: HEAL-02
    verification: []
    human_judgment: true
    rationale: "Owned by plan 227-08; the database half cannot prove the worker wiring."
---

# Phase 227 Plan 03: Token-fenced claim renewal Summary

**`renew_compute_job_claims(uuid[], uuid[])`: a SECDEF, service_role-only RPC that moves `claimed_at` to now() only for rows still running under the caller's own claim token, proven on the pg-lane by five twinned gate arms.**

## Performance

- Duration: about 45 min
- Tasks: 2 (1 tracer, 1 TDD auto)
- Files: 4 created, 0 modified

## Accomplishments

- Migration `20261124120200_compute_job_claim_renewal.sql`: the function (SETOF uuid, SECURITY DEFINER, `search_path = public, pg_catalog`), a contract COMMENT, `REVOKE ... FROM PUBLIC, anon, authenticated` then `GRANT ... TO service_role`, and a catalogue-only self-verify (signature and SETOF uuid, secdef, exact search_path pin, comment-stripped body compares `claim_token` and `status = 'running'` and has no `SKIP LOCKED`, no PUBLIC/anon/authenticated EXECUTE, service_role holds EXECUTE). Header records the traced root cause, DEC-03-A to DEC-03-C and the rejected options B, C and D.
- Gate `test_compute_job_claim_renewal.sql`, arms R1 to R5, each with a prose RED-UNDER and a RED-UNDER-M twin; closing `ALL 5 ARMS EXECUTED` sentinel.
- Manual rollback `down/20261124120200-rollback.sql` (marker query first, precondition and verify, DROP FUNCTION with the exact signature, the worker's 42883 / PGRST202 "dispatch as today" note). Applied against the lane after the migration chain: drops cleanly.
- `supabase/schema/functions/renew_compute_job_claims.sql` snapshot added by `npm run schema:functions`; the regenerate touched nothing else.

## Task Commits

1. Task 1 (tracer): `537a40343` feat(227-03): renew_compute_job_claims token-fenced lease renewal and arm R1
2. Task 2: `e85ac0c0d` feat(227-03): fence arms R2-R5, catalogue self-verify and rollback

## Verification (verbatim)

Task 1 and Task 2 verify commands, run on the pg-lane through the mutation runner:

```
node scripts/lint-migration-data-dependence.mjs
lint-migration-data-dependence: corpus 327 migration(s), 409 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.
node scripts/lint-sql-gates.mjs
lint-sql-gates: scanned 113 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_claim_renewal.sql   -> exit 2 (diagnostic mode never exits 0)
  baseline  supabase/tests/test_compute_job_claim_renewal.sql — exit 0
  arm R1  exit 3  RED (identity ok)
  arm R2  exit 3  RED (identity ok)
  arm R3  exit 3  RED (identity ok)
  arm R4  exit 3  RED (identity ok)
  arm R5  exit 3  RED (identity ok)
arms: 5/5/0   (executed/annotated/waived)
biting: 5
lane-invocations: 5
No defects in the narrowed scope.
```

`npx tsx scripts/check-planning-hygiene.ts` stays OK. Acceptance criteria: `CREATE FUNCTION public.renew_compute_job_claims` count 1; snapshot present; `TEST FAILED (R` count 20 (at least 5); rollback file present.

## PROOF-01 transcript (gate RED first on neutered code with the named arm, byte restore, GREEN)

Run on the pg-lane with the gate's own apply list (the substitute for the local-stack lane, see below). The migration was backed up byte for byte first.

Step A, only the token predicate removed (`AND c.claim_token = r.tok` replaced by `AND TRUE`), self-verify left armed. The apply aborts, so the arm cannot run; this is the self-verify biting:

```
psql:supabase/migrations/20261124120200_compute_job_claim_renewal.sql:162: ERROR:  P0001: Migration 20261124120200 failed: renew_compute_job_claims no longer keys on claim_token, so a stale worker could renew a row the watchdog already took
```

Step B, the same removal plus the self-verify clause on `claim_token` stood down (`IF FALSE AND ...`), which is exactly the R2 twin. The gate goes RED on the named arm; R1 is green before it:

```
psql:supabase/tests/test_compute_job_claim_renewal.sql:130: NOTICE:  00000: R1 OK: a renewed row 25 minutes into its wait survived the real watchdog with the 20-minute derive override.
psql:supabase/tests/test_compute_job_claim_renewal.sql:201: ERROR:  P0001: TEST FAILED (R2): a renew with a token that is not the row's current claim_token returned {ce57b278-8a2c-4148-8f3d-fbe7b899891d} as renewed; a worker the watchdog already displaced would keep a row it no longer owns.
```

Restore: `cp <backup> supabase/migrations/20261124120200_compute_job_claim_renewal.sql; cmp -s <backup> <migration>` printed `cmp exit=0`.

Step C, restored, pristine gate: exit 0, `R1 OK` ... `R5 OK`, then `ALL 5 ARMS EXECUTED (R1,R2,R3,R4,R5)`.

The runner repeats the same proof for every arm: each twin is applied to a copy, the first `TEST FAILED` must name that twin's arm (`RED (identity ok)`), and the pristine baseline is GREEN (exit 0).

## Decisions Made

DEC-03-A, DEC-03-B and DEC-03-C as recorded in the plan and the migration header. No new architectural decision.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The gate loads `reset_stalled_compute_jobs` from its generated snapshot, not from migration `20260516104201`**
- **Found during:** Task 1
- **Issue:** The plan says to add `20260516104201_compute_jobs_audit_2026_05_07_residual.sql` to the gate's apply list. On the lane it aborts in its own verify block (`mark_compute_job_done missing NOT EXISTS set-based fan-in (H-0864)`): it re-bases `mark_compute_job_done`/`mark_compute_job_failed` and expects the fan-in migrations the claim-pair substrate does not carry. Pulling in that chain (as the retention and stuck-computing gates do, 8 to 15 more files, and the real claim-token migration whose bare COMMENT clashes with the two claim overloads) is far heavier than the arm needs.
- **Fix:** the apply list carries `supabase/schema/functions/reset_stalled_compute_jobs.sql` instead, right after fixture 36 and before `20260927120000`. That file is the canonical current body of the function, replayed from `supabase/migrations/**` by `npm run schema:functions`, and the migration it names as its source is exactly `20260516104201`. The arm therefore runs the real, latest watchdog body, not a copy.
- **Files modified:** supabase/tests/test_compute_job_claim_renewal.sql
- **Commit:** 537a40343

**2. [Rule 1 - Bug] The first self-verify clause on `claim_token` was vacuous**
- **Found during:** Task 2 (PROOF-01 step A)
- **Issue:** `position('claim_token' IN v_body) = 0` is never true: the parameter name `p_claim_tokens` contains the substring, so removing the token predicate did not abort the apply and the clause guarded nothing.
- **Fix:** the clause is `v_body !~* '\yclaim_token\s*='` (a word-bounded comparison, which `p_claim_tokens` cannot satisfy); the R2 twin's stand-down edit was updated to the new anchor. PROOF-01 step A then aborts the apply as shown above.
- **Files modified:** supabase/migrations/20261124120200_compute_job_claim_renewal.sql, supabase/tests/test_compute_job_claim_renewal.sql
- **Commit:** e85ac0c0d

**3. [Rule 3 - Blocking] The seed uses two api_key-scoped derive_broker_dailies rows, not "one strategy"**
- **Found during:** Task 1
- **Issue:** the plan says three pending jobs "for one strategy". `derive_allocator_equity` is allocator-scoped, and two `derive_broker_dailies` rows of one scope would hit the one-in-flight index, so no single strategy can host all three.
- **Fix:** two `derive_broker_dailies` rows on two api_keys (the coherence api_key arm) plus one `derive_allocator_equity` row on one allocator, claimed in one batch through the 5-arg claim called with all five arguments (the 2-arg form is ambiguous while both overloads exist, 42725).
- **Files modified:** supabase/tests/test_compute_job_claim_renewal.sql
- **Commit:** 537a40343

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). **Impact:** none on scope; all three are gate-substrate or self-verify precision.

## Substitution and what is left to CI

Docker is unavailable on this host, so `scripts/local-stack/run.sh up` could not run. Every gate run above used the pg-lane (`scripts/pg-lane/run.sh` through `node scripts/mutation-runner/run.mjs --file <gate>`), which is the lane this gate's RED-UNDER-SETUP targets. The local-stack proof (the `sql-tests` job running the corpus on the local Supabase stack) is left to CI; plan 10 owns the census pins, which this plan did not edit.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the SECDEF RPC the plan's threat model covers (T-227-08 token fence proven by R2, T-227-10 ACL and search_path proven by R5 and the self-verify).

## Next Phase Readiness

Plan 227-08 can call `renew_compute_job_claims` from the worker loop and heartbeat and treat 42883 / PGRST202 as "dispatch as today". `src/lib/compute-state.ts` still describes `claimed_at` as stamped once at claim; that comment is intentionally untouched here and is recorded in plan 10's runbook section.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261124120200_compute_job_claim_renewal.sql
- FOUND: supabase/migrations/down/20261124120200-rollback.sql
- FOUND: supabase/tests/test_compute_job_claim_renewal.sql
- FOUND: supabase/schema/functions/renew_compute_job_claims.sql
- FOUND commits: 537a40343, e85ac0c0d (both ancestors of HEAD; `git rev-list --count` from the plan base = 2)
