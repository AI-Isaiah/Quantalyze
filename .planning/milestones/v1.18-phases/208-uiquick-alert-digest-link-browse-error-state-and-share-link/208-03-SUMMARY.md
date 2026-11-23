---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
plan: 03
subsystem: ui
tags: [share-link, clipboard, dialog, a11y, vitest]
requires: ["208-02"]
provides:
  - "exported copyTextBounded(text, { strategyId, host? }): one bounded copy path (3 s bound, execCommand fallback inside the open dialog, logs without the URL)"
  - "copy-failed dialog with its own primary Copy link button, phase labels and LiveRegion, on both lanes (dialogUrl replaces mintedUrl)"
  - "Public link dialog for a published strategy whose two copies both fail"
  - "FactsheetView ShareLinkButton.mintAndCopy bounded through the shared helper"
affects: [208-04]
actuals:
  tokens: 12000
  tasks: 2
  commits: 2
plan_head_before: 9e758792f19c20d13e0851bf86b19a1f72aad405
plan_head_after: 6cc6b15980b27831835d8dc32198cdd25f9b99b1
commits: 2
key-files:
  modified:
    - src/components/strategy/ShareableLink.tsx
    - src/components/strategy/ShareableLink.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx
key-decisions:
  - "dialogUrl replaces mintedUrl (promote, one state for both lanes); the lane only picks title, field label, helper sentence and whether OwnerUnpublishedPanel renders"
  - "copyTextBounded resolves the host itself (ctx.host ?? dialog[open] ?? body) so FactsheetView's mintAndCopy, rendered inside the open Private link Modal, is correct without passing host"
  - "a refused execCommand (returns false) is logged with err null: SFH2-02 names that path as silent"
requirements-completed: [SC-3, SC-4]
status: complete
---

# Phase 208 Plan 03: Copy-failed dialog, Public link lane, bounded factsheet copy Summary

When the clipboard refuses a share link the URL is always on screen and its own `Copy link` button works: the dialog copies the URL already shown straight from the tap (no second mint, no `fetch`), the published lane gets the same dialog titled `Public link`, and the factsheet's mint-and-copy goes through the same 3 s bounded helper, so a hanging clipboard ends in the failure label instead of a disabled button.

## Commits

- `402d22d13` fix(208-03): the copy-failed dialog has its own Copy link through one bounded copy helper (Task 1)
- `6cc6b1598` fix(208-03): the published lane shows its URL, hanging copies end visibly failed, the factsheet copy is bounded (Task 2)

## RED-first and GREEN lines

- Task 1 RED (six new arms, no source change): `Tests 6 failed | 43 passed (49)`.
- Task 1 GREEN: `Tests 49 passed (49)` (ShareableLink), `Tests 26 passed (26)` (FactsheetView share-affordance), `npm run typecheck` no `error TS`. Two arms were added afterwards (see neuter (d)), `Tests 50 passed (50)`.
- Task 2 RED (new arms, no source change): ShareableLink `1 failed | 52 passed (53)` (the D-10 published-lane arm); FactsheetView `1 failed | 26 passed (27)` (the factsheet hang arm). The synchronous-published-copy and dialog-hang arms were green on first run because Task 1's helper already provides that behaviour; their RED proof is neuters (g) and (h).
- Task 2 GREEN: ShareableLink `Tests 53 passed (53)`, FactsheetView `Tests 27 passed (27)`.
- The Pitfall 5 query fixes (two Audit #43 published both-fail arms, plan 02's published region arm) were made in the same edit as the implementation, not before it, so no separate RED reading exists for those three.

## Neuter evidence (D-12, SC-4)

All restores are `cp -p` from a byte backup in the scratchpad (`208-03-T1.bak`, `208-03-T2-ShareableLink.bak`), `cmp` exit 0, then GREEN.

- neuter-208-03 (a): `copyFromField` awaits `mintShareUrl(strategyId)` before copying. RED `1 failed | 48 passed (49)`: "the dialog Copy link copies the URL on screen with no second mint, then reads Copied". `cmp` exit 0, GREEN.
- neuter-208-03 (b): the `clipboard write failed` `console.warn` deleted. RED `1 failed | 48 passed (49)`: "D-05: both copy catches log { strategyId, err } and no logged argument carries the URL". `cmp` exit 0, GREEN.
- neuter-208-03 (b2): the `execCommand copy failed` `console.warn` deleted. RED `2 failed | 47 passed (49)`: "D-05: an execCommand that returns false is still logged, with err null" and the both-catches arm. `cmp` exit 0, GREEN.
- neuter-208-03 (c): host always `document.body`. RED `1 failed | 48 passed (49)`: "D-15: the fallback's temporary input lives in the body for the row and inside the open dialog for the dialog button". `cmp` exit 0, GREEN.
- neuter-208-03 (d): the `setSelectionRange` call deleted from `selectUrlField`. First reading `49 passed (49)`: NOT RED, because the field's `onFocus` also calls `setSelectionRange`, and `focus()` fires it. The arms were rewritten to the intent: iOS ignores `focus()` outside a gesture, so no focus event and no `onFocus`; `HTMLElement.prototype.focus` is stubbed to a no-op and only the explicit call can reselect. Re-run: RED `2 failed | 48 passed (50)`: "D-09: iOS ignores focus() outside a gesture, so a failed dialog copy still reselects with an explicit setSelectionRange" and "D-09: opening the dialog selects the whole URL with an explicit setSelectionRange even when focus() is ignored". `cmp` exit 0, GREEN `50 passed (50)`. A separate arm keeps the refocus assertion (`activeElement` is the field after a failed copy).
- neuter-208-03 (e): dialog `<LiveRegion message={null} />`. RED `1 failed | 48 passed (49)`: "a failed dialog copy reads Copy failed, refocuses and reselects the field, and the dialog region announces it". `cmp` exit 0, GREEN.
- neuter-208-03 (f): `mint-token` gate put back on the failure branch. RED `1 failed | 79 passed (80)`: "D-10: a published strategy whose two copies both fail opens a Public link dialog holding the public URL, with no owner panel and no fetch". `cmp` exit 0, GREEN.
- neuter-208-03 (g): `await Promise.resolve();` before the published lane's `copyTextBounded`. RED `1 failed | 79 passed (80)`: "the published lane stays synchronous: writeText runs inside the click, before any await". `cmp` exit 0, GREEN.
- neuter-208-03 (h): `writeClipboardBounded` awaits `writeText` directly instead of racing the timer. RED `4 failed | 76 passed (80)` across both files, naming BOTH hang arms: ShareableLink "D-08: a dialog copy whose clipboard never settles ends as Copy failed after the 3 s bound, button enabled" and FactsheetView "D-08: a clipboard that NEVER settles ends in the failure label with the button enabled, not stuck working"; also the two existing hang arms "clipboard NEVER settles: after the bound the dialog opens ..." and "clipboard hangs but the synchronous fallback copies ...". `cmp` exit 0, GREEN `80 passed (80)`.

## FactsheetView diff scope

`git diff --numstat`: `9 6 src/app/factsheet/[id]/v2/FactsheetView.tsx`. Hunk headers: `@@ -39,0 +40 @@ import {` (the import block) and `@@ -2790,5 +2791,8 @@ function ShareLinkButton({` plus `@@ -2796 +2799,0 @@ function ShareLinkButton({` (both inside `mintAndCopy`). `copyPublishedUrl` and `shareButtonLabel` are byte-unchanged.

## Gates line

Gate set (copy-census, display-sign-single-source, trim-removed-surfaces, critical-regressions, FactsheetView.share-affordance): `Test Files 4 passed | 1 failed`, `Tests 296 passed | 1 failed (297)`; the one failure is a 5 s timeout of the `display-sign-single-source` whole-tree scan under CPU load (see Deferred Issues), and that file passes alone, `Tests 26 passed (26)`. `strategies/page.share-affordance.test.tsx`: `Tests 9 passed (9)`. `npm run typecheck`: no `error TS`. `npm run lint`: exit 0, planning-hygiene rules OK. `eslint` on the four touched files: exit 0. `npm test` under Node 22.22.1: `Test Files 3 failed | 1236 passed | 20 skipped (1259)`, `Tests 3 failed | 26129 passed | 306 skipped (26438)`; the 3 failures are in files this plan does not touch (see below) and pass when re-run alone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test did not bite] Neuter (d) was GREEN on the first reading**
- **Found during:** Task 1, neuter proofs
- **Issue:** the field's `onFocus` also calls `setSelectionRange`, so deleting the call in `selectUrlField` changed nothing observable when `focus()` fires a focus event.
- **Fix:** rewrote the two selection arms around the iOS premise (focus ignored, `HTMLElement.prototype.focus` stubbed) so only the explicit call can satisfy them; kept a separate refocus arm. Test-only change.
- **Files modified:** `src/components/strategy/ShareableLink.test.tsx`
- **Commit:** `402d22d13`

## Deferred Issues

- Three `npm test` failures outside this plan's files, none touching ShareableLink or FactsheetView: `RiskTabPanel.book-series.test.tsx` (ready, empty legacy strategies), `return-stats.single-source.test.ts` (whole-tree retirements), `seam-venue-vocabulary.invariant.test.ts` (scan exclusions pinned). Two were `Test timed out in 5000ms` whole-tree-scan arms measured while the full suite ran with other work on the machine. Re-run alone: `return-stats.single-source` `34 passed (34)`, `display-sign-single-source` `26 passed (26)`; `RiskTabPanel.book-series` and `seam-venue-vocabulary` passed in the 4-file re-run (`2 passed`). Pre-existing load sensitivity of 5 s whole-tree scans, not caused by this plan; no code changed in response.

## Known Stubs

None.

## Threat Flags

None. `copyTextBounded` logs `{ strategyId, err }` and never the text (T-208-09, pinned by the logging arm and neuters (b), (b2)); the temporary input is removed in `finally` (T-208-10, the existing removal arm plus the host arm); the published copy stays synchronous (T-208-11, neuter (g)).

## Self-Check: PASSED

The four files exist and are committed; commits `402d22d13` and `6cc6b1598` are ancestors of HEAD; `git rev-list --count` over the ledger base measures 2.
