---
phase: 200-managerkeys
reviewed: 2026-11-11T00:00:00Z
depth: standard
files_reviewed: 63
files_reviewed_list:
  - "git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning' (63 files, branch feat/200-managerkeys)"
findings:
  critical: 1
  warning: 6
  info: 0
  total: 7
status: issues_found
---

# Phase 200: Code Review Report (round 1)

**Reviewed:** 2026-11-11
**Depth:** standard. The key-risk path was traced end to end: every `strategies.api_key_id` and `strategy_keys` writer, plus the link and sync routes.
**Files Reviewed:** 63
**Status:** issues_found
**Scope of the report:** MEDIUM and above only, as the caller asked. LOW and INFO items are left out.

## Summary

The core re-point path holds. `Change key…` → `ConfirmKeyChangeDialog` → `handleSyncTrades` is the only browser writer of `strategies.api_key_id` that is left. `StrategyForm` edit mode no longer writes `name` or `api_key_id`. The factsheet and list `Rename…` controls are gone. No encryption restatement is left in any `.tsx` outside `/security`. Wizard writers (`create-with-key`, `composite/*`, `MultiKeyConnectStep`) only touch new or draft strategies, so D-03/D-08 put them out of scope.

**What is still open on the key risk:** two existing-strategy writers can re-point a strategy's key with no confirm:
- Resync on a stale page.
- A confirmed change whose "current key" is stale.

Both pass the attempt's read-back guard. The confirm itself is sound.

**Executor items, rated:**
- The 9 skips: MEDIUM (WR-03).
- The "Use & Sync" remedy copy: MEDIUM, user-facing (WR-01).
- The e2e `Use & Sync` spec: MEDIUM, test reliability (WR-04).
- The `ExchangesTabContent` intro: MEDIUM, user-facing (WR-02).
- The orphaned `addKeyBlockedReason`, `DELETE_MEMBERSHIP_UNCHECKED_COPY` and `deleteCompositeWarning` (the last is still imported by the memberships route): dead code, LOW, not reported. `ApiKeyForm` is still referenced (`ValidateWaitCard`, `UpdateMt5SecretDialog` and others), so it is not orphaned.

**Manager-role Delete in AllocatorExchangeManager:**
- Role-gated (`canHardDeleteKey`, `managerOnly`).
- Errors are handled with authored copy.
- The no-holdings arm sends `p_cascade_holdings:false`.
- The holdings arm can send `true` (WR-06).

## Critical Issues

### CR-01: Resync, and a confirmed change on a stale page, re-point the strategy's key with no confirm (HIGH, data-integrity)

**File:** `src/components/strategy/ApiKeyManager.tsx:874-877` (unconditional write), `:1086` (every attempt links first), `:1527-1533` (Resync), `:1640` (confirm's current label), `:1619` (panel Retry)

**Issue:**
- `handleSyncTrades(keyId)` always calls `handleLinkKey(keyId)`, which runs `update({ api_key_id: keyId }).eq("id", strategyId)` with no condition on the row's current value.
- Resync passes `key.id === currentKeyId`, and `currentKeyId` is the server-rendered prop.

**How it breaks:**
1. The edit page is opened at key K1.
2. The key is changed to K2 elsewhere: another tab, another device, or the wizard.
3. Resync is pressed on the first page. It writes `api_key_id = K1`, which silently re-points the strategy back with no dialog.

`readLinkedKeyId` cannot catch this, because it reads back the value this same attempt just wrote.

The same gap exists for a confirmed `Change key…`. The dialog says "will read trades from K3 instead of K1", but the real current key may be K2. The write still lands, so the manager confirmed a sentence that was false.

The phase goal says "nothing re-points a strategy's key without an explicit confirmation". A wrong key changes every number on the factsheet.

**Fix (minimal):**
```ts
// handleLinkKey
if (keyId === currentKeyId) return; // Resync: no write; the read-back below refuses a mismatch
let q = supabase.from("strategies").update({ api_key_id: keyId }).eq("id", strategyId);
q = currentKeyId === null ? q.is("api_key_id", null) : q.eq("api_key_id", currentKeyId);
const { data, error: linkError } = await q.select("id");
if (linkError) throw new Error(`Failed to link key to strategy: ${linkError.message}`);
if (data?.length !== 1) throw new Error("This strategy's key changed since the page loaded. Reload the page and try again.");
```
With the Resync early return, `readLinkedKeyId` then refuses a stale Resync as `link_unverified` and writes nothing.

## Warnings

### WR-01: Owner remedy copy sends managers to "Use & Sync", a control that no longer exists (MEDIUM, user-facing)

**File:** `src/lib/status-surface-copy.ts:399` (`KCS21-UNLINKED`), `src/lib/degrade-warnings.ts:218` (`A-LINK-KEY-EDIT`)

**Issue:** An unlinked strategy's remedy says "Link a key with Use & Sync on this strategy's edit page". The edit page now offers `Change key…`, and only when the account holds another key (`showChangeKey`, `ApiKeyManager.tsx:851`). With no keys it offers only the Profile link. The remedy names a button the manager cannot find.

**Fix:** Reword both sentences, for example: "Link a key with Change key… on this strategy's edit page (add one on your Profile API keys tab first if you have none) to start a new computation." Then update the pinned copy tests.

### WR-02: The API keys tab tells a manager their positions build an Active Allocation portfolio (MEDIUM, user-facing)

**File:** `src/components/exchanges/ExchangesTabContent.tsx:30-35`

**Issue:** D-06 opened the tab to every role. The intro paragraph is still allocator-only copy: "sync your real positions and build your Active Allocation portfolio … invest and divest events are detected".

For a manager none of that happens, because `AllocatorExchangeManager` keeps every holdings call out for `!isAllocatorRole`. The component already gates its own subtitle and "how it works" list by role (`AllocatorExchangeManager.tsx:1676`, `:1981`). The intro was missed.

**Fix:** Gate the paragraph on `role === "allocator" || role === "both"`. Give a manager a neutral sentence, for example: "Read-only exchange API keys your strategies read trades from."

### WR-03: The 200-08-DEFERRED skips leave the first-link confirm and the post-re-point feeds refresh untested (MEDIUM, data-integrity coverage)

**File:** `src/components/strategy/ApiKeyManager.test.tsx:1831, 2608, 2667, 2981, 3386, 3400, 3595`

**Issue:** Nine cases are `it.skip`, all with the reason "needs a non-current-key card or a removed control". That reason is false for at least two of them:
- **`FIRST-LINK` (:3595):** with `currentKeyId: null`, `changeKeyCandidates` is every key (`:848-850`), so the header picker drives it. This is the only test of D-04's "no key is linked yet" wording.
- **`SHAPE-UNKNOWN-NOTE` (:2981):** the note renders for `keyShape="unknown"` (`:1419-1423`) with no per-card control.

`REFRESH-AFTER-RE-POINT` (:3386) and `STALE-ANSWER-DROPPED` (:3400) also look drivable through the picker. The terminal-arm cases (:1831, :2608, :2667) can go through Resync on the current key.

The skips remove coverage from exactly the re-point and feeds-honesty paths this phase exists to protect.

**Fix:** Re-drive each case through `Change key…` → option → `Change key` (or Resync for the terminal-arm cases) and remove the skips. Any case that truly has no driver left should be deleted with a reason, not skipped.

### WR-04: The e2e spec still asserts the removed `Use & Sync` button (MEDIUM, test reliability)

**File:** `e2e/sync-analytics-flow.spec.ts:125-131` (also review `e2e/api-key-flow.spec.ts:252`)

**Issue:** "Use & Sync button is visible for unlinked keys" expects `getByRole("button", { name: /Use & Sync/i })` on the edit page. That button is gone, and the edit page now lists only the strategy's own key, so the test fails whenever the lane runs it.

`api-key-flow.spec.ts:252` matches `/Resync|Use & Sync/`. It passes only if the target key is the current one, so check its fixture.

**Fix:** Replace the test with one that asserts `Change key…` opens the picker and that a pick opens the confirm dialog without a write.

### WR-05: The rename dialog's hint states the OLD name as what the factsheet shows, while the manager types the new one (MEDIUM, user-facing)

**File:** `src/components/strategy/StrategyNameBlock.tsx:47-49, 96-101`; `src/components/strategy/RenameStrategyDialog.tsx:222`

**Issue:** `publicNote={factsheetLine}` passes "A shared factsheet link shows <current name>." That sentence is rendered as the hint under the input where the new name is typed. The prop's own doc says it is "what the public sees under the new name".

After saving, the factsheet title is the new name, so the hint misstates the result of the very action it sits beside. D-11 requires the rename place to say what the public sees.

**Fix:** Pass a sentence that does not interpolate the current name. For example: "The name you save becomes the factsheet title; discovery shows <preview.discovery> to other viewers." Or render the typed value live.

### WR-06: The manager-only Delete can send `p_cascade_holdings: true`, which also deletes derived allocator history (MEDIUM, data-integrity)

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:1096-1101, 2030-2032, 2165-2180`

**Issue:** The brief's contract is that the manager-role Delete uses `p_cascade_holdings:false`. It does when `deleteHoldingsCount === 0`. When a manager-only user's key has holdings (left from an earlier allocator or `both` role), `managerNeedsCascade` keeps `Delete key` disabled until the cascade box is ticked. `handleDeleteKey` then sends `p_cascade_holdings: true`.

In `delete_allocator_api_key` (migration `20261104120000`, Step 4), that flag also runs the last-key cascade over `allocator_equity_derived`. The box's copy names only "N historical holdings", so a manager would erase allocator book history the role cannot see.

**Fix:** For `managerOnly`, do not render the cascade box. When holdings exist, show a sentence that the key holds allocator data and must be removed under an allocator role. Or, if the founder decides managers may cascade, name the derived-history loss in the box copy. This needs a decision and must not be left implicit.

---

_Reviewed: 2026-11-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (round 1, MEDIUM+)

Full text: scratchpad p200-sfh-r1.md (session-local). Summary:

- **SFH-1 (MEDIUM, user-facing + data-integrity):** AllocatorExchangeManager.tsx ~1076-1080: a failed holdings-count read becomes 0 ("no holdings") and enables a manager's `Delete key`, and the read has no seq guard (a late answer for key A can land on key B).
- **SFH-2 (MEDIUM, user-facing + data-integrity):** AllocatorExchangeManager.tsx ~2160-2190: when feeds are "unchecked", the dialog only warns, so Delete and Disconnect stay enabled while it says it could not check what the key feeds.
- **SFH-3 (MEDIUM, user-facing):** AllocatorExchangeManager.tsx ~516-527 and ApiKeyManager.tsx ~373-380: a failed or 429 feeds read has no retry and stays until reload.
- **SFH-4 (MEDIUM, tests):** ApiKeyManager.test.tsx: STALE-ANSWER-DROPPED cannot fail, and the 9 `200-08-DEFERRED` skips remove coverage (overlaps WR-03).

## Round 1 dispositions (fixer round, topic-split A/B/C, merged --no-ff)

| ID | Disposition | Commit | Proof (neuter → RED) |
|---|---|---|---|
| CR-01 | FIXED | 146d8a737 | Resync writes no `api_key_id`; the confirmed write is conditional on the named current key (`.eq`/`.is(null)`), and zero rows gives a loud "changed since the page loaded" error with no sync. CR01-* tests go RED without either half |
| WR-01 | FIXED | 7a76a966d | remedy copy names `Change key…`; RED "Received Link a key with Use & Sync" |
| WR-02 | FIXED | a3fc46eab | managers get a role-correct intro; MANAGER-INTRO goes RED on the old text |
| WR-03 / SFH-4 | FIXED | cb0157cf0 | all 9 skips re-driven, 0 `it.skip` left; STALE-ANSWER-DROPPED goes RED with the seq guard neutered |
| WR-04 | FIXED (not run) | 093f04ee4 | e2e specs assert `Change key…` + confirm. Playwright was not run (disk rule); the specs are env-gated |
| WR-05 | FIXED | dd9ae8117 | hint no longer quotes the old name; RED on the new-hint assertion |
| WR-06 | FIXED (design default) | c6fa0e33e | manager Delete always sends cascade false; a 23503 refusal is surfaced; the `both` cascade copy names the derived history deletion; RED on the `allocator-cascade-derived-history` testid |
| SFH-1 | FIXED | 96fb7fc62 | a failed holdings read is unknown (Delete disabled) and seq-guarded; RED on the HOLDINGS-UNKNOWN / STALE tests |
| SFH-2 | FIXED (design default) | 2c14609be | Delete and Disconnect are held while feeds are "unchecked"; 4 tests RED |
| SFH-3 | FIXED | d60958e3b, 9d67bcb1f | Retry on a failed feeds/holdings read in both managers; RED with the handler neutered |

Gates after the merge: tsc 0; vitest over the 39 phase-touched test files is 1281 passed, 0 skipped; eslint 0.

## Round 2 findings

**Reviewed:** 2026-11-11, at HEAD `0d966376f` (branch `feat/200-managerkeys`). Read-only; no source file changed.
**Scope:** the 11 round-1 fix commits, the key risk re-checked across `git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning'`, and new problems the fixes may have caused. MEDIUM and above only.
**Gates re-run:** vitest over the six fix-touched files (`ApiKeyManager`, `ApiKeyManager.poll`, `AllocatorExchangeManager`, `AllocatorExchangeManager.feeds`, `ExchangesTabContent`, `StrategyNameBlock`) gave 324 passed, 0 skipped. Nothing was neutered, because the review is read-only. "Its test can fail" was argued from the code instead.

### Verdicts on the round-1 fixes

| ID | Verdict | Notes |
|---|---|---|
| CR-01 (146d8a737) | **Partly fixed**, see R2-01 | The 0-row guard is sound. `.select("id")` plus `linkedRows?.length !== 1` throws on an RLS-filtered row, on a stale condition, and on `data: null`, so a 0-row update can never report success. The mock models the server row, so the CR01-* tests can fail. Gap: the panel Retry. |
| WR-01 (7a76a966d) | Fixed | Both sentences name `Change key…` and the `API keys` tab, which is the label `ProfileTabs` uses. |
| WR-02 (a3fc46eab) | Fixed | |
| WR-03 / SFH-4 (cb0157cf0) | Fixed | 0 `it.skip` left. DROPPED-READ-SUBJECT and IN-FLIGHT-UNTOUCHED now assert the pill, not the button. Each still separates the two outcomes: a released marker shows `sign_in_failed`, a held one shows `syncing`, and an applied healthy row renders no pill at all. |
| WR-04 (093f04ee4) | **Incomplete**, see R2-02 | |
| WR-05 (dd9ae8117) | Fixed | |
| WR-06 (c6fa0e33e) | Fixed | Measured: `allocator_holdings_api_key_id_fkey` is `ON DELETE RESTRICT` (baseline), and the RPC's Step 2 and Step 4 run only on `p_cascade_holdings`. So a manager's delete with `false` on a key that has holdings raises 23503 and rolls back. Not reported: on a manager key that has holdings, `Delete key` stays enabled beside "cannot be deleted". That state needs a pre-role-lock account, since `prevent_profile_role_change` blocks a role switch, and the database refuses the delete. |
| SFH-1 (96fb7fc62) | Fixed | Seq-guarded: Cancel and a reopen bump `holdingsSeqRef`. |
| SFH-2 (2c14609be) | Fixed as written; **decision conflict**, see R2-03 | |
| SFH-3 (d60958e3b, 9d67bcb1f) | Fixed | No loop or race. A Retry sets the read to `loading`/`checking`, so the button unmounts until the answer lands, and every answer is seq-guarded. A rate-limited Retry stays could-not-check only until the 60 s window passes. Not locked forever. |

### R2-01: The panel's Retry re-points the strategy's key with no confirm once the page has refreshed (HIGH, data-integrity)

**File:** `src/components/strategy/ApiKeyManager.tsx:1644` (Retry target), `:893-897` (the condition reads the live `currentKeyId` prop), `src/components/strategy/RenameStrategyDialog.tsx:211` (`router.refresh()` on the same page)

**Issue:** `SyncProgress` renders Retry on every `error` (`SyncProgress.tsx:658-667`). Retry calls `handleSyncTrades(lastAttemptedKeyId)`. `handleLinkKey` then decides whether to write, and what to condition the write on, from the `currentKeyId` prop at click time. It does not use the key the attempt was started or confirmed against. The prop changes on any `router.refresh()` while the component stays mounted. `RenameStrategyDialog` refreshes on every successful rename, and so do `handleSyncTrades` itself and the terminal arm. The panel's `syncStatus`, `lastAttemptedKeyId` and Retry survive that refresh.

**How it breaks (Resync, no dialog at any point):**
1. On tab A, Resync on K1 runs and its computation fails. The error panel shows Retry, and `lastAttemptedKeyId` is K1.
2. On tab B, or in the wizard, the key is changed to K3 with the confirm.
3. On tab A, the manager renames the strategy. `router.refresh()` changes the prop to `currentKeyId = K3`, and the card now lists K3.
4. On tab A, the manager presses Retry. `handleLinkKey(K1)` sees `K1 !== K3` and writes `api_key_id = K1` with `.eq("api_key_id", K3)`. That condition matches, so the strategy is silently re-pointed back to K1.

The read-back cannot catch this, because it reads back K1, which this attempt just wrote. The same happens after a confirmed change that failed on the 0-row guard (CR01-CONFIRM-ON-STALE-PAGE): after a refresh, Retry writes K2 over K3, a key no dialog named. No test drives Retry after a refresh.

**Fix (minimal):** carry the expected current key with the attempt, and condition the write on it, never on the live prop:
```ts
// handleSyncTrades(keyId, expectedCurrent): Resync passes (key.id, key.id); the dialog's onConfirm
// passes (pendingKeyId, currentKeyId captured when the dialog opened). Store the pair with
// lastAttemptedKeyId; Retry replays the same pair.
// handleLinkKey(keyId, expectedCurrent):
if (keyId === expectedCurrent) return;           // a Resync, or a Retry of one, never writes
const q = supabase.from("strategies").update({ api_key_id: keyId }).eq("id", strategyId);
const { data, error } = await (expectedCurrent === null ? q.is("api_key_id", null) : q.eq("api_key_id", expectedCurrent)).select("id");
```
Add a test: Resync fails, a rerender with another `currentKeyId` follows, then Retry. It must assert `strategiesUpdateMock` was not called and the mocked row is unchanged.

### R2-02: WR-04 is only partly fixed: `e2e/api-key-flow.spec.ts` still drives the removed edit-page controls (MEDIUM, test reliability)

**File:** `e2e/api-key-flow.spec.ts:119-209`, `:230-254`, `:257-268`, `:272-290`

**Issue:** D-07 removed `Add Key`, `Delete`, the `Delete API Key` modal and the "No API keys connected" empty state from `/strategies/[id]/edit`. The edit page now says `No key is linked to this strategy yet.` and similar. The fix changed one line (`:252`). That line sits in a test whose first action is `getByRole("button", { name: /Add Key/i }).click()` (`:233`), so the changed line can never be reached. Every test in "Edit page — API key form rendering" and "Key submission and connected keys list" fails as soon as its env gate (`PLAYWRIGHT_TEST_STRATEGY_ID`, or the exchange credentials) is set.

**Fix:** delete these edit-page tests, or move them to the Profile API keys tab (`/profile?tab=exchanges`), where add and delete now live. Keep only an edit-page test that asserts the panel heading and the "Add or remove keys" Profile link.

### R2-03: SFH-2 now blocks a reversible Disconnect on a warning-only read, and reverses a recorded "warn, never block" with no CONTEXT/ROADMAP record (MEDIUM, user-facing)

**File:** `src/components/exchanges/AllocatorExchangeManager.tsx:2073-2074` (`feedsUnknownOrOpen` gates both buttons), `:1094` (comment still says "a failure warns, never blocks")

**Issue:**
- 200-07 shipped the could-not-check state as "warn, never block", citing 167.2.1 D-10, the founder's 2026-09-24 decision. The fixer reversed it as a "design default (founder cannot be asked)". The reversal is recorded only in this file's disposition table. Neither 200-CONTEXT.md nor the ROADMAP records it, which the deviation policy requires.
- The block now also holds an allocator's **Disconnect**. That action keeps the key and its holdings and offers Reconnect, so it is reversible, and the feeds read exists only to warn about it.
- The memberships route allows 5 reads per 60 s per user (`userActionLimiter`). Each confirm open and each Retry spends one. A few opens in a minute therefore leave both buttons disabled until the window passes, with only Cancel available. A persistent route failure (5xx, 404 on a key deleted elsewhere) holds them until a reload.

**Fix:** pick one and record it in 200-CONTEXT.md **and** the ROADMAP.
- Recommended: hold only the irreversible `Delete key` (and the cascade) on "unchecked", and restore warn-only for Disconnect.
- Alternatively, keep both held and record the reversal as a founder-revisitable default.

Either way, fix the stale comment at `:1094`.

### Key-risk re-check, whole diff

Measured:
- The browser writers of `strategies.api_key_id` left in the diff are `handleLinkKey` alone. `StrategyForm`'s `.update({ api_key_id })` was removed.
- `AllocatorExchangeManager`, the feeds and memberships routes, and the wizard preselect read only.
- Every path to `handleLinkKey` except the panel Retry passes the confirm: `Change key…` → option → `ConfirmKeyChangeDialog` → `onConfirm`. Resync writes nothing.

R2-01 is the one remaining path.

_Reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard, with the call chains into `SyncProgress`, `RenameStrategyDialog`, the RPC and the baseline FKs traced_

### Silent-failure hunter, round 2 (MEDIUM+)

- **SFH2-1 (MEDIUM, user-facing + data-integrity):** AllocatorExchangeManager.tsx ~1101-1118, 2123-2160: the delete-confirm Retry re-runs the holdings read without resetting `deleteHoldingsCount`, so a failed re-read leaves the stale count driving the UI (no could-not-check line; buttons enabled on stale data).
- **SFH2-2 (MEDIUM, user-facing):** AllocatorExchangeManager.tsx ~1141-1147: only the manager path maps 23503, so an owner's cascade=false Delete refused by 23503 shows a generic "Please try again" that can never succeed.

## Round 2 dispositions (fixer round, topic-split A/B, merged --no-ff)

| ID | Disposition | Commit | Proof (neuter → RED) |
|---|---|---|---|
| R2-01 | FIXED | 718a3aedf | the write is conditional on the attempt's stored expected key, never the live prop. A Resync replay writes nothing, and a landed change retries as a Resync. R2-01-RESYNC-RETRY-AFTER-REFRESH and R2-01-CONFIRMED-RETRY-AFTER-REFRESH go RED without the fix |
| R2-02 | FIXED (not run) | 418990e6f | api-key-flow.spec.ts matches the one-key panel, and the add/delete steps point at the AEM parity cases. Playwright not run (disk rule) |
| R2-03 | FIXED (design default, CONTEXT D-R1) | 257b0b99f | Disconnect warns only on an unchecked read; Delete key stays held. DISCONNECT-WARNS-ONLY and DELETE-HELD-ON-UNCHECKED go RED |
| SFH2-1 | FIXED | 3f4e1cd3d | Retry resets the holdings count to unknown before re-reading. HOLDINGS-RETRY-FAILS goes RED |
| SFH2-2 | FIXED | f03d8d15f | a 23503 refusal is mapped on every role's Delete path. The role-both test goes RED on the generic text |

Gates after the merge: tsc 0; vitest over the 39 phase-touched test files is 1288 passed, 0 skipped; eslint 0.

## Round 3 findings

**Reviewed:** 2026-11-11, at HEAD `486e9266c` (branch `feat/200-managerkeys`). This was a read-only review and no source file changed.
**Scope:**
- The five round-2 fix commits: `718a3aedf`, `418990e6f`, `257b0b99f`, `3f4e1cd3d` and `f03d8d15f`.
- The key-risk check over `git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning'`.

Only MEDIUM and above is reported.
**Gates re-run:** vitest over `ApiKeyManager.test.tsx`, `AllocatorExchangeManager.test.tsx` and `AllocatorExchangeManager.feeds.test.tsx` gave 284 passed, 0 skipped. Because the review is read-only, nothing was neutered. "Its test can fail" was argued from the code and the mocks.

### Verdicts on the round-2 fixes

| ID | Verdict | Notes |
|---|---|---|
| R2-01 (718a3aedf) | Fixed | **Write condition.** `handleLinkKey` now conditions on the attempt's `expectedCurrent`, never on the live prop. It has three callers, and each passes a pair the manager saw: Resync passes `(key.id, key.id)`, the confirm passes `(pendingKeyId, currentKeyId)` from the render that drew its label, and Retry passes the stored ref.<br>**When the ref moves.** It moves to `keyId` only inside the live attempt, after the link landed.<br>**Bound expiry.** On an expired link bound, Retry replays the original condition. A late landing then gives zero rows and a loud error, and nothing is written.<br>**Tests.** The mock models the server row, so RESYNC-RETRY-AFTER-REFRESH and CONFIRMED-RETRY-AFTER-REFRESH go RED on the round-1 code. LANDED-CHANGE-RETRIES-AS-RESYNC passes on the old code too. It pins only the post-link ref update, and it goes RED without that update. |
| R2-02 (418990e6f) | Fixed (not run) | The edit-page tests assert the panel heading, the Profile link `href`, and that `Add Key`, `Delete` and the empty state are absent. No removed control is driven. |
| R2-03 (257b0b99f) | **Regression**, see R3-01 | The count-0 `Delete key` is held as D-R1 says. Disconnect is now released, and that also releases the cascade, which is irreversible. |
| SFH2-1 (3f4e1cd3d) | Fixed | Retry sets the count to `null` before the re-read, and both buttons are disabled on `null`. **Can the test fail?** Yes. On the old code the count stays 0, so the `allocator-delete-holdings-unchecked` line never renders and the test goes RED. |
| SFH2-2 (f03d8d15f) | Fixed | Measured: `allocator_holdings_api_key_id_fkey` is the only `ON DELETE RESTRICT` FK on `api_keys` (baseline), so a 23503 always means holdings. The owner re-read brings back the box the message names. **Can the test fail?** Yes. On the old code the alert carries the generic text and the test goes RED. |

### R3-01: With the cascade box ticked, Disconnect runs the irreversible cascade delete while the feeds read is unchecked (MEDIUM, data-integrity)

**File:**
- `src/components/exchanges/AllocatorExchangeManager.tsx:2256`: the Disconnect `disabled` checks only `feedsOpen`.
- `:1143`: `cascadeHoldings || hardDelete` sends the delete RPC.
- `:2183`: the cascade box.

**Issue:**
- `257b0b99f` released `Disconnect` on `deleteFeeds.state === "unchecked"`, on the premise that Disconnect is reversible. That premise holds only while the cascade box is unticked.
- For role `allocator` or `both`, on a key with holdings > 0, ticking the box sets `cascadeHoldings`. `Disconnect` then calls `handleDeleteKey(id, false)`, which takes the `cascadeHoldings || hardDelete` branch and sends `delete_allocator_api_key` with `p_cascade_holdings: true`.
- That call hard-deletes the `api_keys` row, its holdings, its `csv_daily_returns` and its `strategy_keys` memberships. On the last key it also deletes `allocator_equity_derived`.
- So the most destructive action on the tab now runs when the dialog has just said "Could not check which strategies this key feeds."

**What the rules say:**
- D-R1 holds `Delete key` on an unchecked read "because a delete is irreversible".
- R2-03's recommended fix said to hold `Delete key` "(and the cascade)".
- The comment at `:2085-2087` says "a key is never deleted without knowing what it feeds".

**Why the tests miss it:** DELETE-HELD-ON-UNCHECKED drives only the count-0 `Delete key` button. DISCONNECT-WARNS-ONLY drives only the unticked soft disconnect. No test ticks the box on an unchecked read.

**Fix (minimal):** hold the button whenever it would cascade on an unchecked read, and pin that with a test. The test should cover role `allocator`, holdings 2, a memberships 500, the box ticked, then assert the button is disabled and that `delete_allocator_api_key` was not called.
```tsx
disabled={
  deleteLoading ||
  deleteHoldingsCount === null ||
  feedsOpen ||
  (cascadeHoldings && deleteFeeds?.state === "unchecked")
}
```

### Key-risk check, whole diff

**Re-pointing a strategy's key:** clean.
- `handleLinkKey` (`ApiKeyManager.tsx:906`) is the only browser writer of `strategies.api_key_id` in the diff.
- Resync and its Retry write nothing.
- The confirmed change, and a Retry of it, write only on the key the dialog named as current. Zero matched rows gives a loud error.
- The wizard steps, the feeds and memberships routes, and `AllocatorExchangeManager` only read.

**A Retry or replay writing against an expectation the manager did not see:** clean after R2-01, for the reasons in the table above.

**A manager's Delete cascading:** clean.
- The cascade box is not rendered for `managerOnly`, and `setCascadeHoldings` is set to true only from that box (`:2183`).
- So a manager's `Delete key` always sends `p_cascade_holdings: false`. A key with holdings is refused by the RESTRICT FK and gets the manager message.
- `AllocatorExchangeManager.tsx:1145` is the only caller of `delete_allocator_api_key` in `src`.

_Reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

### Silent-failure hunter, round 3

- **R3-1 (MEDIUM, data-integrity):** the same defect as R3-01 (Disconnect with the cascade box ticked on an unchecked read). Duplicate; disposition follows R3-01.

## Round 3 dispositions (the review cap of 3 is reached)

| ID | Disposition | Commit | Proof |
|---|---|---|---|
| R3-01 / R3-1 | FIXED | 1fb1bc033 | Disconnect is held when the cascade box is ticked on an unchecked feeds read (D-R1); unticked it keeps R2-03's warn-only behaviour. The orchestrator re-neutered the clause to `false`: R3-01 CASCADE-DISCONNECT-HELD-ON-UNCHECKED went RED ("Received element is not disabled", 1 failed / 26 passed); restored by `cp`, `cmp` OK |

Both R3 reviewers converged on this one minimal, agreed fix, which an R2 fix had introduced. It was applied after round 3 and verified by the orchestrator's own neuter→RED→restore plus the gates below. No fourth review round was run, because 3 is the cap. All three key-risk checks were clean in R3 (no re-point without confirm, no replay against an unseen expectation, no manager cascade).
Open MEDIUM+ survivors: none.
