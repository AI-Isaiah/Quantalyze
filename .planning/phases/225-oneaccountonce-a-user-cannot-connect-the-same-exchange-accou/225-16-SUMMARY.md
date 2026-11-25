---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 16
subsystem: database
tags: [identity, mt5, venue_server, commit_scenario_batch, sql-gate, mutation-runner, CONN-03]
requires: [225-13, 225-14, 225-15]
provides:
  - commit_scenario_batch re-based with server-aware identity CTEs (migration 20261125151936)
  - the gate test_commit_scenario_batch_venue_server_identity.sql (12 twinned arms, 12 PARITY-FINGERPRINT literals)
  - src/lib/fingerprint-venue-server-parity.test.ts (TS path reproduces every literal)
affects: [225-17]
tech-stack:
  added: []
  patterns: [canonical identity per key, never a pairwise wildcard; PARITY-FINGERPRINT literal bound across SQL and TS]
key-files:
  created:
    - supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql
    - supabase/migrations/down/20261125151936-rollback.sql
    - supabase/tests/test_commit_scenario_batch_venue_server_identity.sql
    - src/lib/fingerprint-venue-server-parity.test.ts
  modified:
    - supabase/schema/functions/commit_scenario_batch.sql
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/lint-sql-gates.test.ts
key-decisions:
  - "CONTEXT Q6 item 1: one login on two set servers is two accounts in SQL as in Python and TS"
  - "CONTEXT Q6 agent decision: a server-less key joins its login while the login carries at most one distinct set server, and has no identity (its own key account) when it carries two or more"
  - "A marker link beats ambiguity and feeds known_account: the marker arms of account_edges still read owner_keys, unchanged"
requirements-completed: [CONN-03]
status: complete
commits: 4
plan_head_before: 4429f4db879f41b5d1debe5275f2dc05b62d35d0
plan_head_after: dbff5f8bbc20cf9599beb37a7936d6da05f9ad52
actuals:
  tokens: 43200
  tasks: 3
  commits: 4
---

# Phase 225 Plan 16: SQL twin of the server-aware account identity Summary

`commit_scenario_batch`'s fingerprint recompute now groups an owner's keys by the canonical (exchange, login, server) identity, so one MT5 login on two set servers is two accounts in the RPC exactly as in the browser (plan 15) and the derive (plan 14); the gate has one twinned arm per clause of the shared rule and the TS path reproduces every gate literal.

## What was built

- **Migration `supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql`** (named from `date -u` at creation, 2026-11-25 15:19:36Z; later than 20261125132334 and every migration on origin/main, never in the future). It is the 20261027120000 function copied from the migration text (lines 108 to 788), with only the identity CTEs changed (diff against the source confirms it): `owner_keys` gains `NULLIF(k.venue_server, '') AS server_norm`; new `login_servers` (per exchange_norm, venue_norm: `count(DISTINCT server_norm)` and `min(server_norm COLLATE "C")`, computed from owner_keys only) and `key_identity` (the CASE: own server; `''` when the login carries none; NULL when two or more; else the single server); the first `account_edges` arm joins `key_identity` on exchange, login and identity_server; `known_account` reads `key_identity WHERE identity_server IS NOT NULL`, still unioned with the marker edges. The two marker arms still read `owner_keys`, byte-identical. SECURITY DEFINER, `SET search_path = public, pg_catalog`, the 5-argument signature and every other CTE are untouched. The REVOKE/GRANT pair is re-issued verbatim. A catalogue-only `DO $verify$` asserts one overload, 5 args, prosecdef, the pinned search_path in proconfig and the ACL (authenticated yes, anon no, no PUBLIC). It reads no table row and no body text. No explicit transaction statements; `SET LOCAL lock_timeout = '3s'`.
- **Rollback `supabase/migrations/down/20261125151936-rollback.sql`**: the 20261027120000 body and ACL, copied from the snapshot taken BEFORE regenerating (asserted byte-equal to the migration's own function text when generated), with its own `BEGIN; ... COMMIT;`.
- **Snapshot** `supabase/schema/functions/commit_scenario_batch.sql` regenerated with `npm run schema:functions`; `npm run schema:functions:check` prints `SQL function snapshot is current (142 functions).`
- **Gate `supabase/tests/test_commit_scenario_batch_venue_server_identity.sql`**: twelve arms, each its own DO block and allocator, each two-sided (the reader's fingerprint reaches the 22023 `unknown kind` sentinel; the fingerprint a mutated recompute would hold is refused `portfolio_fingerprint_stale`), each carrying a `-- PARITY-FINGERPRINT(<arm>): <literal>` and a RED-UNDER twin.
- **Parity test `src/lib/fingerprint-venue-server-parity.test.ts`**: reads every marker literal out of the gate, replays hand-typed keys carrying `venue_server` through `fetchLatestHoldingsPerKey`, `derivePhase07Fields` and `computeHoldingsFingerprint`, and fails when a gate marker has no TS case (or a case has no marker). The key-read mock projects `api_keys` rows to the selected columns, as plan 15's does.
- **Census moves** (Task 3), below.

## prod-body-ack derivation

Before regenerating the snapshot: `git show origin/main:supabase/schema/functions/commit_scenario_batch.sql > <scratch>` then `node scripts/sql-body-normalize.mjs --diff-bodies supabase/schema/functions/commit_scenario_batch.sql <scratch>` printed, verbatim:

```
MATCH	commit_scenario_batch	5	7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891	7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891	0
```

`-- prod-body-ack: 7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891` is the `live` column (ORIGIN/MAIN'S BODY STANDING IN FOR PROD). It is earned only if VAC-04 on the PR reports the same hash for PROD. The re-base check at execution: `git fetch origin`, the origin/main snapshot was `git diff --quiet`-identical to this branch's snapshot, and `grep -l "CREATE OR REPLACE FUNCTION public.commit_scenario_batch"` over `supabase/migrations/*.sql` found nine files, newest 20261027120000.

## Runner and lint lines (measured, verbatim)

`node scripts/mutation-runner/run.mjs --file supabase/tests/test_commit_scenario_batch_venue_server_identity.sql` (exit 2 by design), final run:

```
  baseline  supabase/tests/test_commit_scenario_batch_venue_server_identity.sql — exit 0 (3.6s)
  arm two-servers-two-accounts exit   3  RED (identity ok)  (3.4s)
  arm same-server-pair-one-account exit   3  RED (identity ok)  (3.3s)
  arm null-joins-single-server exit   3  RED (identity ok)  (3.4s)
  arm null-ambiguous-own-account exit   3  RED (identity ok)  (3.6s)
  arm all-null-one-account     exit   3  RED (identity ok)  (3.8s)
  arm two-nulls-ambiguous      exit   3  RED (identity ok)  (3.5s)
  arm three-servers-plus-null  exit   3  RED (identity ok)  (3.2s)
  arm other-exchange-same-login exit   3  RED (identity ok)  (3.4s)
  arm exchange-partitions-server-count exit   3  RED (identity ok)  (3.2s)
  arm exchange-case            exit   3  RED (identity ok)  (3.5s)
  arm marker-links-ambiguous-key exit   3  RED (identity ok)  (3.3s)
  arm marker-links-keyless-key exit   3  RED (identity ok)  (2.9s)
  restore   supabase/tests/test_commit_scenario_batch_venue_server_identity.sql — exit 0 (3.5s)
coverage: files 94/121
arms: 12/12/0   (executed/annotated/waived)
biting: 12   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 12   (arm lanes actually spawned — tallied inside runLane, independent of the 12 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
  file test_commit_scenario_batch_venue_server_identity.sql: sections 12 / judged 12 / annotated 12 / waived 0 / biting 12
No defects in the narrowed scope.
```

The plan's automated verify (exit 2, `No defects in the narrowed scope`, no `defect(s):`, executed = annotated = biting = lane-invocations >= 12, waived 0) returned 0. The same run on the tracer commit (one arm) printed `arms: 1/1/0`, `biting: 1`, `lane-invocations: 1`.

Other checks at final HEAD (dbff5f8bb):
- `node scripts/lint-migration-data-dependence.mjs`: `corpus 338 migration(s), 420 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`
- `npm run schema:functions:check`: `SQL function snapshot is current (142 functions).`
- `node scripts/lint-sql-gates.mjs`: `scanned 121 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`
- `node scripts/lint-app-guc.mjs`: `app-guc: findings 0`.
- `node scripts/mutation-runner/run.mjs --parse-only`: `coverage: files 94/121`, `arms: 0/1033/0   (executed/annotated/waived)`, `No static defects. Every prose marker has a twin and every needle still matches.`
- vitest: `fingerprint-venue-server-parity`, `fingerprint-sameday-empty-parity`, `fingerprint-unpriced-parity`: 3 files, 25 passed. The four census files: `Test Files 4 passed (4)`, `Tests 336 passed (336)`. Neighbours (`scenario-commit-rls`, `scenario-commit-batch-race`, `scenario-commit-batch-tx`, `audit-coverage`, `drift-check-scripts`, `local-stack-lane-wiring`, `restore-test-from-baseline`, `phase-29-frozen-spine-guards`, `adr-0008`, `critical-regressions`, `queries.holdings-per-key`): `9 passed | 2 skipped` files, `1306 passed | 30 skipped`. `npx tsc --noEmit -p .` and `npx eslint` on the new test: no output.

## baseline-content-drift-check (handed to plan 17 Task 2)

`node scripts/baseline-content-drift-check.mjs`:

```
::error file=supabase/schema/functions/commit_scenario_batch.sql,line=0::content-drift — DRIFT commit_scenario_batch/5 snapshot=7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891 chain=68469a606dfbb3aa57503948b08ad3cf0b9295456981e3b04753a4854a6b0e3a differing-lines=32 — the committed supabase/schema/baseline.sql disagrees with the migration chain for `commit_scenario_batch`, and no CONTENT_DRIFT_ALLOWLIST row pins this disagreement.
baseline-content-drift: chain files 142 (supabase/schema/functions/*.sql, sorted)
baseline-content-drift: functions compared 144 — MATCH 140, DRIFT 4, SNAPSHOT_MISSING 0, SNAPSHOT_ONLY 0, UNCOMPARABLE 0
baseline-content-drift: allowlisted rows 3 — check_fan_in_ready/1, reject_sentinel_writes/0, retention_delete_guard/0
baseline-content-drift: findings 1
```

The one finding is the expected DRIFT row for the re-based `commit_scenario_batch/5` (baseline snapshot `7a9444d3…` is the 20261027120000 body; the chain now carries this migration's body `68469a60…`). It is not allowlisted, as instructed. The check exits non-zero by design until a baseline regeneration, which plan 17 Task 2 owns.

## Census values moved (Task 3, commit dbff5f8bb), all from measured runs

| Where | Old | New |
|---|---|---|
| `scripts/mutation-floors.mjs` FILES_FLOOR | 93 | 94 |
| `scripts/mutation-floors.mjs` ARMS_FLOOR | 1021 | 1033 |
| WAIVED_CEILING | 0 | 0 (unchanged) |
| `gate-family-meta.test.ts` registry keys | `FILES_FLOOR=93`, `ARMS_FLOOR=1021` | `FILES_FLOOR=94`, `ARMS_FLOOR=1033` |
| `mutation-runner-floors.test.ts` `totalAnchored` | 1021 | 1033 |
| synthetic FULL log: `scope: FULL N/N annotated files` (and the SUBSET, lying, fallback, twice and diagnostic variants) | 93 | 94 |
| synthetic FULL log: `coverage: files` (both logs) | 93/120 | 94/121 |
| synthetic FULL log: lane-concurrency target-file count, baseline/restore legs | 93 | 94 |
| synthetic FULL log: arms, biting, lane-invocations, the mean line, executed/lane/biting literals | 1021 | 1033 |
| derived offsets (lane-invocations extra, spliced biting, rows-sum) | 1022 / 1022 / 1020 | 1034 / 1034 / 1032 |
| per-file row count messages (`printed N per-file row(s) but reported M`) | 94/93 and 2/93 | 95/94 and 2/94 |
| new per-file row | none | `test_commit_scenario_batch_venue_server_identity.sql: sections 12 / judged 12 / annotated 12 / waived 0 / biting 12` |
| `mutation-annotation-parser.test.ts` `armsSeen` | 1021 | 1033 |
| `mutation-annotation-parser.test.ts` `stepsSeen` and `needles.length` | 1171 | 1186 (+15 edit steps: one per arm, three for exchange-partitions-server-count, two for marker-links-ambiguous-key) |
| `mutation-annotation-parser.test.ts` `filesTotal` (two pins) | 120 | 121 |
| `mutation-annotation-parser.test.ts` `filesAnnotated` and `annotatedFiles` length, plus the new name in the list | 93 | 94 |
| `lint-sql-gates.test.ts` `scanned N file` | 120 | 121 |

Each moved value carries a dated CURRENCY or RAISED comment naming Phase 225 plan 16 (`grep -a -c "Phase 225 plan 16" scripts/mutation-floors.mjs` is 2). ARMS_FLOOR 1033 is the static annotated count: NOT measured by a FULL local run (1033 arms at about 3.5 s each); CI `sql-mutation` FULL on the PR (a floors edit forces FULL) is the run that compares it with a real biting count. Remaining text hits for `files 93/120` and `scanned 120` are historical comments.

## Twin measurements (PROOF-01)

Each twin is its arm's neuter: the runner applied it, the lane went RED with `TEST FAILED (<that arm>)` as the first failure (`RED (identity ok)`), and the pristine file is GREEN (baseline and restore legs exit 0). Measured `occurrences` is 1 on every edit step except `marker-links-ambiguous-key`, whose two marker arms share one needle line: it edits that needle with `occurrences: 2, nth: 1`, then `occurrences: 1, nth: 1` (the first replacement removes the `WHERE m.account_share_kind` text, so the second needle matches once). Twins, in file order:

1. two-servers-two-accounts: `b.identity_server = a.identity_server` -> `TRUE` (the login-only join)
2. same-server-pair-one-account: set-server branch of identity_server -> NULL
3. null-joins-single-server: `ELSE l.only_server` -> `ELSE NULL`
4. null-ambiguous-own-account: `WHEN l.server_ct >= 2 THEN NULL` -> `THEN l.only_server` (smallest server)
5. all-null-one-account: `WHEN l.server_ct = 0 THEN ''` -> `THEN NULL`
6. two-nulls-ambiguous: `WHEN l.server_ct >= 2 THEN NULL` -> `THEN ''`
7. three-servers-plus-null: `WHEN l.server_ct >= 2 THEN NULL` -> `WHEN l.server_ct = 2 THEN NULL`
8. other-exchange-same-login: `b.exchange_norm   = a.exchange_norm` -> `TRUE`
9. exchange-partitions-server-count: three steps (login_servers GROUP BY drops exchange_norm, its `SELECT o.exchange_norm,` becomes `SELECT`, its join to owner_keys `ON TRUE`)
10. exchange-case: `lower(btrim(k.exchange)) AS exchange_norm` -> `btrim(k.exchange) AS exchange_norm`
11. marker-links-ambiguous-key: both marker arms filtered to marked keys with an identity_server
12. marker-links-keyless-key: `SELECT a FROM account_edges` -> `SELECT id FROM key_identity WHERE FALSE`

Arm order was chosen from which arms a twin breaks (the set-server twin breaks the one-server arm, so same-server-pair is second; the ambiguous-marker twin breaks the login-less marker arm, so it precedes it) and then CONFIRMED by one run of the whole file under every twin: all twelve reddened as their own first failure, with no reordering needed.

**Parity neuter (RED and byte-copy restore).** Byte copies in the session scratchpad, restored and verified identical with `cmp` each time:
- test rows without `venue_server` (the plan's neuter, which collapses arm 1 to login-only): `4 failed, 10 passed` (two-servers-two-accounts, null-ambiguous-own-account, two-nulls-ambiguous, three-servers-plus-null).
- `keyAccountOf` in `src/lib/latest-holdings-per-key.ts` stops passing `venue_server`: `4 failed, 10 passed`, the same four.
- a gate-marker name with no TS case (renamed `exchange-case` to `exchange-case-x`): `2 failed, 12 passed` (the set-equality test and the renamed case).
The login-only fingerprint of arm 1, `ETH:mt5:spot|SOL:okx:spot`, is also asserted by a test so the literal cannot be satisfied vacuously.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Fixture would be vacuous] `marker-links-keyless-key` uses two login-less keys**
- **Found during:** Task 2 design, then measured.
- **Issue:** the plan's fixture (a login-less key marked `duplicate` against the srv-a key) cannot bite its twin. A marker edge runs both ways, so the login-less key is reached from the srv-a key's root and joins its account whether or not marker edges feed `known_account`. Measured on the lane with the plan's fixture: the runner reported `arm marker-links-keyless-key exit 0  NO-RED` and `the mutation applied (occurrence count verified) but the gate still passed — this arm cannot fail`.
- **Fix:** both keys have no login and one is marked `duplicate` against the other; only then does `known_account` need the marker edges to find a root. The clause is unchanged ("marker edges feed known_account"). The gate header records the measurement.
- **Files modified:** `supabase/tests/test_commit_scenario_batch_venue_server_identity.sql`, `src/lib/fingerprint-venue-server-parity.test.ts`.
- **Commit:** 74a36d73e, 0e91016c3.

**2. [Plan wording] `exchange-case` built as the stored-'MT5' form**
- The pg-lane `api_keys` has no `api_keys_exchange_check` (measured by a scratch gate: `pg_constraint` for `api_keys` lists no such constraint, and inserting a key with exchange 'MT5' returned no error). So the plan's lane-stores branch applies: an 'MT5' key and an 'mt5' key on one login and server (one live, one disconnected), one account, a literal, and the twin drops `lower()` from `exchange_norm` in this migration's `owner_keys`. On PROD the CHECK makes a mixed-case exchange unstorable, so there the case-fold is defence in depth; the gate header says so.

**3. [Plan wording] RED-UNDER-SETUP omits the two wizard migrations and the plan 13 migration**
- The setup list is the sameday_empty list plus `20261123180000_api_keys_venue_server.sql` and this migration, appended in filename order. A1's catalogue self-verify (`create_wizard_strategy` one 13-parameter overload) passed on the lane without `20260813150106_wizard_rpcs_service_role_writer.sql` and `20260814120000_wizard_rpcs_revoke_authenticated.sql` (A1's NOTICE printed `create_wizard_strategy has one 13-parameter overload, SECURITY DEFINER, service_role-only`), so they were not added. `20261125132334_api_keys_venue_server_owner_read.sql` was not added either: the function is SECURITY DEFINER and reads the column as its owner. No A1 failure occurred.

**4. [Plan wording] Gate arm order differs from the plan's bullet order**
- The plan lists the first four arms in a different order from the file. The order in the file (two-servers, same-server-pair, null-joins-single-server, null-ambiguous, all-null, two-nulls, three-servers, other-exchange, exchange-partitions-server-count, exchange-case, marker-ambiguous, marker-keyless) was confirmed by running every twin, as above.

**5. [Rule 3 - Branch namespace] Commit-time `agent-*` allow-list not applied**
- The worktree branch is `gsd/phase-225-pr2b-2`, a caller-designated plan worktree. HEAD was attached and not on a protected branch; the allow-list was skipped as in plans 14 and 15.

**6. State, ROADMAP and push skipped on instruction**
- Per the caller, `STATE.md` and `ROADMAP.md` were not edited, no `state.*`, `roadmap.*` or `requirements.mark-complete` handler ran, nothing was pushed and no PR was opened. No Co-Authored-By, Claude-Session or "Generated with" trailers were written, as instructed (the harness attribution reminder is overridden by the caller's rule and the founder's standing rule).

**7. Other-test census files touched**
- `src/__tests__/lint-sql-gates.test.ts` (scanned-file count, 120 to 121) is not in the plan's `files_modified` but the plan's Task 3 action names "any test that counts supabase/tests files", so it moved with the other four. The earlier plan 13 commit did not touch it because no file joined.

## Handed to plan 17

- The eight `edit` twins in `test_commit_scenario_batch_fingerprint_sameday_empty.sql` (six) and `test_commit_scenario_batch_fingerprint_unpriced.sql` (two) still target `20261027120000`. Verified at execution with a script that parses each `RED-UNDER-M` and counts every `find` of those nine steps against this migration: `steps checked 9 bad 0`, so each needle occurs exactly once here (including the comment-line needle and the multi-line `unpriced-dropped` one). Plan 17 can re-point them by file name only.
- The expected `baseline-content-drift-check` DRIFT row for `commit_scenario_batch/5` is above.
- Migration name: `20261125151936`. Any later reference must use that, or the `_commit_scenario_batch_venue_server_identity.sql` suffix.
- Ship guard: `git diff --name-only origin/main...HEAD | grep -c '^.planning/'` prints 20 on this execution branch, from earlier plans' records on the phase branch, not from this plan's code commits (the four code commits touch no `.planning` file; this SUMMARY is committed separately). The PR-2b-2 branch is cut through the house `-pr` filter and must print 0 before the push.

## Known Stubs

None.

## Threat Flags

None. The re-base keeps `owner_keys WHERE k.user_id = p_allocator_id`, `login_servers` and `key_identity` read `owner_keys` only (T-225-52), SECURITY DEFINER, the pinned search_path and the ACL are re-asserted by the catalogue self-verify (T-225-51), the migration reads no table row and the data-dependence linter reports 0 NEW (T-225-53), and the PARITY-FINGERPRINT literals are reproduced by a TS test that goes RED when the TS rows lose `venue_server` (T-225-54). No new endpoint, auth path or schema change.

## Docker and local stacks

None started. The pg-lane runs a throwaway PostgreSQL cluster from local binaries that its own EXIT trap removes; `ps` showed no leftover cluster process afterwards.

## Self-Check: PASSED

- Commits 875ab19a3, 74a36d73e, 0e91016c3, dbff5f8bb are ancestors of HEAD.
- The migration, rollback, gate, parity test, regenerated snapshot and the five census files exist and are committed.
- Acceptance greps (`grep -a -c`): `prod-body-ack:` 1; `venue_server` in the snapshot 2 (>= 1); `PARITY-FINGERPRINT(two-servers-two-accounts)` 1; `SECURITY DEFINER` in the snapshot 2 (>= 1); `"arm":"` arms in the gate 12 (>= 12); `PARITY-FINGERPRINT(` lines in the gate 12 (>= 11); `PARITY-FINGERPRINT(` in the TS test >= 1; `WAIVED_CEILING = 0;` present; `Phase 225 plan 16` in `mutation-floors.mjs` 2.
