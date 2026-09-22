---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
plan: 06
round: gap-closure 167-06
reviewed: 2026-09-22T23:30:01Z
reviewed_at_sha: 123174c4
diff_base: d565e864
diff_head: de41a200
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
findings:
  critical: 1
  warning: 1
  info: 2
  total: 4
status: issues_found
---

# Phase 167: Code Review Report, plan 167-06 (gap closure)

**Reviewed:** 2026-09-22T23:30:01Z
**Depth:** standard, with the React state flow traced through `SyncProgress`, `useStrategySyncPoller`, `UpdateMt5SecretDialog`, `Modal` and `AllocatorSyncStatus`
**Files Reviewed:** 2 (`git diff d565e864..de41a200 -- ':!.planning'`)
**Status:** issues_found

## Summary

This review covers plan 167-06 only. It checked R1 to R6 against the actual order of state updates in `ApiKeyManager`:
- `handleSyncTrades`, `handleSyncStatusChange`, `handleAddKey` and its background `.catch`, `handleDeleteKey` and the dialog's `onUpdated`;
- the shared `retireWithheldSuccess` helper and its functional updater;
- the derived values `panelSubjectUntrusted` and `withholdPanelSuccess`;
- the two key-scoped `disabled` props.

**What holds (verdicts only):**
- **D-04:** clean. The diff touches 0 paths under factsheet, factsheet-share or lib/factsheet. The only page that mounts `ApiKeyManager` is the owner-gated strategy edit page.
- **Reuse:** `AllocatorSyncStatus` is mounted unchanged. The diff adds 0 user-facing strings and 0 colour tokens. The only additions are the `mt-2` spacing class and the card's `data-testid` hook.
- **Live regions:** each untrusted card has exactly one. The wrapper carries no role and no `aria-*`, and the helper keeps the component's `role="status"`.
- **Census and effects:** exact-match comparisons against the complete status stay at 1 before and 1 after, so the `complete-status-scan` census is unaffected. `useEffect` also stays at 2 before and 2 after.
- **R2:** it withholds only a terminal success. The panel stays mounted while syncing or computing, so its poll still reaches `handleSyncStatusChange`.
- **R3 and R5:** the updater is functional and leaves `syncing`, `computing` and `error` unchanged. On `Delete`, the guard is read before the row is filtered out.
- **Tests and lint:** the test file passed 57/57 here, and `eslint` is clean on both files.

**One BLOCKER.** In one reachable ordering, R6's new marker clear breaks the exact guarantees R1, R4 and R5 exist to provide. A temporary probe test confirmed it and was then deleted, leaving the tree clean. The docblock and D-18 describe R6 as safe. In that ordering, that description is wrong.

## Critical Issues

### CR-01: R6 clears the in-flight marker of an attempt that the post-add error did not stop, which re-opens the R1, R4 and R5 windows for that attempt

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleAddKey`'s background `.catch` (the added `setSyncingKeyId(null)`), together with `handleSyncTrades`

**Issue:** R6 clears `syncingKeyId` whenever the post-add background sync fails. The docblock justifies this with two claims:
- the post-add error "stops that attempt's poll";
- "once the marker is clear, the abandoned attempt cannot show a success, because nothing polls it any more."

Both claims hold only if the tracked attempt is already in `computing`. They fail when the post-add failure lands while a tracked `handleSyncTrades` attempt is still in its REQUEST phase, awaiting `handleLinkKey` or its own `/api/keys/sync`:
1. The user submits Add Key. The form closes as soon as the post-add sync is fired, and that sync stays pending.
2. The user clicks `Resync` (or `Use & Sync`) on key J. This is allowed because the post-add sync never takes the slot. `syncingKeyId` becomes J and the status becomes `syncing`.
3. The post-add sync fails. The catch sets `error` and, since R6, sets `syncingKeyId` to null.
4. J's request resolves. `handleSyncTrades` moves the status to `computing`, and the panel's poll restarts. Nothing sets the marker again.

For the rest of J's own attempt, the marker is null. The probe measured 1 run and 5 of 5 assertions confirming the defect:
- J's `Update password` is enabled. This is R4's window: a rotation now sets J to `idle`, so R2 stops withholding, and the attempt's later success, made under the REPLACED password, is shown as "Up to date".
- J's `Delete` is enabled. This is R5's window.
- J's card pill reads `sign_in_failed` under the panel's spinner, where R1 requires `syncing`. That is a credential claim under a spinner.
- J's own button reads `Resync` and is enabled. So is every other `Resync` and `Use & Sync` button, which lets a second sync overwrite the one slot mid-poll. This is the invariant `!!syncingKeyId` exists to protect.

**This is a regression from R6.** Without R6, the marker stayed J through this ordering, and `handleSyncStatusChange`'s terminal arm cleared it normally. The `R6` test case covers only the other ordering, where the post-add failure lands while J is in `computing`, so nothing pins this one.

This ordering is also not the residual routed to 167.2. D-18 and the ROADMAP's 167.2 entry describe the post-add race only as a subject problem ("R6 closes the dead-lock half"). They do not record that R6's clear can itself strand an attempt that is still live.

**Fix:** Take either route. Both keep R6's dead-lock fix.
- **(a) Root cause:** pull the relevant part of 167.2 forward, and route the post-add sync through the tracked slot, so that only its owner clears the marker.
- **(b) Interim guard:** the background catch clears the marker only when no tracked attempt is in its request phase. For example, keep a ref of the attempt that is still awaiting its request:
  ```ts
  const requestPendingKeyRef = useRef<string | null>(null);
  // handleSyncTrades: set it to keyId before the awaits; set it back to null
  // right after setSyncStatus("computing") and in the catch.
  // background .catch:
  if (requestPendingKeyRef.current === null) {
    setSyncStatus("error");
    setSyncingKeyId(null);
    setSyncError(...);
  } // otherwise the live attempt owns the slot; log only (the failure is already lost today, when "computing" overwrites it)
  ```
  A ref is used rather than a functional updater because the decision spans two setters, and an updater must not have side effects.

With either route:
- add a regression case using deferred `/api/keys/sync` responses: post-add pending, then `Resync` J, then the post-add fails, then J's request resolves. Assert that J's `Update password` and `Delete` are disabled and that J's pill reads `syncing`;
- correct the R6 sentence in the docblock, in D-18 and in the 167-06 SUMMARY.

## Warnings

### WR-01: The healthy-control case names "no added live region" but asserts only two test ids, so that half cannot fail

**File:** `src/components/strategy/ApiKeyManager.test.tsx`, the `HEALTHY CONTROL: sync_status %s renders no pill, no helper and no added live region` case (inside `[167-06] the persisted credential state renders on the manager's key card`)

**Issue:** The case counts only the `allocator-sync-pill` and `allocator-sync-helper` nodes. If a later change put a `role="status"` or `aria-live` wrapper on every card, healthy ones included, this case would stay green.

The live-region count case (`adds EXACTLY ONE live region per untrusted card`) would stay green too, because it measures its baseline from a healthy render, and that baseline would absorb the extra region. So the "healthy card adds no live region" truth in the plan's must-haves is not pinned anywhere. This is an a11y claim on a surface users see, and the case name asserts something the case does not test.

**Fix:** In the healthy-control case, also assert that each card contains no `[aria-live], [role="status"]` nodes, for example `within(screen.getByTestId("api-key-card-key-mt5-ok")).queryAllByRole("status")` has length 0, plus a `querySelectorAll("[aria-live]")` of length 0 on each card. Then prove the new assertion can fail: temporarily give the card's `Card` a `role="status"` and confirm the case goes RED, as N8 did.

## Info

### IN-01: A live region that mounts already holding its text is not reliably announced when the untrusted state first appears after a re-read

**File:** `src/components/strategy/ApiKeyManager.tsx`, the card's `isUntrustedKeySyncStatus(key.sync_status)` mount

**Issue:** The block and its `role="status"` helper mount only once a status is untrusted. When a key BECOMES untrusted during the page's lifetime, the block and its sentence are inserted together. Screen readers generally do not announce content that is present when a live region is inserted. That happens through the terminal-success re-read in `handleSyncStatusChange`, the mid-flight `loadKeys` in `handleSyncTrades`, or the load-error `Retry`.

The mount-site comment claims politeness only for the in-flight return (a stable node), and that claim holds. The first appearance is simply silent. The 167-UI-SPEC § Accessibility accepts one region per card, so this is not a contract breach. It is recorded here so the human a11y check (verification item 4) knows to look.

**Fix:** None required for this plan. If first appearance must be announced, mount an empty helper region on every MT5 or ccxt card. That would conflict with the "healthy renders nothing new" truth, so it needs a spec decision first, not a code change.

### IN-02: `retireWithheldSuccess`'s reason for keeping `error` does not hold on the Delete path, where the panel's Retry is left bound to a deleted key

**File:** `src/components/strategy/ApiKeyManager.tsx`, the `retireWithheldSuccess` docblock ("`error` stays too, because its Retry is useful with a new password") and `handleDeleteKey`

**Issue:** R5 reuses the helper for `Delete`. If the subject key's last attempt ended in `error`, deleting that key keeps the error panel, and its `onRetry` still targets `lastAttemptedKeyId`, which is now a deleted id. `Retry` then runs `handleLinkKey` against that id and surfaces a raw link failure.

This behaviour is pre-existing: it happened in the same way before 167-06, and R5 did not change it. But the docblock now gives a reason that is true only for the `Update password` path, and the `revoked` helper steers users toward `Delete` and re-add.

**Fix:** Either narrow the docblock sentence to the `Update password` path, or have `handleDeleteKey` also retire an `error` whose subject is the deleted key. That second option is a behaviour change, so if taken it belongs in 167.2 with the other subject-tracking work.

---

_Reviewed: 2026-09-22T23:30:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
