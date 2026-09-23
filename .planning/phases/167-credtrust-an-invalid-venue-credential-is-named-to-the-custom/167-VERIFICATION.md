---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
verified: 2026-09-23T00:33:44Z
status: passed
score: 38/40 must-haves verified
verified_at_sha: 7b3ffe9167cc0477ef9fb48a63640dc154f35a1e
drift_subjects:
  - analytics-service/services/mt5_client.py
  - analytics-service/services/mt5_validation.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/exchange.py
  - analytics-service/routers/exchange.py
  - analytics-service/docs/STATUS_CONTRACT.md
  - supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql
  - supabase/tests/test_api_keys_sync_status_sign_in_failed.sql
  - src/components/exchanges/AllocatorSyncStatus.tsx
  - src/components/exchanges/allocator-sync-pill-styles.ts
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/auth/ProfileTabs.tsx
  - src/app/(dashboard)/profile/page.tsx
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/UpdateMt5SecretDialog.tsx
  - src/components/strategy/SyncProgress.tsx
  - src/hooks/useStrategySyncPoller.ts
  - src/components/ui/Modal.tsx
  - src/app/(dashboard)/strategies/[id]/edit/page.tsx
  - src/app/(dashboard)/strategies/layout.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/lib/auth/requireRolePage.ts
  - src/app/api/keys/[id]/rotate-secret/route.ts
  - src/lib/constants.ts
  - src/lib/wizardErrors.ts
  - src/lib/closed-sets.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "On the surface where they notice the symptom, the customer is told the credential is why the factsheet stopped updating"
    reason: "167-CONTEXT D-19. The key card on the strategy's own edit page closes the goal. It sits on the card of the key that feeds the strategy, next to the control that fixes it. An honest sentence saying the factsheet stopped because of the credential cannot be written under D-02, D-03 and D-12. The stronger /strategies list-row placement is routed to Phase 167.2 KEYCARDSYNC, whose ROADMAP entry was widened for it. D-19 is recorded in 167-CONTEXT.md and in the ROADMAP plan list, as the deviation policy requires."
    accepted_by: "orchestrator, under founder delegation (167-CONTEXT D-19); not a founder signature"
    accepted_at: "2026-09-22"
re_verification:
  previous_status: human_needed
  previous_score: 31/34
  previous_sha: de41a2009d03b6b62288b591223cd12659e51b88
  gaps_closed:
    - "Finding: no review covered 167-06's code. Closed. Round 1 (167-REVIEW-06) and round 2 (167-REVIEW-06-R2) each come with a silent-failure table. Every finding in both rounds is fixed in code or recorded as a named limit. Every fix I checked has a named test, and each of those tests passes at this sha."
    - "Finding: goal truth 1 was left to the founder. Closed by D-19, recorded in 167-CONTEXT and the ROADMAP, and applied here as an override."
    - "Finding: D-18 reason 2 misstated how the page is gated. Corrected. D-18 now names strategies/layout.tsx and its requireRolePage(…, \"manager\") call."
    - "Finding: the ROADMAP did not list plan 06. It now reads '6 plans (5 + 1 gap-closure)' and lists 167-06 with D-18 and D-19."
    - "Finding: the post-add residual had no owner. Phase 167.2 KEYCARDSYNC is now in the ROADMAP and names it. The untrusted-key variant of that residual (J's success shown beside J's own pill) is now closed in code and pinned by the corrected R6 case."
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "Every commit on this branch maps to at least one CHANGELOG bullet (167-05 must-have; repo CHANGELOG discipline)"
    addressed_in: "/gsd-ship, which runs next (not a roadmap phase)"
    evidence: "The orchestrator ruled it closed at ship time. It is not true at this sha: CHANGELOG.md was last touched by 6c483b1c, and 54 non-merge commits have landed since."
  - truth: "The /strategies list row, where a manager lands, marks a strategy whose feeding key is untrusted"
    addressed_in: "Phase 167.2 KEYCARDSYNC"
    evidence: "167.2 goal: 'Widened 2026-09-22 (167 D-19): the /strategies list, where a manager lands, marks each strategy row whose feeding key is untrusted (isUntrustedKeySyncStatus) with the same key-level pill'"
  - truth: "A poll landing after the enqueue answers, but before the worker writes computing, cannot end an attempt with the previous run's result"
    addressed_in: "Phase 167.2 KEYCARDSYNC"
    evidence: "167.2 requirements item (3). The defect is pre-existing and not made worse by 167-06. The fix proposed there is to accept a terminal read only after this attempt has seen computing, or once computed_at has changed."
  - truth: "A post-add sync failure that lands during another key's live attempt is shown to the user"
    addressed_in: "Phase 167.2 KEYCARDSYNC"
    evidence: "167.2 requirements item (1), as narrowed: 'what remains is that a post-add sync FAILURE during another key's live attempt reaches only the console'"
human_verification:
  - test: "After merge, confirm the CHECK widening applied on TEST, then on PROD behind the Production reviewer gate: api_keys_sync_status_check admits sign_in_failed. Run the marker query first."
    expected: "apply-test is green and the self-verify DO block stays silent. After the PROD apply, a later daily poll of a key whose sign-in was refused writes sync_status = sign_in_failed, not the SFH-H2 fallback 'error'."
    why_human: "The migration is not applied anywhere yet, and no DB command may run from this checkout."
  - test: "After merge and at least one daily poll, read the sync_status of the two keys behind the ROADMAP's measured cases: the long-stalled MT5 key and the expired bybit key."
    expected: "The MT5 key reads sign_in_failed, provided the live code satisfies the next item. The bybit key reads revoked. Either status renders for its owner, whatever the owner's role."
    why_human: "Needs a PROD read."
  - test: "On the live gateway, find out what login() returns for a wrong investor password: -6, 0, or a login-stage -10005 (RESEARCH assumption A1, still unmeasured)."
    expected: "A code that is_mt5_login_refusal accepts, so the headline MT5 case reaches sign_in_failed rather than the transport note."
    why_human: "Needs a live MT5 terminal and a credential entered by the founder. Agents may not enter credentials."
  - test: "Render the amber 'Sign-in failed' pill and its helper at a 320px viewport and at 200% zoom on BOTH surfaces: the /profile Exchanges table, and the edit page's key card in the narrow right-hand column. Also render the KEY_SIGN_IN_FAILED envelope in both wizard connect steps."
    expected: "The helper wraps as a caption and does not clip. The key card's buttons and pill do not overflow. The envelope does not overflow horizontally. Neither surface shows a Retry button."
    why_human: "This is a visual check. UI-SPEC records S1 long-text as a backstop and S2 overflow as unresolved, and the edit-page column is narrower than the profile table."
---

# Phase 167: CREDTRUST Verification Report

**Phase goal:** When a customer's venue credentials stop working, the product TELLS them so. It does this on the surface where they notice the symptom, names the credential as the reason their factsheet stopped updating, and nudges them to reconnect.
**Verified:** 2026-09-23T00:33:44Z at `7b3ffe91`
**Status:** human_needed
**Re-verification:** Yes. The previous report was `human_needed`, 31/34, at `de41a200`. This is the final re-verification after two review-and-fix rounds on 167-06.

## What changed since the previous report

There are 10 non-merge commits from `de41a200` to HEAD. Source changes:
- **`ApiKeyManager.tsx`:** the attempt-scoped marker, the ordered and bounded re-reads, the WR-01 subject move, and the zero-row delete lookup.
- **`SyncProgress.tsx`:** one line. The poll gate `enabled: isActive` became `enabled: syncStatus === "computing"`.
- **`useStrategySyncPoller.ts`:** its options docblock only. No executable line changed.
- **Tests:** the two `ApiKeyManager` test files, including the new real-poller file `ApiKeyManager.poll.test.tsx`.

Everything else is planning documents.

Paths that did not change: `git diff 3bf2f24b..HEAD` outside `.planning/` touches only those five source files plus `.gitleaks.toml`. That leaves the following with a **0-line** diff since the last full verification:
- `analytics-service/` and `supabase/`
- every factsheet path
- `src/components/exchanges/`, `Modal.tsx`, `ProfileTabs.tsx` and the profile page

So the Python, SQL, wizard and allocator-surface truths cannot have regressed.

The hook's only runtime importers are `SyncProgress` and the wizard's `SyncPreviewStep`. The hook body is unchanged, so the wizard is unaffected. `SyncProgress` has exactly one importer, `ApiKeyManager`, so the gate change reaches no other surface.

## Goal Achievement

The goal-level question is now a recorded decision. **D-19** (orchestrator, founder-delegated) rules that the edit-page key card closes goal truth 1. It routes the stronger `/strategies` list-row mark to Phase 167.2. The decision is written in `167-CONTEXT.md` and in the ROADMAP's 167-06 line, and the 167.2 goal was widened to carry the list-row mark.

That is the override path the previous report prescribed, so truth 1 is **PASSED (override)**. Two points stay on the record:
- The shipped sentence names the credential and the remedy, not the factsheet. The factsheet is tied in by placement only.
- The override's acceptor is the orchestrator acting under delegation, not the founder in person.

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | **[Goal]** On the surface where they notice the symptom, the customer is told the credential is why the factsheet stopped updating | ✓ PASSED (override) | Override: D-19, accepted by the orchestrator under founder delegation on 2026-09-22. The state renders for every role: truth 23 covers manager/both, and `/profile` covers allocator/both. |
| 2 | **[Goal]** Where the state renders, it nudges the owner to update the credential | ✓ VERIFIED | `CREDENTIAL_FAILED_HELPER` is unchanged. The remedy control sits in the same card: `[167-06]` untrusted case, `within(card)`. |
| 3 | **[ROADMAP finding 1]** A refused MT5 sign-in in the daily poll is no longer stamped with a transport cause and a retry promise | ✓ VERIFIED (0-line diff) | As previously verified. The end-to-end test covers -10005, 0 and -6. |
| 4 | **[SF-H2 / 01]** Wizard copy on a login-stage refusal names the credential as one possible reason and makes no retry promise | ✓ VERIFIED (0-line diff) | `SIGN_IN_FAILED` → `VENUE_WIRE_CODE_TO_VERDICT` → `KEY_SIGN_IN_FAILED`. `wizardErrors.roster-render.test.tsx` passes. |
| 5 | **[01 / D-08]** No Retry renders, and that follows from the action set | ✓ VERIFIED (0-line diff) | `dialog-envelope.invariant.test.ts` passes. |
| 6 | **[01]** The other `NETWORK_UNAVAILABLE` sites are unchanged | ✓ VERIFIED | The router file has a 0-line diff. |
| 7 | **[01]** The code can be reached only from a wire code the server emits | ✓ VERIFIED | Unchanged. |
| 8 | **[finding 3]** The second measured venue (an expired bybit key) is surfaced | ✓ VERIFIED (code path) | The pinned ccxt maps the expired-key code to `AuthenticationError`, which maps to `revoked`, which renders `Key revoked` on the manager card. The live status is human item 2. |
| 9 | **[02 / D-09, D-10]** No note promises a retry for a failure that `classify_exception` calls permanent | ✓ VERIFIED (0-line diff) | |
| 10 | **[03 / D-05]** `sign_in_failed` renders an amber pill and an authored helper. It ignores `sync_error` and promises no retry | ✓ VERIFIED | Component unchanged. The `[167-06]` leak case passes. |
| 11 | **[03]** The `error`/`complete_with_warnings` branch is unchanged, and the new value never falls through to the idle pill | ✓ VERIFIED (0-line diff) | |
| 12 | **[03 / D-04]** The public factsheet payload is unchanged, and no cause enters the id-keyed cache | ✓ VERIFIED | Factsheet paths have a 0-line diff over the whole branch. |
| 13 | **[03]** The CHECK constraint admits `sign_in_failed` on TEST and PROD | ? PENDING MERGE (human item 1) | Not applied anywhere. The SFH-H2 fallback keeps deploy-before-migrate safe. |
| 14 | **[04]** Every other failure keeps its status and copy, and a ccxt `AuthenticationError` still writes `revoked` | ✓ VERIFIED (0-line diff) | |
| 15 | **[04 / D-16]** The holdings surfaces test ONE untrusted-status predicate | ✓ VERIFIED | `ApiKeyManager` also answers through `isUntrustedKeySyncStatus`. |
| 16 | **[D-17]** Only a login-stage refusal counts as a sign-in refusal | ✓ VERIFIED (0-line diff) | |
| 17 | **[D-02 / D-03]** No credential cause is inferred from staleness alone | ✓ VERIFIED | The mount reads the stored `sync_status` only. The fix rounds added no staleness or freshness read. |
| 18 | **[05 / D-01]** The ROADMAP `Depends on:` names the phase that actually activated the ledger refresh | ✓ VERIFIED | Unchanged. |
| 19 | **[05]** Both full suites are green | ✓ VERIFIED | Orchestrator, main checkout at `7b3ffe91`: vitest 15183 passed, 0 failed (865 files); tsc and lint clean. My own single full run in this worktree: 864 files and 15147 tests passed. One file failed at module load: `gdpr-export-coverage-hook.test.ts`, whose `MEASURE_FAIL` is the pinned-tsx absolute-path check. A harness worktree has no `node_modules/.bin/tsx`, and the 167-06 SUMMARY documents this as environmental. The 36-test gap equals that file's tests. My `tsc --noEmit` exited 0, and eslint on the 5 changed source/test files exited 0. Python has had no change since `3bf2f24b` (6109 passed, mypy --strict clean). |
| 20 | **[05]** VERSION and CHANGELOG ship in one release commit, and VERSION equals package.json | ✓ VERIFIED | Both read `0.86.0.0`. |
| 21 | **[05]** Every commit on the branch maps to a CHANGELOG bullet | ⏭ CLOSED AT SHIP TIME (`/gsd-ship`) | Not true at this sha: CHANGELOG.md was last touched by `6c483b1c`, with 54 non-merge commits since. Recorded under `deferred`. |
| 22 | **[05 / D-14]** No email or push notifier was added | ✓ VERIFIED | The fix rounds touch one component, one panel gate and tests. |
| 23 | **[06]** A manager-role owner whose key carries `sign_in_failed` sees the amber pill and authored helper on that key's card on `/strategies/[id]/edit`, in the same card as `Update password` | ✓ VERIFIED | The mount is still `isUntrustedKeySyncStatus(key.sync_status)` inside the `keys.map` card. The route is gated by `requireRolePage(…, "manager")`. The `[167-06]` cases pass, and the edit-page test passes (10). |
| 24 | **[06]** A `revoked` key shows `Key revoked` and its authored re-add helper on the same card | ✓ VERIFIED | The same `it.each` row. |
| 25 | **[06]** Every trusted-or-neutral status, and null, renders no pill, no helper and no added live region | ✓ VERIFIED | The HEALTHY CONTROL cases now also assert zero live regions (round-1 WR-01). |
| 26 | **[06]** The raw `api_keys.sync_error` never reaches this surface | ✓ VERIFIED | Leak case. |
| 27 | **[06 R1]** While a resync is in flight, the card shows the neutral `Syncing…` pill with a silent helper, and the helper region stays mounted | ✓ VERIFIED (behavioural test) | `R1 in flight` and `R1 stable live region` pass. |
| 28 | **[06 R2]** A terminal success is withheld while its subject key is untrusted. The error render still shows, and the panel is never unmounted in flight | ✓ VERIFIED (behavioural test) | `withholdPanelSuccess` is unchanged. The R2 cases pass. |
| 29 | **[06 R3]** After a successful Update password, a withheld success is retired and never re-shown | ✓ VERIFIED (behavioural test) | `onUpdated` runs `retireWithheldSuccess()` then `loadKeys()`. The R3 remedy, during-flight, control, keeps-an-error and FUNCTIONAL-updater cases pass. |
| 30 | **[06 R4]** A key's password is never replaced during its own sync | ✓ VERIFIED (behavioural test) | Key-scoped `disabled={syncingKeyId === key.id}`. The marker can now be cleared only by its own attempt (truth 35), which is the premise R4 rests on. |
| 31 | **[06 R5]** A withheld success is retired on Delete and on an Add Key subject move, and a never-withheld success survives both | ✓ VERIFIED (behavioural test) | The R5 remedy and control cases pass. |
| 32 | **[06 R5]** A key's Delete is disabled during its own sync only | ✓ VERIFIED (behavioural test) | `R5 Delete blocked in flight` passes. |
| 33 | **[06 R6, as corrected by D-18]** A failed post-add sync never ends or dead-locks a live tracked attempt. With no attempt live, it reports to the panel | ✓ VERIFIED (behavioural test) | The wording shipped earlier ("every transition to `error` clears the marker") was superseded by D-18's R6 correction, and the corrected rule is what I judged. The catch returns while `attemptRef.current !== null`. The `R6 (corrected)`, `ATTEMPT SCOPE, post-add route` and `live from the CLICK` cases pass. |
| 34 | **[06, as amended by D-18 fix round 2]** No factsheet path changes. `AllocatorSyncStatus`, its pill map, `ProfileTabs` and the profile page are byte-unchanged. No new copy and no new colour exist | ✓ VERIFIED (as amended) | Those paths have a 0-line diff. `SyncProgress` is NO LONGER byte-unchanged, so the plan text is not literally true. It changed one executable line, the poll gate, plus a comment, and added no copy and no colour, so the must-have's stated purpose holds. The change is recorded in D-18 (R4 round-2 lineage and the reversibility line) and in the 167-06 SUMMARY's key-files. See Info finding 1. |
| 35 | **[D-18 fix round]** Only the tracked attempt clears the in-flight marker, and a poll status read before its own enqueue answered is ignored | ✓ VERIFIED (behavioural test) | The single `endAttempt` identity check, and the `!attempt.enqueued` guard. Cases that pass: `ATTEMPT SCOPE, stale-read route` (`it.each`), `an ENDED attempt's late failure…`, and `the attempt is live from the CLICK…`. |
| 36 | **[D-18 fix round 2 / R2 CR-01]** The poll budget starts at the enqueue, so a slow but successful enqueue is not reported as a timeout | ✓ VERIFIED (behavioural test, REAL poller) | The `SyncProgress` gate is `syncStatus === "computing"`, and `ApiKeyManager` sets `computing` only after `isSyncEnqueued`. `ApiKeyManager.poll.test.tsx` runs the real panel and poller on fake timers. Its 36 s and 126 s enqueue cases pass, and so does the grace-boundary CONTROL, which shows the absence case can fail. The SUMMARY records that reverting the gate turns 3 cases RED. |
| 37 | **[D-18 fix round 2]** A terminal success is shown only after an ordered, bounded re-read that could withhold it. A failed, timed-out or throwing re-read withholds it and shows the load error | ✓ VERIFIED (behavioural test) | `settling` guard, `keysReadSeqRef`/`appliedKeysReadRef`, `TERMINAL_REREAD_BOUND_MS` race, and a catch. Cases that pass: terminal-not-shown-until-re-read, re-read FAILS, `one terminal is handled once` (WR-03), `reads are ordered` (WR-04), re-read THROWS (SFH2-LOW-1), and the poll-test bounded re-read (15 s). |
| 38 | **[R2 WR-01]** Retry after a post-add failure targets the key that failed | ✓ VERIFIED (behavioural test) | The catch runs `setLastAttemptedKeyId(newKeyId)` alongside the error. `Retry after a post-add failure re-links the NEW key, never J` passes for both orderings. |
| 39 | **[round-1 SFH-PRE / R2 WR-05, IN-03]** A Delete must remove exactly one row. An already-gone row is a success, and a still-present row is reported as a refusal in active-voice copy | ✓ VERIFIED (behavioural test) | `.select("id")` plus a follow-up existence read. The zero-row refusal and already-gone cases pass. |
| 40 | **[round-1 SFH LOW-2]** The load-error banner renders whether or not the Add Key form is open | ✓ VERIFIED (behavioural test) | The banner condition no longer tests `!showForm`. `a failed re-read after Update password is reported even while the Add Key form is open` passes. |

**Score:** 38/40 truths verified, including 1 override. 0 are present but behaviour-unverified. The other 2:
- truth 13 is pending merge;
- truth 21 is closed at ship time.

Every state-transition truth (27–33, 35–40) counts as VERIFIED because a named case in a file I ran exercises it. I re-ran none of the SUMMARY's neuter tables, because this verification may not modify a source file. I read the round-2 cases, and each asserts its transition, not mere presence.

### Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `src/components/strategy/ApiKeyManager.tsx`: `SyncAttempt`, `endAttempt`, `attemptRef`, ordered `loadKeys`, `TERMINAL_REREAD_BOUND_MS`, the R1–R6 derivations, the zero-row lookup | ✓ VERIFIED | Substantive and wired into the edit page. It authors no new colour, and its only new user-visible copy is the refusal sentence and the load-error string. |
| `src/components/strategy/SyncProgress.tsx`: poll gate on `computing` | ✓ VERIFIED | One importer, `ApiKeyManager`. `SyncProgress.poll.test.tsx` and `SyncProgress.test.ts` pass unedited. |
| `src/hooks/useStrategySyncPoller.ts` | ✓ VERIFIED | Docblock only. The wizard's `SyncPreviewStep` tests (all 10 files) and `seam-poll-disjointness.pin.test.ts` pass. |
| `src/components/strategy/ApiKeyManager.poll.test.tsx` (new) | ✓ VERIFIED | The real panel and poller, not a mock. It closes the reason CR-01 slipped: the other suite mocks `SyncProgress`. |
| `167-REVIEW-06.md`, `167-REVIEW-06-R2.md` | ✓ PRESENT | Each has a silent-failure table. Every R2 finding (CR-01, WR-01…05, IN-01…04, SFH2-*) maps to a code change and a named passing case, except the stale-read limit, which is routed to 167.2. |
| `167-CONTEXT.md` D-18 (corrected), D-19 | ✓ PRESENT | Reason 2 now names the layout's role gate. |
| All Python, SQL, allocator and wizard artifacts | ✓ VERIFIED (0-line diff) | |

### Key Link Verification

| From | To | Status |
|---|---|---|
| `api_keys.sync_status` → `loadKeys` (`API_KEY_USER_COLUMNS`) → `isUntrustedKeySyncStatus` → `AllocatorSyncStatus` in that key's `Card` | manager key card | ✓ WIRED |
| `handleSyncTrades` → `attempt.enqueued = true` → `setSyncStatus("computing")` → `SyncProgress` `enabled: syncStatus === "computing"` → `onStatusChange` → `handleSyncStatusChange` | poll starts at the enqueue | ✓ WIRED |
| terminal success → `settling` → `Promise.race(loadKeys, bound)` → `endAttempt` → `setSyncStatus(reread ? status : "idle")` → `withholdPanelSuccess` | success only after a re-read that can withhold it | ✓ WIRED |
| `UpdateMt5SecretDialog.onUpdated` → `retireWithheldSuccess` → `loadKeys` ← `rotate-secret` wrote `idle` | the fix clears the pill | ✓ WIRED |
| `/strategies/[id]/edit` ← `strategies/layout.tsx` `requireRolePage(…, "manager")` | reachability | ✓ manager and both |
| `api_keys.sync_status` → `/strategies` list row | symptom-adjacent surface | Deferred to 167.2 by D-19 |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| `ApiKeyManager` key card | `key.sync_status` | `api_keys` through the user-scoped client. The daily poll writes the column for every active, non-revoked key. | yes | ✓ FLOWING |
| `AllocatorSyncStatus` on `/profile` | `syncStatus` | same column | yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| 167-06 and its fix rounds, adjacent panel/poller/wizard | `npx vitest run` over both `ApiKeyManager` files, both `SyncProgress` tests, `useStrategySyncPoller.test.ts`, `AllocatorSyncStatus.test.tsx` and every `SyncPreviewStep` test | 29 files, 703 passed | ✓ PASS |
| Other consumers and censuses | sync, validate-and-encrypt and csv-finalize route tests, `complete-status-scan`, `seam-poll-disjointness.pin`, `dialog-envelope.invariant`, `wizardErrors.roster-render`, staleness, `AllocatorMatchQueue`, csv-validate | 10 files, 371 passed | ✓ PASS |
| Edit page | `npx vitest run edit/page.test` | 1 file, 10 passed | ✓ PASS |
| Full suite (one run) | `npx vitest run` | 864 files passed; 1 environmental load failure (see truth 19) | ✓ PASS (env caveat) |
| Types and lint | `tsc --noEmit`; eslint over the 5 changed files | both exit 0 | ✓ PASS |
| Nothing else moved | `git diff 3bf2f24b..HEAD` outside `.planning/` | 5 source/test files plus `.gitleaks.toml` | ✓ PASS |

### Probe Execution

No probe is declared, and this is not a migration-runner or tooling phase. Step 7c: SKIPPED.

### Requirements Coverage

There are no v1.20 requirement IDs. The phase-local D-ids are not marked in `REQUIREMENTS.md`, per D-15b.
- **D-04:** honoured (truth 34).
- **D-05 and D-11 arm B:** honoured, since the fix rounds reuse the existing pill and helper.
- **D-18:** honoured as corrected.
- **D-19:** honoured and routed (truth 1, and `deferred`).

No requirement is orphaned.

### Anti-Patterns and Findings

| File / artifact | Finding | Severity | Impact |
|---|---|---|---|
| All 5 changed source/test files | `TBD`/`FIXME`/`XXX` debt markers | none found | |
| `167-06-PLAN.md` must-have text vs `SyncProgress.tsx` | (Info 1) The plan still says `SyncProgress` is byte-unchanged. Fix round 2 changed its poll gate on purpose, and the change is recorded in D-18 and the SUMMARY. | ℹ️ Info | The plan is historical. The purpose of the must-have, no new copy or colour, holds. |
| `ApiKeyManager.tsx` `handleDeleteKey` comment | (Info 2) The comment says the list "cannot move during the delete await, because the confirm is open and opened modally". Two things break that. Another key's live attempt can re-read the list asynchronously while the modal is open. And round 2's follow-up lookup await runs after `setConfirmDelete(null)`, so the modal is already closed. | ℹ️ Info | The worst case is a lost truthful success line, never a false one: the updater only maps a success to `idle`. Narrow race only. |
| `ApiKeyManager.tsx` `retireWithheldSuccess` docblock | (Info 3) Says it is "the ONLY place" a terminal success is mapped to `idle`. The terminal arm's `setSyncStatus(reread ? status : "idle")` also withholds a success as `idle`. | ℹ️ Info | Comment accuracy only. |
| ROADMAP 167.2 item (4) | (Info 4) Still says "the poller's own timeout is ignored before enqueue". Since round 2 no pre-enqueue poll runs; D-18's re-read has the corrected mechanism. | ℹ️ Info | The routed limit and its bound (`maxDuration`) are unchanged. |
| ROADMAP `### Phase 167` plan list | (Info 5) 167-01 and 167-03…06 are still unchecked `[ ]`, while each has a SUMMARY. | ℹ️ Info | Bookkeeping; the orchestrator owns the ROADMAP. |
| `167-SECURITY.md` | (Info 6) `audited_at_sha` is `3bf2f24b`, which predates 167-06. | ℹ️ Info | Per repo policy, secure-phase runs in parallel with this verifier. 167-06 adds no route, no grant and no new data read beyond one owner-scoped existence `select("id")`. |
| Fix round 2 (`d65d675f`) | (Info 7) No third review round covers it, per the repo's two-rounds-then-verifier policy. I traced every round-2 change adversarially. Beyond Info 2 and 3, I found no defect. | ℹ️ Info | |
| `HoldingsTable.tsx` toggle and footer | Still say "revoked" for a set that now includes `sign_in_failed`. | ℹ️ Info | Carried forward; named residual in 167-04. |

### Human Verification Required

1. **Migration applies on merge.** Confirm TEST first, then PROD behind the Production reviewer gate. Run the marker query first. Then confirm that a refused sign-in writes `sign_in_failed`, not `error`.
2. **The two measured keys after the first post-merge daily poll.** Expect `sign_in_failed` for the MT5 key, subject to item 3, and `revoked` for the bybit key.
3. **The real wrong-password code** on the live gateway, entered by the founder (RESEARCH A1).
4. **Visual checks at 320px and 200% zoom:** the pill and helper on the `/profile` table and on the narrower edit-page key card, plus the wizard envelope with no Retry.

### Gaps Summary

**There are no open gaps.** Every finding from the previous report is resolved:
- **Review coverage.** Two review-and-fix rounds covered 167-06. Every finding from both is fixed with a named passing case or routed to 167.2.
- **Goal truth 1.** Closed by the D-19 override, recorded in CONTEXT and the ROADMAP.
- **Planning records.** The D-18 gating statement is corrected, and the ROADMAP lists 167-06.

The fix rounds broke nothing elsewhere in the phase:
- All code outside `ApiKeyManager`, one `SyncProgress` line and one hook docblock has a 0-line diff.
- Every consumer and census test passes.
- The one full-suite failure is environmental, and the orchestrator's main-checkout run is 0 failed.

What remains:
- The CHANGELOG cross-check, closed at ship time by `/gsd-ship`.
- The migration's application, pending merge.
- Four founder or visual observations.

---

_Verified: 2026-09-23T00:33:44Z_
_Verifier: Claude (gsd-verifier)_
