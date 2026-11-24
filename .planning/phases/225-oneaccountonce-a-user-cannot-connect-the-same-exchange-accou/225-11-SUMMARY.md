---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 11
subsystem: api
tags: [wizard, create-with-key, once-01, once-02, conn-03, mt5d-08, swap-account-slot, race-arm]
requires:
  - phase: 225-07
    provides: resolveByVenueIdentity with the server pick and failing_holder, the MT5 admission path, the failing_holder race-arm branch
  - phase: 225-05
    provides: VENUE_DRAFT_IN_PROGRESS and the draft member's strategyName
  - phase: 225-06
    provides: readLiveSameLoginKeys, pickSameAccountHolder (after_index_refusal tier), swapAccountSlot
provides:
  - "post-validation resolve for every venue whose identity is known (ccxt included): a working same-owner holder is refused by name before the write, a failing one is admitted and swapped"
  - "keyVenueAlreadyConnectedResponse(): the one KEY_VENUE_ALREADY_CONNECTED body, used by the post-validation held arm and the race arm"
  - "race arm in after_index_refusal mode (interim rule for the login-only index)"
  - "per-owner pins for ONCE-01 and ONCE-02 and the OQ-2 statement in the resolver docblock"
affects: [225-12]
key-files:
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
key-decisions:
  - "The post-validation resolve sits between the read-only verdict and encryptKey, so a refusal also spends no encrypt call."
  - "failingHolderId is re-derived from the LATEST read (post-validation), not carried from the pre-validation one: a holder that recovered during validation refuses, one that vanished is not swapped."
  - "The pre-validation MT5 `held` arm is unchanged (it still falls through to validateKey); the post-validation resolve now refuses it instead of the index."
requirements-completed: [ONCE-01, ONCE-02, CONN-03, MT5D-08]
status: complete
commits: 2
plan_head_before: c607494a597a2d7af5cfc45bada73700a1bfa8d3
plan_head_after: 94293e947b26016c174abee2bc6fe275b0a1515a
estimate:
  tokens: 75000
  raw_tokens: 75000
  tasks: 2
  confidence: low
actuals:
  tokens: 10400
  tasks: 2
  commits: 2
---

# Phase 225 Plan 11: every venue is resolved after validation, one builder, interim race arm, per-owner pins Summary

**An okx (or any ccxt) connect is now resolved once more after validateKey and before the write: a working same-owner holder is refused by name with zero writes, a failing one is admitted without identity and takes the slot through swap_account_slot, and an index refusal on the old login-only index is explained by the right key.**

## What changed (`src/app/api/strategies/create-with-key/route.ts`)

- **Post-validation resolve.** After `validateKey` sets the ccxt `venueAccountId`, one `resolveByVenueIdentity(..., "fence")` runs for every venue whose identity is known (MT5 re-reads: its validation can take 120 s). `draft` is `venueDraftInProgressResponse`, `connected` is `venueAlreadyConnectedResponse`, `held` is the new builder, `orphaned` is `keyOrphanedResponse`, `failing_holder` falls into plan 07's admission (venue-neutral already: it is gated on `failingHolderId !== null && venueAccountId !== null`, and a ccxt swap simply carries no server), `unresolved` is the normal RPC. It runs before `encryptKey`, so every refusal also skips the encrypt call and issues zero writes.
- **`failingHolderId` is re-derived** from that read, so the swap always targets the latest holder.
- **`keyVenueAlreadyConnectedResponse()`**: the inline body from the race arm, extracted verbatim (`code` first as a literal, the existing sentence). Used by the post-validation `held` arm and the race arm's `held` / `failing_holder` branch (TWIN-8 one-builder rule). The route now has 3 lines naming it (definition plus two call sites).
- **Race arm** calls `resolveByVenueIdentity` with `"after_index_refusal"`. Its comment records that tier 3 only matters while the login-only index is live and is dead after plan 10.
- **Docblocks.** OQ-2 (three sentences) is in the `failing_holder` member's docblock, followed by the per-owner note (the `user_id` filter in `readLiveSameLoginKeys`, no cross-owner marker, Q3). The admission docblock now says the post-validation resolve is what reaches it.

## Tests (`route.test.ts`)

- New `[225-11]` block (11 tests): okx held by a composite only (byte-exact `KEY_VENUE_ALREADY_CONNECTED`, RPC never called, exactly one fence read), okx past-draft strategy, own draft, orphan; the okx TRACER (failing key: created without identity, swap carries exactly `p_new_key / p_old_holder / p_venue_account_id`, order validate then create then swap, audit once); MT5 holder failing before validation and working after (refused, no write); MT5 holder gone after validation (created WITH identity, no swap); race arm: MT5 working key on a different server named through tier 3, failing key on a different server answers KEY_VENUE_ALREADY_CONNECTED with no swap, a 23505 meeting a failing holder, a 23505 meeting a working held holder (same builder bytes).
- New `[225-11] ONCE-01 and ONCE-02` block (5 tests): okx and MT5 same-owner refusals with zero writes (no RPC, no `api_keys` write verb); another owner's strategy-linked key on the same okx account and on the same MT5 login plus server (the table double honours the `user_id` filter and returns every row when it is absent; every `api_keys` read carries the caller's id; the connect answers 200; the RPC carries `p_venue_account_id`, and `p_venue_server` for MT5); the read set is `api_keys`, `strategies`, `strategy_keys` only.
- **Existing tests kept reachable (action (d)).** Nine existing race-arm tests would have stopped reaching the 23505 arm (the post-validation resolve refuses first). A throwaway probe in the route flagged exactly which tests the new arm refused; each was re-seeded so the first fence read (two for MT5) sees nothing and the holder appears for the race arm. ccxt describe: `holderAppearsAtTheRace()` helper; MT5 sites: a second `mockResolvedValueOnce`. None deleted. A second probe run showed only the new tests are post-refused; the probe was removed (no `TEMP-PROBE` left in either file). One assertion changed: "threads the validator's id" used to assert `venueKeyLookupMock` not called; it now asserts exactly one read keyed on okx, the validator id and the caller's `user_id`.

## Verification

- `npx vitest run src/app/api/strategies/create-with-key/route.test.ts src/__tests__/audit-coverage.test.ts src/lib/wizardErrors.invariant.test.ts`: 3 files, 294 passed at the Task 2 commit (route.test.ts alone: 199, was 183). The first run of this command at the end showed one cold-start timeout in the first test (6.3 s, another vitest run was loading the machine); the rerun was green.
- `npx tsc --noEmit`: clean. `npx eslint src/app/api/strategies/create-with-key/`: clean.
- `npm run lint` (full): started, the eslint stage printed no error before my 110 s wrapper ended the run; not reported as a full pass. The scoped eslint and tsc above are the evidence.
- Test files that name `create-with-key` or the invariants they read as text: the three above plus a wider `vitest run create-with-key wizardErrors roster contract sentry-secrets phase-156` run. Everything touching this route passed. Five failures appeared in that wide run, all in `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` and `ci-docs-path-filter.contract.test.ts` (self-test subprocesses that took 50 to 67 s, a derivation over the whole tree). Neither reads this route; see Deferred.

## TDD / tracer record

The behaviour tests were written first and run before the implementation: 11 failed, 183 passed (194). The race-arm case "a 23505 race arm meeting a FAILING holder" failed at that point for call order (no post-validation read existed yet, so the arm's read was the first and saw nothing), not because plan 07's branch was missing. After the implementation it is green on its own merit, and neuter E below proves it bites. The RED state was not committed (single feat commit with tests and implementation).

## PROOF-01 record (neuter, RED, `cp` byte restore, `cmp` silent, GREEN)

Every backup `cp`-ed to the scratchpad first, restored with `cp`, `cmp` silent. No git checkout, restore or stash. `git status --short` clean after the last restore.

- **B. user_id filter removed from `readLiveSameLoginKeys`** (`.eq("user_id", args.userId)` deleted):
  `× 3. the same okx account held by ANOTHER owner's strategy-linked key: the read is filtered to the caller, ...`,
  `× 4. the same MT5 login and server held by ANOTHER owner's strategy-linked key: as case 3, ...`,
  `× threads the validator's id into the RPC as p_venue_account_id`,
  `× reads the LIVE row only — the fence filters disconnected_at IS NULL, ...`; `Tests  4 failed | 195 passed (199)`. `RESTORED_BYTE_EQUAL_B`. GREEN `Tests  199 passed (199)`.
- **D. post-validation `held` arm dropped:**
  `× held only by a composite → 409 KEY_VENUE_ALREADY_CONNECTED, byte-exact`; `Tests  1 failed | 198 passed (199)`. `RESTORED_BYTE_EQUAL_D`. GREEN `Tests  199 passed (199)`.
- **E. race arm no longer answers `failing_holder`** (the plan-07 branch, `|| venueMatch.kind === "failing_holder"` removed; the case the orchestrator flagged as green on first run):
  `× MT5, a same-login FAILING key on a DIFFERENT server met by the index: 409 KEY_VENUE_ALREADY_CONNECTED, byte-exact, no swap`,
  `× a 23505 race arm meeting a FAILING holder → 409 KEY_VENUE_ALREADY_CONNECTED (plan 07's held branch, pinned)`; `Tests  2 failed | 197 passed (199)`. `RESTORED_BYTE_EQUAL_E`. GREEN `Tests  199 passed (199)`.
- **F. race arm back to `"fence"` mode** (extra):
  `× MT5, a same-login WORKING key on a DIFFERENT server: the fence admits, the old index refuses, and the arm names that key`,
  `× MT5, a same-login FAILING key on a DIFFERENT server met by the index: ...`; `Tests  2 failed | 197 passed (199)`. `RESTORED_BYTE_EQUAL_F`. GREEN.
- **G. stale `failingHolderId` kept past validation** (`if (kind === "failing_holder") failingHolderId = ...` instead of re-deriving; extra):
  `× MT5: a failing holder that is GONE after validation is not swapped: the key is created WITH its identity`; `Tests  1 failed | 198 passed (199)`. `RESTORED_BYTE_EQUAL_G`.
- **H. post-validation resolve removed entirely** (`if (false && venueAccountId !== null)`; extra): `Tests  24 failed | 175 passed (199)`, including the okx TRACER, all four okx refusals, the MT5 moved-state case, and ONCE-01 case 1. `RESTORED_BYTE_EQUAL_H`. GREEN `Tests  199 passed (199)`.

## Deviations from Plan

**1. [Rule 3 - test maintenance the plan anticipated in (d)] Nine existing race-arm tests re-seeded.** Described under Tests. The plan named the ccxt tests; four MT5 tests (the `[154.1]` race-arm case, two TWIN-8 cases, the `[161-05]` wizard-session negative control) had the same problem because the post-validation read is a second fence read for MT5. They passed vacuously until re-seeded, which is why the probe was used rather than trusting green.
**Commit:** b0bc44bfe

**2. [Rule 1 - one changed assertion].** "threads the validator's id into the RPC" asserted that no fence read occurred for ccxt; that is no longer true by design. It now asserts one read with the right filters. **Commit:** b0bc44bfe

**3. [Placement] The resolve runs before `encryptKey`, not after it.** The plan says "after validateKey ... before the write"; this ordering also spares the encrypt call on every refusal. No spec conflict.

No architectural changes, no auth gates, no checkpoints.

## Edge notes

- **Concurrency (ONCE-01).** Two concurrent connects of one account by one owner: the second insert is refused by the live unique index and the race arm answers by name (race-arm tests above). Two concurrent swaps are serialised by `swap_account_slot`'s row locks, and the loser's swap fails; that path is plan 07's failed-swap handling (answers 200, logged at ERROR with Sentry step `holder-swap`, covered by plan 07's test). This plan adds no separate test for the loser.
- **MT5 `held` still waits out validation.** The pre-validation MT5 `held` arm is unchanged (it falls through, as before), so a held MT5 login is refused after `validateKey`, before the write, rather than before it. Only `draft`, `connected` and `orphaned` refuse pre-validation. Left as plan 07 left it; a tracked latency cost, not a correctness one.
- **Ship note for PR-2.** Before PR-2 opens and again immediately before it merges, the orchestrator re-checks the 155.2 freeze (`155.2-12-SUMMARY.md` absent, or `155.2-14-SUMMARY.md` present): the swap paths can NULL a failing MT5 holder's `venue_account_id`, which 155.2's `report_account_matches` hashes. At the start of this plan `155.2-12-SUMMARY.md` was absent.

## For the founder

**OQ-2, stated.** A demoted key that later recovers STAYS marked a duplicate of the working holder while that holder works. Nothing is disconnected, unpublished or re-pointed: plan 08's card sentence names the holder, and the derive counts the account once, through the working holder (D-18). The only automatic move back is MT5D-08 itself (plan 09).

**The shape to know about.** If a demoted key still carries its own strategy, that strategy keeps existing and keeps pointing at its (now duplicate-marked) key. That is the shape Q1 accepts; nothing in this plan changes it. If the founder wants the demoted key's strategy treated differently (unpublished, or re-pointed to the holder), that is a new decision, not a gap in this plan.

**ONCE-02 reading.** "A strategy-linked key that also sits in an allocator book is unaffected" is implemented as: no refusal or swap in this route ever disconnects, unlinks or re-labels such a key (every refusal issues zero writes), and the only change to it is the Q1 demotion when it is NOT working. If the founder meant a failing strategy-linked key keeps its slot, that conflicts with Q1, and Q1 (the later, explicit ruling) was followed.

## Deferred / not done

- Five failures in `ci-apt-bounded.contract.test.ts` (R4, `scripts/ci-apt.sh --self-test`) and `ci-docs-path-filter.contract.test.ts` (calibration and derivation self-tests) during the wide run: subprocess self-tests running 50 to 67 s inside this worktree while other vitest runs shared the machine. Neither file nor anything they test is touched by this plan. Not re-run in isolation or at the base; recorded here so the orchestrator knows they were seen, not fixed.
- Full `npm run lint` not confirmed to completion (110 s wrapper); scoped eslint and `tsc --noEmit` are clean. `scripts/check-planning-hygiene.ts` is not re-run by me after this SUMMARY was written.
- Not run: `supabase/tests` SQL gates, pg-lane, mypy, pytest (this plan touches no SQL or Python), any browser or e2e check.

## Known Stubs

None.

## Threat Flags

None. No new endpoint or schema change. T-225-22 is pinned by the ONCE-02 cases (the read carries the caller's `user_id`; neuter B turns two of them RED) and by the swap's own ACCOUNT_SLOT_NOT_SAME_OWNER refusal. T-225-36 is closed by the post-validation `held` arm (neuter D turns its case RED).

## Self-Check: PASSED

Files present: `route.ts`, `route.test.ts`. Commits b0bc44bfe and 94293e947 are ancestors of HEAD on `worktree-agent-225-11`.
