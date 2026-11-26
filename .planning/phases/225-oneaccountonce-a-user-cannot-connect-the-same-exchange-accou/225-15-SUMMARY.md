---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 15
subsystem: frontend
tags: [identity, mt5, venue_server, accountIdentityTokens, zod, CONN-03]
requires: [225-13, 225-14]
provides:
  - server-aware accountIdentityTokens, accountLoginIdentity, ambiguousServerKeyIds (src/lib/departed-history.ts)
  - venue_server in KEY_IDENTITY_COLUMNS, API_KEY_USER_COLUMNS_ARR, ApiKey and its strict zod schema
  - venue_server carried through the key card state and the gap-line grouping
affects: [225-16, 225-17]
tech-stack:
  added: []
  patterns: [canonical identity per key, never a pairwise wildcard; mock that projects to the selected columns]
key-files:
  created: []
  modified:
    - src/lib/departed-history.ts
    - src/lib/latest-holdings-per-key.ts
    - src/lib/latest-holdings-per-key.test.ts
    - src/lib/venue-identity.test.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/constants.ts
    - src/lib/types.ts
    - src/lib/sec-005-api-keys-projection.test.ts
    - src/__tests__/api-key-runtime-guard.test.ts
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.departed-history.test.tsx
key-decisions:
  - "CONTEXT Q6 item 1: the TS twin applies the same canonical (exchange, login, server) rule as Python; an ambiguous key gets a null token, so keyAccountOf gives it key:<id> and departedHistoryInclusion reads account_unknown"
  - "CONTEXT Q6 plan 13 founder ruling (Owner-only read): venue_server joins API_KEY_USER_COLUMNS_ARR; sec-005's assertion is inverted to match the grant"
requirements-completed: [CONN-03]
status: complete
commits: 3
plan_head_before: 4adb73d54df4053aa12f9c974366a4c76197b1aa
plan_head_after: e4ebcdca7273edcf26e34fe1ab0d28d1dba697ab
actuals:
  tokens: 10100
  tasks: 3
  commits: 3
---

# Phase 225 Plan 15: TS twin of the server-aware account identity Summary

The browser-side identity now agrees with the Python derive on every case of the shared fixture: one MT5 login on two set servers is two accounts, a server-less key joins its login only while the login carries at most one set server, and every reader that feeds the identity selects `venue_server`.

## What was built

- `src/lib/departed-history.ts`: `DepartedHistoryKey.venue_server`; private `loginIdentities` computes each key's `exchange\0login\0canonical server` (or null) plus the ambiguous ids; exported `accountLoginIdentity` and `ambiguousServerKeyIds`; `accountIdentityTokens` unions on the login identity instead of the bare pair. Marker pass and `account:<smaller id>` token unchanged. A server counts only as a non-empty string and is never trimmed or case-folded.
- `src/lib/latest-holdings-per-key.ts`: `KEY_IDENTITY_COLUMNS` and `KeyIdentityRow` carry `venue_server`; `keyAccountOf` passes it through. `portfolio-exposure.ts` needed no edit (it imports the constant and helper).
- `src/lib/constants.ts` / `src/lib/types.ts`: `venue_server` in `API_KEY_USER_COLUMNS_ARR` and the literal type, in `ApiKey` and in the strict zod schema.
- `src/lib/queries.ts`: `marksIncludedKeys` (now exported as a test seam) maps `venue_server`; `EquityHistoryKey.venue_server?`; `deriveKeyDataGapsField` groups on `accountLoginIdentity`, so a `duplicate_account` line never names a key on another server, and two exchanges with an equal account id no longer group.
- `AllocatorExchangeManager.tsx`: `ExchangeConnection.venue_server`, `InitialKey` Omit entry plus widening, `normalizeInitialKey` copy, `historyKeys` mapping. No UI added.

## Task commits

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) | 68b58ca1b | server-aware TS twin, fixture `tokens` replay in both row orders, KEY_IDENTITY_COLUMNS, projecting key-read mock |
| 2 | 02eaec485 | projection, `ApiKey`, strict schema, sec-005 assertion inverted, runtime-guard fixture and pins |
| 3 | e4ebcdca7 | queries.ts mappings and gap grouping, key-card state, behavior and component tests |

## Plan 14's four extra tokens cases

`blank-login-is-unknown`, `login-is-stripped`, `empty-server-is-no-server` and `server-is-compared-as-stored` are replayed with the other 13 (17 cases, each twice: given order and reversed). All 34 pass. `server-is-compared-as-stored` (srv-a vs SRV-A are two accounts) passes because the TS reader does no case-fold.

## Proof the tests can fail (PROOF-01)

Every neuter was made on a file whose byte copy was kept in the session scratchpad, then restored and verified identical with `cmp`.

| Neuter | Result |
|--------|--------|
| T1 (a): drop `venue_server` from `KEY_IDENTITY_COLUMNS` | `3 failed, 89 passed` in `latest-holdings-per-key.test.ts`: the select-names-venue_server test, the projecting-mock split test, and the existing "an error in the key id read" test whose select literal no longer matched |
| T1 (b): union key reverted to the bare pair (canonical server forced to `""`) | `16 failed, 195 passed` across `venue-identity.test.ts` (tokens cases, both orders) and `latest-holdings-per-key.test.ts` |
| T2: remove `venue_server` from the zod schema | `13 failed` in `api-key-runtime-guard.test.ts` (every row dropped at the read boundary) |
| T3 RED-first, before any implementation | `7 failed, 168 passed`: three `deriveKeyDataGapsField` cases, three `marksIncludedKeys` cases (not yet exported), the component test |
| T3 (a): drop the `venue_server` mapping in `marksIncludedKeys` | `2 failed, 157 passed` in `queries.test.ts` (the distinct-account case and the account_unknown case) |
| T3 (b): drop the `venue_server` copy in `normalizeInitialKey` | `1 failed, 15 passed`: the component test, at the FIRST-render assertion |
| T3 (c): copy dropped only when `prev` is set (the router.refresh merge path) | `1 failed, 15 passed`: the component test, at the RERENDER assertion (`departed-history.test.tsx:386`), first render having passed |

Neuter (b) alone cannot show the rerender assertion fails on its own, because dropping the copy outright fails the initial render first; neuter (c) isolates the merge path.

## Verification at final HEAD (e4ebcdca7)

- vitest, 13 files (the plan's three verify sets plus `sec-005-live-probe.test.ts`): `Test Files  13 passed (13)`, `Tests  952 passed | 4 skipped (956)`. The 4 skips are `sec-005-live-probe.test.ts` live-DB arms.
- `npm run typecheck` (`tsc --noEmit`): clean, no output after the script banner.
- `npm run lint`: `5 problems (0 errors, 5 warnings)`, after which every `check-*` script printed OK. One of the 5 warnings was mine (an unused `KEY_IDENTITY_COLUMNS` import in `latest-holdings-per-key.test.ts`); it is now used (the select test asserts equality with the constant) and `npx eslint` over every file this plan touched prints nothing. The remaining 4 are pre-existing in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts` x2).
- Acceptance greps (`grep -a -c`): `export function ambiguousServerKeyIds` 1; the new `KEY_IDENTITY_COLUMNS` literal 1; `spec.tokens` 3; `"venue_server",` in constants 1; `venue_server: z.string().nullable()` 1; `not.toContain("venue_server")` in sec-005 0; `accountLoginIdentity(` in queries.ts 1; `venue_server: k.venue_server` in the manager 2; `"venue_server"` in the manager 1; the component test title 1.
- Ship guard: `git diff --name-only <plan_head_before>..HEAD | grep -c '^.planning/'` is 0 for the code commits; this SUMMARY is the only `.planning` file and is committed separately.

## Fixture files tsc required (Task 2 step 4)

None. `npm run typecheck` reported no fixture missing `venue_server`. The six-file stop condition was not approached. The strict-schema consequence appeared at runtime instead: `api-key-runtime-guard.test.ts`'s `baseRow` is an untyped object, so 11 tests failed until it carried `venue_server: null` (one file). Two pins were added there (preserved value, rejected when missing).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `queries.my-allocation.test.ts` pinned the old select literal**
- **Found during:** Task 1 verify.
- **Issue:** the test `every allocator_holdings read carries the explicit owner filter ...` matches the api_keys select string `"id, exchange, venue_account_id, account_share_kind, account_shared_with_api_key_id"` exactly. The file is not in the plan's `files_modified`.
- **Fix:** updated the literal to the new column list. Committed in Task 1 (68b58ca1b).

**2. [Rule 3 - Test seam] `marksIncludedKeys` exported**
- **Why:** the plan's behavior tests (a departed key on another server is `distinct_account`; a no-server key is `account_unknown`) and its neuter (a) both require a test that reaches the `marksIncludedKeys` mapping. It was module-private and the only other path is the full `getMyAllocationDashboard`. Exporting it changes no behavior.

**3. [Rule 2 - Test fidelity] the key-read mock now projects `api_keys` rows to the selected columns**
- **Why:** the existing fake returned every column regardless of `select(...)`, so dropping `venue_server` from `KEY_IDENTITY_COLUMNS` would still have passed any test that fed it. Projection makes the drop observable (neuter T1 (a)). Existing tests pass unchanged because their rows carry only columns in the select.

**4. [Plan wording] "behavior tests in queries.test.ts and the component test first, RED"**
- Done as written; the `marksIncludedKeys` import was RED as "not a function" until the export in implementation. The RED count (7) is recorded above.

**5. [Rule 3 - Branch namespace] Commit-time `agent-*` allow-list not applied**
- The worktree branch is `gsd/phase-225-pr2b-2`, a caller-designated plan worktree. HEAD was attached and not on a protected branch; the allow-list was skipped as in plan 14.

**6. State and ROADMAP handlers skipped on instruction**
- Per the caller, `STATE.md` and `ROADMAP.md` were not edited, no `state.*`, `roadmap.*` or `requirements.mark-complete` handler ran, nothing was pushed and no PR was opened.

## Stale comment fixed

`src/lib/sec-005-api-keys-projection.test.ts` said migration 20261123180000 "grants it to nobody" and that the browser never reads the server. The test is inverted (it now asserts the column IS projected) and the comment rewritten to cite plan 13's migration 20261125132334 and the founder's "Owner-only read" answer. `grep` finds no other "granted to nobody" / "ungranted" / "browser never reads" text in `src`.

## Ship-time reminder (not done here)

PR-2b-2 must not merge until PROD has applied plan 13's migration `20261125132334_api_keys_venue_server_owner_read.sql` (T-225-48): the code selects the column now, and an ungranted column answers 42501 on every key list. Plan 17 Task 3 reads the grant on PROD.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. `venue_server` joins the owner-only key payload under plan 13's grant (T-225-47, accepted); the key card renders nothing new.

## Self-Check: PASSED

- Commits 68b58ca1b, 02eaec485, e4ebcdca7 are ancestors of HEAD.
- All 13 modified files exist and are committed.
