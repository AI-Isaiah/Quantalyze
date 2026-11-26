---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 08
subsystem: api
tags: [validate-and-encrypt, rotate-secret, swap-account-slot, venue-server, account-share-note]
requires:
  - phase: 225-04
    provides: public.swap_account_slot (live on PROD)
  - phase: 225-06
    provides: venue-identity.ts (readLiveSameLoginKeys, pickSameAccountHolder, swapAccountSlot, normaliseVenueServer)
provides:
  - validate-and-encrypt refuses a working same-owner holder by name before any insert, admits a key over a failing holder through swapAccountSlot, and writes venue_server
  - rotate-secret backfills the login only when no same-owner live key already reads it
  - the demoted-key sentence on both key cards
affects: [225-09, 225-10, 225-11, 225-12]
tech-stack:
  added: []
  patterns: [pre-insert per-owner holder fence with a dark-fence fallback to the index]
key-files:
  created: []
  modified:
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/app/api/keys/[id]/rotate-secret/route.ts
    - src/app/api/keys/[id]/rotate-secret/route.test.ts
    - src/lib/account-share-note.ts
    - src/lib/account-share-note.test.ts
    - src/components/strategy/ApiKeyManager.test.tsx
    - src/components/exchanges/AllocatorExchangeManager.test.tsx
key-decisions:
  - "The refusal and the 23505 arm share one keyVenueAlreadyConnectedResponse(), so the two answers cannot drift."
  - "A failed holder swap never fails the add: logged at ERROR with the request secrets scrubbed (login and server included), captured with step holder-swap, key saved; the daily stamper retries (plan 09)."
  - "accountShareNote: WR-02 is narrowed to disconnected keys; a live not-working marked key beside a WORKING holder gets the new sentence (OQ-1)."
requirements-completed: [ONCE-01, ONCE-02, CONN-03, MT5D-08]
status: complete
actuals:
  tokens: 45000
  tasks: 3
  commits: 3
plan_head_before: e80a0c2201a72450043ac8211ace583b9d3ada38
plan_head_after: e79c19283abe5a49cbb1149400c7ce7612174f2c
---

# Phase 225 Plan 08: The Exchanges-page connect seam and the demoted-key card Summary

The allocator Exchanges page's add route enforces the same per-owner, server-aware rule as the wizard (refuse a working holder by name, swap over a failing one, write the server, never look across owners), the rotate-secret login backfill is fenced the same way, and a demoted key now names its holder on its card.

## What was built

- **Task 1 (tracer), commit 3fbb2a94c.** `validate-and-encrypt` derives `venueServer` (MT5: `normaliseVenueServer(passphrase)`, ccxt: null), reads the owner's live keys on the account through `readLiveSameLoginKeys` and picks with `pickSameAccountHolder(rows, server, "fence")`. A picked holder that is not working is given way to: the new key is inserted with `venue_account_id` and `venue_server` null, then `swapAccountSlot` stamps it and demotes the holder. The `@audit-skip:` pragma sits on the swap call. A failed swap logs at ERROR (scrubbed) and goes to `captureToSentry` with `step: "holder-swap"`; the add still answers success. The route test's admin mock gained a thenable same-login read (filtered by the user_id, exchange and login filters the route sends) and an `rpc` recorder; `@/lib/audit` is mocked with a spy.
- **Task 2, commit 4abdcf30d.** A working picked holder answers 409 `KEY_VENUE_ALREADY_CONNECTED` before any insert (zero inserts, zero rpc calls), through the new local `keyVenueAlreadyConnectedResponse()` that the 23505 arm also uses. The no-holder insert writes `venue_server`. `venueServer` joins every per-request secrets array in the persist arm. A read error is logged scrubbed and the add continues (the index is the backstop). `rotate-secret`: when the row has no login, the same read runs for the caller's own user_id, exchange mt5 and the seam's login; a pick under wildcard server turns the backfill off so the update is attempted once without `venue_account_id`; a read error keeps the attempt-then-retry path; the 23505 retry stays for the race.
- **Task 3, commit e79c19283.** `accountShareNote` returns null for a disconnected key, resolves the holder as before (absent or not working returns null), and for a live key that is itself not working returns: "This key reads the same exchange account as <holder>, which holds that account while this key is not working. We count that account once." The module docblock's WR-02 bullet carries a dated correction. Both cards render through this one function, so no component changed.

## Verification

- `npx vitest run src/app/api/keys/validate-and-encrypt/route.test.ts "src/app/api/keys/[id]/rotate-secret/route.test.ts" src/__tests__/audit-coverage.test.ts src/lib/wizardErrors.invariant.test.ts`: 4 files, 288 passed.
- `npx vitest run src/lib/account-share-note.test.ts src/components/strategy/ApiKeyManager.test.tsx src/components/exchanges/AllocatorExchangeManager.test.tsx src/components/exchanges/AllocatorExchangeManager.liveness.test.tsx`: 4 files, 339 passed (the D-18 parity cases included).
- `src/lib/departed-history.test.ts` and `src/__tests__/critical-regressions.test.ts`: 236 passed.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors; 4 pre-existing warnings in files this plan does not touch (MetricsColumn.tsx, composite-read-path.ts, queries.stale-analytics-detail.test.ts).

## PROOF-01 record (neuter, RED, byte restore, GREEN)

Backups by `cp` into the scratchpad, restored by `cp`, checked with `cmp`. No git checkout, restore or stash was used.

1. **Working-holder refusal.** `if (holder !== null && isWorkingHolder(holder)) {` neutered to `if (holder !== null && !isWorkingHolder(holder) && false) {` in `validate-and-encrypt/route.ts`. RED, first line: `× an okx add whose account a WORKING key of the same owner holds is refused 409 KEY_VENUE_ALREADY_CONNECTED with zero inserts and zero rpc calls`, then `× an MT5 add whose login+server a WORKING key of the same owner holds is refused 409 with zero inserts and zero rpc calls` and `× an MT5 add beside a same-login owner key with a NULL server is refused (null is the wildcard, Q2)`; `Tests  3 failed | 131 passed (134)`. Restore: `cmp` printed `CMP_SILENT` (silent compare, echoed marker). GREEN: `Tests  134 passed (134)`.
2. **Demoted-key sentence.** `if (key.disconnected_at !== null) return null;` in `account-share-note.ts` replaced by the original early `if (!isWorkingHolder(key)) return null;`. RED, first line: `× names the working holder on a live marked key that is itself inactive, and says why (Phase 225 OQ-1)`, with revoked, sign_in_failed and error twins, `× the demoted-key sentence names no remedy`, the ApiKeyManager inactive and revoked cases and the allocator inactive and sign_in_failed cases; `Tests  9 failed | 302 passed (311)`. Restore: `cmp` printed `CMP_SILENT`. GREEN: `Tests  339 passed (339)`.
3. **Rotate fence (RED-first, not a neuter).** Before the fence existed, the new rotate tests failed: `× does NOT backfill the login when another live key of the same owner already reads it on a stored server, and attempts the update once` and `× a read error keeps today's attempt-then-retry path, with a log line that carries neither the login nor the secret` (`Tests  2 failed | 57 passed (59)`); after the fence, all 59 passed.

Tasks 1 and 2 followed RED first as well: the tracer failed with `expected '5001234' to be null` before the admission path existed, and the three refusal tests failed before the refusal arm.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The allocator test "shows nothing on a marked key that is itself inactive" had to flip**
- **Found during:** Task 3
- **Issue:** The plan flips the two ApiKeyManager rows and adds one allocator test, but does not name the existing allocator test that pins silence on an inactive marked key. Under the new sentence it contradicts the behaviour the plan specifies (inactive is one of the four not-working states that now name the holder).
- **Fix:** Replaced it with a disconnected-stays-silent test and an it.each over inactive and sign_in_failed expecting the new sentence. The it.each about the HOLDER being not working is unchanged.
- **Files modified:** src/components/exchanges/AllocatorExchangeManager.test.tsx
- **Commit:** e79c19283

**2. [Scope note] `venue_server` on the insert landed in Task 1, not Task 2**
- The tracer needed the insert to carry the server (null on the swap path, normalised otherwise), so the column write and its secrets-array entries were written once in Task 1's commit. Task 2's tests pin it (the no-holder MT5 and okx cases).

No other deviations. Pre-validation read for MT5 (the up-to-120 s wait before a refusal) was skipped as the plan allows.

## Known limits

- The same-login read and the insert are not one transaction. Two concurrent adds on one account can both pass the fence; the unique index (login-only today, server-aware after plan 10) remains the backstop and its 23505 still answers the same 409.
- A refused add of a working holder happens after `validateKey` has already spent its venue call (and for MT5 its wait).

## Known Stubs

None.

## Threat Flags

None. No new endpoint or auth path; the route already used the service role, and both reads carry the caller's user_id (T-225-23, pinned by the cross-owner tests in both routes). The swap runs only after `validateKey` succeeds (T-225-24). `venueServer` is in every secrets array and the tests assert neither login nor server appears in a body or log line (T-225-25).

## Self-Check: PASSED

Modified files present; commits 3fbb2a94c, 4abdcf30d and e79c19283 are on `worktree-agent-225-08` (3 commits measured from the ledger base e80a0c220).
