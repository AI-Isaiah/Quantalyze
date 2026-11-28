---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 06
subsystem: api
tags: [api-keys, rpc, security-definer, audit-coverage, live-db-lane, vitest, DBACC-02]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 05
    provides: "public.insert_api_key (SECURITY DEFINER, service_role only, one overload), applied to PROD"
provides:
  - "POST /api/keys/validate-and-encrypt writes the api_keys row through admin.rpc(\"insert_api_key\"), no direct insert"
  - "insert_api_key in MUTATING_RPC_NAMES, so the `@audit-skip: key connect` pragma is enforced"
  - "hand-kept insert_api_key entry in database.types Functions"
  - "src/lib/insert-api-key-rpc-live.test.ts, live-lane proof of the writer path, arms (a) to (d)"
  - "route unit oracle moved to the writer's arguments, plus a no-direct-insert arm"
affects: [243-09 PR-C insert fence (precondition: THIS plan's code deployed), seeds and e2e helpers (plans 07 and 08)]
requirements-completed: [DBACC-02]
key-files:
  created:
    - src/lib/insert-api-key-rpc-live.test.ts
  modified:
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/__tests__/audit-coverage.test.ts
    - src/lib/database.types.ts
    - tests/integration/process-key-thin-adapters.test.ts
key-decisions:
  - "The audit gate anchors its 8-line pragma window on the last comment line above the statement, so a one-line pragma directly above the rpc call is NOT seen; a second comment line sits between the pragma and the call"
  - "Unit-test resets of the writer's records collapsed into one resetWriterRecords() helper so the file's PERSIST_STATE.inserts references stay at three (the mock's recording, the helper's reset, the no-direct-insert arm)"
duration: ~2h (wall clock, mostly queueing for the shared Docker lock and a machine at load 80-140)
completed: 2026-11-27
commits: 3
plan_head_before: 9de595438a0dae33d828d693b3eeb81abf3564e8
plan_head_after: 5465531a27c0f36b4f69e7cbadf1b5d763c941e2
actuals:
  tokens: 14500
  tasks: 2
  commits: 3
---

# Phase 243 Plan 06: validate-and-encrypt writes through insert_api_key Summary

The `validate-and-encrypt` route, the only production direct inserter of `api_keys`, now persists through `admin.rpc("insert_api_key", ...)` with the `withAuth` session user as owner, and a live-lane file proves the writer path (uuid back, attestation stamped, 23505 naming the venue-identity constraint, authenticated caller refused) on a real PostgREST.

Tasks 2/2 plus one Rule 3 fix, 6 files touched (1 created, 5 modified), no checkpoint, no auth gate. Commits: `c0bf8ca70` (task 1, tracer), `43e1cb2da` (task 2), `5465531a2` (Rule 3 fix). `git rev-list --count 9de595438..HEAD` read 3 at SUMMARY write, equal to this plan's code commits (the SUMMARY commit follows).

## Precondition (task 1)

- PROD ledger half: **measured by orchestrator** 2026-11-27 (marker query named PRODUCTION first, then the ledger tip read returned `20261127130000 cron_destinations_exact`, and `20261127120100 insert_api_key_rpc_and_user_id_immutable` is present). Not re-run by this executor, which has no PROD MCP.
- Git half, run here: `git fetch origin main -q` exit 0; `git ls-tree --name-only origin/main supabase/migrations/` lists exactly one name ending `_insert_api_key_rpc_and_user_id_immutable.sql` (`20261127120100_...`); `git merge-base --is-ancestor origin/main HEAD` exit 0 and the migration's commit `64de23c65` is in this branch.
- `node scripts/verify-plan-anchors.mjs <this plan>`: `claims: 7 checked`, `OK: 1 plan file(s), no stale claims.`, exit 0.

## What changed

**Route.** The persist call is `await admin.rpc("insert_api_key", { ... })`:
- `p_user_id: userId` (the session user; the hostile-body oracle asserts it), `p_exchange: exchangeNormalized`, `p_label: labelOrDefault`.
- One `p_<column>` per `encryptedColumns` member, written out by name: `p_api_key_encrypted`, `p_api_secret_encrypted`, `p_passphrase_encrypted`, `p_dek_encrypted`, `p_nonce`, `p_kek_version`. The `encryptedColumns` mapped type still fails `tsc` if the encrypt schema grows a member.
- `p_venue_account_id` and `p_venue_server` are spread in only when `failingHolderId === null` and the value is non-null; omitted rather than sent as null, as `create-with-key` does.
- No attestation argument: the writer stamps `attested_venue` from `p_exchange`.
- Failure test is `insertError || typeof insertedKeyId !== "string"`; every former `inserted.id` (swap `newKeyId`, compensating delete, the two success-path reads) is `insertedKeyId`. The 23505 / `pgConstraintName` / scrub / Sentry branches are untouched; the scrub list still carries `api_key, api_secret, passphrase, venueAccountId, venueServer`.
- The block comment above `encryptedColumns` now says the write goes through the audited writer, PR-C fences every other insert, and attestation is stamped in the database.

**Audit allow-list.** `"insert_api_key"` added to `MUTATING_RPC_NAMES` with a dated Phase 243 comment. Pragma enforcement is live: with the pragma neutered, `audit-coverage.test.ts` fails with `Found 1 uninstrumented mutation(s)` naming `route.ts:945`; restored, 28/28 pass (`cmp` identical).

**Types.** `insert_api_key` in `Functions`, alphabetical (after `increment_user_session_count`), all DEFAULT NULL parameters optional (`p_kek_version?: number`, `p_id?: string`, ...), `Returns: string`.

## Live-lane proof (task 1 step 5)

`bash scripts/local-stack/run.sh up` then `npm run test:live-db -- src/lib/insert-api-key-rpc-live.test.ts --reporter=verbose`, under the shared lock (acquired 2026-11-27T17:00:13Z), stack down and lock released afterwards. The stack replayed the one migration newer than its dump (`20261127130000`); `insert_api_key` is carried by the dump itself. Result lines:

```
 ✓ (a) service_role writes through the RPC: uuid back, owner kept, attested_venue stamped, server normalised 34ms
 ✓ (b) the same venue identity again answers 23505 naming api_keys_user_exchange_venue_account_uniq 11ms
 ✓ (c) an authenticated caller is refused, and no row exists for its label 22ms
 ✓ (d) a given p_id is the stored id 21ms
 ✓ advertises why the live arms were skipped when no live DB is configured 1ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
LIVE_EXIT=0
```

Arms (a) to (d) PASSED, none skipped. Arm (a) reads the row back: `user_id` equals the user, `attested_venue` is `"mt5"`, `venue_server` is `"srv.live-test"` (from `" Srv.Live-Test "`). Arm (b) asserts `error.code === "23505"` and `pgConstraintName(error) === VENUE_IDENTITY_CONSTRAINT`. The live arms were not themselves neutered (the plan did not require it); the SQL gate `test_insert_api_key_rpc.sql` from plan 05 owns the writer's mutation-checked coverage.

`scripts/live-db-lane-corpus.mjs` now derives 51 files (was 50). `CORPUS_FLOOR` is 48, so headroom is 3, exactly the contract test's `RATCHET_SLACK` of 3, and that test passed in the full run. **If plan 07 or 08 also adds a `HAS_LIVE_DB` file, the combined phase branch exceeds the slack and `CORPUS_FLOOR` must be raised at merge.**

## Unit oracle (task 2)

All 65 `PERSIST_STATE.inserts` assertions moved to the writer's arguments with the same strength:

| Before | After |
|---|---|
| `row.user_id` | `args.p_user_id` (and not the hostile body's id) |
| `row.exchange` | `args.p_exchange` against hand-typed literals |
| `row.attested_venue` | `expect(args).not.toHaveProperty("p_attested_venue")`, with the comment that the database stamps it (SQL gate arm R1, live arm (a)) |
| totality over `EncryptKeyResponseSchema.shape` | every shape key K is `args["p_"+K]`, now compared to the seam's VALUE, not only present |
| venue login / server present | `args.p_venue_account_id` / `args.p_venue_server` |
| venue login / server null over a failing holder | `.not.toHaveProperty(...)`: absent as keys, not null |
| `expect(inserts).toEqual([])` "no write" | `expect(insertKeyCalls()).toEqual([])` |
| 23505 test's `insertResult` | the same error object on `insertKeyResult` |

The admin mock dispatches `rpc` by name: `insert_api_key` answers `insertKeyResult ?? { data: "persisted-key-id", error: null }`; every other name keeps `rpcResult ?? { data: null, error: null }`, so the `swap_account_slot` arms are unchanged. Three "no swap" assertions after a successful insert (`rpcCalls` equal to `[]`) became `nonWriterRpcCalls()` equal to `[]`; every refusal-path `rpcCalls` equal to `[]` stays as it was (zero rpc of any kind). A new arm records that a successful connect leaves no `.from("api_keys").insert` in the mock.

Acceptance counts:

| Check | Before | After | Required |
|---|---|---|---|
| `grep -ac "PERSIST_STATE.inserts"` in route.test.ts | 65 | 3 | <= 3 |
| `grep -ac "insertKeyCalls()"` | 0 | 58 | >= 10 |
| `grep -ac "p_attested_venue"` | 0 | 3 | >= 1 |
| `it(`/`test(` count (`grep -acE "^\s*(it\|test)(\.each)?\("`) | 117 | 118 | not lower |
| route.ts direct `from("api_keys").insert(` matches | 1 | 0 | 0 |
| `rpc("insert_api_key"` in route.ts | 0 | 1 | 1 |
| `"insert_api_key"` in audit-coverage.test.ts | 0 | 1 | 1 |
| `insert_api_key: {` in database.types.ts | 0 | 1 | 1 |

The 3 remaining `PERSIST_STATE.inserts` references are the mock's own recording, `resetWriterRecords()`, and the new no-direct-insert arm.

## PROOF-01 record (neuter, see RED, restore, cmp, see GREEN)

No-direct-insert arm. Backup `cp` of `route.ts` to the scratchpad, then a direct `await admin.from("api_keys").insert({...})` added before the rpc call:

```
$ npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts
 × a successful connect writes through insert_api_key and records NO direct .from("api_keys").insert
AssertionError: expected [ { …(3) } ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 156 passed (157)
$ cp <backup> route.ts ; cmp <backup> route.ts
cmp: silent/identical
$ npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts
 Test Files  1 passed (1)
      Tests  157 passed (157)
```

Second neuter, same procedure: dropping the `failingHolderId === null &&` guard on `p_venue_account_id` turned `an MT5 add beside the owner's FAILING key on that login inserts without identity ...` RED (1 failed, 156 passed); restored, `cmp` identical. Third: removing the `@audit-skip: key connect` pragma turned `audit-coverage.test.ts` RED, restored, 28/28 GREEN.

## Verification run

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npx vitest run src/__tests__/audit-coverage.test.ts` | `Tests 28 passed (28)` |
| `npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts` | `Tests 157 passed (157)` |
| `npm run lint` | `0 errors, 4 warnings` (all in unrelated files, pre-existing); planning-hygiene, route-manifest, canonical-domain checks OK. `eslint` re-run on the five touched src files after the last edit: clean |
| live lane, `insert-api-key-rpc-live.test.ts` | 4 arms passed, `LIVE_EXIT=0` (above) |
| `npx vitest run` (whole suite, run on a host at load average 80 to 140 while two sibling executors and Docker ran) | `Test Files 39 failed \| 1260 passed \| 20 skipped (1319)`, `Tests 109 failed \| 28227 passed` |

**The whole-suite red is not green, and this is its accounting, not a pass.** I re-ran the 39 failed files with `--maxWorkers=3`: 11 files and 15 tests still failed, one of them caused by this plan (below, fixed). I re-ran the other 38 with `--maxWorkers=2 --testTimeout=150000`: 35 passed, 3 files / 4 tests failed. I then ran those three files on a detached worktree of the base commit `9de595438` with the same flags, and the SAME four tests failed there:

- `src/__tests__/mutation-runner-floors.test.ts` > `--parse-only` deliberately does NOT print it (spawn test)
- `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` > R4: `scripts/ci-apt.sh --self-test` exits 0
- `src/lib/factsheet/compute.conventions.test.ts` > fixtures B and C (`skew` differs in the 17th significant digit: `-0.11360716852722537` against `...538`, a platform float difference)

Those four are pre-existing on this machine, independent of this plan, and not fixed here (scope boundary). Every other full-suite failure was a 5 s to 30 s timeout under the host's load and passed on re-run. The base worktree was removed afterwards. No whole-suite run exited 0 in this session, so the claim "`npx vitest run` green" is NOT made; the claim is "no failure attributable to this plan remains".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A second test mocked the route's admin client and broke when the write moved to an RPC**
- **Found during:** whole-suite run after task 2
- **Issue:** `tests/integration/process-key-thin-adapters.test.ts` > `keys/validate-and-encrypt flag=on STILL uses legacy path (API-2 lock)` mocks the admin client with `rpc: async () => ({ data: null, error: null })`. The route now reads the new key's id from the `insert_api_key` result, so `typeof insertedKeyId !== "string"` took the failure branch and the case answered 500 instead of 200. The file is not in the plan's `files_modified`, and the plan's task 2 `read_first` did not name it.
- **Fix:** that mock's `rpc` answers `{ data: "persisted-key-id", error: null }` for `insert_api_key` and the null answer for every other name; the stale comment above the direct `insert` mock records why it stays (other routes the file drives).
- **Files modified:** `tests/integration/process-key-thin-adapters.test.ts`
- **Verification:** that file, 21 of 21 pass
- **Commit:** `5465531a2`

**2. [Rule 1 - Bug in own change] The one-line pragma directly above the rpc call was not seen by the audit gate**
- **Found during:** task 1, first `audit-coverage.test.ts` run (`route.ts:943` reported uncovered)
- **Issue:** for an rpc call the gate's `chainStart` is the nearest non-blank, non-`.` line above, which was the pragma itself, and its 8-line window starts above `chainStart`. `create-with-key` is covered only because prose lines sit between its pragma and its call.
- **Fix:** a two-line explanatory comment now sits between the pragma and the call (it states why it must stay). The plan's own wording ("pragma within 8 lines above") is true but not sufficient; recorded here for plans 07 and 08 if they add a call site.
- **Commit:** `c0bf8ca70`

### Plan wording corrected, not deviated from

The acceptance criterion `grep -ac "PERSIST_STATE.inserts" ... EXPECT<=3` is met only because the six per-describe reset blocks became one `resetWriterRecords()` helper and two comments were reworded; the plan did not name the helper.

## Known Stubs

None. `src/lib/insert-api-key-rpc-live.test.ts` writes the placeholder ciphertext `"live-rpc-placeholder"` and the synthetic login `9<last 8 digits of the timestamp>` into a throwaway local-stack database and deletes the rows in `afterAll`.

## Threat Flags

None. The plan's register is implemented: T-243-19 (owner is the session user only; asserted against a hostile body), T-243-20 (the same scrub list wraps the RPC error), T-243-21 (`insert_api_key` is in `MUTATING_RPC_NAMES`, pragma enforcement shown RED when neutered), T-243-22 (precondition: git half run here, PROD ledger half measured by the orchestrator).

## Delivery notes for the phase

- PR-B merge gate holds: PR-A's migration is in the PROD ledger (orchestrator measurement). PR-C's fence (plan 09) must not merge until THIS route is deployed.
- `CORPUS_FLOOR` headroom is at the contract test's limit (51 files against floor 48); see above.

## Self-Check: PASSED

- `src/lib/insert-api-key-rpc-live.test.ts`, the route, route.test.ts, audit-coverage.test.ts, database.types.ts, `tests/integration/process-key-thin-adapters.test.ts`: FOUND.
- Commits `c0bf8ca70`, `43e1cb2da`, `5465531a2`: all ancestors of HEAD.
- Docker: this plan's stack was brought down by its own session script (`docker supabase containers after down: []`) and the lock released (`lock released`); the containers and lock owner `243-07` visible afterwards belong to the sibling executor.
