---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
plan: 07
subsystem: ui
tags: [notes, trust-06, d-09, d-10, blur-save, focus, tracer]
status: complete

requires: ["193-01"]
provides:
  - "shouldSaveNoteOnBlur(draft, persisted): the one blur predicate for all four autosaving note surfaces"
  - "StrategyNoteCard, HoldingNoteRow, BridgeOutcomeNoteSection and HoldingDetail write nothing on open: no auto-focus, a persisted baseline advanced on saved, Edit click focuses, blur gated"
  - "D-09 override (Allow clearing, founder 2026-11-07) implemented and pinned by a Q-1 arm on every surface"
affects: [the Phase 193 verifier, /gsd-secure-phase 193]

actuals:
  tokens: 9100
  tasks: 3
  commits: 3
plan_head_before: 9a57088b47b907462a55581945c5adacfb5547b7
plan_head_after: 702b0fc6e6867bb6d45388f07b1e72ab3e99699b

tech-stack:
  added: []
  patterns: ["DashboardNoteCard dirty-check idiom (baseline advanced only on saved) extended to the four other surfaces behind one shared predicate", "focus from the Edit click via a ref flag consumed by an effect on the editing state"]

key-files:
  created:
    - "src/components/notes/should-save-note.ts"
    - "src/components/notes/should-save-note.test.ts"
  modified:
    - "src/components/notes/StrategyNoteCard.tsx"
    - "src/components/notes/StrategyNoteCard.test.tsx"
    - "src/components/notes/HoldingNoteRow.tsx"
    - "src/components/notes/HoldingNoteRow.test.tsx"
    - "src/components/notes/BridgeOutcomeNoteSection.tsx"
    - "src/components/notes/BridgeOutcomeNoteSection.test.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingDetail.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingDetail.test.tsx"

key-decisions:
  - "Predicate is exactly the plan's expression: draft !== persisted && (draft.trim() !== \"\" || persisted.trim() !== \"\"), carrying the founder's 2026-11-07 override (Allow clearing) of D-09's literal wording"
  - "On a skipped blur the card restores draft and content to the persisted value and returns to read mode when something is stored, or stays in the empty textarea when nothing is"
  - "useNoteAutoSave, NoteSaveStatus, DashboardNoteCard and /api/notes are untouched, as the plan requires"

requirements-completed: [TRUST-06]

duration: 35min
completed: 2026-11-07
---

# Phase 193 Plan 07: Opening a note writes nothing Summary

Opening a strategy page, a holding row, a bridge outcome or a holding's Notes tab and leaving without typing now sends no `PATCH /api/notes`; typing still saves once and a deliberate clear of a saved note still reaches the route.

## What was built

- `should-save-note.ts`: `shouldSaveNoteOnBlur(draft, persisted)`, one expression with a doc comment naming the override and the four callers.
- Each of the four surfaces got a `persisted` baseline (seeded from the initial content on the strategy card, from the GET on the other three, `""` on a 404 or any failed load), a `pendingSaveRef`, an effect that advances the baseline when `saveState === "saved"`, a `textareaRef` plus `focusOnEditRef` focused by an effect on the editing state, and a blur gated on the predicate. The textarea's auto-focus attribute is gone from all four. The Edit button sets the flag before setting editing.
- `HoldingNoteRow` and `BridgeOutcomeNoteSection`: the new hooks sit above the loading-gate early return; the `cancelled` flag, the gate and every other line are unchanged.
- `HoldingDetail`: `if (noteLoadError) return;` is still the first statement of `onNoteBlur`, ahead of the predicate.

## Task commits

1. Task 1 (tracer, strategy card + predicate): `13c11ff12` fix(193-07): opening the strategy note card writes nothing (QUIETVIEW D-09, D-10)
2. Task 2 (holding row + bridge outcome): `58b6df203` fix(193-07): opening a holding note row or a bridge outcome note writes nothing (QUIETVIEW D-10)
3. Task 3 (holding detail, neuter, sweep): `702b0fc6e` fix(193-07): opening the holding detail Notes tab writes nothing, behind the kept load-error fence (QUIETVIEW D-10)

## D-09 write-path measurement (measured before the fix, against the unmodified `StrategyNoteCard`)

Opening the card with no saved note and clicking elsewhere (`userEvent.click(document.body)`) sent **1** `PATCH /api/notes`, body `{"scope_kind":"strategy","scope_ref":"s","content":""}`: one empty-content write per open-and-leave. jsdom does honour React's auto-focus (the textarea was the active element on mount), so A-193-13 did not apply and the open-and-leave case is RED at HEAD, not a pass-for-the-wrong-reason.

Beside the D-08 PROD count of plan 193-01 (`193-D08-COUNT.md`, `d08-read-at: 2026-11-06T20:43Z`): `user_notes` held 2 empty rows (scope_kind holding 1, strategy 1, both with `empty=1`) and the audit trail held 2 zero-length saves (`user_note.holding.update` 1, `user_note.strategy.update` 1). The measured client behaviour is the mechanism that produces exactly those rows.

## Census (CONTEXT Specifics)

- `useNoteAutoSave` consumers (non-test): `DashboardNoteCard`, `HoldingDetail`, `StrategyNoteCard`, `HoldingNoteRow`, `BridgeOutcomeNoteSection`. The grep also lists `useNoteAutoSave.ts` itself, `NoteSaveStatus.tsx` and `src/lib/retry/index.ts`; those mention the name in code comments and define the hook, they do not consume it.
- Mount sites: `DashboardNoteCard` in `HoldingsTabPanel.tsx`; `HoldingNoteRow` and `HoldingDetail` in `HoldingsTable.tsx`; `BridgeOutcomeNoteSection` in `OutcomesWidget.tsx`; `StrategyNoteCard` in `src/app/strategy/[id]/page.tsx`.
- Non-note client write calls under the factsheet, strategy and note surfaces: 12, all user-initiated, plus `useNoteAutoSave`'s own PATCH (which only `save()` reaches). By enclosing symbol: `ShareRevokeControl` `confirmRevoke` (revoke click), `RenameStrategyDialog` `handleSave`, `StrategyActions` `handleSubmitForReview`, `ApiKeyManager` `handleAddKey` and `enqueueExchange` inside `handleSyncTrades`, `MarkOwnershipDialog` `submit`, `UpdateMt5SecretDialog` `handleSubmit`, `StarToggle` `attempt` (called from the toggle's transition), `StrategyForm` `handleApiKeySubmit`, `RequestIntroButton` `handleSubmit`, `ShareableLink` `mintShareUrl` (called only from `handleCopy` here and `mintAndCopy` in `FactsheetView`, both click handlers), `PendingIntros` `handleRespond`. None runs on mount; no finding to report.

## Verification (real counts)

- RED-first runs (each against HEAD behaviour, before the fix): predicate file failed to import (module absent); StrategyNoteCard 4 failed / 8 passed; HoldingNoteRow 3 failed (of 21); BridgeOutcomeNoteSection 3 failed (of 8); HoldingDetail 2 failed (of 15).
- GREEN after the fix: should-save-note 8 passed (8 tests); StrategyNoteCard 12 passed; HoldingNoteRow 21 passed; BridgeOutcomeNoteSection 8 passed; HoldingDetail 15 passed.
- Sweep the plan names (`src/components/notes`, `HoldingDetail.test.tsx`, `DashboardNoteCard.test.tsx`, `HoldingsTable*`, `outcomes.test.tsx`): 18 files, 219 tests passed, 0 failed, 0 skipped. `DashboardNoteCard`'s `focus→blur with UNCHANGED content fires NO PATCH (dirty check)` case runs in that sweep unchanged and passes. Wider run, all of `src/components/notes` and `src/app/(dashboard)/allocations`: 169 files, 2832 tests passed, 0 failed, 0 skipped.
- `npx tsc --noEmit`: exit 0 (after fixing the `it.each` callback arity in the predicate test; the first typecheck flagged it).
- `npm run lint`: 0 errors, 2 warnings, both unused-variable warnings in files this plan did not touch (see Deferred Issues); the route, manifest, hygiene and domain checks all OK.
- Component neuter (the four `.pre` components copied over the fixed ones): 12 D-10 cases failed and 44 passed across the four files: StrategyNoteCard 4 (open-and-leave, focus-then-blur, whitespace-only, unchanged saved note), HoldingNoteRow 3, BridgeOutcomeNoteSection 3, HoldingDetail 2. All four restored from `.post` backups; `cmp` clean.
- Always-true predicate mutant (`return true`): 7 failed on `should-save-note.test.ts` and `StrategyNoteCard.test.tsx`: the table's four `false` rows (`("", "")`, `("   ", "")`, `("x", "x")`, `("", "  ")`) plus the StrategyNoteCard focus-then-blur, whitespace-only and unchanged-saved-note cases. Restored, `cmp` clean.
- Never-save predicate mutant (`return false`): 14 failed across the five files: the table's four `true` rows, and every positive or clear arm: T29, T30, the strategy typed-text arm and its Q-1 arm, the HoldingNoteRow typed-blur case and its Q-1 arm, the Bridge typed-blur arm and its Q-1 arm, the HoldingDetail typed `x` case and its Q-1 arm. Restored, `cmp` clean. The final five-file post-fix compare (`cmp` against each `.post`) is clean.
- Backups live at `<session scratchpad>/193/qv/` as `<name>.pre` and `<name>.post`.

## HEAD-green pins (named, per the plan)

These pass against today's code, because HEAD's blur always saves; the never-save mutant above shows each can fail:

- StrategyNoteCard: T29 (`blur on textarea with typed content fires PATCH ...`) and the new typed-text arm.
- HoldingNoteRow: `blur on the textarea fires PATCH with scope_kind=holding + buildHoldingScopeRef scope_ref + typed content`.
- BridgeOutcomeNoteSection: the new `typing then blur sends exactly one PATCH with the typed content (D-10 positive arm)`.
- HoldingDetail: the new `typing x then blur calls save exactly once with x`.
- The four Q-1 arms (a saved note cleared and blurred saves the clear) also pass at HEAD, since HEAD saves every blur; they are the guard that the Allow-clearing override is not lost.

Every other D-10 arm (open-and-leave, focus-then-blur, unchanged saved note, whitespace-only) failed at HEAD and passes now. The strategy card's open-and-leave case failed at HEAD on its focus assertion (see measurement), so A-193-13 did not need the fallback RED arm.

## Deviations from Plan

None to the design. Two small execution notes:

- **[Rule 1 - Bug] `it.each` callback arity in `should-save-note.test.ts`.** The first typecheck rejected the callback because each table row carries four elements (draft, persisted, expected, why) and the callback took three. Added the fourth parameter `_why`. Fixed in the Task 3 commit (`702b0fc6e`). The file never ran wrongly; vitest passed it before the typecheck.
- The plan lists the per-file component neuter as one run; it was run once over all four files at once. The failure counts above are per file.

## Deferred Issues (out of scope, not fixed)

- `npm run lint` warns `nativeUnitReason` is defined but never used in `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, and `isRankableAnalyticsRow` in `src/lib/factsheet/composite-read-path.ts`. Neither file is touched by this plan; both are warnings, not errors.
- A failed save then a blur on an unchanged, still-dirty draft retries (by design, the baseline did not advance). There is no test for the failed-save-then-retry path in the three real-hook surfaces; it follows from the `"saved"`-only advance, which mirrors the already-tested `DashboardNoteCard` idiom. `HoldingDetail`'s test mocks the hook with a permanently `idle` state, so it cannot exercise baseline advance at all.

## Known Stubs

None. No placeholder text or empty data source was added; the placeholder strings in the touched components are the existing user-facing copy.

## Threat Flags

None. No new endpoint, auth path or schema; `/api/notes` and `useNoteAutoSave` are unchanged. T-193-16 (writes the user did not author), T-193-17 (a real edit swallowed) and T-193-18 (HoldingDetail after a failed load) are mitigated as the plan states: the D-10 arms and mutants for the first, the positive and clear arms for the second, and the kept fence (its 403 and network-error cases still pass) for the third.

## Self-Check: PASSED

- Files: `src/components/notes/should-save-note.ts`, `src/components/notes/should-save-note.test.ts` present; all eight modified surface and test files present and byte-equal to their `.post` backups.
- Commits `13c11ff12`, `58b6df203`, `702b0fc6e` are ancestors of HEAD; `git rev-list --count` from `plan_head_before` to HEAD is 3.
- `autoFocus` absent from all four components; `shouldSaveNoteOnBlur(` present in all four; `if (noteLoadError) return;` present in `HoldingDetail.tsx`.
- No change to `STATE.md`, `ROADMAP.md`, `useNoteAutoSave.ts`, `NoteSaveStatus.tsx`, `DashboardNoteCard.tsx` or `src/app/api/notes/route.ts`.
