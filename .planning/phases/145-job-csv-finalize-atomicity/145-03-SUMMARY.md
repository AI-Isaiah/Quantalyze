---
phase: 145-job-csv-finalize-atomicity
plan: 03
subsystem: database
tags: [supabase, migration, plpgsql, security-definer, atomicity, sql-gate, csv-finalize]

requires:
  - phase: 145-01
    provides: "145-repro-harness.sql register (throwaway-cluster mechanism, claims idiom, anti-vacuity loader assertions) + the pre-fold test_csv_finalize_auth_guard.sql"
  - phase: 145-02
    provides: "145-REPRODUCTION.md final verdict (SC#1 CANNOT REPRODUCE, committed before any SC#2 code) + 145-DECISION.md (i-b) — Plan 03 is caller-agnostic but the ordering lock required both"
  - phase: 140.4 (SEAMRIM-03)
    provides: "20260728120000:196-311 — parent 1 (LATEST finalize_csv_strategy body) + the partial unique index the fold's 23505 rides"
  - phase: 19.1
    provides: "20260522111839:111-186 — parent 2 (ONLY persist_csv_daily_returns body) + the never-service_role grant rationale (:200-208)"
  - phase: 35
    provides: "20260624120000 csv_daily_returns per-key-axis shape the dailies INSERT is written against (B3)"
provides:
  - "supabase/migrations/20260819120000_csv_finalize_atomic_fold.sql — finalize_csv_strategy_with_returns: ONE SECDEF transaction writing strategies + strategy_verifications + csv_daily_returns, NO handler clause (D-07); DROPs both parents; authenticated-only grants; STEP 3 self-verify incl. comment-stripped no-handler regex"
  - "supabase/tests/test_csv_finalize_atomic_fold.sql — the SC#2 atomicity oracle EXECUTED at the deployed body + 'private'/default status (D-08) + trades-empty + 5000 cap"
  - "supabase/tests/test_csv_finalize_double_submit.sql re-pointed — Part 1 asserts dailies landed (economic oracle), Part 3 rollback widened to THREE tables (B1)"
  - "supabase/tests/test_csv_finalize_auth_guard.sql re-pointed — 42501 pair pins the fold's message literal; Part C pins both parents gone from pg_proc (B2, D-02)"
  - ".planning/phases/145-job-csv-finalize-atomicity/145-fold-harness.sql — full local proof rig: 20260624120000-shape dailies replica, both parent loaders, Migration B create_wizard_strategy replica"
affects: [145-04 (route caller re-point + Python deletion), 145-05 (TS gates + docs), 145-06 (TEST apply + merge gate), gsd-verifier]

actuals:
  tokens: 32268   # chars/4 over the realized 5-file diff (git show HEAD | wc -c = 129,075)
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Folded SECDEF transaction: multi-table atomicity via ONE plpgsql body with no handler clause, pinned by a comment-stripped 'EXCEPTION[[:space:]]+WHEN' regex in the migration's own self-verify"
    - "Atomicity oracle: gate injects a mid-payload data fault at the deployed body and asserts zero rows in ALL written tables — never re-types the predicate"
    - "Neuter matrix driven from MECHANICAL extractions of the committed migration (awk/sed pulls of STEP 1 and STEP 3), so restores and re-checks run the deployed text, not a retyped copy"

key-files:
  created:
    - supabase/migrations/20260819120000_csv_finalize_atomic_fold.sql
    - supabase/tests/test_csv_finalize_atomic_fold.sql
    - .planning/phases/145-job-csv-finalize-atomicity/145-fold-harness.sql
    - .planning/phases/145-job-csv-finalize-atomicity/deferred-items.md
  modified:
    - supabase/tests/test_csv_finalize_double_submit.sql
    - supabase/tests/test_csv_finalize_auth_guard.sql

key-decisions:
  - "Atomicity-oracle SQLSTATE pinned at CLASS 22, not code 22007 — a PG major bumping the code within class 22 is not a regression of the guarantee under test"
  - "Part 3c's non-vacuity proven with a gate-variant (scratch copy, Part 2 assertions disabled) because within one RPC statement partial state can only survive via a SWALLOWING handler — a re-raising one rolls everything back, so 3c is unreachable while 2a is green"
  - "Harness extended beyond the plan's two named additions (profiles/api_keys/create_wizard_strategy Migration B replica + auth.role() stub) — Rule 3: the four-gate run cannot execute without them"

metrics:
  duration: 24m
  completed: 2026-08-17

status: complete
---

# Phase 145 Plan 03: csv-finalize atomic fold Summary

One SECURITY DEFINER transaction (`finalize_csv_strategy_with_returns`) now writes strategies + strategy_verifications + csv_daily_returns with no handler clause — a mid-body fault provably leaves ZERO rows in all three tables (executed, not grepped) — and both parent RPCs are DROPped with every SQL gate re-pointed in the same commit (`9fc09dca`).

## Commit

**`9fc09dca`** — `feat(145-03): fold csv-finalize into one SECDEF transaction + re-point all gates in the same commit` — the five-file same-commit set (B1/B2): migration + three gate files + harness. Verified via `git show --stat`; zero hunks on `20260816140000` / `20260817120000` (D-10, verified by `git show HEAD -- <both> | wc -l` = 0).

## Task outcomes

| Task | Outcome |
|------|---------|
| 1 (tracer) | Migration authored at prefix `20260819120000` (tip re-verified `20260817120000`). Fail-loud STEP 0 observed raising on a bare cluster (exit 3); harness apply + migration apply green; STEP 3 self-verify passed; all eight behavioral observations green (below). Verify chain: `SECURITY DEFINER`×6, fold name×31, comment-stripped handler-pair count 0, `prosecdef=t`. |
| 2 | Both existing gates re-pointed at the 6-arg fold; `test_csv_finalize_atomic_fold.sql` authored (5 parts, reconcile-sweep register); all FOUR gates green on the harness cluster (incl. `test_wizard_session_idempotency.sql` — the verify-don't-assume check that the partial index is untouched). Single commit `9fc09dca`. |
| 3 | Neuter-RED matrix: 8 required neuters + 3 extra observations, all RED with verbatim output, all restores GREEN. Zero vacuous assertions found. |

## Tracer observations (verbatim, throwaway PG 16.13, db q145f)

1. `OBS1 happy path: returned id=1cc685f9-…, strategies.status=pending_review, sv_count=1, dailies_count=10, first_row=(2026-01-01 , 0)`
2. `OBS2 double submit: raised=t, sqlstate=23505, msg=duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq", counts before=(1,1,10) after=(1,1,10)` — the widened all-or-nothing check
3. `OBS3 private: … strategies.status=private` (D-08)
4. `OBS4 trades-empty: returned id=14b42688-…, dailies_count=0, sv_count=1`
5. `OBS5 cap: raised=t, sqlstate=22023, msg=finalize_csv_strategy_with_returns: p_rows exceeds 5000 rows (got 5001)`
6. `OBS6 atomicity oracle: raised=t, sqlstate=22007, msg=invalid input syntax for type date: "not-a-date", strategies=0, verifications=0, dailies=0` — **the SC#2 mechanism, executed**
7. `OBS7 no-session: raised=t, sqlstate=42501, msg=finalize_csv_strategy_with_returns called without an auth session` (exact literal Part A pins)
8. `OBS8 identity mismatch: raised=t, sqlstate=42501, msg=…does not match auth.uid (…)`

Fail-loud proof (a): on a bare cluster the migration exited 3 with `145 FOLD ABORT (STEP 0): expected exactly one 5-arg public.finalize_csv_strategy to fold and DROP, found 0 …`.

## Neuter-RED matrix (all on the throwaway cluster; repo files never edited for a neuter; variants generated by verified-differing transforms of the mechanically-extracted real body)

| # | Neuter (fold-body variant unless noted) | Gate / part | Observed RED (verbatim head) | Restored |
|---|---|---|---|---|
| 1 | Handler clause swallowing the dailies-INSERT error | atomic_fold Part 2a AND migration STEP 3 (e) | `Part 2a: … SUCCEEDED and returned 64875823-… - the dailies cast is not running` AND `STEP 3: … contains a handler clause - a swallowed error can commit a strategies row without its dailies` — the D-07 pair | GREEN |
| 2 | Dailies INSERT removed (two-RPC shape) | double_submit Part 1d; atomic_fold Part 2a | `Part 1d: 0 csv_daily_returns rows … expected 3 … the two-RPC orphan shape is back`; oracle premise collapse visible (`Part 2a: … SUCCEEDED`) | GREEN |
| 3 | `p_terminal_status` forced to `'pending_review'` internally | atomic_fold Part 3a | `Part 3a: a p_terminal_status='private' call wrote strategies.status=pending_review … every CONTRIB-02 private contribution now lands in the admin publish queue (D-08)` | GREEN |
| 4 | Parents' empty-array 22023 copied verbatim | atomic_fold Part 4 (unhandled, ON_ERROR_STOP) | `ERROR: finalize_csv_strategy_with_returns: p_rows is empty` (exit 3) | GREEN |
| 5 | 5000 cap removed | atomic_fold Part 5a | `Part 5a: a 5001-row payload SUCCEEDED and returned a8973570-…` | GREEN |
| 6 | `wizard_session_id` dropped from the strategies INSERT | STEP 3 (c) AND double_submit Part 1c | `STEP 3: … does not write wizard_session_id in its strategies INSERT` AND `Part 1c: … carries wizard_session_id=<NULL>` — two independent reds | GREEN |
| 7 | Grants left at CREATE-default (simulated `GRANT … TO PUBLIC`) | STEP 3 (b) AND atomic_fold Part 1 | `anon holds EXECUTE on finalize_csv_strategy_with_returns - an unauthenticated browser can POST /rest/v1/rpc/… directly` (both files) — the DROP-loses-ACLs trap made checkable | GREEN |
| 8 | Gates run against a cluster with parents present, NO fold (db q145pre) | all three gates' first executable parts | atomic_fold Part 1: `does not exist - migration 20260819120000 is not applied`; auth_guard Part A: `got 42883`; double_submit: `function …_with_returns(…) does not exist` — genuinely ungated, no green-skip | n/a (separate db) |
| 8c | (same cluster) Part C run standalone | auth_guard Part C | `Part C: 2 pre-fold csv-finalize function(s) still present in pg_proc: finalize_csv_strategy(5 args), persist_csv_daily_returns(3 args)` | n/a |
| 9 | Both 42501 guards deleted | auth_guard Part A; Part B (run standalone, file aborts at A) | Part A: `expected SQLSTATE 42501 … got 23503 (… violates foreign key constraint "strategies_user_id_fkey") - the guard was weakened or replaced`; Part B: same shape | GREEN |
| 10 | 23505 swallowed + shifted-date dailies merged onto the existing row + existing id returned | double_submit Part 2a; Part 3c (via scratch gate-variant with Part 2 assertions disabled — committed file untouched) | `Part 2a: the SECOND … SUCCEEDED`; `Part 3c: 6 csv_daily_returns rows … expected exactly 3 … the fold's all-or-nothing rollback is broken` — proves the widened third-table assertion non-vacuous | GREEN |

Final state: real body restored on q145f; `test_csv_finalize_atomic_fold.sql` + `test_csv_finalize_auth_guard.sql` re-run GREEN (Task 3 verify, exit 0).

## A6 pre-drop grep — disposition table (297 hits, fresh at HEAD `083fbc5c`, 2026-08-17T19:52Z; full output in the executor session)

| Hit class (files) | Disposition |
|---|---|
| `supabase/tests/test_csv_finalize_double_submit.sql`, `test_csv_finalize_auth_guard.sql` | **Re-pointed by this commit** (B1/B2). Post-commit grep confirms ZERO call-target references to old names in `supabase/tests/` |
| `supabase/tests/test_wizard_session_idempotency.sql` (1 hit) | Comment only (names the behavioural receipt file) — no action; gate verified green on the harness |
| `src/app/api/strategies/csv-finalize/route.ts` (31: 2 call-site lines :1471/:1483 + comments), `src/lib/process-key-client.ts`, `wizardErrors.ts`, `analytics-schemas.ts`, `draft-query.ts`, `finalize-wizard/route.ts` | **Call sites + comments re-pointed by Plan 04** (D-06 (i-b) caller wiring — locked scope) |
| `analytics-service/routers/process_key.py` (call site :1151 + comments), `routers/csv.py`, `services/db.py`, `services/csv_validator.py`, `services/analytics_runner.py`, `services/job_worker.py` | **Plan 04** — the Python csv-finalize branch becomes dead code and is deleted (D-06 obligation 2); remaining hits are comments updated there |
| TS tests: `route.test.ts`, `csv-validate-route.test.ts`, `csv-finalize-rpc.test.ts` (skipIf live-DB — counts for nothing, Pitfall 7), `csv-finalize-after-failloud.test.ts`, `csv-finalize-cross-submission-merge.test.ts`, `strategy-verifications-rls.test.ts`, `strategies-source-csv-constraint.test.ts`, `process-key-client.test.ts`, `reconcile-dropped-enqueue-sweep.test.ts` (comment) | **Plan 04/05** — mock/test re-points travel with the caller change; none runs SQL |
| `src/__tests__/audit-coverage.test.ts:209` (`MUTATING_RPC_NAMES`) | ⚠️ **Plan 04 must ADD `finalize_csv_strategy_with_returns`** — the regex requires a closing quote after the name, so the fold's route call sits outside the audit law until added (deferred-items.md #3) |
| `src/lib/database.types.ts:3715/:3943` | ⚠️ Generated types carry BOTH dropped RPCs (contra RESEARCH's inventory claim). No compile break (routes cast through unknown); regenerate/prune in Plan 04 (deferred-items.md #2) |
| pytest: `test_process_key.py` (17), `test_db.py`, `test_mt5_golden_fixtures.py`, `test_csv_daily_returns_*_live.py`, `test_persist_csv_daily_returns_live.py` (live-only, never CI) | **Plan 04** — re-pointed/retired with the Python deletion (deferred-items.md #4 for the live file) |
| Historical migrations (`20260501055202`, `20260716130500`, `20260522111839`, `20260728120000`, `20260624120000`, `20260816140000`, `20260506211806`, `20260521185008`, `20260626120000`, `20260501055213`, `20260726000225`) | Immutable history / comments — never edited (D-10 for 143/144; house law for the rest) |
| `supabase/schema/functions/finalize_csv_strategy.sql`, `persist_csv_daily_returns.sql` (+1 comment hit each in `finalize_wizard_strategy.sql`, `get_verified_cohort_rank.sql`) | ⚠️ `@generated` snapshots now documenting dropped functions — regenerate via `npm run schema:functions` from a node-capable checkout (deferred-items.md #1); reference-only, not executed by CI |

No undispositioned hit remained; the DROP proceeded.

## Deviations from Plan

### Auto-fixed / adapted

**1. [Rule 3 - Blocking] Harness extended beyond the plan's two named additions**
- **Found during:** Task 1(4)/Task 2(4)
- **Issue:** the plan's harness spec named only the dailies replica + both parent loaders, but Task 2(4) requires running `test_csv_finalize_double_submit.sql` (Part 4 calls the REAL `create_wizard_strategy`) and `test_wizard_session_idempotency.sql` (reads that function's body canaries + grant polarity) on the harness cluster
- **Fix:** added minimal `profiles`/`api_keys` replicas, an `auth.role()` stub, the `service_role` role, and the VERBATIM Migration B (`20260814120000:151-313`) `create_wizard_strategy` loader with its grants + a third anti-vacuity assertion (comment-stripped no-`v_auth_uid` — the measured 3e detector)
- **Files:** `.planning/phases/145-job-csv-finalize-atomicity/145-fold-harness.sql`; **Commit:** `9fc09dca`

**2. [Adaptation] Verify commands run `psql` via `/opt/homebrew/opt/postgresql@16/bin`** — `psql` is not on PATH in this environment; identical invocation otherwise. Also: the first bare-cluster proof initially echoed `EXIT=0` from a piped `tail` (the known `$?`-after-pipe trap); re-run unpiped and recorded honestly: **exit 3**.

**3. [Note] Commits made on `feat/v1.19-phase-145`** — the branch the orchestrator explicitly designated for this worktree (not a protected ref; the generic per-agent-branch namespace check is superseded by that explicit instruction).

### Not deviations
- The three re-pointed/new SQL gates are **designed-RED on the shared TEST project** at their first executable parts until Plan 06 applies `20260819120000` there — stated in each file's header and proven ungated by neuter 8.

## Known Stubs

None — no hardcoded empty values flowing to UI, no placeholder text, no unwired surfaces in the five committed files. (The stale `@generated` schema snapshots are tracked in deferred-items.md #1 with a Plan 04/05 owner, not left silent.)

## What could NOT be verified here (and why)

- **TEST/PROD apply** — no Supabase MCP in this session by design; TEST apply + live exercise is Plan 06 (orchestrator-only). The migration is proven on a local PG 16.13 cluster only.
- **`sql-tests` CI behavior** — needs `TEST_SUPABASE_DB_URL`; the designed-RED-until-Plan-06 sequencing is asserted from file structure + neuter 8, not from a CI run.
- **TS-side effects** (audit-coverage list, database.types staleness) — no node_modules in this worktree; dispositioned to Plan 04 rather than half-verified here.

## Self-Check: PASSED

- `supabase/migrations/20260819120000_csv_finalize_atomic_fold.sql` — FOUND
- `supabase/tests/test_csv_finalize_atomic_fold.sql` — FOUND
- `supabase/tests/test_csv_finalize_double_submit.sql` — FOUND (modified)
- `supabase/tests/test_csv_finalize_auth_guard.sql` — FOUND (modified)
- `.planning/phases/145-job-csv-finalize-atomicity/145-fold-harness.sql` — FOUND
- Commit `9fc09dca` — FOUND in `git log`
- Zero hunks on `20260816140000` / `20260817120000` in `9fc09dca` — VERIFIED
