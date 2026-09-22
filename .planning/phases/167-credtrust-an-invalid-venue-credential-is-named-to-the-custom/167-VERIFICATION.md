---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
verified: 2026-09-22T23:21:12Z
status: human_needed
score: 31/34 must-haves verified
verified_at_sha: de41a2009d03b6b62288b591223cd12659e51b88
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
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 18/22
  previous_sha: 3bf2f24b8d1efcd8de4ef5df7bc0af92aa30ce7e
  gaps_closed:
    - "Gap 1, the part the previous report measured: a manager-role owner now sees the persisted untrusted state (the amber 'Sign-in failed' pill and its authored helper, or 'Key revoked' and its re-add helper) on that key's own card on /strategies/[id]/edit, beside the Update password / Delete control that fixes it (167-06, D-18). Every profile role now reaches a surface that renders the state."
    - "Gap 2 (stale CHANGELOG 0.86.0.0 entry): closed at ship time, owned by /gsd-ship. Its repo-mandated CHANGELOG mechanism enumerates every branch commit and regenerates the unified entry. It is NOT closed at this sha: CHANGELOG.md was last touched by 6c483b1c, and 11 non-merge commits have landed since the previous verification."
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "Every commit on this branch maps to at least one CHANGELOG bullet (167-05 must-have; repo CHANGELOG discipline)"
    addressed_in: "/gsd-ship, which runs immediately after this verification (not a roadmap phase)"
    evidence: "CLAUDE.md 'CHANGELOG discipline': enumerate every commit, group by theme, write one unified entry per version, then cross-check every commit against a bullet. Orchestrator ruling: record as closed at ship time."
human_verification:
  - test: "FOUNDER DECISION, goal truth 1. Is placement enough? The state renders on the key card of the strategy's own edit page, with no sentence tying the credential to the factsheet. Accept it with an override, or route a follow-up that also shows the key-scoped pill on the manager's landing list (/strategies)."
    expected: "Either an overrides: entry is added here, with the same decision recorded in 167-CONTEXT and the ROADMAP (deviation policy), or a phase is named for the list-row indicator."
    why_human: "This is a product judgment about which surface is 'where they notice the symptom'. The code evidence is complete either way. D-18 is a planner and orchestrator decision; the founder has not recorded one, and the previous report asked for exactly that."
  - test: "After merge, confirm the CHECK widening applied on TEST, then on PROD behind the Production reviewer gate: api_keys_sync_status_check admits sign_in_failed. Run the marker query first."
    expected: "apply-test is green and the self-verify DO block stays silent. After the PROD apply, a later daily poll of a key with a refused sign-in writes sync_status = sign_in_failed, not the SFH-H2 fallback 'error'."
    why_human: "The migration is not applied anywhere yet, and no DB command may run from this checkout."
  - test: "After merge and at least one daily poll, read the sync_status of the two keys behind the ROADMAP's measured cases: the long-stalled MT5 key and the expired bybit key."
    expected: "The MT5 key reads sign_in_failed, if the live code meets the next item. The bybit key reads revoked. The pinned ccxt maps that venue's expired-key code to AuthenticationError, and the poll maps that to revoked. Either status now renders for the owner, whatever their role."
    why_human: "Needs a PROD read. The owner-role question from the previous report is moot now: every role reaches a rendering surface."
  - test: "On the live gateway, find out what login() returns for a wrong investor password: -6, 0, or a login-stage -10005 (RESEARCH assumption A1, still unmeasured)."
    expected: "A code that is_mt5_login_refusal accepts, so the headline MT5 case reaches sign_in_failed and not the transport note."
    why_human: "Needs a live MT5 terminal and a founder-entered credential. Agents may not enter credentials."
  - test: "Render the amber 'Sign-in failed' pill and its helper at a 320px viewport and at 200% zoom on BOTH surfaces: the /profile Exchanges table, and the edit page's key card, which sits in the narrow right-hand column. Also render the KEY_SIGN_IN_FAILED envelope in both wizard connect steps."
    expected: "The helper wraps as a caption and does not clip. The key card's buttons and pill do not overflow. The envelope does not overflow horizontally. Neither shows a Retry button."
    why_human: "Visual. UI-SPEC records S1 long-text as a backstop and S2 overflow as unresolved, and the edit-page column is narrower than the profile table."
---

# Phase 167: CREDTRUST Verification Report

**Phase goal:** A customer whose venue credentials stopped working is TOLD, in the product and on the surface where they notice the symptom, that the credential is the reason their factsheet stopped updating, and is nudged to reconnect.
**Verified:** 2026-09-22T23:21:12Z at `de41a200`
**Status:** human_needed
**Re-verification:** Yes. This follows gap closure plan 167-06. The previous report was `gaps_found`, 18/22, at `3bf2f24b`.

## What changed since the previous report

There are 11 non-merge commits between `3bf2f24b` and HEAD. Only three touch source:
- `8fcab363` and `76140dd7` change `ApiKeyManager.tsx` and its test;
- `6c71b573` scopes a gitleaks false positive to one identifier in one test file.

The rest are planning docs. `analytics-service/`, `supabase/`, every factsheet path, `src/components/exchanges/`, `SyncProgress.tsx`, `Modal.tsx`, `ProfileTabs.tsx` and the profile page carry a **0-line** diff from `3bf2f24b` to HEAD. So the previously verified Python, SQL and allocator-surface truths cannot have regressed.

## Goal Achievement

**Gap 1 is closed as the previous report measured it.**
- `ApiKeyManager` now mounts the locked `AllocatorSyncStatus` on a key's `Card` exactly when `isUntrustedKeySyncStatus(key.sync_status)`.
- It reads the `sync_status` that `loadKeys` already selects through `API_KEY_USER_COLUMNS`.
- The edit page mounts `ApiKeyManager` for every non-CSV strategy.

Who reaches the edit page:
- `strategies/layout.tsx` guards the whole `/strategies` subtree with `requireRolePage(…, "manager")`, which admits `manager` and `both`.
- `/strategies` is the `homeHref` `requireRolePage` gives a manager, so it is the manager's landing page, one click from the edit page.

Together with the allocator-only `/profile` Exchanges tab, **every profile role now reaches a surface that renders the state.**

**What remains is a judgment, not a code gap: goal truth 1 is routed to the founder.**
- The rendered sentence names the credential and the remedy. It does not name the factsheet.
- The tie to the stalled factsheet is carried by placement: the strategy's own edit page, with its current key marked by `Resync`.
- I accept that no causal sentence can be authored honestly under D-02, D-03 and D-12: the staleness conjunct is `service_role`-only.

I do **not** accept the framing that this is the strongest delivery the locked decisions allow:
- The manager's landing page, `/strategies` (`StrategiesPage`), already selects each owned strategy's `api_key_id`.
- It is server-rendered, owner-scoped (`.eq("user_id", user.id)`) and dynamic under the subtree layout.
- It touches none of the D-04 paths.
- A key-scoped pill on a strategy row would make no causal claim, so it would breach none of D-02, D-03, D-04 or D-12.
- Today that page shows nothing. A manager who notices a stale factsheet and never opens the edit page is never told.

**My verdict on sufficiency.** The delivery is adequate to close the recorded gap, and defensible as a reading of "the surface where they notice the symptom". It is not self-evidently that surface. The previous report asked for a founder decision on exactly this point, and D-18 is a planner and orchestrator decision, not a founder one. So truth 1 is UNCERTAIN, and it goes to human item 1 rather than to VERIFIED.

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | **[Goal]** On the surface where they notice the symptom, the customer is told the credential is why the factsheet stopped updating | ? UNCERTAIN (founder decision, human item 1) | Previously ✗ FAILED (partial). The state now renders for every role (truth 23). The remaining question is placement versus a factsheet-level sentence, and whether the manager's landing list should also carry the key-scoped pill. See Goal Achievement. |
| 2 | **[Goal]** Where the state renders, it nudges the owner to update the credential | ✓ VERIFIED | Unchanged helper `CREDENTIAL_FAILED_HELPER`. On the manager card, the `[167-06]` untrusted case asserts that the remedy button (`Update password` for MT5, `Delete` for a revoked ccxt key) is in the SAME card, via `within(card)`. |
| 3 | **[ROADMAP finding 1]** A refused MT5 sign-in in the daily poll is no longer stamped with a transport cause and a retry promise | ✓ VERIFIED (regression: 0-line diff) | As in the previous report. `fetch_allocator_holdings` raises `AllocatorHoldingsSignInFailedError`; the end-to-end test covers -10005, 0 and -6. |
| 4 | **[ROADMAP SF-H2 / 01]** Wizard copy on a login-stage refusal names the credential as one possible reason and makes no retry promise | ✓ VERIFIED (regression) | `SIGN_IN_FAILED` → `VENUE_WIRE_CODE_TO_VERDICT` → `KEY_SIGN_IN_FAILED`, unchanged. |
| 5 | **[01 / D-08]** No Retry renders, and that is derived from the action set | ✓ VERIFIED (regression) | Unchanged. |
| 6 | **[01]** The other `NETWORK_UNAVAILABLE` sites are unchanged | ✓ VERIFIED (regression) | Router file 0-line diff. |
| 7 | **[01]** The code can only be reached from a server-emitted wire code | ✓ VERIFIED (regression) | Unchanged. |
| 8 | **[ROADMAP finding 3, venue-agnostic]** The second measured venue (an expired bybit key) is now surfaced | ✓ VERIFIED (code path) | Previously ? UNCERTAIN, because the owner's role decided whether any surface existed. Now: the pinned `ccxt==4.5.64` maps bybit's expired-key code to `AuthenticationError`, which I read in the installed package. `_map_exception_to_sync_status` maps that to `revoked`, and the `[167-06]` case renders `Key revoked` plus its helper on the manager card. The live key's current status is a PROD read (human item 3). |
| 9 | **[02 / D-09, D-10]** No note promises a retry for a failure `classify_exception` calls permanent | ✓ VERIFIED (regression) | Unchanged. |
| 10 | **[03 / D-05]** A `sign_in_failed` key renders an amber pill and an AUTHORED helper that ignores `sync_error` and promises no retry | ✓ VERIFIED | Unchanged component. On the new surface, the `[167-06]` leak case asserts the raw `sync_error` and any `will retry automatically` substring are absent. |
| 11 | **[03]** The `error`/`complete_with_warnings` branch is unchanged, and the new value never falls to the idle pill | ✓ VERIFIED (regression) | `AllocatorSyncStatus` and the pill map have a 0-line diff. |
| 12 | **[03 / D-04]** The public factsheet payload is unchanged, and no cause enters the id-keyed cache | ✓ VERIFIED | Factsheet, factsheet-share and `src/lib/factsheet` have a 0-line diff over the whole branch. |
| 13 | **[03]** The CHECK constraint admits `sign_in_failed` in TEST and PROD | ? PENDING MERGE (human item 2) | The migration and SQL gate are unchanged and not applied anywhere. The SFH-H2 fallback keeps a deploy-before-migrate ordering safe. |
| 14 | **[04]** Every other failure keeps its status and copy; a ccxt `AuthenticationError` still writes `revoked` | ✓ VERIFIED (regression) | Unchanged. |
| 15 | **[04 / D-16]** The holdings surfaces test ONE untrusted-status predicate | ✓ VERIFIED (regression) | Unchanged. `ApiKeyManager` now also answers through `isUntrustedKeySyncStatus`. |
| 16 | **[D-17]** Only a login-stage refusal counts as a sign-in refusal | ✓ VERIFIED (regression) | Unchanged. |
| 17 | **[D-02 / D-03]** No credential cause is inferred from staleness alone | ✓ VERIFIED | The new mount reads the stored `sync_status` only. No code in `ApiKeyManager.tsx` reads a staleness or freshness signal: all 6 case-insensitive `stale`/`freshness` hits are comments, and none is `ledger_refresh`. |
| 18 | **[05 / D-01]** The ROADMAP `Depends on:` names the phase that actually activated the ledger refresh | ✓ VERIFIED (regression) | Unchanged. |
| 19 | **[05]** Both full suites are green | ✓ VERIFIED | Orchestrator-measured at `de41a200`: vitest 15159 passed, 0 failed, 864 files; tsc and lint clean. Python has a 0-line diff since `3bf2f24b`, where pytest had 6109 passed and mypy --strict was clean. This run: `ApiKeyManager.test.tsx` plus `AllocatorSyncStatus.test.tsx`, 106 passed. |
| 20 | **[05]** VERSION and CHANGELOG ship in one release commit, and VERSION equals package.json | ✓ VERIFIED | Both read `0.86.0.0`. |
| 21 | **[05]** Every commit on the branch maps to a CHANGELOG bullet | ⏭ CLOSED AT SHIP TIME (owned by `/gsd-ship`) | Not true at this sha, and deliberately not counted as verified: CHANGELOG.md was last touched by `6c483b1c`. `/gsd-ship`'s repo-mandated mechanism regenerates the unified 0.86.0.0 entry over every commit, including `8fcab363`, `76140dd7`, `decfea65` and the gitleaks scope commit `6c71b573`. See `deferred`. |
| 22 | **[05 / D-14]** No email or push notifier was added | ✓ VERIFIED | 167-06 changes one component and its test. |
| 23 | **[06]** A manager-role owner whose key carries `sign_in_failed` sees, on that key's card on `/strategies/[id]/edit`, the amber pill and authored helper, in the same card as `Update password` | ✓ VERIFIED | The mount sits in the `keys.map` card render, conditioned on `isUntrustedKeySyncStatus`. The route is reachable by `manager`/`both` (`requireRolePage`). The `[167-06]` untrusted case checks `data-sync-status`, the exact pill text, the `bg-warning-bg`/`text-warning` classes, the exact hand-typed helper and the same-card `Update password`. It passes. |
| 24 | **[06]** A `revoked` key shows `Key revoked` and its authored re-add helper on the same card | ✓ VERIFIED | The same `it.each` row, with the `Delete` remedy in-card. |
| 25 | **[06]** Every trusted-or-neutral status, and null, renders no pill, no helper and no added live region | ✓ VERIFIED | The healthy control iterates the imported `TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES` plus `null`, one render per case. |
| 26 | **[06]** The raw `api_keys.sync_error` never reaches this surface | ✓ VERIFIED | Leak case, for both untrusted statuses. |
| 27 | **[06 R1]** While a resync is in flight, the card shows the neutral `Syncing…` pill with a silent helper, and the helper region stays mounted | ✓ VERIFIED (behavioural test) | The displayed status is overridden with `syncingKeyId === key.id ? "syncing" : key.sync_status`. The `R1 in flight` and `R1 stable live region` cases pass; the latter checks the node with `toBe` before, during and after. |
| 28 | **[06 R2]** A terminal success is withheld while its subject key is untrusted; the error render still shows; the panel is never unmounted in flight | ✓ VERIFIED (behavioural test) | `withholdPanelSuccess = isComputedAnalytics(syncStatus) && panelSubjectUntrusted` gates the `SyncProgress` mount. Pinned by the R2 `complete`/`complete_with_warnings` cases and the R2 terminal-error case; the R1 case pins the panel still mounted at `computing`. |
| 29 | **[06 R3]** After a successful Update password, a withheld success is retired, never re-shown; another key's in-flight sync keeps running | ✓ VERIFIED (behavioural test) | `onUpdated` calls `retireWithheldSuccess()` and then `loadKeys()`. The helper is guarded by `panelSubjectUntrusted` and uses a functional updater. Pinned by the R3 remedy, R3 during-flight and R3 control cases. |
| 30 | **[06 R4]** A key's password is never replaced during its own sync; the dialog opens modally; another key's Update password stays usable | ✓ VERIFIED (behavioural test) | `disabled={syncingKeyId === key.id}` on `Update password`. The R4 case asserts disabled/enabled per key, re-enabled after the terminal state, and a `showModal` spy scoped to the dialog. |
| 31 | **[06 R5]** A withheld success is retired on Delete and on an Add Key subject move; a never-withheld success survives both | ✓ VERIFIED (behavioural test) | `retireWithheldSuccess()` runs in `handleDeleteKey` after its error return and before the filter, and in `handleAddKey` before the subject moves. Pinned by the two R5 remedy cases and two controls. |
| 32 | **[06 R5]** A key's Delete is disabled during its own sync only | ✓ VERIFIED (behavioural test) | `disabled={syncingKeyId === key.id}` on the card's `Delete`. Pinned by the R5 Delete-blocked case. |
| 33 | **[06 R6]** Every transition of the panel to `error` clears the in-flight marker | ✓ VERIFIED (behavioural test) | `setSyncingKeyId(null)` is in `handleAddKey`'s background catch. Pinned by the R6 case. |
| 34 | **[06]** No factsheet path changes; `AllocatorSyncStatus`, its pill map, `SyncProgress`, `ProfileTabs` and the profile page are byte-unchanged | ✓ VERIFIED | 0-line `git diff 3bf2f24b..HEAD` over all of them. |

**Score:** 31/34 truths verified. Behavioural tests exercise all of them, so 0 are present but behaviour-unverified. The other 3 are:
- 1 UNCERTAIN, founder decision;
- 1 pending merge;
- 1 closed at ship time.

The R-rule truths (27 to 33) are state transitions. Each is VERIFIED because a named case in the file I ran exercises it, not because the code is present. The SUMMARY's 23 neuter runs (N1 to N23) are its own claim. I re-ran none of them, because this verification may not modify a source file. I read the Task 1 cases and the R1 to R4 cases, and each asserts the specific transition, not mere presence.

### Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `src/components/strategy/ApiKeyManager.tsx`: the mount, `panelSubjectUntrusted`, `withholdPanelSuccess`, `retireWithheldSuccess`, two key-scoped `disabled` props, the R6 clear | ✓ VERIFIED | Substantive and wired into the edit page. It authors no copy and no colour. |
| `src/components/strategy/ApiKeyManager.test.tsx`, `[167-06]` describe and its coexistence sub-describe | ✓ VERIFIED | 106 passed across it and `AllocatorSyncStatus.test.tsx` |
| `167-CONTEXT.md` D-18, `167-UI-SPEC.md` S1b amendment, `167-VALIDATION.md` row | ✓ PRESENT | See the Info finding on D-18's reason 2 |
| `src/components/exchanges/AllocatorSyncStatus.tsx` | ✓ VERIFIED | Previously ⚠️ WIRED, LIMITED REACH. It now has a second mount that reaches the manager role. |
| All Python, SQL and wizard artifacts from the previous report | ✓ VERIFIED (0-line diff) | |

### Key Link Verification

| From | To | Status |
|---|---|---|
| `api_keys.sync_status` → `loadKeys` (`API_KEY_USER_COLUMNS`) → `isUntrustedKeySyncStatus` → `AllocatorSyncStatus` inside that key's `Card` | manager key card | ✓ WIRED. Previously ✗ NOT WIRED. |
| `/strategies/[id]/edit` ← `strategies/layout.tsx` `requireRolePage(…, "manager")` | reachability | ✓ `manager` and `both` admitted; `allocator` is redirected to its own home, which has the `/profile` tab |
| `UpdateMt5SecretDialog` `onUpdated` → `retireWithheldSuccess` → `loadKeys` → `rotate-secret` wrote `sync_status: "idle"` → pill unmounts | remedy clears the pill | ✓ WIRED. The rotate-secret route writes `idle`, and the R3 case pins it. |
| `api_keys.sync_status` → `getUserApiKeys` → `AllocatorExchangeManager` → `AllocatorSyncStatus` | allocator pill | ✓ WIRED (unchanged) |
| `api_keys.sync_status` → factsheet, owner or public lane | symptom surface | Not wired, by D-04 and D-18 decision. This is human item 1. |
| `api_keys.sync_status` → `/strategies` list row (manager landing page) | symptom-adjacent surface | Not wired. The previous report did not name this path. It is available under the locked decisions: the page already selects `api_key_id`. This is human item 1. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| `ApiKeyManager` key card | `key.sync_status` | `api_keys` via the user-scoped client. The daily poll writes it for every active non-revoked key, with no role filter. | yes | ✓ FLOWING (previously ✗ DISCONNECTED) |
| `AllocatorSyncStatus` on `/profile` | `syncStatus` | same column | yes | ✓ FLOWING, allocator/both |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Manager card pill, helper, leak, live region, R1 to R6 coexistence; allocator pill unchanged | `npx vitest run` over `ApiKeyManager.test.tsx` and `AllocatorSyncStatus.test.tsx` | 2 files, 106 passed | ✓ PASS |
| Nothing outside the one component moved | `git diff 3bf2f24b..HEAD` over analytics-service, supabase, the factsheet paths, exchanges components, `SyncProgress`, `Modal`, `ProfileTabs`, profile page | 0 lines | ✓ PASS |
| The complete-status census is still satisfied | exact-match comparisons against the complete status in `ApiKeyManager.tsx` | 1, as `ALLOWLIST` pins | ✓ PASS |
| Bybit's expired-key code reaches `revoked` | read `ccxt` 4.5.64 (the pinned version) exception map, and `_map_exception_to_sync_status` | `AuthenticationError`, then `revoked` | ✓ PASS |

### Probe Execution

No probe is declared by any plan or summary, and this is not a migration-runner or tooling phase. Step 7c: SKIPPED.

### Requirements Coverage

There are no v1.20 requirement IDs. 167-06 declares the phase-local D-03, D-04, D-05, D-11 and D-16, and D-15b forbids marking them in `REQUIREMENTS.md`, which was left untouched.
- D-04 is honoured (truth 34).
- D-05 and D-11 arm B are honoured: reuse only.
- D-03 is honoured in the sense that no factsheet-level claim is made.
- D-16's `ApiKeyManager` half is closed; `HoldingsTabPanel`'s `keyStatusById` stays named.

No requirement is orphaned.

### Anti-Patterns and Findings

| File / artifact | Finding | Severity | Impact |
|---|---|---|---|
| Phase-modified sources | `TBD`/`FIXME`/`XXX` debt markers | none found | Verdict only |
| `167-CONTEXT.md` D-18, reason 2 | Says the edit page "is gated by ownership only" and that `proxy.ts` gates admin routes only. It omits `strategies/layout.tsx`'s `requireRolePage(…, "manager")`, which reads `profiles.role` and redirects a pure `allocator`. | ℹ️ Info | The conclusion stands for `manager` and `both`, and it strengthens the coverage argument: allocators have the `/profile` tab. The decision record misstates its own measurement, and a one-line correction is advisable. |
| 167-06 source diff (`ApiKeyManager.tsx`, about 200 lines) | No code-review round covers it: `167-REVIEW.md` has 0 references to 167-06. `167-SECURITY.md` is `audited_at_sha: 3bf2f24b`, which predates it. | ⚠️ Warning (process) | Not a goal gap. The repo's review policy (reviewer ‖ silent-failure-hunter, then verifier ‖ secure-phase) has not run over the gap-closure code. That is the orchestrator's call before ship. |
| D-18's named residual: the post-add sync bypasses the one sync slot | Its untrusted variant can show a panel success ("Up to date") beside a "Sign-in failed" pill: key J syncing, the user adds a key, then J's success is judged against the new key. It is "routed, not fixed", but 0 hits in the ROADMAP, `TODOS.md` or `deferred-items.md` name an owner. | ⚠️ Warning | A user-facing contradiction on a race path, so it is not a goal blocker. The repo's deferral rule requires a user-facing deferral to name a phase. |
| ROADMAP `### Phase 167` | Says "5 plans" and omits 167-06. D-18 appears only in `167-CONTEXT.md`. | ℹ️ Info | The orchestrator owns the ROADMAP. |
| `HoldingsTable.tsx` toggle label and hidden-count footer | Still say "revoked" for a set that now includes `sign_in_failed` | ℹ️ Info | Carried forward; named residual in 167-04 |

### Human Verification Required

1. **Founder decision on goal truth 1.** Is placement enough (the strategy's own edit page, current key marked, the remedy on the card), or should the manager's landing list also carry the key-scoped pill? If accepted, add to this frontmatter, and record the same decision in `167-CONTEXT.md` and the ROADMAP:

   ```yaml
   overrides:
     - must_have: "On the surface where they notice the symptom, the customer is told the credential is why the factsheet stopped updating"
       reason: "<founder reason, e.g. the key card on the strategy's own edit page is the surface; a factsheet-level causal sentence is barred by D-02/D-03/D-12; list-row indicator routed to phase N or declined>"
       accepted_by: "<founder>"
       accepted_at: "<ISO timestamp>"
   ```
2. **Migration applies on merge.** Confirm TEST first, then PROD behind the Production reviewer gate. Then confirm that a refused sign-in writes `sign_in_failed`, not `error`.
3. **The two measured keys' status after the first post-merge daily poll.** Expect `sign_in_failed` for the MT5 key, subject to item 4, and `revoked` for the bybit key.
4. **The real wrong-password code** on the live gateway, entered by the founder (RESEARCH A1).
5. **Visual checks at 320px and 200% zoom.** The pill and helper on both the `/profile` table and the edit-page key card, which sits in the narrower column. Also the wizard envelope, with no Retry.

### Gaps Summary

There are no open gaps.
- **Gap 1** is closed as measured. The state the phase writes for every key now renders for a manager-role owner on that key's card, beside its remedy. The render is proven by behavioural tests: the pill and helper, the no-leak case, one live region, and six coexistence rules against the local sync panel. The goal-adequacy question it leaves is a founder decision (human item 1), not a code defect. It is not the "strongest delivery the locked decisions allow": the manager's landing list is an owner-only, uncached surface that could carry the same key-scoped pill with no causal claim.
- **Gap 2** is closed at ship time by `/gsd-ship`'s CHANGELOG mechanism. It is recorded under `deferred`, and at this sha the entry is still stale.

---

_Verified: 2026-09-22T23:21:12Z_
_Verifier: Claude (gsd-verifier)_
