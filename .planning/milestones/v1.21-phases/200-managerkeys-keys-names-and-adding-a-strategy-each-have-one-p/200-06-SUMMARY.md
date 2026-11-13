---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 06
subsystem: strategy-key-card
tags: [api-key-manager, confirm-dialog, re-point, route-09]
requires: ["200-01", "200-03", "200-12"]
provides:
  - "Use & Sync on a non-current key writes strategies.api_key_id only after a confirm naming the strategy and both keys"
affects:
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ConfirmKeyChangeDialog.tsx
  - "src/app/(dashboard)/strategies/[id]/edit/page.tsx"
tech-stack:
  added: []
  patterns: ["modal mounted only while a choice is pending", "label resolved once via apiKeyLabelById"]
key-files:
  created:
    - src/components/strategy/ConfirmKeyChangeDialog.tsx
  modified:
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
    - src/components/strategy/ApiKeyManager.poll.test.tsx
    - "src/app/(dashboard)/strategies/[id]/edit/page.tsx"
    - "src/app/(dashboard)/strategies/[id]/edit/page.test.tsx"
decisions:
  - "strategyName is a REQUIRED prop (plan text), so the 45 existing ApiKeyManager render sites in two test files gained strategyName=\"Synthetic strategy\"."
  - "The dialog is mounted only while a key is pending (not always-mounted with an open flag), so its sentence is never in the page otherwise and no stale labels exist."
  - "A current key the list cannot name reads 'instead of its current key', never 'No key is linked yet.' (a false statement)."
  - "A pending key the list no longer holds opens nothing and writes nothing."
metrics:
  tasks: 2
  completed: 2026-11-11
status: complete
actuals:
  tokens: 9500
  tasks: 2
  commits: 3
plan_head_before: 95af12c315c19875cc9c774e3894f1effd878a6e
plan_head_after: dfb0f58376e28e7a6c239a6759661521c6be4ea2
---

# Phase 200 Plan 06: Confirm before re-pointing Summary

`Use & Sync` on a key the strategy does not use today now opens `ConfirmKeyChangeDialog` and writes `strategies.api_key_id` only when the manager presses `Change key`; Cancel, the Close control and Escape write nothing, and `Resync` on the current key is unchanged.

## What changed

- **Task 1 (tracer), commits `1dfb11dce` (RED test alone) then `5ab935f2f`.**
  - `describe("ApiKeyManager — confirm before re-point (200-06, D-05)")` with 9 cases: no write before confirm and the dialog names strategy plus both keys; confirm writes once and starts the sync; Cancel and Close write nothing; focus starts on Cancel; Resync opens no dialog; first link says `No key is linked yet.`; unreadable current key says `its current key`; a nickname-less key is named by a masked id tail, never the raw id.
  - `ConfirmKeyChangeDialog.tsx` on `Modal`: title `Change this strategy's key?`, buttons `Cancel` (initial focus) and `Change key`. No `buildEnvelope(` call.
  - `ApiKeyManager.tsx`: new `strategyName` prop, `pendingKeyId` state, the non-current button sets it, the dialog's labels come from `apiKeyLabelById(keys)`, Confirm clears it and calls `handleSyncTrades(id)`. `handleLinkKey` and `Resync` untouched, so the gate sits at the control (D-03).
  - Edit page passes `strategyName={strategy.name}`.
  - Shared file-level `confirmUseAndSync(keyId)` / `confirmDialog()` helpers; the two behavioural sites that expect the link to follow (`CR01-OTHER-KEY-REFUSED` and 200-01's `REFRESH-AFTER-RE-POINT`) use it. The add-in-flight case clicks a DISABLED `Use & Sync` and asserts the button is disabled; it needs no change (a click on a disabled button does nothing).
- **Task 2, commit `dfb0f5837`.** `edit/page.test.tsx` gained `NAME-PROP` (the page hands the key card the strategy's name). KCS-23 cases pass unedited.

## RED evidence

HEAD RED of the D-05 case (test commit `1dfb11dce` alone, before any production edit): `NO-WRITE-BEFORE-CONFIRM` failed with `AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times` (the write is immediate at HEAD). 8 of 9 new cases failed; `RESYNC-IS-NOT-A-RE-POINT` passed by design as a regression guard.

Neuters, each from a byte backup in `p200-bak/06/` (`200-06-ApiKeyManager.tsx.bak`, `200-06-ConfirmKeyChangeDialog.tsx.bak`, `200-06-edit-page.tsx.bak`), restored with `cp` and verified with `cmp`; `git diff --stat` empty after each.

| gc-200-06-neuter | File | Change | Failing assertion |
|---|---|---|---|
| gate bypassed | `ApiKeyManager.tsx` | non-current button `onClick` calls `handleSyncTrades(key.id)` directly | 8 of 9 cases RED; `NO-WRITE-BEFORE-CONFIRM`: `expected "vi.fn()" to not be called at all, but actually been called 1 times`; the helper-based ones: `Use & Sync opened no confirm dialog` |
| cancel writes | `ApiKeyManager.tsx` | `onCancel` clears pending and calls `handleSyncTrades` | `CANCEL-WRITES-NOTHING` and `CLOSE-WRITES-NOTHING`: `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| first link lie | `ApiKeyManager.tsx` | `currentLabel` never null (null id falls to `its current key`) | `FIRST-LINK`: `expected 'Change this strategy's key?Orion wil…' to contain 'No key is linked yet. Orion will read…'` |
| focus | `ConfirmKeyChangeDialog.tsx` | remove `data-initial-focus` from Cancel | `DEFAULT-IS-REFUSE`: `expected <body>… to be <button …>` (focus stayed on body) |
| name prop | edit `page.tsx` | delete `strategyName={strategy.name}` | `NAME-PROP`: `expected undefined to be 'Synthetic Composite'` |

## Gates

- `npx tsc --noEmit -p .`: pass
- `npx vitest run` ApiKeyManager.test.tsx, ApiKeyManager.poll.test.tsx, dialog-envelope.invariant.test.ts, edit/page.test.tsx, display-sign-single-source.test.ts: 5 files, 275/275 passed
- `npx eslint` on every changed file: clean
- Acceptance greps: `<ConfirmKeyChangeDialog` count in `ApiKeyManager.tsx` is 1; non-comment `buildEnvelope(` count in `ConfirmKeyChangeDialog.tsx` is 0; `scripts/verify-plan-anchors.mjs` on the plan: no stale claims.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `strategyName` required prop broke type-check of existing render sites**
- **Found during:** Task 1 (tsc after the prop was added)
- **Issue:** 45 `<ApiKeyManager …>` renders in `ApiKeyManager.test.tsx` (40) and `ApiKeyManager.poll.test.tsx` (5) lacked the new required prop; tests are in `tsc`'s include.
- **Fix:** added `strategyName="Synthetic strategy"` to each render (mechanical edit).
- **Files modified:** `src/components/strategy/ApiKeyManager.poll.test.tsx` (not in the plan's `files_modified`), `src/components/strategy/ApiKeyManager.test.tsx`
- **Commit:** `5ab935f2f`

**2. [Rule 2 - Missing critical] truthful label when the current key cannot be named**
- **Issue:** the plan's `currentLabel: string | null` would render `No key is linked yet.` for a current key id absent from the list (RLS or read trouble), a false statement in a confirm.
- **Fix:** the call site passes `null` only when `currentKeyId === null`; an unnamed current key reads `its current key`. Pinned by `CURRENT-KEY-UNREADABLE`.
- **Commit:** `5ab935f2f`

**3. [Rule 3] Dialog focus without a Button ref**
- `Button` takes no `ref` in its types, so Cancel is found by a `data-initial-focus` attribute inside the dialog footer. Not a plan deviation in behaviour.

The RED test commit (`1dfb11dce`) passes the not-yet-existing `strategyName` prop, so `tsc` was red at that one commit by construction (the plan asks for the test alone); `5ab935f2f` is tsc-clean.

## Known Stubs

None.

## Threat Flags

None. T-200-12 is mitigated (write only after Confirm, D-05 proven RED by neuter); T-200-13 accepted as planned; no package installed (T-200-SC).

## Notes for the orchestrator

- `Add Key` on the edit page still auto-links the key it adds until plan 08 (D-07), so plans 06 and 08 must ship in the same PR (per the plan).
- Plan 04 owns `display-sign-single-source.test.ts`; it was run, unedited, and is green.
- STATE.md, ROADMAP.md and REQUIREMENTS.md untouched.

## Self-Check: PASSED

Files present: `ConfirmKeyChangeDialog.tsx`, this SUMMARY. Commits `1dfb11dce`, `5ab935f2f`, `dfb0f5837` are ancestors of HEAD.
