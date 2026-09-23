---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
plan: 06
round: 2
reviewed: 2026-09-23T00:05:00Z
reviewed_at_sha: 0d921c12
diff_base: e8f96eec
diff_head: ac54c9ba
depth: deep
files_reviewed: 2
files_reviewed_list:
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 167: Code Review Report, plan 167-06, round 2 (the fix round)

**Reviewed:** 2026-09-23T00:05:00Z
**Depth:** deep. The diff was traced through `SyncProgress` and `useStrategySyncPoller`, which is where the poll comes from, and each claim was checked with a probe.
**Files Reviewed:** 2 (`git diff e8f96eec..ac54c9ba -- ':!.planning'`, the fix commit `5d948e2b`)
**Status:** issues_found

## Summary

**Method.**
- The test file passes 67/67. `eslint` and `tsc` are clean on both files.
- 21 mutants were run against a copy of the component, plus 2 behaviour probes: one with the real `SyncProgress` and fake timers, one using the harness's mocked panel. Every probe file was deleted afterwards and the tree is clean.
- Mutants killed: 13. Mutants that survived: 8 (M2, M3, M6, M7, M10, M13, M16, M17; M10 and M13 are harmless).

**Round-1 closure verdicts:**

| Round-1 id | Verdict | Evidence |
|---|---|---|
| CR-01 (post-add clear ends a live attempt) | **CLOSED** | The `attemptRef.current !== null` gate in `handleAddKey`'s catch was removed as a mutant, and that mutant was killed by 2 cases: `ATTEMPT SCOPE, post-add route` and `R6 (corrected)`. |
| WR-01 (healthy card, "no added live region" was not asserted) | **CLOSED** | A `role="status"` on the card and an `aria-live` on an inner div were each killed by the 8 `HEALTHY CONTROL` cases. |
| IN-01 (a region's first appearance is not announced) | **CLOSED as documented** | The limit is recorded at the card's mount comment. |
| IN-02 (`error` kept on Delete) | **CLOSED as documented** | The `retireWithheldSuccess` docblock was narrowed. |
| SFH-HIGH-1 (a pre-enqueue poll read ends the attempt) | **PARTIALLY CLOSED** | Its terminal STATUS is now ignored. But the pre-enqueue polls still use up the poller's attempt budget, and the attempt then fails one tick after its enqueue. See CR-01 below. |
| SFH-MED-1 (retire maps `error`) | **CLOSED** | The `error`→idle mutant was killed by 2 cases. |
| SFH-MED-2 (functional updater) | **CLOSED** | The closure-value mutant was killed by the `R3's updater is FUNCTIONAL` case. |
| SFH-LOW-1 (success shown before its re-read) | **CLOSED** | Two mutants were killed: showing the success before the re-read, and showing it after a failed re-read. |
| SFH-LOW-2 (load-error banner hidden while the form is open) | **CLOSED** | The `!showForm` mutant was killed. |
| SFH-PRE (delete that removed 0 rows) | **CLOSED** | Removing the row check was killed. WR-05 below covers a remaining gap. |

**How each attempt ends.**
- **Enqueue error:** the catch runs `endAttempt` and sets `error`. OK.
- **Enqueue 2xx, then a terminal success:** the attempt settles, re-reads, then ends. OK, with WR-04 and IN-01.
- **Enqueue 2xx, then a terminal error:** it ends. OK, but unpinned (WR-02).
- **Poller timeout before enqueue:** ignored, and the budget stays spent, so the attempt fails right after the enqueue returns (**CR-01**).
- **Poller timeout after enqueue:** ends. OK.
- **Unmount mid-attempt:** the ref is discarded with the component and no marker outlives it. OK.
- **Second attempt while `settling`:** not possible. The marker is still set, so every Resync is disabled, and the panel is in `computing`, so it shows no Retry.
- **Re-read that never returns while settling:** the panel spins with the marker set, and the poller's own escalation is ignored (IN-01).

**Bottom-line error change.** No hidden or doubled error was found on any reachable path:
- `handleSyncTrades`'s catch writes the same message to `error` and `syncError`, so that one line is still hidden.
- Every other writer of `error` differs from `syncError`, so its line now shows.

## Critical Issues

### CR-01: Polls taken before the enqueue are ignored, but they still use up the poller's budget. A slow enqueue that SUCCEEDS is then reported as a timeout one tick later.

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleSyncStatusChange`'s guard (`!attempt.enqueued`) and `handleSyncTrades` (`attempt.enqueued = true; setSyncStatus("computing")`). The cause is in `SyncProgress`, where `useStrategySyncPoller` is called with `enabled: isActive`.

**Issue:**
- `isActive` is true in both `syncing` and `computing`. So the move from `syncing` to `computing` does not restart the poll effect, and its effect-local `attempts` counter keeps counting from the click.
- The interval arm never stops by itself. Once `attempts > MISSING_ROW_GRACE_POLLS` with no analytics row, or once `attempts > POLL_MAX_ATTEMPTS`, it calls `onError` on EVERY tick.
- Before the enqueue, the new guard drops those calls. The first tick after `enqueued` becomes true then delivers `"error"`. The attempt ends with "Analytics computation timed out. Please retry or contact support." while the job it just enqueued is running.

**Probe** (the real `SyncProgress`, fake timers, a deferred `/api/keys/sync`):

| Case | 3 s after a successful 202 |
|---|---|
| Control: no row, enqueue answers at 6 s | still `Computing analytics` |
| No analytics row, enqueue answers at 36 s | `Sync failed` + the timeout copy |
| Previous run's `computing` row, enqueue answers at 126 s | `Sync failed` + the timeout copy |

**Why it matters:**
- The route awaits `postProcessKey`, which calls the analytics service. `MISSING_ROW_GRACE_POLLS`'s own comment puts a cold start at 15–30 s, so the no-row case is only a few seconds outside the typical range.
- The user is told the sync failed while it is running. Retry then sends a second enqueue on top of the live job.
- The `SyncAttempt` docblock says a pre-enqueue read cannot end the attempt. In this case it still does.
- ROADMAP 167.2 limit (4) names only an enqueue that NEVER returns. An enqueue that returns late and then fails at once is not named.

**Fix:** At the root, do not poll before the enqueue. A read taken then is, by the fix's own premise, about an earlier run. Poll only in `computing`:
```tsx
// SyncProgress
useStrategySyncPoller({
  enabled: syncStatus === "computing",   // was: isActive
  ...
});
```
- This makes the attempt counter and the grace start at the enqueue, and it makes `attempt.enqueued` redundant as a read filter.
- `SyncProgress` has one caller (`ApiKeyManager`). The wizard uses the hook directly.
- Re-check `SyncProgress.poll.test.tsx` for a pin on polling while `syncing`.
- Add a regression case using the real `SyncProgress`: no row, the enqueue deferred past 33 s, then the 202. Assert the panel is still `computing` one tick later.

## Warnings

### WR-01: The fix's `lastAttemptedKeyId` gate leaves the post-add failure's Retry pointing at the OLD key. Retry re-links the strategy to it.

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleAddKey` (`if (attemptRef.current === null) setLastAttemptedKeyId(newKeyId)`) and its background `.catch`

**Issue:**
- The gate is evaluated once, right after the add's link write succeeds.
- Suppose a tracked attempt on key J was started while the add's validate or link was still awaited, and it has ENDED by the time the post-add sync fails. `attemptRef.current` is then null, so the catch shows the failure on the panel, but `lastAttemptedKeyId` is still J.
- The panel's Retry runs `handleSyncTrades(J)`, whose `handleLinkKey(J)` writes `strategies.api_key_id` back to J. That undoes the Add Key's link to the new key, from a Retry on the NEW key's failure.

**Probe:** the link writes, in order, were J, then new, then **J** (from the Retry).
- Before the fix round, `lastAttemptedKeyId` was always moved, so the Retry re-linked the new key.
- The catch comment says the failure "is shown there as before". For this ordering that is not true.

**Fix:** Decide ownership once, at fire time, and keep it in the closure:
```ts
const ownsPanel = attemptRef.current === null;
if (ownsPanel) setLastAttemptedKeyId(newKeyId);
fetch(...).catch((err) => {
  console.warn(...);
  if (!ownsPanel || attemptRef.current !== null) return; // not this sync's panel
  setSyncStatus("error"); setSyncError(...);
});
```
Add a case covering this ordering: add in flight, Resync J, J completes, then the post-add fails. Assert that Retry links the new key, or that no panel error appears.

### WR-02: Nothing pins that a poll `error` ends the attempt. Without it, every Resync stays disabled until a reload.

**File:** `src/components/strategy/ApiKeyManager.test.tsx`. The code is `handleSyncStatusChange`'s `status === "error"` arm (`endAttempt(attempt)`).

**Issue:**
- In mutant M16, `endAttempt(attempt)` was deleted from the error arm, and all 67 tests passed.
- With that mutant, a poller timeout or a failed run leaves `syncingKeyId` set. Every Resync and Use & Sync stays disabled, and so do the key's Update password and Delete. That is the dead-lock class R6 exists for.
- The only case that drives `"error"` through the poll (`R3's updater is FUNCTIONAL`) asserts the panel status and nothing about the controls.

**Fix:** Add a case: resync, then `capturedOnStatusChange("error")`. Assert that Resync, Update password and Delete are enabled, and that the timeout copy renders. Neuter `endAttempt` and observe RED.

### WR-03: The new `settling` rule ("one terminal is handled once") is not pinned

**File:** `src/components/strategy/ApiKeyManager.test.tsx`. The code is `handleSyncStatusChange` (`attempt.settling` in the guard, and `attempt.settling = true`).

**Issue:** Mutants M2 (the guard conjunct removed) and M3 (the flag never set) both left 67/67 green. Without the rule, a poll that lands during a slow terminal re-read causes one of two problems:
- a second `complete` starts a second re-read and a second `router.refresh()`;
- an `error`, which a capped poller sends every tick, ends the attempt with the timeout copy, and the first re-read's `finally` then overwrites that error with the success.

**Fix:** Hold the terminal re-read open with `deferred`. Deliver a second `"complete"` and then `"error"`. Assert:
- one re-read only;
- the status stays `computing`;
- after the re-read resolves, the status is the success, not `error`.

### WR-04: "A success is shown only after a re-read that could withhold it" does not hold against the attempt's own earlier re-read

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleSyncTrades` (`await loadKeys({ lastSyncedKeyId: keyId })` after `enqueued = true`) together with the terminal arm's `loadKeys`

**Issue:**
- `enqueued` becomes true before `handleSyncTrades` issues its post-enqueue re-read, so a terminal can arrive while that read is still outstanding. That includes the previous run's row, per 167.2 limit (3).
- `loadKeys` has no sequencing. If the older read resolves LAST, `setKeys` installs the snapshot taken before the job ran, AFTER the terminal arm has shown the success.
- If the job flipped the key to `sign_in_failed`, the stale snapshot still shows the earlier healthy status. R2's withhold then lapses, and "Up to date" renders beside a key whose sign-in has failed on the server. That is the false confidence this phase exists to remove. It lasts until the next read.

**Fix:** Tag each `loadKeys` call with an incrementing request id held in a ref, and drop any response older than the newest one applied. Alternatively, have the terminal arm wait for the attempt's own post-enqueue read before its re-read.

### WR-05: A delete that removed 0 rows treats "the row is already gone" as "the delete was refused", and leaves a card that can never be deleted

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleDeleteKey` (the `deletedRows?.length !== 1` arm)

**Issue:**
- 0 rows is also the answer when the row was deleted elsewhere, for example in another tab.
- The arm returns without re-reading. The card stays, and every later Delete answers "no key was removed" until a reload, even though no such key exists.

**Fix:** In the 0-row arm, call `loadKeys()` after `setError(...)` so that the list matches the server. A key that is really still there survives the re-read, and one that is gone leaves.

## Info

### IN-01: A terminal re-read that never returns keeps the panel spinning and the marker set, and the poller's escalation is ignored

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleSyncStatusChange` (`settling`)

**Issue:** While `settling` is true, every poll call is dropped, including the capped poller's `onError`. So nothing bounds settling except the network stack. Before the fix, the marker was cleared synchronously at the terminal. This is not named in 167.2.

**Fix:** Either name it beside limit (4), or bound the re-read (a timeout that resolves `false`, which goes to the existing idle-plus-load-error arm).

### IN-02: The "ended attempt" branches and the rule "registered before any await" are unpinned

**File:** `src/components/strategy/ApiKeyManager.test.tsx`. The code is `endAttempt`'s identity check, `handleSyncTrades`'s `if (!endAttempt(attempt))` early return, and the registration order at the top of `handleSyncTrades`.

**Issue:** Mutants M6, M7 and M17 each left 67/67 green. The branches are reachable only when `loadKeys` throws after a terminal, and supabase-js returns errors as values, so their real exposure is small.

**Fix:** Pin them, or accept the gap and say so in the `SyncAttempt` docblock.

### IN-03: The new copy "Failed to delete key: no key was removed." is in the passive voice

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleDeleteKey`

**Issue:** DESIGN.md §Voice asks for active voice ("We validate every row"). The added clause is passive and gives no next step. The prefix it extends is existing copy.

**Fix:** For example, "Failed to delete key: the key is still connected. Reload and try again." Update the test's exact-string assertion to match.

### IN-04: `handleSyncStatusChange` is now `async`, and a throw from its re-read escapes as an unhandled rejection

**File:** `src/components/strategy/ApiKeyManager.tsx`, `handleSyncStatusChange` (the `try { await loadKeys } finally { ... }` with no catch)

**Issue:** `SyncProgress`'s `onStatus` drops the returned promise. The `finally` still ends the attempt and sets idle, so the UI is correct. Only the rejection escapes. Before the fix, `loadKeys` was un-awaited and had the same exposure.

**Fix:** Add a `catch` that logs through `console.error("[ApiKeyManager] ...")`, next to the existing `finally`.

---

_Reviewed: 2026-09-23T00:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Silent-failure hunt, round 2 (same scope, run in parallel)

Verdict: not ready — 1 HIGH (new), 1 MEDIUM (new), 1 LOW (new). Every round-1 finding and CR-01 closed, each confirmed by a probe or a mutation.

| Id | Severity | Finding | Relation to this review |
|----|----------|---------|-------------------------|
| SFH2-HIGH-1 | high | The poller's attempt budget spans the enqueue (`isActive` covers `syncing` and `computing`), so pre-enqueue polls spend it; the first tick after `enqueued` ends a correctly enqueued attempt with the timeout copy, having read the new job 0 times. Worse than pre-fix, where the 202 restarted the poller. The committed suite mocks `SyncProgress`, which is why it passed. | Same defect as CR-01 above. |
| SFH2-MED-1 | medium | A terminal re-read that never settles holds `settling`, the spinner and the marker forever (supabase-js has no default timeout). | Same as IN-01 above. |
| SFH2-LOW-1 | low | A re-read that throws ends the attempt with neither success nor error; only an unhandled rejection records it. | Same as IN-04 above. |
| Named limit | — | "Stale read after enqueue" is NOT narrow: the analytics row flips to `computing` only when a job handler runs, so until the worker claims the job, reads return the previous run's row — likely on most resyncs of a strategy with a prior terminal row. Not worse than before this phase; routed to Phase 167.2 with its description corrected. | — |
