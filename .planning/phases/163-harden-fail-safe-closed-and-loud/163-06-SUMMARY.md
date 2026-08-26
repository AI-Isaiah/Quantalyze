---
phase: 163-harden-fail-safe-closed-and-loud
plan: 06
subsystem: database
tags: [postgres, plpgsql, migration, compute-jobs, mvcc, security-definer, acl]

requires:
  - phase: 106-backbone-unification
    provides: the retired-kind RPC admission guard on both enqueue overloads, which this migration must preserve
  - phase: audit-2026-05-07 (mig 109 / P3)
    provides: the 7-param overload's plain re-read + serialization_failure pattern that this replicates
provides:
  - 10-param `_enqueue_compute_job_internal` lost-race re-reads de-strict-ed across all four target arms
  - a classified, retry-safe `serialization_failure` raise replacing an opaque NO_DATA_FOUND 500
  - ACL re-convergence on the 10-param SECURITY DEFINER overload (mig 118 end state re-issued)
  - `supabase/tests/test_enqueue_internal_destrict.sql` — a recurring pg_get_functiondef gate
affects: [OPS-08, SC-3, compute-jobs queue, worker enqueue paths, sql-tests CI lane]

actuals:
  tokens: 9528
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Gate assertions match a COMMENT-STRIPPED pg_get_functiondef, so prose in a function body cannot vouch for behaviour the body lacks (T-163-16, demonstrated)"
    - "A migration that CREATE OR REPLACEs a SECURITY DEFINER function re-converges its ACL rather than only asserting it"
    - "Count-based gate arms report the count they found, so the pre-apply RED states the measured number out loud"

key-files:
  created:
    - supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql
    - supabase/tests/test_enqueue_internal_destrict.sql
  modified: []

key-decisions:
  - "Re-converge the ACL instead of only asserting it — assert-only would have failed the PROD deploy on merge if the Supabase default-grant event trigger fired"
  - "Match on comment-stripped function definitions — the green-wash hole was demonstrated, not hypothesised"
  - "Part 2 counts the four arms, because a de-strict is also achievable by deleting them"
  - "No `ALL N ARMS EXECUTED` sentinel — it would require editing ci.yml, which another Phase 163 workstream owns; recorded as a known limit"

metrics:
  duration: ~75 min
  completed: 2026-08-26

status: complete
---

# Phase 163 Plan 06: OPS-08 INTO STRICT de-STRICT Summary

The 10-param `_enqueue_compute_job_internal` now re-reads its four lost-race branches
without the strict form and raises `serialization_failure` when the winner already
advanced — parity with the 7-param overload, delivered as a forward-only migration whose
gate was observed RED before the fix and GREEN after, on a real Postgres.

## What shipped

| Artifact | Purpose |
|---|---|
| `supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql` | Forward-only `CREATE OR REPLACE` of the 10-param overload, re-based on the verified head `20260716090000`; ACL re-convergence; extended self-verifying DO block |
| `supabase/tests/test_enqueue_internal_destrict.sql` | Recurring 5-arm gate asserting the DEPLOYED body via `pg_get_functiondef` |

Commits: `18d572dd` (migration), `b25f29bc` (gate), `55f45c62` (review fixes).

## The RED proof

⭐ **Gate token counted PRE-EDIT**, as required: the statement form `INTO STRICT v_`
occurred **4 times** in the current 10-param body (`20260716090000:285,292,299,306`) and
**0 times** in the 7-param body. Verified before any file was written.

The plan scheduled the RED→GREEN flip for the TEST project. I could not reach TEST (see
Blockers), so the flip was instead demonstrated on a **throwaway Postgres 16 container**
seeded with a minimal `compute_jobs` schema, the three Supabase roles, the real
`20260716090000` definitions, and mig 118's ACL end state. This is strictly stronger than
the planned proof: it also covers three mutants, an ACL-drift scenario, and the behavioural
delta the requirement is actually about.

**1. Gate RED against the pre-fix deployed body** — and it reported the measured 4:

```
ERROR:  OPS-08 Part 1 FAILED: the deployed 10-param body still carries 4 strict
lost-race re-read(s) (expected 0; the pre-fix definition 20260716090000 carries
exactly 4, one per target scope). ...
```

**2. Behavioural delta** — the lost-race branch driven deterministically (winner row already
advanced to `done`, so the optimistic look-up misses, `ON CONFLICT DO NOTHING` fires, and
the in-flight-filtered re-read returns empty — the real control flow, staged rather than
concurrent):

| | SQLSTATE | Message |
|---|---|---|
| before | `P0002` | `query returned no rows` — no domain context, opaque 500 |
| after | `40001` | `_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=…, portfolio=…, allocator=…, api_key=…, kind=…)` |

**3. Gate GREEN after applying the migration** — all five parts, then
`test_enqueue_internal_destrict: parts 1, 2, 3, 4 and 5 executed.`

**4. Mutation tests — every arm proven able to fail:**

| Mutant | Result |
|---|---|
| A: allocator lost-race arm deleted | Part 1 **passed**, Part 2 caught it (`contains 3 … expected 4`) — exactly why Part 2 exists |
| B: `serialization_failure` → `no_data_found` | Part 3 caught it |
| C: raise gutted **and** a comment quoting the old ERRCODE clause added | ⚠️ **passed GREEN before hardening** — see Deviations. After hardening: Part 3 caught it, and the migration's own deploy-time DO block refused the deploy |

**5. Regression** — the verbatim-copied paths still behave: fresh insert, optimistic replay
returning the same id, allocator arm, api_key arm, retired-kind reject, 4-way XOR guard.
**6. Idempotency** — the migration applied cleanly three times in a row.

## Three-reviewer gate

⚠️ **Read this before merging — the gate was NOT run as specified.** I have no Agent/Task
tool in this executor's tool surface, and only one of the three named agents
(`silent-failure-hunter`) exists on this machine; `migration-reviewer` and
`rls-policy-auditor` have no definition anywhere under `~/.claude`. I ran three distinct
review passes **myself** against those criteria (silent-failure-hunter from its actual
definition; the other two against the repo's own migration and RLS invariants and the
finding format in `.review/specialist.data-migration.jsonl`).

What that buys and what it does not: the passes found and fixed a critical defect, so they
were not ceremonial. But **independence is the property a separate reviewer provides, and
this substitution does not have it** — the author reviewed the author. If the standing rule
is meant to survive, run the real three before merging.

### Pass A — migration review

| # | Severity | Finding | Resolution |
|---|---|---|---|
| A1 | **critical** | `CREATE OR REPLACE` on this function family can have its ACL re-opened by Supabase's default-grant EVENT TRIGGER — mig 118 records that firing on mig 109's CREATE and leaving the 7-param overload EXECUTE-grantable to `anon`/`authenticated`. My first draft only *asserted* the ACL, which on a project where the trigger fires would have **failed the PROD deploy on merge**, blocking OPS-08 on an unrelated condition and leaving the grant open anyway. | **Fixed** (`55f45c62`): re-issue mig 118's `REVOKE`/`GRANT` for the 10-param signature (idempotent, byte-identical), then assert. Proven: applied onto a database where `anon` had EXECUTE, it converges (`anon=f`, `service_role=t`) and exits 0. |
| A2 | medium | `has_function_privilege('anon', …)` raises `role "anon" does not exist` if the role is absent — a cryptic failure on a blocked deploy. | **Fixed**: `to_regrole()` existence check first, with a message naming the actual condition. |
| A3 | low | Header did not state reversibility, unlike the `20260716090000` precedent. | **Fixed**: reversibility paragraph added. |
| A4 | info | Re-base verified at HEAD: 105 references across 14 files, only 6 are a `CREATE OR REPLACE` of either overload, newest is `20260716090000`. `git diff` confirms **zero** changes to any applied migration. | No action — recorded in the header. |
| A5 | info | The unqualified `CREATE` relies on `search_path`, but the failure is self-detecting: if it landed outside `public`, the public-qualified `COMMENT` and the DO block's `to_regprocedure` would still see the OLD body and arm (c) would fail the deploy. | No action. |
| A6 | info | `SET LOCAL lock_timeout='3s'` is a no-op outside a transaction (observed as a WARNING in the scratch harness). Supabase wraps each migration, so it applies there; precedent-identical. Under PROD contention the deploy fails loudly rather than hanging — accepted. | No action. |

### Pass B — RLS / privilege review

| # | Severity | Finding | Resolution |
|---|---|---|---|
| B1 | **critical** | Same as A1 — the ACL surface on a `SECURITY DEFINER` queue-internals function. | **Fixed**, as above. |
| B2 | info | `SECURITY DEFINER` and `SET search_path = public, pg_catalog` preserved byte-exactly and now asserted on **both** overloads at deploy time and on every CI run. No RLS policy is touched; the function bypasses RLS as owner, unchanged. | No action. |
| B3 | info | The new classified message names four UUIDs (`strategy_id`, `portfolio_id`, `allocator_id`, `api_key_id`) plus `kind`. These are internal row ids, **not** key material — `p_api_key_id` references an `api_keys` row, it is not the key. The 7-param precedent already names two of them. Callers should still not surface raw DB messages to end users. | No action; recorded. |

### Pass C — silent-failure hunt

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | **high** | **The gate could be green-washed by prose.** Demonstrated, not theorised: a body whose raise was changed to `no_data_found`, carrying one comment line reading `historically this was USING ERRCODE = 'serialization_failure';`, passed Parts 3 and 5 **GREEN**. The plan's mitigation for T-163-16 was a convention ("phrase prose as 'the strict re-read'"), and a convention does not survive the next editor. | **Fixed**: every arm in both the gate and the migration's DO block now matches a **comment-stripped** copy (`regexp_replace(…, '--.*', '', 'gn')`). Re-ran mutant C: Part 3 RED, and the deploy-time DO block refuses the deploy. |
| C2 | medium | Removing the strict form without adding the raise would make a lost race return **NULL silently** — worse than the 500 being removed. | Already covered: Part 3 + DO-block arm (d) pin the raise in both overloads, both proven able to fail. |
| C3 | medium | The requirement calls the new error "retry-safe", which implies a retrier. `_is_serialization_failure` in `main_worker.py` classifies any `.code == '40001'`, but it is wired into the **mark/defer** paths, not the enqueue paths — and no enqueue call site (15 found across `src/` and `analytics-service/`) was observed to retry on 40001. | **Not a regression** — the 7-param overload has raised 40001 since mig 109 and is in the same state, and a classified 40001 is strictly more actionable than an unclassifiable P0002. Recorded as follow-up, not fixed here: wiring an enqueue-side retry is app-layer work outside this plan's declared files. |
| C4 | low | Gate arms 2 and 4 use counts rather than presence, so an arm silently disappearing is caught rather than tolerated. | No action — this is the intended design. |
| C5 | low | If a future message literal ever contains a `--` sequence, the comment strip truncates that literal before matching. Direction is safe: **false failure, never false pass**. Verified at HEAD — every dash in these messages is U+2014. | Documented in both files. |

## Deviations from Plan

**1. [Rule 2 — missing critical functionality] Gate hardened against comment green-wash**
- **Found during:** Task 3, silent-failure pass (C1)
- **Issue:** The plan's mitigation for its own threat T-163-16 was a naming convention. I demonstrated it does not hold: a gutted body passed GREEN on the strength of a comment.
- **Fix:** Both the gate and the migration's DO block match comment-stripped definitions.
- **Files:** both. **Commits:** `18d572dd`, `b25f29bc` (as written), re-proven after `55f45c62`.

**2. [Rule 2 — missing critical functionality] ACL re-convergence added**
- **Found during:** Task 3, migration/RLS passes (A1/B1)
- **Issue:** Plan said "grants are not touched, CREATE OR REPLACE preserves ACLs". True of the REPLACE, but not the only actor — mig 118 documents Supabase's default-grant event trigger re-opening EXECUTE on this exact family.
- **Fix:** Re-issue mig 118's REVOKE/GRANT, then assert. **Commit:** `55f45c62`.

**3. [Scope, deliberate] Two gate arms beyond the plan's three**
The plan named assertions (a) zero strict re-reads, (b) the raise, (c) the retired-kind
clause. I added Part 2 (four arms present) and Part 4 (7-param parity). Part 2 earned its
place immediately: mutant A satisfied Part 1 by deleting an arm.

**4. [Scope, declined] No `ALL N ARMS EXECUTED` sentinel**
Declaring one requires editing `.github/workflows/ci.yml` (`SENTINEL_FLOOR`, `ARMS_FLOOR`,
the per-file derivation table) or `ci-anti-skip-gate.contract.test.ts` goes red. That file
is outside this plan's declared files and another Phase 163 workstream is editing it
concurrently. Verified the omission is safe: the contract test passed 18/18 with the new
file present. Consequence recorded in the file header and below.

## Verification

| Check | Result |
|---|---|
| Task 1 automated verify (0 gate tokens in migration, ≥1 `serialization_failure`) | PASS (0 / 12) |
| Task 2 automated verify (`DO $$` present, no backslash meta-commands) | PASS |
| Applied migration `20260716090000` unchanged | PASS — `git diff` empty |
| Anti-SKIP preflight shapes (no `RAISE NOTICE 'SKIP:`, no `\` meta-commands) | PASS |
| `ci-anti-skip-gate.contract.test.ts` with the new file in the corpus | PASS 18/18 |
| Gate RED pre-apply / GREEN post-apply | PASS, on scratch Postgres 16 |
| Mutants A, B, C each caught | PASS (C only after the C1 fix) |
| Idempotency (3 consecutive applies) | PASS |
| Regression on verbatim-copied paths | PASS |

## Blockers

**The TEST hand-apply did not happen — it is not reachable from here.** `TEST_SUPABASE_DB_URL`
is a CI secret and there is no env file in this worktree. The plan's Task 3 asked for the
flip to be observed on TEST; the substantive property (the gate is falsifiable, and RED for
the right reason) is proven above on a real Postgres, but **CI's `sql-tests` lane will be RED
for this file until someone applies `20260826150000` to the TEST project by hand.** That RED
is expected and is documented in the test file's own header so it is not misread as a defect.

⛔ PROD was not touched and was never queried. Merging `supabase/migrations/**` to main
auto-applies to PROD; that merge is the founder's call.

## Known Stubs

None. No placeholder values, no unwired paths.

## Follow-ups

1. **Wire an enqueue-side retry on 40001** (C3). Pre-existing for the 7-param overload since
   mig 109; the DB contract is now correct on both, the app-layer retry is not verified.
2. **Give this gate a completion sentinel** once `ci.yml` is free — needs `SENTINEL_FLOOR` 7→8,
   `ARMS_FLOOR` 63→68, and a derivation-table row. Until then an arm neutered in place would
   exit 0 unnoticed, as with the other ~60 sentinel-free files in the corpus.
3. **Run the real three reviewers** before merge, if the standing rule is to mean anything.

## Threat Flags

None. No new network endpoint, auth path, file access or trust-boundary schema change. The
migration narrows privilege surface (re-converges an ACL) rather than widening it.

## Self-Check: PASSED

All three artifacts verified present on disk; all three commit hashes verified in `git log`.
SUMMARY and both shipped files scanned clean for the macOS username and `/Users/` absolute paths (0 occurrences each), per the plan's constraint that 163-03's scanner will read this file.

## State updates deliberately NOT made

**`REQUIREMENTS.md` OPS-08 left unchecked (`:68`, and `Pending` at `:162`).** The
requirement is worded as a property of the *deployed* function — "no longer uses
`INTO STRICT` on its lost-race branches". That is true of the repo and of a scratch
Postgres; it is **not** true of TEST or PROD, because neither has received the migration.
Ticking it now would be closing a requirement by assertion rather than by measurement.
Close it when the TEST apply lands and the `sql-tests` lane goes green.

**`STATE.md` plan counter / progress bar not advanced.** Six Phase 163 plans run in
parallel worktrees against the same file; a per-agent increment races. That belongs to the
wave orchestrator, once.
