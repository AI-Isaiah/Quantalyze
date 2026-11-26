---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
plan: 03
subsystem: create-with-key route / MT5 rotate leg
tags: [CONN-02, CONN-04, mt5, rotate-in-place]
requirements: [CONN-02, CONN-04]
status: partial
partial: SLICED AFTER TASK 1
key-files:
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
commit-list: [56e5660c5]
plan_head_before: 1c38664601d69ead6781d95251b608e7be732f7a
---

# Phase 228 Plan 03: PARTIAL, SLICED AFTER TASK 1

Task 1 (the tracer) is done and committed (`56e5660c5`). Tasks 2 and 3 are NOT started. A fresh executor takes Task 2 from this commit with 228-03-PLAN.md.

## Done (Task 1)

route.ts:
- `VenueIdentityResolution`: `rotate?: { keyId: string }` on `draft`, `connected`, `held`, `orphaned` (4 occurrences) with a docblock; `RotateVerdict` alias.
- `resolveByVenueIdentity`: `rotateTarget` set only after the `isWorkingHolder` branch, only when `picked.venue_server !== null && picked.venue_server === venueServer`; spread into the `connected`, `draft` (now built explicitly: `{ ...byStrategy, ...rotateField }`) and `held`/`orphaned` (from `otherUse`) returns. The dependent-`held` return in the failing-holder branch is untouched.
- Four builders take a trailing optional `secretOutcome` and spread `keySecretField(...)` LAST in an `extra` built above the literal; `venueDraftInProgressResponse` moved its `strategy_name` spread into such an `extra` (byte-identical without an outcome). `keySecretNotConfirmedResponse()` added beside `holderReadFailedResponse` (UNKNOWN, 500, NO_STORE). `rotateArmRefusal(verdict, outcome)` is the one switch over the verdict kind.
- POST: `rotateVerdict` declared beside `failingHolderId`, recorded in the fence for the four kinds when `rotate` is set; the four refusal returns run only while it is null. The rotate leg is the first statement of the existing `try`: admin client (503 `SEAM_MISCONFIGURED` before the probe), user-scoped re-read (`id`, `user_id`, `exchange = 'mt5'`, `disconnected_at IS NULL`; error gives `holderReadFailedResponse`, no row gives today's refusal), `rotateKeySecret({ keyId, userId, newSecret, correlationId })` (a throw reaches the existing catch), `secret_changed === false` gives `unchanged`, else `persistRotatedMt5Secret` (`ok` gives `updated`; `holder_read_failed` gives the 503 holder-read body; `write_failed`, `venue_collision`, `write_zero_rows` give `keySecretNotConfirmedResponse`). Every log and capture names `[api_key, apiSecretNormalized, passphraseOrNull, venueAccountId, venueServer]` (plus the seam's `venue_account_id` after a success). The catch docblock's first sentence now mentions the rotate seam. The founder ruling, the final arm set and the sync-race limit are in a comment above the leg.
- `// @audit-skip:` pragma on the `persistRotatedMt5Secret` call, same wording and reason as plan 01's rotate-secret route (the audit lives inside the helper).

route.test.ts harness: `rotateKeySecretMock` in the analytics-client factory; `@/lib/correlation-id` mocked to a fixed id; `logAuditEvent` on a sibling `rotateAuditMock` (the swap's `auditMock` counts are untouched); the admin `update()` is now a recorder (`adminUpdates`, `updateAnswer`, three `.eq` plus `.select("id")`); `capturedSelects` entries carry `columns`; `rotateRereadMock` routed by `ROTATE_REREAD_COLUMNS` on the user-scoped client. New `describe("[228] CONN-02 ...")` INSIDE the venue-fence parent describe, own `beforeEach`, with three tests:
- `a connected exact-server holder rotates the working holder in place, owner-scoped, and names the key`
- `re-reads the holder owner-scoped: filters exactly id, user_id, exchange mt5 and live`
- `sends the rotate seam exactly the session user's id`

## Verification run so far

- `npx vitest run src/app/api/strategies/create-with-key/route.test.ts -t "rotates the working holder in place"`: 3 passed, 227 skipped.
- Whole `route.test.ts` after the harness edit and after the arm: 230 passed (230). Pre-existing red list: EMPTY. Reason: the exact-server working-holder tests (for example the 225-07 "refused by name BEFORE validateKey (D-01)" test) now enter the rotate leg, but `rotateRereadMock` defaults to no row, which fails toward today's refusal byte-identically. Task 2 must still make the reversed 212-03 / Pitfall 8 tests say "now rotates" (seed `rotateRereadMock` with a row) and keep the null-server wildcard test as the O1 negative control.
- `npx tsc --noEmit`: clean. eslint on route.ts and route.test.ts: clean.
- Census spot run (8 files: route.audit, route.bare-401, wizardErrors.invariant, seam-citations.invariant, seam-terminal-arm.invariant, audit-coverage, no-store-coverage, phase-156-wizard-rpc-writer-guard): 183 passed (183). Notably `route.audit` and `route.bare-401` did NOT need a mock-factory edit, and `wizardErrors.invariant.test.ts` did NOT move (create-with-key `expectedSites` is still 14, not the 16 the plan expected). Task 2 step 3 must re-measure and explain: the plan says to stop and record if the move is not exactly 2.
- Acceptance greps (route.ts): `rotateKeySecret(` 1, `persistRotatedMt5Secret(` 1, `keySecretField(` 5, `rotate?: { keyId: string }` 4; (route.test.ts): `rotateKeySecretMock` 7, `columns?: string;` 1.

## What is red

Nothing is red at this commit.

## What remains

- Task 2: the remaining [228] cases (orphaned, working held, other-session draft; `unchanged`; absent `secret_changed`; blank and padded label; O3 `it.each`; write faults; missing service credential; re-read error and re-read no-row; O1; WR-06 Pitfall 2; failing_holder; post-validation; 23505; O4; `checkLimit` once; extended NO-ARM-ECHOES), the reversed 212-03 tests, the `wizardErrors.invariant.test.ts` measurement, and PROOF-01 neuters (a) to (g), (h1) to (h4).
- Task 3: the SC-2 role-parity `it.each` with a `profiles` double, the three dated `CORRECTED 2026-11-26 (Phase 228)` comment notes (the builders' "TAKES NO PARAMETERS" docblocks, the 212-03 / SC5 fence comments, the `venue_account_id` allowlist docblock), the `maxDuration` docblock check, neuters (i) and (ii), the full census set and tsc and eslint.
- The builders' docblocks still say "IT TAKES NO PARAMETERS" / "NO IDENTITY PARAMETER" (Task 3 corrects them).
- The final SUMMARY (this file replaced) must hold the full PROOF-01 transcripts.

## Deviations from Plan

None so far. No Rule 1 to 4 deviation in Task 1. PROOF-01 neuters for Task 1's own tests (h1 to h4) belong to Task 2 and were NOT run in this slice, so the two guard tests have not yet been seen RED.

## Self-Check: PASSED (for Task 1 only)

- `src/app/api/strategies/create-with-key/route.ts` and `route.test.ts` exist and are committed.
- Commit `56e5660c5` is an ancestor of HEAD.
