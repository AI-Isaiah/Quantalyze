---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
verified: 2026-09-22T21:28:51Z
status: gaps_found
score: 18/22 must-haves verified
verified_at_sha: 3bf2f24b8d1efcd8de4ef5df7bc0af92aa30ce7e
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
  - src/lib/wizardErrors.ts
  - src/lib/closed-sets.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "A customer whose venue credentials stopped working is TOLD, on the surface where they notice the symptom, that the credential is the reason their factsheet stopped updating (ROADMAP goal)"
    status: partial
    reason: >-
      The new state is written for EVERY active key (the daily poll has no role gate), but the only
      component that renders it, AllocatorSyncStatus, is mounted only on the /profile Exchanges tab,
      which is allocator-only. profiles.role defaults to 'manager', and a manager owns the factsheet
      whose staleness is the symptom. The manager's own key surface, ApiKeyManager on
      /strategies/[id]/edit, selects sync_status and renders none of it. The factsheet paths are
      untouched on this branch, so no surface ties the credential to the factsheet. RESEARCH Open
      Question 2 asked which surface is "the surface where they notice the symptom". No plan
      answered it.
    artifacts:
      - path: "src/components/auth/ProfileTabs.tsx"
        issue: "the exchanges tab is declared allocatorOnly; the tab list filters it out for a manager-role profile"
      - path: "src/app/(dashboard)/profile/page.tsx"
        issue: "the exchanges data (getUserApiKeys) is fetched only when role is allocator or both"
      - path: "src/components/strategy/ApiKeyManager.tsx"
        issue: "the manager's per-key card shows the label, venue, a 'Last synced' date and the MT5 account, but never sync_status or sync_error, even though API_KEY_USER_COLUMNS selects sync_status"
      - path: "src/app/factsheet/[id]/v2/"
        issue: "no change on this branch; no cause renders on the owner lane (by design) or the public lane (correct, D-04)"
    missing:
      - "Render the sign_in_failed state (and the existing revoked state) on a surface a manager-role owner reaches. The key card in ApiKeyManager is the nearest, and it already hosts the 'Update password' control the helper copy points at."
      - "Either tie the credential state to the stale factsheet on an owner-only surface, keeping D-04 (no field in the id-keyed cached payload), or record a founder decision that the keys surface alone satisfies the goal (override below)."
  - truth: "Every commit on this branch maps to at least one CHANGELOG bullet (167-05 must-have; repo CHANGELOG discipline)"
    status: failed
    reason: >-
      CHANGELOG.md was last touched by the commit before code-review round 1. After it, 36 commits
      landed, 27 of them in analytics-service/, src/, supabase/ or tests/, including behaviour
      changes: the login-stage-only narrowing, the D-17 -10005 decision, the sign-in job disposition
      moving to permanent, the SFH-H2 'error' fallback, the TRUSTED_OR_NEUTRAL partition, the
      helper reworded from 'Reconnect' to 'Update' and the PILL_STYLES move. The 0.86.0.0 entry
      still says the sign-in exception keeps backing off and retrying, which the shipped
      error_kind = permanent contradicts.
    artifacts:
      - path: "CHANGELOG.md"
        issue: "the 0.86.0.0 entry predates both review fix rounds and describes the superseded transient retry disposition"
    missing:
      - "Regenerate the unified 0.86.0.0 entry, before the push, over every commit on the branch, and cross-check commits against bullets"
human_verification:
  - test: "After merge, confirm the CHECK widening applied on TEST, then on PROD behind the Production reviewer gate: api_keys_sync_status_check admits sign_in_failed. Run the marker query first."
    expected: "apply-test green and the self-verify DO block silent. After PROD apply, a later daily poll of a key with a refused sign-in writes sync_status = sign_in_failed rather than the SFH-H2 fallback 'error'. The 'failed to stamp' ERROR log should stop."
    why_human: "The migration is not applied anywhere yet. No DB command may run from this checkout."
  - test: "Pending the gap-1 decision, check which PROD keys were affected by the two ROADMAP cases (the long-stalled MT5 key and the expired-bybit-key case). What is the profile role of each key's owner?"
    expected: "If either owner is role 'manager', this phase leaves that owner with no surface showing the state, which confirms gap 1 on real data. If both owners are 'both' or 'allocator', the data shows the gap is latent, not live."
    why_human: "Needs a PROD read. The verifier may not run database commands."
  - test: "On the live gateway, find out what login() returns for a wrong investor password: -6, 0 or a login-stage -10005 (RESEARCH assumption A1, still unmeasured)."
    expected: "A code that is_mt5_login_refusal accepts, so the headline MT5 case reaches sign_in_failed and not the transport note."
    why_human: "Needs a live MT5 terminal and a founder-entered credential. Agents may not enter credentials."
  - test: "Render the amber 'Sign-in failed' pill and its 58-char helper at a 320px viewport and at 200% zoom. Also render the KEY_SIGN_IN_FAILED envelope, with its long cause paragraph, in both wizard connect steps."
    expected: "The helper wraps as a caption and does not clip. The envelope does not overflow horizontally. Neither shows a Retry button."
    why_human: "UI-SPEC records S1 long-text as a backstop and S2 overflow as unresolved. Both need eyes on a render."
---

# Phase 167: CREDTRUST Verification Report

**Phase goal:** A customer whose venue credentials stopped working is TOLD, in the product and on the surface where they notice the symptom, that the credential is the reason their factsheet stopped updating, and is nudged to reconnect.
**Verified:** 2026-09-22T21:28:51Z at `3bf2f24b`
**Status:** gaps_found
**Re-verification:** No. This is the initial verification.

## Goal Achievement

The machinery is real, wired and well pinned:
- the D-17 predicate
- the typed sign-in exception carrying its own status and disposition
- the authored helper and amber pill
- the wizard code with no Retry
- the classifier-guarded copy family
- the one untrusted-key predicate

The goal is not met for its primary customer. The state is written for every key, but it renders only on an allocator-only tab. A manager-role owner, whose factsheet is what goes stale, is never shown it, and no surface ties the credential to the factsheet.

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | **[Goal]** On the surface where they notice the symptom, the customer is told the credential is why the factsheet stopped updating | ✗ FAILED (partial) | See gap 1. The only mount of `AllocatorSyncStatus` is `AllocatorExchangeManager`, via `ExchangesTabContent`, on the `/profile` exchanges tab. That tab is `allocatorOnly` in `ProfileTabs`, and `profile/page.tsx` fetches its data only when `role` is `allocator` or `both`; the initial-schema CHECK defaults `role` to `manager`. `ApiKeyManager`, the manager's key card, renders no `sync_status`. No file under `src/app/factsheet*` changed on the branch. RESEARCH Open Question 2 was never resolved. |
| 2 | **[Goal]** Where the state renders, it nudges the owner to update the credential | ✓ VERIFIED | The authored helper `CREDENTIAL_FAILED_HELPER` reads "Update this account's credentials — they may have changed." The same `AllocatorExchangeManager` card hosts the MT5 "Update password" control. The helper pins in `AllocatorSyncStatus.test.tsx` pass. |
| 3 | **[ROADMAP finding 1]** A refused MT5 sign-in in the daily poll is no longer stamped with a transport cause and a retry promise | ✓ VERIFIED | The `except Mt5ClientError` arm in `fetch_allocator_holdings` raises `AllocatorHoldingsSignInFailedError(SIGN_IN_FAILED_NOTE)` when the error is a login-stage refusal or the classifier blames the credential or server. The single `AllocatorHoldingsSyncTransientError` arm in `run_poll_allocator_positions_job` writes `exc.sync_status`. `test_mt5_login_stage_refusal_code_writes_sign_in_failed_end_to_end` (-10005, 0, -6) and `test_sign_in_failure_reaches_its_own_arm_not_the_parents` pass. |
| 4 | **[ROADMAP SF-H2 / 01]** Wizard copy on a login-stage refusal names the credential as one possible reason and makes no retry promise | ✓ VERIFIED | The router's `_validate_mt5_key_probe` tail raises `code="SIGN_IN_FAILED"` with `recoverable=False`. `VENUE_WIRE_CODE_TO_VERDICT` maps that to `KEY_SIGN_IN_FAILED`, whose copy matches UI-SPEC §2. `test_c5_mt5_login_stage_refusal_codes_share_the_sign_in_body` passes, as does the `[167-01 / D-05, D-07]` describe block. |
| 5 | **[01 / D-08]** No Retry renders, and that is derived from the action set | ✓ VERIFIED | `actions: ["request_call","expand_log"]`, neither in `RECOVERABLE_ACTIONS`. The test "the envelope the browser receives is NOT recoverable" asserts `false`, with a non-vacuity control on `KEY_NETWORK_TIMEOUT`. |
| 6 | **[01]** The other `NETWORK_UNAVAILABLE` sites are unchanged | ✓ VERIFIED | `code="NETWORK_UNAVAILABLE"` appears 9 times at the merge base and 9 at HEAD. The non-comment router diff touches only the MT5 client-error tail, and the post-login half keeps the pre-167 raise byte-for-byte. |
| 7 | **[01]** The code can only be reached from a server-emitted wire code | ✓ VERIFIED | The one routing row is in `VENUE_WIRE_CODE_TO_VERDICT`. A test shows the raw detail string classifies `UNKNOWN` without the row. Both rosters, `KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES`, admit the code, as does the rotate-secret dialog roster. |
| 8 | **[ROADMAP finding 3, venue-agnostic]** The second measured venue (an expired bybit key) is now surfaced | ? UNCERTAIN | The exception type and copy are venue-neutral. A ccxt `AuthenticationError` keeps the pre-existing `revoked` path (`_map_exception_to_sync_status`, 3 `revoked` cases pass). That path already existed before 167, so a key that went "unsurfaced" most likely belongs to an owner with no surface, which is gap 1. Confirming it needs the owner's role from PROD (human item 2). |
| 9 | **[02 / D-09, D-10]** No note promises a retry for a failure `classify_exception` calls permanent, across the whole copy family. The rate-limit note keeps its promise. The classifier is consulted, not mirrored. | ✓ VERIFIED | Every MT5, sFOX and ccxt arm calls `_must_reach_handler_unwrapped` first. The `*_arm_follows_the_live_classifier_verdict` oracle cases pass (MT5 ×5, sFOX). The `rate_limited` row still reads "…sync will retry automatically." |
| 10 | **[03 / D-05]** A `sign_in_failed` key renders an amber pill and an AUTHORED helper that ignores `sync_error` and promises no retry | ✓ VERIFIED | `AllocatorSyncStatus` has a `sign_in_failed` case ("Sign-in failed") and a helper branch below `helperOverride`. `PILL_STYLES` holds the opaque warning trio. 162 vitest cases pass across six files. |
| 11 | **[03]** The `error`/`complete_with_warnings` branch is unchanged, and the new value can never fall to the idle pill | ✓ VERIFIED | The shared branch is intact. The `PILL_STYLES` row landed with the migration. `TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES` is pinned to the CHECK by `check-zod-db-check-parity.test.ts`, which passes. |
| 12 | **[03 / D-04]** The public factsheet payload is unchanged, and no cause enters the id-keyed cache | ✓ VERIFIED | `git diff` from the merge base to HEAD over `src/app/factsheet` and `src/app/factsheet-share` is empty. |
| 13 | **[03]** The CHECK constraint admits `sign_in_failed` in TEST and PROD | ? PENDING MERGE | The migration widens the constraint to the prior 8 values plus `sign_in_failed`, with a schema-reading self-verify, and the SQL gate exists. It is not applied anywhere yet. The worker's SFH-H2 fallback keeps a deploy-before-migrate ordering safe (human item 1). |
| 14 | **[04]** Every other failure keeps its status and copy, and a ccxt `AuthenticationError` still writes `revoked` | ✓ VERIFIED | `test_mt5_fault_that_is_not_a_login_refusal_writes_error_not_sign_in_failed` passes for 9 cases: initialize raises, post-login `account_info`, -10000…-10004 and 1. The sibling timeout, fence and mismatch arms still raise `MT5_UNREACHABLE_NOTE`. The `revoked` cases pass. |
| 15 | **[04 / D-16]** The holdings surfaces test ONE untrusted-status predicate, and all 7 former equalities call it | ✓ VERIFIED | `isUntrustedKeySyncStatus` / `untrustedKeyChipLabel` live in `closed-sets.ts`, with 6 call sites in `HoldingsTable` and 1 in `OpenPositionsTable`. No `revoked` equality remains in either file. The surfaces test passes. |
| 16 | **[D-17]** A login-stage -10005 counts as a sign-in refusal. -10000…-10004, 1, `initialize()` failures, transport raises, malformed `last_error` and post-login reads keep the transport answer, and both surfaces share one predicate. | ✓ VERIFIED | `is_mt5_login_refusal` with `_LOGIN_STAGE_NOT_A_REFUSAL_CODES`. The marker is raised only from `login`'s falsy arm via `_raise_last(answered_type=...)`, and the malformed-shape arm resets it to the base class. `test_login_stage_refusal_is_the_only_path_raising_the_marker` and `test_login_failures_with_no_sign_in_answer_are_not_the_marker` pass. |
| 17 | **[D-02 / D-03]** No credential cause is inferred from staleness alone | ✓ VERIFIED | No code reads `ledger_refresh_staleness` or the freshness verdict to produce a credential claim. The claim is scoped to the key and comes only from a recorded sign-in refusal. (The conjunction was never built into a factsheet-level claim; that belongs to gap 1.) |
| 18 | **[05 / D-01]** The ROADMAP `Depends on:` names the phase that actually activated the ledger refresh | ✓ VERIFIED | `### Phase 167` carries the "ATTRIBUTION CORRECTED 2026-09-22" text naming 164.5.1 plan 09 and the cron-manifest evidence. |
| 19 | **[05]** Both full suites are green | ✓ VERIFIED | The orchestrator measured, at this sha, vitest 15131/0, pytest 6109 passed with 90 skipped, and mypy, tsc and lint clean. This run re-ran pytest selections (60, 236 and 3 passed) and vitest files (162 and 338 passed), all green. |
| 20 | **[05]** VERSION and CHANGELOG ship in one release commit, and VERSION equals package.json | ✓ VERIFIED | Commit `9b203548`, `chore(release): v0.86.0.0`. `VERSION` and `package.json` both read `0.86.0.0`. |
| 21 | **[05]** Every commit on the branch maps to a CHANGELOG bullet | ✗ FAILED | See gap 2. 27 source-touching commits landed after the last CHANGELOG edit, and one bullet contradicts shipped behaviour. |
| 22 | **[05 / D-14]** No email or push notifier was added | ✓ VERIFIED | No notifier, cron or email path appears in the phase's diff. |

**Score:** 18/22 truths verified (0 present-but-behaviour-unverified; 2 FAILED; 2 UNCERTAIN or pending merge, both routed to human verification)

### Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/services/mt5_validation.py` `is_mt5_login_refusal` | ✓ VERIFIED | Called by both the router and the holdings arm |
| `analytics-service/services/mt5_client.py` `Mt5LoginRefusedError` | ✓ VERIFIED | Constructed only on `login`'s falsy arm |
| `analytics-service/services/allocator_positions.py` `AllocatorHoldingsSignInFailedError`, `SIGN_IN_FAILED_NOTE`, `SIGN_IN_FAILED_SYNC_STATUS`, copy row | ✓ VERIFIED | Declares its `sync_status` and `error_kind="permanent"` |
| `analytics-service/services/job_worker.py`, single handler arm plus SFH-H2 fallback | ✓ VERIFIED | Audit event records `sync_status_written` |
| `analytics-service/services/exchange.py` `SIGN_IN_FAILED_DETAIL` / `routers/exchange.py` tail | ✓ VERIFIED | |
| `supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql` + SQL gate | ✓ VERIFIED (not applied) | Prior 8 values preserved |
| `src/components/exchanges/AllocatorSyncStatus.tsx` + `allocator-sync-pill-styles.ts` | ⚠️ WIRED, LIMITED REACH | Renders correctly, but its only mount is allocator-only (gap 1) |
| `src/lib/wizardErrors.ts` `KEY_SIGN_IN_FAILED` (union, copy, verdict row, dialog roster) | ✓ VERIFIED | Both `EXPECTED_TABLE_SIZE` pins at 95 |
| `src/lib/closed-sets.ts` untrusted predicate | ✓ VERIFIED | |

### Key Link Verification

| From | To | Status |
|---|---|---|
| `Mt5Client.login` falsy arm → `Mt5LoginRefusedError` → `is_mt5_login_refusal` → `AllocatorHoldingsSignInFailedError` → handler → `api_keys.sync_status='sign_in_failed'` | holdings write | ✓ WIRED (end-to-end test) |
| Router MT5 tail → wire `SIGN_IN_FAILED` → `VENUE_WIRE_CODE_TO_VERDICT` → `KEY_SIGN_IN_FAILED` → `buildEnvelope` (`recoverable:false`) | wizard | ✓ WIRED |
| `api_keys.sync_status` → `getUserApiKeys` → `AllocatorExchangeManager` → `AllocatorSyncStatus` | owner pill | ✓ WIRED for `allocator`/`both` only |
| `api_keys.sync_status` → `ApiKeyManager` (manager key card) | manager surface | ✗ NOT WIRED: selected, never rendered |
| `api_keys.sync_status` → factsheet (owner lane) | symptom surface | ✗ NOT WIRED: out of scope by the plans' decision, with no founder decision recorded |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| `AllocatorSyncStatus` | `syncStatus` | `api_keys.sync_status`, written by `run_poll_allocator_positions_job` (cron jobid 15, every active non-revoked key, no role filter) | yes | ✓ FLOWING, allocator/both only |
| `ApiKeyManager` key card | `sync_status` | same column, same projection | selected, not rendered | ✗ DISCONNECTED for this surface |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Sign-in write path, D-17 code set, copy rows, classifier oracle | worktree pytest `-k` selection over 4 test files | 60 passed | ✓ PASS |
| 164.5.4 classifier / client-contract regression | worktree pytest over the two MT5 contract files | 236 passed, 1 skipped | ✓ PASS |
| ccxt `revoked` unchanged | worktree pytest `-k "revoked or authentication"` | 3 passed | ✓ PASS |
| Owner pill, untrusted surfaces, CHECK parity, wire parity | vitest, 6 files | 162 passed | ✓ PASS |
| Wizard copy table, invariants, dialog roster, Update-password dialog | vitest, 4 files | 338 passed | ✓ PASS |

### Probe Execution

No probe is declared by any plan or summary, and this is not a migration-runner or tooling phase. Step 7c: SKIPPED.

### Requirements Coverage

The phase has no v1.20 requirement IDs. Its plans use the phase-local D-IDs, and D-15b forbids marking any of them in `REQUIREMENTS.md` because they collide with global IDs. D-01…D-17 are covered by the truths above:
- D-03 is honoured only in the sense that no factsheet-level claim is made (row 17).
- D-11 was closed as arm B.
- D-12 is moot, because nothing consumes the staleness view.
- D-13's three-reviewer gate is recorded in `167-03-SUMMARY.md`, with founder approval.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| Phase-modified sources | `TBD`/`FIXME`/`XXX` debt markers | none found | Verdict only; no markers in the phase's changed files |
| `CHANGELOG.md` 0.86.0.0 | Says the sign-in exception "still backs off and retries" | ⚠️ Warning, part of gap 2 | Stale against the shipped `error_kind="permanent"` |
| `HoldingsTable.tsx` toggle label and hidden-count footer | Still say "revoked" for a set that now includes `sign_in_failed` | ℹ️ Info | Named residual in 167-04; not a goal blocker |

### Human Verification Required

1. **Migration applies on merge.** After merge, confirm TEST first, then PROD behind the Production reviewer gate. Then confirm a refused sign-in writes `sign_in_failed` and not the SFH-H2 `error` fallback.
2. **Owner role behind the two ROADMAP cases.** A PROD read of the affected owners' `profiles.role` says whether gap 1 is live or latent.
3. **The real wrong-password code.** On the live gateway (founder-entered credential), confirm `login()` returns a code `is_mt5_login_refusal` accepts (RESEARCH A1).
4. **Visual checks.** The helper at 320px and 200% zoom, and envelope overflow, with no Retry.

### Gaps Summary

**Gap 1 (goal-level).** The phase built a correct signal and a correct owner-facing rendering, but connected them only to the allocator Exchanges tab.
- The measurement that settles it: `enqueue_poll_allocator_positions_for_all_keys` polls every active key, and `run_poll_allocator_positions_job` has no role gate. A manager-role owner's refused MT5 key IS stamped `sign_in_failed`, and that owner has no page that renders it.
  - The manager's key card (`ApiKeyManager`, which already carries "Update password") shows only a "Last synced" date.
  - The factsheet, where the ROADMAP says the customer notices the symptom, is unchanged.
- The plans closed RESEARCH Open Question 1 on purpose and named the strategy→key attribution residual. Open Question 2, which surface counts as "where they notice the symptom", was never closed, and the allocator-only gate on the tab is recorded nowhere in the phase.
- **This looks like it could be an accepted scope limit.** If the founder decides the allocator Exchanges tab satisfies the goal (for example, because every key-holding owner today is role `both`), record it:

```yaml
overrides:
  - must_have: "A customer whose venue credentials stopped working is TOLD, on the surface where they notice the symptom, that the credential is the reason their factsheet stopped updating"
    reason: "<founder reason: e.g. all key-holding owners are role both; manager-only surfacing routed to phase N>"
    accepted_by: "<founder>"
    accepted_at: "<ISO timestamp>"
```

  The deviation policy requires the same decision in `167-CONTEXT.md` and the ROADMAP. Otherwise the smallest closing change is to render the existing pill and helper, or an equivalent, on `ApiKeyManager`'s key card, which already has both the data and the remedy control.

**Gap 2 (release hygiene).** The CHANGELOG entry predates both review fix rounds: 27 source-touching commits, and one bullet contradicts the shipped retry disposition. Regenerate the unified entry over every branch commit before the push.

---

_Verified: 2026-09-22T21:28:51Z_
_Verifier: Claude (gsd-verifier)_
