---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 11
subsystem: strategy-key-card
tags: [api-key-manager, change-key, confirm-dialog, route-09]
requires: ["200-06"]
provides:
  - "The edit page's one Change key… picker; a pick opens plan 06's confirm and the dialog's Change key is the only writer of strategies.api_key_id from the key card"
affects:
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
key-files:
  modified:
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
decisions:
  - "The picker is inline (a Card under the header), not a second Modal: nothing new for the dialog-envelope invariant, and the confirm stays the only dialog."
  - "KeyFeedsLine gained an optional testIdPrefix so a picker option's feeds line never duplicates the card's api-key-feeds-<id> test id."
  - "A non-current key that is being synced (the Add Key attempt) shows a disabled Syncing… marker on its card. It is no control; it keeps the KCS-01 'marker held until the answer lands' cases meaningful."
  - "LINK_BUTTON_NAMES gained /^Change key…$/ and kept /^Use & Sync$/, so a revival of the per-card button fails the composite/unknown cases too."
metrics:
  tasks: 2
  completed: 2026-11-11
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: f28c8c119032c2042cce1f32e9e4a05d7495b6f2
---

# Phase 200 Plan 11: Change key… behind the confirm Summary

The edit page now has one `Change key…` control (single-key shape, at least one other account key) that opens an inline picker of the other keys, each with its feeds line; a pick opens `ConfirmKeyChangeDialog` and only that dialog's `Change key` writes `strategies.api_key_id`. The per-card `Use & Sync` is gone.

## What changed

- **Task 1 (tracer), commit `b4e90923e`.**
  - `ApiKeyManager.tsx`: `pickerOpen` state; `changeKeyCandidates` (`keys` minus the current key, empty unless `linkControlsAllowed`); header `Change key…` (disabled while a sync or add is in flight, same rule as the old button); `change-key-picker` Card listing each candidate by `apiKeyLabelById` plus `KeyFeedsLine`, with Cancel; a pick sets plan 06's `pendingKeyId` and closes the picker. Per-card non-current `Use & Sync` removed. `Add Key`, Delete and `Update password` untouched (plan 08 owns them).
  - `ApiKeyManager.test.tsx`: helpers `pickKey` / `confirmChangeKey` replace `confirmUseAndSync`; the seven plan 06 confirm cases, `CR01-OTHER-KEY-REFUSED`, `REFRESH-AFTER-RE-POINT`, the P7 add-in-flight case, the layout case, `SINGLE-UNCHANGED` and the KCS-23 `LINK_BUTTON_NAMES` list now drive `Change key…`. New block `ApiKeyManager — Change key… picker (200-11, D-07)`: `ONE-CONTROL`, `PICKER-LISTS-OTHER-KEYS-WITH-FEEDS`, `PICK-WRITES-NOTHING`, `PICKER-CANCEL-WRITES-NOTHING`, `ONLY-ONE-KEY`, `FIRST-LINK-IS-OFFERED`, KCS-23 composite and unknown (6 cases plus the 2-row `it.each` = 8 tests).
- **Task 2 (verification only, no commit).** `ApiKeyManager.poll.test.tsx` has 0 `Use & Sync` occurrences, so it needed no change and plan 08's ownership is respected. Poll suite, `dialog-envelope.invariant.test.ts`, edit `page.test.tsx` green.

## RED evidence

Backup: `p200-bak/11/200-11-ApiKeyManager.tsx.bak` (byte copy of the committed good file; the test file's pre-edit bytes are in `200-11-orig-ApiKeyManager.test.tsx.bak`). Each neuter was applied to `ApiKeyManager.tsx`, the suite run, then restored with `cp` and checked with `cmp` (exit 0 every time); `git status` showed only the two intended files modified.

| gc-200-11-neuter | Change | Result |
|---|---|---|
| pick writes directly | the option's `onClick` calls `handleSyncTrades(key.id)` instead of `setPendingKeyId` | 12 cases RED. `D-05 NO-WRITE-BEFORE-CONFIRM`, `FIRST-LINK`, `PICK-WRITES-NOTHING`, `FIRST-LINK-IS-OFFERED`: `expected "vi.fn()" to not be called at all, but actually been called 1 times`; the helper-based ones: `Change key… opened no confirm dialog: expected null not to be null` |
| KCS-23 gate dropped | `changeKeyCandidates` ignores `linkControlsAllowed` | 3 RED: `COMPOSITE-NO-LINK` and both new KCS-23 cases, `expected [ <button …(2)></button> ] to have a length of +0 but got 1` |
| feeds line removed | the option renders `{null}` in place of `KeyFeedsLine` | `PICKER-LISTS-OTHER-KEYS-WITH-FEEDS`: `Unable to find an element by: [data-testid="change-key-feeds-key-pick-b"]` |
| current key offered | candidates are all keys | `PICKER-LISTS-OTHER-KEYS-WITH-FEEDS` and `ONLY-ONE-KEY` RED (`to have a length of +0 but got 1`) |
| no other key still shows control | `changeKeyCandidates.length > 0` replaced by `true` | 4 RED: `ONLY-ONE-KEY`, `COMPOSITE-NO-LINK`, `COMPOSITE-EMPTY`, `SHAPE-UNKNOWN-REMEDY` |

## Gates

- `npx tsc --noEmit -p .`: pass
- `npx vitest run` ApiKeyManager.test.tsx, ApiKeyManager.poll.test.tsx, dialog-envelope.invariant.test.ts, edit/page.test.tsx: 4 files, 257/257 passed (ApiKeyManager.test.tsx alone: 181)
- `npx eslint` on both touched files: clean
- Acceptance: `grep -a -c 'Change key…'` in `ApiKeyManager.tsx` is 8 (at least 1); non-comment `Use & Sync` count is 0; `scripts/verify-plan-anchors.mjs` on the plan: no stale claims.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Syncing marker for a non-current key**
- **Found during:** Task 1 (7 SEAMUX-05 / 167-06 cases went RED)
- **Issue:** Removing the per-card button also removed the `Syncing…` marker the Add Key attempt showed on the new, not-yet-current key, which those cases (KCS-01 marker held until the answer lands) assert.
- **Fix:** a disabled `Syncing…` button on a non-current key while it is the syncing key. It carries no `onClick`, so it cannot re-point.
- **Files modified:** `ApiKeyManager.tsx`
- **Commit:** `b4e90923e`

**2. [Rule 3 - Blocking] Duplicate test id**
- A picker option's feeds line would repeat `api-key-feeds-<id>`; `KeyFeedsLine` gained an optional `testIdPrefix`. Same commit.

## Known Stubs

None.

## Deferred items (out of scope, not fixed)

Strings and specs outside this plan's `files_modified` still name `Use & Sync`, which no longer exists on the edit page:

- `src/lib/status-surface-copy.ts:399` ("Link a key with Use & Sync on this strategy's …") and `src/lib/degrade-warnings.ts:218` ("Link a key with Use & Sync on this strategy's edit page …"): user-facing remedy copy that now points at a missing button. Both are pinned by tests (`status-surface-copy.test.ts` and degrade-warnings tests); they need a copy decision (`Change key…`) and their own test edits.
- `e2e/sync-analytics-flow.spec.ts:125-130` ("Use & Sync button is visible for unlinked keys") and `e2e/api-key-flow.spec.ts:252` (`/Resync|Use & Sync/i`): the first will fail against the new page. Playwright could not be run here (disk rule).
- Comment-only mentions in `ConfirmKeyChangeDialog.tsx`, `key-card-copy.ts`, edit `page.tsx`.

Not appended to `.planning/WINDOWS.md` (this worktree must not touch shared ledgers); the orchestrator should book these.

## Threat Flags

None. T-200-16 mitigated (a pick only sets the pending key; the write is the dialog's Confirm; proven RED by neuter 1). T-200-17 mitigated (KCS-23 fail-closed kept for the picker; neuter 2 RED). No package installed (T-200-SC).

## Notes for the orchestrator

- Plan 10's `AllocatorExchangeManager.*` files untouched. STATE.md, ROADMAP.md, REQUIREMENTS.md untouched.
- Plans 06, 08 and 11 still need to ship in the same PR: `Add Key` on the edit page auto-links until plan 08 removes it.

## Self-Check: PASSED

Files present: `ApiKeyManager.tsx`, `ApiKeyManager.test.tsx`, this SUMMARY. Commit `b4e90923e` is an ancestor of HEAD.
