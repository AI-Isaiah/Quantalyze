---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
scope: PR-B wave 4 (plans 06, 07, 08), diff 9de595438..786f1c82e excluding .planning
reviewed: 2026-11-27T18:23:41Z
depth: deep
files_reviewed: 32
files_reviewed_list:
  - analytics-service/tests/test_compute_jobs_fencing.py
  - analytics-service/tests/test_flow_price_store_live.py
  - analytics-service/tests/test_nav_marks_writer_live.py
  - analytics-service/tests/test_trade_read_store_live.py
  - e2e/axe-app-wide.spec.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/onboarding-funnel.spec.ts
  - e2e/reflow-sweep-authed.spec.ts
  - scripts/seed-full-app-demo.ts
  - src/__tests__/allocator-holdings-rls.test.ts
  - src/__tests__/audit-coverage.test.ts
  - src/__tests__/claim-dedupe-done-pending-children-guard.test.ts
  - src/__tests__/compare-holding-rls.test.ts
  - src/__tests__/delete-allocator-api-key-rpc.test.ts
  - src/__tests__/gdpr-export.test.ts
  - src/__tests__/migration-084-trigger.test.ts
  - src/__tests__/request-allocator-holdings-sync-queued.test.ts
  - src/__tests__/retention-crons.test.ts
  - src/__tests__/sanitize-user.test.ts
  - src/__tests__/scenario-commit-batch-race.test.ts
  - src/__tests__/scenario-commit-batch-tx.test.ts
  - src/__tests__/scenario-commit-rls.test.ts
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/lib/database.types.ts
  - src/lib/insert-api-key-rpc-live.test.ts
  - src/lib/migration-028-tenant-check.test.ts
  - src/lib/sec-005-live-probe.test.ts
  - src/lib/test-helpers/live-db.ts
  - tests/integration/mig-128-batch-concurrency.test.ts
  - tests/integration/mig-129-cutover-concurrency.test.ts
  - tests/integration/process-key-thin-adapters.test.ts
findings:
  critical: 0
  warning: 0
  info: 8
  total: 8
  necessity: 1
status: issues_found
---

# Phase 243 PR-B (plans 06, 07, 08): Code Review Report, round 1

**Reviewed:** 2026-11-27T18:23:41Z
**Depth:** deep
**Files Reviewed:** 32
**Status:** issues_found (Info only: nothing at MEDIUM or above)

Severity mapping used for the caller's scale: `CR-` = HIGH/CRITICAL, `WR-` = MEDIUM, `IN-` = LOW/INFO.

## Summary

**No finding reaches MEDIUM.** All eight findings are LOW or Info. Under the repo rule they are recorded here and not acted on.

Each focus area was traced to source:

- **Route argument mapping against the RPC signature** (`route.ts:945-970` against `20261127120100_insert_api_key_rpc_and_user_id_immutable.sql`):
  - Every member of `encryptedColumns` maps to its `p_` parameter: api_key, api_secret, passphrase, dek, nonce and kek_version. The nullable seam fields (`api_secret_encrypted`, `passphrase_encrypted`, `nonce`) pass JSON null, which becomes SQL NULL, as the old insert did.
  - `p_user_id` is the `withAuth` session's `userId`, and the body is never read for it.
  - `attested_venue` is not sent. The SECDEF body stamps it from `p_exchange`.
  - Over a failing holder, both `p_venue_account_id` and `p_venue_server` are omitted, so the function's `DEFAULT NULL` applies. That is equivalent to the old explicit `null`, and the swap still stamps both afterwards.
  - With no failing holder, a null `venueAccountId` or `venueServer` is omitted, which is again equivalent to null.
  - The RPC's `NULLIF(btrim(...))` is idempotent on the route's already-normalised MT5 login and server.
- **23505 mapping:**
  - The writer has no handler around its INSERT, so PostgREST returns `code: 23505` with a message naming `api_keys_user_exchange_venue_account_uniq`.
  - `pgConstraintName` parses `message`, so the `KEY_VENUE_ALREADY_CONNECTED` arm is unchanged.
  - Live arm (b) in `insert-api-key-rpc-live.test.ts` pins this on a real PostgREST, and the unit arms still drive it through `insertKeyResult`.
- **PR-C fence census.** I ran a multi-line node scan over the tracked `src`, `e2e`, `scripts`, `tests` and `analytics-service` `.ts/.tsx/.mjs/.js/.py` files, looking for a `from(`/`table("api_keys")` call followed by `.insert(` or `.upsert(`. It finds exactly one live direct insert, `src/lib/anon-strategies-live-probe.test.ts:154`. Plan 09 moves that site explicitly, and plan 10 depends on plan 09 (see IN-08). Every other hit is a comment or an in-memory fake (`analytics-service/tests/test_walletoffset_probe.py:1756`).
- **Raw-SQL `INSERT INTO api_keys` outside `supabase/tests`.** None of these sites runs as a client role the fence refuses:
  - `test_trigger_rls_audit.py`, `test_csv_daily_returns_*_live.py`: lane DSN as `postgres`, per the file headers and `connect_live_db`.
  - The four `src/__tests__/*-sql-exec` / `accounttruth-census` files: a throwaway pg-lane cluster whose superuser is `postgres` (`scripts/pg-lane/run.sh:374`, `initdb -U postgres`). Their `api_keys` is either hand-written (`marksource-okx-nonworking-keys-exec.test.ts:45`, `accounttruth-census.test.ts:656`) or cut from the dump's CREATE TABLE block alone, with no triggers (`oneaccountonce-delete-sql-exec.test.ts:202-208`, `mt5-parity-capture-sql-exec.test.ts:282`). They are safe on both counts.
  - `scripts/pg-lane/fixtures/25-*.sql`: the same `postgres` superuser.
- **Non-test-project reach:**
  - `createTestApiKey` takes a client from `createLiveAdminClient`. The live-DB lane's global setup (`vitest.livedb.globalsetup.ts`, `assertLocalApiUrl`) refuses a non-loopback API URL. `src/test-setup.ts` (`assertLiveDbWasIntended`) throws when both live env vars are present without `VITEST_LIVE_DB_INTENDED=1`. That is an intent check, not a URL check.
  - The e2e helper is handed `getAdmin()` or `getCleanupAdmin()`, which both call `assertNotProductionSupabaseUrl`, or the onboarding spec's own client (IN-07).
  - `scripts/seed-full-app-demo.ts` keeps its project-ref allowlist and refuses any project ref it does not list.
  - `tests/integration/mig-128` and `mig-129` and the four Python live suites use clients named by TEST or lane env vars, with no prod-URL assert of their own. This diff leaves that unchanged (it swaps the write call only), and I did not examine it further.
- **Test oracles:**
  - The `PERSIST_STATE.inserts` assertions moved to the writer's arguments with equal or greater strength. The 06 SUMMARY counts 65; I checked every changed line, not the count. The `.shape` totality loop now compares values, not just presence.
  - A dedicated arm pins "no direct insert" on the success path.
  - Seeds that previously ignored their upsert result (all three scenario-commit files) now throw on failure.
  - The one weakening I found is IN-03.
- **Gates re-run at the merged head `786f1c82e`:**
  - `npx tsc --noEmit`: exit 0.
  - `npm run lint`: exit 0.
  - The route, audit-coverage and thin-adapter suites: 206 passed.
  - A 13-file set (the invariant files that read the route source, `critical-regressions` and the new live file): 637 passed, 4 skipped. The 4 skips are the live file's arms, which did not execute here.
  - The live-DB corpus contract set (`live-db-execution-ledger.contract`, `live-db-fixture-drift`, `gate-family-meta`, `self-referential-oracle`): green. `self-referential-oracle` timed out once at load average 43 and passed on re-run with a raised timeout.
- **Not measured by this review:** no live-DB lane, e2e browser spec or Python live suite was run here. Those claims rest on the plan SUMMARYs' recorded runs.

The necessity rubric (`necessity-review.md`) was read and applied. The live helper's `ifAbsent` reuse branch is the one necessity finding (IN-06).

## Narrative Findings (AI reviewer)

## Info

### IN-01: The route comment claims a type-check guard that does not exist (LOW)

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:949-950`
**Issue:**
- The comment says the arguments are "written out so a new encrypted column fails type-checking here".
- `createAdminClient()` (`src/lib/supabase/admin.ts:18`) builds an untyped `createSupabaseClient(url, serviceKey)` with no `Database` generic, so the `rpc()` arguments are not checked. The new `insert_api_key` entry in `database.types.ts` is never consulted on this path.
- Adding a seventh schema field would be forced into the `encryptedColumns` literal by its mapped type, but it would be silently dropped from the RPC call. The old `...encryptedColumns` spread carried it automatically.
- The real backstop is the unit test's `.shape` loop (`route.test.ts`, "TOTALITY"), which fails on a missing `p_<field>`. A new column would also need a writer migration.

**Fix:** Correct the comment to name the unit test's `.shape` loop as the guard, or type the call: `admin.rpc("insert_api_key", args satisfies Database["public"]["Functions"]["insert_api_key"]["Args"])`.

### IN-02: Live arm (c) accepts any error as the refusal (LOW)

**File:** `src/lib/insert-api-key-rpc-live.test.ts:129`
**Issue:** The authenticated-caller arm asserts only `error` non-null and `data` null. A PGRST202 "function not found" (for example a stale schema cache, or the function missing) would satisfy it as easily as the EXECUTE refusal it claims to prove. The no-row read-back limits the damage, but the arm does not show which layer refused.
**Fix:** `expect(error?.code).toBe("42501");`. That is the code PostgREST returns for a missing EXECUTE grant, and the in-body gate raises `insufficient_privilege` too.

### IN-03: The "nothing was written" oracles no longer see a direct insert on refusal paths (LOW)

**File:** `src/app/api/keys/validate-and-encrypt/route.test.ts:1947` (and every refusal arm that now asserts `insertKeyCalls()).toEqual([])`)
**Issue:**
- Before the move, `PERSIST_STATE.inserts` was the single record of a write. The refusal arms (holder read failure, working holder, composite dependent and so on) now check only the RPC call list.
- A refusal path that regressed to `.from("api_keys").insert` would pass them.
- The new "no direct insert" arm covers only the success path. There is one write site today, so the practical risk is small.

**Fix:** Have the shared "nothing written" assertion check both records, for example a helper `expectNothingWritten()` that asserts `insertKeyCalls()` and `PERSIST_STATE.inserts.filter(r => r.__table === "api_keys")` are both empty.

### IN-04: `createTestApiKey` leaks the row when the extras UPDATE fails, and its docstring overstates its surface (LOW)

**File:** `src/lib/test-helpers/live-db.ts:69`, `src/lib/test-helpers/live-db.ts:177-184`
**Issue:**
- When the follow-up `extras` UPDATE fails, the helper throws without the id, so the caller cannot push it to `apiKeyIds`.
- The e2e twin (`e2e/helpers/seed-test-project.ts`, `insertApiKeyViaRpc`) deletes the half-seeded row first. On the lane the row is removed when the owning user is deleted (`api_keys_user_id_fkey ... ON DELETE CASCADE`), so this is untidy, not a leak across runs.
- The interface comment says "Every `p_`-named writer argument is exposed", but `p_passphrase_encrypted` and `p_nonce` are not.

**Fix:** Mirror the e2e helper with a best-effort `admin.from("api_keys").delete().eq("id", id)` before throwing, but only for a row this call inserted, never an `ifAbsent` reuse. Then either expose the two missing options or correct the comment.

### IN-05: Small docstring inaccuracies in the e2e helper (LOW)

**File:** `e2e/helpers/seed-test-project.ts:67`, `e2e/helpers/seed-test-project.ts:97-99`
**Issue:**
- "The five required fields" should be four: `userId`, `exchange`, `label` and `apiKeyEncrypted`.
- "callers pass `getAdmin()`, `getCleanupAdmin()` or their own admin, so the not-prod URL and service-key asserts those carry run before any write": a caller's own admin carries no assert (see IN-07).

**Fix:** Correct both sentences.

### IN-06: Generality without instantiation, the `ifAbsent` reuse branch (LOW)

**File:** `src/lib/test-helpers/live-db.ts:130-152`
**Category:** necessity
**Issue:**
- The reuse branch (row exists under the same `userId`, so skip the insert) has no caller that can reach it.
- All three `ifAbsent` callers pair a fixed key id with an owner minted fresh by `auth.admin.createUser` in the same `beforeAll`: `scenario-commit-batch-race.test.ts:103`, `scenario-commit-rls.test.ts:212` and `scenario-commit-batch-tx.test.ts:93`. A row already present under that fixed id is therefore always under another owner, and the helper throws.
- In practice `ifAbsent` means "fail loud on a stale orphan". That is a fine behaviour, but it is not the idempotent re-seed the docstring describes.
- This rests partly on judgment, because a future caller with a stable owner could use the branch, so it stays Info.

**Fix:** None required. Optionally reword the docstring to say what the callers actually get.

### IN-07: The onboarding spec hands the helper a raw client with no prod-URL assert (LOW, pre-existing)

**File:** `e2e/onboarding-funnel.spec.ts:144-157`
**Issue:**
- The spec builds its own `createClient(TEST_SUPABASE_URL, ...)` without `assertNotProductionSupabaseUrl` and passes it to `insertApiKeyViaRpc`.
- It is guarded in effect, because `seedTestAllocator` (through `getAdmin()`) asserts the same `TEST_SUPABASE_URL` earlier in the same test, and the direct insert it replaced used the same client. The diff introduces no new exposure.

**Fix:** Optionally use `getCleanupAdmin()` here, as the axe and reflow specs do.

### IN-08: One direct service_role insert remains, tracked to plan 09 (LOW, tracked)

**File:** `src/lib/anon-strategies-live-probe.test.ts:153-163`
**Issue:**
- A direct `admin.from("api_keys").insert(...)` remains. The PR-C fence would refuse it (service_role is not on the `postgres`/`supabase_admin` allow-list).
- Plan 07 excludes it by name, and `243-09-PLAN.md` Task 2 step (5)(i) moves it to `createTestApiKey`. `243-10-PLAN.md` carries `depends_on: [... "243-09"]`, so the ordering is correct as planned.
- It becomes a real break only if plan 10 ships before plan 09.

**Fix:** None in this wave. When plan 10 is reviewed, confirm the scan prints zero direct inserts at that head.

---

_Reviewed: 2026-11-27T18:23:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure-hunter, same diff (2026-11-27)

- **SFH-M1 (MEDIUM, test-only, booked, no fixer):** `createTestApiKey({ ifAbsent: true })` in `src/lib/test-helpers/live-db.ts` reuses an existing row after checking only `user_id`, where the replaced upsert rewrote every column. Disposition: not user-facing and not data-integrity (test seed only). The code reviewer's IN-06 measured the reuse branch as unreachable: all three callers create a fresh owner per run, and the live files run on a lane private to each runner. Per the review rule, only non-user-facing MEDIUMs, so no fixer round; recorded here.
- LOW/INFO (recorded only): L1 unread delete error in `insertApiKeyViaRpc`'s extras-failure cleanup; L2 `createTestApiKey` lacks a `typeof data === "string"` check; L3 route accepts an empty-string id (unreachable); L4 PGRST202/42501 land in the generic persist arm (captured, not silent); L5 extras UPDATE without `.select()`; L6 seeded keys are now attested by default; L7 Python `assert` stripped under `-O`.
