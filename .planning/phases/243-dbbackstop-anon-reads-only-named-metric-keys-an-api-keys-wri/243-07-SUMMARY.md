---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 07
subsystem: testing
tags: [vitest, live-db, local-stack, supabase, security-definer, DBACC-02]
status: complete
requires:
  - phase: 243-dbbackstop
    plan: 05
    provides: "public.insert_api_key (service_role only, p_id) and the api_keys_user_id_immutable trigger"
provides:
  - "src/lib/test-helpers/live-db.ts createTestApiKey(admin, opts): RPC seed, optional extras UPDATE, p_id and ifAbsent"
  - "fourteen live-DB vitest files seed api_keys through the helper and never .from(\"api_keys\").insert or .upsert"
affects: [PR-B CI (frontend-live-db-lane), plan 09 (anon probe moves to the helper), plan 10 (PR-C insert fence and its census)]
tech-stack:
  added: []
  patterns:
    - "idempotent fixed-id re-seed without ON CONFLICT: createTestApiKey({ id, ifAbsent: true }) looks the id up and skips the insert, because the PR-C BEFORE INSERT fence fires on INSERT ... ON CONFLICT before conflict resolution"
    - "columns the writer does not take (created_at, sync_status, ...) are applied by a follow-up admin UPDATE through extras"
key-files:
  created: []
  modified:
    - src/lib/test-helpers/live-db.ts
    - src/lib/sec-005-live-probe.test.ts
    - src/lib/migration-028-tenant-check.test.ts
    - src/__tests__/allocator-holdings-rls.test.ts
    - src/__tests__/compare-holding-rls.test.ts
    - src/__tests__/claim-dedupe-done-pending-children-guard.test.ts
    - src/__tests__/delete-allocator-api-key-rpc.test.ts
    - src/__tests__/gdpr-export.test.ts
    - src/__tests__/migration-084-trigger.test.ts
    - src/__tests__/request-allocator-holdings-sync-queued.test.ts
    - src/__tests__/retention-crons.test.ts
    - src/__tests__/sanitize-user.test.ts
    - src/__tests__/scenario-commit-batch-race.test.ts
    - src/__tests__/scenario-commit-batch-tx.test.ts
    - src/__tests__/scenario-commit-rls.test.ts
key-decisions:
  - "ifAbsent without an id throws (fail loud); extras are still applied when ifAbsent finds the row, which keeps the old upsert's 'row ends in this state' semantics"
  - "is_active: true in old payloads is dropped, not routed through extras, because it equals the table default the writer leaves in place"
requirements-completed: [DBACC-02]
duration: ~3h wall clock (about 2h of it waiting on a machine at load average 80-117 and on the shared Docker lane)
completed: 2026-11-27
commits: 3
plan_head_before: 9de595438a0dae33d828d693b3eeb81abf3564e8
plan_head_after: 76c5097d1314425511539b60454ac86f2f45bbbc
actuals:
  tokens: 12000
  tasks: 3
  commits: 3
---

# Phase 243 Plan 07: live test seeds move to insert_api_key Summary

One shared helper, `createTestApiKey`, writes every live-DB test `api_keys` seed through the audited `insert_api_key` writer (RPC, optional extras UPDATE, caller-chosen `p_id`, idempotent `ifAbsent`), and fourteen live files now use it, so the PR-C insert fence cannot red `frontend-live-db-lane`.

Tasks 3/3, 15 files touched (0 created, 15 modified), no checkpoint, no auth gate. Commits: `9a6fe1738` (task 1, tracer), `d4bc4953b` (task 2), `76c5097d1` (task 3). `git rev-list --count 9de595438..HEAD` read 3 at SUMMARY time, equal to this plan's task commits (SUMMARY commit follows).

## Precondition

- PROD ledger half: **measured by orchestrator** (2026-11-27): marker query named PRODUCTION, the ledger tip read `20261127130000 cron_destinations_exact`, and `20261127120100 insert_api_key_rpc_and_user_id_immutable` (plan 05's version) is present. Not re-run here (no PROD MCP).
- Git half, run here: `git fetch origin main -q` exit 0; `git ls-tree --name-only origin/main supabase/migrations/` lists exactly one `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql`; the branch carries it (merge `9de595438`).
- `node scripts/verify-plan-anchors.mjs <this plan>`: `OK: 1 plan file(s), no stale claims`, exit 0.

## Helper (`createTestApiKey`)

`createTestApiKey(admin, { userId, exchange?, label?, apiKeyEncrypted?, apiSecretEncrypted?, dekEncrypted?, kekVersion?, venueAccountId?, venueServer?, id?, ifAbsent?, extras? }): Promise<string>`, beside `createTestUser`, in its throw-on-failure style (every message starts `[createTestApiKey]` and names the step). In order:
1. `extras` naming `user_id` or `id` throws `[createTestApiKey] extras may not set user_id or id (user_id is immutable, DBACC-02)`.
2. `ifAbsent` without `id` throws. With both, a lookup by id: an existing row with the same owner is reused (insert skipped), one under another `user_id` throws.
3. Otherwise `admin.rpc("insert_api_key", { p_user_id, p_exchange, p_label, p_api_key_encrypted, ... })`, mapping each given option to its `p_` name and omitting undefined ones (defaults: `binance`, `live-key-<epoch>`, placeholder ciphertext).
4. `extras` is applied by `admin.from("api_keys").update(extras).eq("id", id)`.
5. Returns the id.

## Attestation check (required by the plan)

`insert_api_key` stamps `attested_venue = exchange`; the replaced direct inserts left it NULL. Node scan over all 14 migrated files plus `src/lib/anon-strategies-live-probe.test.ts` for `attested_venue` and `finalize-wizard` / `finalize_wizard`: **15 of 15 files name neither**. No assertion depends on a NULL attestation, so no seed needed `extras: { attested_venue: null }`.

## Per-file lane results (local-stack lane, `npm run test:live-db -- <files>`)

Arm counts are unchanged: `git diff 9de595438..HEAD -- src` changes **0** `it(` / `describe(` lines, so each file has the same tests as before.

Run 1 (task 1), `Test Files 4 passed (4)`, `Tests 16 passed | 1 skipped (17)`:

| file | result |
|---|---|
| sec-005-live-probe | 5 tests, 4 passed, 1 skipped |
| migration-028-tenant-check | 6 passed |
| allocator-holdings-rls | 2 passed |
| compare-holding-rls | 4 passed |

The one skip is the arm gated on `HAS_LIVE_DB && HAS_INTROSPECTION` (needs `SUPABASE_ACCESS_TOKEN`, a Management API credential; the lane has none). That arm seeds nothing through `api_keys`; none of the 3 migrated seed sites in the file is skipped.

Run 2 (task 2), `Test Files 5 passed (5)`, `Tests 89 passed | 2 skipped (91)`:

| file | result |
|---|---|
| gdpr-export | 58 tests, 57 passed, 1 skipped |
| claim-dedupe-done-pending-children-guard | 16 passed |
| request-allocator-holdings-sync-queued | 5 passed |
| delete-allocator-api-key-rpc | 5 passed |
| migration-084-trigger | 7 tests, 6 passed, 1 skipped |

The two skips are the arms gated on `HAS_INTROSPECTION` (migration-084's `HAS_LIVE_DB || !HAS_INTROSPECTION` arm, and one gdpr arm: `it.skipIf(HAS_LIVE_DB)` which skips by design when the DB is live). Neither seeds `api_keys` through a migrated site.

Run 3 (task 3), `Test Files 5 passed (5)`, `Tests 37 passed | 33 skipped (70)`:

| file | result | skips and why |
|---|---|---|
| sanitize-user | 10 tests, 9 passed, 1 skipped | the `it.skipIf(HAS_LIVE_DB)` placeholder, skipped by design |
| scenario-commit-batch-race | 2 passed | none |
| scenario-commit-batch-tx | 16 tests, 10 passed, 6 skipped | 6 arms gated on `HAS_INTROSPECTION`; the `beforeAll` fixed-id seed (`ifAbsent`) ran and the 10 live arms passed |
| retention-crons | 26 tests, 12 passed, 14 skipped | all skipped arms gated on `HAS_INTROSPECTION`. **Two of the four migrated seed sites (the "rotation fire" and "dedup fire" arms) are inside skipped arms and were NOT executed on the lane.** The two non-skipped arms (rotation reminder, dedup) ran the same helper call shape (`extras: { created_at }`) and passed |
| scenario-commit-rls | 16 tests, 4 passed, 12 skipped | 12 arms gated on `HAS_FULL_LIVE` (needs `SCENARIO_COMMIT_BASE_URL`, a running dev server; absent on the lane), and its `beforeAll` returns early, so the migrated seed did **not** run in this run |

**Not proven by the lane, named plainly:** retention-crons' two introspection-gated seed sites and every live arm of scenario-commit-rls. To exercise scenario-commit-rls' seed anyway, I ran it once more on the lane with `SCENARIO_COMMIT_BASE_URL=http://127.0.0.1:9` (a diagnostic only, environment variable, nothing committed): `beforeAll` completed (the two fixed-id `createTestApiKey(... ifAbsent)` calls and everything after them), `T_RLS9` (a DB-only arm) passed, and the 11 route arms failed with `TypeError: fetch failed ... bad port`, which is the dummy URL, not the seed. That shows the seed path works; it does not prove those 12 arms, which stay skipped on the real lane, as they were before this plan.

Lane hygiene: every session ended with `down` and `docker ps --filter name=supabase -q` empty, and the lock released. Boots failed 6 times on `supabase_analytics_quantalyze container is not ready: unhealthy` while the machine ran at load average 80-117 (three executors and the main session); every one of those sessions torn down cleanly, and the retries succeeded once load dropped. No test ran on a failed boot.

## Residual census (node scan for `from("api_keys")` followed by `.insert(` or `.upsert(` over `git ls-files src`, multi-line)

```
src/app/api/keys/validate-and-encrypt/route.ts
src/components/strategy/StrategyForm.test.tsx
src/lib/anon-strategies-live-probe.test.ts
src/lib/sec-005-api-keys-projection.test.ts
```

Exit 0 (every name is an allowed residual): the route (plan 06 removes it this wave), `StrategyForm.test.tsx` (a mock that records a would-be browser insert on purpose), the anon live probe (plan 09 moves it), `sec-005-api-keys-projection.test.ts` (the hit is inside its header comment). No missed inserter.

## PROOF-01 for the helper's guard (verbatim)

`live-db.ts` backed up with `cp` to the scratchpad, the `extras` `user_id`/`id` refusal deleted (`git diff --stat`: `src/lib/test-helpers/live-db.ts | 5 -----`), and a scratchpad test (not committed, removed after) run on the lane. It calls `createTestApiKey(admin, { userId: a, extras: { user_id: b } })` and expects the helper's own refusal message, then that user `a` owns 0 keys.

Neutered (RED):

```
× extras naming user_id is refused by the helper's own guard 387ms
AssertionError: expected [Function] to throw error matching /extras may not set user_id or id \(user_id is immutable, DBACC-02\)/ but got '[createTestApiKey] extras UPDATE of a…'
+ Received:
"[createTestApiKey] extras UPDATE of api_keys 5ea1480e-b15f-4d43-9b0e-1e4880056dd0 failed: api_keys.user_id is immutable: a key never changes owner"
NEUTERED TEST EXIT 1
```

So with the guard gone, the immutability trigger refused the repoint (plan 05's trigger is the backstop), and the test went RED on the message. Restored with `cp`; `cmp` silent (`RESTORED cmp silent`). Restored (GREEN):

```
✓ extras naming user_id is refused by the helper's own guard 474ms
Tests  1 passed (1)
RESTORED TEST EXIT 0
```

`live-db.ts` byte-equal to the committed version afterwards (`cmp` against `git show HEAD:...`).

## Other verification

- `npx tsc --noEmit`: clean (no output). It caught one defect while editing, a leftover `keyRow` reference in retention-crons after the helper returned a bare id; fixed before the first commit of that file.
- `npm run lint`: exit 0, 0 errors, 4 pre-existing warnings, all in files this plan does not touch (`queries.stale-analytics-detail.test.ts` and one more).
- `node scripts/live-db-fixture-drift-census.mjs`: `corpus 52 file(s); 0 finding(s) (0 absent-table, 0 absent-column, 0 unexposed-schema, 0 ambiguous-overload), 65 unresolved.` (was 67 unresolved; not gated).
- `npx vitest run` (whole suite), first run under load average ~100: `Test Files 37 failed | 1261 passed | 20 skipped (1318)`, `Tests 93 failed | 28241 passed | 306 skipped`. 36 of the 37 failing files failed with `Test timed out in 5000ms` and none touches this plan's diff. Re-run of exactly those 37 files after the load dropped: `Test Files 1 failed | 36 passed (37)`, `Tests 2 failed | 2259 passed (2261)`. The remaining failure is `src/lib/factsheet/compute.conventions.test.ts` (fixtures B and C, a frozen snapshot of `skew` at the 13th-15th significant digit: `Snapshot ... mismatched`); neither the file nor anything it imports is in this plan's diff (`git diff --stat 9de595438..HEAD` lists only the 15 files above), so it is pre-existing on this machine (floating-point drift) and was not touched. I did not re-run it on the base commit.

## Deviations from Plan

None to the plan's behaviour. Disclosures:

1. **[Disclosure] Two assertion-adjacent edits.** In `claim-dedupe-done-pending-children-guard.test.ts` the line `expect(akErr, ...).toBeNull()` went away with the inline insert: the helper throws on an RPC error, which fails the arm louder, not weaker. In `retention-crons.test.ts` two `expect(...).toBe(keyRow.id)` / `api_key_id: keyRow.id` references became `keyId` (same value). No assertion was weakened or removed beyond that.
2. **[Disclosure] `is_active: true` dropped from seeds** (allocator-holdings-rls, compare-holding-rls, delete-allocator-api-key-rpc, request-allocator-holdings-sync-queued, the four retention-crons sites, the three scenario-commit files): it equals the table default (`"is_active" boolean DEFAULT true NOT NULL`, baseline) which the writer leaves in place.
3. **[Rule 3 - Blocking] Local-stack lane boot flake under machine load**, described above; resolved by retrying, no code change.

## Known Stubs

None. Test placeholders in seeds are synthetic ciphertext literals, as before.

## Threat Flags

None. No new endpoint, auth path or schema; T-243-23 holds (the helper runs only through `createLiveAdminClient` under `HAS_LIVE_DB`, `vitest.livedb.config.ts` was not touched, placeholder ciphertext only) and T-243-24 holds (`ifAbsent` throws on an existing id owned by another user; `extras` naming `user_id`/`id` is refused, and the PROOF-01 record shows the trigger is the backstop).

## Self-Check: PASSED

- `createTestApiKey` exported from `src/lib/test-helpers/live-db.ts` (`grep -ac "export async function createTestApiKey"` prints 1).
- Per-task node scans over the migrated files print 0 each (4 files, 5 files, 5 files).
- Commits `9a6fe1738`, `d4bc4953b`, `76c5097d1` are ancestors of HEAD.
- STATE.md and ROADMAP.md unmodified; docker down; lock released.
