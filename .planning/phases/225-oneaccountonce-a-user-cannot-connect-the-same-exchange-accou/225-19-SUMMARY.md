---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 19
subsystem: database-identity
tags: [account-identity, mt5, venue-server, unique-index, migration-b, pr-3, census, mutation-floors]
requires:
  - phase: 225-13
    provides: PR-2b-1, the venue_server owner-read grant and the 6v-owner-read arm (on origin/main)
  - phase: 225-16
    provides: PR-2b-2, the server-aware commit_scenario_batch gate (on origin/main)
  - phase: 225-18
    provides: PR-2c, validation that proves the broker server (on origin/main, 2aa1a0cbb)
provides:
  - migration B under the honest UTC name 20261126102346, on a tree that carries every gap plan
  - both of B's gates green narrowed on the lane, every arm biting
  - every mutation census re-based on main plus plan 10's arms by measurement (ARMS_FLOOR 1033 -> 1042)
affects: [225 PR-3, 225-21]
key-files:
  created:
    - supabase/migrations/20261126102346_api_keys_venue_server_index.sql
    - supabase/migrations/down/20261126102346-rollback.sql
  modified:
    - supabase/tests/test_api_keys_venue_identity_uniq.sql
    - supabase/tests/test_api_keys_account_identity.sql
    - supabase/schema/functions/reconnect_allocator_api_key.sql
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - .planning/phases/225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou/225-10-SUMMARY.md
key-decisions:
  - "Migration B renamed 20261125083433 -> 20261126102346 (UTC at the rename). Later than every file on the merged tree (previous newest 20261125212222). The PROD ledger tip comparison is Task 3 step 2 and is NOT done here."
  - "B's prod-body-ack corrected from d5ef374c... to 8ebf2301... (see Deviations); the orchestrator decided this."
status: partial
actuals:
  tokens: 25000
  tasks: 2
  commits: 41
plan_head_before: d14f82d71c766f4660bc0c797fb823974f3d782d
plan_head_after: 9bef055b0cf0185c7a15eeff9484c7d5424f0bb7
---

# Phase 225 Plan 19: PR-3 re-base (migration B) Summary

Migration B is merged onto origin/main (v0.133.89.0, `2aa1a0cbb`), renamed to an honest UTC name, and passes both of its gates narrowed on the lane with every arm biting. Every mutation census now reads main's values plus plan 10's arms as measured. **Status: partial. Task 3 (the read-only PROD pass) is PENDING and is run by the orchestrator.**

`commits: 31` is MEASURED by `git rev-list --count d14f82d71..HEAD` at the code head `d0817adcf`. It counts the 28 origin/main commits the merge brought in. Authored by this plan: the merge commit `67278b5db`, the ack fix `578bb0341`, the census commit `d0817adcf`, and this SUMMARY's own commit (after the measurement). Nothing was pushed.

## Tasks

- **Task 1 (tracer):** merged origin/main, resolved conflicts, renamed B, re-checked the reconnect re-base and the ack. Commits `67278b5db` (merge + rename) and `578bb0341` (ack).
- **Task 2:** re-based every census by measurement. Commit `d0817adcf`.
- **Task 3 (blocking-human): PENDING, not attempted.** See the section at the end.

## New migration name

`supabase/migrations/20261126102346_api_keys_venue_server_index.sql` and `supabase/migrations/down/20261126102346-rollback.sql`. `grep -a -rn 20261125083433 --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .` prints nothing. The old name is kept as lineage in planning files; `225-10-SUMMARY.md` has the dated rename line appended.

## Merge

Merge commit `67278b5dbbd9e107ff37974b3e17ff6389868b9a`, parents `d14f82d71` and `2aa1a0cbb`. Conflicts and resolutions:

| File | Resolution |
|---|---|
| `.planning/STATE.md`, `.planning/state.json` | Took main's whole file (the orchestrator owns STATE; the phase branch's copy was stale). |
| `supabase/tests/test_api_keys_venue_identity_uniq.sql`, RED-UNDER-SETUP | Main's 17-entry list (ends with plan 13's `20261125132334_api_keys_venue_server_owner_read.sql`), then B (new name) LAST. JSON parsed, only that one entry added. |
| `supabase/tests/test_api_keys_venue_identity_uniq.sql`, final NOTICE | Union: main's text (with `6v-owner-read` and the narrowed `6v-no-grant`) plus plan 10's 6s arm text. All six 6v arms and all five 6s arms are present exactly once. |
| `scripts/mutation-floors.mjs`, `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/mutation-runner-floors.test.ts` | Took main's whole file (Task 1 step 2), then Task 2 re-added plan 10's moves by measurement. |
| `scripts/accounttruth-census.mjs`, `src/__tests__/accounttruth-census.test.ts` | No conflict. Plan 10's rows merged cleanly; test passes. |

## Re-base check of reconnect_allocator_api_key

`grep -a -l "FUNCTION public.reconnect_allocator_api_key" supabase/migrations/*.sql` lists three files: `20260422101911_api_keys_disconnected_at.sql` (the original definition, older than the others), `20260925120000_api_keys_account_identity.sql` and B. The plan expected two. The older file is superseded by 20260925120000, so the newest prior definition is unchanged. Nothing on main changed the function: `git log 017ba2e08..origin/main` over the snapshot and 20260925120000 is empty, and main's snapshot is byte-identical to the merge base's. `npm run schema:functions:check`: `SQL function snapshot is current (142 functions).`

## Deviations from Plan

**1. [Rule 1 - Bug] B's prod-body-ack was mis-derived by plan 10.** Found at Task 1 step 4. The plan's recipe (`git show origin/main:supabase/schema/functions/reconnect_allocator_api_key.sql > <scratch>`, then `node scripts/sql-body-normalize.mjs --diff-bodies supabase/schema/functions/reconnect_allocator_api_key.sql <scratch>`) prints the row (snapshot hash, live hash, differing lines):

```
DRIFT	reconnect_allocator_api_key	1	f2e69a2d7d582c25af13b2fe97fc333b999610bb9f5ef7b6dacc4408ee693340	8ebf230179b99d1f49cc8ed959ad2f7386aad92b592722c4825bc7aa1bd43c74	6
```

- The `live` hash is `8ebf230179b99d1f49cc8ed959ad2f7386aad92b592722c4825bc7aa1bd43c74`. B's pragma said `d5ef374c79d00b10c303bdbde81030602b35da67798dc2b1eb63a624fb593159`.
- Not caused by a main change: the same live hash came out at the merge base `017ba2e08`, at the phase head `d14f82d71` and at plan 10's own commit `dce263327`. `d5ef374c...` matches no body anywhere in the repo.
- Main's snapshot body MATCHes the function inside `20260925120000_api_keys_account_identity.sql` (`8ebf2301...`) and the PROD dump `supabase/schema/baseline.sql` (`MATCH ... 8ebf2301... 8ebf2301... 0`).
- Reproduced through VAC-04's own fetch path (`--extract-fn` on the PROD dump, then `--diff-bodies` against the snapshot): same row, live `8ebf2301...`.
- Method check: plan 16's accepted ack `7a9444d37e66b652d457660f13ce0795ab8d31b057b17215dff9dc44e15dd891` reproduces with the same recipe on `commit_scenario_batch` (snapshot from `2636fb1e5^` against the one at `2636fb1e5`), so the `live` column is the one VAC-04 accepts.
- Fix: only the pragma line changed, `d5ef...` to `8ebf230179b99d1f49cc8ed959ad2f7386aad92b592722c4825bc7aa1bd43c74`. The orchestrator decided this after its own reproduction. Commit `578bb0341`.
- Open: the ack is earned only if VAC-04 on the PR reports the same hash for live PROD. I did not read live PROD.

No other deviations.

## Gate runs (Task 1, narrowed on the lane)

Both exit 2 by design. Full logs in `<scratchpad>/p225/`.

```
test_api_keys_venue_identity_uniq exit=2
coverage: files 94/121
arms: 20/20/0   (executed/annotated/waived)
biting: 20   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 20   (arm lanes actually spawned — tallied inside runLane, independent of the 20 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
No defects in the narrowed scope.
  file test_api_keys_venue_identity_uniq.sql: sections 18 / judged 20 / annotated 20 / waived 0 / biting 20
test_api_keys_account_identity exit=2
coverage: files 94/121
arms: 45/45/0   (executed/annotated/waived)
biting: 45   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
lane-invocations: 45   (arm lanes actually spawned — tallied inside runLane, independent of the 45 the verdict loop counted; plus 1 baseline / 1 restore leg(s))
No defects in the narrowed scope.
  file test_api_keys_account_identity.sql: sections 45 / judged 45 / annotated 45 / waived 0 / biting 45
```

Executed, annotated, biting and lane-invocations are equal in both; waived is 0; no `defect(s):` line.

## Census values moved (Task 2)

Measured: `node scripts/mutation-runner/run.mjs --parse-only` printed `coverage: files 94/121`, `arms: 0/1042/0   (executed/annotated/waived)` and `No static defects. Every prose marker has a twin and every needle still matches.` A FULL local lane run was NOT done; 1042 is the static annotated-unwaived count, an upper bound on biting, and CI `sql-mutation` FULL on the PR (a floors edit forces FULL) is the run that compares it with a real biting count. The two gate files were measured biting individually, above.

| Value | main | measured (merged tree) | where |
|---|---|---|---|
| `ARMS_FLOOR` | 1033 | 1042 | `scripts/mutation-floors.mjs` (dated RAISED entry naming Phase 225 plan 19, quoting the parse-only line; main's entries kept above as lineage) |
| `FILES_FLOOR` | 94 | 94 (unchanged, B adds arms not files) | `scripts/mutation-floors.mjs` |
| `WAIVED_CEILING` | 0 | 0 | `scripts/mutation-floors.mjs` |
| `ARMS_FLOOR` registry entry | 1033 | 1042 | `gate-family-meta.test.ts` |
| `armsSeen` | 1033 | 1042 | `mutation-annotation-parser.test.ts` |
| `stepsSeen` | 1186 | 1190 | `mutation-annotation-parser.test.ts` (value the test reported) |
| `needles.length` | 1186 | 1190 | `mutation-annotation-parser.test.ts` (value the test reported) |
| `totalAnchored` | 1033 | 1042 | `mutation-runner-floors.test.ts` |
| synthetic FULL log arms / biting / lane-invocations / mean line / "arm lane(s) spawned" | 1033 | 1042 | `mutation-runner-floors.test.ts`; baseline/restore legs stay 94 |
| offset literals (sum-of-rows, +1 lane, +1 biting) | 1032 / 1034 | 1041 / 1043 | `mutation-runner-floors.test.ts` |
| per-file row `test_api_keys_venue_identity_uniq.sql` | sections 13 / judged 15 / annotated 15 / biting 15 | sections 18 / 20 / 20 / biting 20 | `mutation-runner-floors.test.ts` (copied from the `--file` run's own line) |
| per-file row `test_api_keys_account_identity.sql` | 41 / 41 / 41 / biting 41 | 45 / 45 / 45 / biting 45 | `mutation-runner-floors.test.ts` |

1033 + 9 = 1042 agrees with the measurement (plan 10's five 6s arms and four RECON arms), but the values were set from the measured run, not the sum.

## Other checks (verbatim)

```
npm run schema:functions:check
SQL function snapshot is current (142 functions).
DRIFT-05 gate (a): baseline 142 name(s) vs migration-replay 142 name(s) — agree, with 0 ratcheted disagreement(s) carried. ...

node scripts/lint-migration-data-dependence.mjs
lint-migration-data-dependence: corpus 340 migration(s), 422 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.

node scripts/lint-sql-gates.mjs
lint-sql-gates: scanned 121 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
node scripts/lint-sql-gates.mjs --self-test
lint-sql-gates self-test OK: 7 rules, red+green each.

node scripts/lint-app-guc.mjs
app-guc: files scanned 423
app-guc: annotated (lineage) 5 — ...
app-guc: findings 0

node scripts/mutation-runner/run.mjs --parse-only
coverage: files 94/121
arms: 0/1042/0   (executed/annotated/waived)
✅ No static defects. Every prose marker has a twin and every needle still matches.

npx tsc --noEmit -p .   -> exit 0, no output
```

Vitest, `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `accounttruth-census`, `lint-sql-gates`, `critical-regressions`, `drift-check-scripts`: `Test Files  7 passed (7)`, `Tests  1520 passed (1520)`. The three fingerprint parity files (`fingerprint-sameday-empty-parity`, `fingerprint-unpriced-parity`, `fingerprint-venue-server-parity`), run by explicit path: `Test Files  3 passed (3)`, `Tests  25 passed (25)`. No analytics-service conflict came in, so pytest and mypy were not run. No Docker or local Supabase stack was started; the lane is a throwaway local PostgreSQL cluster and left no process behind.

## Known Stubs

None.

## Threat Flags

None. B is SQL only and adds no endpoint or auth path.

## Round 2 re-base (2026-11-26)

origin/main moved again (`19ee154a6`): #1363 `20261126130000_strategy_analytics_computed_at_nullable.sql` and #1358 `20261126140000_mt5_terminal_lease.sql` (Phase 230 MT5NIGHTLY), which moved the census too. `commits: 41` in the frontmatter is re-measured by `git rev-list --count d14f82d71..HEAD` at the code head `9bef055b0` and counts the main commits the two merges brought in.

**New name: `20261126140500_api_keys_venue_server_index.sql`** and `down/20261126140500-rollback.sql`. Main's tip `20261126140000` is a future-dated name, so no honest current UTC sorted after it; the name only has to sort after every migration on main and the PROD tip (never the allowlist). `grep -a -rn 20261126102346 --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .` prints nothing. A second dated line is appended to `225-10-SUMMARY.md`. `npm run schema:functions:check`: `SQL function snapshot is current (145 functions).`

**Merge `1f6842bba`; conflicts** (all four census files, resolved by taking main's side then re-measuring):
`scripts/mutation-floors.mjs`, `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/mutation-runner-floors.test.ts`. The rename is commit `9bef055b0`. The gate files, migration and snapshot merged without conflict.

**Census, main vs measured.** `node scripts/mutation-runner/run.mjs --parse-only` printed `coverage: files 95/122`, `arms: 0/1050/0   (executed/annotated/waived)`, `No static defects. Every prose marker has a twin and every needle still matches.`

| Value | main | measured |
|---|---|---|
| `ARMS_FLOOR` (and the gate-family-meta registry entry) | 1041 | 1050 |
| `FILES_FLOOR` | 95 | 95 |
| `WAIVED_CEILING` | 0 | 0 |
| `armsSeen` | 1041 | 1050 |
| `stepsSeen` | 1195 | 1199 |
| `needles.length` | 1195 | 1199 |
| `totalAnchored` | 1041 | 1050 |
| synthetic FULL log (arms, biting, lane-invocations, mean line); baseline/restore legs stay 95 | 1041 | 1050 |
| offset literals | 1040 / 1042 | 1049 / 1051 |
| per-file row, uniq gate | sections 13 / judged 15 / annotated 15 / biting 15 | 18 / 20 / 20 / 20 |
| per-file row, account-identity gate | 41 / 41 / 41 / 41 | 45 / 45 / 45 / 45 |

No FULL local lane run; CI `sql-mutation` FULL on the PR compares the floor with a real biting count.

**Narrowed gate runs on the merged tree** (both exit 2, "No defects in the narrowed scope.", executed = annotated = biting = lane-invocations, waived 0):

```
test_api_keys_venue_identity_uniq: coverage files 95/122; arms: 20/20/0; biting: 20; lane-invocations: 20; sections 18 / judged 20 / annotated 20 / waived 0 / biting 20
test_api_keys_account_identity:    coverage files 95/122; arms: 45/45/0; biting: 45; lane-invocations: 45; sections 45 / judged 45 / annotated 45 / waived 0 / biting 45
```

**Other checks:**

```
lint-migration-data-dependence: corpus 342 migration(s), 424 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.
lint-sql-gates: scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).
app-guc: findings 0
npx tsc --noEmit -p .  -> exit 0, no output
vitest (5 census files + critical-regressions + drift-check-scripts + 3 fingerprint-*-parity): Test Files  10 passed (10), Tests  1547 passed (1547)
mypy --strict (CI command, from analytics-service/): Success: no issues found in 145 source files
```

**Ack still correct.** `node scripts/sql-body-normalize.mjs --extract-fn supabase/schema/baseline.sql reconnect_allocator_api_key > <scratchpad>/p225/<file>` then `--diff-bodies supabase/schema/functions/reconnect_allocator_api_key.sql <file>` prints `DRIFT reconnect_allocator_api_key 1 f2e69a2d7d582c25af13b2fe97fc333b999610bb9f5ef7b6dacc4408ee693340 8ebf230179b99d1f49cc8ed959ad2f7386aad92b592722c4825bc7aa1bd43c74 6`. The `live` hash equals B's pragma `8ebf230179b99d1f49cc8ed959ad2f7386aad92b592722c4825bc7aa1bd43c74`.

**NOT RUN, loud:** pytest on the analytics-service tests touched by the merge (`test_mt5_xlease.py`, `test_job_worker.py`, `test_process_key.py` and eleven others). The local Python lacks `pandas` (`ModuleNotFoundError` in `tests/conftest.py`), and installing packages is out of scope for this plan. The merge had no analytics-service conflicts: those files are main's own, covered by its CI. mypy strict passed.

## Task 3: PENDING (blocking-human, run by the orchestrator)

Not attempted by this executor. The orchestrator runs the read-only PROD pass per the plan's Task 3 instructions (marker query first, one query per call, counts and verdicts only), and records each step's result here:

1. Marker names PRODUCTION: _pending_
2. PROD ledger tip is earlier than `20261126140500` (B's name after round 2): _pending_
3. Gate A5, both censuses: _pending_
4. Multi-server groups = 0; ambiguous keys = 0: _pending_
5. PR-2b-2 bodies live (`login_servers` in `commit_scenario_batch`; venue_server grant authenticated true, anon false); analytics and Vercel deploys at or after PR-2b-2: _pending_
6. PR-2c live; 225-18-SUMMARY.md records the post-deploy wrong-server attempt as a refusal: _pending_
6b. Poll-path server refusal (WR-01) shipped on origin/main or booked with an owner in 225-20-SUMMARY.md: _pending_
7. 155.2 freeze open: _pending_
8. Exactly one open PR touches `supabase/migrations/` (this one): _pending_
Also pending for the orchestrator: VAC-04 on the PR must report `8ebf2301...` for live PROD `reconnect_allocator_api_key`, which is what earns the ack in B. After merge, read the index definition from `pg_indexes` and the reconnect body from `pg_proc` on PROD and record both.

## Self-Check: PASSED

- Files exist: the new migration, its rollback, both gates, the snapshot, the four census files and this SUMMARY.
- Commits are ancestors of HEAD: `67278b5db`, `578bb0341`, `d0817adcf`.
- Not done by design: STATE.md, ROADMAP.md, VERSION, package.json, CHANGELOG, TODOS (ship step), push, PR.
