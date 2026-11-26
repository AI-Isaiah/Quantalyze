---
phase: 253-binancecursor-a-stopped-binance-fills-read-below-a-cursor-th
plan: 01
subsystem: database
tags: [postgres, supabase, rls, security-definer, sql-gate, binance, sync-cursor]
requires: []
provides:
  - "public.strategy_fills_reread_bounds (strategy_id PK, api_key_id, unread_from, updated_at; deny-all RLS; service_role only)"
  - "public.set_strategy_fills_reread_bound(uuid, uuid, uuid, uuid, timestamptz, timestamptz) RETURNS boolean, claim-token fenced SECURITY DEFINER"
  - "supabase/tests/test_strategy_fills_reread_bound.sql, 24 annotated arms, all biting"
  - "supabase/migrations/down/20261126140000-rollback.sql"
affects: [253-02, 253-03, 253-04]
tech-stack:
  added: []
  patterns: ["per-strategy bound table beside the per-key column", "fence copied from the per-key cursor RPC", "RED-UNDER-M twin per arm"]
key-files:
  created:
    - supabase/migrations/20261126140000_strategy_fills_reread_bound.sql
    - supabase/migrations/down/20261126140000-rollback.sql
    - supabase/tests/test_strategy_fills_reread_bound.sql
  modified: []
key-decisions:
  - "D-01 design (b): the bound lives in its own per-strategy table; api_keys.last_fetched_trade_timestamp and advance_sync_cursor are byte-unchanged (D-04)."
  - "The migration stamp 20261126140000 stayed valid: origin/main's latest migration is 20261125212222 (re-measured after git fetch before writing)."
  - "The function's EXECUTE-ACL verify asserts no PUBLIC/anon/authenticated grantee and a service_role grant, not 'exactly owner plus service_role', so an unrelated future grantee cannot refuse the PROD apply."
status: complete
actuals:
  tokens: 15900
  tasks: 3
  commits: 2
plan_head_before: a64150b29fb8825d9e1f5008da4a3ffad9767631
plan_head_after: fbb2aa02a3d686d3b59310a8c54a0f446e5da5ea
commits: 2
---

# Phase 253 Plan 01: per-strategy fills re-read bound (SQL half) Summary

A per-strategy re-read bound table and its one claim-token fenced SECURITY DEFINER writer, with a 24-arm SQL gate in which every arm goes RED under its own twin on the pg-lane.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 (tracer) | 94f7ef268 | feat(253-01): per-strategy fills re-read bound table, fenced RPC and tracer gate arms |
| 2 | fbb2aa02a | test(253-01): every case, fence, ACL, policy and cascade arm for the re-read bound, plus manual rollback |
| 3 | none | PROOF-01 on the migration: no file changed (the neuters were restored byte-identical), so there is nothing to commit |

`commits: 2` is MEASURED from the ledger (`git rev-list --count a64150b29..HEAD` before this SUMMARY's own commit).

## What shipped

- Migration `supabase/migrations/20261126140000_strategy_fills_reread_bound.sql`: table, deny-all policy `strategy_fills_reread_bounds_deny_all` (FOR ALL, USING false, WITH CHECK false), `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT ALL ... TO service_role`, and the RPC per THE RPC CONTRACT (rules 1 to 6, branches R0 to R7). `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` plus `GRANT EXECUTE ... TO service_role` both stated. The closing `DO $verify$` block reads catalogues only (table, primary key column set, relrowsecurity, policy polcmd '*', prosecdef, proconfig search_path, EXECUTE grantees) and never calls the function.
- Gate `supabase/tests/test_strategy_fills_reread_bound.sql`: arms 0, SEED 1, GRANT 1, EXEC 1, SECDEF 1, C0 to C10, FENCE 1, FENCE 2, NULL-ID, POLICY 1, POLICY 2 precondition, POLICY 2, RESTORE 1, CASCADE 1. No `ALL N ARMS EXECUTED` sentinel line, so ci.yml's SENTINEL_FLOOR census does not move.
- Rollback `supabase/migrations/down/20261126140000-rollback.sql`: drops the function and the table; header carries the `psql --single-transaction` usage, the CLAUDE.md marker query, the ledger-row note and the data-loss note; catalogue-only pre and post DO blocks; no transaction statements.

## PROOF-01 (verbatim)

### Per-arm twins (the runner, pg-lane, no Docker)

Command: `node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_fills_reread_bound.sql` (full output saved at `.../scratchpad/253/plan01/runner-final.txt`):

```
  baseline  supabase/tests/test_strategy_fills_reread_bound.sql — exit 0 (1.0s)
  arm 0                        exit   3  RED (identity ok)  (1.1s)
  arm SEED 1                   exit   3  RED (identity ok)  (1.1s)
  arm GRANT 1                  exit   3  RED (identity ok)  (1.2s)
  arm EXEC 1                   exit   3  RED (identity ok)  (1.1s)
  arm SECDEF 1                 exit   3  RED (identity ok)  (1.1s)
  arm C0                       exit   3  RED (identity ok)  (1.1s)
  arm C1                       exit   3  RED (identity ok)  (1.1s)
  arm C2                       exit   3  RED (identity ok)  (1.1s)
  arm C3                       exit   3  RED (identity ok)  (1.1s)
  arm C4                       exit   3  RED (identity ok)  (1.5s)
  arm C5                       exit   3  RED (identity ok)  (1.0s)
  arm C6                       exit   3  RED (identity ok)  (1.0s)
  arm C7                       exit   3  RED (identity ok)  (1.0s)
  arm C8                       exit   3  RED (identity ok)  (1.0s)
  arm C9                       exit   3  RED (identity ok)  (1.1s)
  arm C10                      exit   3  RED (identity ok)  (1.0s)
  arm FENCE 1                  exit   3  RED (identity ok)  (1.0s)
  arm FENCE 2                  exit   3  RED (identity ok)  (1.0s)
  arm NULL-ID                  exit   3  RED (identity ok)  (1.0s)
  arm POLICY 1                 exit   3  RED (identity ok)  (1.1s)
  arm POLICY 2 precondition    exit   3  RED (identity ok)  (1.0s)
  arm POLICY 2                 exit   3  RED (identity ok)  (1.0s)
  arm RESTORE 1                exit   3  RED (identity ok)  (1.0s)
  arm CASCADE 1                exit   3  RED (identity ok)  (1.0s)
  restore   supabase/tests/test_strategy_fills_reread_bound.sql — exit 0 (1.0s)
arms: 24/24/0   (executed/annotated/waived)
biting: 24   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 24   (arm lanes actually spawned ...)
  file test_strategy_fills_reread_bound.sql: sections 24 / judged 24 / annotated 24 / waived 0 / biting 24
No defects in the narrowed scope.
```

The tracer (task 1) ran first with arms 0 and C1 only: `arms: 2/2/0`, `biting: 2`, `No defects in the narrowed scope.`

### Hand neuters of the shipped migration (task 3)

Backup: `cp` of the migration to `.../scratchpad/253/20261126140000_strategy_fills_reread_bound.sql.bak`, `cmp` exit 0 before any neuter. Gate run on the pg-lane with the gate's own apply list via `bash scripts/pg-lane/run.sh --workdir <scratch>/lane-nX --apply <the 8 files of RED-UNDER-SETUP> --gate supabase/tests/test_strategy_fills_reread_bound.sql`.

N1 (the stall neuter: covered-branch assignment becomes the LEAST form):

```
200c200
<          SET unread_from = p_unread_from, updated_at = now()
---
>          SET unread_from = LEAST(v_existing_from, p_unread_from), updated_at = now()
psql:supabase/tests/test_strategy_fills_reread_bound.sql:590: ERROR:  P0001: TEST FAILED (C4): a run that covered the stored bound B and stopped later at L must move it forward to L; got RET true|907d7e86-bb09-4fad-8f40-78516b518ccb|2026-06-02 11:00:00+02. With LEAST here a repeated stop re-reads the same span for ever and never advances (the stall).
N1 restore cmp=0
```

N2 (the orphan neuter: the fence's `RETURN FALSE` deleted):

```
150c150
<       RETURN FALSE;
---
>       NULL;
psql:supabase/tests/test_strategy_fills_reread_bound.sql:590: ERROR:  P0001: TEST FAILED (FENCE 1): a call carrying a token that is not the running job's must return FALSE and leave (K1, B); got RET true|7fe8e42b-8dd4-4f5f-bf6f-d153e61262d2|2026-06-01 11:00:00+02. An orphaned worker that writes lowers or clears a live bound.
N2 restore cmp=0
```

After both restores the GREEN rerun on the pristine file ended `lane-rc=0` (final `DO`), the final `cmp` of the migration against its byte backup printed `final cmp=0`, and `git status --short` was empty (the migration is byte-identical to its committed state).

### Other checks

- `node scripts/lint-sql-gates.mjs --self-test`: `lint-sql-gates self-test OK: 7 rules, red+green each.` and `node scripts/lint-sql-gates.mjs`: `scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`
- `node scripts/lint-migration-data-dependence.mjs --self-test` then the corpus: `corpus 340 migration(s), 422 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`
- Acceptance greps: `CREATE TABLE IF NOT EXISTS strategy_fills_reread_bounds` 1; `SECURITY DEFINER` 4; `FOR UPDATE` 2; non-comment `advance_sync_cursor` in the migration 0; `TEST FAILED (C` 13 (at least 11); `RED-UNDER-M:` 24 equals `RED-UNDER:` 24; `ARMS EXECUTED` 0; rollback header 1; rollback transaction statements 0.
- D-04: `git diff --quiet origin/main -- supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql supabase/schema/functions/advance_sync_cursor.sql` exits 0.
- Rollback proved on the pg-lane: applied the migration, ran the rollback file as the gate, it printed its success NOTICE and exited 0; applying the migration twice in a row is also clean (re-runnable).

## Real-schema run: NOT DONE (Docker unavailable)

`docker info` failed (daemon down) at the start of task 2. Per the plan, this is recorded rather than worked around, and starting Docker Desktop was not attempted because of the standing load limit. No `scripts/local-stack/run.sh up` was run, so no stack was started and there is nothing to tear down (no `down` or `--assert-teardown` verdict exists to report). **CI's `sql-tests` job is therefore the first real-schema run of this gate.** Static check against `supabase/schema/baseline.sql` done instead: `api_keys` NOT NULL columns without a default are `user_id, exchange, label, api_key_encrypted` (all seeded; `exchange = 'okx'` passes `api_keys_exchange_check`); `compute_jobs` accepts `kind = 'sync_trades'` with only `strategy_id` set (`compute_jobs_kind_target_coherence` and `compute_jobs_target_xor`), and the seeded `done` row sits outside the one-in-flight index; the `api_keys` delete guard fires only for a published composite, and the seeded strategy is unpublished. Residual real-schema risk is any CHECK or trigger not visible in that read; if CI's `sql-tests` refuses a seed, adjust the seed column set, never the arm.

## Deviations from Plan

**1. [Rule 2 - missing coverage] POLICY 1 split into POLICY 1, POLICY 2 precondition and POLICY 2**
- Found during: task 2. One arm id carries one twin, so a single POLICY 1 covering both the SELECT and the INSERT half could prove only one half of the qualifier. USING (false) and WITH CHECK (false) are now pinned independently, plus a catalogue precondition that the restoring GRANT includes INSERT (the per-strategy cursor gate's lesson: a grant-layer 42501 is the same SQLSTATE as a WITH CHECK refusal). Arm count is 24, not 22.
- Files: supabase/tests/test_strategy_fills_reread_bound.sql. Commit: fbb2aa02a.

**2. [Rule 1 - tooling] Three twin needles were not unique in the gate file**
- Found during: task 2 first runner pass: the runner's `occurrence-mismatch` MEASURE_FAIL named SEED 1, POLICY 2 precondition and RESTORE 1, because a needle also matches the twin's own JSON line. Fixed by extending each needle across a newline with its neighbouring comment line, the precedent's shape. No assertion or failure branch changed.

**3. [Design note] EXECUTE-ACL verify asserts the absence of client grantees, not an exact grantee set**
- The plan's prose says "exactly the owner and service_role"; its parenthetical says "no anon, authenticated, PUBLIC grantee". The migration and EXEC 1 check the parenthetical (PUBLIC, anon and authenticated hold no EXECUTE; service_role holds it). An exact-set check could refuse the PROD apply on a harmless unrelated grantee, and a refused TEST apply blocks the PROD apply.

**4. [Scope note] No CASCADE arm for the strategies foreign key and no FK check in the verify block**
- Followed the plan: only CASCADE 1 (api_keys). An FK assertion in the verify block would also stand in the way of CASCADE 1's twin (the apply would abort first), which is why the plan omits it.

## Known Stubs

None.

## Threat Flags

None: the new surface (one table, one RPC) is exactly the plan's threat model; T-253-01 to T-253-05 mitigations are pinned by SECDEF 1, FENCE 1/2 (plus N2), GRANT 1, EXEC 1, POLICY 1/2, RESTORE 1 and CASCADE 1.

## Open items for later plans

- Plan 03 owns the census and snapshot moves for the new gate file and the new function (`scripts/mutation-floors.mjs` FILES_FLOOR and ARMS_FLOOR, `src/__tests__/mutation-runner-floors.test.ts`, the function snapshot and `src/lib/database.types.ts`); this plan touched none of them. This gate adds 1 annotated file and 24 biting arms.
- First real-schema run of this gate is CI's `sql-tests` (see above).
- The migration auto-applies to TEST then PROD on merge with no human stop; it is additive, and the manual rollback drops both objects.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261126140000_strategy_fills_reread_bound.sql
- FOUND: supabase/migrations/down/20261126140000-rollback.sql
- FOUND: supabase/tests/test_strategy_fills_reread_bound.sql
- FOUND commits: 94f7ef268, fbb2aa02a
- STATE.md and ROADMAP.md untouched (orchestrator override).
