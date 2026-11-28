---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 09
subsystem: database
tags: [postgres, grants, column-privileges, sql-gate, mutation-runner, supabase, live-db, DBACC-01]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 04
    provides: "the OG route reads the by-basis aliases through the admin client (the one anon reader moved)"
  - phase: 243-dbbackstop
    plan: 05
    provides: "public.insert_api_key writer, so the live probe's api_keys seed can move to it"
  - phase: 243-dbbackstop
    plan: 07
    provides: "createTestApiKey, the live-test seed helper"
provides:
  - "migration 20261127220000: anon loses table-level SELECT/INSERT/UPDATE/DELETE on strategy_analytics and gets a catalogue-derived column-level SELECT grant on every column but metrics_json_by_basis, one DO block with a catalogue-only self-check"
  - "gate test_strategy_analytics_anon_grants.sql, seven twinned arms, ALL 7 ARMS EXECUTED sentinel"
  - "pg-lane fixture 45 (the by-basis column and PROD's table-level client grants on the fixture-sized strategy_analytics)"
  - "manual rollback restoring anon's table-level grants"
  - "anon live probe arms (r), (s), (t) and a non-null by-basis seed"
affects: [PR-B (migration-reviewer, rls-policy-auditor, CHANGELOG), plan 10 (PR-C insert fence), sql-mutation, sql-tests, frontend-live-db-lane]
tech-stack:
  added: []
  patterns:
    - "table-level revoke plus a pg_attribute-derived column-level grant, so the same migration applies to the fixture-sized pg-lane table and PROD's"
    - "a probe arm is shown able to fail by a temporary table-level GRANT on the live lane, then a fresh lane re-proves GREEN"
key-files:
  created:
    - supabase/migrations/20261127220000_strategy_analytics_anon_column_revoke.sql
    - supabase/migrations/down/20261127220000-rollback.sql
    - supabase/tests/test_strategy_analytics_anon_grants.sql
    - scripts/pg-lane/fixtures/45-fixture-strategy-analytics-by-basis.sql
  modified:
    - src/lib/anon-strategies-live-probe.test.ts
    - TODOS.md
    - scripts/mutation-floors.mjs
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts
    - src/lib/factsheet/by-basis-projection.ts
key-decisions:
  - "anon's unused INSERT, UPDATE and DELETE on strategy_analytics are revoked in the same migration (plan-level agent decision 2026-11-27, RESEARCH Open Question 3; reversible through the rollback file; the founder may override at plan review)"
  - "KEEP 1 pins authenticated's table-level SELECT and service_role's four verbs only; authenticated's write grants are deliberately not pinned, so a later phase may narrow them without editing this gate"
  - "src/lib/factsheet/by-basis-projection.ts is outside files_modified: its header comment pointed at the TODOS entry this plan deletes, so step (7)'s pointer fix edited it"
requirements-completed: [DBACC-01]
duration: ~2h 40m wall clock (about 1h 30m of it waiting on a host at load average 25-40, one failed Docker boot pair and the shared lane)
completed: 2026-11-27
commits: 3
plan_head_before: 786f1c82eae2bcf010100d5c3c0414bf14fa413d
plan_head_after: b1cfa9c4a9d0a19968f2e334c48c9f87121ca9ae
actuals:
  tokens: 38000
  tasks: 3
  commits: 3
---

# Phase 243 Plan 09: anon column revoke on strategy_analytics.metrics_json_by_basis Summary

An anonymous REST request can no longer read `strategy_analytics.metrics_json_by_basis`, whole or through any `->` path, including the exact alias projection the payload builder uses (refused 42501 at the grant layer), while every other column of a published strategy's analytics still reads as a signed-out visitor; anon also loses the table-level INSERT, UPDATE and DELETE it never used on this table.

Tasks 3/3, 15 files touched (4 created, 11 modified), no checkpoint, no auth gate. Commits: `acd013d71` (task 1, tracer), `b852337fc` (task 2), `b1cfa9c4a` (task 3). `git rev-list --count 786f1c82e..HEAD` read 3 at SUMMARY time, equal to this plan's task commits (the SUMMARY commit follows).

## Precondition

- (a) and (b) run by this executor: `git fetch origin main -q` exited 0; `git ls-tree --name-only origin/main supabase/migrations/` lists `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql`; `git show origin/main:'src/app/api/og/factsheet/[id]/route.tsx'` contains `BY_BASIS_ALIASES` (3 hits). PR-A's merge `8e8c0753` is an ancestor of this branch's base (`git merge-base --is-ancestor 8e8c0753 HEAD`).
- (c) **measured by the orchestrator**, not by this agent: the production deployment of the PR-A merge succeeded (`gh api deployments?sha=...&environment=Production`, deployment 8113988619, newest status `success`; main's later head also `success`). The PROD ledger tip (`20261127130000`) was read through the PROD MCP after the marker query, also by the orchestrator. This agent has no PROD MCP.
- `node scripts/verify-plan-anchors.mjs <this plan>`: `OK: 1 plan file(s), no stale claims.` (6 claims).
- The newest migration on `origin/main` is `20261127130000_cron_destinations_exact.sql`, before `20261127220000`; no rename was needed.

## Census at HEAD (Task 1, step 0)

A node scan over the 2180 tracked `src`, `e2e` and `scripts` `.ts`/`.tsx`/`.mjs`/`.js` files (never shell grep) for a `strategy_analytics` select or embed that names `metrics_json_by_basis` or uses `*`. Real source hits, classified by client:

| Site | Select | Client |
|---|---|---|
| `src/lib/queries.ts` `getMyStrategies` (`.select(\`*, strategy_analytics (*)\`).eq("user_id", userId)`) | wildcard embed | authenticated session client, owner-scoped |
| `src/app/(dashboard)/strategies/page.tsx`, `src/lib/queries.ts` (`COMPARE_ANALYTICS_COLUMNS`, the ranked-list allowlist) | only comments naming the wildcard as forbidden | none (explicit allowlists) |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` | names `metrics_json_by_basis` | authenticated browser session (manager wizard) |
| `src/lib/factsheet/fetch-and-build-payload.ts` | `BY_BASIS_ALIASES` aliases only | admin client (`createAdminClient`) |
| `src/app/api/og/factsheet/[id]/route.tsx` | `BY_BASIS_ALIASES` aliases only | admin client (PR-A) |

Every other hit was a comment or a test file. A second pass for `strategy_analytics!<hint>` embeds printed no hit. **No anon-client reader of the column or of `strategy_analytics (*)` exists.** The pre-existing `e2e/helpers/seed-test-project.ts` writes the column through the admin client.

`supabase/schema/functions/*.sql`: 23 files mention `strategy_analytics`. Exactly one is SECURITY INVOKER and writes the table, `apply_okx_archive_rebuild.sql`, and the baseline carries `REVOKE ALL ... FROM PUBLIC` plus `GRANT ALL ... TO "service_role"` for it, so anon cannot execute it (the other INVOKER hits are trigger functions on the table itself or read-only). **No anon-executable INVOKER writer exists.** No migration under `supabase/migrations/` carries a `GRANT` or `REVOKE` on `strategy_analytics` (baseline table-level grants only).

## Tracer RED/GREEN (Task 1)

Each run in a fresh `mktemp -d` workdir, last ten lines.

RED, without the migration in `--apply` (pg-lane exit 3); `grep -ac "TEST FAILED (GRANT 1)"` on the same output printed `1`:

```
psql:scripts/pg-lane/fixtures/01-fixture-core.sql:1: NOTICE:  00000: schema "auth" does not exist, skipping
LOCATION:  does_not_exist_skipping, dropcmds.c:526
BEGIN
psql:supabase/tests/test_strategy_analytics_anon_grants.sql:119: ERROR:  P0001: TEST FAILED (GRANT 1): anon can SELECT public.strategy_analytics.metrics_json_by_basis. The column carries whole per-basis series and writer-shaped keys, and row-level security never restricts columns, so the grant layer is the only control. Revoke the table-level SELECT and grant anon SELECT on every column but metrics_json_by_basis (migration 20261127220000 is the model); if a REVOKE printed nothing and changed nothing, the grantor is another role, so find it with aclexplode(relacl).
CONTEXT:  PL/pgSQL function inline_code_block line 17 at RAISE
LOCATION:  exec_stmt_raise, pl_exec.c:3911
```

GREEN, with the migration (exit 0), tracer version of the gate (GRANT 1 and GRANT 4):

```
psql:scripts/pg-lane/fixtures/01-fixture-core.sql:1: NOTICE:  00000: schema "auth" does not exist, skipping
LOCATION:  does_not_exist_skipping, dropcmds.c:526
BEGIN
psql:supabase/tests/test_strategy_analytics_anon_grants.sql:119: NOTICE:  00000: strategy_analytics anon grants OK: anon cannot SELECT metrics_json_by_basis (GRANT 1, GRANT 4) and can read the other columns (GRANT 4).
LOCATION:  exec_stmt_raise, pl_exec.c:3911
DO
ROLLBACK
```

After the full gate was written, the with-migration run printed `ALL 7 ARMS EXECUTED (GRANT 1, GRANT 2, GRANT 3, GRANT 4, WRITE 1, WRITE 2, KEEP 1)` and exit 0.

Acceptance greps: `node scripts/lint-migration-data-dependence.mjs` printed `corpus 348 migration(s), 430 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW` (exit 0); `grep -acE "^[^-]*(BEGIN;|COMMIT;)"` on the migration printed `0`; `RED-UNDER-M` count 2 after Task 1 and 7 after Task 2; `node scripts/lint-sql-gates.mjs` printed `scanned 127 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)`.

## Mutation runner (Task 2, step 3)

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_strategy_analytics_anon_grants.sql`, exit 2 by design (narrowed diagnostic):

```
  baseline  supabase/tests/test_strategy_analytics_anon_grants.sql — exit 0 (1.9s)
  arm GRANT 1                  exit   3  RED (identity ok)  (2.0s)
  arm GRANT 2                  exit   3  RED (identity ok)  (2.0s)
  arm GRANT 3                  exit   3  RED (identity ok)  (1.9s)
  arm GRANT 4                  exit   3  RED (identity ok)  (1.8s)
  arm WRITE 1                  exit   3  RED (identity ok)  (2.0s)
  arm WRITE 2                  exit   3  RED (identity ok)  (2.0s)
  arm KEEP 1                   exit   3  RED (identity ok)  (1.9s)
  restore   supabase/tests/test_strategy_analytics_anon_grants.sql — exit 0 (2.3s)
arms: 7/7/0   (executed/annotated/waived)
biting: 7   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 7   (arm lanes actually spawned — tallied inside runLane, independent of the 7 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_strategy_analytics_anon_grants.sql: sections 7 / judged 7 / annotated 7 / waived 0 / biting 7
No defects in the narrowed scope.
```

GRANT 2 and GRANT 4 carry `"neuter":[{"arm":"GRANT 1"}]` because GRANT 1 fires first under their twins (a table-level or column-level hand-back of the column). GRANT 3, WRITE 1, WRITE 2 and KEEP 1 need no neuter (measured: each twin reddens its own arm first).

## PROOF-01 on the migration (Task 2, step 4)

1. Backup: `cp supabase/migrations/20261127220000_strategy_analytics_anon_column_revoke.sql <scratchpad>/p09-migration.bak`.
2. Neutered in two places so the copy still applies: `AND a.attname <> 'metrics_json_by_basis'` removed from the GRANT derivation only, and the self-check `IF has_column_privilege('anon', v_rel, 'metrics_json_by_basis', 'SELECT')` made `IF FALSE AND ...`. `diff` against the backup showed exactly those two lines.
3. pg-lane run with the neutered migration: exit 3, first failure `TEST FAILED (GRANT 1): anon can SELECT public.strategy_analytics.metrics_json_by_basis ...` (`line 25 at RAISE`).
4. `cp <backup> <migration>` then `cmp <backup> <migration>` printed nothing (silent; the shell echoed `CMP_SILENT`). Re-run: exit 0. `git status --short` showed no stray change to the migration.

## Local-stack lane, anon live probe (Task 2, steps 5 and 6)

Lock protocol followed (`/private/tmp/quantalyze-local-stack.lock`, foreign-container check, `down` in a trap, lock released).

- `bash scripts/local-stack/run.sh up` exit 0. It named `baseline-replay: 2 migration(s) newer than the dump: 20261127130000_cron_destinations_exact.sql 20261127220000_strategy_analytics_anon_column_revoke.sql` and printed `replayed 20261127220000_strategy_analytics_anon_column_revoke.sql (ledger row written)`: the PROD-shaped table takes the migration.
- The gate on the lane DSN, read the way `sql-tests` reads it (`psql -X -v ON_ERROR_STOP=1 -f supabase/tests/test_strategy_analytics_anon_grants.sql`): exit 0, printed `ALL 7 ARMS EXECUTED (...)` and `strategy_analytics anon grants OK.` GRANT 3 ran there against all of PROD's columns.
- `npm run test:live-db -- src/lib/anon-strategies-live-probe.test.ts`: `Test Files 1 passed (1)`, `Tests 18 passed (18)`, none skipped (arms (a) to (q), the new (r), (s), (t), and the skip-reason advert). Arm (j), the OG route as a signed-out visitor, passed with no `afterSpy` call.
- **Anti-vacuity.** As `postgres` through `psql` on the same lane: `GRANT SELECT ON public.strategy_analytics TO anon`, then the probe again: `Tests 2 failed | 16 passed (18)`, the two failures being exactly (r) and (s). So both arms measure the grant.
- `down`, then `up` again on a fresh lane. **Two fresh-lane boots failed first**: `supabase_analytics_quantalyze container is not ready: unhealthy` at host load average about 34 (an infrastructure fault of the analytics container's health check, not a lane or migration fault; both boots tore down cleanly). After the CI-shaped checks below were done and the host load fell, the third fresh boot exited 0 and the probe printed `Tests 18 passed (18)`, none skipped. `down` then `docker ps --filter name=supabase -q` printed empty, and the lock was released.
- **Other SQL gates on the post-revoke lane.** Because `sql-tests` runs the whole corpus on a lane that now carries the revoke, every gate file that names `strategy_analytics` (34, minus the 2 `LANE-ONLY` files the CI job excludes: `test_mark_rpc_bridge_advisory_lock.sql`, `test_sync_status_bridge_lock.sql`) was run with `psql -X -v ON_ERROR_STOP=1 -f` on the fresh lane: `gates run=32 failed=0`. This includes this plan's own gate.
- **Execution ledger.** CI runs `npm run test:live-db:ledger`. On the same lane: `Test Files 2 failed | 47 passed | 2 skipped (51)`, `Tests 7 failed | 429 passed | 81 skipped (517)`, and `[live-db-ledger] OK — the failing set is EXACTLY the ledger (7/7). Every corpus file executed; no arm outside the ledger failed; no ledger entry has gone stale.` The three new arms are not in `scripts/live-db-execution-ledger.txt` (it lists known-bad arms only) and pass, so the ledger file did not move. `CORPUS_FLOOR` in `scripts/live-db-lane-corpus.mjs` was checked and did not move: no live file was added (51 files collected, as at the base).

## Censuses moved (Task 3)

Every value re-measured on this tree, none added up from the plan text:

- `scripts/mutation-floors.mjs`: `FILES_FLOOR` 99 -> 100 and `ARMS_FLOOR` 1110 -> 1117, from `--parse-only` (`coverage: files 100/127`, `arms: 0/1117/0`, `No static defects`) and the diagnostic run's `biting: 7`. `WAIVED_CEILING` stays 0. Two dated `(Phase 243 DBBACKSTOP, plan 09)` blocks.
- `ci.yml` `sql-tests`: derivation row `test_strategy_analytics_anon_grants.sql 7`, `SENTINEL_FLOOR` 41 -> 42, `ARMS_FLOOR` 620 -> 627 with its trailing sum, and a `# Re-measured` note. No mutation-runner script path in that job body.
- Test census literals: `drift-check-scripts` (`SENTINEL_FLOOR=42`, `ARMS_FLOOR=627`), `gate-family-meta` (the two floor pins), `mutation-annotation-parser` (`armsSeen` 1117, `filesTotal` 127 twice, `filesAnnotated` 100, `annotatedFiles` 100, the by-name list; `stepsSeen` and `needles.length` stay 1252 because every twin here is a `sql` step), `mutation-runner-floors` (`totalAnchored` 1117, the `GREEN_LOG` literals, one new per-file row), `lint-sql-gates` (`scanned 127`), `ci-anti-skip-gate.contract` (`okCount` 1 -> 2: this sentinel reads `ALL 7 ARMS EXECUTED`, so it now shares that text with `test_sync_status_curated_sentence_survives.sql`). Each with a dated CURRENCY comment.

Verification run lines:

- The seven census files (`mutation-runner-floors`, `lint-sql-gates`, `ci-anti-skip-gate.contract`, `local-stack-lane-wiring`, `gate-family-meta`, `mutation-annotation-parser`, `drift-check-scripts`): first pass `Tests 4 failed | 1395 passed (1399)`, all four being **timeouts at the default 5000 and 30000 ms under host load** (load average 25-40); re-run of those three files with `--testTimeout=240000`: `Test Files 3 passed (3)`, `Tests 315 passed (315)`. The other four files passed on the first pass.
- `npx tsc --noEmit`: exit 0. `npm run lint`: exit 0.
- `node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 100/127`, `arms: 0/1117/0`, `No static defects`.
- Whole `npx vitest run --testTimeout=240000` (host load average 35-55): `Test Files 4 failed | 1295 passed | 20 skipped (1319)`, `Tests 5 failed | 28332 passed | 313 skipped (28650)`. The five failures, named:
  - `src/lib/factsheet/compute.conventions.test.ts` fixture B (zero-return days) and fixture C (interior calendar gaps), snapshot mismatch: **pre-existing**. Re-run alone on this tree it fails the same two; re-run on a throwaway worktree of the plan's base `786f1c82e` (removed afterwards) it fails the same two, so this plan did not cause them. This plan touches nothing under `src/lib/factsheet` except a comment line in `by-basis-projection.ts`. Not fixed (out of scope); needs an owner.
  - `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` R4 (SIGKILL at the 55 s spawn timeout), `src/__tests__/mutation-runner-floors.test.ts` IN-05 (30 s timeout) and `src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx` (`factsheet-collapse:` key write): load-induced; the three files re-run together at load average 10: `Test Files 3 passed (3)`, `Tests 227 passed (227)`.

## Deviations from Plan

None in behaviour. Recorded differences:

- **`src/lib/factsheet/by-basis-projection.ts` is outside `files_modified`.** Plan step (7) says to fix any non-lineage pointer to the deleted TODOS entry; that file's header comment (written by plan 03) named `RANK-SPLAT-01` as an open TODOS entry, so its wording was changed to say the entry was closed and deleted by Phase 243 (comment only).
- **The new migration's header still names RANK-SPLAT-01** ("Booked as TODOS RANK-SPLAT-01"). That is deliberate: it is the closing migration, and an applied migration's comment is lineage. `git grep -n RANK-SPLAT-01 -- ':!CHANGELOG.md' ':!.planning'` lists only that migration after the fix.
- **Pre-commit namespace guard.** The worktree branch is `wt/243-p09`, which is outside the `agent-*` allow-list in the executor's commit protocol; the orchestrator created these plan worktrees and plans 02, 05 and 07 committed on the same shape, so the protected-branch check ran (HEAD is attached, `wt/243-p09` is not a protected name) and the allow-list was not applied.
- **Full-suite timeouts** were re-run with a raised `--testTimeout`, per the orchestrator's instruction for host load.

## Decisions Made

- anon's INSERT, UPDATE and DELETE on `strategy_analytics` are revoked in the same migration as the column revoke. This is a plan-level agent decision (phase agent, 2026-11-27, RESEARCH Open Question 3), not a CONTEXT decision and not Claude's discretion, so the CHANGELOG entry carries it as a decision taken. Reasons: the `strategies` precedent did the same in one migration; no anon writer of `strategy_analytics` exists (the census above); it shrinks DBACC-03's lock surface on the table. Reversible: the rollback file restores the grants.
- The revoke is **default-deny** (CONTEXT `### DBACC-01`): every later migration that adds a `strategy_analytics` column must grant it to anon, or record an exemption in the gate's `HIDDEN_COLUMN_EXEMPTIONS`. GRANT 3 goes RED on the local-stack lane otherwise.

## Known limits

- **An authenticated non-owner can still read the whole `metrics_json_by_basis` column of a published strategy.** `authenticated` keeps table-level SELECT (the owner pages read the column through the user client), so the grant layer does not separate owner from non-owner; row visibility is RLS's. Deferred in CONTEXT `## Deferred Ideas`; not tested here (a comment above the new probe arms says so). To go in the CHANGELOG entry at ship.
- KEEP 1 does not pin authenticated's write grants, deliberately.
- The migration applies to PROD on the merge push once `apply-test` succeeds, with no human gate (the `Production` reviewer was removed 2026-09-23). The merge precondition stands: migration-reviewer and rls-policy-auditor each return no MEDIUM or higher finding before PR-B merges. The phase review lanes run them; this plan did not merge.

## Known Stubs

None.

## Threat Flags

None. The migration narrows a trust boundary and adds no endpoint, auth path or file access.

## Closed ledger entries

- `TODOS.md` `RANK-SPLAT-01` deleted (4 lines: heading, blank, body, blank). The CHANGELOG naming of the closed id is the PR-B ship step's.

## Self-Check: PASSED

All four created files exist and the three task commits (`acd013d71`, `b852337fc`, `b1cfa9c4a`) are ancestors of HEAD.
